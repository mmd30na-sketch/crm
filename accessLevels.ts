/**
 * User levels («سطوح کاربری») with a per-level permission matrix, enforced server-side.
 *
 * Model: every level has a base role (admin | cashier | instructor). The base role keeps the existing coarse
 * rules (canAccessApi in server.ts) and is the MAXIMUM a level can reach; the permission matrix can only take
 * rights away. So a «حسابدار» is usually base=admin with settings/users/... switched off.
 *
 * Storage: JSON store `access_levels` (array). Staff records get `level_id`. Idempotent migration
 * (ensureAccessLevels) seeds three system levels mirroring today's roles and assigns them to staff without a
 * level; the env admin always uses `full_admin`, which cannot be edited or deleted — no lockout is possible.
 */
export type BaseRole = 'admin' | 'cashier' | 'instructor';

export const PERMISSIONS = [
  { key: 'students', label: 'هنرجویان، ثبت‌نام و دوره‌ها' },
  { key: 'payments', label: 'پرداخت‌ها، حسابداری و فاکتورها' },
  { key: 'refunds', label: 'استرداد و ریورس' },
  { key: 'sms', label: 'پیامک، پیام‌رسان و ایمیل' },
  { key: 'leads', label: 'سرنخ‌ها و فروش' },
  { key: 'lessons', label: 'جلسات، کارها و حق‌التدریس' },
  { key: 'hamraz', label: 'دسترسی به هم‌راز' },
  { key: 'payment_tools', label: 'ابزارهای پرداخت هم‌راز' },
  { key: 'settings', label: 'تنظیمات و اتوماسیون' },
  { key: 'users', label: 'کاربران و سطوح دسترسی' },
  { key: 'delete', label: 'حذف رکوردها' },
] as const;
export type PermKey = typeof PERMISSIONS[number]['key'];
export const PERM_KEYS: readonly PermKey[] = PERMISSIONS.map((p) => p.key);

export type AccessLevel = { id: string; name: string; base_role: BaseRole; permissions: Record<PermKey, boolean>; system?: boolean; created_at?: string };

const all = (v: boolean) => Object.fromEntries(PERM_KEYS.map((k) => [k, v])) as Record<PermKey, boolean>;
export const FULL_ADMIN_ID = 'full_admin';
export const SYSTEM_LEVELS: readonly AccessLevel[] = [
  { id: FULL_ADMIN_ID, name: 'مدیر کل', base_role: 'admin', permissions: all(true), system: true },
  // Mirror today's cashier/instructor rights (the base role still applies on top).
  { id: 'cashier', name: 'صندوقدار', base_role: 'cashier', permissions: { ...all(true), settings: false, users: false, refunds: false, payment_tools: false, delete: false }, system: true },
  { id: 'instructor', name: 'مربی', base_role: 'instructor', permissions: { ...all(false), students: true, lessons: true }, system: true },
];
export const defaultLevelFor = (role: string) => (role === 'cashier' ? 'cashier' : role === 'instructor' ? 'instructor' : FULL_ADMIN_ID);

export function listLevels(db: any): AccessLevel[] {
  const stored: AccessLevel[] = Array.isArray(db?.access_levels) ? db.access_levels : [];
  const out = SYSTEM_LEVELS.map((s) => {
    const st = stored.find((l) => l.id === s.id);
    // full_admin is always all-true; the other system levels may be customized but keep their base role.
    return s.id === FULL_ADMIN_ID ? { ...s } : { ...s, ...(st ? { name: st.name || s.name, permissions: normalizePerms(st.permissions, s.permissions) } : {}), base_role: s.base_role, system: true };
  });
  for (const l of stored) if (!SYSTEM_LEVELS.some((s) => s.id === l.id)) out.push({ ...l, permissions: normalizePerms(l.permissions, all(false)), system: false });
  return out;
}

export function normalizePerms(p: any, fallback: Record<PermKey, boolean>): Record<PermKey, boolean> {
  const out = { ...fallback };
  if (p && typeof p === 'object') for (const k of PERM_KEYS) if (typeof p[k] === 'boolean') out[k] = p[k];
  return out;
}

/** Idempotent migration. Returns true when the store changed. */
export function ensureAccessLevels(db: any): boolean {
  let changed = false;
  if (!Array.isArray(db.access_levels)) { db.access_levels = []; changed = true; }
  for (const s of SYSTEM_LEVELS) if (!db.access_levels.some((l: any) => l.id === s.id)) { db.access_levels.push({ ...s }); changed = true; }
  const ids = new Set(db.access_levels.map((l: any) => l.id));
  for (const u of Array.isArray(db.staff_users) ? db.staff_users : []) {
    if (!u.level_id || !ids.has(u.level_id)) { u.level_id = defaultLevelFor(u.role); changed = true; }
  }
  return changed;
}

/** Level for a session: env admin → full_admin; local staff → its level_id; others → default for the role. */
export function levelForSession(db: any, session: any): AccessLevel {
  const levels = listLevels(db);
  const byId = (id: string) => levels.find((l) => l.id === id);
  if (!session) return byId('instructor')!;
  if (session.source === 'env') return byId(FULL_ADMIN_ID)!;
  if (session.source === 'local') {
    const st = (db?.staff_users || []).find((s: any) => s.id === session.user_id);
    const lv = st?.level_id ? byId(st.level_id) : null;
    if (lv) return lv;
  }
  return byId(defaultLevelFor(String(session.role || '')))!;
}

/** The permission keys an /api request needs (path relative to /api). Unknown paths need none. */
export function permissionsForRequest(method: string, rawPath: string): PermKey[] {
  const p = rawPath.toLowerCase();
  const write = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const need = new Set<PermKey>();
  const starts = (...xs: string[]) => xs.some((x) => p.startsWith(x));
  if (method === 'DELETE') need.add('delete');
  if (starts('/staff', '/access-levels')) need.add('users');
  else if (starts('/settings/zarinpal', '/settings/hamraz', '/settings/business-owner', '/settings/gateways', '/settings/field-policy', '/settings/field-access-log', '/imports', '/automation')) need.add('settings');
  else if (starts('/settings', '/receipt-settings') && write) need.add('settings');
  else if (p.startsWith('/branches') && write) need.add('settings');
  if (starts('/refunds')) need.add('refunds');
  if (starts('/payments', '/expenses', '/accounting', '/invoices', '/finance-reports', '/online-payments', '/receipt', '/report-templates', '/report-context')) need.add('payments');
  if (starts('/students', '/enrollments', '/registrations', '/ocr', '/course-terms') || (starts('/courses') && write)) need.add('students');
  if (starts('/messenger', '/message-templates', '/campaigns', '/debt-sms', '/email')) need.add('sms');
  if (starts('/leads', '/lead-pipeline', '/activities')) need.add('leads');
  if (starts('/lessons', '/instructor-pay')) need.add('lessons');
  if (starts('/copilot')) need.add('hamraz');
  return [...need];
}

export const missingPermissions = (level: AccessLevel, need: PermKey[]) => need.filter((k) => !level.permissions[k]);

/** Copilot tool → permission (beyond `hamraz`). */
export function permissionForCopilotTool(name: string): PermKey | null {
  if (name === 'zarinpal_refund' || name === 'zarinpal_reverse') return 'refunds';
  if (name.startsWith('zarinpal_')) return 'payment_tools';
  if (/^sms_|^send_(telegram|rubika)_message$/.test(name)) return 'sms';
  return null;
}

const SLUG = /^[a-z][a-z0-9_-]{1,31}$/;
/** Validates a create/update body. Returns the stored shape. */
export function validateLevelInput(b: any, existing?: AccessLevel): AccessLevel {
  const bad = (m: string) => Object.assign(new Error(m), { status: 400 });
  const name = String(b?.name ?? existing?.name ?? '').trim().slice(0, 40);
  if (!name) throw bad('نام سطح الزامی است.');
  const id = existing ? existing.id : String(b?.id || '').trim().toLowerCase();
  if (!existing && !SLUG.test(id)) throw bad('شناسه سطح باید ۲ تا ۳۲ کاراکتر لاتین کوچک باشد (مثل accountant).');
  const base = existing?.system ? existing.base_role : String(b?.base_role ?? existing?.base_role ?? 'cashier');
  if (!['admin', 'cashier', 'instructor'].includes(base)) throw bad('نقش پایه نامعتبر است.');
  return { id, name, base_role: base as BaseRole, permissions: normalizePerms(b?.permissions, existing?.permissions || all(false)), system: !!existing?.system, created_at: existing?.created_at || new Date().toISOString() };
}
