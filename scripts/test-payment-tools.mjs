// Unit checks for Ham-Raz payment tools (agent/payment_tools). No network: fetch and the client are stubbed.
// Run: npm run test:payment-tools
import assert from 'node:assert/strict';
import { PAYMENT_TOOLS, toolDefinitions, runPaymentTool, isPaymentTool, executePaymentAction, createZarinpalClient, skillsPrompt, SKILL_FILES } from '../agent/payment_tools/index.ts';
import { restHost, extractCode } from '../agent/payment_tools/client/index.ts';
import { explainError } from '../agent/payment_tools/client/errors.ts';
import { toGregorianDate } from '../agent/payment_tools/tools/util.ts';

const MID = '1a2b3c4d-1111-2222-3333-abcdefab9f0e';
const TOKEN = 'TOKEN-SECRET-abcdefghijklmnopqrstuvwxyz';
const admin = { username: 'admin', role: 'admin' };

// 1. Schemas.
assert.equal(PAYMENT_TOOLS.length, 10);
for (const t of PAYMENT_TOOLS) {
  assert.match(t.name, /^zarinpal_[a-z_]+$/);
  assert.match(t.description, /[\u0600-\u06FF]/, `${t.name} Persian description`);
  assert.equal(t.parameters.type, 'object');
  for (const r of t.parameters.required || []) assert.ok(r in t.parameters.properties, `${t.name}.${r}`);
  assert.equal(isPaymentTool(t.name), true);
}
assert.deepEqual(PAYMENT_TOOLS.filter((t) => t.mutating).map((t) => t.name).sort(), ['zarinpal_refund', 'zarinpal_reverse']);
assert.equal(JSON.stringify(toolDefinitions()).includes('"type":"function"'), true);
assert.equal(isPaymentTool('sms_send'), false);

// 2. Fake client: records every call.
function fakeDeps({ sandbox = true } = {}) {
  const calls = { query: [], rest: [], mutation: 0, queued: [] };
  const sessions = [
    { id: '11', status: 'VERIFIED', amount: 500000, description: 'KRM-00042 pkg_basic', created_at: '2026-11-05T10:00:00+03:30', session_tries: [{ rrn: '999', card_pan: '502229******4321' }] },
    { id: '12', status: 'FAILED', amount: 100000, description: 'x', created_at: '2026-10-01T10:00:00+03:30', session_tries: [] },
  ];
  const client = {
    config: () => ({ merchantId: MID, sandbox, currency: 'IRT', accessToken: TOKEN, publicBaseUrl: '', paymentLinkBase: '' }),
    query: async (q, v) => {
      calls.query.push(q);
      if (/Terminals/.test(q)) return { Terminals: [{ id: '630542', status: 'ACTIVE', domain: 'kermanshahcart.ir', name: 'n', key: MID }] };
      if (/Reconciliation/.test(q)) return { resource: [{ id: '1', status: 'PAID', amount: 2000000, payable_at: '2026-11-01T00:00:00+03:30', reference_id: 'R', reconciled_at: null }] };
      if (/Session\(id:/.test(q)) return { Session: sessions.filter((s) => s.id === v.id) };
      return { Session: (v.offset || 0) === 0 ? sessions : [] };
    },
    rest: async () => ({}),
    inquiry: async (a) => { calls.rest.push(`inquiry:${a}`); return { status: 'VERIFIED', code: 100 }; },
    unverified: async () => { calls.rest.push('unverified'); return { code: 100, authorities: [{ authority: 'A0001', amount: 50000, date: '2026-11-11' }] }; },
    verify: async (a, amt) => { calls.rest.push(`verify:${a}:${amt}`); return { code: 100, ref_id: 77, card_pan: '603799******1111' }; },
    reverse: async (a) => { calls.rest.push(`reverse:${a}`); return { code: 100, message: 'Reversed' }; },
    mutationAddRefund: async () => { calls.mutation++; return { id: 'RF1' }; },
  };
  const deps = {
    client,
    links: { createLink: async (sid, amount) => ({ code: 'ABC123', amount, expires_at: null }), studentInfo: async (id) => (id === 5 ? { first_name: 'علی', last_name: 'تست', phone_number: '09120000000' } : null), studentDebt: async () => 300000 },
    paymentLinkBase: () => 'https://kermanshahcart.ir/p/',
    queueConfirmation: (ctx, action, label, summary) => { calls.queued.push(action); return { pending_id: `pay_${calls.queued.length}`, preview: summary }; },
  };
  return { deps, calls };
}

// 3. Read tools: query only, no mutation, no secrets in outputs.
{
  const { deps, calls } = fakeDeps();
  const outs = [];
  outs.push(await runPaymentTool('zarinpal_list_terminals', {}, admin, deps));
  const tx = await runPaymentTool('zarinpal_list_transactions', { from_date: '1405/08/01', to_date: '1405/08/30' }, admin, deps); outs.push(tx);
  assert.equal(tx.total, 1, 'date filter (jalali Aban 1405)'); assert.equal(tx.rows[0].amount_toman, 50000); assert.equal(tx.rows[0].card, '****4321');
  assert.equal(tx.successful_total_toman, 50000);
  const all = await runPaymentTool('zarinpal_list_transactions', {}, admin, deps); assert.equal(all.total, 2); assert.deepEqual(all.by_status, { VERIFIED: 1, FAILED: 1 });
  const krm = await runPaymentTool('zarinpal_list_transactions', { description_contains: 'krm-00042' }, admin, deps); assert.equal(krm.total, 1);
  await runPaymentTool('zarinpal_list_transactions', { status: 'VERIFIED' }, admin, deps);
  assert.ok(calls.query.some((q) => /filter: VERIFIED/.test(q)));
  outs.push(await runPaymentTool('zarinpal_transaction_inquiry', { authority: 'A00000000000000000000000000000abcd' }, admin, deps));
  outs.push(await runPaymentTool('zarinpal_unverified_list', {}, admin, deps));
  outs.push(await runPaymentTool('zarinpal_reconcile_list', { status: 'PAID' }, admin, deps));
  outs.push(await runPaymentTool('zarinpal_error_explain', { code: '-62' }, admin, deps));
  assert.equal(calls.query.every((q) => /^\s*query\b/.test(q) && !/\bmutation\b/i.test(q)), true, 'read tools only query');
  assert.equal(calls.mutation, 0);
  assert.equal(calls.rest.some((r) => r.startsWith('reverse')), false);
  const blob = JSON.stringify(outs);
  assert.equal(blob.includes(MID), false, 'merchant id leaked'); assert.equal(blob.includes(TOKEN), false, 'token leaked');
  assert.equal(/\d{6}\*{6}\d{4}/.test(blob), false, 'unmasked card');
  assert.equal(outs[0].terminals[0].is_configured_merchant, true);
}

// 4. Mutating tools only queue; nothing runs before confirmation. Refund blocked in sandbox.
{
  const { deps, calls } = fakeDeps({ sandbox: true });
  const rv = await runPaymentTool('zarinpal_reverse', { authority: 'A00000000000000000000000000000abcd' }, admin, deps);
  assert.ok(rv.pending_id); assert.equal(calls.rest.some((r) => r.startsWith('reverse')), false, 'reverse not executed by the tool');
  const rf = await runPaymentTool('zarinpal_refund', { session_id: '11' }, admin, deps);
  assert.match(rf.error, /sandbox/);
  assert.equal(calls.mutation, 0);
}
{
  const { deps, calls } = fakeDeps({ sandbox: false });
  const rf = await runPaymentTool('zarinpal_refund', { session_id: '11', amount_toman: 20000 }, admin, deps);
  assert.ok(rf.pending_id); assert.match(rf.preview, /\*\*\*\*4321/); assert.equal(calls.mutation, 0, 'refund not executed by the tool');
  assert.deepEqual(calls.queued.at(-1), { kind: 'refund', session_id: '11', amount_rial: 200000, description: 'استرداد از CRM', card: '****4321' });
  assert.match((await runPaymentTool('zarinpal_refund', { session_id: '11', amount_toman: 999999 }, admin, deps)).error, /مبلغ/);
  // the executor (called only from «تأیید») is what runs it
  const ex = await executePaymentAction(deps.client, calls.queued.at(-1));
  assert.equal(ex.ok, true); assert.equal(calls.mutation, 1);
  assert.equal((await executePaymentAction(deps.client, { kind: 'reverse', authority: 'A1', amount_toman: null, status: 'PAID' })).ok, true);
}

// 5. Non-admin blocked; payment link + verify.
{
  const { deps } = fakeDeps();
  assert.match((await runPaymentTool('zarinpal_list_transactions', {}, { username: 'c', role: 'cashier' }, deps)).error, /مدیر/);
  const link = await runPaymentTool('zarinpal_create_payment_link', { student_id: 5 }, admin, deps);
  assert.equal(link.url, 'https://kermanshahcart.ir/p/ABC123'); assert.equal(link.amount_toman, 300000);
  assert.match((await runPaymentTool('zarinpal_create_payment_link', { student_id: 9 }, admin, deps)).error, /پیدا نشد/);
  const { deps: d2, calls: c2 } = fakeDeps();
  const v = await runPaymentTool('zarinpal_verify_payment', { authority: 'A00000000000000000000000000000abcd', amount_toman: 1000 }, admin, d2);
  assert.equal(v.ok, true); assert.equal(v.card, '****1111'); assert.ok(c2.rest.includes('verify:A00000000000000000000000000000abcd:1000'), 'IRT: toman as-is');
}

// 6. Client: sandbox host selection, error-code mapping, query-only GraphQL helper.
assert.equal(restHost(true), 'https://sandbox.zarinpal.com'); assert.equal(restHost(false), 'https://payment.zarinpal.com');
for (const sandbox of [true, false]) {
  const urls = [];
  const c = createZarinpalClient(() => ({ merchantId: MID, sandbox, currency: 'IRR', accessToken: `Bearer ${TOKEN}`, publicBaseUrl: '', paymentLinkBase: '', sources: {} }),
    async (url, init) => { urls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ data: { code: 100, status: 'PAID' } }) }; });
  await c.inquiry('A0000000000000000001');
  assert.equal(urls[0].url, `${sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com'}/pg/v4/payment/inquiry.json`);
  await c.query('query { Me { id } }');
  assert.equal(urls[1].init.headers.authorization, `Bearer ${TOKEN}`, 'Bearer prefix stripped once');
  await assert.rejects(() => c.query('mutation { AddRefund { id } }'));
}
{
  const c = createZarinpalClient(() => ({ merchantId: MID, sandbox: true, currency: 'IRR', accessToken: '', publicBaseUrl: '', paymentLinkBase: '', sources: {} }),
    async () => ({ ok: false, status: 404, json: async () => ({ message: 'Invalid authority', errors: { authority: ['Invalid authority.', '-54'] } }) }));
  await assert.rejects(() => c.inquiry('A0000000000000000001'), (e) => e.code === -54 && /اتوریتی/.test(e.message) && !e.message.includes(MID));
}
assert.equal(extractCode({ data: {}, errors: { code: -62 } }), -62);
assert.equal(explainError('-62').type, 'PaymentReverse'); assert.equal(explainError('abc'), null);
assert.equal(toGregorianDate('۱۴۰۵/۰۸/۲۰'), '2026-11-11'); assert.equal(toGregorianDate('2026-11-11'), '2026-11-11'); assert.equal(toGregorianDate('bad'), '');

// 7. Skills load.
const sp = skillsPrompt();
for (const f of SKILL_FILES) assert.ok(sp.includes(`## ${f.replace('.md', '')}`), f);
console.log('payment-tools: ok');
