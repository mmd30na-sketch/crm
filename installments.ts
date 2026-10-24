/**
 * Legacy per-installment payment links («لینک پرداخت قسط»).
 *
 * This branch no longer schedules installments or sends installment reminders: the debt-SMS feature
 * (debtSms.ts) mints its own links in `crm_debt_links`. What remains here is the ability to resolve the
 * short codes already stored in `crm_installment_links` so links sent before this change keep working.
 *
 * Additive only: `crm_installments` / `crm_installment_links` are left in place (created if missing) and
 * only read. New debt links live in a separate table and a separate resolver (see debtSms.ts).
 */
import * as db from './mysql-socks';
import { owedByEnrollment } from './src/utils/finance';

export type InstallmentStatus = 'unpaid' | 'paid' | 'cancelled';

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
const phoneKey = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
/** Masked phone for lists/previews (same shape as journal/preprint code). */
const maskPhone = (v: unknown) => { const k = phoneKey(v); return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const money = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export type LinkRow = {
  code: string; installment_id: number; amount: number; expires_at: string | null;
  used_at: string | null; created_at?: string;
};

export type InstallmentStoreDeps = {
  readJsonDb: () => any;
  writeJsonDb: (store: any) => void;
};

/** Link resolution used by the trainee routes. */
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

/** The shared installment-link store used by the trainee payment routes (onlinePayments.ts). */
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

  async function get(id: number): Promise<any | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>('SELECT * FROM crm_installments WHERE id = ?', [id]);
      return row || null;
    }
    return jsonInstallments(deps.readJsonDb()).find((r) => Number(r.id) === id) || null;
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

  async function findByCode(code: string): Promise<LinkRow | null> {
    const clean = String(code || '').trim();
    if (!/^[0-9A-Za-z]{12}$/.test(clean)) return null;
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<LinkRow>('SELECT code, installment_id, amount, expires_at, used_at, created_at FROM crm_installment_links WHERE code = ?', [clean]);
      return row || null;
    }
    return (jsonLinks(deps.readJsonDb()).find((l) => String(l.code) === clean) as LinkRow) || null;
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

  return { enrollmentRemaining, get, markPaid, findByCode, markLinksUsed, resolveLink, studentInfo };
}
