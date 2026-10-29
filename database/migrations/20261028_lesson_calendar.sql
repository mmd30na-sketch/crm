-- Practical-lesson calendar (تقویم جلسات عملی): vehicles, instructor weekly availability, lesson bookings.
-- Additive only: three new tables; existing tables (crm_instructors, crm_instructor_sessions, students) are only read
-- or receive normal inserts (a lesson marked "done" can log one crm_instructor_sessions row).
-- Requires 20261017_instructor_pay.sql (crm_instructors). Runtime init creates the same tables when missing
-- (lessonCalendar.ts ensureLessonCalendarSchema), so this file is the manual/DBA copy of the same schema.

CREATE TABLE IF NOT EXISTS crm_vehicles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  plate VARCHAR(40) NULL,
  kind ENUM('car','motorcycle','other') NOT NULL DEFAULT 'car',
  gearbox ENUM('manual','automatic') NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_vehicles_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: training vehicles / خودروهای آموزشی';

CREATE TABLE IF NOT EXISTS crm_instructor_availability (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT UNSIGNED NOT NULL,
  weekday TINYINT NOT NULL COMMENT '0 = Saturday ... 6 = Friday',
  start_time CHAR(5) NOT NULL COMMENT 'HH:MM',
  end_time CHAR(5) NOT NULL COMMENT 'HH:MM',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_avail_instructor_day (instructor_id, weekday),
  CONSTRAINT fk_avail_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructor weekly availability / ساعات حضور مربی';

CREATE TABLE IF NOT EXISTS crm_lesson_bookings (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: practical lesson bookings / رزرو جلسات عملی';
