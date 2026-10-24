import express from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { execFile, spawn } from 'child_process';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as chabokan from './mysql-socks';
import { createSms, toBracket, fromBracket, resolveApiKey } from '../shared/sms';
import { runCopilotSql, COPILOT_SQL_SCHEMA } from './copilot-sql';
import { getSiteAnalytics, umamiEnabled } from './copilot-umami';
import { copilotDateRule } from './src/utils/copilotDate';
import { persianizeCodes } from './src/utils/labels';
import { dbhubSelected, getDbhubTools, isDbhubTool, callDbhubTool } from './copilot-mcp';
import { registerPhase4, ensurePhase4Schema, maskPhone } from './phase4';
import { registerCourseTerms, ensureCourseTermsSchema } from './courseTerms';
import {
  ensureThemeSettingsSchema,
  readThemeConfig,
  writeThemeConfig,
  normalizeTheme,
  uploadThemeLogo,
  removeThemeLogos,
  removeOtherThemeLogos,
  THEME_LOGO_DIR,
  type ThemeConfig,
} from './theme';
import { registerInstructorPay, ensureInstructorPaySchema } from './instructorPay';
import { registerOnlinePayments, ensureOnlinePaymentsSchema } from './onlinePayments';
import { ensureInstallmentsSchema, createInstallmentStore } from './installments';
import { registerDebtSms, ensureDebtSmsSchema, createDebtLinkStore } from './debtSms';
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
      timeout: 15000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
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
    const isIdCard = file.fieldname === 'idCard' || file.fieldname === 'id_card_photo' || file.fieldname === 'idCardOriginal';
    // Originals are kept on disk next to the cropped file (no DB column), e.g. Name_12_Photo_orig.jpg.
    const orig = file.fieldname.endsWith('Original') ? '_orig' : '';
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, freeFileName(studentUploadDir(req), `${lastName}_${studentId}_${isIdCard ? 'ID' : 'Photo'}${orig}`, ext));
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
    // Uncropped original saved beside the photo (see studentPhotoStorage).
    const orig = typeof student?.[key] === 'string' ? student[key].replace(/(_ID|_Photo)(\.[a-z]+)$/i, '$1_orig$2') : '';
    if (orig && orig !== student[key]) unlinkStoredFile(orig, studentFilesBase);
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
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
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

/** Trainee online installment (Zarinpal or uploaded receipt) awaiting a cashier's approval. */
interface OnlinePayment {
  id: number;
  student_id: number;
  enrollment_id: number;
  amount: number;
  method: 'zarinpal' | 'receipt';
  authority?: string | null;
  ref_id?: string | null;
  receipt_file?: string | null;
  status: 'pending' | 'paid' | 'approved' | 'rejected';
  admin_note?: string | null;
  created_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
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
    theme?: ThemeConfig;
  };
  courses: Course[];
  students: Student[];
  enrollments: Enrollment[];
  payments: Payment[];
  expenses: Expense[];
  reportTemplates: ReportTemplate[];
  staff_users: StaffUserRecord[];
  online_payments: OnlinePayment[];
}

// Initial Seed Data
const initialDb: DatabaseSchema = {
  settings: {
    academy_name: '',
    logo_url: '',
    phone_number: '',
    address: '',
    header_text: '',
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
    { key: 'standard_receipt', title: 'فیش پرداخت رسمی هنرجو (A5)', category: 'receipt', active: true, body: '<div class="receipt-print">...</div>' },
    { key: 'standard_contract', title: 'قرارداد رسمی آموزش رانندگی', category: 'contract', active: true, body: '<div class="contract-print">...</div>' },
  ],
  staff_users: [],
  online_payments: [],
};

// Helper function to read/write DB
function parseDbFile(file: string): typeof initialDb {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.staff_users)) parsed.staff_users = [];
  if (!Array.isArray(parsed.online_payments)) parsed.online_payments = [];
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

/** Audit trail of every write (who, what endpoint, result). No bodies, so no personal data or secrets. */
app.use('/api', (req, res, next) => {
  const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (!write || req.path === '/messenger/webhook' || req.path === '/messenger/account-ingest' || req.path === '/auth/file-token') return next();
  const apiPath = req.path; // relative to /api; Express restores req.path to the full URL after routing
  res.on('finish', () => {
    const session = sessionFromRequest(req);
    const segs = apiPath.split('/').filter(Boolean);
    const username = session?.username
      || (apiPath === '/auth/login' ? sanitizeString(req.body?.username, 80) || null : null);
    void chabokan.insertAudit({
      username, role: session?.role || null, method: req.method, path: apiPath,
      entity: segs[0] ? segs[0].slice(0, 40) : null, entity_id: segs[1] ? segs[1].slice(0, 64) : null,
      status: res.statusCode, ip: String(req.ip || '').slice(0, 64) || null,
    });
  });
  next();
});


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

/** Pending messages awaiting admin confirmation (copilot send tools). */
interface PendingMessage {
  id: string;
  createdBy: string;
  channel: 'telegram' | 'rubika' | 'sms';
  recipient: string;
  /** channel=sms: one item per recipient (max 20); sent only on human confirm. */
  sms?: { items: { mobile: string; label: string; studentId?: number | null; text: string }[]; templateKey?: string | null; vars?: Record<string, string> };
  label: string;
  text: string;
  createdAt: number;
  expiresAt: number;
}
const pendingMessages = new Map<string, PendingMessage>();
const PENDING_TTL_MS = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, msg] of pendingMessages) {
    if (now > msg.expiresAt) pendingMessages.delete(key);
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
    // 'file' and 'trainee' tokens are never staff sessions (the trainee routes check their own token).
    return data && data.kind !== 'file' && data.kind !== 'trainee' ? data : null;
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

// ── SSO from the public site's admin panel ──────────────────────────────────────────────────────────
// The site mints a one-time ticket: base64url(JSON{jti,exp,iss:'kermanshah-site'}).HMAC-SHA256(CRM_SSO_SECRET).
// Valid for at most 60s, single use (jti remembered in memory until expiry). The CRM session token is returned
// in the POST response body only, never in a URL. Maps to CRM_SSO_USER (a local staff username) or the env admin.
const ssoBuckets = new Map<string, { count: number; resetAt: number }>();
const ssoUsedJti = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of ssoUsedJti) if (now > exp) ssoUsedJti.delete(k);
  for (const [k, b] of ssoBuckets) if (now > b.resetAt) ssoBuckets.delete(k);
}, 60_000).unref();

function verifySsoTicket(ticket: string): { ok: true; jti: string; exp: number } | { ok: false; reason: string } {
  const secret = process.env.CRM_SSO_SECRET || '';
  if (secret.length < 32) return { ok: false, reason: 'not_configured' };
  const parts = String(ticket || '').split('.');
  if (parts.length !== 2 || parts[0].length > 400) return { ok: false, reason: 'malformed' };
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  let p: any;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  const now = Date.now();
  if (p?.iss !== 'kermanshah-site' || typeof p.jti !== 'string' || p.jti.length < 16 || typeof p.exp !== 'number') return { ok: false, reason: 'malformed' };
  if (now > p.exp || p.exp - now > 65_000) return { ok: false, reason: 'expired' };
  if (ssoUsedJti.has(p.jti)) return { ok: false, reason: 'reused' };
  return { ok: true, jti: p.jti, exp: p.exp };
}

app.post('/api/auth/sso', (req, res) => {
  if (overLimit(ssoBuckets, clientIp(req), 10)) return res.status(429).json({ error: 'Too many attempts' });
  const v = verifySsoTicket(String(req.body?.ticket || ''));
  if (!v.ok) { const reason = 'reason' in v ? v.reason : 'unknown'; console.warn(`[sso] rejected (${reason})`); return res.status(401).json({ error: 'ورود خودکار ناموفق بود؛ دوباره از پنل سایت تلاش کنید.' }); }
  ssoUsedJti.set(v.jti, v.exp + 5_000);
  const want = String(process.env.CRM_SSO_USER || '').trim();
  const envUser = process.env.CRM_ADMIN_USER || 'admin';
  if (want && want !== envUser) {
    const st = readDb().staff_users.find((s) => s.username.toLowerCase() === want.toLowerCase());
    if (!st || !st.is_active || !st.password_hash) { console.warn('[sso] rejected (mapped_user_missing)'); return res.status(401).json({ error: 'کاربر SSO در CRM پیدا نشد.' }); }
    const token = signToken({ username: st.username, role: st.role, user_id: st.id, source: 'local', pwv: passwordTag(st.password_hash), sso: true });
    console.log('[sso] success');
    return res.json({ token, user: { username: st.username, role: st.role, full_name: st.full_name } });
  }
  const token = signToken({ username: envUser, role: 'admin', source: 'env', pwv: envAdminPasswordTag(), sso: true });
  console.log('[sso] success');
  return res.json({ token, user: { username: envUser, role: 'admin', full_name: 'مدیر سیستم' } });
});

// GET form: does not consume the ticket, just hands it to the SPA, which exchanges it via POST.
app.get('/api/auth/sso', (req, res) => {
  if (overLimit(ssoBuckets, clientIp(req), 10)) return res.status(429).send('Too many attempts');
  const t = String(req.query.ticket || '');
  if (!/^[A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{20,100}$/.test(t)) return res.redirect(302, '/');
  return res.redirect(302, `/?sso_ticket=${encodeURIComponent(t)}`);
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
  if (path.startsWith('/online-payments')) return role === 'cashier'; // admin handled above
  if (path.startsWith('/debt-sms')) return role === 'cashier'; // settings writes are admin-only in the handler
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
  if (path.startsWith('/message-templates')) return role === 'cashier'; // staff can manage reply templates
  if (path.startsWith('/tasks')) return true; // handlers scope non-admins to their own tasks
  if (path.startsWith('/leads') || path.startsWith('/activities')) return role === 'cashier';
  if (path.startsWith('/campaigns')) return false; // admin only
  if (path.startsWith('/instructor-pay')) return false; // admin only (حق‌التدریس)
  if (path.startsWith('/course-terms')) return role === 'cashier' && !write; // writes: admin only
  if (path.startsWith('/copilot')) return role === 'cashier';
  if (path.startsWith('/courses') || path.startsWith('/health')) return !write;
  if (!write) return role === 'cashier';
  return false;
}

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  // Trainee payment routes carry their own signed trainee token (never a staff session).
  if (req.path.startsWith('/trainee-payments')) return next();
  if (req.path === '/health') return next();
  // The theme (and with it the login logo) is read by the public login screen, so it needs no session.
  if (req.path === '/settings/theme' && req.method === 'GET') return next();
  if (req.path === '/messenger/webhook') return next();
  if (req.path === '/messenger/account-ingest') return next();
  if (req.method === 'OPTIONS') return next();
  return requireAuth(req, res, next);
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/trainee-payments') || req.path === '/health' || (req.path === '/settings/theme' && req.method === 'GET') || req.path === '/messenger/webhook' || req.path === '/messenger/account-ingest' || req.method === 'OPTIONS') return next();
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

// The theme logo is shown on the public login screen (no session there), so /uploads/theme is
// served without a login. It MUST be registered before the protected /uploads route below.
if (!fs.existsSync(THEME_LOGO_DIR)) fs.mkdirSync(THEME_LOGO_DIR, { recursive: true });
app.use('/uploads/theme', express.static(THEME_LOGO_DIR));

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
  const mysqlStudent = chabokan.isMysqlEnabled() && (channel === 'rubika' || channel === 'telegram') && chat_id && sender_phone
    ? await chabokan.findStudentByPhone(normalizeMobile(sender_phone))
    : null;
  const db = readDb();
  if (!(db as any).messages) (db as any).messages = [];

  // The chat_id <-> student link decides who receives that student's messages, so it is only
  // accepted from a caller that knows the shared secret (MESSENGER_WEBHOOK_SECRET).
  // Telegram: the bot only forwards a phone the user shared as their own contact (contact.user_id === from.id).
  if (channel === 'telegram' && chat_id && sender_phone && mysqlStudent) {
    const tlinks = ((db as any).telegram_links ||= {}) as Record<string, string>;
    tlinks[String(mysqlStudent.id)] = String(chat_id).slice(0, 100);
    console.log(`[Telegram] chat_id linked for student ${mysqlStudent.id}`);
  }
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

// ── Main Rubika account (rubpy listener) -> messenger store. Loopback only + shared secret file. ──
const RUBIKA_STATE_DIR = process.env.RUBIKA_STATE_DIR || '/project/kermanshahcart/crm-data/rubika';
const INGEST_SECRET_FILE = path.join(RUBIKA_STATE_DIR, 'ingest.secret');
function ingestSecret(): string {
  try {
    if (!fs.existsSync(INGEST_SECRET_FILE)) {
      fs.mkdirSync(RUBIKA_STATE_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(INGEST_SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    return fs.readFileSync(INGEST_SECRET_FILE, 'utf8').trim();
  } catch { return ''; }
}
ingestSecret();
const rubikaAccountActive = () => (readDb().settings as any)?.gateways?.rubika_account_active !== false;
const stableThreadId = (guid: string) => 9e12 + (parseInt(crypto.createHash('sha1').update(guid).digest('hex').slice(0, 10), 16) % 1e12);

/** Phone -> person in the shared MySQL DB (students, registrations, legacy TblStudents, leads); JSON store fallback. */
async function lookupPerson(k: string): Promise<chabokan.PhonePerson | null> {
  if (!k) return null;
  if (chabokan.isMysqlEnabled()) { try { return await chabokan.findPersonByPhone(k); } catch { return null; } }
  const st: any = readDb().students.find((s: any) => chabokan.mobileKey(s.phone_number) === k);
  return st ? { kind: 'student', id: st.id, student_id: st.id, name: `${st.first_name} ${st.last_name}`.trim() } : null;
}
function applyPersonLink(db: any, th: any, p: chabokan.PhonePerson | null) {
  if (!p) return;
  th.person = { kind: p.kind, id: p.id, name: p.name };
  if (p.name) th.title = p.name;
  if (p.student_id) {
    th.student_id = p.student_id;
    const linkKey = th.source === 'bot' ? 'rubika_links' : 'rubika_account_links';
    ((db[linkKey] ||= {}) as Record<string, string>)[String(p.student_id)] = th.external_id;
  }
}
/** Re-match every account thread by phone (after a phone sync or DB change). */
async function relinkAccountThreads(): Promise<{ total: number; withPhone: number; linked: number; students: number }> {
  const snap = readDb() as any;
  const keys = [...new Set(((snap.threads || []) as any[]).filter(t => t.source === 'account' || t.source === 'bot').map(t => chabokan.mobileKey(t.phone)).filter(Boolean))];
  const persons: Record<string, chabokan.PhonePerson | null> = {};
  for (const k of keys) persons[k] = await lookupPerson(k);
  const db = readDb() as any;
  const threads = ((db.threads || []) as any[]).filter(t => t.source === 'account' || t.source === 'bot');
  for (const th of threads) { const k = chabokan.mobileKey(th.phone); if (k) applyPersonLink(db, th, persons[k]); }
  for (const m of (db.messages || []) as any[]) {
    if (m.source !== 'account' && m.source !== 'bot') continue;
    const th = threads.find(t => t.source === m.source && t.external_id === m.chat_id);
    if (th) { m.chat_title = th.title; if (th.student_id) m.student_id = th.student_id; if (m.direction !== 'out') m.sender = th.title; }
  }
  writeDb(db);
  return { total: threads.length, withPhone: threads.filter(t => t.phone).length, linked: threads.filter(t => t.person).length, students: threads.filter(t => t.student_id).length };
}

/** Stores account messages (deduped by ext_id) and upserts their threads; links chats to students by phone. */
/** Rubika message id = the numeric tail of ext_id "<guid>:<message_id>" (bot/local ids have none). */
function rubikaMsgIdOf(extId: unknown): string | null {
  const m = /^[a-zA-Z0-9_]+:(\d{6,})$/.exec(String(extId || ''));
  return m ? m[1] : null;
}

async function storeAccountMessages(items: any[]): Promise<number> {
  const clean = items.filter(m => m && m.chat_id && m.text && m.ext_id).slice(0, 500);
  const persons: Record<string, chabokan.PhonePerson | null> = {};
  for (const m of clean) {
    const k = chabokan.mobileKey(m.phone);
    if (k && !(k in persons)) persons[k] = await lookupPerson(k);
  }
  const db = readDb();
  const messages = ((db as any).messages ||= []) as any[];
  const threads = ((db as any).threads ||= []) as any[];
  const seen = new Set(messages.filter(m => m.ext_id).map(m => m.ext_id));
  let added = 0;
  for (const m of clean) {
    const extId = sanitizeString(String(m.ext_id), 120);
    const chatId = sanitizeString(String(m.chat_id), 100);
    const title = sanitizeString(m.title || '', 100) || 'کاربر روبیکا';
    const k = chabokan.mobileKey(m.phone);
    const phone = k ? `0${k}` : '';
    const out = m.direction === 'out';
    const when = new Date(Number(m.time) || Date.now()).toISOString();
    const src = m.source === 'bot' ? 'bot' : 'account';
    let th = threads.find(t => t.source === src && t.external_id === chatId);
    if (!th) {
      th = { thread_id: stableThreadId(src === 'bot' ? `bot:${chatId}` : chatId), source: src, channel: 'rubika', external_id: chatId, title, phone, unread_count: 0, updated_at: when, last_message_text: '' };
      threads.push(th);
    }
    if (phone && !th.phone) th.phone = phone;
    if (title && title !== 'کاربر روبیکا' && !th.person) th.title = title;
    applyPersonLink(db, th, k ? persons[k] : null);
    if (seen.has(extId)) continue;
    seen.add(extId); added++;
    if (th.contact_only) delete th.contact_only;
    messages.push({
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000), ext_id: extId, source: src, channel: 'rubika',
      chat_id: chatId, chat_title: th.title, student_id: th.student_id, sender: out ? 'admin' : th.title, direction: out ? 'out' : 'in',
      sender_phone: th.phone || '', message: sanitizeString(String(m.text), 2000), received_at: when, ...(out ? { status: 'sent' } : {}),
      ...(rubikaMsgIdOf(extId) ? { rubika_message_id: rubikaMsgIdOf(extId) } : {}),
      ...(m.media && typeof m.media === 'object' ? { media: {
        type: sanitizeString(String(m.media.type || 'File'), 20), mime: sanitizeString(String(m.media.mime || ''), 40),
        file_name: sanitizeString(String(m.media.file_name || ''), 120), size: Number(m.media.size) || 0 } } : {}),
    });
    if (when >= (th.updated_at || '')) { th.updated_at = when; th.last_message_text = sanitizeString(String(m.text), 200); }
    if (!out && Date.now() - Date.parse(when) < 10 * 60 * 1000) th.unread_count = (th.unread_count || 0) + 1;
  }
  if (added) {
    messages.sort((a, b) => String(a.received_at || '').localeCompare(String(b.received_at || '')));
    if (messages.length > MAX_STORED_MESSAGES) messages.splice(0, messages.length - MAX_STORED_MESSAGES);
  }
  writeDb(db);
  return added;
}

app.post('/api/messenger/account-ingest', asyncHandler(async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) || req.headers['x-forwarded-for']) return res.status(403).json({ error: 'Forbidden' });
  const secret = ingestSecret();
  const given = Buffer.from(String(req.headers['x-ingest-secret'] || ''));
  if (!secret || given.length !== Buffer.byteLength(secret) || !crypto.timingSafeEqual(given, Buffer.from(secret))) return res.status(401).json({ error: 'Unauthorized' });
  // Bot messages (ker.py) are always stored; account messages only while the account is switched on.
  const items = (Array.isArray(req.body?.messages) ? req.body.messages : []).filter((m: any) => m?.source === 'bot' || rubikaAccountActive());
  const added = items.length ? await storeAccountMessages(items) : 0;
  // Edits/deletes made in the Rubika app itself (from the listener): update the CRM copy, never remove it.
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 200) : [];
  if (events.length) {
    const db = readDb() as any; let changed = false;
    for (const ev of events) {
      const m = ((db.messages || []) as any[]).find(x => x.ext_id === String(ev?.ext_id || ''));
      if (!m) continue;
      if (ev.action === 'edit' && ev.text) { m.message = sanitizeString(String(ev.text), 2000); m.edited = true; changed = true; }
      if (ev.action === 'delete') { m.deleted_remote = true; changed = true; }
    }
    if (changed) writeDb(db);
  }
  const phones = Array.isArray(req.body?.phones) ? req.body.phones.slice(0, 500) : [];
  if (phones.length) {
    const db = readDb() as any;
    for (const p of phones) {
      const th = ((db.threads || []) as any[]).find(t => t.source === 'account' && t.external_id === String(p?.chat_id || ''));
      const k = chabokan.mobileKey(p?.phone);
      if (th && k) th.phone = `0${k}`;
      if (th && p?.title && !th.person) th.title = sanitizeString(String(p.title), 100);
    }
    writeDb(db);
  }
  const relink = phones.length || req.body?.relink ? await relinkAccountThreads() : undefined;
  res.json({ ok: true, added, relink });
}));

// ── GET: دریافت پیام‌های ورودی ──
app.get('/api/messenger/messages', (req, res) => {
  const db = readDb();
  res.json({ success: true, messages: (db as any).messages || [] });
});

// ── Rubika address book (main account): add students/leads as contacts so they can be messaged one-to-one.
// addAddressBook / deleteContact only: never sends a message. Results live in db.rubika_contacts["student:<id>"|"lead:<id>"].
type ContactKind = 'student' | 'lead';
type ContactPerson = { kind: ContactKind; id: number; first_name: string; last_name: string; phone: string };
const contactKey = (kind: ContactKind, id: number | string) => `${kind}:${id}`;
const asContactKind = (v: unknown): ContactKind | null => (v === 'student' || v === 'lead' ? v : null);
function contactPublic(r: any) {
  return r ? { status: r.status, linked: !!r.guid, at: r.at, error: r.error } : null;
}
/** Records the result and, with a user guid, upserts a hidden (contact-only) account thread so one-to-one sends find it. */
function applyContactResult(db: any, p: ContactPerson, res: { status: string; guid?: string; error?: string }, by: string | null) {
  const map = (db.rubika_contacts ||= {}) as Record<string, any>;
  const key = contactKey(p.kind, p.id);
  const prev = map[key];
  const k = chabokan.mobileKey(p.phone);
  const guid = res.guid && /^[a-zA-Z0-9_]{10,64}$/.test(res.guid) ? res.guid : undefined;
  let status = res.status;
  const threads = (db.threads ||= []) as any[];
  if (status === 'added' && guid && (prev?.guid === guid || threads.some(t => t.source === 'account' && t.external_id === guid && !t.contact_only))) status = 'already';
  map[key] = { status, guid: guid || (status === 'failed' ? prev?.guid : undefined), phone: k ? `0${k}` : '', at: new Date().toISOString(), by, ...(res.error ? { error: String(res.error).slice(0, 200) } : {}) };
  if (!map[key].guid) delete map[key].guid;
  if (guid) {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'کاربر روبیکا';
    let th = threads.find(t => t.source === 'account' && t.external_id === guid);
    if (!th) {
      th = { thread_id: stableThreadId(guid), source: 'account', channel: 'rubika', external_id: guid, title: name, phone: k ? `0${k}` : '',
        unread_count: 0, updated_at: new Date().toISOString(), last_message_text: '', contact_only: true };
      threads.push(th);
    }
    if (k && !th.phone) th.phone = `0${k}`;
    th.person = { kind: p.kind, id: p.id, name };
    if (!th.contact_only || th.title === 'کاربر روبیکا') th.title = th.title && th.title !== 'کاربر روبیکا' ? th.title : name;
    if (p.kind === 'student') { th.student_id = p.id; ((db.rubika_account_links ||= {}) as Record<string, string>)[String(p.id)] = guid; }
  }
  return map[key];
}
async function loadContactPerson(kind: ContactKind, id: number): Promise<ContactPerson | null> {
  if (kind === 'student') {
    if (chabokan.isMysqlEnabled()) {
      const [s] = await chabokan.sql<any>('SELECT student_id AS id, first_name, last_name, phone_number FROM students WHERE student_id = ?', [id]);
      return s ? { kind, id, first_name: s.first_name || '', last_name: s.last_name || '', phone: s.phone_number || '' } : null;
    }
    const s: any = readDb().students.find((x: any) => Number(x.id) === id);
    return s ? { kind, id, first_name: s.first_name || '', last_name: s.last_name || '', phone: s.phone_number || '' } : null;
  }
  if (!chabokan.isMysqlEnabled()) return null;
  const [l] = await chabokan.sql<any>('SELECT lead_id AS id, first_name, last_name, phone_number FROM leads WHERE lead_id = ?', [id]);
  return l ? { kind, id, first_name: l.first_name || '', last_name: l.last_name || '', phone: l.phone_number || '' } : null;
}
/** Bulk target list; filters: active_term (students in a term with status active), unlinked (no contact result with a guid yet). */
async function contactTargets(kind: ContactKind, f: { active_term?: boolean; unlinked?: boolean }): Promise<ContactPerson[]> {
  let rows: any[] = [];
  if (kind === 'student') {
    if (chabokan.isMysqlEnabled()) {
      rows = await chabokan.sql<any>(`SELECT s.student_id AS id, s.first_name, s.last_name, s.phone_number FROM students s
        ${f.active_term ? `WHERE EXISTS (SELECT 1 FROM enrollments e JOIN crm_course_terms t ON t.course_id = e.course_id AND t.course_number = e.course_number
          AND t.status = 'active' WHERE e.student_id = s.student_id)` : ''} ORDER BY s.student_id`);
    } else if (!f.active_term) rows = readDb().students.map((s: any) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, phone_number: s.phone_number }));
  } else if (chabokan.isMysqlEnabled()) {
    rows = await chabokan.sql<any>("SELECT lead_id AS id, first_name, last_name, phone_number FROM leads WHERE status NOT IN ('converted','lost') ORDER BY lead_id");
  }
  const map = ((readDb() as any).rubika_contacts || {}) as Record<string, any>;
  const seen = new Set<string>();
  return rows
    .map((r) => ({ kind, id: Number(r.id), first_name: r.first_name || '', last_name: r.last_name || '', phone: r.phone_number || '' }))
    .filter((p) => {
      const k = chabokan.mobileKey(p.phone);
      if (!k || k.length !== 10 || seen.has(k)) return false;
      seen.add(k);
      const rec = map[contactKey(kind, p.id)];
      return !(f.unlinked && rec && (rec.guid || rec.status === 'not_on_rubika'));
    });
}

app.get('/api/messenger/contacts', (req, res) => {
  const kind = asContactKind(req.query.kind);
  if (!kind) return res.status(400).json({ error: 'نوع نامعتبر' });
  const map = ((readDb() as any).rubika_contacts || {}) as Record<string, any>;
  const outMap: Record<string, any> = {};
  for (const [k, v] of Object.entries(map)) if (k.startsWith(`${kind}:`)) outMap[k.slice(kind.length + 1)] = contactPublic(v);
  res.json({ contacts: outMap, bulk: contactJobPublic() });
});

app.post('/api/messenger/contacts/:kind/:id/add', asyncHandler(async (req, res) => {
  const kind = asContactKind(req.params.kind); const id = Number(req.params.id);
  if (!kind || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ورودی نامعتبر' });
  if (!rubikaAccountActive()) return res.status(400).json({ error: 'اکانت اصلی روبیکا غیرفعال است.' });
  if (contactJob?.running) return res.status(409).json({ error: 'افزودن گروهی در حال اجراست؛ کمی بعد دوباره امتحان کنید.' });
  const p = await loadContactPerson(kind, id);
  if (!p) return res.status(404).json({ error: 'شخص پیدا نشد.' });
  if (!/^9\d{9}$/.test(chabokan.mobileKey(p.phone))) return res.status(400).json({ error: 'شماره موبایل این شخص معتبر نیست.' });
  const r = await runRubikaAccount('add_contact', { phone: p.phone, first_name: p.first_name, last_name: p.last_name });
  const by = sessionFromRequest(req)?.username || null;
  const db = readDb() as any;
  const rec = applyContactResult(db, p, r.ok ? { status: r.status, guid: r.guid } : { status: 'failed', error: r.error }, by);
  writeDb(db);
  const labels: Record<string, string> = { added: 'به مخاطبین روبیکا اضافه شد.', already: 'از قبل مخاطب یا در گفتگو بود؛ پیوند به‌روز شد.', not_on_rubika: 'این شماره در روبیکا حساب ندارد.' };
  res.status(r.ok ? 200 : 502).json({ ok: !!r.ok, ...contactPublic(rec), message: r.ok ? labels[rec.status] : (r.error || 'افزودن ناموفق بود.') });
}));

app.post('/api/messenger/contacts/:kind/:id/delete', asyncHandler(async (req, res) => {
  const kind = asContactKind(req.params.kind); const id = Number(req.params.id);
  if (!kind || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ورودی نامعتبر' });
  const key = contactKey(kind, id);
  const rec = (((readDb() as any).rubika_contacts) || {})[key];
  if (!rec?.guid) return res.status(404).json({ error: 'این شخص در مخاطبین روبیکا ثبت نشده است.' });
  const r = await runRubikaAccount('delete_contact', { guid: rec.guid });
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error || 'حذف مخاطب ناموفق بود.' });
  const db = readDb() as any;
  delete db.rubika_contacts[key];
  // Hidden contact-only threads go; real conversations (with messages) stay.
  db.threads = ((db.threads || []) as any[]).filter(t => !(t.source === 'account' && t.external_id === rec.guid && t.contact_only));
  writeDb(db);
  res.json({ ok: true, message: 'از مخاطبین روبیکا حذف شد. (گفتگوهای قبلی در CRM می‌مانند.)' });
}));

// Bulk add: one job at a time, one rubpy client, 3-5 s random gap, stops on flood/repeated errors. Sends nothing.
let contactJob: null | { running: boolean; kind: ContactKind; total: number; done: number; added: number; already: number; not_on_rubika: number;
  failed: number; stopped: string | null; started_at: string; finished_at?: string; by: string | null; child?: import('child_process').ChildProcess } = null;
function contactJobPublic() {
  if (!contactJob) return null;
  const { child, ...rest } = contactJob; return rest;
}
app.post('/api/messenger/contacts/bulk/preview', asyncHandler(async (req, res) => {
  const kind = asContactKind(req.body?.kind);
  if (!kind) return res.status(400).json({ error: 'نوع نامعتبر' });
  const list = await contactTargets(kind, { active_term: !!req.body?.active_term, unlinked: req.body?.unlinked !== false });
  res.json({ count: list.length, seconds_estimate: list.length * 4 });
}));
app.post('/api/messenger/contacts/bulk/start', asyncHandler(async (req, res) => {
  const kind = asContactKind(req.body?.kind);
  if (!kind) return res.status(400).json({ error: 'نوع نامعتبر' });
  if (!rubikaAccountActive()) return res.status(400).json({ error: 'اکانت اصلی روبیکا غیرفعال است.' });
  if (contactJob?.running) return res.status(409).json({ error: 'یک افزودن گروهی در حال اجراست.' });
  const list = (await contactTargets(kind, { active_term: !!req.body?.active_term, unlinked: req.body?.unlinked !== false })).slice(0, 2000);
  if (!list.length) return res.status(400).json({ error: 'کسی برای افزودن پیدا نشد.' });
  const by = sessionFromRequest(req)?.username || null;
  const byKey = new Map(list.map(p => [contactKey(p.kind, p.id), p]));
  const job: NonNullable<typeof contactJob> = { running: true, kind, total: list.length, done: 0, added: 0, already: 0, not_on_rubika: 0, failed: 0, stopped: null, started_at: new Date().toISOString(), by };
  contactJob = job;
  const script = path.join(process.cwd(), 'scripts', 'rubika_account.py');
  const child = spawn(process.env.RUBIKA_PYTHON || 'python3', [script, 'add_contacts'], { stdio: ['pipe', 'pipe', 'ignore'] });
  job.child = child;
  let buf = '';
  const onLine = (line: string) => {
    let j: any; try { j = JSON.parse(line); } catch { return; }
    if (j.type === 'item') {
      const p = byKey.get(String(j.key)); if (!p) return;
      const db = readDb() as any;
      const rec = applyContactResult(db, p, { status: j.status, guid: j.guid, error: j.error }, by);
      writeDb(db);
      job.done++; (job as any)[rec.status] = ((job as any)[rec.status] || 0) + 1;
      void chabokan.insertAudit({ username: by, role: null, method: 'POST', path: `/messenger/contacts/bulk/item/${rec.status}`, entity: 'rubika_contact', entity_id: contactKey(p.kind, p.id), status: rec.status === 'failed' ? 502 : 200, ip: null });
    } else if (j.type === 'done') { job.stopped = j.stopped || (j.ok === false ? 'error' : null); }
  };
  child.stdout!.on('data', (d) => { buf += String(d); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } });
  child.on('close', () => { if (buf.trim()) onLine(buf.trim()); job.running = false; job.finished_at = new Date().toISOString(); if (!job.stopped && job.done < job.total) job.stopped = job.stopped || 'cancelled'; delete job.child; });
  child.on('error', () => { job.running = false; job.stopped = 'error'; });
  child.stdin!.end(JSON.stringify({ items: list.map(p => ({ key: contactKey(p.kind, p.id), phone: p.phone, first_name: p.first_name, last_name: p.last_name })), min_delay: 3, max_delay: 5 }));
  res.json({ ok: true, bulk: contactJobPublic() });
}));
app.get('/api/messenger/contacts/bulk', (_req, res) => res.json({ bulk: contactJobPublic() }));
app.post('/api/messenger/contacts/bulk/stop', (_req, res) => {
  if (contactJob?.running && contactJob.child) { contactJob.stopped = 'cancelled'; contactJob.child.kill('SIGTERM'); }
  res.json({ ok: true, bulk: contactJobPublic() });
});

// ── Rubika main-account message actions (one-to-one chats only; bulk stays in campaigns, locked) ──
const RUBIKA_MEDIA_DIR = path.join(process.env.RUBIKA_STATE_DIR || '/project/kermanshahcart/crm-data/rubika', 'media');
const RUBIKA_OUTBOX_DIR = path.join(process.env.RUBIKA_STATE_DIR || '/project/kermanshahcart/crm-data/rubika', 'outbox');
for (const d of [RUBIKA_MEDIA_DIR, RUBIKA_OUTBOX_DIR]) { try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); } catch { /* created on first use */ } }
const uploadRubikaAttachment = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RUBIKA_OUTBOX_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${(path.extname(file.originalname) || '.bin').slice(0, 10).replace(/[^.\w]/g, '')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
/** The stored account message for :id, with its chat and Rubika message id, or an error answer. */
function accountMessage(req: express.Request, res: express.Response): { db: any; m: any; mid: string | null } | null {
  const db = readDb() as any;
  const m = ((db.messages || []) as any[]).find(x => String(x.id) === String(req.params.id));
  if (!m) { res.status(404).json({ error: 'پیام یافت نشد.' }); return null; }
  if (m.source !== 'account' || !m.chat_id) { res.status(400).json({ error: 'این عملیات فقط برای گفتگوهای اکانت اصلی روبیکا ممکن است.' }); return null; }
  return { db, m, mid: m.rubika_message_id || rubikaMsgIdOf(m.ext_id) };
}
const findMsg = (id: unknown) => ((((readDb() as any).messages) || []) as any[]).find(x => String(x.id) === String(id));
const patchMsg = (id: unknown, changes: Record<string, unknown>) => {
  const db = readDb() as any; const m = ((db.messages || []) as any[]).find(x => String(x.id) === String(id));
  if (m) { Object.assign(m, changes); writeDb(db); }
  return m;
};

app.post('/api/messenger/messages/:id/delete', asyncHandler(async (req, res) => {
  const scope = req.body?.scope === 'global' ? 'global' : 'crm';
  if (scope === 'crm') {
    const db = readDb() as any; const n = (db.messages || []).length;
    db.messages = ((db.messages || []) as any[]).filter(x => String(x.id) !== String(req.params.id));
    if (db.messages.length === n) return res.status(404).json({ error: 'پیام یافت نشد.' });
    writeDb(db); return res.json({ ok: true, scope });
  }
  const a = accountMessage(req, res); if (!a) return;
  if (!a.mid) return res.status(400).json({ error: 'شناسه روبیکای این پیام ثبت نشده؛ فقط حذف از CRM ممکن است.' });
  if (!rubikaAccountActive()) return res.status(400).json({ error: 'اکانت اصلی روبیکا غیرفعال است.' });
  let r = await runRubikaAccount('delete', { guid: a.m.chat_id, message_ids: [a.mid], type: 'Global' });
  let type = 'Global'; let note = '';
  if (!r.ok && a.m.direction !== 'out') {
    const r2 = await runRubikaAccount('delete', { guid: a.m.chat_id, message_ids: [a.mid], type: 'Local' });
    if (r2.ok) { r = r2; type = 'Local'; note = 'روبیکا حذف برای طرف مقابل را نپذیرفت؛ پیام فقط از سمت ما حذف شد.'; }
  }
  if (!r.ok) return res.status(502).json({ error: `روبیکا حذف را نپذیرفت: ${r.error || 'نامشخص'}` });
  const db = readDb() as any;
  db.messages = ((db.messages || []) as any[]).filter(x => String(x.id) !== String(req.params.id));
  writeDb(db);
  res.json({ ok: true, scope, type, note });
}));

app.post('/api/messenger/messages/:id/edit', asyncHandler(async (req, res) => {
  const text = sanitizeString(req.body?.text, 2000);
  if (!text) return res.status(400).json({ error: 'متن جدید را وارد کنید.' });
  const a = accountMessage(req, res); if (!a) return;
  if (a.m.direction !== 'out') return res.status(400).json({ error: 'فقط پیام‌های ارسالی خودمان قابل ویرایش است.' });
  if (!a.mid) return res.status(400).json({ error: 'شناسه روبیکای این پیام ثبت نشده است.' });
  if (!rubikaAccountActive()) return res.status(400).json({ error: 'اکانت اصلی روبیکا غیرفعال است.' });
  const r = await runRubikaAccount('edit', { guid: a.m.chat_id, message_id: a.mid, text });
  if (!r.ok) return res.status(502).json({ error: `روبیکا ویرایش را نپذیرفت: ${r.error || 'نامشخص'}` });
  patchMsg(req.params.id, { message: text, edited: true, edited_at: new Date().toISOString() });
  res.json({ ok: true });
}));

app.post('/api/messenger/threads/:chatId/attachment', uploadRubikaAttachment.single('file'), asyncHandler(async (req, res) => {
  const chat = sanitizeString(String(req.params.chatId || ''), 100);
  const file = (req as any).file as Express.Multer.File | undefined;
  const cleanup = () => { if (file) fs.promises.unlink(file.path).catch(() => {}); };
  if (!file) return res.status(400).json({ error: 'فایلی انتخاب نشده است.' });
  const th = ((((readDb() as any).threads) || []) as any[]).find(t => t.source === 'account' && t.external_id === chat);
  if (!th) { cleanup(); return res.status(404).json({ error: 'این گفتگو در اکانت اصلی روبیکا پیدا نشد (فقط پاسخ به گفتگوهای موجود).' }); }
  if (!rubikaAccountActive()) { cleanup(); return res.status(400).json({ error: 'اکانت اصلی روبیکا غیرفعال است.' }); }
  const isPhoto = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
  const caption = sanitizeString(req.body?.caption, 1000);
  const r = await runRubikaAccount('send_file', { guid: chat, path: file.path, kind: isPhoto ? 'photo' : 'document', caption });
  cleanup();
  if (!r.ok) return res.status(502).json({ error: `ارسال فایل ناموفق بود: ${r.error || 'نامشخص'}` });
  const now = Date.now(); const extId = `${chat}:${r.message_id || `local-${now}`}`;
  const name = sanitizeString(file.originalname, 120);
  await storeAccountMessages([{ ext_id: extId, chat_id: chat, text: caption || (isPhoto ? '[Image]' : `[File] ${name}`), time: now, direction: 'out',
    media: { type: isPhoto ? 'Image' : 'File', mime: file.mimetype, file_name: name, size: file.size } }]);
  const stored = (((readDb() as any).messages) || []).find((m: any) => m.ext_id === extId);
  res.json({ ok: true, message_id: stored?.id });
}));

const lastSeen = new Map<string, string>();
app.post('/api/messenger/threads/:chatId/seen', asyncHandler(async (req, res) => {
  const chat = sanitizeString(String(req.params.chatId || ''), 100);
  const db = readDb() as any;
  const th = ((db.threads || []) as any[]).find(t => t.source === 'account' && t.external_id === chat);
  if (!th) return res.status(404).json({ error: 'گفتگو یافت نشد.' });
  th.unread_count = 0; writeDb(db);
  const ids = ((db.messages || []) as any[]).filter(m => m.source === 'account' && m.chat_id === chat && m.direction === 'in')
    .map(m => m.rubika_message_id || rubikaMsgIdOf(m.ext_id)).filter(Boolean) as string[];
  const last = ids.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).pop();
  if (!last || !rubikaAccountActive()) return res.json({ ok: true, rubika: false });
  if (lastSeen.get(chat) === last) return res.json({ ok: true, rubika: true, cached: true });
  const r = await runRubikaAccount('seen', { guid: chat, message_id: last });
  if (r.ok) lastSeen.set(chat, last);
  res.json({ ok: true, rubika: !!r.ok, error: r.ok ? undefined : r.error });
}));

app.get('/api/messenger/messages/:id/media', asyncHandler(async (req, res) => {
  const a = accountMessage(req, res); if (!a) return;
  if (!a.mid) return res.status(404).json({ error: 'فایل در دسترس نیست.' });
  const file = path.join(RUBIKA_MEDIA_DIR, `${a.m.chat_id.replace(/\W/g, '')}_${a.mid}`);
  const metaFile = `${file}.json`;
  if (!fs.existsSync(file)) {
    const r = await runRubikaAccount('download', { guid: a.m.chat_id, message_id: a.mid, dest: file, max_bytes: 25 * 1024 * 1024 });
    if (!r.ok) return res.status(502).json({ error: r.error || 'دریافت فایل ناموفق بود.' });
    fs.writeFileSync(metaFile, JSON.stringify({ mime: r.mime, file_name: r.file_name, type: r.type }), { mode: 0o600 });
  }
  let meta: any = {}; try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')); } catch { /* none */ }
  const ext = String(meta.mime || a.m.media?.mime || '').toLowerCase();
  const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', pdf: 'application/pdf' };
  const ctype = ext.includes('/') ? ext : (mimeMap[ext] || 'application/octet-stream');
  res.setHeader('Content-Type', ctype);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  const name = String(meta.file_name || a.m.media?.file_name || 'file').replace(/["\r\n]/g, '');
  res.setHeader('Content-Disposition', `${/^(image|audio|video)\//.test(ctype) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  fs.createReadStream(file).pipe(res);
}));

app.post('/api/messenger/messages/:id/transcribe', asyncHandler(async (req, res) => {
  const a = accountMessage(req, res); if (!a) return;
  if (a.m.transcription) return res.json({ ok: true, text: a.m.transcription });
  if (!a.mid) return res.status(400).json({ error: 'شناسه روبیکای این پیام ثبت نشده است.' });
  const r = await runRubikaAccount('transcribe', { guid: a.m.chat_id, message_id: a.mid });
  if (!r.ok) return res.status(502).json({ error: r.error || 'تبدیل صوت به متن ناموفق بود.' });
  patchMsg(req.params.id, { transcription: sanitizeString(String(r.text), 4000) });
  res.json({ ok: true, text: r.text });
}));

// ── Gateway settings (stored on the server; secrets are never sent back to the browser) ──
type Gateways = {
  sms_provider: string; sms_api_key: string; sms_sender_line: string;
  sms_auto_register: boolean; sms_auto_exam: boolean;
  rubika_bot_token: string; rubika_channel_id: string; rubika_active: boolean;
};
// SMS settings live in MySQL app_settings['sms.config'] (shared with the site); API key only from env SMS_API_KEY.
const sharedSms = createSms((q: string, p: any[] = []) => chabokan.sql(q, p));
let smsCfg: any = { provider: 'smsir', lineNumber: process.env.SMS_SENDER_LINE || '', autoRegister: false, autoExam: false };
const refreshSmsCfg = () => sharedSms.getConfig(true).then((c) => { smsCfg = c; }).catch((e) => console.warn('[SMS] config load failed:', e?.message || e));
setTimeout(refreshSmsCfg, 3000); setInterval(refreshSmsCfg, 60_000).unref?.();
function getGateways(): Gateways {
  let g: any = {};
  try { g = (readDb().settings as any)?.gateways || {}; } catch { /* unreadable DB: fall back to env */ }
  return {
    sms_provider: smsCfg.provider || 'smsir',
    sms_api_key: process.env.SMS_API_KEY || '',
    sms_sender_line: smsCfg.lineNumber || process.env.SMS_SENDER_LINE || '',
    sms_auto_register: smsCfg.autoRegister === true, // default OFF
    sms_auto_exam: smsCfg.autoExam === true, // default OFF
    rubika_bot_token: g.rubika_bot_token || RUBIKA_BOT_TOKEN,
    rubika_channel_id: g.rubika_channel_id || '',
    rubika_active: g.rubika_active !== false,
  };
}

const normalizeMobile = (v: unknown) => toLatinDigits(String(v ?? '')).replace(/[\s-]/g, '').replace(/^\+98/, '0').replace(/^98(?=9\d{9}$)/, '0');

/** Sends one SMS through the shared helper (sms.ir bulk, line from app_settings). */
async function sendSmsMessage(mobile: string, text: string): Promise<{ ok: boolean; status: 'sent' | 'not_configured' | 'failed'; detail?: string }> {
  const r = await sharedSms.sendText(mobile, text);
  return { ok: r.ok, status: (r.status === 'disabled' ? 'failed' : r.status) as any, detail: r.detail };
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
    else if (!chatId) { status = 'awaiting_user_init'; note = 'هنرجو هنوز /start نزده؛ پیام در صف ماند.'; }
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
// Message templates (messenger «الگوهای آماده»): JSON store, seeded once; writes are audit-logged by the /api middleware.
// Message templates: canonical store is MySQL sms_templates (see shared/sms.ts).
const TEMPLATE_COLORS = ['sky', 'rose', 'teal', 'amber', 'violet', 'emerald', 'slate'];
// Templates live in MySQL sms_templates ({name}-style placeholders); the UI keeps its [نام]-style tokens, converted here.
const tplOut = (t: any) => ({ id: t.key, title: t.title_fa || t.key, body: toBracket(t.body_fa || ''), color: t.color || 'sky', updated_at: t.updated_at });
const templateInput = (b: any) => {
  const title = sanitizeString(b?.title, 80); const body = sanitizeString(b?.body, 1000);
  const color = TEMPLATE_COLORS.includes(b?.color) ? b.color : 'sky';
  if (!title || !body) throw Object.assign(new Error('عنوان و متن الگو الزامی است.'), { status: 400 });
  return { title_fa: title, body_fa: fromBracket(body), color };
};
app.get('/api/message-templates', async (req, res) => {
  try { res.json((await sharedSms.listTemplates(true)).filter((t: any) => t.show_in_crm && t.channel_kind === 'bulk').map(tplOut)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.post('/api/message-templates', async (req, res) => {
  try {
    const v = templateInput(req.body); const id = `t${Date.now().toString(36)}`;
    await sharedSms.upsertTemplate(id, v); res.json({ ok: true, id });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
});
app.put('/api/message-templates/:id', async (req, res) => {
  try {
    const v = templateInput(req.body);
    const t = await sharedSms.getTemplate(String(req.params.id));
    if (!t || t.channel_kind !== 'bulk') return res.status(404).json({ error: 'الگو یافت نشد.' });
    await chabokan.sql('UPDATE sms_templates SET title_fa = ?, body_fa = ?, color = ? WHERE `key` = ?', [v.title_fa, v.body_fa, v.color, t.key]);
    await sharedSms.listTemplates(true); res.json({ ok: true });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
});
app.delete('/api/message-templates/:id', async (req, res) => {
  try {
    const t = await sharedSms.getTemplate(String(req.params.id));
    if (!t || t.channel_kind !== 'bulk') return res.status(404).json({ error: 'الگو یافت نشد.' });
    await sharedSms.deleteTemplate(t.key); res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messenger/send', async (req, res) => {
  const channel = sanitizeString(req.body?.channel, 20) || 'sms';
  const message = sanitizeString(req.body?.message ?? req.body?.messageText, 1000);
  const phone = normalizeMobile(req.body?.recipient);
  const accountChat = channel === 'rubika' && req.body?.source === 'account' ? sanitizeString(String(req.body?.chat_id || ''), 100) : '';
  if (accountChat && message && rubikaAccountActive()) {
    const r = await runRubikaAccount('send', { guid: accountChat, text: message });
    const now = Date.now();
    if (r.ok) await storeAccountMessages([{ ext_id: `${accountChat}:${r.message_id || `local-${now}`}`, chat_id: accountChat, text: message, time: now, direction: 'out' }]);
    const db = readDb();
    const stored = ((db as any).messages || []).find((m: any) => m.ext_id === `${accountChat}:${r.message_id || `local-${now}`}`);
    return res.json({ success: !!r.ok, status: r.ok ? 'sent' : 'failed', message_id: stored?.id, message: r.ok ? 'پیام از اکانت اصلی ارسال شد.' : (r.error || 'ارسال ناموفق بود.') });
  }
  // One-to-one reply without a chat id (student profile, phone-based thread, or a Bale/Eita/SMS thread): if this person already
  // has a Rubika conversation, reply there (account first, then bot). Only existing conversations, never a new chat or bulk.
  if (!req.body?.chat_id && message && req.body?.prefer_sms !== true) {
    const k = chabokan.mobileKey(phone);
    const sid = req.body?.student_id != null && req.body?.student_id !== '' ? String(req.body.student_id) : '';
    const ths = (((readDb() as any).threads) || []) as any[];
    const match = (src: string) => ths
      .filter(t => t.source === src && t.external_id && ((k && chabokan.mobileKey(t.phone) === k) || (sid && String(t.student_id || '') === sid)))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
    const acc = rubikaAccountActive() ? match('account') : undefined;
    const bot = acc ? undefined : (getGateways().rubika_bot_token ? match('bot') : undefined);
    if (acc || bot) { req.body = { ...req.body, channel: 'rubika', source: acc ? 'account' : 'bot', chat_id: (acc || bot).external_id }; }
  }
  if (req.body?.channel === 'rubika' && req.body?.source === 'account' && req.body?.chat_id && message && rubikaAccountActive()) {
    const chat = sanitizeString(String(req.body.chat_id), 100);
    const r = await runRubikaAccount('send', { guid: chat, text: message });
    const now = Date.now(); const extId = `${chat}:${r.message_id || `local-${now}`}`;
    if (r.ok) await storeAccountMessages([{ ext_id: extId, chat_id: chat, text: message, time: now, direction: 'out' }]);
    const stored = (((readDb() as any).messages) || []).find((m: any) => m.ext_id === extId);
    return res.json({ success: !!r.ok, status: r.ok ? 'sent' : 'failed', via: 'rubika', message_id: stored?.id, message: r.ok ? 'پیام در گفتگوی روبیکای همین شخص (اکانت اصلی) ارسال شد.' : (r.error || 'ارسال ناموفق بود.') });
  }
  const botChat = (channel === 'rubika' || req.body?.channel === 'rubika') && req.body?.source === 'bot' ? sanitizeString(String(req.body?.chat_id || ''), 100) : '';
  if (botChat && message) {
    // Reply on a bot thread: Rubika bot API sendMessage only (ker.py stays the only consumer of updates).
    let ok = false; let err = '';
    try { const r = await sendRubikaMessage(botChat, message); ok = r?.status === 'OK'; if (!ok) err = String(r?.status || r?.raw || 'نامشخص').slice(0, 120); }
    catch (e: any) { err = e?.message || 'خطا'; }
    const now = Date.now(); const extId = `bot:${botChat}:out-${now}`;
    if (ok) await storeAccountMessages([{ source: 'bot', ext_id: extId, chat_id: botChat, text: message, time: now, direction: 'out' }]);
    const stored = (((readDb() as any).messages) || []).find((m: any) => m.ext_id === extId);
    return res.json({ success: ok, status: ok ? 'sent' : 'failed', message_id: stored?.id, message: ok ? 'پیام از ربات روبیکا ارسال شد.' : `ارسال با ربات ناموفق بود: ${err}` });
  }
  if (accountChat && !/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'اکانت اصلی روبیکا غیرفعال است و برای این گفتگو شماره‌ای جهت ارسال با ربات وجود ندارد.' });
  if (channel === 'bale' || channel === 'eitaa') {
    return res.json({ success: false, status: 'not_configured', message: 'ارسال از بله/ایتا هنوز راه‌اندازی نشده است؛ برای این شخص گفتگوی روبیکا هم پیدا نشد.' });
  }
  if (!phone || !message) return res.status(400).json({ error: 'گیرنده و متن پیام الزامی است.' });
  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'شماره موبایل گیرنده معتبر نیست.' });
  try {
    const r = await deliverMessage({ channel, recipient: phone, message, studentId: req.body?.student_id });
    const labels: Record<string, string> = {
      sent: 'پیام ارسال شد.',
      awaiting_user_init: 'هنرجو هنوز /start نزده؛ پیام در صف ماند.',
      not_configured: r.note || 'درگاه ارسال تنظیم نشده است.',
      failed: `ارسال ناموفق بود${r.note ? `: ${r.note}` : '.'}`,
    };
    res.json({ success: r.status === 'sent', status: r.status, tracking_id: r.trackingId, message_id: r.messageId, message: labels[r.status] || r.status });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
    return res.status(400).json({ error: 'وضعیت هنرجو نامعتبر است.' });
  }
  const db = readDb();
  const codeChanged = !!data.national_code && data.national_code !== normalizeNationalCode(current.national_code);
  if (codeChanged && db.students.some(s => sameCode(s, data.national_code) && s.id !== studentId)) {
    return res.status(409).json({ error: 'هنرجوی دیگری با این کد ملی ثبت شده است.' });
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
  { name: 'personal', maxCount: 1 },
  { name: 'idCardOriginal', maxCount: 1 },
  { name: 'personalOriginal', maxCount: 1 }
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

const REG_COURSE_NAMES_FA: Record<string, string> = {
  cargo_freight: 'بدو خدمت باری', passenger_bus: 'بدو خدمت مسافری', hazardous_materials: 'مواد خطرناک',
  technical_manager: 'مدیر فنی شرکت', ceo_company: 'مدیر عامل شرکت', ceo_freight: 'مدیر شرکت حمل و نقل', ceo_passenger: 'مدیر شرکت مسافربری'
};
/** Vars for sms_templates.registration_rejected (param_map NAME/COURSE/TRACK + fallback {name},{tracking_code},{reason},{academy}). */
function rejectionSmsVars(reg: any, reason: string, academy: string) {
  return { name: reg?.full_name || '', course: REG_COURSE_NAMES_FA[String(reg?.category || '')] || '', tracking_code: String(reg?.tracking_code || ''), reason: reason || '', academy };
}
/** Vars for sms_templates.registration_welcome (param_map NAME/COURSE/TRACK + fallback {name},{family},{course},{academy}). */
function welcomeSmsVars(student: any, course: any, trackingCode: string, academy: string) {
  return { name: [student?.first_name, student?.last_name].filter(Boolean).join(' ').trim(), family: student?.last_name || '', course: course?.title || '', tracking_code: trackingCode || '', academy };
}

/** 'Registration rejected' SMS (sms_templates.registration_rejected, toggle sms.config.autoRejected). Never throws. */
async function notifyRejection(reg: any, reason: string) {
  const tracking = String(reg?.tracking_code || '');
  const phone = normalizeMobile(reg?.phone_number);
  const masked = phone.replace(/^(.*)(\d{4})$/, (_x, a2, b2) => '*'.repeat(a2.length) + b2);
  try {
    const c: any = await sharedSms.getConfig(true);
    if (c.autoRejected !== true) return;
    const tpl: any = await sharedSms.getTemplate('registration_rejected');
    if (!tpl || !tpl.enabled) return;
    if (!/^09\d{9}$/.test(phone)) { console.log(`[SMS] registration_rejected ${tracking} failed: invalid mobile ${masked}`); return; }
    const academy = academyDisplayName() || String(c.academyName || '').trim();
    // Verify template 997615 (NAME, COURSE, TRACK); falls back to fallback_body_fa (free text) inside the shared helper.
    const r0 = await sharedSms.sendTemplate('registration_rejected', phone, rejectionSmsVars(reg, reason, academy));
    if (r0.status === 'disabled') return;
    const r = { status: r0.ok ? 'sent' : r0.status, note: `${r0.detail || ''} [${r0.mode || '-'}]` };
    console.log(`[SMS] registration_rejected ${tracking} ${r.status === 'sent' ? 'ok' : `failed: ${r.note || r.status}`} ${masked}`);
  } catch (e: any) { console.log(`[SMS] registration_rejected ${tracking} failed: ${e?.message || e} ${masked}`); }
}

/** Welcome SMS after registration: only when the toggle is on and an SMS gateway is configured. */
async function notifyRegistration(student: any, course: any, trackingCode?: string) {
  try {
    const g = getGateways();
    if (!student || !g.sms_auto_register || !g.sms_api_key || !g.sms_sender_line) return;
    const phone = normalizeMobile(student.phone_number);
    if (!/^09\d{9}$/.test(phone)) return;
    const academy = academyDisplayName();
    // Verify template 743658 (NAME, COURSE, TRACK). Without a tracking code (manual CRM enrollment) TRACK is empty,
    // so the shared helper falls back to fallback_body_fa (the previous free-text welcome).
    const r = await sharedSms.sendTemplate('registration_welcome', phone, welcomeSmsVars(student, course, String(trackingCode || ''), academy));
    if (r.status === 'disabled') return;
    console.log(`[SMS] registration_welcome ${trackingCode || '-'} ${r.ok ? 'ok' : 'failed: ' + (r.detail || r.status)} [${r.mode || '-'}]`);
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
    if (!students.some(s => Number(s.id) === studentId)) return res.status(404).json({ error: 'هنرجو یافت نشد.' });
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
      return res.status(409).json({ error: 'این هنرجو قبلاً در همین دوره و کلاس ثبت‌نام شده است.' });
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
/**
 * Records a payment (split over the student's enrollments, oldest first) with the overpay check.
 * Shared by POST /api/payments and by the online-payment approval. Throws `{ status, message }` on a
 * rejected/overpaid payment so both callers answer with the same Persian error.
 */
async function createPaymentCore(input: {
  studentId: number; linkedEnrollmentId: number; amount: number;
  payDate: string; payMethod: string; paymentKind: string; description: string;
}): Promise<any[]> {
  if (chabokan.isMysqlEnabled()) {
    // Check + every part + the cached amount_paid in one transaction with the enrollment rows locked.
    return chabokan.insertPaymentAtomic(input);
  }
  const db = readDb();
  if (!db.students.some(s => s.id === input.studentId)) throw Object.assign(new Error('هنرجو یافت نشد.'), { status: 404 });
  if (input.linkedEnrollmentId) {
    const enr = db.enrollments.find(e => e.id === input.linkedEnrollmentId);
    if (!enr || enr.student_id !== input.studentId) throw Object.assign(new Error('ثبت‌نام مربوط به این هنرجو یافت نشد.'), { status: 404 });
  }
  const { order, owed } = jsonStudentOwed(db, input.studentId);
  const remaining = payableAmount(owed, input.linkedEnrollmentId);
  if (input.amount > remaining) {
    throw Object.assign(new Error(remaining > 0
      ? `مبلغ پرداختی از مانده شهریه (${remaining.toLocaleString('fa-IR')} تومان) بیشتر است.`
      : 'برای این هنرجو مانده‌ای برای پرداخت وجود ندارد.'), { status: 400 });
  }
  const parts = splitPayment(order, owed, input.amount, input.linkedEnrollmentId);
  const created = parts.map((part, i) => ({
    id: (db.payments.length > 0 ? Math.max(...db.payments.map(p => p.id)) : 0) + 1 + i,
    student_id: input.studentId,
    enrollment_id: part.enrollmentId,
    amount: part.amount,
    pay_date_jalali: input.payDate,
    pay_method: input.payMethod,
    payment_kind: input.paymentKind,
    description: input.description,
  }));
  db.payments.push(...created);
  writeDb(db);
  return created;
}

app.post('/api/payments', asyncHandler(async (req, res) => {
  const paymentData = req.body || {};
  const studentId = parseInt(paymentData.student_id ?? paymentData.studentId, 10);
  if (!studentId) return res.status(400).json({ error: 'هنرجوی پرداخت مشخص نیست.' });
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

  try {
    const rows = await createPaymentCore({ studentId, linkedEnrollmentId, amount, payDate: payDate.value, payMethod, paymentKind, description });
    return res.json({ ...rows[0], allocations: rows.length });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

app.get('/api/payments', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.listPayments());
    // Every payment is listed, also when it has no enrollment (or its enrollment was deleted):
    // the enrollment/course fields are filled like the MySQL listing's COALESCE, so received money
    // can no longer disappear from the report.
    const db = readDb();
    const enrollments = new Map(db.enrollments.map(e => [Number(e.id), e]));
    const courses = new Map(db.courses.map(c => [Number(c.id), c]));
    res.json(db.payments.map(p => {
      const enr = p.enrollment_id === null || p.enrollment_id === undefined ? undefined : enrollments.get(Number(p.enrollment_id));
      const course = enr ? courses.get(Number(enr.course_id)) : undefined;
      return {
        ...p,
        enrollment_id: p.enrollment_id === null || p.enrollment_id === undefined ? null : Number(p.enrollment_id),
        course_id: enr ? Number(enr.course_id) : 0,
        course_title: course?.title || '',
      };
    }));
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
  if (!student) return res.status(404).json({ error: 'هنرجوی این ثبت‌نام پیدا نشد.' });

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
  const previousIsOurs = !!previousAbs && path.dirname(previousAbs) === path.resolve(dirAbs)
    && new RegExp(`^${target.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?\\.pdf$`).test(path.basename(previousAbs));
  if (previousIsOurs) {
    fileName = path.basename(previousAbs); // regeneration replaces this enrollment's own previous file
  } else if (fs.existsSync(path.join(dirAbs, fileName))) {
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
  // New site rows store paths relative to uploads/ ("registrations/<code>/<file>"), legacy rows "/uploads/registrations/...".
  rel = marker ? marker[1] : rel.replace(/^[\\/]+/, '').replace(/^registrations\//i, '');
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

// "Reviewed" marks for pending website registrations: kept in the CRM JSON store (no MySQL schema change; Directus shares that DB).
app.get('/api/registrations/reviews', (req, res) => {
  res.json((readDb() as any).registration_reviews || {});
});
app.post('/api/registrations/:code/review', (req, res) => {
  const code = sanitizeString(req.params.code, 50);
  if (!code) return res.status(400).json({ error: 'کد پیگیری الزامی است.' });
  const db: any = readDb();
  const map = db.registration_reviews || {};
  if (req.body?.reviewed === false) delete map[code];
  else map[code] = { at: new Date().toISOString(), by: String((req as any).user?.username || '') };
  db.registration_reviews = map;
  writeDb(db);
  res.json(map);
});

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
      .then((courses) => notifyRegistration(result.student, courses.find(c => Number(c.id) === courseId), code))
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
    // Fire-and-forget 'registration rejected' SMS. Runs only after a real pending -> rejected transition
    // (rejectWebsiteRegistration throws 409 for already-processed rows), so past rejections are never re-sent.
    void notifyRejection(registration, reason);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});


app.get('/api/messenger/threads', (req, res) => {
  const db = readDb();
  res.json({ success: true, threads: (((db as any).threads || []) as any[]).filter(t => !t.contact_only) });
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

// ── Theme settings («تم»): public read (the login screen shows the logo), admin write ──
app.get('/api/settings/theme', asyncHandler(async (req, res) => {
  res.json(await readThemeConfig(readDb().settings));
}));

app.put('/api/settings/theme', requireAdmin, asyncHandler(async (req, res) => {
  const db = readDb();
  const current = await readThemeConfig(db.settings);
  const next = normalizeTheme({ ...current, ...(req.body || {}) });
  // Reset to the default logo: the uploaded image is no longer referenced.
  if (!next.logo_url && current.logo_url) removeThemeLogos();
  await writeThemeConfig(db.settings, next);
  writeDb(db);
  res.json(next);
}));

app.post('/api/settings/theme/logo', requireAdmin, uploadThemeLogo.single('logo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل لوگو ارسال نشد.' });
  const db = readDb();
  const current = await readThemeConfig(db.settings);
  const logoUrl = publicPathFromFile(req.file);
  removeOtherThemeLogos(req.file.path);
  const next = { ...current, logo_url: logoUrl };
  await writeThemeConfig(db.settings, next);
  writeDb(db);
  res.json(next);
}));
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
  // SMS: provider fixed to smsir; line + toggles -> app_settings['sms.config']; API key is env-only (SMS_API_KEY), UI value ignored.
  const smsPatch: any = { provider: 'smsir' };
  if (b.sms_sender_line !== undefined) smsPatch.lineNumber = sanitizeString(b.sms_sender_line, 30);
  if (b.sms_auto_register !== undefined) smsPatch.autoRegister = !!b.sms_auto_register;
  if (b.sms_auto_exam !== undefined) smsPatch.autoExam = !!b.sms_auto_exam;
  for (const k of ['sms_provider', 'sms_api_key', 'sms_sender_line', 'sms_auto_register', 'sms_auto_exam']) delete next[k];
  sharedSms.setConfig(smsPatch).then((c) => { smsCfg = c; }).catch((e) => console.warn('[SMS] config save failed:', e?.message || e));
  if (typeof b.rubika_bot_token === 'string' && b.rubika_bot_token.trim()) next.rubika_bot_token = sanitizeString(b.rubika_bot_token, 200);
  if (b.rubika_channel_id !== undefined) next.rubika_channel_id = sanitizeString(b.rubika_channel_id, 100);
  if (b.rubika_active !== undefined) next.rubika_active = !!b.rubika_active;
  db.settings = { ...(db.settings as any), gateways: next };
  writeDb(db);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// AI COPILOT — Financial Accounting Agent (tool-calling)
// ─────────────────────────────────────────────────────────────
const COPILOT_API_URL = String(process.env.COPILOT_API_URL || '').trim().replace(/\/+$/, '');
const COPILOT_API_KEY = String(process.env.COPILOT_API_KEY || '').trim();
const COPILOT_MODEL = String(process.env.COPILOT_MODEL || 'gpt-4o-mini').trim();
const COPILOT_MAX_ITERATIONS = 6;

/** Academy display name from the CRM settings only (no hardcoded default); '' when not set. */
function academyDisplayName(): string {
  try { return String((readDb().settings as any)?.academy_name || '').trim(); } catch { return ''; }
}

/** Rule 7, built from the tools actually offered to this user (non-admins are not told about admin tools). */
const COPILOT_TOOL_GUIDE: [string, string][] = [
  ['list_courses', 'قیمت/فهرست دوره‌ها'], ['list_site_registrations', 'ثبت‌نام‌های سایت و در انتظار تأیید'],
  ['pending_site_registrations', 'فهرست سریع ثبت‌نام‌های در انتظار بررسی'], ['site_registrations_by_status', 'تعداد ثبت‌نام‌های سایت به تفکیک وضعیت'],
  ['list_leads', 'سرنخ‌ها'], ['get_sales_funnel', 'قیف فروش'], ['list_tasks', 'کارهای کارکنان'],
  ['list_course_terms', 'دوره‌های در حال برگزاری/شماره دوره و ظرفیت'], ['list_exams', 'زمان‌بندی آزمون دوره‌ها و مانده بدهی پیش از آزمون'],
  ['list_enrollments', 'ثبت‌نام کارآموزان در دوره‌ها و مانده هر ثبت‌نام'], ['list_documents', 'مدارک و فایل‌های کارآموزان (رسید، قرارداد، کارت ملی)'],
  ['list_payments', 'فیش‌ها و دریافتی‌ها'], ['monthly_income', 'درآمد یک ماه شمسی'],
  ['get_financial_report', 'هزینه‌ها، سود و زیان ماهانه، حساب‌های بانکی و اقساط معوق'], ['list_messaging', 'گفتگوهای پیام‌رسان و کمپین‌ها'],
  ['list_sms', 'سوابق پیامک‌های ارسالی و الگوهای پیامک'],
  ['sms_get_credit', 'اعتبار باقی‌مانده و خط پنل پیامک'], ['sms_delivery_status', 'وضعیت تحویل پیامک‌های ارسالی از پنل'],
  ['sms_list_received', 'پیامک‌های دریافتی (پاسخ‌ها)'], ['sms_send', 'پیش‌نویس ارسال پیامک (فقط پس از تأیید ادمین در ویجت ارسال می‌شود)'],
  ['list_activity_log', 'سوابق تغییرات و تماس‌ها'], ['search_student', 'جست‌وجوی کارآموز'], ['trainee_count', 'تعداد کل کارآموزان'],
  ['get_student_financial_summary', 'خلاصه مالی یک کارآموز'], ['get_daily_cashflow', 'گردش روزانه'],
  ['get_debtors_list', 'بدهکاران'], ['top_debtors', 'بیشترین بدهکاران'], ['get_course_statistics', 'آمار یک دوره'],
  ['get_site_analytics', 'آمار بازدید سایت (بازدیدکننده، صفحه‌ها، ارجاع‌ها، دستگاه‌ها)'],
  ['execute_sql_crm', 'پرس‌وجوی SELECT دلخواه روی پایگاه CRM (فقط اگر ابزار دیگری کافی نیست)'],
  ['run_sql_query', 'پرس‌وجوی SELECT دلخواه (فقط اگر ابزار دیگری کافی نیست)'],
];
function copilotToolGuide(tools: any[]): string {
  const offered = new Set(tools.map((t: any) => t?.function?.name));
  const parts = COPILOT_TOOL_GUIDE.filter(([n]) => offered.has(n)).map(([n, d]) => `${d} ${n}`);
  return `۷) راهنمای ابزارها: ${parts.join('؛ ')}.`;
}

const copilotSystemPrompt = (tools: any[] = COPILOT_TOOLS) => [
  `شما «دستیار هوشمند»${academyDisplayName() ? ` ${academyDisplayName()}` : ' آموزشگاه'} هستید؛ دستیار عمومی CRM آموزشگاه، فارسی‌زبان، دقیق و حرفه‌ای، برای امور مالی، هنرجویان و فراگیران، سرنخ‌ها، کلاس‌ها و دوره‌ها، کارهای کارکنان، پیام‌رسان، ثبت‌نام‌های سایت و آمار بازدید سایت. مخاطبین این مرکز عموماً رانندگان و مدیران حمل‌ونقل هستند و دوره‌ها آموزش کارت هوشمند است، نه آموزش رانندگی.`,
  'قوانین کار:',
  '۱) برای هر عدد، آمار، موجودی، بدهی یا گردش مالی حتماً از ابزارهای در دسترس استفاده کنید و هرگز عددی را حدس نزنید.',
  '۲) اگر پرسش کاربر نیازمند داده‌ای است که ابزاری برای آن وجود ندارد، صادقانه بگویید داده در دسترس نیست.',
  '۳) همه مبالغ را به تومان و با جداکننده هزارگان بنویسید؛ مثلا ۱٬۲۵۰٬۰۰۰ تومان.',
  '۴) پاسخ‌ها را کوتاه و ساختاریافته به زبان فارسی بنویسید؛ در صورت نیاز از فهرست کوتاه یا جدول ساده استفاده کنید.',
  '۵) هرگز کلید API، نام جداول یا جزئیات فنی ابزارها را در پاسخ نمایش ندهید؛ وضعیت‌ها و کدها (مثل new، pending، approved، paid) را همیشه به فارسی بگویید، نه کد انگلیسی.',
  '۶) شما مستقیماً هیچ پیامی ارسال نمی‌کنید و چیزی را تغییر نمی‌دهید. ابزارهای sms_send، send_telegram_message و send_rubika_message (اگر در دسترس باشند) فقط پیش‌نویس می‌سازند؛ پیش‌نمایش را به کاربر نشان دهید و بگویید برای ارسال، دکمه «تأیید» را در کادر زیر گفتگو بزند. هرگز نگویید پیام ارسال شد. اگر این ابزارها در دسترس نیستند، متن پیشنهادی بنویسید و بگویید از بخش «پیام‌رسان» ارسال کند.',
  copilotToolGuide(tools),
  '۸) هر ابزار را با همان ورودی تکرار نکنید؛ وقتی داده کافی است مستقیم پاسخ دهید.',
  '۹) تاریخ‌ها شمسی و به وقت تهران هستند؛ تاریخ ورودی ابزارها را به شکل YYYY/MM/DD شمسی بدهید.',
].join('\n');

const COPILOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_student',
      description: 'جستجوی کارآموز بر اساس نام، کد ملی یا شماره تماس. برای پیدا کردن شناسه کارآموز استفاده می‌شود.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'نام، نام خانوادگی، کد ملی یا شماره تماس کارآموز' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_student_financial_summary',
      description: 'خلاصه مالی یک کارآموز: مجموع شهریه، مجموع پرداخت‌ها و مانده بدهی.',
      parameters: {
        type: 'object',
        properties: {
          student_id: { type: 'integer', description: 'شناسه کارآموز' },
        },
        required: ['student_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_cashflow',
      description: 'گردش مالی یک روز: مجموع دریافتی‌ها، مجموع پرداختی‌ها و خالص جریان نقدی.',
      parameters: {
        type: 'object',
        properties: {
          date_jalali: { type: 'string', description: 'تاریخ شمسی به فرمت YYYY/MM/DD؛ در صورت خالی بودن، امروز در نظر گرفته می‌شود' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_debtors_list',
      description: 'فهرست بدهکاران به ترتیب بیشترین بدهی، همراه با شماره تماس.',
      parameters: {
        type: 'object',
        properties: {
          min_debt: { type: 'number', description: 'حداقل مبلغ بدهی (پیش‌فرض ۱ تومان)' },
          limit: { type: 'integer', description: 'حداکثر تعداد نتایج (پیش‌فرض ۱۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_course_statistics',
      description: 'آمار یک دوره: تعداد ثبت‌نام‌ها و مجموع مبالغ وصول‌شده.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer', description: 'شناسه دوره' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_courses',
      description: 'فهرست همه دوره‌ها با شناسه، عنوان، شهریه (تومان) و وضعیت فعال بودن. برای پرسش قیمت/شهریه یا یافتن شناسه دوره.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_site_registrations',
      description: 'ثبت‌نام‌های آنلاین سایت. status=pending (پیش‌فرض) یعنی در انتظار تأیید؛ all یعنی همه ثبت‌نام‌های اخیر.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'all'], description: 'pending یا all' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_leads',
      description: 'سرنخ‌ها (متقاضیان/تماس‌گیرندگان): نام، موبایل، منبع، دوره مورد علاقه، وضعیت و تاریخ پیگیری بعدی.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['new', 'contacted', 'in_negotiation', 'converted', 'lost'], description: 'فیلتر وضعیت (اختیاری)' },
          due_only: { type: 'boolean', description: 'فقط سرنخ‌های باز که تاریخ پیگیری دارند' },
          query: { type: 'string', description: 'جستجو در نام یا موبایل' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_funnel',
      description: 'قیف فروش به تفکیک منبع سرنخ: تعداد کل، جدید، تماس‌گرفته، در حال پیگیری، تبدیل‌شده، از دست رفته و نرخ تبدیل.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'کارهای ارجاع‌شده به کارکنان: عنوان، مسئول، مهلت، اولویت، وضعیت و عقب‌افتاده بودن.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'done', 'all'], description: 'open (پیش‌فرض) = باز و در حال انجام' },
          assignee: { type: 'string', description: 'نام کاربری مسئول (اختیاری)' },
          overdue_only: { type: 'boolean', description: 'فقط کارهای عقب‌افتاده' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_course_terms',
      description: 'دوره‌های برگزارشده/در حال برگزاری (شماره دوره، کلاس‌ها): تاریخ شروع و پایان، ظرفیت، تعداد ثبت‌نام و وضعیت.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer', description: 'شناسه نوع دوره (از list_courses)' },
          status: { type: 'string', description: 'فیلتر وضعیت (اختیاری)' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_enrollments',
      description: 'ثبت‌نام‌های کارآموزان در دوره‌ها: کارآموز، دوره، شماره دوره، تاریخ ثبت‌نام، شهریه، پرداختی، مانده و وجود رسید/قرارداد.',
      parameters: {
        type: 'object',
        properties: {
          student_id: { type: 'integer', description: 'شناسه کارآموز' },
          course_id: { type: 'integer', description: 'شناسه نوع دوره' },
          course_number: { type: 'integer', description: 'شماره دوره' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۳۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_payments',
      description: 'پرداخت‌های دریافتی (فیش‌ها): تاریخ، مبلغ، روش پرداخت، کارآموز و دوره، به همراه جمع کل.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'از تاریخ شمسی YYYY/MM/DD' },
          date_to: { type: 'string', description: 'تا تاریخ شمسی YYYY/MM/DD' },
          student_id: { type: 'integer', description: 'شناسه کارآموز' },
          course_id: { type: 'integer', description: 'شناسه نوع دوره' },
          limit: { type: 'integer', description: 'حداکثر تعداد ردیف (پیش‌فرض ۳۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_financial_report',
      description: 'گزارش‌های مالی: expenses = هزینه‌ها (با بازه تاریخ)، expenses_by_category = هزینه به تفکیک دسته، profit_loss_monthly = سود و زیان ماهانه، bank_accounts = حساب‌های بانکی، overdue_installments = اقساط سررسیدگذشته.',
      parameters: {
        type: 'object',
        properties: {
          report: { type: 'string', enum: ['expenses', 'expenses_by_category', 'profit_loss_monthly', 'bank_accounts', 'overdue_installments'] },
          date_from: { type: 'string', description: 'از تاریخ شمسی YYYY/MM/DD (برای expenses)' },
          date_to: { type: 'string', description: 'تا تاریخ شمسی YYYY/MM/DD (برای expenses)' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۳۰)' },
        },
        required: ['report'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_messaging',
      description: 'پیام‌رسان و کمپین‌ها: threads = گفتگوها (کانال، نام، تعداد خوانده‌نشده، آخرین پیام)، campaigns = کمپین‌های پیام انبوه و آمار ارسال.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['threads', 'campaigns'], description: 'پیش‌فرض threads' },
          unread_only: { type: 'boolean', description: 'فقط گفتگوهای دارای پیام خوانده‌نشده' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_activity_log',
      description: 'سوابق فعالیت: audit = گزارش تغییرات کاربران CRM (چه کسی، چه زمانی، چه بخشی)، activities = تماس‌ها و یادداشت‌های ثبت‌شده برای کارآموز یا سرنخ.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['audit', 'activities'], description: 'پیش‌فرض audit' },
          username: { type: 'string', description: 'نام کاربری (اختیاری)' },
          entity: { type: 'string', description: 'برای audit: بخش (مثل payments)؛ برای activities: student یا lead' },
          entity_id: { type: 'integer', description: 'برای activities: شناسه کارآموز یا سرنخ' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
];

const LEAD_STATUS_FA: Record<string, string> = { new: 'جدید', contacted: 'تماس گرفته شد', in_negotiation: 'در حال پیگیری', converted: 'تبدیل‌شده', lost: 'از دست رفته' };
const SMS_STATUS_FA: Record<string, string> = { sent: 'ارسال‌شده', failed: 'ناموفق', not_configured: 'تنظیم‌نشده', queued: 'در صف', delivered: 'تحویل‌شده', received: 'دریافت‌شده', pending: 'در انتظار' };

/** Bounded LIMIT for Copilot tools (1..50). */
function copilotLimit(v: any, def: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : def;
}

/** UTC datetime (Date or 'YYYY-MM-DD HH:MM:SS' without zone) -> Jalali date/time in Tehran, e.g. 1405/07/29 14:05. */
function copilotTehran(v: any): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : `${String(v).replace(' ', 'T')}Z`);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('fa-IR-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Last change date of a stored file (public path under the project root), or null when it is missing. */
function copilotFileDate(v: any): string | null {
  if (!v) return null;
  try {
    const rel = decodeURIComponent(String(v).split(/[?#]/)[0]).replace(/^\/+/, '');
    return copilotTehran(fs.statSync(path.resolve(process.cwd(), rel)).mtime);
  } catch { return null; }
}

/** Normalizes a Jalali date argument to zero-padded YYYY/MM/DD (Latin digits), or null. */
function copilotJalali(v: any): string | null {
  const t = String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0)).replace(/[-.]/g, '/').trim();
  const m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : null;
}

function toNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const COPILOT_SQL_ENABLED = String(process.env.COPILOT_SQL_ENABLED || '').trim() === '1';

const COPILOT_SQL_TOOL = {
  type: 'function',
  function: {
    name: 'run_sql_query',
    description: 'اجرای یک پرس‌وجوی فقط-خواندنی SELECT روی پایگاه crm (MySQL) یا site (SQLite)، فقط وقتی هیچ ابزار دیگری کافی نیست. حداکثر ۲۰۰ ردیف. برای نام مستعار از کلمات رزرو‌شده مثل count/date/order استفاده نکنید (مثلاً total_count).\n' + COPILOT_SQL_SCHEMA,
    parameters: {
      type: 'object',
      properties: {
        database: { type: 'string', enum: ['crm', 'site'] },
        sql: { type: 'string', description: 'یک دستور SELECT بدون ; و بدون کامنت' },
      },
      required: ['database', 'sql'],
    },
  },
};

const COPILOT_UMAMI_TOOL = {
  type: 'function',
  function: {
    name: 'get_site_analytics',
    description: 'آمار بازدید سایت kermanshahcart.ir از Umami (فقط خواندنی): بازدید، بازدیدکننده، صفحه‌دیده‌شده، پرش، کاربران آنلاین و پرتکرارترین صفحه/ارجاع‌دهنده/دستگاه/شهر/رویداد/مرورگر/سیستم‌عامل/کشور. روزها به وقت تهران. برای custom تاریخ شمسی یا میلادی به شکل YYYY-MM-DD بدهید.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'custom'] },
        startDate: { type: 'string', description: 'YYYY-MM-DD (فقط برای custom)' },
        endDate: { type: 'string', description: 'YYYY-MM-DD (فقط برای custom؛ پیش‌فرض همان startDate)' },
        metrics: { type: 'array', items: { type: 'string', enum: ['path', 'referrer', 'device', 'city', 'event', 'browser', 'os', 'country'] } },
      },
      required: ['period'],
    },
  },
};

/** run_sql_query limited to the site SQLite (used next to DBHub, which serves the CRM MySQL). */
const COPILOT_SITE_SQL_TOOL = {
  type: 'function',
  function: {
    ...COPILOT_SQL_TOOL.function,
    description: 'اجرای یک SELECT فقط-خواندنی روی پایگاه site (SQLite سایت). برای پایگاه CRM از execute_sql_crm و ابزارهای گزارش استفاده کنید.\n' + COPILOT_SQL_SCHEMA,
    parameters: { ...COPILOT_SQL_TOOL.function.parameters, properties: { ...COPILOT_SQL_TOOL.function.parameters.properties, database: { type: 'string', enum: ['site'] } } },
  },
};

/** Telegram Bot API send (TELEGRAM_BOT_TOKEN; optional TELEGRAM_PROXY as http://host:port, tunnelled with CONNECT). */
function sendTelegramMessage(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return Promise.resolve({ ok: false, error: 'ارسال تلگرام پیکربندی نشده است' });
  const body = JSON.stringify({ chat_id: chatId, text });
  const send = (socket?: any) => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const r = https.request({ host: 'api.telegram.org', port: 443, method: 'POST', path: `/bot${token}/sendMessage`, servername: 'api.telegram.org',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000, ...(socket ? { socket, agent: false } : {}) }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j: any = {}; try { j = JSON.parse(d); } catch {} resolve(j.ok ? { ok: true } : { ok: false, error: String(j.description || `HTTP ${res.statusCode}`) }); });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ ok: false, error: e.message }));
    r.end(body);
  });
  const proxy = String(process.env.TELEGRAM_PROXY || '').trim();
  if (!proxy) return send();
  let u: URL; try { u = new URL(proxy); } catch { return Promise.resolve({ ok: false, error: 'TELEGRAM_PROXY نامعتبر است' }); }
  if (u.protocol !== 'http:') return Promise.resolve({ ok: false, error: 'فقط پروکسی http برای تلگرام پشتیبانی می‌شود' });
  return new Promise((resolve) => {
    const c = http.request({ host: u.hostname, port: Number(u.port || 80), method: 'CONNECT', path: 'api.telegram.org:443', timeout: 15000 });
    c.on('connect', (res, socket) => { if (res.statusCode !== 200) { socket.destroy(); resolve({ ok: false, error: `proxy ${res.statusCode}` }); } else send(socket).then(resolve); });
    c.on('timeout', () => c.destroy(new Error('proxy timeout')));
    c.on('error', (e) => resolve({ ok: false, error: e.message }));
    c.end();
  });
}

const maskChatId = (v: string) => (v.length > 6 ? `${v.slice(0, 4)}…${v.slice(-2)}` : '***');

/** Resolve a Copilot send recipient: «chat:<id>» = explicit chat id; otherwise a trainee by student_id, mobile or name, using the stored Rubika link. */
async function resolveCopilotRecipient(channel: 'telegram' | 'rubika', raw: string): Promise<{ chatId: string; label: string } | { error: string }> {
  const q = sanitizeString(raw, 100);
  if (/^chat:/i.test(q)) { const id = q.slice(5).trim(); return id ? { chatId: id, label: `گفتگو ${maskChatId(id)}` } : { error: 'شناسه گفتگو خالی است.' }; }
  let rows: any[] = [];
  const mobile = normalizeMobile(q);
  if (/^\d{1,9}$/.test(q)) rows = await chabokan.sql<any>('SELECT student_id, first_name, last_name FROM students WHERE student_id = ? LIMIT 2', [Number(q)]);
  else if (/^09\d{9}$/.test(mobile)) rows = await chabokan.sql<any>('SELECT student_id, first_name, last_name FROM students WHERE phone_number = ? LIMIT 2', [mobile]);
  else rows = await chabokan.sql<any>("SELECT student_id, first_name, last_name FROM students WHERE CONCAT(first_name, ' ', last_name) LIKE ? LIMIT 5", [`%${q}%`]);
  if (!rows.length) return { error: 'کارآموزی با این مشخصات پیدا نشد.' };
  if (rows.length > 1) return { error: `${rows.length} کارآموز با این مشخصات پیدا شد؛ شناسه کارآموز (student_id) را بدهید.` };
  const st = rows[0];
  const label = `آقای ${String(st.first_name || '').trim()} ${String(st.last_name || '').trim()}`.trim();
  const link = (readDb() as any)[channel === 'rubika' ? 'rubika_links' : 'telegram_links']?.[String(st.student_id)];
  if (!link) return { error: 'این کارآموز به روبیکا/تلگرام وصل نیست' };
  return { chatId: String(link), label };
}

const COPILOT_SEND_TELEGRAM_TOOL = {
  type: 'function',
  function: {
    name: 'send_telegram_message',
    description: 'یک پیام تلگرام پیش‌نویس می‌سازد و برای تأیید ادمین در صف می‌گذارد. هیچ‌چیزی ارسال نمی‌شود تا زمانی که ادمین در ویجت تأیید کند. پارامترها: recipient (student_id کارآموز یا chat_id صریح)، text (متن پیام). بازگرداندن: { pending_id, preview }.',
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'شناسه کارآموز (student_id)، موبایل یا نام کارآموز؛ یا chat:<شناسه گفتگو> برای یک گفتگوی مشخص' },
        text: { type: 'string', description: 'متن پیام برای ارسال' },
      },
      required: ['recipient', 'text'],
    },
  },
};

const COPILOT_SEND_RUBIKA_TOOL = {
  type: 'function',
  function: {
    name: 'send_rubika_message',
    description: 'یک پیام روبیکا پیش‌نویس می‌سازد و برای تأیید ادمین در صف می‌گذارد. هیچ‌چیزی ارسال نمی‌شود تا زمانی که ادمین در ویجت تأیید کند. پارامترها: recipient (student_id کارآموز یا chat_id صریح)، text (متن پیام). بازگرداندن: { pending_id, preview }.',
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'شناسه کارآموز (student_id)، موبایل یا نام کارآموز؛ یا chat:<شناسه گفتگو> برای یک گفتگوی مشخص' },
        text: { type: 'string', description: 'متن پیام برای ارسال' },
      },
      required: ['recipient', 'text'],
    },
  },
};

const COPILOT_SMS_TOOLS = [
  { type: 'function', function: { name: 'sms_get_credit', description: 'اعتبار باقی‌مانده پنل پیامک (sms.ir) و شماره خط(های) ارسال. فقط خواندنی.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'sms_delivery_status', description: 'وضعیت تحویل پیامک‌ها از پنل sms.ir. با message_id وضعیت یک پیامک؛ بدون آن فهرست پیامک‌های ارسالی اخیر (امروز یا بایگانی) با وضعیت تحویل. فقط خواندنی.', parameters: { type: 'object', properties: {
    message_id: { type: 'string', description: 'شناسه پیامک در sms.ir (اختیاری)' },
    scope: { type: 'string', enum: ['live', 'archive'], description: 'live = ارسال‌های امروز (پیش‌فرض)، archive = بایگانی روزهای قبل' },
    limit: { type: 'number', description: 'حداکثر تعداد (پیش‌فرض ۱۰، حداکثر ۵۰)' } } } } },
  { type: 'function', function: { name: 'sms_list_received', description: 'پیامک‌های دریافتی (پاسخ‌های مخاطبان) از پنل sms.ir. فقط خواندنی.', parameters: { type: 'object', properties: {
    scope: { type: 'string', enum: ['live', 'archive'], description: 'live = دریافتی‌های جدید/امروز (پیش‌فرض)، archive = بایگانی' },
    limit: { type: 'number', description: 'حداکثر تعداد (پیش‌فرض ۱۰، حداکثر ۵۰)' } } } } },
  { type: 'function', function: { name: 'sms_send', description: 'یک پیامک پیش‌نویس می‌سازد و برای تأیید ادمین در صف می‌گذارد؛ هیچ‌چیزی ارسال نمی‌شود تا ادمین در ویجت «تأیید» را بزند. گیرنده: student_id یا موبایل (حداکثر ۲۰ گیرنده). محتوا: یا template_key (الگوهای ذخیره‌شده، مثل registration_welcome یا class_schedule) با params، یا text آزاد. بازگرداندن: { pending_id, preview } شامل متن نهایی، شناسه الگو و هزینه تقریبی.', parameters: { type: 'object', properties: {
    recipients: { type: 'array', items: { type: 'string' }, description: 'فهرست student_id یا شماره موبایل (09xxxxxxxxx)؛ حداکثر ۲۰' },
    template_key: { type: 'string', description: 'کلید الگوی پیامک (اختیاری؛ به‌جای text)' },
    params: { type: 'object', description: 'مقادیر متغیرهای الگو، مثل { "name": "علی", "course": "..." }؛ نام و موبایل هر کارآموز خودکار پر می‌شود', additionalProperties: { type: 'string' } },
    text: { type: 'string', description: 'متن آزاد پیامک (اگر template_key داده نشده)' } }, required: ['recipients'] } } },
];

const SMSIR_DELIVERY_FA: Record<number, string> = { 1: 'رسیده به گوشی', 2: 'نرسیده به گوشی', 3: 'پردازش در مخابرات', 4: 'نرسیده به مخابرات', 5: 'رسیده به اپراتور', 6: 'ناموفق', 7: 'لیست سیاه' };
let smsirLastCall = 0;
/** Read-only GET against sms.ir (key from env, never returned). Spaces calls ~2s apart. */
async function smsirGet(path: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const apiKey = process.env.SMS_API_KEY || '';
  if (!apiKey) return { ok: false, error: 'درگاه پیامک تنظیم نشده است.' };
  const wait = smsirLastCall + 2000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  smsirLastCall = Date.now();
  try {
    const r = await fetch(`https://api.sms.ir${path}`, { headers: { 'x-api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const t = await r.text(); let b: any = null; try { b = JSON.parse(t); } catch { /* non-JSON */ }
    if (b && b.status === 1) return { ok: true, data: b.data };
    if (b && b.status === 20) return { ok: false, error: 'محدودیت تعداد درخواست پنل پیامک؛ چند ثانیه دیگر دوباره تلاش کنید.' };
    return { ok: false, error: String((b && b.message) || `HTTP ${r.status}`).split(apiKey).join('***').slice(0, 200) };
  } catch (e: any) { return { ok: false, error: e?.name === 'TimeoutError' ? 'پاسخی از سرویس پیامک نرسید.' : 'خطا در اتصال به سرویس پیامک' }; }
}
/** OTP codes must never reach the model: mask digits in verification-code texts. */
const redactSmsText = (t: unknown) => { const s = String(t ?? ''); return /کد\s*(تایید|تأیید|ورود)|code|رمز/i.test(s) ? s.replace(/\d{3,8}/g, '****') : s; };
const smsirTime = (sec: unknown) => { const n = Number(sec); return n > 0 ? copilotTehran(new Date(n * 1000).toISOString()) : null; };
const smsirMobile = (m: unknown) => maskPhone(String(m ?? '').replace(/^(?=9\d{9}$)/, '0'));
const smsParts = (t: string) => { const uni = /[^\x00-\x7F]/.test(t); const one = uni ? 70 : 160; const multi = uni ? 67 : 153; return t.length <= one ? 1 : Math.ceil(t.length / multi); };

/** Tools offered to this user (admin-only extras): SQL via DBHub (COPILOT_DB_BACKEND=dbhub, falls back to builtin when down) or builtin run_sql_query, plus get_site_analytics. */
/** Admin-only read-only tools (exams, documents, SMS); offered only to admin and re-checked in runCopilotTool. */
const COPILOT_ADMIN_READ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_exams',
      description: 'زمان‌بندی آزمون دوره‌ها. نتیجه یا نمره آزمون در CRM ذخیره نمی‌شود؛ تاریخ آزمون بر پایه تاریخ پایان دوره‌ها گزارش می‌شود: دوره، شماره دوره، تاریخ شروع و پایان، تعداد ثبت‌نام‌ها و تعداد کارآموزان دارای مانده بدهی.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer', description: 'شناسه نوع دوره' },
          status: { type: 'string', enum: ['active', 'finished'], description: 'فیلتر وضعیت دوره (اختیاری)' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description: 'مدارک و فایل‌های کارآموزان: رسید پرداخت، قرارداد، کارت ملی، عکس کارت ملی و عکس شخصی. فقط نام فایل، نوع، تاریخ و تعداد برگردانده می‌شود؛ محتوای فایل‌ها هرگز خوانده یا برگردانده نمی‌شود.',
      parameters: {
        type: 'object',
        properties: {
          student_id: { type: 'integer', description: 'شناسه کارآموز' },
          kind: { type: 'string', enum: ['documents', 'generated'], description: 'documents (پیش‌فرض) = مدارک ثبت‌نام و عکس‌ها؛ generated = مدارک تولیدشده از الگوها' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sms',
      description: 'پیامک‌ها: messages = سوابق پیامک‌های ارسالی و وضعیت آن‌ها، templates = الگوهای پیامک آماده، campaigns = کمپین‌های پیامک انبوه و آمار ارسال. فقط خواندنی است و هیچ پیامکی ارسال نمی‌کند.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['messages', 'templates', 'campaigns'], description: 'پیش‌فرض messages' },
          limit: { type: 'integer', description: 'حداکثر تعداد (پیش‌فرض ۲۰)' },
        },
        required: [],
      },
    },
  },
];

async function copilotToolsFor(role: string) {
  if (role !== 'admin') return COPILOT_TOOLS;
  let sqlTools: any[] = [];
  if (COPILOT_SQL_ENABLED) {
    const dbhub = dbhubSelected() ? await getDbhubTools() : null;
    sqlTools = dbhub ? [...dbhub, COPILOT_SITE_SQL_TOOL] : [COPILOT_SQL_TOOL];
  }
  return [...COPILOT_TOOLS, ...COPILOT_ADMIN_READ_TOOLS, ...sqlTools, COPILOT_SEND_TELEGRAM_TOOL, COPILOT_SEND_RUBIKA_TOOL, ...COPILOT_SMS_TOOLS, ...(umamiEnabled() ? [COPILOT_UMAMI_TOOL] : [])];
}

async function auditCopilotSql(username: string, e: { db: string; sql: string; allowed: boolean; reason: string | null; rows: number | null; ms: number | null }) {
  try {
    await chabokan.sqlExec(
      'INSERT INTO crm_copilot_queries (username, db, sql_text, allowed, reason, row_count, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username || null, e.db.slice(0, 10), e.sql.slice(0, 8000), e.allowed ? 1 : 0, e.reason ? e.reason.slice(0, 500) : null, e.rows, e.ms]);
  } catch (err: any) { console.warn('copilot sql audit failed:', err?.message || err); }
}

async function runCopilotTool(name: string, args: any, ctx: { username: string; role: string } = { username: '', role: '' }): Promise<any> {
  const a = args && typeof args === 'object' ? args : {};

  if (name === 'run_sql_query') {
    if (!COPILOT_SQL_ENABLED || ctx.role !== 'admin') return { error: 'این ابزار برای شما فعال نیست.' };
    return runCopilotSql(a.database, a.sql, (e) => auditCopilotSql(ctx.username, e));
  }

  if (isDbhubTool(name)) {
    if (!COPILOT_SQL_ENABLED || ctx.role !== 'admin') return { error: 'این ابزار برای شما فعال نیست.' };
    return callDbhubTool(name, a, (e) => auditCopilotSql(ctx.username, e));
  }

  if (name === 'get_site_analytics') {
    if (!umamiEnabled() || ctx.role !== 'admin') return { error: 'این ابزار برای شما فعال نیست.' };
    return getSiteAnalytics(a);
  }

  if (name === 'send_notification') {
    // Disabled: sending must go through a human-confirmed UI flow, never directly from the model.
    return { error: 'ارسال پیام از طریق دستیار غیرفعال است؛ از بخش پیام‌رسان استفاده کنید.' };
  }

  if (name === 'sms_get_credit') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    const c = await smsirGet('/v1/credit');
    const l = await smsirGet('/v1/line');
    let cfgLine = ''; try { cfgLine = String((await sharedSms.getConfig()).lineNumber || ''); } catch { /* ignore */ }
    if (!c.ok) return { error: c.error };
    return { credit: c.data, credit_unit: 'اعتبار پنل sms.ir', lines: l.ok ? l.data : [], configured_line: cfgLine || null };
  }

  if (name === 'sms_delivery_status') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    const fmt = (m: any) => ({ message_id: m.messageId, mobile: smsirMobile(m.mobile), text: redactSmsText(m.messageText).slice(0, 200),
      sent_at: smsirTime(m.sendDateTime), line: m.lineNumber, cost: m.cost, delivery: SMSIR_DELIVERY_FA[Number(m.deliveryState)] || (m.deliveryState == null ? 'نامشخص' : String(m.deliveryState)),
      delivered_at: smsirTime(m.deliveryDateTime) });
    const mid = toLatinDigits(String(a.message_id ?? '')).replace(/\D/g, '');
    if (mid) { const r = await smsirGet(`/v1/send/${mid}`); return r.ok ? { message: r.data ? fmt(r.data) : null } : { error: r.error }; }
    const limit = Math.min(50, Math.max(1, Number(a.limit) || 10));
    const scope = a.scope === 'archive' ? 'archive' : 'live';
    const r = await smsirGet(`/v1/send/${scope}?pageNumber=1&pageSize=${limit}`);
    if (!r.ok) return { error: r.error };
    const list = (Array.isArray(r.data) ? r.data : []).map(fmt);
    return { scope, count: list.length, messages: list };
  }

  if (name === 'sms_list_received') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    const limit = Math.min(50, Math.max(1, Number(a.limit) || 10));
    const scope = a.scope === 'archive' ? 'archive' : 'live';
    const r = await smsirGet(`/v1/receive/${scope}?pageNumber=1&pageSize=${limit}${scope === 'live' ? '&sortByNewest=true' : ''}`);
    if (!r.ok) return { error: r.error };
    const list = (Array.isArray(r.data) ? r.data : []).map((m: any) => ({ number: smsirMobile(m.number ?? m.mobile), text: String(m.messageText ?? '').slice(0, 300),
      received_at: smsirTime(m.receivedDateTime ?? m.sendDateTime), line: m.lineNumber ?? null }));
    return { scope, count: list.length, messages: list };
  }

  if (name === 'sms_send') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    const raw: string[] = (Array.isArray(a.recipients) ? a.recipients : [a.recipients ?? a.recipient ?? a.mobile ?? a.student_id]).filter((x: any) => x != null && String(x).trim()).map((x: any) => sanitizeString(String(x), 40));
    if (!raw.length) return { error: 'حداقل یک گیرنده لازم است.' };
    if (raw.length > 20) return { error: 'حداکثر ۲۰ گیرنده در هر درخواست مجاز است.' };
    const key = sanitizeString(a.template_key, 60);
    const freeText = sanitizeString(a.text, 1000);
    if (!key && !freeText) return { error: 'template_key یا text الزامی است.' };
    if (key && freeText) return { error: 'فقط یکی از template_key یا text را بدهید.' };
    let tpl: any = null;
    if (key) {
      if (/^otp/i.test(key)) return { error: 'این الگو از طریق دستیار قابل ارسال نیست.' };
      tpl = await sharedSms.getTemplate(key);
      if (!tpl) return { error: 'الگوی پیامک با این کلید پیدا نشد.' };
      if (!tpl.enabled) return { error: 'این الگو غیرفعال است.' };
    }
    const vars: Record<string, string> = {};
    if (a.params && typeof a.params === 'object') for (const [k, v] of Object.entries(a.params)) if (/^\w{1,40}$/.test(k)) vars[k] = sanitizeString(String(v ?? ''), 200);
    const items: { mobile: string; label: string; studentId?: number | null; text: string }[] = [];
    const errors: string[] = [];
    for (const r0 of raw) {
      const q = toLatinDigits(r0).trim(); const mob = normalizeMobile(q);
      let st: any = null;
      if (/^\d{1,9}$/.test(q)) st = (await chabokan.sql<any>('SELECT student_id, first_name, last_name, phone_number FROM students WHERE student_id = ? LIMIT 1', [Number(q)]))[0];
      else if (/^09\d{9}$/.test(mob)) st = (await chabokan.sql<any>('SELECT student_id, first_name, last_name, phone_number FROM students WHERE phone_number = ? LIMIT 1', [mob]))[0] || { phone_number: mob };
      else { errors.push(`${r0}: شناسه یا موبایل نامعتبر`); continue; }
      if (!st) { errors.push(`${r0}: کارآموز پیدا نشد`); continue; }
      const mobile = normalizeMobile(st.phone_number);
      if (!/^09\d{9}$/.test(mobile)) { errors.push(`${r0}: شماره موبایل معتبر ندارد`); continue; }
      if (items.some((x) => x.mobile === mobile)) continue;
      const nm = `${String(st.first_name || '').trim()} ${String(st.last_name || '').trim()}`.trim();
      const v = { ...vars }; if (nm && !v.name) v.name = nm; if (!v.mobile) v.mobile = mobile;
      const text = tpl ? sharedSms.render(tpl.body_fa || tpl.fallback_body_fa || '', v).replace(/\n+$/, '') : freeText;
      if (tpl && tpl.channel_kind === 'verify') { const { missing } = sharedSms.buildVerifyParams(tpl, v); if (missing.length) { errors.push(`${r0}: متغیر خالی الگو (${missing.join('، ')})`); continue; } }
      items.push({ mobile, label: nm || 'شماره آزاد', studentId: st.student_id ?? null, text });
    }
    if (!items.length) return { error: `هیچ گیرنده معتبری نماند. ${errors.join('؛ ')}` };
    const parts = items.reduce((n, x) => n + smsParts(x.text), 0);
    const pendingId = `sms_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    pendingMessages.set(pendingId, { id: pendingId, createdBy: ctx.username, channel: 'sms', recipient: items.map((x) => x.mobile).join(','),
      label: items.length === 1 ? items[0].label : `${items.length} گیرنده`, text: items[0].text, createdAt: now, expiresAt: now + PENDING_TTL_MS,
      sms: { items, templateKey: key || null, vars } });
    const head = `✉️ پیامک → ${items.length} گیرنده${tpl ? ` | الگو: ${key}${tpl.provider_template_id ? ` (شناسه sms.ir ${tpl.provider_template_id}، ${tpl.channel_kind === 'verify' ? 'ارسال الگویی' : 'ارسال متنی'})` : ' (ارسال متنی)'}` : ' | متن آزاد'} | هزینه تقریبی: ${parts} بخش پیامک`;
    const lines = items.slice(0, 5).map((x) => `• ${x.label} ${x.mobile}${items.length > 1 ? '' : ''}`);
    if (items.length > 5) lines.push(`• و ${items.length - 5} گیرنده دیگر`);
    const sample = items.length > 1 && items.some((x) => x.text !== items[0].text) ? '(متن نمونه برای گیرنده اول)\n' : '';
    return { pending_id: pendingId, preview: `${head}\n${lines.join('\n')}\n${sample}${items[0].text}`, skipped: errors.length ? errors : undefined,
      note: 'هنوز ارسال نشده است؛ ادمین باید در کادر تأیید زیر گفتگو «تأیید» را بزند.' };
  }

  if (name === 'send_telegram_message') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    const recipient = sanitizeString(a.recipient, 100);
    const text = sanitizeString(a.text, 2000);
    if (!recipient || !text) return { error: 'recipient و text الزامی هستند.' };
    const to = await resolveCopilotRecipient('telegram', recipient);
    if ('error' in to) return { error: to.error };
    const pendingId = `tg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    pendingMessages.set(pendingId, {
      id: pendingId,
      createdBy: ctx.username,
      channel: 'telegram',
      recipient: to.chatId,
      label: to.label,
      text,
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
    });
    return { pending_id: pendingId, preview: `📱 تلگرام → ${to.label}\n${text}` };
  }

  if (name === 'send_rubika_message') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    const recipient = sanitizeString(a.recipient, 100);
    const text = sanitizeString(a.text, 2000);
    if (!recipient || !text) return { error: 'recipient و text الزامی هستند.' };
    const to = await resolveCopilotRecipient('rubika', recipient);
    if ('error' in to) return { error: to.error };
    const pendingId = `rb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    pendingMessages.set(pendingId, {
      id: pendingId,
      createdBy: ctx.username,
      channel: 'rubika',
      recipient: to.chatId,
      label: to.label,
      text,
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
    });
    return { pending_id: pendingId, preview: `💬 روبیکا → ${to.label}\n${text}` };
  }

  if (!chabokan.isMysqlEnabled()) {
    return { error: 'پایگاه داده MySQL در دسترس نیست.' };
  }

  if (name === 'list_courses') {
    const rows = await chabokan.listCourses();
    return {
      currency: 'toman',
      count: rows.length,
      courses: rows.map((r: any) => ({ course_id: r.id, title: r.title, price_toman: toNumber(r.tuition), active: Boolean(Number(r.active)) })),
    };
  }

  if (name === 'list_site_registrations') {
    const status = String(a.status || 'pending').trim() === 'all' ? 'all' : 'pending';
    const limit = Math.max(1, Math.min(100, Math.floor(toNumber(a.limit)) || 20));
    const all: any[] = await chabokan.listWebsiteRegistrations();
    // Same filter as the pending list page (PendingRegistrationsPanel).
    const filtered = status === 'pending' ? all.filter((r) => r.status === 'pending' && !r.student_id) : all;
    return {
      status,
      total: filtered.length,
      registrations: filtered.slice(0, limit).map((r) => ({
        tracking_code: r.tracking_code,
        full_name: r.full_name,
        phone_number: r.phone_number,
        category: r.category,
        status: r.status,
        created_at: copilotTehran(r.created_at),
        approved_or_rejected_at: copilotTehran(r.approved_at),
        paid_online_toman: toNumber(r.paid_toman),
      })),
    };
  }

  if (name === 'list_leads') {
    const where: string[] = []; const params: any[] = [];
    const st = String(a.status || '');
    if (['new', 'contacted', 'in_negotiation', 'converted', 'lost'].includes(st)) { where.push('l.status = ?'); params.push(st); }
    if (a.due_only === true) where.push("l.next_followup_date_jalali IS NOT NULL AND l.status NOT IN ('converted','lost')");
    const q = String(a.query || '').trim();
    if (q) { where.push("(CONCAT(COALESCE(l.first_name,''),' ',l.last_name) LIKE ? OR l.phone_number LIKE ?)"); params.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
    const rows = await chabokan.sql<any>(
      `SELECT l.lead_id, l.first_name, l.last_name, l.phone_number, ls.title AS source, c.title AS course, l.status,
              l.next_followup_date_jalali, l.loss_reason, l.notes, l.converted_student_id, l.created_at
       FROM leads l LEFT JOIN lead_sources ls ON ls.source_id = l.source_id LEFT JOIN courses c ON c.course_id = l.interested_course_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.lead_id DESC LIMIT ?`, [...params, copilotLimit(a.limit, 20)]);
    return { count: rows.length, leads: rows.map((r) => ({
      lead_id: r.lead_id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone_number: r.phone_number, source: r.source,
      course: r.course, status: LEAD_STATUS_FA[r.status] || r.status, next_followup: r.next_followup_date_jalali,
      loss_reason: r.loss_reason, notes: r.notes ? String(r.notes).slice(0, 200) : null, converted_student_id: r.converted_student_id,
      created_at: copilotTehran(r.created_at),
    })) };
  }

  if (name === 'get_sales_funnel') {
    const rows = await chabokan.sql<any>('SELECT * FROM v_sales_funnel_summary ORDER BY total_leads DESC');
    return { sources: rows.map((r) => ({
      source: r.source_title, total: toNumber(r.total_leads), new: toNumber(r.count_new), contacted: toNumber(r.count_contacted),
      in_negotiation: toNumber(r.count_in_negotiation), converted: toNumber(r.count_converted), lost: toNumber(r.count_lost),
      conversion_rate_percent: toNumber(r.conversion_rate_percent),
    })) };
  }

  if (name === 'list_tasks') {
    const where: string[] = []; const params: any[] = [];
    const st = String(a.status || 'open');
    if (st === 'open') where.push("t.status IN ('open','in_progress')");
    else if (st === 'done') where.push("t.status IN ('done','cancelled')");
    if (a.assignee) { where.push('t.assignee_username = ?'); params.push(String(a.assignee).trim()); }
    if (a.overdue_only === true) where.push("t.due_at IS NOT NULL AND t.due_at < UTC_TIMESTAMP() AND t.status IN ('open','in_progress')");
    const rows = await chabokan.sql<any>(
      `SELECT t.id, t.title, t.description, t.assignee_username, t.created_by, t.due_at, t.priority, t.status, t.entity_type, t.entity_id, t.completed_at,
              (t.due_at IS NOT NULL AND t.due_at < UTC_TIMESTAMP() AND t.status IN ('open','in_progress')) AS overdue
       FROM crm_tasks t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.due_at IS NULL, t.due_at, t.id DESC LIMIT ?`, [...params, copilotLimit(a.limit, 20)]);
    return { count: rows.length, tasks: rows.map((r) => ({
      id: r.id, title: r.title, description: r.description ? String(r.description).slice(0, 200) : null,
      assignee: r.assignee_username, created_by: r.created_by, due: copilotTehran(r.due_at), priority: r.priority, status: r.status,
      overdue: Boolean(Number(r.overdue)), related: r.entity_type ? `${r.entity_type}#${r.entity_id}` : null, completed_at: copilotTehran(r.completed_at),
    })) };
  }

  if (name === 'list_course_terms') {
    const where: string[] = []; const params: any[] = [];
    const cid = parseInt(String(a.course_id ?? ''), 10);
    if (Number.isFinite(cid)) { where.push('t.course_id = ?'); params.push(cid); }
    if (a.status) { where.push('t.status = ?'); params.push(String(a.status).trim()); }
    const rows = await chabokan.sql<any>(
      `SELECT t.id, t.course_id, c.title AS course, t.course_number, t.title, t.start_date, t.end_date, t.capacity, t.status, t.notes,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = t.course_id AND e.course_number = t.course_number) AS enrolled
       FROM crm_course_terms t LEFT JOIN courses c ON c.course_id = t.course_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.id DESC LIMIT ?`, [...params, copilotLimit(a.limit, 20)]);
    return { count: rows.length, terms: rows.map((r) => ({
      id: r.id, course_id: r.course_id, course: r.course, course_number: r.course_number, title: r.title,
      start_date: r.start_date, end_date: r.end_date, capacity: r.capacity, enrolled: toNumber(r.enrolled), status: r.status,
      notes: r.notes ? String(r.notes).slice(0, 200) : null,
    })) };
  }

  if (name === 'list_exams') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    // The CRM stores no exam table: exam timing is read from the course terms (end date) and the trainees' settlement.
    const where: string[] = []; const params: any[] = [];
    const cid = parseInt(String(a.course_id ?? ''), 10);
    if (Number.isFinite(cid)) { where.push('t.course_id = ?'); params.push(cid); }
    if (a.status) { where.push('t.status = ?'); params.push(String(a.status).trim()); }
    const rows = await chabokan.sql<any>(
      `SELECT t.id, t.course_id, c.title AS course, t.course_number, t.title, t.start_date, t.end_date, t.capacity, t.status,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = t.course_id AND e.course_number = t.course_number) AS enrolled,
              (SELECT COUNT(*) FROM enrollments e JOIN v_enrollment_balances b ON b.enrollment_id = e.enrollment_id
                WHERE e.course_id = t.course_id AND e.course_number = t.course_number AND b.balance_due > 0) AS unsettled
       FROM crm_course_terms t LEFT JOIN courses c ON c.course_id = t.course_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.end_date IS NULL, t.end_date DESC, t.id DESC LIMIT ?`,
      [...params, copilotLimit(a.limit, 20)]);
    return { note: 'نتیجه یا نمره آزمون در CRM ذخیره نمی‌شود؛ تاریخ آزمون بر پایه تاریخ پایان دوره است.',
      count: rows.length, exams: rows.map((r) => ({
        course: r.course, course_number: r.course_number, title: r.title, start_date: r.start_date, end_date: r.end_date,
        status: r.status, capacity: r.capacity, enrolled: toNumber(r.enrolled), unsettled: toNumber(r.unsettled),
      })) };
  }

  if (name === 'list_enrollments') {
    const where: string[] = []; const params: any[] = [];
    for (const [k, col] of [['student_id', 'e.student_id'], ['course_id', 'e.course_id'], ['course_number', 'e.course_number']] as const) {
      const v = parseInt(String(a[k] ?? ''), 10);
      if (Number.isFinite(v)) { where.push(`${col} = ?`); params.push(v); }
    }
    const rows = await chabokan.sql<any>(
      `SELECT e.enrollment_id, e.student_id, s.first_name, s.last_name, s.phone_number, c.title AS course, e.course_number, e.signup_date_jalali,
              b.final_price, b.amount_paid_from_payments AS paid, b.balance_due,
              (e.receipt_pdf_path IS NOT NULL) AS has_receipt, (e.contract_pdf_path IS NOT NULL) AS has_contract, (e.idcard_pdf_path IS NOT NULL) AS has_idcard
       FROM enrollments e JOIN students s ON s.student_id = e.student_id LEFT JOIN courses c ON c.course_id = e.course_id
       LEFT JOIN v_enrollment_balances b ON b.enrollment_id = e.enrollment_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.enrollment_id DESC LIMIT ?`, [...params, copilotLimit(a.limit, 30)]);
    return { count: rows.length, enrollments: rows.map((r) => ({
      enrollment_id: r.enrollment_id, student_id: r.student_id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone_number: r.phone_number,
      course: r.course, course_number: r.course_number, signup_date: r.signup_date_jalali, final_price: toNumber(r.final_price),
      paid: toNumber(r.paid), remaining: toNumber(r.balance_due),
      documents: { receipt: Boolean(Number(r.has_receipt)), contract: Boolean(Number(r.has_contract)), id_card: Boolean(Number(r.has_idcard)) },
    })) };
  }

  if (name === 'list_documents') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    // Only file metadata (name, type, date, count); the file contents are never read.
    const limit = copilotLimit(a.limit, 20);
    const sid = parseInt(String(a.student_id ?? ''), 10);
    const where: string[] = []; const params: any[] = [];
    if (Number.isFinite(sid)) { where.push('e.student_id = ?'); params.push(sid); }
    if (String(a.kind || 'documents') === 'generated') {
      try {
        const rows = await chabokan.sql<any>(
          `SELECT d.document_id, d.enrollment_id, e.student_id, s.first_name, s.last_name, c.title AS course, e.course_number,
                  rt.title_fa AS title, rt.category, d.paper_size, d.generated_at
           FROM enrollment_documents d JOIN enrollments e ON e.enrollment_id = d.enrollment_id
           JOIN students s ON s.student_id = e.student_id LEFT JOIN courses c ON c.course_id = e.course_id
           LEFT JOIN report_templates rt ON rt.template_id = d.template_id
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.generated_at DESC, d.document_id DESC LIMIT ?`,
          [...params, limit]);
        return { kind: 'generated', count: rows.length, documents: rows.map((r) => ({
          document_id: r.document_id, student_id: r.student_id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
          course: r.course, course_number: r.course_number, title: r.title, category: r.category,
          paper_size: r.paper_size, generated_at: copilotTehran(r.generated_at),
        })) };
      } catch {
        return { kind: 'generated', count: 0, documents: [], note: 'جدول مدارک تولیدشده در این پایگاه داده موجود نیست.' };
      }
    }
    const rows = await chabokan.sql<any>(
      `SELECT e.enrollment_id, e.student_id, s.first_name, s.last_name, c.title AS course, e.course_number,
              e.receipt_pdf_path, e.idcard_pdf_path, e.contract_pdf_path, s.id_card_photo, s.personal_photo
       FROM enrollments e JOIN students s ON s.student_id = e.student_id LEFT JOIN courses c ON c.course_id = e.course_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.enrollment_id DESC LIMIT ?`, [...params, limit]);
    const docs: any[] = []; const photos: any[] = []; const counts: Record<string, number> = {};
    const seenStudents = new Set<any>();
    for (const r of rows) {
      const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
      const add = (list: any[], type: string, file: any) => {
        if (!file) return;
        counts[type] = (counts[type] || 0) + 1;
        list.push({ student_id: r.student_id, name, enrollment_id: r.enrollment_id, course: r.course, course_number: r.course_number,
          type, file_name: String(file).split('/').pop(), date: copilotFileDate(file) });
      };
      add(docs, 'رسید پرداخت', r.receipt_pdf_path);
      add(docs, 'قرارداد', r.contract_pdf_path);
      add(docs, 'کارت ملی', r.idcard_pdf_path);
      if (!seenStudents.has(r.student_id)) {
        seenStudents.add(r.student_id);
        add(photos, 'عکس کارت ملی', r.id_card_photo);
        add(photos, 'عکس شخصی', r.personal_photo);
      }
    }
    return { kind: 'documents', enrollment_count: rows.length, document_count: docs.length, photo_count: photos.length,
      counts, documents: docs.slice(0, limit), photos: photos.slice(0, limit) };
  }

  if (name === 'list_payments') {
    const where: string[] = []; const params: any[] = [];
    const from = copilotJalali(a.date_from); const to = copilotJalali(a.date_to);
    if (from) { where.push('p.pay_date_jalali >= ?'); params.push(from); }
    if (to) { where.push('p.pay_date_jalali <= ?'); params.push(to); }
    const sid = parseInt(String(a.student_id ?? ''), 10);
    if (Number.isFinite(sid)) { where.push('p.student_id = ?'); params.push(sid); }
    const cid = parseInt(String(a.course_id ?? ''), 10);
    if (Number.isFinite(cid)) { where.push('e.course_id = ?'); params.push(cid); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = 'FROM payments p LEFT JOIN enrollments e ON e.enrollment_id = p.enrollment_id LEFT JOIN students s ON s.student_id = p.student_id LEFT JOIN courses c ON c.course_id = e.course_id';
    const [tot] = await chabokan.sql<any>(`SELECT COUNT(*) AS n, CAST(COALESCE(SUM(p.amount),0) AS DECIMAL(15,2)) AS total ${base} ${w}`, params);
    const rows = await chabokan.sql<any>(
      `SELECT p.payment_id, p.pay_date_jalali, p.amount, p.pay_method, p.payment_kind, p.ref_id, s.first_name, s.last_name, c.title AS course, e.course_number
       ${base} ${w} ORDER BY p.pay_date_jalali DESC, p.payment_id DESC LIMIT ?`, [...params, copilotLimit(a.limit, 30)]);
    return { date_from: from, date_to: to, payment_count: toNumber(tot?.n), total_amount: toNumber(tot?.total), shown: rows.length,
      payments: rows.map((r) => ({ payment_id: r.payment_id, date: r.pay_date_jalali, amount: toNumber(r.amount), method: r.pay_method,
        kind: r.payment_kind, ref_id: r.ref_id, student: `${r.first_name || ''} ${r.last_name || ''}`.trim(), course: r.course, course_number: r.course_number })) };
  }

  if (name === 'get_financial_report') {
    const report = String(a.report || '');
    const limit = copilotLimit(a.limit, 30);
    if (report === 'expenses') {
      const where: string[] = []; const params: any[] = [];
      const from = copilotJalali(a.date_from); const to = copilotJalali(a.date_to);
      if (from) { where.push('x.expense_date_jalali >= ?'); params.push(from); }
      if (to) { where.push('x.expense_date_jalali <= ?'); params.push(to); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [tot] = await chabokan.sql<any>(`SELECT COUNT(*) AS n, CAST(COALESCE(SUM(x.amount),0) AS DECIMAL(15,2)) AS total FROM expenses x ${w}`, params);
      const rows = await chabokan.sql<any>(
        `SELECT x.expense_id, x.expense_date_jalali, x.title, x.amount, ec.title AS category, x.vendor_name, x.description
         FROM expenses x LEFT JOIN expense_categories ec ON ec.category_id = x.category_id ${w}
         ORDER BY x.expense_date_jalali DESC, x.expense_id DESC LIMIT ?`, [...params, limit]);
      return { report, date_from: from, date_to: to, count: toNumber(tot?.n), total_amount: toNumber(tot?.total),
        expenses: rows.map((r) => ({ id: r.expense_id, date: r.expense_date_jalali, title: r.title, amount: toNumber(r.amount), category: r.category, vendor: r.vendor_name, description: r.description })) };
    }
    if (report === 'expenses_by_category') {
      const rows = await chabokan.sql<any>('SELECT * FROM v_expenses_by_category ORDER BY total_expense_amount DESC LIMIT ?', [limit]);
      return { report, categories: rows.map((r) => ({ category: r.category_title, count: toNumber(r.total_expense_count), total_amount: toNumber(r.total_expense_amount) })) };
    }
    if (report === 'profit_loss_monthly') {
      const rows = await chabokan.sql<any>('SELECT * FROM v_profit_and_loss_monthly ORDER BY jalali_month DESC LIMIT ?', [limit]);
      return { report, months: rows.map((r) => ({ month: r.jalali_month, income: toNumber(r.total_income), expenses: toNumber(r.total_expenses), net_profit: toNumber(r.net_profit) })) };
    }
    if (report === 'bank_accounts') {
      const rows = await chabokan.sql<any>('SELECT account_id, title, bank_name, card_number, initial_balance, is_active FROM bank_accounts ORDER BY account_id LIMIT ?', [limit]);
      return { report, accounts: rows.map((r) => ({ id: r.account_id, title: r.title, bank: r.bank_name,
        card_last4: r.card_number ? String(r.card_number).replace(/\D/g, '').slice(-4) : null, initial_balance: toNumber(r.initial_balance), active: Boolean(Number(r.is_active)) })) };
    }
    if (report === 'overdue_installments') {
      const rows = await chabokan.sql<any>('SELECT * FROM v_overdue_installments ORDER BY due_date_jalali LIMIT ?', [limit]);
      return { report, count: rows.length, installments: rows.map((r) => ({ student: r.student_full_name, phone_number: r.student_phone, course: r.course_title,
        installment_number: r.installment_number, due_date: r.due_date_jalali, amount: toNumber(r.amount), status: r.status })) };
    }
    return { error: 'گزارش نامعتبر. مقادیر مجاز: expenses، expenses_by_category، profit_loss_monthly، bank_accounts، overdue_installments' };
  }

  if (name === 'list_messaging') {
    const limit = copilotLimit(a.limit, 20);
    if (String(a.kind || 'threads') === 'campaigns') {
      const rows = await chabokan.sql<any>(
        'SELECT id, name, status, dry_run, created_by, total, sent, failed, skipped, created_at, finished_at FROM crm_campaigns ORDER BY id DESC LIMIT ?', [limit]);
      return { kind: 'campaigns', count: rows.length, campaigns: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, dry_run: Boolean(Number(r.dry_run)),
        created_by: r.created_by, total: toNumber(r.total), sent: toNumber(r.sent), failed: toNumber(r.failed), skipped: toNumber(r.skipped),
        created_at: copilotTehran(r.created_at), finished_at: copilotTehran(r.finished_at) })) };
    }
    const rows = await chabokan.sql<any>(
      `SELECT * FROM v_messenger_thread_summary ${a.unread_only === true ? 'WHERE unread_count > 0' : ''} ORDER BY last_message_at DESC LIMIT ?`, [limit]);
    return { kind: 'threads', count: rows.length, threads: rows.map((r) => ({ thread_id: r.thread_id, channel: r.channel, name: r.display_name,
      student_id: r.student_id, lead_id: r.lead_id, unread: toNumber(r.unread_count), last_message_at: copilotTehran(r.last_message_at),
      last_message: r.last_message_preview ? String(r.last_message_preview).slice(0, 150) : null, last_direction: r.last_message_direction })) };
  }

  if (name === 'list_sms') {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای ادمین فعال است.' };
    // Read-only: the SMS log, the stored templates and the bulk-SMS campaign stats. Nothing is ever sent here.
    const limit = copilotLimit(a.limit, 20);
    const kind = String(a.kind || 'messages');
    if (kind === 'templates') {
      const list = (await sharedSms.listTemplates(true)).map((t: any) => ({ id: t.key, title: t.title_fa, body: t.body_fa, updated_at: t.updated_at }));
      return { kind: 'templates', count: list.length, templates: list.slice(0, limit).map((t: any) => ({
        id: t.id, title: t.title, body: String(t.body || '').slice(0, 500), updated_at: copilotTehran(t.updated_at) })) };
    }
    if (kind === 'campaigns') {
      const rows = await chabokan.sql<any>(
        'SELECT id, name, status, dry_run, created_by, total, sent, failed, skipped, created_at, finished_at, filters FROM crm_campaigns ORDER BY id DESC LIMIT ?', [limit]);
      const campaigns = rows.filter((r: any) => {
        let f: any = r.filters;
        if (typeof f === 'string') { try { f = JSON.parse(f || '{}'); } catch { f = {}; } }
        const channel = String(f?.channel || 'rubika');
        return channel === 'sms' || channel === 'rubika_sms';
      }).map((r) => ({ id: r.id, name: r.name, status: SMS_STATUS_FA[r.status] || r.status, dry_run: Boolean(Number(r.dry_run)),
        created_by: r.created_by, total: toNumber(r.total), sent: toNumber(r.sent), failed: toNumber(r.failed), skipped: toNumber(r.skipped),
        created_at: copilotTehran(r.created_at), finished_at: copilotTehran(r.finished_at) }));
      return { kind: 'campaigns', count: campaigns.length, campaigns };
    }
    const db = readDb() as any;
    const history = (((db.outbox || []) as any[]).filter((m: any) => m.channel === 'sms')).map((m: any) => ({
      id: m.id, direction: 'ارسالی', recipient: maskPhone(m.recipient), student_id: m.student_id ?? null,
      status: String(m.status || 'sent'), at: m.sent_at, text: String(m.message || '').slice(0, 150),
    })).sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || '')));
    const counts: Record<string, number> = {};
    for (const m of history) counts[SMS_STATUS_FA[m.status] || m.status] = (counts[SMS_STATUS_FA[m.status] || m.status] || 0) + 1;
    return { kind: 'messages', count: history.length, counts, messages: history.slice(0, limit).map((m: any) => ({
      id: m.id, direction: m.direction, recipient: m.recipient, student_id: m.student_id,
      status: SMS_STATUS_FA[m.status] || m.status, at: copilotTehran(m.at), text: m.text })) };
  }

  if (name === 'list_activity_log') {
    const limit = copilotLimit(a.limit, 20);
    if (String(a.kind || 'audit') === 'activities') {
      const where: string[] = []; const params: any[] = [];
      if (a.entity === 'student' || a.entity === 'lead') { where.push('entity_type = ?'); params.push(a.entity); }
      const eid = parseInt(String(a.entity_id ?? ''), 10);
      if (Number.isFinite(eid)) { where.push('entity_id = ?'); params.push(eid); }
      if (a.username) { where.push('staff_username = ?'); params.push(String(a.username).trim()); }
      const rows = await chabokan.sql<any>(
        `SELECT id, entity_type, entity_id, kind, outcome, body, staff_username, occurred_at FROM crm_activities
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY occurred_at DESC, id DESC LIMIT ?`, [...params, limit]);
      return { kind: 'activities', count: rows.length, activities: rows.map((r) => ({ id: r.id, related: `${r.entity_type}#${r.entity_id}`, kind: r.kind,
        outcome: r.outcome, body: r.body ? String(r.body).slice(0, 200) : null, staff: r.staff_username, at: copilotTehran(r.occurred_at) })) };
    }
    const rows = await chabokan.listAudit({ limit, username: a.username ? String(a.username).trim() : undefined, entity: a.entity ? String(a.entity).trim() : undefined });
    const list: any[] = Array.isArray(rows) ? rows : ((rows as any)?.rows || (rows as any)?.items || []);
    return { kind: 'audit', count: list.length, entries: list.slice(0, limit).map((r: any) => ({ at: copilotTehran(r.created_at), username: r.username, role: r.role,
      method: r.method, path: r.path, entity: r.entity, entity_id: r.entity_id, status: r.status })) };
  }

  if (name === 'search_student') {
    const q = String(a.query || '').trim();
    if (!q) return { error: 'عبارت جستجو خالی است.' };
    const rows = await chabokan.sql<any>(
      `SELECT s.student_id AS id, s.first_name, s.last_name, s.national_code, s.phone_number,
              CAST(COALESCE(SUM(b.balance_due),0) AS DECIMAL(15,2)) AS remaining_debt
       FROM students s
       LEFT JOIN v_enrollment_balances b ON b.student_id = s.student_id
       WHERE s.first_name LIKE ? OR s.last_name LIKE ? OR s.national_code=? OR s.phone_number=?
       GROUP BY s.student_id LIMIT 10`,
      [`%${q}%`, `%${q}%`, q, q]
    );
    return {
      query: q,
      count: rows.length,
      students: rows.map((r) => ({
        student_id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        national_code: r.national_code,
        phone_number: r.phone_number,
        remaining_debt: toNumber(r.remaining_debt),
      })),
    };
  }

  if (name === 'get_student_financial_summary') {
    const studentId = parseInt(String(a.student_id), 10);
    if (!Number.isFinite(studentId)) return { error: 'شناسه کارآموز نامعتبر است.' };
    const rows = await chabokan.sql<any>(
      `SELECT s.student_id AS id, s.first_name, s.last_name,
              CAST(SUM(b.final_price) AS DECIMAL(15,2)) AS total_tuition,
              CAST(SUM(b.amount_paid_from_payments) AS DECIMAL(15,2)) AS total_paid,
              CAST(SUM(b.balance_due) AS DECIMAL(15,2)) AS remaining_debt
       FROM students s JOIN v_enrollment_balances b ON b.student_id=s.student_id
       WHERE s.student_id=? GROUP BY s.student_id`,
      [studentId]
    );
    if (!rows.length) return { student_id: studentId, found: false, message: 'کارآموزی با این شناسه یافت نشد.' };
    const row = rows[0];
    return {
      found: true,
      student_id: row.id,
      name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      total_tuition: toNumber(row.total_tuition),
      total_paid: toNumber(row.total_paid),
      remaining_debt: toNumber(row.remaining_debt),
    };
  }

  if (name === 'get_daily_cashflow') {
    const date = String(a.date_jalali || '').trim() || chabokan.jalaliToday();
    const incomeRows = await chabokan.sql<any>(
      `SELECT CAST(COALESCE(SUM(amount),0) AS DECIMAL(15,2)) AS total FROM payments WHERE pay_date_jalali=?`,
      [date]
    );
    const expenseRows = await chabokan.sql<any>(
      `SELECT CAST(COALESCE(SUM(amount),0) AS DECIMAL(15,2)) AS total FROM expenses WHERE expense_date_jalali=?`,
      [date]
    );
    const income = toNumber(incomeRows[0]?.total);
    const expense = toNumber(expenseRows[0]?.total);
    return { date_jalali: date, income, expense, net: income - expense };
  }

  if (name === 'get_debtors_list') {
    const minDebt = a.min_debt === undefined || a.min_debt === null || a.min_debt === ''
      ? 1
      : toNumber(a.min_debt);
    const limit = a.limit === undefined || a.limit === null || a.limit === ''
      ? 10
      : Math.max(1, Math.min(100, Math.floor(toNumber(a.limit)) || 10));
    const rows = await chabokan.sql<any>(
      `SELECT s.student_id AS id, s.first_name, s.last_name, s.phone_number,
              CAST(SUM(b.balance_due) AS DECIMAL(15,2)) AS remaining_debt
       FROM students s JOIN v_enrollment_balances b ON b.student_id=s.student_id
       GROUP BY s.student_id HAVING remaining_debt >= ?
       ORDER BY remaining_debt DESC LIMIT ?`,
      [minDebt, limit]
    );
    return {
      min_debt: minDebt,
      limit,
      count: rows.length,
      debtors: rows.map((r) => ({
        student_id: r.id,
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        phone_number: r.phone_number,
        remaining_debt: toNumber(r.remaining_debt),
      })),
    };
  }

  if (name === 'get_course_statistics') {
    const courseId = parseInt(String(a.course_id), 10);
    if (!Number.isFinite(courseId)) return { error: 'شناسه دوره نامعتبر است.' };
    const rows = await chabokan.sql<any>(
      `SELECT c.course_id AS id, c.title, COUNT(e.enrollment_id) AS enrollment_count,
              CAST(COALESCE(SUM(b.amount_paid_from_payments),0) AS DECIMAL(15,2)) AS total_collected
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id=c.course_id
       LEFT JOIN v_enrollment_balances b ON b.enrollment_id=e.enrollment_id
       WHERE c.course_id=? GROUP BY c.course_id`,
      [courseId]
    );
    if (!rows.length) return { course_id: courseId, found: false, message: 'دوره‌ای با این شناسه یافت نشد.' };
    const row = rows[0];
    return {
      found: true,
      course_id: row.id,
      title: row.title,
      enrollment_count: toNumber(row.enrollment_count),
      total_collected: toNumber(row.total_collected),
    };
  }

  return { error: `ابزار ناشناخته: ${name}` };
}

async function callCopilotCompletion(messages: any[], withTools = true, tools: any[] = COPILOT_TOOLS) {
  const response = await fetch(`${COPILOT_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${COPILOT_API_KEY}`,
    },
    body: JSON.stringify({
      model: COPILOT_MODEL,
      messages,
      ...(withTools ? { tools, tool_choice: 'auto' } : {}),
      temperature: 0.2,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Copilot API error ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<any>;
}

app.post('/api/copilot/chat', requireAuth, async (req, res) => {
  if (!COPILOT_API_URL) {
    return res.status(503).json({ error: 'سرویس هوش مصنوعی پیکربندی نشده است (COPILOT_API_URL تنظیم نشده).' });
  }
  if (!COPILOT_API_KEY) {
    return res.status(503).json({ error: 'کلید سرویس هوش مصنوعی تنظیم نشده است (COPILOT_API_KEY تنظیم نشده).' });
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const history = incoming
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  if (!history.length) {
    return res.status(400).json({ error: 'پیام کاربر ارسال نشده است.' });
  }

  const sessionUser = (req as any).user || {};
  const ctx = { username: String(sessionUser.username || ''), role: String(sessionUser.role || '') };
  const tools = await copilotToolsFor(ctx.role);
  const sqlNames = tools.map((t: any) => t.function?.name).filter((n: string) => n === 'run_sql_query' || n === 'execute_sql_crm');
  const sqlRule = sqlNames.length
    ? `\n۱۰) ابتدا از ابزارهای آماده استفاده کنید؛ فقط وقتی هیچ ابزاری پاسخ نمی‌دهد ابزار SQL (${sqlNames.join(' یا ')}) را با یک SELECT دقیق و ستون‌های مشخص اجرا کنید. اگر پرس‌وجو رد شد، دلیل را بخوانید و اصلاح کنید.`
    : '';
  const messages: any[] = [{ role: 'system', content: copilotSystemPrompt(tools) + sqlRule + '\n' + copilotDateRule() }, ...history];

  const toolCache = new Map<string, any>(); // identical repeated calls reuse the first result
  const pendingConfirmations: Array<{ pending_id: string; preview: string }> = [];
  try {
    for (let iteration = 0; iteration < COPILOT_MAX_ITERATIONS; iteration++) {
      const completion = await callCopilotCompletion(messages, true, tools);
      const message = completion?.choices?.[0]?.message;
      if (!message) {
        return res.status(502).json({ error: 'پاسخ نامعتبر از سرویس هوش مصنوعی دریافت شد.' });
      }
      messages.push(message);

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length) {
        return res.json({ reply: String(message.content || '').trim(), pendingConfirmations });
      }

      for (const toolCall of toolCalls) {
        const fn = toolCall?.function || {};
        let args: any = {};
        try {
          args = fn.arguments ? JSON.parse(fn.arguments) : {};
        } catch {
          args = {};
        }
        const cacheKey = `${fn.name}:${JSON.stringify(args)}`;
        let result: any = toolCache.get(cacheKey);
        if (result === undefined || fn.name === 'send_notification') {
          try {
            result = await runCopilotTool(String(fn.name || ''), args, ctx);
          } catch (err: any) {
            result = { error: err?.message || 'اجرای ابزار ناموفق بود.' };
          }
          toolCache.set(cacheKey, result);
        }
        if (result && typeof result === 'object' && result.pending_id && result.preview) {
          pendingConfirmations.push({ pending_id: result.pending_id, preview: result.preview });
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall?.id || `${fn.name || 'tool'}`,
          name: String(fn.name || ''),
          content: JSON.stringify(persianizeCodes(result)),
        });
      }
    }
    // Tool budget spent: ask once more without tools so the user still gets an answer from the data gathered so far.
    messages.push({ role: 'user', content: 'با همین داده‌های به‌دست‌آمده و بدون فراخوانی ابزار دیگر، پاسخ نهایی را کوتاه بنویسید.' });
    const final = await callCopilotCompletion(messages, false);
    const finalText = String(final?.choices?.[0]?.message?.content || '').trim();
    return res.json({ reply: finalText || 'پاسخ کامل آماده نشد؛ لطفاً پرسش را دقیق‌تر بپرسید.', pendingConfirmations });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'خطا در ارتباط با سرویس هوش مصنوعی.' });
  }
});

/** POST /api/copilot/pending/:id/confirm — admin confirms and sends a pending message. */
app.post('/api/copilot/pending/:id/confirm', requireAdmin, asyncHandler(async (req, res) => {
  const pendingId = sanitizeString(req.params.id, 64);
  const pending = pendingMessages.get(pendingId);
  if (!pending) return res.status(404).json({ error: 'پیام معلق یافت نشد یا منقضی شده است.' });
  if (pending.createdBy !== (req as any).user.username) {
    return res.status(403).json({ error: 'فقط سازنده پیام می‌تواند آن را تأیید کند.' });
  }
  const sessionUser = (req as any).user || {};
  const username = String(sessionUser.username || '');
  const now = Date.now();
  if (now > pending.expiresAt) {
    pendingMessages.delete(pendingId);
    return res.status(410).json({ error: 'پیام منقضی شده است.' });
  }
  let result: { ok: boolean; error?: string } = { ok: false, error: 'کانال ناشناخته' };
  if (pending.channel === 'rubika') {
    try {
      const r = await sendRubikaMessage(pending.recipient, pending.text);
      result = r?.status === 'OK' ? { ok: true } : { ok: false, error: String(r?.status || 'ربات پیام را نپذیرفت') };
    } catch (err: any) {
      result = { ok: false, error: err?.message || 'خطا در ارسال' };
    }
  } else if (pending.channel === 'sms' && pending.sms) {
    const sent: string[] = []; const failed: string[] = [];
    for (const it of pending.sms.items) {
      let r: { ok: boolean; status: string; detail?: string };
      try {
        r = pending.sms.templateKey
          ? await sharedSms.sendTemplate(pending.sms.templateKey, it.mobile, { ...(pending.sms.vars || {}), ...(it.studentId && !pending.sms.vars?.name ? { name: it.label } : {}), mobile: it.mobile })
          : await sharedSms.sendText(it.mobile, it.text);
      } catch (e: any) { r = { ok: false, status: 'failed', detail: e?.message || 'خطا' }; }
      (r.ok ? sent : failed).push(it.mobile);
      const db = readDb(); const t = Date.now();
      const outbox = ((db as any).outbox ||= []) as any[];
      outbox.push({ id: `MSG-${t}-${crypto.randomBytes(2).toString('hex')}`, recipient: it.mobile, channel: 'sms', message: it.text, student_id: it.studentId ?? undefined,
        sent_at: new Date(t).toISOString(), status: r.ok ? 'sent' : (r.status === 'disabled' ? 'failed' : r.status), note: `copilot ${pendingId}${pending.sms.templateKey ? ` tpl=${pending.sms.templateKey}` : ''}${r.detail ? ` ${r.detail}` : ''}`.slice(0, 300) });
      if (outbox.length > MAX_STORED_MESSAGES) outbox.splice(0, outbox.length - MAX_STORED_MESSAGES);
      writeDb(db);
    }
    result = failed.length === 0 ? { ok: true } : { ok: sent.length > 0, error: `${sent.length} ارسال شد، ${failed.length} ناموفق` };
  } else if (pending.channel === 'telegram') {
    result = await sendTelegramMessage(pending.recipient, pending.text);
  }
  pendingMessages.delete(pendingId);
  if (result.ok) {
    void chabokan.insertAudit({
      username,
      role: 'admin',
      method: 'POST',
      path: `/copilot/pending/${pendingId}/confirm?ch=${pending.channel}&to=${`${pending.label} ${maskChatId(pending.recipient)}`}&ok=${result.ok ? 1 : 0}&text=${pending.text.slice(0, 100).replace(/\s+/g, ' ')}`.slice(0, 255),
      entity: 'copilot_pending',
      entity_id: pendingId,
      status: 200,
      ip: req.ip || null,
    });
    return res.json({ ok: true, message: 'پیام ارسال شد.' });
  } else {
    void chabokan.insertAudit({
      username,
      role: 'admin',
      method: 'POST',
      path: `/copilot/pending/${pendingId}/confirm?ch=${pending.channel}&to=${`${pending.label} ${maskChatId(pending.recipient)}`}&ok=${result.ok ? 1 : 0}&text=${pending.text.slice(0, 100).replace(/\s+/g, ' ')}`.slice(0, 255),
      entity: 'copilot_pending',
      entity_id: pendingId,
      status: 502,
      ip: req.ip || null,
    });
    return res.status(502).json({ ok: false, error: result.error || 'ارسال ناموفق بود.' });
  }
}));

/** POST /api/copilot/pending/:id/cancel — admin cancels a pending message. */
app.post('/api/copilot/pending/:id/cancel', requireAdmin, asyncHandler(async (req, res) => {
  const pendingId = sanitizeString(req.params.id, 64);
  const pending = pendingMessages.get(pendingId);
  if (!pending) return res.status(404).json({ error: 'پیام معلق یافت نشد یا منقضی شده است.' });
  if (pending.createdBy !== (req as any).user.username) {
    return res.status(403).json({ error: 'فقط سازنده پیام می‌تواند آن را لغو کند.' });
  }
  pendingMessages.delete(pendingId);
  const sessionUser = (req as any).user || {};
  const username = String(sessionUser.username || '');
  void chabokan.insertAudit({
    username,
    role: 'admin',
    method: 'POST',
    path: `/copilot/pending/${pendingId}/cancel?ch=${pending.channel}&to=${`${pending.label} ${maskChatId(pending.recipient)}`}&text=${pending.text.slice(0, 100).replace(/\s+/g, ' ')}`.slice(0, 255),
    entity: 'copilot_pending',
    entity_id: pendingId,
    status: 200,
    ip: req.ip || null,
  });
  res.json({ ok: true, message: 'پیام لغو شد.' });
}));

// Rubika bot connectivity test: calls getMe only, never sends a message. Token stays server-side.
app.post('/api/settings/gateways/rubika-test', (req, res) => {
  const botToken = getGateways().rubika_bot_token;
  if (!botToken) return res.status(400).json({ ok: false, error: 'توکن ربات روبیکا ذخیره نشده است.' });
  const r = https.request({ hostname: 'botapi.rubika.ir', port: 443, path: `/v3/${botToken}/getMe`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': 2 }, timeout: 10000 }, (resp) => {
    let data = '';
    resp.on('data', (c) => { data += c; });
    resp.on('end', () => {
      let j: any = null; try { j = JSON.parse(data); } catch { /* not json */ }
      const bot = j?.data?.bot || j?.bot || null;
      if (j && (j.status === 'OK' || bot)) return res.json({ ok: true, bot: bot ? { bot_title: bot.bot_title, username: bot.username, bot_id: bot.bot_id } : null });
      res.status(502).json({ ok: false, error: (j && (j.status || j.message)) ? String(j.status || j.message).slice(0, 200) : 'پاسخ نامعتبر از روبیکا' });
    });
  });
  r.on('timeout', () => r.destroy(new Error('timeout')));
  r.on('error', (e) => { if (!res.headersSent) res.status(502).json({ ok: false, error: 'اتصال به botapi.rubika.ir ناموفق: ' + e.message }); });
  r.write('{}'); r.end();
});

// Main Rubika account (rubpy self-bot), shared with the site's session. Admin only.
// The Python helper keeps login state (phone_code_hash etc.) server-side and only prints status JSON.
function runRubikaAccount(cmd: string, args: Record<string, unknown> = {}): Promise<any> {
  const script = path.join(process.cwd(), 'scripts', 'rubika_account.py');
  return new Promise((resolve) => {
    const child = execFile(process.env.RUBIKA_PYTHON || 'python3', [script, cmd], { timeout: 45000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const line = String(stdout || '').trim().split('\n').pop() || '';
      try { return resolve(JSON.parse(line)); } catch { /* fall through */ }
      resolve({ ok: false, error: err ? 'اجرای ماژول روبیکا ناموفق بود.' : 'پاسخ نامعتبر از ماژول روبیکا' });
    });
    child.stdin?.end(JSON.stringify(args));
  });
}
const rubikaAccountPublic = (r: any) => {
  const keep = ['ok', 'logged_in', 'name', 'username', 'phone', 'pending', 'step', 'hint', 'error', 'note', 'terminated_remote'];
  const o: any = {}; for (const k of keep) if (r && r[k] !== undefined) o[k] = r[k];
  return o;
};
app.get('/api/settings/rubika-account', requireAdmin, async (req, res) => {
  const r = await runRubikaAccount('status');
  res.json({ ...rubikaAccountPublic(r), active: (readDb().settings as any)?.gateways?.rubika_account_active !== false });
});
app.post('/api/settings/rubika-account/send-code', requireAdmin, async (req, res) => {
  const phone = sanitizeString(String(req.body?.phone || ''), 20);
  const pass_key = typeof req.body?.pass_key === 'string' ? req.body.pass_key.slice(0, 100) : undefined;
  if (!phone) return res.status(400).json({ ok: false, error: 'شماره تلفن را وارد کنید.' });
  const r = await runRubikaAccount('send_code', { phone, pass_key });
  res.status(r.ok ? 200 : 400).json(rubikaAccountPublic(r));
});
app.post('/api/settings/rubika-account/sign-in', requireAdmin, async (req, res) => {
  const code = String(req.body?.code || '').slice(0, 12);
  const r = await runRubikaAccount('sign_in', { code });
  res.status(r.ok ? 200 : 400).json(rubikaAccountPublic(r));
});
app.post('/api/settings/rubika-account/logout', requireAdmin, async (req, res) => {
  const r = await runRubikaAccount('logout');
  res.status(r.ok ? 200 : 500).json(rubikaAccountPublic(r));
});
app.post('/api/settings/rubika-account/active', requireAdmin, (req, res) => {
  const db = readDb();
  const g: any = { ...((db.settings as any)?.gateways || {}), rubika_account_active: !!req.body?.active };
  db.settings = { ...(db.settings as any), gateways: g };
  writeDb(db);
  res.json({ ok: true, active: g.rubika_account_active });
});

// Dashboard to-do list and calendar events: shared by all admins (they used to live in each browser).
registerCourseTerms(app, { isAdmin: (req) => currentRole(req) === 'admin' });
// Instructor pay (حق‌التدریس): admin-only; falls back to db_store.json ("instructor_pay") when MySQL is off.
registerInstructorPay(app, {
  isAdmin: (req) => currentRole(req) === 'admin',
  readJsonDb: () => readDb(),
  writeJsonDb: (d) => writeDb(d),
});

// Remaining-debt payment links + SMS (debtSms.ts). The link store is shared with the trainee Zarinpal
// flow below and the legacy installment-link store stays available for links sent before this change.
const installmentStore = createInstallmentStore({ readJsonDb: () => readDb(), writeJsonDb: (store) => writeDb(store) });
const debtLinkStore = createDebtLinkStore({ readJsonDb: () => readDb(), writeJsonDb: (store) => writeDb(store) });
const publicBaseFromRequest = (req: express.Request) => String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`);
registerOnlinePayments(app, {
  readJsonDb: () => readDb(),
  writeJsonDb: (store) => writeDb(store),
  session: (req) => { const s = sessionFromRequest(req); return s ? { username: String(s.username || ''), role: String(s.role || '') } : null; },
  sanitize: (v, max) => sanitizeString(v, max),
  normalizeMobile,
  jalaliToday: () => jalaliNow(),
  signToken: (payload, ttlMs) => signToken(payload, ttlMs),
  verifyToken: (token) => verifyToken(token),
  createPayment: (input) => createPaymentCore(input),
  zarinpalMerchantId: () => {
    try { return String((readDb().settings as any)?.gateways?.zarinpal_merchant_id || ''); } catch { return ''; }
  },
  publicBaseUrl: publicBaseFromRequest,
  installments: installmentStore,
  debtLinks: debtLinkStore,
  log: (msg) => console.warn(`[online-payments] ${msg}`),
});

// Remaining-debt SMS with a payment link: preview / single send / bulk send / settings / log.
registerDebtSms(app, {
  session: (req) => { const s = sessionFromRequest(req); return s ? { username: String(s.username || ''), role: String(s.role || '') } : null; },
  sanitize: (v, max) => sanitizeString(v, max),
  normalizeMobile,
  settings: () => { try { return (readDb() as any).settings || {}; } catch { return {}; } },
  saveSettings: (patch: Record<string, any>) => {
    const d = readDb();
    const settings: any = (d as any).settings = (d as any).settings || {};
    settings.debt_sms = { ...(settings.debt_sms || {}), ...patch };
    writeDb(d);
  },
  readJsonDb: () => readDb(),
  writeJsonDb: (store: any) => writeDb(store),
  links: debtLinkStore,
  // SMS goes through the shared helper (sms_templates key debt_balance -> sms.ir verify 472328: NAME, AMOUNT, CODE).
  sms: {
    sendTemplate: (key, mobile, vars, fallback) => sharedSms.sendTemplate(key, mobile, vars, fallback),
    configured: () => !!resolveApiKey(smsCfg?.apiKeyRef || 'env:SMS_API_KEY'),
  },
  log: (msg: string) => console.warn(`[debt-sms] ${msg}`),
});

// Short public payment URL: /p/<code> opens the trainee panel with the amount preset.
app.get('/p/:code', (req, res) => {
  const code = sanitizeString(req.params.code, 16);
  if (!/^[0-9A-Za-z]{12}$/.test(code)) return res.redirect(302, '/?trainee=1&payment=notfound');
  const base = publicBaseFromRequest(req).replace(/\/$/, '');
  res.redirect(302, `${base}/?trainee=1&code=${encodeURIComponent(code)}`);
});

registerPhase4(app, {
  session: (req) => { const x = sessionFromRequest(req); return x ? { username: String(x.username), role: x.role } : null; },
  sanitize: (v, max) => sanitizeString(v, max),
  normalizeMobile,
  readJsonDb: () => readDb(),
  sendAccount: async (guid, text) => {
    if (!rubikaAccountActive()) return { ok: false, error: 'اکانت اصلی روبیکا غیرفعال است' };
    const r = await runRubikaAccount('send', { guid, text });
    if (r?.ok) await storeAccountMessages([{ ext_id: `${guid}:${r.message_id || `bulk-${Date.now()}`}`, chat_id: guid, text, time: Date.now(), direction: 'out' }]);
    return { ok: !!r?.ok, error: r?.error };
  },
  sendBot: async (chatId, text) => {
    try {
      const r = await sendRubikaMessage(chatId, text);
      const ok = r?.status === 'OK';
      if (ok) await storeAccountMessages([{ source: 'bot', ext_id: `bot:${chatId}:out-${Date.now()}`, chat_id: chatId, text, time: Date.now(), direction: 'out' }]);
      return { ok, error: ok ? undefined : String(r?.status || 'خطا') };
    } catch (e: any) { return { ok: false, error: e?.message }; }
  },
  sendSms: async (phone, text) => {
    const r = await sendSmsMessage(normalizeMobile(phone), text);
    return { ok: r.ok, error: r.ok ? undefined : (r.detail || r.status) };
  },
  smsConfigured: () => { const g = getGateways(); return !!(g.sms_api_key && g.sms_sender_line); },
  staffDirectory: () => {
    const d = readDb();
    return [{ username: envAdminUsername(), full_name: 'مدیر سیستم', role: 'admin', is_active: true },
      ...d.staff_users.map((u: any) => ({ username: u.username, full_name: u.full_name, role: u.role, is_active: !!u.is_active }))];
  },
});

app.get('/api/settings/audit-log', requireAdmin, asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  res.json(await chabokan.listAudit({
    limit: Number(q.limit), offset: Number(q.offset),
    username: q.username ? sanitizeString(q.username, 80) : undefined,
    entity: q.entity ? sanitizeString(q.entity, 40) : undefined,
  }));
}));

/** Nightly mysqldump files written by scripts/backup-db.sh (cron). Lists names/sizes only. */
app.get('/api/settings/backups', requireAdmin, (_req, res) => {
  const dir = process.env.CRM_BACKUP_DIR || '/project/_archive/db-backups';
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^carla-\d{8}-\d{4}\.sql\.gz$/.test(f))
      .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtime: st.mtime.toISOString() }; })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ dir_configured: true, files });
  } catch {
    res.json({ dir_configured: false, files: [] });
  }
});

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
  await ensurePhase4Schema();
  await ensureCourseTermsSchema();
  await ensureThemeSettingsSchema();
  await ensureInstructorPaySchema();
  await ensureOnlinePaymentsSchema();
  await ensureInstallmentsSchema();
  await ensureDebtSmsSchema();
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
