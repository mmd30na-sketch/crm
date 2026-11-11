import type { PaymentTool } from './types';
import { maskCard, num, rialToToman, str } from './util';

export const zarinpalRefund: PaymentTool = {
  name: 'zarinpal_refund',
  description: 'استرداد (بازگشت وجه) کامل یا جزئی یک تراکنش موفق زرین‌پال با session_id. اجرا نمی‌شود تا مدیر در ویجت «تأیید» بزند؛ این ابزار فقط پیش‌نویس با مبلغ و کارت ماسک‌شده می‌سازد. در حالت تست (sandbox) غیرفعال است.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'شناسه تراکنش (از zarinpal_list_transactions)' },
      amount_toman: { type: 'number', description: 'مبلغ استرداد به تومان؛ خالی = کل مبلغ' },
      description: { type: 'string' },
    },
    required: ['session_id'],
    additionalProperties: false,
  },
  async handler(a, ctx, deps) {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای مدیر فعال است.' };
    if (deps.client.config().sandbox) return { error: 'درگاه در حالت تست (sandbox) است؛ استرداد واقعی غیرفعال است.' };
    const sessionId = str(a?.session_id, 30);
    if (!/^\d{1,20}$/.test(sessionId)) return { error: 'session_id نامعتبر است.' };
    const d = await deps.client.query('query S($id: ID) { Session(id: $id) { id status amount description created_at session_tries { card_pan rrn } } }', { id: sessionId });
    const s = Array.isArray(d?.Session) ? d.Session[0] : null;
    if (!s) return { error: 'تراکنش پیدا نشد.' };
    if (s.status !== 'VERIFIED' && s.status !== 'PAID') return { error: `فقط تراکنش موفق قابل استرداد است (وضعیت: ${s.status}).` };
    const fullToman = rialToToman(s.amount);
    const toman = a?.amount_toman === undefined || a?.amount_toman === null ? fullToman : num(a.amount_toman);
    if (!(toman > 0) || toman > fullToman) return { error: `مبلغ استرداد باید بین ۱ و ${fullToman} تومان باشد.` };
    const tries: any[] = Array.isArray(s.session_tries) ? s.session_tries : [];
    const card = maskCard((tries.find((t) => t?.card_pan) || {}).card_pan);
    const description = str(a?.description, 200) || 'استرداد از CRM';
    const summary = `💸 استرداد زرین‌پال\nتراکنش: ${sessionId}\nمبلغ: ${toman.toLocaleString('fa-IR')} تومان از ${fullToman.toLocaleString('fa-IR')} تومان\nکارت: ${card || 'نامشخص'}\nتوضیح: ${description}`;
    const q = deps.queueConfirmation(ctx, { kind: 'refund', session_id: sessionId, amount_rial: Math.round(toman * 10), description, card }, `استرداد ${sessionId}`, summary);
    return { ...q, note: 'هنوز انجام نشده است؛ مدیر باید در کادر تأیید «تأیید» را بزند.' };
  },
};
