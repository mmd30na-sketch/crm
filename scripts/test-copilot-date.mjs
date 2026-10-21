#!/usr/bin/env node
/** Run: npm run test:copilot-date (= node --import tsx scripts/test-copilot-date.mjs) */
import assert from 'node:assert/strict';
import { copilotDate, copilotDateRule } from '../src/utils/copilotDate.ts';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
// 2026-10-21 12:00 UTC = 15:30 Tehran = Wednesday 29 Mehr 1405
const d = copilotDate(new Date('2026-10-21T12:00:00Z'));
t('jalali', () => assert.equal(d.jalali, '1405/07/29'));
t('jalali text', () => assert.equal(d.jalaliText, '۲۹ مهر ۱۴۰۵'));
t('weekday', () => assert.equal(d.weekday, 'چهارشنبه'));
t('gregorian', () => assert.equal(d.gregorian, '2026/10/21'));
t('month / prev', () => { assert.equal(d.month, '1405/07'); assert.equal(d.prevMonth, '1405/06'); assert.equal(d.prevMonthText, 'شهریور ۱۴۰۵'); });
// 21:00 UTC on 21 Oct is already 00:30 on 22 Oct in Tehran (day boundary is Tehran, not UTC)
const late = copilotDate(new Date('2026-10-21T21:00:00Z'));
t('tehran day boundary', () => { assert.equal(late.jalali, '1405/07/30'); assert.equal(late.gregorian, '2026/10/22'); assert.equal(late.weekday, 'پنجشنبه'); });
// Farvardin -> previous month is Esfand of the previous year (1 Farvardin 1406 = 2027-03-21)
const nowruz = copilotDate(new Date('2027-03-21T12:00:00Z'));
t('year wrap', () => { assert.equal(nowruz.jalali, '1406/01/01'); assert.equal(nowruz.prevMonth, '1405/12'); assert.equal(nowruz.prevMonthText, 'اسفند ۱۴۰۵'); });
t('rule text', () => { const r = copilotDateRule(new Date('2026-10-21T12:00:00Z')); assert.ok(r.includes('1405/07/29') && r.includes('monthly_income') && r.includes('ماه قبل شهریور ۱۴۰۵')); });
console.log(`${n} passed`);
