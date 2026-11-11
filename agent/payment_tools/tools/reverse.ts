import type { PaymentTool } from './types';
import { str } from './util';

export const zarinpalReverse: PaymentTool = {
  name: 'zarinpal_reverse',
  description: 'ریورس (برگشت فوری بدون کارمزد) یک تراکنش موفق تا ۳۰ دقیقه بعد از پرداخت. اجرا نمی‌شود تا مدیر در ویجت «تأیید» بزند؛ این ابزار فقط پیش‌نویس می‌سازد. نیاز به ثبت IP سرور در درگاه دارد (کد -62).',
  mutating: true,
  parameters: { type: 'object', properties: { authority: { type: 'string' }, reason: { type: 'string' } }, required: ['authority'], additionalProperties: false },
  async handler(a, ctx, deps) {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای مدیر فعال است.' };
    const authority = str(a?.authority, 64);
    if (!/^[A-Za-z0-9]{10,64}$/.test(authority)) return { error: 'authority نامعتبر است.' };
    let status = '';
    try { status = String((await deps.client.inquiry(authority))?.status || ''); } catch (e: any) { return { error: e?.message || 'استعلام تراکنش ناموفق بود.' }; }
    if (status !== 'VERIFIED' && status !== 'PAID') return { error: `فقط تراکنش موفق قابل ریورس است (وضعیت فعلی: ${status || 'نامشخص'}).` };
    const reason = str(a?.reason, 200);
    const summary = `↩️ ریورس تراکنش زرین‌پال\nauthority: ${authority}\nوضعیت فعلی: ${status}${reason ? `\nدلیل: ${reason}` : ''}\nپول بدون کارمزد به کارت پرداخت‌کننده برمی‌گردد.`;
    const q = deps.queueConfirmation(ctx, { kind: 'reverse', authority, amount_toman: null, status }, `ریورس ${authority.slice(-6)}`, summary);
    return { ...q, note: 'هنوز انجام نشده است؛ مدیر باید در کادر تأیید «تأیید» را بزند.' };
  },
};
