// Unit checks for the official-SDK wrapper (zarinpal.ts). No network and no DB: a fake SDK client is
// injected with setZarinpalClientFactory() and every assertion runs against recorded calls.
// Run: npm run test:zarinpal-sdk
import assert from 'node:assert/strict';
import {
  zarinpalConfigFromEnv, sandboxFromEnv, toGatewayAmount, startPayUrl, minGatewayAmount, MIN_AMOUNT_TOMAN,
  parseZarinpalError, requestPayment, verifyPayment, unverifiedList, inquiry, reverse, feeCalculation,
  setZarinpalClientFactory, createZarinpalSdkClient, ZARINPAL_HTTP_TIMEOUT_MS,
} from '../zarinpal.ts';

const MID = '1a2b3c4d-1111-2222-3333-abcdefab9f0e';
const cfgIrr = { merchantId: MID, sandbox: false, currency: 'IRR' };
const cfgIrt = { merchantId: MID, sandbox: true, currency: 'IRT' };

/** Fake SDK client: records every call and replays canned responses. */
function fakeSdk({ responses = {}, errors = {} } = {}) {
  const calls = [];
  const boom = (m, body) => Object.assign(new Error(m), body ? { response: { data: body } } : {});
  const run = (method) => async (args) => {
    calls.push({ method, args });
    if (errors[method]) throw errors[method] === 'plain' ? new Error('boom') : errors[method];
    const r = responses[method];
    if (r && r.__throw) throw boom(r.message, r.body);
    return r ?? {};
  };
  return {
    calls,
    responses,
    errors,
    payments: { create: run('payments.create'), feeCalculation: run('payments.feeCalculation'), getRedirectUrl: (a) => `https://payment.zarinpal.com/pg/StartPay/${a}` },
    verifications: { verify: run('verifications.verify') },
    unverified: { list: run('unverified.list') },
    inquiries: { inquire: run('inquiries.inquire') },
    reversals: { reverse: run('reversals.reverse') },
  };
}

let sdk = fakeSdk();
setZarinpalClientFactory(() => sdk);
const restore = () => { sdk = fakeSdk(); return sdk; };

// 1. Sandbox flag is unified: ONLY '1'/'true' is sandbox; '0', '' and anything else are production.
assert.equal(sandboxFromEnv('1'), true);
assert.equal(sandboxFromEnv('true'), true);
assert.equal(sandboxFromEnv('TRUE'), true);
assert.equal(sandboxFromEnv('0'), false);
assert.equal(sandboxFromEnv(''), false);
assert.equal(sandboxFromEnv('false'), false);
assert.equal(sandboxFromEnv(undefined), false, 'unset = production');
assert.equal(sandboxFromEnv('yes'), false);
for (const [v, expected] of [['1', true], ['true', true], ['0', false], ['', false], [undefined, false]]) {
  const saved = process.env.ZARINPAL_SANDBOX;
  if (v === undefined) delete process.env.ZARINPAL_SANDBOX; else process.env.ZARINPAL_SANDBOX = v;
  try { assert.equal(zarinpalConfigFromEnv(MID).sandbox, expected, `ZARINPAL_SANDBOX=${String(v)}`); }
  finally { if (saved === undefined) delete process.env.ZARINPAL_SANDBOX; else process.env.ZARINPAL_SANDBOX = saved; }
}
// The real SDK client keeps working; no network call happens here.
{
  const zp = createZarinpalSdkClient({ merchantId: MID, sandbox: true, currency: 'IRR' });
  assert.equal(zp.getBaseUrl(), 'https://sandbox.zarinpal.com');
}

// 2. Currency: IRR sends Toman*10 AND currency:'IRR'; IRT sends Toman as-is AND currency:'IRT'.
assert.equal(toGatewayAmount(1000, cfgIrr), 10000);
assert.equal(toGatewayAmount(1000, cfgIrt), 1000);
assert.equal(toGatewayAmount(1500.7, cfgIrr), 15007);
assert.equal(minGatewayAmount(cfgIrr), 10000);
assert.equal(minGatewayAmount(cfgIrt), 1000);
assert.equal(MIN_AMOUNT_TOMAN, 1000);

// 3. requestPayment: amount + currency + metadata shape (order_id, mobile, email) + StartPay from the SDK.
{
  const fresh = restore();
  fresh.responses['payments.create'] = { data: { code: 100, authority: 'A0000000000000000000000000000abcd123' } };
  const out = await requestPayment(cfgIrr, { amountToman: 2500, description: 'پرداخت قسط', callbackUrl: 'https://x.example/cb', mobile: '09123456789', email: 'a@b.co', orderId: 'online-12' });
  assert.equal(out.authority, 'A0000000000000000000000000000abcd123');
  assert.equal(out.paymentUrl, `https://payment.zarinpal.com/pg/StartPay/A0000000000000000000000000000abcd123`);
  const arg = fresh.calls.find((c) => c.method === 'payments.create').args;
  assert.equal(arg.amount, 25000, 'IRR: toman*10');
  assert.equal(arg.currency, 'IRR');
  assert.deepEqual(arg.metadata, { mobile: '09123456789', email: 'a@b.co', order_id: 'online-12' });
  assert.equal(arg.mobile, '09123456789');
  assert.equal(arg.email, 'a@b.co');
}
{
  const fresh = restore();
  fresh.responses['payments.create'] = { data: { code: 100, authority: 'A' + 'x'.repeat(35) } };
  await requestPayment(cfgIrt, { amountToman: 3000, description: 'd', callbackUrl: 'https://x.example/cb', orderId: 'online-9' });
  const arg = fresh.calls.find((c) => c.method === 'payments.create').args;
  assert.equal(arg.amount, 3000, 'IRT: toman as-is');
  assert.equal(arg.currency, 'IRT');
  assert.deepEqual(arg.metadata, { order_id: 'online-9' }, 'junk/absent mobile+email are skipped');
  assert.equal('mobile' in arg, false);
}
// Sandbox StartPay host comes from the SDK (sandbox.zarinpal.com), never www.zarinpal.com.
assert.equal(startPayUrl('A1', cfgIrr), 'https://payment.zarinpal.com/pg/StartPay/A1');
assert.equal(startPayUrl('A1', cfgIrt), 'https://sandbox.zarinpal.com/pg/StartPay/A1');

// 4. Description is cut at 500 chars (docs), not 255.
{
  const fresh = restore();
  fresh.responses['payments.create'] = { data: { code: 100, authority: 'A' + 'y'.repeat(35) } };
  await requestPayment(cfgIrr, { amountToman: 1000, description: 'و'.repeat(700), callbackUrl: 'https://x.example/cb' });
  assert.equal(fresh.calls[0].args.description.length, 500);
}

// 5. Minimum amount: below 1000 toman is rejected in Persian, before any network call.
{
  const fresh = restore();
  await assert.rejects(() => requestPayment(cfgIrr, { amountToman: 500, description: 'd', callbackUrl: 'https://x.example/cb' }), /تومان/);
  await assert.rejects(() => requestPayment(cfgIrt, { amountToman: 999, description: 'd', callbackUrl: 'https://x.example/cb' }), /تومان/);
  assert.equal(fresh.calls.length, 0, 'no SDK call for a too-small amount');
  // Exactly at the minimum is accepted.
  fresh.responses['payments.create'] = { data: { code: 100, authority: 'A' + 'm'.repeat(35) } };
  const out = await requestPayment(cfgIrr, { amountToman: 1000, description: 'd', callbackUrl: 'https://x.example/cb' });
  assert.match(out.paymentUrl, /StartPay/);
}

// 6. Error parsing: array and object shapes, plus validations numeric codes.
assert.deepEqual(parseZarinpalError([{ code: -54, message: 'Invalid authority.' }]), { code: -54, message: 'Invalid authority.' });
assert.deepEqual(parseZarinpalError({ message: 'خطا', code: -9 }), { code: -9, message: 'خطا' });
assert.deepEqual(parseZarinpalError({ validations: { authority: ['Invalid authority.', '-54'] } }), { code: -54, message: 'Invalid authority.' });
assert.deepEqual(parseZarinpalError(null, 'پیش‌فرض'), { code: null, message: 'پیش‌فرض' });
// requestPayment surfaces the gateway message from both shapes.
{
  const fresh = restore();
  fresh.responses['payments.create'] = { data: { code: -10 }, errors: [{ code: -10, message: 'Invalid merchant or ip.' }] };
  await assert.rejects(() => requestPayment(cfgIrr, { amountToman: 2000, description: 'd', callbackUrl: 'https://x.example/cb' }), (e) => e.gateway === true && e.code === -10 && /Invalid merchant/.test(e.message));
}
{
  const fresh = restore();
  fresh.responses['payments.create'] = { data: { code: -10 }, errors: { message: 'Validation failed.', code: -9, validations: { amount: ['Amount is invalid.', '-10'] } } };
  await assert.rejects(() => requestPayment(cfgIrr, { amountToman: 2000, description: 'd', callbackUrl: 'https://x.example/cb' }), (e) => e.gateway === true && e.code === -9 && /Validation failed/.test(e.message));
}
// SDK/axios-level failures (non-2xx) are normalized to a Persian 502, never thrown raw.
{
  const fresh = restore();
  fresh.errors['payments.create'] = { response: { data: { errors: [{ code: -11, message: 'Terminal is not active.' }] } } };
  await assert.rejects(() => requestPayment(cfgIrr, { amountToman: 2000, description: 'd', callbackUrl: 'https://x.example/cb' }), (e) => e.status === 502 && e.code === -11);
}

// 7. verify: 100 and 101 both ok (never throws), card/fee fields come back.
for (const [code, ok] of [[100, true], [101, true]]) {
  const fresh = restore();
  fresh.responses['verifications.verify'] = { data: { code, message: code === 101 ? 'Verified' : 'Success', ref_id: 987654, card_pan: '603799******1111', card_hash: '1Z1', fee: 2500, fee_type: 'MERCHANT' } };
  const r = await verifyPayment(cfgIrr, { amountToman: 4000, authority: 'A' + 'v'.repeat(35) });
  assert.equal(r.ok, ok);
  assert.equal(r.code, code);
  assert.equal(r.refId, '987654');
  assert.equal(r.cardPan, '603799******1111');
  assert.equal(r.cardHash, '1Z1');
  assert.equal(r.fee, 2500);
  assert.equal(r.feeType, 'MERCHANT');
  const arg = fresh.calls[0].args;
  assert.equal(arg.amount, 40000, 'verify uses the same unit as the request (IRR: *10)');
  assert.equal(arg.authority, 'A' + 'v'.repeat(35));
}
{
  const fresh = restore();
  fresh.responses['verifications.verify'] = { data: { code: -50, message: 'amount mismatch' } };
  const r = await verifyPayment(cfgIrr, { amountToman: 4000, authority: 'A' + 'v'.repeat(35) });
  assert.equal(r.ok, false); assert.equal(r.code, -50); assert.equal(r.refId, null);
}
// A failing verify never throws (network down, HTTP 404, gateway logical error).
{
  const fresh = restore();
  fresh.errors['verifications.verify'] = { response: { data: { errors: { code: -51, message: 'Failed.' } } } };
  const r = await verifyPayment(cfgIrr, { amountToman: 1000, authority: 'A' + 'v'.repeat(35) });
  assert.equal(r.ok, false); assert.equal(r.code, -51); assert.match(r.message, /Failed/);
}
{
  const fresh = restore();
  fresh.errors['verifications.verify'] = 'plain';
  const r = await verifyPayment(cfgIrt, { amountToman: 1000, authority: 'A' + 'v'.repeat(35) });
  assert.equal(r.ok, false); assert.equal(r.fee, null);
  assert.equal(fresh.calls[0].args.amount, 1000, 'IRT verify amount as-is');
}

// 8. unverifiedList / inquiry / reverse / feeCalculation via the SDK.
{
  const fresh = restore();
  fresh.responses['unverified.list'] = { data: { code: 100, authorities: [{ authority: 'A' + 'u'.repeat(35), amount: 25000, date: '2026-11-17' }] } };
  const l = await unverifiedList(cfgIrr);
  assert.equal(l.code, 100);
  assert.equal(l.authorities.length, 1);
  assert.equal(l.authorities[0].amount, 25000);
  fresh.responses['inquiries.inquire'] = { data: { code: 100, status: 'PAID', authority: 'A' + 'u'.repeat(35) } };
  assert.equal((await inquiry(cfgIrr, 'A' + 'u'.repeat(35))).status, 'PAID');
  fresh.responses['reversals.reverse'] = { data: { code: 100, message: 'Reversed' } };
  assert.equal((await reverse(cfgIrr, 'A' + 'u'.repeat(35))).code, 100);
  fresh.responses['payments.feeCalculation'] = { data: { code: 100, fee: 25000, fee_type: 'MERCHANT' } };
  const f = await feeCalculation(cfgIrr, 10000);
  assert.equal(f.fee, 25000); assert.equal(f.feeType, 'MERCHANT');
  assert.equal(fresh.calls.find((c) => c.method === 'payments.feeCalculation').args.currency, 'IRR');
  assert.equal(fresh.calls.find((c) => c.method === 'payments.feeCalculation').args.merchant_id, MID);
}
// reverse with a logical error throws a Persian gateway error; feeCalculation error is parsed too.
{
  const fresh = restore();
  fresh.responses['reversals.reverse'] = { data: { code: -63 }, errors: [{ code: -63, message: 'Time expired.' }] };
  await assert.rejects(() => reverse(cfgIrr, 'A' + 'u'.repeat(35)), (e) => e.gateway === true && e.code === -63);
  fresh.responses['payments.feeCalculation'] = { data: { code: -9 }, errors: { message: 'Bad amount', code: -9 } };
  await assert.rejects(() => feeCalculation(cfgIrr, 0), (e) => e.code === -9 && /Bad amount/.test(e.message));
}

// 9. HTTP timeout is applied to the SDK axios instances (no request is made).
assert.equal(ZARINPAL_HTTP_TIMEOUT_MS, 15000);
{
  const zp = createZarinpalSdkClient({ merchantId: MID, sandbox: false, currency: 'IRR' });
  assert.equal(zp.httpClient?.defaults?.timeout, 15000);
  assert.equal(zp.graphqlClient?.defaults?.timeout, 15000);
}

// 10. The merchant id never leaks into a thrown message.
{
  const fresh = restore();
  fresh.errors['payments.create'] = { response: { data: { errors: [{ code: -10, message: `Bad merchant ${MID}` }] } } };
  await assert.rejects(() => requestPayment(cfgIrr, { amountToman: 2000, description: 'd', callbackUrl: 'https://x.example/cb' }), (e) => e.status === 502 && !String(e.message).includes(MID));
}

setZarinpalClientFactory(null);
console.log('zarinpal-sdk: ok');
