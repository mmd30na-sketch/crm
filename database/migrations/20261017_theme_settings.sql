-- Migration: theme settings («تم») — app_settings key 'theme.config' + public logo read
-- Additive only: app_settings is the existing key-value store (20260720_app_settings.sql);
-- no existing table or column is created, dropped, renamed or modified. The JSON fallback
-- lives in db_store.json under settings.theme (written by the server, same shape).
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
  'theme.config',
  '{"mode":"system","primary":"#0ea5e9","font":"vazirmatn","logo_url":null}',
  'json',
  'تنظیمات تم ظاهری',
  'حالت روشن/تاریک/سیستمی، رنگ اصلی، فونت و لوگو (لوگو در صفحه ورود عمومی نمایش داده می‌شود)',
  1
)
ON DUPLICATE KEY UPDATE
  label_fa = VALUES(label_fa),
  description_fa = VALUES(description_fa),
  is_public = VALUES(is_public);
