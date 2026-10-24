/**
 * Installment schedule («اقساط») + per-installment payment links.
 *
 * Additive only: two new tables `crm_installments` and `crm_installment_links` (JSON store fallback in
 * db_store.json.installments / installment_links). Existing tables are only read. The balance side still
 * comes from `v_enrollment_balances` (MySQL) / owedByEnrollment() (JSON): an installment plan is a promise
 * about the existing debt, it never creates money.
 *
 * A link is a short random base62 code; the public URL `${PUBLIC_BASE_URL}/p/<code>` opens the trainee
 * payment panel with the amount preset. onlinePayments.ts consumes links (GET/POST trainee link routes)
 * through createInstallmentStore(); reminders.ts reuses getOrCreateLink().
 */
import type express from 'express';
import crypto from 'crypto';
import * as db from './mysql-socks';
import { owedByEnrollment } from './src/utils/finance';
import { normalizeJalaliDate, jalaliToday as tehranJalaliToday } from './src/utils/normalize';
import { addJalaliDays, addJalaliMonths, jalaliToGregorian } from './src/utils/jalali';

export type InstallmentStatus = 'unpaid' | 'paid' | 'cancelled';
const STATUSES: readonly InstallmentStatus[] = ['unpaid', 'paid', 'cancelled'];

const DEFAULT_LINK_DAYS = 7;
const LINK_MIN_DAYS_AFTER_DUE = 3;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function randomLinkCode(len = 12): string {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += BASE62[buf[i] % BASE62.length];
  return out;
}

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
const phoneKey = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
/** Masked phone for lists/previews (same shape as journal/preprint code). */
const maskPhone = (v: unknown) => { const k = phoneKey(v); return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const intOrNull = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const money = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const sqlDateTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export type InstallmentRow = {
  id: number; student_id: number; enrollment_id: number; seq: number; amount: number;
  due_date_jalali: string; status: InstallmentStatus; paid_at: string | null;
  online_payment_id: number | null; created_by: string | null; created_at: string; notes: string | null;
  student_name?: string; phone_masked?: string; course_title?: string; course_number?: number | null;
};

export type LinkRow = {
  code: string; installment_id: number; amount: number; expires_at: string | null;
  used_at: string | null; created_at?: string;
};

export type InstallmentStoreDeps = {
  readJsonDb: () => any;
  writeJsonDb: (store: any) => void;
};

/** Link resolution used by the trainee routes and the reminder preview. */
export type ResolvedLink =
  | { status: 'ok'; link: LinkRow; installment: any; enrollment_id: number; student_id: number; amount: number; amount_toman: number; due_date_jalali: string; installment_status: InstallmentStatus; student: { first_name: string; last_name: string; phone_masked: string } }
  | { status: 'not_found' | 'expired' | 'used' };

export async function ensureInstallmentsSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_installments (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      enrollment_id INT NOT NULL,
      seq INT NOT NULL DEFAULT 1,
      amount BIGINT NOT NULL COMMENT 'Toman, same unit as payments.amount',
      due_date_jalali CHAR(10) NOT NULL COMMENT 'Jalali yyyy/mm/dd',
      status ENUM('unpaid','paid','cancelled') NOT NULL DEFAULT 'unpaid',
      paid_at DATETIME NULL,
      online_payment_id INT UNSIGNED NULL,
      created_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT NULL,
      KEY idx_inst_enrollment (enrollment_id, status),
      KEY idx_inst_due (status, due_date_jalali),
      KEY idx_inst_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: enrollment installment schedule / اقساط ثبت‌نام'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_installment_links (
      code CHAR(12) NOT NULL PRIMARY KEY,
      installment_id INT UNSIGNED NOT NULL,
      amount BIGINT NOT NULL COMMENT 'Toman, copied from the installment',
      expires_at DATETIME NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_link_installment (installment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: per-installment payment links / لینک پرداخت قسط'`);
  } catch (err: any) {
    console.warn('crm_installments schema setup failed:', err.message);
  }
}

/** The shared installment/link store used by the routes, onlinePayments.ts and reminders.ts. */
export type InstallmentStore = ReturnType<typeof createInstallmentStore>;

export function createInstallmentStore(deps: InstallmentStoreDeps) {
  const jsonInstallments = (store: any): any[] => { if (!Array.isArray(store.installments)) store.installments = []; return store.installments; };
  const jsonLinks = (store: any): any[] => { if (!Array.isArray(store.installment_links)) store.installment_links = []; return store.installment_links; };

  async function enrollmentRemaining(enrollmentId: number): Promise<number | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>(
        `SELECT CAST(GREATEST(COALESCE(balance_due, 0), 0) AS DECIMAL(15,2)) AS remaining FROM v_enrollment_balances WHERE enrollment_id = ?`,
        [enrollmentId]);
      if (row) return Number(row.remaining) || 0;
      // No balance row (no payments yet): fall back to the enrollment's final_price.
      const [enr] = await db.sql<any>(`SELECT CAST(final_price AS DECIMAL(15,2)) AS final_price FROM enrollments WHERE enrollment_id = ?`, [enrollmentId]);
      return enr ? Number(enr.final_price) || 0 : null;
    }
    const store = deps.readJsonDb();
    const enr = (store.enrollments || []).find((e: any) => Number(e.id) === enrollmentId);
    if (!enr) return null;
    const payments = (store.payments || []).filter((p: any) => Number(p.enrollment_id) === enrollmentId);
    const owed = owedByEnrollment([{ id: enrollmentId, final_price: Number(enr.final_price) || 0 }],
      payments.map((p: any) => ({ enrollment_id: enrollmentId, amount: Number(p.amount) || 0 })));
    return owed.get(enrollmentId) || 0;
  }

  async function enrollmentStudent(enrollmentId: number): Promise<number | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>('SELECT student_id FROM enrollments WHERE enrollment_id = ?', [enrollmentId]);
      return row ? Number(row.student_id) : null;
    }
    const enr = (deps.readJsonDb().enrollments || []).find((e: any) => Number(e.id) === enrollmentId);
    return enr ? Number(enr.student_id) : null;
  }

  async function sumUnpaid(enrollmentId: number, excludeId = 0): Promise<number> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM crm_installments WHERE enrollment_id = ? AND status = 'unpaid' AND id <> ?`,
        [enrollmentId, excludeId]);
      return Number(row?.s) || 0;
    }
    return jsonInstallments(deps.readJsonDb())
      .filter((r) => Number(r.enrollment_id) === enrollmentId && r.status === 'unpaid' && Number(r.id) !== excludeId)
      .reduce((s, r) => s + money(r.amount), 0);
  }

  async function list(filter: { enrollment_id?: number; student_id?: number; status?: string; from?: string; to?: string; limit?: number } = {}): Promise<InstallmentRow[]> {
    if (db.isMysqlEnabled()) {
      const where: string[] = []; const params: any[] = [];
      if (intOrNull(filter.enrollment_id)) { where.push('i.enrollment_id = ?'); params.push(intOrNull(filter.enrollment_id)); }
      if (intOrNull(filter.student_id)) { where.push('i.student_id = ?'); params.push(intOrNull(filter.student_id)); }
      if (filter.status && (STATUSES as readonly string[]).includes(filter.status)) { where.push('i.status = ?'); params.push(filter.status); }
      if (normalizeJalaliDate(filter.from)) { where.push('i.due_date_jalali >= ?'); params.push(normalizeJalaliDate(filter.from)); }
      if (normalizeJalaliDate(filter.to)) { where.push('i.due_date_jalali <= ?'); params.push(normalizeJalaliDate(filter.to)); }
      const limit = Math.min(Math.max(intOrNull(filter.limit) || 500, 1), 2000);
      const rows = await db.sql<any>(`
        SELECT i.*, CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, '')) AS student_name,
               s.phone_number, c.title AS course_title, e.course_number
        FROM crm_installments i
        LEFT JOIN students s ON s.student_id = i.student_id
        LEFT JOIN enrollments e ON e.enrollment_id = i.enrollment_id
        LEFT JOIN courses c ON c.course_id = e.course_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY i.due_date_jalali ASC, i.id ASC LIMIT ${limit}`, params);
      return rows.map(shapeInstallment);
    }
    const store = deps.readJsonDb();
    return jsonInstallments(store)
      .filter((r) => (!intOrNull(filter.enrollment_id) || Number(r.enrollment_id) === intOrNull(filter.enrollment_id))
        && (!intOrNull(filter.student_id) || Number(r.student_id) === intOrNull(filter.student_id))
        && (!filter.status || r.status === filter.status)
        && (!normalizeJalaliDate(filter.from) || String(r.due_date_jalali) >= normalizeJalaliDate(filter.from))
        && (!normalizeJalaliDate(filter.to) || String(r.due_date_jalali) <= normalizeJalaliDate(filter.to)))
      .sort((a, b) => String(a.due_date_jalali).localeCompare(String(b.due_date_jalali)) || Number(a.id) - Number(b.id))
      .slice(0, Math.min(intOrNull(filter.limit) || 500, 2000))
      .map((r) => {
        const s = (store.students || []).find((x: any) => Number(x.id) === Number(r.student_id));
        const e = (store.enrollments || []).find((x: any) => Number(x.id) === Number(r.enrollment_id));
        const c = e ? (store.courses || []).find((x: any) => Number(x.id) === Number(e.course_id)) : null;
        return shapeInstallment({
          ...r, student_name: [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim(),
          phone_number: s?.phone_number || '', course_title: c?.title || '', course_number: e?.course_number ?? null,
        });
      });
  }

  function shapeInstallment(r: any): InstallmentRow {
    return {
      id: Number(r.id), student_id: Number(r.student_id), enrollment_id: Number(r.enrollment_id), seq: Number(r.seq) || 1,
      amount: Number(r.amount) || 0, due_date_jalali: String(r.due_date_jalali || ''), status: (r.status || 'unpaid') as InstallmentStatus,
      paid_at: r.paid_at || null, online_payment_id: r.online_payment_id != null ? Number(r.online_payment_id) : null,
      created_by: r.created_by || null, created_at: r.created_at || '', notes: r.notes || null,
      student_name: r.student_name || '', phone_masked: maskPhone(r.phone_number), course_title: r.course_title || '',
      course_number: r.course_number ?? null,
    };
  }

  async function get(id: number): Promise<any | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>('SELECT * FROM crm_installments WHERE id = ?', [id]);
      return row || null;
    }
    return jsonInstallments(deps.readJsonDb()).find((r) => Number(r.id) === id) || null;
  }

  async function nextSeq(enrollmentId: number): Promise<number> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>('SELECT COALESCE(MAX(seq), 0) AS m FROM crm_installments WHERE enrollment_id = ?', [enrollmentId]);
      return (Number(row?.m) || 0) + 1;
    }
    return jsonInstallments(deps.readJsonDb())
      .filter((r) => Number(r.enrollment_id) === enrollmentId)
      .reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0) + 1;
  }

  async function insertRow(values: {
    student_id: number; enrollment_id: number; seq: number; amount: number; due_date_jalali: string;
    notes: string | null; created_by: string | null;
  }): Promise<number> {
    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec(
        `INSERT INTO crm_installments (student_id, enrollment_id, seq, amount, due_date_jalali, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [values.student_id, values.enrollment_id, values.seq, values.amount, values.due_date_jalali, values.notes, values.created_by]);
      return r.insertId;
    }
    const store = deps.readJsonDb();
    const list = jsonInstallments(store);
    const id = list.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    list.push({
      id, student_id: values.student_id, enrollment_id: values.enrollment_id, seq: values.seq, amount: values.amount,
      due_date_jalali: values.due_date_jalali, status: 'unpaid', paid_at: null, online_payment_id: null,
      created_by: values.created_by, created_at: new Date().toISOString(), notes: values.notes,
    });
    deps.writeJsonDb(store);
    return id;
  }

  const MUTABLE = ['amount', 'due_date_jalali', 'status', 'paid_at', 'online_payment_id', 'notes'];
  async function update(id: number, patch: Record<string, any>): Promise<void> {
    const keys = Object.keys(patch).filter((k) => MUTABLE.includes(k));
    if (!keys.length) return;
    if (db.isMysqlEnabled()) {
      await db.sqlExec(`UPDATE crm_installments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
      return;
    }
    const store = deps.readJsonDb();
    const row = jsonInstallments(store).find((r) => Number(r.id) === id);
    if (!row) return;
    for (const k of keys) row[k] = patch[k];
    deps.writeJsonDb(store);
  }

  /** Marks an unpaid installment paid. Idempotent: a repeated callback is a no-op, it is never re-marked. */
  async function markPaid(installmentId: number, onlinePaymentId: number): Promise<void> {
    if (db.isMysqlEnabled()) {
      await db.sqlExec(
        `UPDATE crm_installments SET status = 'paid', paid_at = ?, online_payment_id = ? WHERE id = ? AND status = 'unpaid'`,
        [nowSql(), onlinePaymentId, installmentId]);
      return;
    }
    const store = deps.readJsonDb();
    const row = jsonInstallments(store).find((r) => Number(r.id) === installmentId);
    if (!row || row.status !== 'unpaid') return;
    row.status = 'paid'; row.paid_at = nowSql(); row.online_payment_id = onlinePaymentId;
    deps.writeJsonDb(store);
  }

  /* ── links ── */

  async function insertLink(installmentId: number, amount: number, expiresAt: string | null): Promise<LinkRow> {
    if (db.isMysqlEnabled()) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomLinkCode();
        try {
          await db.sqlExec('INSERT INTO crm_installment_links (code, installment_id, amount, expires_at) VALUES (?, ?, ?, ?)',
            [code, installmentId, amount, expiresAt]);
          return { code, installment_id: installmentId, amount, expires_at: expiresAt, used_at: null };
        } catch (err: any) {
          if (err?.code !== 'ER_DUP_ENTRY') throw err;
        }
      }
      throw Object.assign(new Error('ساخت کد پرداخت ناموفق بود؛ دوباره تلاش کنید.'), { status: 500 });
    }
    const store = deps.readJsonDb();
    const list = jsonLinks(store);
    const taken = new Set(list.map((l) => String(l.code)));
    let code = randomLinkCode();
    while (taken.has(code)) code = randomLinkCode();
    const row: LinkRow = { code, installment_id: installmentId, amount, expires_at: expiresAt, used_at: null, created_at: new Date().toISOString() };
    list.push(row);
    deps.writeJsonDb(store);
    return row;
  }

  async function findByCode(code: string): Promise<LinkRow | null> {
    const clean = String(code || '').trim();
    if (!/^[0-9A-Za-z]{12}$/.test(clean)) return null;
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<LinkRow>('SELECT code, installment_id, amount, expires_at, used_at, created_at FROM crm_installment_links WHERE code = ?', [clean]);
      return row || null;
    }
    return (jsonLinks(deps.readJsonDb()).find((l) => String(l.code) === clean) as LinkRow) || null;
  }

  /** An existing unused, unexpired link for the installment, or a fresh one. */
  async function getOrCreateLink(installmentId: number, amount: number, expiresAt: string | null): Promise<LinkRow> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<LinkRow>(
        `SELECT code, installment_id, amount, expires_at, used_at FROM crm_installment_links
         WHERE installment_id = ? AND used_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC LIMIT 1`, [installmentId]);
      if (row) return row;
    } else {
      const now = Date.now();
      const row = jsonLinks(deps.readJsonDb())
        .filter((l) => Number(l.installment_id) === installmentId && !l.used_at && (!l.expires_at || Date.parse(l.expires_at) > now))
        .pop();
      if (row) return row as LinkRow;
    }
    return insertLink(installmentId, amount, expiresAt);
  }

  async function markLinksUsed(installmentId: number): Promise<void> {
    if (db.isMysqlEnabled()) {
      await db.sqlExec('UPDATE crm_installment_links SET used_at = NOW() WHERE installment_id = ? AND used_at IS NULL', [installmentId]);
      return;
    }
    const store = deps.readJsonDb();
    let changed = false;
    for (const l of jsonLinks(store)) if (Number(l.installment_id) === installmentId && !l.used_at) { l.used_at = new Date().toISOString(); changed = true; }
    if (changed) deps.writeJsonDb(store);
  }

  async function studentInfo(studentId: number): Promise<{ first_name: string; last_name: string; phone_number: string } | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>('SELECT first_name, last_name, phone_number FROM students WHERE student_id = ?', [studentId]);
      return row || null;
    }
    const s = (deps.readJsonDb().students || []).find((x: any) => Number(x.id) === studentId);
    return s ? { first_name: s.first_name || '', last_name: s.last_name || '', phone_number: s.phone_number || '' } : null;
  }

  /** Link + installment + masked student, or a reason the link cannot be used. */
  async function resolveLink(code: string): Promise<ResolvedLink> {
    const link = await findByCode(code);
    if (!link) return { status: 'not_found' };
    if (link.used_at) return { status: 'used' };
    if (link.expires_at && Date.parse(link.expires_at) < Date.now()) return { status: 'expired' };
    const installment = await get(Number(link.installment_id));
    if (!installment) return { status: 'not_found' };
    const student = await studentInfo(Number(installment.student_id));
    return {
      status: 'ok', link, installment,
      enrollment_id: Number(installment.enrollment_id), student_id: Number(installment.student_id),
      amount: money(installment.amount), amount_toman: money(link.amount || installment.amount),
      due_date_jalali: String(installment.due_date_jalali || ''),
      installment_status: (installment.status || 'unpaid') as InstallmentStatus,
      student: { first_name: student?.first_name || '', last_name: student?.last_name || '', phone_masked: maskPhone(student?.phone_number) },
    };
  }

  /**
   * Unpaid installments due on `dueDateJalali` with the student's masked contact info and the enrollment's
   * current remaining balance, for the reminder job and its preview.
   */
  async function dueForReminder(dueDateJalali: string): Promise<Array<{
    id: number; student_id: number; enrollment_id: number; amount: number; due_date_jalali: string; seq: number;
    first_name: string; last_name: string; phone_number: string; remaining: number;
  }>> {
    if (db.isMysqlEnabled()) {
      const rows = await db.sql<any>(`
        SELECT i.id, i.student_id, i.enrollment_id, i.amount, i.due_date_jalali, i.seq,
               COALESCE(s.first_name, '') AS first_name, COALESCE(s.last_name, '') AS last_name, COALESCE(s.phone_number, '') AS phone_number,
               CAST(GREATEST(COALESCE(b.balance_due, 0), 0) AS DECIMAL(15,2)) AS remaining
        FROM crm_installments i
        LEFT JOIN students s ON s.student_id = i.student_id
        LEFT JOIN v_enrollment_balances b ON b.enrollment_id = i.enrollment_id
        WHERE i.status = 'unpaid' AND i.due_date_jalali = ?
        ORDER BY i.id`, [dueDateJalali]);
      return rows.map((r: any) => ({
        id: Number(r.id), student_id: Number(r.student_id), enrollment_id: Number(r.enrollment_id), amount: Number(r.amount) || 0,
        due_date_jalali: String(r.due_date_jalali), seq: Number(r.seq) || 1, first_name: r.first_name, last_name: r.last_name,
        phone_number: r.phone_number, remaining: Math.max(0, Number(r.remaining) || 0),
      }));
    }
    const store = deps.readJsonDb();
    const out: any[] = [];
    for (const r of jsonInstallments(store)) {
      if (r.status !== 'unpaid' || String(r.due_date_jalali) !== dueDateJalali) continue;
      const s = (store.students || []).find((x: any) => Number(x.id) === Number(r.student_id));
      const remaining = (await enrollmentRemaining(Number(r.enrollment_id))) || 0;
      out.push({
        id: Number(r.id), student_id: Number(r.student_id), enrollment_id: Number(r.enrollment_id), amount: money(r.amount),
        due_date_jalali: String(r.due_date_jalali), seq: Number(r.seq) || 1, first_name: s?.first_name || '', last_name: s?.last_name || '',
        phone_number: s?.phone_number || '', remaining,
      });
    }
    return out;
  }

  return {
    enrollmentRemaining, enrollmentStudent, sumUnpaid, list, get, nextSeq, insertRow, update, markPaid,
    findByCode, getOrCreateLink, markLinksUsed, resolveLink, studentInfo, dueForReminder,
  };
}

/** Default link expiry: now + 7 days, but never before the due date + 3 days. */
export function defaultLinkExpiry(dueDateJalali: string): string {
  const preferred = new Date(Date.now() + DEFAULT_LINK_DAYS * 86400_000);
  const g = jalaliToGregorian(addJalaliDays(dueDateJalali, LINK_MIN_DAYS_AFTER_DUE));
  const floor = g ? new Date(g.gy, g.gm - 1, g.gd, 23, 59, 59) : null;
  return sqlDateTime(floor && floor > preferred ? floor : preferred);
}

export type InstallmentDeps = {
  store: InstallmentStore;
  session: (req: express.Request) => { username: string; role: string } | null;
  sanitize: (v: unknown, max: number) => string;
  jalaliToday: () => string;
  publicBaseUrl: (req: express.Request) => string;
  log?: (msg: string) => void;
};

export function registerInstallments(app: express.Express, deps: InstallmentDeps) {
  const { store } = deps;
  const log = deps.log || (() => {});
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response) => { fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' })); };
  const requireStaffRole = (req: express.Request, res: express.Response): boolean => {
    const role = deps.session(req)?.role || '';
    if (role !== 'admin' && role !== 'cashier') { res.status(403).json({ error: 'دسترسی ندارید.' }); return false; }
    return true;
  };
  const requestBase = (req: express.Request) => deps.publicBaseUrl(req).replace(/\/$/, '');

  app.get('/api/installments', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const q = req.query as Record<string, string>;
    res.json(await store.list({
      enrollment_id: intOrNull(q.enrollment_id) || undefined, student_id: intOrNull(q.student_id) || undefined,
      status: q.status, from: q.from, to: q.to, limit: intOrNull(q.limit) || undefined,
    }));
  }));

  /** Single installment, or `count` monthly installments over the (unplanned) remaining balance. */
  app.post('/api/installments', wrap(async (req, res) => {
    const session = deps.session(req);
    if (!requireStaffRole(req, res)) return;
    const body = req.body || {};
    const enrollmentId = intOrNull(body.enrollment_id);
    if (!enrollmentId) return res.status(400).json({ error: 'ثبت‌نام را انتخاب کنید.' });
    const studentId = await store.enrollmentStudent(enrollmentId);
    if (!studentId) return res.status(404).json({ error: 'ثبت‌نام پیدا نشد.' });
    const remaining = await store.enrollmentRemaining(enrollmentId);
    if (remaining === null) return res.status(404).json({ error: 'ثبت‌نام پیدا نشد.' });
    const existing = await store.sumUnpaid(enrollmentId);
    const available = Math.max(0, (remaining || 0) - existing);
    const notes = deps.sanitize(body.notes, 2000) || null;
    const createdBy = session?.username || null;

    const isSplit = body.split === true || (body.count !== undefined && body.split !== false);
    if (isSplit) {
      const count = intOrNull(body.count);
      if (!count || count < 1 || count > 60) return res.status(400).json({ error: 'تعداد اقساط باید بین ۱ تا ۶۰ باشد.' });
      const start = normalizeJalaliDate(body.start_date_jalali ?? deps.jalaliToday());
      if (!start) return res.status(400).json({ error: 'تاریخ شروع را به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.' });
      if (available <= 0) return res.status(400).json({ error: remaining && remaining > 0 ? 'باقیمانده‌ای برای قسط‌بندی نمانده است (اقساط موجود مانده را پوشش داده‌اند).' : 'مانده‌ای برای قسط‌بندی وجود ندارد.' });
      const base = Math.floor(available / count);
      if (base <= 0) return res.status(400).json({ error: 'مبلغ هر قسط بسیار کوچک است؛ تعداد را کم کنید.' });
      let seq = await store.nextSeq(enrollmentId);
      const ids: number[] = [];
      let allocated = 0;
      for (let i = 0; i < count; i += 1) {
        const amount = i === count - 1 ? available - allocated : base;
        allocated += amount;
        ids.push(await store.insertRow({
          student_id: studentId, enrollment_id: enrollmentId, seq, amount,
          due_date_jalali: addJalaliMonths(start, i), notes, created_by: createdBy,
        }));
        seq += 1;
      }
      return res.json({ ok: true, ids, count, total: available, remaining: (remaining || 0) - allocated });
    }

    const amount = money(body.amount);
    if (amount <= 0) return res.status(400).json({ error: 'مبلغ قسط باید بیشتر از صفر باشد.' });
    const due = normalizeJalaliDate(body.due_date_jalali);
    if (!due) return res.status(400).json({ error: 'تاریخ سررسید را به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.' });
    if (existing + amount > (remaining || 0)) {
      return res.status(400).json({
        error: (remaining || 0) - existing > 0
          ? `مجموع اقساط از مانده این ثبت‌نام (${((remaining || 0) - existing).toLocaleString('fa-IR')} تومان) بیشتر می‌شود.`
          : 'مانده‌ای برای این ثبت‌نام وجود ندارد.',
      });
    }
    const seq = await store.nextSeq(enrollmentId);
    const id = await store.insertRow({ student_id: studentId, enrollment_id: enrollmentId, seq, amount, due_date_jalali: due, notes, created_by: createdBy });
    res.json({ ok: true, id, seq });
  }));

  app.put('/api/installments/:id', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const row = await store.get(id);
    if (!row) return res.status(404).json({ error: 'قسط پیدا نشد.' });
    const body = req.body || {};
    const patch: Record<string, any> = {};

    if (body.amount !== undefined || body.due_date_jalali !== undefined) {
      if (row.status !== 'unpaid') return res.status(400).json({ error: 'قسط پرداخت‌شده یا لغوشده قابل ویرایش مبلغ/تاریخ نیست.' });
      const amount = body.amount !== undefined ? money(body.amount) : money(row.amount);
      if (amount <= 0) return res.status(400).json({ error: 'مبلغ قسط باید بیشتر از صفر باشد.' });
      const due = body.due_date_jalali !== undefined ? normalizeJalaliDate(body.due_date_jalali) : String(row.due_date_jalali);
      if (!due) return res.status(400).json({ error: 'تاریخ سررسید را به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.' });
      const remaining = await store.enrollmentRemaining(Number(row.enrollment_id));
      const others = await store.sumUnpaid(Number(row.enrollment_id), id);
      if (remaining !== null && others + amount > remaining) {
        return res.status(400).json({ error: `مجموع اقساط از مانده این ثبت‌نام (${Math.max(0, remaining - others).toLocaleString('fa-IR')} تومان) بیشتر می‌شود.` });
      }
      if (body.amount !== undefined) patch.amount = amount;
      if (body.due_date_jalali !== undefined) patch.due_date_jalali = due;
    }
    if (body.notes !== undefined) patch.notes = deps.sanitize(body.notes, 2000) || null;
    if (Object.keys(patch).length) await store.update(id, patch);
    res.json({ ok: true });
  }));

  app.post('/api/installments/:id/cancel', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const row = await store.get(id);
    if (!row) return res.status(404).json({ error: 'قسط پیدا نشد.' });
    if (row.status === 'paid') return res.status(409).json({ error: 'قسط پرداخت‌شده را نمی‌توان لغو کرد.' });
    await store.update(id, { status: 'cancelled' });
    res.json({ ok: true });
  }));

  /** Mint (or reuse) a payment link for one installment and return its short URL. */
  app.post('/api/installments/:id/link', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const row = await store.get(id);
    if (!row) return res.status(404).json({ error: 'قسط پیدا نشد.' });
    if (row.status !== 'unpaid') return res.status(409).json({ error: row.status === 'paid' ? 'این قسط پرداخت شده است.' : 'این قسط لغو شده است.' });
    const expiresAt = defaultLinkExpiry(String(row.due_date_jalali));
    const link = await store.getOrCreateLink(id, money(row.amount), expiresAt);
    log(`installment link created for #${id} (${link.code.slice(0, 4)}…)`);
    res.json({ code: link.code, url: `${requestBase(req)}/p/${link.code}`, expires_at: link.expires_at, amount: money(link.amount) });
  }));
}
