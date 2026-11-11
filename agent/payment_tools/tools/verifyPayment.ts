import type { PaymentTool } from './types';
import { maskCard, num, str } from './util';
import { toGatewayAmount } from '../../../zarinpal';

export const zarinpalVerifyPayment: PaymentTool = {
  name: 'zarinpal_verify_payment',
  description: 'وریفای (تأیید نهایی) یک پرداخت موفقِ وریفای‌نشده با authority و مبلغ (تومان). معمولاً CRM خودکار وریفای می‌کند؛ این ابزار برای پرداخت‌های جامانده از فهرست unverified است. نتیجه در CRM ثبت نمی‌شود؛ ثبت پرداخت را به مدیر بسپارید.',
  parameters: {
    type: 'object',
    properties: { authority: { type: 'string' }, amount_toman: { type: 'number', description: 'دقیقاً همان مبلغ پرداخت (تومان)' } },
    required: ['authority', 'amount_toman'],
    additionalProperties: false,
  },
  async handler(a, ctx, deps) {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای مدیر فعال است.' };
    const authority = str(a?.authority, 64);
    const toman = num(a?.amount_toman);
    if (!/^[A-Za-z0-9]{10,64}$/.test(authority) || !(toman > 0)) return { error: 'authority یا مبلغ نامعتبر است.' };
    const cfg = deps.client.config();
    const d = await deps.client.verify(authority, toGatewayAmount(toman, { merchantId: '', sandbox: cfg.sandbox, currency: cfg.currency }));
    const code = Number(d?.code);
    return { ok: code === 100 || code === 101, code, already_verified: code === 101, ref_id: d?.ref_id != null ? String(d.ref_id) : null, card: maskCard(d?.card_pan) || null, fee_type: d?.fee_type || null, sandbox: cfg.sandbox };
  },
};
