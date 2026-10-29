/**
 * Public REST API v1 (/api/v1) with API-key auth, per-key rate limits, and the admin routes that manage
 * keys and outbound webhooks (/api/settings/api-keys, /api/settings/webhooks).
 *
 * Additive only: one new table crm_api_keys (+ the webhook tables in webhooks.ts); with MySQL disabled the
 * keys live in db_store.json under "public_api.api_keys". Only sha256(key) is stored; the full key is shown
 * once at creation. The staff-session middlewares in server.ts skip /api/v1 (it carries its own key auth).
 * Reads reuse the server's existing list loaders; writes go through the same core functions as the staff
 * routes (validation, duplicate / overpay checks, webhooks), so the API can never bypass a business rule.
 */
import type express from 'express';
import crypto from 'node:crypto';
import * as db from './mysql-socks';
import type { Webhooks } from './webhooks';

const KEY_PREFIX = 'crm_live_';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SCOPES = ['read', 'write'] as const;
const CACHE_MS = 30_000;
const LAST_USED_MS = 60_000;
const MAX_RATE = 1000;

type KeyRow = {
  id: number; name: string; prefix: string; key_hash: string; scopes: string; rate_limit_per_min: number;
  created_by: string | null; created_at: any; last_used_at: any; revoked_at: any;
};

export type PublicApiDeps = {
  readJsonDb: () => any;
  writeJsonDb: (s: any) => void;
  isAdmin: (req: express.Request) => boolean;
  username: (req: express.Request) => string;
  loadStudents: () => Promise<any[]>;
  loadEnrollments: () => Promise<any[]>;
  loadCourses: () => Promise<any[]>;
  loadPayments: () => Promise<any[]>;
  createStudent: (body: any) => Promise<{ status: number; body: any }>;
  createEnrollment: (body: any) => Promise<{ status: number; body: any }>;
  createPayment: (body: any) => Promise<{ status: number; body: any }>;
  openApiSpec: (req: express.Request) => any;
  docsHtml: (req: express.Request) => string;
  webhooks: Webhooks;
  log: (m: string) => void;
};

export async function ensureApiKeysSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_api_keys (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    prefix CHAR(12) NOT NULL COMMENT 'first 12 chars of the key, shown in the admin list',
    key_hash CHAR(64) NOT NULL COMMENT 'sha256 hex of the full key; the key itself is never stored',
    scopes VARCHAR(255) NOT NULL DEFAULT 'read',
    rate_limit_per_min INT NOT NULL DEFAULT 60,
    created_by VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    UNIQUE KEY uq_api_key_prefix (prefix),
    UNIQUE KEY uq_api_key_hash (key_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: public API keys / کلیدهای API'`);
}

export const hashApiKey = (key: string) => crypto.createHash('sha256').update(key, 'utf8').digest('hex');

/** crm_live_ + 32 base62 chars from crypto.randomInt (no modulo bias). */
export function generateApiKey(): { key: string; prefix: string } {
  let rnd = '';
  for (let i = 0; i < 32; i++) rnd += BASE62[crypto.randomInt(BASE62.length)];
  const key = KEY_PREFIX + rnd;
  return { key, prefix: key.slice(0, 12) };
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const iso = (v: any): string | null => (v === null || v === undefined || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const toEn = (v: unknown) => String(v ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
/** Jalali yyyy/m/d -> zero-padded yyyy/mm/dd so string comparison orders dates; null when invalid. */
const jalaliKey = (v: unknown): string | null => {
  const m = toEn(v).replace(/-/g, '/').match(/^(1[34]\d\d)\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : null;
};

// ── Response shapes (whitelists: nothing personal beyond these, no file paths, no internal fields) ─────────
const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));
export const apiStudent = (s: any) => ({
  id: Number(s.id), first_name: s.first_name ?? '', last_name: s.last_name ?? '', father_name: s.father_name ?? null,
  national_code: s.national_code ?? '', phone_number: s.phone_number ?? '', birth_date_jalali: s.birth_date_jalali ?? null,
  status: s.status ?? null, created_at: iso(s.created_at),
});
export const apiEnrollment = (e: any) => ({
  id: Number(e.id), student_id: Number(e.student_id), course_id: Number(e.course_id), course_number: num(e.course_number),
  signup_date_jalali: e.signup_date_jalali ?? null, final_price: Number(e.final_price || 0),
  ...(e.amount_paid !== undefined ? { amount_paid: Number(e.amount_paid || 0) } : {}),
  ...(e.remaining_debt !== undefined ? { remaining_debt: Number(e.remaining_debt || 0) } : {}),
});
export const apiPayment = (p: any) => ({
  id: Number(p.id), student_id: Number(p.student_id), enrollment_id: num(p.enrollment_id), amount: Number(p.amount || 0),
  pay_date_jalali: p.pay_date_jalali ?? null, pay_method: p.pay_method ?? null, payment_kind: p.payment_kind ?? null,
  description: p.description ?? null,
});
export const apiCourse = (c: any) => ({
  id: Number(c.id), title: c.title ?? '', code: c.code ?? null, price: Number(c.price ?? c.tuition ?? 0),
  duration_days: num(c.duration_days), is_active: c.is_active === undefined ? true : !!Number(c.is_active === true ? 1 : c.is_active),
});

function paging(req: express.Request) {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  return { limit, offset };
}
const page = <T>(rows: T[], req: express.Request) => {
  const { limit, offset } = paging(req);
  return { data: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
};

type AuthedKey = { id: number; name: string; prefix: string; scopes: string[]; rate_limit_per_min: number };

export function registerPublicApi(app: express.Express, deps: PublicApiDeps): void {
  // ── Key store ───────────────────────────────────────────────────────────
  const cache = new Map<string, { row: KeyRow | null; until: number }>(); // by hash
  const lastUsed = new Map<number, number>();
  const buckets = new Map<number, { count: number; resetAt: number }>();

  const jsonKeys = () => {
    const store = deps.readJsonDb();
    store.public_api = store.public_api || {};
    store.public_api.api_keys = Array.isArray(store.public_api.api_keys) ? store.public_api.api_keys : [];
    return { store, keys: store.public_api.api_keys as KeyRow[] };
  };

  async function findByHash(hash: string): Promise<KeyRow | null> {
    const hit = cache.get(hash);
    if (hit && hit.until > Date.now()) return hit.row;
    let row: KeyRow | null;
    if (db.isMysqlEnabled()) row = (await db.sql<KeyRow>('SELECT * FROM crm_api_keys WHERE key_hash = ? LIMIT 1', [hash]))[0] || null;
    else row = jsonKeys().keys.find((k) => k.key_hash === hash) || null;
    cache.set(hash, { row, until: Date.now() + CACHE_MS });
    if (cache.size > 1000) cache.clear();
    return row;
  }

  function touch(id: number) {
    const now = Date.now();
    if (now - (lastUsed.get(id) || 0) < LAST_USED_MS) return;
    lastUsed.set(id, now);
    if (db.isMysqlEnabled()) {
      db.sqlExec('UPDATE crm_api_keys SET last_used_at = NOW() WHERE id = ?', [id]).catch((e) => deps.log(`last_used_at: ${e?.message || e}`));
      return;
    }
    try {
      const { store, keys } = jsonKeys();
      const k = keys.find((x) => Number(x.id) === id);
      if (k) { k.last_used_at = new Date().toISOString(); deps.writeJsonDb(store); }
    } catch (e: any) { deps.log(`last_used_at: ${e?.message || e}`); }
  }

  const extractKey = (req: express.Request): string => {
    const auth = String(req.get('authorization') || '');
    const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
    return (bearer || String(req.get('x-api-key') || '')).trim();
  };

  // ── Public docs (no key) ───────────────────────────────────────────────
  app.get('/api/v1/openapi.json', (req, res) => { res.json(deps.openApiSpec(req)); });
  app.get('/api/v1/docs', (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    res.type('html').send(deps.docsHtml(req));
  });

  // ── Key auth + rate limit + scope for everything else under /api/v1 ─────
  app.use('/api/v1', (req, res, next) => {
    void (async () => {
      const key = extractKey(req);
      if (!key.startsWith(KEY_PREFIX) || key.length !== KEY_PREFIX.length + 32) return res.status(401).json({ error: 'کلید API نامعتبر است' });
      const hash = hashApiKey(key);
      const row = await findByHash(hash);
      // Hash lookup is by exact value; the extra timing-safe compare guards against a cache/DB collation surprise.
      if (!row || row.revoked_at || !crypto.timingSafeEqual(Buffer.from(String(row.key_hash), 'utf8'), Buffer.from(hash, 'utf8'))) {
        return res.status(401).json({ error: 'کلید API نامعتبر است' });
      }
      const limit = Math.min(Math.max(Number(row.rate_limit_per_min) || 60, 1), MAX_RATE);
      const now = Date.now();
      let b = buckets.get(row.id);
      if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + 60_000 }; buckets.set(row.id, b); }
      b.count += 1;
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(limit - b.count, 0)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
      if (b.count > limit) {
        res.setHeader('Retry-After', String(Math.max(Math.ceil((b.resetAt - now) / 1000), 1)));
        return res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است' });
      }
      const scopes = String(row.scopes || '').split(',').map((s) => s.trim()).filter(Boolean);
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (write ? !scopes.includes('write') : !(scopes.includes('read') || scopes.includes('write'))) {
        return res.status(403).json({ error: write ? 'این کلید مجوز نوشتن ندارد' : 'این کلید مجوز خواندن ندارد' });
      }
      touch(Number(row.id));
      (req as any).apiKey = { id: Number(row.id), name: row.name, prefix: row.prefix, scopes, rate_limit_per_min: limit } satisfies AuthedKey;
      next();
    })().catch(next);
  });

  const h = (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => { fn(req, res).catch(next); };
  const send = (res: express.Response, r: { status: number; body: any }, created = false) =>
    res.status(created && r.status === 200 ? 201 : r.status).json(r.body);

  app.get('/api/v1/me', (req, res) => { res.json({ key: (req as any).apiKey }); });

  // Students
  app.get('/api/v1/students', h(async (req, res) => {
    const q = toEn(req.query.q).toLowerCase();
    const status = String(req.query.status ?? '').trim();
    let rows = (await deps.loadStudents()).map(apiStudent);
    if (q) rows = rows.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) || toEn(s.phone_number).includes(q) || toEn(s.national_code).includes(q));
    if (status) rows = rows.filter((s) => String(s.status ?? '') === status);
    res.json(page(rows, req));
  }));
  app.get('/api/v1/students/:id', h(async (req, res) => {
    const id = posInt(req.params.id);
    const s = id ? (await deps.loadStudents()).find((x) => Number(x.id) === id) : null;
    if (!s) return res.status(404).json({ error: 'کارآموز پیدا نشد' });
    const enrollments = (await deps.loadEnrollments()).filter((e) => Number(e.student_id) === id).map(apiEnrollment);
    res.json({ ...apiStudent(s), enrollments });
  }));
  app.post('/api/v1/students', h(async (req, res) => {
    const b = req.body || {};
    // Only plain fields: photo / ID-card paths can never be set through the API.
    const r = await deps.createStudent({
      first_name: b.first_name, last_name: b.last_name, national_code: b.national_code, phone_number: b.phone_number,
      father_name: b.father_name, birth_date_jalali: b.birth_date_jalali, address: b.address,
    });
    if (r.status === 200 && r.body?.student) {
      return res.status(r.body.already_exists ? 200 : 201).json({ student: apiStudent(r.body.student), ...(r.body.already_exists ? { already_exists: true } : {}), warnings: r.body.warnings || [] });
    }
    send(res, r);
  }));

  // Courses
  app.get('/api/v1/courses', h(async (req, res) => {
    let rows = (await deps.loadCourses()).map(apiCourse);
    if (req.query.active === '1') rows = rows.filter((c) => c.is_active);
    if (req.query.active === '0') rows = rows.filter((c) => !c.is_active);
    res.json(page(rows, req));
  }));
  app.get('/api/v1/courses/:id', h(async (req, res) => {
    const id = posInt(req.params.id);
    const c = id ? (await deps.loadCourses()).find((x) => Number(x.id) === id) : null;
    if (!c) return res.status(404).json({ error: 'دوره پیدا نشد' });
    res.json(apiCourse(c));
  }));

  // Enrollments
  app.get('/api/v1/enrollments', h(async (req, res) => {
    const sid = posInt(req.query.student_id); const cid = posInt(req.query.course_id);
    let rows = await deps.loadEnrollments();
    if (sid) rows = rows.filter((e) => Number(e.student_id) === sid);
    if (cid) rows = rows.filter((e) => Number(e.course_id) === cid);
    res.json(page(rows.map(apiEnrollment), req));
  }));
  app.get('/api/v1/enrollments/:id', h(async (req, res) => {
    const id = posInt(req.params.id);
    const e = id ? (await deps.loadEnrollments()).find((x) => Number(x.id) === id) : null;
    if (!e) return res.status(404).json({ error: 'ثبت‌نام پیدا نشد' });
    res.json(apiEnrollment(e));
  }));
  app.post('/api/v1/enrollments', h(async (req, res) => {
    const b = req.body || {};
    const r = await deps.createEnrollment({
      student_id: b.student_id, course_id: b.course_id, course_number: b.course_number,
      final_price: b.final_price, signup_date_jalali: b.signup_date_jalali,
    });
    if (r.status === 200 && r.body?.id) return res.status(201).json(apiEnrollment(r.body));
    send(res, r);
  }));

  // Payments
  app.get('/api/v1/payments', h(async (req, res) => {
    const sid = posInt(req.query.student_id); const eid = posInt(req.query.enrollment_id);
    const from = req.query.from ? jalaliKey(req.query.from) : null; const to = req.query.to ? jalaliKey(req.query.to) : null;
    if ((req.query.from && !from) || (req.query.to && !to)) return res.status(400).json({ error: 'تاریخ نامعتبر است (yyyy/mm/dd شمسی)' });
    let rows = await deps.loadPayments();
    if (sid) rows = rows.filter((p) => Number(p.student_id) === sid);
    if (eid) rows = rows.filter((p) => Number(p.enrollment_id) === eid);
    if (from || to) rows = rows.filter((p) => { const d = jalaliKey(p.pay_date_jalali); return !!d && (!from || d >= from) && (!to || d <= to); });
    res.json(page(rows.map(apiPayment), req));
  }));
  app.get('/api/v1/payments/:id', h(async (req, res) => {
    const id = posInt(req.params.id);
    const p = id ? (await deps.loadPayments()).find((x) => Number(x.id) === id) : null;
    if (!p) return res.status(404).json({ error: 'پرداخت پیدا نشد' });
    res.json(apiPayment(p));
  }));
  app.post('/api/v1/payments', h(async (req, res) => {
    const b = req.body || {};
    const r = await deps.createPayment({
      student_id: b.student_id, enrollment_id: b.enrollment_id, amount: b.amount, pay_date_jalali: b.pay_date_jalali,
      pay_method: b.pay_method || 'api', payment_kind: b.payment_kind, description: b.description,
    });
    if (r.status === 200 && r.body?.id) return res.status(201).json({ ...apiPayment(r.body), allocations: Number(r.body.allocations) || 1 });
    send(res, r);
  }));

  app.use('/api/v1', (_req, res) => { res.status(404).json({ error: 'مسیر یافت نشد' }); });
  // JSON errors for /api/v1 (never Express' HTML page, never internal messages on 5xx).
  app.use('/api/v1', (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) deps.log(`v1 error: ${err?.message || err}`);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: status < 500 && err?.message ? err.message : 'خطای داخلی سرور' });
  });

  // ── Admin: API keys ─────────────────────────────────────────────────────
  const admin = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    (deps.isAdmin(req) ? next() : res.status(403).json({ error: 'فقط مدیر سیستم دسترسی دارد' }));
  const adminH = (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response) => { fn(req, res).catch((e: any) => res.status(e?.status || 500).json({ error: e?.status ? e.message : 'خطای داخلی سرور' })); };
  const publicKey = (k: KeyRow) => ({
    id: Number(k.id), name: k.name, prefix: k.prefix, scopes: String(k.scopes || '').split(',').filter(Boolean),
    rate_limit_per_min: Number(k.rate_limit_per_min), created_by: k.created_by ?? null, created_at: iso(k.created_at) || '',
    last_used_at: iso(k.last_used_at), revoked_at: iso(k.revoked_at),
  });

  app.get('/api/settings/api-keys', admin, adminH(async (_req, res) => {
    const rows = db.isMysqlEnabled()
      ? await db.sql<KeyRow>('SELECT id, name, prefix, scopes, rate_limit_per_min, created_by, created_at, last_used_at, revoked_at FROM crm_api_keys ORDER BY id DESC')
      : jsonKeys().keys.slice().sort((a, b) => b.id - a.id);
    res.json(rows.map(publicKey));
  }));

  app.post('/api/settings/api-keys', admin, adminH(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name ?? '').trim().slice(0, 120);
    if (!name) throw httpError(400, 'نام کلید الزامی است.');
    const scopes = (Array.isArray(b.scopes) ? b.scopes : String(b.scopes ?? 'read').split(',')).map((s: unknown) => String(s).trim())
      .filter((s: string) => (SCOPES as readonly string[]).includes(s));
    if (!scopes.length) throw httpError(400, 'حداقل یک دسترسی (خواندن/نوشتن) را انتخاب کنید.');
    const rate = Number(b.rate_limit_per_min ?? 60);
    if (!Number.isInteger(rate) || rate < 1 || rate > MAX_RATE) throw httpError(400, `سقف درخواست باید بین ۱ و ${MAX_RATE} باشد.`);
    const { key, prefix } = generateApiKey();
    const row = { name, prefix, key_hash: hashApiKey(key), scopes: [...new Set(scopes)].join(','), rate_limit_per_min: rate, created_by: deps.username(req) || null };
    let id: number;
    if (db.isMysqlEnabled()) {
      id = (await db.sqlExec('INSERT INTO crm_api_keys (name, prefix, key_hash, scopes, rate_limit_per_min, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [row.name, row.prefix, row.key_hash, row.scopes, row.rate_limit_per_min, row.created_by])).insertId;
    } else {
      const { store, keys } = jsonKeys();
      id = keys.reduce((m, k) => Math.max(m, Number(k.id) || 0), 0) + 1;
      keys.push({ id, ...row, created_at: new Date().toISOString(), last_used_at: null, revoked_at: null });
      deps.writeJsonDb(store);
    }
    cache.clear();
    deps.log(`API key #${id} (${prefix}…) created by ${row.created_by || '?'}`);
    res.json({ id, key, prefix });
  }));

  app.post('/api/settings/api-keys/:id/revoke', admin, adminH(async (req, res) => {
    const id = posInt(req.params.id);
    if (!id) throw httpError(400, 'شناسه نامعتبر است.');
    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec('UPDATE crm_api_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ?', [id]);
      if (!r.affectedRows) throw httpError(404, 'کلید پیدا نشد.');
    } else {
      const { store, keys } = jsonKeys();
      const k = keys.find((x) => Number(x.id) === id);
      if (!k) throw httpError(404, 'کلید پیدا نشد.');
      k.revoked_at = k.revoked_at || new Date().toISOString();
      deps.writeJsonDb(store);
    }
    cache.clear(); // revocation is effective immediately
    buckets.delete(id);
    res.json({ ok: true });
  }));

  // ── Admin: webhooks ─────────────────────────────────────────────────────
  app.get('/api/settings/webhooks', admin, adminH(async (_req, res) => { res.json(await deps.webhooks.listSubscriptions()); }));
  app.get('/api/settings/webhooks/deliveries', admin, adminH(async (req, res) => {
    res.json(await deps.webhooks.listDeliveries({ subscriptionId: posInt(req.query.subscription_id) || undefined, limit: Number(req.query.limit) || 50 }));
  }));
  app.post('/api/settings/webhooks', admin, adminH(async (req, res) => {
    const b = req.body || {};
    res.json(await deps.webhooks.createSubscription({ url: b.url, events: b.events, description: b.description, createdBy: deps.username(req) }));
  }));
  app.post('/api/settings/webhooks/:id/active', admin, adminH(async (req, res) => {
    const id = posInt(req.params.id); if (!id) throw httpError(400, 'شناسه نامعتبر است.');
    await deps.webhooks.setActive(id, req.body?.active === true || req.body?.active === 1 || req.body?.active === '1');
    res.json({ ok: true });
  }));
  app.post('/api/settings/webhooks/:id/rotate-secret', admin, adminH(async (req, res) => {
    const id = posInt(req.params.id); if (!id) throw httpError(400, 'شناسه نامعتبر است.');
    res.json({ secret: await deps.webhooks.rotateSecret(id) });
  }));
  app.post('/api/settings/webhooks/:id/test', admin, adminH(async (req, res) => {
    const id = posInt(req.params.id); if (!id) throw httpError(400, 'شناسه نامعتبر است.');
    res.json(await deps.webhooks.sendTest(id));
  }));
  app.delete('/api/settings/webhooks/:id', admin, adminH(async (req, res) => {
    const id = posInt(req.params.id); if (!id) throw httpError(400, 'شناسه نامعتبر است.');
    await deps.webhooks.deleteSubscription(id);
    res.json({ ok: true });
  }));
}
