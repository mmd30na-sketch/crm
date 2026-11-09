/**
 * Trainee portal API (پرتال کارآموز, installable PWA at /?portal=1). Public routes under /api/trainee-portal/*:
 * mobile OTP login (sms_templates key "otp" via sharedSms, behind CRM_TRAINEE_OTP_SMS_ENABLED=1, default off;
 * CRM_TRAINEE_OTP_TEST_MOBILE limits sends to one number) and read-only views of the trainee's own lessons,
 * installments and enrollment status. The token is the same signed { kind: 'trainee', student_id } token the
 * existing /api/trainee-payments/* routes accept, so online payment reuses the Zarinpal flow unchanged.
 * One-time entry links (crm_portal_entries, JSON fallback portal_entries) burn on first redeem and return
 * that same 30-day token. Missing optional tables (lessons, installments, terms) read as empty.
 */
import type express from 'express';
import crypto from 'crypto';
import * as db from './mysql-socks';
import { jalaliToday } from './src/utils/normalize';

const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PORTAL_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomEntryCode(len = 12): string {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += BASE62[buf[i] % BASE62.length];
  return out;
}

const utcSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function jsonEntries(store: any): any[] {
  if (!Array.isArray(store.portal_entries)) store.portal_entries = [];
  return store.portal_entries;
}

export async function ensurePortalEntrySchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_portal_entries (
      code CHAR(12) NOT NULL PRIMARY KEY,
      student_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_portal_entry_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: one-time trainee portal entry'`);
  } catch (err: any) {
    console.warn('crm_portal_entries schema setup failed:', err.message);
  }
}

type EntryIo = { readJsonDb: () => any; writeJsonDb: (store: any) => void };

/** 12-char code, single use, valid 7 days. The SMS template carries only this code, not the session token. */
export async function mintPortalEntry(studentId: number, io: EntryIo): Promise<{ code: string }> {
  const id = Number(studentId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('student id invalid');
  const expires = new Date(Date.now() + ENTRY_TTL_MS);
  if (db.isMysqlEnabled()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomEntryCode();
      try {
        await db.sqlExec('INSERT INTO crm_portal_entries (code, student_id, expires_at) VALUES (?, ?, ?)', [code, id, utcSql(expires)]);
        return { code };
      } catch (err: any) {
        if (err?.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    throw new Error('portal entry code collision');
  }
  const store = io.readJsonDb();
  const list = jsonEntries(store);
  const taken = new Set(list.map((l: any) => String(l.code)));
  let code = randomEntryCode();
  while (taken.has(code)) code = randomEntryCode();
  list.push({ code, student_id: id, expires_at: expires.toISOString(), used_at: null, created_at: new Date().toISOString() });
  io.writeJsonDb(store);
  return { code };
}

type Deps = {
  normalizeMobile: (v: unknown) => string; // '' when invalid else '09xxxxxxxxx'
  signToken: (payload: Record<string, unknown>, ttlMs?: number) => string;
  verifyToken: (token: string) => any | null;
  readJsonDb: () => any; // fallback JSON store
  writeJsonDb: (store: any) => void;
  sms: {
    sendTemplate: (
      key: string,
      mobile: string,
      vars: Record<string, unknown>,
      fallback?: { templateId?: string; param?: string }
    ) => Promise<{ ok: boolean; status: string; detail?: string }>;
  };
  log: (msg: string) => void;
};

type OtpEntry = {
  hash: string;
  exp: number;
  tries: number;
  studentIds: number[];
};

type RateRecord = {
  timestamps: number[];
};

export function registerTraineePortal(
  app: express.Express,
  deps: Deps
): void {
  const OTP_TTL_MS = 120_000;
  const OTP_MAX_TRIES = 5;
  const OTP_RATE_IP_LIMIT = 10;
  const OTP_RATE_MOBILE_LIMIT = 3;
  const OTP_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 min
  const OTP_MIN_INTERVAL_MS = 60_000; // 60 sec

  const otpStore = new Map<string, OtpEntry>();
  const ipRateMap = new Map<string, RateRecord>();
  const mobileRateMap = new Map<string, RateRecord>();
  const lastSendMap = new Map<string, number>();

  /** normalizeMobile only normalises; a usable number must be 09xxxxxxxxx. */
  const validMobile = (v: unknown): string => { const m = deps.normalizeMobile(v); return /^09\d{9}$/.test(m) ? m : ''; };

  const maskMobile = (mobile: string): string => {
    // 09xx***xx
    if (mobile.length !== 11) return mobile;
    return mobile.slice(0, 4) + '***' + mobile.slice(7);
  };

  const getAuthStudentIds = (req: express.Request): number[] | null => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    const data = deps.verifyToken(token);
    const sid = Number(data?.student_id);
    if (!data || data.kind !== 'trainee' || !Number.isInteger(sid) || sid <= 0) {
      return null;
    }
    return [sid];
  };

  const authMiddleware = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const ids = getAuthStudentIds(req);
    if (!ids) {
      res.status(401).json({ error: 'نشست منقضی شده است؛ دوباره وارد شوید.' });
      return;
    }
    (req as any).traineeIds = ids;
    next();
  };

  const handleError = (res: express.Response, err: any) => {
    deps.log(`Error in trainee portal: ${err?.message || err}`);
    res.status(500).json({ error: 'خطای سرور' });
  };

  const enforceRateLimits = (ip: string, mobile: string): string | null => {
    const now = Date.now();

    // IP rate
    const ipRec = ipRateMap.get(ip) ?? { timestamps: [] };
    ipRec.timestamps = ipRec.timestamps.filter(t => now - t < OTP_RATE_WINDOW_MS);
    if (ipRec.timestamps.length >= OTP_RATE_IP_LIMIT) {
      return 'تعداد درخواست‌های بیش از حد برای این IP.';
    }
    ipRec.timestamps.push(now);
    ipRateMap.set(ip, ipRec);

    // Mobile rate
    const mobRec = mobileRateMap.get(mobile) ?? { timestamps: [] };
    mobRec.timestamps = mobRec.timestamps.filter(t => now - t < OTP_RATE_WINDOW_MS);
    if (mobRec.timestamps.length >= OTP_RATE_MOBILE_LIMIT) {
      return 'تعداد درخواست‌های بیش از حد برای این شماره موبایل.';
    }
    const lastSend = lastSendMap.get(mobile) ?? 0;
    if (now - lastSend < OTP_MIN_INTERVAL_MS) {
      return 'فاصله زمانی بین ارسال کدها کمتر از حد مجاز است.';
    }
    mobRec.timestamps.push(now);
    mobileRateMap.set(mobile, mobRec);
    lastSendMap.set(mobile, now);
    return null;
  };

  // -------- OTP REQUEST ----------
  app.post('/api/trainee-portal/otp/request', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { mobile } = req.body ?? {};
      const normMobile = validMobile(mobile);
      if (!normMobile) {
        res.status(400).json({ error: 'شماره موبایل نامعتبر است.' });
        return;
      }

      const ip = String(req.ip || 'unknown');
      const rateErr = enforceRateLimits(ip, normMobile);
      if (rateErr) {
        res.status(429).json({ error: rateErr });
        return;
      }

      // Find students
      let studentIds: number[] = [];
      if (db.isMysqlEnabled()) {
        const rows = await db.sql<{ id: number }>(
          `SELECT student_id AS id FROM students WHERE RIGHT(REPLACE(REPLACE(phone_number,' ',''),'-',''),10) = ?`,
          [normMobile.slice(-10)]
        );
        studentIds = rows.map(r => Number(r.id)).slice(0, 10);
      } else {
        const json = deps.readJsonDb();
        if (Array.isArray(json?.students)) {
          studentIds = json.students
            .filter((s: any) => {
              const pn = typeof s.phone_number === 'string' ? s.phone_number.replace(/[ \-]/g, '') : '';
              return pn.slice(-10) === normMobile.slice(-10);
            })
            .map((s: any) => Number(s.id));
        }
      }

      const now0 = Date.now();
      for (const [k, v] of otpStore) if (v.exp < now0) otpStore.delete(k); // sweep expired codes
      const code = String(crypto.randomInt(0, 100000)).padStart(5, '0');
      const hash = crypto.createHash('sha256').update(code + normMobile).digest('hex');
      otpStore.set(normMobile, {
        hash,
        exp: Date.now() + OTP_TTL_MS,
        tries: 0,
        studentIds,
      });

      let sent = false;
      const smsEnabled = process.env.CRM_TRAINEE_OTP_SMS_ENABLED === '1';
      const testMobile = process.env.CRM_TRAINEE_OTP_TEST_MOBILE
        ? validMobile(process.env.CRM_TRAINEE_OTP_TEST_MOBILE)
        : '';
      // Unknown numbers get the same response but never an SMS (no enumeration, no spam relay).
      if (smsEnabled && studentIds.length > 0 && (!testMobile || testMobile === normMobile)) {
        const templateKey = process.env.CRM_TRAINEE_OTP_TEMPLATE_KEY || 'otp';
        const smsRes = await deps.sms.sendTemplate(
          templateKey,
          normMobile,
          { CODE: code, code },
          undefined
        );
        sent = smsRes.ok;
        if (!smsRes.ok) deps.log(`otp sms to ${maskMobile(normMobile)} failed: ${smsRes.status}`);
      }

      const response: any = {
        ok: true,
        sent,
        expires_in: Math.floor(OTP_TTL_MS / 1000),
      };
      if (process.env.CRM_TRAINEE_OTP_DEV_ECHO === '1' && process.env.NODE_ENV !== 'production') {
        response.dev_code = code;
      }
      res.json(response);
    } catch (e) {
      handleError(res, e);
    }
  });

  // -------- OTP VERIFY ----------
  const verifyIpMap = new Map<string, RateRecord>();
  app.post('/api/trainee-portal/otp/verify', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const vip = String(req.ip || 'unknown');
      const vnow = Date.now();
      const vrec = verifyIpMap.get(vip) ?? { timestamps: [] };
      vrec.timestamps = vrec.timestamps.filter((t) => vnow - t < OTP_RATE_WINDOW_MS);
      if (vrec.timestamps.length >= 30) {
        res.status(429).json({ error: 'تلاش‌های زیاد؛ کمی بعد دوباره امتحان کنید.' });
        return;
      }
      vrec.timestamps.push(vnow);
      verifyIpMap.set(vip, vrec);
      const { mobile, code } = req.body ?? {};
      const normMobile = validMobile(mobile);
      if (!normMobile) {
        res.status(400).json({ error: 'شماره موبایل نامعتبر است.' });
        return;
      }

      const persianDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
      const latinDigits = ['0','1','2','3','4','5','6','7','8','9'];
      let codeStr = String(code ?? '');
      persianDigits.forEach((p, i) => {
        codeStr = codeStr.replace(new RegExp(p, 'g'), latinDigits[i]);
      });
      if (!/^\d{5}$/.test(codeStr)) {
        res.status(401).json({ error: 'کد تأیید نادرست یا منقضی است.' });
        return;
      }

      const entry = otpStore.get(normMobile);
      if (!entry || entry.exp < Date.now()) {
        res.status(401).json({ error: 'کد تأیید نادرست یا منقضی است.' });
        return;
      }

      if (entry.tries >= OTP_MAX_TRIES) {
        otpStore.delete(normMobile);
        res.status(401).json({ error: 'کد تأیید نادرست یا منقضی است.' });
        return;
      }

      const incomingHash = crypto.createHash('sha256').update(codeStr + normMobile).digest('hex');
      const storedHashBuf = Buffer.from(entry.hash, 'hex');
      const incomingBuf = Buffer.from(incomingHash, 'hex');
      const match = crypto.timingSafeEqual(storedHashBuf, incomingBuf);
      if (!match) {
        entry.tries += 1;
        otpStore.set(normMobile, entry);
        res.status(401).json({ error: 'کد تأیید نادرست یا منقضی است.' });
        return;
      }

      // success
      otpStore.delete(normMobile);
      if (!entry.studentIds.length) {
        res.status(401).json({ error: 'کد تأیید نادرست یا منقضی است.' });
        return;
      }
      const names = new Map<number, string>();
      if (db.isMysqlEnabled()) {
        const ids = entry.studentIds;
        const rows = await db.sql<any>(`SELECT student_id AS id, first_name, last_name FROM students WHERE student_id IN (${ids.map(() => '?').join(',')})`, ids);
        for (const r of rows) names.set(Number(r.id), `${r.first_name || ''} ${r.last_name || ''}`.trim());
      } else {
        for (const st of deps.readJsonDb()?.students || []) {
          if (entry.studentIds.includes(Number(st.id))) names.set(Number(st.id), `${st.first_name || ''} ${st.last_name || ''}`.trim());
        }
      }
      const accounts = entry.studentIds.map(id => ({
        student_id: id,
        name: names.get(Number(id)) || `کارآموز ${id}`,
        token: deps.signToken({ kind: 'trainee', student_id: id, via: 'otp' }, 30 * 24 * 60 * 60 * 1000),
      }));
      res.json({ accounts });
    } catch (e) {
      handleError(res, e);
    }
  });

  // -------- ONE-TIME ENTRY LINK ----------
  // Burns the code, then returns the same 30-day portal token OTP login stores on the device.
  const entryIpMap = new Map<string, RateRecord>();
  app.post('/api/trainee-portal/entry', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const ip = String(req.ip || 'unknown');
      const now = Date.now();
      const rec = entryIpMap.get(ip) ?? { timestamps: [] };
      rec.timestamps = rec.timestamps.filter((t) => now - t < OTP_RATE_WINDOW_MS);
      if (rec.timestamps.length >= 30) {
        res.status(429).json({ error: 'تلاش‌های زیاد؛ کمی بعد دوباره امتحان کنید.' });
        return;
      }
      rec.timestamps.push(now);
      entryIpMap.set(ip, rec);

      const code = String(req.body?.code ?? '').trim();
      if (!/^[0-9A-Za-z]{12}$/.test(code)) {
        res.status(404).json({ error: 'لینک ورود نامعتبر است.' });
        return;
      }

      let studentId = 0;
      if (db.isMysqlEnabled()) {
        const burned = await db.sqlExec(
          `UPDATE crm_portal_entries SET used_at = UTC_TIMESTAMP()
           WHERE code = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
          [code],
        );
        if (burned.affectedRows !== 1) {
          const [row] = await db.sql<any>('SELECT used_at FROM crm_portal_entries WHERE code = ?', [code]);
          if (!row) {
            res.status(404).json({ error: 'لینک ورود نامعتبر است.' });
            return;
          }
          res.status(410).json({ error: row.used_at ? 'این لینک قبلاً استفاده شده است.' : 'مهلت این لینک تمام شده است.' });
          return;
        }
        const [row] = await db.sql<any>('SELECT student_id FROM crm_portal_entries WHERE code = ?', [code]);
        studentId = Number(row?.student_id);
      } else {
        const store = deps.readJsonDb();
        const row = jsonEntries(store).find((l: any) => String(l.code) === code);
        if (!row) {
          res.status(404).json({ error: 'لینک ورود نامعتبر است.' });
          return;
        }
        if (row.used_at) {
          res.status(410).json({ error: 'این لینک قبلاً استفاده شده است.' });
          return;
        }
        if (row.expires_at && Date.parse(String(row.expires_at)) < Date.now()) {
          res.status(410).json({ error: 'مهلت این لینک تمام شده است.' });
          return;
        }
        row.used_at = new Date().toISOString();
        deps.writeJsonDb(store);
        studentId = Number(row.student_id);
      }

      if (!Number.isInteger(studentId) || studentId <= 0) {
        res.status(404).json({ error: 'لینک ورود نامعتبر است.' });
        return;
      }
      let name = '';
      if (db.isMysqlEnabled()) {
        const [st] = await db.sql<any>('SELECT first_name, last_name FROM students WHERE student_id = ?', [studentId]);
        name = `${st?.first_name || ''} ${st?.last_name || ''}`.trim();
      } else {
        const st = (deps.readJsonDb()?.students || []).find((s: any) => Number(s.id) === studentId);
        name = `${st?.first_name || ''} ${st?.last_name || ''}`.trim();
      }
      res.json({
        token: deps.signToken({ kind: 'trainee', student_id: studentId, via: 'entry' }, PORTAL_SESSION_MS),
        student_id: studentId,
        name: name || `کارآموز ${studentId}`,
      });
    } catch (e) {
      handleError(res, e);
    }
  });

  // -------- LESSONS ----------
  app.get('/api/trainee-portal/lessons', authMiddleware, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const studentIds: number[] = (req as any).traineeIds;
      const studentId = studentIds[0];

      if (!db.isMysqlEnabled()) {
        res.json({ upcoming: [], past: [] });
        return;
      }

      const rows = await db.sql<{
        id: number;
        lesson_date: string;
        start_time: string;
        end_time: string;
        status: string;
        instructor_name: string;
        vehicle_name: string | null;
      }>(`
        SELECT b.id, b.lesson_date, b.start_time, b.end_time, b.status,
               i.name AS instructor_name,
               v.name AS vehicle_name
        FROM crm_lesson_bookings b
        JOIN crm_instructors i ON i.id = b.instructor_id
        LEFT JOIN crm_vehicles v ON v.id = b.vehicle_id
        WHERE b.student_id = ? AND b.status <> 'cancelled'
        ORDER BY b.lesson_date, b.start_time
        LIMIT 300
      `, [studentId]);

      const today = jalaliToday(); // assuming format 'YYYY/MM/DD'
      const upcoming: any[] = [];
      const past: any[] = [];

      for (const r of rows) {
        const lesson = {
          id: r.id,
          lesson_date: r.lesson_date,
          start_time: r.start_time,
          end_time: r.end_time,
          status: r.status,
          instructor_name: r.instructor_name,
          vehicle_name: r.vehicle_name,
        };
        if (r.lesson_date >= today && r.status === 'scheduled') {
          upcoming.push(lesson);
        } else {
          past.push(lesson);
        }
      }

      // keep only most recent 30 past lessons
      const pastSorted = past
        .sort((a, b) => (a.lesson_date < b.lesson_date ? 1 : -1))
        .slice(0, 30);

      res.json({ upcoming, past: pastSorted });
    } catch (e: any) {
      if (e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146) {
        res.json({ upcoming: [], past: [] });
      } else {
        handleError(res, e);
      }
    }
  });

  // -------- INSTALLMENTS ----------
  app.get('/api/trainee-portal/installments', authMiddleware, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const studentIds: number[] = (req as any).traineeIds;
      const studentId = studentIds[0];

      if (!db.isMysqlEnabled()) {
        res.json({ installments: [] });
        return;
      }

      const rows = await db.sql<{
        id: number;
        enrollment_id: number;
        seq: number;
        amount: number;
        due_date_jalali: string;
        status: string;
      }>(`
        SELECT id, enrollment_id, seq, amount, due_date_jalali, status
        FROM crm_installments
        WHERE student_id = ? AND status <> 'cancelled'
        ORDER BY due_date_jalali, seq
      `, [studentId]);

      const today = jalaliToday();
      const installments = rows.map(r => ({
        id: r.id,
        enrollment_id: r.enrollment_id,
        seq: r.seq,
        amount: Number(r.amount) || 0,
        due_date_jalali: r.due_date_jalali,
        status: r.status,
        overdue: r.status === 'unpaid' && String(r.due_date_jalali) < today,
      }));

      res.json({ installments });
    } catch (e: any) {
      if (e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146) {
        res.json({ installments: [] });
      } else {
        handleError(res, e);
      }
    }
  });

  // -------- STATUS ----------
  app.get('/api/trainee-portal/status', authMiddleware, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const studentIds: number[] = (req as any).traineeIds;
      const studentId = studentIds[0];

      if (!db.isMysqlEnabled()) {
        const json = deps.readJsonDb();
        const student = json?.students?.find((s: any) => Number(s.id) === studentId);
        if (!student) {
          res.json({ student: null, enrollments: [] });
          return;
        }

        const enrollments = (json?.enrollments ?? []).filter((e: any) => Number(e.student_id) === studentId);
        const payments = json?.payments ?? [];

        const enriched = enrollments.map((e: any) => {
          const paid = payments
            .filter((p: any) => Number(p.enrollment_id) === Number(e.id))
            .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
          const remaining = Math.max((e.final_price ?? 0) - paid, 0);
          const course = json?.courses?.find((c: any) => Number(c.id) === Number(e.course_id)) ?? {};
          return {
            id: e.id,
            course_title: course.title ?? '',
            course_number: e.course_number,
            signup_date_jalali: e.signup_date_jalali,
            final_price: e.final_price,
            paid,
            remaining,
            term_status: '',
            term_start: '',
            term_end: '',
          };
        });

        res.json({
          student: {
            id: student.id,
            first_name: student.first_name,
            last_name: student.last_name,
            status: student.status,
          },
          enrollments: enriched,
        });
        return;
      }

      // MySQL path
      const studentRows = await db.sql<{
        id: number;
        first_name: string;
        last_name: string;
        status: string;
      }>(`SELECT * FROM students WHERE student_id = ?`, [studentId]); // status is optional (not in every schema)

      const row: any = studentRows[0] ?? null;
      const student = row ? { id: Number(row.student_id), first_name: row.first_name, last_name: row.last_name, status: row.status ?? '' } : null;

      if (!student) {
        res.json({ student: null, enrollments: [] });
        return;
      }

      // Try query with course terms join
      let enrollmentRows: any[];
      try {
        enrollmentRows = await db.sql<any>(`
          SELECT e.enrollment_id AS id,
                 c.title AS course_title,
                 e.course_number,
                 e.signup_date_jalali,
                 e.final_price,
                 b.amount_paid_from_payments AS total_paid,
                 b.balance_due,
                 t.status AS term_status,
                 t.start_date AS term_start,
                 t.end_date AS term_end
          FROM enrollments e
          LEFT JOIN v_enrollment_balances b ON b.enrollment_id = e.enrollment_id
          LEFT JOIN courses c ON c.course_id = e.course_id
          LEFT JOIN crm_course_terms t ON t.course_id = e.course_id AND t.course_number = e.course_number
          WHERE e.student_id = ?
          ORDER BY e.enrollment_id
        `, [studentId]);
      } catch (e: any) {
        // fallback without terms
        if (e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146) {
          enrollmentRows = await db.sql<any>(`
            SELECT e.enrollment_id AS id,
                   c.title AS course_title,
                   e.course_number,
                   e.signup_date_jalali,
                   e.final_price,
                   b.amount_paid_from_payments AS total_paid,
                   b.balance_due
            FROM enrollments e
            LEFT JOIN v_enrollment_balances b ON b.enrollment_id = e.enrollment_id
            LEFT JOIN courses c ON c.course_id = e.course_id
            WHERE e.student_id = ?
          `, [studentId]);
        } else {
          throw e;
        }
      }

      const enrollments = enrollmentRows.map(r => ({
        id: r.id,
        course_title: r.course_title ?? '',
        course_number: r.course_number,
        signup_date_jalali: r.signup_date_jalali,
        final_price: Number(r.final_price) || 0,
        paid: Number(r.total_paid) || 0,
        remaining: Math.max(Number(r.balance_due) || 0, 0),
        term_status: r.term_status ?? '',
        term_start: r.term_start ?? '',
        term_end: r.term_end ?? '',
      }));

      res.json({
        student: {
          id: student.id,
          first_name: student.first_name,
          last_name: student.last_name,
          status: student.status,
        },
        enrollments,
      });
    } catch (e) {
      handleError(res, e);
    }
  });
}
