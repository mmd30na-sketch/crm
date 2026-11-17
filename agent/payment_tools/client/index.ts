/**
 * Thin Zarinpal client for Ham-Raz payment tools.
 * - REST v4 actions (inquiry / unVerified / verify / reverse) go through the official
 *   `zarinpal-node-sdk` wrapper in zarinpal.ts (currency, metadata, timeout and error parsing live there).
 *   No hand-rolled POST to payment.zarinpal.com.
 * - GraphQL (next.zarinpal.com) through zarinpalQuery(), which rejects anything but `query`.
 *   The single mutation (AddRefund) has its own function that only the confirmed-action executor calls.
 * - `rest` (the REST transport) is injectable for tests: the default builds on the SDK wrapper, tests
 *   pass a fake so nothing touches the network.
 * Token: leading "Bearer " and whitespace are stripped. Secrets never appear in results.
 */
import { resolveZarinpal, normalizeAccessToken, zarinpalQuery, ZARINPAL_GRAPHQL_URL, toZarinpalConfig, type EffectiveZarinpal } from '../../../zarinpalSettings';
import { inquiry as sdkInquiry, unverifiedList as sdkUnverifiedList, verifyPayment as sdkVerifyPayment, reverse as sdkReverse } from '../../../zarinpal';
import { explainError } from './errors';

export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
export const restHost = (sandbox: boolean) => (sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com');

export class ZpError extends Error {
  code: number | null;
  constructor(message: string, code: number | null = null, public status = 502) { super(message); this.code = code; }
}

/** Pulls the numeric code out of the shapes Zarinpal returns ({errors:{code}} or {errors:{field:[msg,"-54"]}}). */
export function extractCode(body: any): number | null {
  const e = body?.errors;
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    if (Number.isFinite(Number(e.code))) return Number(e.code);
    for (const v of Object.values(e)) if (Array.isArray(v)) for (const x of v) if (/^-?\d+$/.test(String(x))) return Number(x);
  }
  if (Array.isArray(e) && e[0] && Number.isFinite(Number(e[0].code))) return Number(e[0].code);
  const c = Number(body?.data?.code);
  return Number.isFinite(c) ? c : null;
}

/** The SDK-backed REST actions this client uses (injectable for tests). */
export type ZarinpalRestAction = 'inquiry' | 'unverified' | 'verify' | 'reverse';
export type ZarinpalRest = (action: ZarinpalRestAction, payload: any) => Promise<any>;

/** Default transport: the official-SDK wrapper in zarinpal.ts. */
function sdkRest(getCfg: () => EffectiveZarinpal): ZarinpalRest {
  return async (action, payload) => {
    const cfg = toZarinpalConfig(getCfg());
    if (!cfg.merchantId) throw Object.assign(new Error('شناسه پذیرنده زرین‌پال تنظیم نشده است.'), { code: -9, status: 503 });
    switch (action) {
      case 'inquiry': return sdkInquiry(cfg, String(payload?.authority || ''));
      case 'unverified': return sdkUnverifiedList(cfg);
      case 'verify': {
        // The wrapper converts Toman -> the gateway unit; map back to the REST-style data shape.
        const r = await sdkVerifyPayment(cfg, { amountToman: Number(payload?.amount_toman) || 0, authority: String(payload?.authority || '') });
        return { code: r.code, ok: r.ok, message: r.message, ref_id: r.refId, card_pan: r.cardPan, card_hash: r.cardHash, fee: r.fee, fee_type: r.feeType };
      }
      case 'reverse': return sdkReverse(cfg, String(payload?.authority || ''));
    }
  };
}

/** Normalizes a wrapper/transport failure into a ZpError with the official code + Persian message. */
function toZpError(e: any, fallback: string): ZpError {
  const code = e && typeof e.code === 'number' ? e.code : extractCode(e?.body ?? null);
  const info = explainError(code);
  const message = info ? `${info.fa} (کد ${code})` : String(e?.message || fallback);
  return new ZpError(message, code, Number(e?.status) || 502);
}

export function createZarinpalClient(
  getCfg: () => EffectiveZarinpal = () => resolveZarinpal({}),
  fetchImpl: FetchLike = fetch as any,
  rest?: ZarinpalRest,
) {
  const restCaller: ZarinpalRest = rest || sdkRest(getCfg);

  /** inquiry / unverified / verify / reverse via the SDK wrapper; errors become ZpError (code + Persian). */
  async function restCall(action: ZarinpalRestAction, payload: Record<string, unknown> = {}): Promise<any> {
    try {
      return await restCaller(action, payload);
    } catch (e: any) {
      throw toZpError(e, 'خطای زرین‌پال');
    }
  }

  const token = () => normalizeAccessToken(getCfg().accessToken);
  const query = (q: string, variables: Record<string, unknown> = {}) => zarinpalQuery(token(), q, variables, fetchImpl as any);

  /** Only used by the refund executor after an admin «تأیید». Sandbox still blocks real refunds. */
  async function mutationAddRefund(v: { session_id: string; amount: number; description?: string }): Promise<any> {
    const t = token();
    if (!t) throw new ZpError('توکن دسترسی زرین‌پال تنظیم نشده است.', null, 400);
    const r = await fetchImpl(ZARINPAL_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({
        query: 'mutation AddRefund($session_id: ID!, $amount: BigInteger!, $description: String) { resource: AddRefund(session_id: $session_id, amount: $amount, description: $description) { id amount terminal_id timeline { refund_amount refund_time refund_status } } }',
        variables: v,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    let body: any = null;
    try { body = await r.json(); } catch { /* */ }
    if (!r.ok || body?.errors?.length) throw new ZpError(String(body?.errors?.[0]?.message || `HTTP ${r.status}`).slice(0, 200));
    return body?.data?.resource ?? {};
  }

  return {
    config: getCfg,
    rest: restCall,
    query,
    inquiry: (authority: string) => restCall('inquiry', { authority }),
    unverified: () => restCall('unverified'),
    /** verify: the wrapper converts Toman -> the gateway unit (same as the original request). */
    verify: (authority: string, amountToman: number) => restCall('verify', { authority, amount_toman: amountToman }),
    reverse: (authority: string) => restCall('reverse', { authority }),
    mutationAddRefund,
  };
}
export type ZarinpalClient = ReturnType<typeof createZarinpalClient>;
