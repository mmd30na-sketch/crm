-- Migration: public REST API v1 keys + outbound webhooks
-- Additive only: three new tables; no existing table/column is dropped, altered or renamed. The server also
-- creates these at boot (CREATE TABLE IF NOT EXISTS in publicApi.ts / webhooks.ts), so applying this file is
-- optional but safe and idempotent.
-- Target: MySQL 8+ / schema_mysql.sql
--
-- crm_api_keys              only sha256(key) is stored; the full key is shown once to the admin
-- crm_webhook_subscriptions target URL, events (comma list or *), HMAC-SHA256 signing secret
-- crm_webhook_deliveries    one row per event x subscription; retried 1m/5m/30m/2h/6h, 6 attempts max

CREATE TABLE IF NOT EXISTS crm_api_keys (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(120) NOT NULL,
  prefix             CHAR(12)     NOT NULL COMMENT 'first 12 chars of the key, shown in the admin list',
  key_hash           CHAR(64)     NOT NULL COMMENT 'sha256 hex of the full key; the key itself is never stored',
  scopes             VARCHAR(255) NOT NULL DEFAULT 'read',
  rate_limit_per_min INT          NOT NULL DEFAULT 60,
  created_by         VARCHAR(80)  NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at       DATETIME     NULL,
  revoked_at         DATETIME     NULL,
  UNIQUE KEY uq_api_key_prefix (prefix),
  UNIQUE KEY uq_api_key_hash (key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: public API keys / کلیدهای API';

CREATE TABLE IF NOT EXISTS crm_webhook_subscriptions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  url         VARCHAR(500) NOT NULL,
  events      VARCHAR(500) NOT NULL COMMENT 'comma list or *',
  secret      VARCHAR(80)  NOT NULL COMMENT 'HMAC signing secret (shown once to the admin)',
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  description VARCHAR(255) NULL,
  created_by  VARCHAR(80)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_webhook_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: outbound webhook subscriptions / وب‌هوک‌ها';

CREATE TABLE IF NOT EXISTS crm_webhook_deliveries (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subscription_id  INT UNSIGNED    NOT NULL,
  event            VARCHAR(60)     NOT NULL,
  event_id         CHAR(36)        NOT NULL,
  payload          MEDIUMTEXT      NOT NULL,
  status           ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  attempts         INT             NOT NULL DEFAULT 0,
  next_attempt_at  DATETIME        NULL,
  last_status_code INT             NULL,
  last_error       VARCHAR(500)    NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at     DATETIME        NULL,
  KEY idx_delivery_due (status, next_attempt_at),
  KEY idx_delivery_sub (subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM: webhook delivery log / گزارش ارسال وب‌هوک';
