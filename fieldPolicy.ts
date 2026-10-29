/**
 * Field-level access (دسترسی ریزدانه به فیلدهای حساس).
 *
 * A policy maps (role, field group) -> edit | view | masked | hidden. It is enforced on the server:
 *  - responses: every JSON body sent under /api is walked and the mapped keys are masked or removed;
 *  - writes: non-editable keys are removed from JSON bodies before the route sees them (POST = create may set a
 *    field with "view" access, PUT/PATCH need "edit"), and each blocked key is audited as blocked_edit;
 *  - files: /StudentFiles is checked by the server against the documents / personal photo groups.
 * The admin always has full access (policy cannot change that). The defaults equal the behaviour before this
 * feature: cashier = edit everything; instructor = name, mobile and personal photo only (the instructor
 * whitelist in server.ts stays in place; the policy can widen it only to the keys listed here).
 * The role "api" is for /api/v1 keys (public-api branch): call applyFieldPolicy(row, 'api') there.
 *
 * Storage: settings.field_policy in db_store.json settings (like debt_sms). Audit: crm_field_access_log (MySQL)
 * or a ring buffer "field_access_log" (last 2000) in db_store.json. Values themselves are never logged.
 */
import type express from 'express';
import * as db from './mysql-socks';

export type Access = 'edit' | 'view' | 'masked' | 'hidden';
export type PolicyRole = 'cashier' | 'instructor' | 'api';
export type FieldGroup = { id: string; label: string; description: string; maskable: boolean; keys: string[] };
export type Policy = Record<PolicyRole, Record<string, Access>>;
export type FieldPolicySettings = { policy: Policy; audit_enabled: boolean };

export const ACCESS_LEVELS: Access[] = ['edit', 'view', 'masked', 'hidden'];
export const POLICY_ROLES: { id: PolicyRole; label: string }[] = [
  { id: 'cashier', label: 'صندوقدار' },
  { id: 'instructor', label: 'مربی' },
  { id: 'api', label: 'کلید API نسخه ۱ (پس از ادغام API عمومی)' },
];

export const FIELD_GROUPS: FieldGroup[] = [
  { id: 'national_code', label: 'کد ملی', description: 'کد ملی کارآموز', maskable: true, keys: ['national_code', 'student_national_code'] },
  { id: 'mobile', label: 'شماره همراه / تلفن', description: 'phone_number، mobile، phone', maskable: true,
    keys: ['phone_number', 'mobile', 'phone', 'student_phone', 'student_mobile', 'father_phone', 'emergency_phone'] },
  { id: 'address', label: 'نشانی', description: 'نشانی و کد پستی', maskable: true, keys: ['address', 'home_address', 'postal_code'] },
  { id: 'personal_details', label: 'نام پدر و تاریخ تولد', description: 'father_name، birth_date_jalali', maskable: true,
    keys: ['father_name', 'birth_date_jalali', 'birth_date'] },
  { id: 'id_documents', label: 'مدارک شناسایی و PDFها', description: 'تصویر کارت ملی، PDF رسید/کارت/قرارداد ثبت‌نام', maskable: false,
    keys: ['id_card_photo_url', 'national_card_path', 'idcard_pdf_path', 'contract_pdf_path', 'receipt_pdf_path'] },
  { id: 'personal_photo', label: 'عکس پرسنلی', description: 'personal_photo_url', maskable: false, keys: ['personal_photo_url', 'personal_photo_path'] },
  { id: 'financial', label: 'مبالغ مالی', description: 'شهریه، پرداختی، بدهی، مبلغ پرداخت/هزینه', maskable: false,
    keys: ['final_price', 'amount_paid', 'total_paid', 'remaining_debt', 'course_fee', 'amount', 'paid', 'balance', 'debt', 'total_debt', 'remaining'] },
];

const KEY_GROUP = new Map<string, string>();
for (const g of FIELD_GROUPS) for (const k of g.keys) KEY_GROUP.set(k, g.id);
export const groupOfKey = (key: string) => KEY_GROUP.get(key);

const all = (a: Access) => Object.fromEntries(FIELD_GROUPS.map((g) => [g.id, a])) as Record<string, Access>;
/** Same as before this feature. */
export const DEFAULT_POLICY: Policy = {
  cashier: all('edit'),
  instructor: { ...all('hidden'), mobile: 'view', personal_photo: 'view' },
  api: { ...all('hidden'), national_code: 'view', mobile: 'view', financial: 'view' },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function normalizePolicy(input: any, base: FieldPolicySettings = { policy: DEFAULT_POLICY, audit_enabled: true }): FieldPolicySettings {
  const p = input && typeof input === 'object' ? input : {};
  const policy = clone(base.policy);
  for (const r of POLICY_ROLES) {
    const row = p.policy?.[r.id];
    if (!row || typeof row !== 'object') continue;
    for (const g of FIELD_GROUPS) {
      const v = row[g.id];
      if (v === undefined) continue;
      if (!ACCESS_LEVELS.includes(v)) throw Object.assign(new Error(`سطح دسترسی نامعتبر برای ${g.label}`), { status: 400 });
      policy[r.id][g.id] = v === 'masked' && !g.maskable ? 'hidden' : v;
    }
    // "api" keys are read/create only; edit means the same as view for them.
  }
  return { policy, audit_enabled: p.audit_enabled === undefined ? base.audit_enabled : !!p.audit_enabled };
}

const digitsEn = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
export function maskValue(group: string, key: string, v: unknown): unknown {
  if (v === null || v === undefined || v === '') return v;
  const s = digitsEn(v).trim();
  switch (group) {
    case 'national_code': return s.length > 3 ? `${'*'.repeat(Math.max(s.length - 3, 3))}${s.slice(-3)}` : '***';
    case 'mobile': return s.length >= 8 ? `${s.slice(0, 4)}***${s.slice(-2)}` : '***';
    case 'address': { const first = String(v).trim().split(/[\s،,-]+/)[0] || ''; return key === 'postal_code' ? '**********' : `${first} ***`; }
    case 'personal_details':
      if (key.startsWith('birth')) return /^\d{4}/.test(s) ? `${s.slice(0, 4)}/**/**` : '***';
      return `${String(v).trim().charAt(0)}***`;
    default: return null;
  }
}

export type ApplyStats = { exposed: Set<string>; masked: Set<string>; hidden: Set<string>; records: number };
/** Returns a copy of `value` with the role's policy applied. Admin => untouched. */
export function applyFieldPolicy<T>(value: T, role: string, policy: Policy, stats?: ApplyStats): T {
  if (role === 'admin') {
    if (stats) collect(value, stats, 0);
    return value;
  }
  const rules = (policy as any)[role] as Record<string, Access> | undefined;
  // Unknown role: hide every sensitive field (fail closed).
  const accessOf = (g: string): Access => (rules ? rules[g] || 'hidden' : 'hidden');
  const walk = (v: any, depth: number): any => {
    if (depth > 12 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v instanceof Date || Buffer.isBuffer(v)) return v;
    const out: any = {};
    let touched = false;
    for (const [k, x] of Object.entries(v)) {
      const g = KEY_GROUP.get(k);
      if (!g || (x !== null && typeof x === 'object')) { out[k] = walk(x, depth + 1); continue; }
      touched = true;
      const a = accessOf(g);
      if (a === 'hidden') { stats?.hidden.add(g); continue; }
      if (a === 'masked') { stats?.masked.add(g); out[k] = maskValue(g, k, x); continue; }
      stats?.exposed.add(g);
      out[k] = x;
    }
    if (touched && stats) stats.records += 1;
    return out;
  };
  return walk(value, 0);
}

function collect(v: any, stats: ApplyStats, depth: number) {
  if (depth > 12 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) collect(x, stats, depth + 1); return; }
  let touched = false;
  for (const [k, x] of Object.entries(v)) {
    const g = KEY_GROUP.get(k);
    if (g && (x === null || typeof x !== 'object')) { touched = true; stats.exposed.add(g); } else collect(x, stats, depth + 1);
  }
  if (touched) stats.records += 1;
}

/** Removes keys the role may not write. Returns the blocked groups. `create` = POST (view is enough). */
export function stripWrites(body: any, role: string, policy: Policy, create: boolean): string[] {
  if (role === 'admin' || !body || typeof body !== 'object' || Array.isArray(body)) return [];
  const rules = (policy as any)[role] as Record<string, Access> | undefined;
  const blocked = new Set<string>();
  const strip = (o: any, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 3) return;
    if (Array.isArray(o)) { for (const x of o) strip(x, depth + 1); return; }
    for (const k of Object.keys(o)) {
      const g = KEY_GROUP.get(k);
      if (!g) { if (o[k] && typeof o[k] === 'object') strip(o[k], depth + 1); continue; }
      const a: Access = rules ? rules[g] || 'hidden' : 'hidden';
      const ok = a === 'edit' || (create && a === 'view');
      if (!ok) { delete o[k]; blocked.add(g); }
    }
  };
  strip(body, 0);
  return [...blocked];
}

export const canEditGroup = (role: string, group: string, policy: Policy) => role === 'admin' || (policy as any)[role]?.[group] === 'edit';
export const accessFor = (role: string, group: string, policy: Policy): Access =>
  role === 'admin' ? 'edit' : ((policy as any)[role]?.[group] as Access) || 'hidden';

export async function ensureFieldPolicySchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_field_access_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NULL,
    role VARCHAR(20) NULL,
    method VARCHAR(8) NOT NULL,
    path VARCHAR(200) NOT NULL,
    fields VARCHAR(300) NOT NULL COMMENT 'comma separated field groups (never values)',
    records INT NOT NULL DEFAULT 0,
    action ENUM('view','blocked_edit','file') NOT NULL DEFAULT 'view',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_fal_created (created_at),
    KEY idx_fal_user (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: sensitive field access audit'`);
}

export type FieldPolicyDeps = {
  session: (req: express.Request) => { username: string; role: string } | null;
  readJsonDb: () => any;
  writeJsonDb: (s: any) => void;
  log: (m: string) => void;
};

type LogEntry = { username: string | null; role: string | null; method: string; path: string; fields: string[]; records: number; action: 'view' | 'blocked_edit' | 'file' };

export function createFieldPolicy(deps: FieldPolicyDeps) {
  let cache: { at: number; value: FieldPolicySettings } | null = null;
  const get = (): FieldPolicySettings => {
    if (cache && Date.now() - cache.at < 5000) return cache.value;
    let value: FieldPolicySettings;
    try { value = normalizePolicy(deps.readJsonDb()?.settings?.field_policy || {}); } catch { value = { policy: clone(DEFAULT_POLICY), audit_enabled: true }; }
    cache = { at: Date.now(), value };
    return value;
  };
  const save = (next: FieldPolicySettings) => {
    const store = deps.readJsonDb();
    store.settings = { ...(store.settings || {}), field_policy: next };
    deps.writeJsonDb(store);
    cache = { at: Date.now(), value: next };
  };

  // Audit: the same user/path/fields/action is written at most once a minute (list pages poll).
  const recent = new Map<string, number>();
  const pending: LogEntry[] = [];
  let flushing = false;
  const flush = async () => {
    if (flushing || !pending.length) return;
    flushing = true;
    const batch = pending.splice(0, pending.length);
    try {
      if (db.isMysqlEnabled()) {
        for (const e of batch) {
          await db.sqlExec('INSERT INTO crm_field_access_log (username, role, method, path, fields, records, action) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [e.username, e.role, e.method, e.path.slice(0, 200), e.fields.join(',').slice(0, 300), e.records, e.action]);
        }
      } else {
        const store = deps.readJsonDb();
        const list = Array.isArray(store.field_access_log) ? store.field_access_log : [];
        let id = list.reduce((m: number, x: any) => Math.max(m, Number(x.id) || 0), 0);
        for (const e of batch) list.push({ id: ++id, ...e, created_at: new Date().toISOString() });
        store.field_access_log = list.slice(-2000);
        deps.writeJsonDb(store);
      }
    } catch (err: any) {
      deps.log(`audit write failed: ${err?.message || err}`);
    } finally {
      flushing = false;
      if (pending.length) setTimeout(() => { void flush(); }, 200);
    }
  };
  const audit = (e: LogEntry) => {
    if (!get().audit_enabled || !e.fields.length) return;
    const path = e.path.replace(/\/\d+(?=\/|$)/g, '/:id');
    const key = `${e.username}|${e.method}|${path}|${e.fields.join(',')}|${e.action}`;
    const now = Date.now();
    if ((recent.get(key) || 0) > now - 60_000) return;
    recent.set(key, now);
    if (recent.size > 5000) for (const [k, t] of recent) if (t < now - 60_000) recent.delete(k);
    pending.push({ ...e, path });
    setTimeout(() => { void flush(); }, 50);
  };

  async function listLog(q: { username?: string; field?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000);
    if (db.isMysqlEnabled()) {
      const where: string[] = []; const params: any[] = [];
      if (q.username) { where.push('username = ?'); params.push(q.username); }
      if (q.field) { where.push('FIND_IN_SET(?, fields)'); params.push(q.field); }
      const rows = await db.sql<any>(`SELECT id, username, role, method, path, fields, records, action, created_at FROM crm_field_access_log
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`, params);
      return rows.map((r: any) => ({ ...r, id: Number(r.id), records: Number(r.records), fields: String(r.fields || '').split(',').filter(Boolean) }));
    }
    const list: any[] = Array.isArray(deps.readJsonDb().field_access_log) ? deps.readJsonDb().field_access_log : [];
    return list.filter((r) => (!q.username || r.username === q.username) && (!q.field || (r.fields || []).includes(q.field)))
      .slice(-limit).reverse();
  }

  return { get, save, audit, listLog };
}

export type FieldPolicyService = ReturnType<typeof createFieldPolicy>;

/**
 * Installs the response filter + write guard on /api and the admin routes. Call before the API routes.
 * `skip` = paths that must never be filtered (auth, public trainee routes, the policy routes themselves).
 */
export function registerFieldPolicy(app: express.Express, deps: FieldPolicyDeps & { skip: (req: express.Request) => boolean }) {
  const svc = createFieldPolicy(deps);

  app.use('/api', (req, res, next) => {
    if (deps.skip(req)) return next();
    const s = deps.session(req);
    if (!s) return next();
    const role = s.role;
    const policy = svc.get().policy;
    const m = req.method.toUpperCase();
    if ((m === 'POST' || m === 'PUT' || m === 'PATCH') && req.body && typeof req.body === 'object') {
      const blocked = stripWrites(req.body, role, policy, m === 'POST');
      if (blocked.length) svc.audit({ username: s.username, role, method: m, path: req.originalUrl.split('?')[0], fields: blocked, records: 1, action: 'blocked_edit' });
    }
    const orig = res.json.bind(res);
    res.json = ((body: any) => {
      if (res.statusCode >= 400) return orig(body);
      const stats: ApplyStats = { exposed: new Set(), masked: new Set(), hidden: new Set(), records: 0 };
      const out = applyFieldPolicy(body, role, policy, stats);
      const seen = [...new Set([...stats.exposed, ...stats.masked])];
      if (seen.length) svc.audit({ username: s.username, role, method: m, path: req.originalUrl.split('?')[0], fields: seen.sort(), records: stats.records, action: 'view' });
      return orig(out);
    }) as any;
    next();
  });

  const admin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const s = deps.session(req);
    if (!s) return res.status(401).json({ error: 'Unauthorized' });
    if (s.role !== 'admin') return res.status(403).json({ error: 'فقط مدیر سیستم' });
    next();
  };
  const view = () => {
    const cur = svc.get();
    return {
      fields: FIELD_GROUPS.map(({ id, label, description, maskable }) => ({ id, label, description, maskable })),
      roles: POLICY_ROLES, policy: cur.policy, defaults: DEFAULT_POLICY, audit_enabled: cur.audit_enabled,
    };
  };
  app.get('/api/settings/field-policy', admin, (_req, res) => { res.json(view()); });
  app.put('/api/settings/field-policy', admin, (req, res) => {
    try {
      svc.save(normalizePolicy(req.body, svc.get()));
      res.json(view());
    } catch (e: any) { res.status(e?.status || 500).json({ error: e?.status ? e.message : 'خطای داخلی سرور' }); }
  });
  app.post('/api/settings/field-policy/reset', admin, (_req, res) => {
    svc.save({ policy: clone(DEFAULT_POLICY), audit_enabled: true });
    res.json(view());
  });
  app.get('/api/settings/field-access-log', admin, async (req, res) => {
    try {
      res.json(await svc.listLog({ username: req.query.username ? String(req.query.username) : undefined, field: req.query.field ? String(req.query.field) : undefined, limit: Number(req.query.limit) || undefined }));
    } catch (e: any) { deps.log(`log read: ${e?.message || e}`); res.status(500).json({ error: 'خطای داخلی سرور' }); }
  });
  return svc;
}
