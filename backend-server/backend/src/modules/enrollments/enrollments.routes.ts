/**
 * Enrollments API + report context + receipt PDF upload
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import pool from '../../config/db.js';
import { getTodayShamsi } from '../../utils/shamsi.js';

const router = Router();

const EnrollmentSchema = z.object({
  student_id: z.number().int(),
  course_id: z.number().int(),
  course_number: z.number().int().nullable().optional(),
  signup_date_jalali: z
    .string()
    .regex(/^\d{4}\/\d{2}\/\d{2}$/, 'Date must be in YYYY/MM/DD format')
    .optional(),
  final_price: z.number().nonnegative().optional(),
});

function formatFaNumber(n: number): string {
  try {
    return new Intl.NumberFormat('fa-IR').format(Math.round(n));
  } catch {
    return String(n);
  }
}

async function loadReceiptSettings(): Promise<Record<string, unknown>> {
  const defaults: Record<string, unknown> = {
    paper_size: 'a5',
    copies: 1,
    footer_text:
      'این رسید صرفاً اعلام دریافت وجه است و به‌منزله گواهی پایان دوره نمی‌باشد.',
    header_title: 'آموزشگاه',
    header_phone: '',
    show_national_code: true,
    show_balance: true,
  };
  try {
    const [rows] = (await pool.query(
      `SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'receipt.%'`
    )) as [Array<{ setting_key: string; setting_value: unknown }>, unknown];
    for (const row of rows) {
      const k = row.setting_key.replace(/^receipt\./, '');
      let v = row.setting_value;
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          /* keep */
        }
      }
      defaults[k] = v;
    }
  } catch {
    /* table missing */
  }
  return defaults;
}

export async function buildReportContext(enrollmentId: number | string) {
  const [rows] = (await pool.query(
    `SELECT e.*, c.title AS course_title, c.price AS course_base_price,
            s.first_name, s.last_name, s.national_code, s.phone_number, s.address,
            s.student_id AS sid
     FROM enrollments e
     JOIN courses c ON e.course_id = c.course_id
     JOIN students s ON e.student_id = s.student_id
     WHERE e.enrollment_id = ?`,
    [enrollmentId]
  )) as [Array<Record<string, unknown>>, unknown];

  if (!rows.length) return null;
  const e = rows[0];

  const [payments] = (await pool.query(
    `SELECT * FROM payments WHERE enrollment_id = ? OR student_id = ?
     ORDER BY payment_id DESC LIMIT 5`,
    [enrollmentId, e.student_id]
  )) as [Array<Record<string, unknown>>, unknown];

  const lastPay = payments[0] || null;
  const finalPrice = Number(e.final_price ?? 0);
  const amountPaid = Number(e.amount_paid ?? 0);
  const balance = finalPrice - amountPaid;
  const settings = await loadReceiptSettings();

  const first = String(e.first_name ?? '');
  const last = String(e.last_name ?? '');

  const ctx: Record<string, string> = {
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim(),
    national_code: String(e.national_code ?? ''),
    phone_number: String(e.phone_number ?? ''),
    address: String(e.address ?? ''),
    course_title: String(e.course_title ?? ''),
    course_number: e.course_number != null ? String(e.course_number) : '',
    signup_date_jalali: String(e.signup_date_jalali ?? ''),
    final_price: formatFaNumber(finalPrice),
    final_price_raw: String(finalPrice),
    amount_paid: formatFaNumber(amountPaid),
    amount_paid_raw: String(amountPaid),
    balance: formatFaNumber(balance),
    balance_raw: String(balance),
    pay_method: lastPay ? String(lastPay.pay_method ?? '') : '',
    payment_kind: lastPay ? String(lastPay.payment_kind ?? '') : '',
    pay_date_jalali: lastPay
      ? String(lastPay.pay_date_jalali ?? '')
      : String(e.signup_date_jalali ?? ''),
    enrollment_id: String(e.enrollment_id),
    student_id: String(e.student_id),
    school_name: String(settings.header_title ?? 'آموزشگاه'),
    school_phone: String(settings.header_phone ?? ''),
    footer_text: String(settings.footer_text ?? ''),
    today_jalali: getTodayShamsi(),
  };

  return {
    context: ctx,
    enrollment: e,
    settings,
    last_payment: lastPay,
  };
}

// POST /api/enrollments
router.post('/', async (req, res) => {
  try {
    const validatedData = EnrollmentSchema.parse(req.body);
    const { student_id, course_id, course_number, signup_date_jalali, final_price } =
      validatedData;

    const [students]: any = await pool.query(
      'SELECT * FROM students WHERE student_id = ?',
      [student_id]
    );
    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const [courses]: any = await pool.query(
      'SELECT * FROM courses WHERE course_id = ?',
      [course_id]
    );
    if (courses.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const course = courses[0];

    const resolvedPrice =
      final_price !== undefined ? final_price : Number(course.price);
    const resolvedDate = signup_date_jalali || getTodayShamsi();

    const [result]: any = await pool.query(
      `INSERT INTO enrollments (student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid)
       VALUES (?, ?, ?, ?, ?, 0.0000)`,
      [student_id, course_id, course_number || null, resolvedDate, resolvedPrice]
    );

    const enrollmentId = result.insertId;
    const [newEnrollment]: any = await pool.query(
      `SELECT e.*, c.title as course_title, c.price as course_base_price
       FROM enrollments e
       JOIN courses c ON e.course_id = c.course_id
       WHERE e.enrollment_id = ?`,
      [enrollmentId]
    );

    res.status(201).json(newEnrollment[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating enrollment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/enrollments/student/:studentId
router.get('/student/:studentId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, c.title as course_title, c.price as course_base_price,
       (e.final_price - e.amount_paid) as balance
       FROM enrollments e
       JOIN courses c ON e.course_id = c.course_id
       WHERE e.student_id = ?
       ORDER BY e.enrollment_id DESC`,
      [req.params.studentId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching student enrollments:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/enrollments/:id/report-context
router.get('/:id/report-context', async (req, res) => {
  try {
    const built = await buildReportContext(req.params.id);
    if (!built) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    res.json(built);
  } catch (error) {
    console.error('Error building report context:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Receipt upload ---
const TEMP_DIR = path.resolve(
  process.env.OCR_TEMP_DIR || path.join(process.cwd(), 'uploads', 'temp')
);
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const uploadReceipt = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_DIR),
    filename: (_req, file, cb) => {
      cb(
        null,
        `receipt_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname) || '.pdf'}`
      );
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/octet-stream' ||
      (file.originalname || '').toLowerCase().endsWith('.pdf');
    if (ok) cb(null, true);
    else cb(new Error('Only PDF files are accepted for receipts'));
  },
});

function multerErr(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (!err) return next();
  if (err instanceof multer.MulterError || err instanceof Error) {
    return res.status(400).json({ error: (err as Error).message });
  }
  next(err);
}

// POST /api/enrollments/:id/receipt  multipart: file + template_key?
router.post(
  '/:id/receipt',
  (req, res, next) => {
    uploadReceipt.single('file')(req, res, (err) => multerErr(err, req, res, next));
  },
  async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const enrollmentId = req.params.id;
      const templateKey =
        (typeof req.body?.template_key === 'string' && req.body.template_key) ||
        'receipt';
      const paperSize =
        (typeof req.body?.paper_size === 'string' && req.body.paper_size) || null;

      if (!req.file) {
        return res.status(400).json({ error: 'PDF file is required (field: file)' });
      }

      const [enrows]: any = await pool.query(
        'SELECT * FROM enrollments WHERE enrollment_id = ?',
        [enrollmentId]
      );
      if (!enrows.length) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }
      const enrollment = enrows[0];
      const studentId = enrollment.student_id;

      const storageRoot =
        process.env.STORAGE_PATH ||
        path.resolve(process.cwd(), '../storage/students');
      const receiptsDir = path.join(
        storageRoot,
        String(studentId),
        'receipts'
      );
      fs.mkdirSync(receiptsDir, { recursive: true });

      const destName = `enrollment_${enrollmentId}_${templateKey}.pdf`;
      const destPath = path.join(receiptsDir, destName);
      const relativePath = `${studentId}/receipts/${destName}`;

      const fileBuf = fs.readFileSync(tempPath!);
      const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
      fs.writeFileSync(destPath, fileBuf);

      // Best-effort: update enrollments.receipt_* if columns exist
      try {
        await pool.query(
          `UPDATE enrollments SET
             receipt_pdf_path = ?,
             receipt_generated_at = NOW(),
             receipt_sha256 = ?,
             receipt_template = ?
           WHERE enrollment_id = ?`,
          [relativePath, sha256, templateKey, enrollmentId]
        );
      } catch (colErr) {
        console.warn(
          'enrollments.receipt_* columns missing — file saved, DB meta skipped:',
          colErr instanceof Error ? colErr.message : colErr
        );
      }

      // Best-effort enrollment_documents
      try {
        const [tpl]: any = await pool.query(
          'SELECT template_id FROM report_templates WHERE template_key = ? LIMIT 1',
          [templateKey]
        );
        const templateId = tpl[0]?.template_id ?? null;
        if (templateId) {
          await pool.query(
            `INSERT INTO enrollment_documents
               (enrollment_id, template_id, template_key, file_path, sha256, paper_size)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               file_path = VALUES(file_path),
               sha256 = VALUES(sha256),
               paper_size = VALUES(paper_size),
               generated_at = CURRENT_TIMESTAMP`,
            [
              enrollmentId,
              templateId,
              templateKey,
              relativePath,
              sha256,
              paperSize,
            ]
          );
        }
      } catch {
        /* optional table */
      }

      res.status(201).json({
        enrollment_id: Number(enrollmentId),
        template_key: templateKey,
        receipt_pdf_path: relativePath,
        receipt_sha256: sha256,
        bytes: fileBuf.length,
        paper_size: paperSize,
      });
    } catch (error) {
      console.error('Error saving receipt PDF:', error);
      res.status(500).json({ error: 'Failed to save receipt PDF' });
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
      }
    }
  }
);

// GET /api/enrollments/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT e.*, c.title as course_title, c.price as course_base_price,
       (e.final_price - e.amount_paid) as balance
       FROM enrollments e
       JOIN courses c ON e.course_id = c.course_id
       WHERE e.enrollment_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching enrollment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
