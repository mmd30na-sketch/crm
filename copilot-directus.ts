/**
 * Ham-Raz copilot backend over a Directus MCP server.
 * COPILOT_DB_BACKEND=directus enables it. COPILOT_DIRECTUS_URL / COPILOT_DIRECTUS_TOKEN configure it.
 * Only three tools are exposed to the model (schema / read items / write items); writes are limited
 * to an explicit collection allowlist and money/ledger tables are read-only. The module stays free of
 * the DB layer: the caller supplies the audit callbacks (the write audit is persisted by the server).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const TIMEOUT_MS = 8000;
const TOOLS_TTL_MS = 5 * 60 * 1000;
const DOWN_BACKOFF_MS = 60 * 1000;

const DOWN_MESSAGE = 'سرویس Directus در دسترس نیست؛ دوباره تلاش کنید.';
const WRITE_ACTION_DENIED = 'عملیات مجاز فقط ایجاد (create) یا به‌روزرسانی (update) است؛ حذف و سایر عملیات‌ها از طریق دستیار ممنوع است.';
const COLLECTION_DENIED = 'دسترسی به این جدول مجاز نیست.';
const MONEY_WRITE_DENIED = 'نوشتن در جدول‌های مالی و دفتر کل ممنوع است. بازگشت وجه و اصلاح تراکنش‌ها نیازمند تأیید ادمین است و ردیف‌های دفتر فقط پس از تأیید درگاه پرداخت ثبت می‌شوند.';
const WRITE_NOT_ALLOWED = 'این جدول در فهرست مجاز برای نوشتن نیست.';

const DIRECTUS_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'admin.kermanshahcart.ir']);

/** Collections that may be created/updated (never deleted). */
export const WRITE_COLLECTIONS = new Set([
  'students', 'leads', 'lead_followups', 'lead_sources', 'enrollments', 'registrations', 'courses',
  'messenger_threads', 'messenger_messages', 'messenger_outbox', 'sms_reports', 'sms_credit_log',
  'sms_templates', 'enrollment_documents', 'site_errors', 'crm_tasks', 'crm_activities',
  'crm_course_terms', 'crm_campaigns', 'crm_campaign_recipients', 'crm_lead_stages', 'crm_lead_stage_history',
]);

/** Money/ledger collections: readable, but writes are forbidden (refunds/reversals need an admin). */
export const MONEY_COLLECTIONS = new Set([
  'payments', 'payment_installments', 'site_registration_payments', 'expenses', 'expense_categories',
  'bank_accounts', 'instructor_settlements', 'crm_instructor_settlements', 'enrollment_settle_log',
  'crm_online_payments', 'crm_refunds', 'crm_invoices', 'crm_invoice_items', 'crm_invoice_counters',
  'crm_debt_links', 'crm_installments', 'crm_installment_links', 'tblpeyment', 'tblexpenses',
  'site_checks', 'site_accounts',
]);

/** Never readable or writable through the copilot. */
export const DENY_COLLECTIONS = new Set([
  'staff_users', 'otp_codes', 'tblotp', 'app_settings', 'academy_settings', 'crm_api_keys',
  'report_templates', 'id_renumber_map', 'crm_copilot_queries', 'crm_webhook_subscriptions',
  'crm_webhook_deliveries', 'crm_portal_entries',
]);

/** Field names removed from every payload/result; collection-specific ones are added on top. */
export const SECRET_FIELDS = [
  'authority', 'password', 'password_hash', 'token', 'secret', 'key_hash', 'tfa_secret', 'auth_data', 'webhook_secret',
];
export const SECRET_FIELDS_BY_COLLECTION: Record<string, string[]> = {
  enrollment_documents: ['template_key'],
  report_templates: ['template_key'],
};

/** Mixed-case Directus collection names (live data model). Lookups stay case-insensitive. */
const COLLECTION_CANONICAL: Record<string, string> = {
  tblpeyment: 'TblPeyment', tblexpenses: 'Tblexpenses', tblcourse: 'TblCourse',
  tblenroll: 'TblEnroll', tblstudents: 'TblStudents', tblotp: 'TblOTP',
};

/** Preserve the live Directus collection spelling when calling MCP. */
export function canonicalCollection(name: string): string {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  return COLLECTION_CANONICAL[raw.toLowerCase()] || raw;
}

export function isMoneyCollection(collection: string): boolean {
  const c = String(collection || '').trim().toLowerCase();
  return MONEY_COLLECTIONS.has(c) || c.startsWith('v_');
}

export function secretFieldsFor(collection: string): string[] {
  const c = String(collection || '').trim().toLowerCase();
  const fields = new Set(SECRET_FIELDS.map((f) => f.toLowerCase()));
  for (const f of SECRET_FIELDS_BY_COLLECTION[c] || []) fields.add(f.toLowerCase());
  return [...fields];
}

/** Deep-copy a payload/result with secret fields removed (arrays and nested objects included). */
export function sanitizeItemFields(collection: string, item: any): any {
  const fields = new Set(secretFieldsFor(collection));
  return stripFields(item, fields);
}

function stripFields(value: any, fields: Set<string>): any {
  if (Array.isArray(value)) return value.map((v) => stripFields(v, fields));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (fields.has(k.toLowerCase())) continue;
      out[k] = stripFields(v, fields);
    }
    return out;
  }
  return value;
}

/** Normalize the model arguments for the Directus items tool. */
export function parseItemsArgs(args: any): { collection: string; action: string; data: any; id: any; ids: any; query: any; fields: any; limit: any } {
  const a = args && typeof args === 'object' ? args : {};
  return {
    collection: String(a.collection ?? '').trim().toLowerCase(),
    action: String(a.action ?? 'read').trim().toLowerCase(),
    data: a.data ?? null,
    id: a.id ?? null,
    ids: a.ids ?? null,
    query: a.query ?? null,
    fields: a.fields ?? null,
    limit: a.limit ?? null,
  };
}

/** Throws a Persian error when a write is not allowed. Reads use assertDirectusReadAllowed. */
export function assertDirectusWriteAllowed(collection: string, action: string): void {
  const act = String(action || '').trim().toLowerCase();
  if (act !== 'create' && act !== 'update') throw new Error(WRITE_ACTION_DENIED);
  const c = String(collection || '').trim().toLowerCase();
  if (!c) throw new Error(COLLECTION_DENIED);
  if (DENY_COLLECTIONS.has(c) || c.startsWith('directus_')) throw new Error(COLLECTION_DENIED);
  if (isMoneyCollection(c)) throw new Error(MONEY_WRITE_DENIED);
  if (!WRITE_COLLECTIONS.has(c)) throw new Error(WRITE_NOT_ALLOWED);
}

export function assertDirectusReadAllowed(collection: string): void {
  const c = String(collection || '').trim().toLowerCase();
  if (!c || DENY_COLLECTIONS.has(c) || c.startsWith('directus_')) throw new Error(COLLECTION_DENIED);
}

export function directusSelected(): boolean {
  return String(process.env.COPILOT_DB_BACKEND || 'builtin').trim().toLowerCase() === 'directus';
}

/** SSRF guard: only local Directus or the known admin host may be contacted. */
export function validateDirectusUrl(raw: string): URL {
  const url = new URL(String(raw || ''));
  if (!DIRECTUS_ALLOWED_HOSTS.has(url.hostname)) throw new Error('Directus host is not allowed');
  return url;
}

const DIRECTUS_SCHEMA_TOOL = {
  type: 'function',
  function: {
    name: 'directus_schema',
    description: 'ساختار جدول‌ها و فیلدهای Directus (فقط خواندنی). برای فهمیدن نام جدول‌ها و فیلدهای موجود قبل از خواندن یا نوشتن داده‌ها از این ابزار استفاده کنید.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

const DIRECTUS_READ_TOOL = {
  type: 'function',
  function: {
    name: 'directus_read_items',
    description: 'خواندن رکوردهای یک جدول در Directus (فقط خواندنی). نام جدول را از directus_schema بگیرید. برای نوشتن از directus_write_items استفاده کنید.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'نام جدول (مثل students یا enrollments)' },
        query: { type: 'object', description: 'فیلتر، مرتب‌سازی و گروه‌بندی Directus (اختیاری)' },
        fields: { type: 'array', items: { type: 'string' }, description: 'فیلدهای موردنیاز (اختیاری)' },
        limit: { type: 'integer', description: 'حداکثر تعداد رکورد (اختیاری)' },
        ids: { type: 'array', items: { type: ['string', 'number'] }, description: 'فهرست شناسه‌ها (اختیاری)' },
        id: { type: ['string', 'number'], description: 'شناسه‌ی یک رکورد (اختیاری)' },
      },
      required: ['collection'],
    },
  },
};

const DIRECTUS_WRITE_TOOL = {
  type: 'function',
  function: {
    name: 'directus_write_items',
    description: 'ایجاد یا به‌روزرسانی رکورد در جدول‌های مجاز Directus. حذف مجاز نیست و نوشتن در جدول‌های مالی (payments و ...) ممنوع است.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'نام جدول' },
        action: { type: 'string', enum: ['create', 'update'], description: 'create برای ایجاد، update برای به‌روزرسانی' },
        data: { type: ['object', 'array'], description: 'داده‌ی رکورد یا فهرست رکوردها' },
        id: { type: ['string', 'number'], description: 'شناسه‌ی رکورد برای update (اختیاری)' },
        ids: { type: 'array', items: { type: ['string', 'number'] }, description: 'فهرست شناسه‌ها برای update (اختیاری)' },
        query: { type: 'object', description: 'فیلتر برای update گروهی (اختیاری)' },
      },
      required: ['collection', 'action', 'data'],
    },
  },
};

const DIRECTUS_TOOL_NAMES = new Set(['directus_schema', 'directus_read_items', 'directus_write_items']);

let client: Client | null = null;
let cachedTools: any[] | null = null;
let toolsAt = 0;
let downUntil = 0;

async function connect(): Promise<Client> {
  if (client) return client;
  const url = validateDirectusUrl(process.env.COPILOT_DIRECTUS_URL || 'http://127.0.0.1:8055/mcp');
  const token = String(process.env.COPILOT_DIRECTUS_TOKEN || '').trim();
  if (!token) throw new Error('COPILOT_DIRECTUS_TOKEN is not set');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: 'crm-hamraz', version: '1.0.0' });
  await c.connect(transport, { timeout: TIMEOUT_MS });
  return (client = c);
}

async function reset(): Promise<void> {
  const c = client; client = null; cachedTools = null;
  try { await c?.close(); } catch { /* ignore */ }
}

/** Our three Directus tools in OpenAI function format, or null when Directus is unavailable. */
export async function getDirectusTools(): Promise<any[] | null> {
  if (Date.now() < downUntil) return null;
  if (cachedTools && Date.now() - toolsAt < TOOLS_TTL_MS) return cachedTools;
  try {
    const c = await connect();
    const res = await c.listTools(undefined, { timeout: TIMEOUT_MS });
    const names = new Set((res?.tools || []).map((t: any) => String(t?.name || '')));
    if (!names.has('items')) throw new Error('Directus MCP server does not expose the items tool');
    cachedTools = [DIRECTUS_SCHEMA_TOOL, DIRECTUS_READ_TOOL, DIRECTUS_WRITE_TOOL];
    toolsAt = Date.now();
    return cachedTools;
  } catch (e: any) {
    console.warn('Directus MCP unavailable:', String(e?.message || e).slice(0, 200));
    downUntil = Date.now() + DOWN_BACKOFF_MS;
    await reset();
    return null;
  }
}

export function isDirectusTool(name: string): boolean {
  return DIRECTUS_TOOL_NAMES.has(String(name || '').trim());
}

type Audit = (e: { db: string; sql: string; allowed: boolean; reason: string | null; rows: number | null; ms: number | null }) => Promise<void> | void;
type WriteAudit = (e: {
  username?: string;
  action: 'create' | 'update' | 'delete' | string;
  collection: string;
  entity_id: string | null;
  allowed: boolean;
  reason: string | null;
  status: number | null;
}) => Promise<void> | void;

/** Parse an MCP tool result: failed flag/message plus the sanitized payload. */
export function parseDirectusResult(res: any, collection = ''): { failed: boolean; error: string; rows: number | null; data: any } {
  const text = (Array.isArray(res?.content) ? res.content : [])
    .filter((p: any) => p?.type === 'text')
    .map((p: any) => String(p?.text ?? ''))
    .join('\n');
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  const failed = Boolean(res?.isError) || parsed?.success === false || parsed?.ok === false;
  const error = failed ? String(parsed?.error || parsed?.message || text || 'MCP call failed').slice(0, 500) : '';
  const data = sanitizeItemFields(collection, parsed);
  const rows = Array.isArray(data) ? data.length
    : Array.isArray(data?.data) ? data.data.length
      : Array.isArray(data?.items) ? data.items.length
        : null;
  return { failed, error, rows, data };
}

/** Audit entry for a call that failed in the MCP layer: logged as not allowed, with the error. */
function directusErrorAudit(sql: string, msg: string, ms: number | null) {
  return { db: 'directus', sql, allowed: false, reason: `execution error: ${String(msg).slice(0, 300)}`, rows: null, ms };
}

function auditText(name: string, args: any, collection: string): string {
  let body: any;
  try { body = JSON.stringify(sanitizeItemFields(collection, args)); } catch { body = '[unserializable]'; }
  return `${name}(${String(body).slice(0, 4000)})`;
}

function entityIdFromArgs(p: { id: any; ids: any; data: any }, data?: any): string | null {
  const raw = p.id ?? (Array.isArray(p.ids) && p.ids.length ? p.ids[0] : null)
    ?? (data && !Array.isArray(data) ? data.id : null)
    ?? (p.data && !Array.isArray(p.data) ? p.data.id : null);
  return raw == null || raw === '' ? null : String(raw).slice(0, 64);
}

export async function callDirectusTool(name: string, args: any, auditSql?: Audit, auditWrite?: WriteAudit): Promise<any> {
  const t0 = Date.now();
  const a = args && typeof args === 'object' ? args : {};
  const audit = async (e: { db: string; sql: string; allowed: boolean; reason: string | null; rows: number | null; ms: number | null }) => {
    try { await auditSql?.(e); } catch (err: any) { console.warn('directus audit failed:', String(err?.message || err).slice(0, 200)); }
  };
  const auditW = async (e: { username?: string; action: string; collection: string; entity_id: string | null; allowed: boolean; reason: string | null; status: number | null }) => {
    try { await auditWrite?.(e); } catch (err: any) { console.warn('directus write audit failed:', String(err?.message || err).slice(0, 200)); }
  };

  if (!isDirectusTool(name)) return { error: 'ابزار نامعتبر است.' };

  if (name === 'directus_schema') {
    const sqlText = auditText('schema', {}, '');
    try {
      const c = await connect();
      const res = await c.callTool({ name: 'schema', arguments: {} }, undefined, { timeout: TIMEOUT_MS });
      const out = parseDirectusResult(res);
      await audit({ db: 'directus', sql: sqlText, allowed: !out.failed, reason: out.failed ? out.error : null, rows: out.rows, ms: Date.now() - t0 });
      if (out.failed) return { error: out.error };
      return out.data;
    } catch (e: any) {
      await reset();
      await audit(directusErrorAudit(sqlText, `directus error: ${String(e?.message || e).slice(0, 300)}`, Date.now() - t0));
      return { error: DOWN_MESSAGE };
    }
  }

  const p = parseItemsArgs(a);

  if (name === 'directus_read_items') {
    let deny: string | null = null;
    try { assertDirectusReadAllowed(p.collection); } catch (e: any) { deny = String(e?.message || e); }
    if (deny) {
      await audit({ db: 'directus', sql: auditText('read_items', a, p.collection), allowed: false, reason: deny, rows: null, ms: Date.now() - t0 });
      return { error: deny };
    }
    const mcpArgs: Record<string, any> = { collection: canonicalCollection(p.collection), action: 'read' };
    if (p.query != null) mcpArgs.query = p.query;
    if (p.fields != null) mcpArgs.fields = p.fields;
    if (p.limit != null) mcpArgs.limit = p.limit;
    if (p.ids != null) mcpArgs.ids = p.ids;
    if (p.id != null) mcpArgs.id = p.id;
    const sqlText = auditText('read_items', mcpArgs, p.collection);
    try {
      const c = await connect();
      const res = await c.callTool({ name: 'items', arguments: mcpArgs }, undefined, { timeout: TIMEOUT_MS });
      const out = parseDirectusResult(res, p.collection);
      await audit({ db: 'directus', sql: sqlText, allowed: !out.failed, reason: out.failed ? out.error : null, rows: out.rows, ms: Date.now() - t0 });
      if (out.failed) return { error: out.error };
      return out.data;
    } catch (e: any) {
      await reset();
      await audit(directusErrorAudit(sqlText, `directus error: ${String(e?.message || e).slice(0, 300)}`, Date.now() - t0));
      return { error: DOWN_MESSAGE };
    }
  }

  let deny: string | null = null;
  try { assertDirectusWriteAllowed(p.collection, p.action); } catch (e: any) { deny = String(e?.message || e); }
  if (deny) {
    await auditW({ action: p.action, collection: p.collection, entity_id: entityIdFromArgs(p), allowed: false, reason: deny, status: 403 });
    await audit({ db: 'directus', sql: auditText(`${p.action}_items`, a, p.collection), allowed: false, reason: deny, rows: null, ms: Date.now() - t0 });
    return { error: deny };
  }

  const data = sanitizeItemFields(p.collection, p.data);
  const mcpArgs: Record<string, any> = { collection: canonicalCollection(p.collection), action: p.action, data };
  if (p.id != null) mcpArgs.id = p.id;
  if (p.ids != null) mcpArgs.ids = p.ids;
  if (p.query != null) mcpArgs.query = p.query;
  const sqlText = auditText(`${p.action}_items`, { ...a, data }, p.collection);
  try {
    const c = await connect();
    const res = await c.callTool({ name: 'items', arguments: mcpArgs }, undefined, { timeout: TIMEOUT_MS });
    const out = parseDirectusResult(res, p.collection);
    const ok = !out.failed;
    await auditW({ action: p.action, collection: p.collection, entity_id: entityIdFromArgs(p, data), allowed: ok, reason: ok ? null : out.error, status: ok ? 200 : 500 });
    await audit({ db: 'directus', sql: sqlText, allowed: ok, reason: ok ? null : out.error, rows: out.rows, ms: Date.now() - t0 });
    if (!ok) return { error: out.error };
    return out.data;
  } catch (e: any) {
    await reset();
    const err = `directus error: ${String(e?.message || e).slice(0, 300)}`;
    await auditW({ action: p.action, collection: p.collection, entity_id: entityIdFromArgs(p, data), allowed: false, reason: err, status: 500 });
    await audit(directusErrorAudit(sqlText, err, Date.now() - t0));
    return { error: DOWN_MESSAGE };
  }
}
