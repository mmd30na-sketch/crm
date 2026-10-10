/**
 * Tuition balances, shared by the server and the dashboards. Pure (unit-tested in scripts/test-finance.mjs).
 *
 * Each enrollment's balance is clamped at 0 before anything is summed: an enrollment that was settled by
 * lowering final_price to what was paid (or overpaid) must not cancel another enrollment's debt.
 * Payments without an enrollment count against the oldest open debt first.
 */

export type BalanceEnrollment = { id: number; final_price?: number | null };
export type BalancePayment = { enrollment_id?: number | null; amount: number };

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Remaining tuition per enrollment (never negative), oldest enrollment (lowest id) first. */
export function owedByEnrollment(enrollments: BalanceEnrollment[], payments: BalancePayment[]): Map<number, number> {
  const ids = new Set(enrollments.map((e) => Number(e.id)));
  const paid = new Map<number, number>();
  let unattributed = 0;
  for (const p of payments) {
    const id = p.enrollment_id === null || p.enrollment_id === undefined ? null : Number(p.enrollment_id);
    if (id !== null && ids.has(id)) paid.set(id, (paid.get(id) || 0) + money(p.amount));
    else unattributed += money(p.amount);
  }
  const owed = new Map<number, number>();
  for (const e of [...enrollments].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = Number(e.id);
    let rem = Math.max(0, money(e.final_price) - (paid.get(id) || 0));
    const used = Math.min(unattributed, rem);
    unattributed -= used;
    rem -= used;
    owed.set(id, rem);
  }
  return owed;
}

/** One student's totals from their own enrollments and payments. */
export function studentBalance(enrollments: BalanceEnrollment[], payments: BalancePayment[]) {
  const owed = owedByEnrollment(enrollments, payments);
  const totalTuition = enrollments.reduce((s, e) => s + money(e.final_price), 0);
  const totalPaid = payments.reduce((s, p) => s + money(p.amount), 0);
  let debt = 0;
  for (const v of owed.values()) debt += v;
  return { totalTuition, totalPaid, debt, owed };
}

/** Outstanding tuition over all students (per-student balances, each per-enrollment clamped). */
export function totalOutstanding(
  enrollments: Array<BalanceEnrollment & { student_id: number }>,
  payments: Array<BalancePayment & { student_id: number }>,
): number {
  const enrByStudent = new Map<number, BalanceEnrollment[]>();
  for (const e of enrollments) {
    const k = Number(e.student_id);
    if (!enrByStudent.has(k)) enrByStudent.set(k, []);
    enrByStudent.get(k)!.push(e);
  }
  const payByStudent = new Map<number, BalancePayment[]>();
  for (const p of payments) {
    const k = Number(p.student_id);
    if (!payByStudent.has(k)) payByStudent.set(k, []);
    payByStudent.get(k)!.push(p);
  }
  let total = 0;
  for (const [sid, enrs] of enrByStudent) total += studentBalance(enrs, payByStudent.get(sid) || []).debt;
  return total;
}

/**
 * Splits a payment over the student's enrollments, oldest first, up to what is owed on each.
 * A linked payment goes entirely to that enrollment. Whatever is left (only possible when the caller
 * skipped the overpay check) lands on the last enrollment that received money.
 */
export function allocatePayment(
  order: number[],
  owed: Map<number, number>,
  amount: number,
  linkedEnrollmentId: number | null,
): Array<{ enrollmentId: number | null; amount: number }> {
  if (linkedEnrollmentId) return [{ enrollmentId: linkedEnrollmentId, amount }];
  if (order.length === 0) return [{ enrollmentId: null, amount }];
  const parts: Array<{ enrollmentId: number | null; amount: number }> = [];
  let left = amount;
  for (const id of order) {
    if (left <= 0) break;
    const take = Math.min(left, owed.get(id) || 0);
    if (take > 0) { parts.push({ enrollmentId: id, amount: take }); left -= take; }
  }
  if (left > 0) parts.push({ enrollmentId: parts.length ? parts[parts.length - 1].enrollmentId : order[order.length - 1], amount: left });
  return parts;
}

/** What may still be paid: the whole student's debt, or (for a linked payment) at most that enrollment's. */
export function payableAmount(owed: Map<number, number>, linkedEnrollmentId: number | null): number {
  let student = 0;
  for (const v of owed.values()) student += v;
  if (!linkedEnrollmentId) return student;
  return Math.min(student, owed.get(linkedEnrollmentId) || 0);
}
