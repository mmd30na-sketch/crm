import {
  MONEY_COLLECTIONS, WRITE_COLLECTIONS, DENY_COLLECTIONS, SECRET_FIELDS,
  directusSelected, validateDirectusUrl, isMoneyCollection, canonicalCollection,
  assertDirectusWriteAllowed, assertDirectusReadAllowed,
  sanitizeItemFields, parseItemsArgs, callDirectusTool, copilotSqlToolsFor, getDirectusTools,
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

// Fallback / tool assembly: COPILOT_DB_BACKEND=directus -> Directus tools, else DBHub fallback, else builtin SQL.
const BUILTIN_SQL_TOOL = { type: 'function', function: { name: 'run_sql_query', parameters: { type: 'object', properties: { database: { type: 'string', enum: ['crm', 'site'] } } } } };
const SITE_SQL_TOOL = { type: 'function', function: { name: 'run_sql_query', parameters: { type: 'object', properties: { database: { type: 'string', enum: ['site'] } } } } };
const DIRECTUS_TOOLS = [
  { type: 'function', function: { name: 'directus_schema', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'directus_read_items', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'directus_write_items', parameters: { type: 'object', properties: {} } } },
];
const DBHUB_TOOLS = [
  { type: 'function', function: { name: 'execute_sql_crm', parameters: { type: 'object', properties: { sql: { type: 'string' } } } } },
];
const sqlToolNames = (tools: any[]) => tools.map((t) => t?.function?.name);
const hasTool = (tools: any[], name: string) => sqlToolNames(tools).includes(name);

ok('fallback: directus ok -> directus tools + site sql', (() => { const l = copilotSqlToolsFor({ backend: 'directus', directusTools: DIRECTUS_TOOLS, dbhubFallback: true, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }); return hasTool(l, 'directus_write_items') && hasTool(l, 'directus_schema') && hasTool(l, 'directus_read_items') && hasTool(l, 'run_sql_query') && sqlToolNames(l).length === 4; })());
ok('fallback: directus ok ignores dbhub fallback', copilotSqlToolsFor({ backend: 'directus', directusTools: DIRECTUS_TOOLS, dbhubFallback: false, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }).length === 4);
ok('fallback: directus down + dbhubFallback + dbhub tools -> dbhub + site sql', (() => { const l = copilotSqlToolsFor({ backend: 'directus', directusTools: null, dbhubTools: DBHUB_TOOLS, dbhubFallback: true, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }); return hasTool(l, 'execute_sql_crm') && hasTool(l, 'run_sql_query') && !sqlToolNames(l).some((n) => n.startsWith('directus_')); })());
ok('fallback: directus down + dbhubFallback off -> builtin sql', (() => { const l = copilotSqlToolsFor({ backend: 'directus', directusTools: null, dbhubTools: DBHUB_TOOLS, dbhubFallback: false, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }); return l.length === 1 && l[0]?.function?.name === 'run_sql_query'; })());
ok('fallback: directus down + dbhubFallback + no dbhub tools -> builtin sql', copilotSqlToolsFor({ backend: 'directus', directusTools: null, dbhubTools: null, dbhubFallback: true, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }).length === 1);
ok('fallback: dbhub backend with tools -> dbhub + site sql', (() => { const l = copilotSqlToolsFor({ backend: 'dbhub', dbhubTools: DBHUB_TOOLS, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }); return hasTool(l, 'execute_sql_crm') && hasTool(l, 'run_sql_query'); })());
ok('fallback: dbhub backend down -> builtin sql', copilotSqlToolsFor({ backend: 'dbhub', dbhubTools: null, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }).length === 1);
ok('fallback: builtin backend -> builtin sql', copilotSqlToolsFor({ backend: 'builtin', builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }).length === 1);
ok('fallback: backend normalized (Directus -> directus)', copilotSqlToolsFor({ backend: '  Directus ', directusTools: DIRECTUS_TOOLS, dbhubFallback: true, builtinTool: BUILTIN_SQL_TOOL, siteTool: SITE_SQL_TOOL }).length === 4);

// canonicalCollection / parseItemsArgs edge cases.
ok('canonical empty string', canonicalCollection('') === '');
ok('canonical whitespace', canonicalCollection('   ') === '');
ok('canonical trims but preserves case', canonicalCollection('  Students  ') === 'Students');
ok('canonical tblotp', canonicalCollection('tblotp') === 'TblOTP');
ok('canonical tblstudents', canonicalCollection('tblstudents') === 'TblStudents');
ok('canonical crm_tasks kept', canonicalCollection('crm_tasks') === 'crm_tasks');
const p2 = parseItemsArgs({ collection: '  Students  ', action: ' CREATE ', data: null, ids: null, query: null, fields: null, limit: null });
ok('parseItemsArgs trims/lowercases collection+action', p2.collection === 'students' && p2.action === 'create');
ok('parseItemsArgs defaults for missing fields', parseItemsArgs({}).data === null && parseItemsArgs({}).id === null && parseItemsArgs({}).ids === null && parseItemsArgs({}).query === null && parseItemsArgs({}).fields === null && parseItemsArgs({}).limit === null);

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
  ok('getDirectusTools -> null when Directus unconfigured', (await getDirectusTools()) === null);

  if (oldToken === undefined) delete process.env.COPILOT_DIRECTUS_TOKEN; else process.env.COPILOT_DIRECTUS_TOKEN = oldToken;
  if (oldUrl === undefined) delete process.env.COPILOT_DIRECTUS_URL; else process.env.COPILOT_DIRECTUS_URL = oldUrl;

  // Allowed read through a mocked MCP client (no token, no network).
  const readCalls: any[] = [];
  const fakeReadClient: any = { callTool: async (req: any) => { readCalls.push(req); return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: [{ student_id: 7, first_name: 'Ali', authority: 'auth-secret' }] }) }], isError: false }; } };
  const r5: any = await callDirectusTool('directus_read_items', { collection: 'students', fields: ['student_id', 'first_name'] }, (e) => { sqls.push(e); }, (e) => { writes.push(e); }, fakeReadClient);
  ok('callDirectusTool allowed read -> rows returned', r5?.data?.[0]?.student_id === 7 && r5?.data?.[0]?.first_name === 'Ali');
  ok('callDirectusTool allowed read strips secret', r5?.data?.[0]?.authority === undefined);
  ok('callDirectusTool read request shaped for MCP items call', readCalls.length === 1 && readCalls[0]?.name === 'items' && readCalls[0]?.arguments?.collection === 'students' && readCalls[0]?.arguments?.action === 'read' && JSON.stringify(readCalls[0]?.arguments?.fields) === JSON.stringify(['student_id', 'first_name']));
  ok('callDirectusTool allowed read audit', sqls.length === 2 && sqls[1].allowed === true && sqls[1].db === 'directus' && sqls[1].rows === 1);

  // Allowed write through a mocked MCP client (no token, no network); secrets never leave the process.
  const writeCalls: any[] = [];
  const fakeWriteClient: any = { callTool: async (req: any) => { writeCalls.push(req); return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { id: 9, first_name: 'New', password: 'secret-pass' } }) }], isError: false }; } };
  const r6: any = await callDirectusTool('directus_write_items', { collection: 'leads', action: 'create', data: { first_name: 'New', authority: 'auth-secret', phone_number: '09120000000' } }, (e) => { sqls.push(e); }, (e) => { writes.push(e); }, fakeWriteClient);
  ok('callDirectusTool allowed write -> ok result', r6?.data?.id === 9 && r6?.data?.first_name === 'New' && r6?.data?.password === undefined);
  ok('callDirectusTool allowed write strips secret before MCP', writeCalls[0]?.arguments?.data?.authority === undefined && writeCalls[0]?.arguments?.data?.first_name === 'New' && writeCalls[0]?.arguments?.data?.phone_number === '09120000000');
  ok('callDirectusTool write request shaped for MCP items call', writeCalls[0]?.name === 'items' && writeCalls[0]?.arguments?.collection === 'leads' && writeCalls[0]?.arguments?.action === 'create');
  ok('callDirectusTool allowed write auditW', writes.length === 2 && writes[1].allowed === true && writes[1].status === 200 && writes[1].collection === 'leads' && writes[1].action === 'create');

  // Denied write/read paths never reach the (mocked) MCP client.
  const deniedCalls: any[] = [];
  const fakeDeniedClient: any = { callTool: async (req: any) => { deniedCalls.push(req); return { content: [{ type: 'text', text: '{}' }], isError: false }; } };
  const r7: any = await callDirectusTool('directus_write_items', { collection: 'some_random_table', action: 'create', data: {} }, () => {}, () => {}, fakeDeniedClient);
  ok('callDirectusTool unknown collection write rejected before MCP', typeof r7?.error === 'string' && /مجاز/.test(r7.error) && deniedCalls.length === 0);
  const r8: any = await callDirectusTool('directus_write_items', { collection: 'students', action: 'delete', data: {} }, () => {}, () => {}, fakeDeniedClient);
  ok('callDirectusTool delete rejected before MCP', typeof r8?.error === 'string' && /حذف/.test(r8.error) && deniedCalls.length === 0);
  const r9: any = await callDirectusTool('directus_write_items', { collection: 'payments', action: 'create', data: { amount: 1 } }, () => {}, () => {}, fakeDeniedClient);
  ok('callDirectusTool money write rejected before MCP', typeof r9?.error === 'string' && /مالی/.test(r9.error) && deniedCalls.length === 0);
  const r10: any = await callDirectusTool('not_a_real_tool', {}, () => {}, () => {}, fakeDeniedClient);
  ok('callDirectusTool unknown tool rejected', typeof r10?.error === 'string' && /نامعتبر/.test(r10.error) && deniedCalls.length === 0);

  if (oldToken === undefined) delete process.env.COPILOT_DIRECTUS_TOKEN; else process.env.COPILOT_DIRECTUS_TOKEN = oldToken;
  if (oldUrl === undefined) delete process.env.COPILOT_DIRECTUS_URL; else process.env.COPILOT_DIRECTUS_URL = oldUrl;
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
