// Unit checks for Settings → تنظیمات هم‌راز (hamrazSettings.ts): precedence, masking, no secret leak, test call.
// Run: npm run test:hamraz-settings
import assert from 'node:assert/strict';
import { resolveHamraz, publicHamraz, applyHamrazPatch, testCopilotEndpoint, scrub, redactUrl } from '../hamrazSettings.ts';

const KEY = 'sk-live-SECRET-0123456789abcdef';
const env = { COPILOT_API_URL: 'http://127.0.0.1:20130/v1/', COPILOT_API_KEY: KEY, COPILOT_MODEL: 'env/model', COPILOT_SQL_ENABLED: '1' };

// 1. Nothing saved = today's env behavior + defaults.
const d = resolveHamraz({}, env);
assert.equal(d.enabled, true); assert.equal(d.apiUrl, 'http://127.0.0.1:20130/v1'); assert.equal(d.apiKey, KEY);
assert.equal(d.model, 'env/model'); assert.equal(d.maxIterations, 6); assert.equal(d.sqlEnabled, true);
assert.equal(d.smsDirect, true); assert.deepEqual(d.confirm, { sms_send: true, telegram: true, rubika: true });
assert.equal(d.sources.api_key, 'env'); assert.equal(d.sources.sms_send, 'default');
const bare = resolveHamraz({}, {});
assert.equal(bare.model, 'gpt-4o-mini'); assert.equal(bare.sqlEnabled, false); assert.equal(bare.apiUrl, '');
assert.equal(resolveHamraz({}, { COPILOT_SQL_ENABLED: '0' }).sqlEnabled, false);

// 2. Saved wins; empty key keeps the saved key; null resets to env/default.
let saved = applyHamrazPatch({}, { enabled: false, api_url: 'https://ai.example/v1///', api_key: 'Bearer new-key-123456', model: 'x/y:free', max_iterations: 9, sql_enabled: false, sms_direct: false, confirm: { telegram: false } });
const s1 = resolveHamraz({ hamraz: saved }, env);
assert.equal(s1.enabled, false); assert.equal(s1.apiUrl, 'https://ai.example/v1'); assert.equal(s1.apiKey, 'new-key-123456');
assert.equal(s1.model, 'x/y:free'); assert.equal(s1.maxIterations, 9); assert.equal(s1.sqlEnabled, false); assert.equal(s1.smsDirect, false);
assert.deepEqual(s1.confirm, { sms_send: true, telegram: false, rubika: true });
assert.equal(s1.sources.telegram, 'saved'); assert.equal(s1.sources.rubika, 'default');
assert.equal(applyHamrazPatch(saved, { api_key: '' }).api_key, 'new-key-123456');
assert.equal('api_key' in applyHamrazPatch(saved, { clear_api_key: true }), false);
saved = applyHamrazPatch(saved, { sql_enabled: null, confirm: { telegram: null }, model: '' });
const s2 = resolveHamraz({ hamraz: saved }, env);
assert.equal(s2.sqlEnabled, true, 'null -> env'); assert.equal(s2.confirm.telegram, true); assert.equal(s2.model, 'env/model');
assert.throws(() => applyHamrazPatch({}, { api_url: 'ftp://x' }));
assert.throws(() => applyHamrazPatch({}, { max_iterations: 0 }));
assert.throws(() => applyHamrazPatch({}, { max_iterations: 99 }));
assert.throws(() => applyHamrazPatch({}, { model: 'bad model; rm' }));

// 3. Public view never carries the key or URL credentials/query.
const withCreds = resolveHamraz({ hamraz: { api_url: 'https://user:pw@ai.example/v1?key=QSECRET' } }, env);
const pub = JSON.stringify(publicHamraz(withCreds));
assert.equal(pub.includes(KEY), false); assert.equal(pub.includes('pw@'), false); assert.equal(pub.includes('QSECRET'), false);
assert.match(pub, /"api_key_set":true/);
assert.equal(redactUrl('not a url'), '');
assert.equal(scrub(`bad key ${KEY} and Bearer abcdefghijklmnop123`, [KEY]).includes(KEY), false);
assert.equal(scrub('Authorization: Bearer abcdefghijklmnop123', []), 'Authorization: Bearer ***');

// 4. Test call: tiny request, Bearer header, provider error scrubbed.
const calls = [];
const okFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{}' }; };
const t1 = await testCopilotEndpoint(d, okFetch);
assert.equal(t1.ok, true); assert.equal(calls[0].url, 'http://127.0.0.1:20130/v1/chat/completions');
assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
const body = JSON.parse(calls[0].init.body); assert.equal(body.max_tokens <= 5, true); assert.equal('tools' in body, false);
const badFetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: `invalid key ${KEY}` } }) });
const t2 = await testCopilotEndpoint(d, badFetch);
assert.equal(t2.ok, false); assert.equal(JSON.stringify(t2).includes(KEY), false); assert.equal(t2.status, 401);
const throwFetch = async () => { throw new Error(`connect ECONNREFUSED ${KEY}`); };
assert.equal(JSON.stringify(await testCopilotEndpoint(d, throwFetch)).includes(KEY), false);
assert.equal((await testCopilotEndpoint(bare, okFetch)).ok, false, 'no url -> fail without a request');
console.log('hamraz-settings: ok');
