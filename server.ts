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
import { IranIdOcr, toLatinDigits as ocrLatinDigits, isValidNationalCode, runCardOcr } from './ocrValidate';
import { normalizeJalaliDate as strictJalaliDate, jalaliToday as tehranJalaliToday, normalizeNationalCode, checkNationalCode, cleanText } from './src/utils/normalize';
import { safeSegment, registrationPdfRelPath, parseDocKind, isPdfBytes, DOC_PATH_FIELDS, DOC_KINDS, type DocKind } from './src/utils/printDocs';
import { owedByEnrollment, allocatePayment as splitPayment, payableAmount } from './src/utils/finance';

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

/**
 * TRUST_PROXY (default 1): how many reverse proxies in front of the app may set X-Forwarded-For, so that
 * req.ip is the real client (rate limits are per IP). 1 = nginx only; 2 = CDN (e.g. Arvan) + nginx, with
 * nginx appending $proxy_add_x_forwarded_for. Also accepts true/false or Express' IP/subnet lists.
 */
function trustProxySetting(): boolean | number | string {
  const raw = String(process.env.TRUST_PROXY ?? '1').trim();
  if (raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
app.set('trust proxy', trustProxySetting());

/** Express 4 does not catch rejected promises: route them to the JSON error handler instead of hanging. */
type AsyncRoute = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown> | unknown;
const asyncHandler = (fn: AsyncRoute): express.RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
const PORT = Number(process.env.PORT || 3000);

// Set up storage directory for uploads
// Set up StudentFiles storage directory structure matching MS Access logic
const studentFilesBase = path.join(process.cwd(), 'StudentFiles');
if (!fs.existsSync(studentFilesBase)) {
  fs.mkdirSync(studentFilesBase, { recursive: true });
}

/**
 * A file name in `dir` that is not taken yet: `base + ext`, else `base_2 + ext`, ... Student ids were
 * renumbered, so an existing file with "our" name may belong to someone else and is never overwritten.
 */
function freeFileName(dir: string, base: string, ext: string): string {
  if (!fs.existsSync(path.join(dir, `${base}${ext}`))) return `${base}${ext}`;
  for (let i = 2; i < 100; i++) {
    const name = `${base}_${i}${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return `${base}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
}

function publicPathFromFile(file: Express.Multer.File) {
  const rel = path.relative(process.cwd(), path.resolve(file.path)).split(path.sep).join('/');
  return `/${rel}`;
}

function studentUploadDir(req: express.Request) {
  const courseNum = safeSegment(req.body.course_number, 'unsorted');
  const studentId = safeSegment(req.params.id || req.body.student_id, String(Date.now()));
  const lastName = safeSegment(req.body.last_name, 'student');
  return path.join(studentFilesBase, courseNum, `${lastName}_${studentId}`);
}

const studentPhotoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const targetDir = studentUploadDir(req);
    fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const lastName = safeSegment(req.body.last_name, 'Student');
    const studentId = safeSegment(req.params.id || req.body.student_id, String(Date.now()));
    const isIdCard = file.fieldname === 'idCard' || file.fieldname === 'id_card_photo';
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, freeFileName(studentUploadDir(req), `${lastName}_${studentId}_${isIdCard ? 'ID' : 'Photo'}`, ext));
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
/** Removes a deleted student's photos/scans and the registration PDFs (receipt, file summary, contract) of their enrollments. */
function removeStudentFiles(student: any, enrollments: any[]) {
  for (const key of ['id_card_photo_url', 'personal_photo_url', 'national_card_path', 'personal_photo_path']) {
    unlinkStoredFile(student?.[key], studentFilesBase);
  }
  for (const e of enrollments) {
    for (const kind of DOC_KINDS) {
      // Registration PDFs live in StudentFiles (older receipts in uploads/).
      const stored = e?.[DOC_PATH_FIELDS[kind]];
      unlinkStoredFile(stored, studentFilesBase);
      unlinkStoredFile(stored, uploadsDir);
    }
  }
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
// Registration PDFs are validated in memory, then written under StudentFiles/ by the route (the path comes from the enrollment, not the client).
const MAX_REGISTRATION_PDF_BYTES = 8 * 1024 * 1024;
const uploadReceipt = multer({ storage: multer.memoryStorage(), fileFilter: pdfFileFilter, limits: { fileSize: MAX_REGISTRATION_PDF_BYTES, files: 1 } });

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
  idcard_pdf_path?: string;
  contract_pdf_path?: string;
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
    contract_text?: string;
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
const fileRateBuckets = new Map<string, { count: number; resetAt: number }>();
const clientIp = (req: express.Request) => req.ip || req.socket.remoteAddress || 'unknown';

/** Counts one hit for `key`; true when the key went over `limit` within the window. */
function overLimit(map: Map<string, { count: number; resetAt: number }>, key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = map.get(key);
  if (!bucket || now > bucket.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

app.use('/api/', (req, res, next) => {
  if (overLimit(rateBuckets, clientIp(req), 180)) return res.status(429).json({ error: 'Too many requests' });
  next();
});

/** Uploaded files: a list page loads many thumbnails, so the limit is generous but still bounded. */
function fileRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (overLimit(fileRateBuckets, clientIp(req), 600)) return res.status(429).json({ error: 'Too many requests' });
  next();
}

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
// Failed logins per (username, IP): guessing one account from one address is throttled, but nobody can lock
// the admin out of every other address by failing on purpose. The per-IP login limit still applies.
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const map of [rateBuckets, fileRateBuckets, loginBuckets, failedLogins]) {
    for (const [key, b] of map) if (now > b.resetAt) map.delete(key);
  }
}, 60_000).unref();

const SESSION_TTL_MS = 12 * 3600 * 1000;
const FILE_TOKEN_TTL_MS = 10 * 60 * 1000;

function signToken(payload: Record<string, unknown>, ttlMs = SESSION_TTL_MS) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
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

/** Short tag of a password hash: a token carries it, so changing the password ends older sessions. */
const passwordTag = (v: unknown) => crypto.createHash('sha256').update(String(v ?? '')).digest('base64url').slice(0, 16);
function envAdminPasswordTag() {
  let hash = '';
  try { hash = String(readDb().settings?.admin_password_hash || ''); } catch {}
  return passwordTag(hash ? `hash:${hash}` : `env:${process.env.CRM_ADMIN_PASSWORD || ''}`);
}

const isFilePath = (req: express.Request) => /^\/(uploads|StudentFiles)(\/|$)/i.test(req.originalUrl.split('?')[0]);

/**
 * Session token from the Authorization header (API and files), or a short-lived file token from ?token=
 * (only for GET of /uploads and /StudentFiles: <img>/<a> cannot send headers). Each kind is refused in
 * the other place, so a URL that leaks (logs, Referer) never opens the API.
 */
function tokenFromRequest(req: express.Request): any | null {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) {
    const data = verifyToken(h.slice(7).trim());
    return data && data.kind !== 'file' ? data : null;
  }
  if (!isFilePath(req) || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  const q = String((req.query as any)?.token || '');
  const data = q ? verifyToken(q) : null;
  return data && data.kind === 'file' ? data : null;
}

// MySQL staff are re-checked in the background (at most once a minute per user): deactivation or a
// password change ends their sessions within about a minute without a DB query on every request.
const MYSQL_STAFF_RECHECK_MS = 60_000;
const mysqlStaffState = new Map<string, { active: boolean; role: string; tag: string; at: number }>();
const mysqlStaffChecking = new Set<string>();
function rememberMysqlStaff(staff: any) {
  mysqlStaffState.set(String(staff.username).toLowerCase(), {
    active: !!Number(staff.is_active), role: String(staff.role || ''), tag: passwordTag(staff.password_hash), at: Date.now(),
  });
}
function recheckMysqlStaff(username: string) {
  const key = username.toLowerCase();
  if (mysqlStaffChecking.has(key) || !chabokan.isMysqlEnabled()) return;
  mysqlStaffChecking.add(key);
  chabokan.findStaffByUsername(username)
    .then((staff) => {
      if (staff) rememberMysqlStaff(staff);
      else mysqlStaffState.set(key, { active: false, role: '', tag: '', at: Date.now() });
    })
    .catch(() => {})
    .finally(() => mysqlStaffChecking.delete(key));
}

/** Valid token -> session. Local staff and the env admin are re-checked on every request, MySQL staff via the cache above. */
function sessionFromRequest(req: express.Request): any | null {
  const session = tokenFromRequest(req);
  if (!session) return null;
  if (session.source === 'local') {
    try {
      const staff = readDb().staff_users.find((s) => s.id === session.user_id);
      if (!staff || !staff.is_active || session.pwv !== passwordTag(staff.password_hash)) return null;
      return { ...session, username: staff.username, role: staff.role };
    } catch {
      return null;
    }
  }
  if (session.source === 'env') {
    return session.pwv === envAdminPasswordTag() ? session : null;
  }
  // MySQL staff (older tokens carry no source).
  const username = String(session.username || '');
  const state = mysqlStaffState.get(username.toLowerCase());
  if (!state || Date.now() - state.at > MYSQL_STAFF_RECHECK_MS) recheckMysqlStaff(username);
  if (state && (!state.active || (session.pwv && session.pwv !== state.tag))) return null;
  return state?.role ? { ...session, role: state.role } : session;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  (req as any).user = session;
  next();
}

/** Any signed-in staff role. Used for uploaded files, which <img>/<a> load with a ?token= file token. */
function requireStaff(req: express.Request, res: express.Response, next: express.NextFunction) {
  requireAuth(req, res, () => {
    if (!currentRole(req)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
}

app.post('/api/auth/login', async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  if (overLimit(loginBuckets, ip, 10)) return res.status(429).json({ error: 'Too many login attempts' });

  const username = sanitizeString(req.body?.username, 80);
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const userKey = `${username.toLowerCase()}|${ip}`;
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
        const token = signToken({ username: envUser, role: 'admin', source: 'env', pwv: envAdminPasswordTag() });
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
          pwv: passwordTag(localStaff.password_hash),
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
          rememberMysqlStaff(staff);
          const token = signToken({ username: staff.username, role: staff.role, user_id: staff.user_id, source: 'mysql', pwv: passwordTag(staff.password_hash) });
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

// Short-lived token for <img>/<a> loads of /uploads and /StudentFiles (?token=). It is refused by the API.
app.post('/api/auth/file-token', requireAuth, (req, res) => {
  const u = (req as any).user || {};
  const expires = Date.now() + FILE_TOKEN_TTL_MS;
  const token = signToken({ kind: 'file', username: u.username, role: u.role, user_id: u.user_id, source: u.source, pwv: u.pwv }, FILE_TOKEN_TTL_MS);
  res.json({ token, expires });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: chabokan.isMysqlEnabled() ? 'chabokan-mysql' : 'json-file' });
});

const STAFF_ROLES = ['admin', 'cashier', 'instructor'] as const;
type StaffRole = typeof STAFF_ROLES[number];

function currentRole(req: express.Request): StaffRole | null {
  const role = String((req as any).user?.role || '');
  return (STAFF_ROLES as readonly string[]).includes(role) ? role as StaffRole : null;
}

/**
 * Roles: admin (everything), cashier (registration, payments, accounting, messenger), instructor (the
 * students tab only: a read-only list without national codes, addresses, ID scans or money; see
 * redactForInstructor). Every DELETE is admin-only.
 */
function canAccessApi(role: StaffRole, method: string, rawPath: string): boolean {
  if (role === 'admin') return true;
  const path = rawPath.toLowerCase(); // Express routing ignores case, so the checks must too
  const write = method !== 'GET' && method !== 'HEAD';
  if (method === 'DELETE') return false;
  if (path.startsWith('/staff') || path.startsWith('/settings') || path.startsWith('/imports')) return false;
  if (path.startsWith('/courses') && write) return false;
  if (path.startsWith('/receipt-settings') && write) return false;
  if (path.startsWith('/payments') || path.startsWith('/expenses')) return role === 'cashier';
  if (path.startsWith('/ocr')) return role === 'cashier';
  if (path.includes('report-templates') || path.includes('report-context') || path.includes('/receipt')) return role === 'cashier';
  if (path.startsWith('/registrations')) return role === 'cashier';
  if (path.startsWith('/students') || path.startsWith('/enrollments')) {
    if (write) return role === 'cashier';
    // The instructor only gets the two lists (redacted), not single records or sub-resources.
    if (role === 'instructor') return path === '/students' || path === '/students/' || path === '/enrollments' || path === '/enrollments/';
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

/** The instructor's students tab needs names, phone, photo and classes; nothing personal or financial. */
function redactForInstructor(req: express.Request, kind: 'students' | 'enrollments', rows: any[]): any[] {
  if (currentRole(req) !== 'instructor') return rows;
  if (kind === 'students') {
    return rows.map((s) => ({
      id: s.id, first_name: s.first_name, last_name: s.last_name, phone_number: s.phone_number,
      personal_photo_url: s.personal_photo_url, status: s.status, created_at: s.created_at,
    }));
  }
  return rows.map((e) => ({
    id: e.id, student_id: e.student_id, course_id: e.course_id, course_number: e.course_number, signup_date_jalali: e.signup_date_jalali,
  }));
}

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
app.use('/uploads', fileRateLimit, requireStaff, (req, res, next) => {
  const role = currentRole(req);
  if (role !== 'admin' && role !== 'cashier') return res.status(403).json({ error: 'Forbidden' });
  next();
}, express.static(uploadsDir));

// Personal-photo paths the instructor may open (refreshed at most once a minute).
let instructorPhotos: { paths: Set<string>; at: number } | null = null;
async function instructorPhotoPaths(): Promise<Set<string>> {
  if (instructorPhotos && Date.now() - instructorPhotos.at < 60_000) return instructorPhotos.paths;
  const norm = (v: unknown) => { try { return decodeURIComponent(String(v || '').split(/[?#]/)[0]).replace(/^\/*/, '/'); } catch { return ''; } };
  const paths = new Set((await loadStudents()).map((s) => norm(s.personal_photo_url)).filter((p) => p.length > 1));
  instructorPhotos = { paths, at: Date.now() };
  return paths;
}

// Student documents (national card, photos) are personal data: staff login required. The instructor
// only sees personal photos (positively identified as a student's personal_photo), never ID scans.
app.use('/StudentFiles', fileRateLimit, requireStaff, asyncHandler(async (req, res, next) => {
  if (currentRole(req) !== 'instructor') return next();
  let requested = '';
  try { requested = decodeURIComponent(req.originalUrl.split('?')[0]); } catch { return res.status(400).json({ error: 'Bad path' }); }
  if (!(await instructorPhotoPaths()).has(requested)) return res.status(403).json({ error: 'Forbidden' });
  next();
}), express.static(studentFilesBase));

// Initialize Gemini API. GEMINI_API_KEYS (comma/space separated) and/or GEMINI_API_KEY; when one key hits its
// quota the OCR call moves on to the next key.
const geminiKeys = [...new Set(`${process.env.GEMINI_API_KEYS || ''},${process.env.GEMINI_API_KEY || ''}`.split(/[\s,]+/).filter(Boolean))];
const geminiClients: GoogleGenAI[] = [];
const geminiCooldownUntil: number[] = [];
for (const apiKey of geminiKeys) {
  try {
    geminiClients.push(new GoogleGenAI({
      apiKey,
      httpOptions: {
        // Optional relay/proxy endpoint for servers that cannot reach Google directly.
        ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    }));
    geminiCooldownUntil.push(0);
  } catch (e) {
    console.error('Failed to initialize a Gemini API key:', e);
  }
}
const ai: GoogleGenAI | null = geminiClients[0] || null;
if (ai) console.log(`Gemini API initialized successfully (${geminiClients.length} key${geminiClients.length > 1 ? 's' : ''}).`);

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

app.post('/api/messenger/webhook', asyncHandler(async (req, res) => {
  // Fail closed: without MESSENGER_WEBHOOK_SECRET the endpoint is disabled.
  if (!process.env.MESSENGER_WEBHOOK_SECRET) return res.status(403).json({ error: 'Webhook is not configured' });
  if (!webhookAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { sender, message, channel, chat_id, sender_phone } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });

  // With MySQL the students live there (db_store.json only holds demo students): look the sender up first.
  const mysqlStudent = chabokan.isMysqlEnabled() && channel === 'rubika' && chat_id && sender_phone
    ? await chabokan.findStudentByPhone(normalizeMobile(sender_phone))
    : null;
  const db = readDb();
  if (!(db as any).messages) (db as any).messages = [];

  // The chat_id <-> student link decides who receives that student's messages, so it is only
  // accepted from a caller that knows the shared secret (MESSENGER_WEBHOOK_SECRET).
  if (channel === 'rubika' && chat_id && sender_phone) {
    if (chabokan.isMysqlEnabled()) {
      if (mysqlStudent) {
        // Keyed by the MySQL student_id; the JSON store's demo students are never touched.
        const links = ((db as any).rubika_links ||= {}) as Record<string, string>;
        links[String(mysqlStudent.id)] = String(chat_id).slice(0, 100);
        console.log(`[Rubika] chat_id ذخیره شد برای ${mysqlStudent.first_name} ${mysqlStudent.last_name}`);
      }
    } else {
      const phone = normalizeMobile(sender_phone);
      const student = db.students.find((s: any) => normalizeMobile(s.phone_number) === phone);
      if (student) {
        (student as any).rubika_chat_id = String(chat_id).slice(0, 100);
        console.log(`[Rubika] chat_id ذخیره شد برای ${student.first_name} ${student.last_name}`);
      }
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
}));

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
    if (chabokan.isMysqlEnabled()) {
      // MySQL students: the chat link is stored by student_id (see the webhook), never on the demo records.
      let sid = opts.studentId ? String(opts.studentId) : '';
      if (!sid) sid = String((await chabokan.findStudentByPhone(phone))?.id || '');
      chatId = (sid && (snapshot as any).rubika_links?.[sid]) || null;
    } else {
      const student = opts.studentId
        ? snapshot.students.find((s: any) => String(s.id) === String(opts.studentId))
        : snapshot.students.find((s: any) => normalizeMobile(s.phone_number) === phone);
      chatId = (student as any)?.rubika_chat_id || null;
    }
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

/** "۱۴۰۵/۷/۱۶" or "1405-7-16" -> "1405/07/16" (Latin digits, zero padded); '' for anything that is not a real date. */
function normalizeJalaliDate(v: unknown): string {
  return strictJalaliDate(v);
}
/** Today in Iran (Asia/Tehran), whatever the server's time zone. */
function jalaliNow(): string {
  return tehranJalaliToday();
}

/**
 * Date field from a request: empty -> `fallback` (today), a valid date -> "yyyy/mm/dd",
 * anything else -> `{ error }` with a Persian message for a 400 answer.
 */
function requestDate(v: unknown, label: string, fallback: () => string = jalaliNow): { value: string; error?: string } {
  const raw = sanitizeString(typeof v === 'number' ? String(v) : v, 30);
  if (!raw) return { value: fallback() };
  const value = normalizeJalaliDate(raw);
  return value ? { value } : { value: '', error: `${label} نامعتبر است؛ آن را به شکل سال/ماه/روز (مثلاً ۱۴۰۵/۰۷/۱۶) وارد کنید.` };
}
const coursePrice = (c: any): number => Number(c?.price ?? c?.tuition ?? 0);
/** MySQL returns 0/1 (not false/true) for the active flag. */
const courseIsActive = (c: any): boolean => {
  const v = c?.is_active ?? c?.active;
  return !(v === false || v === 0 || v === '0');
};

type StudentFields = {
  first_name?: string; last_name?: string; national_code?: string; phone_number?: string;
  father_name?: string; birth_date_jalali?: string; address?: string;
};

/**
 * Cleans and validates student input. `partial` (updates) only checks fields that were sent.
 * A national code that is not 10 digits is an error; a failing checksum is only a warning (staff entry,
 * legacy cards), returned to the client in `warnings`.
 */
function parseStudentInput(body: any, partial: boolean): { data: StudentFields; error?: string; warnings: string[] } {
  const warnings: string[] = [];
  const b = body && typeof body === 'object' ? body : {};
  const data: StudentFields = {};
  const sent = (k: string) => b[k] !== undefined && b[k] !== null && String(b[k]).trim() !== '';

  for (const [key, label] of [['first_name', 'نام'], ['last_name', 'نام خانوادگی']] as const) {
    // Names are stored as one clean line (no newlines/control characters, no outer spaces).
    if (sent(key) && cleanText(b[key], 80)) data[key] = cleanText(b[key], 80);
    else if (!partial) return { data, error: `${label} الزامی است.`, warnings };
  }
  if (sent('national_code')) {
    const checked = checkNationalCode(sanitizeString(String(b.national_code), 30));
    if (checked.error) return { data, error: checked.error, warnings };
    if (checked.warning) warnings.push(checked.warning);
    data.national_code = checked.code;
  } else if (!partial) return { data, error: 'کد ملی الزامی است.', warnings };
  if (sent('phone_number')) {
    const phone = toLatinDigits(sanitizeString(String(b.phone_number), 20)).replace(/[\s-]/g, '');
    if (!/^09\d{9}$/.test(phone)) return { data, error: 'شماره همراه باید ۱۱ رقم و با ۰۹ شروع شود.', warnings };
    data.phone_number = phone;
  } else if (!partial) return { data, error: 'شماره همراه الزامی است.', warnings };
  // Optional fields: an explicitly sent empty value clears the field.
  const present = (k: string) => b[k] !== undefined && b[k] !== null;
  if (present('father_name')) data.father_name = cleanText(b.father_name, 80);
  if (present('birth_date_jalali')) {
    const raw = sanitizeString(String(b.birth_date_jalali), 30);
    const date = raw ? normalizeJalaliDate(raw) : '';
    if (raw && !date) return { data, error: 'تاریخ تولد نامعتبر است؛ آن را به شکل سال/ماه/روز وارد کنید.', warnings };
    data.birth_date_jalali = date;
  }
  if (present('address')) data.address = cleanText(b.address, 400);
  return { data, warnings };
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

/** JSON store: what each of a student's enrollments still owes (clamped at 0, oldest first). */
function jsonStudentOwed(db: typeof initialDb, studentId: number) {
  const enrollments = db.enrollments.filter(e => e.student_id === studentId).sort((a, b) => a.id - b.id);
  const ids = new Set(enrollments.map(e => e.id));
  const payments = db.payments.filter(p => p.enrollment_id && ids.has(p.enrollment_id));
  return { order: enrollments.map(e => e.id), owed: owedByEnrollment(enrollments, payments) };
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
    const title = cleanText(b.title, 120);
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
    if (chabokan.isMysqlEnabled()) return res.json(redactForInstructor(req, 'students', await chabokan.listStudents()));
    res.json(redactForInstructor(req, 'students', readDb().students));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

const sameCode = (s: any, code: string | undefined) => !!code && normalizeNationalCode(s?.national_code) === code;

app.post('/api/students', asyncHandler(async (req, res) => {
  const { data, error, warnings } = parseStudentInput(req.body, false);
  if (error) return res.status(400).json({ error });

  if (chabokan.isMysqlEnabled()) {
    // Same national code = same person (e.g. a second course): the existing record is reused. The lookup
    // and the insert run in one locked transaction, so two concurrent submits cannot both insert.
    const { student, alreadyExists } = await chabokan.insertStudent({ ...req.body, ...data });
    return res.json({ status: 'success', ...(alreadyExists ? { already_exists: true } : {}), student, warnings });
  }
  const db = readDb();
  const existing = db.students.find(s => sameCode(s, data.national_code));
  if (existing) return res.json({ status: 'success', already_exists: true, student: existing, warnings });
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
  res.json({ status: 'success', student: newStudent, warnings });
}));


app.put('/api/students/:id', asyncHandler(async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const current = (await loadStudents()).find(s => Number(s.id) === studentId);
  if (!current) return res.status(404).json({ error: 'Student not found' });
  // The edit form sends the whole record back: an old birth date in a free-text format is kept as it is
  // unless it was changed.
  const body = { ...(req.body || {}) };
  if (body.birth_date_jalali !== undefined && String(body.birth_date_jalali ?? '') === String(current.birth_date_jalali ?? '')) {
    delete body.birth_date_jalali;
  }
  const { data, error, warnings } = parseStudentInput(body, true);
  if (error) return res.status(400).json({ error });
  if (chabokan.isMysqlEnabled()) {
    // updateStudent writes every column, so start from the stored record and apply only what was sent.
    // It re-checks the national code against other students under the same lock as the insert.
    try {
      const student = await chabokan.updateStudent(studentId, {
        first_name: current.first_name, last_name: current.last_name, national_code: current.national_code,
        phone_number: current.phone_number, address: current.address, father_name: current.father_name,
        birth_date_jalali: current.birth_date_jalali,
        ...data,
      });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      return res.json({ status: 'success', student, warnings });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  }
  const hasStatus = body.status !== undefined && body.status !== null && body.status !== '';
  if (hasStatus && !['active', 'suspended', 'graduated'].includes(body.status)) {
    return res.status(400).json({ error: 'وضعیت کارآموز نامعتبر است.' });
  }
  const db = readDb();
  const codeChanged = !!data.national_code && data.national_code !== normalizeNationalCode(current.national_code);
  if (codeChanged && db.students.some(s => sameCode(s, data.national_code) && s.id !== studentId)) {
    return res.status(409).json({ error: 'کارآموز دیگری با این کد ملی ثبت شده است.' });
  }
  const index = db.students.findIndex(s => s.id === studentId);
  if (index === -1) return res.status(404).json({ error: 'Student not found' });
  db.students[index] = {
    ...db.students[index],
    ...data,
    status: hasStatus ? body.status : db.students[index].status,
  };
  writeDb(db);
  res.json({ status: 'success', student: db.students[index], warnings });
}));

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
// The student must exist before multer creates a folder or writes a file for it.
const requireExistingStudent = asyncHandler(async (req, res, next) => {
  const studentId = /^\d+$/.test(req.params.id) ? parseInt(req.params.id, 10) : 0;
  const exists = studentId > 0 && (chabokan.isMysqlEnabled()
    ? await chabokan.studentExists(studentId)
    : readDb().students.some(s => s.id === studentId));
  if (!exists) return res.status(404).json({ error: 'Student not found' });
  next();
});

app.post('/api/students/:id/photos', requireExistingStudent, uploadStudentMedia.fields([
  { name: 'idCard', maxCount: 1 },
  { name: 'personal', maxCount: 1 }
]), async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  try {
    const studentId = parseInt(req.params.id, 10);
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
      instructorPhotos = null;
      const student = await chabokan.listStudents().then((list) => list.find((s: any) => Number(s.id) === studentId));
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

    const signup = requestDate(b.signup_date_jalali, 'تاریخ ثبت‌نام');
    if (signup.error) return res.status(400).json({ error: signup.error });
    const signupDate = signup.value;
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
    if (chabokan.isMysqlEnabled()) return res.json(redactForInstructor(req, 'enrollments', await chabokan.listEnrollments()));
    res.json(redactForInstructor(req, 'enrollments', readDb().enrollments));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 7. POST payments (always for one enrollment; at most what is still owed on it and by the student)
app.post('/api/payments', asyncHandler(async (req, res) => {
  const paymentData = req.body || {};
  const studentId = parseInt(paymentData.student_id ?? paymentData.studentId, 10);
  if (!studentId) return res.status(400).json({ error: 'کارآموز پرداخت مشخص نیست.' });
  const rawAmount = paymentData.amount;
  const amount = typeof rawAmount === 'number' || typeof rawAmount === 'string' ? Math.round(Number(rawAmount)) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'مبلغ پرداخت باید بیشتر از صفر باشد.' });
  // Every payment belongs to one enrollment (course registration); unlinked payments are not accepted.
  const linkedEnrollmentId = /^\d+$/.test(String(paymentData.enrollment_id ?? '')) ? parseInt(paymentData.enrollment_id, 10) : 0;
  if (!linkedEnrollmentId) return res.status(400).json({ error: 'دوره (ثبت‌نام) مربوط به این پرداخت را انتخاب کنید.' });
  const payDate = requestDate(paymentData.pay_date_jalali, 'تاریخ پرداخت');
  if (payDate.error) return res.status(400).json({ error: payDate.error });
  const payMethod = sanitizeString(paymentData.pay_method ?? paymentData.paymentMethod, 40) || 'pos';
  const paymentKind = sanitizeString(paymentData.payment_kind, 40) || 'downpayment';
  const description = sanitizeString(paymentData.description ?? paymentData.notes, 400);
  const overpayError = (remaining: number) => remaining > 0
    ? `مبلغ پرداختی از مانده شهریه (${remaining.toLocaleString('fa-IR')} تومان) بیشتر است.`
    : 'برای این کارآموز مانده‌ای برای پرداخت وجود ندارد.';

  if (chabokan.isMysqlEnabled()) {
    // Check + every part + the cached amount_paid in one transaction with the enrollment rows locked.
    try {
      const rows = await chabokan.insertPaymentAtomic({
        studentId, linkedEnrollmentId, amount, payDate: payDate.value, payMethod, paymentKind, description,
      });
      return res.json({ ...rows[0], allocations: rows.length });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  }

  const db = readDb();
  if (!db.students.some(s => s.id === studentId)) return res.status(404).json({ error: 'کارآموز یافت نشد.' });
  if (linkedEnrollmentId) {
    const enr = db.enrollments.find(e => e.id === linkedEnrollmentId);
    if (!enr || enr.student_id !== studentId) return res.status(404).json({ error: 'ثبت‌نام مربوط به این کارآموز یافت نشد.' });
  }
  const { order, owed } = jsonStudentOwed(db, studentId);
  const remaining = payableAmount(owed, linkedEnrollmentId);
  if (amount > remaining) return res.status(400).json({ error: overpayError(remaining) });
  const parts = splitPayment(order, owed, amount, linkedEnrollmentId);
  const created = parts.map((part, i) => ({
    id: (db.payments.length > 0 ? Math.max(...db.payments.map(p => p.id)) : 0) + 1 + i,
    student_id: studentId,
    enrollment_id: part.enrollmentId,
    amount: part.amount,
    pay_date_jalali: payDate.value,
    pay_method: payMethod,
    payment_kind: paymentKind,
    description,
  }));
  db.payments.push(...created);
  writeDb(db);
  res.json({ ...created[0], allocations: created.length });
}));

app.get('/api/payments', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listPayments());
    // Only payments of an existing enrollment count (same rule as the MySQL listing).
    const db = readDb();
    const ids = new Set(db.enrollments.map(e => e.id));
    res.json(db.payments.filter(p => p.enrollment_id && ids.has(p.enrollment_id)));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

const toEnglishDigits = ocrLatinDigits;
const validNationalCode = isValidNationalCode;

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

const OCR_FIELDS_PROMPT = `این تصویر کارت ملی هوشمند ایران است (افقی). فقط یک JSON برگردان، بدون توضیح و بدون markdown.
جای فیلدها: برچسب‌های فارسی در سمت راست هر سطر چاپ شده‌اند و مقدار هر فیلد در سمت چپ همان برچسب است:
- «شماره ملی» (۱۰ رقم)
- «نام» (ممکن است یک کلمهٔ مرکب باشد مثل محمدسینا؛ آن را جدا نکن)
- «نام خانوادگی» (ممکن است دو کلمه با یک فاصله باشد؛ فاصله را حفظ کن)
- «تاریخ تولد» (سال/ماه/روز شمسی)
- «نام پدر»
- «پایان اعتبار» (سال/ماه/روز شمسی)
ارقام با یک فونت درشت و تزئینی چاپ شده‌اند (گلیف‌های فارسی-هندی؛ مثلا ۴ شبیه «ع»، ۵ شبیه قلب، ۲ شبیه r). رقم‌ها را یکی‌یکی و با دقت بخوان.
رنگ پس‌زمینه، آرم و طرح کارت ممکن است متفاوت باشد؛ به آن‌ها توجه نکن. تصویر ممکن است تار یا دارای انعکاس نور باشد.
national_code و تاریخ‌ها را با ارقام انگلیسی (لاتین) بنویس؛ تاریخ‌ها به شکل yyyy/mm/dd.
اگر فیلدی را با اطمینان نخواندی، رشتهٔ خالی بگذار؛ هیچ مقداری را حدس نزن و رقمی را از خودت نساز.
خروجی:
{
  "readable": true,
  "first_name": "",
  "last_name": "",
  "national_code": "",
  "father_name": "",
  "birth_date_jalali": "",
  "card_expiry_jalali": "",
  "confidence": 0.0,
  "field_confidence": { "first_name": 0.0, "last_name": 0.0, "national_code": 0.0, "father_name": 0.0, "birth_date_jalali": 0.0, "card_expiry_jalali": 0.0 }
}
readable را false بگذار اگر تصویر یک کارت ملی خوانا نیست. confidence و field_confidence عدد بین ۰ و ۱ هستند.`;

const OCR_FOCUSED_PROMPT = `در این تصویر کارت ملی هوشمند ایران، فقط این سه مورد را دوباره و با دقت بخوان:
۱) «شماره ملی» که ۱۰ رقم است و با فونت درشت و تزئینی چاپ شده (ارقام فارسی-هندی؛ مثلا ۴ شبیه «ع»، ۵ شبیه قلب، ۲ شبیه r). هر رقم را جداگانه، از راست به چپ بخوان.
۲) «تاریخ تولد» شمسی.
۳) «پایان اعتبار» شمسی.
به رنگ پس‌زمینه و آرم کارت وابسته نباش. اگر رقمی را نمی‌توانی بخوانی، digit آن را رشتهٔ خالی و confidence را کم بگذار؛ حدس نزن.
فقط JSON، تاریخ‌ها و ارقام با اعداد لاتین:
{
  "digits": [ { "digit": "", "confidence": 0.0 } ],
  "national_code": "",
  "birth_date_jalali": "yyyy/mm/dd",
  "card_expiry_jalali": "yyyy/mm/dd",
  "confidence": 0.0
}
آرایهٔ digits باید دقیقاً ۱۰ عنصر به ترتیب خواندن داشته باشد.`;

/** One Gemini read of the card. `pass` picks the prompt; the focused pass tries the stronger model first. */
async function ocrWithGemini(fileBuffer: Buffer, mimeType: string, pass: 'full' | 'focused' = 'full', deadlineMs = Infinity): Promise<Record<string, any> | null> {
  if (!ai) return null;
  const models = [...new Set([...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'])];
  const prompt = pass === 'focused' ? OCR_FOCUSED_PROMPT : OCR_FIELDS_PROMPT;
  for (let k = 0; k < geminiClients.length; k++) {
    if (Date.now() < geminiCooldownUntil[k]) continue;
    for (const model of models) {
      if (Date.now() > deadlineMs) return null;
      try {
        const response = await geminiClients[k].models.generateContent({
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
        const msg = String(err?.message || err);
        console.warn('Gemini OCR failed', `key#${k + 1}`, model, msg.slice(0, 160));
        // Quota / invalid key: park this key for a while and try the next one.
        if (/429|RESOURCE_EXHAUSTED|quota|API key|\b(401|403)\b/i.test(msg)) {
          geminiCooldownUntil[k] = Date.now() + 10 * 60 * 1000;
          break;
        }
      }
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
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(uploaded.path);
  } catch (err: any) {
    console.error('OCR upload could not be read:', err?.message || err);
    return res.status(500).json({ success: false, error: 'فایل ارسالی خوانده نشد؛ دوباره تلاش کنید.' });
  } finally {
    // The scan is only needed for this request; don't keep national-card images in /uploads.
    removeUploadedFiles(files); // the client sends the same scan under two field names
  }
  try {
    const mime = uploaded.mimetype || 'image/jpeg';
    const result = await runCardOcr({
      gemini: (pass, deadline) => ocrWithGemini(fileBuffer, mime, pass, deadline),
      vision: () => ocrWithCloudVision(fileBuffer),
      today: jalaliNow(),
    });
    const hasAny = !!(result && (result.first_name || result.last_name || result.national_code));
    if (!result || !hasAny) {
      return res.status(422).json({
        success: false,
        error: 'خواندن کارت ملی ناموفق بود. اطلاعات را دستی وارد کنید.',
        first_name: '', last_name: '', national_code: '', father_name: '', birth_date_jalali: '', card_expiry_jalali: '',
        card_expired: false, confidence: 0, field_warnings: {}, needs_review: true,
      });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('National card OCR failed:', (error as any)?.message || error);
    return res.status(422).json({
      success: false,
      error: 'خواندن کارت ملی ناموفق بود. اطلاعات را دستی وارد کنید.',
      first_name: '', last_name: '', national_code: '', father_name: '', birth_date_jalali: '', card_expiry_jalali: '',
      card_expired: false, confidence: 0, field_warnings: {}, needs_review: true,
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
  if (incoming.contract_text !== undefined) incoming.contract_text = typeof incoming.contract_text === 'string' ? incoming.contract_text.replace(/\r\n/g, '\n').trim().slice(0, 6000) : '';
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

// 11. GET enrollment report context (the receipt data of one enrollment)
app.get('/api/enrollments/:id/report-context', asyncHandler(async (req, res) => {
  const enrollmentId = parseInt(req.params.id, 10);
  if (!enrollmentId) return res.status(400).json({ error: 'Invalid enrollment id' });
  let settings: any = {};
  try { settings = publicSettings(readDb().settings); } catch {}
  if (chabokan.isMysqlEnabled()) {
    // MySQL holds the real records; db_store.json only has demo enrollments/students.
    const ctx = await chabokan.getEnrollmentReportContext(enrollmentId);
    if (!ctx) return res.status(404).json({ error: 'Enrollment not found' });
    return res.json({ ...ctx, settings, timestamp: new Date().toISOString() });
  }
  const db = readDb();
  const enrollment = db.enrollments.find(e => e.id === enrollmentId);
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
  const student = db.students.find(s => s.id === enrollment.student_id);
  const course = db.courses.find(c => c.id === enrollment.course_id);
  const payments = db.payments.filter(p => p.student_id === enrollment.student_id && p.enrollment_id === enrollmentId);
  res.json({
    enrollment,
    student: student || null,
    course: course || null,
    payments,
    settings,
    timestamp: new Date().toISOString(),
  });
}));

// 12. Upload one of the three registration PDFs (Receipt | IDCard | Contract) of an enrollment.
// The target folder and file name come from the enrollment itself (course number, student last name and id), never from the client.
async function loadEnrollmentForPdf(enrollmentId: number) {
  if (chabokan.isMysqlEnabled()) {
    const ctx = await chabokan.getEnrollmentReportContext(enrollmentId);
    return ctx ? { enrollment: ctx.enrollment as any, student: ctx.student as any } : null;
  }
  const db = readDb();
  const enrollment = db.enrollments.find(e => e.id === enrollmentId);
  if (!enrollment) return null;
  return { enrollment: enrollment as any, student: db.students.find(s => s.id === enrollment.student_id) as any };
}

function pdfPathsOf(enrollment: any) {
  return {
    receipt_pdf_path: enrollment?.receipt_pdf_path || '',
    idcard_pdf_path: enrollment?.idcard_pdf_path || '',
    contract_pdf_path: enrollment?.contract_pdf_path || '',
  };
}

app.post('/api/enrollments/:id/receipt', uploadReceipt.single('pdf'), asyncHandler(async (req, res) => {
  const enrollmentId = parseInt(req.params.id, 10);
  if (!req.file) return res.status(400).json({ error: 'فایل PDF ارسال نشد.' });
  if (!enrollmentId) return res.status(400).json({ error: 'شناسه ثبت‌نام نامعتبر است.' });
  const kind: DocKind | null = req.body?.kind === undefined || req.body?.kind === '' ? 'Receipt' : parseDocKind(req.body.kind);
  if (!kind) return res.status(400).json({ error: 'نوع سند نامعتبر است (Receipt، IDCard یا Contract).' });
  const buf = req.file.buffer;
  if (!buf || buf.length < 100 || buf.length > MAX_REGISTRATION_PDF_BYTES) return res.status(400).json({ error: 'اندازه فایل PDF مجاز نیست.' });
  if (!isPdfBytes(buf.subarray(0, 5))) return res.status(400).json({ error: 'فایل ارسالی PDF معتبر نیست.' });

  const ctx = await loadEnrollmentForPdf(enrollmentId);
  if (!ctx) return res.status(404).json({ error: 'ثبت‌نام پیدا نشد.' });
  const { enrollment, student } = ctx;
  if (!student) return res.status(404).json({ error: 'کارآموز این ثبت‌نام پیدا نشد.' });

  const field = DOC_PATH_FIELDS[kind];
  const target = registrationPdfRelPath({ courseNumber: enrollment.course_number, lastName: student.last_name, studentId: student.id, kind });
  const dirAbs = path.join(process.cwd(), target.dir);
  if (!path.resolve(dirAbs).startsWith(studentFilesBase + path.sep)) return res.status(400).json({ error: 'مسیر ذخیره نامعتبر است.' });

  // The enrollment's own previous file of this kind is replaced. Any other file with the target name (another enrollment of
  // the same student in the same course number) is never overwritten: the new file gets a free name instead.
  const previous = String(enrollment[field] || '');
  const decode = (p: string) => { try { return decodeURIComponent(p.split(/[?#]/)[0]); } catch { return ''; } };
  const previousAbs = previous ? path.resolve(process.cwd(), decode(previous).replace(/^\/+/, '')) : '';
  fs.mkdirSync(dirAbs, { recursive: true });
  let fileName = target.file;
  if (fs.existsSync(path.join(dirAbs, fileName)) && path.resolve(dirAbs, fileName) !== previousAbs) {
    fileName = freeFileName(dirAbs, target.base, '.pdf');
  }
  const finalAbs = path.join(dirAbs, fileName);
  const tmpAbs = `${finalAbs}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const publicPath = `/${target.dir}/${fileName}`;
  try {
    fs.writeFileSync(tmpAbs, buf);
    fs.renameSync(tmpAbs, finalAbs);
  } catch (err: any) {
    try { fs.unlinkSync(tmpAbs); } catch {}
    return res.status(500).json({ error: 'ذخیره فایل PDF روی سرور ناموفق بود.' });
  }
  try {
    if (chabokan.isMysqlEnabled()) {
      await chabokan.updateEnrollmentPdfPath(enrollmentId, field, publicPath);
    } else {
      const db = readDb();
      const index = db.enrollments.findIndex(e => e.id === enrollmentId);
      if (index === -1) throw new Error('Enrollment not found');
      (db.enrollments[index] as any)[field] = publicPath;
      writeDb(db);
    }
  } catch (err: any) {
    // Do not leave a file nobody points to (unless it replaced the file the enrollment already pointed at).
    if (path.resolve(finalAbs) !== previousAbs) { try { fs.unlinkSync(finalAbs); } catch {} }
    return res.status(500).json({ error: err?.message || 'ثبت مسیر فایل در پایگاه داده ناموفق بود.' });
  }
  // Drop the replaced file when it lived elsewhere (older name or the former uploads/ location).
  if (previous && previousAbs && previousAbs !== path.resolve(finalAbs)) {
    unlinkStoredFile(previous, studentFilesBase);
    unlinkStoredFile(previous, uploadsDir);
  }
  const paths = { ...pdfPathsOf(enrollment), [field]: publicPath };
  res.json({ kind, path: publicPath, ...paths });
}));

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
  const expenseDate = requestDate(expenseData.pay_date_jalali ?? expenseData.expenseDate ?? expenseData.expensedate, 'تاریخ هزینه');
  if (expenseDate.error) return res.status(400).json({ error: expenseDate.error });
  try {
  if (chabokan.isMysqlEnabled()) {
    return res.json(await chabokan.insertExpense({
      title, amount,
      pay_method: sanitizeString(expenseData.pay_method ?? expenseData.category, 80),
      description: sanitizeString(expenseData.description ?? expenseData.notes, 400),
      pay_date_jalali: expenseDate.value,
    }));
  }
  const db = readDb();
  const newExpense = {
    id: db.expenses.length > 0 ? Math.max(...db.expenses.map(ex => ex.id)) + 1 : 1,
    title,
    amount,
    pay_method: sanitizeString(expenseData.pay_method ?? expenseData.category, 80) || 'کارت بانکی',
    pay_date_jalali: expenseDate.value,
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
        // An existing file with this name may belong to another (renumbered) student: take a free name.
        // COPYFILE_EXCL still refuses to overwrite if the name was taken in between.
        const base = `${safeSegment(t.lastName, 'Student')}_${safeSegment(t.studentId, String(Date.now()))}_${suffix}`;
        const ext = (path.extname(src) || '.jpg').toLowerCase();
        let dest = path.join(dir, freeFileName(dir, base, ext));
        try {
          fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        } catch (err: any) {
          if (err?.code !== 'EEXIST') throw err;
          // Taken in between: copy under a random name instead of dropping the photo (never overwrite).
          console.warn(`Registration photo name taken, using a new name: ${dest}`);
          dest = path.join(dir, `${base}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
          fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        }
        out.created.push(dest);
        return `/${path.relative(process.cwd(), dest).split(path.sep).join('/')}`;
      } catch (err: any) {
        console.error(`Registration photo copy failed (${suffix}, student ${t.studentId}):`, err?.message || err);
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
    const signup = requestDate(b.signup_date_jalali, 'تاریخ ثبت‌نام');
    if (signup.error) return res.status(400).json({ error: signup.error });

    const result = await chabokan.approveWebsiteRegistration({
      trackingCode: code,
      staffUsername: String((req as any).user?.username || ''),
      courseId,
      courseNumber,
      finalPrice,
      signupDate: signup.value,
      overrides: data,
      updateExisting: b.update_existing === true,
      copyFiles: copyRegistrationFiles,
    });
    // Committed: the welcome SMS lookup must not turn the approval into an error.
    loadCourses()
      .then((courses) => notifyRegistration(result.student, courses.find(c => Number(c.id) === courseId)))
      .catch((err) => console.warn('Registration SMS skipped:', err?.message || err));
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
  const saved: any = (db as any).dashboard || {};
  const hadNotes = (Array.isArray(saved.tasks) && saved.tasks.length > 0) || (Array.isArray(saved.events) && saved.events.length > 0);
  // Empty lists never replace saved notes unless the user explicitly cleared them (a client that failed
  // to load would otherwise wipe everyone's notes).
  if (!tasks.length && !events.length && hadNotes && req.body?.cleared !== true) {
    return res.status(409).json({ error: 'یادداشت‌های ذخیره‌شده با فهرست خالی جایگزین نشد.' });
  }
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

// Last resort for /api and file routes (thrown or rejected handlers): always JSON, never Express' HTML page.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent || !/^\/(api|uploads|StudentFiles)(\/|$)/i.test(req.path)) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) console.error(`${req.method} ${req.path} failed:`, err?.message || err);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status < 500 && err?.message ? err.message : 'خطای داخلی سرور؛ دوباره تلاش کنید.',
  });
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
