-- One-time trainee portal entry links. Additive: new table only.
-- The server also creates this at boot (CREATE TABLE IF NOT EXISTS in traineePortal.ts).
-- A code is single use. Redeeming it issues the same 30-day trainee session the OTP login stores on the device.

CREATE TABLE IF NOT EXISTS crm_portal_entries (
  code        CHAR(12) NOT NULL PRIMARY KEY COMMENT 'random base62',
  student_id  INT      NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_portal_entry_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: one-time trainee portal entry';
