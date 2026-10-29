/**
 * Transactional + campaign email (SMTP via nodemailer).
 *
 * Safety: nothing is sent unless CRM_EMAIL_ENABLED=1 AND SMTP_HOST + CRM_EMAIL_FROM are set. Every send API
 * defaults to dry-run. CRM_EMAIL_TEST_TO, when set, redirects EVERY real send to that one address. Campaigns
 * also need CRM_EMAIL_UNSUB_SECRET (signed unsubscribe link + List-Unsubscribe header) and an explicit typed
 * confirmation. Sends are rate limited per hour (CRM_EMAIL_MAX_PER_HOUR) and throttled (CRM_EMAIL_THROTTLE_MS).
 * The log stores masked addresses only; SMTP credentials are never returned or logged.
 */
// Drafted with a free model (codestral) and then rewritten during review.
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import type express from 'express';
import { toJalaali } from 'jalaali-js';
import * as db from './mysql-socks';
import { renderEmail, EMAIL_TEMPLATES, type EmailTemplateKey, type EmailVars } from './emailTemplates';

export type EmailDeps = {
  session(req: express.Request): { username: string; role: string } | null;
  sanitize(v: unknown, max: number): string;
  academyName(): string;
  publicBaseUrl(req: express.Request): string;
  log(msg: string): void;
};

const intEnv = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export function isValidEmail(e: unknown): e is string {
  const s = String(e ?? '');
  return s.length > 3 && s.length <= 190 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(s);
}
export function maskEmail(e: unknown): string {
  const s = String(e ?? '');
  const at = s.lastIndexOf('@');
  if (at < 1) return '';
  return `${s.slice(0, Math.min(2, at))}***@${s.slice(at + 1)}`;
}

export function emailConfig() {
  const env = process.env;
  const testTo = String(env.CRM_EMAIL_TEST_TO || '').trim();
  const host = String(env.SMTP_HOST || '').trim();
  const from = String(env.CRM_EMAIL_FROM || '').trim();
  return {
    enabled: env.CRM_EMAIL_ENABLED === '1',
    testTo: isValidEmail(testTo) ? testTo : '',
    host,
    port: intEnv(env.SMTP_PORT, 587, 1, 65535),
    secure: env.SMTP_SECURE === '1',
    user: String(env.SMTP_USER || ''),
    pass: String(env.SMTP_PASS || ''),
    from,
    fromName: String(env.CRM_EMAIL_FROM_NAME || '').replace(/["\r\n<>]/g, '').trim(),
    maxPerHour: intEnv(env.CRM_EMAIL_MAX_PER_HOUR, 100, 0, 10000),
    throttleMs: intEnv(env.CRM_EMAIL_THROTTLE_MS, 1500, 0, 60000),
    unsubSecret: String(env.CRM_EMAIL_UNSUB_SECRET || ''),
    configured: !!(host && isValidEmail(from)),
  };
}
export function emailStatus() {
  const c = emailConfig();
  return {
    enabled: c.enabled, configured: c.configured, test_to_masked: c.testTo ? maskEmail(c.testTo) : '',
    max_per_hour: c.maxPerHour, throttle_ms: c.throttleMs, from_masked: c.from ? maskEmail(c.from) : '',
    unsubscribe_ready: !!c.unsubSecret, mysql: db.isMysqlEnabled() && ready,
  };
}

/* ---------------- unsubscribe tokens (pure) ---------------- */
const hmac = (email: string, secret: string) => crypto.createHmac('sha256', secret).update(email).digest('hex').slice(0, 32);
export function makeUnsubscribeToken(email: string, secret: string): string {
  const e = email.trim().toLowerCase();
  return `${Buffer.from(e, 'utf8').toString('base64url')}.${hmac(e, secret)}`;
}
/** Returns the lower-cased email when the token is authentic, else null. */
export function verifyUnsubscribeToken(token: unknown, secret: string): string | null {
  if (!secret) return null;
  const m = String(token ?? '').match(/^([A-Za-z0-9_-]{4,400})\.([a-f0-9]{32})$/);
  if (!m) return null;
  let email = '';
  try { email = Buffer.from(m[1], 'base64url').toString('utf8'); } catch { return null; }
  if (!isValidEmail(email)) return null;
  const a = Buffer.from(m[2]); const b = Buffer.from(hmac(email, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? email : null;
}
const emailHash = (e: string) => crypto.createHash('sha256').update(e.trim().toLowerCase()).digest('hex');

/* ---------------- schema ---------------- */
let ready = false;
export async function ensureEmailSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_email_contacts (
      student_id INT NOT NULL PRIMARY KEY,
      email VARCHAR(190) NOT NULL,
      updated_by VARCHAR(80) NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_email_contacts_email (email)
    ) ${T} COMMENT='CRM: student email addresses / ایمیل کارآموزان'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_email_unsubscribes (
      email_hash CHAR(64) NOT NULL PRIMARY KEY,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ${T} COMMENT='CRM: campaign unsubscribes (sha256 of lower-cased email)'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_email_templates (
      template_key VARCHAR(40) NOT NULL PRIMARY KEY,
      subject VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      updated_by VARCHAR(80) NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ${T} COMMENT='CRM: email template overrides'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_email_campaigns (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      subject VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      filters JSON NULL,
      status ENUM('draft','sending','done','cancelled') NOT NULL DEFAULT 'draft',
      dry_run TINYINT(1) NOT NULL DEFAULT 1,
      total INT NOT NULL DEFAULT 0,
      sent INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0,
      skipped INT NOT NULL DEFAULT 0,
      created_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME NULL,
      finished_at DATETIME NULL
    ) ${T} COMMENT='CRM: email campaigns'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_email_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      kind ENUM('transactional','campaign') NOT NULL,
      template_key VARCHAR(40) NULL,
      campaign_id INT UNSIGNED NULL,
      student_id INT NULL,
      to_masked VARCHAR(120) NULL,
      subject VARCHAR(200) NULL,
      status ENUM('sent','failed','dry_run','skipped_unsubscribed','skipped_no_email','skipped_disabled','rate_limited') NOT NULL,
      test_override TINYINT(1) NOT NULL DEFAULT 0,
      error VARCHAR(255) NULL,
      created_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_email_log_created (created_at),
      KEY idx_email_log_campaign (campaign_id),
      KEY idx_email_log_student (student_id),
      KEY idx_email_log_status (status, created_at)
    ) ${T} COMMENT='CRM: email send log (masked addresses only)'`);
    // A campaign interrupted by a restart must not look like it is still sending.
    await db.sqlExec("UPDATE crm_email_campaigns SET status = 'cancelled', finished_at = NOW() WHERE status = 'sending'");
    ready = true;
  } catch (err: any) {
    console.warn('Email schema setup failed:', err?.message || err);
  }
}

/* ---------------- delivery ---------------- */
let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
let transportKey = '';
function getTransport(c: ReturnType<typeof emailConfig>) {
  const key = `${c.host}|${c.port}|${c.secure}|${c.user}`;
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
    transportKey = key;
  }
  return transport;
}
export type DeliverStatus = 'sent' | 'failed' | 'dry_run' | 'skipped_unsubscribed' | 'skipped_no_email' | 'skipped_disabled' | 'rate_limited';
let sentThisHour: number[] = [];
async function rateLimited(maxPerHour: number): Promise<boolean> {
  const since = Date.now() - 3_600_000;
  sentThisHour = sentThisHour.filter((t) => t > since);
  const rows = await db.sql<{ c: number }>("SELECT COUNT(*) AS c FROM crm_email_log WHERE status = 'sent' AND created_at >= (NOW() - INTERVAL 1 HOUR)");
  return Math.max(Number(rows[0]?.c) || 0, sentThisHour.length) >= maxPerHour;
}
async function isUnsubscribed(email: string): Promise<boolean> {
  const r = await db.sql<{ c: number }>('SELECT COUNT(*) AS c FROM crm_email_unsubscribes WHERE email_hash = ?', [emailHash(email)]);
  return Number(r[0]?.c) > 0;
}
/** Strip anything that could carry a credential or address out of a transport error. */
const safeError = (e: any) => String(e?.code || e?.responseCode || e?.message || e).replace(/[^\s@]+@[^\s@]+/g, '***').slice(0, 200);

export async function deliver(o: {
  to: string | null; subject: string; html: string; text: string; kind: 'transactional' | 'campaign';
  template_key?: string | null; campaign_id?: number | null; student_id?: number | null; by?: string | null;
  dryRun: boolean; unsubscribeUrl?: string | null;
}): Promise<{ status: DeliverStatus; to_masked: string; test_override: boolean }> {
  const c = emailConfig();
  const realTo = isValidEmail(o.to) ? o.to : '';
  const override = !!c.testTo;
  const to_masked = (realTo ? maskEmail(realTo) : '') + (override ? ' → test' : '');
  let status: DeliverStatus; let error: string | null = null;
  if (!realTo) status = 'skipped_no_email';
  else if (o.kind === 'campaign' && await isUnsubscribed(realTo)) status = 'skipped_unsubscribed';
  else if (o.dryRun) status = 'dry_run';
  else if (!c.enabled || !c.configured) status = 'skipped_disabled';
  else if (c.maxPerHour === 0 || await rateLimited(c.maxPerHour)) status = 'rate_limited';
  else {
    try {
      sentThisHour.push(Date.now());
      await getTransport(c).sendMail({
        from: c.fromName ? { name: c.fromName, address: c.from } : c.from,
        to: c.testTo || realTo,
        subject: override ? `[TEST] ${o.subject}` : o.subject,
        html: o.html, text: o.text,
        headers: o.unsubscribeUrl ? { 'List-Unsubscribe': `<${o.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
      });
      status = 'sent';
    } catch (e: any) { status = 'failed'; error = safeError(e); }
  }
  await db.sqlExec(`INSERT INTO crm_email_log (kind, template_key, campaign_id, student_id, to_masked, subject, status, test_override, error, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [o.kind, o.template_key || null, o.campaign_id || null, o.student_id || null,
    to_masked.slice(0, 120) || null, o.subject.slice(0, 200), status, override ? 1 : 0, error, o.by || null]);
  return { status, to_masked, test_override: override };
}

/* ---------------- data ---------------- */
const TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[];
const isTemplateKey = (k: unknown): k is EmailTemplateKey => TEMPLATE_KEYS.includes(k as EmailTemplateKey);
async function getTemplate(key: EmailTemplateKey) {
  const rows = await db.sql<{ subject: string; body: string }>('SELECT subject, body FROM crm_email_templates WHERE template_key = ?', [key]);
  const d = EMAIL_TEMPLATES[key];
  return rows[0] ? { ...d, subject: rows[0].subject, body: rows[0].body, overridden: true } : { ...d, overridden: false };
}
const money = (v: unknown) => Math.round(Number(v) || 0).toLocaleString('fa-IR');
const p2 = (n: number) => String(n).padStart(2, '0');
export function todayJalali(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const j = toJalaali(g('year'), g('month'), g('day'));
  return `${j.jy}/${p2(j.jm)}/${p2(j.jd)}`;
}
const SAMPLE_VARS: EmailVars = {
  name: 'سارا', family: 'نمونه', full_name: 'سارا نمونه', course: 'دورهٔ نمونه', amount: money(2500000), date: todayJalali(),
  pay_method: 'کارت به کارت', receipt_no: '1234', debt: money(500000), message: 'متن یادآوری نمونه', due_date: todayJalali(),
};

/** Variables for one student (and optionally one payment / enrollment). Returns null when the student is missing. */
export async function studentVars(studentId: number, opts: { payment_id?: number | null; enrollment_id?: number | null } = {}) {
  const st = (await db.sql<any>(`SELECT s.student_id, s.first_name, s.last_name, ec.email FROM students s
    LEFT JOIN crm_email_contacts ec ON ec.student_id = s.student_id WHERE s.student_id = ?`, [studentId]))[0];
  if (!st) return null;
  const debt = (await db.sql<any>('SELECT COALESCE(SUM(GREATEST(balance_due, 0)), 0) AS d FROM v_enrollment_balances WHERE student_id = ?', [studentId]))[0]?.d;
  const vars: EmailVars = {
    name: st.first_name || '', family: st.last_name || '', full_name: `${st.first_name || ''} ${st.last_name || ''}`.trim(),
    debt: money(debt), date: todayJalali(), course: '', amount: '', pay_method: '', receipt_no: '',
  };
  let enrollmentId = opts.enrollment_id || null;
  if (opts.payment_id) {
    const p = (await db.sql<any>('SELECT payment_id, enrollment_id, amount, pay_date_jalali, pay_method FROM payments WHERE payment_id = ? AND student_id = ?', [opts.payment_id, studentId]))[0];
    if (!p) throw Object.assign(new Error('این پرداخت متعلق به این کارآموز نیست.'), { status: 400 });
    Object.assign(vars, { amount: money(p.amount), date: p.pay_date_jalali || vars.date, pay_method: p.pay_method || '', receipt_no: String(p.payment_id) });
    enrollmentId = enrollmentId || p.enrollment_id || null;
  }
  const e = (await db.sql<any>(enrollmentId
    ? 'SELECT e.enrollment_id, c.title FROM enrollments e LEFT JOIN courses c ON c.course_id = e.course_id WHERE e.enrollment_id = ? AND e.student_id = ?'
    : 'SELECT e.enrollment_id, c.title FROM enrollments e LEFT JOIN courses c ON c.course_id = e.course_id WHERE e.student_id = ? ORDER BY e.enrollment_id DESC LIMIT 1',
  enrollmentId ? [enrollmentId, studentId] : [studentId]))[0];
  if (enrollmentId && !e) throw Object.assign(new Error('این ثبت‌نام متعلق به این کارآموز نیست.'), { status: 400 });
  if (e) vars.course = e.title || '';
  return { email: isValidEmail(st.email) ? String(st.email) : null, vars };
}

export type AudienceFilters = { target: 'all' | 'course' | 'debtors'; course_id?: number | null; min_debt?: number | null };
export function normalizeFilters(f: any): AudienceFilters {
  const target = ['all', 'course', 'debtors'].includes(f?.target) ? f.target : 'all';
  const course_id = Number(f?.course_id) > 0 ? Math.floor(Number(f.course_id)) : null;
  const min_debt = Number(f?.min_debt) > 0 ? Number(f.min_debt) : 1;
  return target === 'course' ? { target, course_id } : target === 'debtors' ? { target, min_debt } : { target };
}
/** Students that have an email on file and match the filter (max 5000). */
async function audience(f: AudienceFilters) {
  const where: string[] = []; const params: any[] = [];
  if (f.target === 'course') {
    if (!f.course_id) throw Object.assign(new Error('دوره را انتخاب کنید.'), { status: 400 });
    where.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.course_id = ?)'); params.push(f.course_id);
  }
  if (f.target === 'debtors') {
    where.push('(SELECT COALESCE(SUM(GREATEST(b.balance_due, 0)), 0) FROM v_enrollment_balances b WHERE b.student_id = s.student_id) >= ?'); params.push(f.min_debt || 1);
  }
  const rows = await db.sql<any>(`SELECT s.student_id, s.first_name, s.last_name, ec.email FROM students s
    JOIN crm_email_contacts ec ON ec.student_id = s.student_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.student_id LIMIT 5000`, params);
  return rows.filter((r: any) => isValidEmail(r.email)).map((r: any) => ({
    student_id: Number(r.student_id), email: String(r.email),
    vars: { name: r.first_name || '', family: r.last_name || '', full_name: `${r.first_name || ''} ${r.last_name || ''}`.trim() } as EmailVars,
  }));
}

/** For future automation wiring: render + deliver one transactional template to a student (dry-run by default). */
export async function sendTemplateEmail(key: Exclude<EmailTemplateKey, 'campaign'>, studentId: number, opts: {
  payment_id?: number | null; enrollment_id?: number | null; vars?: EmailVars; dryRun?: boolean; by?: string | null; academyName: string;
}) {
  const sv = await studentVars(studentId, opts);
  if (!sv) throw Object.assign(new Error('کارآموز یافت نشد.'), { status: 404 });
  const t = await getTemplate(key);
  const r = renderEmail({ subject: t.subject, body: t.body, vars: { ...sv.vars, ...(opts.vars || {}) }, academyName: opts.academyName });
  return deliver({ to: sv.email, ...r, kind: 'transactional', template_key: key, student_id: studentId, by: opts.by, dryRun: opts.dryRun !== false });
}

/* ---------------- routes ---------------- */
const unsubPage = (title: string, msg: string) => `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:Vazirmatn,Tahoma,Arial,sans-serif;"><div style="max-width:420px;margin:60px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;text-align:center;">
<h1 style="font-size:18px;color:#0f172a;margin:0 0 12px;">${title}</h1><p style="font-size:14px;color:#475569;line-height:1.9;margin:0;">${msg}</p></div></body></html>`;

let sendingCampaign: number | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerEmail(app: express.Express, deps: EmailDeps) {
  type Who = { username: string; role: string };
  const route = (adminOnly: boolean, fn: (req: express.Request, res: express.Response, who: Who) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      const who = deps.session(req);
      if (!who) return res.status(401).json({ error: 'ابتدا وارد شوید.' });
      if (adminOnly ? who.role !== 'admin' : !['admin', 'cashier'].includes(who.role)) return res.status(403).json({ error: 'دسترسی ندارید.' });
      if (!db.isMysqlEnabled() || !ready) return res.status(503).json({ error: 'ایمیل به پایگاه دادهٔ MySQL نیاز دارد و فعلاً در دسترس نیست.' });
      try { await fn(req, res, who); } catch (err: any) {
        const status = Number(err?.status) || 500;
        if (status >= 500) console.error(`email ${req.method} ${req.path} failed:`, err?.message || err);
        res.status(status).json({ error: status < 500 ? err.message : 'خطای داخلی سرور.' });
      }
    };
  const bad = (m: string) => Object.assign(new Error(m), { status: 400 });
  const idParam = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('شناسه نامعتبر است.'); return n; };

  app.get('/api/email/status', (req, res) => {
    const who = deps.session(req);
    if (!who || !['admin', 'cashier'].includes(who.role)) return res.status(403).json({ error: 'دسترسی ندارید.' });
    res.json(emailStatus());
  });

  /* contacts */
  app.get('/api/email/contacts', route(false, async (req, res) => {
    const q = deps.sanitize(req.query.q, 80).trim();
    const onlyWith = req.query.only_with_email === '1';
    const params: any[] = []; const where: string[] = [];
    if (q) { where.push("CONCAT(s.first_name, ' ', s.last_name) LIKE ?"); params.push(`%${q}%`); }
    if (onlyWith) where.push('ec.email IS NOT NULL');
    const rows = await db.sql<any>(`SELECT s.student_id, s.first_name, s.last_name, ec.email FROM students s
      LEFT JOIN crm_email_contacts ec ON ec.student_id = s.student_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (ec.email IS NULL), s.student_id DESC LIMIT 300`, params);
    const hashes = rows.filter((r: any) => r.email).map((r: any) => emailHash(r.email));
    const unsub = new Set(hashes.length
      ? (await db.sql<any>(`SELECT email_hash FROM crm_email_unsubscribes WHERE email_hash IN (${hashes.map(() => '?').join(',')})`, hashes)).map((r: any) => r.email_hash)
      : []);
    res.json(rows.map((r: any) => ({
      student_id: Number(r.student_id), name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      email_masked: r.email ? maskEmail(r.email) : '', has_email: !!r.email, unsubscribed: r.email ? unsub.has(emailHash(r.email)) : false,
    })));
  }));
  app.put('/api/email/contacts/:studentId', route(false, async (req, res, who) => {
    const id = idParam(req.params.studentId);
    const email = String(req.body?.email ?? '').trim();
    if (!(await db.sql<any>('SELECT student_id FROM students WHERE student_id = ?', [id])).length) throw Object.assign(new Error('کارآموز یافت نشد.'), { status: 404 });
    if (!email) { await db.sqlExec('DELETE FROM crm_email_contacts WHERE student_id = ?', [id]); return res.json({ ok: true, has_email: false }); }
    if (!isValidEmail(email)) throw bad('ایمیل نامعتبر است.');
    await db.sqlExec(`INSERT INTO crm_email_contacts (student_id, email, updated_by) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE email = VALUES(email), updated_by = VALUES(updated_by)`, [id, email, who.username]);
    res.json({ ok: true, has_email: true, email_masked: maskEmail(email) });
  }));

  /* templates */
  app.get('/api/email/templates', route(false, async (_req, res) => {
    res.json(await Promise.all(TEMPLATE_KEYS.map(async (key) => ({ key, ...(await getTemplate(key)) }))));
  }));
  app.put('/api/email/templates/:key', route(true, async (req, res, who) => {
    const key = req.params.key; if (!isTemplateKey(key)) throw bad('قالب نامعتبر است.');
    const subject = String(req.body?.subject ?? '').trim(); const body = String(req.body?.body ?? '');
    if (!subject || subject.length > 200) throw bad('موضوع باید ۱ تا ۲۰۰ نویسه باشد.');
    if (!body.trim() || body.length > 20000) throw bad('متن قالب خالی یا بیش از حد طولانی است.');
    await db.sqlExec(`INSERT INTO crm_email_templates (template_key, subject, body, updated_by) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE subject = VALUES(subject), body = VALUES(body), updated_by = VALUES(updated_by)`, [key, subject, body, who.username]);
    res.json({ ok: true });
  }));
  app.delete('/api/email/templates/:key', route(true, async (req, res) => {
    const key = req.params.key; if (!isTemplateKey(key)) throw bad('قالب نامعتبر است.');
    await db.sqlExec('DELETE FROM crm_email_templates WHERE template_key = ?', [key]);
    res.json({ ok: true });
  }));
  const extraVars = (v: any): EmailVars => {
    const out: EmailVars = {};
    for (const k of ['message', 'due_date', 'date', 'course']) if (v && v[k] !== undefined && v[k] !== null && String(v[k]).trim()) out[k] = String(v[k]).slice(0, 300);
    return out;
  };
  app.post('/api/email/templates/:key/preview', route(false, async (req, res) => {
    const key = req.params.key; if (!isTemplateKey(key)) throw bad('قالب نامعتبر است.');
    const t = await getTemplate(key);
    const subject = typeof req.body?.subject === 'string' && req.body.subject.trim() ? String(req.body.subject).slice(0, 200) : t.subject;
    const body = typeof req.body?.body === 'string' && req.body.body.trim() ? String(req.body.body).slice(0, 20000) : t.body;
    let vars = SAMPLE_VARS; let to_masked = '';
    if (req.body?.student_id) {
      const sv = await studentVars(idParam(req.body.student_id), { payment_id: Number(req.body.payment_id) || null, enrollment_id: Number(req.body.enrollment_id) || null });
      if (!sv) throw Object.assign(new Error('کارآموز یافت نشد.'), { status: 404 });
      vars = sv.vars; to_masked = sv.email ? maskEmail(sv.email) : '';
    }
    const r = renderEmail({ subject, body, vars: { ...vars, ...extraVars(req.body?.vars) }, academyName: deps.academyName(), unsubscribeUrl: key === 'campaign' ? '#' : null });
    res.json({ subject: r.subject, html: r.html, text: r.text, to_masked });
  }));

  /* transactional send */
  app.post('/api/email/send', route(false, async (req, res, who) => {
    const key = req.body?.template_key;
    if (!isTemplateKey(key) || key === 'campaign') throw bad('قالب باید رسید، گواهی یا یادآوری باشد.');
    const dryRun = req.body?.dry_run !== false;
    const r = await sendTemplateEmail(key, idParam(req.body?.student_id), {
      payment_id: Number(req.body?.payment_id) || null, enrollment_id: Number(req.body?.enrollment_id) || null,
      vars: extraVars(req.body?.vars), dryRun, by: who.username, academyName: deps.academyName(),
    });
    deps.log(`email ${key} student=${req.body?.student_id} status=${r.status} by=${who.username}`);
    res.json(r);
  }));

  /* campaigns */
  const unsubUrlFor = (base: string, email: string) => {
    const s = emailConfig().unsubSecret;
    return s ? `${base.replace(/\/$/, '')}/api/email/unsubscribe?t=${makeUnsubscribeToken(email, s)}` : null;
  };
  const readCampaignInput = (b: any) => {
    const subject = String(b?.subject ?? '').trim(); const body = String(b?.body ?? '');
    if (!subject || subject.length > 200) throw bad('موضوع باید ۱ تا ۲۰۰ نویسه باشد.');
    if (!body.trim() || body.length > 20000) throw bad('متن پیام خالی یا بیش از حد طولانی است.');
    return { subject, body, filters: normalizeFilters(b?.filters) };
  };
  app.post('/api/email/campaigns/preview', route(true, async (req, res) => {
    const { subject, body, filters } = readCampaignInput(req.body);
    const list = await audience(filters);
    let unsubscribed = 0;
    if (list.length) {
      const hashes = list.map((r) => emailHash(r.email));
      const set = new Set<string>();
      for (let i = 0; i < hashes.length; i += 500) {
        const chunk = hashes.slice(i, i + 500);
        (await db.sql<any>(`SELECT email_hash FROM crm_email_unsubscribes WHERE email_hash IN (${chunk.map(() => '?').join(',')})`, chunk)).forEach((r: any) => set.add(r.email_hash));
      }
      unsubscribed = hashes.filter((h) => set.has(h)).length;
    }
    const first = list[0];
    const rendered = renderEmail({ subject, body, vars: first ? first.vars : SAMPLE_VARS, academyName: deps.academyName(), unsubscribeUrl: '#' });
    res.json({
      with_email: list.length, unsubscribed, will_send: list.length - unsubscribed, capped: list.length >= 5000,
      sample: list.slice(0, 20).map((r) => ({ name: r.vars.full_name, email_masked: maskEmail(r.email) })),
      rendered: { subject: rendered.subject, html: rendered.html }, status: emailStatus(),
    });
  }));
  app.get('/api/email/campaigns', route(true, async (_req, res) => {
    const rows = await db.sql<any>('SELECT * FROM crm_email_campaigns ORDER BY id DESC LIMIT 100');
    res.json(rows.map((r: any) => ({ ...r, dry_run: !!Number(r.dry_run), filters: typeof r.filters === 'string' ? JSON.parse(r.filters || 'null') : r.filters })));
  }));
  app.post('/api/email/campaigns', route(true, async (req, res, who) => {
    const { subject, body, filters } = readCampaignInput(req.body);
    const name = deps.sanitize(req.body?.name, 150).trim() || subject.slice(0, 150);
    const r = await db.sqlExec('INSERT INTO crm_email_campaigns (name, subject, body, filters, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, subject, body, JSON.stringify(filters), who.username]);
    res.status(201).json({ id: r.insertId });
  }));
  app.post('/api/email/campaigns/:id/send', route(true, async (req, res, who) => {
    const id = idParam(req.params.id);
    const camp = (await db.sql<any>('SELECT * FROM crm_email_campaigns WHERE id = ?', [id]))[0];
    if (!camp) throw Object.assign(new Error('کمپین یافت نشد.'), { status: 404 });
    if (camp.status === 'sending' || sendingCampaign) throw Object.assign(new Error('یک کمپین در حال ارسال است.'), { status: 409 });
    if (camp.status === 'cancelled') throw bad('این کمپین لغو شده است.');
    const dryRun = req.body?.dry_run !== false;
    const c = emailConfig();
    if (!dryRun) {
      if (camp.status === 'done' && !Number(camp.dry_run)) throw bad('این کمپین قبلاً واقعاً ارسال شده است؛ برای ارسال دوباره کمپین جدید بسازید.');
      if (!c.enabled) throw bad('ارسال ایمیل خاموش است (CRM_EMAIL_ENABLED).');
      if (!c.configured) throw bad('تنظیمات SMTP کامل نیست (SMTP_HOST / CRM_EMAIL_FROM).');
      if (!c.unsubSecret) throw bad('CRM_EMAIL_UNSUB_SECRET تنظیم نشده است؛ کمپین بدون لینک لغو اشتراک ارسال نمی‌شود.');
      if (String(req.body?.confirm ?? '').trim() !== 'ارسال') throw bad('برای ارسال واقعی، کلمهٔ «ارسال» را تایپ کنید.');
    }
    const filters = normalizeFilters(typeof camp.filters === 'string' ? JSON.parse(camp.filters || '{}') : camp.filters);
    const list = await audience(filters);
    sendingCampaign = id;
    await db.sqlExec(`UPDATE crm_email_campaigns SET status = 'sending', dry_run = ?, total = ?, sent = 0, failed = 0, skipped = 0, started_at = NOW(), finished_at = NULL WHERE id = ?`,
      [dryRun ? 1 : 0, list.length, id]);
    res.json({ ok: true, total: list.length, dry_run: dryRun, test_override: !!c.testTo });
    const base = deps.publicBaseUrl(req); const academy = deps.academyName();
    void (async () => {
      let sent = 0; let failed = 0; let skipped = 0;
      try {
        for (let i = 0; i < list.length; i++) {
          if (i % 10 === 0) {
            const st = (await db.sql<any>('SELECT status FROM crm_email_campaigns WHERE id = ?', [id]))[0]?.status;
            if (st !== 'sending') return;
          }
          const r0 = list[i];
          const unsub = unsubUrlFor(base, r0.email);
          const r = renderEmail({ subject: camp.subject, body: camp.body, vars: r0.vars, academyName: academy, unsubscribeUrl: unsub || (dryRun ? '#' : null) });
          const d = await deliver({ to: r0.email, ...r, kind: 'campaign', campaign_id: id, student_id: r0.student_id, by: who.username, dryRun, unsubscribeUrl: unsub });
          if (d.status === 'sent' || d.status === 'dry_run') sent++; else if (d.status === 'failed') failed++; else skipped++;
          if (i % 10 === 9 || i === list.length - 1) await db.sqlExec('UPDATE crm_email_campaigns SET sent = ?, failed = ?, skipped = ? WHERE id = ?', [sent, failed, skipped, id]);
          if (d.status === 'rate_limited') { // stop instead of logging thousands of rate_limited rows
            await db.sqlExec("UPDATE crm_email_campaigns SET status = 'cancelled', finished_at = NOW(), sent = ?, failed = ?, skipped = ? WHERE id = ?", [sent, failed, skipped, id]);
            deps.log(`email campaign ${id} stopped: hourly limit reached`);
            return;
          }
          if (!dryRun && d.status === 'sent' && c.throttleMs) await sleep(c.throttleMs);
        }
        await db.sqlExec("UPDATE crm_email_campaigns SET status = 'done', finished_at = NOW(), sent = ?, failed = ?, skipped = ? WHERE id = ? AND status = 'sending'", [sent, failed, skipped, id]);
        deps.log(`email campaign ${id} finished dry_run=${dryRun} sent=${sent} failed=${failed} skipped=${skipped}`);
      } catch (err: any) {
        console.error('email campaign failed:', err?.message || err);
        await db.sqlExec("UPDATE crm_email_campaigns SET status = 'cancelled', finished_at = NOW() WHERE id = ?", [id]).catch(() => undefined);
      } finally { sendingCampaign = null; }
    })();
  }));
  app.post('/api/email/campaigns/:id/cancel', route(true, async (req, res) => {
    const id = idParam(req.params.id);
    const r = await db.sqlExec("UPDATE crm_email_campaigns SET status = 'cancelled', finished_at = NOW() WHERE id = ? AND status IN ('draft','sending')", [id]);
    res.json({ ok: r.affectedRows > 0 });
  }));

  /* log */
  app.get('/api/email/log', route(false, async (req, res) => {
    const q = req.query as Record<string, string>;
    const where: string[] = []; const params: any[] = [];
    if (q.kind === 'transactional' || q.kind === 'campaign') { where.push('kind = ?'); params.push(q.kind); }
    if (Number(q.campaign_id) > 0) { where.push('campaign_id = ?'); params.push(Number(q.campaign_id)); }
    if (q.status && /^[a-z_]{3,30}$/.test(q.status)) { where.push('status = ?'); params.push(q.status); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50)); const offset = Math.max(0, Number(q.offset) || 0);
    const rows = await db.sql<any>(`SELECT id, kind, template_key, campaign_id, student_id, to_masked, subject, status, test_override, error, created_by, created_at
      FROM crm_email_log ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    const total = Number((await db.sql<any>(`SELECT COUNT(*) AS c FROM crm_email_log ${w}`, params))[0]?.c) || 0;
    res.json({ rows: rows.map((r: any) => ({ ...r, test_override: !!Number(r.test_override) })), total });
  }));

  /* PUBLIC unsubscribe (no session): GET shows the page, POST supports RFC 8058 one-click */
  const unsubscribe = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const email = verifyUnsubscribeToken(req.query.t, emailConfig().unsubSecret);
    if (!email || !db.isMysqlEnabled() || !ready) return res.status(400).type('html').send(unsubPage('لینک نامعتبر است', 'این لینک لغو اشتراک معتبر نیست یا منقضی شده است.'));
    try {
      await db.sqlExec('INSERT IGNORE INTO crm_email_unsubscribes (email_hash) VALUES (?)', [emailHash(email)]);
    } catch (err: any) {
      console.error('unsubscribe failed:', err?.message || err);
      return res.status(500).type('html').send(unsubPage('خطا', 'لطفاً بعداً دوباره تلاش کنید.'));
    }
    res.type('html').send(unsubPage('اشتراک شما لغو شد', 'از این پس ایمیل‌های خبری و تبلیغاتی برای شما ارسال نمی‌شود. ایمیل‌های ضروری مانند رسید پرداخت همچنان ارسال می‌شوند.'));
  };
  app.get('/api/email/unsubscribe', unsubscribe);
  app.post('/api/email/unsubscribe', unsubscribe);
}
