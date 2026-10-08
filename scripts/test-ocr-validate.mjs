#!/usr/bin/env node
/**
 * Unit tests for ocrValidate.ts (synthetic data only, no network).
 * Run: npm run test:ocr   (= node --import tsx scripts/test-ocr-validate.mjs)
 */
import assert from 'node:assert/strict';
import {
  isValidNationalCode, normalizeName, normalizeJalaliDate, validateOcr, runCardOcr, toLatinDigits,
} from '../ocrValidate.ts';

/** Build a checksum-valid code from 9 digits. */
function makeCode(nine) {
  const d = nine.split('').map(Number);
  let s = 0;
  for (let i = 0; i < 9; i++) s += d[i] * (10 - i);
  const r = s % 11;
  return nine + (r < 2 ? r : 11 - r);
}
const GOOD = makeCode('123456789');
const GOOD2 = makeCode('987654321');
// Same code with one digit changed and checksum broken.
const BAD = GOOD.slice(0, 4) + String((Number(GOOD[4]) + 1) % 10) + GOOD.slice(5);
assert.ok(isValidNationalCode(GOOD) && isValidNationalCode(GOOD2) && !isValidNationalCode(BAD));
const TODAY = '1405/07/16';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const read = (over = {}) => ({
  readable: true, first_name: 'محمدسینا', last_name: 'تست زاده', national_code: GOOD, father_name: 'علی',
  birth_date_jalali: '1380/05/20', card_expiry_jalali: '1410/05/20', confidence: 0.95, provider: 'gemini:fake', ...over,
});
const run = (full, focused, vision = null) => runCardOcr({
  gemini: async (pass) => (pass === 'full' ? full : focused),
  vision: async () => vision, today: TODAY,
});

await test('checksum helper rejects same-digit and short codes', () => {
  assert.equal(isValidNationalCode('1111111111'), false);
  assert.equal(isValidNationalCode(GOOD.slice(1)), false);
});
await test('digits conversion and name normalization', () => {
  assert.equal(toLatinDigits('۱۲۳٤٥'), '12345');
  assert.equal(normalizeName('  عليرضا  ك2  x '), 'علیرضا ک');
  assert.equal(normalizeJalaliDate('۱۳۸۰-۵-۲'), '1380/05/02');
  assert.equal(normalizeJalaliDate('13800502'), '1380/05/02');
});
await test('valid read -> ok, no second pass', async () => {
  let calls = 0;
  const r = await runCardOcr({ gemini: async () => { calls++; return read(); }, vision: async () => null, today: TODAY });
  assert.equal(calls, 1);
  assert.equal(r.needs_review, false);
  assert.equal(r.checksum_valid, true);
  assert.equal(r.second_pass, 'not_needed');
});
await test('wrong checksum then corrected second read -> accepted', async () => {
  const r = await run(read({ national_code: BAD }), { national_code: GOOD, birth_date_jalali: '1380/05/20', confidence: 0.9 });
  assert.equal(r.national_code, GOOD);
  assert.equal(r.checksum_valid, true);
  assert.equal(r.needs_review, false);
  assert.equal(r.second_pass, 'accepted');
});
await test('digit-array second read is used', async () => {
  const digits = GOOD.split('').map((d) => ({ digit: d, confidence: 0.9 }));
  const r = await run(read({ national_code: BAD }), { digits });
  assert.equal(r.national_code, GOOD);
});
await test('wrong checksum both times -> needs_review, value kept as read', async () => {
  const other = BAD.slice(0, 9) + String((Number(BAD[9]) + 1) % 10);
  const r = await run(read({ national_code: BAD }), { national_code: isValidNationalCode(other) ? BAD.slice(0, 8) + '00' : other });
  assert.equal(r.national_code, BAD);
  assert.equal(r.needs_review, true);
  assert.ok(r.field_warnings.national_code.includes('national_code_checksum_failed'));
});
await test('expired card is informational only', async () => {
  const r = await run(read({ card_expiry_jalali: '1400/01/01' }), null);
  assert.equal(r.card_expired, true);
  assert.equal(r.needs_review, false);
  assert.ok(r.field_warnings.card_expiry_jalali.includes('card_expired'));
});
await test('invalid birth date is flagged', () => {
  const v = validateOcr(read({ birth_date_jalali: '1380/13/40' }), { today: TODAY, confidence: 0.95 });
  assert.ok(v.field_warnings.birth_date_jalali.includes('birth_date_invalid'));
  const future = validateOcr(read({ birth_date_jalali: '1500/01/01' }), { today: TODAY, confidence: 0.95 });
  assert.ok(future.field_warnings.birth_date_jalali.includes('birth_date_invalid'));
});
await test('Persian digits in code and dates', async () => {
  const fa = GOOD.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const r = await run(read({ national_code: fa, birth_date_jalali: '۱۳۸۰/۰۵/۲۰', card_expiry_jalali: '۱۴۱۰-۰۵-۲۰' }), null);
  assert.equal(r.national_code, GOOD);
  assert.equal(r.birth_date_jalali, '1380/05/20');
  assert.equal(r.card_expiry_jalali, '1410/05/20');
  assert.equal(r.needs_review, false);
});
await test('compound first name and two-word family name preserved', async () => {
  const r = await run(read({ first_name: 'محمدسینا', last_name: 'احمدی نژاد' }), null);
  assert.equal(r.first_name, 'محمدسینا');
  assert.equal(r.last_name, 'احمدی نژاد');
});
await test('empty key field and low confidence need review', async () => {
  const r = await run(read({ first_name: '', confidence: 0.5 }), { national_code: GOOD });
  assert.equal(r.needs_review, true);
  assert.ok(r.field_warnings.first_name.includes('missing'));
  assert.ok(r.field_warnings._overall.includes('low_confidence'));
});
await test('vision candidate with valid checksum is preferred', async () => {
  const r = await run(read({ national_code: BAD }), null, {
    first_name: '', last_name: '', national_code: GOOD, father_name: '', birth_date_jalali: '', confidence: 0.4,
  });
  assert.equal(r.national_code, GOOD);
});
await test('nothing read -> null', async () => {
  assert.equal(await run(null, null), null);
});
console.log(`\n${passed} tests passed`);
