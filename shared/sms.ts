/**
 * Shared SMS helper (site + CRM). Keep this file identical to the site copy
 * `/project/kermanshahcart/shared/sms.ts`. No sms.ir SDK; these calls match the panel docs.
 *
 * Config, and nothing else:
 *   SMS_API_KEY                 env only. Header `x-api-key`. Never stored in DB or JSON.
 *   app_settings['sms.config']  { provider:'smsir', lineNumber, apiKeyRef:'env:SMS_API_KEY', autoRegister, autoExam }
 *   SMS_SENDER_LINE             bulk-send fallback, used only when `lineNumber` is empty. Verify does not use a line.
 *   sms_templates               verify rows need provider_template_id and status 2 (approved) before they can send.
 *
 * Calls: POST /v1/send/verify, POST /v1/send/bulk, GET /v1/credit, GET /v1/line, GET /v1/templates.
 * A verify parameter value is at most 25 characters. Template review status: 1 pending, 2 approved, 3 rejected.
 */
export type SqlFn = (query: string, params?: any[]) => Promise<any[]>;
export type SmsSendResult = { ok: boolean; status: 'sent' | 'not_configured' | 'failed' | 'disabled'; detail?: string };
export type SmsConfig = { provider: string; lineNumber: string; apiKeyRef: string; autoRegister: boolean; autoExam: boolean };

/** {placeholder} <-> legacy CRM UI [Persian] tokens (the UI substitutes the bracket form client-side). */
export const PLACEHOLDERS: Record<string, string> = {
  name: 'نام', family: 'خانوادگی', course: 'دوره', debt: 'بدهی', date: 'تاریخ', time: 'ساعت', amount: 'مبلغ', tracking_code: 'کد_پیگیری',
};
export const toBracket = (s: string) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (PLACEHOLDERS[k] ? `[${PLACEHOLDERS[k]}]` : m));
export const fromBracket = (s: string) => {
  let t = String(s || '');
  for (const [k, fa] of Object.entries(PLACEHOLDERS)) t = t.split(`[${fa}]`).join(`{${k}}`);
  return t;
};
export const render = (body: string, vars: Record<string, unknown> = {}) =>
  String(body || '').replace(/\{(\w+)\}/g, (m, k) => {
    if (vars[k] === undefined || vars[k] === null) return '';
    const v = String(vars[k]);
    return k === 'tracking_code' ? v.replace(/^KRM-/i, '') : v; // SMS shows the bare tracking number
  });

const SMSIR_API = 'https://api.sms.ir';
/** Delivery states from the sms.ir status table. 8 is the documented "unknown". */
export const SMSIR_DELIVERY_FA: Record<number, string> = {
  1: 'رسیده', 2: 'نرسیده به گوشی', 3: 'رسیده به مخابرات', 4: 'نرسیده به مخابرات',
  5: 'رسیده به اپراتور', 6: 'ناموفق', 7: 'لیست سیاه', 8: 'نامشخص',
};

const fetchJson = async (url: string, init: any = {}) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const txt = await r.text();
  let body: any = null; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 200); }
  return { status: r.status, body };
};
const scrubKey = (s: any, key: string) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return (key ? t.split(key).join('***') : t).slice(0, 300); };

/** Bulk line: an explicit line, then sms.config.lineNumber, then SMS_SENDER_LINE. */
export function resolveSenderLine(configured?: string | null, override?: string | null): string {
  return String(override ?? '').trim() || String(configured ?? '').trim() || String(process.env.SMS_SENDER_LINE || '').trim();
}

async function smsirCall(o: { apiKey: string; method?: string; path: string; body?: unknown }) {
  const headers: Record<string, string> = { 'x-api-key': o.apiKey, Accept: 'application/json' };
  const init: any = { method: o.method || 'GET', headers };
  if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
  return fetchJson(`${SMSIR_API}${o.path}`, init);
}

/** Read-only sms.ir GET. `path` includes the query string. Does not log the key. */
export async function smsirRead(apiKey: string, path: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!apiKey) return { ok: false, error: 'درگاه پیامک تنظیم نشده است.' };
  try {
    const { status, body } = await smsirCall({ apiKey, path });
    if (body && body.status === 1) return { ok: true, data: body.data };
    if (body && body.status === 20) return { ok: false, error: 'محدودیت تعداد درخواست پنل پیامک؛ چند ثانیه دیگر دوباره تلاش کنید.' };
    return { ok: false, error: scrubKey(body && body.message || `HTTP ${status}`, apiKey) };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'پاسخی از سرویس پیامک نرسید.' : 'خطا در اتصال به سرویس پیامک' };
  }
}

/** sms.ir sends. Parameter names are camelCase, as in the panel samples. */
export async function smsirVerify(o: { apiKey: string; mobile: string; templateId: number; parameters: { name: string; value: string }[] }): Promise<{ ok: boolean; error?: string }> {
  const { body } = await smsirCall({
    apiKey: o.apiKey, method: 'POST', path: '/v1/send/verify',
    body: { mobile: o.mobile, templateId: o.templateId, parameters: o.parameters },
  });
  return body && body.status === 1 ? { ok: true } : { ok: false, error: scrubKey(body && body.message || body, o.apiKey) };
}
export async function smsirBulk(o: { apiKey: string; lineNumber: string; mobile: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const { status, body } = await smsirCall({
    apiKey: o.apiKey, method: 'POST', path: '/v1/send/bulk',
    body: { lineNumber: Number(o.lineNumber), messageText: o.text, mobiles: [o.mobile] },
  });
  return body && body.status === 1 ? { ok: true } : { ok: false, error: scrubKey(body && body.message || `HTTP ${status}`, o.apiKey) };
}
export async function smsirCredit(apiKey: string): Promise<{ ok: boolean; credit?: number; error?: string }> {
  const r = await smsirRead(apiKey, '/v1/credit');
  return r.ok ? { ok: true, credit: r.data } : { ok: false, error: r.error };
}

/** Lesson reminders still ask for `class_time`; the sms.ir row is stored as `class_schedule` (template 926976). */
export const SMS_TEMPLATE_KEY_ALIASES: Record<string, string> = { class_time: 'class_schedule' };

/** Fields we copy from one sms.ir verify template. Status 2 is approved on this account; 3 is rejected. */
export function smsirTemplateFields(raw: any) {
  const params = Array.isArray(raw?.parameters)
    ? raw.parameters.map((p: any) => String(p?.name || '').trim()).filter(Boolean)
    : [];
  const status = Number(raw?.status);
  return {
    provider_template_id: String(raw?.id ?? '').trim(),
    title_fa: String(raw?.title || '').trim().slice(0, 120),
    body_fa: String(raw?.templateText || '').slice(0, 2000),
    param_names: params.join(','),
    provider_status: Number.isFinite(status) ? status : null,
  };
}

export function matchSmsTemplate(rows: any[], key: string, templateId?: string | number | null) {
  const list = Array.isArray(rows) ? rows : [];
  const byKey = (k: string) => list.find((t) => t && t.key === k) || null;
  const alias = SMS_TEMPLATE_KEY_ALIASES[key];
  return byKey(key)
    || (alias ? byKey(alias) : null)
    || (templateId != null && String(templateId) !== ''
      ? list.find((t) => String(t?.provider_template_id || '') === String(templateId)) || null
      : null);
}

export async function smsirListTemplates(apiKey: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const { status, body } = await smsirCall({ apiKey, path: `/v1/templates?pageNumber=${page}&pageSize=100` });
    const data = body && Array.isArray(body.data) ? body.data : null;
    if (status !== 200 || !body || body.status !== 1 || !data) {
      if (page === 1) throw new Error('sms.ir template list failed');
      break;
    }
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

const DEFAULT_CONFIG: SmsConfig = { provider: 'smsir', lineNumber: '', apiKeyRef: 'env:SMS_API_KEY', autoRegister: false, autoExam: false };
export const resolveApiKey = (ref: string) => (String(ref || '').startsWith('env:') ? String(process.env[ref.slice(4)] || '') : '');

export function createSms(sql: SqlFn, opts: { cacheMs?: number } = {}) {
  const cacheMs = opts.cacheMs ?? 60_000;
  let cfgCache: { at: number; v: SmsConfig } | null = null;
  let tplCache: { at: number; v: any[] } | null = null;

  async function getConfig(force = false): Promise<SmsConfig> {
    if (!force && cfgCache && Date.now() - cfgCache.at < cacheMs) return cfgCache.v;
    try {
      const rows = await sql("SELECT setting_value FROM app_settings WHERE setting_key = 'sms.config' LIMIT 1");
      let v: any = rows[0]?.setting_value; if (typeof v === 'string') v = JSON.parse(v);
      const c: SmsConfig = { ...DEFAULT_CONFIG, ...(v || {}) };
      c.autoRegister = v?.autoRegister === true; c.autoExam = v?.autoExam === true;
      cfgCache = { at: Date.now(), v: c };
    } catch { if (!cfgCache) return { ...DEFAULT_CONFIG, lineNumber: process.env.SMS_SENDER_LINE || '' }; }
    return cfgCache!.v;
  }
  async function setConfig(patch: Partial<SmsConfig>) {
    const next: any = { ...(await getConfig(true)), ...patch };
    delete next.apiKey; // never persist secrets
    await sql("UPDATE app_settings SET setting_value = CAST(? AS JSON) WHERE setting_key = 'sms.config'", [JSON.stringify(next)]);
    cfgCache = null; return next as SmsConfig;
  }
  async function listTemplates(force = false): Promise<any[]> {
    if (!force && tplCache && Date.now() - tplCache.at < cacheMs) return tplCache.v;
    const rows = await sql('SELECT * FROM sms_templates ORDER BY id');
    tplCache = { at: Date.now(), v: rows }; return rows;
  }
  async function getTemplate(key: string, templateId?: string | number | null) {
    return matchSmsTemplate(await listTemplates(), key, templateId);
  }
  async function ensureProviderStatusColumn() {
    const cols = await sql("SHOW COLUMNS FROM sms_templates LIKE 'provider_status'");
    if (Array.isArray(cols) && cols.length) return;
    await sql('ALTER TABLE sms_templates ADD COLUMN provider_status SMALLINT NULL');
  }
  /** Pull sms.ir verify templates into sms_templates. Matches on provider_template_id. Never changes `enabled`. */
  async function syncFromSmsir() {
    const cfg = await getConfig(true);
    const apiKey = resolveApiKey(cfg.apiKeyRef || 'env:SMS_API_KEY');
    if (!apiKey) return { ok: false as const, status: 'not_configured' as const };
    await ensureProviderStatusColumn();
    const remote = await smsirListTemplates(apiKey);
    const local = await listTemplates(true);
    let updated = 0;
    let inserted = 0;
    for (const raw of remote) {
      const row = smsirTemplateFields(raw);
      if (!row.provider_template_id) continue;
      const existing = local.find((t) => String(t?.provider_template_id || '') === row.provider_template_id);
      if (existing) {
        await sql(
          "UPDATE sms_templates SET title_fa = ?, body_fa = ?, param_names = ?, provider_status = ?, provider = 'smsir', channel_kind = 'verify' WHERE `key` = ?",
          [row.title_fa || existing.title_fa, row.body_fa || existing.body_fa || '', row.param_names || existing.param_names || null, row.provider_status, existing.key],
        );
        updated++;
      } else {
        const key = `smsir_${row.provider_template_id}`;
        await sql(
          "INSERT INTO sms_templates (`key`, title_fa, body_fa, color, channel_kind, provider, provider_template_id, param_names, enabled, show_in_crm, provider_status) VALUES (?, ?, ?, 'slate', 'verify', 'smsir', ?, ?, 0, ?, ?)",
          [key, row.title_fa || key, row.body_fa, row.provider_template_id, row.param_names || null, key === 'smsir_653789' ? 0 : 1, row.provider_status],
        );
        inserted++;
      }
    }
    tplCache = null;
    return { ok: true as const, updated, inserted, remote: remote.length };
  }
  async function upsertTemplate(key: string, f: { title_fa?: string; body_fa?: string; color?: string; channel_kind?: string; provider_template_id?: string | null; param_names?: string | null; enabled?: boolean }) {
    await sql(
      `INSERT INTO sms_templates (\`key\`, title_fa, body_fa, color, channel_kind, provider_template_id, param_names, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title_fa = COALESCE(VALUES(title_fa), title_fa), body_fa = COALESCE(VALUES(body_fa), body_fa), color = COALESCE(VALUES(color), color)`,
      [key, f.title_fa ?? null, f.body_fa ?? null, f.color ?? 'sky', f.channel_kind || 'bulk', f.provider_template_id ?? null, f.param_names ?? null, f.enabled === false ? 0 : 1]);
    tplCache = null;
  }
  async function deleteTemplate(key: string) { const r: any = await sql('DELETE FROM sms_templates WHERE `key` = ? AND `key` <> \'otp\'', [key]); tplCache = null; return r; }

  /** Free-text SMS through the configured line (or `opts.lineNumber`, e.g. a branch's own line). */
  async function sendText(mobile: string, text: string, opts: { lineNumber?: string | null } = {}): Promise<SmsSendResult> {
    const base = await getConfig(); const apiKey = resolveApiKey(base.apiKeyRef);
    const lineNumber = resolveSenderLine(base.lineNumber, opts.lineNumber);
    if (base.provider !== 'smsir' || !apiKey || !lineNumber) return { ok: false, status: 'not_configured', detail: 'درگاه پیامک تنظیم نشده است (SMS_API_KEY در env و شماره خط در تنظیمات یا SMS_SENDER_LINE).' };
    try { const r = await smsirBulk({ apiKey, lineNumber, mobile, text }); return r.ok ? { ok: true, status: 'sent' } : { ok: false, status: 'failed', detail: r.error }; }
    catch (e: any) { return { ok: false, status: 'failed', detail: e?.name === 'TimeoutError' ? 'پاسخی از سرویس پیامک نرسید.' : (e?.message || 'خطا در اتصال به سرویس پیامک') }; }
  }
  /** Builds the sms.ir verify parameters for a row ({TEMPLATE_PARAM: ourVar}); empty values are reported, never sent. */
  function buildVerifyParams(t: any, vars: Record<string, unknown>, fallbackParam?: string) {
    let map: any = t?.param_map; if (typeof map === 'string') { try { map = JSON.parse(map); } catch { map = null; } }
    const pairs: [string, string][] = map && typeof map === 'object'
      ? Object.entries(map).map(([P, v]) => [P, String(v)])
      : String(t?.param_names || fallbackParam || 'CODE').split(',').map((x) => x.trim()).filter(Boolean).map((n) => [n, n]);
    const val = (k: string) => { const raw = vars[k] ?? vars[k.toLowerCase()]; if (raw === undefined || raw === null) return ''; const v = String(raw).trim(); return k === 'tracking_code' ? v.replace(/^KRM-/i, '') : v; };
    const parameters = pairs.map(([name, k]) => ({ name, value: val(k) }));
    return { parameters, missing: parameters.filter((x) => !x.value).map((x) => x.name) };
  }
  /** Verify rows -> sms.ir /v1/send/verify; on a non-transient verify error (or missing params) falls back to fallback_body_fa via bulk.
   *  Bulk rows are rendered and sent as text. */
  async function sendTemplate(key: string, mobile: string, vars: Record<string, unknown> = {}, fallback?: { templateId?: string; param?: string }): Promise<SmsSendResult & { mode?: string }> {
    let t: any = null; try { t = await getTemplate(key, fallback?.templateId); } catch { /* DB down: use fallback */ }
    if (t && !t.enabled) return { ok: false, status: 'disabled', detail: `template ${key} disabled` };
    const kind = t?.channel_kind || (fallback?.templateId ? 'verify' : 'bulk');
    const bulkFallback = async (why: string): Promise<SmsSendResult & { mode?: string }> => {
      const fb = t?.fallback_body_fa;
      if (!fb) return { ok: false, status: 'failed', detail: why, mode: 'verify' };
      console.log(`[SMS] verify ${key} -> bulk fallback (${why})`);
      const r = await sendText(mobile, render(fb, vars).replace(/\n+$/, ''));
      return { ...r, detail: r.ok ? `bulk fallback (${why})` : `verify: ${why}; bulk: ${r.detail || r.status}`, mode: 'bulk-fallback' };
    };
    if (kind === 'verify') {
      const c = await getConfig(); const apiKey = resolveApiKey(c.apiKeyRef || 'env:SMS_API_KEY');
      const templateId = Number(t?.provider_template_id || fallback?.templateId || 0);
      if (!apiKey || !templateId) return { ok: false, status: 'not_configured', detail: 'sms.ir verify template not configured' };
      const { parameters, missing } = buildVerifyParams(t, vars, fallback?.param);
      if (missing.length) return bulkFallback(`empty params ${missing.join(',')}`);
      let r: { ok: boolean; error?: string };
      try { r = await smsirVerify({ apiKey, mobile, templateId, parameters }); }
      catch (e: any) { return { ok: false, status: 'failed', detail: `verify transient: ${e?.name === 'TimeoutError' ? 'timeout' : (e?.message || e)}`, mode: 'verify' }; } // no fallback: may have been delivered
      if (r.ok) return { ok: true, status: 'sent', mode: 'verify' };
      console.log(`[SMS] verify ${key} failed: ${r.error}`);
      return bulkFallback(String(r.error || 'verify failed'));
    }
    if (!t?.body_fa) return { ok: false, status: 'not_configured', detail: `template ${key} missing` };
    return { ...(await sendText(mobile, render(t.body_fa, vars))), mode: 'bulk' };
  }
  return { getConfig, setConfig, listTemplates, getTemplate, upsertTemplate, deleteTemplate, sendText, sendTemplate, buildVerifyParams, render, syncFromSmsir };
}
