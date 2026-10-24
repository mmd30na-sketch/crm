/**
 * Remaining-debt SMS with a single payment link for the whole outstanding balance.
 *
 * For every trainee who still owes money the CRM can send one SMS a day (per trainee) containing the
 * trainee's first name, the full remaining balance and a short payment code. The code is a link in
 * `crm_debt_links`; the public URL is `${CRM_PAYMENT_LINK_BASE}<code>` (default
 * https://kermanshahcart.ir/p/) and is served by the trainee payment routes in onlinePayments.ts, which
 * resolve the link through the store created here (separate from the legacy installment links).
 *
 * Additive only: two new tables `crm_debt_links` and `crm_debt_sms_log` (JSON fallback in
 * db_store.json.debt_links / debt_sms_log). The balance itself keeps coming from `v_enrollment_balances`
 * (MySQL) / owedByEnrollment() (JSON); this feature never changes money.
 *
 * Safety rules, mirroring the old reminder job:
 *   - CRM_DEBT_SMS_ENABLED === '1' is a hard gate; settings can only disable on top of it, never enable.
 *   - CRM_DEBT_SMS_TEST_MOBILE, when set, is the ONLY number that can ever receive; every other eligible
 *     trainee is logged as `skipped_test_mode` so a real number cannot receive during a trial.
 *   - One SMS per trainee per day: UNIQUE(student_id, send_day). The slot is reserved as 'sending' before
 *     sms.ir is called; a duplicate key means another run already handled it. The env test mobile always
 *     wins over a settings value, which can only apply while the env value is empty.
 *   - Preview / dry runs create no links and write no log rows.
 *
 * The text is the sms.ir verify template (default 472328, «مانده بدهی»), sent through the shared SMS helper
 * (../shared/sms sendTemplate, key `debt_balance` in MySQL sms_templates; when that row is missing the
 * configured template id is used with params NAME,AMOUNT,CODE). The CRM only supplies NAME / AMOUNT / CODE;
 * the template renders the link as kermanshahcart.ir/p/#CODE#. The API key is env-only (SMS_API_KEY). AMOUNT is Toman with Persian thousands separators and no
 * "تومان" (the template has it). Full phone numbers and the API key are never stored.
 */
import type express from 'express';
import crypto from 'crypto';
import { toJalaali } from 'jalaali-js';
import * as db from './mysql-socks';
import { owedByEnrollment } from './src/utils/finance';

export type DebtSmsStatus = 'sending' | 'sent' | 'failed' | 'skipped_test_mode';
export type DebtSmsReason = 'ok' | 'already_sent' | 'no_debt' | 'no_mobile' | 'test_mode_skip' | 'disabled' | 'not_configured' | 'link_failed';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PLACEHOLDER_CODE = 'XXXXXXXXXXXX';
const PREVIEW_TEMPLATE = '{NAME} عزیز، مانده بدهی شما {AMOUNT} تومان است. پرداخت: {LINK}';
const DEFAULT_PAYMENT_BASE = 'https://kermanshahcart.ir/p/';
const DEBT_LINK_DAYS = 7;

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
const phoneKey = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const maskPhone = (v: unknown) => { const k = phoneKey(v); return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const maskLast = (last: unknown) => { const s = String(last ?? '').trim(); return s ? `${s.slice(0, 1)}***` : ''; };
const maskName = (first: unknown, last: unknown) => [String(first ?? '').trim(), maskLast(last)].filter(Boolean).join(' ').trim();
const intOrNull = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const money = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const faMoney = (n: number) => money(n).toLocaleString('fa-IR');
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const sqlDateTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function randomLinkCode(len = 12): string {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += BASE62[buf[i] % BASE62.length];
  return out;
}

/** The current Jalali date (yyyy/mm/dd) in Tehran, converted with jalaali-js. */
export function jalaliTodayTehran(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const { jy, jm, jd } = toJalaali(get('year'), get('month'), get('day'));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${jy}/${p2(jm)}/${p2(jd)}`;
}

export type DebtSmsConfig = {
  /** Hard result: the env flag is on AND the settings override is not false. */
  enabled: boolean;
  /** The env flag alone (CRM_DEBT_SMS_ENABLED === '1'); settings can never turn it on. */
  envEnabled: boolean;
  templateId: number;
  /** Normalized mobile that alone may receive while test mode is on ('' = disabled). */
  testMobile: string;
  /** True when the test mobile comes from the env and cannot be changed from settings. */
  testMobileEnv: boolean;
  /** The shared SMS helper has an API key (env SMS_API_KEY); verify templates need no line number. */
  configured: boolean;
  /** Public base of the payment link; the short code is appended (env CRM_PAYMENT_LINK_BASE). */
  paymentBase: string;
};

export function debtSmsConfig(settings: any, normalizeMobile: (v: unknown) => string, smsConfigured = false): DebtSmsConfig {
  const s = (settings && settings.debt_sms) || {};
  const has = (v: unknown) => v !== undefined && v !== null && v !== '';
  const envEnabled = process.env.CRM_DEBT_SMS_ENABLED === '1';
  const enabled = envEnabled && s.enabled !== false;
  const templateId = Number(has(s.template_id) ? s.template_id : 472328) || 472328;
  const envTestMobile = normalizeMobile(process.env.CRM_DEBT_SMS_TEST_MOBILE ?? '');
  const testMobile = envTestMobile || normalizeMobile(has(s.test_mobile) ? s.test_mobile : '');
  const paymentBase = String(process.env.CRM_PAYMENT_LINK_BASE || DEFAULT_PAYMENT_BASE);
  return { enabled, envEnabled, templateId, testMobile, testMobileEnv: !!envTestMobile, configured: !!smsConfigured, paymentBase };
}

export async function ensureDebtSmsSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_debt_links (
      code CHAR(12) NOT NULL PRIMARY KEY,
      student_id INT NOT NULL,
      amount BIGINT NOT NULL COMMENT 'Toman: the full remaining balance when the SMS was sent',
      expires_at DATETIME NULL,
      used_at DATETIME NULL,
      online_payment_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_debt_link_student (student_id),
      KEY idx_debt_link_payment (online_payment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: remaining-debt payment links / لینک پرداخت مانده بدهی'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_debt_sms_log (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      send_day CHAR(10) NOT NULL COMMENT 'Jalali yyyy/mm/dd the SMS is sent on',
      mobile_masked VARCHAR(20) NULL,
      amount BIGINT NOT NULL COMMENT 'Remaining balance at send time',
      link_code CHAR(12) NULL,
      status ENUM('sending','sent','failed','skipped_test_mode') NOT NULL,
      provider_message_id VARCHAR(64) NULL,
      error VARCHAR(255) NULL,
      created_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_debt_sms_day (student_id, send_day),
      KEY idx_debt_sms_day (send_day, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: remaining-debt SMS log / پیامک مانده بدهی'`);
  } catch (err: any) {
    console.warn('crm_debt_sms schema setup failed:', err.message);
  }
}

/* ─────────────────────────────── debt links ─────────────────────────────── */

export type DebtLinkRow = {
  code: string; student_id: number; amount: number; expires_at: string | null;
  used_at: string | null; online_payment_id: number | null; created_at?: string;
};

export type DebtLinkResolved =
  | { status: 'ok'; link: DebtLinkRow; student_id: number; amount: number; expires_at: string | null; student: { first_name: string; last_name: string; phone_masked: string } }
  | { status: 'not_found' | 'expired' | 'used' };

export type DebtLinkStoreDeps = {
  readJsonDb: () => any;
  writeJsonDb: (store: any) => void;
};

export type DebtLinkStore = ReturnType<typeof createDebtLinkStore>;

/** Debt links used by the debt-SMS feature and by the trainee payment routes (onlinePayments.ts). */
export function createDebtLinkStore(deps: DebtLinkStoreDeps) {
  const jsonLinks = (store: any): any[] => { if (!Array.isArray(store.debt_links)) store.debt_links = []; return store.debt_links; };

  async function studentInfo(studentId: number): Promise<{ first_name: string; last_name: string; phone_number: string } | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>('SELECT first_name, last_name, phone_number FROM students WHERE student_id = ?', [studentId]);
      return row || null;
    }
    const s = (deps.readJsonDb().students || []).find((x: any) => Number(x.id) === studentId);
    return s ? { first_name: s.first_name || '', last_name: s.last_name || '', phone_number: s.phone_number || '' } : null;
  }

  /** The trainee's total remaining balance over all enrollments (each clamped at 0). */
  async function studentDebt(studentId: number): Promise<number> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>(
        `SELECT CAST(COALESCE(SUM(GREATEST(balance_due, 0)), 0) AS DECIMAL(15,2)) AS debt
         FROM v_enrollment_balances WHERE student_id = ?`, [studentId]);
      return Math.max(0, Number(row?.debt) || 0);
    }
    const store = deps.readJsonDb();
    const enrollments = (store.enrollments || []).filter((e: any) => Number(e.student_id) === studentId);
    const ids = new Set(enrollments.map((e: any) => Number(e.id)));
    const payments = (store.payments || []).filter((p: any) => p.enrollment_id && ids.has(Number(p.enrollment_id)));
    const owed = owedByEnrollment(
      enrollments.map((e: any) => ({ id: Number(e.id), final_price: Number(e.final_price) || 0 })),
      payments.map((p: any) => ({ enrollment_id: Number(p.enrollment_id), amount: Number(p.amount) || 0 })),
    );
    let debt = 0;
    for (const v of owed.values()) debt += v;
    return debt;
  }

  /** Oldest still-owing enrollment (to attach an online payment to, like splitPayment does). */
  async function oldestOwingEnrollment(studentId: number): Promise<number | null> {
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<any>(
        `SELECT enrollment_id FROM v_enrollment_balances
         WHERE student_id = ? AND GREATEST(COALESCE(balance_due, 0), 0) > 0
         ORDER BY enrollment_id ASC LIMIT 1`, [studentId]);
      return row ? Number(row.enrollment_id) : null;
    }
    const store = deps.readJsonDb();
    const enrollments = (store.enrollments || [])
      .filter((e: any) => Number(e.student_id) === studentId)
      .sort((a: any, b: any) => Number(a.id) - Number(b.id));
    const ids = new Set(enrollments.map((e: any) => Number(e.id)));
    const payments = (store.payments || []).filter((p: any) => p.enrollment_id && ids.has(Number(p.enrollment_id)));
    const owed = owedByEnrollment(
      enrollments.map((e: any) => ({ id: Number(e.id), final_price: Number(e.final_price) || 0 })),
      payments.map((p: any) => ({ enrollment_id: Number(p.enrollment_id), amount: Number(p.amount) || 0 })),
    );
    for (const e of enrollments) if ((owed.get(Number(e.id)) || 0) > 0) return Number(e.id);
    return null;
  }

  async function createLink(studentId: number, amount: number, expiresAt: string | null): Promise<DebtLinkRow> {
    if (db.isMysqlEnabled()) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomLinkCode();
        try {
          await db.sqlExec('INSERT INTO crm_debt_links (code, student_id, amount, expires_at) VALUES (?, ?, ?, ?)',
            [code, studentId, money(amount), expiresAt]);
          return { code, student_id: studentId, amount: money(amount), expires_at: expiresAt, used_at: null, online_payment_id: null };
        } catch (err: any) {
          if (err?.code !== 'ER_DUP_ENTRY') throw err;
        }
      }
      throw Object.assign(new Error('ساخت کد پرداخت ناموفق بود؛ دوباره تلاش کنید.'), { status: 500 });
    }
    const store = deps.readJsonDb();
    const list = jsonLinks(store);
    const taken = new Set(list.map((l: any) => String(l.code)));
    let code = randomLinkCode();
    while (taken.has(code)) code = randomLinkCode();
    const row: DebtLinkRow = { code, student_id: studentId, amount: money(amount), expires_at: expiresAt, used_at: null, online_payment_id: null, created_at: new Date().toISOString() };
    list.push(row);
    deps.writeJsonDb(store);
    return row;
  }

  async function findByCode(code: string): Promise<DebtLinkRow | null> {
    const clean = String(code || '').trim();
    if (!/^[0-9A-Za-z]{12}$/.test(clean)) return null;
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<DebtLinkRow>(
        'SELECT code, student_id, amount, expires_at, used_at, online_payment_id, created_at FROM crm_debt_links WHERE code = ?', [clean]);
      return row || null;
    }
    return (jsonLinks(deps.readJsonDb()).find((l: any) => String(l.code) === clean) as DebtLinkRow) || null;
  }

  /** Link + masked student, or the reason it cannot be used. */
  async function resolveLink(code: string): Promise<DebtLinkResolved> {
    const link = await findByCode(code);
    if (!link) return { status: 'not_found' };
    if (link.used_at) return { status: 'used' };
    if (link.expires_at && Date.parse(link.expires_at) < Date.now()) return { status: 'expired' };
    const student = await studentInfo(Number(link.student_id));
    return {
      status: 'ok', link, student_id: Number(link.student_id), amount: money(link.amount), expires_at: link.expires_at || null,
      student: { first_name: student?.first_name || '', last_name: student?.last_name || '', phone_masked: maskPhone(student?.phone_number) },
    };
  }

  /** Links the link to the online payment that was started from it (only the first attempt wins). */
  async function attachPayment(code: string, onlinePaymentId: number): Promise<void> {
    if (db.isMysqlEnabled()) {
      await db.sqlExec('UPDATE crm_debt_links SET online_payment_id = ? WHERE code = ? AND online_payment_id IS NULL', [onlinePaymentId, String(code)]);
      return;
    }
    const store = deps.readJsonDb();
    const row = jsonLinks(store).find((l: any) => String(l.code) === String(code));
    if (!row || row.online_payment_id) return;
    row.online_payment_id = onlinePaymentId;
    deps.writeJsonDb(store);
  }

  /** Burns the link tied to a paid online payment. Idempotent (only the first call sets used_at). */
  async function markUsedByPayment(onlinePaymentId: number): Promise<void> {
    if (!intOrNull(onlinePaymentId)) return;
    if (db.isMysqlEnabled()) {
      await db.sqlExec('UPDATE crm_debt_links SET used_at = NOW() WHERE online_payment_id = ? AND used_at IS NULL', [onlinePaymentId]);
      return;
    }
    const store = deps.readJsonDb();
    const row = jsonLinks(store).find((l: any) => Number(l.online_payment_id) === Number(onlinePaymentId) && !l.used_at);
    if (!row) return;
    row.used_at = new Date().toISOString();
    deps.writeJsonDb(store);
  }

  /** The debt link a given online payment was started from (null when the payment came from elsewhere). */
  async function findByPayment(onlinePaymentId: number): Promise<DebtLinkRow | null> {
    if (!intOrNull(onlinePaymentId)) return null;
    if (db.isMysqlEnabled()) {
      const [row] = await db.sql<DebtLinkRow>(
        'SELECT code, student_id, amount, expires_at, used_at, online_payment_id, created_at FROM crm_debt_links WHERE online_payment_id = ? LIMIT 1',
        [onlinePaymentId]);
      return row || null;
    }
    return (jsonLinks(deps.readJsonDb()).find((l: any) => Number(l.online_payment_id) === Number(onlinePaymentId)) as DebtLinkRow) || null;
  }

  return { studentInfo, studentDebt, oldestOwingEnrollment, createLink, findByCode, resolveLink, attachPayment, markUsedByPayment, findByPayment };
}

/* ─────────────────────────────── preview / send ─────────────────────────────── */

export type DebtSmsCandidate = { student_id: number; first_name: string; last_name: string; phone_number: string; debt: number };

export type DebtSmsPreviewItem = {
  student_id: number; name_masked: string; mobile_masked: string; debt: number; amount_text: string;
  would_send: boolean; reason: DebtSmsReason; text_preview: string;
};

const linkUrl = (cfg: DebtSmsConfig, code: string) => `${String(cfg.paymentBase || DEFAULT_PAYMENT_BASE).replace(/\/+$/, '')}/${code}`;

function renderPreview(name: string, amountText: string, link: string): string {
  return PREVIEW_TEMPLATE.replace('{NAME}', name).replace('{AMOUNT}', amountText).replace('{LINK}', link);
}

/** Why a candidate would (not) get a message; shared by preview and both send paths. */
function evaluate(row: DebtSmsCandidate, cfg: DebtSmsConfig, placeholderLink: string, normalizeMobile: (v: unknown) => string) {
  const mobile = normalizeMobile(row.phone_number);
  const amountText = faMoney(row.debt);
  const name = String(row.first_name || '').trim() || [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  const item: DebtSmsPreviewItem = {
    student_id: row.student_id, name_masked: maskName(row.first_name, row.last_name), mobile_masked: maskPhone(row.phone_number),
    debt: row.debt, amount_text: amountText, would_send: false, reason: 'ok',
    text_preview: renderPreview(name || 'کارآموز', amountText, placeholderLink),
  };
  if (!cfg.enabled) { item.reason = 'disabled'; return { item, mobile, name }; }
  if (!/^09\d{9}$/.test(mobile)) { item.reason = 'no_mobile'; return { item, mobile, name }; }
  if (row.debt <= 0) { item.reason = 'no_debt'; return { item, mobile, name }; }
  if (cfg.testMobile && mobile !== cfg.testMobile) { item.reason = 'test_mode_skip'; return { item, mobile, name }; }
  if (!cfg.configured) { item.reason = 'not_configured'; return { item, mobile, name }; }
  item.would_send = true;
  return { item, mobile, name };
}

/* ─────────────────────────────── log rows ─────────────────────────────── */

const jsonLogList = (store: any): any[] => { if (!Array.isArray(store.debt_sms_log)) store.debt_sms_log = []; return store.debt_sms_log; };

/** Reserves the (student_id, send_day) slot; false when it is already taken (someone else sent today). */
async function reserveLog(deps: DebtSmsDeps, values: { student_id: number; send_day: string; mobile_masked: string | null; amount: number; created_by: string | null }): Promise<boolean> {
  if (db.isMysqlEnabled()) {
    try {
      await db.sqlExec(
        `INSERT INTO crm_debt_sms_log (student_id, send_day, mobile_masked, amount, status, created_by)
         VALUES (?, ?, ?, ?, 'sending', ?)`,
        [values.student_id, values.send_day, values.mobile_masked, money(values.amount), values.created_by]);
      return true;
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') return false;
      throw err;
    }
  }
  const json = deps.readJsonDb();
  const list = jsonLogList(json);
  if (list.some((r: any) => Number(r.student_id) === values.student_id && String(r.send_day) === values.send_day)) return false;
  list.push({
    id: list.reduce((m: number, r: any) => Math.max(m, Number(r.id) || 0), 0) + 1,
    student_id: values.student_id, send_day: values.send_day, mobile_masked: values.mobile_masked,
    amount: money(values.amount), link_code: null, status: 'sending', provider_message_id: null,
    error: null, created_by: values.created_by, created_at: new Date().toISOString(),
  });
  deps.writeJsonDb(json);
  return true;
}

/** Writes a one-shot row for a candidate that is skipped in test mode (no reservation, no send). */
async function logSkippedTestMode(deps: DebtSmsDeps, values: { student_id: number; send_day: string; mobile_masked: string | null; amount: number; created_by: string | null }): Promise<void> {
  if (db.isMysqlEnabled()) {
    try {
      await db.sqlExec(
        `INSERT INTO crm_debt_sms_log (student_id, send_day, mobile_masked, amount, status, created_by)
         VALUES (?, ?, ?, ?, 'skipped_test_mode', ?)`,
        [values.student_id, values.send_day, values.mobile_masked, money(values.amount), values.created_by]);
    } catch (err: any) { if (err?.code !== 'ER_DUP_ENTRY') throw err; }
    return;
  }
  const json = deps.readJsonDb();
  const list = jsonLogList(json);
  if (list.some((r: any) => Number(r.student_id) === values.student_id && String(r.send_day) === values.send_day)) return;
  list.push({
    id: list.reduce((m: number, r: any) => Math.max(m, Number(r.id) || 0), 0) + 1,
    student_id: values.student_id, send_day: values.send_day, mobile_masked: values.mobile_masked,
    amount: money(values.amount), link_code: null, status: 'skipped_test_mode', provider_message_id: null,
    error: null, created_by: values.created_by, created_at: new Date().toISOString(),
  });
  deps.writeJsonDb(json);
}

async function finalizeLog(deps: DebtSmsDeps, values: {
  student_id: number; send_day: string; status: 'sent' | 'failed'; link_code: string | null;
  provider_message_id?: string | null; error?: string | null;
}): Promise<void> {
  if (db.isMysqlEnabled()) {
    await db.sqlExec(
      `UPDATE crm_debt_sms_log SET status = ?, link_code = ?, provider_message_id = ?, error = ?
       WHERE student_id = ? AND send_day = ?`,
      [values.status, values.link_code, values.provider_message_id ?? null, values.error ?? null, values.student_id, values.send_day]);
    return;
  }
  const json = deps.readJsonDb();
  const row = jsonLogList(json).find((r: any) => Number(r.student_id) === values.student_id && String(r.send_day) === values.send_day);
  if (!row) return;
  row.status = values.status;
  row.link_code = values.link_code;
  row.provider_message_id = values.provider_message_id ?? null;
  row.error = values.error ?? null;
  deps.writeJsonDb(json);
}

/** sms_templates key of the debt SMS (shared helper); its provider_template_id wins over cfg.templateId. */
export const DEBT_SMS_TEMPLATE_KEY = 'debt_balance';

/** One template message via the shared SMS helper; never sends when SMS is not configured. */
async function sendTemplate(deps: DebtSmsDeps, cfg: DebtSmsConfig, mobile: string, vars: { NAME: string; AMOUNT: string; CODE: string }): Promise<{ ok: boolean; messageId: string | null; error?: string }> {
  if (!cfg.configured) return { ok: false, messageId: null, error: 'درگاه پیامک تنظیم نشده است (SMS_API_KEY در env).' };
  try {
    const r = await deps.sms.sendTemplate(DEBT_SMS_TEMPLATE_KEY, mobile,
      { ...vars, name: vars.NAME, amount: vars.AMOUNT, code: vars.CODE },
      { templateId: String(cfg.templateId), param: 'NAME,AMOUNT,CODE' });
    return { ok: !!r.ok, messageId: null, error: r.ok ? undefined : String(r.detail || r.status || 'ارسال پیامک ناموفق بود') };
  } catch (err: any) {
    return { ok: false, messageId: null, error: err?.message || 'ارسال پیامک ناموفق بود' };
  }
}

export type DebtSmsDeps = {
  session: (req: express.Request) => { username: string; role: string } | null;
  sanitize: (v: unknown, max: number) => string;
  normalizeMobile: (v: unknown) => string;
  /** Live settings object (readDb().settings), for the overrides. */
  settings: () => any;
  /** Persists the settings overrides (merged into settings.debt_sms). */
  saveSettings: (patch: Record<string, any>) => void;
  readJsonDb: () => any;
  writeJsonDb: (store: any) => void;
  links: DebtLinkStore;
  /** Shared SMS helper (../shared/sms createSms): template send + whether an API key is configured. */
  sms: {
    sendTemplate: (key: string, mobile: string, vars: Record<string, unknown>, fallback?: { templateId?: string; param?: string }) => Promise<{ ok: boolean; status: string; detail?: string }>;
    configured: () => boolean;
  };
  log?: (msg: string) => void;
};

/** Trainees who still owe money, optionally limited to one course term and/or an explicit id set. */
async function candidates(deps: DebtSmsDeps, opts: { term_id?: number | null; student_ids?: number[] } = {}): Promise<DebtSmsCandidate[]> {
  const studentIds = Array.isArray(opts.student_ids) ? opts.student_ids.filter((n) => intOrNull(n)) : null;
  if (db.isMysqlEnabled()) {
    const where: string[] = ['COALESCE(b.debt, 0) > 0']; const params: any[] = [];
    if (intOrNull(opts.term_id)) {
      const [t] = await db.sql<any>('SELECT course_id, course_number FROM crm_course_terms WHERE id = ?', [intOrNull(opts.term_id)]);
      if (!t) return [];
      where.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.course_id = ? AND e.course_number = ?)');
      params.push(t.course_id, t.course_number);
    }
    if (studentIds && studentIds.length) {
      where.push(`s.student_id IN (${studentIds.map(() => '?').join(', ')})`);
      params.push(...studentIds);
    }
    const rows = await db.sql<any>(
      `SELECT s.student_id, s.first_name, s.last_name, s.phone_number, COALESCE(b.debt, 0) AS debt
       FROM students s
       LEFT JOIN (SELECT student_id, SUM(GREATEST(balance_due, 0)) AS debt FROM v_enrollment_balances GROUP BY student_id) b ON b.student_id = s.student_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.last_name, s.first_name LIMIT 2000`, params);
    return rows.map((r: any) => ({ student_id: Number(r.student_id), first_name: r.first_name || '', last_name: r.last_name || '', phone_number: r.phone_number || '', debt: Math.max(0, Number(r.debt) || 0) }));
  }
  const store = deps.readJsonDb();
  const students = (store.students || []) as any[];
  const enrollments = (store.enrollments || []) as any[];
  const payments = (store.payments || []) as any[];
  const out: DebtSmsCandidate[] = [];
  const wanted = studentIds && studentIds.length ? new Set(studentIds.map(Number)) : null;
  for (const s of students) {
    const sid = Number(s.id);
    if (wanted && !wanted.has(sid)) continue;
    const enr = enrollments.filter((e: any) => Number(e.student_id) === sid);
    if (!enr.length) continue;
    const ids = new Set(enr.map((e: any) => Number(e.id)));
    const pays = payments.filter((p: any) => p.enrollment_id && ids.has(Number(p.enrollment_id)));
    const owed = owedByEnrollment(
      enr.map((e: any) => ({ id: Number(e.id), final_price: Number(e.final_price) || 0 })),
      pays.map((p: any) => ({ enrollment_id: Number(p.enrollment_id), amount: Number(p.amount) || 0 })),
    );
    let debt = 0;
    for (const v of owed.values()) debt += v;
    if (debt <= 0) continue;
    out.push({ student_id: sid, first_name: s.first_name || '', last_name: s.last_name || '', phone_number: s.phone_number || '', debt });
  }
  return out;
}

/** Builds the preview list without creating links or writing any log row (placeholder link only). */
export async function previewDebtSms(deps: DebtSmsDeps, opts: { term_id?: number | null; student_ids?: number[] } = {}): Promise<{ items: DebtSmsPreviewItem[]; enabled: boolean }> {
  const cfg = debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured());
  const placeholder = linkUrl(cfg, PLACEHOLDER_CODE);
  const rows = await candidates(deps, opts);
  return { enabled: cfg.enabled, items: rows.map((r) => evaluate(r, cfg, placeholder, deps.normalizeMobile).item) };
}

export type DebtSmsSendOutcome = { status: DebtSmsStatus | 'already_sent' | 'skipped'; reason: DebtSmsReason };

async function sendOne(deps: DebtSmsDeps, cfg: DebtSmsConfig, sendDay: string, row: DebtSmsCandidate, createdBy: string | null): Promise<DebtSmsSendOutcome> {
  const { item, mobile, name } = evaluate(row, cfg, '', deps.normalizeMobile);
  if (item.reason === 'test_mode_skip') {
    await logSkippedTestMode(deps, { student_id: row.student_id, send_day: sendDay, mobile_masked: maskPhone(row.phone_number), amount: row.debt, created_by: createdBy });
    return { status: 'skipped_test_mode', reason: 'test_mode_skip' };
  }
  if (!item.would_send) return { status: 'skipped', reason: item.reason };

  const reserved = await reserveLog(deps, { student_id: row.student_id, send_day: sendDay, mobile_masked: maskPhone(row.phone_number), amount: row.debt, created_by: createdBy });
  if (!reserved) return { status: 'already_sent', reason: 'already_sent' };

  // The link amount is the full remaining balance at send time; never fall back to a placeholder in a real send.
  let code: string | null = null;
  try {
    const link = await deps.links.createLink(row.student_id, row.debt, sqlDateTime(new Date(Date.now() + DEBT_LINK_DAYS * 86400_000)));
    code = link.code;
  } catch (e: any) {
    deps.log?.(`debt link creation failed for student ${row.student_id}: ${e?.message}`);
    await finalizeLog(deps, { student_id: row.student_id, send_day: sendDay, status: 'failed', link_code: null, error: 'link_failed' });
    return { status: 'failed', reason: 'link_failed' };
  }

  const result = await sendTemplate(deps, cfg, mobile, { NAME: name || 'هنرجو', AMOUNT: item.amount_text, CODE: code });
  await finalizeLog(deps, {
    student_id: row.student_id, send_day: sendDay, status: result.ok ? 'sent' : 'failed', link_code: code,
    provider_message_id: result.messageId, error: result.ok ? null : deps.sanitize(result.error, 255),
  });
  return { status: result.ok ? 'sent' : 'failed', reason: result.ok ? 'ok' : undefined };
}

/** Sends the debt SMS to one trainee (respecting the once-a-day slot). */
export async function sendDebtSmsToStudent(deps: DebtSmsDeps, studentId: number, createdBy: string | null): Promise<DebtSmsSendOutcome> {
  const cfg = debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured());
  if (!cfg.enabled) throw Object.assign(new Error('ارسال پیامک بدهی روی سرور غیرفعال است.'), { status: 403 });
  const rows = await candidates(deps, { student_ids: [studentId] });
  const row = rows[0];
  if (!row) throw Object.assign(new Error('این کارآموز مانده بدهی ندارد.'), { status: 400 });
  return sendOne(deps, cfg, jalaliTodayTehran(), row, createdBy);
}

export type DebtSmsRunResult = { sent: number; failed: number; skipped: number; dry_run: number; results: Array<{ student_id: number; status: DebtSmsStatus | 'already_sent' | 'skipped'; reason?: DebtSmsReason }> };

/** In-process lock: two bulk runs can never overlap inside this process. */
let bulkRunInProgress = false;

/**
 * A batch pass over the debtors. `dryRun` only reports what would happen and writes no rows; otherwise
 * sms.ir is called once per trainee. The (student_id, send_day) slot is reserved as 'sending' before the
 * SMS is attempted, so two concurrent runs can never send twice for the same trainee/day.
 */
export async function runDebtSmsBulk(deps: DebtSmsDeps, opts: { dryRun?: boolean; term_id?: number | null; student_ids?: number[]; createdBy?: string | null } = {}): Promise<DebtSmsRunResult> {
  if (bulkRunInProgress) throw Object.assign(new Error('یک اجرای ارسال در حال انجام است؛ کمی بعد دوباره تلاش کنید.'), { status: 409 });
  bulkRunInProgress = true;
  try {
    const cfg = debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured());
    const sendDay = jalaliTodayTehran();
    const out: DebtSmsRunResult = { sent: 0, failed: 0, skipped: 0, dry_run: 0, results: [] };
    if (!cfg.enabled) return out;
    const rows = await candidates(deps, { term_id: opts.term_id, student_ids: opts.student_ids });
    for (const row of rows) {
      const { item } = evaluate(row, cfg, '', deps.normalizeMobile);
      if (item.reason === 'test_mode_skip') {
        if (!opts.dryRun) await logSkippedTestMode(deps, { student_id: row.student_id, send_day: sendDay, mobile_masked: maskPhone(row.phone_number), amount: row.debt, created_by: opts.createdBy || null });
        out.skipped += 1; out.results.push({ student_id: row.student_id, status: 'skipped_test_mode', reason: 'test_mode_skip' }); continue;
      }
      if (!item.would_send) {
        out.skipped += 1; out.results.push({ student_id: row.student_id, status: 'skipped', reason: item.reason }); continue;
      }
      if (opts.dryRun) { out.dry_run += 1; out.results.push({ student_id: row.student_id, status: 'skipped', reason: 'ok' }); continue; }
      const res = await sendOne(deps, cfg, sendDay, row, opts.createdBy || null);
      if (res.status === 'sent') out.sent += 1;
      else if (res.status === 'failed') out.failed += 1;
      else out.skipped += 1;
      out.results.push({ student_id: row.student_id, status: res.status, reason: res.reason });
    }
    return out;
  } finally {
    bulkRunInProgress = false;
  }
}

/* ─────────────────────────────── HTTP routes ─────────────────────────────── */

export function registerDebtSms(app: express.Express, deps: DebtSmsDeps) {
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response) => { fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' })); };
  const staffRole = (req: express.Request): string => deps.session(req)?.role || '';
  const requireStaffRole = (req: express.Request, res: express.Response): boolean => {
    const role = staffRole(req);
    if (role !== 'admin' && role !== 'cashier') { res.status(403).json({ error: 'دسترسی ندارید.' }); return false; }
    return true;
  };
  const requireAdmin = (req: express.Request, res: express.Response): boolean => {
    if (staffRole(req) !== 'admin') { res.status(403).json({ error: 'فقط مدیر' }); return false; }
    return true;
  };
  const intList = (v: unknown): number[] | undefined => Array.isArray(v) ? v.map(intOrNull).filter((n): n is number => !!n) : undefined;

  const settingsPayload = (cfg: DebtSmsConfig) => ({
    enabled: cfg.enabled, env_enabled: cfg.envEnabled, template_id: cfg.templateId,
    test_mode: !!cfg.testMobile, test_mobile_masked: maskPhone(cfg.testMobile), test_mobile_env: cfg.testMobileEnv,
    configured: cfg.configured, payment_base: cfg.paymentBase, today: jalaliTodayTehran(), timezone: 'Asia/Tehran',
  });

  app.get('/api/debt-sms/settings', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    res.json(settingsPayload(debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured())));
  }));

  app.put('/api/debt-sms/settings', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const patch: Record<string, any> = {};
    // The env flag is the hard gate; settings can only disable, never enable while it is off.
    if (b.enabled !== undefined) {
      if (b.enabled && process.env.CRM_DEBT_SMS_ENABLED !== '1') {
        return res.status(400).json({ error: 'برای فعال‌سازی، ابتدا CRM_DEBT_SMS_ENABLED=1 را روی سرور تنظیم کنید.' });
      }
      patch.enabled = !!b.enabled;
    }
    if (b.template_id !== undefined) patch.template_id = intOrNull(b.template_id) || 472328;
    if (b.test_mobile !== undefined) patch.test_mobile = b.test_mobile ? deps.normalizeMobile(b.test_mobile) : '';
    deps.saveSettings(patch);
    res.json({ ok: true, ...settingsPayload(debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured())) });
  }));

  app.get('/api/debt-sms/preview', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const q = req.query as Record<string, any>;
    const { items, enabled } = await previewDebtSms(deps, { term_id: intOrNull(q.term_id) });
    const cfg = debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured());
    res.json({
      enabled, env_enabled: cfg.envEnabled, configured: cfg.configured, test_mode: !!cfg.testMobile,
      test_mobile_masked: maskPhone(cfg.testMobile), test_mobile_env: cfg.testMobileEnv, template_id: cfg.templateId,
      payment_base: cfg.paymentBase, today: jalaliTodayTehran(),
      total: items.length, would_send: items.filter((i) => i.would_send).length, items,
    });
  }));

  app.get('/api/debt-sms/log', wrap(async (req, res) => {
    if (!requireStaffRole(req, res)) return;
    const limit = Math.min(Math.max(intOrNull(req.query.limit) || 200, 1), 1000);
    if (db.isMysqlEnabled()) {
      const rows = await db.sql<any>(`
        SELECT l.id, l.student_id, l.send_day, l.mobile_masked, l.amount, l.link_code, l.status,
               l.provider_message_id, l.error, l.created_by, l.created_at, s.first_name, s.last_name
        FROM crm_debt_sms_log l
        LEFT JOIN students s ON s.student_id = l.student_id
        ORDER BY l.id DESC LIMIT ${limit}`);
      return res.json(rows.map((r: any) => ({
        id: r.id, student_id: Number(r.student_id), name_masked: maskName(r.first_name, r.last_name),
        send_day: r.send_day, mobile_masked: r.mobile_masked || '', amount: Number(r.amount) || 0,
        link_code: r.link_code || null, status: r.status, provider_message_id: r.provider_message_id || null,
        error: r.error || null, created_by: r.created_by || null, created_at: r.created_at,
      })));
    }
    const store = deps.readJsonDb();
    const list = jsonLogList(store).slice().sort((a: any, b: any) => Number(b.id) - Number(a.id)).slice(0, limit);
    res.json(list.map((r: any) => {
      const s = (store.students || []).find((x: any) => Number(x.id) === Number(r.student_id));
      return {
        id: r.id, student_id: Number(r.student_id), name_masked: maskName(s?.first_name, s?.last_name),
        send_day: r.send_day, mobile_masked: r.mobile_masked || '', amount: Number(r.amount) || 0,
        link_code: r.link_code || null, status: r.status, provider_message_id: r.provider_message_id || null,
        error: r.error || null, created_by: r.created_by || null, created_at: r.created_at,
      };
    }));
  }));

  app.post('/api/debt-sms/student/:id', wrap(async (req, res) => {
    const session = deps.session(req);
    if (!requireStaffRole(req, res)) return;
    const id = intOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    if (req.body?.confirm !== 'ارسال') return res.status(400).json({ error: 'برای ارسال باید کلمه «ارسال» را تایپ کنید.' });
    const outcome = await sendDebtSmsToStudent(deps, id, session?.username || null);
    if (outcome.status === 'already_sent') return res.status(409).json({ error: 'امروز قبلاً برای این کارآموز پیامک بدهی ارسال شده است.', status: outcome.status });
    res.json({ ok: true, status: outcome.status, reason: outcome.reason || null });
  }));

  app.post('/api/debt-sms/bulk', wrap(async (req, res) => {
    const session = deps.session(req);
    if (!requireStaffRole(req, res)) return;
    const cfg = debtSmsConfig(deps.settings(), deps.normalizeMobile, deps.sms.configured());
    if (!cfg.enabled) return res.status(403).json({ error: 'ارسال پیامک بدهی روی سرور غیرفعال است.' });
    if (req.body?.confirm !== 'ارسال') return res.status(400).json({ error: 'برای ارسال باید کلمه «ارسال» را تایپ کنید.' });
    const dryRun = req.body?.dry_run === true;
    const result = await runDebtSmsBulk(deps, {
      dryRun, term_id: intOrNull(req.body?.term_id), student_ids: intList(req.body?.student_ids), createdBy: session?.username || null,
    });
    res.json({ ok: true, dry_run: dryRun, sent: result.sent, failed: result.failed, skipped: result.skipped, dry_run_count: result.dry_run, results: result.results });
  }));
}
