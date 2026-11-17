#!/usr/bin/env node
/**
 * Unit tests for ocrProviders.ts (no network).
 * Run: npm run test:ocr-providers
 */
import assert from 'node:assert/strict';
import {
  parseJsonObject, attemptTimeoutMs, resolveVisionEndpoint, visionModelsFromEnv,
  ocrWithGeminiClients, ocrWithOpenAiVision, withTimeoutAbort, DEFAULT_OCR_VISION_MODELS,
} from '../ocrProviders.ts';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await test('parseJsonObject reads bare and fenced JSON, rejects junk', () => {
  assert.deepEqual(parseJsonObject('{"first_name":"علی"}'), { first_name: 'علی' });
  assert.deepEqual(parseJsonObject('```json\n{"first_name":"علی"}\n```'), { first_name: 'علی' });
  assert.equal(parseJsonObject('invalid json'), null);
  assert.equal(parseJsonObject(''), null);
});

await test('attemptTimeoutMs default and clamp', () => {
  assert.equal(attemptTimeoutMs({}), 12000);
  assert.equal(attemptTimeoutMs({ GEMINI_OCR_ATTEMPT_TIMEOUT_MS: '15000' }), 15000);
  assert.equal(attemptTimeoutMs({ GEMINI_OCR_ATTEMPT_TIMEOUT_MS: '2000' }), 3000);
  assert.equal(attemptTimeoutMs({ GEMINI_OCR_ATTEMPT_TIMEOUT_MS: '30000' }), 25000);
});

await test('resolveVisionEndpoint prefers OCR_VISION_* and joins /v1/chat/completions', () => {
  assert.deepEqual(
    resolveVisionEndpoint({ OCR_VISION_API_URL: 'https://example.com', OCR_VISION_API_KEY: 'key1' }),
    { apiUrl: 'https://example.com/v1/chat/completions', apiKey: 'key1' },
  );
  assert.deepEqual(
    resolveVisionEndpoint({ OCR_VISION_API_URL: 'https://example.com/v1', OCR_VISION_API_KEY: 'key1' }),
    { apiUrl: 'https://example.com/v1/chat/completions', apiKey: 'key1' },
  );
  assert.deepEqual(
    resolveVisionEndpoint({ OCR_VISION_API_URL: 'https://example.com/v1/chat/completions', OCR_VISION_API_KEY: 'key1' }),
    { apiUrl: 'https://example.com/v1/chat/completions', apiKey: 'key1' },
  );
  assert.deepEqual(
    resolveVisionEndpoint({ COPILOT_API_URL: 'https://gateway.test/v1', COPILOT_API_KEY: 'key2' }),
    { apiUrl: 'https://gateway.test/v1/chat/completions', apiKey: 'key2' },
  );
  assert.equal(resolveVisionEndpoint({ OCR_VISION_API_URL: 'https://example.com' }), null);
  assert.equal(resolveVisionEndpoint({}), null);
});

await test('visionModelsFromEnv', () => {
  assert.deepEqual(visionModelsFromEnv({ OCR_VISION_MODELS: 'model1, model2' }), ['model1', 'model2']);
  assert.deepEqual(visionModelsFromEnv({}), [...DEFAULT_OCR_VISION_MODELS]);
});

await test('ocrWithGeminiClients: first model times out, second is used and aborted the first', async () => {
  const aborted = [];
  const clients = [{
    models: {
      generateContent: async (req) => {
        if (req.model === 'model1') {
          return new Promise((_, reject) => {
            req.config.abortSignal.addEventListener('abort', () => {
              aborted.push('model1');
              reject(new Error('aborted'));
            });
          });
        }
        return { text: '{"first_name":"علی"}' };
      },
    },
  }];
  const result = await ocrWithGeminiClients({
    clients,
    cooldownUntil: [0],
    models: ['model1', 'model2'],
    prompt: 'prompt',
    fileBuffer: Buffer.from(''),
    mimeType: 'image/jpeg',
    timeoutMs: 50,
  });
  assert.deepEqual(result, { first_name: 'علی', provider: 'gemini:model2' });
  assert.deepEqual(aborted, ['model1']);
});

await test('ocrWithGeminiClients: 429 parks key#1 and uses key#2', async () => {
  const cooldownUntil = [0, 0];
  const now = () => 1_000;
  const result = await ocrWithGeminiClients({
    clients: [
      { models: { generateContent: async () => { throw new Error('429 RESOURCE_EXHAUSTED'); } } },
      { models: { generateContent: async () => ({ text: '{"first_name":"علی"}' }) } },
    ],
    cooldownUntil,
    models: ['model1'],
    prompt: 'prompt',
    fileBuffer: Buffer.from(''),
    mimeType: 'image/jpeg',
    now,
  });
  assert.deepEqual(result, { first_name: 'علی', provider: 'gemini:model1' });
  assert.equal(cooldownUntil[0], 1_000 + 10 * 60 * 1000);
  assert.equal(cooldownUntil[1], 0);
});

await test('ocrWithOpenAiVision: first HTTP 500, second 200 JSON; auth header present, key not logged', async () => {
  const KEY = 'secret-test-key-should-not-be-logged';
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, model: JSON.parse(init.body).model });
    if (JSON.parse(init.body).model === 'model1') return { ok: false, status: 500 };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"first_name":"علی"}' } }] }),
    };
  };
  const result = await ocrWithOpenAiVision({
    apiUrl: 'https://example.com/v1/chat/completions',
    apiKey: KEY,
    models: ['model1', 'model2'],
    prompt: 'prompt',
    fileBuffer: Buffer.from(''),
    mimeType: 'image/jpeg',
    fetchImpl,
    log: (...args) => logs.push(args.map(String).join(' ')),
  });
  assert.deepEqual(result, { first_name: 'علی', provider: 'vision:model2' });
  assert.deepEqual(calls.map((c) => c.model), ['model1', 'model2']);
  assert.equal(calls[0].auth, `Bearer ${KEY}`);
  assert.equal(JSON.stringify(logs).includes(KEY), false, 'logs must not contain the API key');
});

await test('withTimeoutAbort rejects a hanging promise', async () => {
  let aborted = false;
  const started = Date.now();
  await assert.rejects(
    () => withTimeoutAbort(async (signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {});
    }, 50),
    (err) => {
      assert.equal(err.message, 'ocr attempt timeout');
      return true;
    },
  );
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 1000);
});

console.log(`ocr-providers: ${passed} ok`);
