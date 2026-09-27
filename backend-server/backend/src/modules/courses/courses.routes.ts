import { Router } from 'express';
import pool from '../../config/db.js';

const router = Router();

// GET /api/courses
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT course_id, title, price, is_active FROM courses WHERE is_active = 1 ORDER BY title ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
