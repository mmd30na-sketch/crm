/**
 * Thin Zarinpal client for Ham-Raz payment tools.
 * - REST v4 (request/verify/inquiry/unVerified/reverse) on payment.zarinpal.com, or sandbox.zarinpal.com when
 *   the effective setting (Settings → درگاه پرداخت, env fallback) says sandbox.
 * - GraphQL (next.zarinpal.com) through zarinpalQuery(), which rejects anything but `query`.
 *   The single mutation (AddRefund) has its own function that only the confirmed-action executor calls.
 * Token: leading "Bearer " and whitespace are stripped. All calls time out. Secrets never appear in results.
 */
import { resolveZarinpal, normalizeAccessToken, zarinpalQuery, ZARINPAL_GRAPHQL_URL, type EffectiveZarinpal } from '../../../zarinpalSettings';
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

export function createZarinpalClient(getCfg: () => EffectiveZarinpal = () => resolveZarinpal({}), fetchImpl: FetchLike = fetch as any) {
  async function rest(path: string, payload: Record<string, unknown>): Promise<any> {
    const cfg = getCfg();
    if (!cfg.merchantId) throw new ZpError('شناسه پذیرنده زرین‌پال تنظیم نشده است.', -9, 503);
    const r = await fetchImpl(`${restHost(cfg.sandbox)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ merchant_id: cfg.merchantId, ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
    let body: any = null;
    try { body = await r.json(); } catch { /* non-JSON */ }
    const code = extractCode(body);
    if (!r.ok || (code !== null && code !== 100 && code !== 101)) {
      const info = explainError(code);
      throw new ZpError(info ? `${info.fa} (کد ${code})` : `خطای زرین‌پال (HTTP ${r.status}${code !== null ? `، کد ${code}` : ''})`, code);
    }
    return body?.data ?? {};
  }
  const token = () => normalizeAccessToken(getCfg().accessToken);
  const query = (q: string, variables: Record<string, unknown> = {}) => zarinpalQuery(token(), q, variables, fetchImpl as any);

  /** Only used by the refund executor after an admin «تأیید». */
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
    rest,
    query,
    inquiry: (authority: string) => rest('/pg/v4/payment/inquiry.json', { authority }),
    unverified: () => rest('/pg/v4/payment/unVerified.json', {}),
    verify: (authority: string, amount: number) => rest('/pg/v4/payment/verify.json', { authority, amount }),
    reverse: (authority: string) => rest('/pg/v4/payment/reverse.json', { authority }),
    mutationAddRefund,
  };
}
export type ZarinpalClient = ReturnType<typeof createZarinpalClient>;
