// Unit checks for the Ham-Raz primary -> fallback model chain (hamrazSettings.ts), with a mocked fetch.
// Run: npm run test:copilot-model-fallback
import assert from 'node:assert/strict';
import {
  resolveHamraz, callCopilotCompletionWithFallback, CopilotCompletionError,
  DEFAULT_MODEL_FALLBACKS, modelChain,
} from '../hamrazSettings.ts';

const KEY = 'sk-live-SECRET-0123456789abcdef';
const ENV = { COPILOT_API_URL: 'http://gateway.test/v1', COPILOT_API_KEY: KEY };

const reply = (content, extra = {}) => ({
  choices: [{ message: { role: 'assistant', content, ...extra } }],
});
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});
const mockFetch = (handlers) => {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, model: body.model, init, body });
    const handler = handlers[body.model];
    if (!handler) throw new Error(`unexpected model ${body.model}`);
    return handler;
  };
  fn.calls = calls;
  return fn;
};

// 0. Chain building: primary first, de-duplicated, defaults/env/saved precedence.
assert.deepEqual(modelChain('b', ['a', 'b', 'a']), ['b', 'a']);
const defaults = resolveHamraz({}, ENV);
assert.deepEqual(defaults.modelFallbacks, DEFAULT_MODEL_FALLBACKS.filter((m) => m !== defaults.model));
const fromEnv = resolveHamraz({}, { ...ENV, COPILOT_MODEL: 'primary', COPILOT_MODEL_FALLBACKS: 'a, b, a' });
assert.deepEqual(fromEnv.modelFallbacks, ['a', 'b']);
assert.equal(fromEnv.sources.model_fallbacks, 'env');
const fromSaved = resolveHamraz({ hamraz: { model: 'primary', model_fallbacks: ['b', 'primary', 'b'] } }, { ...ENV, COPILOT_MODEL_FALLBACKS: 'env-model' });
assert.deepEqual(fromSaved.modelFallbacks, ['b']);
assert.equal(fromSaved.sources.model_fallbacks, 'saved');

// 1. Primary 429/quota -> fallback 200.
const e1 = resolveHamraz({ hamraz: { model: 'primary/model', model_fallbacks: ['fallback/a', 'fallback/b'] } }, ENV);
const f1 = mockFetch({
  'primary/model': response(429, { error: { message: `quota exceeded for ${KEY}` } }),
  'fallback/a': response(200, reply('hello from fallback')),
});
const r1 = await callCopilotCompletionWithFallback(e1, { messages: [{ role: 'user', content: 'hi' }], withTools: false }, f1);
assert.equal(r1.model, 'fallback/a');
assert.equal(r1.completion.choices[0].message.content, 'hello from fallback');
assert.deepEqual(f1.calls.map((c) => c.model), ['primary/model', 'fallback/a']);
assert.equal(f1.calls[0].url, 'http://gateway.test/v1/chat/completions');
assert.equal(f1.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
assert.equal(JSON.stringify(r1.attempts).includes(KEY), false, 'attempt details must not leak the key');

// 2. Primary 401 (bad key/url) must NOT try another model.
const e2 = resolveHamraz({ hamraz: { model: 'primary/model', model_fallbacks: ['fallback/a'] } }, ENV);
const f2 = mockFetch({
  'primary/model': response(401, { error: { message: `invalid key ${KEY}` } }),
});
await assert.rejects(
  () => callCopilotCompletionWithFallback(e2, { messages: [{ role: 'user', content: 'hi' }], withTools: false }, f2),
  (err) => {
    assert.equal(err instanceof CopilotCompletionError, true);
    assert.equal(err.status, 401);
    assert.equal(err.retryable, false);
    assert.equal(String(err.message).includes(KEY), false, 'provider error must be scrubbed');
    return true;
  },
);
assert.deepEqual(f2.calls.map((c) => c.model), ['primary/model']);

// 3. Empty assistant content -> next model.
const e3 = resolveHamraz({ hamraz: { model: 'primary/model', model_fallbacks: ['fallback/a'] } }, ENV);
const f3 = mockFetch({
  'primary/model': response(200, reply('   ')),
  'fallback/a': response(200, reply('non-empty answer')),
});
const r3 = await callCopilotCompletionWithFallback(e3, { messages: [{ role: 'user', content: 'hi' }], withTools: true }, f3);
assert.equal(r3.model, 'fallback/a');
assert.equal(r3.completion.choices[0].message.content, 'non-empty answer');
assert.deepEqual(f3.calls.map((c) => c.model), ['primary/model', 'fallback/a']);
assert.equal('tools' in f3.calls[0].body, true);

// 4. A successful primary never calls the fallback.
const e4 = resolveHamraz({ hamraz: { model: 'primary/model', model_fallbacks: ['fallback/a'] } }, ENV);
const f4 = mockFetch({ 'primary/model': response(200, reply('primary answer')) });
const r4 = await callCopilotCompletionWithFallback(e4, { messages: [{ role: 'user', content: 'hi' }], withTools: false }, f4);
assert.equal(r4.model, 'primary/model');
assert.equal(r4.completion.choices[0].message.content, 'primary answer');
assert.deepEqual(f4.calls.map((c) => c.model), ['primary/model']);

// 5. Quota/rate-limit text on a non-5xx status is retryable; 403 is not.
const e5 = resolveHamraz({ hamraz: { model: 'primary/model', model_fallbacks: ['fallback/a'] } }, ENV);
const f5 = mockFetch({
  'primary/model': response(400, { error: { message: 'Resource EXHAUSTED, slow down' } }),
  'fallback/a': response(200, reply('after text retry')),
});
const r5 = await callCopilotCompletionWithFallback(e5, { messages: [{ role: 'user', content: 'hi' }], withTools: false }, f5);
assert.equal(r5.model, 'fallback/a');
assert.deepEqual(f5.calls.map((c) => c.model), ['primary/model', 'fallback/a']);
const e6 = resolveHamraz({ hamraz: { model: 'primary/model', model_fallbacks: ['fallback/a'] } }, ENV);
const f6 = mockFetch({ 'primary/model': response(403, { error: { message: 'quota denied' } }) });
await assert.rejects(() => callCopilotCompletionWithFallback(e6, { messages: [{ role: 'user', content: 'hi' }], withTools: false }, f6));
assert.deepEqual(f6.calls.map((c) => c.model), ['primary/model']);

console.log('copilot-model-fallback: ok');
