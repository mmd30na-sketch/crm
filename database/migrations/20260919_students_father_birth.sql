-- Persist OCR/form fields that the UI already collects.
-- Runtime init also attempts these ALTERs if the columns are missing.

ALTER TABLE students
  ADD COLUMN father_name VARCHAR(100) NULL COMMENT 'Father name from national card / registration form'
    AFTER last_name;

ALTER TABLE students
  ADD COLUMN birth_date_jalali VARCHAR(20) NULL COMMENT 'Jalali birth date YYYY/MM/DD'
    AFTER phone_number;
