-- Migration: installment schedule + per-installment payment links + reminder log
-- Additive only: three new tables; no existing table/column is dropped or renamed. The server also
-- creates these at boot (CREATE TABLE IF NOT EXISTS in installments.ts / reminders.ts), so applying this
-- file is optional but safe. Directus reads the same shared MySQL DB.
-- Target: MySQL 8+ / schema_mysql.sql
--
-- crm_installments          one planned payment per row; amount is Toman (same unit as payments.amount)
-- crm_installment_links     short base62 code -> installment + amount, single use, optional expiry
-- crm_installment_reminders append-only log; UNIQUE(installment_id, send_day) plus the 'sending' reservation
-- row (inserted before the SMS, updated to sent/failed after) prevents a double send on the same day
--
-- crm_online_payments (created 20261017) gains one NULLable column `installment_id` so a gateway payment
-- started from a link settles exactly that installment. crm_online_payments is new in this branch, so the
-- ALTER is safe; it is written idempotently below.

CREATE TABLE IF NOT EXISTS crm_installments (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id       INT          NOT NULL,
  enrollment_id    INT          NOT NULL,
  seq              INT          NOT NULL DEFAULT 1,
  amount           BIGINT       NOT NULL COMMENT 'Toman, same unit as payments.amount',
  due_date_jalali  CHAR(10)     NOT NULL COMMENT 'Jalali yyyy/mm/dd',
  status           ENUM('unpaid','paid','cancelled') NOT NULL DEFAULT 'unpaid',
  paid_at          DATETIME     NULL,
  online_payment_id INT UNSIGNED NULL COMMENT 'crm_online_payments.id that settled this installment',
  created_by       VARCHAR(80)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes            TEXT         NULL,
  KEY idx_inst_enrollment (enrollment_id, status),
  KEY idx_inst_due (status, due_date_jalali),
  KEY idx_inst_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: enrollment installment schedule / اقساط ثبت‌نام';

CREATE TABLE IF NOT EXISTS crm_installment_links (
  code            CHAR(12)     NOT NULL PRIMARY KEY COMMENT 'random base62',
  installment_id  INT UNSIGNED NOT NULL,
  amount          BIGINT       NOT NULL COMMENT 'Toman, copied from the installment',
  expires_at      DATETIME     NULL,
  used_at         DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_link_installment (installment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: per-installment payment links / لینک پرداخت قسط';

CREATE TABLE IF NOT EXISTS crm_installment_reminders (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  installment_id      INT UNSIGNED NOT NULL,
  send_day            CHAR(10)     NOT NULL COMMENT 'Jalali yyyy/mm/dd the reminder is sent on',
  mobile_masked       VARCHAR(20)  NULL COMMENT 'never the full phone number',
  status              ENUM('sending','sent','failed','skipped_test_mode','skipped_disabled','dry_run') NOT NULL,
  provider_message_id VARCHAR(64)  NULL,
  error               VARCHAR(255) NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reminder_day (installment_id, send_day),
  KEY idx_reminder_day (send_day, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: installment reminder log / یادآوری اقساط';


-- Idempotent additive column on the (new-in-branch) crm_online_payments.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_online_payments' AND COLUMN_NAME = 'installment_id');
SET @ddl := IF(@col = 0,
  'ALTER TABLE crm_online_payments ADD COLUMN installment_id INT UNSIGNED NULL AFTER enrollment_id',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
