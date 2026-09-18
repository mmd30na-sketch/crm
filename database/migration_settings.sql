-- =============================================================================
-- Migration: Settings Module
-- Adds: academy_settings table, capacity & duration_days columns on courses
-- Run: Once on the carla_crm database
-- =============================================================================

SET NAMES utf8mb4;

-- 1. Academy Settings key-value store
CREATE TABLE IF NOT EXISTS academy_settings (
    `key`       VARCHAR(100)  NOT NULL,
    `value`     TEXT          NOT NULL DEFAULT '',
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Global CRM settings stored as key-value pairs';

-- 2. Seed default values (will not overwrite existing keys)
INSERT IGNORE INTO academy_settings (`key`, `value`) VALUES
  ('academy_name',      'آموزشگاه فنی'),
  ('address',           ''),
  ('phone',             ''),
  ('manager_name',      ''),
  ('license_number',    ''),
  ('logo_url',          ''),
  ('default_course_fee','1200000'),
  ('currency_unit',     'تومان'),
  ('payment_methods',   'نقدی,کارتخوان,کارت به کارت,چک'),
  ('ocr_engine',        'mock');

-- 3. Add new columns to courses (if not already exist)
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS capacity      INT NULL     COMMENT 'Max students per course run',
  ADD COLUMN IF NOT EXISTS duration_days INT NULL     COMMENT 'Duration in days';
