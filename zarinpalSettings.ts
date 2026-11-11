/**
 * Zarinpal gateway settings («تنظیمات > درگاه پرداخت»), admin only.
 *
 * Storage: the JSON settings store, `settings.gateways.zarinpal` (the same place the Rubika gateway keys
 * live; `publicSettings()` already strips `gateways` from every browser response). No SQL migration.
 *
 * Precedence for every field: saved value (non-empty) > env var > built-in default. With nothing saved the
 * behavior is exactly the env-based one that runs today:
 *   merchant id     ZARINPAL_MERCHANT_ID   (legacy gateways.zarinpal_merchant_id stays the last fallback)
 *   sandbox         ZARINPAL_SANDBOX       (anything but '0' = sandbox, as before)
 *   currency        ZARINPAL_CURRENCY      (IRR default)
 *   public base     PUBLIC_BASE_URL        (else the request host)
 *   payment link    CRM_PAYMENT_LINK_BASE  (else debtSms.ts default)
 *   access token    ZARINPAL_ACCESS_TOKEN  (GraphQL API, read-only use)
 *
 * Secrets (merchant id, access token) never leave the server: the public view only carries the last 4 chars
 * of the merchant id and `access_token_set`. The GraphQL helper refuses anything that is not a `query`.
 */
import type express from 'express';
import type { ZarinpalConfig } from './zarinpal';

export type Source = 'saved' | 'env' | 'default';

export type SavedZarinpal = {
  merchant_id?: string;
  sandbox?: boolean;
  currency?: 'IRR' | 'IRT';
  public_base_url?: string;
  payment_link_base?: string;
  access_token?: string;
};

export type EffectiveZarinpal = {
  merchantId: string;
  sandbox: boolean;
  currency: 'IRR' | 'IRT';
  publicBaseUrl: string;
  paymentLinkBase: string;
  accessToken: string;
  sources: Record<'merchant_id' | 'sandbox' | 'currency' | 'public_base_url' | 'payment_link_base' | 'access_token', Source>;
};

export const ZARINPAL_GRAPHQL_URL = 'https://next.zarinpal.com/api/v4/graphql/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isMerchantUuid = (v: unknown) => UUID_RE.test(String(v ?? '').trim());

/** Stored/pasted tokens often carry a "Bearer " prefix, line breaks or spaces: keep only the token itself. */
export function normalizeAccessToken(v: unknown): string {
  return String(v ?? '').trim().replace(/^bearer\s+/i, '').replace(/\s+/g, '');
}

/** "****" + last 4 characters ('' when empty). */
export function maskTail(v: unknown, keep = 4): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return `****${s.slice(-keep)}`;
}

/** Card PAN -> "****1234" (Zarinpal already masks the middle; we keep only the last 4 digits). */
export function maskCard(v: unknown): string {
  const digits = String(v ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '';
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function resolveZarinpal(gateways: any, env: NodeJS.ProcessEnv = process.env): EffectiveZarinpal {
  const g = (gateways && typeof gateways === 'object' ? gateways : {}) as any;
  const s: SavedZarinpal = (g.zarinpal && typeof g.zarinpal === 'object') ? g.zarinpal : {};
  const pick = (saved: unknown, envVal: unknown, def = ''): [string, Source] => {
    if (str(saved)) return [str(saved), 'saved'];
    if (str(envVal)) return [str(envVal), 'env'];
    return [def, 'default'];
  };
  const [merchantEnv, mSrc] = pick(s.merchant_id, env.ZARINPAL_MERCHANT_ID, str(g.zarinpal_merchant_id));
  const sandbox: [boolean, Source] = typeof s.sandbox === 'boolean'
    ? [s.sandbox, 'saved']
    : env.ZARINPAL_SANDBOX !== undefined && env.ZARINPAL_SANDBOX !== '' ? [String(env.ZARINPAL_SANDBOX) !== '0', 'env'] : [true, 'default'];
  const [cur, cSrc] = pick(s.currency, env.ZARINPAL_CURRENCY, 'IRR');
  const [pub, pSrc] = pick(s.public_base_url, env.PUBLIC_BASE_URL, '');
  const [link, lSrc] = pick(s.payment_link_base, env.CRM_PAYMENT_LINK_BASE, '');
  const tokSaved = normalizeAccessToken(s.access_token);
  const tokEnv = normalizeAccessToken(env.ZARINPAL_ACCESS_TOKEN);
  return {
    merchantId: merchantEnv,
    sandbox: sandbox[0],
    currency: cur.toUpperCase() === 'IRT' ? 'IRT' : 'IRR',
    publicBaseUrl: pub,
    paymentLinkBase: link,
    accessToken: tokSaved || tokEnv,
    sources: {
      merchant_id: mSrc === 'default' && merchantEnv ? 'saved' : mSrc,
      sandbox: sandbox[1], currency: cSrc, public_base_url: pSrc, payment_link_base: lSrc,
      access_token: tokSaved ? 'saved' : tokEnv ? 'env' : 'default',
    },
  };
}

export const toZarinpalConfig = (e: EffectiveZarinpal): ZarinpalConfig => ({ merchantId: e.merchantId, sandbox: e.sandbox, currency: e.currency });

/** The only shape that is ever sent to the browser. */
export function publicZarinpal(e: EffectiveZarinpal) {
  return {
    merchant_id_masked: maskTail(e.merchantId),
    merchant_id_set: !!e.merchantId,
    merchant_id_valid: isMerchantUuid(e.merchantId),
    sandbox: e.sandbox,
    currency: e.currency,
    public_base_url: e.publicBaseUrl,
    payment_link_base: e.paymentLinkBase,
    access_token_set: !!e.accessToken,
    sources: e.sources,
    status: !e.merchantId ? 'not_configured' : !isMerchantUuid(e.merchantId) ? 'invalid_merchant' : e.sandbox ? 'sandbox' : 'live',
  };
}

const cleanUrl = (v: unknown) => {
  const s = str(v).slice(0, 300);
  if (!s) return '';
  if (!/^https?:\/\/[^\s/]+/i.test(s)) throw Object.assign(new Error('آدرس باید با http:// یا https:// شروع شود.'), { status: 400 });
  return s;
};

/**
 * Applies a POST body to the saved block. Empty secret fields keep the saved value; `clear_*` flags remove
 * it (falls back to env). Other text fields: '' clears the saved override.
 */
export function applyZarinpalPatch(current: SavedZarinpal | undefined, b: any): SavedZarinpal {
  const next: SavedZarinpal = { ...(current || {}) };
  if (b?.clear_merchant_id) delete next.merchant_id;
  else if (str(b?.merchant_id)) {
    const m = str(b.merchant_id);
    if (!isMerchantUuid(m)) throw Object.assign(new Error('کد مرچنت باید ۳۶ کاراکتر به شکل xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx باشد.'), { status: 400 });
    next.merchant_id = m;
  }
  if (b?.clear_access_token) delete next.access_token;
  else if (str(b?.access_token)) next.access_token = normalizeAccessToken(b.access_token).slice(0, 4000);
  if (b?.sandbox === null) delete next.sandbox;
  else if (b?.sandbox !== undefined) next.sandbox = !!b.sandbox;
  if (b?.currency !== undefined) {
    const c = str(b.currency).toUpperCase();
    if (!c) delete next.currency; else if (c === 'IRR' || c === 'IRT') next.currency = c; else throw Object.assign(new Error('واحد پول باید IRR یا IRT باشد.'), { status: 400 });
  }
  for (const k of ['public_base_url', 'payment_link_base'] as const) {
    if (b?.[k] === undefined) continue;
    const u = cleanUrl(b[k]);
    if (u) next[k] = u; else delete next[k];
  }
  return next;
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/** Read-only GraphQL call. Throws on anything but a `query` operation. */
export async function zarinpalQuery(token: string, query: string, variables: Record<string, unknown> = {}, fetchImpl: FetchLike = fetch as any): Promise<any> {
  if (!/^\s*query\b/.test(query) || /\bmutation\b/i.test(query)) throw new Error('only GraphQL queries are allowed');
  const t = normalizeAccessToken(token);
  if (!t) throw Object.assign(new Error('توکن دسترسی زرین‌پال تنظیم نشده است.'), { status: 400 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetchImpl(ZARINPAL_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    let body: any = null;
    try { body = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok || body?.errors?.length) {
      const msg = String(body?.errors?.[0]?.message || body?.message || `HTTP ${r.status}`).slice(0, 200);
      throw Object.assign(new Error(msg), { status: 502 });
    }
    return body?.data || {};
  } finally { clearTimeout(timer); }
}

export type ZpTerminal = { id: string; status: string; domain: string; name: string; matches_merchant: boolean };
export type ZpSessionRow = {
  id: string; created_at: string; amount_rial: number; amount_toman: number;
  status: string; description: string; rrn: string; card: string;
};

/** Terminals; the merchant key is compared server-side and never returned. */
export async function fetchTerminals(token: string, merchantId: string, fetchImpl?: FetchLike): Promise<ZpTerminal[]> {
  const d = await zarinpalQuery(token, 'query { Terminals { id status domain name key } }', {}, fetchImpl);
  return (Array.isArray(d.Terminals) ? d.Terminals : []).map((t: any) => ({
    id: String(t?.id ?? ''), status: String(t?.status ?? ''), domain: String(t?.domain ?? ''), name: String(t?.name ?? ''),
    matches_merchant: !!merchantId && String(t?.key ?? '').toLowerCase() === merchantId.toLowerCase(),
  }));
}

export function mapSession(s: any): ZpSessionRow {
  const tries: any[] = Array.isArray(s?.session_tries) ? s.session_tries : [];
  const best = tries.find((t) => t?.rrn) || tries[tries.length - 1] || {};
  const rial = Number(s?.amount) || 0;
  return {
    id: String(s?.id ?? ''),
    created_at: String(s?.created_at ?? ''),
    amount_rial: rial,
    amount_toman: Math.round(rial / 10),
    status: String(s?.status ?? ''),
    description: String(s?.description ?? '').slice(0, 300),
    rrn: best?.rrn ? String(best.rrn) : '',
    card: maskCard(best?.card_pan),
  };
}

export async function fetchSessions(token: string, terminalId: string, limit = 50, offset = 0, fetchImpl?: FetchLike): Promise<ZpSessionRow[]> {
  const d = await zarinpalQuery(token,
    'query Sessions($t: ID, $limit: Int, $offset: Int) { Session(terminal_id: $t, limit: $limit, offset: $offset) { id status amount description created_at session_tries { rrn card_pan status } } }',
    { t: terminalId, limit, offset }, fetchImpl);
  return (Array.isArray(d.Session) ? d.Session : []).map(mapSession);
}

/**
 * Every session of a terminal, all statuses (no `filter` argument), paged with limit/offset until a short
 * page, de-duplicated by id and sorted newest first. `maxPages` bounds the work (100 × 50 = 5000 rows).
 */
export async function fetchAllSessions(token: string, terminalId: string, fetchImpl?: FetchLike, pageSize = 100, maxPages = 50): Promise<{ sessions: ZpSessionRow[]; truncated: boolean }> {
  const byId = new Map<string, ZpSessionRow>();
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchSessions(token, terminalId, pageSize, page * pageSize, fetchImpl);
    let added = 0;
    for (const r of rows) if (r.id && !byId.has(r.id)) { byId.set(r.id, r); added++; }
    if (rows.length < pageSize || added === 0) break; // last page (or the API ignored offset)
    if (page === maxPages - 1) truncated = true;
  }
  const sessions = [...byId.values()].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  return { sessions, truncated };
}

export function countByStatus(rows: ZpSessionRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status || '?'] = (out[r.status || '?'] || 0) + 1;
  return out;
}

export type ZarinpalSettingsDeps = {
  readGateways: () => any;
  writeZarinpal: (next: SavedZarinpal) => void;
  isAdmin: (req: express.Request) => boolean;
  log?: (msg: string) => void;
  fetchImpl?: FetchLike;
};

export function registerZarinpalSettings(app: express.Express, deps: ZarinpalSettingsDeps) {
  const log = deps.log || (() => {});
  const eff = () => resolveZarinpal(deps.readGateways());
  const guard = (req: express.Request, res: express.Response) => {
    if (deps.isAdmin(req)) return true;
    res.status(403).json({ error: 'فقط مدیر سیستم به تنظیمات درگاه پرداخت دسترسی دارد.' });
    return false;
  };
  const fail = (res: express.Response, err: any) => res.status(Number(err?.status) || 500).json({ error: String(err?.message || 'خطا') });

  app.get('/api/settings/zarinpal', (req, res) => {
    if (!guard(req, res)) return;
    res.json(publicZarinpal(eff()));
  });

  app.post('/api/settings/zarinpal', (req, res) => {
    if (!guard(req, res)) return;
    try {
      const current = (deps.readGateways() || {}).zarinpal;
      deps.writeZarinpal(applyZarinpalPatch(current, req.body || {}));
      res.json({ success: true, settings: publicZarinpal(eff()) });
    } catch (err: any) { fail(res, err); }
  });

  app.post('/api/settings/zarinpal/test', async (req, res) => {
    if (!guard(req, res)) return;
    const e = eff();
    const merchant = { ok: isMerchantUuid(e.merchantId), message: !e.merchantId ? 'کد مرچنت تنظیم نشده است.' : isMerchantUuid(e.merchantId) ? 'قالب کد مرچنت درست است.' : 'قالب کد مرچنت نادرست است (باید UUID باشد).' };
    let api: { ok: boolean; skipped?: boolean; message: string } = { ok: false, skipped: true, message: 'توکن دسترسی تنظیم نشده است.' };
    if (e.accessToken) {
      try {
        const d = await zarinpalQuery(e.accessToken, 'query { Me { id } }', {}, deps.fetchImpl);
        api = d?.Me?.id ? { ok: true, message: 'اتصال به API زرین‌پال برقرار است.' } : { ok: false, message: 'پاسخ API نامعتبر بود.' };
      } catch (err: any) {
        log(`zarinpal api test failed: ${err?.message}`);
        api = { ok: false, message: `اتصال ناموفق: ${String(err?.message || '').slice(0, 120)}` };
      }
    }
    res.json({ merchant, api, settings: publicZarinpal(e) });
  });

  /** Read-only sync: terminals + every session (all statuses, fully paged). Nothing is written. */
  app.get('/api/settings/zarinpal/transactions', async (req, res) => {
    if (!guard(req, res)) return;
    const e = eff();
    try {
      const terminals = await fetchTerminals(e.accessToken, e.merchantId, deps.fetchImpl);
      const wanted = String(req.query.terminal_id || '');
      const terminal = terminals.find((t) => t.id === wanted) || terminals.find((t) => t.matches_merchant) || terminals[0];
      const { sessions, truncated } = terminal ? await fetchAllSessions(e.accessToken, terminal.id, deps.fetchImpl) : { sessions: [], truncated: false };
      res.json({ terminals, terminal_id: terminal?.id || null, total: sessions.length, by_status: countByStatus(sessions), truncated, sessions });
    } catch (err: any) {
      log(`zarinpal sync failed: ${err?.message}`);
      fail(res, err);
    }
  });
}
