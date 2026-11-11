/**
 * Multi-branch (چندشعبه) support — dormant by design.
 *
 *  - Off unless CRM_MULTI_BRANCH=1 and MySQL is enabled: no DDL, no filtering, /api/branches/config says {enabled:false}.
 *  - On with ONE active branch: tables/columns exist and the admin can manage branches, but nothing is filtered
 *    and the UI switcher stays hidden, so the CRM behaves exactly as before.
 *  - On with 2+ active branches: list responses (students, enrollments, courses, payments, expenses, instructors and,
 *    when the lesson-calendar tables exist, vehicles/bookings) are filtered to the request's branch scope, by-id routes
 *    of other branches answer 404, and new rows are stamped with the active branch.
 *
 * Additive only: crm_branches, crm_user_branches and a nullable branch_id column (+ index) on the scoped tables.
 * A NULL branch_id always counts as the default branch, so a row that was missed by stamping stays visible there.
 * The existing list queries in mysql-socks.ts are not touched: scoping happens on the JSON response, using an
 * id -> branch_id lookup on the same table (one extra indexed query per list request, only with 2+ branches).
 */
import type express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as db from './mysql-socks';

/** Scoped tables and their primary keys (identifiers are only ever taken from this map). */
const TABLES = {
  students: 'student_id',
  enrollments: 'enrollment_id',
  courses: 'course_id',
  payments: 'payment_id',
  expenses: 'expense_id',
  crm_instructors: 'id',
  crm_vehicles: 'id',
  crm_lesson_bookings: 'id',
} as const;
type Table = keyof typeof TABLES;

/** GET list endpoints whose response rows are filtered (full path -> table). */
const LIST_PATHS: Record<string, Table> = {
  '/api/students': 'students',
  '/api/enrollments': 'enrollments',
  '/api/courses': 'courses',
  '/api/payments': 'payments',
  '/api/expenses': 'expenses',
  '/api/instructor-pay/instructors': 'crm_instructors',
  '/api/lessons/vehicles': 'crm_vehicles',
  '/api/lessons/bookings': 'crm_lesson_bookings',
};
/** By-id routes guarded against other branches (any method, sub-paths included). */
const GUARDS: { re: RegExp; table: Table }[] = [
  { re: /^\/api\/students\/(\d+)(?:\/|$)/, table: 'students' },
  { re: /^\/api\/enrollments\/(\d+)(?:\/|$)/, table: 'enrollments' },
  { re: /^\/api\/courses\/(\d+)(?:\/|$)/, table: 'courses' },
  { re: /^\/api\/instructor-pay\/instructors\/(\d+)(?:\/|$)/, table: 'crm_instructors' },
  { re: /^\/api\/lessons\/vehicles\/(\d+)(?:\/|$)/, table: 'crm_vehicles' },
  { re: /^\/api\/lessons\/bookings\/(\d+)(?:\/|$)/, table: 'crm_lesson_bookings' },
];
/** POST endpoints that create one row: stamp it with the active branch. */
const STAMP_PATHS: Record<string, { table: Table; id: (b: any) => unknown }> = {
  '/api/students': { table: 'students', id: (b) => b?.student?.id ?? b?.id },
  '/api/courses': { table: 'courses', id: (b) => b?.id },
  '/api/expenses': { table: 'expenses', id: (b) => b?.id ?? b?.expense?.id },
  '/api/instructor-pay/instructors': { table: 'crm_instructors', id: (b) => b?.instructor?.id ?? b?.id },
  '/api/lessons/vehicles': { table: 'crm_vehicles', id: (b) => b?.vehicle?.id ?? b?.id },
  '/api/lessons/bookings': { table: 'crm_lesson_bookings', id: (b) => b?.booking?.id ?? b?.id },
};
/** Writes after which derived branches (enrollment <- course, payment <- enrollment) are filled in. */
const RECONCILE_RE = /^\/api\/(enrollments|payments|online-payments|registrations\/[^/]+\/approve|trainee-payments)/;

const BRANCH_CACHE_MS = 30_000;
const NOT_ENABLED = { error: 'چندشعبه فعال نیست.' };

type Branch = {
  id: number; code: string; name: string; is_default: boolean; is_active: boolean;
  academy_name: string | null; address: string | null; phone: string | null; sms_sender_line: string | null; manager_name: string | null;
};
type User = { username: string; role: string };

let ready = false;
const existing = new Set<Table>(); // scoped tables that exist and carry branch_id
let cache: { at: number; all: Branch[]; defaultId: number } | null = null;
const userCache = new Map<string, { at: number; ids: number[] }>();
/** The request's single active branch, readable anywhere down the request's async chain (e.g. the SMS sender). */
const requestBranch = new AsyncLocalStorage<{ branchId: number | null }>();
export function currentBranchId(): number | null {
  return requestBranch.getStore()?.branchId ?? null;
}

export function isMultiBranchEnabled(): boolean {
  return process.env.CRM_MULTI_BRANCH === '1' && db.isMysqlEnabled();
}
const live = () => isMultiBranchEnabled() && ready;

const toBranch = (r: any): Branch => ({
  id: Number(r.id), code: String(r.code), name: String(r.name), is_default: Number(r.is_default) === 1, is_active: Number(r.is_active) === 1,
  academy_name: r.academy_name ?? null, address: r.address ?? null, phone: r.phone ?? null,
  sms_sender_line: r.sms_sender_line ?? null, manager_name: r.manager_name ?? null,
});
const invalidate = () => { cache = null; userCache.clear(); };

async function branches(): Promise<{ all: Branch[]; active: Branch[]; defaultId: number; multi: boolean }> {
  if (!cache || Date.now() - cache.at > BRANCH_CACHE_MS) {
    const all = (await db.sql('SELECT * FROM crm_branches ORDER BY is_default DESC, id ASC')).map(toBranch);
    cache = { at: Date.now(), all, defaultId: all.find((b) => b.is_default)?.id || all[0]?.id || 1 };
  }
  const active = cache.all.filter((b) => b.is_active);
  return { all: cache.all, active, defaultId: cache.defaultId, multi: active.length >= 2 };
}

/** Branch ids a user may work in: admin -> every active branch; others -> their active assignments, else the default. */
async function allowedFor(user: User): Promise<number[]> {
  const { active, defaultId } = await branches();
  const activeIds = active.map((b) => b.id);
  if (user.role === 'admin') return activeIds;
  const key = String(user.username || '').toLowerCase();
  let hit = userCache.get(key);
  if (!hit || Date.now() - hit.at > BRANCH_CACHE_MS) {
    const rows = await db.sql('SELECT branch_id FROM crm_user_branches WHERE username = ?', [key]);
    hit = { at: Date.now(), ids: rows.map((r: any) => Number(r.branch_id)) };
    userCache.set(key, hit);
  }
  const ids = hit.ids.filter((id) => activeIds.includes(id));
  return ids.length ? ids : [defaultId];
}

// ---------------------------------------------------------------------------------------------- schema

async function tableExists(t: string) {
  const r = await db.sql('SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1', [t]);
  return r.length > 0;
}
async function columnExists(t: string, c: string) {
  const r = await db.sql('SELECT 1 AS ok FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1', [t, c]);
  return r.length > 0;
}
async function indexExists(t: string, i: string) {
  const r = await db.sql('SELECT 1 AS ok FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [t, i]);
  return r.length > 0;
}

/**
 * Idempotent, additive migration (also in database/migrations/20261028_multi_branch.sql). Runs only with the flag on.
 * Safe to call again after the lesson-calendar tables appear: missing columns are added, NULLs backfilled.
 */
export async function ensureBranchSchema(): Promise<void> {
  ready = false;
  existing.clear();
  if (!isMultiBranchEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_branches (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(40) NOT NULL,
      name VARCHAR(120) NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      academy_name VARCHAR(160) NULL,
      address VARCHAR(400) NULL,
      phone VARCHAR(40) NULL,
      sms_sender_line VARCHAR(30) NULL,
      manager_name VARCHAR(120) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_branch_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_user_branches (
      username VARCHAR(80) NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, branch_id),
      KEY idx_ub_branch (branch_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const def = await db.sql('SELECT id FROM crm_branches WHERE is_default = 1 ORDER BY id LIMIT 1');
    if (!def.length) {
      const any = await db.sql('SELECT id FROM crm_branches ORDER BY id LIMIT 1');
      if (any.length) await db.sqlExec('UPDATE crm_branches SET is_default = 1, is_active = 1 WHERE id = ?', [any[0].id]);
      else await db.sqlExec("INSERT INTO crm_branches (code, name, is_default, is_active) VALUES ('main', 'شعبه مرکزی', 1, 1)");
    }
    invalidate();
    const { defaultId } = await branches();
    for (const t of Object.keys(TABLES) as Table[]) {
      if (!(await tableExists(t))) continue; // e.g. crm_vehicles before the lesson-calendar PR
      if (!(await columnExists(t, 'branch_id'))) await db.sqlExec(`ALTER TABLE ${t} ADD COLUMN branch_id INT UNSIGNED NULL`);
      if (!(await indexExists(t, 'idx_branch_id'))) await db.sqlExec(`ALTER TABLE ${t} ADD INDEX idx_branch_id (branch_id)`);
      await db.sqlExec(`UPDATE ${t} SET branch_id = ? WHERE branch_id IS NULL`, [defaultId]);
      existing.add(t);
    }
    ready = true;
    console.log(`[branches] multi-branch on: default branch #${defaultId}, scoped tables: ${[...existing].join(', ')}`);
  } catch (e: any) {
    console.warn('[branches] schema failed, feature stays off:', e?.message || e);
  }
}

/**
 * Scoped tables created after startup (e.g. the lesson-calendar tables when that schema runs later) get their
 * branch_id column here, so start-up order between feature modules does not matter.
 */
let adoptedAt = 0;
async function adoptNewTables(defaultId: number) {
  if (Date.now() - adoptedAt < 60_000) return; // writes call reconcile too; the table check runs at most once a minute
  adoptedAt = Date.now();
  for (const t of Object.keys(TABLES) as Table[]) {
    if (existing.has(t) || !(await tableExists(t))) continue;
    if (!(await columnExists(t, 'branch_id'))) await db.sqlExec(`ALTER TABLE ${t} ADD COLUMN branch_id INT UNSIGNED NULL`);
    if (!(await indexExists(t, 'idx_branch_id'))) await db.sqlExec(`ALTER TABLE ${t} ADD INDEX idx_branch_id (branch_id)`);
    existing.add(t);
    console.log(`[branches] adopted table ${t} (default branch #${defaultId})`);
  }
}

/** Fills derived branches: enrollment <- its course, payment <- its enrollment, anything left -> default. */
export async function reconcileBranches(): Promise<void> {
  if (!live()) return;
  const { defaultId } = await branches();
  await adoptNewTables(defaultId);
  if (existing.has('enrollments') && existing.has('courses')) {
    await db.sqlExec(
      `UPDATE enrollments e JOIN courses c ON c.course_id = e.course_id
       SET e.branch_id = COALESCE(c.branch_id, ?) WHERE e.branch_id IS NULL`, [defaultId]);
  }
  if (existing.has('payments') && existing.has('enrollments')) {
    await db.sqlExec(
      `UPDATE payments p JOIN enrollments e ON e.enrollment_id = p.enrollment_id
       SET p.branch_id = e.branch_id WHERE p.branch_id IS NULL AND e.branch_id IS NOT NULL`);
  }
  for (const t of existing) await db.sqlExec(`UPDATE ${t} SET branch_id = ? WHERE branch_id IS NULL`, [defaultId]);
}

let job: NodeJS.Timeout | null = null;
export function startBranchReconcileJob(): void {
  if (!live() || job) return;
  const tick = () => { reconcileBranches().catch((e) => console.warn('[branches] reconcile failed:', e?.message || e)); };
  setTimeout(tick, 30_000).unref?.(); // picks up tables other modules created after ensureBranchSchema
  job = setInterval(tick, 5 * 60_000);
  job.unref?.();
}

// ---------------------------------------------------------------------------------------------- scoping

/** Ids (of `table`) visible in `scope`. Students are also visible in a branch where they have an enrollment. */
async function visibleIds(table: Table, ids: number[], scope: number[], defaultId: number): Promise<Set<number>> {
  const pk = TABLES[table];
  const out = new Set<number>();
  if (!ids.length) return out;
  const rows = await db.sql(`SELECT ${pk} AS id, COALESCE(branch_id, ?) AS b FROM ${table} WHERE ${pk} IN (?)`, [defaultId, ids]);
  for (const r of rows) if (scope.includes(Number(r.b))) out.add(Number(r.id));
  if (table === 'students' && existing.has('enrollments')) {
    const viaEnr = await db.sql(
      'SELECT DISTINCT student_id AS id FROM enrollments WHERE student_id IN (?) AND COALESCE(branch_id, ?) IN (?)', [ids, defaultId, scope]);
    for (const r of viaEnr) out.add(Number(r.id));
  }
  return out;
}

async function filterRows(table: Table, rows: any[], scope: number[], defaultId: number) {
  const ids = [...new Set(rows.map((r) => Number(r?.id)).filter((n) => Number.isInteger(n) && n > 0))];
  const ok = await visibleIds(table, ids, scope, defaultId);
  // Rows without a known id (should not happen) are kept only in the default branch.
  return rows.filter((r) => (ok.has(Number(r?.id)) || (!Number(r?.id) && scope.includes(defaultId))));
}

const ARRAY_KEYS = ['rows', 'items', 'bookings', 'vehicles', 'instructors', 'students', 'payments', 'enrollments', 'courses', 'expenses'];

/**
 * Mounted on /api after the auth + role middlewares. Never fails a request because of its own DB errors.
 * Sets req.branchScope (number[] | null = everything) and req.activeBranchId (single branch or null).
 */
export function branchMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!live()) return next();
  const user: User | undefined = (req as any).user;
  if (!user?.username && !user?.role) return next();
  const full = `${req.baseUrl || ''}${req.path}`.replace(/\/+$/, '') || '/';
  run().catch((e) => { console.warn('[branches] scope failed (request not scoped):', e?.message || e); next(); });

  async function run() {
    const { defaultId, multi, active } = await branches();
    const allowed = await allowedFor(user!);
    let scope: number[] | null = null;
    if (multi) {
      const raw = String(req.header('x-branch-id') || '').trim();
      const wanted = /^\d+$/.test(raw) ? Number(raw) : null;
      const isConfig = full === '/api/branches/config';
      if (wanted !== null && !allowed.includes(wanted) && !isConfig) {
        return void res.status(403).json({ error: 'دسترسی به این شعبه ندارید.' });
      }
      if (wanted !== null && allowed.includes(wanted)) scope = [wanted];
      else if (user!.role === 'admin') scope = null;
      else scope = allowed.length >= active.length ? null : allowed;
    }
    (req as any).branchScope = scope;
    (req as any).activeBranchId = scope && scope.length === 1 ? scope[0] : null;
    (req as any).branchAllowed = allowed;
    if (!multi) return void next();
    const proceed = () => requestBranch.run({ branchId: (req as any).activeBranchId }, next);

    // By-id guard.
    if (scope) {
      for (const g of GUARDS) {
        const m = full.match(g.re);
        if (!m || !existing.has(g.table)) continue;
        const id = Number(m[1]);
        const ok = await visibleIds(g.table, [id], scope, defaultId);
        const found = await db.sql(`SELECT 1 AS ok FROM ${g.table} WHERE ${TABLES[g.table]} = ? LIMIT 1`, [id]);
        if (found.length && !ok.has(id)) return void res.status(404).json({ error: 'پیدا نشد' });
        break;
      }
    }

    const listTable = req.method === 'GET' && scope ? LIST_PATHS[full] : undefined;
    const stamp = req.method === 'POST' ? STAMP_PATHS[full] : undefined;
    const reconcile = req.method !== 'GET' && RECONCILE_RE.test(full);
    if ((listTable && existing.has(listTable)) || (stamp && existing.has(stamp.table)) || reconcile) {
      const original = res.json.bind(res);
      let done = false;
      res.json = ((body: any) => {
        if (done) return original(body);
        done = true;
        post(body).then((b) => original(b)).catch((e) => { console.warn('[branches] post-process failed:', e?.message || e); original(body); });
        return res;
      }) as any;

      const post = async (body: any) => {
        if (res.statusCode >= 400) return body;
        if (listTable && scope) {
          if (Array.isArray(body)) return filterRows(listTable, body, scope, defaultId);
          if (body && typeof body === 'object') {
            const key = ARRAY_KEYS.find((k) => Array.isArray(body[k]));
            if (key) return { ...body, [key]: await filterRows(listTable, body[key], scope, defaultId) };
          }
          return body;
        }
        if (stamp) {
          const id = Number(stamp.id(body));
          // A reused record (same national code) keeps its branch; only a row this request created is stamped.
          if (Number.isInteger(id) && id > 0 && !body?.already_exists) {
            const fromBody = Number(req.body?.branch_id);
            const target = allowed.includes(fromBody) ? fromBody : ((req as any).activeBranchId || (user!.role === 'admin' ? defaultId : allowed[0]) || defaultId);
            await db.sqlExec(`UPDATE ${stamp.table} SET branch_id = ? WHERE ${TABLES[stamp.table]} = ?`, [target, id]);
          }
        }
        if (reconcile) await reconcileBranches();
        return body;
      };
    }
    proceed();
  }
}

// ---------------------------------------------------------------------------------------------- routes

const str = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };
const jalali = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/-/g, '/');
  const m = s.match(/^(1[34]\d\d)\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : null;
};
const boolish = (v: unknown) => (v === undefined ? undefined : v === true || v === 1 || v === '1' || v === 'true');

export function registerBranches(app: express.Express, deps: {
  isAdmin: (req: express.Request) => boolean;
  currentUser: (req: express.Request) => User | null;
  /** Known staff accounts (env admin, local and MySQL staff) for the assignment screen. */
  listStaff: () => Promise<{ username: string; full_name?: string; role?: string }[]>;
}) {
  const wrap = (admin: boolean, fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response) => {
      if (!live()) return res.status(404).json(NOT_ENABLED);
      if (admin && !deps.isAdmin(req)) return res.status(403).json({ error: 'فقط مدیر سیستم' });
      fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.status ? e.message : 'خطای سرور در بخش شعب' }));
    };
  const bad = (status: number, message: string) => Object.assign(new Error(message), { status });

  app.get('/api/branches/config', (req, res) => {
    if (!live()) return res.json({ enabled: false, multi: false, branches: [], active: 'all', can_see_all: true });
    const user = deps.currentUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    (async () => {
      const { active, multi } = await branches();
      const allowed: number[] = (req as any).branchAllowed || (await allowedFor(user));
      const scope: number[] | null = (req as any).branchScope ?? null;
      res.json({
        enabled: true,
        multi,
        branches: active.filter((b) => allowed.includes(b.id)).map((b) => ({ id: b.id, name: b.name, code: b.code, is_default: b.is_default })),
        active: scope && scope.length === 1 ? scope[0] : 'all',
        can_see_all: user.role === 'admin' || allowed.length >= active.length,
      });
    })().catch(() => res.status(500).json({ error: 'خطا در خواندن تنظیمات شعب' }));
  });

  app.get('/api/branches/active-settings', wrap(false, async (req, res) => {
    const { all, defaultId } = await branches();
    const id = (req as any).activeBranchId || defaultId;
    const b = all.find((x) => x.id === id) || all.find((x) => x.id === defaultId);
    if (!b) throw bad(404, 'شعبه پیدا نشد');
    res.json({ branch_id: b.id, name: b.name, academy_name: b.academy_name, address: b.address, phone: b.phone, sms_sender_line: b.sms_sender_line, manager_name: b.manager_name });
  }));

  app.get('/api/branches', wrap(true, async (_req, res) => {
    const { all, defaultId } = await branches();
    const count = async (t: Table) => {
      if (!existing.has(t)) return new Map<number, number>();
      const rows = await db.sql(`SELECT COALESCE(branch_id, ?) AS b, COUNT(*) AS n FROM ${t} GROUP BY b`, [defaultId]);
      return new Map(rows.map((r: any) => [Number(r.b), Number(r.n)]));
    };
    const [st, en] = await Promise.all([count('students'), count('enrollments')]);
    const us = new Map((await db.sql('SELECT branch_id AS b, COUNT(*) AS n FROM crm_user_branches GROUP BY branch_id')).map((r: any) => [Number(r.b), Number(r.n)]));
    res.json({ branches: all.map((b) => ({ ...b, students: st.get(b.id) || 0, enrollments: en.get(b.id) || 0, users: us.get(b.id) || 0 })) });
  }));

  const readBody = (b: any, partial: boolean) => {
    const out: Record<string, any> = {};
    if (b?.code !== undefined || !partial) {
      const code = String(b?.code ?? '').trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,40}$/.test(code)) throw bad(400, 'کد شعبه باید ۲ تا ۴۰ حرف لاتین کوچک، عدد، - یا _ باشد.');
      out.code = code;
    }
    if (b?.name !== undefined || !partial) {
      const name = str(b?.name, 120);
      if (!name) throw bad(400, 'نام شعبه الزامی است.');
      out.name = name;
    }
    const limits: Record<string, number> = { academy_name: 160, address: 400, phone: 40, sms_sender_line: 30, manager_name: 120 };
    for (const [k, max] of Object.entries(limits)) if (b?.[k] !== undefined) out[k] = str(b[k], max);
    if (out.sms_sender_line && !/^\d{4,20}$/.test(String(out.sms_sender_line).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))))) {
      throw bad(400, 'شماره خط پیامک فقط عدد است.');
    }
    if (out.sms_sender_line) out.sms_sender_line = String(out.sms_sender_line).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const act = boolish(b?.is_active);
    if (act !== undefined) out.is_active = act ? 1 : 0;
    return out;
  };

  app.post('/api/branches', wrap(true, async (req, res) => {
    const data = readBody(req.body, false);
    if ((await db.sql('SELECT id FROM crm_branches WHERE code = ? LIMIT 1', [data.code])).length) throw bad(409, 'این کد شعبه قبلاً ثبت شده است.');
    const cols = Object.keys(data);
    const r = await db.sqlExec(`INSERT INTO crm_branches (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => data[c]));
    invalidate();
    const { all } = await branches();
    res.json({ branch: all.find((b) => b.id === r.insertId) });
  }));

  app.put('/api/branches/:id', wrap(true, async (req, res) => {
    const id = Number(req.params.id);
    const { all } = await branches();
    const cur = all.find((b) => b.id === id);
    if (!cur) throw bad(404, 'شعبه پیدا نشد');
    const data = readBody(req.body, true);
    if (cur.is_default && data.is_active === 0) throw bad(400, 'شعبه پیش‌فرض را نمی‌توان غیرفعال کرد.');
    if (data.code && (await db.sql('SELECT id FROM crm_branches WHERE code = ? AND id <> ? LIMIT 1', [data.code, id])).length) throw bad(409, 'این کد شعبه قبلاً ثبت شده است.');
    const cols = Object.keys(data);
    if (cols.length) await db.sqlExec(`UPDATE crm_branches SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => data[c]), id]);
    invalidate();
    res.json({ branch: (await branches()).all.find((b) => b.id === id) });
  }));

  app.post('/api/branches/:id/default', wrap(true, async (req, res) => {
    const id = Number(req.params.id);
    const { all } = await branches();
    const b = all.find((x) => x.id === id);
    if (!b) throw bad(404, 'شعبه پیدا نشد');
    if (!b.is_active) throw bad(400, 'شعبه غیرفعال نمی‌تواند پیش‌فرض باشد.');
    // One statement, so there is never zero or two defaults.
    await db.sqlExec('UPDATE crm_branches SET is_default = IF(id = ?, 1, 0)', [id]);
    invalidate();
    res.json({ success: true });
  }));

  app.get('/api/branches/users', wrap(true, async (_req, res) => {
    const rows = await db.sql('SELECT username, branch_id FROM crm_user_branches ORDER BY username');
    const map = new Map<string, { username: string; full_name?: string; role?: string; branch_ids: number[] }>();
    let staff: { username: string; full_name?: string; role?: string }[] = [];
    try { staff = await deps.listStaff(); } catch { /* list is optional */ }
    for (const s of staff) {
      const k = String(s.username || '').toLowerCase();
      if (k) map.set(k, { username: k, full_name: s.full_name, role: s.role, branch_ids: [] });
    }
    for (const r of rows) {
      const k = String(r.username);
      if (!map.has(k)) map.set(k, { username: k, branch_ids: [] });
      map.get(k)!.branch_ids.push(Number(r.branch_id));
    }
    res.json({ users: [...map.values()] });
  }));

  app.put('/api/branches/users/:username', wrap(true, async (req, res) => {
    const username = String(req.params.username || '').trim().toLowerCase();
    if (!/^[\w.@-]{1,80}$/.test(username)) throw bad(400, 'نام کاربری نامعتبر است.');
    const raw = req.body?.branch_ids;
    if (!Array.isArray(raw)) throw bad(400, 'branch_ids باید آرایه باشد.');
    const ids = [...new Set(raw.map(Number))];
    const { all } = await branches();
    if (ids.some((id) => !all.some((b) => b.id === id))) throw bad(400, 'شناسه شعبه نامعتبر است.');
    await db.sqlExec('DELETE FROM crm_user_branches WHERE username = ?', [username]);
    for (const id of ids) await db.sqlExec('INSERT INTO crm_user_branches (username, branch_id) VALUES (?, ?)', [username, id]);
    invalidate();
    res.json({ username, branch_ids: ids });
  }));

  app.get('/api/branches/report', wrap(true, async (req, res) => {
    const from = req.query.from ? jalali(req.query.from) : null;
    const to = req.query.to ? jalali(req.query.to) : null;
    if ((req.query.from && !from) || (req.query.to && !to)) throw bad(400, 'تاریخ باید مثل 1405/08/01 باشد.');
    const { all, defaultId } = await branches();
    const range = (col: string) => {
      const w: string[] = []; const p: any[] = [];
      if (from) { w.push(`${col} >= ?`); p.push(from); }
      if (to) { w.push(`${col} <= ?`); p.push(to); }
      return { where: w.length ? ` AND ${w.join(' AND ')}` : '', params: p };
    };
    const group = async (q: string, params: any[]) =>
      new Map((await db.sql(q, params)).map((r: any) => [Number(r.b), r]));
    const e = range('e.signup_date_jalali');
    const p = range('p.pay_date_jalali');
    const x = range('x.expense_date_jalali');
    const [st, en, pay, exp] = await Promise.all([
      group('SELECT COALESCE(branch_id, ?) AS b, COUNT(*) AS n FROM students GROUP BY b', [defaultId]),
      group(`SELECT COALESCE(e.branch_id, ?) AS b, COUNT(*) AS n, SUM(e.final_price) AS tuition,
                    SUM(GREATEST(e.final_price - COALESCE(v.amount_paid_from_payments, 0), 0)) AS remaining
             FROM enrollments e LEFT JOIN v_enrollment_balances v ON v.enrollment_id = e.enrollment_id
             WHERE 1 = 1${e.where} GROUP BY b`, [defaultId, ...e.params]),
      group(`SELECT COALESCE(p.branch_id, ?) AS b, SUM(p.amount) AS paid FROM payments p WHERE 1 = 1${p.where} GROUP BY b`, [defaultId, ...p.params]),
      existing.has('expenses')
        ? group(`SELECT COALESCE(x.branch_id, ?) AS b, SUM(x.amount) AS spent FROM expenses x WHERE 1 = 1${x.where} GROUP BY b`, [defaultId, ...x.params])
        : Promise.resolve(new Map()),
    ]);
    const rows = all.map((b) => ({
      branch_id: b.id, name: b.name, is_active: b.is_active,
      students: Number(st.get(b.id)?.n || 0),
      enrollments: Number(en.get(b.id)?.n || 0),
      tuition_total: Math.round(Number(en.get(b.id)?.tuition || 0)),
      paid_total: Math.round(Number(pay.get(b.id)?.paid || 0)),
      expenses_total: Math.round(Number((exp as Map<number, any>).get(b.id)?.spent || 0)),
      remaining_total: Math.round(Number(en.get(b.id)?.remaining || 0)),
    }));
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    res.json({
      from, to, rows,
      totals: { students: sum('students'), enrollments: sum('enrollments'), tuition_total: sum('tuition_total'), paid_total: sum('paid_total'), expenses_total: sum('expenses_total'), remaining_total: sum('remaining_total') },
    });
  }));

  // Anything else under /api/branches while the feature is off.
  app.all('/api/branches/*', (_req, res) => res.status(404).json(live() ? { error: 'پیدا نشد' } : NOT_ENABLED));
}

/**
 * Per-branch SMS sender line for free-text (bulk) SMS. Only when a request works in one branch of a multi-branch
 * setup and that branch has its own line; otherwise null -> the global sms.config line (unchanged behaviour).
 * sms.ir verify templates do not use a sender line, so they are not affected.
 */
export async function branchSmsLine(branchId: number | null | undefined = currentBranchId()): Promise<string | null> {
  if (!live() || !branchId) return null;
  try {
    const { all, multi } = await branches();
    if (!multi) return null;
    return all.find((b) => b.id === branchId && b.is_active)?.sms_sender_line || null;
  } catch { return null; }
}
