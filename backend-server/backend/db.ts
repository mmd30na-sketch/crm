import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

// MySQL Connection Config with fallback to localhost defaults
const DB_HOST = process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '';
const DB_NAME = process.env.MYSQL_DATABASE || process.env.DB_NAME || 'carla_crm';

console.log(`[MySQL DB] Connecting to mysql://${DB_USER}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

export const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// National ID Modulo 11 check algorithm
export function isValidNationalId(code: string): boolean {
  if (!code || !/^\d{10}$/.test(code)) return false;
  
  // Check for repeated digits like 1111111111
  if (/^(\d)\1{9}$/.test(code)) return false;
  
  const check = parseInt(code.charAt(9), 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(code.charAt(i), 10) * (10 - i);
  }
  const remainder = sum % 11;
  return (remainder < 2 && check === remainder) || (remainder >= 2 && check === 11 - remainder);
}

// Convert Persian/Arabic digits to English
export function normalizeDigits(str: string): string {
  if (!str) return str;
  return str
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
}

export async function checkExistingRegistration(nationalCode: string): Promise<boolean> {
  try {
    const [rows]: any = await pool.query(
      'SELECT registration_id FROM registrations WHERE national_code = ? AND status = "pending"',
      [nationalCode]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('[MySQL Warning] Failed to check existing registration:', err);
    return false;
  }
}

export async function getUserByUsername(username: string) {
  try {
    const [rows]: any = await pool.query(
      'SELECT user_id, username, full_name, role, password_hash, is_active FROM staff_users WHERE username = ? AND is_active = 1 LIMIT 1',
      [username]
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

export async function insertRegistration(data: {
  trackingCode: string;
  nationalCode: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  fatherName?: string;
  address?: string;
  phoneNumber: string;
  category?: string;
  courseId?: number;
  initialPayment?: number;
  academicDegree?: string;
  militaryStatus?: string;
  hasTempPermit?: boolean;
  nationalCardPath?: string | null;
  personalPhotoPath?: string | null;
  source?: string;
}) {
  const firstName = data.firstName || data.fullName.split(' ')[0] || '';
  const lastName = data.lastName || data.fullName.split(' ').slice(1).join(' ') || '';

  const sql = `
    INSERT INTO registrations (
      tracking_code,
      national_code,
      full_name,
      phone_number,
      category,
      academic_degree,
      military_status,
      has_temp_permit,
      national_card_path,
      personal_photo_path,
      status,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `;

  const values = [
    data.trackingCode,
    data.nationalCode,
    data.fullName,
    data.phoneNumber,
    data.category || null,
    data.academicDegree || null,
    data.militaryStatus || null,
    data.hasTempPermit ? 1 : 0,
    data.nationalCardPath || null,
    data.personalPhotoPath || null,
    data.source || 'website'
  ];

  const [result]: any = await pool.query(sql, values);

  // Automatically sync to students table if not exists
  try {
    const [existingStudent]: any = await pool.query('SELECT student_id FROM students WHERE national_code = ?', [data.nationalCode]);
    let studentId: number;

    if (Array.isArray(existingStudent) && existingStudent.length > 0) {
      studentId = existingStudent[0].student_id;
    } else {
      const [stuRes]: any = await pool.query(
        'INSERT INTO students (first_name, last_name, national_code, phone_number, father_name, address) VALUES (?, ?, ?, ?, ?, ?)',
        [firstName, lastName, data.nationalCode, data.phoneNumber, data.fatherName || null, data.address || null]
      );
      studentId = stuRes.insertId;
    }

    // Link student_id back to registration
    await pool.query('UPDATE registrations SET student_id = ? WHERE tracking_code = ?', [studentId, data.trackingCode]);

    // Create course enrollment subform link if courseId is specified
    if (data.courseId) {
      const [courseRows]: any = await pool.query('SELECT price FROM courses WHERE course_id = ?', [data.courseId]);
      const coursePrice = courseRows && courseRows.length > 0 ? courseRows[0].price : 1200000;
      await pool.query(
        'INSERT INTO enrollments (student_id, course_id, final_price, amount_paid, status) VALUES (?, ?, ?, ?, "active") ON DUPLICATE KEY UPDATE course_id = VALUES(course_id)',
        [studentId, data.courseId, coursePrice, data.initialPayment || 0]
      );
    }

    // If initial payment was made, record in payments table
    if (data.initialPayment && data.initialPayment > 0) {
      await pool.query(
        'INSERT INTO payments (student_id, amount, payment_date, payment_method, tracking_number, notes) VALUES (?, ?, CURRENT_TIMESTAMP, "online", ?, "پیش‌پرداخت اولیه ثبت‌نام")',
        [studentId, data.initialPayment, `PAY-${data.trackingCode}`]
      );
    }
  } catch (syncErr) {
    console.warn('[MySQL Sync Warning] Auto-creating student/enrollment failed:', syncErr);
  }

  return result;
}

export async function getCourses() {
  const [rows] = await pool.query('SELECT * FROM courses WHERE is_active = 1 ORDER BY course_id ASC');
  return rows;
}

export async function getRegistrationByTrackingCode(trackingCode: string) {
  const [rows]: any = await pool.query(
    'SELECT * FROM registrations WHERE tracking_code = ? OR national_code = ? OR phone_number = ?',
    [trackingCode, trackingCode, trackingCode]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function getStudents(filters: { search?: string; category?: string; hasDebt?: boolean }) {
  let sql = `
    SELECT 
      s.student_id,
      s.first_name,
      s.last_name,
      CONCAT(s.first_name, ' ', s.last_name) AS full_name,
      s.national_code,
      s.phone_number,
      s.father_name,
      s.birth_date_jalali,
      s.address,
      s.created_at,
      r.category,
      r.tracking_code,
      r.status AS registration_status,
      COALESCE(SUM(DISTINCT p.amount), 0) AS total_paid,
      COALESCE(e.final_price, 1200000) AS course_fee,
      (COALESCE(e.final_price, 1200000) - COALESCE(SUM(DISTINCT p.amount), 0)) AS remaining_debt
    FROM students s
    LEFT JOIN registrations r ON s.student_id = r.student_id OR s.national_code = r.national_code
    LEFT JOIN enrollments e ON s.student_id = e.student_id
    LEFT JOIN payments p ON s.student_id = p.student_id
    WHERE 1=1
  `;

  const values: any[] = [];

  if (filters.search) {
    sql += ` AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.national_code LIKE ? OR s.phone_number LIKE ?)`;
    const term = `%${filters.search}%`;
    values.push(term, term, term, term);
  }

  if (filters.category) {
    sql += ` AND r.category = ?`;
    values.push(filters.category);
  }

  sql += ` GROUP BY s.student_id, s.first_name, s.last_name, s.national_code, s.phone_number, s.father_name, s.birth_date_jalali, s.address, s.created_at, r.category, r.tracking_code, r.status, e.final_price`;

  if (filters.hasDebt) {
    sql += ` HAVING remaining_debt > 0`;
  }

  sql += ` ORDER BY s.student_id DESC`;

  const [rows] = await pool.query(sql, values);
  return rows;
}

export async function insertPayment(data: { studentId: number; amount: number; paymentMethod?: string; trackingNumber?: string; notes?: string }) {
  const sql = `
    INSERT INTO payments (student_id, amount, payment_date, payment_method, tracking_number, notes)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
  `;
  const [result]: any = await pool.query(sql, [
    data.studentId,
    data.amount,
    data.paymentMethod || 'cash',
    data.trackingNumber || `PAY-${Date.now()}`,
    data.notes || ''
  ]);
  return result;
}

export async function deleteStudentCascading(studentId: number) {
  await pool.query('DELETE FROM payments WHERE student_id = ?', [studentId]);
  await pool.query('DELETE FROM enrollments WHERE student_id = ?', [studentId]);
  await pool.query('DELETE FROM registrations WHERE student_id = ?', [studentId]);
  const [res]: any = await pool.query('DELETE FROM students WHERE student_id = ?', [studentId]);
  return res;
}

export async function getExpenses(search?: string) {
  let sql = 'SELECT * FROM expenses WHERE 1=1';
  const values: any[] = [];
  if (search) {
    sql += ' AND (title LIKE ? OR notes LIKE ?)';
    const term = `%${search}%`;
    values.push(term, term);
  }
  sql += ' ORDER BY expense_id DESC';
  const [rows] = await pool.query(sql, values);
  return rows;
}

export async function insertExpense(data: { title: string; amount: number; expenseDate?: string; notes?: string; category?: string }) {
  const sql = `
    INSERT INTO expenses (title, amount, expense_date, notes, category)
    VALUES (?, ?, ?, ?, ?)
  `;
  const [result]: any = await pool.query(sql, [
    data.title,
    data.amount,
    data.expenseDate || new Date().toISOString().slice(0, 10),
    data.notes || null,
    data.category || 'عمومی'
  ]);
  return result;
}

export async function deleteExpense(expenseId: number) {
  const [result]: any = await pool.query('DELETE FROM expenses WHERE expense_id = ?', [expenseId]);
  return result;
}

export async function getAccountingSummary() {
  const [incomeRows]: any = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total_income FROM payments');
  const [expenseRows]: any = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses');

  const totalIncome = Number(incomeRows[0]?.total_income || 0);
  const totalExpenses = Number(expenseRows[0]?.total_expenses || 0);
  const netProfit = totalIncome - totalExpenses;

  const [recentPayments]: any = await pool.query('SELECT p.*, s.first_name, s.last_name FROM payments p LEFT JOIN students s ON p.student_id = s.student_id ORDER BY p.payment_id DESC LIMIT 10');
  const [recentExpenses]: any = await pool.query('SELECT * FROM expenses ORDER BY expense_id DESC LIMIT 10');

  return {
    totalIncome,
    totalExpenses,
    netProfit,
    recentPayments,
    recentExpenses
  };
}
