-- Instructor pay (حق‌التدریس): instructors, rates, sessions and monthly settlements.
-- Additive only (Directus reads the same DB): four new crm_instructor_* tables; existing tables are only read.
-- Runtime init also creates these tables when they are missing (instructorPay.ts ensureInstructorPaySchema),
-- so this file is the manual/DBA copy of the same schema.

CREATE TABLE IF NOT EXISTS crm_instructors (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inst_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructors / اساتید حق‌التدریس';

CREATE TABLE IF NOT EXISTS crm_instructor_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT UNSIGNED NOT NULL,
  course_term_id INT UNSIGNED NULL,
  rate_type ENUM('per_term','per_session') NOT NULL DEFAULT 'per_session',
  amount INT NOT NULL COMMENT 'Toman',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rates_instructor (instructor_id),
  KEY idx_rates_term (course_term_id),
  CONSTRAINT fk_inst_rates_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_inst_rates_term FOREIGN KEY (course_term_id) REFERENCES crm_course_terms (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructor pay rates / نرخ حق‌التدریس';

CREATE TABLE IF NOT EXISTS crm_instructor_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT UNSIGNED NOT NULL,
  course_term_id INT UNSIGNED NULL,
  session_date VARCHAR(10) NOT NULL COMMENT 'Jalali yyyy/mm/dd',
  hours DECIMAL(5,1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_instructor_date (instructor_id, session_date),
  KEY idx_sessions_term (course_term_id),
  CONSTRAINT fk_inst_sessions_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_inst_sessions_term FOREIGN KEY (course_term_id) REFERENCES crm_course_terms (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructor sessions / جلسات تدریس';

CREATE TABLE IF NOT EXISTS crm_instructor_settlements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT UNSIGNED NOT NULL,
  year_month CHAR(7) NOT NULL COMMENT 'Jalali yyyy-mm',
  total INT NOT NULL DEFAULT 0 COMMENT 'Toman',
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT NULL,
  UNIQUE KEY uq_settlement (instructor_id, year_month),
  CONSTRAINT fk_inst_settlements_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: monthly instructor settlements / تسویه ماهانه';
