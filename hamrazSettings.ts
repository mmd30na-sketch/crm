/**
 * «تنظیمات هم‌راز»: editable settings of the CRM's AI copilot (هم‌راز), admin only.
 *
 * Storage: JSON settings store `settings.gateways.hamraz` (`gateways` is stripped from every browser response
 * by publicSettings()). No SQL migration. Precedence per field: saved value > env > default, so nothing
 * changes until the admin saves something:
 *   enabled            (no env)                 default on
 *   api_url            COPILOT_API_URL          ''  (copilot answers 503 while empty)
 *   api_key            COPILOT_API_KEY          ''  (write-only; never returned)
 *   model              COPILOT_MODEL            'gpt-4o-mini'
 *   max_iterations     (no env)                 6   (clamped 1..20)
 *   sql_enabled        COPILOT_SQL_ENABLED=1    off
 *   sms_direct         (no env)                 on  (sms_send_direct offered and allowed)
 *   confirm.sms_send / confirm.telegram / confirm.rubika   (no env)   all on (draft + «تأیید» in the widget)
 * Values are read at request time, so a save takes effect without a restart.
 */
import type express from 'express';

export type Source = 'saved' | 'env' | 'default';
export type ConfirmKey = 'sms_send' | 'telegram' | 'rubika';
export const CONFIRM_KEYS: readonly ConfirmKey[] = ['sms_send', 'telegram', 'rubika'];

export type SavedHamraz = {
  enabled?: boolean;
  api_url?: string;
  api_key?: string;
  model?: string;
  max_iterations?: number;
  sql_enabled?: boolean;
  sms_direct?: boolean;
  confirm?: Partial<Record<ConfirmKey, boolean>>;
};

export type EffectiveHamraz = {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
  sqlEnabled: boolean;
  smsDirect: boolean;
  confirm: Record<ConfirmKey, boolean>;
  sources: Record<'enabled' | 'api_url' | 'api_key' | 'model' | 'max_iterations' | 'sql_enabled' | 'sms_direct' | ConfirmKey, Source>;
};

export const DEFAULT_MODEL = 'gpt-4o-mini';
export const DEFAULT_MAX_ITERATIONS = 6;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const cleanBase = (v: string) => v.trim().replace(/\/+$/, '');
const clampSteps = (n: unknown) => Math.min(20, Math.max(1, Math.round(Number(n)) || DEFAULT_MAX_ITERATIONS));

export function resolveHamraz(gateways: any, env: NodeJS.ProcessEnv = process.env): EffectiveHamraz {
  const g = gateways && typeof gateways === 'object' ? gateways : {};
  const s: SavedHamraz = g.hamraz && typeof g.hamraz === 'object' ? g.hamraz : {};
  const txt = (saved: unknown, envVal: unknown, def: string): [string, Source] =>
    str(saved) ? [str(saved), 'saved'] : str(envVal) ? [str(envVal), 'env'] : [def, 'default'];
  const bool = (saved: unknown, envVal: boolean | undefined, def: boolean): [boolean, Source] =>
    typeof saved === 'boolean' ? [saved, 'saved'] : envVal !== undefined ? [envVal, 'env'] : [def, 'default'];
  const [apiUrl, uSrc] = txt(s.api_url, env.COPILOT_API_URL, '');
  const [apiKey, kSrc] = txt(s.api_key, env.COPILOT_API_KEY, '');
  const [model, mSrc] = txt(s.model, env.COPILOT_MODEL, DEFAULT_MODEL);
  const steps: [number, Source] = Number.isFinite(Number(s.max_iterations)) && s.max_iterations !== undefined && s.max_iterations !== null
    ? [clampSteps(s.max_iterations), 'saved'] : [DEFAULT_MAX_ITERATIONS, 'default'];
  const envSql = str(env.COPILOT_SQL_ENABLED) ? str(env.COPILOT_SQL_ENABLED) === '1' : undefined;
  const [enabled, eSrc] = bool(s.enabled, undefined, true);
  const [sqlEnabled, qSrc] = bool(s.sql_enabled, envSql, false);
  const [smsDirect, dSrc] = bool(s.sms_direct, undefined, true);
  const c = s.confirm && typeof s.confirm === 'object' ? s.confirm : {};
  const confirm = {} as Record<ConfirmKey, boolean>;
  const cSrc = {} as Record<ConfirmKey, Source>;
  for (const k of CONFIRM_KEYS) [confirm[k], cSrc[k]] = bool((c as any)[k], undefined, true);
  return {
    enabled, apiUrl: cleanBase(apiUrl), apiKey, model, maxIterations: steps[0], sqlEnabled, smsDirect, confirm,
    sources: { enabled: eSrc, api_url: uSrc, api_key: kSrc, model: mSrc, max_iterations: steps[1], sql_enabled: qSrc, sms_direct: dSrc, ...cSrc },
  };
}

/** The only shape sent to the browser: no key, and the URL without credentials/query. */
export function publicHamraz(e: EffectiveHamraz) {
  return {
    enabled: e.enabled,
    configured: !!e.apiUrl && !!e.apiKey,
    api_url: redactUrl(e.apiUrl),
    api_key_set: !!e.apiKey,
    model: e.model,
    max_iterations: e.maxIterations,
    sql_enabled: e.sqlEnabled,
    sms_direct: e.smsDirect,
    confirm: { ...e.confirm },
    sources: { ...e.sources },
  };
}

/** Drops user:pass@ and the query string (some gateways put keys there). */
export function redactUrl(u: string): string {
  if (!u) return '';
  try {
    const x = new URL(u);
    x.username = ''; x.password = ''; x.search = ''; x.hash = '';
    return x.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });

/** Applies a POST body. Empty api_key keeps the saved key; clear_api_key removes it; null resets a field to env/default. */
export function applyHamrazPatch(current: SavedHamraz | undefined, b: any): SavedHamraz {
  const next: SavedHamraz = { ...(current || {}), confirm: { ...((current && current.confirm) || {}) } };
  for (const k of ['enabled', 'sql_enabled', 'sms_direct'] as const) {
    if (b?.[k] === null) delete next[k];
    else if (b?.[k] !== undefined) next[k] = !!b[k];
  }
  if (b?.api_url !== undefined) {
    const u = cleanBase(str(b.api_url)).slice(0, 300);
    if (!u) delete next.api_url;
    else if (!/^https?:\/\/[^\s/]+/i.test(u)) throw bad('آدرس سرویس باید با http:// یا https:// شروع شود.');
    else next.api_url = u;
  }
  if (b?.model !== undefined) {
    const m = str(b.model).slice(0, 120);
    if (!m) delete next.model; else if (!/^[\w.:/@+-]+$/.test(m)) throw bad('نام مدل نامعتبر است.'); else next.model = m;
  }
  if (b?.max_iterations === null || b?.max_iterations === '') delete next.max_iterations;
  else if (b?.max_iterations !== undefined) {
    const n = Number(b.max_iterations);
    if (!Number.isFinite(n) || n < 1 || n > 20) throw bad('حداکثر گام‌ها باید بین ۱ تا ۲۰ باشد.');
    next.max_iterations = Math.round(n);
  }
  if (b?.clear_api_key) delete next.api_key;
  else if (str(b?.api_key)) next.api_key = str(b.api_key).replace(/^bearer\s+/i, '').slice(0, 1000);
  if (b?.confirm && typeof b.confirm === 'object') {
    for (const k of CONFIRM_KEYS) {
      if (b.confirm[k] === null) delete next.confirm![k];
      else if (b.confirm[k] !== undefined) next.confirm![k] = !!b.confirm[k];
    }
  }
  if (!Object.keys(next.confirm || {}).length) delete next.confirm;
  return next;
}

/** Removes the key (and Bearer form) from any provider text before it reaches a response or a log. */
export function scrub(text: string, secrets: string[]): string {
  let out = String(text || '');
  for (const s of secrets.filter((x) => x && x.length >= 6)) out = out.split(s).join('***');
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]{12,}/g, 'Bearer ***');
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** A tiny chat completion (max_tokens 1, no tools). Returns ok/fail with a scrubbed short message. */
export async function testCopilotEndpoint(e: EffectiveHamraz, fetchImpl: FetchLike = fetch as any): Promise<{ ok: boolean; status: number | null; model: string; ms: number; message: string }> {
  const t0 = Date.now();
  if (!e.apiUrl) return { ok: false, status: null, model: e.model, ms: 0, message: 'آدرس سرویس تنظیم نشده است.' };
  if (!e.apiKey) return { ok: false, status: null, model: e.model, ms: 0, message: 'کلید API تنظیم نشده است.' };
  try {
    const r = await fetchImpl(`${e.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.apiKey}` },
      body: JSON.stringify({ model: e.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5, temperature: 0 }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await r.text().catch(() => '');
    const ms = Date.now() - t0;
    if (r.ok) return { ok: true, status: r.status, model: e.model, ms, message: 'اتصال به سرویس هوش مصنوعی برقرار است.' };
    let detail = '';
    try { const j = JSON.parse(body); detail = String(j?.error?.message || j?.message || j?.error || ''); } catch { detail = body; }
    return { ok: false, status: r.status, model: e.model, ms, message: `پاسخ ${r.status}: ${scrub(detail, [e.apiKey]).slice(0, 160)}` };
  } catch (err: any) {
    return { ok: false, status: null, model: e.model, ms: Date.now() - t0, message: `اتصال ناموفق: ${scrub(String(err?.message || ''), [e.apiKey]).slice(0, 160)}` };
  }
}

export type HamrazSettingsDeps = {
  readGateways: () => any;
  writeHamraz: (next: SavedHamraz) => void;
  isAdmin: (req: express.Request) => boolean;
  fetchImpl?: FetchLike;
};

export function registerHamrazSettings(app: express.Express, deps: HamrazSettingsDeps) {
  const eff = () => resolveHamraz(deps.readGateways());
  const guard = (req: express.Request, res: express.Response) => {
    if (deps.isAdmin(req)) return true;
    res.status(403).json({ error: 'فقط مدیر سیستم به تنظیمات هم‌راز دسترسی دارد.' });
    return false;
  };
  app.get('/api/settings/hamraz', (req, res) => { if (guard(req, res)) res.json(publicHamraz(eff())); });
  app.post('/api/settings/hamraz', (req, res) => {
    if (!guard(req, res)) return;
    try {
      deps.writeHamraz(applyHamrazPatch((deps.readGateways() || {}).hamraz, req.body || {}));
      res.json({ success: true, settings: publicHamraz(eff()) });
    } catch (err: any) { res.status(Number(err?.status) || 500).json({ error: String(err?.message || 'خطا') }); }
  });
  app.post('/api/settings/hamraz/test', async (req, res) => {
    if (!guard(req, res)) return;
    const e = eff();
    res.json({ ...(await testCopilotEndpoint(e, deps.fetchImpl)), settings: publicHamraz(e) });
  });
}
