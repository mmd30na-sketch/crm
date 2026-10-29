-- Rule-based automation («اتوماسیون قاعده‌محور»): rules + run log. Additive only; safe to re-run.
-- The server also creates these tables at startup (automation.ts ensureAutomationSchema).
CREATE TABLE IF NOT EXISTS crm_automation_rules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL,
  event VARCHAR(40) NOT NULL,
  conditions JSON NULL,
  actions JSON NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  dry_run TINYINT(1) NOT NULL DEFAULT 1,
  test_mobile VARCHAR(20) NULL,
  max_per_hour INT NOT NULL DEFAULT 30,
  params JSON NULL,
  created_by VARCHAR(80) NULL,
  updated_by VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_rule_event (event, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: automation rules / قواعد اتوماسیون';

CREATE TABLE IF NOT EXISTS crm_automation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_id INT UNSIGNED NOT NULL,
  event VARCHAR(40) NOT NULL,
  dedupe_key VARCHAR(140) NOT NULL,
  mode ENUM('dry','live') NOT NULL,
  status ENUM('running','done','partial','failed','skipped','rate_limited','dry_run') NOT NULL,
  student_id INT NULL,
  target_masked VARCHAR(80) NULL,
  summary VARCHAR(500) NULL,
  actions_result JSON NULL,
  triggered_by VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  UNIQUE KEY uq_rule_dedupe (rule_id, dedupe_key, mode),
  KEY idx_run_rule (rule_id, created_at),
  KEY idx_run_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: automation run log / سوابق اجرای اتوماسیون';
