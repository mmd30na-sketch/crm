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

import { exec } from 'child_process';

// ─────────────────────────────────────────────────────────────
// RUBIKA INTEGRATION (USER ACCOUNT / SELF-BOT & BOT API)
// ─────────────────────────────────────────────────────────────
const RUBIKA_BOT_TOKEN = process.env.RUBIKA_BOT_TOKEN || '';
const RUBIKA_AUTH_TOKEN = process.env.RUBIKA_AUTH_TOKEN || process.env.RUBIKA_USER_HASH || '';

// 1. Send via Personal User Account (Userbot / Hash ID)
function sendRubikaUserAccountMessage(target: string, text: string): Promise<any> {
  return new Promise((resolve) => {
    const tokenFile = path.join(process.cwd(), 'rubika_user_token.json');
    let authToken = RUBIKA_AUTH_TOKEN;

    if (!authToken && fs.existsSync(tokenFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
        authToken = parsed.auth || parsed.auth_token || '';
      } catch {}
    }

    if (!authToken) {
      return resolve({ ok: false, error: 'RUBIKA_AUTH_TOKEN یا اکانت شخصی فعال روبیکا یافت نشد.' });
    }

    const pyScript = `
import asyncio, json
try:
    from rubpy import Client
    async def run():
        async with Client(name="rubika_user_session", auth="${authToken}") as client:
            res = await client.send_message("${target}", """${text.replace(/"/g, '\\"')}""")
            print(json.dumps({"ok": True, "res": str(res)}))
    asyncio.run(run())
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;

    const pyCmd = process.platform === 'win32' ? 'py' : 'python3';
    exec(`${pyCmd} -c "${pyScript.replace(/\n/g, ' ')}"`, { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({ ok: false, error: err ? err.message : 'No output from python script' });
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ ok: true, raw: stdout });
      }
    });
  });
}

// 2. Send via Official Bot API
function sendRubikaMessage(chatId: string, text: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!RUBIKA_BOT_TOKEN) {
      return reject(new Error('RUBIKA_BOT_TOKEN تنظیم نشده است.'));
    }
    const body = JSON.stringify({ chat_id: chatId, text });
    const options = {
      hostname: 'botapi.rubika.ir',
      port: 443,
      path: `/v3/${RUBIKA_BOT_TOKEN}/sendMessage`,
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
const PORT = Number(process.env.PORT || 3000);

// Set up storage directory for uploads
// Set up StudentFiles storage directory structure matching MS Access logic
const studentFilesBase = path.join(process.cwd(), 'StudentFiles');
if (!fs.existsSync(studentFilesBase)) {
  fs.mkdirSync(studentFilesBase, { recursive: true });
}

function safeSegment(value: unknown, fallback: string) {
  const raw = String(value || fallback).trim() || fallback;
  return raw.replace(/[^؀-ۿa-zA-Z0-9._-]+/g, '_').slice(0, 80) || fallback;
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
    logo_url: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=200',
    phone_number: '۰۲۱-۸۸۸۸۴۴۴۴',
    address: 'تهران، خیابان ولیعصر، نرسیده به میدان ونک، پلاک ۱۲۰',
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
function readDb(): typeof initialDb {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed.staff_users)) parsed.staff_users = [];
      return parsed;
    }
  } catch (err) {
    console.error('Error reading database file, using in-memory store instead.', err);
  }
  return initialDb;
}

function writeDb(data: typeof initialDb) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to database file.', err);
  }
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
  const q = String((req.query as any)?.token || '');
  return q || null;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = readBearer(req);
  const session = token ? verifyToken(token) : null;
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

  try {
    const envUser = process.env.CRM_ADMIN_USER || 'admin';
    const envPass = process.env.CRM_ADMIN_PASSWORD || '';
    if (username === envUser) {
      const adminHash = readDb().settings?.admin_password_hash;
      const envOk = !!envPass && password === envPass;
      const hashOk = adminHash ? await bcrypt.compare(password, String(adminHash)) : false;
      if (hashOk || (!adminHash && envOk)) {
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
          const token = signToken({ username: staff.username, role: staff.role, user_id: staff.user_id });
          return res.json({ token, user: { username: staff.username, role: staff.role } });
        }
      }
    }
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

function canAccessApi(role: StaffRole, method: string, path: string): boolean {
  if (role === 'admin') return true;
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
  if (path.startsWith('/messenger')) return true;
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
  const token = readBearer(req);
  const session = token ? verifyToken(token) : null;
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
    const staffId = parseInt(req.params.id, 10);
    const body = req.body || {};
    if (!staffId) {
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
app.use('/uploads', requireStaff, express.static(uploadsDir));

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
app.post('/api/messenger/webhook', (req, res) => {
  const { sender, message, channel, chat_id, sender_phone } = req.body;
  console.log(`[Messenger Webhook] دریافت پیام از ${sender} via ${channel || 'rubika'}: ${message}`);

  const db = readDb();
  if (!(db as any).messages) (db as any).messages = [];

  // ثبت chat_id روبیکا روی پروفایل دانش‌آموز (از طریق شماره تلفن)
  if (channel === 'rubika' && chat_id && sender_phone) {
    const phone = String(sender_phone).replace(/^\+98/, '0');
    const student = db.students.find((s: any) =>
      String(s.phone_number || '').replace(/^\+98/, '0') === phone
    );
    if (student) {
      (student as any).rubika_chat_id = chat_id;
      writeDb(db);
      console.log(`[Rubika] chat_id ذخیره شد برای ${student.first_name} ${student.last_name}: ${chat_id}`);
    }
  }

  (db as any).messages.push({
    id: Date.now(),
    sender,
    channel: channel || 'rubika',
    chat_id,
    sender_phone,
    message,
    received_at: new Date().toISOString(),
  });
  writeDb(db);

  res.json({ success: true, status: 'RECEIVED_AND_STORED' });
});

// ── GET: دریافت پیام‌های ورودی ──
app.get('/api/messenger/messages', (req, res) => {
  const db = readDb();
  res.json({ success: true, messages: (db as any).messages || [] });
});

// ── POST: ارسال پیام از طریق روبیکا یا پیامک ──
app.post('/api/messenger/send', async (req, res) => {
  const { recipient, channel, student_id } = req.body;
  const message = req.body.message || req.body.messageText;
  if (!recipient || !message) {
    return res.status(400).json({ error: 'گیرنده و متن پیام الزامی است.' });
  }

  const trackingId = `MSG-${Date.now()}`;
  const db = readDb();
  if (!(db as any).outbox) (db as any).outbox = [];

  const logEntry: any = {
    id: trackingId,
    recipient,
    channel: channel || 'sms',
    message,
    student_id,
    sent_at: new Date().toISOString(),
    status: 'pending',
  };

  if (channel === 'rubika') {
    // پیدا کردن chat_id دانش‌آموز از دیتابیس
    let chatId: string | null = null;

    if (student_id) {
      const student = db.students.find((s: any) => String(s.id) === String(student_id));
      chatId = (student as any)?.rubika_chat_id || null;
    }

    // اگه شماره تلفن recipient یه chat_id ذخیره‌شده داشت
    if (!chatId) {
      const phone = String(recipient).replace(/^\+98/, '0');
      const student = db.students.find((s: any) =>
        String(s.phone_number || '').replace(/^\+98/, '0') === phone
      );
      chatId = (student as any)?.rubika_chat_id || null;
    }

    if (chatId) {
      try {
        const rubikaRes = await sendRubikaMessage(chatId, message);
        logEntry.status = rubikaRes?.ok ? 'sent' : 'api_error';
        logEntry.rubika_response = rubikaRes;
        console.log(`[Rubika] پیام به ${chatId} ارسال شد:`, rubikaRes);
      } catch (err: any) {
        logEntry.status = 'failed';
        logEntry.error = err.message;
        console.error('[Rubika] خطا در ارسال:', err.message);
      }
    } else {
      // chat_id ندارد — در صف pending می‌مونه تا کاربر اول پیام بده
      logEntry.status = 'awaiting_user_init';
      logEntry.note = 'کاربر هنوز با ربات شروع به چت نکرده. پس از ارسال /start توسط کارآموز، پیام ارسال خواهد شد.';
      console.warn(`[Rubika] chat_id برای ${recipient} یافت نشد. پیام در صف pending.`);
    }
  } else {
    // SMS یا سایر کانال‌ها
    logEntry.status = 'queued_sms';
    console.log(`[SMS] پیامک به ${recipient}: ${message}`);
  }

  (db as any).outbox.push(logEntry);
  writeDb(db);

  const isRubikaSuccess = logEntry.status === 'sent';
  res.json({
    success: true,
    tracking_id: trackingId,
    status: logEntry.status,
    message: isRubikaSuccess
      ? `پیام روبیکا با موفقیت ارسال شد ✅`
      : logEntry.status === 'awaiting_user_init'
        ? `⚠️ کارآموز هنوز /start نزده. پیام در صف ماند.`
        : `پیام در صف ارسال ${channel === 'rubika' ? 'روبیکا' : 'پیامک'} قرار گرفت.`,
  });
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
  if (sent('father_name')) data.father_name = sanitizeString(b.father_name, 80);
  if (sent('birth_date_jalali')) data.birth_date_jalali = sanitizeString(b.birth_date_jalali, 20);
  if (sent('address')) data.address = sanitizeString(b.address, 400);
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
    return Math.max(0, Number(row?.remaining_debt ?? 0));
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
app.post('/api/courses', async (req, res) => {
  try {
    if (chabokan.isMysqlEnabled()) return res.json(await chabokan.insertCourse(req.body));
    const db = readDb();
    const newCourse = {
      id: db.courses.length > 0 ? Math.max(...db.courses.map(c => c.id)) + 1 : 1,
      ...req.body,
    };
    db.courses.push(newCourse);
    writeDb(db);
    res.json(newCourse);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (chabokan.isMysqlEnabled()) {
      const row = await chabokan.updateCourse(id, req.body);
      if (!row) return res.status(404).json({ error: 'Course not found' });
      return res.json(row);
    }
    const db = readDb();
    const index = db.courses.findIndex(c => c.id === id);
    if (index !== -1) {
      db.courses[index] = { ...db.courses[index], ...req.body, id };
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
      const student = await chabokan.updateStudent(studentId, { ...(req.body || {}), ...data });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      return res.json({ status: 'success', student });
    }
    const db = readDb();
    const index = db.students.findIndex(s => s.id === studentId);
    if (index === -1) return res.status(404).json({ error: 'Student not found' });
    const body = req.body || {};
    db.students[index] = {
      ...db.students[index],
      ...data,
      status: body.status || db.students[index].status,
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
      await chabokan.deleteStudent(studentId);
      return res.json({ success: true });
    }
    const db = readDb();
    db.students = db.students.filter(s => s.id !== studentId);
    db.enrollments = db.enrollments.filter(e => e.student_id !== studentId);
    db.payments = db.payments.filter(p => p.student_id !== studentId);
    writeDb(db);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 5. POST student photos
app.post('/api/students/:id/photos', uploadStudentMedia.fields([
  { name: 'idCard', maxCount: 1 },
  { name: 'personal', maxCount: 1 }
]), async (req, res) => {
  const studentId = parseInt(req.params.id);
  const db = readDb();
  const index = db.students.findIndex(s => s.id === studentId);
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
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
});

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

    const hasPrice = b.final_price !== undefined && b.final_price !== null && b.final_price !== '';
    const finalPrice = hasPrice ? Number(b.final_price) : Number(course.tuition || 0);
    if (!Number.isFinite(finalPrice) || finalPrice < 0) return res.status(400).json({ error: 'شهریه نامعتبر است.' });

    const numbers = enrollments.map(e => Number(e.course_number)).filter(n => Number.isFinite(n) && n > 0);
    let courseNumber: number | null;
    if (b.course_number !== undefined && b.course_number !== null && b.course_number !== '') {
      courseNumber = parseInt(b.course_number, 10);
      if (!Number.isInteger(courseNumber) || courseNumber <= 0) return res.status(400).json({ error: 'شماره دوره نامعتبر است.' });
    } else {
      courseNumber = numbers.length > 0 ? Math.max(...numbers) : null;
    }
    if (enrollments.some(e => Number(e.student_id) === studentId && Number(e.course_id) === courseId && Number(e.course_number) === courseNumber)) {
      return res.status(409).json({ error: 'این کارآموز قبلاً در همین دوره و کلاس ثبت‌نام شده است.' });
    }

    const signupDate = sanitizeString(b.signup_date_jalali, 20) || chabokan.jalaliToday();
    if (chabokan.isMysqlEnabled()) {
      return res.json(await chabokan.insertEnrollment({
        ...b, student_id: studentId, course_id: courseId, course_number: courseNumber, final_price: finalPrice, signup_date_jalali: signupDate,
      }));
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
app.post('/api/payments', async (req, res) => {
  try {
    const paymentData = req.body;
    const studentId = parseInt(paymentData.student_id ?? paymentData.studentId, 10);
    if (!studentId) return res.status(400).json({ error: 'student_id is required' });
    const amount = parseFloat(paymentData.amount);
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
    if (chabokan.isMysqlEnabled()) {
      return res.json(await chabokan.insertPayment({
        ...paymentData,
        student_id: studentId,
        amount,
        pay_date_jalali: sanitizeString(paymentData.pay_date_jalali, 20) || new Date().toLocaleDateString('fa-IR'),
      }));
    }
    const db = readDb();
    const newPayment = {
      id: db.payments.length > 0 ? Math.max(...db.payments.map(p => p.id)) + 1 : 1,
      student_id: studentId,
      enrollment_id: paymentData.enrollment_id ? parseInt(paymentData.enrollment_id, 10) : null,
      amount,
      pay_date_jalali: sanitizeString(paymentData.pay_date_jalali, 20) || new Date().toLocaleDateString('fa-IR'),
      pay_method: sanitizeString(paymentData.pay_method ?? paymentData.paymentMethod, 40) || 'pos',
      payment_kind: sanitizeString(paymentData.payment_kind, 40) || 'downpayment',
      description: sanitizeString(paymentData.description ?? paymentData.notes, 400),
    };
    db.payments.push(newPayment);
    writeDb(db);
    res.json(newPayment);
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
    removeUploadedFiles(uploaded);
    return res.status(503).json({ success: false, error: 'سرویس خواندن کارت ملی تنظیم نشده است (GEMINI_API_KEY). اطلاعات را دستی وارد کنید.' });
  }
  const fileBuffer = fs.readFileSync(req.file.path);
  // The scan is only needed for this request; don't keep national-card images in /uploads.
  fs.unlink(req.file.path, () => {});
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
  const db = readDb();
  res.json(db.settings);
});

app.post('/api/receipt-settings', (req, res) => {
  const db = readDb();
  db.settings = { ...db.settings, ...req.body };
  writeDb(db);
  res.json(db.settings);
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
    settings: db.settings,
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
  const db = readDb();
  const expenseData = req.body;
  const title = sanitizeString(expenseData.title ?? expenseData.expenseTitle, 160);
  const amount = parseFloat(expenseData.amount ?? expenseData.expenseAmount);
  if (!title || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'title and amount are required' });
  }
  try {
  if (chabokan.isMysqlEnabled()) {
    return res.json(await chabokan.insertExpense({ ...expenseData, title, amount }));
  }
  const newExpense = {
    id: db.expenses.length > 0 ? Math.max(...db.expenses.map(ex => ex.id)) + 1 : 1,
    title,
    amount,
    pay_method: sanitizeString(expenseData.pay_method ?? expenseData.category, 80) || 'کارت بانکی',
    pay_date_jalali: sanitizeString(expenseData.pay_date_jalali ?? expenseData.expenseDate ?? expenseData.expensedate, 20) || new Date().toLocaleDateString('fa-IR'),
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

app.post('/api/registrations/:id/approve', async (req, res) => {
  try {
    const registrationId = parseInt(req.params.id, 10);
    const studentId = parseInt(req.body?.student_id, 10);
    if (!registrationId || !studentId) {
      return res.status(400).json({ error: 'registration id and student_id are required' });
    }
    if (!chabokan.isMysqlEnabled()) {
      return res.status(503).json({ error: 'MySQL is not enabled' });
    }
    const row = await chabokan.linkWebsiteRegistration(registrationId, studentId, 'approved');
    res.json({ success: true, registration: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


app.get('/api/messenger/threads', (req, res) => {
  const db = readDb();
  res.json({ success: true, threads: (db as any).threads || [] });
});

app.get('/api/settings/academy', (req, res) => {
  const db = readDb();
  res.json(db.settings);
});
app.put('/api/settings/academy', (req, res) => {
  const db = readDb();
  db.settings = { ...db.settings, ...req.body };
  writeDb(db);
  res.json(db.settings);
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
  res.json({
    sms_provider: process.env.SMS_PROVIDER || 'ippanel',
    sms_api_key: '',
    sms_sender_line: process.env.SMS_SENDER_LINE || '',
    sms_auto_register: true,
    rubika_bot_token: '',
    rubika_channel_id: '',
    rubika_active: !!process.env.RUBIKA_BOT_TOKEN,
  });
});
app.post('/api/settings/gateways', (req, res) => {
  res.json({ success: true });
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

startServer();
