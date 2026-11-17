/**
 * Post a gateway-verified site tuition payment (site_registration_payments, status=paid
 * and verified_at set) into the CRM money ledger (payments) exactly once, then refresh
 * enrollments.amount_paid from the sum of ledger rows.
 *
 * Golden rule: a money row is written only after gateway confirmation. This module never
 * invents a payment; it only copies already-verified site rows.
 */
import { jalaliToday } from './src/utils/normalize';

export const TRACKING_EQ =
  'CONVERT(p.tracking_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci';

export const REG_TRACKING_JOIN =
  'CONVERT(r.tracking_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.tracking_code USING utf8mb4) COLLATE utf8mb4_unicode_ci';

export type Queryable = {
  query: (sql: string, params?: any[]) => Promise<[any, any] | any[]>;
};

export type SqlExec = (sql: string, params?: any[]) => Promise<{ insertId?: number; affectedRows?: number }>;

export type LedgerDb = {
  sql: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  sqlExec: SqlExec;
};

export type SiteTuitionPayment = {
  id?: number;
  tracking_code?: string;
  amount_toman?: number | string;
  kind?: string | null;
  authority?: string | null;
  ref_id?: string | null;
  card_pan?: string | null;
  card_hash?: string | null;
  fee?: number | string | null;
  fee_type?: string | null;
  verified_at?: string | Date | null;
  course_id?: number | null;
  status?: string;
};

export type ApplyResult = { applied: number; skipped: number; amountPaid: number };

function rowsOf(result: any): any[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  return [];
}

export function normalizeGatewayToken(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 255) : null;
}

export function paymentKindFromSite(kind: unknown): string {
  return String(kind || '').trim().toLowerCase() === 'deposit' ? 'پيش پرداخت' : 'تسويه کامل';
}

/** Jalali (Tehran) date for a verified_at timestamp; falls back to today. */
export function payDateJalaliFromVerifiedAt(verifiedAt: unknown, now: Date = new Date()): string {
  if (verifiedAt instanceof Date && !Number.isNaN(verifiedAt.getTime())) return jalaliToday(verifiedAt);
  if (typeof verifiedAt === 'string' && verifiedAt.trim()) {
    const raw = verifiedAt.trim();
    const hasZone = /T/.test(raw) ? /Z|[+-]\d{2}:?\d{2}$/i.test(raw) : /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
    const iso = hasZone ? raw : raw.replace(' ', 'T') + '+03:30';
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return jalaliToday(d);
  }
  return jalaliToday(now);
}

export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as any;
  return Number(e?.errno) === 1062 || String(e?.code || '') === 'ER_DUP_ENTRY' || /duplicate entry/i.test(String(e?.message || ''));
}

async function q(conn: Queryable, sql: string, params: any[] = []): Promise<any[]> {
  return rowsOf(await conn.query(sql, params));
}

export async function refreshEnrollmentAmountPaid(conn: Queryable, enrollmentId: number): Promise<number> {
  const rows = await q(
    conn,
    'SELECT CAST(COALESCE(SUM(amount),0) AS DECIMAL(15,2)) AS paid FROM payments WHERE enrollment_id = ?',
    [enrollmentId],
  );
  const paid = Number(rows[0]?.paid || 0);
  await conn.query('UPDATE enrollments SET amount_paid = ? WHERE enrollment_id = ?', [paid, enrollmentId]);
  return paid;
}

async function ledgerRowExists(conn: Queryable, authority: string | null, refId: string | null): Promise<boolean> {
  if (!authority && !refId) return false;
  const rows = await q(
    conn,
    `SELECT payment_id FROM payments
      WHERE (? IS NOT NULL AND authority <=> ?)
         OR (? IS NOT NULL AND ref_id <=> ?)
      LIMIT 1`,
    [authority, authority, refId, refId],
  );
  return rows.length > 0;
}

async function resolveEnrollmentId(
  conn: Queryable,
  opts: { enrollmentId?: number; studentId: number; courseId?: number | null },
): Promise<number | null> {
  if (opts.enrollmentId && Number.isFinite(opts.enrollmentId)) return Number(opts.enrollmentId);
  const courseId = opts.courseId == null ? null : Number(opts.courseId);
  if (courseId && Number.isFinite(courseId)) {
    const byCourse = await q(
      conn,
      'SELECT enrollment_id FROM enrollments WHERE student_id = ? AND course_id = ? ORDER BY enrollment_id DESC LIMIT 1',
      [opts.studentId, courseId],
    );
    if (byCourse[0]?.enrollment_id) return Number(byCourse[0].enrollment_id);
  }
  const any = await q(
    conn,
    'SELECT enrollment_id FROM enrollments WHERE student_id = ? ORDER BY enrollment_id DESC LIMIT 1',
    [opts.studentId],
  );
  return any[0]?.enrollment_id ? Number(any[0].enrollment_id) : null;
}

/**
 * Copy one already-verified site payment into `payments` if it is not already there.
 * Does not check overpay: the money has already been confirmed by the gateway.
 */
export async function applyOneVerifiedSitePayment(
  conn: Queryable,
  payment: SiteTuitionPayment,
  opts: { studentId: number; enrollmentId?: number; trackingCode?: string },
): Promise<'applied' | 'skipped'> {
  const authority = normalizeGatewayToken(payment.authority);
  const refId = normalizeGatewayToken(payment.ref_id);
  if (!authority && !refId) return 'skipped';
  if (String(payment.status || 'paid') !== 'paid') return 'skipped';
  if (!payment.verified_at) return 'skipped';
  const amount = Number(payment.amount_toman);
  if (!(amount > 0)) return 'skipped';

  const enrollmentId = await resolveEnrollmentId(conn, {
    enrollmentId: opts.enrollmentId,
    studentId: opts.studentId,
    courseId: payment.course_id,
  });
  if (!enrollmentId) return 'skipped';

  if (await ledgerRowExists(conn, authority, refId)) {
    await refreshEnrollmentAmountPaid(conn, enrollmentId);
    return 'skipped';
  }

  const tracking = String(opts.trackingCode || payment.tracking_code || '').trim();
  const description = tracking
    ? `پرداخت آنلاین شهریه سایت (${tracking})`
    : 'پرداخت آنلاین شهریه سایت';
  try {
    await conn.query(
      `INSERT INTO payments
        (enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind,
         gateway_name, authority, ref_id, card_pan, card_hash, fee, fee_type, description)
       VALUES (?, ?, ?, ?, 'آنلاین', ?, 'zarinpal', ?, ?, ?, ?, ?, ?, ?)`,
      [
        enrollmentId,
        opts.studentId,
        payDateJalaliFromVerifiedAt(payment.verified_at),
        amount,
        paymentKindFromSite(payment.kind),
        authority,
        refId,
        payment.card_pan ? String(payment.card_pan).slice(0, 30) : null,
        payment.card_hash ? String(payment.card_hash).slice(0, 64) : null,
        Number.isFinite(Number(payment.fee)) && Number(payment.fee) > 0 ? Math.round(Number(payment.fee)) : null,
        payment.fee_type ? String(payment.fee_type).slice(0, 32) : null,
        description.slice(0, 500),
      ],
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    await refreshEnrollmentAmountPaid(conn, enrollmentId);
    return 'skipped';
  }
  await refreshEnrollmentAmountPaid(conn, enrollmentId);
  return 'applied';
}

/** Used when a website registration is approved (same transaction as the enrollment insert). */
export async function applyVerifiedSitePaymentsForRegistration(
  conn: Queryable,
  opts: { trackingCode: string; studentId: number; enrollmentId: number },
): Promise<ApplyResult> {
  const tracking = String(opts.trackingCode || '').trim();
  if (!tracking || !opts.studentId || !opts.enrollmentId) return { applied: 0, skipped: 0, amountPaid: 0 };
  const pays = await q(
    conn,
    `SELECT id, tracking_code, amount_toman, kind, authority, ref_id, card_pan, card_hash, fee, fee_type, verified_at, course_id, status
       FROM site_registration_payments p
      WHERE ${TRACKING_EQ}
        AND p.status = 'paid'
        AND p.verified_at IS NOT NULL`,
    [tracking],
  );
  let applied = 0;
  let skipped = 0;
  for (const payment of pays) {
    const r = await applyOneVerifiedSitePayment(conn, payment, {
      studentId: opts.studentId,
      enrollmentId: opts.enrollmentId,
      trackingCode: tracking,
    });
    if (r === 'applied') applied += 1;
    else skipped += 1;
  }
  const amountPaid = await refreshEnrollmentAmountPaid(conn, opts.enrollmentId);
  return { applied, skipped, amountPaid };
}

/** Payment verified after approval, or a repair/sync pass: link paid site rows to an existing enrollment. */
export async function syncVerifiedSiteTuitionPayments(db: LedgerDb): Promise<ApplyResult> {
  const rows = await db.sql<any>(
    `SELECT p.id, p.tracking_code, p.amount_toman, p.kind, p.authority, p.ref_id, p.card_pan,
            p.card_hash, p.fee, p.fee_type, p.verified_at, p.course_id, p.status, r.student_id
       FROM site_registration_payments p
       JOIN registrations r ON ${REG_TRACKING_JOIN}
      WHERE p.status = 'paid'
        AND p.verified_at IS NOT NULL
        AND r.status = 'approved'
        AND r.student_id IS NOT NULL`,
  );
  let applied = 0;
  let skipped = 0;
  let lastEnrollment: number | null = null;
  const conn: Queryable = {
    query: async (sqlText, params) => [await db.sql(sqlText, params || [])],
  };
  // sql() does not expose insertId; use sqlExec for INSERT/UPDATE.
  const execConn: Queryable = {
    query: async (sqlText, params) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sqlText)) {
        const r = await db.sqlExec(sqlText, params || []);
        return [r, undefined];
      }
      return [await db.sql(sqlText, params || [])];
    },
  };
  for (const row of rows || []) {
    const studentId = Number(row.student_id);
    if (!studentId) { skipped += 1; continue; }
    const r = await applyOneVerifiedSitePayment(execConn, row, {
      studentId,
      trackingCode: row.tracking_code,
    });
    if (r === 'applied') applied += 1;
    else skipped += 1;
    lastEnrollment = (await resolveEnrollmentId(conn, { studentId, courseId: row.course_id })) || lastEnrollment;
  }
  const amountPaid = lastEnrollment ? await refreshEnrollmentAmountPaid(execConn, lastEnrollment) : 0;
  return { applied, skipped, amountPaid };
}

export async function ensureSiteTuitionLedgerSchema(db: LedgerDb): Promise<void> {
  const tables = await db.sql<any>(
    `SELECT TABLE_COLLATION AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_registration_payments'`,
  );
  if (!tables.length) return;
  const collation = String(tables[0]?.c || '');
  if (collation && collation !== 'utf8mb4_unicode_ci') {
    await db.sqlExec(
      'ALTER TABLE site_registration_payments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
  }
  await db.sqlExec("UPDATE payments SET authority = NULL WHERE authority = ''");
  await db.sqlExec("UPDATE payments SET ref_id = NULL WHERE ref_id = ''");
  const indexes = await db.sql<any>(
    `SELECT INDEX_NAME AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'`,
  );
  const names = new Set(indexes.map((r: any) => String(r.n)));
  if (!names.has('uq_payments_authority')) {
    await db.sqlExec('ALTER TABLE payments ADD UNIQUE KEY uq_payments_authority (authority)');
  }
  if (!names.has('uq_payments_ref_id')) {
    await db.sqlExec('ALTER TABLE payments ADD UNIQUE KEY uq_payments_ref_id (ref_id)');
  }
  // Gateway verify details on the money ledger (additive nullable columns, added only when missing).
  for (const [col, ddl] of [
    ['card_pan', 'ALTER TABLE payments ADD COLUMN card_pan VARCHAR(32) NULL'],
    ['card_hash', 'ALTER TABLE payments ADD COLUMN card_hash VARCHAR(64) NULL'],
    ['fee', 'ALTER TABLE payments ADD COLUMN fee BIGINT NULL'],
    ['fee_type', 'ALTER TABLE payments ADD COLUMN fee_type VARCHAR(32) NULL'],
  ] as const) {
    const cols = await db.sql<any>(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = ?`,
      [col],
    );
    if (!cols.length) await db.sqlExec(ddl);
  }
  for (const [col, ddl] of [
    ['card_pan', 'ALTER TABLE site_registration_payments ADD COLUMN card_pan VARCHAR(32) NULL'],
    ['card_hash', 'ALTER TABLE site_registration_payments ADD COLUMN card_hash VARCHAR(64) NULL'],
    ['fee', 'ALTER TABLE site_registration_payments ADD COLUMN fee BIGINT NULL'],
    ['fee_type', 'ALTER TABLE site_registration_payments ADD COLUMN fee_type VARCHAR(32) NULL'],
  ] as const) {
    const cols = await db.sql<any>(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_registration_payments' AND COLUMN_NAME = ?`,
      [col],
    );
    if (!cols.length) await db.sqlExec(ddl);
  }
}
