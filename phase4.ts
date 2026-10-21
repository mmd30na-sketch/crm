/**
 * Phase 4: leads, activity timeline, assignable tasks, bulk Rubika campaigns.
 * Schema is additive only (Directus reads the same DB): new crm_* tables + one nullable column on leads.
 * Bulk sending: real delivery requires CRM_BULK_SEND_ENABLED=1 in the server env AND a typed confirmation;
 * dry-run campaigns resolve routes and log per-recipient results without sending anything.
 */
import type express from 'express';
import * as db from './mysql-socks';

type Role = 'admin' | 'cashier' | 'instructor';
type Session = { username: string; role: Role } | null;

export type Phase4Deps = {
  session: (req: express.Request) => Session;
  sanitize: (v: unknown, max: number) => string;
  normalizeMobile: (v: unknown) => string;
  readJsonDb: () => any;
  sendAccount: (guid: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  sendBot: (chatId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  staffDirectory: () => Array<{ username: string; full_name: string; role: string; is_active: boolean }>;
  /** SMS via the CRM gateway (settings). Only used by real (unlocked) campaigns. */
  sendSms?: (phone: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  smsConfigured?: () => boolean;
};

const LEAD_STATUSES = ['new', 'contacted', 'in_negotiation', 'converted', 'lost'] as const;
const ACTIVITY_KINDS = ['call', 'note', 'sms', 'in_person', 'rubika'] as const;
const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
const pick = <T extends readonly string[]>(v: unknown, list: T, dflt: T[number]): T[number] =>
  (list as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : dflt;
const intOrNull = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const dtOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
};
const jalaliOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).trim();
  const m = s.match(/^(1[34]\d\d)[/-](\d{1,2})[/-](\d{1,2})$/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : null;
};

let ready = false;
export async function ensurePhase4Schema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_activities (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      entity_type VARCHAR(10) NOT NULL, entity_id INT NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'note', outcome VARCHAR(120) NULL, body TEXT NULL,
      staff_username VARCHAR(80) NULL, occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_act_entity (entity_type, entity_id, occurred_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_tasks (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL, description TEXT NULL,
      assignee_username VARCHAR(80) NULL, created_by VARCHAR(80) NULL,
      due_at DATETIME NULL, priority VARCHAR(10) NOT NULL DEFAULT 'normal', status VARCHAR(15) NOT NULL DEFAULT 'open',
      entity_type VARCHAR(10) NULL, entity_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      KEY idx_task_assignee (assignee_username, status), KEY idx_task_due (due_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_campaigns (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL, template TEXT NOT NULL, filters JSON NULL,
      dry_run TINYINT(1) NOT NULL DEFAULT 1, throttle_ms INT NOT NULL DEFAULT 3000,
      status VARCHAR(15) NOT NULL DEFAULT 'draft', created_by VARCHAR(80) NULL,
      total INT NOT NULL DEFAULT 0, sent INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0, skipped INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at DATETIME NULL, finished_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_campaign_recipients (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      campaign_id INT UNSIGNED NOT NULL, student_id INT NULL, lead_id INT NULL,
      name VARCHAR(200) NULL, phone VARCHAR(20) NULL, rendered TEXT NULL,
      route VARCHAR(20) NULL, status VARCHAR(15) NOT NULL DEFAULT 'pending', error VARCHAR(255) NULL, processed_at DATETIME NULL,
      KEY idx_rcpt_campaign (campaign_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const cols = await db.sql<{ Field: string }>('SHOW COLUMNS FROM leads');
    if (!cols.some((c) => c.Field === 'converted_student_id')) {
      await db.sqlExec('ALTER TABLE leads ADD COLUMN converted_student_id INT NULL');
    }
    ready = true;
  } catch (err: any) {
    console.warn('Phase 4 schema setup failed:', err.message);
  }
}

/* ---------------- recipients & templates ---------------- */
type Recipient = { student_id: number | null; lead_id: number | null; name: string; first_name: string; last_name: string; phone: string; course: string; debt: number };

type Channel = 'rubika' | 'sms' | 'rubika_sms';
const channelOf = (f: any): Channel => (f?.channel === 'sms' || f?.channel === 'rubika_sms' ? f.channel : 'rubika');
const phoneKey = (v: unknown) => { const d = String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0)).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
export const maskPhone = (v: unknown) => { const k = phoneKey(v); return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const idList = (v: unknown) => new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000));

async function selectRecipients(f: any): Promise<Recipient[]> {
  const raw = await selectRecipientsRaw(f);
  // Same phone once (a person enrolled in two courses of the term, or duplicate records); removed individuals left out.
  const exS = idList(f?.exclude_students); const exL = idList(f?.exclude_leads);
  const seen = new Set<string>(); const out: Recipient[] = [];
  for (const r of raw) {
    if ((r.student_id && exS.has(r.student_id)) || (r.lead_id && exL.has(r.lead_id))) continue;
    const k = phoneKey(r.phone);
    if (k) { if (seen.has(k)) continue; seen.add(k); }
    out.push(r);
  }
  return out;
}

async function selectRecipientsRaw(f: any): Promise<Recipient[]> {
  const out: Recipient[] = [];
  const target = f?.target === 'leads' ? 'leads' : f?.target === 'term' ? 'term' : 'students';
  if (target === 'term') {
    // «همه افراد یک دوره»: one term (crm_course_terms row) or every course with the same course number.
    let cond = ''; let params: any[] = [];
    if (intOrNull(f?.term_id)) {
      const [t] = await db.sql<any>('SELECT course_id, course_number FROM crm_course_terms WHERE id = ?', [intOrNull(f.term_id)]);
      if (!t) return out;
      cond = 'e.course_id = ? AND e.course_number = ?'; params = [t.course_id, t.course_number];
    } else if (intOrNull(f?.term_number)) { cond = 'e.course_number = ?'; params = [intOrNull(f.term_number)]; }
    else return out;
    const rows = await db.sql<any>(
      `SELECT s.student_id, s.first_name, s.last_name, s.phone_number, COALESCE(b.debt, 0) AS debt,
              (SELECT GROUP_CONCAT(DISTINCT c.title SEPARATOR '، ') FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.student_id = s.student_id AND ${cond}) AS course
       FROM students s
       LEFT JOIN (SELECT student_id, SUM(GREATEST(balance_due, 0)) AS debt FROM v_enrollment_balances GROUP BY student_id) b ON b.student_id = s.student_id
       WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND ${cond}) ${f?.debtors ? 'AND COALESCE(b.debt, 0) > 0' : ''}
       ORDER BY s.last_name, s.first_name LIMIT 2000`, [...params, ...params]);
    for (const r of rows) out.push({ student_id: r.student_id, lead_id: null, first_name: r.first_name || '', last_name: r.last_name || '', name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone: r.phone_number || '', course: r.course || '', debt: Number(r.debt) || 0 });
    return out;
  }
  if (target === 'students') {
    const where: string[] = []; const params: any[] = [];
    if (intOrNull(f?.course_id)) { where.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.course_id = ?)'); params.push(intOrNull(f.course_id)); }
    if (intOrNull(f?.course_number)) { where.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.course_number = ?)'); params.push(intOrNull(f.course_number)); }
    if (f?.debtors) where.push('COALESCE(b.debt, 0) > 0');
    const rows = await db.sql<any>(
      `SELECT s.student_id, s.first_name, s.last_name, s.phone_number, COALESCE(b.debt, 0) AS debt,
              (SELECT GROUP_CONCAT(DISTINCT c.title SEPARATOR '، ') FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.student_id = s.student_id) AS course
       FROM students s
       LEFT JOIN (SELECT student_id, SUM(GREATEST(balance_due, 0)) AS debt FROM v_enrollment_balances GROUP BY student_id) b ON b.student_id = s.student_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.student_id DESC LIMIT 2000`, params);
    for (const r of rows) out.push({ student_id: r.student_id, lead_id: null, first_name: r.first_name || '', last_name: r.last_name || '', name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone: r.phone_number || '', course: r.course || '', debt: Number(r.debt) || 0 });
  } else {
    const where: string[] = []; const params: any[] = [];
    if (f?.lead_status && (LEAD_STATUSES as readonly string[]).includes(f.lead_status)) { where.push('l.status = ?'); params.push(f.lead_status); }
    if (intOrNull(f?.course_id)) { where.push('l.interested_course_id = ?'); params.push(intOrNull(f.course_id)); }
    const rows = await db.sql<any>(`SELECT l.lead_id, l.first_name, l.last_name, l.phone_number, c.title AS course FROM leads l LEFT JOIN courses c ON c.course_id = l.interested_course_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.lead_id DESC LIMIT 2000`, params);
    for (const r of rows) out.push({ student_id: null, lead_id: r.lead_id, first_name: r.first_name || '', last_name: r.last_name || '', name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone: r.phone_number || '', course: r.course || '', debt: 0 });
  }
  return out;
}

export function renderTemplate(tpl: string, r: Recipient): string {
  const vars: Record<string, string> = {
    name: r.name, first_name: r.first_name, last_name: r.last_name, course: r.course,
    debt: r.debt ? r.debt.toLocaleString('fa-IR') : '۰', phone: r.phone,
  };
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m)).slice(0, 2000);
}

/** Which channel a recipient can be reached on, without sending: Rubika (account chat > bot chat), SMS, or none. */
function resolveRoute(json: any, r: Recipient, normalizeMobile: (v: unknown) => string, channel: Channel = 'rubika'): { route: 'account' | 'bot' | 'sms' | 'none'; chat?: string } {
  const smsOk = /^09\d{9}$/.test(normalizeMobile(r.phone));
  if (channel === 'sms') return smsOk ? { route: 'sms' } : { route: 'none' };
  const rb = resolveRubika(json, r, normalizeMobile);
  if (rb.route === 'none' && channel === 'rubika_sms' && smsOk) return { route: 'sms' };
  return rb;
}
function resolveRubika(json: any, r: Recipient, normalizeMobile: (v: unknown) => string): { route: 'account' | 'bot' | 'none'; chat?: string } {
  const sid = r.student_id ? String(r.student_id) : '';
  const acc = sid && json?.rubika_account_links?.[sid];
  if (acc) return { route: 'account', chat: acc };
  const bot = sid && json?.rubika_links?.[sid];
  if (bot) return { route: 'bot', chat: bot };
  const phone = normalizeMobile(r.phone);
  if (/^09\d{9}$/.test(phone)) {
    const th = ((json?.threads || []) as any[]).find((t) => normalizeMobile(t.phone) === phone);
    if (th) return { route: th.source === 'bot' ? 'bot' : 'account', chat: th.external_id };
  }
  return { route: 'none' };
}

const runningCampaigns = new Set<number>();
async function runCampaign(id: number, deps: Phase4Deps) {
  if (runningCampaigns.has(id)) return;
  runningCampaigns.add(id);
  try {
    const [c] = await db.sql<any>('SELECT * FROM crm_campaigns WHERE id = ?', [id]);
    if (!c) return;
    const dry = Number(c.dry_run) === 1 || process.env.CRM_BULK_SEND_ENABLED !== '1';
    await db.sqlExec("UPDATE crm_campaigns SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = ?", [id]);
    const json = deps.readJsonDb();
    let channel: Channel = 'rubika';
    try { channel = channelOf(typeof c.filters === 'string' ? JSON.parse(c.filters) : c.filters); } catch { /* old campaigns: Rubika */ }
    for (;;) {
      const [cur] = await db.sql<any>('SELECT status FROM crm_campaigns WHERE id = ?', [id]);
      if (!cur || cur.status === 'cancelled') break;
      const batch = await db.sql<any>("SELECT * FROM crm_campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 20", [id]);
      if (!batch.length) break;
      for (const r of batch) {
        const rec: Recipient = { student_id: r.student_id, lead_id: r.lead_id, name: r.name || '', first_name: '', last_name: '', phone: r.phone || '', course: '', debt: 0 };
        const route = resolveRoute(json, rec, deps.normalizeMobile, channel);
        let status = 'dry_run'; let error: string | null = null;
        if (route.route === 'none') { status = 'skipped'; error = channel === 'sms' ? 'شماره موبایل معتبر نیست' : 'گفتگوی روبیکا برای این شماره پیدا نشد'; }
        else if (!dry) {
          const res = route.route === 'sms'
            ? (deps.sendSms ? await deps.sendSms(r.phone, r.rendered) : { ok: false, error: 'درگاه پیامک تنظیم نشده است' })
            : route.route === 'account' ? await deps.sendAccount(route.chat!, r.rendered) : await deps.sendBot(route.chat!, r.rendered);
          status = res.ok ? 'sent' : 'failed'; error = res.ok ? null : String(res.error || 'خطا').slice(0, 250);
        }
        await db.sqlExec('UPDATE crm_campaign_recipients SET status = ?, route = ?, error = ?, processed_at = NOW() WHERE id = ?', [status, route.route, error, r.id]);
        const col = status === 'sent' || status === 'dry_run' ? 'sent' : status === 'failed' ? 'failed' : 'skipped';
        await db.sqlExec(`UPDATE crm_campaigns SET ${col} = ${col} + 1 WHERE id = ?`, [id]);
        if (!dry && route.route !== 'none') await new Promise((ok) => setTimeout(ok, Math.max(1000, Number(c.throttle_ms) || 3000)));
      }
    }
    await db.sqlExec("UPDATE crm_campaigns SET status = IF(status = 'cancelled', 'cancelled', 'done'), finished_at = NOW() WHERE id = ?", [id]);
  } catch (err: any) {
    console.warn(`campaign ${id} stopped:`, err.message);
    await db.sqlExec("UPDATE crm_campaigns SET status = 'failed' WHERE id = ?", [id]).catch(() => undefined);
  } finally {
    runningCampaigns.delete(id);
  }
}

/* ---------------- routes ---------------- */
export function registerPhase4(app: express.Express, deps: Phase4Deps) {
  const need = (res: express.Response) => { if (!ready) { res.status(503).json({ error: 'این بخش فقط با دیتابیس MySQL فعال است.' }); return false; } return true; };
  const me = (req: express.Request) => deps.session(req);
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) => (req: express.Request, res: express.Response) => {
    if (!need(res)) return;
    fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' }));
  };

  /* ---- staff directory for assignment (names only) ---- */
  app.get('/api/tasks/assignees', (_req, res) => {
    res.json(deps.staffDirectory().filter((s) => s.is_active).map((s) => ({ username: s.username, full_name: s.full_name, role: s.role })));
  });

  /* ---- leads ---- */
  app.get('/api/leads/sources', wrap(async (_req, res) => {
    res.json(await db.sql('SELECT source_id AS id, title, code FROM lead_sources WHERE is_active = 1 ORDER BY source_id'));
  }));
  app.get('/api/leads', wrap(async (req, res) => {
    const q = req.query as Record<string, string>;
    const where: string[] = []; const params: any[] = [];
    if (q.status && (LEAD_STATUSES as readonly string[]).includes(q.status)) { where.push('l.status = ?'); params.push(q.status); }
    if (q.due === '1') where.push("l.next_followup_date_jalali IS NOT NULL AND l.status NOT IN ('converted','lost')");
    const rows = await db.sql(
      `SELECT l.lead_id AS id, l.first_name, l.last_name, l.phone_number, l.national_code, l.source_id, ls.title AS source_title,
              l.interested_course_id AS course_id, c.title AS course_title, l.status, l.assigned_staff_id, l.next_followup_date_jalali,
              l.loss_reason, l.notes, l.converted_student_id, DATE_FORMAT(l.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
              DATE_FORMAT(l.updated_at, '%Y-%m-%dT%H:%i:%s') AS updated_at
       FROM leads l LEFT JOIN lead_sources ls ON ls.source_id = l.source_id LEFT JOIN courses c ON c.course_id = l.interested_course_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.lead_id DESC LIMIT 1000`, params);
    res.json(rows);
  }));
  const leadBody = (b: any) => ({
    first_name: deps.sanitize(b?.first_name, 100) || null,
    last_name: deps.sanitize(b?.last_name, 100),
    phone_number: deps.normalizeMobile(b?.phone_number).slice(0, 20),
    national_code: deps.sanitize(b?.national_code, 10).replace(/\D/g, '') || null,
    source_id: intOrNull(b?.source_id),
    interested_course_id: intOrNull(b?.course_id ?? b?.interested_course_id),
    status: pick(b?.status, LEAD_STATUSES, 'new'),
    next_followup_date_jalali: jalaliOrNull(b?.next_followup_date_jalali),
    loss_reason: deps.sanitize(b?.loss_reason, 255) || null,
    notes: deps.sanitize(b?.notes, 4000) || null,
  });
  app.post('/api/leads', wrap(async (req, res) => {
    const b = leadBody(req.body);
    if (!b.last_name || !/^09\d{9}$/.test(b.phone_number)) return res.status(400).json({ error: 'نام خانوادگی و شماره موبایل معتبر الزامی است.' });
    const r = await db.sqlExec(
      `INSERT INTO leads (first_name, last_name, phone_number, national_code, source_id, interested_course_id, status, next_followup_date_jalali, loss_reason, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.first_name, b.last_name, b.phone_number, b.national_code, b.source_id, b.interested_course_id, b.status, b.next_followup_date_jalali, b.loss_reason, b.notes]);
    res.json({ id: r.insertId });
  }));
  app.put('/api/leads/:id', wrap(async (req, res) => {
    const id = intOrNull(req.params.id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const b = leadBody(req.body);
    if (!b.last_name || !/^09\d{9}$/.test(b.phone_number)) return res.status(400).json({ error: 'نام خانوادگی و شماره موبایل معتبر الزامی است.' });
    await db.sqlExec(
      `UPDATE leads SET first_name = ?, last_name = ?, phone_number = ?, national_code = ?, source_id = ?, interested_course_id = ?, status = ?,
              next_followup_date_jalali = ?, loss_reason = ?, notes = ? WHERE lead_id = ?`,
      [b.first_name, b.last_name, b.phone_number, b.national_code, b.source_id, b.interested_course_id, b.status, b.next_followup_date_jalali, b.loss_reason, b.notes, id]);
    res.json({ ok: true });
  }));
  /** Creates (or finds by national code) the student and marks the lead converted; enrollment is done in the registration form. */
  app.post('/api/leads/:id/convert', wrap(async (req, res) => {
    const id = intOrNull(req.params.id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const [l] = await db.sql<any>('SELECT * FROM leads WHERE lead_id = ?', [id]);
    if (!l) return res.status(404).json({ error: 'سرنخ پیدا نشد' });
    if (l.converted_student_id) return res.json({ student_id: l.converted_student_id, alreadyConverted: true });
    const nationalCode = deps.sanitize(req.body?.national_code ?? l.national_code, 10).replace(/\D/g, '');
    if (!/^\d{10}$/.test(nationalCode)) return res.status(400).json({ error: 'برای تبدیل به کارآموز، کد ملی ۱۰ رقمی لازم است.' });
    const { student, alreadyExists } = await db.insertStudent({ first_name: l.first_name || '', last_name: l.last_name, phone_number: l.phone_number, national_code: nationalCode });
    const sid = Number(student?.id ?? student?.student_id);
    await db.sqlExec("UPDATE leads SET status = 'converted', converted_student_id = ?, national_code = COALESCE(national_code, ?) WHERE lead_id = ?", [sid, nationalCode, id]);
    const s = me(req);
    await db.sqlExec("INSERT INTO crm_activities (entity_type, entity_id, kind, outcome, body, staff_username) VALUES ('lead', ?, 'note', 'converted', ?, ?)", [id, `تبدیل به هنرجو #${sid}`, s?.username || null]);
    res.json({ student_id: sid, alreadyExists });
  }));

  /* ---- activities timeline ---- */
  app.get('/api/activities', wrap(async (req, res) => {
    const type = req.query.entity_type === 'lead' ? 'lead' : 'student';
    const id = intOrNull(req.query.entity_id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const acts = await db.sql<any>(
      `SELECT id, kind, outcome, body, staff_username, DATE_FORMAT(occurred_at, '%Y-%m-%dT%H:%i:%s') AS occurred_at FROM crm_activities
       WHERE entity_type = ? AND entity_id = ? ORDER BY occurred_at DESC LIMIT 300`, [type, id]);
    // Rubika messages already linked to this person (by student id or phone).
    let phone = '';
    if (type === 'student') { const [s] = await db.sql<any>('SELECT phone_number FROM students WHERE student_id = ?', [id]); phone = deps.normalizeMobile(s?.phone_number); }
    else { const [l] = await db.sql<any>('SELECT phone_number FROM leads WHERE lead_id = ?', [id]); phone = deps.normalizeMobile(l?.phone_number); }
    const json = deps.readJsonDb();
    const msgs = ((json?.messages || []) as any[]).filter((m) =>
      (type === 'student' && Number(m.student_id) === id) || (phone && /^09\d{9}$/.test(phone) && deps.normalizeMobile(m.sender_phone) === phone))
      .slice(-200)
      .map((m) => ({ id: String(m.id), direction: m.direction, source: m.source, text: String(m.message || '').slice(0, 1000), at: m.received_at }));
    res.json({ activities: acts, messages: msgs });
  }));
  app.post('/api/activities', wrap(async (req, res) => {
    const type = req.body?.entity_type === 'lead' ? 'lead' : 'student';
    const id = intOrNull(req.body?.entity_id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const body = deps.sanitize(req.body?.body, 4000);
    const kind = pick(req.body?.kind, ACTIVITY_KINDS, 'note');
    if (!body && kind === 'note') return res.status(400).json({ error: 'متن یادداشت خالی است.' });
    const r = await db.sqlExec('INSERT INTO crm_activities (entity_type, entity_id, kind, outcome, body, staff_username, occurred_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))',
      [type, id, kind, deps.sanitize(req.body?.outcome, 120) || null, body || null, me(req)?.username || null, dtOrNull(req.body?.occurred_at)]);
    if (type === 'lead' && kind !== 'note') await db.sqlExec("UPDATE leads SET status = IF(status = 'new', 'contacted', status) WHERE lead_id = ?", [id]);
    res.json({ id: r.insertId });
  }));

  /* ---- tasks ---- */
  app.get('/api/tasks', wrap(async (req, res) => {
    const s = me(req)!;
    const where: string[] = []; const params: any[] = [];
    const mine = req.query.mine === '1' || s.role !== 'admin';
    if (mine) { where.push('t.assignee_username = ?'); params.push(s.username); }
    if (req.query.open === '1') where.push("t.status IN ('open','in_progress')");
    const et = req.query.entity_type === 'lead' ? 'lead' : req.query.entity_type === 'student' ? 'student' : '';
    if (et && intOrNull(req.query.entity_id)) { where.push('t.entity_type = ? AND t.entity_id = ?'); params.push(et, intOrNull(req.query.entity_id)); }
    const rows = await db.sql(
      `SELECT t.id, t.title, t.description, t.assignee_username, t.created_by, DATE_FORMAT(t.due_at, '%Y-%m-%dT%H:%i:%s') AS due_at, t.priority, t.status,
              t.entity_type, t.entity_id, DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
              (t.due_at IS NOT NULL AND t.due_at < UTC_TIMESTAMP() AND t.status IN ('open','in_progress')) AS overdue,
              CASE WHEN t.entity_type = 'student' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM students WHERE student_id = t.entity_id)
                   WHEN t.entity_type = 'lead' THEN (SELECT CONCAT(COALESCE(first_name, ''), ' ', last_name) FROM leads WHERE lead_id = t.entity_id) END AS entity_name
       FROM crm_tasks t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (t.status IN ('done','cancelled')), t.due_at IS NULL, t.due_at, t.id DESC LIMIT 500`, params);
    res.json(rows.map((r: any) => ({ ...r, overdue: !!Number(r.overdue) })));
  }));
  app.get('/api/tasks/summary', wrap(async (req, res) => {
    const s = me(req)!;
    const [r] = await db.sql<any>(
      `SELECT SUM(status IN ('open','in_progress')) AS open, SUM(due_at IS NOT NULL AND due_at < UTC_TIMESTAMP() AND status IN ('open','in_progress')) AS overdue
       FROM crm_tasks WHERE assignee_username = ?`, [s.username]);
    res.json({ open: Number(r?.open || 0), overdue: Number(r?.overdue || 0) });
  }));
  const taskBody = (b: any) => ({
    title: deps.sanitize(b?.title, 200), description: deps.sanitize(b?.description, 4000) || null,
    assignee_username: deps.sanitize(b?.assignee_username, 80) || null, due_at: dtOrNull(b?.due_at),
    priority: pick(b?.priority, TASK_PRIORITIES, 'normal'), status: pick(b?.status, TASK_STATUSES, 'open'),
    entity_type: b?.entity_type === 'lead' || b?.entity_type === 'student' ? b.entity_type : null,
    entity_id: intOrNull(b?.entity_id),
  });
  app.post('/api/tasks', wrap(async (req, res) => {
    const s = me(req)!; const b = taskBody(req.body);
    if (!b.title) return res.status(400).json({ error: 'عنوان کار الزامی است.' });
    if (s.role !== 'admin') b.assignee_username = b.assignee_username || s.username;
    const r = await db.sqlExec(
      'INSERT INTO crm_tasks (title, description, assignee_username, created_by, due_at, priority, status, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [b.title, b.description, b.assignee_username, s.username, b.due_at, b.priority, b.status, b.entity_type, b.entity_type ? b.entity_id : null]);
    res.json({ id: r.insertId });
  }));
  app.put('/api/tasks/:id', wrap(async (req, res) => {
    const s = me(req)!; const id = intOrNull(req.params.id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const [t] = await db.sql<any>('SELECT assignee_username, created_by FROM crm_tasks WHERE id = ?', [id]);
    if (!t) return res.status(404).json({ error: 'کار پیدا نشد' });
    if (s.role !== 'admin' && t.assignee_username !== s.username && t.created_by !== s.username) return res.status(403).json({ error: 'Forbidden' });
    const b = taskBody(req.body);
    if (!b.title) return res.status(400).json({ error: 'عنوان کار الزامی است.' });
    await db.sqlExec(
      `UPDATE crm_tasks SET title = ?, description = ?, assignee_username = ?, due_at = ?, priority = ?, status = ?, entity_type = ?, entity_id = ?,
              completed_at = IF(? = 'done', COALESCE(completed_at, NOW()), NULL) WHERE id = ?`,
      [b.title, b.description, s.role === 'admin' ? b.assignee_username : t.assignee_username, b.due_at, b.priority, b.status, b.entity_type, b.entity_type ? b.entity_id : null, b.status, id]);
    res.json({ ok: true });
  }));

  /* ---- bulk campaigns (admin only via canAccessApi) ---- */
  app.post('/api/campaigns/preview', wrap(async (req, res) => {
    const template = deps.sanitize(req.body?.template, 2000);
    const filters = req.body?.filters || {};
    const channel = channelOf(filters);
    const list = await selectRecipients(filters);
    const json = deps.readJsonDb();
    const routes = { account: 0, bot: 0, sms: 0, none: 0 };
    // Full list (max 2000) so staff can remove individuals; phones masked; sample text for the first 30 only.
    const all = list.slice(0, 2000).map((r, i) => {
      const route = resolveRoute(json, r, deps.normalizeMobile, channel).route; routes[route]++;
      return { student_id: r.student_id, lead_id: r.lead_id, name: r.name, phone: maskPhone(r.phone), course: r.course, route, text: template && i < 30 ? renderTemplate(template, r) : '' };
    });
    res.json({ total: list.length, routes, channel, recipients: all, send_enabled: process.env.CRM_BULK_SEND_ENABLED === '1',
      sms_configured: deps.smsConfigured ? deps.smsConfigured() : false });
  }));
  app.get('/api/campaigns', wrap(async (_req, res) => {
    res.json(await db.sql(`SELECT id, name, template, filters, dry_run, throttle_ms, status, created_by, total, sent, failed, skipped,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at, DATE_FORMAT(finished_at, '%Y-%m-%dT%H:%i:%s') AS finished_at FROM crm_campaigns ORDER BY id DESC LIMIT 100`));
  }));
  app.get('/api/campaigns/:id/recipients', wrap(async (req, res) => {
    const rows = await db.sql<any>(`SELECT id, student_id, lead_id, name, phone, route, status, error, rendered, DATE_FORMAT(processed_at, '%Y-%m-%dT%H:%i:%s') AS processed_at
      FROM crm_campaign_recipients WHERE campaign_id = ? ORDER BY id LIMIT 2000`, [intOrNull(req.params.id)]);
    res.json(rows.map((r) => ({ ...r, phone: maskPhone(r.phone) })));
  }));
  /** Creates the campaign and its queue. A real send needs dry_run=false, server flag, and confirm === 'ارسال'. */
  app.post('/api/campaigns', wrap(async (req, res) => {
    const name = deps.sanitize(req.body?.name, 150) || 'کمپین بدون نام';
    const template = deps.sanitize(req.body?.template, 2000);
    if (!template) return res.status(400).json({ error: 'متن پیام خالی است.' });
    const wantsReal = req.body?.dry_run === false;
    if (wantsReal) {
      if (process.env.CRM_BULK_SEND_ENABLED !== '1') return res.status(403).json({ error: 'ارسال واقعی روی سرور غیرفعال است (فقط اجرای آزمایشی مجاز است).' });
      if (req.body?.confirm !== 'ارسال') return res.status(400).json({ error: 'برای ارسال واقعی باید کلمه «ارسال» را تایپ کنید.' });
      if (channelOf(req.body?.filters) !== 'rubika' && !(deps.smsConfigured && deps.smsConfigured())) return res.status(400).json({ error: 'درگاه پیامک در CRM تنظیم نشده است؛ ارسال واقعی پیامک ممکن نیست.' });
    }
    const filters = req.body?.filters || {};
    const list = await selectRecipients(filters);
    const throttle = Math.min(Math.max(Number(req.body?.throttle_ms) || 3000, 1000), 60000);
    const r = await db.sqlExec('INSERT INTO crm_campaigns (name, template, filters, dry_run, throttle_ms, status, created_by, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, template, JSON.stringify(filters), wantsReal ? 0 : 1, throttle, 'queued', me(req)?.username || null, list.length]);
    const cid = r.insertId;
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      await db.sqlExec(`INSERT INTO crm_campaign_recipients (campaign_id, student_id, lead_id, name, phone, rendered) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap((x) => [cid, x.student_id, x.lead_id, x.name.slice(0, 200), x.phone.slice(0, 20), renderTemplate(template, x)]));
    }
    void runCampaign(cid, deps);
    res.json({ id: cid, total: list.length, dry_run: !wantsReal });
  }));
  app.post('/api/campaigns/:id/cancel', wrap(async (req, res) => {
    await db.sqlExec("UPDATE crm_campaigns SET status = 'cancelled' WHERE id = ? AND status IN ('queued','running','draft')", [intOrNull(req.params.id)]);
    res.json({ ok: true });
  }));
}
