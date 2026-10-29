-- Migration: visual lead pipeline (Kanban) / پایپ‌لاین سرنخ‌ها
-- Additive only: two new tables and three NULLable columns on `leads`; nothing is dropped, renamed or narrowed.
-- The server also applies this at boot (ensureLeadPipelineSchema in leadPipeline.ts), so running this file is
-- optional but safe. The legacy leads.status column keeps working: stages with a status_key update it on move.
-- Target: MySQL 8+ / schema_mysql.sql
--
-- crm_lead_stages         configurable stages (title, color, order, won/lost flags, optional legacy status mapping)
-- crm_lead_stage_history  append-only log of stage moves (used by the funnel "reached" counts and days-to-win)
-- leads.pipeline_stage_id / owner_username / stage_changed_at  (NULL until used; backfilled from status below)

CREATE TABLE IF NOT EXISTS crm_lead_stages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT 'slate',
  position INT NOT NULL DEFAULT 0,
  status_key VARCHAR(20) NULL COMMENT 'legacy leads.status this stage maps to',
  is_won TINYINT(1) NOT NULL DEFAULT 0,
  is_lost TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_stage_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: lead pipeline stages / مراحل پایپ‌لاین';

CREATE TABLE IF NOT EXISTS crm_lead_stage_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  from_stage_id INT UNSIGNED NULL,
  to_stage_id INT UNSIGNED NOT NULL,
  changed_by VARCHAR(80) NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hist_lead (lead_id, changed_at),
  KEY idx_hist_stage (to_stage_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: lead stage moves / تاریخچه مراحل سرنخ';

INSERT INTO crm_lead_stages (title, color, position, status_key, is_won, is_lost)
SELECT * FROM (SELECT 'جدید' AS t, 'sky' AS c, 10 AS p, 'new' AS k, 0 AS w, 0 AS l UNION ALL
  SELECT 'تماس گرفته شد', 'amber', 20, 'contacted', 0, 0 UNION ALL
  SELECT 'در حال مذاکره', 'indigo', 30, 'in_negotiation', 0, 0 UNION ALL
  SELECT 'ثبت‌نام شد', 'emerald', 40, 'converted', 1, 0 UNION ALL
  SELECT 'از دست رفت', 'rose', 50, 'lost', 0, 1) seed
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_stages);

-- MySQL 8 has no ADD COLUMN IF NOT EXISTS; skip any statement that reports "Duplicate column name".
ALTER TABLE leads ADD COLUMN pipeline_stage_id INT UNSIGNED NULL;
ALTER TABLE leads ADD COLUMN owner_username VARCHAR(80) NULL;
ALTER TABLE leads ADD COLUMN stage_changed_at DATETIME NULL;

UPDATE leads l JOIN (SELECT status_key, MIN(id) AS id FROM crm_lead_stages WHERE status_key IS NOT NULL GROUP BY status_key) s
  ON s.status_key = l.status SET l.pipeline_stage_id = s.id WHERE l.pipeline_stage_id IS NULL;
