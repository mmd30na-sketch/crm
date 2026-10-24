/**
 * Shared SMS helper (site + CRM). Canonical stores (MySQL nodejs430_carla):
 *   app_settings['sms.config'] = { provider, lineNumber, apiKeyRef: 'env:SMS_API_KEY', autoRegister, autoExam }
 *   sms_templates (key, channel_kind verify|bulk, provider_template_id, param_names, body_fa, enabled, ...)
 * Placeholders in body_fa use one style: {name} {family} {course} {debt} {date} {time} {amount} {tracking_code}.
 * The API key is never stored in DB/JSON; only the env var name is.
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

const fetchJson = async (url: string, init: any = {}) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const txt = await r.text();
  let body: any = null; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 200); }
  return { status: r.status, body };
};
const scrubKey = (s: any, key: string) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return (key ? t.split(key).join('***') : t).slice(0, 300); };

/** sms.ir low-level calls (shared by both apps). */
export async function smsirVerify(o: { apiKey: string; mobile: string; templateId: number; parameters: { name: string; value: string }[] }): Promise<{ ok: boolean; error?: string }> {
  const { body } = await fetchJson('https://api.sms.ir/v1/send/verify', {
    method: 'POST', headers: { 'x-api-key': o.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ mobile: o.mobile, templateId: o.templateId, parameters: o.parameters }),
  });
  return body && body.status === 1 ? { ok: true } : { ok: false, error: scrubKey(body && body.message || body, o.apiKey) };
}
export async function smsirBulk(o: { apiKey: string; lineNumber: string; mobile: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const { status, body } = await fetchJson('https://api.sms.ir/v1/send/bulk', {
    method: 'POST', headers: { 'x-api-key': o.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ lineNumber: Number(o.lineNumber), messageText: o.text, mobiles: [o.mobile] }),
  });
  return body && body.status === 1 ? { ok: true } : { ok: false, error: scrubKey(body && body.message || `HTTP ${status}`, o.apiKey) };
}
export async function smsirCredit(apiKey: string): Promise<{ ok: boolean; credit?: number; error?: string }> {
  const { body } = await fetchJson('https://api.sms.ir/v1/credit', { headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
  return body && body.status === 1 ? { ok: true, credit: body.data } : { ok: false, error: scrubKey(body && body.message || body, apiKey) };
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
  async function getTemplate(key: string) { return (await listTemplates()).find((t) => t.key === key) || null; }
  async function upsertTemplate(key: string, f: { title_fa?: string; body_fa?: string; color?: string; channel_kind?: string; provider_template_id?: string | null; param_names?: string | null; enabled?: boolean }) {
    await sql(
      `INSERT INTO sms_templates (\`key\`, title_fa, body_fa, color, channel_kind, provider_template_id, param_names, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title_fa = COALESCE(VALUES(title_fa), title_fa), body_fa = COALESCE(VALUES(body_fa), body_fa), color = COALESCE(VALUES(color), color)`,
      [key, f.title_fa ?? null, f.body_fa ?? null, f.color ?? 'sky', f.channel_kind || 'bulk', f.provider_template_id ?? null, f.param_names ?? null, f.enabled === false ? 0 : 1]);
    tplCache = null;
  }
  async function deleteTemplate(key: string) { const r: any = await sql('DELETE FROM sms_templates WHERE `key` = ? AND `key` <> \'otp\'', [key]); tplCache = null; return r; }

  /** Free-text SMS through the configured line. */
  async function sendText(mobile: string, text: string): Promise<SmsSendResult> {
    const c = await getConfig(); const apiKey = resolveApiKey(c.apiKeyRef);
    if (c.provider !== 'smsir' || !apiKey || !c.lineNumber) return { ok: false, status: 'not_configured', detail: 'درگاه پیامک تنظیم نشده است (SMS_API_KEY در env و شماره خط در app_settings).' };
    try { const r = await smsirBulk({ apiKey, lineNumber: c.lineNumber, mobile, text }); return r.ok ? { ok: true, status: 'sent' } : { ok: false, status: 'failed', detail: r.error }; }
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
    let t: any = null; try { t = await getTemplate(key); } catch { /* DB down: use fallback */ }
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
  return { getConfig, setConfig, listTemplates, getTemplate, upsertTemplate, deleteTemplate, sendText, sendTemplate, buildVerifyParams, render };
}
