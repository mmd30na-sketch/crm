// Unit tests for accessLevels.ts (user levels + permission matrix) and ownerContact.ts (business owner contact).
import assert from 'node:assert/strict';
import * as L from '../accessLevels.ts';
import * as O from '../ownerContact.ts';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('migration seeds system levels and maps existing staff (admin -> full_admin), idempotent', () => {
  const db = { staff_users: [{ id: 1, role: 'admin' }, { id: 2, role: 'cashier' }, { id: 3, role: 'instructor' }, { id: 4, role: 'cashier', level_id: 'ghost' }] };
  assert.equal(L.ensureAccessLevels(db), true);
  assert.deepEqual(db.staff_users.map((u) => u.level_id), ['full_admin', 'cashier', 'instructor', 'cashier']);
  assert.equal(L.ensureAccessLevels(db), false);
  assert.equal(db.access_levels.length, 3);
});

t('env admin is always full access, even if the stored full_admin was tampered with', () => {
  const db = { staff_users: [], access_levels: [{ id: 'full_admin', name: 'x', base_role: 'cashier', permissions: { users: false, settings: false } }] };
  const lv = L.levelForSession(db, { source: 'env', role: 'admin' });
  assert.equal(lv.id, 'full_admin'); assert.equal(lv.base_role, 'admin');
  assert.ok(L.PERM_KEYS.every((k) => lv.permissions[k] === true));
});

t('local staff gets its level; unknown/mysql sessions fall back to the role default', () => {
  const db = { staff_users: [{ id: 7, role: 'admin', level_id: 'accountant' }], access_levels: [{ id: 'accountant', name: 'حسابدار', base_role: 'admin', permissions: { payments: true, settings: false } }] };
  assert.equal(L.levelForSession(db, { source: 'local', user_id: 7 }).id, 'accountant');
  assert.equal(L.levelForSession(db, { source: 'mysql', role: 'cashier' }).id, 'cashier');
  assert.equal(L.levelForSession(db, { source: 'mysql', role: 'admin' }).id, 'full_admin');
  assert.equal(L.levelForSession(db, { source: 'local', user_id: 7 }).permissions.users, false); // missing keys default to false
});

t('request -> permission mapping', () => {
  const need = (m, p) => L.permissionsForRequest(m, p).sort();
  assert.deepEqual(need('POST', '/settings'), ['settings']);
  assert.deepEqual(need('GET', '/settings'), []);
  assert.deepEqual(need('GET', '/settings/zarinpal'), ['settings']);
  assert.deepEqual(need('GET', '/settings/hamraz'), ['settings']);
  assert.deepEqual(need('GET', '/settings/business-owner'), ['settings']);
  assert.deepEqual(need('GET', '/staff'), ['users']);
  assert.deepEqual(need('PUT', '/access-levels/x'), ['users']);
  assert.deepEqual(need('DELETE', '/students/5'), ['delete', 'students']);
  assert.deepEqual(need('GET', '/refunds'), ['refunds']);
  assert.deepEqual(need('POST', '/payments'), ['payments']);
  assert.deepEqual(need('POST', '/copilot/chat'), ['hamraz']);
  assert.deepEqual(need('POST', '/debt-sms/send'), ['sms']);
  assert.deepEqual(need('GET', '/LEADS'), ['leads']);
  assert.deepEqual(need('GET', '/tasks'), []);
  assert.deepEqual(need('GET', '/branches/config'), []);
});

t('matrix blocks: accountant without settings/users/refunds', () => {
  const lv = { id: 'a', name: 'حسابدار', base_role: 'admin', permissions: { ...Object.fromEntries(L.PERM_KEYS.map((k) => [k, false])), payments: true, students: true } };
  assert.deepEqual(L.missingPermissions(lv, L.permissionsForRequest('POST', '/settings/hamraz')), ['settings']);
  assert.deepEqual(L.missingPermissions(lv, L.permissionsForRequest('GET', '/payments')), []);
  assert.deepEqual(L.missingPermissions(lv, L.permissionsForRequest('POST', '/staff')), ['users']);
});

t('copilot tool -> permission', () => {
  assert.equal(L.permissionForCopilotTool('zarinpal_refund'), 'refunds');
  assert.equal(L.permissionForCopilotTool('zarinpal_reverse'), 'refunds');
  assert.equal(L.permissionForCopilotTool('zarinpal_list_transactions'), 'payment_tools');
  assert.equal(L.permissionForCopilotTool('sms_send'), 'sms');
  assert.equal(L.permissionForCopilotTool('send_telegram_message'), 'sms');
  assert.equal(L.permissionForCopilotTool('search_students'), null);
});

t('full_admin cannot be edited via listLevels and system base roles stay fixed', () => {
  const db = { access_levels: [{ id: 'cashier', name: 'صندوق', base_role: 'admin', permissions: { sms: false } }] };
  const c = L.listLevels(db).find((l) => l.id === 'cashier');
  assert.equal(c.base_role, 'cashier'); assert.equal(c.name, 'صندوق'); assert.equal(c.permissions.sms, false);
  const sys = L.SYSTEM_LEVELS.find((l) => l.id === 'cashier');
  assert.equal(L.validateLevelInput({ base_role: 'admin', name: 'x' }, { ...sys }).base_role, 'cashier');
});

t('level validation', () => {
  assert.throws(() => L.validateLevelInput({ id: 'Bad Id', name: 'x' }), /شناسه/);
  assert.throws(() => L.validateLevelInput({ id: 'ok_id', name: '' }), /نام/);
  assert.throws(() => L.validateLevelInput({ id: 'ok_id', name: 'x', base_role: 'root' }), /نقش/);
  const v = L.validateLevelInput({ id: 'operator', name: 'اپراتور', base_role: 'cashier', permissions: { sms: true, evil: true, students: 'yes' } });
  assert.equal(v.permissions.sms, true); assert.equal(v.permissions.students, false); assert.equal('evil' in v.permissions, false);
});

t('owner contact validation + links', () => {
  const o = O.validateOwner({ name: 'علی', phone: '+98 912 345 6789', telegram: 'https://t.me/Ali_Owner', rubika: '@ali.owner', bale: 'ble.ir/ali_1' });
  assert.deepEqual(o, { name: 'علی', phone: '09123456789', telegram: 'Ali_Owner', rubika: 'ali.owner', bale: 'ali_1' });
  assert.equal(O.validateOwner({ phone: '۰۹۱۲۳۴۵۶۷۸۹' }).phone, '09123456789');
  assert.deepEqual(O.ownerLinks(o), { phone: 'tel:09123456789', telegram: 'https://t.me/Ali_Owner', rubika: 'https://rubika.ir/ali.owner', bale: 'https://ble.ir/ali_1' });
  assert.deepEqual(O.ownerLinks({}), { phone: null, telegram: null, rubika: null, bale: null });
  assert.throws(() => O.validateOwner({ phone: '12345' }), /تلفن/);
  assert.throws(() => O.validateOwner({ telegram: 'ab' }), /تلگرام/);
  assert.throws(() => O.validateOwner({ rubika: 'a b<script>' }), /روبیکا/);
  assert.throws(() => O.validateOwner({ bale: 'javascript:alert(1)' }), /بله/);
});

console.log(`\n${n} access-level/owner tests passed`);
