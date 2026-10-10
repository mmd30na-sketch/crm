/**
 * Search / filter rules of the students list. Pure (unit-tested in scripts/test-crm-logic.mjs).
 */
import { searchKey } from './normalize';

/** Name, national code or phone contains the query; Persian/Arabic digits match Latin ones. */
export function matchesStudentSearch(
  s: { first_name?: string | null; last_name?: string | null; national_code?: string | null; phone_number?: string | null },
  query: string,
): boolean {
  const q = searchKey(query);
  if (!q) return true;
  const name = searchKey(`${s.first_name ?? ''} ${s.last_name ?? ''}`);
  if (name.includes(q)) return true;
  const digits = q.replace(/[\s-]/g, '');
  if (!digits) return false;
  return [s.national_code, s.phone_number].some((v) => searchKey(v).replace(/[\s-]/g, '').includes(digits));
}

/**
 * Course-number filter. A student without any enrollment stays visible under a specific number
 * (they are not in an older course, they are not in any yet).
 */
export function matchesCourseNumber(courseNumbers: Array<number | string | null | undefined>, filter: string): boolean {
  if (filter === 'all') return true;
  if (courseNumbers.length === 0) return true;
  return courseNumbers.some((n) => n !== null && n !== undefined && String(n) === filter);
}

/** Newest course number (the default filter), or 'all' when there is none. */
export function defaultCourseNumberFilter(courseNumbers: Array<number | string | null | undefined>): string {
  const nums = courseNumbers.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? String(Math.max(...nums)) : 'all';
}

/** "Settled" = nothing left to pay, including students whose tuition is 0 (settled by a price change). */
export function financialStatus(fin: { debt: number; enrollmentsCount: number }): 'settled' | 'debtor' | 'none' {
  if (fin.enrollmentsCount === 0) return 'none';
  return fin.debt > 0 ? 'debtor' : 'settled';
}
