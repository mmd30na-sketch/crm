-- Invoices (فاکتور رسمی) + refunds ledger. Additive only; the server also creates these at boot (ensureInvoicesSchema / ensureFinanceSchema).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS crm_invoice_counters (
  year CHAR(4) NOT NULL PRIMARY KEY COMMENT 'Jalali year',
  last_seq INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: invoice number sequence per Jalali year';

CREATE TABLE IF NOT EXISTS crm_invoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(32) NOT NULL,
  serial_year CHAR(4) NOT NULL,
  serial_seq INT UNSIGNED NOT NULL,
  issue_date_jalali CHAR(10) NOT NULL,
  student_id INT NOT NULL,
  enrollment_id INT NULL,
  seller_json JSON NOT NULL COMMENT 'seller snapshot at issue time',
  buyer_json JSON NOT NULL COMMENT 'buyer snapshot at issue time',
  subtotal BIGINT NOT NULL DEFAULT 0 COMMENT 'Toman',
  discount_total BIGINT NOT NULL DEFAULT 0,
  tax_total BIGINT NOT NULL DEFAULT 0,
  grand_total BIGINT NOT NULL DEFAULT 0,
  status ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
  notes TEXT NULL,
  created_by VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  cancelled_by VARCHAR(80) NULL,
  cancel_reason VARCHAR(300) NULL,
  UNIQUE KEY uq_invoice_no (invoice_no),
  UNIQUE KEY uq_invoice_serial (serial_year, serial_seq),
  KEY idx_invoice_date (issue_date_jalali),
  KEY idx_invoice_student (student_id),
  KEY idx_invoice_enrollment (enrollment_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: official invoices / فاکتور رسمی';

CREATE TABLE IF NOT EXISTS crm_invoice_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  line_no INT NOT NULL,
  description VARCHAR(300) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price BIGINT NOT NULL,
  discount BIGINT NOT NULL DEFAULT 0,
  net BIGINT NOT NULL,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_amount BIGINT NOT NULL DEFAULT 0,
  total BIGINT NOT NULL,
  KEY idx_item_invoice (invoice_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES crm_invoices (id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: invoice lines / ردیف‌های فاکتور';

CREATE TABLE IF NOT EXISTS crm_refunds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  enrollment_id INT NULL,
  amount BIGINT NOT NULL COMMENT 'Toman',
  refund_date_jalali CHAR(10) NOT NULL,
  method VARCHAR(30) NOT NULL DEFAULT 'cash',
  reason VARCHAR(300) NOT NULL,
  status ENUM('active','void') NOT NULL DEFAULT 'active',
  created_by VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by VARCHAR(80) NULL,
  voided_at DATETIME NULL,
  KEY idx_refund_date (refund_date_jalali),
  KEY idx_refund_student (student_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: refunds / بازپرداخت به کارآموز';
