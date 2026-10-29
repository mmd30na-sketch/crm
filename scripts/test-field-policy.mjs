// Unit checks for field-level access (no server, no DB). Run: node --import tsx scripts/test-field-policy.mjs
import assert from 'node:assert/strict';
import { applyFieldPolicy, stripWrites, normalizePolicy, DEFAULT_POLICY, maskValue, FIELD_GROUPS } from '../fieldPolicy.ts';

const student = { id: 1, first_name: 'a', last_name: 'b', national_code: '0012345678', phone_number: '09121234567', address: 'تهران خیابان یک',
  father_name: 'c', birth_date_jalali: '1380/01/02', id_card_photo_url: '/StudentFiles/x/id.jpg', personal_photo_url: '/StudentFiles/x/p.jpg',
  total_paid: 100, remaining_debt: 50, enrollments: [{ id: 3, final_price: 150, contract_pdf_path: '/StudentFiles/x/c.pdf' }] };

// Defaults = previous behaviour: admin and cashier unchanged
assert.deepEqual(applyFieldPolicy(student, 'admin', DEFAULT_POLICY), student);
assert.deepEqual(applyFieldPolicy(student, 'cashier', DEFAULT_POLICY), student);
// Instructor defaults: only mobile + personal photo among sensitive keys
const inst = applyFieldPolicy(student, 'instructor', DEFAULT_POLICY);
assert.deepEqual(Object.keys(inst).sort(), ['enrollments', 'first_name', 'id', 'last_name', 'personal_photo_url', 'phone_number'].sort());
assert.deepEqual(inst.enrollments[0], { id: 3 });
// Unknown role fails closed
assert.equal('national_code' in applyFieldPolicy(student, 'ghost', DEFAULT_POLICY), false);

// Masking
const pol = normalizePolicy({ policy: { cashier: { national_code: 'masked', mobile: 'masked', address: 'masked', personal_details: 'masked', financial: 'hidden', id_documents: 'masked' } } });
assert.equal(pol.policy.cashier.id_documents, 'hidden', 'non-maskable masked -> hidden');
const stats = { exposed: new Set(), masked: new Set(), hidden: new Set(), records: 0 };
const m = applyFieldPolicy([student], 'cashier', pol.policy, stats)[0];
assert.equal(m.national_code, '*******678');
assert.equal(m.phone_number, '0912***67');
assert.equal(m.address, 'تهران ***');
assert.equal(m.birth_date_jalali, '1380/**/**');
assert.equal(m.father_name, 'c***');
assert.equal('total_paid' in m, false);
assert.equal('final_price' in m.enrollments[0], false);
assert.equal('id_card_photo_url' in m, false);
assert.equal(m.personal_photo_url, student.personal_photo_url);
assert.ok(stats.masked.has('national_code') && stats.hidden.has('financial') && stats.records === 2);
assert.equal(maskValue('mobile', 'phone', '۰۹۱۲۱۲۳۴۵۶۷'), '0912***67');
assert.throws(() => normalizePolicy({ policy: { cashier: { mobile: 'root' } } }));

// Writes: PUT needs edit, POST (create) accepts view; blocked keys are removed
const vpol = normalizePolicy({ policy: { cashier: { national_code: 'view', financial: 'masked', address: 'hidden' } } }).policy;
let body = { first_name: 'x', national_code: '1', address: 'y', amount: 5, nested: { final_price: 9 } };
assert.deepEqual(stripWrites(body, 'cashier', vpol, false).sort(), ['address', 'financial', 'national_code']);
assert.deepEqual(body, { first_name: 'x', nested: {} });
body = { national_code: '1', address: 'y' };
assert.deepEqual(stripWrites(body, 'cashier', vpol, true), ['address']);
assert.deepEqual(body, { national_code: '1' });
body = { national_code: '1' };
assert.deepEqual(stripWrites(body, 'admin', vpol, false), []);
assert.equal(FIELD_GROUPS.length, 7);
console.log('field-policy: ok');
