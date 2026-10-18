/**
 * Trainee online installment payments: Zarinpal gateway + receipt upload, with a cashier approval step.
 *
 * Additive only: one new table crm_online_payments (JSON store fallback in db_store.json.online_payments).
 * Nothing existing is dropped or altered. Admin approval records a normal row in `payments` through the
 * same core the staff POST /api/payments route uses, so all existing accounting/owed logic applies.
 *
 * Trainee identification (no trainee login exists in this CRM — staff use the main login):
 *   - A staff member (admin/cashier) mints a signed link:  POST /api/online-payments/link/:studentId
 *     -> https://<host>/?trainee=1&t=<signed token>, valid 7 days.
 *   - Or the trainee signs in with their student id + the last 4 digits of their national code:
 *     POST /api/trainee-payments/login.
 *   Both yield the same HMAC-signed token (kind 'trainee', student_id, exp); it is only accepted by the
 *   /api/trainee-payments/* routes and never by the staff API. See docs/trainee_online_payments.md.
 */
import type express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import * as db from './mysql-socks';
import { owedByEnrollment } from './src/utils/finance';
import { zarinpalConfigFromEnv, requestPayment, verifyPayment } from './zarinpal';
import type { InstallmentStore } from './installments';
import type { DebtLinkStore } from './debtSms';

export type OnlineMethod = 'zarinpal' | 'receipt';
export type OnlineStatus = 'pending' | 'paid' | 'approved' | 'rejected';

export type OnlinePaymentDeps = {
  readJsonDb: () => any;
  writeJsonDb: (store: any) => void;
  session: (req: express.Request) => { username: string; role: string } | null;
  sanitize: (v: unknown, max: number) => string;
  normalizeMobile: (v: unknown) => string;
  jalaliToday: () => string;
  signToken: (payload: Record<string, unknown>, ttlMs?: number) => string;
  verifyToken: (token: string) => any | null;
  /** Records a real payment row: same path as POST /api/payments. Throws { status, message } on rejection. */
  createPayment: (input: {
    studentId: number; linkedEnrollmentId: number; amount: number;
    payDate: string; payMethod: string; paymentKind: string; description: string;
  }) => Promise<any[]>;
  /** Merchant id from settings (env ZARINPAL_MERCHANT_ID wins inside zarinpal.ts). */
  zarinpalMerchantId: () => string;
  /** Public origin for callback/return links (PUBLIC_BASE_URL or the request host). */
  publicBaseUrl: (req: express.Request) => string;
  /** Installment schedule + per-installment links (installments.ts); enables the /link/:code routes. */
  installments?: Pick<InstallmentStore, 'resolveLink' | 'markPaid' | 'markLinksUsed' | 'enrollmentRemaining'>;
  /** Remaining-debt links (debtSms.ts); resolves debt codes on the same /link/:code routes. */
  debtLinks?: Pick<DebtLinkStore, 'resolveLink' | 'studentDebt' | 'oldestOwingEnrollment' | 'attachPayment' | 'markUsedByPayment' | 'findByPayment'>;
  log?: (msg: string) => void;
};

const STATUSES: readonly OnlineStatus[] = ['pending', 'paid', 'approved', 'rejected'];
const TRAINEE_TTL_LINK_MS = 7 * 24 * 3600 * 1000;
const TRAINEE_TTL_LOGIN_MS = 2 * 3600 * 1000;
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
const RECEIPT_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
const phoneKey = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
/** Masked phone for staff lists (same shape as phase4.maskPhone). */
const maskPhone = (v: unknown) => { const k = phoneKey(v); return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const intOrNull = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export async function ensureOnlinePaymentsSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_online_payments (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      enrollment_id INT NOT NULL,
      installment_id INT UNSIGNED NULL,
      amount BIGINT NOT NULL,
      method ENUM('zarinpal','receipt') NOT NULL,
      authority VARCHAR(64) NULL,
      ref_id VARCHAR(64) NULL,
      receipt_file VARCHAR(512) NULL,
      status ENUM('pending','paid','approved','rejected') NOT NULL DEFAULT 'pending',
      admin_note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_by VARCHAR(80) NULL,
      reviewed_at DATETIME NULL,
      KEY idx_online_status (status, created_at),
      KEY idx_online_student (student_id),
      KEY idx_online_enrollment (enrollment_id),
      KEY idx_online_installment (installment_id),
      KEY idx_online_authority (authority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: trainee online installments'`);
    // Additive: an existing install of this branch's parent may already have the table without the column.
    const cols = await db.sql<{ Field: string }>(`SHOW COLUMNS FROM crm_online_payments LIKE 'installment_id'`);
    if (!cols.length) await db.sqlExec('ALTER TABLE crm_online_payments ADD COLUMN installment_id INT UNSIGNED NULL AFTER enrollment_id');
  } catch (err: any) {
    console.warn('crm_online_payments schema setup failed:', err.message);
  }
}

export function registerOnlinePayments(app: express.Express, deps: OnlinePaymentDeps) {
  const log = deps.log || (() => {});
  const receiptsDir = path.join(process.cwd(), 'uploads', 'receipts');
  fs.mkdirSync(receiptsDir, { recursive: true });

  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response) => { fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' })); };

  // ── store helpers (MySQL with a db_store.json fallback) ──
  const jsonList = (store: any): any[] => { if (!Array.isArray(store.online_payments)) store.online_payments = []; return store.online_payments; };

  async function insertOnline(values: { student_id: number; enrollment_id: number; amount: number; method: OnlineMethod; authority?: string | null; receipt_file?: string | null; status?: OnlineStatus; installment_id?: number | null }): Promise<number> {
    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec(
        `INSERT INTO crm_online_payments (student_id, enrollment_id, installment_id, amount, method, authority, receipt_file, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [values.student_id, values.enrollment_id, values.installment_id ?? null, values.amount, values.method, values.authority ?? null, values.receipt_file ?? null, values.status ?? 'pending'],
      );
      return r.insertId;
    }
    const store = deps.readJsonDb();
    const list = jsonList(store);
    const id = list.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    list.push({
      id, student_id: values.student_id, enrollment_id: values.enrollment_id, installment_id: values.installment_id ?? null,
      amount: values.amount, method: values.method, authority: values.authority ?? null, ref_id: null,
      receipt_file: values.receipt_file ?? null, status: values.status ?? 'pending', admin_note: null,
      created_at: new Date().toISOString(), reviewed_by: null, reviewed_at: null,
    });
    deps.writeJsonDb(store);
    return id;
  }

  const MUTABLE = ['status', 'ref_id', 'authority', 'admin_note', 'reviewed_by', 'reviewed_at', 'receipt_file'];
  async function updateOnline(id: number, patch: Record<string, any>): Promise<void> {
    const keys = Object.keys(patch).filter((k) => MUTABLE.includes(k));
    if (!keys.length) return;
    if (db.isMysqlEnabled()) {
      await db.sqlExec(`UPDATE crm_online_payments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
      return;
    }
    const store = deps.readJsonDb();
    const row = jsonList(store).find((r) => Number(r.id) === id);
    if (!row) return;
    for (const k of keys) row[k] = patch[k];
    deps.writeJsonDb(store);
  }

  async function getOnline(id: number): Promise<any | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>(`SELECT * FROM crm_online_payments WHERE id = ?`, [id]);
      return row || null;
    }
    return jsonList(deps.readJsonDb()).find((r) => Number(r.id) === id) || null;
  }

  async function findByAuthority(authority: string): Promise<any | null> {
    if (!authority) return null;
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>(`SELECT * FROM crm_online_payments WHERE authority = ? ORDER BY id DESC LIMIT 1`, [authority]);
      return row || null;
    }
    const list = jsonList(deps.readJsonDb()).filter((r) => r.authority === authority);
    return list.length ? list[list.length - 1] : null;
  }

  /** A student's enrollments with the amount still owed on each (never negative). */
  async function studentContext(studentId: number): Promise<{ student: any; enrollments: any[] } | null> {
    if (db.isMysqlEnabled()) {
      const [student] = await db.sql<any>(
        `SELECT student_id AS id, first_name, last_name, phone_number, national_code FROM students WHERE student_id = ?`, [studentId]);
      if (!student) return null;
      const rows = await db.sql<any>(`
        SELECT e.enrollment_id AS id, e.course_id, e.course_number, e.signup_date_jalali,
               CAST(e.final_price AS DECIMAL(15,2)) AS final_price,
               CAST(GREATEST(COALESCE(b.balance_due, 0), 0) AS DECIMAL(15,2)) AS remaining,
               c.title AS course_title
        FROM enrollments e
        LEFT JOIN v_enrollment_balances b ON b.enrollment_id = e.enrollment_id
        LEFT JOIN courses c ON c.course_id = e.course_id
        WHERE e.student_id = ? ORDER BY e.enrollment_id ASC`, [studentId]);
      return { student, enrollments: rows.map((e: any) => ({ ...e, final_price: Number(e.final_price) || 0, remaining: Number(e.remaining) || 0 })) };
    }
    const store = deps.readJsonDb();
    const student = (store.students || []).find((s: any) => Number(s.id) === studentId);
    if (!student) return null;
    const enrollments = (store.enrollments || [])
      .filter((e: any) => Number(e.student_id) === studentId)
      .sort((a: any, b: any) => Number(a.id) - Number(b.id));
    const ids = new Set(enrollments.map((e: any) => Number(e.id)));
    const payments = (store.payments || []).filter((p: any) => p.enrollment_id && ids.has(Number(p.enrollment_id)));
    const owed = owedByEnrollment(
      enrollments.map((e: any) => ({ id: Number(e.id), final_price: Number(e.final_price) || 0 })),
      payments.map((p: any) => ({ enrollment_id: Number(p.enrollment_id), amount: Number(p.amount) || 0 })),
    );
    return {
      student,
      enrollments: enrollments.map((e: any) => ({
        id: e.id, course_id: e.course_id, course_number: e.course_number ?? null,
        signup_date_jalali: e.signup_date_jalali || '', final_price: Number(e.final_price) || 0,
        remaining: owed.get(Number(e.id)) || 0,
        course_title: (store.courses || []).find((c: any) => Number(c.id) === Number(e.course_id))?.title || '',
      })),
    };
  }

  // ── trainee token ──
  function traineeStudentId(req: express.Request): number | null {
    const header = String(req.headers.authorization || '');
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : String((req.query as any)?.t || '');
    if (!raw) return null;
    const data = deps.verifyToken(raw);
    if (!data || data.kind !== 'trainee') return null;
    const sid = Number(data.student_id);
    return Number.isInteger(sid) && sid > 0 ? sid : null;
  }
  const traineeAuth: express.RequestHandler = (req, res, next) => {
    const sid = traineeStudentId(req);
    if (!sid) return res.status(401).json({ error: 'لینک پرداخت نامعتبر یا منقضی شده است.' });
    (req as any).traineeStudentId = sid;
    next();
  };
  const requestBase = (req: express.Request) => deps.publicBaseUrl(req).replace(/\/$/, '');

  /**
   * Settles whatever a gateway payment was started from: an installment (paid exactly once + its links
   * burned) or a remaining-debt link (burned once). Safe to call on every callback, including a repeated
   * one: markPaid no-ops once the row is paid and markUsedByPayment only sets used_at once.
   */
  async function settleLinkedInstallment(row: any): Promise<void> {
    const installmentId = Number(row?.installment_id) || 0;
    if (installmentId && deps.installments) {
      try { await deps.installments.markPaid(installmentId, Number(row.id)); }
      catch (e: any) { log(`failed to mark installment ${installmentId} paid: ${e?.message}`); }
      try { await deps.installments.markLinksUsed(installmentId); }
      catch (e: any) { log(`failed to mark links used for installment ${installmentId}: ${e?.message}`); }
    }
    if (deps.debtLinks) {
      try { await deps.debtLinks.markUsedByPayment(Number(row.id)); }
      catch (e: any) { log(`failed to mark debt link used for payment ${row?.id}: ${e?.message}`); }
    }
  }

  // ── receipt upload (image or PDF, 8MB) ──
  const receiptStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, receiptsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${(path.extname(file.originalname) || '').toLowerCase()}`),
  });
  const receiptUpload = multer({
    storage: receiptStorage,
    limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').toLowerCase();
      const isPdf = ext === '.pdf' && file.mimetype === 'application/pdf';
      const isImage = RECEIPT_IMAGE_EXT.has(ext) && String(file.mimetype).startsWith('image/');
      if (!isPdf && !isImage) return cb(Object.assign(new Error('فقط تصویر (JPG/PNG/WEBP) یا فایل PDF مجاز است.'), { status: 400 }));
      cb(null, true);
    },
  });
  const removeFile = (f?: Express.Multer.File) => { if (f?.path) fs.unlink(f.path, () => {}); };

  // ── trainee-facing API (public; token or ?t= required) ──
  const loginBuckets = new Map<string, { count: number; resetAt: number }>();
  app.post('/api/trainee-payments/login', wrap(async (req, res) => {
    const ip = req.ip || 'unknown';
    const bucket = loginBuckets.get(ip);
    const now = Date.now();
    if (bucket && now < bucket.resetAt && bucket.count >= 15) return res.status(429).json({ error: 'تلاش‌های زیاد؛ کمی بعد دوباره امتحان کنید.' });
    if (!bucket || now > bucket.resetAt) loginBuckets.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
    else bucket.count += 1;

    const studentId = intOrNull(req.body?.student_id);
    const last4 = toLatin(req.body?.national_last4).replace(/\D/g, '').slice(-4);
    if (!studentId || last4.length !== 4) return res.status(400).json({ error: 'شناسه کارآموز و ۴ رقم آخر کد ملی لازم است.' });
    const ctx = await studentContext(studentId);
    const national = toLatin(ctx?.student?.national_code).replace(/\D/g, '');
    if (!ctx || national.length < 4 || national.slice(-4) !== last4) {
      return res.status(401).json({ error: 'اطلاعات ورود مطابقت ندارد.' });
    }
    const token = deps.signToken({ kind: 'trainee', student_id: studentId, via: 'login' }, TRAINEE_TTL_LOGIN_MS);
    res.json({ token, student: { id: studentId, first_name: ctx.student.first_name, last_name: ctx.student.last_name } });
  }));

  app.get('/api/trainee-payments/me', traineeAuth, wrap(async (req, res) => {
    const studentId = (req as any).traineeStudentId as number;
    const ctx = await studentContext(studentId);
    if (!ctx) return res.status(404).json({ error: 'کارآموز پیدا نشد.' });
    res.json({
      student: { id: studentId, first_name: ctx.student.first_name, last_name: ctx.student.last_name, phone_masked: maskPhone(ctx.student.phone_number) },
      enrollments: ctx.enrollments,
    });
  }));

  app.get('/api/trainee-payments/payments', traineeAuth, wrap(async (req, res) => {
    const studentId = (req as any).traineeStudentId as number;
    let rows: any[];
    if (db.isMysqlEnabled()) {
      rows = await db.sql<any>(
        `SELECT id, enrollment_id, amount, method, ref_id, status, admin_note, created_at,
                receipt_file AS received_file
         FROM crm_online_payments WHERE student_id = ? ORDER BY id DESC LIMIT 100`, [studentId]);
    } else {
      rows = jsonList(deps.readJsonDb())
        .filter((r) => Number(r.student_id) === studentId)
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 100)
        .map((r) => ({ id: r.id, enrollment_id: r.enrollment_id, amount: r.amount, method: r.method, ref_id: r.ref_id, status: r.status, admin_note: r.admin_note, created_at: r.created_at, received_file: r.receipt_file }));
    }
    res.json(rows.map((r) => ({
      id: r.id, enrollment_id: r.enrollment_id, amount: Number(r.amount) || 0, method: r.method,
      ref_id: r.ref_id || null, status: r.status, admin_note: r.admin_note || null, created_at: r.created_at,
      has_receipt: !!r.received_file,
    })));
  }));

  app.post('/api/trainee-payments/zarinpal/request', traineeAuth, wrap(async (req, res) => {
    const studentId = (req as any).traineeStudentId as number;
    const enrollmentId = intOrNull(req.body?.enrollment_id);
    const amount = Math.round(Number(req.body?.amount));
    if (!enrollmentId || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'دوره و مبلغ پرداخت را درست وارد کنید.' });
    const ctx = await studentContext(studentId);
    const enrollment = ctx?.enrollments.find((e) => Number(e.id) === enrollmentId);
    if (!ctx || !enrollment) return res.status(404).json({ error: 'ثبت‌نام پیدا نشد.' });
    if (amount > enrollment.remaining) {
      return res.status(400).json({ error: enrollment.remaining > 0
        ? `مبلغ از مانده این دوره (${enrollment.remaining.toLocaleString('fa-IR')} تومان) بیشتر است.`
        : 'مانده‌ای برای پرداخت روی این دوره وجود ندارد.' });
    }
    const cfg = zarinpalConfigFromEnv(deps.zarinpalMerchantId());
    if (!cfg.merchantId) return res.status(503).json({ error: 'درگاه پرداخت آنلاین هنوز تنظیم نشده است. با آموزشگاه تماس بگیرید.' });

    const id = await insertOnline({ student_id: studentId, enrollment_id: enrollmentId, amount, method: 'zarinpal', status: 'pending' });
    const callbackUrl = `${requestBase(req)}/api/trainee-payments/zarinpal/callback`;
    try {
      const { authority, paymentUrl } = await requestPayment(cfg, {
        amountToman: amount,
        description: `پرداخت قسط دوره - ثبت‌نام ${enrollmentId}`,
        callbackUrl,
        mobile: deps.normalizeMobile(ctx.student.phone_number),
      });
      await updateOnline(id, { authority });
      res.json({ payment_url: paymentUrl, authority, online_payment_id: id });
    } catch (err: any) {
      await updateOnline(id, { status: 'rejected', admin_note: deps.sanitize(err?.message || 'خطای درگاه پرداخت', 500) });
      log(`zarinpal request failed for online payment ${id}: ${err?.message}`);
      res.status(err?.status || 502).json({ error: err?.message || 'اتصال به درگاه پرداخت ناموفق بود.' });
    }
  }));

  // Zarinpal sends the payer here (Status=OK|NOK). Always redirect back to the SPA with a fresh token.
  app.get('/api/trainee-payments/zarinpal/callback', wrap(async (req, res) => {
    const base = requestBase(req);
    const authority = deps.sanitize((req.query as any)?.Authority, 64);
    const status = String((req.query as any)?.Status || '');
    const row = authority ? await findByAuthority(authority) : null;
    if (!row) return res.redirect(302, `${base}/?trainee=1&payment=notfound`);
    const token = deps.signToken({ kind: 'trainee', student_id: row.student_id, via: 'callback' }, TRAINEE_TTL_LINK_MS);
    const back = (result: string) => res.redirect(302, `${base}/?trainee=1&t=${encodeURIComponent(token)}&payment=${result}`);

    // A repeated callback must still settle the installment (idempotently) in case it failed the first time.
    if (String(row.status) === 'paid' || String(row.status) === 'approved') {
      await settleLinkedInstallment(row);
      return back('ok');
    }
    if (status !== 'OK') {
      await updateOnline(row.id, { status: 'rejected', admin_note: 'پرداخت در درگاه لغو یا ناموفق شد.' });
      return back('failed');
    }
    const cfg = zarinpalConfigFromEnv(deps.zarinpalMerchantId());
    try {
      const result = await verifyPayment(cfg, { amountToman: Number(row.amount) || 0, authority });
      if (result.ok) {
        await updateOnline(row.id, { status: 'paid', ref_id: result.refId, admin_note: null });
        // A payment started from a per-installment link settles that installment and burns the link.
        await settleLinkedInstallment(row);
        return back('ok');
      }
      await updateOnline(row.id, { status: 'rejected', admin_note: deps.sanitize(result.message || 'تأیید پرداخت ناموفق', 500) });
      log(`zarinpal verify rejected online payment ${row.id}: ${result.message}`);
      return back('failed');
    } catch (err: any) {
      log(`zarinpal verify error for online payment ${row.id}: ${err?.message}`);
      return back('failed');
    }
  }));

  app.post('/api/trainee-payments/receipt', traineeAuth, receiptUpload.single('receipt'), wrap(async (req, res) => {
    const studentId = (req as any).traineeStudentId as number;
    const file = req.file;
    const enrollmentId = intOrNull(req.body?.enrollment_id);
    const amount = Math.round(Number(req.body?.amount));
    try {
      if (!enrollmentId || !Number.isFinite(amount) || amount <= 0) { removeFile(file); return res.status(400).json({ error: 'دوره و مبلغ پرداخت را درست وارد کنید.' }); }
      if (!file) return res.status(400).json({ error: 'فایل رسید (تصویر یا PDF) ارسال نشد.' });
      const ctx = await studentContext(studentId);
      const enrollment = ctx?.enrollments.find((e) => Number(e.id) === enrollmentId);
      if (!ctx || !enrollment) { removeFile(file); return res.status(404).json({ error: 'ثبت‌نام پیدا نشد.' }); }
      if (amount > enrollment.remaining) {
        removeFile(file);
        return res.status(400).json({ error: enrollment.remaining > 0
          ? `مبلغ از مانده این دوره (${enrollment.remaining.toLocaleString('fa-IR')} تومان) بیشتر است.`
          : 'مانده‌ای برای پرداخت روی این دوره وجود ندارد.' });
      }
      const receiptFile = `/uploads/receipts/${path.basename(file.path)}`;
      const id = await insertOnline({ student_id: studentId, enrollment_id: enrollmentId, amount, method: 'receipt', receipt_file: receiptFile, status: 'pending' });
      res.json({ ok: true, id, status: 'pending' });
    } catch (err: any) {
      removeFile(file);
      throw err;
    }
  }));

  // Lets the trainee preview their own uploaded receipt (staff /uploads needs a staff token).
  app.get('/api/trainee-payments/receipts/:id/file', traineeAuth, wrap(async (req, res) => {
    const studentId = (req as any).traineeStudentId as number;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const row = await getOnline(id);
    if (!row || Number(row.student_id) !== studentId || !row.receipt_file) return res.status(404).json({ error: 'رسیدی پیدا نشد.' });
    const rel = decodeURIComponent(String(row.receipt_file).split(/[?#]/)[0]).replace(/^\/+/, '');
    const abs = path.resolve(process.cwd(), rel);
    if (!abs.startsWith(receiptsDir + path.sep) || !fs.existsSync(abs)) return res.status(404).json({ error: 'فایل پیدا نشد.' });
    res.sendFile(abs);
  }));

  // ── short payment links (the code is the auth): debt links first, then legacy installment links ──
  const linkReason = (status: 'not_found' | 'expired' | 'used') =>
    status === 'expired' ? { code: 410, error: 'این لینک پرداخت منقضی شده است.' }
      : status === 'used' ? { code: 409, error: 'این لینک پرداخت قبلاً استفاده شده است.' }
        : { code: 404, error: 'لینک پرداخت پیدا نشد.' };

  app.get('/api/trainee-payments/link/:code', wrap(async (req, res) => {
    const code = String(req.params.code || '');
    if (deps.debtLinks) {
      const debt = await deps.debtLinks.resolveLink(code);
      if (debt.status === 'ok') {
        const total = await deps.debtLinks.studentDebt(debt.student_id);
        return res.json({
          kind: 'debt',
          student: debt.student,
          enrollment_id: null,
          amount: Math.min(debt.amount, total),
          debt_total: total,
          due_date_jalali: null,
          installment: null,
          expires_at: debt.expires_at,
          paid: total <= 0,
        });
      }
      if (debt.status !== 'not_found') { const r = linkReason(debt.status); return res.status(r.code).json({ error: r.error }); }
    }
    if (!deps.installments) return res.status(503).json({ error: 'این بخش در دسترس نیست.' });
    const resolved = await deps.installments.resolveLink(code);
    if (resolved.status !== 'ok') { const r = linkReason(resolved.status); return res.status(r.code).json({ error: r.error }); }
    res.json({
      kind: 'installment',
      student: resolved.student,
      enrollment_id: resolved.enrollment_id,
      amount: resolved.amount_toman,
      due_date_jalali: resolved.due_date_jalali,
      installment: { id: resolved.installment.id, seq: Number(resolved.installment.seq) || 1, status: resolved.installment_status },
      expires_at: resolved.link.expires_at || null,
      paid: resolved.installment_status === 'paid',
    });
  }));

  app.post('/api/trainee-payments/link/:code/zarinpal', wrap(async (req, res) => {
    const code = String(req.params.code || '');
    const cfg = zarinpalConfigFromEnv(deps.zarinpalMerchantId());
    if (!cfg.merchantId) return res.status(503).json({ error: 'درگاه پرداخت آنلاین هنوز تنظیم نشده است. با آموزشگاه تماس بگیرید.' });
    const callbackUrl = `${requestBase(req)}/api/trainee-payments/zarinpal/callback`;

    // Remaining-debt link: charge the link amount, capped at the balance still owed right now.
    if (deps.debtLinks) {
      const debt = await deps.debtLinks.resolveLink(code);
      if (debt.status === 'ok') {
        const studentId = debt.student_id;
        const total = await deps.debtLinks.studentDebt(studentId);
        if (total <= 0) return res.status(409).json({ error: 'مانده بدهی شما تسویه شده است.' });
        const amount = Math.round(Math.min(debt.amount, total));
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'مبلغ این لینک معتبر نیست.' });
        const enrollmentId = await deps.debtLinks.oldestOwingEnrollment(studentId);
        if (!enrollmentId) return res.status(409).json({ error: 'ثبت‌نامی با مانده بدهی پیدا نشد.' });
        const id = await insertOnline({ student_id: studentId, enrollment_id: enrollmentId, amount, method: 'zarinpal', status: 'pending' });
        try {
          const { authority, paymentUrl } = await requestPayment(cfg, {
            amountToman: amount,
            description: `پرداخت مانده بدهی - کارآموز ${studentId}`,
            callbackUrl,
            mobile: deps.normalizeMobile((await studentContext(studentId))?.student?.phone_number),
          });
          await updateOnline(id, { authority });
          // Attach only once the gateway accepted the request, so a failed request leaves the link free.
          await deps.debtLinks.attachPayment(code, id);
          res.json({ payment_url: paymentUrl, authority, online_payment_id: id, kind: 'debt' });
        } catch (err: any) {
          await updateOnline(id, { status: 'rejected', admin_note: deps.sanitize(err?.message || 'خطای درگاه پرداخت', 500) });
          log(`zarinpal request failed for debt link payment ${id}: ${err?.message}`);
          res.status(err?.status || 502).json({ error: err?.message || 'اتصال به درگاه پرداخت ناموفق بود.' });
        }
        return;
      }
      if (debt.status !== 'not_found') { const r = linkReason(debt.status); return res.status(r.code).json({ error: r.error }); }
    }

    if (!deps.installments) return res.status(503).json({ error: 'این بخش در دسترس نیست.' });
    const resolved = await deps.installments.resolveLink(code);
    if (resolved.status !== 'ok') { const r = linkReason(resolved.status); return res.status(r.code).json({ error: r.error }); }
    const enrollmentId = resolved.enrollment_id;
    const studentId = resolved.student_id;
    const amount = Math.round(resolved.amount_toman);
    if (!enrollmentId || !studentId || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'مبلغ این لینک معتبر نیست.' });
    if (resolved.installment_status === 'paid') return res.status(409).json({ error: 'این قسط قبلاً پرداخت شده است.' });
    const remaining = await deps.installments.enrollmentRemaining(enrollmentId);
    if (remaining !== null && remaining <= 0) return res.status(409).json({ error: 'مانده‌ای برای پرداخت روی این دوره وجود ندارد.' });

    const id = await insertOnline({ student_id: studentId, enrollment_id: enrollmentId, amount, method: 'zarinpal', status: 'pending', installment_id: resolved.installment.id });
    try {
      const { authority, paymentUrl } = await requestPayment(cfg, {
        amountToman: amount,
        description: `پرداخت قسط ${resolved.installment.seq || ''} - ثبت‌نام ${enrollmentId}`,
        callbackUrl,
        mobile: deps.normalizeMobile((await studentContext(studentId))?.student?.phone_number),
      });
      await updateOnline(id, { authority });
      res.json({ payment_url: paymentUrl, authority, online_payment_id: id, kind: 'installment' });
    } catch (err: any) {
      await updateOnline(id, { status: 'rejected', admin_note: deps.sanitize(err?.message || 'خطای درگاه پرداخت', 500) });
      log(`zarinpal request failed for installment link payment ${id}: ${err?.message}`);
      res.status(err?.status || 502).json({ error: err?.message || 'اتصال به درگاه پرداخت ناموفق بود.' });
    }
  }));

  // ── staff API (global auth middleware already ran) ──
  const staffRole = (req: express.Request): string => deps.session(req)?.role || '';
  const requireStaffRole = (req: express.Request, res: express.Response): boolean => {
    const role = staffRole(req);
    if (role !== 'admin' && role !== 'cashier') { res.status(403).json({ error: 'دسترسی ندارید.' }); return false; }
    return true;
  };

  app.get('/api/online-payments', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const status = STATUSES.includes(req.query.status as OnlineStatus) ? String(req.query.status) : '';
    let rows: any[];
    if (db.isMysqlEnabled()) {
      rows = await db.sql<any>(`
        SELECT p.id, p.student_id, p.enrollment_id, p.installment_id, p.amount, p.method, p.ref_id, p.receipt_file,
               p.status, p.admin_note, p.created_at, p.reviewed_by, p.reviewed_at,
               s.first_name, s.last_name, s.phone_number, e.course_number, c.title AS course_title
        FROM crm_online_payments p
        LEFT JOIN students s ON s.student_id = p.student_id
        LEFT JOIN enrollments e ON e.enrollment_id = p.enrollment_id
        LEFT JOIN courses c ON c.course_id = e.course_id
        ${status ? 'WHERE p.status = ?' : ''}
        ORDER BY p.id DESC LIMIT 500`, status ? [status] : []);
    } else {
      const store = deps.readJsonDb();
      rows = jsonList(store)
        .filter((r) => !status || r.status === status)
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 500)
        .map((r) => {
          const student = (store.students || []).find((s: any) => Number(s.id) === Number(r.student_id));
          const enr = (store.enrollments || []).find((e: any) => Number(e.id) === Number(r.enrollment_id));
          const course = enr ? (store.courses || []).find((c: any) => Number(c.id) === Number(enr.course_id)) : null;
          return { ...r, first_name: student?.first_name || '', last_name: student?.last_name || '', phone_number: student?.phone_number || '', course_number: enr?.course_number ?? null, course_title: course?.title || '' };
        });
    }
    res.json(rows.map((r) => ({
      id: r.id, student_id: r.student_id, enrollment_id: r.enrollment_id, installment_id: r.installment_id != null ? Number(r.installment_id) : null,
      amount: Number(r.amount) || 0,
      method: r.method, ref_id: r.ref_id || null, status: r.status, admin_note: r.admin_note || null,
      created_at: r.created_at, reviewed_by: r.reviewed_by || null, reviewed_at: r.reviewed_at || null,
      student_name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
      phone_masked: maskPhone(r.phone_number), course_title: r.course_title || '', course_number: r.course_number ?? null,
      receipt_file: r.receipt_file || null,
    })));
  }));

  app.post('/api/online-payments/:id/approve', wrap(async (req, res) => {
    const session = deps.session(req);
    if (!requireStaffRole(req, res)) return;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const row = await getOnline(id);
    if (!row) return res.status(404).json({ error: 'پرداخت آنلاین پیدا نشد.' });
    if (row.status === 'approved') return res.status(409).json({ error: 'این پرداخت قبلاً تأیید شده است.' });
    if (row.status === 'rejected') return res.status(409).json({ error: 'این پرداخت رد شده است.' });
    if (row.method === 'zarinpal' && row.status !== 'paid') {
      return res.status(400).json({ error: 'پرداخت زرین‌پال این ردیف تأیید نشده؛ تا تکمیل پرداخت قابل ثبت نیست.' });
    }
    try {
      const debtLink = deps.debtLinks ? await deps.debtLinks.findByPayment(id) : null;
      const rows = await deps.createPayment({
        studentId: Number(row.student_id),
        linkedEnrollmentId: Number(row.enrollment_id),
        amount: Number(row.amount) || 0,
        payDate: deps.jalaliToday(),
        payMethod: 'online',
        paymentKind: debtLink ? 'debt' : 'installment',
        description: debtLink
          ? `پرداخت آنلاین مانده بدهی #${id} (${row.method === 'zarinpal' ? 'زرین‌پال' : 'رسید'})`
          : `پرداخت آنلاین #${id} (${row.method === 'zarinpal' ? 'زرین‌پال' : 'رسید'})`,
      });
      await updateOnline(id, { status: 'approved', reviewed_by: session?.username || null, reviewed_at: nowSql() });
      res.json({ ok: true, payment: rows[0] || null, allocations: rows.length });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err?.message || 'ثبت پرداخت ناموفق بود.' });
    }
  }));

  app.post('/api/online-payments/:id/reject', wrap(async (req, res) => {
    const session = deps.session(req);
    if (!requireStaffRole(req, res)) return;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const row = await getOnline(id);
    if (!row) return res.status(404).json({ error: 'پرداخت آنلاین پیدا نشد.' });
    if (row.status === 'approved') return res.status(409).json({ error: 'پرداخت تأییدشده را نمی‌توان رد کرد.' });
    const note = deps.sanitize(req.body?.admin_note, 500);
    await updateOnline(id, { status: 'rejected', admin_note: note || null, reviewed_by: session?.username || null, reviewed_at: nowSql() });
    res.json({ ok: true });
  }));

  app.post('/api/online-payments/link/:studentId', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const studentId = intOrNull(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const ctx = await studentContext(studentId);
    if (!ctx) return res.status(404).json({ error: 'کارآموز پیدا نشد.' });
    const token = deps.signToken({ kind: 'trainee', student_id: studentId, via: 'link' }, TRAINEE_TTL_LINK_MS);
    const url = `${requestBase(req)}/?trainee=1&t=${encodeURIComponent(token)}`;
    res.json({ url, token, expires_in_days: 7, student_name: [ctx.student.first_name, ctx.student.last_name].filter(Boolean).join(' ').trim(), phone_masked: maskPhone(ctx.student.phone_number) });
  }));
}
