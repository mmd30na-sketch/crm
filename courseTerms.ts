/**
 * Course terms («مدیریت دوره‌ها»): one row per (course, course_number).
 * Additive only: new table crm_course_terms; existing tables are only read.
 * Seed (once, when the table is empty): distinct (course_id, course_number > 0) from enrollments and TblEnroll.
 * course_number is a global cohort counter (same numbers start at the same time across courses), so the
 * single highest number overall is 'active' and everything else 'finished'.
 * Writes go through /api/course-terms, so the global audit middleware logs them (entity "course-terms").
 */
import type express from 'express';
import * as db from './mysql-socks';

let ready = false;
const STATUSES = ['active', 'finished'] as const;
const jalali = (v: unknown): string | null => {
  const s = String(v ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/-/g, '/');
  return /^1[34]\d\d\/\d{1,2}\/\d{1,2}$/.test(s) ? s : null;
};
const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const str = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };

export async function ensureCourseTermsSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_course_terms (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      course_id INT NOT NULL,
      course_number INT NOT NULL,
      title VARCHAR(150) NULL,
      start_date VARCHAR(10) NULL COMMENT 'Jalali yyyy/mm/dd',
      end_date VARCHAR(10) NULL COMMENT 'Jalali yyyy/mm/dd',
      capacity INT NULL,
      status ENUM('active','finished') NOT NULL DEFAULT 'active',
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_course_term (course_id, course_number),
      KEY idx_term_status (status),
      CONSTRAINT fk_course_terms_course FOREIGN KEY (course_id) REFERENCES courses (course_id) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: course runs / دوره‌های برگزارشده'`);
    const [{ n }] = await db.sql<{ n: number }>('SELECT COUNT(*) AS n FROM crm_course_terms');
    if (Number(n) === 0) {
      const pairs = await db.sql<{ course_id: number; course_number: number }>(`
        SELECT DISTINCT p.course_id, p.course_number FROM (
          SELECT course_id, course_number FROM enrollments WHERE course_number > 0
          UNION SELECT courseRef, courseNumber FROM TblEnroll WHERE courseNumber > 0
        ) p JOIN courses c ON c.course_id = p.course_id`).catch(async () =>
        db.sql<any>('SELECT DISTINCT e.course_id, e.course_number FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.course_number > 0'));
      const maxNum = (pairs as any[]).reduce((m: number, p: any) => Math.max(m, Number(p.course_number)), 0);
      for (const p of pairs) {
        await db.sqlExec('INSERT IGNORE INTO crm_course_terms (course_id, course_number, status, notes) VALUES (?, ?, ?, ?)',
          [p.course_id, p.course_number, Number(p.course_number) === maxNum ? 'active' : 'finished', 'ایجاد خودکار از ثبت‌نام‌های موجود']);
      }
      console.log(`crm_course_terms seeded: ${pairs.length} terms, active course_number=${maxNum}`);
    }
    ready = true;
  } catch (err: any) {
    console.warn('Could not prepare crm_course_terms:', err.message);
  }
}

const LIST_SQL = `
  SELECT t.id, t.course_id, c.title AS course_title, t.course_number, t.title, t.start_date, t.end_date, t.capacity, t.status, t.notes,
         t.created_at, t.updated_at,
         COUNT(e.enrollment_id) AS enrolled,
         COALESCE(SUM(e.final_price), 0) AS total_due,
         COALESCE(SUM(p.paid), 0) AS total_paid
  FROM crm_course_terms t
  JOIN courses c ON c.course_id = t.course_id
  LEFT JOIN enrollments e ON e.course_id = t.course_id AND e.course_number = t.course_number
  LEFT JOIN (SELECT enrollment_id, SUM(amount) AS paid FROM payments GROUP BY enrollment_id) p ON p.enrollment_id = e.enrollment_id`;

export function registerCourseTerms(app: express.Express, deps: { isAdmin: (req: express.Request) => boolean }) {
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) => (req: express.Request, res: express.Response) => {
    if (!ready) return res.status(503).json({ error: 'این بخش فقط با دیتابیس MySQL فعال است.' });
    fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' }));
  };
  const shape = (r: any) => ({
    ...r, enrolled: Number(r.enrolled) || 0, total_due: Number(r.total_due) || 0, total_paid: Number(r.total_paid) || 0,
    remaining: Math.max(0, (Number(r.total_due) || 0) - (Number(r.total_paid) || 0)),
  });

  app.get('/api/course-terms', wrap(async (req, res) => {
    const q = req.query as Record<string, string>;
    const where: string[] = []; const params: any[] = [];
    if (posInt(q.course_id)) { where.push('t.course_id = ?'); params.push(posInt(q.course_id)); }
    if ((STATUSES as readonly string[]).includes(q.status)) { where.push('t.status = ?'); params.push(q.status); }
    const rows = await db.sql<any>(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY t.id ORDER BY t.course_number DESC, c.title`, params);
    res.json(rows.map(shape));
  }));

  app.get('/api/course-terms/:id/students', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const rows = await db.sql<any>(`
      SELECT s.student_id AS id, s.first_name, s.last_name, s.phone_number, e.enrollment_id, e.signup_date_jalali, e.final_price,
             COALESCE(p.paid, 0) AS paid
      FROM crm_course_terms t
      JOIN enrollments e ON e.course_id = t.course_id AND e.course_number = t.course_number
      LEFT JOIN students s ON s.student_id = e.student_id
      LEFT JOIN (SELECT enrollment_id, SUM(amount) AS paid FROM payments GROUP BY enrollment_id) p ON p.enrollment_id = e.enrollment_id
      WHERE t.id = ? ORDER BY e.signup_date_jalali DESC, e.enrollment_id DESC`, [id]);
    res.json(rows.map((r) => ({ ...r, final_price: Number(r.final_price) || 0, paid: Number(r.paid) || 0 })));
  }));

  const readBody = (b: any) => {
    const capacity = b.capacity === '' || b.capacity == null ? null : posInt(b.capacity);
    if (b.capacity !== '' && b.capacity != null && capacity == null) throw Object.assign(new Error('ظرفیت باید عدد مثبت باشد'), { status: 400 });
    for (const k of ['start_date', 'end_date']) if (b[k] && !jalali(b[k])) throw Object.assign(new Error('تاریخ باید به شکل ۱۴۰۵/۰۷/۰۱ باشد'), { status: 400 });
    return {
      title: str(b.title, 150), start_date: jalali(b.start_date), end_date: jalali(b.end_date), capacity,
      status: (STATUSES as readonly string[]).includes(b.status) ? b.status : 'active', notes: str(b.notes, 2000),
    };
  };

  app.post('/api/course-terms', wrap(async (req, res) => {
    if (!deps.isAdmin(req)) return res.status(403).json({ error: 'فقط مدیر' });
    const course_id = posInt(req.body?.course_id); const course_number = posInt(req.body?.course_number);
    if (!course_id || !course_number) return res.status(400).json({ error: 'دوره و شماره دوره الزامی است' });
    const [c] = await db.sql<any>('SELECT course_id FROM courses WHERE course_id = ?', [course_id]);
    if (!c) return res.status(400).json({ error: 'دوره پیدا نشد' });
    const [dup] = await db.sql<any>('SELECT id FROM crm_course_terms WHERE course_id = ? AND course_number = ?', [course_id, course_number]);
    if (dup) return res.status(409).json({ error: 'این شماره دوره برای این دوره قبلاً ثبت شده است' });
    const v = readBody(req.body || {});
    const r = await db.sqlExec('INSERT INTO crm_course_terms (course_id, course_number, title, start_date, end_date, capacity, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [course_id, course_number, v.title, v.start_date, v.end_date, v.capacity, v.status, v.notes]);
    res.json({ id: r.insertId });
  }));

  app.put('/api/course-terms/:id', wrap(async (req, res) => {
    if (!deps.isAdmin(req)) return res.status(403).json({ error: 'فقط مدیر' });
    const id = posInt(req.params.id); if (!id) return res.status(400).json({ error: 'شناسه نامعتبر' });
    const v = readBody(req.body || {});
    const r = await db.sqlExec('UPDATE crm_course_terms SET title = ?, start_date = ?, end_date = ?, capacity = ?, status = ?, notes = ? WHERE id = ?',
      [v.title, v.start_date, v.end_date, v.capacity, v.status, v.notes, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'پیدا نشد' });
    res.json({ ok: true });
  }));
}
