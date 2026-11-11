// Unit checks for Settings → درگاه پرداخت (zarinpalSettings.ts): env fallback, masking, secrets never in the
// public view, query-only GraphQL. No server, no DB, no network (fetch is stubbed).
// Run: npm run test:zarinpal-settings
import assert from 'node:assert/strict';
import {
  resolveZarinpal, publicZarinpal, applyZarinpalPatch, maskTail, maskCard, normalizeAccessToken,
  isMerchantUuid, zarinpalQuery, fetchTerminals, fetchSessions, fetchAllSessions, countByStatus, toZarinpalConfig,
} from '../zarinpalSettings.ts';
import { zarinpalConfigFromEnv } from '../zarinpal.ts';

const MID = '1a2b3c4d-1111-2222-3333-abcdefab9f0e';
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOi.SECRET-TOKEN-VALUE.zz';
const env = { ZARINPAL_MERCHANT_ID: MID, ZARINPAL_SANDBOX: '1', ZARINPAL_CURRENCY: 'IRR', PUBLIC_BASE_URL: 'https://crm.example', CRM_PAYMENT_LINK_BASE: 'https://site.example/p/', ZARINPAL_ACCESS_TOKEN: `Bearer  ${TOKEN}\n` };

// 1. Nothing saved: same config as the env-only path used today.
for (const e of [env, {}, { ZARINPAL_SANDBOX: '0' }, { ZARINPAL_SANDBOX: '' }, { ZARINPAL_CURRENCY: 'irt' }]) {
  const saved = process.env;
  process.env = { ...e };
  try { assert.deepEqual(toZarinpalConfig(resolveZarinpal({}, e)), zarinpalConfigFromEnv(''), JSON.stringify(e)); }
  finally { process.env = saved; }
}
const r0 = resolveZarinpal({}, env);
assert.equal(r0.publicBaseUrl, 'https://crm.example');
assert.equal(r0.paymentLinkBase, 'https://site.example/p/');
assert.equal(r0.accessToken, TOKEN, 'Bearer prefix + whitespace stripped');
assert.equal(r0.sources.merchant_id, 'env');
// legacy gateways.zarinpal_merchant_id stays below env (as before)
assert.equal(resolveZarinpal({ zarinpal_merchant_id: 'legacy' }, env).merchantId, MID);
assert.equal(resolveZarinpal({ zarinpal_merchant_id: 'legacy' }, {}).merchantId, 'legacy');

// 2. Saved values win over env.
const saved = applyZarinpalPatch({}, { merchant_id: MID.replace('9f0e', '7777'), sandbox: false, currency: 'irt', access_token: ' Bearer abc ', public_base_url: 'https://x.example' });
const r1 = resolveZarinpal({ zarinpal: saved }, env);
assert.equal(r1.sandbox, false); assert.equal(r1.currency, 'IRT'); assert.equal(r1.accessToken, 'abc');
assert.equal(r1.merchantId.endsWith('7777'), true); assert.equal(r1.sources.sandbox, 'saved');
assert.equal(r1.paymentLinkBase, 'https://site.example/p/', 'unsaved field still falls back to env');
// empty secret keeps the saved value; clear_* removes it
assert.equal(applyZarinpalPatch(saved, { access_token: '' }).access_token, 'abc');
assert.equal('access_token' in applyZarinpalPatch(saved, { clear_access_token: true }), false);
assert.throws(() => applyZarinpalPatch({}, { merchant_id: 'not-a-uuid' }));
assert.throws(() => applyZarinpalPatch({}, { public_base_url: 'javascript:alert(1)' }));
assert.throws(() => applyZarinpalPatch({}, { currency: 'USD' }));

// 3. Masking + secrets never in the public view.
assert.equal(maskTail(MID), '****9f0e');
assert.equal(maskTail(''), '');
assert.equal(maskCard('502229******1234'), '****1234');
assert.equal(maskCard(null), '');
assert.equal(normalizeAccessToken('  bearer a b\nc '), 'abc');
assert.equal(isMerchantUuid(MID), true); assert.equal(isMerchantUuid(TOKEN), false);
const pub = JSON.stringify(publicZarinpal(r0));
assert.equal(pub.includes(MID), false, 'merchant id leaked');
assert.equal(pub.includes(TOKEN), false, 'token leaked');
assert.equal(pub.includes('SECRET'), false);
assert.match(pub, /"access_token_set":true/);
assert.match(pub, /"merchant_id_masked":"\*\*\*\*9f0e"/);
assert.equal(publicZarinpal(resolveZarinpal({}, {})).status, 'not_configured');
assert.equal(publicZarinpal(r0).status, 'sandbox');

// 4. GraphQL: query only, Bearer header, terminal key never returned, rial -> toman, card masked.
await assert.rejects(() => zarinpalQuery(TOKEN, 'mutation { TerminalAdd { id } }'));
await assert.rejects(() => zarinpalQuery(TOKEN, 'query { x } mutation { y }'));
await assert.rejects(() => zarinpalQuery('', 'query { Me { id } }'));
const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  const q = JSON.parse(init.body).query;
  const data = q.includes('Terminals')
    ? { Terminals: [{ id: '630542', status: 'ACTIVE', domain: 'kermanshahcart.ir', name: 'n', key: MID }] }
    : { Session: [{ id: '9', status: 'VERIFIED', amount: 100000, description: 'd', created_at: '2026-11-11T10:00:00+03:30', session_tries: [{ rrn: '123', card_pan: '502229******4321', status: 'PAID' }] }] };
  return { ok: true, status: 200, json: async () => ({ data }) };
};
const terms = await fetchTerminals(`Bearer ${TOKEN}`, MID, fakeFetch);
assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
assert.equal(JSON.stringify(terms).includes(MID), false, 'terminal key leaked');
assert.equal(terms[0].matches_merchant, true);
const rows = await fetchSessions(TOKEN, '630542', 50, 0, fakeFetch);
assert.deepEqual(rows[0], { id: '9', created_at: '2026-11-11T10:00:00+03:30', amount_rial: 100000, amount_toman: 10000, status: 'VERIFIED', description: 'd', rrn: '123', card: '****4321' });
assert.equal(calls.every((c) => /^\s*query\b/.test(JSON.parse(c.init.body).query)), true);

// 5. Full sync: all statuses (no filter arg), every page, de-duplicated, newest first.
const all = Array.from({ length: 9 }, (_, i) => ({ id: String(100 + i), status: i < 4 ? 'VERIFIED' : 'FAILED', amount: 10000 * (i + 1), description: '', created_at: `2026-11-0${i + 1}T10:00:00+03:30`, session_tries: [] }));
const pageCalls = [];
const pagedFetch = async (url, init) => {
  const b = JSON.parse(init.body);
  pageCalls.push(b);
  assert.equal(/filter/i.test(b.query), false, 'sync must not filter by status');
  const { limit, offset } = b.variables;
  const rowsPage = all.slice(offset, offset + limit);
  if (offset === 4) rowsPage.push(all[0]); // duplicate across pages
  return { ok: true, status: 200, json: async () => ({ data: { Session: rowsPage } }) };
};
const full = await fetchAllSessions(TOKEN, '630542', pagedFetch, 4);
assert.equal(full.sessions.length, 9);
assert.equal(full.truncated, false);
assert.equal(pageCalls.length, 3);
assert.deepEqual(countByStatus(full.sessions), { VERIFIED: 4, FAILED: 5 });
assert.equal(full.sessions[0].id, '108', 'newest first');
// an API that ignores offset must not loop forever
const stuck = await fetchAllSessions(TOKEN, 't', async () => ({ ok: true, status: 200, json: async () => ({ data: { Session: all.slice(0, 4) } }) }), 4);
assert.equal(stuck.sessions.length, 4);
console.log('zarinpal-settings: ok');
