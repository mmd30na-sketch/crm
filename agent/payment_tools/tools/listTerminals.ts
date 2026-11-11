import type { PaymentTool } from './types';

export const zarinpalListTerminals: PaymentTool = {
  name: 'zarinpal_list_terminals',
  description: 'فهرست درگاه‌های (ترمینال‌های) زرین‌پال آموزشگاه: شناسه، دامنه، نام، وضعیت و اینکه کدام همان مرچنت تنظیم‌شده است. فقط خواندنی.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async handler(_a, _ctx, deps) {
    const d = await deps.client.query('query { Terminals { id status domain name key created_at } }');
    const mid = String(deps.client.config().merchantId || '').toLowerCase();
    const terminals = (Array.isArray(d?.Terminals) ? d.Terminals : []).map((t: any) => ({
      id: String(t.id), status: String(t.status || ''), domain: String(t.domain || ''), name: String(t.name || ''),
      created_at: String(t.created_at || ''), is_configured_merchant: !!mid && String(t.key || '').toLowerCase() === mid,
    }));
    return { count: terminals.length, terminals, sandbox: deps.client.config().sandbox };
  },
};
