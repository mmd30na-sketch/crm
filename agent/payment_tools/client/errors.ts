/** Official Zarinpal error codes (docs: /paymentGateway/errorList.html, reverse.html). Local copy, no network. */
export type ZpErrorInfo = { code: number; type: string; en: string; fa: string };

export const ZARINPAL_ERRORS: Record<string, ZpErrorInfo> = Object.fromEntries(([
  [-9, 'public', 'Validation error', 'خطای اعتبارسنجی: مرچنت کد، آدرس بازگشت، توضیحات (حداکثر ۵۰۰ کاراکتر)، مبلغ یا کد معرف نامعتبر است.'],
  [-10, 'public', 'Terminal is not valid, please check merchant_id or ip address.', 'آی‌پی یا مرچنت کد پذیرنده صحیح نیست.'],
  [-11, 'public', 'Terminal is not active, please contact our support team.', 'مرچنت کد فعال نیست؛ با پشتیبانی زرین‌پال تماس بگیرید.'],
  [-12, 'public', 'Too many attempts, please try again later.', 'تلاش بیش از حد مجاز در بازه کوتاه؛ کمی بعد دوباره تلاش کنید.'],
  [-13, 'public', 'terminal limit reached.', 'محدودیت تراکنش؛ مدارک را از طریق پشتیبانی تکمیل کنید.'],
  [-14, 'public', 'The callback URL domain does not match the registered terminal domain.', 'دامنه آدرس بازگشت با دامنه ثبت‌شده درگاه مغایرت دارد.'],
  [-15, 'public', 'Terminal user is suspend.', 'درگاه پرداخت تعلیق شده است؛ با پشتیبانی تماس بگیرید.'],
  [-16, 'public', 'Terminal user level is not valid.', 'سطح تأیید پذیرنده پایین‌تر از سطح نقره‌ای است.'],
  [-17, 'public', 'Terminal user level is not valid.', 'محدودیت پذیرنده در سطح آبی.'],
  [-18, 'public', 'The referrer address does not match the registered domain.', 'استفاده از این درگاه روی این دامنه مجاز نیست.'],
  [-19, 'public', 'Terminal user transactions are banned.', 'ایجاد تراکنش برای این ترمینال ممکن نیست.'],
  [100, 'public', 'Success', 'عملیات موفق'],
  [101, 'PaymentVerify', 'Verified', 'تراکنش قبلاً وریفای شده است.'],
  [-40, 'PaymentRequest', 'Invalid extra params, expire_in is not valid.', 'پارامتر expire_in نامعتبر است.'],
  [-41, 'PaymentRequest', 'Maximum amount is 100,000,000 tomans.', 'حداکثر مبلغ پرداختی ۱۰۰ میلیون تومان است.'],
  [-50, 'PaymentVerify', 'Session is not valid, amounts values is not the same.', 'مبلغ پرداخت‌شده با مبلغ ارسالی در وریفای متفاوت است.'],
  [-51, 'PaymentVerify', 'Session is not valid, session is not active paid try.', 'پرداخت ناموفق.'],
  [-52, 'PaymentVerify', 'Oops!!, please contact our support team', 'خطای غیرمنتظره؛ با پشتیبانی زرین‌پال تماس بگیرید.'],
  [-53, 'PaymentVerify', 'Session is not this merchant_id session', 'پرداخت متعلق به این مرچنت کد نیست.'],
  [-54, 'PaymentVerify', 'Invalid authority.', 'اتوریتی نامعتبر است.'],
  [-55, 'PaymentVerify', 'manual payment request not found.', 'تراکنش مورد نظر یافت نشد.'],
  [-60, 'PaymentReverse', 'Session can not be reversed with bank.', 'امکان ریورس تراکنش با بانک وجود ندارد.'],
  [-61, 'PaymentReverse', 'Session is not in success status.', 'تراکنش موفق نیست یا قبلاً ریورس شده است.'],
  [-62, 'PaymentReverse', 'Terminal ip limit must be active.', 'آی‌پی سرور برای درگاه ثبت نشده است (در پنل زرین‌پال «با محدودیت IP» و IP سرور را تنظیم کنید).'],
  [-63, 'PaymentReverse', 'Maximum time for reverse this session is expired.', 'حداکثر زمان ریورس (۳۰ دقیقه) گذشته است.'],
] as [number, string, string, string][]).map(([code, type, en, fa]) => [String(code), { code, type, en, fa }]));

export function explainError(code: unknown): ZpErrorInfo | null {
  const n = Number(String(code ?? '').trim());
  return Number.isFinite(n) ? ZARINPAL_ERRORS[String(n)] || null : null;
}
