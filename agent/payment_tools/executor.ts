/**
 * Runs a confirmed payment action. Called ONLY from the copilot «تأیید» route (server.ts deliverPending), never
 * from a tool handler, so refund/reverse always need an explicit admin confirmation.
 */
import type { ZarinpalClient } from './client';
import type { PaymentAction } from './tools/types';

export async function executePaymentAction(client: ZarinpalClient, action: PaymentAction): Promise<{ ok: boolean; error?: string; detail?: string }> {
  try {
    if (action.kind === 'reverse') {
      const d = await client.reverse(action.authority);
      return { ok: Number(d?.code) === 100, detail: String(d?.message || 'Reversed') };
    }
    if (action.kind === 'refund') {
      if (client.config().sandbox) return { ok: false, error: 'درگاه در حالت تست است؛ استرداد انجام نشد.' };
      const r = await client.mutationAddRefund({ session_id: action.session_id, amount: action.amount_rial, description: action.description });
      return { ok: !!r?.id, detail: r?.id ? `شناسه استرداد ${r.id}` : undefined };
    }
    return { ok: false, error: 'عملیات ناشناخته' };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'عملیات ناموفق بود').slice(0, 200) };
  }
}
