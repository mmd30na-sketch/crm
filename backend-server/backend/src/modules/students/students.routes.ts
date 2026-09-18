/**
 * Students module — CRM API
 * Includes online Gemini 1.5 Flash national-card OCR:
 *   POST /api/students/ocr/national-card
 *
 * Author: rok (eco_v4)
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import pool from '../../config/db.js';
import {
  isValidNationalCode,
  normalizeNationalCode,
  onlyDigits,
} from '../../utils/iranNationalId.js';
import {
  guessMimeFromFilename,
  isAllowedImageMime,
  runGeminiNationalCardOcr,
  safeUnlink,
} from './geminiNationalCardOcr.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const StudentSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  national_code: z
    .string()
    .regex(/^[0-9]{10}$/, 'National code must be exactly 10 digits')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  phone_number: z
    .string()
    .min(10, 'Phone number must be at least 10 digits')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  address: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Multer — temp disk storage for OCR + photo uploads
// ---------------------------------------------------------------------------

const TEMP_UPLOAD_DIR = path.resolve(
  process.env.OCR_TEMP_DIR || path.join(process.cwd(), 'uploads', 'temp')
);

function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  }
}
ensureTempDir();

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureTempDir();
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const safe = (file.originalname || 'upload').replace(/[^\w.\-()+\u0600-\u06FF]/g, '_');
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
  },
});

const imageFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const mime = (file.mimetype || '').toLowerCase();
  if (isAllowedImageMime(mime) || mime === 'application/octet-stream') {
    cb(null, true);
    return;
  }
  cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}`));
};

const OCR_MAX_BYTES = Number(process.env.OCR_MAX_UPLOAD_BYTES || 8 * 1024 * 1024);

const uploadOcr = multer({
  storage: diskStorage,
  limits: { fileSize: OCR_MAX_BYTES, files: 1 },
  fileFilter: imageFileFilter,
});

const uploadPhotos = multer({
  storage: diskStorage,
  limits: { fileSize: OCR_MAX_BYTES, files: 2 },
  fileFilter: imageFileFilter,
});

/** Prefer field name: file | image | id_card | national_card */
function pickUploadedImage(req: Request): Express.Multer.File | undefined {
  const anyReq = req as Request & {
    file?: Express.Multer.File;
    files?:
      | Express.Multer.File[]
      | { [fieldname: string]: Express.Multer.File[] };
  };

  if (anyReq.file) return anyReq.file;

  const files = anyReq.files;
  if (!files) return undefined;

  if (Array.isArray(files)) return files[0];

  for (const key of ['file', 'image', 'id_card', 'national_card', 'photo']) {
    const arr = files[key];
    if (arr && arr[0]) return arr[0];
  }
  const firstKey = Object.keys(files)[0];
  return firstKey ? files[firstKey][0] : undefined;
}

function multerErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!err) {
    next();
    return;
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: `Image too large (max ${Math.round(OCR_MAX_BYTES / (1024 * 1024))}MB)`,
      });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && /Unsupported file type/i.test(err.message)) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}

// ---------------------------------------------------------------------------
// GET /api/students — list / search (optional course_number)
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const { search, national_code, phone_number, course_number } = req.query;
    let query = 'SELECT DISTINCT s.* FROM students s';
    const params: unknown[] = [];

    if (course_number) {
      query += ' JOIN enrollments e ON s.student_id = e.student_id';
    }

    query += ' WHERE 1=1';

    if (search) {
      query += ' AND (s.last_name LIKE ? OR s.first_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (national_code) {
      const nc = normalizeNationalCode(String(national_code));
      query += ' AND s.national_code = ?';
      params.push(nc || national_code);
    }
    if (phone_number) {
      query += ' AND s.phone_number = ?';
      params.push(onlyDigits(String(phone_number)) || phone_number);
    }
    if (course_number) {
      query += ' AND e.course_number = ?';
      params.push(parseInt(String(course_number), 10));
    }

    query += ' ORDER BY s.last_name ASC, s.first_name ASC';
    const [students] = (await pool.query(query, params)) as [Array<Record<string, unknown>>, unknown];

    if (students.length > 0) {
      const studentIds = students.map((s) => s.student_id);
      const [enrollments] = (await pool.query(
        `SELECT e.enrollment_id, e.student_id, e.course_id, e.course_number,
                e.signup_date_jalali, e.final_price, e.amount_paid, c.title AS course_title
         FROM enrollments e
         JOIN courses c ON e.course_id = c.course_id
         WHERE e.student_id IN (?)`,
        [studentIds]
      )) as [Array<Record<string, unknown>>, unknown];

      for (const student of students) {
        student.courses = enrollments.filter(
          (e) => e.student_id === student.student_id
        );
      }
    }

    res.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/students/ocr/national-card
// multipart: file | image | id_card  (image/*)
// ---------------------------------------------------------------------------

router.post(
  '/ocr/national-card',
  (req, res, next) => {
    // Accept several field names without forcing clients to match one name
    uploadOcr.fields([
      { name: 'file', maxCount: 1 },
      { name: 'image', maxCount: 1 },
      { name: 'id_card', maxCount: 1 },
      { name: 'national_card', maxCount: 1 },
      { name: 'photo', maxCount: 1 },
    ])(req, res, (err) => multerErrorHandler(err, req, res, next));
  },
  async (req, res) => {
    let tempPath: string | undefined;

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'Gemini API key is not configured',
          hint: 'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the backend environment',
        });
      }

      const uploaded = pickUploadedImage(req);
      if (!uploaded) {
        return res.status(400).json({
          error: 'No image file uploaded',
          hint: 'Send multipart form field: file, image, id_card, national_card, or photo',
        });
      }

      tempPath = uploaded.path;

      if (!uploaded.size || uploaded.size < 32) {
        return res.status(400).json({ error: 'Uploaded file is empty or too small' });
      }

      let mimeType = (uploaded.mimetype || '').toLowerCase().split(';')[0].trim();
      if (!mimeType || mimeType === 'application/octet-stream') {
        mimeType = guessMimeFromFilename(uploaded.originalname);
      }
      if (!isAllowedImageMime(mimeType)) {
        return res.status(400).json({
          error: `Unsupported image type: ${mimeType}`,
        });
      }

      const buffer = fs.readFileSync(tempPath);

      const ocr = await runGeminiNationalCardOcr({
        buffer,
        mimeType,
        apiKey,
      });

      // Soft warnings for the UI (still 200 — operator may correct fields)
      const warnings: string[] = [];
      if (!ocr.national_code) {
        warnings.push('national_code_missing');
      } else if (!ocr.national_code_length_ok) {
        warnings.push('national_code_not_10_digits');
      } else if (!ocr.national_code_valid) {
        warnings.push('national_code_checksum_failed');
      }
      if (!ocr.first_name && !ocr.last_name) {
        warnings.push('name_fields_empty');
      }

      return res.json({
        ...ocr,
        warnings,
        // Convenience aliases for StudentRegistrationForm prefill
        prefill: {
          first_name: ocr.first_name,
          last_name: ocr.last_name,
          national_code: ocr.national_code,
          // birth date is not a students table column today; exposed for future use
          birth_date_jalali: ocr.birth_date_jalali,
        },
        meta: {
          original_filename: uploaded.originalname,
          mime_type: mimeType,
          bytes: uploaded.size,
          national_code_checksum_algorithm: 'iran-mod11',
        },
      });
    } catch (error) {
      console.error('Error running national card OCR:', error);
      const message =
        error instanceof Error ? error.message : 'OCR processing failed';
      const isConfig =
        /API key|PERMISSION|401|403|quota|RESOURCE_EXHAUSTED/i.test(message);
      return res.status(isConfig ? 502 : 500).json({
        error: 'OCR processing failed',
        detail: process.env.NODE_ENV === 'development' ? message : undefined,
        hint: 'Check image quality, GEMINI_API_KEY, and model availability (gemini-1.5-flash)',
      });
    } finally {
      safeUnlink(tempPath);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/students/:id
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res) => {
  try {
    const studentId = req.params.id;
    const [students] = (await pool.query(
      'SELECT * FROM students WHERE student_id = ?',
      [studentId]
    )) as [Array<Record<string, unknown>>, unknown];

    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = students[0];
    const [enrollments] = (await pool.query(
      `SELECT e.*, c.title AS course_title,
              (e.final_price - e.amount_paid) AS balance
       FROM enrollments e
       JOIN courses c ON e.course_id = c.course_id
       WHERE e.student_id = ?
       ORDER BY e.enrollment_id DESC`,
      [studentId]
    )) as [unknown[], unknown];

    student.courses = enrollments;
    res.json(student);
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/students
// ---------------------------------------------------------------------------

router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.national_code) {
      body.national_code = normalizeNationalCode(body.national_code);
    }
    if (body.phone_number) {
      body.phone_number = onlyDigits(body.phone_number) || body.phone_number;
    }

    const validatedData = StudentSchema.parse(body);
    let { first_name, last_name, national_code, phone_number, address } =
      validatedData;

    if (national_code && !isValidNationalCode(national_code)) {
      return res.status(400).json({
        error: 'Invalid national code checksum',
        national_code,
        national_code_valid: false,
      });
    }

    if (national_code) {
      const [existing] = (await pool.query(
        'SELECT * FROM students WHERE national_code = ?',
        [national_code]
      )) as [unknown[], unknown];
      if (existing.length > 0) {
        return res.status(409).json({
          status: 'exists',
          message: 'Student with this national code already exists',
          student: existing[0],
        });
      }
    }

    const [result] = (await pool.query(
      `INSERT INTO students (first_name, last_name, national_code, phone_number, address)
       VALUES (?, ?, ?, ?, ?)`,
      [
        first_name,
        last_name,
        national_code || null,
        phone_number || null,
        address || null,
      ]
    )) as [{ insertId: number }, unknown];

    const [newStudent] = (await pool.query(
      'SELECT * FROM students WHERE student_id = ?',
      [result.insertId]
    )) as [unknown[], unknown];

    res.status(201).json({
      status: 'created',
      student: newStudent[0],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/students/:id
// ---------------------------------------------------------------------------

router.put('/:id', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.national_code) {
      body.national_code = normalizeNationalCode(body.national_code);
    }
    if (body.phone_number) {
      body.phone_number = onlyDigits(body.phone_number) || body.phone_number;
    }

    const validatedData = StudentSchema.parse(body);
    const { first_name, last_name, national_code, phone_number, address } =
      validatedData;

    if (national_code && !isValidNationalCode(national_code)) {
      return res.status(400).json({
        error: 'Invalid national code checksum',
        national_code,
        national_code_valid: false,
      });
    }

    if (national_code) {
      const [existing] = (await pool.query(
        'SELECT * FROM students WHERE national_code = ? AND student_id != ?',
        [national_code, req.params.id]
      )) as [unknown[], unknown];
      if (existing.length > 0) {
        return res
          .status(409)
          .json({ error: 'National code is already in use by another student' });
      }
    }

    await pool.query(
      `UPDATE students
       SET first_name = ?, last_name = ?, national_code = ?, phone_number = ?, address = ?
       WHERE student_id = ?`,
      [
        first_name,
        last_name,
        national_code || null,
        phone_number || null,
        address || null,
        req.params.id,
      ]
    );

    const [updated] = (await pool.query(
      'SELECT * FROM students WHERE student_id = ?',
      [req.params.id]
    )) as [unknown[], unknown];

    if (!updated.length) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/students/:id — cascade payments + enrollments
// ---------------------------------------------------------------------------

router.delete('/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const studentId = req.params.id;
    const [students] = (await connection.query(
      'SELECT * FROM students WHERE student_id = ?',
      [studentId]
    )) as [unknown[], unknown];

    if (students.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Student not found' });
    }

    await connection.beginTransaction();
    await connection.query('DELETE FROM payments WHERE student_id = ?', [
      studentId,
    ]);
    await connection.query('DELETE FROM enrollments WHERE student_id = ?', [
      studentId,
    ]);
    await connection.query('DELETE FROM students WHERE student_id = ?', [
      studentId,
    ]);
    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message:
        'Student profile and all associated payments/enrollments deleted successfully.',
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    connection.release();
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/students/:id/upload — id_card_photo / personal_photo
// ---------------------------------------------------------------------------

router.post(
  '/:id/upload',
  (req, res, next) => {
    uploadPhotos.fields([
      { name: 'id_card_photo', maxCount: 1 },
      { name: 'personal_photo', maxCount: 1 },
    ])(req, res, (err) => multerErrorHandler(err, req, res, next));
  },
  async (req, res) => {
    try {
      const studentId = req.params.id;
      const [students] = (await pool.query(
        'SELECT * FROM students WHERE student_id = ?',
        [studentId]
      )) as [Array<Record<string, unknown>>, unknown];

      if (students.length === 0) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const student = students[0];
      const baseStoragePath =
        process.env.STORAGE_PATH ||
        path.resolve(process.cwd(), '../storage/students');
      const studentFolder = path.join(baseStoragePath, String(studentId));

      if (!fs.existsSync(studentFolder)) {
        fs.mkdirSync(studentFolder, { recursive: true });
      }

      const files = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined;
      const updates: { id_card_photo?: string; personal_photo?: string } = {};
      const lastName = String(student.last_name || 'student');

      if (files?.id_card_photo?.[0]) {
        const file = files.id_card_photo[0];
        const ext = path.extname(file.originalname) || '.jpg';
        const destName = `${lastName}_${studentId}_ID${ext}`;
        const destPath = path.join(studentFolder, destName);
        fs.renameSync(file.path, destPath);
        updates.id_card_photo = `${studentId}/${destName}`;
      }

      if (files?.personal_photo?.[0]) {
        const file = files.personal_photo[0];
        const ext = path.extname(file.originalname) || '.jpg';
        const destName = `${lastName}_${studentId}_Photo${ext}`;
        const destPath = path.join(studentFolder, destName);
        fs.renameSync(file.path, destPath);
        updates.personal_photo = `${studentId}/${destName}`;
      }

      if (updates.id_card_photo || updates.personal_photo) {
        const fields: string[] = [];
        const params: unknown[] = [];
        if (updates.id_card_photo) {
          fields.push('id_card_photo = ?');
          params.push(updates.id_card_photo);
        }
        if (updates.personal_photo) {
          fields.push('personal_photo = ?');
          params.push(updates.personal_photo);
        }
        params.push(studentId);
        await pool.query(
          `UPDATE students SET ${fields.join(', ')} WHERE student_id = ?`,
          params
        );
      }

      const [updatedStudent] = (await pool.query(
        'SELECT * FROM students WHERE student_id = ?',
        [studentId]
      )) as [unknown[], unknown];

      res.json(updatedStudent[0]);
    } catch (error) {
      console.error('Error uploading photos:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

export default router;
