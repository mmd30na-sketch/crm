import fs from 'fs';
import net from 'net';
import mysql from 'mysql2/promise';

/**
 * Read at connection time, not at import time: this module is imported before server.ts runs
 * dotenv.config(), so constants read here would never see the values from .env.
 */
function getDbConfig() {
  const DB_HOST = process.env.DB_HOST || 'services.irn5.chabokan.net';
  const DB_PORT = Number(process.env.DB_PORT || 52691);
  const DB_USER = process.env.DB_USER || 'nodejs430_carla';
  const DB_PASSWORD = process.env.DB_PASSWORD || process.env.NODEJS_DB_PASS || '';
  const DB_NAME = process.env.DB_NAME || 'nodejs430_carla';
  const SOCKS_HOST = process.env.DB_SOCKS_HOST || '';
  const SOCKS_PORT = Number(process.env.DB_SOCKS_PORT || 1081);
  const useSocks = Boolean(SOCKS_HOST);
  return { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, SOCKS_HOST, SOCKS_PORT, useSocks };
}

let live: mysql.Connection | null = null;
let mysqlEnabled = false;

function socksSocket(): Promise<net.Socket> {
  const { DB_HOST, DB_PORT, SOCKS_HOST, SOCKS_PORT } = getDbConfig();
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: SOCKS_HOST, port: SOCKS_PORT, timeout: 15000 });
    let buf = Buffer.alloc(0);
    let stage = 0;
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('SOCKS timeout')));
    socket.once('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
    socket.on('data', onData);

    function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00) return fail(new Error('SOCKS auth failed'));
        buf = buf.slice(2);
        stage = 1;
        const host = Buffer.from(DB_HOST);
        socket.write(
          Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
            host,
            Buffer.from([(DB_PORT >> 8) & 0xff, DB_PORT & 0xff]),
          ])
        );
      }
      if (stage === 1) {
        if (buf.length < 10) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00) return fail(new Error(`SOCKS connect failed ${buf[1]}`));
        const leftover = buf.slice(10);
        socket.removeListener('data', onData);
        socket.setTimeout(0);
        if (leftover.length) socket.unshift(leftover);
        resolve(socket);
      }
    }
  });
}

export function isMysqlEnabled() {
  return mysqlEnabled;
}

export async function initMysql(): Promise<boolean> {
  const { DB_HOST, DB_PORT, DB_PASSWORD, DB_NAME, SOCKS_HOST, SOCKS_PORT, useSocks } = getDbConfig();
  if (!DB_PASSWORD) {
    console.warn('Chabokan MySQL skipped: DB_PASSWORD / NODEJS_DB_PASS is empty');
    mysqlEnabled = false;
    return false;
  }
  try {
    await getConn();
    mysqlEnabled = true;
    await ensureStudentExtendedColumns();
    const via = useSocks
      ? `via socks5://${SOCKS_HOST}:${SOCKS_PORT}`
      : `direct ${DB_HOST}:${DB_PORT}`;
    console.log(`Connected to Chabokan MySQL ${DB_NAME} ${via}`);
    return true;
  } catch (err: any) {
    mysqlEnabled = false;
    console.error('Chabokan MySQL connection failed:', err.message);
    return false;
  }
}

/** Opens a new connection (also used for transactions that must not share the long-lived one). */
async function createConn(): Promise<mysql.Connection> {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, useSocks } = getDbConfig();
  if (useSocks) {
    return mysql.createConnection({
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      stream: await socksSocket(),
      connectTimeout: 20000,
      charset: 'utf8mb4',
    });
  }
  return mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectTimeout: 20000,
    charset: 'utf8mb4',
  });
}

async function getConn(): Promise<mysql.Connection> {
  if (live) {
    try {
      await live.query('SELECT 1');
      return live;
    } catch {
      try { await live.end(); } catch {}
      live = null;
    }
  }
  live = await createConn();
  live.on('error', () => {
    live = null;
  });
  return live;
}

export async function sql<T = any>(query: string, params: any[] = []): Promise<T[]> {
  const conn = await getConn();
  const [rows] = await conn.query(query, params);
  return rows as T[];
}

export async function sqlExec(query: string, params: any[] = []): Promise<{ insertId: number; affectedRows: number }> {
  const conn = await getConn();
  const [result] = await conn.query(query, params);
  const r = result as mysql.ResultSetHeader;
  return { insertId: r.insertId || 0, affectedRows: r.affectedRows || 0 };
}

let studentHasFatherName = false;
let studentHasBirthDate = false;

export function jalaliToday(): string {
  const raw = new Date().toLocaleDateString('fa-IR');
  const mapped = raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = mapped.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return mapped;
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
}

async function ensureStudentExtendedColumns() {
  try {
    const cols = await sql<{ Field: string }>('SHOW COLUMNS FROM students');
    const names = new Set(cols.map((c) => c.Field));
    if (!names.has('father_name')) {
      try {
        await sqlExec('ALTER TABLE students ADD COLUMN father_name VARCHAR(100) NULL');
        studentHasFatherName = true;
        console.log('Added students.father_name');
      } catch (err: any) {
        console.warn('Could not add students.father_name:', err.message);
      }
    } else {
      studentHasFatherName = true;
    }
    if (!names.has('birth_date_jalali')) {
      try {
        await sqlExec('ALTER TABLE students ADD COLUMN birth_date_jalali VARCHAR(20) NULL');
        studentHasBirthDate = true;
        console.log('Added students.birth_date_jalali');
      } catch (err: any) {
        console.warn('Could not add students.birth_date_jalali:', err.message);
      }
    } else {
      studentHasBirthDate = true;
    }
  } catch (err: any) {
    console.warn('Could not inspect students columns:', err.message);
  }
}

function studentSelectColumns() {
  const extra = [
    studentHasFatherName ? 's.father_name' : "'' AS father_name",
    studentHasBirthDate ? 's.birth_date_jalali' : "'' AS birth_date_jalali",
  ].join(', ');
  return extra;
}

async function fetchStudentById(studentId: number) {
  const rows = await sql(
    `SELECT student_id AS id, first_name, last_name, ${studentHasFatherName ? 'father_name' : "'' AS father_name"},
            national_code, phone_number, ${studentHasBirthDate ? 'birth_date_jalali' : "'' AS birth_date_jalali"},
            address, id_card_photo AS id_card_photo_url, personal_photo AS personal_photo_url,
            created_at, 'active' AS status
     FROM students WHERE student_id = ?`,
    [studentId]
  );
  return rows[0];
}

async function syncTblStudent(payload: {
  studentId: number;
  firstName: string;
  lastName: string;
  nationalCode: string;
  phoneNumber: string;
  address: string;
  idCard?: string | null;
  personalPhoto?: string | null;
  photosOnly?: boolean;
}) {
  const { studentId, firstName, lastName, nationalCode, phoneNumber, address } = payload;
  const idCard = payload.idCard ?? null;
  const personalPhoto = payload.personalPhoto ?? null;

  const byCode = nationalCode
    ? await sql<any>('SELECT StudentID, Ncode FROM TblStudents WHERE Ncode = ? LIMIT 1', [nationalCode])
    : [];
  const byId = await sql<any>('SELECT StudentID, Ncode FROM TblStudents WHERE StudentID = ? LIMIT 1', [studentId]);

  if (byCode[0]) {
    if (payload.photosOnly) {
      if (idCard) await sqlExec('UPDATE TblStudents SET IdCartPht = ? WHERE Ncode = ?', [idCard, nationalCode]);
      if (personalPhoto) await sqlExec('UPDATE TblStudents SET PersonalPht = ? WHERE Ncode = ?', [personalPhoto, nationalCode]);
      return;
    }
    await sqlExec(
      `UPDATE TblStudents SET firstName = ?, lastName = ?, phoneNumber = ?, Address = ?,
              IdCartPht = COALESCE(?, IdCartPht), PersonalPht = COALESCE(?, PersonalPht)
       WHERE Ncode = ?`,
      [firstName, lastName, phoneNumber, address, idCard, personalPhoto, nationalCode]
    );
    return;
  }

  if (byId[0] && byId[0].Ncode && nationalCode && String(byId[0].Ncode) !== nationalCode) {
    console.warn(`TblStudents StudentID ${studentId} belongs to Ncode ${byId[0].Ncode}; inserting a new legacy row to avoid overwrite`);
    await sqlExec(
      `INSERT INTO TblStudents (firstName, lastName, Ncode, phoneNumber, Address, IdCartPht, PersonalPht)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [firstName, lastName, nationalCode, phoneNumber, address, idCard, personalPhoto]
    );
    return;
  }

  if (byId[0]) {
    if (payload.photosOnly) {
      if (idCard) await sqlExec('UPDATE TblStudents SET IdCartPht = ? WHERE StudentID = ?', [idCard, studentId]);
      if (personalPhoto) await sqlExec('UPDATE TblStudents SET PersonalPht = ? WHERE StudentID = ?', [personalPhoto, studentId]);
      return;
    }
    await sqlExec(
      `UPDATE TblStudents SET firstName = ?, lastName = ?, Ncode = ?, phoneNumber = ?, Address = ?,
              IdCartPht = COALESCE(?, IdCartPht), PersonalPht = COALESCE(?, PersonalPht)
       WHERE StudentID = ?`,
      [firstName, lastName, nationalCode, phoneNumber, address, idCard, personalPhoto, studentId]
    );
    return;
  }

  await sqlExec(
    `INSERT INTO TblStudents (StudentID, firstName, lastName, Ncode, phoneNumber, Address, IdCartPht, PersonalPht)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [studentId, firstName, lastName, nationalCode, phoneNumber, address, idCard, personalPhoto]
  );
}

export async function listCourses() {
  return sql(
    `SELECT course_id AS id, title,
            CONCAT('C-', course_id) AS code,
            CAST(price AS DECIMAL(15,2)) AS tuition,
            CEIL(COALESCE(duration_days, 56) / 7) AS duration_weeks,
            IF(is_active = 1, TRUE, FALSE) AS active
     FROM courses ORDER BY course_id ASC`
  );
}

export async function insertCourse(body: any) {
  const title = String(body.title || '').trim();
  const price = Number(body.price ?? body.tuition ?? 0);
  const durationDays = body.duration_days ?? (body.duration_weeks ? Number(body.duration_weeks) * 7 : 56);
  const active = body.is_active ?? body.active ?? 1;
  const result = await sqlExec(
    'INSERT INTO courses (title, price, duration_days, is_active) VALUES (?, ?, ?, ?)',
    [title, price, durationDays, active ? 1 : 0]
  );
  const rows = await sql('SELECT course_id AS id, title, CONCAT("C-", course_id) AS code, price AS tuition, CEIL(COALESCE(duration_days,56)/7) AS duration_weeks, IF(is_active=1,TRUE,FALSE) AS active FROM courses WHERE course_id = ?', [result.insertId]);
  return rows[0];
}

export async function updateCourse(id: number, body: any) {
  const title = String(body.title || '').trim();
  const price = Number(body.price ?? body.tuition ?? 0);
  const durationDays = body.duration_days ?? (body.duration_weeks ? Number(body.duration_weeks) * 7 : 56);
  const active = body.is_active ?? body.active ?? 1;
  await sqlExec(
    'UPDATE courses SET title = ?, price = ?, duration_days = ?, is_active = ? WHERE course_id = ?',
    [title, price, durationDays, active ? 1 : 0, id]
  );
  const rows = await sql('SELECT course_id AS id, title, CONCAT("C-", course_id) AS code, price AS tuition, CEIL(COALESCE(duration_days,56)/7) AS duration_weeks, IF(is_active=1,TRUE,FALSE) AS active FROM courses WHERE course_id = ?', [id]);
  return rows[0];
}

export async function listStudents() {
  const rows = await sql(
    `SELECT s.student_id AS id,
            s.first_name, s.last_name,
            ${studentSelectColumns()},
            s.national_code, s.phone_number, s.address,
            s.id_card_photo AS id_card_photo_url,
            s.personal_photo AS personal_photo_url,
            s.created_at,
            'active' AS status,
            CAST(COALESCE(x.total_paid, 0) AS DECIMAL(15,2)) AS total_paid,
            CAST(COALESCE(x.course_fee, 0) AS DECIMAL(15,2)) AS course_fee,
            CAST(COALESCE(x.remaining_debt, 0) AS DECIMAL(15,2)) AS remaining_debt
     FROM students s
     LEFT JOIN (
       SELECT student_id,
              SUM(amount_paid_from_payments) AS total_paid,
              SUM(final_price) AS course_fee,
              SUM(balance_due) AS remaining_debt
       FROM v_enrollment_balances
       GROUP BY student_id
     ) x ON x.student_id = s.student_id
     ORDER BY s.student_id DESC`
  );
  return rows.map((s: any) => ({
    ...s,
    total_paid: Number(s.total_paid || 0),
    course_fee: Number(s.course_fee || 0),
    remaining_debt: Number(s.remaining_debt || 0),
    tuition: Number(s.course_fee || 0),
  }));
}

export async function insertStudent(body: any) {
  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const nationalCode = String(body.national_code || '').trim();
  const phoneNumber = String(body.phone_number || '').trim();
  const address = String(body.address || '').trim();
  const fatherName = String(body.father_name || '').trim();
  const birthDate = String(body.birth_date_jalali || '').trim();
  // Photo paths are set by the server's upload handler; a client-supplied value is only kept when it points into StudentFiles/.
  const ownFile = (v: unknown) => {
    const p = typeof v === 'string' ? v.trim() : '';
    return /^\/?StudentFiles\//.test(p) && !p.includes('..') ? p : null;
  };
  const idCard = ownFile(body.id_card_photo_url) || ownFile(body.national_card_path);
  const personalPhoto = ownFile(body.personal_photo_url) || ownFile(body.personal_photo_path);

  if (nationalCode) {
    const dup = await sql('SELECT student_id AS id FROM students WHERE national_code = ? LIMIT 1', [nationalCode]);
    if (dup[0]) {
      const err: any = new Error(`کد ملی ${nationalCode} قبلاً ثبت شده (student_id=${dup[0].id})`);
      err.status = 409;
      throw err;
    }
  }

  const columns = ['first_name', 'last_name', 'national_code', 'phone_number', 'address', 'id_card_photo', 'personal_photo'];
  const values: any[] = [firstName, lastName, nationalCode, phoneNumber, address, idCard, personalPhoto];
  if (studentHasFatherName) {
    columns.push('father_name');
    values.push(fatherName || null);
  }
  if (studentHasBirthDate) {
    columns.push('birth_date_jalali');
    values.push(birthDate || null);
  }

  const result = await sqlExec(
    `INSERT INTO students (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values
  );

  const studentId = result.insertId;

  try {
    await syncTblStudent({
      studentId, firstName, lastName, nationalCode, phoneNumber, address, idCard, personalPhoto,
    });
  } catch (err: any) {
    console.warn('Sync insert to TblStudents warning:', err.message);
  }

  return fetchStudentById(studentId);
}

export async function updateStudent(id: number, body: any) {
  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const nationalCode = String(body.national_code || '').trim();
  const phoneNumber = String(body.phone_number || '').trim();
  const address = String(body.address || '').trim();
  const fatherName = String(body.father_name || '').trim();
  const birthDate = String(body.birth_date_jalali || '').trim();

  const sets = ['first_name = ?', 'last_name = ?', 'national_code = ?', 'phone_number = ?', 'address = ?'];
  const params: any[] = [firstName, lastName, nationalCode, phoneNumber, address];
  if (studentHasFatherName) {
    sets.push('father_name = ?');
    params.push(fatherName || null);
  }
  if (studentHasBirthDate) {
    sets.push('birth_date_jalali = ?');
    params.push(birthDate || null);
  }
  params.push(id);

  await sqlExec(`UPDATE students SET ${sets.join(', ')} WHERE student_id = ?`, params);

  try {
    await syncTblStudent({
      studentId: id, firstName, lastName, nationalCode, phoneNumber, address,
    });
  } catch (err: any) {
    console.warn('Sync update to TblStudents warning:', err.message);
  }

  return fetchStudentById(id);
}

export async function deleteStudent(id: number) {
  // The legacy row is matched by national code (its StudentID is not guaranteed to equal ours).
  const found = await sql<any>('SELECT national_code FROM students WHERE student_id = ? LIMIT 1', [id]);
  const nationalCode = String(found[0]?.national_code || '').trim();
  const conn = await getConn();
  await conn.beginTransaction();
  try {
    await conn.query('DELETE FROM payments WHERE student_id = ?', [id]);
    await conn.query('DELETE FROM enrollments WHERE student_id = ?', [id]);
    // A website registration that was approved into this student goes back to the pending queue.
    await conn.query(
      `UPDATE registrations SET status = 'pending', student_id = NULL, approved_by = NULL, approved_at = NULL
       WHERE student_id = ?`,
      [id]
    );
    await conn.query('DELETE FROM students WHERE student_id = ?', [id]);
    if (nationalCode) {
      try {
        await conn.query('DELETE FROM TblStudents WHERE Ncode = ?', [nationalCode]);
      } catch (err: any) {
        console.warn('Sync delete from TblStudents warning:', err.message);
      }
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  }
}

export async function updateStudentPhotos(id: number, idCard?: string, personal?: string) {
  if (idCard) {
    await sqlExec('UPDATE students SET id_card_photo = ? WHERE student_id = ?', [idCard, id]);
  }
  if (personal) {
    await sqlExec('UPDATE students SET personal_photo = ? WHERE student_id = ?', [personal, id]);
  }
  try {
    const row = await fetchStudentById(id);
    if (row) {
      await syncTblStudent({
        studentId: id,
        firstName: row.first_name,
        lastName: row.last_name,
        nationalCode: row.national_code,
        phoneNumber: row.phone_number,
        address: row.address || '',
        idCard: idCard || row.id_card_photo_url,
        personalPhoto: personal || row.personal_photo_url,
        photosOnly: true,
      });
    }
  } catch (err: any) {
    console.warn('Sync photos to TblStudents warning:', err.message);
  }
}

export async function listEnrollments() {
  const rows = await sql(
    `SELECT e.enrollment_id AS id, e.student_id, e.course_id, e.course_number,
            e.signup_date_jalali, CAST(e.final_price AS DECIMAL(15,2)) AS final_price,
            CAST(COALESCE(b.amount_paid_from_payments, e.amount_paid, 0) AS DECIMAL(15,2)) AS amount_paid,
            CAST(COALESCE(b.balance_due, 0) AS DECIMAL(15,2)) AS remaining_debt,
            e.receipt_pdf_path
     FROM enrollments e
     LEFT JOIN v_enrollment_balances b ON b.enrollment_id = e.enrollment_id
     ORDER BY e.enrollment_id DESC`
  );
  return rows.map((e: any) => ({
    ...e,
    final_price: Number(e.final_price || 0),
    amount_paid: Number(e.amount_paid || 0),
    remaining_debt: Number(e.remaining_debt || 0),
  }));
}

export async function insertEnrollment(body: any) {
  const result = await sqlExec(
    `INSERT INTO enrollments (student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [
      Number(body.student_id),
      Number(body.course_id),
      body.course_number ? Number(body.course_number) : 1,
      String(body.signup_date_jalali || jalaliToday()),
      Number(body.final_price || 0),
    ]
  );
  const rows = await sql(
    `SELECT enrollment_id AS id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid
     FROM enrollments WHERE enrollment_id = ?`,
    [result.insertId]
  );
  return rows[0];
}

export async function listPayments() {
  const rows = await sql(
    `SELECT payment_id AS id, enrollment_id, student_id, pay_date_jalali,
            CAST(amount AS DECIMAL(15,2)) AS amount, pay_method, payment_kind, description
     FROM payments ORDER BY payment_id DESC`
  );
  return rows.map((p: any) => ({ ...p, amount: Number(p.amount || 0) }));
}

export async function insertPayment(body: any) {
  const result = await sqlExec(
    `INSERT INTO payments (enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      body.enrollment_id ? Number(body.enrollment_id) : null,
      Number(body.student_id),
      String(body.pay_date_jalali || jalaliToday()),
      Number(body.amount),
      String(body.pay_method || body.paymentMethod || 'pos'),
      String(body.payment_kind || 'downpayment'),
      String(body.description || body.notes || ''),
    ]
  );
  const rows = await sql(
    `SELECT payment_id AS id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description
     FROM payments WHERE payment_id = ?`,
    [result.insertId]
  );
  return rows[0];
}

export async function listExpenses() {
  const rows = await sql(
    `SELECT expense_id AS id, title, CAST(amount AS DECIMAL(15,2)) AS amount,
            COALESCE(vendor_name, '') AS pay_method,
            expense_date_jalali AS pay_date_jalali,
            description
     FROM expenses ORDER BY expense_id DESC`
  );
  return rows.map((e: any) => ({ ...e, amount: Number(e.amount || 0) }));
}

export async function insertExpense(body: any) {
  const result = await sqlExec(
    `INSERT INTO expenses (title, amount, expense_date_jalali, vendor_name, description)
     VALUES (?, ?, ?, ?, ?)`,
    [
      String(body.title || body.expenseTitle || '').trim(),
      Number(body.amount || body.expenseAmount),
      String(body.pay_date_jalali || body.expenseDate || body.expensedate || ''),
      String(body.pay_method || body.category || ''),
      String(body.description || body.notes || ''),
    ]
  );
  const rows = await sql(
    `SELECT expense_id AS id, title, amount, vendor_name AS pay_method, expense_date_jalali AS pay_date_jalali, description
     FROM expenses WHERE expense_id = ?`,
    [result.insertId]
  );
  return rows[0];
}

export async function findStaffByUsername(username: string) {
  const rows = await sql(
    `SELECT user_id, username, password_hash, full_name, role, is_active
     FROM staff_users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

export async function listWebsiteRegistrations() {
  return sql(
    `SELECT registration_id AS id, tracking_code, national_code, full_name, phone_number,
            category, academic_degree, military_status, has_temp_permit,
            national_card_path, personal_photo_path, status, source, student_id,
            approved_by, approved_at, created_at
     FROM registrations ORDER BY registration_id DESC`
  );
}

export async function getWebsiteRegistrationFiles(trackingCode: string) {
  const rows = await sql(
    'SELECT national_card_path, personal_photo_path FROM registrations WHERE tracking_code = ? LIMIT 1',
    [trackingCode]
  );
  return rows[0] || null;
}

function httpError(status: number, message: string, code?: string) {
  const err: any = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

const toLatinDigits = (v: unknown) =>
  String(v ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();

export type ApproveRegistrationInput = {
  trackingCode: string;
  staffUsername: string;
  courseId: number;
  courseNumber?: number | null;
  finalPrice?: number | null;
  signupDate: string;
  /** Validated student fields from the request body (only the ones that were sent). */
  overrides: { first_name?: string; last_name?: string; phone_number?: string; address?: string; birth_date_jalali?: string };
  /** When false an existing student keeps their name/phone/address; the overrides only apply to a new record. */
  updateExisting: boolean;
  /**
   * Copies the site upload files into StudentFiles. Must not throw; lists every file it created in
   * `created` so the caller can delete them when the transaction rolls back.
   */
  copyFiles: (
    reg: { national_card_path?: string | null; personal_photo_path?: string | null },
    target: { studentId: number; lastName: string; courseNumber: number; wantIdCard: boolean; wantPersonal: boolean }
  ) => Promise<{ idCard?: string; personal?: string; created: string[] }>;
};

/**
 * Approves a website registration in one transaction on a dedicated connection: student (new or reused),
 * enrollment, photo files and the registration row all commit or roll back together.
 */
export async function approveWebsiteRegistration(input: ApproveRegistrationInput) {
  const conn = await createConn();
  let created: string[] = [];
  let committed = false;
  let result: { studentId: number; enrollmentId: number; photos: boolean; isNewStudent: boolean; student: any } | null = null;
  try {
    await conn.beginTransaction();

    const [regRows] = await conn.query(
      'SELECT * FROM registrations WHERE tracking_code = ? LIMIT 1 FOR UPDATE',
      [input.trackingCode]
    );
    const reg = (regRows as any[])[0];
    if (!reg) throw httpError(404, 'ثبت‌نام یافت نشد.');
    if (reg.status !== 'pending' || reg.student_id) throw httpError(409, 'این ثبت‌نام قبلاً پردازش شده است.', 'already_processed');

    const [courseRows] = await conn.query(
      'SELECT course_id, price, is_active FROM courses WHERE course_id = ? LIMIT 1',
      [input.courseId]
    );
    const course = (courseRows as any[])[0];
    if (!course) throw httpError(404, 'دوره آموزشی یافت نشد.');
    if (Number(course.is_active) !== 1) throw httpError(409, 'این دوره غیرفعال است و ثبت‌نام جدید ندارد.');
    const finalPrice = input.finalPrice === undefined || input.finalPrice === null ? Number(course.price || 0) : Number(input.finalPrice);
    if (!Number.isFinite(finalPrice) || finalPrice < 0) throw httpError(400, 'شهریه نامعتبر است.');

    let courseNumber = input.courseNumber ?? null;
    if (courseNumber === null) {
      const [maxRows] = await conn.query('SELECT MAX(course_number) AS m FROM enrollments');
      courseNumber = Number((maxRows as any[])[0]?.m) > 0 ? Number((maxRows as any[])[0].m) : 1;
    }

    const nationalCode = toLatinDigits(reg.national_code).replace(/[\s-]/g, '');
    if (!nationalCode) throw httpError(400, 'کد ملی ثبت‌نام خالی است.');
    const [stuRows] = await conn.query('SELECT * FROM students WHERE national_code = ? LIMIT 1 FOR UPDATE', [nationalCode]);
    let student = (stuRows as any[])[0];
    const isNewStudent = !student;
    const o = input.overrides;

    if (student) {
      if (input.updateExisting) {
        const sets: string[] = [];
        const params: any[] = [];
        const map: Array<[string, string | undefined, boolean]> = [
          ['first_name', o.first_name, true], ['last_name', o.last_name, true], ['phone_number', o.phone_number, true],
          ['address', o.address, true], ['birth_date_jalali', o.birth_date_jalali, studentHasBirthDate],
        ];
        for (const [col, val, ok] of map) {
          if (ok && val !== undefined) { sets.push(`${col} = ?`); params.push(val); }
        }
        if (sets.length) {
          params.push(student.student_id);
          await conn.query(`UPDATE students SET ${sets.join(', ')} WHERE student_id = ?`, params);
        }
      }
    } else {
      const parts = String(reg.full_name || '').trim().split(/\s+/).filter(Boolean);
      const firstName = o.first_name ?? (parts[0] || '');
      const lastName = o.last_name ?? parts.slice(1).join(' ');
      const phone = o.phone_number ?? toLatinDigits(reg.phone_number).replace(/[\s-]/g, '');
      if (!firstName || !lastName) throw httpError(400, 'نام و نام خانوادگی کارآموز مشخص نیست؛ آن‌ها را وارد کنید.');
      if (!phone) throw httpError(400, 'شماره همراه کارآموز مشخص نیست.');
      const columns = ['first_name', 'last_name', 'national_code', 'phone_number', 'address'];
      const values: any[] = [firstName, lastName, nationalCode, phone, o.address ?? ''];
      if (studentHasBirthDate && o.birth_date_jalali) { columns.push('birth_date_jalali'); values.push(o.birth_date_jalali); }
      const [ins] = await conn.query(
        `INSERT INTO students (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        values
      );
      const [fresh] = await conn.query('SELECT * FROM students WHERE student_id = ?', [(ins as mysql.ResultSetHeader).insertId]);
      student = (fresh as any[])[0];
    }
    const studentId = Number(student.student_id);

    const [dup] = await conn.query(
      'SELECT enrollment_id FROM enrollments WHERE student_id = ? AND course_id = ? AND course_number = ? LIMIT 1',
      [studentId, input.courseId, courseNumber]
    );
    if ((dup as any[]).length) throw httpError(409, 'این کارآموز قبلاً در همین دوره و کلاس ثبت‌نام شده است.');

    const [enr] = await conn.query(
      `INSERT INTO enrollments (student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [studentId, input.courseId, courseNumber, input.signupDate || jalaliToday(), finalPrice]
    );
    const enrollmentId = (enr as mysql.ResultSetHeader).insertId;

    // Never replace a photo the student already has.
    const copied = await input.copyFiles(reg, {
      studentId,
      lastName: String(student.last_name || ''),
      courseNumber,
      wantIdCard: !student.id_card_photo,
      wantPersonal: !student.personal_photo,
    });
    created = copied.created;
    if (copied.idCard) await conn.query('UPDATE students SET id_card_photo = ? WHERE student_id = ?', [copied.idCard, studentId]);
    if (copied.personal) await conn.query('UPDATE students SET personal_photo = ? WHERE student_id = ?', [copied.personal, studentId]);

    const [staffRows] = await conn.query('SELECT user_id FROM staff_users WHERE username = ? LIMIT 1', [input.staffUsername]);
    const approvedBy = (staffRows as any[])[0]?.user_id ?? null;
    await conn.query(
      `UPDATE registrations SET status = 'approved', student_id = ?, approved_by = ?, approved_at = NOW()
       WHERE registration_id = ?`,
      [studentId, approvedBy, reg.registration_id]
    );

    await conn.commit();
    committed = true;
    result = { studentId, enrollmentId, photos: Boolean(copied.idCard || copied.personal), isNewStudent, student };
    const out = result;
    // The legacy table is updated best-effort after the commit, like the other student writes.
    try {
      const row = await fetchStudentById(out.studentId);
      if (row) {
        await syncTblStudent({
          studentId: out.studentId, firstName: row.first_name, lastName: row.last_name, nationalCode: row.national_code,
          phoneNumber: row.phone_number, address: row.address || '',
          idCard: row.id_card_photo_url, personalPhoto: row.personal_photo_url,
          photosOnly: !out.isNewStudent,
        });
      }
    } catch (err: any) {
      console.warn('Sync approved registration to TblStudents warning:', err.message);
    }
    const [enrRows] = await conn.query(
      `SELECT enrollment_id AS id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid
       FROM enrollments WHERE enrollment_id = ?`,
      [enrollmentId]
    );
    const [regOut] = await conn.query(
      `SELECT registration_id AS id, tracking_code, national_code, full_name, phone_number, category, status,
              student_id, approved_by, approved_at, created_at
       FROM registrations WHERE registration_id = ?`,
      [reg.registration_id]
    );
    return {
      student: await fetchStudentById(studentId),
      enrollment: (enrRows as any[])[0],
      registration: (regOut as any[])[0],
      photos: out.photos,
      student_created: out.isNewStudent,
    };
  } catch (err) {
    if (!committed) {
      try { await conn.rollback(); } catch {}
      created.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    }
    throw err;
  } finally {
    try { await conn.end(); } catch {}
  }
}

export async function rejectWebsiteRegistration(trackingCode: string, staffUsername: string) {
  const r = await sqlExec(
    `UPDATE registrations
     SET status = 'rejected', approved_at = NOW(),
         approved_by = (SELECT user_id FROM staff_users WHERE username = ? LIMIT 1)
     WHERE tracking_code = ? AND status = 'pending' AND student_id IS NULL`,
    [staffUsername, trackingCode]
  );
  if (r.affectedRows === 0) {
    const rows = await sql('SELECT status FROM registrations WHERE tracking_code = ? LIMIT 1', [trackingCode]);
    if (!rows[0]) throw httpError(404, 'ثبت‌نام یافت نشد.');
    throw httpError(409, 'این ثبت‌نام قبلاً پردازش شده است.', 'already_processed');
  }
  const rows = await sql(
    `SELECT registration_id AS id, tracking_code, national_code, full_name, phone_number, category, status,
            student_id, approved_by, approved_at, created_at
     FROM registrations WHERE tracking_code = ?`,
    [trackingCode]
  );
  return rows[0];
}

export async function updateEnrollmentReceipt(enrollmentId: number, receiptPath: string) {
  await sqlExec(
    'UPDATE enrollments SET receipt_pdf_path = ? WHERE enrollment_id = ?',
    [receiptPath, enrollmentId]
  );
}
