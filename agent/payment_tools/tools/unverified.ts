import type { PaymentTool } from './types';

export const zarinpalUnverifiedList: PaymentTool = {
  name: 'zarinpal_unverified_list',
  description: 'فهرست پرداخت‌های موفقی که هنوز وریفای نشده‌اند (حداکثر ۱۰۰ مورد آخر). مبلغ‌ها به واحد پول درگاه هستند (currency در خروجی). فقط خواندنی.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async handler(_a, _ctx, deps) {
    const cfg = deps.client.config();
    const d = await deps.client.unverified();
    const items = (Array.isArray(d?.authorities) ? d.authorities : []).map((x: any) => ({
      authority: String(x.authority || ''), amount: Number(x.amount) || 0, date: String(x.date || ''),
      amount_toman: cfg.currency === 'IRT' ? Number(x.amount) || 0 : Math.round((Number(x.amount) || 0) / 10),
    }));
    return { count: items.length, currency: cfg.currency, items, sandbox: cfg.sandbox };
  },
};
