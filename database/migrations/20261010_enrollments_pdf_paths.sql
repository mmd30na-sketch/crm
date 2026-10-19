-- Registration documents: one PDF each for the receipt (existing receipt_pdf_path), the file summary (IDCard) and the contract.
-- Files live under StudentFiles/<course number>/<LastName>_<studentId>/<LastName>_<studentId>_<Receipt|IDCard|Contract>.pdf
-- Runtime init (mysql-socks.ts ensureEnrollmentPdfColumns) also adds these columns when they are missing.

ALTER TABLE enrollments
  ADD COLUMN idcard_pdf_path   VARCHAR(512) NULL COMMENT 'File summary (IDCard) PDF, /StudentFiles/...',
  ADD COLUMN contract_pdf_path VARCHAR(512) NULL COMMENT 'Contract PDF, /StudentFiles/...';
