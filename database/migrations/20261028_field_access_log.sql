-- Sensitive field access audit (fieldPolicy.ts). Additive; also created at boot by ensureFieldPolicySchema(). Safe to re-run.

CREATE TABLE IF NOT EXISTS crm_field_access_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NULL,
  role VARCHAR(20) NULL,
  method VARCHAR(8) NOT NULL,
  path VARCHAR(200) NOT NULL,
  fields VARCHAR(300) NOT NULL COMMENT 'comma separated field groups (never values)',
  records INT NOT NULL DEFAULT 0,
  action ENUM('view','blocked_edit','file') NOT NULL DEFAULT 'view',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fal_created (created_at),
  KEY idx_fal_user (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: sensitive field access audit';
