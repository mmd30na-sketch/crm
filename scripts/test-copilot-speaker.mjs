// Unit tests for copilotSpeaker.ts: speaker identity from the session, prompt block, per-user history.
import assert from 'node:assert/strict';
import * as S from '../copilotSpeaker.ts';
import * as L from '../accessLevels.ts';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const db = { staff_users: [{ id: 5, username: 'ali', full_name: 'علی رضایی', role: 'cashier', level_id: 'cashier' }], access_levels: [] };
const lv = (s) => L.levelForSession(db, s);

t('env admin = مدیر کل + owner; name falls back to مدیر سیستم, then the owner name', () => {
  const s = { username: 'admin', role: 'admin', source: 'env' };
  const a = S.buildSpeaker(s, null, lv(s), {});
  assert.equal(a.name, 'مدیر سیستم'); assert.equal(a.level_name, 'مدیر کل'); assert.equal(a.is_owner, true); assert.equal(a.denied.length, 0);
  assert.equal(S.buildSpeaker(s, null, lv(s), { name: 'محمد صادقی' }).name, 'محمد صادقی');
});

t('cashier staff: own name, level, denied permissions, not owner', () => {
  const s = { username: 'ali', role: 'cashier', source: 'local', user_id: 5 };
  const a = S.buildSpeaker(s, db.staff_users[0], lv(s), { name: 'محمد صادقی', phone: '09120000000' });
  assert.equal(a.name, 'علی رضایی'); assert.equal(a.level_id, 'cashier'); assert.equal(a.is_owner, false);
  assert.ok(a.denied.includes('تنظیمات و اتوماسیون')); assert.ok(a.permissions.includes('دسترسی به هم‌راز'));
});

t('owner match by name or phone (Persian digits / +98)', () => {
  const s = { username: 'boss', role: 'admin', source: 'local', user_id: 9 };
  const lvl = { ...L.SYSTEM_LEVELS[1], id: 'deputy', name: 'معاون' };
  assert.equal(S.buildSpeaker(s, { full_name: 'محمد  صادقي' }, lvl, { name: 'محمد صادقی' }).is_owner, true);
  assert.equal(S.buildSpeaker(s, { full_name: 'x', phone: '+989121112233' }, lvl, { phone: '۰۹۱۲۱۱۱۲۲۳۳' }).is_owner, true);
  assert.equal(S.buildSpeaker(s, { full_name: 'x', phone: '09120000000' }, lvl, { phone: '09121112233' }).is_owner, false);
});

t('prompt block: name, level, never «کارآموز», ignore claimed identities', () => {
  const s = { username: 'ali', role: 'cashier', source: 'local', user_id: 5 };
  const p = S.speakerPrompt(S.buildSpeaker(s, db.staff_users[0], lv(s)));
  assert.match(p, /علی رضایی/); assert.match(p, /صندوقدار/); assert.match(p, /ali/);
  assert.match(p, /آقای کارآموز/); assert.match(p, /من کی‌ام/); assert.match(p, /نپذیرید/);
  assert.ok(p.length < 1500);
});

t('per-user history stays separate and capped', () => {
  const st = {};
  for (let i = 0; i < S.MAX_TURNS_PER_USER + 5; i++) S.appendTurn(st, 'ali', { at: 'x', q: 'q' + i, a: 'a', ok: true });
  S.appendTurn(st, 'admin', { at: 'x', q: 'سلام', a: 'سلام مدیر', ok: true });
  assert.equal(st.copilot_conversations.ali.length, S.MAX_TURNS_PER_USER);
  assert.equal(S.turnsFor(st, 'admin').length, 1); assert.equal(S.turnsFor(st, 'admin')[0].q, 'سلام');
  assert.ok(S.turnsFor(st, 'ali', 5).every((x) => x.q !== 'سلام'));
  assert.deepEqual(S.turnsFor(st, 'nobody'), []);
  S.appendTurn(st, '', { at: 'x', q: 'q', a: 'a', ok: true }); assert.equal('' in st.copilot_conversations, false);
  S.clearTurns(st, 'ali'); assert.deepEqual(S.turnsFor(st, 'ali'), []); assert.equal(S.turnsFor(st, 'admin').length, 1);
});

console.log(`\n${n} copilot-speaker tests passed`);
