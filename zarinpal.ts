/**
 * Zarinpal v4 payment gateway (server side only), driven by the official `zarinpal-node-sdk`.
 *
 * Everything REST (request / verify / unVerified / inquiry / reverse / feeCalculation) goes through the
 * SDK; this module is only a thin wrapper for the gaps the SDK lacks: explicit currency (IRR vs IRT),
 * metadata { mobile, email, order_id }, a 15s HTTP timeout, error parsing for both the array and the
 * object error shape, and the CRM minimum amount. No hand-rolled POST to payment.zarinpal.com anywhere.
 *
 * Sandbox flag is unified across the app: sandbox ONLY when ZARINPAL_SANDBOX is '1' or 'true'; '0',
 * unset or anything else is production. The merchant id comes from env ZARINPAL_MERCHANT_ID, or (as a
 * fallback) from the settings value the caller passes in. No key is ever hardcoded or logged.
 *
 * Amounts inside the CRM are Toman (like payments.amount). requestPayment / verifyPayment convert with
 * toGatewayAmount(): IRR (default) -> Toman * 10 (Rial), IRT -> Toman as-is. Verify always uses the same
 * unit as the request. The network calls only run when a payment is actually started/verified; nothing
 * here runs at boot. Exported function signatures stay backward compatible with onlinePayments.ts.
 */
import ZarinPal from 'zarinpal-node-sdk';

export type ZarinpalConfig = {
  merchantId: string;
  sandbox: boolean;
  /** 'IRR' (default): convert Toman -> Rial (*10). 'IRT': send Toman as-is. */
  currency: 'IRR' | 'IRT';
};

/** Sandbox ONLY for '1' / 'true' (case-insensitive); '0', unset or anything else is production. */
export function sandboxFromEnv(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true';
}

export function zarinpalConfigFromEnv(settingsMerchantId = ''): ZarinpalConfig {
  const currency = String(process.env.ZARINPAL_CURRENCY || 'IRR').trim().toUpperCase() === 'IRT' ? 'IRT' : 'IRR';
  return {
    sandbox: sandboxFromEnv(process.env.ZARINPAL_SANDBOX),
    // Truncate the 36-char merchant id; env wins over the settings value.
    merchantId: (process.env.ZARINPAL_MERCHANT_ID || settingsMerchantId || '').trim(),
    currency,
  };
}

/** Production host and the sandbox host; both expose the same /pg/v4 REST paths. */
const baseUrl = (sandbox: boolean) => (sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com');

/** Where the payer is sent after a request succeeds. */
export function startPayUrl(authority: string, cfg: ZarinpalConfig): string {
  return `${baseUrl(cfg.sandbox)}/pg/StartPay/${encodeURIComponent(authority)}`;
}

/** Toman -> the amount Zarinpal expects (Rial by default, Toman when ZARINPAL_CURRENCY=IRT). */
export function toGatewayAmount(toman: number, cfg: ZarinpalConfig): number {
  return Math.max(0, Math.round(cfg.currency === 'IRT' ? toman : toman * 10));
}

/** CRM minimum: 1000 Toman (the gateway minimum expressed in the CRM unit). */
export const MIN_AMOUNT_TOMAN = 1000;
/** Gateway-unit minimum for a request (10000 Rial == 1000 Toman; 1000 when the unit already is Toman). */
export const minGatewayAmount = (cfg: ZarinpalConfig): number => (cfg.currency === 'IRR' ? MIN_AMOUNT_TOMAN * 10 : MIN_AMOUNT_TOMAN);

/** Zarinpal rejects a malformed mobile/email at the SDK layer, so only well-formed values are forwarded. */
const validMobile = (v?: string) => (/^09\d{9}$/.test(String(v || '')) ? String(v) : undefined);
const validEmail = (v?: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')) ? String(v) : undefined);

/**
 * Zarinpal `errors` may be an array [{ code, message, validations }] OR an object { message, code,
 * validations } (validations may carry numeric codes like '-54'). Both are parsed to { code, message }.
 */
export function parseZarinpalError(errors: any, fallback = ''): { code: number | null; message: string } {
  const shape = Array.isArray(errors) ? errors[0] : errors && typeof errors === 'object' ? errors : null;
  if (!shape) return { code: null, message: String(errors || fallback || '') };
  let code = Number.isFinite(Number(shape.code)) ? Number(shape.code) : null;
  let message = String(shape.message || '');
  if ((code === null || !message) && shape.validations && typeof shape.validations === 'object') {
    for (const list of Object.values(shape.validations) as unknown[][]) {
      for (const v of Array.isArray(list) ? list : []) {
        if (code === null && /^-?\d+$/.test(String(v))) code = Number(v);
        if (!message) message = String(v);
      }
    }
  }
  return { code, message: message || fallback };
}

/** Never echoes the merchant id into a message or log. */
const scrubMerchant = (s: unknown, merchantId: string): string => {
  const t = String(s ?? '');
  return merchantId && t.includes(merchantId) ? t.split(merchantId).join('****') : t;
};

/**
 * The SDK throws on non-2xx HTTP and on its own input validators; the gateway also reports logical errors
 * in the 200 body (code !== 100). Both are normalized to a Persian Error carrying `{ status: 502,
 * gateway: true, code }`. The merchant id is never part of the message.
 */
function gatewayError(err: any, fallback: string, merchantId = ''): Error {
  const body = err?.response?.data ?? err?.body ?? null;
  const parsed = parseZarinpalError(body?.errors, '');
  const detail = scrubMerchant(parsed.message || body?.data?.message || body?.message || err?.message || fallback, merchantId);
  return Object.assign(new Error(detail), { status: 502, gateway: true, code: parsed.code ?? null });
}

/** Builds the real SDK client (axios 15s timeout on both REST and GraphQL instances). */
export function createZarinpalSdkClient(cfg: ZarinpalConfig): any {
  const zp: any = new ZarinPal({ merchantId: cfg.merchantId, sandbox: cfg.sandbox });
  // The SDK's axios instances are private; set the HTTP timeout on them when reachable.
  try { if (zp.httpClient?.defaults) zp.httpClient.defaults.timeout = ZARINPAL_HTTP_TIMEOUT_MS; } catch { /* older build */ }
  try { if (zp.graphqlClient?.defaults) zp.graphqlClient.defaults.timeout = ZARINPAL_HTTP_TIMEOUT_MS; } catch { /* older build */ }
  return zp;
}

let clientFactory: (cfg: ZarinpalConfig) => any = createZarinpalSdkClient;
/** Test seam: inject a fake SDK client so the wrapper never touches the network. */
export function setZarinpalClientFactory(f: ((cfg: ZarinpalConfig) => any) | null): void {
  clientFactory = f || createZarinpalSdkClient;
}
const client = (cfg: ZarinpalConfig) => clientFactory(cfg);

/** HTTP timeout for every SDK call (15s; GraphQL stays 15-20s in zarinpalSettings.ts). */
export const ZARINPAL_HTTP_TIMEOUT_MS = 15_000;

export interface RequestPaymentInput {
  /** Amount in Toman (the CRM unit). */
  amountToman: number;
  description: string;
  callbackUrl: string;
  mobile?: string;
  email?: string;
  /** Free-form order reference (e.g. `online-<id>`); goes into metadata.order_id. */
  orderId?: string;
}

/** payment/request.json. Returns the authority and the StartPay URL to redirect the payer to. */
export async function requestPayment(cfg: ZarinpalConfig, input: RequestPaymentInput): Promise<{ authority: string; paymentUrl: string }> {
  if (!cfg.merchantId) {
    throw Object.assign(new Error('شناسه پذیرنده زرین‌پال تنظیم نشده است (ZARINPAL_MERCHANT_ID).'), { status: 503, gateway: true });
  }
  const gatewayAmount = toGatewayAmount(input.amountToman, cfg);
  if (gatewayAmount < minGatewayAmount(cfg)) {
    throw Object.assign(new Error(`حداقل مبلغ پرداخت ${MIN_AMOUNT_TOMAN.toLocaleString('fa-IR')} تومان است.`), { status: 400, gateway: true });
  }
  const zp = client(cfg);
  const mobile = validMobile(input.mobile);
  const email = validEmail(input.email);
  const orderId = String(input.orderId || '').trim().slice(0, 64);
  const metadata: Record<string, string> = {};
  if (mobile) metadata.mobile = mobile;
  if (email) metadata.email = email;
  if (orderId) metadata.order_id = orderId;
  try {
    const body: any = await zp.payments.create({
      amount: gatewayAmount,
      currency: cfg.currency,
      callback_url: input.callbackUrl,
      description: input.description.slice(0, 500),
      ...(mobile ? { mobile } : {}),
      ...(email ? { email } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    } as any);
    const code = Number(body?.data?.code);
    const authority = String(body?.data?.authority || '');
    if (code !== 100 || !authority) {
      const parsed = parseZarinpalError(body?.errors, 'درخواست پرداخت پذیرفته نشد');
      throw Object.assign(new Error(scrubMerchant(parsed.message || body?.data?.message || 'درخواست پرداخت پذیرفته نشد', cfg.merchantId)), { status: 502, gateway: true, code: parsed.code });
    }
    return { authority, paymentUrl: zp.payments.getRedirectUrl(authority) };
  } catch (err: any) {
    throw err?.gateway ? err : gatewayError(err, 'درخواست پرداخت پذیرفته نشد', cfg.merchantId);
  }
}

export interface VerifyPaymentInput {
  /** Amount in Toman, the same amount that was requested. */
  amountToman: number;
  authority: string;
}

export interface VerifyPaymentResult {
  ok: boolean;
  refId: string | null;
  code: number;
  message: string;
  /** Masked card PAN as reported by the gateway (e.g. 610433******1234); null when absent. */
  cardPan: string | null;
  cardHash: string | null;
  /** Gateway fee in the gateway unit; null when the gateway did not report it. */
  fee: number | null;
  feeType: string | null;
}

/**
 * payment/verify.json. `code` 100 = freshly verified, 101 = already verified (both count as paid).
 * Anything else is treated as a failure with the gateway's message; this never throws (an unreachable
 * gateway yields `ok: false` so the callback can redirect the payer back to the SPA).
 */
export async function verifyPayment(cfg: ZarinpalConfig, input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
  const empty: VerifyPaymentResult = { ok: false, refId: null, code: -1, message: 'تأیید پرداخت ناموفق بود', cardPan: null, cardHash: null, fee: null, feeType: null };
  if (!cfg.merchantId) {
    return { ...empty, message: 'شناسه پذیرنده زرین‌پال تنظیم نشده است.' };
  }
  const pick = (d: any): VerifyPaymentResult => {
    const code = Number(d?.code);
    const ok = code === 100 || code === 101;
    const fee = Number(d?.fee);
    return {
      ok,
      refId: ok && d?.ref_id !== undefined && d?.ref_id !== null ? String(d.ref_id) : null,
      code: Number.isFinite(code) ? code : -1,
      message: String(d?.message || (ok ? 'Verified' : 'تأیید پرداخت ناموفق بود')),
      cardPan: d?.card_pan ? String(d.card_pan) : null,
      cardHash: d?.card_hash ? String(d.card_hash) : null,
      fee: ok && Number.isFinite(fee) ? fee : null,
      feeType: d?.fee_type ? String(d.fee_type) : null,
    };
  };
  try {
    const body: any = await client(cfg).verifications.verify({
      amount: toGatewayAmount(input.amountToman, cfg),
      authority: input.authority,
    } as any);
    const parsed = parseZarinpalError(body?.errors, '');
    return body?.errors && !body?.data
      ? { ...empty, code: parsed.code ?? -1, message: parsed.message || 'تأیید پرداخت ناموفق بود' }
      : pick(body?.data);
  } catch (err: any) {
    const body = err?.response?.data ?? err?.body ?? null;
    const code = Number(body?.data?.code);
    const parsed = parseZarinpalError(body?.errors, '');
    return {
      ...empty,
      code: Number.isFinite(code) && body?.data?.code !== undefined ? code : (parsed.code ?? -1),
      message: String(body?.data?.message || parsed.message || body?.message || err?.message || 'تأیید پرداخت ناموفق بود'),
    };
  }
}

/** payment/unVerified.json -> `{ code, authorities: [{ authority, amount, date }] }` (gateway unit). */
export async function unverifiedList(cfg: ZarinpalConfig): Promise<{ code: number; authorities: any[] }> {
  const body: any = await client(cfg).unverified.list();
  const data = body?.data ?? body ?? {};
  const parsed = parseZarinpalError(body?.errors, 'دریافت فهرست پرداخت‌های وریفای‌نشده ناموفق بود');
  if (body?.errors && !data?.authorities) {
    throw Object.assign(new Error(parsed.message || 'دریافت فهرست پرداخت‌های وریفای‌نشده ناموفق بود'), { status: 502, gateway: true, code: parsed.code });
  }
  return { code: Number(data?.code) || 100, authorities: Array.isArray(data?.authorities) ? data.authorities : [] };
}

/** payment/inquiry.json (NOT a verify) -> the gateway status of one authority. */
export async function inquiry(cfg: ZarinpalConfig, authority: string): Promise<any> {
  try {
    const body: any = await client(cfg).inquiries.inquire({ authority });
    return body?.data ?? {};
  } catch (err: any) {
    throw err?.gateway ? err : gatewayError(err, 'استعلام تراکنش ناموفق بود', cfg.merchantId);
  }
}

/** payment/reverse.json -> `{ code, message }` (must run within 30 minutes of a payment). */
export async function reverse(cfg: ZarinpalConfig, authority: string): Promise<any> {
  try {
    const body: any = await client(cfg).reversals.reverse({ authority });
    const data = body?.data ?? {};
    const code = Number(data?.code ?? body?.code);
    if (Number.isFinite(code) && code !== 100) {
      const parsed = parseZarinpalError(body?.errors, data?.message || body?.message || 'ریورس تراکنش ناموفق بود');
      throw Object.assign(new Error(parsed.message || 'ریورس تراکنش ناموفق بود'), { status: 502, gateway: true, code: parsed.code ?? code });
    }
    return data;
  } catch (err: any) {
    throw err?.gateway ? err : gatewayError(err, 'ریورس تراکنش ناموفق بود', cfg.merchantId);
  }
}

/**
 * payment/feeCalculation.json: computes the gateway fee for an amount WITHOUT creating a payment
 * (used by Settings → «تست اتصال»). `amount` is in the gateway unit (see toGatewayAmount).
 */
export async function feeCalculation(cfg: ZarinpalConfig, amount: number): Promise<{ code: number; fee: number | null; feeType: string | null }> {
  const body: any = await client(cfg).payments.feeCalculation({
    merchant_id: cfg.merchantId,
    amount,
    currency: cfg.currency,
  });
  const data = body?.data ?? body ?? {};
  const parsed = parseZarinpalError(body?.errors, 'محاسبه کارمزد ناموفق بود');
  const code = Number(data?.code);
  if (!Number.isFinite(code) || (code !== 100 && body?.errors)) {
    throw Object.assign(new Error(parsed.message || 'محاسبه کارمزد ناموفق بود'), { status: 502, gateway: true, code: parsed.code });
  }
  const fee = Number(data?.fee);
  return { code: Number.isFinite(code) ? code : -1, fee: Number.isFinite(fee) ? fee : null, feeType: data?.fee_type ? String(data.fee_type) : null };
}
