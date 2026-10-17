/**
 * National smart-card OCR: validation, normalization and the multi-pass pipeline.
 * Pure functions + an injectable pipeline (no network here) so they can be unit-tested
 * with `npm run test:ocr`.
 */

export type IranIdOcr = {
  first_name: string;
  last_name: string;
  national_code: string;
  father_name: string;
  birth_date_jalali: string;
  card_expiry_jalali?: string;
  confidence: number;
  provider?: string;
};

export type FieldWarnings = Record<string, string[]>;

export type ValidatedOcr = {
  first_name: string;
  last_name: string;
  national_code: string;
  father_name: string;
  birth_date_jalali: string;
  card_expiry_jalali: string;
  card_expired: boolean;
  checksum_valid: boolean;
  confidence: number;
  field_warnings: FieldWarnings;
  needs_review: boolean;
};

export type SecondPassStatus = 'not_needed' | 'accepted' | 'partly_accepted' | 'rejected' | 'failed' | 'skipped';

export const LOW_CONFIDENCE = 0.8;
export const EXTRA_PASS_BUDGET_MS = 25_000;

export function toLatinDigits(v: unknown): string {
  return String(v ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function isValidNationalCode(code: string): boolean {
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const d = code.split('').map(Number);
  let s = 0;
  for (let i = 0; i < 9; i++) s += d[i] * (10 - i);
  const r = s % 11;
  return (r < 2 && d[9] === r) || (r >= 2 && d[9] === 11 - r);
}

/** Digits only (Latin). Never "fixes" anything: a bad checksum stays as read. */
export function normalizeNationalCode(v: unknown): string {
  return toLatinDigits(v).replace(/\D/g, '');
}

/** Trim, unify Arabic ي/ك, drop digits/latin/punctuation noise, collapse spaces. Compound words are kept. */
export function normalizeName(v: unknown): string {
  return String(v ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[0-9۰-۹٠-٩A-Za-z]/g, ' ')
    .replace(/[:：\-_|\/\\.,،;؛"'()\[\]{}<>*#@!?؟=+~`^%$&]/g, ' ')
    .replace(/[​‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidJalaliParts(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const max = m <= 6 ? 31 : m <= 11 ? 30 : 30; // month 12 has 29 or 30 days; leap years are not checked
  return d <= max;
}

/** "۱۳۷۸-۵-۲۰", "1378.05.20", "13780520" -> "1378/05/20"; '' when no date shape is found. */
export function normalizeJalaliDate(v: unknown): string {
  const s = toLatinDigits(v).replace(/[​‎‏]/g, '').trim();
  const sep = s.match(/(\d{4})\s*[^\d\s]\s*(\d{1,2})\s*[^\d\s]\s*(\d{1,2})/) || s.match(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})/);
  if (sep) return `${sep[1]}/${sep[2].padStart(2, '0')}/${sep[3].padStart(2, '0')}`;
  const packed = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (packed) return `${packed[1]}/${packed[2]}/${packed[3]}`;
  return '';
}

function jalaliYear(today: string): number {
  return Number(normalizeJalaliDate(today).slice(0, 4)) || 1405;
}

export function validateBirthDate(v: string, today: string): boolean {
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 1300 && y <= jalaliYear(today) && isValidJalaliParts(y, Number(m[2]), Number(m[3]));
}

export function validateExpiryDate(v: string, today: string): boolean {
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 1380 && y <= jalaliYear(today) + 20 && isValidJalaliParts(y, Number(m[2]), Number(m[3]));
}

export type FieldConfidences = Partial<Record<keyof IranIdOcr, number>>;

/**
 * Normalize + validate one OCR read. `confidence` is the model-reported overall confidence
 * (not the "how many fields are filled" ratio).
 * An expired card (card_expired) is informational only and never sets needs_review.
 */
export function validateOcr(
  raw: Partial<IranIdOcr>,
  opts: { today: string; confidence?: number; fieldConfidence?: FieldConfidences; readable?: boolean },
): ValidatedOcr {
  const warn: FieldWarnings = {};
  const add = (k: string, w: string) => { (warn[k] ||= []).push(w); };

  const nameField = (k: 'first_name' | 'last_name' | 'father_name', key: boolean) => {
    const n = normalizeName(raw[k]);
    if (n.length > 40) { add(k, 'name_too_long'); return ''; }
    if (!n && key) add(k, 'missing');
    return n;
  };
  const first_name = nameField('first_name', true);
  const last_name = nameField('last_name', true);
  const father_name = nameField('father_name', false);

  const national_code = normalizeNationalCode(raw.national_code);
  const checksum_valid = isValidNationalCode(national_code);
  if (!national_code) add('national_code', 'missing');
  else if (national_code.length !== 10) add('national_code', 'national_code_invalid_length');
  else if (!checksum_valid) add('national_code', 'national_code_checksum_failed');

  let birth_date_jalali = normalizeJalaliDate(raw.birth_date_jalali);
  if (!birth_date_jalali) {
    if (String(raw.birth_date_jalali ?? '').trim()) add('birth_date_jalali', 'birth_date_invalid');
    else add('birth_date_jalali', 'missing');
  } else if (!validateBirthDate(birth_date_jalali, opts.today)) add('birth_date_jalali', 'birth_date_invalid');

  const card_expiry_jalali = normalizeJalaliDate(raw.card_expiry_jalali);
  let card_expired = false;
  if (card_expiry_jalali) {
    if (!validateExpiryDate(card_expiry_jalali, opts.today)) add('card_expiry_jalali', 'card_expiry_invalid');
    else if (card_expiry_jalali < normalizeJalaliDate(opts.today)) { card_expired = true; add('card_expiry_jalali', 'card_expired'); }
  }

  const confidence = Math.max(0, Math.min(1, Number(opts.confidence ?? raw.confidence ?? 0) || 0));
  for (const [k, c] of Object.entries(opts.fieldConfidence || {})) {
    if (typeof c !== 'number' || c >= LOW_CONFIDENCE) continue;
    if (k === 'national_code' && checksum_valid) continue; // the checksum is stronger evidence
    if (!(k in { first_name: 1, last_name: 1, national_code: 1, father_name: 1, birth_date_jalali: 1, card_expiry_jalali: 1 })) continue;
    add(k, 'low_confidence');
  }
  if (confidence < LOW_CONFIDENCE) add('_overall', 'low_confidence');
  if (opts.readable === false) add('_overall', 'not_readable');

  const keyMissing = !first_name || !last_name || !national_code || !birth_date_jalali;
  const needs_review = (!!national_code && !checksum_valid) || !national_code || keyMissing
    || confidence < LOW_CONFIDENCE || opts.readable === false;

  return {
    first_name, last_name, national_code, father_name, birth_date_jalali, card_expiry_jalali,
    card_expired, checksum_valid, confidence, field_warnings: warn, needs_review,
  };
}

/** Merge a primary (model) read with a fallback (Cloud Vision parser) read; the primary wins per field. */
export function mergeOcr(primary: Partial<IranIdOcr>, fallback: IranIdOcr): IranIdOcr {
  const pick = (k: keyof IranIdOcr) => String(primary[k] || fallback[k] || '');
  const merged: IranIdOcr = {
    first_name: pick('first_name'),
    last_name: pick('last_name'),
    national_code: pick('national_code'),
    father_name: pick('father_name'),
    birth_date_jalali: pick('birth_date_jalali'),
    card_expiry_jalali: pick('card_expiry_jalali'),
    confidence: Number(primary.confidence || fallback.confidence || 0),
    provider: String(primary.provider || fallback.provider || ''),
  };
  if (merged.national_code) merged.national_code = toLatinDigits(merged.national_code).replace(/\D/g, '').slice(0, 10);
  if (merged.birth_date_jalali) merged.birth_date_jalali = toLatinDigits(merged.birth_date_jalali);
  const hits = [merged.first_name, merged.last_name, merged.national_code, merged.father_name, merged.birth_date_jalali].filter(Boolean).length;
  merged.confidence = Math.max(merged.confidence, Number((hits / 5).toFixed(2)));
  return merged;
}

/** Raw JSON as returned by the vision-language model (any field may be missing or mistyped). */
export type ModelRead = Record<string, any>;

export type OcrDeps = {
  /** pass 'full' = whole card; 'focused' = re-read national number and dates only. null = unavailable/failed. */
  gemini: (pass: 'full' | 'focused', deadlineMs: number) => Promise<ModelRead | null>;
  vision: () => Promise<IranIdOcr | null>;
  today: string; // Jalali yyyy/mm/dd
  now?: () => number;
};

export type CardOcrResult = ValidatedOcr & {
  provider: string;
  readable: boolean;
};

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function fieldConfidences(read: ModelRead | null): FieldConfidences {
  const out: FieldConfidences = {};
  const fc = read?.field_confidence;
  if (fc && typeof fc === 'object') {
    for (const k of ['first_name', 'last_name', 'national_code', 'father_name', 'birth_date_jalali', 'card_expiry_jalali'] as const) {
      const n = num(fc[k]);
      if (n !== undefined) out[k] = n;
    }
  }
  return out;
}

/** National code from a focused read: prefer the digit-by-digit array when it has exactly 10 digits. */
export function codeFromFocusedRead(read: ModelRead): string {
  if (Array.isArray(read.digits)) {
    const joined = read.digits.map((d: any) => toLatinDigits(typeof d === 'object' && d ? d.digit : d).replace(/\D/g, '')).join('');
    if (joined.length === 10) return joined;
  }
  return normalizeNationalCode(read.national_code);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return null;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => { t = setTimeout(() => r(null), ms); })]);
  } catch { return null; } finally { if (t) clearTimeout(t); }
}

/**
 * Full pipeline: model read + Cloud Vision parse -> merge -> validate. A single model read; a checksum-failed
 * code is never altered by guesswork and goes to human review.
 */
export async function runCardOcr(deps: OcrDeps): Promise<CardOcrResult | null> {
  const now = deps.now || Date.now;
  const started = now();
  const deadline = started + EXTRA_PASS_BUDGET_MS;
  const [first, vision] = await Promise.all([
    withTimeout(deps.gemini('full', deadline), EXTRA_PASS_BUDGET_MS * 2).catch(() => null),
    deps.vision().catch(() => null),
  ]);
  if (!first && !vision) return null;

  const empty: IranIdOcr = { first_name: '', last_name: '', national_code: '', father_name: '', birth_date_jalali: '', confidence: 0 };
  const merged = mergeOcr(first || {}, vision || empty);
  // Prefer a candidate that passes the checksum.
  const codeCandidates = [first?.national_code, vision?.national_code, merged.national_code].map(normalizeNationalCode).filter(Boolean);
  merged.national_code = codeCandidates.find(isValidNationalCode) || codeCandidates[0] || '';

  const modelConfidence = first ? (num(first.confidence) ?? 0) : (vision?.confidence ?? 0);
  const readable = first ? first.readable !== false : true;
  const fc = fieldConfidences(first);
  const provider = first ? (vision ? `${first.provider}+cloud-vision` : String(first.provider || '')) : 'cloud-vision';

  let v = validateOcr(merged, { today: deps.today, confidence: modelConfidence, fieldConfidence: fc, readable });
  return { ...v, provider, readable };
}
