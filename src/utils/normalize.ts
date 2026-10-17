/**
 * Pure normalization helpers shared by the server (server.ts, mysql-socks.ts) and the browser.
 * No Node or DOM imports here, so `node --import tsx` can unit-test them (scripts/test-crm-logic.mjs).
 */
import { toLatinDigits, isValidNationalCode, isValidJalaliParts } from '../../ocrValidate';

export { toLatinDigits, isValidNationalCode };

const PERSIAN_ZERO = 0x06F0;
const ARABIC_ZERO = 0x0660;

/** Latin digits, no spaces/dashes/zero-width marks: the form national codes are compared in. */
export function normalizeNationalCode(v: unknown): string {
  return toLatinDigits(v).replace(/[\s\-‌-‏]/g, '').trim();
}

/**
 * The spellings a code may be stored under in older rows (Latin, Persian or Arabic-Indic digits),
 * for `WHERE col IN (...)` lookups. Input is normalized first.
 */
export function nationalCodeVariants(v: unknown): string[] {
  const code = normalizeNationalCode(v);
  if (!code) return [];
  const shift = (zero: number) => code.replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));
  return [...new Set([code, shift(PERSIAN_ZERO), shift(ARABIC_ZERO)])];
}

/**
 * Staff-entered national code: `error` for input that cannot be a code (not 10 digits),
 * `warning` when only the checksum fails (legacy and hand-typed codes are still accepted).
 */
export function checkNationalCode(v: unknown): { code: string; error?: string; warning?: string } {
  const code = normalizeNationalCode(v);
  if (!/^\d{10}$/.test(code)) return { code, error: 'کد ملی باید ۱۰ رقم باشد.' };
  if (!isValidNationalCode(code)) return { code, warning: 'رقم کنترل کد ملی معتبر نیست؛ کد ملی را با کارت تطبیق دهید.' };
  return { code };
}

/**
 * Strict Jalali date: "۱۴۰۵/۷/۱۶", "1405-07-16" -> "1405/07/16". Anything that is not
 * year/month/day with a 4-digit year (1300-1499), month 1-12 and a day that exists in that month
 * (31 for months 1-6, 30 for 7-12) returns ''.
 */
export function normalizeJalaliDate(v: unknown): string {
  const s = toLatinDigits(v).replace(/[‌-‏]/g, '').trim();
  const m = s.match(/^(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1300 || y > 1499 || !isValidJalaliParts(y, mo, d)) return '';
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
}

/** Today's Jalali date in Iran (Asia/Tehran), whatever time zone the server or browser runs in. */
export function jalaliToday(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => toLatinDigits(parts.find((p) => p.type === t)?.value || '').replace(/\D/g, '');
    const out = normalizeJalaliDate(`${get('year')}/${get('month')}/${get('day')}`);
    if (out) return out;
  } catch {}
  const raw = toLatinDigits(now.toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' }));
  const m = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : raw;
}

/** Today's Jalali date in Iran as numbers ({ jy, jm, jd }). */
export function jalaliTodayParts(now: Date = new Date()): { jy: number; jm: number; jd: number } {
  const [jy, jm, jd] = jalaliToday(now).split('/').map(Number);
  return { jy, jm, jd };
}

/** Lower-cased text with Latin digits and unified ی/ک, for search matching. */
export function searchKey(v: unknown): string {
  return toLatinDigits(v).replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase().trim();
}

/** Same person check for the legacy table: normalized first + last name (Arabic ی/ک, spaces, ZWNJ). */
export function sameName(aFirst: unknown, aLast: unknown, bFirst: unknown, bLast: unknown): boolean {
  const n = (v: unknown) => String(v ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌]+/g, '').trim();
  return !!n(aLast) && n(aFirst) === n(bFirst) && n(aLast) === n(bLast);
}

/** One-line display text: control characters/newlines become spaces, runs of whitespace collapse, trimmed. */
export function cleanText(v: unknown, maxLen = 500): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * A stored photo value as a usable path: '/...' or 'http(s)://...'. Legacy rows hold bare file names
 * ("Screenshot (1).png") or ';'-joined lists; a bare name is no photo, a list gives its first usable entry.
 */
export function photoPath(v: unknown): string | undefined {
  for (const part of String(v ?? '').split(';')) {
    const p = part.trim();
    if (p.startsWith('/') || /^https?:\/\//i.test(p)) return p;
  }
  return undefined;
}
