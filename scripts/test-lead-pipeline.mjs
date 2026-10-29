// Unit tests for the lead pipeline report + Jalali helpers (no DB needed).
// Run: npm run test:lead-pipeline
import assert from 'node:assert/strict';
import { buildReport, jalaliToGregorianDate, jalaliMonthOf, rate } from '../leadPipeline.ts';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok -', name); };

t('jalaliToGregorianDate parses Latin and Persian digits', () => {
  assert.equal(jalaliToGregorianDate('1405/01/01').toISOString().slice(0, 10), '2026-03-21');
  assert.equal(jalaliToGregorianDate('۱۴۰۵/۰۸/۰۶').toISOString().slice(0, 10), '2026-10-28');
  assert.equal(jalaliToGregorianDate('1405-1-1').toISOString().slice(0, 10), '2026-03-21');
  assert.equal(jalaliToGregorianDate('1405/13/01'), null);
  assert.equal(jalaliToGregorianDate('garbage'), null);
});

t('jalaliMonthOf uses Tehran time (UTC 21:00 on 20 Mar = 1 Farvardin in Tehran)', () => {
  assert.equal(jalaliMonthOf(new Date('2026-03-20T21:00:00Z')), '1405/01');
  assert.equal(jalaliMonthOf(new Date('2026-03-20T19:00:00Z')), '1404/12');
});

t('rate rounds to 4 decimals and handles zero', () => {
  assert.equal(rate(1, 3), 0.3333);
  assert.equal(rate(5, 0), 0);
});

const stages = [
  { id: 1, title: 'جدید', color: 'sky', position: 10, status_key: 'new', is_won: false, is_lost: false, is_active: true },
  { id: 2, title: 'مذاکره', color: 'indigo', position: 20, status_key: 'in_negotiation', is_won: false, is_lost: false, is_active: true },
  { id: 3, title: 'ثبت‌نام', color: 'emerald', position: 30, status_key: 'converted', is_won: true, is_lost: false, is_active: true },
  { id: 4, title: 'از دست رفت', color: 'rose', position: 40, status_key: 'lost', is_won: false, is_lost: true, is_active: true },
  { id: 5, title: 'قدیمی', color: 'slate', position: 5, status_key: null, is_won: false, is_lost: false, is_active: false },
];
const d = (s) => new Date(s);
const leads = [
  { id: 10, source_id: 1, source_title: 'اینستاگرام', status: 'new', stage_id: 1, created_at: d('2026-03-25T08:00:00Z') },
  { id: 11, source_id: 1, source_title: 'اینستاگرام', status: 'converted', stage_id: 3, created_at: d('2026-03-25T08:00:00Z') },
  { id: 12, source_id: 2, source_title: 'سایت', status: 'lost', stage_id: 4, created_at: d('2026-04-25T08:00:00Z') },
  { id: 13, source_id: null, source_title: null, status: 'converted', stage_id: null, created_at: d('2026-04-25T08:00:00Z') },
];
const history = [
  { lead_id: 11, to_stage_id: 2, changed_at: d('2026-03-26T08:00:00Z') },
  { lead_id: 11, to_stage_id: 3, changed_at: d('2026-03-29T08:00:00Z') },
  { lead_id: 12, to_stage_id: 2, changed_at: d('2026-04-26T08:00:00Z') },
  { lead_id: 99, to_stage_id: 3, changed_at: d('2026-04-26T08:00:00Z') }, // outside the filtered set
];
const r = buildReport(leads, stages, history);

t('totals: won by stage flag or legacy status, lost excludes won', () => {
  assert.deepEqual(r.totals, { leads: 4, won: 2, lost: 1, open: 1, conversion_rate: 0.5 });
});
t('by_stage: active stages only, ordered, reached counts use history', () => {
  assert.deepEqual(r.by_stage.map((s) => s.stage_id), [1, 2, 3, 4]);
  const s2 = r.by_stage.find((s) => s.stage_id === 2);
  assert.equal(s2.current, 0); assert.equal(s2.reached, 2); assert.equal(s2.reach_rate, 0.5);
  assert.equal(r.by_stage.find((s) => s.stage_id === 3).reached, 1); // lead 99 ignored
});
t('by_source: unknown source grouped as نامشخص, rates per source', () => {
  const insta = r.by_source.find((s) => s.source_id === 1);
  assert.equal(insta.leads, 2); assert.equal(insta.won, 1); assert.equal(insta.conversion_rate, 0.5);
  assert.equal(r.by_source.find((s) => s.source_id === null).title, 'نامشخص');
});
t('by_period: Jalali months, sorted', () => {
  assert.deepEqual(r.by_period.map((p) => [p.period, p.leads, p.won]), [['1405/01', 2, 1], ['1405/02', 2, 1]]);
});
t('avg_days_to_win from first move into a won stage', () => {
  assert.equal(r.avg_days_to_win, 4);
});
t('empty input', () => {
  const e = buildReport([], stages, []);
  assert.equal(e.totals.conversion_rate, 0); assert.equal(e.avg_days_to_win, null); assert.deepEqual(e.by_period, []);
});
console.log(`\n${n} lead-pipeline tests passed`);
