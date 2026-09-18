-- Migration: receipt PDF metadata on enrollments
-- CRM hybrid offline-first — see docs/pdf_receipt_architecture.md
-- Target: MySQL 8+ / schema_mysql.sql

ALTER TABLE enrollments
  ADD COLUMN receipt_pdf_path     VARCHAR(512)  NULL
    COMMENT 'Relative path under STORAGE_PATH, e.g. 118/receipts/enrollment_42_receipt.pdf'
    AFTER amount_paid,
  ADD COLUMN receipt_generated_at DATETIME      NULL
    COMMENT 'Last successful receipt PDF write time'
    AFTER receipt_pdf_path,
  ADD COLUMN receipt_sha256       CHAR(64)      NULL
    COMMENT 'SHA-256 hex of receipt file for integrity'
    AFTER receipt_generated_at,
  ADD COLUMN receipt_template     VARCHAR(64)   NULL
    COMMENT 'Template id/version used to generate PDF'
    AFTER receipt_sha256,
  ADD COLUMN receipt_payment_id   INT           NULL
    COMMENT 'Optional payments.payment_id this receipt is based on'
    AFTER receipt_template;

CREATE INDEX idx_enrollments_receipt_path
  ON enrollments (receipt_pdf_path(191));

CREATE INDEX idx_enrollments_receipt_payment
  ON enrollments (receipt_payment_id);

-- Optional hard FK (uncomment if desired):
-- ALTER TABLE enrollments
--   ADD CONSTRAINT fk_enrollments_receipt_payment
--     FOREIGN KEY (receipt_payment_id) REFERENCES payments (payment_id)
--     ON UPDATE CASCADE ON DELETE SET NULL;
