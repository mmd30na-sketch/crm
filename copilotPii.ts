/**
 * Helpers for Ham-Raz: normalize search text, match students, and mask
 * mobile numbers / national IDs in tool results sent to the model.
 */
import { toLatinDigits } from './ocrValidate';
import { nationalCodeVariants, normalizeNationalCode } from './src/utils/normalize';

const PERSIAN_ZERO = 0x06F0;
const ARABIC_ZERO = 0x0660;

const digitScripts = (latin: string): string[] => {
  if (!/^\d+$/.test(latin)) return latin ? [latin] : [];
  const shift = (zero: number) => latin.replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));
  return [...new Set([latin, shift(PERSIAN_ZERO), shift(ARABIC_ZERO)])];
};

export function normalizeCopilotText(v: unknown): string {
  return toLatinDigits(v)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200d\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhoneDigits(v: unknown): string {
  let digits = toLatinDigits(v).replace(/\D/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length >= 12 && digits[2] === '9') digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) digits = '0' + digits;
  return digits;
}

export function phoneDigitVariants(v: unknown): string[] {
  const phone = normalizePhoneDigits(v);
  const out: string[] = [];
  for (const form of [phone, phone.length === 11 && phone.startsWith('09') ? phone.slice(1) : '']) {
    if (form) out.push(...digitScripts(form));
  }
  return [...new Set(out)];
}

export function maskMobile(v: unknown): string {
  const raw = v == null ? '' : String(v);
  if (!raw) return '';
  const phone = normalizePhoneDigits(raw);
  if (phone.length === 11 && phone.startsWith('09')) return phone.slice(0, 4) + '***' + phone.slice(-4);
  return raw;
}

export function maskNationalId(v: unknown): string {
  const raw = v == null ? '' : String(v);
  if (!raw) return '';
  const code = normalizeNationalCode(raw);
  if (/^\d{10}$/.test(code)) return code.slice(0, 3) + '***' + code.slice(-3);
  return raw;
}

const PII_PHONE_KEY = /phone|mobile|cell|تلفن|موبایل/i;
const PII_NATIONAL_KEY = /national_?code|nationalid|کد_?ملی|کدملی/i;

function maskMobilesInText(s: string): string {
  return s.replace(/(?:\+98|0098|98|0|۰|٠)?[9۹٩][0-9۰-۹٠-٩]{9}/g, (m) => {
    const phone = normalizePhoneDigits(m);
    return phone.length === 11 && phone.startsWith('09') ? maskMobile(phone) : m;
  });
}

function maskNationalIdsInText(s: string): string {
  return s.replace(/(?<![0-9۰-۹٠-٩])[0-9۰-۹٠-٩]{10}(?![0-9۰-۹٠-٩])/g, (m) => {
    const code = normalizeNationalCode(m);
    return /^\d{10}$/.test(code) ? maskNationalId(code) : m;
  });
}

export function maskPiiForModel(value: unknown): unknown {
  if (typeof value === 'string') return maskNationalIdsInText(maskMobilesInText(value));
  if (Array.isArray(value)) return value.map(maskPiiForModel);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (PII_NATIONAL_KEY.test(key)) out[key] = maskNationalId(val);
      else if (PII_PHONE_KEY.test(key)) out[key] = maskMobile(val);
      else out[key] = maskPiiForModel(val);
    }
    return out;
  }
  return value;
}

export function studentSearchPlan(query: string): {
  nameNorm: string; tokens: string[]; national: string; phone: string; phone10: string;
} {
  const nameNorm = normalizeCopilotText(query);
  const tokens = nameNorm.split(' ').filter((t) => t.length >= 2);
  const nationalRaw = normalizeNationalCode(query);
  const national = /^\d{10}$/.test(nationalRaw) ? nationalRaw : '';
  const phoneRaw = normalizePhoneDigits(query);
  const phone = phoneRaw.length === 11 && phoneRaw.startsWith('09') ? phoneRaw : '';
  const phone10 = phone ? phone.slice(1) : (phoneRaw.length === 10 && phoneRaw.startsWith('9') ? phoneRaw : '');
  return { nameNorm, tokens, national, phone, phone10 };
}

export function studentMatchesPlan(
  row: { first_name?: string; last_name?: string; national_code?: string; phone_number?: string },
  plan: ReturnType<typeof studentSearchPlan>,
): boolean {
  const first = normalizeCopilotText(row.first_name);
  const last = normalizeCopilotText(row.last_name);
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (plan.nameNorm && full.includes(plan.nameNorm)) return true;
  if (plan.tokens.some((t) => first.includes(t) || last.includes(t))) return true;
  if (plan.national && nationalCodeVariants(plan.national).includes(normalizeNationalCode(row.national_code))) return true;
  const rowPhone = normalizePhoneDigits(row.phone_number);
  if (plan.phone && rowPhone && (rowPhone === plan.phone || rowPhone.endsWith(plan.phone10))) return true;
  if (!plan.phone && plan.phone10 && rowPhone.endsWith(plan.phone10)) return true;
  return false;
}

export { nationalCodeVariants };
