/**
 * Outbound webhooks for the public API (/api/v1). Additive only: two new tables
 * (crm_webhook_subscriptions, crm_webhook_deliveries); with MySQL disabled the same data lives in
 * db_store.json under "public_api". Admin-only management routes are registered in publicApi.ts.
 *
 * Every delivery is a POST with a JSON body {id, event, created_at, data} and the headers
 *   X-Ham-Taraz-Event, X-Ham-Taraz-Delivery (event id) and
 *   X-Ham-Taraz-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 * 2xx = delivered. Otherwise retried with backoff 1m, 5m, 30m, 2h, 6h (6 attempts in total), then 'failed'.
 * emit() never throws and never blocks the caller (the staff request that triggered the event).
 */
import crypto from 'node:crypto';
import net from 'node:net';
import * as db from './mysql-socks';

export type WebhookEvent = 'enrollment.created' | 'enrollment.approved' | 'enrollment.rejected' | 'payment.succeeded' | 'student.created';
export const WEBHOOK_EVENTS: WebhookEvent[] = ['enrollment.created', 'enrollment.approved', 'enrollment.rejected', 'payment.succeeded', 'student.created'];

const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const TIMEOUT_MS = 10_000;
const CLAIM_MS = 2 * 60_000; // a claimed delivery is not picked up again by the worker for 2 minutes
const JSON_MAX_DELIVERIES = 500;

export async function ensureWebhooksSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_webhook_subscriptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    url VARCHAR(500) NOT NULL,
    events VARCHAR(500) NOT NULL COMMENT 'comma list or *',
    secret VARCHAR(80) NOT NULL COMMENT 'HMAC signing secret (shown once to the admin)',
    active TINYINT(1) NOT NULL DEFAULT 1,
    description VARCHAR(255) NULL,
    created_by VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_webhook_active (active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: outbound webhook subscriptions / وب‌هوک‌ها'`);
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_webhook_deliveries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    subscription_id INT UNSIGNED NOT NULL,
    event VARCHAR(60) NOT NULL,
    event_id CHAR(36) NOT NULL,
    payload MEDIUMTEXT NOT NULL,
    status ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NULL,
    last_status_code INT NULL,
    last_error VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at DATETIME NULL,
    KEY idx_delivery_due (status, next_attempt_at),
    KEY idx_delivery_sub (subscription_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: webhook delivery log / گزارش ارسال وب‌هوک'`);
}

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

/** Receiver-side check (documented in the API docs, used by the tests). */
export function verifySignature(secret: string, header: string, rawBody: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 || '')) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = signPayload(secret, t, rawBody).split('v1=')[1];
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'));
}

export type WebhookSubscription = {
  id: number; url: string; events: string[]; secret_hint: string; active: boolean;
  description: string | null; created_by: string | null; created_at: string;
};
export type WebhookDelivery = {
  id: number; subscription_id: number; event: string; event_id: string; status: 'pending' | 'success' | 'failed';
  attempts: number; next_attempt_at: string | null; last_status_code: number | null; last_error: string | null;
  created_at: string; delivered_at: string | null;
};
type SubRow = { id: number; url: string; events: string; secret: string; active: number | boolean; description: string | null; created_by: string | null; created_at: any };
type JsonDelivery = WebhookDelivery & { payload: string };

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const iso = (v: any): string | null => (v === null || v === undefined || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
const hint = (secret: string) => `…${String(secret || '').slice(-4)}`;
const newSecret = () => `whsec_${crypto.randomBytes(24).toString('base64url')}`;

function isPrivateIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(h)) return h === '::1' || /^f[cd]/i.test(h) || /^fe80/i.test(h);
  return false;
}

/**
 * https only, no private IP literals. Plain http to localhost is allowed outside production, or when
 * CRM_WEBHOOK_ALLOW_LOCAL=1 (local testing only; never set it on the server).
 */
export function validateWebhookUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  let u: URL;
  try { u = new URL(s); } catch { throw httpError(400, 'آدرس وب‌هوک نامعتبر است.'); }
  if (s.length > 500 || u.username || u.password) throw httpError(400, 'آدرس وب‌هوک نامعتبر است.');
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (local && (process.env.NODE_ENV !== 'production' || process.env.CRM_WEBHOOK_ALLOW_LOCAL === '1')) return u.toString();
  if (u.protocol !== 'https:') throw httpError(400, 'آدرس وب‌هوک باید با https:// شروع شود.');
  if (local || isPrivateIp(u.hostname) || /\.(local|internal|lan)$/i.test(u.hostname)) throw httpError(400, 'آدرس‌های داخلی/خصوصی مجاز نیستند.');
  return u.toString();
}

function parseEvents(raw: unknown): string[] {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((e) => String(e).trim()).filter(Boolean);
  if (!list.length) throw httpError(400, 'حداقل یک رویداد را انتخاب کنید.');
  if (list.includes('*')) return ['*'];
  const bad = list.filter((e) => !(WEBHOOK_EVENTS as string[]).includes(e));
  if (bad.length) throw httpError(400, `رویداد نامعتبر: ${bad.join(', ')}`);
  return [...new Set(list)];
}

export type Webhooks = ReturnType<typeof createWebhooks>;

export function createWebhooks(deps: { readJsonDb: () => any; writeJsonDb: (s: any) => void; log: (m: string) => void }) {
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  const inFlight = new Set<string>(); // JSON mode: "id" being delivered right now

  // ── JSON fallback store ────────────────────────────────────────────────
  const jsonState = () => {
    const store = deps.readJsonDb();
    const pa = (store.public_api = store.public_api || {});
    pa.webhooks = Array.isArray(pa.webhooks) ? pa.webhooks : [];
    pa.deliveries = Array.isArray(pa.deliveries) ? pa.deliveries : [];
    return { store, pa: pa as { webhooks: (SubRow & { events: string })[]; deliveries: JsonDelivery[] } };
  };
  const jsonUpdate = <T>(fn: (pa: { webhooks: any[]; deliveries: JsonDelivery[] }) => T): T => {
    const { store, pa } = jsonState();
    const out = fn(pa);
    if (pa.deliveries.length > JSON_MAX_DELIVERIES) pa.deliveries = pa.deliveries.slice(-JSON_MAX_DELIVERIES);
    deps.writeJsonDb(store);
    return out;
  };
  const nextId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;

  const toPublic = (r: SubRow): WebhookSubscription => ({
    id: Number(r.id), url: r.url, events: String(r.events || '').split(',').filter(Boolean), secret_hint: hint(r.secret),
    active: !!Number(r.active), description: r.description ?? null, created_by: r.created_by ?? null, created_at: iso(r.created_at) || '',
  });

  async function getSub(id: number): Promise<SubRow | null> {
    if (db.isMysqlEnabled()) return (await db.sql<SubRow>('SELECT * FROM crm_webhook_subscriptions WHERE id = ?', [id]))[0] || null;
    return jsonState().pa.webhooks.find((w) => Number(w.id) === id) || null;
  }

  /** One HTTP attempt; never throws. */
  async function post(url: string, secret: string, event: string, eventId: string, payload: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'manual', // a redirect is not followed (could point at an internal host)
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Ham-TarazCRM-Webhooks/1.0',
          'X-Ham-Taraz-Event': event,
          'X-Ham-Taraz-Delivery': eventId,
          'X-Ham-Taraz-Signature': signPayload(secret, Math.floor(Date.now() / 1000), payload),
        },
        body: payload,
      });
      try { await res.arrayBuffer(); } catch { /* drain */ }
      return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, error: e?.name === 'AbortError' ? 'timeout (10s)' : String(e?.cause?.code || e?.message || e).slice(0, 300) };
    } finally {
      clearTimeout(t);
    }
  }

  async function record(id: number, attemptsBefore: number, r: { ok: boolean; status?: number; error?: string }) {
    const attempts = attemptsBefore + 1;
    const failed = !r.ok && attempts >= MAX_ATTEMPTS;
    const next = r.ok || failed ? null : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
    const status = r.ok ? 'success' : failed ? 'failed' : 'pending';
    const err = r.ok ? null : String(r.error || '').slice(0, 500);
    if (db.isMysqlEnabled()) {
      await db.sqlExec(
        `UPDATE crm_webhook_deliveries SET status = ?, attempts = ?, last_status_code = ?, last_error = ?, next_attempt_at = ?,
           delivered_at = IF(? = 'success', NOW(), delivered_at) WHERE id = ?`,
        [status, attempts, r.status ?? null, err, next, status, id],
      );
      return;
    }
    jsonUpdate((pa) => {
      const d = pa.deliveries.find((x) => Number(x.id) === id);
      if (!d) return;
      Object.assign(d, { status, attempts, last_status_code: r.status ?? null, last_error: err, next_attempt_at: next ? next.toISOString() : null });
      if (r.ok) d.delivered_at = new Date().toISOString();
    });
  }

  /** Claims (MySQL: conditional UPDATE) and delivers one pending row. */
  async function attempt(id: number): Promise<void> {
    try {
      let row: { subscription_id: number; event: string; event_id: string; payload: string; attempts: number } | undefined;
      if (db.isMysqlEnabled()) {
        const claim = await db.sqlExec(
          `UPDATE crm_webhook_deliveries SET next_attempt_at = ? WHERE id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())`,
          [new Date(Date.now() + CLAIM_MS), id],
        );
        if (!claim.affectedRows) return;
        row = (await db.sql<any>('SELECT subscription_id, event, event_id, payload, attempts FROM crm_webhook_deliveries WHERE id = ?', [id]))[0];
      } else {
        if (inFlight.has(String(id))) return;
        row = jsonState().pa.deliveries.find((d) => Number(d.id) === id && d.status === 'pending');
        if (row) inFlight.add(String(id));
      }
      if (!row) return;
      try {
        const sub = await getSub(Number(row.subscription_id));
        if (!sub) { await record(id, MAX_ATTEMPTS, { ok: false, error: 'subscription deleted' }); return; }
        if (!Number(sub.active)) { await record(id, MAX_ATTEMPTS, { ok: false, error: 'subscription disabled' }); return; }
        const r = await post(sub.url, sub.secret, row.event, row.event_id, row.payload);
        await record(id, Number(row.attempts) || 0, r);
        if (!r.ok) deps.log(`delivery ${id} (${row.event}) attempt ${(Number(row.attempts) || 0) + 1} failed: ${r.error}`);
      } finally {
        inFlight.delete(String(id));
      }
    } catch (e: any) {
      deps.log(`delivery ${id} error: ${e?.message || e}`);
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      let ids: number[];
      if (db.isMysqlEnabled()) {
        ids = (await db.sql<{ id: number }>(
          `SELECT id FROM crm_webhook_deliveries WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) ORDER BY id LIMIT 20`,
        )).map((r) => Number(r.id));
      } else {
        const now = new Date().toISOString();
        ids = jsonState().pa.deliveries.filter((d) => d.status === 'pending' && (!d.next_attempt_at || d.next_attempt_at <= now)).slice(0, 20).map((d) => Number(d.id));
      }
      for (const id of ids) await attempt(id);
    } catch (e: any) {
      deps.log(`worker error: ${e?.message || e}`);
    } finally {
      ticking = false;
    }
  }

  async function enqueue(event: WebhookEvent, data: unknown): Promise<number[]> {
    const eventId = crypto.randomUUID();
    const payload = JSON.stringify({ id: eventId, event, created_at: new Date().toISOString(), data });
    if (db.isMysqlEnabled()) {
      const subs = await db.sql<{ id: number }>(
        `SELECT id FROM crm_webhook_subscriptions WHERE active = 1 AND (events = '*' OR FIND_IN_SET(?, events))`, [event],
      );
      const ids: number[] = [];
      for (const s of subs) {
        const r = await db.sqlExec(
          'INSERT INTO crm_webhook_deliveries (subscription_id, event, event_id, payload, status, attempts, next_attempt_at) VALUES (?, ?, ?, ?, \'pending\', 0, NULL)',
          [s.id, event, eventId, payload],
        );
        ids.push(r.insertId);
      }
      return ids;
    }
    return jsonUpdate((pa) => {
      const subs = pa.webhooks.filter((w) => Number(w.active) && (w.events === '*' || String(w.events).split(',').includes(event)));
      const ids: number[] = [];
      for (const s of subs) {
        const id = nextId(pa.deliveries);
        pa.deliveries.push({
          id, subscription_id: Number(s.id), event, event_id: eventId, payload, status: 'pending', attempts: 0,
          next_attempt_at: null, last_status_code: null, last_error: null, created_at: new Date().toISOString(), delivered_at: null,
        });
        ids.push(id);
      }
      return ids;
    });
  }

  return {
    events: WEBHOOK_EVENTS,

    async listSubscriptions(): Promise<WebhookSubscription[]> {
      if (db.isMysqlEnabled()) return (await db.sql<SubRow>('SELECT * FROM crm_webhook_subscriptions ORDER BY id DESC')).map(toPublic);
      return jsonState().pa.webhooks.slice().sort((a, b) => b.id - a.id).map(toPublic);
    },

    async createSubscription(input: { url: unknown; events: unknown; description?: unknown; createdBy?: string }): Promise<{ id: number; secret: string }> {
      const url = validateWebhookUrl(input.url);
      const events = parseEvents(input.events).join(',');
      const description = String(input.description ?? '').trim().slice(0, 255) || null;
      const secret = newSecret();
      if (db.isMysqlEnabled()) {
        const r = await db.sqlExec(
          'INSERT INTO crm_webhook_subscriptions (url, events, secret, active, description, created_by) VALUES (?, ?, ?, 1, ?, ?)',
          [url, events, secret, description, input.createdBy || null],
        );
        return { id: r.insertId, secret };
      }
      const id = jsonUpdate((pa) => {
        const id = nextId(pa.webhooks);
        pa.webhooks.push({ id, url, events, secret, active: 1, description, created_by: input.createdBy || null, created_at: new Date().toISOString() });
        return id;
      });
      return { id, secret };
    },

    async setActive(id: number, active: boolean): Promise<void> {
      if (!(await getSub(id))) throw httpError(404, 'وب‌هوک پیدا نشد.');
      if (db.isMysqlEnabled()) { await db.sqlExec('UPDATE crm_webhook_subscriptions SET active = ? WHERE id = ?', [active ? 1 : 0, id]); return; }
      jsonUpdate((pa) => { const w = pa.webhooks.find((x) => Number(x.id) === id); if (w) w.active = active ? 1 : 0; });
    },

    async rotateSecret(id: number): Promise<string> {
      if (!(await getSub(id))) throw httpError(404, 'وب‌هوک پیدا نشد.');
      const secret = newSecret();
      if (db.isMysqlEnabled()) await db.sqlExec('UPDATE crm_webhook_subscriptions SET secret = ? WHERE id = ?', [secret, id]);
      else jsonUpdate((pa) => { const w = pa.webhooks.find((x) => Number(x.id) === id); if (w) w.secret = secret; });
      return secret;
    },

    async deleteSubscription(id: number): Promise<void> {
      if (!(await getSub(id))) throw httpError(404, 'وب‌هوک پیدا نشد.');
      if (db.isMysqlEnabled()) {
        await db.sqlExec('DELETE FROM crm_webhook_deliveries WHERE subscription_id = ? AND status = \'pending\'', [id]);
        await db.sqlExec('DELETE FROM crm_webhook_subscriptions WHERE id = ?', [id]);
        return;
      }
      jsonUpdate((pa) => {
        pa.webhooks = pa.webhooks.filter((w) => Number(w.id) !== id);
        pa.deliveries = pa.deliveries.filter((d) => !(Number(d.subscription_id) === id && d.status === 'pending'));
      });
    },

    async listDeliveries(opts: { subscriptionId?: number; limit?: number } = {}): Promise<WebhookDelivery[]> {
      const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
      const strip = (d: any): WebhookDelivery => ({
        id: Number(d.id), subscription_id: Number(d.subscription_id), event: d.event, event_id: d.event_id, status: d.status,
        attempts: Number(d.attempts) || 0, next_attempt_at: iso(d.next_attempt_at), last_status_code: d.last_status_code ?? null,
        last_error: d.last_error ?? null, created_at: iso(d.created_at) || '', delivered_at: iso(d.delivered_at),
      });
      if (db.isMysqlEnabled()) {
        const rows = opts.subscriptionId
          ? await db.sql<any>(`SELECT id, subscription_id, event, event_id, status, attempts, next_attempt_at, last_status_code, last_error, created_at, delivered_at
              FROM crm_webhook_deliveries WHERE subscription_id = ? ORDER BY id DESC LIMIT ${limit}`, [opts.subscriptionId])
          : await db.sql<any>(`SELECT id, subscription_id, event, event_id, status, attempts, next_attempt_at, last_status_code, last_error, created_at, delivered_at
              FROM crm_webhook_deliveries ORDER BY id DESC LIMIT ${limit}`);
        return rows.map(strip);
      }
      return jsonState().pa.deliveries
        .filter((d) => !opts.subscriptionId || Number(d.subscription_id) === opts.subscriptionId)
        .slice(-limit).reverse().map(strip);
    },

    /** Fire-and-forget: queue one delivery per matching subscription and try it right away. */
    emit(event: WebhookEvent, data: unknown): void {
      void enqueue(event, data)
        .then((ids) => Promise.all(ids.map((id) => attempt(id))))
        .catch((e) => deps.log(`emit ${event} failed: ${e?.message || e}`));
    },

    /** Synchronous 'ping' to one subscription (not logged as a delivery). */
    async sendTest(id: number): Promise<{ ok: boolean; status?: number; error?: string }> {
      const sub = await getSub(id);
      if (!sub) throw httpError(404, 'وب‌هوک پیدا نشد.');
      const eventId = crypto.randomUUID();
      const payload = JSON.stringify({ id: eventId, event: 'ping', created_at: new Date().toISOString(), data: { message: 'Ham-Taraz CRM webhook test' } });
      return post(sub.url, sub.secret, 'ping', eventId, payload);
    },

    start(): void {
      if (timer) return;
      timer = setInterval(() => { void tick(); }, 60_000);
      timer.unref();
    },
    stop(): void { if (timer) clearInterval(timer); timer = null; },
    /** For tests: run one worker pass now. */
    runOnce: tick,
  };
}
