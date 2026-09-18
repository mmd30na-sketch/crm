import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  pool,
  isValidNationalId,
  normalizeDigits,
  checkExistingRegistration,
  insertRegistration,
  getCourses,
  getRegistrationByTrackingCode,
  getStudents,
  insertPayment,
  deleteStudentCascading,
  getExpenses,
  insertExpense,
  deleteExpense,
  getAccountingSummary,
  getUserByUsername
} from './db';

dotenv.config();

// ── JWT CONFIG ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'crm_dev_secret_change_in_production';
const JWT_EXPIRES_IN = '8h';

// JWT Auth Middleware
function verifyToken(req: Request, res: Response, next: NextFunction) {
  // Skip auth in development mode if DEV_MODE=true
  if (process.env.DEV_MODE === 'true') return next();

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'دسترسی غیرمجاز: توکن ارسال نشده.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'دسترسی غیرمجاز: توکن نامعتبر یا منقضی شده.' });
  }
}

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());

// ── AUTH ROUTES (Public — no token required) ─────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
    }

    // Verify password — supports real bcrypt hashes and legacy base64
    let passwordMatch = false;
    if (user.password_hash.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, user.password_hash);
    } else {
      // Legacy base64 fallback (migrate on next login)
      const legacy = Buffer.from(password).toString('base64');
      passwordMatch = (legacy === user.password_hash);
      if (passwordMatch) {
        // Auto-upgrade to bcrypt
        const newHash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE staff_users SET password_hash = ? WHERE user_id = ?', [newHash, user.user_id]);
        console.log(`[Auth] Upgraded password hash for user: ${username}`);
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
    }

    const token = jwt.sign(
      { userId: user.user_id, username: user.username, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Update last login
    await pool.query('UPDATE staff_users SET last_login_at = NOW() WHERE user_id = ?', [user.user_id]).catch(() => {});

    res.json({
      success: true,
      token,
      user: { userId: user.user_id, username: user.username, fullName: user.full_name, role: user.role }
    });
  } catch (err: any) {
    console.error('[Auth Login Error]', err);
    res.status(500).json({ error: 'خطا در سرور' });
  }
});

// GET /api/messenger/threads (Fetch real Rubika/SMS threads from DB)
app.get('/api/messenger/threads', async (req: Request, res: Response) => {
  try {
    const [threads]: any = await pool.query('SELECT * FROM messenger_threads ORDER BY updated_at DESC').catch(() => [[]]);
    res.json({ success: true, threads });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت لیست چت‌ها' });
  }
});

// GET /api/messenger/messages (Fetch real message stream from DB)
app.get('/api/messenger/messages', async (req: Request, res: Response) => {
  try {
    const [messages]: any = await pool.query('SELECT * FROM messenger_messages ORDER BY created_at ASC').catch(() => [[]]);
    res.json({ success: true, messages });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت پیام‌ها' });
  }
});

// ── PROTECTED ROUTES — Apply verifyToken to all /api/* below ─────────────────
app.use('/api', verifyToken);

// Uploads directory configuration
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage for uploaded files (national card, personal photo)
const storage = multer.diskStorage({
  destination: (req: any, file: any, cb: any) => {
    const trackingCode = req.trackingCode || 'temp_' + Date.now();
    const dir = path.join(UPLOADS_DIR, 'registrations', trackingCode);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${file.fieldname}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max per file
  fileFilter: (req: any, file: any, cb: any) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('فرمت فایل نامعتبر است. فقط JPG و PNG مجاز می‌باشد.'));
    }
  }
});

// Attach trackingCode to request object before multer saves files
app.use('/api/register', (req: any, res: Response, next) => {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randNum = Math.floor(1000 + Math.random() * 9000);
  req.trackingCode = `TRK-${dateStr}-${randNum}`;
  next();
});

// Serve static uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// === ONLINE OCR ENDPOINT (National Card OCR) ===
app.post('/api/students/ocr/national-card', upload.single('nationalCard'), async (req: any, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'تصویر کارت ملی ارسال نشده است.' });
    }

    // Mock/Demo OCR parsing logic (returns extracted fields)
    // In production, this interfaces with Tesseract / Google GenAI Vision / Iran OCR API
    const sampleNationalCodes = ['3241913562', '3242293908', '3256398073', '3411554238'];
    const extractedCode = sampleNationalCodes[Math.floor(Math.random() * sampleNationalCodes.length)];
    const isValid = isValidNationalId(extractedCode);

    console.log(`[OCR Processing] National card image parsed: ${file.filename}`);

    return res.json({
      success: true,
      first_name: 'علی',
      last_name: 'دلیری',
      national_code: extractedCode,
      birth_date_jalali: '1370/05/12',
      national_code_valid: isValid,
      image_url: `/uploads/registrations/${req.trackingCode || 'temp'}/${file.filename}`
    });
  } catch (err: any) {
    console.error('[OCR Error]', err);
    return res.status(500).json({ error: 'خطا در پردازش تصویر کارت ملی (OCR)' });
  }
});

// === API ROUTES ===

// 1. GET /api/courses
app.get('/api/courses', async (req: Request, res: Response) => {
  try {
    const courses = await getCourses();
    res.json({ success: true, courses });
  } catch (err: any) {
    console.error('[API Courses Error]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست دوره‌ها' });
  }
});

// 2. POST /api/register (Registration Submission)
app.post('/api/register', upload.fields([
  { name: 'nationalCard', maxCount: 1 },
  { name: 'personalPhoto', maxCount: 1 }
]), async (req: any, res: Response) => {
  try {
    const {
      fullName,
      firstName,
      lastName,
      fatherName,
      address,
      nationalId,
      phone,
      category,
      courseId,
      initialPayment,
      academicDegree,
      militaryStatus,
      hasTemporaryPermit
    } = req.body;

    const normalizedNationalId = normalizeDigits(nationalId);
    const normalizedPhone = normalizeDigits(phone);

    const computedFullName = fullName
      ? fullName.trim()
      : `${firstName || ''} ${lastName || ''}`.trim();

    // Backend Validation Checks
    if (!computedFullName || computedFullName.length < 2) {
      return res.status(400).json({ error: 'نام و نام خانوادگی نامعتبر است.' });
    }

    if (!isValidNationalId(normalizedNationalId)) {
      return res.status(400).json({ error: 'کد ملی وارد شده نامعتبر است (رقم کنترلی ناهمخوان).' });
    }

    if (!normalizedPhone || !/^09\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'شماره موبایل نامعتبر است. فرمت صحیح: 09123456789' });
    }

    // Check existing pending registration for same National ID
    const exists = await checkExistingRegistration(normalizedNationalId);
    if (exists) {
      return res.status(400).json({ error: 'یک ثبت‌نام در جریان برای این کد ملی قبلاً ثبت شده است.' });
    }

    const trackingCode = req.trackingCode;

    // File paths
    const files = req.files || {};
    const nationalCardFile = files.nationalCard && files.nationalCard[0];
    const personalPhotoFile = files.personalPhoto && files.personalPhoto[0];

    const nationalCardPath = nationalCardFile
      ? `/uploads/registrations/${trackingCode}/${nationalCardFile.filename}`
      : null;

    const personalPhotoPath = personalPhotoFile
      ? `/uploads/registrations/${trackingCode}/${personalPhotoFile.filename}`
      : null;

    // Save to MySQL
    await insertRegistration({
      trackingCode,
      nationalCode: normalizedNationalId,
      fullName: computedFullName,
      firstName: firstName ? firstName.trim() : undefined,
      lastName: lastName ? lastName.trim() : undefined,
      fatherName: fatherName ? fatherName.trim() : undefined,
      address: address ? address.trim() : undefined,
      phoneNumber: normalizedPhone,
      category,
      courseId: courseId ? Number(courseId) : undefined,
      initialPayment: initialPayment ? Number(initialPayment) : undefined,
      academicDegree,
      militaryStatus,
      hasTempPermit: hasTemporaryPermit === 'true' || hasTemporaryPermit === true,
      nationalCardPath,
      personalPhotoPath,
      source: 'website'
    });

    console.log(`[CRM Registration Success] Created trackingCode: ${trackingCode} for ${computedFullName}`);

    return res.status(201).json({
      success: true,
      message: 'ثبت‌نام شما با موفقیت در سیستم CRM ثبت شد.',
      trackingCode,
      dossier: {
        trackingCode,
        nationalId: normalizedNationalId,
        fullName: fullName.trim(),
        phone: normalizedPhone,
        category,
        registerDate: new Date().toLocaleDateString('fa-IR'),
        nationalCardUploaded: !!nationalCardPath,
        personalPhotoUploaded: !!personalPhotoPath
      }
    });

  } catch (err: any) {
    console.error('[API Register Error]', err);
    return res.status(500).json({
      error: 'خطای سرور در ذخیره‌سازی ثبت‌نام',
      details: err.message
    });
  }
});

// 3. GET /api/track/:query (Track dossier by trackingCode / nationalId / phone)
app.get('/api/track/:query', async (req: Request, res: Response) => {
  try {
    const query = normalizeDigits(String(req.params.query));
    const reg = await getRegistrationByTrackingCode(query);

    if (!reg) {
      return res.status(404).json({ error: 'هیچ پرونده‌ای با این مشخصات یافت نشد.' });
    }

    res.json({
      success: true,
      dossier: {
        trackingCode: reg.tracking_code,
        nationalCode: reg.national_code,
        fullName: reg.full_name,
        phone: reg.phone_number,
        category: reg.category,
        academicDegree: reg.academic_degree,
        status: reg.status,
        hasTempPermit: !!reg.has_temp_permit,
        nationalCardPath: reg.national_card_path,
        personalPhotoPath: reg.personal_photo_path,
        createdAt: reg.created_at
      }
    });
  } catch (err: any) {
    console.error('[API Track Error]', err);
    res.status(500).json({ error: 'خطا در استعلام پیگیری پرونده' });
  }
});

// 4. GET /api/students (List Students with Filtering, Search & Pagination)
app.get('/api/students', async (req: Request, res: Response) => {
  try {
    const { search, category, hasDebt, page, limit } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(5, Number(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const allStudents = await getStudents({
      search: search ? normalizeDigits(String(search)) : undefined,
      category: category ? String(category) : undefined,
      hasDebt: hasDebt === 'true'
    }) as any[];

    const total = allStudents.length;
    const totalPages = Math.ceil(total / limitNum);
    const students = allStudents.slice(offset, offset + limitNum);

    res.json({ success: true, count: total, total, page: pageNum, totalPages, students });
  } catch (err: any) {
    console.error('[API Students Error]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست کارآموزان' });
  }
});

// 5. POST /api/payments (Register Payment)
app.post('/api/payments', async (req: Request, res: Response) => {
  try {
    const { studentId, amount, paymentMethod, trackingNumber, notes } = req.body;
    if (!studentId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'اطلاعات پرداخت و شناسه کارآموز نامعتبر است.' });
    }

    const result = await insertPayment({
      studentId: Number(studentId),
      amount: Number(amount),
      paymentMethod,
      trackingNumber,
      notes
    });

    res.status(201).json({ success: true, message: 'پرداخت با موفقیت ثبت شد.', payment_id: (result as any).insertId });
  } catch (err: any) {
    console.error('[API Payments Error]', err);
    res.status(500).json({ error: 'خطا در ثبت پرداخت' });
  }
});

// 5b. GET /api/payments (List all payments — required by frontend)
app.get('/api/payments', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT p.*, s.first_name, s.last_name
      FROM payments p
      LEFT JOIN students s ON p.student_id = s.student_id
      ORDER BY p.payment_id DESC
      LIMIT 500
    `);
    res.json({ success: true, count: (rows as any[]).length, payments: rows });
  } catch (err: any) {
    console.error('[API Payments List Error]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست پرداخت‌ها' });
  }
});

// 5c. POST /api/students (Create student directly — frontend registration form)
app.post('/api/students', async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, national_code, phone_number, father_name, birth_date_jalali, address } = req.body;
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'نام و نام خانوادگی الزامی است.' });
    }
    // Check if student already exists by national_code
    if (national_code) {
      const [existing]: any = await pool.query('SELECT student_id FROM students WHERE national_code = ?', [national_code]);
      if (Array.isArray(existing) && existing.length > 0) {
        const [stuRows]: any = await pool.query('SELECT * FROM students WHERE student_id = ?', [existing[0].student_id]);
        return res.json({ success: true, status: 'existing', student: stuRows[0] });
      }
    }
    const [result]: any = await pool.query(
      'INSERT INTO students (first_name, last_name, national_code, phone_number, father_name, birth_date_jalali, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [first_name, last_name, national_code || null, phone_number || null, father_name || null, birth_date_jalali || null, address || null]
    );
    const [newStudent]: any = await pool.query('SELECT * FROM students WHERE student_id = ?', [result.insertId]);
    res.status(201).json({ success: true, status: 'created', student: newStudent[0] });
  } catch (err: any) {
    console.error('[API Create Student Error]', err);
    res.status(500).json({ error: 'خطا در ایجاد پرونده کارآموز', details: err.message });
  }
});

// 5d. POST /api/students/:id/photos (Upload student photos)
app.post('/api/students/:id/photos', upload.fields([
  { name: 'idCard', maxCount: 1 },
  { name: 'personal', maxCount: 1 }
]), async (req: any, res: Response) => {
  try {
    const studentId = Number(req.params.id);
    const files = req.files || {};
    const idCardFile    = files.idCard    && files.idCard[0];
    const personalFile  = files.personal  && files.personal[0];
    const updates: string[] = [];
    const vals: any[] = [];
    if (idCardFile) {
      updates.push('national_card_path = ?');
      vals.push(`/uploads/${idCardFile.filename}`);
    }
    if (personalFile) {
      updates.push('personal_photo_path = ?');
      vals.push(`/uploads/${personalFile.filename}`);
    }
    if (updates.length > 0) {
      vals.push(studentId);
      await pool.query(`UPDATE students SET ${updates.join(', ')} WHERE student_id = ?`, vals);
    }
    const [rows]: any = await pool.query('SELECT * FROM students WHERE student_id = ?', [studentId]);
    res.json({ success: true, student: rows[0] || { student_id: studentId } });
  } catch (err: any) {
    console.error('[API Student Photos Error]', err);
    res.status(500).json({ error: 'خطا در آپلود تصاویر' });
  }
});

// 5e. GET /api/enrollments (List enrollments — required by frontend)
app.get('/api/enrollments', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query(
      'SELECT * FROM enrollments ORDER BY enrollment_id DESC LIMIT 500'
    );
    res.json({ success: true, enrollments: rows });
  } catch (err: any) {
    console.error('[API Enrollments List Error]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست ثبت‌نام‌ها' });
  }
});

// 5f. POST /api/enrollments (Create enrollment)
app.post('/api/enrollments', async (req: Request, res: Response) => {
  try {
    const { student_id, course_id, course_number, signup_date_jalali, final_price } = req.body;
    if (!student_id || !course_id) {
      return res.status(400).json({ error: 'شناسه دانشجو و دوره الزامی است.' });
    }
    const [courseRows]: any = await pool.query('SELECT price FROM courses WHERE course_id = ?', [course_id]);
    const coursePrice = courseRows && courseRows.length > 0 ? Number(courseRows[0].price) : (Number(final_price) || 1200000);
    const [result]: any = await pool.query(
      'INSERT INTO enrollments (student_id, course_id, final_price, amount_paid, status) VALUES (?, ?, ?, 0, "active") ON DUPLICATE KEY UPDATE course_id = VALUES(course_id)',
      [student_id, course_id, final_price ?? coursePrice]
    );
    res.status(201).json({ success: true, enrollment_id: result.insertId, id: result.insertId });
  } catch (err: any) {
    console.error('[API Create Enrollment Error]', err);
    res.status(500).json({ error: 'خطا در ثبت دوره', details: err.message });
  }
});

// 5g. GET /api/enrollments/:id/report-context
app.get('/api/enrollments/:id/report-context', async (req: Request, res: Response) => {
  try {
    const enrollmentId = Number(req.params.id);
    const [envRows]: any = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = ?', [enrollmentId]);
    if (!envRows || envRows.length === 0) {
      return res.status(404).json({ error: 'ثبت‌نام یافت نشد.' });
    }
    const enrollment = envRows[0];
    const [stuRows]: any = await pool.query('SELECT * FROM students WHERE student_id = ?', [enrollment.student_id]);
    const [crsRows]: any = await pool.query('SELECT * FROM courses WHERE course_id = ?', [enrollment.course_id]);
    const [payRows]: any = await pool.query('SELECT * FROM payments WHERE student_id = ?', [enrollment.student_id]);
    const [settingRows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings').catch(() => [[]]);
    const settings: Record<string, string> = {};
    (settingRows as any[]).forEach((r: any) => { settings[r.key] = r.value; });
    res.json({
      enrollment,
      student: stuRows[0] || null,
      course:  crsRows[0] || null,
      payments: payRows,
      settings: {
        academy_name: settings.academy_name || 'آموزشگاه رانندگی کارلا',
        logo_url:     settings.logo_url || '',
        phone_number: settings.phone_number || '',
        address:      settings.address || '',
        header_text:  settings.header_text || '',
        footer_text:  settings.footer_text || '',
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[API Enrollment Report Context Error]', err);
    res.status(500).json({ error: 'خطا در دریافت اطلاعات رسید' });
  }
});

// 5h. POST /api/enrollments/:id/receipt (Upload PDF receipt)
app.post('/api/enrollments/:id/receipt', upload.single('pdf'), async (req: any, res: Response) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'فایل PDF ارسال نشده است.' });
    const pdfPath = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE enrollments SET receipt_pdf_path = ? WHERE enrollment_id = ?', [pdfPath, enrollmentId]).catch(() => {});
    res.json({ success: true, receipt_pdf_path: pdfPath });
  } catch (err: any) {
    console.error('[API Receipt Upload Error]', err);
    res.status(500).json({ error: 'خطا در آپلود رسید' });
  }
});

// ─────────────────────────────────────────────────────────
// 5i. RUBIKA & SMS.IR GATEWAYS INTEGRATION MODULE
// ─────────────────────────────────────────────────────────

// Helper: Send SMS via sms.ir API v1
async function sendSmsIr(opts: { apiKey: string; lineNumber?: string; mobile: string; messageText: string }): Promise<any> {
  const https = require('https');
  const payload = JSON.stringify({
    lineNumber: opts.lineNumber || '30000000',
    messageText: opts.messageText,
    mobiles: [opts.mobile]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.sms.ir',
      path: '/v1/send/bulk',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': opts.apiKey,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('sms.ir API Timeout')); });
    req.write(payload);
    req.end();
  });
}

// Helper: Send Message via Rubika Bot API
async function sendRubikaMessage(opts: { botToken: string; chatId: string; text: string }): Promise<any> {
  const https = require('https');
  const payload = JSON.stringify({
    chat_id: opts.chatId,
    text: opts.text
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'botapi.rubika.ir',
      path: `/${opts.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Rubika API Timeout')); });
    req.write(payload);
    req.end();
  });
}

// GET /api/settings/gateways
app.get('/api/settings/gateways', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings WHERE `key` LIKE "gateway_%" OR `key` LIKE "rubika_%" OR `key` LIKE "sms_%"').catch(() => [[]]);
    const settings: Record<string, string> = {};
    (rows as any[]).forEach((r: any) => { settings[r.key] = r.value; });
    res.json({
      success: true,
      data: {
        sms_provider: settings.sms_provider || 'sms.ir',
        sms_api_key: settings.sms_api_key || '',
        sms_sender_line: settings.sms_sender_line || '',
        sms_auto_register: settings.sms_auto_register !== 'false',
        rubika_bot_token: settings.rubika_bot_token || '',
        rubika_channel_id: settings.rubika_channel_id || '',
        rubika_active: settings.rubika_active !== 'false'
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت تنظیمات درگاه‌ها' });
  }
});

// POST /api/settings/gateways
app.post('/api/settings/gateways', async (req: Request, res: Response) => {
  try {
    const { sms_provider, sms_api_key, sms_sender_line, sms_auto_register, rubika_bot_token, rubika_channel_id, rubika_active } = req.body;
    const items = [
      { key: 'sms_provider', value: sms_provider || 'sms.ir' },
      { key: 'sms_api_key', value: sms_api_key || '' },
      { key: 'sms_sender_line', value: sms_sender_line || '' },
      { key: 'sms_auto_register', value: String(sms_auto_register !== false) },
      { key: 'rubika_bot_token', value: rubika_bot_token || '' },
      { key: 'rubika_channel_id', value: rubika_channel_id || '' },
      { key: 'rubika_active', value: String(rubika_active !== false) }
    ];

    for (const item of items) {
      await pool.query(
        'INSERT INTO academy_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [item.key, item.value]
      ).catch(() => {});
    }

    res.json({ success: true, message: 'تنظیمات درگاه‌های پیامکی و روبیکا ذخیره شد.' });
  } catch (err: any) {
    console.error('[Save Gateways Error]', err);
    res.status(500).json({ error: 'خطا در ذخیره تنظیمات درگاه‌ها' });
  }
});

// GET /api/messenger/threads (Fetch real Rubika/SMS threads from DB)
app.get('/api/messenger/threads', async (req: Request, res: Response) => {
  try {
    const [threads]: any = await pool.query('SELECT * FROM messenger_threads ORDER BY updated_at DESC').catch(() => [[]]);
    res.json({ success: true, threads });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت لیست چت‌ها' });
  }
});

// GET /api/messenger/messages (Fetch real message stream from DB)
app.get('/api/messenger/messages', async (req: Request, res: Response) => {
  try {
    const [messages]: any = await pool.query('SELECT * FROM messenger_messages ORDER BY created_at ASC').catch(() => [[]]);
    res.json({ success: true, messages });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت پیام‌ها' });
  }
});

// POST /api/messenger/send (Send SMS or Rubika message live)
app.post('/api/messenger/send', async (req: Request, res: Response) => {
  try {
    const { channel, recipient, messageText, templateTitle } = req.body;
    if (!recipient || !messageText) {
      return res.status(400).json({ error: 'گیرنده و متن پیام الزامی است.' });
    }

    // Load saved config
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings').catch(() => [[]]);
    const cfg: Record<string, string> = {};
    (rows as any[]).forEach((r: any) => { cfg[r.key] = r.value; });

    let result: any = null;

    if (channel === 'rubika') {
      const token = cfg.rubika_bot_token;
      if (!token) return res.status(400).json({ error: 'توکن ربات روبیکا در تنظیمات ثبت نشده است.' });
      result = await sendRubikaMessage({ botToken: token, chatId: recipient, text: messageText });
    } else {
      // Default: SMS.ir / IPPanel
      const apiKey = cfg.sms_api_key;
      const senderLine = cfg.sms_sender_line;
      if (!apiKey) {
        // Fallback simulation mode if API key not entered yet
        result = { success: true, mode: 'simulated', message: 'پیامک در حالت شبیه‌سازی ارسال شد (کلید API ثبت نشده است).' };
      } else {
        result = await sendSmsIr({ apiKey, lineNumber: senderLine, mobile: recipient, messageText });
      }
    }

    // Log to DB messenger_outbox
    await pool.query(
      'INSERT INTO messenger_outbox (recipient, channel, message_text, status, result_json) VALUES (?, ?, ?, "sent", ?)',
      [recipient, channel || 'sms', messageText, JSON.stringify(result)]
    ).catch(() => {});

    res.json({ success: true, channel: channel || 'sms', result });
  } catch (err: any) {
    console.error('[Send Messenger Error]', err);
    res.status(500).json({ error: 'خطا در ارسال پیام', details: err.message });
  }
});

// 6. DELETE /api/students/:id (Cascading Delete Student)
app.delete('/api/students/:id', async (req: Request, res: Response) => {
  try {
    const studentId = Number(req.params.id);
    if (!studentId || isNaN(studentId)) {
      return res.status(400).json({ error: 'شناسه کارآموز نامعتبر است.' });
    }

    await deleteStudentCascading(studentId);
    res.json({ success: true, message: 'پرونده کارآموز با موفقیت حذف گردید.' });
  } catch (err: any) {
    console.error('[API Delete Student Error]', err);
    res.status(500).json({ error: 'خطا در حذف پرونده کارآموز' });
  }
});

// 7. GET /api/expenses (List Expenses)
app.get('/api/expenses', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const expenses = await getExpenses(search ? String(search) : undefined);
    res.json({ success: true, count: (expenses as any[]).length, expenses });
  } catch (err: any) {
    console.error('[API Expenses Error]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست هزینه‌ها' });
  }
});

// 8. POST /api/expenses (Create Expense)
app.post('/api/expenses', async (req: Request, res: Response) => {
  try {
    const { title, amount, expenseDate, notes, category } = req.body;
    if (!title || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'عنوان و مبلغ هزینه الزامی است.' });
    }

    await insertExpense({
      title: title.trim(),
      amount: Number(amount),
      expenseDate,
      notes,
      category
    });

    res.status(201).json({ success: true, message: 'هزینه جدید با موفقیت ثبت شد.' });
  } catch (err: any) {
    console.error('[API Create Expense Error]', err);
    res.status(500).json({ error: 'خطا در ثبت هزینه جدید' });
  }
});

// 9. DELETE /api/expenses/:id (Delete Expense)
app.delete('/api/expenses/:id', async (req: Request, res: Response) => {
  try {
    const expenseId = Number(req.params.id);
    if (!expenseId || isNaN(expenseId)) {
      return res.status(400).json({ error: 'شناسه هزینه نامعتبر است.' });
    }

    await deleteExpense(expenseId);
    res.json({ success: true, message: 'هزینه با موفقیت حذف گردید.' });
  } catch (err: any) {
    console.error('[API Delete Expense Error]', err);
    res.status(500).json({ error: 'خطا در حذف هزینه' });
  }
});

// 10. GET /api/accounting/summary (Financial Balance & Net Profit)
app.get('/api/accounting/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getAccountingSummary();
    res.json({ success: true, summary });
  } catch (err: any) {
    console.error('[API Accounting Summary Error]', err);
    res.status(500).json({ error: 'خطا در دریافت خلاصه حسابداری' });
  }
});

// 11. GET /api/financial/summary (Full dashboard data for AccountingDashboard.tsx)
app.get('/api/financial/summary', async (req: Request, res: Response) => {
  try {
    // Base totals
    const [incomeRows]: any = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total_income FROM payments');
    const [expenseRows]: any = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses');
    const totalIncome = Number(incomeRows[0]?.total_income || 0);
    const totalExpenses = Number(expenseRows[0]?.total_expenses || 0);
    const netProfit = totalIncome - totalExpenses;

    // Categories (from expense_categories table if exists, else synthetic)
    let categories: any[] = [];
    try {
      const [catRows]: any = await pool.query('SELECT category_id, code, title, description FROM expense_categories ORDER BY category_id ASC');
      categories = catRows as any[];
    } catch {
      categories = [{ category_id: 1, code: 'GEN', title: 'عمومی', description: '' }];
    }

    // Accounts (from financial_accounts table if exists, else synthetic)
    let accounts: any[] = [];
    try {
      const [accRows]: any = await pool.query('SELECT account_id, title, bank_name, initial_balance FROM financial_accounts ORDER BY account_id ASC');
      accounts = accRows as any[];
    } catch {
      accounts = [{ account_id: 1, title: 'صندوق نقدی', bank_name: 'نقد', initial_balance: 0 }];
    }

    // Expenses by category
    let byCategory: any[] = [];
    try {
      const [byCatRows]: any = await pool.query(`
        SELECT 
          COALESCE(e.category, 'عمومی') AS category_title,
          'GEN' AS category_code,
          1 AS category_id,
          COUNT(*) AS total_expense_count,
          COALESCE(SUM(e.amount), 0) AS total_expense_amount
        FROM expenses e
        GROUP BY e.category
        ORDER BY total_expense_amount DESC
      `);
      byCategory = byCatRows as any[];
    } catch { byCategory = []; }

    // Monthly P&L (last 6 months, by payment month)
    let monthlyPL: any[] = [];
    try {
      const [monthRows]: any = await pool.query(`
        SELECT
          DATE_FORMAT(payment_date, '%Y-%m') AS jalali_month,
          COALESCE(SUM(amount), 0) AS total_income,
          0 AS total_expenses,
          COALESCE(SUM(amount), 0) AS net_profit
        FROM payments
        WHERE payment_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
        ORDER BY jalali_month ASC
      `);
      monthlyPL = monthRows as any[];
    } catch { monthlyPL = []; }

    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpenses,
        netProfit,
        categories,
        accounts,
        byCategory,
        monthlyPL
      }
    });
  } catch (err: any) {
    console.error('[API Financial Summary Error]', err);
    res.status(500).json({ error: 'خطا در دریافت اطلاعات مالی' });
  }
});

// ── SETTINGS ROUTES ─────────────────────────────────────────────────────────

// GET /api/settings/academy
app.get('/api/settings/academy', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings');
    const data: Record<string, string> = {};
    (rows as any[]).forEach((r: any) => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: {} });
  }
});

// PUT /api/settings/academy
app.put('/api/settings/academy', async (req: Request, res: Response) => {
  try {
    const entries = Object.entries(req.body) as [string, string][];
    for (const [key, value] of entries) {
      await pool.query(
        'INSERT INTO academy_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
        [key, value, value]
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/courses
app.get('/api/settings/courses', async (req: Request, res: Response) => {
  try {
    const [courses] = await pool.query('SELECT * FROM courses ORDER BY course_id ASC');
    res.json({ success: true, courses });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/courses
app.post('/api/settings/courses', async (req: Request, res: Response) => {
  try {
    const { title, price, capacity, duration_days } = req.body;
    if (!title || price == null) return res.status(400).json({ error: 'عنوان و شهریه الزامی است' });
    await pool.query(
      'INSERT INTO courses (title, price, capacity, duration_days) VALUES (?, ?, ?, ?)',
      [title, Number(price), capacity || null, duration_days || null]
    );
    res.status(201).json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/courses/:id
app.put('/api/settings/courses/:id', async (req: Request, res: Response) => {
  try {
    const { title, price, capacity, duration_days, is_active } = req.body;
    await pool.query(
      'UPDATE courses SET title=?, price=?, capacity=?, duration_days=?, is_active=? WHERE course_id=?',
      [title, Number(price), capacity || null, duration_days || null, is_active ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/financial
app.get('/api/settings/financial', async (req: Request, res: Response) => {
  try {
    const keys = ['default_course_fee', 'currency_unit', 'payment_methods'];
    const [rows]: any = await pool.query(
      'SELECT `key`, `value` FROM academy_settings WHERE `key` IN (?)',
      [keys]
    );
    const data: Record<string, string> = { default_course_fee: '1200000', currency_unit: 'تومان', payment_methods: 'نقدی,کارتخوان,کارت به کارت,چک' };
    (rows as any[]).forEach((r: any) => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: { default_course_fee: '1200000', currency_unit: 'تومان', payment_methods: 'نقدی,کارتخوان' } });
  }
});

// PUT /api/settings/financial
app.put('/api/settings/financial', async (req: Request, res: Response) => {
  try {
    const entries = Object.entries(req.body) as [string, string][];
    for (const [key, value] of entries) {
      await pool.query(
        'INSERT INTO academy_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
        [key, String(value), String(value)]
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/users
app.get('/api/settings/users', async (req: Request, res: Response) => {
  try {
    const [users] = await pool.query(
      'SELECT user_id, username, full_name, role, is_active, last_login_at, created_at FROM staff_users ORDER BY user_id ASC'
    );
    res.json({ success: true, users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/users
app.post('/api/settings/users', async (req: Request, res: Response) => {
  try {
    const { username, full_name, password, role } = req.body;
    if (!username || !full_name || !password) return res.status(400).json({ error: 'اطلاعات ناقص است' });
    // Simple bcrypt-like hash placeholder — replace with real bcrypt in production
    const bcrypt = await import('bcryptjs').catch(() => null);
    const hash = bcrypt ? await bcrypt.hash(password, 10) : Buffer.from(password).toString('base64');
    await pool.query(
      'INSERT INTO staff_users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, full_name, hash, role || 'operator']
    );
    res.status(201).json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/users/:id
app.put('/api/settings/users/:id', async (req: Request, res: Response) => {
  try {
    const { is_active, role } = req.body;
    await pool.query(
      'UPDATE staff_users SET is_active=?, role=COALESCE(?,role) WHERE user_id=?',
      [is_active ? 1 : 0, role || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/export/students  (CSV)
app.get('/api/settings/export/students', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT s.student_id, s.first_name, s.last_name, s.national_code, s.phone_number, s.address,
        COALESCE(SUM(p.amount),0) AS total_paid, s.created_at
      FROM students s
      LEFT JOIN payments p ON p.student_id = s.student_id
      GROUP BY s.student_id
      ORDER BY s.student_id DESC
    `);
    const headers = ['شناسه', 'نام', 'نام خانوادگی', 'کد ملی', 'موبایل', 'آدرس', 'جمع پرداختی', 'تاریخ ثبت'];
    const csv = [
      headers.join(','),
      ...(rows as any[]).map((r: any) =>
        [r.student_id, r.first_name, r.last_name, r.national_code, r.phone_number,
          `"${(r.address || '').replace(/"/g, '""')}"`, r.total_paid,
          new Date(r.created_at).toLocaleDateString('fa-IR')
        ].join(',')
      )
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=students_export.csv`);
    res.send('\uFEFF' + csv); // BOM for Excel RTL
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/export/backup  (SQL dump placeholder)
app.get('/api/settings/export/backup', async (req: Request, res: Response) => {
  try {
    const tables = ['students', 'courses', 'enrollments', 'payments', 'expenses', 'registrations'];
    let sql = `-- CRM Backup — ${new Date().toISOString()}\nSET NAMES utf8mb4;\n\n`;
    for (const table of tables) {
      const [rows]: any = await pool.query(`SELECT * FROM ${table}`);
      if ((rows as any[]).length === 0) continue;
      sql += `-- TABLE: ${table}\n`;
      for (const row of rows as any[]) {
        const cols = Object.keys(row).join(', ');
        const vals = Object.values(row).map(v =>
          v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
        ).join(', ');
        sql += `INSERT INTO ${table} (${cols}) VALUES (${vals});\n`;
      }
      sql += '\n';
    }
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', 'attachment; filename=crm_backup.sql');
    res.send(sql);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/security
app.get('/api/settings/security', async (req: Request, res: Response) => {
  try {
    const keys = ['session_timeout_minutes', 'max_login_attempts'];
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings WHERE `key` IN (?)', [keys]);
    const data: Record<string, string> = { session_timeout_minutes: '60', max_login_attempts: '5' };
    (rows as any[]).forEach((r: any) => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch { res.json({ success: true, data: { session_timeout_minutes: '60', max_login_attempts: '5' } }); }
});

// PUT /api/settings/security
app.put('/api/settings/security', async (req: Request, res: Response) => {
  try {
    for (const [key, value] of Object.entries(req.body) as [string, string][]) {
      await pool.query('INSERT INTO academy_settings (`key`,`value`) VALUES(?,?) ON DUPLICATE KEY UPDATE `value`=?', [key, String(value), String(value)]);
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/security/logs
app.get('/api/settings/security/logs', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query('SELECT user_id, username, full_name, role, last_login_at FROM staff_users WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 20');
    res.json({ success: true, logs: rows });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/security/change-password
app.post('/api/settings/security/change-password', async (req: Request, res: Response) => {
  try {
    const { user_id, old_password, new_password } = req.body;
    if (!user_id || !old_password || !new_password) return res.status(400).json({ error: 'اطلاعات ناقص است' });
    const [rows]: any = await pool.query('SELECT password_hash FROM staff_users WHERE user_id=?', [user_id]);
    if (!rows.length) return res.status(404).json({ error: 'کاربر یافت نشد' });
    const bcrypt = await import('bcryptjs').catch(() => null);
    const valid = bcrypt ? await bcrypt.compare(old_password, rows[0].password_hash) : true;
    if (!valid) return res.status(401).json({ error: 'رمز عبور فعلی اشتباه است' });
    const hash = bcrypt ? await bcrypt.hash(new_password, 10) : Buffer.from(new_password).toString('base64');
    await pool.query('UPDATE staff_users SET password_hash=? WHERE user_id=?', [hash, user_id]);
    res.json({ success: true, message: 'رمز عبور با موفقیت تغییر کرد' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/messages
app.get('/api/settings/messages', async (req: Request, res: Response) => {
  try {
    const keys = ['sms_registration_confirm', 'sms_payment_receipt', 'sms_course_reminder'];
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings WHERE `key` IN (?)', [keys]);
    const data: Record<string, string> = {
      sms_registration_confirm: 'هنرجوی گرامی {نام}، ثبت‌نام شما در دوره {دوره} با کد پیگیری {کد_پیگیری} ثبت شد.',
      sms_payment_receipt: 'هنرجوی گرامی {نام}، مبلغ {مبلغ} تومان دریافت شد. موجودی حساب شما به‌روز شد.',
      sms_course_reminder: 'یادآوری: دوره {دوره} فردا شروع می‌شود. {نام} عزیز لطفاً ساعت ۸ حاضر باشید.'
    };
    (rows as any[]).forEach((r: any) => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch { res.json({ success: true, data: {} }); }
});

// PUT /api/settings/messages
app.put('/api/settings/messages', async (req: Request, res: Response) => {
  try {
    for (const [key, value] of Object.entries(req.body) as [string, string][]) {
      await pool.query('INSERT INTO academy_settings (`key`,`value`) VALUES(?,?) ON DUPLICATE KEY UPDATE `value`=?', [key, String(value), String(value)]);
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/certificate
app.get('/api/settings/certificate', async (req: Request, res: Response) => {
  try {
    const keys = ['certificate_header', 'certificate_footer', 'certificate_signature_title'];
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings WHERE `key` IN (?)', [keys]);
    const data: Record<string, string> = {
      certificate_header: 'گواهینامه پایان دوره آموزشی',
      certificate_footer: 'این گواهینامه بر اساس مصوبات سازمان فنی و حرفه‌ای صادر گردیده است.',
      certificate_signature_title: 'مدیر آموزشگاه'
    };
    (rows as any[]).forEach((r: any) => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch { res.json({ success: true, data: {} }); }
});

// PUT /api/settings/certificate
app.put('/api/settings/certificate', async (req: Request, res: Response) => {
  try {
    for (const [key, value] of Object.entries(req.body) as [string, string][]) {
      await pool.query('INSERT INTO academy_settings (`key`,`value`) VALUES(?,?) ON DUPLICATE KEY UPDATE `value`=?', [key, String(value), String(value)]);
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/alerts
app.get('/api/settings/alerts', async (req: Request, res: Response) => {
  try {
    const keys = ['alert_debt_threshold', 'alert_new_registration', 'alert_capacity_threshold'];
    const [rows]: any = await pool.query('SELECT `key`, `value` FROM academy_settings WHERE `key` IN (?)', [keys]);
    const data: Record<string, string> = { alert_debt_threshold: '500000', alert_new_registration: 'true', alert_capacity_threshold: '80' };
    (rows as any[]).forEach((r: any) => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch { res.json({ success: true, data: { alert_debt_threshold: '500000', alert_new_registration: 'true', alert_capacity_threshold: '80' } }); }
});

// PUT /api/settings/alerts
app.put('/api/settings/alerts', async (req: Request, res: Response) => {
  try {
    for (const [key, value] of Object.entries(req.body) as [string, string][]) {
      await pool.query('INSERT INTO academy_settings (`key`,`value`) VALUES(?,?) ON DUPLICATE KEY UPDATE `value`=?', [key, String(value), String(value)]);
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'online', service: 'CRM Express Backend', time: new Date().toISOString() });
});

app.listen(PORT, HOST, () => {
  console.log(`[CRM Express Backend] Server started on http://${HOST}:${PORT}`);
});
