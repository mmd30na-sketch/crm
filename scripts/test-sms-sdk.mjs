import assert from 'node:assert/strict';
import {
  smsirVerify,
  smsirBulk,
  smsirCredit,
  smsirRead,
  createSms,
  setSmsirClientFactory,
} from '../shared/sms.ts';

const KEY = 'TESTKEY_abc';
const RATE_LIMIT_FA = 'محدودیت تعداد درخواست پنل پیامک؛ چند ثانیه دیگر دوباره تلاش کنید.';
const TIMEOUT_FA = 'پاسخی از سرویس پیامک نرسید.';

// --- Mock Smsir client: records every call, never touches the network. ---
let calls = [];
let clients = [];
const ok = (data) => ({ status: 1, message: '', data });
const fail = (message, status = 2) => ({ status, message, data: null });
const recording = (name, impl) => async (...args) => {
  calls.push([name, ...args]);
  return impl(...args);
};
const makeClient = (overrides = {}) => ({
  sendVerifyCode: recording('sendVerifyCode', () => ok({ messageId: 1 })),
  sendBulk: recording('sendBulk', () => ok({ packId: 'p1' })),
  getCredit: recording('getCredit', () => ok(12345)),
  getLineNumbers: recording('getLineNumbers', () => ok([30001111])),
  reportTodayLive: recording('reportTodayLive', () => ok([])),
  reportArchive: recording('reportArchive', () => ok([])),
  reportReceiveLive: recording('reportReceiveLive', () => ok([])),
  reportReceiveArchive: recording('reportReceiveArchive', () => ok([])),
  reportMessage: recording('reportMessage', () => ok({ messageId: 123 })),
  ...overrides,
});
const useRecordingFactory = () => setSmsirClientFactory((apiKey, lineNumber) => {
  const c = makeClient();
  clients.push({ apiKey, lineNumber, c });
  return c;
});
useRecordingFactory();
const last = () => clients[clients.length - 1];
const lastCall = () => calls[calls.length - 1];
const reset = () => { calls = []; };

// --- smsirVerify -> sendVerifyCode(mobile, templateId, parameters) ---
reset();
{
  const r = await smsirVerify({ apiKey: KEY, mobile: '09123456789', templateId: 472328, parameters: [{ name: 'DEBT', value: '250000' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(lastCall(), ['sendVerifyCode', '09123456789', 472328, [{ name: 'DEBT', value: '250000' }]]);
  assert.equal(typeof lastCall()[2], 'number'); // numeric template id
  assert.equal(last().apiKey, KEY);
  assert.equal(last().lineNumber, 0); // verify needs no line
}

// --- smsirBulk -> sendBulk(text, [mobile], undefined, customLine) ---
reset();
{
  const r = await smsirBulk({ apiKey: KEY, lineNumber: '30001111', mobile: '09123456789', text: 'سلام' });
  assert.equal(r.ok, true);
  assert.deepEqual(lastCall(), ['sendBulk', 'سلام', ['09123456789'], undefined, 30001111]);
  assert.equal(typeof lastCall()[4], 'number'); // numeric custom line
}

// --- smsirCredit -> getCredit ---
reset();
{
  const r = await smsirCredit(KEY);
  assert.deepEqual(r, { ok: true, credit: 12345 });
  assert.deepEqual(lastCall(), ['getCredit']);
}

// --- smsirRead dispatch table ---
const reads = [
  ['/v1/credit', ['getCredit']],
  ['/v1/line', ['getLineNumbers']],
  ['/v1/send/live?pageNumber=1&pageSize=10', ['reportTodayLive', 1, 10]],
  ['/v1/send/archive?pageNumber=1&pageSize=10', ['reportArchive', 0, 0, 1, 10]], // falsy dates omitted
  ['/v1/receive/live?pageNumber=1&pageSize=10&sortByNewest=true', ['reportReceiveLive', 1, 10, true]],
  ['/v1/receive/archive?pageNumber=1&pageSize=10', ['reportReceiveArchive', 0, 0, 1, 10]],
  ['/v1/send/123', ['reportMessage', 123]],
];
for (const [path, expected] of reads) {
  reset();
  const r = await smsirRead(KEY, path);
  assert.equal(r.ok, true, path);
  assert.deepEqual(lastCall(), expected, path);
}
reset();
{
  const r = await smsirRead(KEY, '/v1/not-in-the-sdk');
  assert.equal(r.ok, false);
}

// --- no key -> not configured ---
{
  const r = await smsirRead('', '/v1/credit');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'درگاه پیامک تنظیم نشده است.');
}

// --- status 20 -> rate-limit message ---
reset();
{
  const c = makeClient({ getCredit: async () => fail('rate limited', 20) });
  setSmsirClientFactory(() => c);
  const r = await smsirRead(KEY, '/v1/credit');
  assert.equal(r.ok, false);
  assert.equal(r.error, RATE_LIMIT_FA);
}

// --- thrown TimeoutError -> Persian timeout message ---
reset();
{
  const e = new Error('timed out'); e.name = 'TimeoutError';
  const c = makeClient({ getLineNumbers: async () => { throw e; } });
  setSmsirClientFactory(() => c);
  const r = await smsirRead(KEY, '/v1/line');
  assert.equal(r.ok, false);
  assert.equal(r.error, TIMEOUT_FA);
}

// --- the API key never appears in any error string ---
reset();
{
  const c = makeClient({
    getCredit: async () => fail(`bad key ${KEY} given`),
    sendVerifyCode: async () => fail(`invalid ${KEY}`),
    reportMessage: async () => { throw new Error(`HTTP 403 for ${KEY}`); },
  });
  setSmsirClientFactory(() => c);
  const a = await smsirRead(KEY, '/v1/credit');
  assert.equal(a.ok, false);
  assert.ok(!a.error.includes(KEY) && a.error.includes('***'));
  const b = await smsirVerify({ apiKey: KEY, mobile: '09123456789', templateId: 472328, parameters: [] });
  assert.equal(b.ok, false);
  assert.ok(!b.error.includes(KEY) && b.error.includes('***'));
  const d = await smsirRead(KEY, '/v1/send/123');
  assert.equal(d.ok, false);
  assert.ok(!d.error.includes(KEY) && d.error.includes('***'));
}

// --- createSms().sendTemplate('debt_balance') still uses verify for template 472328, no network ---
reset();
useRecordingFactory();
{
  process.env.SMS_API_KEY = KEY;
  const debt = { key: 'debt_balance', provider_template_id: '472328', enabled: 1, channel_kind: 'verify', param_names: 'DEBT' };
  const sql = async (q) => {
    if (q.includes("setting_key = 'sms.config'")) return [{ setting_value: JSON.stringify({ provider: 'smsir', lineNumber: '', apiKeyRef: 'env:SMS_API_KEY' }) }];
    if (q.includes('FROM sms_templates')) return [debt];
    throw new Error(`unexpected query: ${q}`);
  };
  const sms = createSms(sql, { cacheMs: 0 });
  const r = await sms.sendTemplate('debt_balance', '09123456789', { DEBT: '250000' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, 'sent');
  assert.equal(r.mode, 'verify');
  assert.deepEqual(lastCall(), ['sendVerifyCode', '09123456789', 472328, [{ name: 'DEBT', value: '250000' }]]);
}

// --- restore the real factory (no mock left behind) ---
setSmsirClientFactory(null);
console.log('sms sdk: ok');
