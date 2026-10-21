#!/usr/bin/env node
/** Run: npm run test:copilot-labels (= node --import tsx scripts/test-copilot-labels.mjs) */
import assert from 'node:assert/strict';
import { persianizeCodes, LEAD_STATUS_LABEL } from '../src/utils/labels.ts';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
t('lead status', () => assert.equal(persianizeCodes({ status: 'new' }).status, 'جدید'));
t('nested leads list', () => assert.deepEqual(persianizeCodes({ leads: [{ status: 'in_negotiation' }, { status: 'lost' }] }).leads.map((l) => l.status), ['در حال پیگیری', 'از دست رفته']));
t('registration statuses', () => { assert.equal(persianizeCodes({ status: 'pending_review' }).status, 'در انتظار بررسی'); assert.equal(persianizeCodes({ status: 'rejected' }).status, 'ردشده'); });
t('dbhub reg_status rows', () => assert.deepEqual(persianizeCodes({ rows: [{ reg_status: 'none', total: 5 }, { reg_status: 'pending_review', total: 2 }] }).rows.map((r) => r.reg_status), ['بدون وضعیت', 'در انتظار بررسی']));
t('null status', () => assert.equal(persianizeCodes({ status: null }).status, 'بدون وضعیت'));
t('task status + priority', () => { const r = persianizeCodes({ status: 'in_progress', priority: 'high' }); assert.equal(r.status, 'در حال انجام'); assert.equal(r.priority, 'فوری'); });
t('pay method + site payment', () => { const r = persianizeCodes({ pay_method: 'card_transfer', status: 'paid' }); assert.equal(r.pay_method, 'کارت‌به‌کارت'); assert.equal(r.status, 'پرداخت‌شده'); });
t('unknown codes and other keys untouched', () => assert.deepEqual(persianizeCodes({ status: 'weird', name: 'new', tracking_code: 'KRM-1', n: 3 }), { status: 'weird', name: 'new', tracking_code: 'KRM-1', n: 3 }));
t('already Persian untouched', () => assert.equal(persianizeCodes({ pay_method: 'نقدی' }).pay_method, 'نقدی'));
t('input not mutated', () => { const o = { status: 'new' }; persianizeCodes(o); assert.equal(o.status, 'new'); });
t('shared map', () => assert.equal(LEAD_STATUS_LABEL.contacted, 'تماس گرفته شد'));
console.log(`${n} passed`);
