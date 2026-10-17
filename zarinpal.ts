/**
 * Zarinpal v4 REST payment gateway (server side only).
 *
 * Sandbox by default: the sandbox endpoints are used unless ZARINPAL_SANDBOX === '0'. The merchant id
 * comes from env ZARINPAL_MERCHANT_ID, or (as a fallback) from the settings value the caller passes in
 * (gateways.zarinpal_merchant_id). No key is ever hardcoded and no browser ever sees the merchant id.
 *
 * Amounts inside the CRM are Toman (like payments.amount). Zarinpal expects Rial, so requestPayment /
 * verifyPayment convert with toGatewayAmount() unless ZARINPAL_CURRENCY=IRT is set.
 *
 * The network calls only run when a payment is actually started/verified; nothing here runs at boot.
 */
export type ZarinpalConfig = {
  merchantId: string;
  sandbox: boolean;
  /** 'IRR' (default): convert Toman -> Rial (*10). 'IRT': send Toman as-is. */
  currency: 'IRR' | 'IRT';
};

export function zarinpalConfigFromEnv(settingsMerchantId = ''): ZarinpalConfig {
  const currency = String(process.env.ZARINPAL_CURRENCY || 'IRR').trim().toUpperCase() === 'IRT' ? 'IRT' : 'IRR';
  return {
    sandbox: String(process.env.ZARINPAL_SANDBOX ?? '1') !== '0',
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

/** Toman -> the amount Zarinpal expects (Rial by default). */
export function toGatewayAmount(toman: number, cfg: ZarinpalConfig): number {
  return Math.max(0, Math.round(cfg.currency === 'IRT' ? toman : toman * 10));
}

type ZarinpalResponse = { data?: any; errors?: any };

async function callZarinpal(url: string, payload: Record<string, unknown>): Promise<ZarinpalResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok && !body?.data) {
    throw Object.assign(new Error('پاسخ درگاه پرداخت نامعتبر بود.'), { status: 502, gateway: true });
  }
  return body as ZarinpalResponse;
}

export interface RequestPaymentInput {
  /** Amount in Toman (the CRM unit). */
  amountToman: number;
  description: string;
  callbackUrl: string;
  mobile?: string;
  email?: string;
}

/** payment/request.json. Returns the authority and the StartPay URL to redirect the payer to. */
export async function requestPayment(cfg: ZarinpalConfig, input: RequestPaymentInput): Promise<{ authority: string; paymentUrl: string }> {
  if (!cfg.merchantId) {
    throw Object.assign(new Error('شناسه پذیرنده زرین‌پال تنظیم نشده است (ZARINPAL_MERCHANT_ID).'), { status: 503, gateway: true });
  }
  const metadata: Record<string, string> = {};
  if (input.mobile) metadata.mobile = input.mobile;
  if (input.email) metadata.email = input.email;
  const body = await callZarinpal(`${baseUrl(cfg.sandbox)}/pg/v4/payment/request.json`, {
    merchant_id: cfg.merchantId,
    amount: toGatewayAmount(input.amountToman, cfg),
    callback_url: input.callbackUrl,
    description: input.description.slice(0, 255),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  });
  const code = Number(body.data?.code);
  const authority = String(body.data?.authority || '');
  if (code !== 100 || !authority) {
    const detail = body.errors?.[0]?.message || body.data?.message || 'درخواست پرداخت پذیرفته نشد';
    throw Object.assign(new Error(String(detail)), { status: 502, gateway: true });
  }
  return { authority, paymentUrl: startPayUrl(authority, cfg) };
}

export interface VerifyPaymentInput {
  /** Amount in Toman, the same amount that was requested. */
  amountToman: number;
  authority: string;
}

/**
 * payment/verify.json. `code` 100 = freshly verified, 101 = already verified (both count as paid).
 * Anything else is treated as a failure with the gateway's message.
 */
export async function verifyPayment(cfg: ZarinpalConfig, input: VerifyPaymentInput): Promise<{ ok: boolean; refId: string | null; code: number; message: string }> {
  if (!cfg.merchantId) {
    return { ok: false, refId: null, code: -1, message: 'شناسه پذیرنده زرین‌پال تنظیم نشده است.' };
  }
  const body = await callZarinpal(`${baseUrl(cfg.sandbox)}/pg/v4/payment/verify.json`, {
    merchant_id: cfg.merchantId,
    amount: toGatewayAmount(input.amountToman, cfg),
    authority: input.authority,
  });
  const code = Number(body.data?.code);
  const ok = code === 100 || code === 101;
  return {
    ok,
    refId: ok && body.data?.ref_id !== undefined && body.data?.ref_id !== null ? String(body.data.ref_id) : null,
    code: Number.isFinite(code) ? code : -1,
    message: String(body.data?.message || body.errors?.[0]?.message || (ok ? 'Verified' : 'تأیید پرداخت ناموفق بود')),
  };
}
