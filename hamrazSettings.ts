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
 *   model_fallbacks    COPILOT_MODEL_FALLBACKS  the three free OmniRoute models from docs/copilot.md
 *   max_iterations     (no env)                 6   (clamped 1..20)
 *   sql_enabled        COPILOT_SQL_ENABLED=1    off
 *   sms_direct         (no env)                 on  (sms_send_direct offered and allowed)
 *   payment_tools      (no env)                 on  (agent/payment_tools; refund/reverse always need «تأیید»)
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
  model_fallbacks?: string[];
  max_iterations?: number;
  sql_enabled?: boolean;
  sms_direct?: boolean;
  payment_tools?: boolean;
  confirm?: Partial<Record<ConfirmKey, boolean>>;
};

export type EffectiveHamraz = {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
  modelFallbacks: string[];
  maxIterations: number;
  sqlEnabled: boolean;
  smsDirect: boolean;
  paymentTools: boolean;
  confirm: Record<ConfirmKey, boolean>;
  sources: Record<'enabled' | 'api_url' | 'api_key' | 'model' | 'model_fallbacks' | 'max_iterations' | 'sql_enabled' | 'sms_direct' | 'payment_tools' | ConfirmKey, Source>;
};

export const DEFAULT_MODEL = 'gpt-4o-mini';
export const DEFAULT_MAX_ITERATIONS = 6;
/** Free OmniRoute models documented in docs/copilot.md as returning tool_calls. */
export const DEFAULT_MODEL_FALLBACKS = [
  'cline/poolside/laguna-s-2.1:free',
  'cline/nvidia/nemotron-3.5-lightning:free',
  'cline/xiaomi/mimo-v2.6-flash',
];
const MAX_FALLBACKS = 20;
const MODEL_RE = /^[\w.:/@+-]+$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const cleanBase = (v: string) => v.trim().replace(/\/+$/, '');
const clampSteps = (n: unknown) => Math.min(20, Math.max(1, Math.round(Number(n)) || DEFAULT_MAX_ITERATIONS));
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(str).filter(Boolean);
const dedupe = (items: string[]) => [...new Set(items)];
/** Primary first, then the fallbacks, de-duplicated. */
export function modelChain(primary: string, fallbacks: string[]): string[] {
  return dedupe([primary, ...fallbacks].map((m) => str(m).slice(0, 120)).filter(Boolean)).slice(0, MAX_FALLBACKS + 1);
}

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
  const savedFallbacks = list(s.model_fallbacks);
  const envFallbacks = list(env.COPILOT_MODEL_FALLBACKS);
  const fallbacks = savedFallbacks.length ? savedFallbacks : envFallbacks.length ? envFallbacks : [...DEFAULT_MODEL_FALLBACKS];
  const fSrc: Source = savedFallbacks.length ? 'saved' : envFallbacks.length ? 'env' : 'default';
  // The primary is always first; duplicates (including a fallback equal to the primary) are dropped.
  const modelFallbacks = modelChain(model, fallbacks).slice(1);
  const steps: [number, Source] = Number.isFinite(Number(s.max_iterations)) && s.max_iterations !== undefined && s.max_iterations !== null
    ? [clampSteps(s.max_iterations), 'saved'] : [DEFAULT_MAX_ITERATIONS, 'default'];
  const envSql = str(env.COPILOT_SQL_ENABLED) ? str(env.COPILOT_SQL_ENABLED) === '1' : undefined;
  const [enabled, eSrc] = bool(s.enabled, undefined, true);
  const [sqlEnabled, qSrc] = bool(s.sql_enabled, envSql, false);
  const [smsDirect, dSrc] = bool(s.sms_direct, undefined, true);
  const [paymentTools, pSrc] = bool(s.payment_tools, undefined, true);
  const c = s.confirm && typeof s.confirm === 'object' ? s.confirm : {};
  const confirm = {} as Record<ConfirmKey, boolean>;
  const cSrc = {} as Record<ConfirmKey, Source>;
  for (const k of CONFIRM_KEYS) [confirm[k], cSrc[k]] = bool((c as any)[k], undefined, true);
  return {
    enabled, apiUrl: cleanBase(apiUrl), apiKey, model, modelFallbacks, maxIterations: steps[0], sqlEnabled, smsDirect, paymentTools, confirm,
    sources: { enabled: eSrc, api_url: uSrc, api_key: kSrc, model: mSrc, model_fallbacks: fSrc, max_iterations: steps[1], sql_enabled: qSrc, sms_direct: dSrc, payment_tools: pSrc, ...cSrc },
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
    model_fallbacks: [...e.modelFallbacks],
    max_iterations: e.maxIterations,
    sql_enabled: e.sqlEnabled,
    sms_direct: e.smsDirect,
    payment_tools: e.paymentTools,
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
  for (const k of ['enabled', 'sql_enabled', 'sms_direct', 'payment_tools'] as const) {
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
    if (!m) delete next.model; else if (!MODEL_RE.test(m)) throw bad('نام مدل نامعتبر است.'); else next.model = m;
  }
  if (b?.model_fallbacks !== undefined) {
    const models = b.model_fallbacks === null ? [] : dedupe(list(b.model_fallbacks).map((m) => m.slice(0, 120)));
    if (!models.length) delete next.model_fallbacks;
    else {
      for (const m of models) if (!MODEL_RE.test(m)) throw bad('نام مدل جایگزین نامعتبر است.');
      next.model_fallbacks = models.slice(0, MAX_FALLBACKS);
    }
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

export type CopilotFetchResponse = { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> };
export type CopilotFetchLike = (url: string, init: any) => Promise<CopilotFetchResponse>;

export type CopilotCompletionOptions = {
  messages: any[];
  withTools?: boolean;
  tools?: any[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type CopilotAttempt = { model: string; status: number | null; ok: boolean; retryable: boolean; reason?: string };
export type CopilotCompletionOutcome = { completion: any; model: string; attempts: CopilotAttempt[] };

export class CopilotCompletionError extends Error {
  status: number | null;
  model: string;
  retryable: boolean;
  attempts: CopilotAttempt[];
  constructor(message: string, opts: { status: number | null; model: string; retryable: boolean; attempts: CopilotAttempt[] }) {
    super(message);
    this.name = 'CopilotCompletionError';
    this.status = opts.status;
    this.model = opts.model;
    this.retryable = opts.retryable;
    this.attempts = opts.attempts;
    Object.setPrototypeOf(this, CopilotCompletionError.prototype);
  }
}

const RETRYABLE_STATUS = new Set([402, 408, 429, 500, 502, 503, 529]);
const RETRYABLE_TEXT = /quota|rate[\s_-]*limit|resource[\s_-]*exhausted|too many requests/i;

export const isRetryableStatus = (status: number) => RETRYABLE_STATUS.has(status);
export const mentionsRetryableFailure = (text: string) => RETRYABLE_TEXT.test(String(text || ''));

function providerDetail(body: string): string {
  try {
    const j = JSON.parse(body);
    return String(j?.error?.message || j?.message || j?.error || body || '');
  } catch { return String(body || ''); }
}

/**
 * Calls an OpenAI-compatible `/chat/completions` endpoint, walking primary -> fallbacks for retryable
 * failures (402/408/429/5xx/529, quota/rate-limit text, network/timeout, empty assistant content).
 * 401/403 and other non-retryable provider errors stop immediately: another model will not fix them.
 */
export async function callCopilotCompletionWithFallback(
  e: EffectiveHamraz,
  opts: CopilotCompletionOptions,
  fetchImpl: CopilotFetchLike = fetch as any,
): Promise<CopilotCompletionOutcome> {
  const models = modelChain(e.model, e.modelFallbacks);
  const attempts: CopilotAttempt[] = [];
  const url = `${e.apiUrl}/chat/completions`;
  const baseBody: Record<string, any> = {
    messages: opts.messages,
    ...(opts.withTools === false ? {} : { tools: opts.tools || [], tool_choice: 'auto' }),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2000,
  };
  let lastEmpty: { completion: any; model: string } | null = null;

  for (const model of models) {
    let response: CopilotFetchResponse;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.apiKey}` },
        body: JSON.stringify({ ...baseBody, model }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
      });
    } catch (err: any) {
      const reason = scrub(String(err?.message || err || 'network error'), [e.apiKey]).slice(0, 200);
      attempts.push({ model, status: null, ok: false, retryable: true, reason });
      console.warn(`[copilot] model ${model} failed (network); trying next model if available`);
      continue;
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const detail = scrub(providerDetail(raw), [e.apiKey]).slice(0, 300);
      const retryable = response.status !== 401 && response.status !== 403
        && (isRetryableStatus(response.status) || mentionsRetryableFailure(raw));
      attempts.push({ model, status: response.status, ok: false, retryable, reason: detail });
      if (!retryable) {
        console.warn(`[copilot] model ${model} failed ${response.status}; not trying another model`);
        throw new CopilotCompletionError(`Copilot API error ${response.status} (model=${model}): ${detail}`, {
          status: response.status, model, retryable: false, attempts,
        });
      }
      console.warn(`[copilot] model ${model} failed ${response.status}; trying next model if available`);
      continue;
    }

    let completion: any;
    try {
      completion = await response.json();
    } catch (err: any) {
      const reason = scrub(String(err?.message || err || 'invalid JSON'), [e.apiKey]).slice(0, 200);
      attempts.push({ model, status: response.status, ok: false, retryable: true, reason });
      console.warn(`[copilot] model ${model} returned invalid JSON; trying next model if available`);
      continue;
    }

    const message = completion?.choices?.[0]?.message;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!toolCalls.length && !content) {
      attempts.push({ model, status: response.status, ok: false, retryable: true, reason: 'empty assistant content' });
      console.warn(`[copilot] model ${model} returned empty content; trying next model if available`);
      lastEmpty = { completion, model };
      continue;
    }

    attempts.push({ model, status: response.status, ok: true, retryable: false });
    if (model !== e.model) console.info(`[copilot] using fallback model ${model}`);
    return { completion, model, attempts };
  }

  // Empty replies are not thrown here: the chat handler already turns a still-empty reply into a 502 message.
  if (lastEmpty) return { completion: lastEmpty.completion, model: lastEmpty.model, attempts };
  const last = attempts[attempts.length - 1];
  throw new CopilotCompletionError(
    `Copilot API error: all models failed${last ? ` (${last.model}${last.status ? ` ${last.status}` : ''})` : ''}`,
    { status: last?.status ?? null, model: last?.model ?? e.model, retryable: true, attempts },
  );
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
