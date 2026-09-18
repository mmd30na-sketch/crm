-- Migration: app_settings key-value store + receipt print defaults
-- See docs/receipt_print_settings.md
-- MySQL 8+

CREATE TABLE IF NOT EXISTS app_settings (
    setting_id      INT            NOT NULL AUTO_INCREMENT,
    setting_key     VARCHAR(128)   NOT NULL
        COMMENT 'Dot-path key, e.g. receipt.paper_size',
    setting_value   JSON           NOT NULL
        COMMENT 'JSON value: string/number/bool/object',
    value_type      VARCHAR(32)    NOT NULL DEFAULT 'string'
        COMMENT 'string|number|boolean|json — hint for UI',
    label_fa        VARCHAR(255)   NULL
        COMMENT 'Human label for settings form',
    description_fa  VARCHAR(512)   NULL,
    is_public       TINYINT(1)     NOT NULL DEFAULT 0
        COMMENT '1 = readable by frontend without admin role',
    updated_by      INT            NULL
        COMMENT 'Optional staff user id',
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_id),
    UNIQUE KEY uq_app_settings_key (setting_key),
    KEY idx_app_settings_public (is_public)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Global/app configuration key-value store';

INSERT INTO app_settings (setting_key, setting_value, value_type, label_fa, description_fa, is_public) VALUES
(
  'receipt.paper_size',
  '"a5"',
  'string',
  'اندازه کاغذ رسید',
  'a4 | a5 | thermal_80',
  1
),
(
  'receipt.copies',
  '1',
  'number',
  'تعداد کپی چاپ',
  'Integer 1..5 — repeated pages in one print job',
  1
),
(
  'receipt.footer_text',
  '"این رسید صرفاً اعلام دریافت وجه است و به‌منزله گواهی پایان دوره نمی‌باشد."',
  'string',
  'متن پاورقی رسید',
  'Disclaimer shown at bottom of each receipt copy',
  1
),
(
  'receipt.header_title',
  '"آموزشگاه"',
  'string',
  'عنوان سربرگ',
  NULL,
  1
),
(
  'receipt.header_phone',
  '""',
  'string',
  'تلفن سربرگ',
  NULL,
  1
),
(
  'receipt.header_logo_path',
  'null',
  'json',
  'مسیر لوگو',
  'Relative path under storage or null',
  1
),
(
  'receipt.show_national_code',
  'true',
  'boolean',
  'نمایش کدملی روی رسید',
  NULL,
  1
),
(
  'receipt.show_balance',
  'true',
  'boolean',
  'نمایش مانده روی رسید',
  NULL,
  1
),
(
  'receipt.font_scale',
  '1',
  'number',
  'مقیاس فونت',
  '0.8 .. 1.4',
  1
),
(
  'receipt.margin_mm',
  '8',
  'number',
  'حاشیه میلی‌متر (A4/A5)',
  'Ignored or reduced for thermal_80',
  1
)
ON DUPLICATE KEY UPDATE
  label_fa = VALUES(label_fa),
  description_fa = VALUES(description_fa),
  is_public = VALUES(is_public);
