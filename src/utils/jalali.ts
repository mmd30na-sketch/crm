/**
 * Pure Jalali (Solar Hijri) date helpers — no dependencies, so they are safe to import from the server,
 * the browser and `node --import tsx` tests. Only arithmetic on the standard Jalali day-number calendar
 * (the well-known jalaali algorithm) is implemented; parsing/validation stays in `normalize.ts`.
 *
 * Dates are the CRM shape "yyyy/mm/dd" with Latin digits (see normalizeJalaliDate).
 */

const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

/** Jalaali calendar breaks (jalaali-js). */
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

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
  return jalCal(jy).leap === 0;
}

/** Days in a Jalali month (1-6: 31, 7-11: 30, 12: 29 or 30 in a leap year). */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

/** Serial day number of a Jalali date ("yyyy/mm/dd"); null when unparseable. */
export function jalaliToJdn(date: string): number | null {
  const p = parse(date);
  return p ? j2d(p.jy, p.jm, p.jd) : null;
}

/** Gregorian {gy, gm, gd} of a Jalali date; null when unparseable. */
export function jalaliToGregorian(date: string): { gy: number; gm: number; gd: number } | null {
  const jdn = jalaliToJdn(date);
  return jdn === null ? null : d2g(jdn);
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
  const jm = mod(total, 12) + 1;
  const jd = Math.min(p.jd, jalaliMonthLength(jy, jm));
  return fmt(jy, jm, jd);
}
