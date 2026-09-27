import { Router } from 'express';
import pool from '../../config/db.js';
import { z } from 'zod';
import { getTodayShamsi } from '../../utils/shamsi.js';

const router = Router();

const PaymentSchema = z.object({
  student_id: z.number().int(),
  enrollment_id: z.number().int().nullable().optional(),
  amount: z.number().nonnegative(),
  pay_date_jalali: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/, 'Date must be in YYYY/MM/DD format').optional(),
  pay_method: z.string().nullable().optional(),
  payment_kind: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

// Helper to recalculate enrollment amount_paid cache
async function syncEnrollmentPaidAmount(enrollmentId: number) {
  await pool.query(
    `UPDATE enrollments 
     SET amount_paid = (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE enrollment_id = ?) 
     WHERE enrollment_id = ?`,
    [enrollmentId, enrollmentId]
  );
}

// POST /api/payments - Register a new payment
router.post('/', async (req, res) => {
  try {
    const validatedData = PaymentSchema.parse(req.body);
    const { student_id, enrollment_id, amount, pay_date_jalali, pay_method, payment_kind, description } = validatedData;

    // 1. Verify student exists
    const [students]: any = await pool.query('SELECT * FROM students WHERE student_id = ?', [student_id]);
    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let resolvedEnrollmentId = enrollment_id || null;
    let resolvedDate = pay_date_jalali || null;

    // 2. Process enrollment specific logic
    if (resolvedEnrollmentId) {
      const [enrollments]: any = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = ?', [resolvedEnrollmentId]);
      if (enrollments.length === 0) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      // If no custom payment date, copy from enrollment signup date
      if (!resolvedDate) {
        resolvedDate = enrollments[0].signup_date_jalali;
      }
    }

    if (!resolvedDate) {
      resolvedDate = getTodayShamsi();
    }

    // 3. Insert payment
    const [result]: any = await pool.query(
      `INSERT INTO payments (enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [resolvedEnrollmentId, student_id, resolvedDate, amount, pay_method || null, payment_kind || null, description || null]
    );

    const paymentId = result.insertId;

    // 4. Sync enrollment paid amount
    if (resolvedEnrollmentId) {
      await syncEnrollmentPaidAmount(resolvedEnrollmentId);
    }

    const [newPayment]: any = await pool.query('SELECT * FROM payments WHERE payment_id = ?', [paymentId]);

    // 5. Return success and the payment details
    res.status(201).json(newPayment[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating payment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/payments/student/:studentId - Get payments list of a specific student
router.get('/student/:studentId', async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const [rows] = await pool.query(
      'SELECT * FROM payments WHERE student_id = ? ORDER BY pay_date_jalali DESC, payment_id DESC',
      [studentId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching student payments:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/payments/enrollment/:enrollmentId - Get payments list of a specific enrollment
router.get('/enrollment/:enrollmentId', async (req, res) => {
  try {
    const enrollmentId = req.params.enrollmentId;
    const [rows] = await pool.query(
      'SELECT * FROM payments WHERE enrollment_id = ? ORDER BY pay_date_jalali DESC, payment_id DESC',
      [enrollmentId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching enrollment payments:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
