/**
 * Automatic installment-reminder SMS (daily) with a per-installment Zarinpal link.
 *
 * Additive only: one new table `crm_installment_reminders` (JSON store fallback in
 * db_store.json.installment_reminders). Nothing is sent unless CRM_INSTALLMENT_REMINDER_ENABLED === '1';
 * that env flag is a hard gate and a settings value can only disable on top of it (never turn sending on
 * while the env flag is off): the cron task is only registered when enabled, and POST /run-now refuses with
 * the same rule. Test mode (CRM_REMINDER_TEST_MOBILE) makes every other recipient a logged
 * `skipped_test_mode`, so a real number can never receive a message during a trial; the env test mobile
 * always wins over a settings value, which can only apply while the env one is empty.
 *
 * The actual text comes from the SMS.ir template (default 472328); the CRM only supplies params
 * NAME / AMOUNT / DATE / LINK through the official `smsir-js` SDK. Full phone numbers and the API key are
 * never stored: reminder rows keep the masked phone only.
 */
import type express from 'express';
import { schedule as cronSchedule, validate as cronValidate } from 'node-cron';
import { Smsir } from 'smsir-js';
import * as db from './mysql-socks';
import { addJalaliDays } from './src/utils/jalali';
import { defaultLinkExpiry, type InstallmentStore } from './installments';

export type ReminderStatus = 'sending' | 'sent' | 'failed' | 'skipped_test_mode' | 'skipped_disabled' | 'dry_run';
export type ReminderReason = 'ok' | 'already_sent' | 'enrollment_settled' | 'no_mobile' | 'test_mode_skip' | 'disabled' | 'not_configured' | 'link_failed';

const PLACEHOLDER_CODE = 'XXXXXXXXXXXX';
const PREVIEW_TEMPLATE = '{NAME} عزیز، قسط {AMOUNT} شما در تاریخ {DATE} سررسید می‌شود. پرداخت: {LINK}';
const GRACE_MAX_DAYS = 60;

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
const phoneKey = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const maskPhone = (v: unknown) => { const k = phoneKey(v); return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const maskLast = (last: unknown) => { const s = String(last ?? '').trim(); return s ? `${s.slice(0, 1)}***` : ''; };
const maskName = (first: unknown, last: unknown) => [String(first ?? '').trim(), maskLast(last)].filter(Boolean).join(' ').trim();
const intOrNull = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const faMoney = (n: number) => Math.round(Number(n) || 0).toLocaleString('fa-IR');

export type ReminderConfig = {
  /** Hard result: the env flag is on AND the settings override is not false. */
  enabled: boolean;
  /** The env flag alone (CRM_INSTALLMENT_REMINDER_ENABLED === '1'); the settings can never turn this on. */
  envEnabled: boolean;
  daysBefore: number;
  templateId: number;
  cron: string;
  testMobile: string;
  /** True when the test mobile comes from the env (CRM_REMINDER_TEST_MOBILE) and cannot be changed from settings. */
  testMobileEnv: boolean;
  apiKey: string;
  lineNumber: string;
  configured: boolean;
};

/**
 * Env values, overridden by `settings.installment_reminders` when present, with two hard rules:
 * the env flag is a hard gate (a settings value can only disable, never enable) and the env test mobile
 * always wins (settings may set one only while the env value is empty).
 */
export function reminderConfig(settings: any, normalizeMobile: (v: unknown) => string): ReminderConfig {
  const s = (settings && settings.installment_reminders) || {};
  const gateways = (settings && settings.gateways) || {};
  const has = (v: unknown) => v !== undefined && v !== null && v !== '';
  const envEnabled = process.env.CRM_INSTALLMENT_REMINDER_ENABLED === '1';
  const enabled = envEnabled && s.enabled !== false;
  const daysBefore = Math.min(GRACE_MAX_DAYS, Math.max(0, Number(has(s.days_before) ? s.days_before : (process.env.CRM_REMINDER_DAYS_BEFORE ?? 2)) || 2));
  const templateId = Number(has(s.template_id) ? s.template_id : (process.env.SMSIR_REMINDER_TEMPLATE_ID ?? 472328)) || 472328;
  const cron = String(has(s.cron) ? s.cron : (process.env.CRM_REMINDER_CRON ?? '0 10 * * *')).trim() || '0 10 * * *';
  const envTestMobile = normalizeMobile(process.env.CRM_REMINDER_TEST_MOBILE ?? '');
  const testMobile = envTestMobile || normalizeMobile(has(s.test_mobile) ? s.test_mobile : '');
  // The sms.ir key may also come from the CRM's own SMS gateway when it is set to sms.ir.
  const apiKey = String(process.env.SMSIR_API_KEY || (gateways.sms_provider === 'smsir' ? gateways.sms_api_key : '') || '');
  const lineNumber = String(process.env.SMSIR_LINE_NUMBER || (gateways.sms_provider === 'smsir' ? gateways.sms_sender_line : '') || '');
  return { enabled, envEnabled, daysBefore, templateId, cron, testMobile, testMobileEnv: !!envTestMobile, apiKey, lineNumber, configured: !!(apiKey && lineNumber) };
}

export async function ensureInstallmentRemindersSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_installment_reminders (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      installment_id INT UNSIGNED NOT NULL,
      send_day CHAR(10) NOT NULL COMMENT 'Jalali yyyy/mm/dd the reminder is sent on',
      mobile_masked VARCHAR(20) NULL,
      status ENUM('sending','sent','failed','skipped_test_mode','skipped_disabled','dry_run') NOT NULL,
      provider_message_id VARCHAR(64) NULL,
      error VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_reminder_day (installment_id, send_day),
      KEY idx_reminder_day (send_day, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: installment reminder log / یادآوری اقساط'`);
    // Additive: an install of an earlier commit may have the table without the 'sending' reservation state.
    const [statusCol] = await db.sql<{ Type: string; Field: string }>(`SHOW COLUMNS FROM crm_installment_reminders LIKE 'status'`);
    if (statusCol && !String(statusCol.Type).includes("'sending'")) {
      await db.sqlExec(`ALTER TABLE crm_installment_reminders
        MODIFY status ENUM('sending','sent','failed','skipped_test_mode','skipped_disabled','dry_run') NOT NULL`);
    }
  } catch (err: any) {
    console.warn('crm_installment_reminders schema setup failed:', err.message);
  }
}

export type ReminderDeps = {
  store: InstallmentStore;
  session: (req: express.Request) => { username: string; role: string } | null;
  sanitize: (v: unknown, max: number) => string;
  normalizeMobile: (v: unknown) => string;
  jalaliToday: () => string;
  /** Public origin for links (PUBLIC_BASE_URL); may be '' in dev, links are then relative. */
  publicBaseUrl: () => string;
  /** Live settings object (readDb().settings), for the overrides. */
  settings: () => any;
  /** Persists the settings overrides (merged into settings.installment_reminders). */
  saveSettings: (patch: Record<string, any>) => void;
  readJsonDb: () => any;
  writeJsonDb: (store: any) => void;
  log?: (msg: string) => void;
};

type DueRow = Awaited<ReturnType<InstallmentStore['dueForReminder']>>[number];

export type ReminderPreviewItem = {
  installment_id: number; name_masked: string; mobile_masked: string; amount: number; amount_text: string;
  due_date: string; link_preview: string; text_preview: string; would_send: boolean; reason: ReminderReason;
};

const jsonReminderList = (store: any): any[] => { if (!Array.isArray(store.installment_reminders)) store.installment_reminders = []; return store.installment_reminders; };

function renderPreview(name: string, amountText: string, date: string, link: string): string {
  return PREVIEW_TEMPLATE
    .replace('{NAME}', name).replace('{AMOUNT}', amountText).replace('{DATE}', date).replace('{LINK}', link);
}

/** Why a due installment would (not) get a message; shared by preview and the real run. */
function evaluate(row: DueRow, deps: ReminderDeps, cfg: ReminderConfig, placeholderLink: string) {
  const mobile = deps.normalizeMobile(row.phone_number);
  const amountText = `${faMoney(row.amount)} تومان`;
  const name = String(row.first_name || '').trim() || [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  const item: ReminderPreviewItem = {
    installment_id: row.id, name_masked: maskName(row.first_name, row.last_name), mobile_masked: maskPhone(row.phone_number),
    amount: row.amount, amount_text: amountText, due_date: row.due_date_jalali, link_preview: placeholderLink,
    text_preview: renderPreview(name || 'کارآموز', amountText, row.due_date_jalali, placeholderLink),
    would_send: false, reason: 'ok',
  };
  if (!cfg.enabled) { item.reason = 'disabled'; return { item, mobile, name }; }
  if (!/^09\d{9}$/.test(mobile)) { item.reason = 'no_mobile'; return { item, mobile, name }; }
  if (row.remaining <= 0) { item.reason = 'enrollment_settled'; return { item, mobile, name }; }
  if (cfg.testMobile && mobile !== cfg.testMobile) { item.reason = 'test_mode_skip'; return { item, mobile, name }; }
  if (!cfg.configured) { item.reason = 'not_configured'; return { item, mobile, name }; }
  item.would_send = true;
  return { item, mobile, name };
}

/** Builds the preview list without creating links or writing any log row (placeholder link only). */
export async function previewReminders(deps: ReminderDeps, daysOverride?: number): Promise<{ target_date: string; items: ReminderPreviewItem[] }> {
  const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
  const days = daysOverride !== undefined && Number.isFinite(daysOverride) ? Math.min(GRACE_MAX_DAYS, Math.max(0, Math.round(daysOverride))) : cfg.daysBefore;
  const target = addJalaliDays(deps.jalaliToday(), days);
  const placeholder = linkUrl(deps, PLACEHOLDER_CODE);
  const rows = target ? await deps.store.dueForReminder(target) : [];
  return { target_date: target, items: rows.map((r) => evaluate(r, deps, cfg, placeholder).item) };
}

const linkUrl = (deps: ReminderDeps, code: string) => `${String(deps.publicBaseUrl() || '').replace(/\/$/, '')}/p/${code}`;

/** Inserts a reminder log row; false when UNIQUE(installment_id, send_day) already has it. */
async function insertReminderRow(deps: ReminderDeps, values: {
  installment_id: number; send_day: string; mobile_masked: string | null; status: ReminderStatus;
  provider_message_id?: string | null; error?: string | null;
}): Promise<boolean> {
  if (db.isMysqlEnabled()) {
    try {
      await db.sqlExec(
        `INSERT INTO crm_installment_reminders (installment_id, send_day, mobile_masked, status, provider_message_id, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [values.installment_id, values.send_day, values.mobile_masked, values.status, values.provider_message_id ?? null, values.error ?? null]);
      return true;
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') return false;
      throw err;
    }
  }
  const json = deps.readJsonDb();
  const list = jsonReminderList(json);
  if (list.some((r: any) => Number(r.installment_id) === values.installment_id && String(r.send_day) === values.send_day)) return false;
  list.push({
    id: list.reduce((m: number, r: any) => Math.max(m, Number(r.id) || 0), 0) + 1,
    installment_id: values.installment_id, send_day: values.send_day, mobile_masked: values.mobile_masked,
    status: values.status, provider_message_id: values.provider_message_id ?? null, error: values.error ?? null,
    created_at: new Date().toISOString(),
  });
  deps.writeJsonDb(json);
  return true;
}

/**
 * Reserves the (installment_id, send_day) slot before the SMS goes out: the row is inserted as
 * 'sending' and only the caller whose insert succeeded may send. A rejected UNIQUE key means another
 * run/cron already handled it (already_sent). Same behaviour in the JSON-store fallback.
 */
async function reserveReminderRow(deps: ReminderDeps, installmentId: number, sendDay: string, mobileMasked: string | null): Promise<boolean> {
  return insertReminderRow(deps, { installment_id: installmentId, send_day: sendDay, mobile_masked: mobileMasked, status: 'sending' });
}

/** Updates the reserved row with the final outcome (no-op when the row vanished). */
async function finalizeReminderRow(deps: ReminderDeps, values: {
  installment_id: number; send_day: string; status: 'sent' | 'failed' | 'skipped_test_mode';
  provider_message_id?: string | null; error?: string | null;
}): Promise<void> {
  if (db.isMysqlEnabled()) {
    await db.sqlExec(
      `UPDATE crm_installment_reminders SET status = ?, provider_message_id = ?, error = ?
       WHERE installment_id = ? AND send_day = ?`,
      [values.status, values.provider_message_id ?? null, values.error ?? null, values.installment_id, values.send_day]);
    return;
  }
  const json = deps.readJsonDb();
  const row = jsonReminderList(json).find((r: any) => Number(r.installment_id) === values.installment_id && String(r.send_day) === values.send_day);
  if (!row) return;
  row.status = values.status;
  row.provider_message_id = values.provider_message_id ?? null;
  row.error = values.error ?? null;
  deps.writeJsonDb(json);
}

/** One template message via the official sms.ir SDK; never sends when the key/line are missing. */
async function sendTemplate(cfg: ReminderConfig, mobile: string, params: Array<{ name: string; value: string }>): Promise<{ ok: boolean; messageId: string | null; error?: string }> {
  if (!cfg.configured) return { ok: false, messageId: null, error: 'درگاه پیامک sms.ir تنظیم نشده است (SMSIR_API_KEY/SMSIR_LINE_NUMBER).' };
  try {
    const smsir = new Smsir(cfg.apiKey, Number(cfg.lineNumber) || cfg.lineNumber);
    const res: any = await smsir.SendVerifyCode(mobile, cfg.templateId, params);
    const ok = Number(res?.status) === 1 || res?.status === true;
    const messageId = res?.data?.messageId ?? res?.data?.packId ?? res?.data?.id ?? null;
    return { ok, messageId: messageId != null ? String(messageId) : null, error: ok ? undefined : String(res?.message || 'ارسال پیامک ناموفق بود') };
  } catch (err: any) {
    return { ok: false, messageId: null, error: err?.response?.data?.message || err?.message || 'ارسال پیامک ناموفق بود' };
  }
}

type RunResult = { sent: number; failed: number; skipped: number; dry_run: number; results: Array<{ installment_id: number; status: ReminderStatus | 'already_sent'; reason?: ReminderReason }> };

/** In-process lock: the daily cron and a manual run-now can never overlap inside this process. */
let reminderRunInProgress = false;

/**
 * One daily pass. `dryRun` only reports what would happen and writes no rows; otherwise sms.ir is called
 * once per due, still-owing installment. The (installment_id, send_day) slot is reserved as 'sending'
 * before the SMS is attempted, so two concurrent runs can never send twice for the same installment/day.
 */
export async function runReminders(deps: ReminderDeps, opts: { dryRun?: boolean; daysOverride?: number } = {}): Promise<RunResult> {
  if (reminderRunInProgress) {
    throw Object.assign(new Error('اجرای یادآوری اقساط در حال انجام است؛ کمی بعد دوباره تلاش کنید.'), { status: 409 });
  }
  reminderRunInProgress = true;
  try {
    const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
    const sendDay = deps.jalaliToday();
    const out: RunResult = { sent: 0, failed: 0, skipped: 0, dry_run: 0, results: [] };
    if (!cfg.enabled) { deps.log?.('run skipped: reminders disabled'); return out; }

    const target = addJalaliDays(sendDay, opts.daysOverride !== undefined && Number.isFinite(opts.daysOverride)
      ? Math.min(GRACE_MAX_DAYS, Math.max(0, Math.round(opts.daysOverride))) : cfg.daysBefore);
    const due = target ? await deps.store.dueForReminder(target) : [];
    const placeholder = linkUrl(deps, PLACEHOLDER_CODE);

    for (const row of due) {
      const { item, mobile, name } = evaluate(row, deps, cfg, placeholder);

      if (item.reason === 'test_mode_skip') {
        await insertReminderRow(deps, { installment_id: row.id, send_day: sendDay, mobile_masked: maskPhone(row.phone_number), status: 'skipped_test_mode' });
        out.skipped += 1; out.results.push({ installment_id: row.id, status: 'skipped_test_mode', reason: 'test_mode_skip' }); continue;
      }
      if (!item.would_send) {
        out.skipped += 1; out.results.push({ installment_id: row.id, status: 'skipped_disabled', reason: item.reason }); continue;
      }
      // Dry run must not write anything: a row here would block the real send on the same day.
      if (opts.dryRun) {
        out.dry_run += 1; out.results.push({ installment_id: row.id, status: 'dry_run', reason: 'ok' }); continue;
      }

      // Reserve first; a duplicate means another run/cron already owns this slot for the day.
      const reserved = await reserveReminderRow(deps, row.id, sendDay, maskPhone(row.phone_number));
      if (!reserved) {
        out.skipped += 1; out.results.push({ installment_id: row.id, status: 'already_sent', reason: 'already_sent' }); continue;
      }

      // Create/reuse the per-installment link; never fall back to the placeholder link in a real send.
      let link: { code: string } | null = null;
      try {
        const inst = await deps.store.get(row.id);
        if (inst) link = await deps.store.getOrCreateLink(row.id, Number(inst.amount) || row.amount, defaultLinkExpiry(String(inst.due_date_jalali)));
      } catch (e: any) { deps.log?.(`link creation failed for installment ${row.id}: ${e?.message}`); }
      if (!link) {
        await finalizeReminderRow(deps, { installment_id: row.id, send_day: sendDay, status: 'failed', error: 'link_failed' });
        out.failed += 1; out.results.push({ installment_id: row.id, status: 'failed', reason: 'link_failed' }); continue;
      }

      const result = await sendTemplate(cfg, mobile, [
        { name: 'NAME', value: name || 'کارآموز' },
        { name: 'AMOUNT', value: item.amount_text },
        { name: 'DATE', value: row.due_date_jalali },
        { name: 'LINK', value: linkUrl(deps, link.code) },
      ]);
      await finalizeReminderRow(deps, {
        installment_id: row.id, send_day: sendDay,
        status: result.ok ? 'sent' : 'failed', provider_message_id: result.messageId,
        error: result.ok ? null : deps.sanitize(result.error, 255),
      });
      if (result.ok) out.sent += 1; else out.failed += 1;
      out.results.push({ installment_id: row.id, status: result.ok ? 'sent' : 'failed', reason: result.ok ? 'ok' : undefined });
    }
    return out;
  } finally {
    reminderRunInProgress = false;
  }
}

export function registerInstallmentReminders(app: express.Express, deps: ReminderDeps) {
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
    (req: express.Request, res: express.Response) => { fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' })); };
  const requireAdmin = (req: express.Request, res: express.Response): boolean => {
    const role = deps.session(req)?.role || '';
    if (role !== 'admin') { res.status(403).json({ error: 'فقط مدیر' }); return false; }
    return true;
  };

  app.get('/api/installment-reminders/settings', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
    res.json({
      enabled: cfg.enabled, env_enabled: cfg.envEnabled, days_before: cfg.daysBefore, template_id: cfg.templateId,
      cron: cfg.cron, test_mode: !!cfg.testMobile, test_mobile_masked: maskPhone(cfg.testMobile),
      test_mobile_env: cfg.testMobileEnv, configured: cfg.configured, timezone: 'Asia/Tehran',
    });
  }));

  app.put('/api/installment-reminders/settings', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const patch: Record<string, any> = {};
    // The env flag is the hard gate; settings can only disable, never enable while it is off.
    if (b.enabled !== undefined) {
      if (b.enabled && process.env.CRM_INSTALLMENT_REMINDER_ENABLED !== '1') {
        return res.status(400).json({ error: 'برای فعال‌سازی، ابتدا CRM_INSTALLMENT_REMINDER_ENABLED=1 را روی سرور تنظیم کنید.' });
      }
      patch.enabled = !!b.enabled;
    }
    if (b.days_before !== undefined) patch.days_before = Math.min(GRACE_MAX_DAYS, Math.max(0, Number(b.days_before) || 0));
    if (b.template_id !== undefined) patch.template_id = intOrNull(b.template_id) || 472328;
    if (b.cron !== undefined) {
      const cron = deps.sanitize(b.cron, 80) || '0 10 * * *';
      if (!cronValidate(cron)) return res.status(400).json({ error: 'عبارت زمان‌بندی (cron) نامعتبر است.' });
      patch.cron = cron;
    }
    if (b.test_mobile !== undefined) patch.test_mobile = b.test_mobile ? deps.normalizeMobile(b.test_mobile) : '';
    deps.saveSettings(patch);
    const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
    res.json({
      ok: true, enabled: cfg.enabled, env_enabled: cfg.envEnabled, days_before: cfg.daysBefore,
      template_id: cfg.templateId, cron: cfg.cron, test_mode: !!cfg.testMobile,
      test_mobile_masked: maskPhone(cfg.testMobile), test_mobile_env: cfg.testMobileEnv, configured: cfg.configured,
    });
  }));

  app.get('/api/installment-reminders/preview', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const days = req.query.days !== undefined ? Number(req.query.days) : undefined;
    const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
    const { target_date, items } = await previewReminders(deps, days);
    res.json({
      enabled: cfg.enabled, env_enabled: cfg.envEnabled, configured: cfg.configured, test_mode: !!cfg.testMobile,
      test_mobile_masked: maskPhone(cfg.testMobile), test_mobile_env: cfg.testMobileEnv, days_before: cfg.daysBefore,
      template_id: cfg.templateId, cron: cfg.cron, timezone: 'Asia/Tehran', target_date, total: items.length,
      would_send: items.filter((i) => i.would_send).length, items,
    });
  }));

  app.get('/api/installment-reminders/log', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const limit = Math.min(Math.max(intOrNull(req.query.limit) || 200, 1), 1000);
    if (db.isMysqlEnabled()) {
      const rows = await db.sql<any>(`SELECT id, installment_id, send_day, mobile_masked, status, provider_message_id, error, created_at
        FROM crm_installment_reminders ORDER BY id DESC LIMIT ${limit}`);
      return res.json(rows);
    }
    const list = jsonReminderList(deps.readJsonDb()).slice().sort((a: any, b: any) => Number(b.id) - Number(a.id)).slice(0, limit);
    res.json(list);
  }));

  app.post('/api/installment-reminders/run-now', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
    if (!cfg.enabled) return res.status(403).json({ error: 'یادآوری اقساط روی سرور غیرفعال است.' });
    if (req.body?.confirm !== 'ارسال') return res.status(400).json({ error: 'برای ارسال باید کلمه «ارسال» را تایپ کنید.' });
    const dryRun = req.body?.dry_run === true;
    const result = await runReminders(deps, { dryRun, daysOverride: req.body?.days !== undefined ? Number(req.body.days) : undefined });
    res.json({ ok: true, dry_run: dryRun, sent: result.sent, failed: result.failed, skipped: result.skipped, dry_run_count: result.dry_run, results: result.results });
  }));
}

/** Registers the daily cron task only when reminders are enabled. Returns whether a task was scheduled. */
export function startInstallmentReminderScheduler(deps: ReminderDeps): boolean {
  const cfg = reminderConfig(deps.settings(), deps.normalizeMobile);
  if (!cfg.enabled) { deps.log?.('scheduler not registered: reminders disabled'); return false; }
  if (!cronValidate(cfg.cron)) { deps.log?.(`scheduler not registered: invalid cron "${cfg.cron}"`); return false; }
  try {
    cronSchedule(cfg.cron, () => { void runReminders(deps, {}).catch((e) => deps.log?.(`daily run failed: ${e?.message}`)); }, { timezone: 'Asia/Tehran' });
    deps.log?.(`scheduler registered: "${cfg.cron}" Asia/Tehran`);
    return true;
  } catch (err: any) {
    deps.log?.(`scheduler registration failed: ${err?.message}`);
    return false;
  }
}
