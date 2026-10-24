-- Migration: remaining-debt SMS + full-balance payment links
-- Additive only: two new tables; no existing table/column is dropped, altered or renamed. The server also
-- creates these at boot (CREATE TABLE IF NOT EXISTS in debtSms.ts), so applying this file is optional but
-- safe. Directus reads the same shared MySQL DB.
-- Target: MySQL 8+ / schema_mysql.sql
--
-- crm_debt_links     short base62 code -> student + the full remaining balance at send time, single use
-- crm_debt_sms_log   append-only log; UNIQUE(student_id, send_day) plus the 'sending' reservation row
--                    (inserted before the SMS, updated to sent/failed after) prevents a second SMS to the
--                    same trainee on the same Jalali day. Only the masked phone is stored.
--
-- The legacy crm_installments / crm_installment_links / crm_installment_reminders tables are left untouched.

CREATE TABLE IF NOT EXISTS crm_debt_links (
  code              CHAR(12)     NOT NULL PRIMARY KEY COMMENT 'random base62',
  student_id        INT          NOT NULL,
  amount            BIGINT       NOT NULL COMMENT 'Toman: the full remaining balance when the SMS was sent',
  expires_at        DATETIME     NULL,
  used_at           DATETIME     NULL,
  online_payment_id INT UNSIGNED NULL COMMENT 'crm_online_payments.id started from this link',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_debt_link_student (student_id),
  KEY idx_debt_link_payment (online_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: remaining-debt payment links / لینک پرداخت مانده بدهی';

CREATE TABLE IF NOT EXISTS crm_debt_sms_log (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id          INT          NOT NULL,
  send_day            CHAR(10)     NOT NULL COMMENT 'Jalali yyyy/mm/dd the SMS is sent on',
  mobile_masked       VARCHAR(20)  NULL COMMENT 'never the full phone number',
  amount              BIGINT       NOT NULL COMMENT 'Remaining balance at send time',
  link_code           CHAR(12)     NULL,
  status              ENUM('sending','sent','failed','skipped_test_mode') NOT NULL,
  provider_message_id VARCHAR(64)  NULL,
  error               VARCHAR(255) NULL,
  created_by          VARCHAR(80)  NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_debt_sms_day (student_id, send_day),
  KEY idx_debt_sms_day (send_day, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: remaining-debt SMS log / پیامک مانده بدهی';
