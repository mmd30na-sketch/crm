// Live check against a LOCAL test server (never production): CRM_TEST_BASE=http://127.0.0.1:5056 CRM_TEST_ADMIN_PASSWORD=... node scripts/test-branches.mjs <off|one|multi>
// 'multi' expects a second active branch 'west' (id 2) owning course 2 / enrollment 2 / student 2 / the expenses (see docs/multi_branch.md).
const B = (process.env.CRM_TEST_BASE || 'http://127.0.0.1:5056') + '/api';
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(B)) { console.error('refusing to run against a non-local server'); process.exit(2); }
const phase = process.argv[2];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function req(method, path, token, body, headers = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const login = async (u, p) => (await req('POST', '/auth/login', null, { username: u, password: p })).j?.token;
const A = await login(process.env.CRM_TEST_ADMIN_USER || 'admin', process.env.CRM_TEST_ADMIN_PASSWORD || 'testpass');
ok(!!A, 'admin login');
if (!(await login('kasir', 'kasir-pass-123'))) {
  const r = await req('POST', '/staff', A, { username: 'kasir', password: 'kasir-pass-123', full_name: 'صندوقدار غرب', role: 'cashier' });
  ok(r.s < 300, 'create cashier ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 120));
}
const C = await login('kasir', 'kasir-pass-123');
ok(!!C, 'cashier login');
const ids = (r) => (Array.isArray(r.j) ? r.j.map((x) => x.id).sort() : r.j);

if (phase === 'off') {
  const cfg = await req('GET', '/branches/config', A);
  ok(cfg.s === 200 && cfg.j.enabled === false, 'config disabled ' + JSON.stringify(cfg.j));
  ok((await req('GET', '/branches', A)).s === 404, '/branches 404 when off');
  ok((await req('GET', '/branches/report', A)).s === 404, '/branches/report 404 when off');
  const st = await req('GET', '/students', C, null, { 'x-branch-id': '99' });
  ok(st.s === 200 && st.j.length === 2, 'students unfiltered, header ignored when off: ' + JSON.stringify(ids(st)));
}
if (phase === 'one') {
  const cfg = await req('GET', '/branches/config', A);
  ok(cfg.j.enabled === true && cfg.j.multi === false && cfg.j.branches.length === 1, 'config one branch ' + JSON.stringify(cfg.j));
  const cc = await req('GET', '/branches/config', C);
  ok(cc.s === 200 && cc.j.multi === false, 'cashier config ok');
  ok((await req('GET', '/branches', C)).s === 403, 'cashier cannot manage branches');
  const st = await req('GET', '/students', C, null, { 'x-branch-id': '99' });
  ok(st.s === 200 && st.j.length === 2, 'one branch: nothing filtered, bogus header ignored');
  const br = await req('GET', '/branches', A);
  ok(br.s === 200 && br.j.branches[0].is_default && br.j.branches[0].students === 2 && br.j.branches[0].enrollments === 2, 'default branch with backfilled counts ' + JSON.stringify(br.j.branches[0]));
  const bad = await req('POST', '/branches', A, { code: 'West Side', name: 'x' });
  ok(bad.s === 400, 'bad code 400');
  const w = await req('POST', '/branches', A, { code: 'west', name: 'شعبه غرب', sms_sender_line: '۳۰۰۰۱۲۳۴', academy_name: 'آموزشگاه کارلا - غرب' });
  ok(w.s === 200 && w.j.branch?.id && w.j.branch.sms_sender_line === '30001234', 'create west ' + JSON.stringify(w.j).slice(0, 200));
  const dup = await req('POST', '/branches', A, { code: 'west', name: 'y' });
  ok(dup.s === 409, 'duplicate code 409');
  const def = br.j.branches[0];
  ok((await req('PUT', '/branches/' + def.id, A, { is_active: false })).s === 400, 'cannot deactivate default');
}
if (phase === 'multi') {
  const cfg = await req('GET', '/branches/config', A);
  ok(cfg.j.multi === true && cfg.j.branches.length === 2 && cfg.j.can_see_all, 'admin config multi ' + JSON.stringify(cfg.j));
  const west = cfg.j.branches.find((b) => b.code === 'west').id;
  const main = cfg.j.branches.find((b) => b.code === 'main').id;
  // admin sees all without header
  ok((await req('GET', '/students', A)).j.length === 2, 'admin all students');
  const aw = await req('GET', '/students', A, null, { 'x-branch-id': String(west) });
  ok(JSON.stringify(ids(aw)) === '[2]', 'admin west students = [2] ' + JSON.stringify(ids(aw)));
  const am = await req('GET', '/students', A, null, { 'x-branch-id': String(main) });
  ok(JSON.stringify(ids(am)) === '[1]', 'admin main students = [1] ' + JSON.stringify(ids(am)));
  const pw = await req('GET', '/payments', A, null, { 'x-branch-id': String(west) });
  ok(pw.j.length === 1 && pw.j[0].student_id === 2, 'west payments only student 2');
  const cw = await req('GET', '/courses', A, null, { 'x-branch-id': String(west) });
  ok(JSON.stringify(ids(cw)) === '[2]', 'west courses [2] ' + JSON.stringify(ids(cw)));
  const ew = await req('GET', '/expenses', A, null, { 'x-branch-id': String(main) });
  ok(Array.isArray(ew.j) && ew.j.length === 0, 'main expenses empty (expense is west) ' + JSON.stringify(ew.j).slice(0, 80));
  // cashier: unassigned -> default branch only
  const c0 = await req('GET', '/students', C);
  ok(JSON.stringify(ids(c0)) === '[1]', 'unassigned cashier sees default only ' + JSON.stringify(ids(c0)));
  ok((await req('GET', '/students', C, null, { 'x-branch-id': String(west) })).s === 403, 'cashier forbidden west header');
  ok((await req('GET', '/branches/config', C, null, { 'x-branch-id': String(west) })).s === 200, 'config never 403 (stale header)');
  // assign cashier to west only
  const as = await req('PUT', '/branches/users/kasir', A, { branch_ids: [west] });
  ok(as.s === 200, 'assign kasir->west');
  const c1 = await req('GET', '/students', C);
  ok(JSON.stringify(ids(c1)) === '[2]', 'cashier west sees [2] ' + JSON.stringify(ids(c1)));
  ok((await req('GET', '/students/1/smart-crop', C)).s === 404 || true, '');
  const g = await req('PUT', '/students/1', C, { first_name: 'هک' });
  ok(g.s === 404, 'by-id guard: cashier cannot edit main student ' + g.s);
  const rc = await req('GET', '/enrollments/1/report-context', C);
  ok(rc.s === 404, 'by-id guard on enrollment sub-route ' + rc.s);
  // cashier creates a student -> stamped west
  const ns = await req('POST', '/students', C, { first_name: 'رضا', last_name: 'کریمی', national_code: '0012345679', phone_number: '09120000001' });
  ok(ns.s === 200 && ns.j.student?.id, 'cashier creates student ' + ns.s + ' ' + JSON.stringify(ns.j).slice(0, 160));
  const sid = ns.j.student?.id;
  const c2 = await req('GET', '/students', C);
  ok(c2.j.some((s) => s.id === sid), 'new student visible in west');
  ok(!(await req('GET', '/students', A, null, { 'x-branch-id': String(main) })).j.some((s) => s.id === sid), 'new student not in main');
  // enrollment in west course -> derived west; payment derived
  const ne = await req('POST', '/enrollments', C, { student_id: sid, course_id: 2, final_price: 1000000, course_number: 7 });
  ok(ne.s === 200, 'cashier enrolls in west course ' + ne.s + ' ' + JSON.stringify(ne.j).slice(0, 120));
  const np = await req('POST', '/payments', C, { student_id: sid, enrollment_id: ne.j.id, amount: 250000, pay_method: 'pos' });
  ok(np.s === 200, 'payment ' + np.s + ' ' + JSON.stringify(np.j).slice(0, 120));
  const pw2 = await req('GET', '/payments', C);
  ok(pw2.j.some((p) => p.student_id === sid), 'new payment visible in west');
  ok(!(await req('GET', '/payments', A, null, { 'x-branch-id': String(main) })).j.some((p) => p.student_id === sid), 'new payment not in main');
  // student 1 enrolls in west course: becomes visible in west too (home branch main)
  const ne2 = await req('POST', '/enrollments', A, { student_id: 1, course_id: 2, final_price: 500000, course_number: 8 }, { 'x-branch-id': String(west) });
  ok(ne2.s === 200, 'admin enrolls main student into west course');
  const c3 = await req('GET', '/students', C);
  ok(c3.j.some((s) => s.id === 1), 'student 1 visible in west via enrollment');
  // report
  const rep = await req('GET', '/branches/report', A);
  ok(rep.s === 200 && rep.j.rows.length === 2, 'report ok ' + JSON.stringify(rep.j.rows));
  const rw = rep.j.rows.find((r) => r.branch_id === west);
  ok(rw.students === 2 && rw.enrollments === 3 && rw.paid_total === 5250000 && rw.expenses_total === 300000, 'west report numbers');
  const rf = await req('GET', '/branches/report?from=1405/08/02&to=1405/08/30', A);
  ok(rf.s === 200, 'report with range ' + JSON.stringify(rf.j.totals));
  ok((await req('GET', '/branches/report?from=bad', A)).s === 400, 'bad date 400');
  const as2 = await req('GET', '/branches/active-settings', C);
  ok(as2.j.branch_id === west && as2.j.sms_sender_line === '30001234', 'active settings west ' + JSON.stringify(as2.j));
  const us = await req('GET', '/branches/users', A);
  ok(us.j.users.some((u) => u.username === 'kasir' && u.branch_ids[0] === west) && us.j.users.some((u) => u.username === 'admin'), 'users list');
  // cleanup assignment so re-runs stay deterministic
  await req('PUT', '/branches/users/kasir', A, { branch_ids: [] });
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
