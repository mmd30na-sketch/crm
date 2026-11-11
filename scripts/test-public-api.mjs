// Unit checks for the public API helpers (no server, no DB): key format/hash, webhook signing, URL guard.
// Run: node --import tsx scripts/test-public-api.mjs
import assert from 'node:assert/strict';
import { generateApiKey, hashApiKey, apiStudent } from '../publicApi.ts';
import { signPayload, verifySignature, validateWebhookUrl } from '../webhooks.ts';

const { key, prefix } = generateApiKey();
assert.match(key, /^crm_live_[0-9A-Za-z]{32}$/);
assert.equal(prefix, key.slice(0, 12));
assert.match(hashApiKey(key), /^[0-9a-f]{64}$/);
assert.notEqual(generateApiKey().key, key);

const body = JSON.stringify({ id: 'x', event: 'ping', data: {} });
const t = Math.floor(Date.now() / 1000);
const header = signPayload('whsec_test', t, body);
assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
assert.equal(verifySignature('whsec_test', header, body), true);
assert.equal(verifySignature('whsec_other', header, body), false);
assert.equal(verifySignature('whsec_test', header, body + ' '), false);
assert.equal(verifySignature('whsec_test', signPayload('whsec_test', t - 3600, body), body), false, 'stale timestamp');

process.env.NODE_ENV = 'production';
assert.equal(validateWebhookUrl('https://example.com/hook'), 'https://example.com/hook');
for (const bad of ['http://example.com', 'https://10.0.0.5/x', 'https://192.168.1.2', 'https://127.0.0.1', 'https://localhost/x', 'https://u:p@example.com', 'ftp://x', 'nope']) {
  assert.throws(() => validateWebhookUrl(bad), undefined, bad);
}

const s = apiStudent({ id: '3', first_name: 'a', last_name: 'b', national_code: '1', phone_number: '2', address: 'secret', id_card_url: '/x' });
assert.equal(s.id, 3);
assert.equal('address' in s, false);
assert.equal('id_card_url' in s, false);
console.log('public-api helpers: ok');
