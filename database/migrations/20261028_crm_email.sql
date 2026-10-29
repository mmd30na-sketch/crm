-- Migration: transactional + campaign email / ایمیل تراکنشی و کمپین
-- Additive only: five new tables; no existing table or column is touched. The server also creates these at boot
-- (CREATE TABLE IF NOT EXISTS in emailService.ts), so applying this file is optional but safe.
-- Target: MySQL 8+ / schema_mysql.sql
--
-- crm_email_contacts      student_id -> email (students has no email column)
-- crm_email_unsubscribes  sha256(lower(email)) of people who used the campaign unsubscribe link
-- crm_email_templates     admin overrides of the built-in Persian templates
-- crm_email_campaigns     campaign drafts / runs with counters
-- crm_email_log           one row per attempt (sent, failed, dry_run, skipped_*, rate_limited); masked address only

CREATE TABLE IF NOT EXISTS crm_email_contacts (
  student_id INT NOT NULL PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  updated_by VARCHAR(80) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_email_contacts_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: student email addresses / ایمیل کارآموزان';

CREATE TABLE IF NOT EXISTS crm_email_unsubscribes (
  email_hash CHAR(64) NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: campaign unsubscribes (sha256 of lower-cased email)';

CREATE TABLE IF NOT EXISTS crm_email_templates (
  template_key VARCHAR(40) NOT NULL PRIMARY KEY,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  updated_by VARCHAR(80) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: email template overrides';

CREATE TABLE IF NOT EXISTS crm_email_campaigns (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  filters JSON NULL,
  status ENUM('draft','sending','done','cancelled') NOT NULL DEFAULT 'draft',
  dry_run TINYINT(1) NOT NULL DEFAULT 1,
  total INT NOT NULL DEFAULT 0,
  sent INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  created_by VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  finished_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: email campaigns';

CREATE TABLE IF NOT EXISTS crm_email_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('transactional','campaign') NOT NULL,
  template_key VARCHAR(40) NULL,
  campaign_id INT UNSIGNED NULL,
  student_id INT NULL,
  to_masked VARCHAR(120) NULL,
  subject VARCHAR(200) NULL,
  status ENUM('sent','failed','dry_run','skipped_unsubscribed','skipped_no_email','skipped_disabled','rate_limited') NOT NULL,
  test_override TINYINT(1) NOT NULL DEFAULT 0,
  error VARCHAR(255) NULL,
  created_by VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_email_log_created (created_at),
  KEY idx_email_log_campaign (campaign_id),
  KEY idx_email_log_student (student_id),
  KEY idx_email_log_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: email send log (masked addresses only)';

