-- Migration: trainee online installment payments (Zarinpal + receipt upload)
-- Additive only: a new crm_online_payments table; existing tables/columns are never changed.
-- Directus reads the same shared MySQL DB. The server also creates this table at boot
-- (CREATE TABLE IF NOT EXISTS in onlinePayments.ts), so applying this file is optional but safe.
-- Target: MySQL 8+ / schema_mysql.sql
--
-- method: zarinpal (gateway) | receipt (uploaded image/PDF reviewed by a cashier)
-- status: pending  -> awaiting review or gateway redirect
--         paid     -> a Zarinpal authority was verified successfully (still needs admin approval)
--         approved -> a real row was inserted into `payments` (same path as POST /api/payments)
--         rejected -> declined by a cashier, with admin_note

CREATE TABLE IF NOT EXISTS crm_online_payments (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id    INT          NOT NULL,
  enrollment_id INT          NOT NULL,
  amount        BIGINT       NOT NULL COMMENT 'Toman, same unit as payments.amount',
  method        ENUM('zarinpal','receipt') NOT NULL,
  authority     VARCHAR(64)  NULL COMMENT 'Zarinpal Authority while pending/paid',
  ref_id        VARCHAR(64)  NULL COMMENT 'Zarinpal ref_id after verify',
  receipt_file  VARCHAR(512) NULL COMMENT 'Relative path under uploads/receipts',
  status        ENUM('pending','paid','approved','rejected') NOT NULL DEFAULT 'pending',
  admin_note    TEXT         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by   VARCHAR(80)  NULL,
  reviewed_at   DATETIME     NULL,
  KEY idx_online_status (status, created_at),
  KEY idx_online_student (student_id),
  KEY idx_online_enrollment (enrollment_id),
  KEY idx_online_authority (authority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: trainee online installments / پرداخت آنلاین اقساط کارآموز';
