import type { PaymentTool } from './types';
import { str } from './util';

const STATUS_FA: Record<string, string> = { VERIFIED: 'وریفای شده', PAID: 'پرداخت شده (وریفای نشده)', IN_BANK: 'در حال پرداخت', FAILED: 'ناموفق', REVERSED: 'ریورس شده' };

export const zarinpalTransactionInquiry: PaymentTool = {
  name: 'zarinpal_transaction_inquiry',
  description: 'استعلام وضعیت یک تراکنش زرین‌پال با authority (فقط وضعیت را می‌گوید و تراکنش را وریفای نمی‌کند).',
  parameters: { type: 'object', properties: { authority: { type: 'string', description: 'کد authority تراکنش (A000...)' } }, required: ['authority'], additionalProperties: false },
  async handler(a, _ctx, deps) {
    const authority = str(a?.authority, 64);
    if (!/^[A-Za-z0-9]{10,64}$/.test(authority)) return { error: 'authority نامعتبر است.' };
    const d = await deps.client.inquiry(authority);
    return { authority, status: String(d?.status || ''), status_fa: STATUS_FA[String(d?.status)] || String(d?.status || ''), code: d?.code ?? null, sandbox: deps.client.config().sandbox };
  },
};
