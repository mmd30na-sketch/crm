/**
 * Persian labels for internal codes, shared by the UI and the Copilot (pure, no imports).
 * src/api/phase4.ts re-exports the lead/task/activity maps from here.
 */
export const LEAD_STATUS_LABEL = { new: 'جدید', contacted: 'تماس گرفته شد', in_negotiation: 'در حال پیگیری', converted: 'تبدیل‌شده', lost: 'از دست رفته' } as const;
export const ACTIVITY_KIND_LABEL = { call: 'تماس تلفنی', note: 'یادداشت', sms: 'پیامک', in_person: 'حضوری', rubika: 'روبیکا' } as const;
export const TASK_STATUS_LABEL = { open: 'باز', in_progress: 'در حال انجام', done: 'انجام شد', cancelled: 'لغو شد' } as const;
export const TASK_PRIORITY_LABEL = { low: 'کم', normal: 'عادی', high: 'فوری' } as const;
export const PAY_METHOD_LABELS: Record<string, string> = { pos: 'کارتخوان', cash: 'نقدی', card_transfer: 'کارت‌به‌کارت', online: 'آنلاین', cheque: 'چک' };
export const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  pending: 'در انتظار بررسی', pending_review: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'ردشده', none: 'بدون وضعیت',
};
export const TERM_STATUS_LABEL: Record<string, string> = { active: 'در حال برگزاری', finished: 'پایان‌یافته', planned: 'برنامه‌ریزی‌شده' };
/** Other statuses seen in campaigns, outbox, recipients and site payments. */
export const MISC_STATUS_LABEL: Record<string, string> = {
  draft: 'پیش‌نویس', running: 'در حال اجرا', paused: 'متوقف', completed: 'تکمیل‌شده', finished: 'پایان‌یافته', queued: 'در صف',
  scheduled: 'زمان‌بندی‌شده', sent: 'ارسال‌شده', delivered: 'تحویل‌شده', failed: 'ناموفق', not_configured: 'تنظیم‌نشده',
  paid: 'پرداخت‌شده', unpaid: 'پرداخت‌نشده', test_cancelled: 'لغوشده (آزمایشی)', suspended: 'تعلیق', graduated: 'فارغ‌التحصیل',
  success: 'موفق', skipped: 'ردشده از ارسال', active_term: 'فعال', full: 'کامل', deposit: 'پیش‌پرداخت',
};

const STATUS: Record<string, string> = {
  ...MISC_STATUS_LABEL, ...TERM_STATUS_LABEL, ...TASK_STATUS_LABEL, ...REGISTRATION_STATUS_LABEL, ...LEAD_STATUS_LABEL,
};
const BY_KEY: [RegExp, Record<string, string>][] = [
  [/(^|_)priority$/, TASK_PRIORITY_LABEL],
  [/(^|_)(pay_method|method)$/, PAY_METHOD_LABELS],
  [/(^|_)kind$/, { ...ACTIVITY_KIND_LABEL, full: 'کامل', deposit: 'پیش‌پرداخت' }],
  [/(^|_)(status|state|result)$/, STATUS],
];

/** Copy of a tool result where code values under status/priority/kind/method keys become Persian labels. */
export function persianizeCodes<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => persianizeCodes(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const map = BY_KEY.find(([re]) => re.test(k.toLowerCase()))?.[1];
    if (map && typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)) out[k] = (map as Record<string, string>)[v];
    else if (map && v === null && /(^|_)status$/.test(k.toLowerCase())) out[k] = 'بدون وضعیت';
    else out[k] = persianizeCodes(v, depth + 1);
  }
  return out as T;
}
