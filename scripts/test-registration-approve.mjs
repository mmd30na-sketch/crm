#!/usr/bin/env node
/**
 * Integration test for POST /api/registrations/:code/approve, /reject and the student-delete
 * "back to pending" rule, against a running CRM that uses a MySQL database.
 *
 * It WRITES test rows (students, enrollments, a temporary inactive course, registrations) and removes
 * them again at the end, so it refuses to run unless I_UNDERSTAND_THIS_WRITES=1 is set.
 *
 * Env:
 *   I_UNDERSTAND_THIS_WRITES=1   required
 *   CRM_URL                      base URL of the CRM, e.g. http://localhost:3000
 *   CRM_TOKEN                    admin bearer token (POST /api/auth/login)
 *   DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME   the same MySQL database the CRM uses
 *   SITE_UPLOADS_DIR             optional; when set (and the CRM sees the same dir) the photo-copy path is tested too
 *   COURSE_ID                    optional active course id (default: first active course)
 *
 * Run: I_UNDERSTAND_THIS_WRITES=1 CRM_URL=... CRM_TOKEN=... DB_HOST=... DB_PORT=... DB_USER=... \
 *      DB_PASSWORD=... DB_NAME=... node scripts/test-registration-approve.mjs
 */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

if (process.env.I_UNDERSTAND_THIS_WRITES !== '1') {
  console.error('Refusing to run: this script writes to the database. Set I_UNDERSTAND_THIS_WRITES=1.');
  process.exit(2);
}
const need = ['CRM_URL', 'CRM_TOKEN', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(2);
}

const BASE = process.env.CRM_URL.replace(/\/+$/, '');
const TOKEN = process.env.CRM_TOKEN;
const SITE_DIR = process.env.SITE_UPLOADS_DIR || '';
const RUN = String(Date.now()).slice(-8);

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
});

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
  if (!ok) failures += 1;
};

async function api(method, url, body) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const q = async (sqlText, params = []) => (await db.query(sqlText, params))[0];
const count = async (table) => Number((await q(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);

const created = { regs: [], nationalCodes: [], courseIds: [], files: [] };

async function addReg(n, extra = {}) {
  const code = `TST-${RUN}-${n}`;
  const national = extra.national_code || `9${RUN}${n}`;
  await q(
    `INSERT INTO registrations (tracking_code, national_code, full_name, phone_number, category, status, source,
                               national_card_path, personal_photo_path)
     VALUES (?, ?, ?, ?, 'cargo_freight', 'pending', 'website', ?, ?)`,
    [code, national, extra.full_name || 'تست آزمون', extra.phone || '09120000001', extra.card || null, extra.photo || null]
  );
  created.regs.push(code);
  created.nationalCodes.push(national);
  return { code, national };
}
const getReg = async (code) => (await q('SELECT * FROM registrations WHERE tracking_code = ?', [code]))[0];

try {
  const courses = (await api('GET', '/courses')).json;
  const active = process.env.COURSE_ID
    ? courses.find((c) => String(c.id) === process.env.COURSE_ID)
    : courses.find((c) => c.active !== false && c.active !== 0);
  if (!active) throw new Error('No active course found; set COURSE_ID');
  const courseId = Number(active.id);
  const staff = await q('SELECT user_id FROM staff_users LIMIT 1'); // only used to explain a null approved_by below

  // 1. approve ok (no site files: photos:false) ------------------------------------------------------
  const r1 = await addReg(1);
  let res = await api('POST', `/registrations/${r1.code}/approve`, { course_id: courseId, course_number: 999 });
  check('approve ok -> 200', res.status === 200 && res.json.success, JSON.stringify(res.json));
  const studentId = res.json.student?.id;
  check('student created', res.json.student_created === true && !!studentId);
  check('enrollment created for course', Number(res.json.enrollment?.course_id) === courseId && Number(res.json.enrollment?.course_number) === 999);
  check('missing photos -> photos:false (approval still succeeds)', res.json.photos === false);
  let reg = await getReg(r1.code);
  check('registration approved + linked', reg.status === 'approved' && Number(reg.student_id) === Number(studentId));
  check('approved_at set', !!reg.approved_at);
  check('approved_by filled when the token user exists in staff_users', reg.approved_by !== null || staff.length === 0,
    'approved_by is NULL: the token user has no row in staff_users (FK column), so it cannot be stored');

  // 2. approve twice -> 409 --------------------------------------------------------------------------
  const enrBefore = await count('enrollments');
  res = await api('POST', `/registrations/${r1.code}/approve`, { course_id: courseId, course_number: 999 });
  check('approve twice -> 409 already_processed', res.status === 409 && res.json.code === 'already_processed', JSON.stringify(res.json));
  check('second approve created nothing', (await count('enrollments')) === enrBefore);

  // 3. existing national code: reuse, phone not overwritten ------------------------------------------
  const r3 = await addReg(3, { phone: '09129999999', full_name: 'نام دیگر' });
  await q(`INSERT INTO students (first_name, last_name, national_code, phone_number, address) VALUES (?, ?, ?, ?, '')`,
    ['اصلی', 'قدیمی', r3.national, '09120000000']);
  const existingId = (await q('SELECT student_id FROM students WHERE national_code = ?', [r3.national]))[0].student_id;
  res = await api('POST', `/registrations/${r3.code}/approve`, { course_id: courseId, course_number: 999 });
  check('existing student reused', res.status === 200 && res.json.student_created === false && Number(res.json.student?.id) === Number(existingId), JSON.stringify(res.json));
  const st = (await q('SELECT * FROM students WHERE student_id = ?', [existingId]))[0];
  check('existing phone/name not overwritten', st.phone_number === '09120000000' && st.first_name === 'اصلی' && st.last_name === 'قدیمی');
  check('only one student for that national code', (await q('SELECT COUNT(*) AS n FROM students WHERE national_code = ?', [r3.national]))[0].n === 1);

  // 4. inactive course -> 4xx and nothing changes ----------------------------------------------------
  const [ins] = await db.query(`INSERT INTO courses (title, price, duration_days, is_active) VALUES (?, 1000, 7, 0)`, [`TEST-INACTIVE-${RUN}`]);
  created.courseIds.push(ins.insertId);
  const r4 = await addReg(4);
  const before = { s: await count('students'), e: await count('enrollments') };
  res = await api('POST', `/registrations/${r4.code}/approve`, { course_id: ins.insertId, course_number: 999 });
  check('inactive course -> 4xx', res.status >= 400 && res.status < 500, `${res.status} ${JSON.stringify(res.json)}`);
  reg = await getReg(r4.code);
  check('rollback: registration still pending/unlinked', reg.status === 'pending' && reg.student_id === null && reg.approved_at === null);
  check('rollback: no student or enrollment added', (await count('students')) === before.s && (await count('enrollments')) === before.e);

  // 5. photos copied when the site files exist (needs SITE_UPLOADS_DIR shared with the CRM) -----------
  if (SITE_DIR && fs.existsSync(SITE_DIR)) {
    const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    const f1 = `tst-${RUN}-card.jpg`, f2 = `tst-${RUN}-photo.jpg`;
    fs.writeFileSync(path.join(SITE_DIR, f1), jpg);
    fs.writeFileSync(path.join(SITE_DIR, f2), jpg);
    created.files.push(path.join(SITE_DIR, f1), path.join(SITE_DIR, f2));
    const r5 = await addReg(5, { card: `/uploads/registrations/${f1}`, photo: `/uploads/registrations/${f2}` });
    res = await api('POST', `/registrations/${r5.code}/approve`, { course_id: courseId, course_number: 999 });
    check('site photos copied -> photos:true', res.status === 200 && res.json.photos === true, JSON.stringify(res.json));
    const s5 = (await q('SELECT id_card_photo, personal_photo FROM students WHERE student_id = ?', [res.json.student?.id]))[0];
    check('student photo columns point into StudentFiles', /^\/StudentFiles\//.test(s5?.id_card_photo || '') && /^\/StudentFiles\//.test(s5?.personal_photo || ''));
    const trav = await addReg(6, { card: '/uploads/registrations/../../etc/passwd.jpg' });
    res = await api('POST', `/registrations/${trav.code}/approve`, { course_id: courseId, course_number: 998 });
    check('path traversal in stored path is ignored (photos:false, approval ok)', res.status === 200 && res.json.photos === false, JSON.stringify(res.json));
  } else {
    console.log('SKIP  photo copy (set SITE_UPLOADS_DIR to a dir the CRM server also uses)');
  }

  // 6. reject ---------------------------------------------------------------------------------------
  const r7 = await addReg(7);
  res = await api('POST', `/registrations/${r7.code}/reject`, { reason: 'test' });
  check('reject -> 200, status rejected', res.status === 200 && (await getReg(r7.code)).status === 'rejected', JSON.stringify(res.json));
  res = await api('POST', `/registrations/${r7.code}/reject`, {});
  check('reject again -> 409', res.status === 409);
  res = await api('POST', `/registrations/${r7.code}/approve`, { course_id: courseId });
  check('approve after reject -> 409', res.status === 409);

  // 7. delete student -> registration back to pending -----------------------------------------------
  res = await api('DELETE', `/students/${studentId}`);
  check('delete student -> 200', res.status === 200, JSON.stringify(res.json));
  reg = await getReg(r1.code);
  check('registration back to pending, link cleared',
    reg.status === 'pending' && reg.student_id === null && reg.approved_at === null && reg.approved_by === null,
    JSON.stringify(reg));
} catch (err) {
  failures += 1;
  console.error('ERROR', err);
} finally {
  // Cleanup of everything this run created.
  try {
    for (const nc of created.nationalCodes) {
      const ids = (await q('SELECT student_id FROM students WHERE national_code = ?', [nc])).map((r) => r.student_id);
      for (const id of ids) {
        // Through the API first: it also removes the copied files from StudentFiles.
        try { await api('DELETE', `/students/${id}`); } catch {}
        await q('DELETE FROM payments WHERE student_id = ?', [id]);
        await q('DELETE FROM enrollments WHERE student_id = ?', [id]);
        await q('UPDATE registrations SET student_id = NULL WHERE student_id = ?', [id]);
        await q('DELETE FROM students WHERE student_id = ?', [id]);
      }
      try { await q('DELETE FROM TblStudents WHERE Ncode = ?', [nc]); } catch {}
    }
    for (const code of created.regs) await q('DELETE FROM registrations WHERE tracking_code = ?', [code]);
    for (const id of created.courseIds) await q('DELETE FROM courses WHERE course_id = ?', [id]);
    for (const f of created.files) { try { fs.unlinkSync(f); } catch {} }
  } catch (err) {
    console.error('Cleanup failed (remove rows with tracking_code LIKE "TST-' + RUN + '-%" by hand):', err.message);
  }
  await db.end();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
