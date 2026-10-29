#!/usr/bin/env node
/**
 * Tests for the automation engine (automationConditions.ts + automation.ts) with the JSON store and fake
 * SMS / notify / task deps. Synthetic data only: no network, no database, nothing is ever sent.
 * Run: npm run test:automation   (= node --import tsx scripts/test-automation.mjs)
 */
import assert from 'node:assert/strict';
import { evaluateConditions, validateConditions, validateActions, renderText, dedupeKey } from '../automationConditions.ts';
import { createAutomationEngine } from '../automation.ts';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const norm = (v) => { const d = String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/\D/g, ''); const k = d.length >= 10 ? d.slice(-10) : ''; return k && k.startsWith('9') ? `0${k}` : ''; };

function harness(env = {}) {
  for (const k of ['CRM_AUTOMATION_ENABLED', 'CRM_AUTOMATION_TEST_MOBILE', 'CRM_AUTOMATION_MAX_SMS_PER_DAY', 'CRM_AUTOMATION_ADMIN_TELEGRAM_CHAT']) delete process.env[k];
  Object.assign(process.env, env);
  let store = {};
  const sent = []; const tasks = []; const notes = []; const notified = [];
  const deps = {
    session: () => ({ username: 'admin', role: 'admin' }),
    sanitize: (v, max) => String(v ?? '').trim().slice(0, max),
    normalizeMobile: norm,
    readJsonDb: () => store, writeJsonDb: (s) => { store = s; },
    sms: {
      sendTemplate: async (key, mobile, vars) => { sent.push({ key, mobile, vars }); return { ok: true, status: 'sent' }; },
      sendText: async (mobile, text) => { sent.push({ mobile, text }); return { ok: true, status: 'sent' }; },
    },
    notify: { telegram: async (chat, text) => { notified.push({ chat, text }); return { ok: true }; }, rubika: async () => ({ ok: true }) },
    createTask: async (t) => { tasks.push(t); return { ok: true, id: tasks.length }; },
    addNote: async (id, text) => { notes.push({ id, text }); return { ok: true }; },
    scheduledContexts: async () => [
      { student_id: 1, first_name: 'علی', last_name: 'رضایی', mobile: '09120000001', debt: 5_000_000 },
      { student_id: 2, first_name: 'سارا', last_name: 'احمدی', mobile: '09120000002', debt: 500_000 },
    ],
    sampleContexts: async () => [{ student_id: 1, first_name: 'علی', mobile: '09120000001', amount: 100 }],
    jalaliToday: () => '1405/08/06', log: () => {},
  };
  return { engine: createAutomationEngine(deps), sent, tasks, notes, notified, store: () => store };
}
const smsRule = (extra = {}) => ({
  name: 'بدهی', event: 'debt_above_threshold', params: { threshold: 1_000_000 },
  conditions: { mode: 'all', items: [{ field: 'debt', op: 'gte', value: '۲۰۰۰۰۰۰' }] },
  actions: [{ type: 'sms_text', text: '{name} عزیز، بدهی {debt} تومان' }, { type: 'task', title: 'پیگیری {name}' }],
  ...extra,
});

await test('conditions: AND/OR, Persian digits, in, empty', () => {
  const ctx = { debt: 2500000, course_title: 'پایه دوم', first_name: '' };
  assert.equal(evaluateConditions({ mode: 'all', items: [{ field: 'debt', op: 'gt', value: '۲,۰۰۰,۰۰۰' }, { field: 'course_title', op: 'contains', value: 'پایه' }] }, ctx), true);
  assert.equal(evaluateConditions({ mode: 'any', items: [{ field: 'debt', op: 'lt', value: 10 }, { mode: 'all', items: [{ field: 'first_name', op: 'empty' }] }] }, ctx), true);
  assert.equal(evaluateConditions({ mode: 'all', items: [{ field: 'course_title', op: 'in', value: 'پایه یکم,موتور' }] }, ctx), false);
  assert.equal(evaluateConditions({ mode: 'any', items: [] }, ctx), true);
});
await test('validation rejects unknown fields and bad actions', () => {
  assert.equal(validateConditions({ mode: 'all', items: [{ field: 'national_code', op: 'eq', value: 1 }] }, 'debt_above_threshold').ok, false);
  assert.equal(validateActions([]).ok, false);
  assert.equal(validateActions([{ type: 'sms_template', template_key: 'Bad Key' }]).ok, false);
  assert.equal(validateActions([{ type: 'notify_admin', channel: 'email', text: 'x' }]).ok, false);
  assert.equal(renderText('{name} {debt}', { first_name: 'علی', debt: 1200 }), `علی ${(1200).toLocaleString('fa-IR')}`);
  assert.equal(dedupeKey('payment_succeeded', { payment_id: 9, student_id: 1 }), 'payment_succeeded:9');
});
await test('global flag off: emit is a no-op and run-now is a dry run (nothing sent)', async () => {
  const h = harness();
  const r = await h.engine.saveRule(smsRule({ enabled: true, dry_run: false }), null, 'admin');
  assert.equal(r.enabled, true);
  h.engine.emit('debt_above_threshold', { student_id: 1, debt: 9e6, mobile: '09120000001' });
  await new Promise((res) => setTimeout(res, 20));
  assert.equal((h.store().automation_runs || []).length, 0);
  const out = await h.engine.runScheduled({ force: true, ruleId: r.id });
  assert.equal(out.dry_runs, 1); assert.equal(h.sent.length, 0); assert.equal(h.tasks.length, 0);
});
await test('new rules default to disabled + dry run', async () => {
  const h = harness({ CRM_AUTOMATION_ENABLED: '1' });
  const r = await h.engine.saveRule(smsRule(), null, 'admin');
  assert.equal(r.enabled, false); assert.equal(r.dry_run, true);
  assert.equal((await h.engine.runScheduled({})).rules, 0); // disabled rules are not scheduled
});
await test('live run with env test mobile: SMS redirected, idempotent per bucket', async () => {
  const h = harness({ CRM_AUTOMATION_ENABLED: '1', CRM_AUTOMATION_TEST_MOBILE: '09359999999' });
  await h.engine.saveRule(smsRule({ enabled: true, dry_run: false }), null, 'admin');
  const a = await h.engine.runScheduled({});
  assert.equal(a.matched, 1); assert.equal(a.executed, 1);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].mobile, '09359999999');
  assert.equal(h.tasks.length, 1); assert.equal(h.tasks[0].title, 'پیگیری علی');
  const b = await h.engine.runScheduled({});
  assert.equal(b.duplicates, 1); assert.equal(h.sent.length, 1);
  const run = h.store().automation_runs[0];
  assert.equal(run.status, 'done'); assert.ok(!JSON.stringify(run).includes('09359999999')); assert.ok(!JSON.stringify(run).includes('09120000001'));
});
await test('rate limit per rule and daily SMS cap', async () => {
  const h = harness({ CRM_AUTOMATION_ENABLED: '1', CRM_AUTOMATION_MAX_SMS_PER_DAY: '0' });
  const r = await h.engine.saveRule({ ...smsRule({ enabled: true, dry_run: false, max_per_hour: 1 }), conditions: { mode: 'all', items: [] } }, null, 'admin');
  const out = await h.engine.runScheduled({ ruleId: r.id, force: true });
  assert.equal(out.matched, 2); assert.equal(out.rate_limited, 1);
  assert.equal(h.sent.length, 0); // daily cap 0
  const first = h.store().automation_runs.find((x) => x.status !== 'rate_limited');
  assert.equal(first.actions_result[0].skipped, 'daily_cap');
});
await test('instant events: emit runs once per entity; masked test mobile kept on edit', async () => {
  const h = harness({ CRM_AUTOMATION_ENABLED: '1' });
  const r = await h.engine.saveRule({ name: 'پرداخت', event: 'payment_succeeded', enabled: true, dry_run: false, test_mobile: '09121112233',
    actions: [{ type: 'sms_template', template_key: 'payment_ok' }, { type: 'note', text: 'پرداخت {amount}' }, { type: 'notify_admin', channel: 'telegram', text: 'x' }] }, null, 'admin');
  const edited = await h.engine.saveRule({ name: 'پرداخت ۲', test_mobile: '0912***33' }, r.id, 'admin');
  assert.equal(edited.test_mobile, '09121112233');
  const ctx = { payment_id: 7, student_id: 3, first_name: 'رضا', mobile: '09125550000', amount: 1000 };
  h.engine.emit('payment_succeeded', ctx); h.engine.emit('payment_succeeded', ctx);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].mobile, '09121112233'); assert.equal(h.notes.length, 1);
  const run = h.store().automation_runs[0];
  assert.equal(run.status, 'done'); // notify_admin skipped (no chat configured) does not fail the run
  assert.equal(run.actions_result[2].skipped, 'not_configured');
});
await test('preview writes nothing and warns about live SMS without test mobile', async () => {
  const h = harness({ CRM_AUTOMATION_ENABLED: '1' });
  const p = await h.engine.previewRule(smsRule({ dry_run: false }));
  assert.equal(p.total_checked, 2); assert.equal(p.matched, 1);
  assert.ok(p.warnings.some((w) => w.includes('شماره واقعی')));
  assert.equal(p.items[0].mobile_masked, '0912***01');
  assert.equal((h.store().automation_runs || []).length, 0); assert.equal(h.sent.length, 0);
});
console.log(`\n${passed} automation tests passed`);
