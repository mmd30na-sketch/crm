import type { PaymentTool } from './types';
import { jalaliDateTime, pickTerminal, rialToToman, str, toGregorianDate } from './util';

const FILTERS = ['ALL', 'PAID', 'IN_PROGRESS', 'REVERSED'] as const;

export const zarinpalReconcileList: PaymentTool = {
  name: 'zarinpal_reconcile_list',
  description: 'تسویه‌حساب‌های زرین‌پال (واریز به حساب بانکی آموزشگاه) با فیلتر وضعیت و بازه تاریخ. مبالغ به تومان. فقط خواندنی.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...FILTERS] },
      from_date: { type: 'string', description: 'شمسی یا میلادی' },
      to_date: { type: 'string' },
      terminal_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  async handler(a, _ctx, deps) {
    const terminal = await pickTerminal(deps, str(a?.terminal_id, 20) || undefined);
    if (!terminal) return { error: 'هیچ درگاهی پیدا نشد.' };
    const filter = FILTERS.includes(String(a?.status || 'ALL').toUpperCase() as any) ? String(a?.status || 'ALL').toUpperCase() : 'ALL';
    const vars: Record<string, unknown> = { terminal_id: terminal.id, filter };
    const from = toGregorianDate(a?.from_date); const to = toGregorianDate(a?.to_date);
    if (from) vars.created_from_date = from;
    if (to) vars.created_to_date = to;
    const d = await deps.client.query(
      'query getReconciles($terminal_id: ID, $filter: ReconciliationStatusEnum, $created_from_date: DateTime, $created_to_date: DateTime) { resource: Reconciliation(terminal_id: $terminal_id, filter: $filter, created_from_date: $created_from_date, created_to_date: $created_to_date) { id status amount payable_at reference_id reconciled_at } }',
      vars);
    const rows = (Array.isArray(d?.resource) ? d.resource : []).map((r: any) => ({
      id: String(r.id), status: String(r.status || ''), amount_toman: rialToToman(r.amount), payable_at: jalaliDateTime(r.payable_at),
      reconciled_at: r.reconciled_at ? jalaliDateTime(r.reconciled_at) : null, reference_id: String(r.reference_id || ''),
    }));
    return { terminal_id: terminal.id, filter, count: rows.length, total_toman: rows.reduce((s: number, r: any) => s + r.amount_toman, 0), rows };
  },
};
