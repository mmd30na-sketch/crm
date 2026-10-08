import express from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as chabokan from './mysql-socks';

dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env


// ─────────────────────────────────────────────────────────────
// RUBIKA INTEGRATION (USER ACCOUNT / SELF-BOT & BOT API)
// ─────────────────────────────────────────────────────────────
const RUBIKA_BOT_TOKEN = process.env.RUBIKA_BOT_TOKEN || '';

// 2. Send via Official Bot API
function sendRubikaMessage(chatId: string, text: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const botToken = getGateways().rubika_bot_token;
    if (!botToken) {
      return reject(new Error('RUBIKA_BOT_TOKEN تنظیم نشده است.'));
    }
    const body = JSON.stringify({ chat_id: chatId, text });
    const options = {
      hostname: 'botapi.rubika.ir',
      port: 443,
      path: `/v3/${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const app = express();
app.disable('x-powered-by');
// Behind nginx/Cloudflare: use the real client IP for rate limiting.
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);

// Set up storage directory for uploads
// Set up StudentFiles storage directory structure matching MS Access logic
const studentFilesBase = path.join(process.cwd(), 'StudentFiles');
if (!fs.existsSync(studentFilesBase)) {
  fs.mkdirSync(studentFilesBase, { recursive: true });
}

function safeSegment(value: unknown, fallback: string) {
  const raw = String(value || fallback).trim() || fallback;
  const clean = raw.replace(/[^؀-ۿa-zA-Z0-9._-]+/g, '_').slice(0, 80);
  // '.' / '..' would climb out of StudentFiles when used as a directory name.
  return !clean || /^\.+$/.test(clean) ? fallback : clean;
}

function publicPathFromFile(file: Express.Multer.File) {
  const rel = path.relative(process.cwd(), path.resolve(file.path)).split(path.sep).join('/');
  return `/${rel}`;
}

const studentPhotoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const courseNum = safeSegment(req.body.course_number, 'unsorted');
    const studentId = safeSegment(req.params.id || req.body.student_id, String(Date.now()));
    const lastName = safeSegment(req.body.last_name, 'student');
    const targetDir = path.join(studentFilesBase, courseNum, `${lastName}_${studentId}`);
    fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const lastName = safeSegment(req.body.last_name, 'Student');
    const studentId = safeSegment(req.params.id || req.body.student_id, String(Date.now()));
    const isIdCard = file.fieldname === 'idCard' || file.fieldname === 'id_card_photo';
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${lastName}_${studentId}_${isIdCard ? 'ID' : 'Photo'}${ext}`);
  },
});
class UploadError extends Error {
  status = 400;
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
function imageFileFilter(_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || !String(file.mimetype).startsWith('image/')) {
    return cb(new UploadError('فقط تصویر با فرمت JPG، PNG یا WEBP مجاز است.'));
  }
  cb(null, true);
}
function pdfFileFilter(_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext !== '.pdf' || file.mimetype !== 'application/pdf') {
    return cb(new UploadError('فقط فایل PDF مجاز است.'));
  }
  cb(null, true);
}
function removeUploadedFiles(files: Express.Multer.File | Express.Multer.File[] | { [field: string]: Express.Multer.File[] } | undefined) {
  if (!files) return;
  const list = Array.isArray(files) ? files : 'path' in files ? [files as Express.Multer.File] : Object.values(files).flat();
  for (const f of list) fs.unlink(f.path, () => {});
}

/** Deletes a stored file given its public path (e.g. /StudentFiles/...), only when it resolves inside `baseDir`. */
function unlinkStoredFile(publicPath: unknown, baseDir: string) {
  if (typeof publicPath !== 'string' || !publicPath) return;
  let rel = publicPath.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch { return; }
  const abs = path.resolve(process.cwd(), rel.replace(/^\/+/, ''));
  if (!abs.startsWith(baseDir + path.sep)) return;
  fs.unlink(abs, () => {
    // Drop the per-student folder when it is now empty (no-op otherwise).
    const dir = path.dirname(abs);
    if (dir !== baseDir && dir.startsWith(baseDir + path.sep)) fs.rmdir(dir, () => {});
  });
}
/** Removes a deleted student's photos/scans and the receipt PDFs of their enrollments. */
function removeStudentFiles(student: any, enrollments: any[]) {
  for (const key of ['id_card_photo_url', 'personal_photo_url', 'national_card_path', 'personal_photo_path']) {
    unlinkStoredFile(student?.[key], studentFilesBase);
  }
  for (const e of enrollments) unlinkStoredFile(e?.receipt_pdf_path, uploadsDir);
}

const uploadStudentMedia = multer({
  storage: studentPhotoStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
});

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const uploadsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
// OCR scans (images) and receipt PDFs share the same storage but not the same rules.
const upload = multer({ storage: uploadsStorage, fileFilter: imageFileFilter, limits: { fileSize: 8 * 1024 * 1024, files: 2 } });
const uploadReceipt = multer({ storage: uploadsStorage, fileFilter: pdfFileFilter, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
// Student documents (national card, photos) are personal data: staff login required.
app.use('/StudentFiles', (req, res, next) => requireStaff(req, res, next), express.static(studentFilesBase));

// Database File Path
const DB_PATH = path.join(process.cwd(), 'db_store.json');

// Database Schema interfaces for TypeScript type safety
interface Course {
  id: number;
  title: string;
  code: string;
  tuition: number;
  duration_weeks: number;
  active: boolean;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  father_name?: string;
  national_code: string;
  phone_number: string;
  birth_date_jalali?: string;
  address?: string;
  id_card_photo_url?: string;
  personal_photo_url?: string;
  status: 'active' | 'suspended' | 'graduated';
  created_at: string;
}

interface Enrollment {
  id: number;
  student_id: number;
  course_id: number;
  course_number?: number;
  signup_date_jalali: string;
  final_price: number;
  receipt_pdf_path?: string;
}

interface Payment {
  id: number;
  student_id: number;
  enrollment_id?: number | null;
  amount: number;
  pay_date_jalali: string;
  pay_method: string;
  payment_kind: string;
  description?: string;
}

interface Expense {
  id: number;
  title: string;
  amount: number;
  pay_method: string;
  pay_date_jalali: string;
  description?: string;
}


interface StaffUserRecord {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: 'admin' | 'cashier' | 'instructor';
  is_active: boolean;
  created_at: string;
}

interface ReportTemplate {
  key: string;
  title: string;
  category: string;
  active: boolean;
  body?: string;
}

interface DatabaseSchema {
  settings: {
    academy_name: string;
    logo_url?: string;
    phone_number: string;
    address: string;
    header_text?: string;
    footer_text?: string;
    admin_password_hash?: string;
  };
  courses: Course[];
  students: Student[];
  enrollments: Enrollment[];
  payments: Payment[];
  expenses: Expense[];
  reportTemplates: ReportTemplate[];
  staff_users: StaffUserRecord[];
}

// Initial Seed Data
const initialDb: DatabaseSchema = {
  settings: {
    academy_name: 'آموزشگاه رانندگی کارلا (Carla)',
    logo_url: '',
    phone_number: '',
    address: '',
    header_text: 'رسید رسمی ثبت‌نام کارآموز - سیستم جامع مدیریت رانندگی کارلا',
    footer_text: 'خواهشمند است جهت هماهنگی کلاس‌ها و آزمون‌ها ۲۴ ساعت قبل با آموزشگاه تماس بگیرید.',
  },
  courses: [
    { id: 1, title: 'آموزش رانندگی گواهینامه پایه سوم', code: 'C3-DRIVE', tuition: 4500000, duration_weeks: 10, active: true },
    { id: 2, title: 'آموزش موتور سیکلت (پایه الف)', code: 'MOTO-A', tuition: 2200000, duration_weeks: 6, active: true },
    { id: 3, title: 'آموزش رانندگی گواهینامه پایه دوم', code: 'C2-HEAVY', tuition: 6800000, duration_weeks: 12, active: true },
    { id: 4, title: 'آموزش رانندگی گواهینامه پایه یک (ترانزیت)', code: 'C1-TRAILER', tuition: 9500000, duration_weeks: 16, active: true },
  ],
  students: [
    {
      id: 1,
      first_name: 'امیرحسین',
      last_name: 'رضایی',
      father_name: 'علیرضا',
      national_code: '0012345678',
      phone_number: '09123456789',
      birth_date_jalali: '1378/04/15',
      address: 'تهران، محله ونک، خیابان ملاصدرا، کوچه شیراز، پلاک ۱۲',
      status: 'active',
      created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 2,
      first_name: 'سارا',
      last_name: 'احمدی',
      father_name: 'حمید',
      national_code: '0459876543',
      phone_number: '09198765432',
      birth_date_jalali: '1382/10/22',
      address: 'تهران، شهرک غرب، بلوار پاکنژاد، کوچه مریم، پلاک ۵',
      status: 'active',
      created_at: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 3,
      first_name: 'محمدرضا',
      last_name: 'کریمی',
      father_name: 'محمد',
      national_code: '2991234567',
      phone_number: '09355551122',
      birth_date_jalali: '1375/01/01',
      address: 'تهران، تهرانپارس، خیابان رشید، نبش ۱۵۴، پلاک ۸',
      status: 'suspended',
      created_at: new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString(),
    }
  ],
  enrollments: [
    { id: 1, student_id: 1, course_id: 1, course_number: 104, signup_date_jalali: '1405/04/20', final_price: 4500000 },
    { id: 2, student_id: 2, course_id: 2, course_number: 88, signup_date_jalali: '1405/05/05', final_price: 2000000 }, // 200,000 discount
    { id: 3, student_id: 3, course_id: 3, course_number: 32, signup_date_jalali: '1405/04/01', final_price: 6800000 },
  ],
  payments: [
    { id: 1, student_id: 1, enrollment_id: 1, amount: 2500000, pay_date_jalali: '1405/04/20', pay_method: 'pos', payment_kind: 'downpayment', description: 'کارتخوان رفاه - پیش‌پرداخت ثبت‌نام اولیه' },
    { id: 2, student_id: 1, enrollment_id: 1, amount: 2000000, pay_date_jalali: '1405/05/10', pay_method: 'card_transfer', payment_kind: 'full', description: 'انتقال کارت به کارت - تسویه حساب کامل گواهینامه رانندگی' },
    { id: 3, student_id: 2, enrollment_id: 2, amount: 1200000, pay_date_jalali: '1405/05/05', pay_method: 'cash', payment_kind: 'downpayment', description: 'پرداخت نقدی - پیش‌پرداخت دوره موتور' },
    { id: 4, student_id: 3, enrollment_id: 3, amount: 3000000, pay_date_jalali: '1405/04/01', pay_method: 'pos', payment_kind: 'downpayment', description: 'بانک ملی - قسط اول ثبت‌نام سنگین' },
  ],
  expenses: [
    { id: 1, title: 'خرید لوازم مصرفی و نوشت‌افزار اداری', amount: 850000, pay_method: 'کارت بانکی آموزشگاه', pay_date_jalali: '1405/05/01', description: 'خرید از فروشگاه فدک شامل کاغذ آ۴ و زونکن' },
    { id: 2, title: 'هزینه تعمیر و تعویض لنت ترمز خودروی آموزشی پراید', amount: 1450000, pay_method: 'کارت بانکی آموزشگاه', pay_date_jalali: '1405/05/12', description: 'تعمیرگاه مرکزی سایپا - خودروی شماره ۴' },
    { id: 3, title: 'هزینه شارژ اینترنت و قبوض تلفن آموزشگاه', amount: 620000, pay_method: 'بانکداری اینترنتی', pay_date_jalali: '1405/05/15', description: 'قبوض تلفن ثابت و شارژ اینترنت فیبر نوری شاتل' },
  ],
  reportTemplates: [
    { key: 'standard_receipt', title: 'فیش پرداخت رسمی کارآموز (A5)', category: 'receipt', active: true, body: '<div class="receipt-print">...</div>' },
    { key: 'standard_contract', title: 'قرارداد رسمی آموزش رانندگی', category: 'contract', active: true, body: '<div class="contract-print">...</div>' },
  ],
  staff_users: [],
};

// Helper function to read/write DB
function parseDbFile(file: string): typeof initialDb {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.staff_users)) parsed.staff_users = [];
  return parsed;
}

let corruptCopySaved = false;
function readDb(): typeof initialDb {
  if (!fs.existsSync(DB_PATH)) return initialDb;
  try {
    return parseDbFile(DB_PATH);
  } catch (err) {
    console.error('db_store.json is unreadable:', err);
    if (!corruptCopySaved) {
      corruptCopySaved = true;
      try { fs.copyFileSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`); } catch {}
    }
    // Never fall back to the demo data: it would overwrite the real records on the next write.
    try {
      if (fs.existsSync(`${DB_PATH}.bak`)) {
        console.warn('Using db_store.json.bak');
        return parseDbFile(`${DB_PATH}.bak`);
      }
    } catch {}
    throw new Error('فایل پایگاه‌داده محلی (db_store.json) خراب است؛ برای جلوگیری از از دست رفتن اطلاعات عملیات متوقف شد.');
  }
}

/** Atomic write (temp file + rename) that keeps the previous version as .bak. Throws on failure. */
function writeDb(data: typeof initialDb) {
  const tmp = `${DB_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(DB_PATH)) {
    try { fs.copyFileSync(DB_PATH, `${DB_PATH}.bak`); } catch {}
  }
  fs.renameSync(tmp, DB_PATH);
}

// Seed if not exists
if (!fs.existsSync(DB_PATH)) {
  writeDb(initialDb);
}


app.use(express.json({ limit: '2mb' }));

const ALLOWED_ORIGINS = [
  'https://mmd30na-sketch.github.io',
  'https://crm.mmd30na.cloud',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
];

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-crm-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > 180) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
});

/** Settings safe to send to the browser (no password hash, no gateway keys). */
const publicSettings = (settings: any) => {
  const { admin_password_hash, gateways, ...rest } = settings || {};
  return rest;
};

function sanitizeString(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function loadTokenSecret() {
  if (process.env.CRM_JWT_SECRET) return process.env.CRM_JWT_SECRET;
  const secretPath = path.join(process.cwd(), '.crm-jwt-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {}
  const generated = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(secretPath, generated, { mode: 0o600 }); } catch {}
  return generated;
}
const TOKEN_SECRET = loadTokenSecret();
const loginBuckets = new Map<string, { count: number; resetAt: number }>();
// Failed logins per username (lower-cased): a guessed password is throttled even when the IP changes.
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const map of [rateBuckets, loginBuckets, failedLogins]) {
    for (const [key, b] of map) if (now > b.resetAt) map.delete(key);
  }
}, 60_000).unref();

function signToken(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): any | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function readBearer(req: express.Request): string | null {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  // ?token= is only for <img>/<a> file loads (they cannot send headers); the API needs the header.
  if (!/^\/(uploads|StudentFiles)(\/|$)/i.test(req.originalUrl.split('?')[0])) return null;
  const q = String((req.query as any)?.token || '');
  return q || null;
}

/** Valid token -> session. Local staff are re-checked against the store so deactivation and role changes apply at once. */
function sessionFromRequest(req: express.Request): any | null {
  const token = readBearer(req);
  const session = token ? verifyToken(token) : null;
  if (!session) return null;
  if (session.source === 'local') {
    try {
      const staff = readDb().staff_users.find((s) => s.id === session.user_id);
      if (!staff || !staff.is_active) return null;
      return { ...session, username: staff.username, role: staff.role };
    } catch {
      return null;
    }
  }
  return session;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  (req as any).user = session;
  next();
}

/** Any signed-in staff role. Used for uploaded files, which <img>/<a> load with ?token=. */
function requireStaff(req: express.Request, res: express.Response, next: express.NextFunction) {
  requireAuth(req, res, () => {
    if (!currentRole(req)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
}

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = loginBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) loginBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
  else {
    bucket.count += 1;
    if (bucket.count > 10) return res.status(429).json({ error: 'Too many login attempts' });
  }

  const username = sanitizeString(req.body?.username, 80);
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const userKey = username.toLowerCase();
  const failed = failedLogins.get(userKey);
  if (failed && now <= failed.resetAt && failed.count >= MAX_FAILED_LOGINS) {
    return res.status(429).json({ error: 'Too many failed attempts, try again later' });
  }

  try {
    const envUser = process.env.CRM_ADMIN_USER || 'admin';
    const envPass = process.env.CRM_ADMIN_PASSWORD || '';
    if (username === envUser) {
      const adminHash = readDb().settings?.admin_password_hash;
      const envOk = !!envPass && password === envPass;
      const hashOk = adminHash ? await bcrypt.compare(password, String(adminHash)) : false;
      if (hashOk || (!adminHash && envOk)) {
        failedLogins.delete(userKey);
        const token = signToken({ username: envUser, role: 'admin', source: 'env' });
        return res.json({ token, user: { username: envUser, role: 'admin', full_name: 'مدیر سیستم' } });
      }
    }

    const localStaff = readDb().staff_users.find(
      (s) => s.username.toLowerCase() === username.toLowerCase()
    );
    if (localStaff && localStaff.is_active && localStaff.password_hash) {
      const ok = await bcrypt.compare(password, String(localStaff.password_hash));
      if (ok) {
        failedLogins.delete(userKey);
        const token = signToken({
          username: localStaff.username,
          role: localStaff.role,
          user_id: localStaff.id,
          source: 'local',
        });
        return res.json({
          token,
          user: { username: localStaff.username, role: localStaff.role, full_name: localStaff.full_name },
        });
      }
    }

    if (chabokan.isMysqlEnabled()) {
      const staff = await chabokan.findStaffByUsername(username);
      if (staff && staff.is_active && staff.password_hash) {
        const ok = await bcrypt.compare(password, String(staff.password_hash));
        if (ok) {
          failedLogins.delete(userKey);
          const token = signToken({ username: staff.username, role: staff.role, user_id: staff.user_id });
          return res.json({ token, user: { username: staff.username, role: staff.role } });
        }
      }
    }
    if (!failed || now > failed.resetAt) failedLogins.set(userKey, { count: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS });
    else failed.count += 1;
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: (req as any).user || null, db: chabokan.isMysqlEnabled() ? 'chabokan-mysql' : 'json' });
});

app.post('/api/auth/logout', (_req, res) => res.json({ success: true }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: chabokan.isMysqlEnabled() ? 'chabokan-mysql' : 'json-file' });
});

const STAFF_ROLES = ['admin', 'cashier', 'instructor'] as const;
type StaffRole = typeof STAFF_ROLES[number];

function currentRole(req: express.Request): StaffRole | null {
  const role = String((req as any).user?.role || '');
  return (STAFF_ROLES as readonly string[]).includes(role) ? role as StaffRole : null;
}

function canAccessApi(role: StaffRole, method: string, rawPath: string): boolean {
  if (role === 'admin') return true;
  const path = rawPath.toLowerCase(); // Express routing ignores case, so the checks must too
  const write = method !== 'GET' && method !== 'HEAD';
  if (path.startsWith('/staff') || path.startsWith('/settings') || path.startsWith('/imports')) return false;
  if (path.startsWith('/courses') && write) return false;
  if (path.startsWith('/receipt-settings') && write) return false;
  if (path.startsWith('/payments') || path.startsWith('/expenses')) return role === 'cashier';
  if (path.startsWith('/ocr')) return role === 'cashier';
  if (path.includes('report-templates') || path.includes('report-context') || path.includes('/receipt')) return role === 'cashier';
  if (path.startsWith('/registrations')) return role === 'cashier';
  if (path.startsWith('/students') || path.startsWith('/enrollments')) {
    if (write) return role === 'cashier';
    return true;
  }
  if (path.startsWith('/messenger')) return role === 'cashier';
  if (path.startsWith('/courses') || path.startsWith('/health')) return !write;
  if (!write) return role === 'cashier';
  return false;
}

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  if (req.path === '/health') return next();
  if (req.path === '/messenger/webhook') return next();
  if (req.method === 'OPTIONS') return next();
  return requireAuth(req, res, next);
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path === '/health' || req.path === '/messenger/webhook' || req.method === 'OPTIONS') return next();
  const role = currentRole(req);
  if (!role) return res.status(401).json({ error: 'Unauthorized' });
  if (!canAccessApi(role, req.method, req.path)) return res.status(403).json({ error: 'Forbidden' });
  next();
});

function envAdminUsername() {
  return sanitizeString(process.env.CRM_ADMIN_USER || 'admin', 80) || 'admin';
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  (req as any).user = session;
  next();
}

function publicStaffUser(u: StaffUserRecord) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    is_active: !!u.is_active,
    source: 'local' as const,
    locked: false,
    created_at: u.created_at,
  };
}

function envAdminPublic() {
  return {
    id: 0,
    username: envAdminUsername(),
    full_name: 'مدیر سیستم',
    role: 'admin' as const,
    is_active: true,
    source: 'env' as const,
    locked: true,
  };
}

function nextStaffId(users: StaffUserRecord[]) {
  return users.length > 0 ? Math.max(...users.map((u) => u.id)) + 1 : 1;
}

app.get('/api/staff', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ users: [envAdminPublic(), ...db.staff_users.map(publicStaffUser)] });
});

app.post('/api/staff', requireAdmin, async (req, res) => {
  try {
    const username = sanitizeString(req.body?.username, 80).toLowerCase();
    const full_name = sanitizeString(req.body?.full_name, 80);
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'cashier') as StaffRole;
    const is_active = req.body?.is_active !== false;
    if (!username || !full_name) return res.status(400).json({ error: 'نام و نام کاربری الزامی است' });
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return res.status(400).json({ error: 'نام کاربری باید ۳ تا ۳۲ کاراکتر لاتین باشد' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر باشد' });
    if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'نقش نامعتبر است' });
    if (username === envAdminUsername().toLowerCase()) {
      return res.status(409).json({ error: 'این نام کاربری سیستمی است' });
    }
    const db = readDb();
    if (db.staff_users.some((s) => s.username.toLowerCase() === username)) {
      return res.status(409).json({ error: 'نام کاربری تکراری است' });
    }
    const record: StaffUserRecord = {
      id: nextStaffId(db.staff_users),
      username,
      password_hash: await bcrypt.hash(password, 10),
      full_name,
      role,
      is_active,
      created_at: new Date().toISOString(),
    };
    db.staff_users.push(record);
    writeDb(db);
    res.json({ status: 'success', user: publicStaffUser(record) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff/:id', requireAdmin, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });
    const staffId = parseInt(req.params.id, 10);
    const body = req.body || {};
    if (staffId === 0) {
      const password = String(body.password || '');
      if (password.length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر باشد' });
      const db = readDb();
      db.settings = db.settings || ({} as typeof db.settings);
      db.settings.admin_password_hash = await bcrypt.hash(password, 10);
      writeDb(db);
      return res.json({ status: 'success', user: envAdminPublic() });
    }
    const db = readDb();
    const index = db.staff_users.findIndex((s) => s.id === staffId);
    if (index === -1) return res.status(404).json({ error: 'کاربر یافت نشد' });
    const current = db.staff_users[index];
    const full_name = body.full_name !== undefined ? sanitizeString(body.full_name, 80) : current.full_name;
    if (!full_name) return res.status(400).json({ error: 'نام الزامی است' });
    let role = current.role;
    if (body.role !== undefined) {
      if (!STAFF_ROLES.includes(body.role)) return res.status(400).json({ error: 'نقش نامعتبر است' });
      role = body.role;
    }
    const is_active = body.is_active !== undefined ? !!body.is_active : current.is_active;
    let password_hash = current.password_hash;
    if (body.password) {
      if (String(body.password).length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر باشد' });
      password_hash = await bcrypt.hash(String(body.password), 10);
    }
    db.staff_users[index] = { ...current, full_name, role, is_active, password_hash };
    writeDb(db);
    res.json({ status: 'success', user: publicStaffUser(db.staff_users[index]) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve uploads statically
// Receipt PDFs and scans in uploads/ are financial/personal documents: admin and cashier only.
app.use('/uploads', requireStaff, (req, res, next) => {
  const role = currentRole(req);
  if (role !== 'admin' && role !== 'cashier') return res.status(403).json({ error: 'Forbidden' });
  next();
}, express.static(uploadsDir));

// Initialize Gemini API
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        // Optional relay/proxy endpoint for servers that cannot reach Google directly.
        ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log('Gemini API initialized successfully.');
  } catch (e) {
    console.error('Failed to initialize Gemini API:', e);
  }
}

// ------------------- MESSENGER & ACCESS IMPORT ENDPOINTS -------------------

// ── Rubika Webhook: دریافت پیام‌های ورودی و ثبت chat_id هر کاربر ──
const MAX_STORED_MESSAGES = 2000;
function webhookAuthorized(req: express.Request): boolean {
  const secret = process.env.MESSENGER_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const given = Buffer.from(String(req.headers['x-webhook-secret'] || ''));
  const expected = Buffer.from(secret);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

app.post('/api/messenger/webhook', (req, res) => {
  // Fail closed: without MESSENGER_WEBHOOK_SECRET the endpoint is disabled.
  if (!process.env.MESSENGER_WEBHOOK_SECRET) return res.status(403).json({ error: 'Webhook is not configured' });
  if (!webhookAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { sender, message, channel, chat_id, sender_phone } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });

  const db = readDb();
  if (!(db as any).messages) (db as any).messages = [];

  // The chat_id <-> student link decides who receives that student's messages, so it is only
  // accepted from a caller that knows the shared secret (MESSENGER_WEBHOOK_SECRET).
  if (channel === 'rubika' && chat_id && sender_phone) {
    const phone = String(sender_phone).replace(/^\+98/, '0');
    const student = db.students.find((s: any) =>
      String(s.phone_number || '').replace(/^\+98/, '0') === phone
    );
    if (student) {
      (student as any).rubika_chat_id = String(chat_id).slice(0, 100);
      console.log(`[Rubika] chat_id ذخیره شد برای ${student.first_name} ${student.last_name}`);
    }
  }

  const messages = (db as any).messages as any[];
  messages.push({
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    sender: sanitizeString(sender, 100),
    channel: sanitizeString(channel, 20) || 'rubika',
    chat_id: sanitizeString(chat_id, 100),
    sender_phone: sanitizeString(sender_phone, 20),
    message: sanitizeString(message, 2000),
    received_at: new Date().toISOString(),
  });
  if (messages.length > MAX_STORED_MESSAGES) messages.splice(0, messages.length - MAX_STORED_MESSAGES);
  writeDb(db);

  res.json({ success: true, status: 'RECEIVED_AND_STORED' });
});

// ── GET: دریافت پیام‌های ورودی ──
app.get('/api/messenger/messages', (req, res) => {
  const db = readDb();
  res.json({ success: true, messages: (db as any).messages || [] });
});

// ── Gateway settings (stored on the server; secrets are never sent back to the browser) ──
type Gateways = {
  sms_provider: string; sms_api_key: string; sms_sender_line: string;
  sms_auto_register: boolean; sms_auto_exam: boolean;
  rubika_bot_token: string; rubika_channel_id: string; rubika_active: boolean;
};
function getGateways(): Gateways {
  let g: any = {};
  try { g = (readDb().settings as any)?.gateways || {}; } catch { /* unreadable DB: fall back to env */ }
  return {
    sms_provider: g.sms_provider || process.env.SMS_PROVIDER || 'ippanel',
    sms_api_key: g.sms_api_key || process.env.SMS_API_KEY || '',
    sms_sender_line: g.sms_sender_line || process.env.SMS_SENDER_LINE || '',
    sms_auto_register: g.sms_auto_register !== false,
    sms_auto_exam: g.sms_auto_exam !== false,
    rubika_bot_token: g.rubika_bot_token || RUBIKA_BOT_TOKEN,
    rubika_channel_id: g.rubika_channel_id || '',
    rubika_active: g.rubika_active !== false,
  };
}

const normalizeMobile = (v: unknown) => toLatinDigits(String(v ?? '')).replace(/[\s-]/g, '').replace(/^\+98/, '0').replace(/^98(?=9\d{9}$)/, '0');

/** Sends one SMS through the configured provider (sms.ir or IPPanel). */
async function sendSmsMessage(mobile: string, text: string): Promise<{ ok: boolean; status: 'sent' | 'not_configured' | 'failed'; detail?: string }> {
  const g = getGateways();
  if (!g.sms_api_key || !g.sms_sender_line) {
    return { ok: false, status: 'not_configured', detail: 'درگاه پیامک تنظیم نشده است (کلید API و شماره خط را در تنظیمات وارد کنید).' };
  }
  try {
    if (g.sms_provider === 'smsir') {
      const r = await fetch('https://api.sms.ir/v1/send/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': g.sms_api_key },
        body: JSON.stringify({ lineNumber: Number(g.sms_sender_line), messageText: text, mobiles: [mobile] }),
        signal: AbortSignal.timeout(15000),
      });
      const data: any = await r.json().catch(() => ({}));
      return data?.status === 1 ? { ok: true, status: 'sent' } : { ok: false, status: 'failed', detail: data?.message || `HTTP ${r.status}` };
    }
    // IPPanel (edge API)
    const r = await fetch('https://edge.ippanel.com/v1/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: g.sms_api_key },
      body: JSON.stringify({
        sending_type: 'webservice',
        from_number: g.sms_sender_line.startsWith('+') ? g.sms_sender_line : `+98${g.sms_sender_line.replace(/^0/, '')}`,
        message: text,
        params: { recipients: [`+98${mobile.slice(1)}`] },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await r.json().catch(() => ({}));
    return data?.meta?.status === true || r.ok && data?.meta?.status !== false
      ? { ok: true, status: 'sent' }
      : { ok: false, status: 'failed', detail: data?.meta?.message || `HTTP ${r.status}` };
  } catch (err: any) {
    return { ok: false, status: 'failed', detail: err?.name === 'TimeoutError' ? 'پاسخی از سرویس پیامک نرسید.' : (err?.message || 'خطا در اتصال به سرویس پیامک') };
  }
}

/** Delivers a message and stores it (outbox + chat history). The DB is re-read after the network call. */
async function deliverMessage(opts: { channel: string; recipient: string; message: string; studentId?: unknown }) {
  const { channel, message } = opts;
  const phone = normalizeMobile(opts.recipient);
  let status: string; let note = '';
  let chatId: string | null = null;

  if (channel === 'rubika') {
    const snapshot = readDb();
    const student = opts.studentId
      ? snapshot.students.find((s: any) => String(s.id) === String(opts.studentId))
      : snapshot.students.find((s: any) => normalizeMobile(s.phone_number) === phone);
    chatId = (student as any)?.rubika_chat_id || null;
    if (!getGateways().rubika_bot_token) { status = 'not_configured'; note = 'توکن ربات روبیکا تنظیم نشده است.'; }
    else if (!chatId) { status = 'awaiting_user_init'; note = 'کارآموز هنوز /start نزده؛ پیام در صف ماند.'; }
    else {
      try {
        const r = await sendRubikaMessage(chatId, message);
        status = r?.ok || r?.status === 'OK' ? 'sent' : 'failed';
        if (status === 'failed') note = 'ربات روبیکا پیام را نپذیرفت.';
      } catch (err: any) { status = 'failed'; note = err.message; }
    }
  } else {
    const r = await sendSmsMessage(phone, message);
    status = r.status; note = r.detail || '';
  }

  const db = readDb(); // fresh copy: other requests may have written while we were waiting on the network
  const now = Date.now();
  const messageId = now * 1000 + Math.floor(Math.random() * 1000);
  const outbox = ((db as any).outbox ||= []) as any[];
  outbox.push({ id: `MSG-${now}`, recipient: phone, channel, message, student_id: opts.studentId, sent_at: new Date(now).toISOString(), status, note });
  if (outbox.length > MAX_STORED_MESSAGES) outbox.splice(0, outbox.length - MAX_STORED_MESSAGES);
  const messages = ((db as any).messages ||= []) as any[];
  messages.push({ id: messageId, sender: 'admin', channel, sender_phone: phone, message, status, received_at: new Date(now).toISOString() });
  if (messages.length > MAX_STORED_MESSAGES) messages.splice(0, messages.length - MAX_STORED_MESSAGES);
  writeDb(db);
  return { status, note, messageId, trackingId: `MSG-${now}` };
}

// ── POST: ارسال پیام از طریق روبیکا یا پیامک ──
app.post('/api/messenger/send', async (req, res) => {
  const channel = sanitizeString(req.body?.channel, 20) || 'sms';
  const message = sanitizeString(req.body?.message ?? req.body?.messageText, 1000);
  const phone = normalizeMobile(req.body?.recipient);
  if (!phone || !message) return res.status(400).json({ error: 'گیرنده و متن پیام الزامی است.' });
  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'شماره موبایل گیرنده معتبر نیست.' });
  try {
    const r = await deliverMessage({ channel, recipient: phone, message, studentId: req.body?.student_id });
    const labels: Record<string, string> = {
      sent: 'پیام ارسال شد.',
      awaiting_user_init: 'کارآموز هنوز /start نزده؛ پیام در صف ماند.',
      not_configured: r.note || 'درگاه ارسال تنظیم نشده است.',
      failed: `ارسال ناموفق بود${r.note ? `: ${r.note}` : '.'}`,
    };
    res.json({ success: r.status === 'sent', status: r.status, tracking_id: r.trackingId, message_id: r.messageId, message: labels[r.status] || r.status });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Access Database Trigger Endpoint
app.post('/api/imports/access', (req, res) => {
  try {
    const db = readDb();
    res.json({ success: true, count: db.students.length, message: `داده‌های دیتابیس با موفقیت همگام‌سازی شدند.` });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در همگام‌سازی دیتابیس', details: err.message });
  }
});

// ------------------- API ROUTES -------------------

// 1. GET active courses
// ─────────────────────────────────────────────────────────────
// INPUT VALIDATION HELPERS (students / enrollments / payments)
// ─────────────────────────────────────────────────────────────
function toLatinDigits(v: string): string {
  return v
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** "۱۴۰۵/۷/۱۶" or "1405-7-16" -> "1405/07/16" (Latin digits, zero padded). */
function normalizeJalaliDate(v: unknown): string {
  const s = toLatinDigits(String(v ?? '')).trim();
  const m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : s;
}
function jalaliNow(): string {
  return normalizeJalaliDate(new Date().toLocaleDateString('fa-IR'));
}
const coursePrice = (c: any): number => Number(c?.price ?? c?.tuition ?? 0);
/** MySQL returns 0/1 (not false/true) for the active flag. */
const courseIsActive = (c: any): boolean => {
  const v = c?.is_active ?? c?.active;
  return !(v === false || v === 0 || v === '0');
};

function isValidIranNationalCode(code: string): boolean {
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const sum = d.slice(0, 9).reduce((acc, x, i) => acc + x * (10 - i), 0);
  const r = sum % 11;
  return r < 2 ? d[9] === r : d[9] === 11 - r;
}

type StudentFields = {
  first_name?: string; last_name?: string; national_code?: string; phone_number?: string;
  father_name?: string; birth_date_jalali?: string; address?: string;
};

/** Cleans and validates student input. `partial` (updates) only checks fields that were sent. */
function parseStudentInput(body: any, partial: boolean): { data: StudentFields; error?: string } {
  const b = body && typeof body === 'object' ? body : {};
  const data: StudentFields = {};
  const sent = (k: string) => b[k] !== undefined && b[k] !== null && String(b[k]).trim() !== '';

  for (const [key, label] of [['first_name', 'نام'], ['last_name', 'نام خانوادگی']] as const) {
    if (sent(key)) data[key] = sanitizeString(b[key], 80);
    else if (!partial) return { data, error: `${label} الزامی است.` };
  }
  if (sent('national_code')) {
    const code = toLatinDigits(sanitizeString(b.national_code, 20)).replace(/[\s-]/g, '');
    if (!isValidIranNationalCode(code)) return { data, error: 'کد ملی معتبر نیست.' };
    data.national_code = code;
  } else if (!partial) return { data, error: 'کد ملی الزامی است.' };
  if (sent('phone_number')) {
    const phone = toLatinDigits(sanitizeString(b.phone_number, 20)).replace(/[\s-]/g, '');
    if (!/^09\d{9}$/.test(phone)) return { data, error: 'شماره همراه باید ۱۱ رقم و با ۰۹ شروع شود.' };
    data.phone_number = phone;
  } else if (!partial) return { data, error: 'شماره همراه الزامی است.' };
  // Optional fields: an explicitly sent empty value clears the field.
  const present = (k: string) => b[k] !== undefined && b[k] !== null;
  if (present('father_name')) data.father_name = sanitizeString(b.father_name, 80);
  if (present('birth_date_jalali')) data.birth_date_jalali = sanitizeString(b.birth_date_jalali, 20);
  if (present('address')) data.address = sanitizeString(b.address, 400);
  return { data };
}

async function loadStudents(): Promise<any[]> {
  return chabokan.isMysqlEnabled() ? chabokan.listStudents() : readDb().students;
}
async function loadCourses(): Promise<any[]> {
  return chabokan.isMysqlEnabled() ? chabokan.listCourses() : readDb().courses;
}
async function loadEnrollments(): Promise<any[]> {
  return chabokan.isMysqlEnabled() ? chabokan.listEnrollments() : readDb().enrollments;
}
const enrollmentId = (e: any): number => Number(e.enrollment_id ?? e.id);

/** Outstanding tuition for a student (optionally limited to one enrollment). */
async function remainingBalance(studentId: number, forEnrollmentId?: number | null): Promise<number> {
  if (chabokan.isMysqlEnabled()) {
    const row = (await chabokan.listStudents()).find((s: any) => Number(s.id) === studentId);
    const studentRemaining = Math.max(0, Number(row?.remaining_debt ?? 0));
    if (!forEnrollmentId) return studentRemaining;
    const enr = (await chabokan.listEnrollments()).find((e: any) => enrollmentId(e) === forEnrollmentId);
    return Math.max(0, Math.min(studentRemaining, Number(enr?.remaining_debt ?? 0)));
  }
  const db = readDb();
  const enrollments = db.enrollments.filter(e => e.student_id === studentId);
  const payments = db.payments.filter(p => p.student_id === studentId);
  const studentRemaining = enrollments.reduce((a, e) => a + (e.final_price || 0), 0) - payments.reduce((a, p) => a + p.amount, 0);
  if (!forEnrollmentId) return Math.max(0, studentRemaining);
  const enr = enrollments.find(e => e.id === forEnrollmentId);
  const enrRemaining = (enr?.final_price || 0) - payments.filter(p => p.enrollment_id === forEnrollmentId).reduce((a, p) => a + p.amount, 0);
  return Math.max(0, Math.min(studentRemaining, enrRemaining));
}

app.get('/api/courses', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listCourses());
    res.json(readDb().courses);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 2. Add / Update course
/** Whitelists and validates course input. `partial` (updates) only checks fields that were sent. */
function parseCourseInput(body: any, partial: boolean): { data: { title?: string; code?: string; price?: number; duration_days?: number; is_active?: boolean }; error?: string } {
  const b = body && typeof body === 'object' ? body : {};
  const data: { title?: string; code?: string; price?: number; duration_days?: number; is_active?: boolean } = {};
  const sent = (v: unknown) => v !== undefined && v !== null && v !== '';

  if (sent(b.title)) {
    const title = sanitizeString(b.title, 120);
    if (!title) return { data, error: 'عنوان دوره الزامی است.' };
    data.title = title;
  } else if (!partial) return { data, error: 'عنوان دوره الزامی است.' };

  if (sent(b.code)) data.code = sanitizeString(b.code, 40);

  const rawPrice = sent(b.price) ? b.price : b.tuition;
  if (sent(rawPrice)) {
    const price = typeof rawPrice === 'number' || typeof rawPrice === 'string' ? Number(rawPrice) : NaN;
    if (!Number.isFinite(price) || price < 0 || price > 1e12) return { data, error: 'شهریه نامعتبر است.' };
    data.price = Math.round(price);
  } else if (!partial) data.price = 0;

  const rawDays = sent(b.duration_days) ? b.duration_days : (sent(b.duration_weeks) ? Number(b.duration_weeks) * 7 : undefined);
  if (sent(rawDays)) {
    const days = typeof rawDays === 'number' || typeof rawDays === 'string' ? Number(rawDays) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 3650) return { data, error: 'مدت دوره نامعتبر است.' };
    data.duration_days = days;
  } else if (!partial) data.duration_days = 56;

  const rawActive = b.is_active ?? b.active;
  if (sent(rawActive)) {
    if (![true, false, 1, 0, '1', '0', 'true', 'false'].includes(rawActive)) return { data, error: 'وضعیت دوره نامعتبر است.' };
    data.is_active = rawActive === true || rawActive === 1 || rawActive === '1' || rawActive === 'true';
  } else if (!partial) data.is_active = true;
  return { data };
}

app.post('/api/courses', async (req, res) => {
  try {
    const { data, error } = parseCourseInput(req.body, false);
    if (error) return res.status(400).json({ error });
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.insertCourse(data));
    const db = readDb();
    const newCourse = {
      id: db.courses.length > 0 ? Math.max(...db.courses.map(c => c.id)) + 1 : 1,
      title: data.title!,
      code: data.code || data.title!.slice(0, 8).replace(/\s/g, '-').toUpperCase(),
      tuition: data.price!,
      duration_weeks: Math.ceil(data.duration_days! / 7),
      active: data.is_active!,
    };
    db.courses.push(newCourse);
    writeDb(db);
    res.json(newCourse);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data, error } = parseCourseInput(req.body, true);
    if (error) return res.status(400).json({ error });
    if (chabokan.isMysqlEnabled()) {
      // updateCourse writes every column, so start from the stored course and apply only what was sent.
      const current = (await loadCourses()).find(c => Number(c.id) === id);
      if (!current) return res.status(404).json({ error: 'Course not found' });
      const row = await chabokan.updateCourse(id, {
        title: current.title, price: coursePrice(current), duration_days: Number(current.duration_weeks || 8) * 7, is_active: courseIsActive(current),
        ...data,
      });
      if (!row) return res.status(404).json({ error: 'Course not found' });
      return res.json(row);
    }
    const db = readDb();
    const index = db.courses.findIndex(c => c.id === id);
    if (index !== -1) {
      // Older records may carry price/duration_days/is_active; fold them into the canonical fields.
      const { price: _p, duration_days: _d, is_active: _a, ...cur } = db.courses[index] as any;
      const legacy = db.courses[index] as any;
      db.courses[index] = {
        ...cur,
        title: data.title ?? cur.title,
        code: data.code ?? cur.code,
        tuition: data.price ?? coursePrice(legacy),
        duration_weeks: data.duration_days !== undefined ? Math.ceil(data.duration_days / 7) : (cur.duration_weeks ?? Math.ceil(Number(legacy.duration_days || 56) / 7)),
        active: data.is_active ?? courseIsActive(legacy),
        id,
      };
      writeDb(db);
      res.json(db.courses[index]);
    } else {
      res.status(404).json({ error: 'Course not found' });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 3. GET/POST students
app.get('/api/students', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listStudents());
    res.json(readDb().students);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/students', async (req, res) => {
  try {
    const { data, error } = parseStudentInput(req.body, false);
    if (error) return res.status(400).json({ error });

    // Same national code = same person (e.g. a second course): reuse the existing record.
    const existing = (await loadStudents()).find(s => String(s.national_code) === data.national_code);
    if (existing) return res.json({ status: 'success', already_exists: true, student: existing });

    if (chabokan.isMysqlEnabled()) {
      const student = await chabokan.insertStudent({ ...req.body, ...data });
      return res.json({ status: 'success', student });
    }
    const db = readDb();
    const newStudent: Student = {
      id: db.students.length > 0 ? Math.max(...db.students.map(s => s.id)) + 1 : 1,
      first_name: data.first_name!,
      last_name: data.last_name!,
      father_name: data.father_name || '',
      national_code: data.national_code!,
      phone_number: data.phone_number!,
      birth_date_jalali: data.birth_date_jalali || '',
      address: data.address || '',
      status: 'active',
      created_at: new Date().toISOString(),
    };
    db.students.push(newStudent);
    writeDb(db);
    res.json({ status: 'success', student: newStudent });
  } catch (err: any) { res.status(err.status || 500).json({ error: err.message }); }
});


app.put('/api/students/:id', async (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const { data, error } = parseStudentInput(req.body, true);
    if (error) return res.status(400).json({ error });
    if (data.national_code) {
      const clash = (await loadStudents()).find(s => String(s.national_code) === data.national_code && Number(s.id) !== studentId);
      if (clash) return res.status(409).json({ error: 'کارآموز دیگری با این کد ملی ثبت شده است.' });
    }
    if (chabokan.isMysqlEnabled()) {
      // updateStudent writes every column, so start from the stored record and apply only what was sent.
      const current = (await loadStudents()).find(s => Number(s.id) === studentId);
      if (!current) return res.status(404).json({ error: 'Student not found' });
      const student = await chabokan.updateStudent(studentId, {
        first_name: current.first_name, last_name: current.last_name, national_code: current.national_code,
        phone_number: current.phone_number, address: current.address, father_name: current.father_name,
        birth_date_jalali: current.birth_date_jalali,
        ...data,
      });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      return res.json({ status: 'success', student });
    }
    const body = req.body || {};
    const hasStatus = body.status !== undefined && body.status !== null && body.status !== '';
    if (hasStatus && !['active', 'suspended', 'graduated'].includes(body.status)) {
      return res.status(400).json({ error: 'وضعیت کارآموز نامعتبر است.' });
    }
    const db = readDb();
    const index = db.students.findIndex(s => s.id === studentId);
    if (index === -1) return res.status(404).json({ error: 'Student not found' });
    db.students[index] = {
      ...db.students[index],
      ...data,
      status: hasStatus ? body.status : db.students[index].status,
    };
    writeDb(db);
    res.json({ status: 'success', student: db.students[index] });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 4. CASCADE DELETE student
app.delete('/api/students/:id', async (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || !(await loadStudents()).some(s => Number(s.id) === studentId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    if (chabokan.isMysqlEnabled()) {
      // Read the file paths first: the rows are gone after the delete.
      const student = (await loadStudents()).find(s => Number(s.id) === studentId);
      const enrollments = (await loadEnrollments()).filter(e => Number(e.student_id) === studentId);
      await chabokan.deleteStudent(studentId);
      removeStudentFiles(student, enrollments);
      return res.json({ success: true });
    }
    const db = readDb();
    const student = db.students.find(s => s.id === studentId) as any;
    const enrollments = db.enrollments.filter(e => e.student_id === studentId);
    db.students = db.students.filter(s => s.id !== studentId);
    db.enrollments = db.enrollments.filter(e => e.student_id !== studentId);
    db.payments = db.payments.filter(p => p.student_id !== studentId);
    // Chat history and outbox entries belong to the student too (matched by id, phone or Rubika chat).
    const phone = normalizeMobile(student?.phone_number);
    const chatId = student?.rubika_chat_id ? String(student.rubika_chat_id) : '';
    const isTheirs = (m: any) =>
      (m.student_id !== undefined && m.student_id !== null && String(m.student_id) === String(studentId)) ||
      (!!phone && (normalizeMobile(m.recipient) === phone || normalizeMobile(m.sender_phone) === phone)) ||
      (!!chatId && String(m.chat_id || '') === chatId);
    for (const key of ['messages', 'outbox']) {
      if (Array.isArray((db as any)[key])) (db as any)[key] = (db as any)[key].filter((m: any) => !isTheirs(m));
    }
    writeDb(db);
    removeStudentFiles(student, enrollments);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 5. POST student photos
app.post('/api/students/:id/photos', uploadStudentMedia.fields([
  { name: 'idCard', maxCount: 1 },
  { name: 'personal', maxCount: 1 }
]), async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  try {
    const studentId = parseInt(req.params.id);
    const db = readDb();
    const index = db.students.findIndex(s => s.id === studentId);
    if (!chabokan.isMysqlEnabled() && index === -1) {
      removeUploadedFiles(files);
      return res.status(404).json({ error: 'Student not found' });
    }

    const idCardPath = files?.idCard?.[0] ? publicPathFromFile(files.idCard[0]) : undefined;
    const personalPath = files?.personal?.[0] ? publicPathFromFile(files.personal[0]) : undefined;
    if (chabokan.isMysqlEnabled()) {
      await chabokan.updateStudentPhotos(studentId, idCardPath, personalPath);
      const student = await chabokan.listStudents().then((list) => list.find((s: any) => s.id === studentId));
      return res.json(student || { id: studentId, id_card_photo_url: idCardPath, personal_photo_url: personalPath });
    }
    if (idCardPath) db.students[index].id_card_photo_url = idCardPath;
    if (personalPath) db.students[index].personal_photo_url = personalPath;
    writeDb(db);
    res.json(db.students[index]);
  } catch (err: any) {
    removeUploadedFiles(files);
    res.status(500).json({ error: err.message });
  }
});

/** Welcome SMS after registration: only when the toggle is on and an SMS gateway is configured. */
async function notifyRegistration(student: any, course: any) {
  try {
    const g = getGateways();
    if (!student || !g.sms_auto_register || !g.sms_api_key || !g.sms_sender_line) return;
    const phone = normalizeMobile(student.phone_number);
    if (!/^09\d{9}$/.test(phone)) return;
    let academy = 'آموزشگاه';
    try { academy = (readDb().settings as any)?.academy_name || academy; } catch {}
    await deliverMessage({
      channel: 'sms', recipient: phone, studentId: student.id,
      message: `${student.first_name} ${student.last_name} عزیز، ثبت‌نام شما در دوره «${course?.title || ''}» با موفقیت انجام شد.\n${academy}`,
    });
  } catch (err: any) { console.warn('Registration SMS failed:', err?.message || err); }
}

// 6. POST enrollment
app.post('/api/enrollments', async (req, res) => {
  try {
    const b = req.body || {};
    const studentId = parseInt(b.student_id, 10);
    const courseId = parseInt(b.course_id, 10);
    if (!studentId || !courseId) return res.status(400).json({ error: 'student_id و course_id الزامی است.' });

    const [students, courses, enrollments] = await Promise.all([loadStudents(), loadCourses(), loadEnrollments()]);
    if (!students.some(s => Number(s.id) === studentId)) return res.status(404).json({ error: 'کارآموز یافت نشد.' });
    const course = courses.find(c => Number(c.id) === courseId);
    if (!course) return res.status(404).json({ error: 'دوره آموزشی یافت نشد.' });
    if (!courseIsActive(course)) return res.status(409).json({ error: 'این دوره غیرفعال است و ثبت‌نام جدید ندارد.' });

    const hasPrice = b.final_price !== undefined && b.final_price !== null && b.final_price !== '';
    const finalPrice = hasPrice ? Number(b.final_price) : coursePrice(course);
    if (!Number.isFinite(finalPrice) || finalPrice < 0) return res.status(400).json({ error: 'شهریه نامعتبر است.' });

    const numbers = enrollments.map(e => Number(e.course_number)).filter(n => Number.isFinite(n) && n > 0);
    let courseNumber: number | null;
    if (b.course_number !== undefined && b.course_number !== null && b.course_number !== '') {
      courseNumber = parseInt(b.course_number, 10);
      if (!Number.isInteger(courseNumber) || courseNumber <= 0) return res.status(400).json({ error: 'شماره دوره نامعتبر است.' });
    } else {
      courseNumber = numbers.length > 0 ? Math.max(...numbers) : null;
    }
    // A missing class number (null) must still match another enrollment without one.
    const sameClass = (e: any) => (e.course_number === null || e.course_number === undefined || e.course_number === '' ? null : Number(e.course_number)) === courseNumber;
    if (enrollments.some(e => Number(e.student_id) === studentId && Number(e.course_id) === courseId && sameClass(e))) {
      return res.status(409).json({ error: 'این کارآموز قبلاً در همین دوره و کلاس ثبت‌نام شده است.' });
    }

    const signupDate = normalizeJalaliDate(sanitizeString(b.signup_date_jalali, 20)) || jalaliNow();
    if (chabokan.isMysqlEnabled()) {
      const created = await chabokan.insertEnrollment({
        ...b, student_id: studentId, course_id: courseId, course_number: courseNumber, final_price: finalPrice, signup_date_jalali: signupDate,
      });
      void notifyRegistration(students.find(s => Number(s.id) === studentId), course);
      return res.json(created);
    }
    const db = readDb();
    const newEnrollment = {
      id: db.enrollments.length > 0 ? Math.max(...db.enrollments.map(e => e.id)) + 1 : 1,
      student_id: studentId,
      course_id: courseId,
      course_number: courseNumber as number,
      signup_date_jalali: signupDate,
      final_price: finalPrice,
    };
    db.enrollments.push(newEnrollment);
    writeDb(db);
    void notifyRegistration(students.find(s => Number(s.id) === studentId), course);
    res.json(newEnrollment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/enrollments', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listEnrollments());
    res.json(readDb().enrollments);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 7. POST payments
/**
 * A payment that is not tied to an enrollment is spread over the student's enrollments (oldest first,
 * up to what is still owed on each) so per-course accounting stays correct.
 */
async function allocatePayment(studentId: number, amount: number, linkedEnrollmentId: number | null): Promise<Array<{ enrollmentId: number | null; amount: number }>> {
  if (linkedEnrollmentId) return [{ enrollmentId: linkedEnrollmentId, amount }];
  const enrollments = (await loadEnrollments())
    .filter(e => Number(e.student_id) === studentId)
    .sort((a, b) => enrollmentId(a) - enrollmentId(b));
  if (enrollments.length === 0) return [{ enrollmentId: null, amount }];

  const owed = new Map<number, number>();
  if (chabokan.isMysqlEnabled()) {
    for (const e of enrollments) owed.set(enrollmentId(e), Math.max(0, Number(e.remaining_debt ?? 0)));
  } else {
    const payments = readDb().payments.filter(p => p.student_id === studentId);
    let unattributed = payments.filter(p => !p.enrollment_id).reduce((a, p) => a + p.amount, 0);
    for (const e of enrollments) {
      const id = enrollmentId(e);
      let rem = (e.final_price || 0) - payments.filter(p => p.enrollment_id === id).reduce((a, p) => a + p.amount, 0);
      const used = Math.min(unattributed, Math.max(0, rem)); // older payments without a link count against the oldest debt
      unattributed -= used; rem -= used;
      owed.set(id, Math.max(0, rem));
    }
  }
  const parts: Array<{ enrollmentId: number | null; amount: number }> = [];
  let left = amount;
  for (const e of enrollments) {
    if (left <= 0) break;
    const id = enrollmentId(e);
    const take = Math.min(left, owed.get(id) || 0);
    if (take > 0) { parts.push({ enrollmentId: id, amount: take }); left -= take; }
  }
  if (left > 0) parts.push({ enrollmentId: parts.length ? parts[parts.length - 1].enrollmentId : enrollmentId(enrollments[enrollments.length - 1]), amount: left });
  return parts;
}

app.post('/api/payments', async (req, res) => {
  try {
    const paymentData = req.body;
    const studentId = parseInt(paymentData.student_id ?? paymentData.studentId, 10);
    if (!studentId) return res.status(400).json({ error: 'student_id is required' });
    const rawAmount = paymentData.amount;
    const amount = typeof rawAmount === 'number' || typeof rawAmount === 'string' ? Math.round(Number(rawAmount)) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount is required' });
    if (!(await loadStudents()).some(s => Number(s.id) === studentId)) {
      return res.status(404).json({ error: 'کارآموز یافت نشد.' });
    }
    const linkedEnrollmentId = paymentData.enrollment_id ? parseInt(paymentData.enrollment_id, 10) : null;
    if (linkedEnrollmentId) {
      const enr = (await loadEnrollments()).find(e => enrollmentId(e) === linkedEnrollmentId);
      if (!enr || Number(enr.student_id) !== studentId) {
        return res.status(404).json({ error: 'ثبت‌نام مربوط به این کارآموز یافت نشد.' });
      }
    }
    const remaining = await remainingBalance(studentId, linkedEnrollmentId);
    if (amount > remaining) {
      return res.status(400).json({
        error: remaining > 0
          ? `مبلغ پرداختی از مانده شهریه (${remaining.toLocaleString('fa-IR')} تومان) بیشتر است.`
          : 'برای این کارآموز مانده‌ای برای پرداخت وجود ندارد.',
      });
    }
    const payDate = normalizeJalaliDate(sanitizeString(paymentData.pay_date_jalali, 20)) || jalaliNow();
    const parts = await allocatePayment(studentId, amount, linkedEnrollmentId);

    if (chabokan.isMysqlEnabled()) {
      const rows = [];
      for (const part of parts) {
        rows.push(await chabokan.insertPayment({
          student_id: studentId, enrollment_id: part.enrollmentId, amount: part.amount, pay_date_jalali: payDate,
          pay_method: sanitizeString(paymentData.pay_method ?? paymentData.paymentMethod, 40) || 'pos',
          payment_kind: sanitizeString(paymentData.payment_kind, 40) || 'downpayment',
          description: sanitizeString(paymentData.description ?? paymentData.notes, 400),
        }));
      }
      return res.json({ ...rows[0], allocations: rows.length });
    }
    const db = readDb();
    const created = parts.map((part, i) => ({
      id: (db.payments.length > 0 ? Math.max(...db.payments.map(p => p.id)) : 0) + 1 + i,
      student_id: studentId,
      enrollment_id: part.enrollmentId,
      amount: part.amount,
      pay_date_jalali: payDate,
      pay_method: sanitizeString(paymentData.pay_method ?? paymentData.paymentMethod, 40) || 'pos',
      payment_kind: sanitizeString(paymentData.payment_kind, 40) || 'downpayment',
      description: sanitizeString(paymentData.description ?? paymentData.notes, 400),
    }));
    db.payments.push(...created);
    writeDb(db);
    res.json({ ...created[0], allocations: created.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/payments', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listPayments());
    res.json(readDb().payments);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

type IranIdOcr = {
  first_name: string;
  last_name: string;
  national_code: string;
  father_name: string;
  birth_date_jalali: string;
  confidence: number;
  provider?: string;
};

function toEnglishDigits(s: string) {
  return String(s || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function validNationalCode(code: string) {
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const d = code.split('').map(Number);
  let s = 0;
  for (let i = 0; i < 9; i++) s += d[i] * (10 - i);
  const r = s % 11;
  return r < 2 ? d[9] === r : d[9] === 11 - r;
}

function cleanPersonName(s: string) {
  return String(s || '')
    .replace(/[0-9۰-۹٠-٩]/g, ' ')
    .replace(/[:：\-_|]/g, ' ')
    .replace(/نام(?:\s*خانوادگ[یي])?|پدر|کد\s*ملی|تاریخ|تولد|انقضا|صادره|شناسایی|هوشمند/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function grabLabeled(text: string, labelRe: RegExp): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    const same = cleanPersonName(m[1] || '');
    if (same) return same;
    const next = cleanPersonName(lines[i + 1] || '');
    if (next) return next;
  }
  return '';
}

function parseIranIdText(raw: string): IranIdOcr {
  const text = toEnglishDigits(raw).replace(/\u200c/g, ' ');
  const out: IranIdOcr = {
    first_name: '', last_name: '', national_code: '', father_name: '', birth_date_jalali: '', confidence: 0,
  };
  const codeCandidates = [
    ...(text.match(/\d{10}/g) || []),
    ...(text.match(/\d{3}[\s\-]\d{7}/g) || []).map((s) => s.replace(/\D/g, '')),
  ];
  out.national_code = codeCandidates.find(validNationalCode) || '';
  const date =
    text.match(/(13\d{2}|14\d{2})[\/\-\.](0[1-9]|1[0-2]|[1-9])[\/\-\.](0[1-9]|[12]\d|3[01]|[1-9])/)
    || text.match(/(13\d{2}|14\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (date) {
    out.birth_date_jalali = `${date[1]}/${date[2].padStart(2, '0')}/${date[3].padStart(2, '0')}`;
  }
  out.last_name = grabLabeled(text, /^نام\s*خانوادگ[یي]\s*[:：\-]?\s*(.*)$/);
  out.father_name = grabLabeled(text, /^نام\s*پدر\s*[:：\-]?\s*(.*)$/);
  out.first_name = grabLabeled(text, /^نام(?!\s*(?:و\s*نام\s*)?خانواد|\s*پدر)(?:\s*کوچک)?\s*[:：\-]?\s*(.*)$/);
  if (!out.first_name || !out.last_name) {
    const combo = grabLabeled(text, /^نام(?:\s*و)?\s*نام\s*خانوادگ[یي]\s*[:：\-]?\s*(.*)$/);
    if (combo) {
      const parts = combo.split(/\s+/);
      if (!out.first_name) out.first_name = parts[0] || '';
      if (!out.last_name) out.last_name = parts.slice(1).join(' ');
    }
  }
  const hits = [out.first_name, out.last_name, out.national_code, out.father_name, out.birth_date_jalali].filter(Boolean).length;
  out.confidence = Number((hits / 5).toFixed(2));
  return out;
}

function mergeOcr(primary: Partial<IranIdOcr>, fallback: IranIdOcr): IranIdOcr {
  const pick = (k: keyof IranIdOcr) => String(primary[k] || fallback[k] || '');
  const merged: IranIdOcr = {
    first_name: pick('first_name'),
    last_name: pick('last_name'),
    national_code: pick('national_code'),
    father_name: pick('father_name'),
    birth_date_jalali: pick('birth_date_jalali'),
    confidence: Number(primary.confidence || fallback.confidence || 0),
    provider: String(primary.provider || fallback.provider || ''),
  };
  if (merged.national_code) merged.national_code = toEnglishDigits(merged.national_code).replace(/\D/g, '').slice(0, 10);
  if (merged.birth_date_jalali) merged.birth_date_jalali = toEnglishDigits(merged.birth_date_jalali);
  const hits = [merged.first_name, merged.last_name, merged.national_code, merged.father_name, merged.birth_date_jalali].filter(Boolean).length;
  merged.confidence = Math.max(merged.confidence, Number((hits / 5).toFixed(2)));
  return merged;
}

let gcpTokenCache: { token: string; exp: number } | null = null;
async function getGcpAccessToken(): Promise<string | null> {
  const clientId = process.env.GCP_CLIENT_ID;
  const clientSecret = process.env.GCP_CLIENT_SECRET;
  const refreshToken = process.env.GCP_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  if (gcpTokenCache && Date.now() < gcpTokenCache.exp - 60_000) return gcpTokenCache.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  if (!data.access_token) return null;
  gcpTokenCache = { token: data.access_token, exp: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return data.access_token;
}

async function ocrWithCloudVision(fileBuffer: Buffer): Promise<IranIdOcr | null> {
  const token = await getGcpAccessToken();
  const project = process.env.GCP_PROJECT_ID || '';
  if (!token || !project) return null;
  const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': project,
    },
    body: JSON.stringify({
      requests: [{
        image: { content: fileBuffer.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['fa', 'en'] },
      }],
    }),
  });
  if (!res.ok) {
    console.error('Cloud Vision OCR HTTP', res.status);
    return null;
  }
  const data: any = await res.json();
  const text = data?.responses?.[0]?.fullTextAnnotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || '';
  if (!text.trim()) return null;
  const parsed = parseIranIdText(text);
  parsed.provider = 'cloud-vision';
  return parsed;
}

async function ocrWithGemini(fileBuffer: Buffer, mimeType: string): Promise<IranIdOcr | null> {
  if (!ai) return null;
  const prompt = `این تصویر کارت ملی هوشمند ایران است. فقط JSON برگردان، بدون توضیح.
{
  "first_name": "نام کوچک به فارسی",
  "last_name": "نام خانوادگی به فارسی",
  "national_code": "۱۰ رقم انگلیسی",
  "father_name": "نام پدر به فارسی",
  "birth_date_jalali": "مثلا 1378/05/20",
  "confidence": 0.95
}
اگر خوانده نشد رشته خالی بگذار. هیچ فیلدی را حدس نزن.`;
  const models = [...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { data: fileBuffer.toString('base64'), mimeType } },
          { text: prompt },
        ],
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      const responseText = response.text || '';
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) continue;
      const parsed = JSON.parse(responseText.slice(jsonStart, jsonEnd + 1));
      parsed.provider = `gemini:${model}`;
      return parsed;
    } catch (err: any) {
      console.warn('Gemini OCR model failed', model, err?.message || err);
    }
  }
  return null;
}

app.get('/api/ocr/status', async (_req, res) => {
  const vision = !!(process.env.GCP_CLIENT_ID && process.env.GCP_REFRESH_TOKEN && process.env.GCP_PROJECT_ID);
  res.json({ gemini: !!ai, vision, ready: !!ai || vision });
});

// 8. OCR Iranian national smart card: Gemini (if keyed) + Cloud Vision parser
app.post('/api/ocr', upload.fields([{ name: 'card', maxCount: 1 }, { name: 'nationalCard', maxCount: 1 }]), async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const uploaded = files?.card?.[0] || files?.nationalCard?.[0] || (req as any).file;
  if (!uploaded) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  (req as any).file = uploaded;
  const visionConfigured = !!(process.env.GCP_CLIENT_ID && process.env.GCP_REFRESH_TOKEN && process.env.GCP_PROJECT_ID);
  if (!ai && !visionConfigured) {
    removeUploadedFiles(files);
    return res.status(503).json({ success: false, error: 'سرویس خواندن کارت ملی تنظیم نشده است (GEMINI_API_KEY). اطلاعات را دستی وارد کنید.' });
  }
  const fileBuffer = fs.readFileSync(req.file.path);
  // The scan is only needed for this request; don't keep national-card images in /uploads.
  removeUploadedFiles(files); // the client sends the same scan under two field names
  try {
    const [gemini, vision] = await Promise.all([
      ocrWithGemini(fileBuffer, req.file.mimetype || 'image/jpeg'),
      ocrWithCloudVision(fileBuffer),
    ]);
    const empty: IranIdOcr = { first_name: '', last_name: '', national_code: '', father_name: '', birth_date_jalali: '', confidence: 0 };
    const merged = mergeOcr(gemini || {}, vision || empty);
    if (gemini) merged.provider = vision ? `${gemini.provider}+cloud-vision` : gemini.provider;
    else if (vision) merged.provider = 'cloud-vision';
    const hasAny = !!(merged.first_name || merged.last_name || merged.national_code);
    if (!hasAny) {
      return res.status(422).json({
        success: false,
        error: 'خواندن کارت ملی ناموفق بود. اطلاعات را دستی وارد کنید.',
        ...empty,
      });
    }
    return res.json({ success: true, ...merged });
  } catch (error) {
    console.error('National card OCR failed:', (error as any)?.message || error);
    return res.status(422).json({
      success: false,
      error: 'خواندن کارت ملی ناموفق بود. اطلاعات را دستی وارد کنید.',
      first_name: '', last_name: '', national_code: '', father_name: '', birth_date_jalali: '', confidence: 0,
    });
  }
});

// 9. GET/POST receipt settings
app.get('/api/receipt-settings', (req, res) => {
  res.json(publicSettings(readDb().settings));
});

app.post('/api/receipt-settings', (req, res) => {
  const db = readDb();
  const { admin_password_hash, gateways, ...incoming } = req.body || {};
  db.settings = { ...db.settings, ...incoming };
  writeDb(db);
  res.json(publicSettings(db.settings));
});

// 10. GET report templates
app.get('/api/report-templates', (req, res) => {
  const db = readDb();
  const { category, active } = req.query;
  let templates = db.reportTemplates;

  if (category) {
    templates = templates.filter(t => t.category === category);
  }
  if (active !== undefined) {
    templates = templates.filter(t => t.active === (active === 'true'));
  }

  res.json({ templates, fallback: true });
});

// 11. GET enrollment report context
app.get('/api/enrollments/:id/report-context', (req, res) => {
  const db = readDb();
  const enrollmentId = parseInt(req.params.id);
  const enrollment = db.enrollments.find(e => e.id === enrollmentId);

  if (!enrollment) {
    return res.status(404).json({ error: 'Enrollment not found' });
  }

  const student = db.students.find(s => s.id === enrollment.student_id);
  const course = db.courses.find(c => c.id === enrollment.course_id);
  const payments = db.payments.filter(p => p.student_id === enrollment.student_id && p.enrollment_id === enrollmentId);

  res.json({
    enrollment,
    student: student || null,
    course: course || null,
    payments,
    settings: publicSettings(db.settings),
    timestamp: new Date().toISOString(),
  });
});

// 12. Upload receipt PDF
app.post('/api/enrollments/:id/receipt', uploadReceipt.single('pdf'), async (req, res) => {
  const enrollmentId = parseInt(req.params.id, 10);
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded' });
  }
  const reject = (status: number, error: string) => { removeUploadedFiles(req.file); return res.status(status).json({ error }); };
  if (!enrollmentId) return reject(400, 'Invalid enrollment id');
  const header = Buffer.alloc(5);
  const fd = fs.openSync(req.file.path, 'r');
  try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
  if (header.toString('latin1') !== '%PDF-') return reject(400, 'فایل ارسالی PDF معتبر نیست.');
  const receiptPath = publicPathFromFile(req.file);
  try {
    if (chabokan.isMysqlEnabled()) {
      if (!(await loadEnrollments()).some(e => Number(e.id) === enrollmentId)) return reject(404, 'Enrollment not found');
      await chabokan.updateEnrollmentReceipt(enrollmentId, receiptPath);
      return res.json({ receipt_pdf_path: receiptPath });
    }
    const db = readDb();
    const index = db.enrollments.findIndex(e => e.id === enrollmentId);
    if (index === -1) {
      return reject(404, 'Enrollment not found');
    }
    db.enrollments[index].receipt_pdf_path = receiptPath;
    writeDb(db);
    res.json({ receipt_pdf_path: receiptPath });
  } catch (err: any) {
    removeUploadedFiles(req.file);
    res.status(500).json({ error: err.message });
  }
});

// 13. Expenses management
app.get('/api/expenses', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listExpenses());
    res.json(readDb().expenses);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/expenses', async (req, res) => {
  const expenseData = req.body || {};
  const title = sanitizeString(expenseData.title ?? expenseData.expenseTitle, 160);
  const amount = parseFloat(expenseData.amount ?? expenseData.expenseAmount);
  if (!title || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'title and amount are required' });
  }
  try {
  if (chabokan.isMysqlEnabled()) {
    return res.json(await chabokan.insertExpense({
      title, amount,
      pay_method: sanitizeString(expenseData.pay_method ?? expenseData.category, 80),
      description: sanitizeString(expenseData.description ?? expenseData.notes, 400),
      pay_date_jalali: normalizeJalaliDate(sanitizeString(expenseData.pay_date_jalali ?? expenseData.expenseDate ?? expenseData.expensedate, 20)) || jalaliNow(),
    }));
  }
  const db = readDb();
  const newExpense = {
    id: db.expenses.length > 0 ? Math.max(...db.expenses.map(ex => ex.id)) + 1 : 1,
    title,
    amount,
    pay_method: sanitizeString(expenseData.pay_method ?? expenseData.category, 80) || 'کارت بانکی',
    pay_date_jalali: normalizeJalaliDate(sanitizeString(expenseData.pay_date_jalali ?? expenseData.expenseDate ?? expenseData.expensedate, 20)) || jalaliNow(),
    description: sanitizeString(expenseData.description ?? expenseData.notes, 400),
  };
  db.expenses.push(newExpense);
  writeDb(db);
  res.json(newExpense);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/registrations', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listWebsiteRegistrations());
    res.json([]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Website registrations (MySQL `registrations`; the JSON store has none) ──────────────────────────
const SITE_UPLOADS_DEFAULT = '/project/kermanshahcart/site/app/uploads/registrations';
function siteUploadsDir() {
  return path.resolve(process.env.SITE_UPLOADS_DIR || SITE_UPLOADS_DEFAULT);
}

/** Resolves a stored site upload path to a real image file inside SITE_UPLOADS_DIR, or null (missing, unsafe, not an image). */
function resolveSiteFile(stored: unknown): string | null {
  if (typeof stored !== 'string' || !stored.trim()) return null;
  let rel = stored.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch { return null; }
  if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) return null;
  const marker = rel.match(/(?:^|\/)uploads\/registrations\/(.+)$/i);
  rel = marker ? marker[1] : rel.replace(/^[\\/]+/, '');
  if (!rel || !IMAGE_EXTENSIONS.has(path.extname(rel).toLowerCase())) return null;
  try {
    const base = fs.realpathSync(siteUploadsDir());
    const abs = fs.realpathSync(path.resolve(base, rel));
    if (!abs.startsWith(base + path.sep) || !fs.statSync(abs).isFile()) return null;
    return abs;
  } catch { return null; }
}

/** Copies a registration's site photos into StudentFiles with the same names the CRM photo upload uses. */
async function copyRegistrationFiles(
  reg: { national_card_path?: string | null; personal_photo_path?: string | null },
  t: { studentId: number; lastName: string; courseNumber: number; wantIdCard: boolean; wantPersonal: boolean },
) {
  const out: { idCard?: string; personal?: string; created: string[] } = { created: [] };
  try {
    const dir = path.join(studentFilesBase, safeSegment(t.courseNumber, 'unsorted'), `${safeSegment(t.lastName, 'student')}_${safeSegment(t.studentId, String(Date.now()))}`);
    const copy = (stored: string | null | undefined, suffix: 'ID' | 'Photo'): string | undefined => {
      const src = resolveSiteFile(stored);
      if (!src) return undefined;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `${safeSegment(t.lastName, 'Student')}_${safeSegment(t.studentId, String(Date.now()))}_${suffix}${path.extname(src) || '.jpg'}`);
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        out.created.push(dest);
        return `/${path.relative(process.cwd(), dest).split(path.sep).join('/')}`;
      } catch (err: any) {
        console.warn('Registration photo copy skipped:', err?.message || err);
        return undefined;
      }
    };
    if (t.wantIdCard) out.idCard = copy(reg.national_card_path, 'ID');
    if (t.wantPersonal) out.personal = copy(reg.personal_photo_path, 'Photo');
  } catch (err: any) { console.warn('Registration photo copy skipped:', err?.message || err); }
  return out;
}

function requireRegistrationStore(res: express.Response): boolean {
  if (chabokan.isMysqlEnabled()) return true;
  res.status(501).json({ error: 'ثبت‌نام‌های وبسایت فقط با پایگاه داده MySQL پشتیبانی می‌شود.' });
  return false;
}

// Streams a site-uploaded document (before approval it only exists in the site's uploads dir).
app.get('/api/registrations/:code/file/:kind', async (req, res) => {
  try {
    if (!requireRegistrationStore(res)) return;
    const kind = req.params.kind;
    if (kind !== 'national_card' && kind !== 'personal_photo') return res.status(400).json({ error: 'نوع فایل نامعتبر است.' });
    const row = await chabokan.getWebsiteRegistrationFiles(sanitizeString(req.params.code, 50));
    if (!row) return res.status(404).json({ error: 'ثبت‌نام یافت نشد.' });
    const file = resolveSiteFile(kind === 'national_card' ? row.national_card_path : row.personal_photo_path);
    if (!file) return res.status(404).json({ error: 'فایل یافت نشد.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(file, { dotfiles: 'allow' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Approves a website registration: student (new or reused) + enrollment + photos + status, in one transaction.
app.post('/api/registrations/:code/approve', async (req, res) => {
  try {
    if (!requireRegistrationStore(res)) return;
    const b = req.body || {};
    const code = sanitizeString(req.params.code, 50);
    const courseId = parseInt(b.course_id, 10);
    if (!code) return res.status(400).json({ error: 'کد پیگیری الزامی است.' });
    if (!courseId) return res.status(400).json({ error: 'course_id الزامی است.' });

    const hasPrice = b.final_price !== undefined && b.final_price !== null && b.final_price !== '';
    const finalPrice = hasPrice ? Number(b.final_price) : null;
    if (hasPrice && (!Number.isFinite(finalPrice) || (finalPrice as number) < 0)) return res.status(400).json({ error: 'شهریه نامعتبر است.' });
    let courseNumber: number | null = null;
    if (b.course_number !== undefined && b.course_number !== null && b.course_number !== '') {
      courseNumber = parseInt(b.course_number, 10);
      if (!Number.isInteger(courseNumber) || courseNumber <= 0) return res.status(400).json({ error: 'شماره دوره نامعتبر است.' });
    }

    const { data, error } = parseStudentInput({ ...b, national_code: undefined }, true);
    if (error) return res.status(400).json({ error });
    delete data.national_code;
    delete data.father_name;

    const result = await chabokan.approveWebsiteRegistration({
      trackingCode: code,
      staffUsername: String((req as any).user?.username || ''),
      courseId,
      courseNumber,
      finalPrice,
      signupDate: normalizeJalaliDate(sanitizeString(b.signup_date_jalali, 20)) || jalaliNow(),
      overrides: data,
      updateExisting: b.update_existing === true,
      copyFiles: copyRegistrationFiles,
    });
    const course = (await loadCourses()).find(c => Number(c.id) === courseId);
    void notifyRegistration(result.student, course);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

app.post('/api/registrations/:code/reject', async (req, res) => {
  try {
    if (!requireRegistrationStore(res)) return;
    const code = sanitizeString(req.params.code, 50);
    if (!code) return res.status(400).json({ error: 'کد پیگیری الزامی است.' });
    const registration = await chabokan.rejectWebsiteRegistration(code, String((req as any).user?.username || ''));
    const reason = sanitizeString(req.body?.reason, 300);
    if (reason) console.log(`Registration ${code} rejected by ${(req as any).user?.username}: ${reason}`);
    res.json({ success: true, registration });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});


app.get('/api/messenger/threads', (req, res) => {
  const db = readDb();
  res.json({ success: true, threads: (db as any).threads || [] });
});

app.get('/api/settings/academy', (req, res) => {
  res.json(publicSettings(readDb().settings));
});
app.put('/api/settings/academy', (req, res) => {
  const db = readDb();
  const { admin_password_hash, gateways, ...incoming } = req.body || {};
  db.settings = { ...db.settings, ...incoming };
  writeDb(db);
  res.json(publicSettings(db.settings));
});
app.post('/api/settings/courses', (req, res) => {
  req.url = '/api/courses';
  (app as any)._router.handle(req, res);
});
app.put('/api/settings/courses/:id', (req, res) => {
  req.url = `/api/courses/${req.params.id}`;
  (app as any)._router.handle(req, res);
});
app.post('/api/students/ocr/national-card', (req, res) => {
  req.url = '/api/ocr';
  (app as any)._router.handle(req, res);
});
app.get('/api/settings/gateways', (req, res) => {
  const g = getGateways();
  res.json({
    sms_provider: g.sms_provider,
    sms_api_key: '',
    sms_api_key_set: !!g.sms_api_key,
    sms_sender_line: g.sms_sender_line,
    sms_auto_register: g.sms_auto_register,
    sms_auto_exam: g.sms_auto_exam,
    rubika_bot_token: '',
    rubika_bot_token_set: !!g.rubika_bot_token,
    rubika_channel_id: g.rubika_channel_id,
    rubika_active: g.rubika_active,
  });
});
app.post('/api/settings/gateways', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const current: any = (db.settings as any)?.gateways || {};
  const next: any = { ...current };
  if (b.sms_provider !== undefined) next.sms_provider = ['smsir', 'ippanel'].includes(b.sms_provider) ? b.sms_provider : 'ippanel';
  if (typeof b.sms_api_key === 'string' && b.sms_api_key.trim()) next.sms_api_key = sanitizeString(b.sms_api_key, 200); // blank = keep the saved key
  if (b.sms_sender_line !== undefined) next.sms_sender_line = sanitizeString(b.sms_sender_line, 30);
  if (b.sms_auto_register !== undefined) next.sms_auto_register = !!b.sms_auto_register;
  if (b.sms_auto_exam !== undefined) next.sms_auto_exam = !!b.sms_auto_exam;
  if (typeof b.rubika_bot_token === 'string' && b.rubika_bot_token.trim()) next.rubika_bot_token = sanitizeString(b.rubika_bot_token, 200);
  if (b.rubika_channel_id !== undefined) next.rubika_channel_id = sanitizeString(b.rubika_channel_id, 100);
  if (b.rubika_active !== undefined) next.rubika_active = !!b.rubika_active;
  db.settings = { ...(db.settings as any), gateways: next };
  writeDb(db);
  res.json({ success: true });
});

// Dashboard to-do list and calendar events: shared by all admins (they used to live in each browser).
app.get('/api/dashboard-notes', (req, res) => {
  const d: any = (readDb() as any).dashboard || {};
  res.json({ tasks: Array.isArray(d.tasks) ? d.tasks : [], events: Array.isArray(d.events) ? d.events : [] });
});
app.put('/api/dashboard-notes', (req, res) => {
  const tasks = (Array.isArray(req.body?.tasks) ? req.body.tasks : []).slice(0, 500).map((t: any) => ({
    id: Number(t.id) || Date.now(), text: sanitizeString(t.text, 300), completed: !!t.completed,
    priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
  })).filter((t: any) => t.text);
  const events = (Array.isArray(req.body?.events) ? req.body.events : []).slice(0, 1000).map((e: any) => ({
    year: Number(e.year) || null, month: Number(e.month) || null, day: Math.min(31, Math.max(1, Number(e.day) || 1)),
    title: sanitizeString(e.title, 200), time: sanitizeString(e.time, 10),
  })).filter((e: any) => e.title);
  const db = readDb();
  (db as any).dashboard = { tasks, events };
  writeDb(db);
  res.json({ tasks, events });
});

// JSON errors for bad bodies and rejected uploads (instead of Express' HTML 500 page)
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON نامعتبر است.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'حجم درخواست بیش از حد مجاز است.' });
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیش از حد مجاز است.' : 'آپلود نامعتبر است.',
    });
  }
  if (err instanceof UploadError) return res.status(err.status).json({ error: err.message });
  next(err);
});

// Vite Integration middleware & SPA fallback
async function startServer() {
  await chabokan.initMysql();
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started successfully on http://0.0.0.0:${PORT}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

startServer();
