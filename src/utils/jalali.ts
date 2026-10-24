/**
 * Jalali (Solar Hijri) date helpers built on `jalaali-js`, so the conversion math is maintained by a
 * well-tested library instead of hand-rolled arithmetic. Safe to import from the server, the browser
 * and `node --import tsx` tests. Parsing/validation of the CRM date shape stays in `normalize.ts`.
 *
 * Dates are the CRM shape "yyyy/mm/dd" with Latin digits (see normalizeJalaliDate).
 */

import { d2j, isLeapJalaaliYear, j2d, jalaaliMonthLength, toGregorian } from 'jalaali-js';

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmt = (jy: number, jm: number, jd: number) => `${jy}/${pad2(jm)}/${pad2(jd)}`;

const parse = (date: string): { jy: number; jm: number; jd: number } | null => {
  const m = String(date || '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]); const jm = Number(m[2]); const jd = Number(m[3]);
  return jy >= 1300 && jy <= 1499 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31 ? { jy, jm, jd } : null;
};

/** Is `jy` a Jalali leap year (esfand has 30 days). */
export function isLeapJalaliYear(jy: number): boolean {
  return isLeapJalaaliYear(jy);
}

/** Days in a Jalali month (1-6: 31, 7-11: 30, 12: 29 or 30 in a leap year). */
export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaaliMonthLength(jy, jm);
}

/** Serial day number of a Jalali date ("yyyy/mm/dd"); null when unparseable. */
export function jalaliToJdn(date: string): number | null {
  const p = parse(date);
  return p ? j2d(p.jy, p.jm, p.jd) : null;
}

/** Gregorian {gy, gm, gd} of a Jalali date; null when unparseable. */
export function jalaliToGregorian(date: string): { gy: number; gm: number; gd: number } | null {
  const p = parse(date);
  if (!p) return null;
  const { gy, gm, gd } = toGregorian(p.jy, p.jm, p.jd);
  return { gy, gm, gd };
}

/** Jalali date ("yyyy/mm/dd") of a serial day number. */
export function jdnToJalali(jdn: number): string {
  const { jy, jm, jd } = d2j(jdn);
  return fmt(jy, jm, jd);
}

/** `date` shifted by `n` (may be negative) Jalali days; '' when `date` is invalid. */
export function addJalaliDays(date: string, n: number): string {
  const jdn = jalaliToJdn(date);
  return jdn === null ? '' : jdnToJalali(jdn + Math.round(n));
}

/**
 * `date` shifted by `n` Jalali months; the day is clamped to the target month's length
 * (e.g. 1405/06/31 -> 1405/07/30). '' when `date` is invalid.
 */
export function addJalaliMonths(date: string, n: number): string {
  const p = parse(date);
  if (!p) return '';
  const total = p.jy * 12 + (p.jm - 1) + Math.round(n);
  const jy = Math.floor(total / 12);
  const jm = ((total % 12) + 12) % 12 + 1;
  const jd = Math.min(p.jd, jalaaliMonthLength(jy, jm));
  return fmt(jy, jm, jd);
}
