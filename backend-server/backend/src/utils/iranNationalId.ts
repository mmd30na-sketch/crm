/**
 * Iranian national ID + Jalali digit helpers (CRM OCR / students module).
 * Written for eco_v4 CRM — used by online Gemini OCR and form validation.
 */

const PERSIAN_ARABIC_DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

/** Convert Persian/Arabic-Indic digits to ASCII 0-9. */
export function toEnglishDigits(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  return String(value).replace(
    /[۰-۹٠-٩]/g,
    (ch) => PERSIAN_ARABIC_DIGIT_MAP[ch] ?? ch
  );
}

/** Keep digits only (after Persian/Arabic normalization). */
export function onlyDigits(value: string | null | undefined): string {
  return toEnglishDigits(value).replace(/\D/g, '');
}

/**
 * Normalize national code to 10 ASCII digits when possible.
 * - strips non-digits
 * - left-pads with 0 if length is 8 or 9 (common OCR drop of leading zeros)
 */
export function normalizeNationalCode(
  raw: string | null | undefined
): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  let digits = onlyDigits(raw);
  if (!digits) return null;
  if (digits.length > 10) {
    // Prefer last 10 or first 10 if model returned noise; take first 10-run
    const match = digits.match(/\d{10}/);
    digits = match ? match[0] : digits.slice(0, 10);
  }
  if (digits.length >= 8 && digits.length < 10) {
    digits = digits.padStart(10, '0');
  }
  return digits.length ? digits : null;
}

/** Official Iranian national ID checksum (10 digits). */
export function isValidNationalCode(code: string | null | undefined): boolean {
  if (!code || !/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(code[i]) * (10 - i);
  }
  const remainder = sum % 11;
  const check = Number(code[9]);
  return (
    (remainder < 2 && check === remainder) ||
    (remainder >= 2 && check === 11 - remainder)
  );
}

/**
 * Normalize Jalali date strings to YYYY/MM/DD when possible.
 * Accepts 1400/1/2, 1400-01-02, 14000102, Persian digits.
 */
export function normalizeJalaliDate(
  raw: string | null | undefined
): string | null {
  if (raw == null || String(raw).trim() === '') return null;

  let s = toEnglishDigits(raw).trim().replace(/[-.]/g, '/').replace(/\s+/g, '');

  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    return `${y}/${mo}/${d}`;
  }

  const compact = onlyDigits(s);
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;
  }

  // Partial / unparseable — return cleaned original for operator review
  return s || null;
}

export function trimName(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t.length ? t : null;
}
