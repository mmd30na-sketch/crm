/**
 * Practical-lesson calendar (تقویم جلسات عملی): vehicles, instructor weekly availability and lesson
 * bookings with instructor / vehicle / student double-booking detection, plus a flag-gated SMS reminder.
 * Additive only: three new tables (crm_vehicles, crm_instructor_availability, crm_lesson_bookings);
 * instructors come from the existing crm_instructors (instructorPay.ts) and a lesson marked "done" can be
 * logged once into crm_instructor_sessions so it counts towards حق‌التدریس. MySQL only.
 * Staff routes /api/lessons/* (admin + cashier; reminder run is admin only). Phones are always masked.
 * SMS reminders: CRM_LESSON_SMS_ENABLED=1 is a hard gate (default off); CRM_LESSON_SMS_TEST_MOBILE redirects
 * every reminder to one test number. See docs/lesson_calendar.md.
 */
import type express from 'express';
import * as db from './mysql-socks';
import { maskPhone } from './phase4';
import { parseTime, normalizeJalali, findConflicts, withinAvailability, lessonStartUtc, durationHours, ACTIVE_STATUSES } from './lessonCore';
import { jalaliToday } from './src/utils/normalize';
import { addJalaliDays } from './src/utils/jalali';

let ready = false;

const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const str = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };
const bool = (v: unknown) => v === 'true' || v === '1' || v === true || v === 1;

const badRequest = (msg: string): never => { const e = new Error(msg); (e as any).status = 400; throw e; };
const notFound = (): never => { const e: any = new Error('پیدا نشد'); e.status = 404; throw e; };
const conflict = (msg: string, conflicts: any[]): never => { const e = new Error(msg); (e as any).status = 409; (e as any).conflicts = conflicts; throw e; };

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) => async (req: express.Request, res: express.Response) => {
  if (!ready) return res.status(503).json({ error: 'این بخش فقط با دیتابیس MySQL فعال است.' });
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json(result);
  } catch (err: any) {
    if (res.headersSent) return;
    if (err.status === 409) {
      res.status(409).json({ error: err.message, conflicts: err.conflicts });
    } else if (err.status) {
      res.status(err.status).json({ error: err.message, ...(err.outside_availability ? { outside_availability: true } : {}) });
    } else {
      console.warn('[lessons]', err?.message || err);
      res.status(500).json({ error: 'خطای سرور' });
    }
  }
};
const LOCK = 'crm_lesson_booking';
/** Serialises conflict check + write across concurrent requests (MySQL named lock). */
async function withBookingLock<T>(fn: () => Promise<T>): Promise<T> {
  const [lock] = await db.sql<{ l: number }>(`SELECT GET_LOCK('${LOCK}', 5) AS l`);
  if (!lock || Number(lock.l) !== 1) { const e: any = new Error('سرور مشغول است؛ دوباره تلاش کنید.'); e.status = 503; throw e; }
  try { return await fn(); } finally { await db.sql(`SELECT RELEASE_LOCK('${LOCK}') AS r`).catch(() => undefined); }
}
const ACTIVE_SQL = ACTIVE_STATUSES.map((x) => `'${x}'`).join(',');

const checkRole = (req: express.Request, deps: { role: (req: express.Request) => string | null }) => {
  const role = deps.role(req);
  if (role !== 'admin' && role !== 'cashier') {
    const e = new Error('دسترسی غیرمجاز');
    (e as any).status = 403;
    throw e;
  }
};

export async function ensureLessonCalendarSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  const statements: [string, string][] = [
    ['crm_vehicles', `CREATE TABLE IF NOT EXISTS crm_vehicles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      plate VARCHAR(40) NULL,
      kind ENUM('car','motorcycle','other') NOT NULL DEFAULT 'car',
      gearbox ENUM('manual','automatic') NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vehicles_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: training vehicles / خودروهای آموزشی'`],
    ['crm_instructor_availability', `CREATE TABLE IF NOT EXISTS crm_instructor_availability (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      instructor_id INT UNSIGNED NOT NULL,
      weekday TINYINT NOT NULL COMMENT '0 = Saturday ... 6 = Friday',
      start_time CHAR(5) NOT NULL COMMENT 'HH:MM',
      end_time CHAR(5) NOT NULL COMMENT 'HH:MM',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_avail_instructor_day (instructor_id, weekday),
      CONSTRAINT fk_avail_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructor weekly availability / ساعات حضور مربی'`],
    ['crm_lesson_bookings', `CREATE TABLE IF NOT EXISTS crm_lesson_bookings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      instructor_id INT UNSIGNED NOT NULL,
      vehicle_id INT UNSIGNED NULL,
      lesson_date CHAR(10) NOT NULL COMMENT 'Jalali yyyy/mm/dd',
      start_time CHAR(5) NOT NULL COMMENT 'HH:MM Asia/Tehran',
      end_time CHAR(5) NOT NULL COMMENT 'HH:MM Asia/Tehran',
      status ENUM('scheduled','done','cancelled','no_show') NOT NULL DEFAULT 'scheduled',
      notes TEXT NULL,
      cancel_reason VARCHAR(255) NULL,
      reminder_status VARCHAR(32) NULL,
      reminder_sent_at DATETIME NULL,
      instructor_session_id INT UNSIGNED NULL COMMENT 'crm_instructor_sessions.id once logged for حق‌التدریس',
      created_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_lesson_date_instructor (lesson_date, instructor_id),
      KEY idx_lesson_date_vehicle (lesson_date, vehicle_id),
      KEY idx_lesson_student_date (student_id, lesson_date),
      KEY idx_lesson_reminder (status, reminder_sent_at),
      CONSTRAINT fk_lesson_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_lesson_vehicle FOREIGN KEY (vehicle_id) REFERENCES crm_vehicles (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: practical lesson bookings / رزرو جلسات عملی'`],
  ];
  // One try per statement (instructorPay.ts style): crm_instructors comes from ensureInstructorPaySchema.
  let ok = true;
  for (const [name, q] of statements) {
    try { await db.sqlExec(q); } catch (err: any) { ok = false; console.warn(`lesson-calendar schema (${name}):`, err.message); }
  }
  ready = ok;
}

export function registerLessonCalendar(app: express.Express, deps: {
  role: (req: express.Request) => string | null;
  username: (req: express.Request) => string;
  normalizeMobile: (v: unknown) => string;
  sms: { sendTemplate: (key: string, mobile: string, vars: Record<string, unknown>, fallback?: { templateId?: string; param?: string }) => Promise<{ ok: boolean; status: string; detail?: string }>; configured: () => boolean };
  log: (msg: string) => void;
}) {
  app.get('/api/lessons/vehicles', wrap(async (req, res) => {
    checkRole(req, deps);
    const rows = await db.sql<{
      id: number;
      name: string;
      plate: string | null;
      kind: 'car' | 'motorcycle' | 'other';
      gearbox: 'manual' | 'automatic' | null;
      active: number;
      notes: string | null;
    }>('SELECT id, name, plate, kind, gearbox, active, notes FROM crm_vehicles ORDER BY name');
    return rows.map(r => ({ ...r, active: !!r.active }));
  }));

  app.post('/api/lessons/vehicles', wrap(async (req, res) => {
    checkRole(req, deps);
    const name = str(req.body?.name, 120);
    const plate = str(req.body?.plate, 40);
    const kind = ['car', 'motorcycle', 'other'].includes(req.body?.kind) ? req.body.kind : 'car';
    const gearbox = ['manual', 'automatic'].includes(req.body?.gearbox) ? req.body.gearbox : null;
    const active = bool(req.body?.active);
    const notes = str(req.body?.notes, 2000);

    if (!name) badRequest('نام خودرو الزامی است');

    const result = await db.sqlExec(
      'INSERT INTO crm_vehicles (name, plate, kind, gearbox, active, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [name, plate, kind, gearbox, active ? 1 : 0, notes]
    );
    return { id: result.insertId };
  }));

  app.put('/api/lessons/vehicles/:id', wrap(async (req, res) => {
    checkRole(req, deps);
    const id = posInt(req.params.id);
    if (!id) badRequest('شناسه نامعتبر');

    const name = str(req.body?.name, 120);
    const plate = str(req.body?.plate, 40);
    const kind = ['car', 'motorcycle', 'other'].includes(req.body?.kind) ? req.body.kind : 'car';
    const gearbox = ['manual', 'automatic'].includes(req.body?.gearbox) ? req.body.gearbox : null;
    const active = bool(req.body?.active);
    const notes = str(req.body?.notes, 2000);

    if (!name) badRequest('نام خودرو الزامی است');

    await db.sqlExec(
      'UPDATE crm_vehicles SET name=?, plate=?, kind=?, gearbox=?, active=?, notes=? WHERE id=?',
      [name, plate, kind, gearbox, active ? 1 : 0, notes, id]
    );
    return { ok: true };
  }));

  app.delete('/api/lessons/vehicles/:id', wrap(async (req, res) => {
    checkRole(req, deps);
    const id = posInt(req.params.id);
    if (!id) badRequest('شناسه نامعتبر');

    await db.sqlExec('DELETE FROM crm_vehicles WHERE id=?', [id]);
    return { ok: true };
  }));

  app.get('/api/lessons/instructors', wrap(async (req, res) => {
    checkRole(req, deps);
    const rows = await db.sql<{ id: number; name: string; active: number }>(
      'SELECT id, name, active FROM crm_instructors ORDER BY name'
    );
    return rows.map(r => ({ ...r, active: !!r.active }));
  }));

  app.get('/api/lessons/availability', wrap(async (req, res) => {
    checkRole(req, deps);
    const instructor_id = posInt(req.query.instructor_id);

    const rows = await db.sql<{
      id: number;
      instructor_id: number;
      weekday: number;
      start_time: string;
      end_time: string;
    }>(
      `SELECT id, instructor_id, weekday, start_time, end_time FROM crm_instructor_availability
       ${instructor_id ? 'WHERE instructor_id=?' : ''} ORDER BY instructor_id, weekday, start_time`,
      instructor_id ? [instructor_id] : []
    );
    return rows.map((r) => ({ ...r, weekday: Number(r.weekday) }));
  }));

  app.post('/api/lessons/availability', wrap(async (req, res) => {
    checkRole(req, deps);
    const instructor_id = posInt(req.body?.instructor_id);
    const wd = Number(req.body?.weekday);
    const weekday = Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : null;
    const start_time = parseTime(req.body?.start_time);
    const end_time = parseTime(req.body?.end_time);

    if (!instructor_id || weekday === null || !start_time || !end_time) {
      badRequest('مربی، روز هفته و ساعت شروع/پایان الزامی است');
    }
    if (start_time >= end_time) badRequest('ساعت پایان باید بعد از ساعت شروع باشد');

    const [instructor] = await db.sql<{ id: number }>(
      'SELECT id FROM crm_instructors WHERE id=? AND active=1',
      [instructor_id]
    );
    if (!instructor) badRequest('مربی نامعتبر یا غیرفعال است');

    const result = await db.sqlExec(
      'INSERT INTO crm_instructor_availability (instructor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)',
      [instructor_id, weekday, start_time, end_time]
    );
    return { id: result.insertId };
  }));

  app.delete('/api/lessons/availability/:id', wrap(async (req, res) => {
    checkRole(req, deps);
    const id = posInt(req.params.id);
    if (!id) badRequest('شناسه نامعتبر');

    await db.sqlExec('DELETE FROM crm_instructor_availability WHERE id=?', [id]);
    return { ok: true };
  }));

  app.get('/api/lessons/bookings', wrap(async (req, res) => {
    checkRole(req, deps);
    const from = normalizeJalali(req.query.from) || '0000/00/00';
    const to = normalizeJalali(req.query.to) || '9999/99/99';
    const instructor_id = posInt(req.query.instructor_id);
    const vehicle_id = posInt(req.query.vehicle_id);
    const student_id = posInt(req.query.student_id);
    const include_cancelled = bool(req.query.include_cancelled);

    let where = 'b.lesson_date BETWEEN ? AND ?';
    const params: any[] = [from, to];

    if (instructor_id) {
      where += ' AND b.instructor_id=?';
      params.push(instructor_id);
    }
    if (vehicle_id) {
      where += ' AND b.vehicle_id=?';
      params.push(vehicle_id);
    }
    if (student_id) {
      where += ' AND b.student_id=?';
      params.push(student_id);
    }
    if (!include_cancelled) {
      where += " AND b.status <> 'cancelled'";
    }

    const rows = await db.sql<{
      id: number;
      student_id: number;
      student_name: string;
      student_phone: string | null;
      instructor_id: number;
      instructor_name: string;
      vehicle_id: number | null;
      vehicle_name: string | null;
      lesson_date: string;
      start_time: string;
      end_time: string;
      status: string;
      notes: string | null;
      cancel_reason: string | null;
      reminder_status: string | null;
      reminder_sent_at: string | null;
      instructor_session_id: number | null;
    }>(`
      SELECT
        b.id, b.student_id, CONCAT(s.first_name, ' ', s.last_name) AS student_name,
        s.phone_number AS student_phone,
        b.instructor_id, i.name AS instructor_name,
        b.vehicle_id, v.name AS vehicle_name,
        b.lesson_date, b.start_time, b.end_time, b.status, b.notes,
        b.cancel_reason, b.reminder_status, b.reminder_sent_at, b.instructor_session_id
      FROM crm_lesson_bookings b
      JOIN students s ON s.student_id = b.student_id
      JOIN crm_instructors i ON i.id = b.instructor_id
      LEFT JOIN crm_vehicles v ON v.id = b.vehicle_id
      WHERE ${where}
      ORDER BY b.lesson_date, b.start_time
      LIMIT 2000
    `, params);

    // Raw phone never leaves the server.
    return rows.map(({ student_phone, ...r }) => ({ ...r, phone_masked: maskPhone(student_phone) }));
  }));

  app.post('/api/lessons/bookings', wrap(async (req, res) => {
    checkRole(req, deps);
    const student_id = posInt(req.body?.student_id);
    const instructor_id = posInt(req.body?.instructor_id);
    const vehicle_id = posInt(req.body?.vehicle_id);
    const lesson_date = normalizeJalali(req.body?.lesson_date);
    const start_time = parseTime(req.body?.start_time);
    const end_time = parseTime(req.body?.end_time);
    const notes = str(req.body?.notes, 2000);
    const force_outside_availability = bool(req.body?.force_outside_availability);

    if (!student_id || !instructor_id || !lesson_date || !start_time || !end_time) {
      badRequest('شناسه هنرجو، مربی، تاریخ و ساعت شروع/پایان الزامی است');
    }
    if (start_time >= end_time) badRequest('ساعت پایان باید بعد از ساعت شروع باشد');

    const [student] = await db.sql<{ student_id: number }>(
      'SELECT student_id FROM students WHERE student_id=?',
      [student_id]
    );
    if (!student) badRequest('هنرجو پیدا نشد');

    const [instructor] = await db.sql<{ id: number; active: number }>(
      'SELECT id, active FROM crm_instructors WHERE id=?',
      [instructor_id]
    );
    if (!instructor || !instructor.active) badRequest('مربی نامعتبر یا غیرفعال است');

    if (vehicle_id) {
      const [vehicle] = await db.sql<{ id: number; active: number }>(
        'SELECT id, active FROM crm_vehicles WHERE id=?',
        [vehicle_id]
      );
      if (!vehicle || !vehicle.active) badRequest('خودرو نامعتبر یا غیرفعال است');
    }

    const candidate = {
      instructor_id,
      vehicle_id: vehicle_id || null,
      student_id,
      lesson_date,
      start_time,
      end_time,
      status: 'scheduled'
    };

    return withBookingLock(async () => {
      const existing = await db.sql<{
        id: number;
        instructor_id: number;
        vehicle_id: number | null;
        student_id: number;
        lesson_date: string;
        start_time: string;
        end_time: string;
        status: string;
      }>(`
        SELECT id, instructor_id, vehicle_id, student_id, lesson_date, start_time, end_time, status
        FROM crm_lesson_bookings
        WHERE lesson_date = ? AND status IN (${ACTIVE_SQL}) AND (instructor_id = ? OR vehicle_id = ? OR student_id = ?)
      `, [lesson_date, instructor_id, vehicle_id || 0, student_id]);

      const conflicts = findConflicts(candidate, existing);
      if (conflicts.length > 0) {
        conflict('تداخل زمانی: مربی/خودرو/هنرجو در این بازه رزرو دارد', conflicts);
      }

      const availability = await db.sql<{
        instructor_id: number;
        weekday: number;
        start_time: string;
        end_time: string;
      }>(
        'SELECT instructor_id, weekday, start_time, end_time FROM crm_instructor_availability WHERE instructor_id=?',
        [instructor_id]
      );

      if (!withinAvailability(candidate, availability) && !force_outside_availability) {
        const e = new Error('خارج از ساعات حضور مربی');
        (e as any).status = 400;
        (e as any).outside_availability = true;
        throw e;
      }

      const warnings: string[] = [];
      if (force_outside_availability && availability.length > 0) {
        warnings.push('تایید دستی: خارج از ساعات حضور مربی');
      }

      const result = await db.sqlExec(
        'INSERT INTO crm_lesson_bookings (student_id, instructor_id, vehicle_id, lesson_date, start_time, end_time, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [student_id, instructor_id, vehicle_id || null, lesson_date, start_time, end_time, notes, deps.username(req)]
      );

      return { id: result.insertId, warnings };
    });
  }));

  app.put('/api/lessons/bookings/:id', wrap(async (req, res) => {
    checkRole(req, deps);
    const id = posInt(req.params.id);
    if (!id) badRequest('شناسه نامعتبر');

    const student_id = posInt(req.body?.student_id);
    const instructor_id = posInt(req.body?.instructor_id);
    const vehicle_id = posInt(req.body?.vehicle_id);
    const lesson_date = normalizeJalali(req.body?.lesson_date);
    const start_time = parseTime(req.body?.start_time);
    const end_time = parseTime(req.body?.end_time);
    const notes = str(req.body?.notes, 2000);
    const force_outside_availability = bool(req.body?.force_outside_availability);

    if (!student_id || !instructor_id || !lesson_date || !start_time || !end_time) {
      badRequest('شناسه هنرجو، مربی، تاریخ و ساعت شروع/پایان الزامی است');
    }
    if (start_time >= end_time) badRequest('ساعت پایان باید بعد از ساعت شروع باشد');

    const [student] = await db.sql<{ student_id: number }>(
      'SELECT student_id FROM students WHERE student_id=?',
      [student_id]
    );
    if (!student) badRequest('هنرجو پیدا نشد');

    const [instructor] = await db.sql<{ id: number; active: number }>(
      'SELECT id, active FROM crm_instructors WHERE id=?',
      [instructor_id]
    );
    if (!instructor || !instructor.active) badRequest('مربی نامعتبر یا غیرفعال است');

    if (vehicle_id) {
      const [vehicle] = await db.sql<{ id: number; active: number }>(
        'SELECT id, active FROM crm_vehicles WHERE id=?',
        [vehicle_id]
      );
      if (!vehicle || !vehicle.active) badRequest('خودرو نامعتبر یا غیرفعال است');
    }

    const [booking] = await db.sql<{ lesson_date: string; start_time: string; end_time: string; status: string }>(
      'SELECT lesson_date, start_time, end_time, status FROM crm_lesson_bookings WHERE id=?',
      [id]
    );
    if (!booking) notFound();
    if (booking.status === 'cancelled') badRequest('جلسه لغوشده قابل ویرایش نیست');

    const candidate = {
      id,
      instructor_id,
      vehicle_id: vehicle_id || null,
      student_id,
      lesson_date,
      start_time,
      end_time,
      status: 'scheduled'
    };

    return withBookingLock(async () => {
      const existing = await db.sql<{
        id: number;
        instructor_id: number;
        vehicle_id: number | null;
        student_id: number;
        lesson_date: string;
        start_time: string;
        end_time: string;
        status: string;
      }>(`
        SELECT id, instructor_id, vehicle_id, student_id, lesson_date, start_time, end_time, status
        FROM crm_lesson_bookings
        WHERE lesson_date = ? AND status IN (${ACTIVE_SQL}) AND (instructor_id = ? OR vehicle_id = ? OR student_id = ?) AND id <> ?
      `, [lesson_date, instructor_id, vehicle_id || 0, student_id, id]);

      const conflicts = findConflicts(candidate, existing);
      if (conflicts.length > 0) {
        conflict('تداخل زمانی: مربی/خودرو/هنرجو در این بازه رزرو دارد', conflicts);
      }

      const availability = await db.sql<{
        instructor_id: number;
        weekday: number;
        start_time: string;
        end_time: string;
      }>(
        'SELECT instructor_id, weekday, start_time, end_time FROM crm_instructor_availability WHERE instructor_id=?',
        [instructor_id]
      );

      if (!withinAvailability(candidate, availability) && !force_outside_availability) {
        const e = new Error('خارج از ساعات حضور مربی');
        (e as any).status = 400;
        (e as any).outside_availability = true;
        throw e;
      }

      const warnings: string[] = [];
      if (force_outside_availability && availability.length > 0) {
        warnings.push('تایید دستی: خارج از ساعات حضور مربی');
      }

      const resetReminder = (booking.lesson_date !== lesson_date || booking.start_time !== start_time || booking.end_time !== end_time);

      await db.sqlExec(
        `UPDATE crm_lesson_bookings SET
          student_id=?, instructor_id=?, vehicle_id=?, lesson_date=?, start_time=?, end_time=?,
          notes=?, reminder_status=${resetReminder ? 'NULL' : 'reminder_status'},
          reminder_sent_at=${resetReminder ? 'NULL' : 'reminder_sent_at'}
        WHERE id=?`,
        [student_id, instructor_id, vehicle_id || null, lesson_date, start_time, end_time, notes, id]
      );

      return { ok: true, warnings };
    });
  }));

  app.post('/api/lessons/bookings/:id/cancel', wrap(async (req, res) => {
    checkRole(req, deps);
    const id = posInt(req.params.id);
    if (!id) badRequest('شناسه نامعتبر');

    const reason = str(req.body?.reason, 255);

    const r = await db.sqlExec(
      "UPDATE crm_lesson_bookings SET status='cancelled', cancel_reason=? WHERE id=? AND status <> 'cancelled'",
      [reason, id]
    );
    if (!r.affectedRows) notFound();
    return { ok: true };
  }));

  app.post('/api/lessons/bookings/:id/status', wrap(async (req, res) => {
    checkRole(req, deps);
    const id = posInt(req.params.id);
    if (!id) badRequest('شناسه نامعتبر');

    const status = String(req.body?.status || '');
    if (!['scheduled', 'done', 'no_show'].includes(status)) badRequest('وضعیت نامعتبر');

    const log_instructor_session = bool(req.body?.log_instructor_session);

    const [booking] = await db.sql<{
      id: number;
      instructor_id: number;
      lesson_date: string;
      start_time: string;
      end_time: string;
      instructor_session_id: number | null;
      status: string;
    }>(
      'SELECT id, instructor_id, lesson_date, start_time, end_time, instructor_session_id, status FROM crm_lesson_bookings WHERE id=?',
      [id]
    );
    if (!booking) notFound();
    if (status === 'scheduled' && booking.status === 'cancelled') {
      // Restoring a cancelled lesson must not silently create a double booking.
      return withBookingLock(async () => {
        const existing = await db.sql<any>(
          `SELECT b.id, b.instructor_id, b.vehicle_id, b.student_id, b.lesson_date, b.start_time, b.end_time, b.status
           FROM crm_lesson_bookings b JOIN crm_lesson_bookings me ON me.id = ?
           WHERE b.id <> me.id AND b.lesson_date = me.lesson_date AND b.status IN (${ACTIVE_SQL})
             AND (b.instructor_id = me.instructor_id OR b.vehicle_id = me.vehicle_id OR b.student_id = me.student_id)`, [id]);
        const [me] = await db.sql<any>('SELECT id, instructor_id, vehicle_id, student_id, lesson_date, start_time, end_time FROM crm_lesson_bookings WHERE id=?', [id]);
        const conflicts = findConflicts({ ...me, status: 'scheduled' }, existing);
        if (conflicts.length) conflict('تداخل زمانی: مربی/خودرو/هنرجو در این بازه رزرو دارد', conflicts);
        await db.sqlExec("UPDATE crm_lesson_bookings SET status='scheduled', cancel_reason=NULL WHERE id=?", [id]);
        return { ok: true };
      });
    }

    if (status === 'done' && log_instructor_session && !booking.instructor_session_id) {
      const hours = durationHours(booking.start_time, booking.end_time);
      const notes = `جلسه عملی #${booking.id}`;

      const result = await db.sqlExec(
        'INSERT INTO crm_instructor_sessions (instructor_id, session_date, hours, notes) VALUES (?, ?, ?, ?)',
        [booking.instructor_id, booking.lesson_date, hours, notes]
      );

      await db.sqlExec(
        'UPDATE crm_lesson_bookings SET status=?, instructor_session_id=? WHERE id=?',
        [status, result.insertId, id]
      );

      return { ok: true, instructor_session_id: result.insertId };
    } else {
      await db.sqlExec(
        'UPDATE crm_lesson_bookings SET status=? WHERE id=?',
        [status, id]
      );
      return { ok: true };
    }
  }));

  app.get('/api/lessons/reminders/config', wrap(async (req, res) => {
    checkRole(req, deps);
    const enabled = process.env.CRM_LESSON_SMS_ENABLED === '1';
    const hours_before = Number(process.env.CRM_LESSON_SMS_HOURS_BEFORE) || 24;
    const template_key = process.env.CRM_LESSON_SMS_TEMPLATE_KEY || 'class_time';
    const template_id = process.env.CRM_LESSON_SMS_TEMPLATE_ID || '926976';
    const test_mobile = deps.normalizeMobile(process.env.CRM_LESSON_SMS_TEST_MOBILE);

    return {
      enabled,
      hours_before,
      template_key,
      template_id,
      test_mobile_masked: test_mobile ? maskPhone(test_mobile) : '',
      sms_configured: deps.sms.configured()
    };
  }));

  const runReminders = async (opts: { dryRun: boolean }) => {
    const dryRun = opts.dryRun ?? true;
    const enabled = process.env.CRM_LESSON_SMS_ENABLED === '1';

    if (!dryRun && !enabled) {
      badRequest('یادآور پیامکی غیرفعال است (CRM_LESSON_SMS_ENABLED=1 لازم است)');
    }

    const today = jalaliToday();
    const from = addJalaliDays(today, -1);
    const to = addJalaliDays(today, 3);

    const candidates = await db.sql<{
      id: number;
      student_id: number;
      first_name: string;
      last_name: string;
      phone_number: string;
      instructor_name: string;
      vehicle_name: string | null;
      lesson_date: string;
      start_time: string;
    }>(`
      SELECT
        b.id, b.student_id, s.first_name, s.last_name, s.phone_number,
        i.name AS instructor_name, v.name AS vehicle_name,
        b.lesson_date, b.start_time
      FROM crm_lesson_bookings b
      JOIN students s ON s.student_id = b.student_id
      JOIN crm_instructors i ON i.id = b.instructor_id
      LEFT JOIN crm_vehicles v ON v.id = b.vehicle_id
      WHERE b.status = 'scheduled'
        AND b.reminder_sent_at IS NULL
        AND b.lesson_date BETWEEN ? AND ?
    `, [from, to]);

    const hoursBefore = Number(process.env.CRM_LESSON_SMS_HOURS_BEFORE) || 24;
    const templateKey = process.env.CRM_LESSON_SMS_TEMPLATE_KEY || 'class_time';
    const templateId = process.env.CRM_LESSON_SMS_TEMPLATE_ID || '926976';
    const params = process.env.CRM_LESSON_SMS_PARAMS || 'NAME,DATE,TIME';
    const testMobile = deps.normalizeMobile(process.env.CRM_LESSON_SMS_TEST_MOBILE);

    const now = new Date();
    const windowStart = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

    const filtered = candidates.filter(c => {
      const startUtc = lessonStartUtc(c.lesson_date, c.start_time);
      return startUtc && startUtc > now && startUtc <= windowStart;
    });

    const sent: number[] = [];
    const failed: number[] = [];
    const skipped: number[] = [];

    if (!dryRun && enabled) {
      for (const c of filtered) {
        const mobile = testMobile || deps.normalizeMobile(c.phone_number);
        if (!mobile) {
          await db.sqlExec(
            "UPDATE crm_lesson_bookings SET reminder_status='no_mobile', reminder_sent_at=NOW() WHERE id=?",
            [c.id]
          );
          skipped.push(c.id);
          continue;
        }

        try {
          const fullName = `${c.first_name} ${c.last_name}`;
          const result = await deps.sms.sendTemplate(templateKey, mobile, {
            name: c.first_name,
            family: c.last_name,
            date: c.lesson_date,
            time: c.start_time,
            instructor: c.instructor_name,
            vehicle: c.vehicle_name || '',
            NAME: fullName,
            DATE: c.lesson_date,
            TIME: c.start_time
          }, {
            templateId,
            param: params
          });

          if (result.ok) {
            await db.sqlExec(
              "UPDATE crm_lesson_bookings SET reminder_status='sent', reminder_sent_at=NOW() WHERE id=?",
              [c.id]
            );
            sent.push(c.id);
            deps.log(`Sent reminder to ${maskPhone(mobile)} for booking ${c.id}`);
          } else {
            await db.sqlExec(
              "UPDATE crm_lesson_bookings SET reminder_status='failed', reminder_sent_at=NOW() WHERE id=?",
              [c.id]
            );
            failed.push(c.id);
            deps.log(`Failed to send reminder to ${maskPhone(mobile)} for booking ${c.id}: ${result.status}`);
          }
        } catch (err) {
          await db.sqlExec(
            "UPDATE crm_lesson_bookings SET reminder_status='failed', reminder_sent_at=NOW() WHERE id=?",
            [c.id]
          );
          failed.push(c.id);
          deps.log(`Error sending reminder to ${maskPhone(mobile)} for booking ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return {
      dry_run: dryRun || !enabled,
      candidates: filtered.map(c => ({
        booking_id: c.id,
        student_name: `${c.first_name} ${c.last_name}`,
        phone_masked: maskPhone(testMobile || c.phone_number || ''),
        lesson_date: c.lesson_date,
        start_time: c.start_time
      })),
      sent: sent.length,
      failed: failed.length,
      skipped: skipped.length
    };
  };

  app.post('/api/lessons/reminders/run', wrap(async (req) => {
    if (deps.role(req) !== 'admin') { const e: any = new Error('فقط مدیر'); e.status = 403; throw e; }
    const dryRun = req.body?.dry_run === undefined ? true : bool(req.body.dry_run);
    return runReminders({ dryRun });
  }));

  return { runReminders };
}

export function startLessonReminderJob(runner: { runReminders: (o: { dryRun: boolean }) => Promise<any> }, log: (m: string) => void) {
  if (process.env.CRM_LESSON_SMS_ENABLED !== '1') {
    log('Lesson reminder job disabled (CRM_LESSON_SMS_ENABLED not set to 1)');
    return;
  }

  const interval = 10 * 60 * 1000; // 10 minutes
  const firstRunDelay = 60 * 1000; // 60 seconds

  setTimeout(async () => {
    try {
      await runner.runReminders({ dryRun: false });
    } catch (err) {
      log(`Error in lesson reminder job: ${err instanceof Error ? err.message : String(err)}`);
    }

    const intervalId = setInterval(async () => {
      try {
        await runner.runReminders({ dryRun: false });
      } catch (err) {
        log(`Error in lesson reminder job: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, interval);

    intervalId.unref();
  }, firstRunDelay);
}
