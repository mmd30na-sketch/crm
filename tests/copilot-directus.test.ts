import {
  MONEY_COLLECTIONS, WRITE_COLLECTIONS, DENY_COLLECTIONS, SECRET_FIELDS,
  directusSelected, validateDirectusUrl, isMoneyCollection, canonicalCollection,
  assertDirectusWriteAllowed, assertDirectusReadAllowed,
  sanitizeItemFields, parseItemsArgs, callDirectusTool,
} from '../copilot-directus';

let fail = 0;
const ok = (name: string, cond: boolean) => { console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) fail++; };

const denied = (collection: string, action: string) => {
  try { assertDirectusWriteAllowed(collection, action); return false; } catch { return true; }
};
const denialMessage = (collection: string, action: string) => {
  try { assertDirectusWriteAllowed(collection, action); return ''; } catch (e: any) { return String(e?.message || e); }
};
const readDenied = (collection: string) => {
  try { assertDirectusReadAllowed(collection); return false; } catch { return true; }
};

// Write allowlist / denylist.
ok('payments write rejected', denied('payments', 'create'));
ok('v_ view write rejected', denied('v_daily_cashflow', 'update'));
ok('staff_users write rejected', denied('staff_users', 'create'));
ok('directus_ prefix write rejected', denied('directus_users', 'update'));
ok('delete action rejected', denied('students', 'delete'));
ok('unknown collection write rejected', denied('some_random_table', 'create'));
ok('students write allowed', !denied('students', 'create'));
ok('sms_reports write allowed', !denied('sms_reports', 'create'));
ok('crm_tasks write allowed', !denied('crm_tasks', 'update'));
ok('money message mentions admin confirmation', /ادمین/.test(denialMessage('payments', 'create')));
ok('money message mentions gateway confirmation', /درگاه/.test(denialMessage('payments', 'create')));
ok('isMoneyCollection v_ prefix', isMoneyCollection('v_anything'));
ok('MONEY_COLLECTIONS exported', MONEY_COLLECTIONS.has('payments') && MONEY_COLLECTIONS.has('tblpeyment'));
ok('WRITE_COLLECTIONS exported', WRITE_COLLECTIONS.has('sms_reports') && WRITE_COLLECTIONS.has('enrollment_documents'));
ok('DENY_COLLECTIONS exported', DENY_COLLECTIONS.has('staff_users') && DENY_COLLECTIONS.has('tblotp'));
ok('SECRET_FIELDS exported', SECRET_FIELDS.includes('authority') && SECRET_FIELDS.includes('tfa_secret'));
ok('read deny staff_users', readDenied('staff_users'));
ok('read allow payments', !readDenied('payments'));

// Secret stripping from payloads and read results.
const payload = sanitizeItemFields('students', {
  first_name: 'Ali', authority: 'auth-secret', password_hash: 'hash',
  nested: { token: 'tok', keep: 1 }, list: [{ secret: 's', ok: 2 }],
});
ok('authority stripped from payload', payload.authority === undefined);
ok('password_hash stripped from payload', payload.password_hash === undefined);
ok('nested token stripped', payload.nested.token === undefined && payload.nested.keep === 1);
ok('array secret stripped', payload.list[0].secret === undefined && payload.list[0].ok === 2);
ok('normal payload field kept', payload.first_name === 'Ali');

const read = sanitizeItemFields('payments', { data: [{ payment_id: 1, authority: 'auth-secret', amount: 100 }] });
ok('payments read authority stripped', read.data[0].authority === undefined && read.data[0].amount === 100);
ok('enrollment_documents template_key stripped', sanitizeItemFields('enrollment_documents', { id: 1, template_key: 'k' }).template_key === undefined);
ok('template_key kept for other collections', sanitizeItemFields('students', { id: 1, template_key: 'k' }).template_key === 'k');

// Argument normalization.
const p = parseItemsArgs({ collection: 'Students', action: 'Update', data: { id: 5 }, id: 5, query: { limit: 1 } });
ok('parseItemsArgs normalizes', p.collection === 'students' && p.action === 'update' && p.id === 5 && p.data.id === 5 && p.query.limit === 1);
ok('parseItemsArgs defaults', parseItemsArgs({}).action === 'read' && parseItemsArgs({}).collection === '');

// URL allowlist (SSRF).
const accepts = (u: string) => { try { validateDirectusUrl(u); return true; } catch { return false; } };
ok('url accepts 127.0.0.1', accepts('http://127.0.0.1:8055/mcp'));
ok('url accepts localhost', accepts('http://localhost:8055/mcp'));
ok('url accepts ipv6', accepts('http://[::1]:8055/mcp'));
ok('canonical TblPeyment', canonicalCollection('tblpeyment') === 'TblPeyment');
ok('canonical students unchanged', canonicalCollection('students') === 'students');
ok('url accepts admin host', accepts('https://admin.kermanshahcart.ir/mcp'));
ok('url rejects evil host', !accepts('http://evil.example.com/mcp'));
ok('url rejects lookalike host', !accepts('http://127.0.0.1.evil.com/mcp'));
ok('url rejects localhost subdomain', !accepts('http://localhost.evil.com/mcp'));

// Backend selection.
const oldBackend = process.env.COPILOT_DB_BACKEND;
delete process.env.COPILOT_DB_BACKEND;
ok('directusSelected default false', directusSelected() === false);
process.env.COPILOT_DB_BACKEND = 'directus';
ok('directusSelected true', directusSelected() === true);
process.env.COPILOT_DB_BACKEND = 'DBHUB';
ok('directusSelected other backend false', directusSelected() === false);
if (oldBackend === undefined) delete process.env.COPILOT_DB_BACKEND; else process.env.COPILOT_DB_BACKEND = oldBackend;

// Denied write/read paths run before any network call (no token is set here).
const oldToken = process.env.COPILOT_DIRECTUS_TOKEN;
const oldUrl = process.env.COPILOT_DIRECTUS_URL;
delete process.env.COPILOT_DIRECTUS_TOKEN;
delete process.env.COPILOT_DIRECTUS_URL;

(async () => {
  const writes: any[] = [];
  const sqls: any[] = [];
  const r1: any = await callDirectusTool('directus_write_items', { collection: 'payments', action: 'create', data: { amount: 1 } }, (e) => { sqls.push(e); }, (e) => { writes.push(e); });
  ok('callDirectusTool money denial error', typeof r1?.error === 'string' && /مالی/.test(r1.error));
  ok('callDirectusTool denial auditWrite', writes.length === 1 && writes[0].allowed === false && writes[0].status === 403 && writes[0].collection === 'payments' && writes[0].action === 'create');
  ok('callDirectusTool denial auditSql', sqls.length === 1 && sqls[0].db === 'directus' && sqls[0].allowed === false);
  const r2: any = await callDirectusTool('directus_write_items', { collection: 'staff_users', action: 'create', data: {} }, () => {}, () => {});
  ok('callDirectusTool deny collection', typeof r2?.error === 'string' && /مجاز نیست/.test(r2.error));
  const r3: any = await callDirectusTool('directus_write_items', { collection: 'students', action: 'delete', data: {} }, () => {}, () => {});
  ok('callDirectusTool delete denied', typeof r3?.error === 'string' && /حذف/.test(r3.error));
  const r4: any = await callDirectusTool('directus_read_items', { collection: 'staff_users' }, () => {}, () => {});
  ok('callDirectusTool read deny', typeof r4?.error === 'string' && /مجاز نیست/.test(r4.error));

  if (oldToken === undefined) delete process.env.COPILOT_DIRECTUS_TOKEN; else process.env.COPILOT_DIRECTUS_TOKEN = oldToken;
  if (oldUrl === undefined) delete process.env.COPILOT_DIRECTUS_URL; else process.env.COPILOT_DIRECTUS_URL = oldUrl;
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
