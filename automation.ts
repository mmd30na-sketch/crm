/**
 * Rule-based automation («اتوماسیون قاعده‌محور»): event -> conditions -> actions.
 *
 * Events are emitted from existing code paths in server.ts (enrollment created, online registration
 * approved / rejected, payment recorded) or produced by the daily scheduler (installment due / overdue,
 * debt above a threshold, plain daily). Conditions are simple field comparisons with AND/OR groups
 * (automationConditions.ts). Actions: SMS template / free-text SMS through the shared SMS module, an admin
 * task, a Telegram / Rubika admin notification, or a note on the student's timeline.
 *
 * Safety (nothing real is ever sent by default):
 *   - CRM_AUTOMATION_ENABLED === '1' is a hard gate. While it is off, emit() is a no-op (no DB access) and
 *     every run that is forced from the admin UI is executed as a dry run.
 *   - Every rule is created disabled and in dry-run mode; dry runs only write a run row with previews.
 *   - Test mobile override: CRM_AUTOMATION_TEST_MOBILE (env, wins) or the rule's test_mobile receives every
 *     SMS of the rule instead of the real recipient.
 *   - Idempotency: UNIQUE(rule_id, dedupe_key, mode) on crm_automation_runs; the slot is reserved before any
 *     action runs, so the same event (or the same scheduled bucket) is never handled twice.
 *   - Rate limits: max_per_hour live runs per rule and CRM_AUTOMATION_MAX_SMS_PER_DAY SMS overall.
 *   - Run rows never store full mobiles, chat ids, API keys or provider responses beyond a short error.
 *
 * Additive only: two new tables (crm_automation_rules, crm_automation_runs); JSON fallback in
 * db_store.json (automation_rules / automation_runs) when MySQL is off.
 */
import type express from 'express';
import * as db from './mysql-socks';
import {
  AutomationEvent, AutomationRule, AutomationAction, EventContext, ConditionGroup, SCHEDULED_EVENTS, EVENT_LABELS, EVENT_FIELDS,
  evaluateConditions, validateConditions, validateActions, renderText, smsVars, dedupeKey,
} from './automationConditions';

export type RunStatus = 'running' | 'done' | 'partial' | 'failed' | 'skipped' | 'rate_limited' | 'dry_run';
export type RunMode = 'dry' | 'live';

export type AutomationConfig = {
  enabled: boolean; envTestMobile: string; maxSmsPerDay: number; dailyHour: number;
  adminTelegramChat: string; adminRubikaChat: string;
};

export type AutomationDeps = {
  session(req: express.Request): { username: string; role: string } | null;
  sanitize(v: unknown, max: number): string;
  normalizeMobile(v: unknown): string;
  readJsonDb(): any;
  writeJsonDb(store: any): void;
  sms: {
    sendTemplate(key: string, mobile: string, vars: Record<string, unknown>): Promise<{ ok: boolean; status: string; detail?: string }>;
    sendText(mobile: string, text: string): Promise<{ ok: boolean; status: string; detail?: string }>;
  };
  notify: {
    telegram(chatId: string, text: string): Promise<{ ok: boolean; error?: string }>;
    rubika(chatId: string, text: string): Promise<{ ok: boolean; error?: string }>;
  };
  createTask(t: { title: string; description: string; assignee: string | null; due_at: string | null; priority: string; student_id: number | null; created_by: string }): Promise<{ ok: boolean; id?: number; error?: string }>;
  addNote(studentId: number, text: string, by: string): Promise<{ ok: boolean; error?: string }>;
  scheduledContexts(event: AutomationEvent, rule: AutomationRule): Promise<EventContext[]>;
  sampleContexts(event: AutomationEvent, limit: number): Promise<EventContext[]>;
  jalaliToday(): string;
  log(msg: string): void;
};

const intEnv = (name: string, def: number, min: number, max: number) => {
  const n = parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

export function automationConfig(normalizeMobile: (v: unknown) => string): AutomationConfig {
  return {
    enabled: process.env.CRM_AUTOMATION_ENABLED === '1',
    envTestMobile: normalizeMobile(process.env.CRM_AUTOMATION_TEST_MOBILE || ''),
    maxSmsPerDay: intEnv('CRM_AUTOMATION_MAX_SMS_PER_DAY', 200, 0, 10000),
    dailyHour: intEnv('CRM_AUTOMATION_DAILY_HOUR', 9, 0, 23),
    adminTelegramChat: String(process.env.CRM_AUTOMATION_ADMIN_TELEGRAM_CHAT || '').trim(),
    adminRubikaChat: String(process.env.CRM_AUTOMATION_ADMIN_RUBIKA_CHAT || '').trim(),
  };
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
export const maskMobile = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); const k = d.length >= 10 ? d.slice(-10) : ''; return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const maskName = (first: unknown, last: unknown) => {
  const f = String(first ?? '').trim(); const l = String(last ?? '').trim();
  return [f, l ? `${l.slice(0, 1)}***` : ''].filter(Boolean).join(' ');
};
const short = (v: unknown, n = 200) => String(v ?? '').slice(0, n);
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const sqlNow = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');
const parseJson = (v: any, def: any) => { if (v === null || v === undefined || v === '') return def; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return def; } };
const asBool = (v: any) => v === true || v === 1 || v === '1';

/** Tehran calendar parts (Gregorian) and hour. */
function tehranNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const y = get('year'); const m = get('month'); const day = get('day');
  return { hour: get('hour') % 24, dayIndex: Math.floor(Date.UTC(y, m - 1, day) / 86_400_000), dayKey: `${y}-${m}-${day}` };
}

function normalizeRule(r: any): AutomationRule {
  return {
    id: Number(r.id), name: String(r.name || ''), description: String(r.description || ''), event: r.event,
    conditions: parseJson(r.conditions, { mode: 'all', items: [] }), actions: parseJson(r.actions, []),
    enabled: asBool(r.enabled), dry_run: r.dry_run === undefined || r.dry_run === null ? true : asBool(r.dry_run),
    test_mobile: String(r.test_mobile || ''), max_per_hour: Number(r.max_per_hour) || 30, params: parseJson(r.params, {}) || {},
    created_by: r.created_by ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at || ''),
  };
}
/** What the API returns: the test mobile is masked, never the full number. */
const publicRule = (r: AutomationRule) => ({ ...r, test_mobile: r.test_mobile ? maskMobile(r.test_mobile) : '' });

const jsonRules = (store: any): any[] => { if (!Array.isArray(store.automation_rules)) store.automation_rules = []; return store.automation_rules; };
const jsonRuns = (store: any): any[] => { if (!Array.isArray(store.automation_runs)) store.automation_runs = []; return store.automation_runs; };

/* ─────────────────────────────── schema ─────────────────────────────── */

export async function ensureAutomationSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_automation_rules (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description VARCHAR(500) NULL,
      event VARCHAR(40) NOT NULL,
      conditions JSON NULL,
      actions JSON NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      dry_run TINYINT(1) NOT NULL DEFAULT 1,
      test_mobile VARCHAR(20) NULL,
      max_per_hour INT NOT NULL DEFAULT 30,
      params JSON NULL,
      created_by VARCHAR(80) NULL,
      updated_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_rule_event (event, enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: automation rules / قواعد اتوماسیون'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_automation_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      rule_id INT UNSIGNED NOT NULL,
      event VARCHAR(40) NOT NULL,
      dedupe_key VARCHAR(140) NOT NULL,
      mode ENUM('dry','live') NOT NULL,
      status ENUM('running','done','partial','failed','skipped','rate_limited','dry_run') NOT NULL,
      student_id INT NULL,
      target_masked VARCHAR(80) NULL,
      summary VARCHAR(500) NULL,
      actions_result JSON NULL,
      triggered_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      UNIQUE KEY uq_rule_dedupe (rule_id, dedupe_key, mode),
      KEY idx_run_rule (rule_id, created_at),
      KEY idx_run_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: automation run log / سوابق اجرای اتوماسیون'`);
  } catch (err: any) {
    console.warn('Automation schema setup failed:', err?.message || err);
  }
}

/* ─────────────────────────────── engine ─────────────────────────────── */

type ActionResult = {
  type: AutomationAction['type']; ok: boolean; skipped?: string; status?: string; error?: string;
  preview?: string; to_masked?: string; test_override?: boolean; task_id?: number;
};

const ACTION_LABEL: Record<string, string> = { sms_template: 'پیامک الگو', sms_text: 'پیامک متنی', task: 'تسک', notify_admin: 'اعلان مدیر', note: 'یادداشت' };
const SKIP_LABEL: Record<string, string> = {
  no_mobile: 'شماره موبایل ندارد', daily_cap: 'سقف روزانه پیامک', not_configured: 'پیکربندی نشده', no_student: 'کارآموز ندارد',
};

function actionPreview(a: AutomationAction, ctx: EventContext): string {
  switch (a.type) {
    case 'sms_template': return `الگو: ${a.template_key}`;
    case 'sms_text': return renderText(a.text, ctx);
    case 'task': return renderText(a.title, ctx);
    case 'notify_admin': return `${a.channel === 'telegram' ? 'تلگرام' : 'روبیکا'}: ${renderText(a.text, ctx)}`;
    case 'note': return renderText(a.text, ctx);
    default: return '';
  }
}

export type RuleInput = Partial<Omit<AutomationRule, 'id'>> & Record<string, unknown>;

export function createAutomationEngine(deps: AutomationDeps) {
  const config = () => automationConfig(deps.normalizeMobile);
  let cache: { at: number; rules: AutomationRule[] } | null = null;
  const sms = { day: '', count: 0 };
  let lastDaily = '';
  let schedulerTimer: NodeJS.Timeout | null = null;
  let scheduledRunning = false;

  const smsTestMobile = (rule: AutomationRule) => config().envTestMobile || deps.normalizeMobile(rule.test_mobile || '');

  async function allRules(): Promise<AutomationRule[]> {
    if (db.isMysqlEnabled()) return (await db.sql('SELECT * FROM crm_automation_rules ORDER BY id DESC')).map(normalizeRule);
    return jsonRules(deps.readJsonDb()).map(normalizeRule).sort((a, b) => b.id - a.id);
  }
  async function enabledRules(): Promise<AutomationRule[]> {
    if (cache && Date.now() - cache.at < 30_000) return cache.rules;
    const rules = (await allRules()).filter((r) => r.enabled);
    cache = { at: Date.now(), rules };
    return rules;
  }
  async function rawRule(id: number): Promise<AutomationRule | null> {
    if (db.isMysqlEnabled()) { const rows = await db.sql('SELECT * FROM crm_automation_rules WHERE id = ? LIMIT 1', [id]); return rows[0] ? normalizeRule(rows[0]) : null; }
    const r = jsonRules(deps.readJsonDb()).find((x: any) => Number(x.id) === id);
    return r ? normalizeRule(r) : null;
  }

  /* run rows */
  async function reserveRun(rule: AutomationRule, key: string, mode: RunMode, ctx: EventContext, by: string | null): Promise<number | null> {
    const status: RunStatus = mode === 'dry' ? 'dry_run' : 'running';
    const target = [maskName(ctx.first_name, ctx.last_name), maskMobile(ctx.mobile)].filter(Boolean).join(' · ').slice(0, 80) || null;
    if (db.isMysqlEnabled()) {
      try {
        const r: any = await db.sqlExec(
          `INSERT INTO crm_automation_runs (rule_id, event, dedupe_key, mode, status, student_id, target_masked, triggered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [rule.id, rule.event, key, mode, status, ctx.student_id || null, target, by]);
        return Number(r?.insertId) || -1;
      } catch (err: any) {
        if (err?.code === 'ER_DUP_ENTRY') return null;
        throw err;
      }
    }
    const store = deps.readJsonDb(); const runs = jsonRuns(store);
    if (runs.some((x: any) => Number(x.rule_id) === rule.id && x.dedupe_key === key && x.mode === mode)) return null;
    const id = runs.reduce((m: number, x: any) => Math.max(m, Number(x.id) || 0), 0) + 1;
    runs.push({ id, rule_id: rule.id, event: rule.event, dedupe_key: key, mode, status, student_id: ctx.student_id || null, target_masked: target, summary: null, actions_result: null, triggered_by: by, created_at: new Date().toISOString(), finished_at: null });
    if (runs.length > 5000) runs.splice(0, runs.length - 5000);
    deps.writeJsonDb(store);
    return id;
  }
  async function finishRun(id: number, status: RunStatus, summary: string, results: ActionResult[] | null) {
    if (db.isMysqlEnabled()) {
      await db.sqlExec('UPDATE crm_automation_runs SET status = ?, summary = ?, actions_result = ?, finished_at = NOW() WHERE id = ?',
        [status, summary.slice(0, 500), results ? JSON.stringify(results) : null, id]);
      return;
    }
    const store = deps.readJsonDb(); const row = jsonRuns(store).find((x: any) => Number(x.id) === id);
    if (row) { Object.assign(row, { status, summary: summary.slice(0, 500), actions_result: results, finished_at: new Date().toISOString() }); deps.writeJsonDb(store); }
  }
  async function liveRunsLastHour(ruleId: number, excludeId: number): Promise<number> {
    if (db.isMysqlEnabled()) {
      const rows = await db.sql(`SELECT COUNT(*) AS c FROM crm_automation_runs WHERE rule_id = ? AND mode = 'live' AND id <> ?
        AND status NOT IN ('rate_limited','skipped') AND created_at >= (NOW() - INTERVAL 1 HOUR)`, [ruleId, excludeId]);
      return Number(rows[0]?.c) || 0;
    }
    const since = Date.now() - 3_600_000;
    return jsonRuns(deps.readJsonDb()).filter((x: any) => Number(x.rule_id) === ruleId && x.mode === 'live' && Number(x.id) !== excludeId
      && !['rate_limited', 'skipped'].includes(x.status) && Date.parse(x.created_at) >= since).length;
  }
  function takeSmsSlot(): boolean {
    const today = tehranNow().dayKey;
    if (sms.day !== today) { sms.day = today; sms.count = 0; }
    if (sms.count >= config().maxSmsPerDay) return false;
    sms.count += 1;
    return true;
  }

  async function runAction(a: AutomationAction, rule: AutomationRule, ctx: EventContext, cfg: AutomationConfig): Promise<ActionResult> {
    const res: ActionResult = { type: a.type, ok: false };
    switch (a.type) {
      case 'sms_template':
      case 'sms_text': {
        const test = smsTestMobile(rule);
        const mobile = test || deps.normalizeMobile(ctx.mobile || '');
        res.test_override = !!test;
        if (!/^09\d{9}$/.test(mobile)) { res.skipped = 'no_mobile'; return res; }
        res.to_masked = maskMobile(mobile);
        if (!takeSmsSlot()) { res.skipped = 'daily_cap'; return res; }
        const r = a.type === 'sms_text'
          ? await deps.sms.sendText(mobile, renderText(a.text, ctx))
          : await deps.sms.sendTemplate(a.template_key, mobile, smsVars(ctx));
        res.ok = !!r.ok; res.status = short(r.status, 30);
        if (!r.ok) res.error = short(r.detail || r.status);
        return res;
      }
      case 'task': {
        const due = a.due_in_days !== undefined ? sqlNow(new Date(Date.now() + a.due_in_days * 86_400_000)) : null;
        const r = await deps.createTask({
          title: renderText(a.title, ctx).slice(0, 200), description: renderText(a.description || '', ctx).slice(0, 2000),
          assignee: a.assignee || null, due_at: due, priority: a.priority || 'normal', student_id: ctx.student_id || null, created_by: `automation:${rule.id}`,
        });
        res.ok = !!r.ok; res.task_id = r.id; if (!r.ok) res.error = short(r.error);
        return res;
      }
      case 'notify_admin': {
        const chat = a.channel === 'telegram' ? cfg.adminTelegramChat : cfg.adminRubikaChat;
        if (!chat) { res.skipped = 'not_configured'; return res; }
        const text = renderText(a.text, ctx);
        const r = a.channel === 'telegram' ? await deps.notify.telegram(chat, text) : await deps.notify.rubika(chat, text);
        res.ok = !!r.ok; if (!r.ok) res.error = short(r.error);
        return res;
      }
      case 'note': {
        if (!ctx.student_id) { res.skipped = 'no_student'; return res; }
        const r = await deps.addNote(ctx.student_id, renderText(a.text, ctx).slice(0, 2000), `automation:${rule.id}`);
        res.ok = !!r.ok; if (!r.ok) res.error = short(r.error);
        return res;
      }
      default: return res;
    }
  }

  type ProcessOutcome = 'no_match' | 'duplicate' | 'rate_limited' | RunStatus;

  /** Evaluates one rule for one context and (once per dedupe key) runs or previews its actions. Never throws. */
  async function processRule(rule: AutomationRule, ctx: EventContext, bucket?: string, by: string | null = null): Promise<ProcessOutcome> {
    try {
      if (!evaluateConditions(rule.conditions, ctx)) return 'no_match';
      const cfg = config();
      // The global flag is the hard gate: with it off, even a forced run is only a dry run.
      const mode: RunMode = cfg.enabled && !rule.dry_run ? 'live' : 'dry';
      const key = dedupeKey(rule.event, ctx, bucket);
      const runId = await reserveRun(rule, key, mode, ctx, by);
      if (runId === null) return 'duplicate';

      if (mode === 'dry') {
        const results: ActionResult[] = rule.actions.map((a) => {
          const isSms = a.type === 'sms_template' || a.type === 'sms_text';
          const test = isSms ? smsTestMobile(rule) : '';
          return { type: a.type, ok: true, preview: actionPreview(a, ctx).slice(0, 300), ...(isSms ? { to_masked: maskMobile(test || ctx.mobile), test_override: !!test } : {}) };
        });
        await finishRun(runId, 'dry_run', `آزمایشی: ${rule.actions.map((a) => ACTION_LABEL[a.type]).join(' · ')}`, results);
        return 'dry_run';
      }

      if (await liveRunsLastHour(rule.id, runId) >= rule.max_per_hour) {
        await finishRun(runId, 'rate_limited', `محدودیت ${rule.max_per_hour} اجرا در ساعت`, null);
        return 'rate_limited';
      }

      const results: ActionResult[] = [];
      for (const a of rule.actions) {
        try { results.push(await runAction(a, rule, ctx, cfg)); }
        catch (err: any) { results.push({ type: a.type, ok: false, error: short(err?.message || err) }); }
      }
      const failed = results.filter((r) => !r.ok && !r.skipped).length;
      const okCount = results.filter((r) => r.ok).length;
      const status: RunStatus = failed === 0 ? (okCount ? 'done' : 'skipped') : (okCount ? 'partial' : 'failed');
      const summary = results.map((r) => `${ACTION_LABEL[r.type]}: ${r.ok ? 'انجام شد' : r.skipped ? (SKIP_LABEL[r.skipped] || 'رد شد') : 'خطا'}`).join(' · ');
      await finishRun(runId, status, summary, results);
      return status;
    } catch (err: any) {
      deps.log(`rule ${rule.id} failed: ${short(err?.message || err)}`);
      return 'failed';
    }
  }

  /** Fire-and-forget entry point for code paths. A no-op (no DB access) while the global flag is off. */
  function emit(event: AutomationEvent, ctx: EventContext | (() => Promise<EventContext | null>)): void {
    if (!config().enabled) return;
    setImmediate(() => {
      (async () => {
        const rules = (await enabledRules()).filter((r) => r.event === event);
        if (!rules.length) return;
        const c = typeof ctx === 'function' ? await ctx() : ctx;
        if (!c) return;
        for (const rule of rules) await processRule(rule, c);
      })().catch((err) => deps.log(`emit ${event} failed: ${short(err?.message || err)}`));
    });
  }

  const bucketFor = (rule: AutomationRule) => String(Math.floor(tehranNow().dayIndex / Math.max(1, Number(rule.params?.repeat_days) || 1)));

  async function contextsFor(rule: AutomationRule): Promise<EventContext[]> {
    const list = await deps.scheduledContexts(rule.event, rule);
    if (rule.event === 'daily' && !list.length) return [{ date: deps.jalaliToday() }];
    return list;
  }

  /** Scheduled events (installment due/overdue, debt above threshold, daily). Dedupe makes repeats harmless. */
  async function runScheduled(opts: { force?: boolean; ruleId?: number; by?: string | null } = {}) {
    const out = { rules: 0, checked: 0, matched: 0, executed: 0, duplicates: 0, dry_runs: 0, rate_limited: 0 };
    if (!config().enabled && !opts.force) return out;
    if (scheduledRunning) throw httpError(409, 'اجرای زمان‌بندی‌شده دیگری در جریان است.');
    scheduledRunning = true;
    try {
      let rules: AutomationRule[];
      if (opts.ruleId) { const r = await rawRule(opts.ruleId); rules = r ? [r] : []; }
      else rules = (await enabledRules());
      rules = rules.filter((r) => SCHEDULED_EVENTS.includes(r.event));
      for (const rule of rules) {
        out.rules += 1;
        const bucket = bucketFor(rule);
        for (const ctx of (await contextsFor(rule)).slice(0, 2000)) {
          out.checked += 1;
          const r = await processRule(rule, ctx, bucket, opts.by ?? 'scheduler');
          if (r === 'no_match') continue;
          out.matched += 1;
          if (r === 'duplicate') out.duplicates += 1;
          else if (r === 'dry_run') out.dry_runs += 1;
          else if (r === 'rate_limited') out.rate_limited += 1;
          else out.executed += 1;
        }
      }
      return out;
    } finally { scheduledRunning = false; }
  }

  function startScheduler(): void {
    if (schedulerTimer) return;
    const tick = () => {
      const cfg = config();
      if (!cfg.enabled) return;
      const now = tehranNow();
      if (now.hour < cfg.dailyHour || lastDaily === now.dayKey) return;
      lastDaily = now.dayKey;
      runScheduled({ by: 'scheduler' })
        .then((r) => deps.log(`daily run: ${JSON.stringify(r)}`))
        .catch((err) => deps.log(`daily run failed: ${short(err?.message || err)}`));
    };
    schedulerTimer = setInterval(tick, 10 * 60_000);
    schedulerTimer.unref?.();
    setTimeout(tick, 60_000).unref?.();
  }

  /* validation + CRUD */
  function validate(input: RuleInput, existing: AutomationRule | null): AutomationRule {
    const merged: any = { ...(existing || {}), ...input };
    const name = deps.sanitize(merged.name, 150);
    if (!name) throw httpError(400, 'نام قاعده الزامی است.');
    const event = String(merged.event || '') as AutomationEvent;
    if (!EVENT_LABELS[event]) throw httpError(400, 'رویداد نامعتبر است.');
    const conds = validateConditions(merged.conditions ?? { mode: 'all', items: [] }, event);
    if (!conds.ok) throw httpError(400, (conds as { error: string }).error);
    const acts = validateActions(merged.actions);
    if (!acts.ok) throw httpError(400, (acts as { error: string }).error);
    const num = (v: unknown, min: number, max: number, def?: number) => { const n = Number(toLatin(v)); return Number.isFinite(n) && String(v ?? '') !== '' ? Math.min(Math.max(Math.round(n), min), max) : def; };
    const p = merged.params || {};
    const params: AutomationRule['params'] = {};
    if (event === 'installment_due') params.days_before = num(p.days_before, 0, 30, 0);
    if (event === 'debt_above_threshold') {
      params.threshold = num(p.threshold, 0, 10_000_000_000, 0);
      if (!params.threshold) throw httpError(400, 'برای «بدهی بالاتر از حد» مبلغ آستانه (تومان) را وارد کنید.');
    }
    if (SCHEDULED_EVENTS.includes(event)) params.repeat_days = num(p.repeat_days, 1, 90, 1);
    // A masked value coming back from the UI keeps the stored number.
    let testMobile = '';
    const rawTest = String(input.test_mobile ?? (existing ? existing.test_mobile : '') ?? '');
    if (rawTest.includes('*')) testMobile = existing?.test_mobile || '';
    else if (rawTest.trim()) { testMobile = deps.normalizeMobile(rawTest); if (!/^09\d{9}$/.test(testMobile)) throw httpError(400, 'شماره تست نامعتبر است.'); }
    return {
      id: existing?.id || 0, name, description: deps.sanitize(merged.description || '', 500), event,
      conditions: conds.value, actions: acts.value,
      enabled: existing ? (input.enabled === undefined ? existing.enabled : !!input.enabled) : input.enabled === true,
      dry_run: existing ? (input.dry_run === undefined ? existing.dry_run : input.dry_run !== false) : input.dry_run !== false,
      test_mobile: testMobile, max_per_hour: num(merged.max_per_hour, 1, 1000, 30) as number, params,
      created_by: existing?.created_by ?? null, created_at: existing?.created_at || '', updated_at: '',
    };
  }

  async function saveRule(input: RuleInput, id: number | null, by: string): Promise<AutomationRule> {
    const existing = id ? await rawRule(id) : null;
    if (id && !existing) throw httpError(404, 'قاعده یافت نشد.');
    const r = validate(input, existing);
    const cols = [r.name, r.description, r.event, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.enabled ? 1 : 0, r.dry_run ? 1 : 0, r.test_mobile || null, r.max_per_hour, JSON.stringify(r.params)];
    if (db.isMysqlEnabled()) {
      if (existing) {
        await db.sqlExec(`UPDATE crm_automation_rules SET name = ?, description = ?, event = ?, conditions = CAST(? AS JSON), actions = CAST(? AS JSON),
          enabled = ?, dry_run = ?, test_mobile = ?, max_per_hour = ?, params = CAST(? AS JSON), updated_by = ? WHERE id = ?`, [...cols, by, existing.id]);
      } else {
        const res: any = await db.sqlExec(`INSERT INTO crm_automation_rules (name, description, event, conditions, actions, enabled, dry_run, test_mobile, max_per_hour, params, created_by, updated_by)
          VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`, [...cols, by, by]);
        r.id = Number(res?.insertId);
      }
    } else {
      const store = deps.readJsonDb(); const list = jsonRules(store); const now = new Date().toISOString();
      if (existing) {
        const i = list.findIndex((x: any) => Number(x.id) === existing.id);
        list[i] = { ...r, created_at: existing.created_at, updated_at: now, updated_by: by };
      } else {
        r.id = list.reduce((m: number, x: any) => Math.max(m, Number(x.id) || 0), 0) + 1;
        list.push({ ...r, created_by: by, created_at: now, updated_at: now, updated_by: by });
      }
      deps.writeJsonDb(store);
    }
    cache = null;
    return (await rawRule(r.id)) || r;
  }

  async function deleteRule(id: number): Promise<boolean> {
    // Run history is kept for the audit trail.
    if (db.isMysqlEnabled()) { const r: any = await db.sqlExec('DELETE FROM crm_automation_rules WHERE id = ?', [id]); cache = null; return Number(r?.affectedRows) > 0; }
    const store = deps.readJsonDb(); const list = jsonRules(store); const before = list.length;
    store.automation_rules = list.filter((x: any) => Number(x.id) !== id);
    deps.writeJsonDb(store); cache = null;
    return store.automation_rules.length < before;
  }

  async function toggleRule(id: number, patch: { enabled?: boolean; dry_run?: boolean }, by: string): Promise<AutomationRule> {
    const existing = await rawRule(id);
    if (!existing) throw httpError(404, 'قاعده یافت نشد.');
    const enabled = patch.enabled === undefined ? existing.enabled : !!patch.enabled;
    const dryRun = patch.dry_run === undefined ? existing.dry_run : !!patch.dry_run;
    if (db.isMysqlEnabled()) await db.sqlExec('UPDATE crm_automation_rules SET enabled = ?, dry_run = ?, updated_by = ? WHERE id = ?', [enabled ? 1 : 0, dryRun ? 1 : 0, by, id]);
    else {
      const store = deps.readJsonDb(); const row = jsonRules(store).find((x: any) => Number(x.id) === id);
      if (row) Object.assign(row, { enabled, dry_run: dryRun, updated_by: by, updated_at: new Date().toISOString() });
      deps.writeJsonDb(store);
    }
    cache = null;
    return (await rawRule(id)) as AutomationRule;
  }

  /** Who a draft rule would affect right now. No DB writes, no sends. */
  async function previewRule(input: RuleInput, limit = 50) {
    const rule = validate({ ...input, name: input.name || 'پیش‌نمایش' }, null);
    rule.id = 0; rule.dry_run = input.dry_run !== false;
    if (typeof input.test_mobile === 'string' && input.test_mobile.includes('*') && Number(input.id)) {
      rule.test_mobile = (await rawRule(Number(input.id)))?.test_mobile || '';
    }
    const cfg = config();
    const warnings: string[] = [];
    if (!cfg.enabled) warnings.push('اتوماسیون در سطح سرور خاموش است (CRM_AUTOMATION_ENABLED)؛ هیچ قاعده‌ای اجرا نمی‌شود.');
    const hasSms = rule.actions.some((a) => a.type === 'sms_template' || a.type === 'sms_text');
    const test = smsTestMobile(rule);
    if (hasSms && !rule.dry_run && !test) warnings.push('این قاعده در حالت واقعی و بدون شماره تست است؛ پیامک به شماره واقعی کارآموزان ارسال می‌شود.');
    if (hasSms && test) warnings.push(`همه پیامک‌های این قاعده به شماره تست ${maskMobile(test)} ارسال می‌شود.`);
    if (rule.actions.some((a) => a.type === 'notify_admin' && !(a.channel === 'telegram' ? cfg.adminTelegramChat : cfg.adminRubikaChat))) {
      warnings.push('گیرنده اعلان مدیر (CRM_AUTOMATION_ADMIN_TELEGRAM_CHAT / CRM_AUTOMATION_ADMIN_RUBIKA_CHAT) تنظیم نشده است.');
    }
    const scheduled = SCHEDULED_EVENTS.includes(rule.event);
    if (!scheduled) warnings.push('برای رویدادهای لحظه‌ای، پیش‌نمایش روی آخرین رکوردهای واقعی انجام می‌شود.');
    const contexts = scheduled ? await contextsFor(rule) : await deps.sampleContexts(rule.event, 20);
    const items: Array<{ name_masked: string; mobile_masked: string; student_id: number | null; actions: Array<{ type: string; preview: string; to_masked?: string }> }> = [];
    let matched = 0;
    for (const ctx of contexts.slice(0, 2000)) {
      if (!evaluateConditions(rule.conditions, ctx)) continue;
      matched += 1;
      if (items.length >= limit) continue;
      items.push({
        name_masked: maskName(ctx.first_name, ctx.last_name), mobile_masked: maskMobile(ctx.mobile), student_id: ctx.student_id || null,
        actions: rule.actions.map((a) => {
          const isSms = a.type === 'sms_template' || a.type === 'sms_text';
          return { type: a.type, preview: actionPreview(a, ctx).slice(0, 300), ...(isSms ? { to_masked: maskMobile(test || ctx.mobile) || 'بدون شماره' } : {}) };
        }),
      });
    }
    return { total_checked: contexts.length, matched, items, warnings };
  }

  async function listRuns(opts: { ruleId?: number; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    if (db.isMysqlEnabled()) {
      const where = opts.ruleId ? 'WHERE r.rule_id = ?' : '';
      const args = opts.ruleId ? [opts.ruleId] : [];
      const rows = await db.sql(`SELECT r.id, r.rule_id, COALESCE(x.name, '(حذف‌شده)') AS rule_name, r.event, r.dedupe_key, r.mode, r.status, r.student_id,
          r.target_masked, r.summary, r.actions_result, r.triggered_by, r.created_at, r.finished_at
        FROM crm_automation_runs r LEFT JOIN crm_automation_rules x ON x.id = r.rule_id ${where}
        ORDER BY r.id DESC LIMIT ${limit} OFFSET ${offset}`, args);
      const total = await db.sql(`SELECT COUNT(*) AS c FROM crm_automation_runs r ${where}`, args);
      return { rows: rows.map((r: any) => ({ ...r, actions_result: parseJson(r.actions_result, null) })), total: Number(total[0]?.c) || 0 };
    }
    const store = deps.readJsonDb(); const names = new Map(jsonRules(store).map((x: any) => [Number(x.id), String(x.name)]));
    const all = jsonRuns(store).filter((x: any) => !opts.ruleId || Number(x.rule_id) === opts.ruleId).sort((a: any, b: any) => Number(b.id) - Number(a.id));
    return { rows: all.slice(offset, offset + limit).map((x: any) => ({ ...x, rule_name: names.get(Number(x.rule_id)) || '(حذف‌شده)' })), total: all.length };
  }

  return {
    isEnabled: () => config().enabled, emit, processRule, runScheduled, startScheduler, previewRule,
    listRules: async () => (await allRules()).map(publicRule),
    getRule: async (id: number) => { const r = await rawRule(id); return r ? publicRule(r) : null; },
    rawRule, saveRule, deleteRule, toggleRule, listRuns,
  };
}
export type AutomationEngine = ReturnType<typeof createAutomationEngine>;

/* ─────────────────────────────── routes ─────────────────────────────── */

const OPS_FA = [
  { key: 'eq', label: 'برابر با' }, { key: 'neq', label: 'مخالف' }, { key: 'gt', label: 'بیشتر از' }, { key: 'gte', label: 'بیشتر یا مساوی' },
  { key: 'lt', label: 'کمتر از' }, { key: 'lte', label: 'کمتر یا مساوی' }, { key: 'contains', label: 'شامل' }, { key: 'not_contains', label: 'شامل نباشد' },
  { key: 'empty', label: 'خالی باشد' }, { key: 'not_empty', label: 'خالی نباشد' }, { key: 'in', label: 'یکی از (با کاما)' },
];

export function registerAutomation(app: express.Express, deps: AutomationDeps, engine: AutomationEngine) {
  const admin = (req: express.Request, res: express.Response): string | null => {
    const s = deps.session(req);
    if (!s || s.role !== 'admin') { res.status(403).json({ error: 'فقط مدیر به اتوماسیون دسترسی دارد.' }); return null; }
    return s.username || 'admin';
  };
  const wrap = (fn: (req: express.Request, res: express.Response, user: string) => Promise<void>) => async (req: express.Request, res: express.Response) => {
    const user = admin(req, res); if (!user) return;
    try { await fn(req, res, user); } catch (err: any) {
      const status = Number(err?.status) || 500;
      if (status >= 500) deps.log(`${req.method} ${req.path}: ${short(err?.message || err)}`);
      res.status(status).json({ error: status < 500 && err?.message ? err.message : 'خطای داخلی اتوماسیون.' });
    }
  };
  const idOf = (req: express.Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'شناسه نامعتبر است.'); return n; };

  app.get('/api/automation/meta', wrap(async (_req, res) => {
    const cfg = automationConfig(deps.normalizeMobile);
    res.json({
      enabled: cfg.enabled, test_mobile_env: !!cfg.envTestMobile, test_mobile_masked: maskMobile(cfg.envTestMobile),
      max_sms_per_day: cfg.maxSmsPerDay, daily_hour: cfg.dailyHour,
      telegram_configured: !!cfg.adminTelegramChat, rubika_configured: !!cfg.adminRubikaChat,
      events: (Object.keys(EVENT_LABELS) as AutomationEvent[]).map((key) => ({ key, label: EVENT_LABELS[key], scheduled: SCHEDULED_EVENTS.includes(key), fields: EVENT_FIELDS[key] })),
      ops: OPS_FA,
    });
  }));
  app.get('/api/automation/rules', wrap(async (_req, res) => { res.json({ rules: await engine.listRules() }); }));
  app.get('/api/automation/rules/:id', wrap(async (req, res) => {
    const r = await engine.getRule(idOf(req)); if (!r) throw httpError(404, 'قاعده یافت نشد.'); res.json(r);
  }));
  app.post('/api/automation/rules', wrap(async (req, res, user) => {
    const r = await engine.saveRule(req.body || {}, null, user); res.status(201).json(await engine.getRule(r.id));
  }));
  app.put('/api/automation/rules/:id', wrap(async (req, res, user) => {
    const r = await engine.saveRule(req.body || {}, idOf(req), user); res.json(await engine.getRule(r.id));
  }));
  app.delete('/api/automation/rules/:id', wrap(async (req, res) => {
    if (!(await engine.deleteRule(idOf(req)))) throw httpError(404, 'قاعده یافت نشد.'); res.json({ ok: true });
  }));
  app.post('/api/automation/rules/:id/toggle', wrap(async (req, res, user) => {
    const b = req.body || {};
    const patch: { enabled?: boolean; dry_run?: boolean } = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (typeof b.dry_run === 'boolean') patch.dry_run = b.dry_run;
    const r = await engine.toggleRule(idOf(req), patch, user);
    res.json(await engine.getRule(r.id));
  }));
  app.post('/api/automation/preview', wrap(async (req, res) => { res.json(await engine.previewRule(req.body || {})); }));
  app.get('/api/automation/runs', wrap(async (req, res) => {
    const q = req.query as Record<string, string>;
    res.json(await engine.listRuns({ ruleId: Number(q.rule_id) || undefined, limit: Number(q.limit) || 50, offset: Number(q.offset) || 0 }));
  }));
  app.post('/api/automation/rules/:id/run-now', wrap(async (req, res, user) => {
    const rule = await engine.rawRule(idOf(req));
    if (!rule) throw httpError(404, 'قاعده یافت نشد.');
    if (!SCHEDULED_EVENTS.includes(rule.event)) throw httpError(400, 'فقط قاعده‌های زمان‌بندی‌شده را می‌توان دستی اجرا کرد.');
    const live = engine.isEnabled() && !rule.dry_run;
    if (live && String(req.body?.confirm || '').trim() !== 'اجرا') throw httpError(400, 'این قاعده در حالت واقعی است؛ برای اجرا عبارت «اجرا» را تأیید کنید.');
    res.json({ ok: true, live, ...(await engine.runScheduled({ force: true, ruleId: rule.id, by: user })) });
  }));
}
