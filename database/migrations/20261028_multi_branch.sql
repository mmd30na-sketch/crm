-- Multi-branch (چندشعبه) — additive and idempotent. Only needed when CRM_MULTI_BRANCH=1; the server runs the same
-- steps itself at start-up (branches.ts ensureBranchSchema), so running this file by hand is optional.
-- Nothing is dropped or renamed. Every existing row is assigned to the default branch.
-- Rollback: unset CRM_MULTI_BRANCH (the columns/tables are then simply ignored).

CREATE TABLE IF NOT EXISTS crm_branches (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  academy_name VARCHAR(160) NULL,
  address VARCHAR(400) NULL,
  phone VARCHAR(40) NULL,
  sms_sender_line VARCHAR(30) NULL,
  manager_name VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_branch_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_user_branches (
  username VARCHAR(80) NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (username, branch_id),
  KEY idx_ub_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_branches (code, name, is_default, is_active)
SELECT 'main', 'شعبه مرکزی', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM crm_branches WHERE is_default = 1);

-- branch_id + index on each scoped table that exists (crm_vehicles / crm_lesson_bookings only after the
-- lesson-calendar migration), then backfill NULLs to the default branch.
DROP PROCEDURE IF EXISTS crm_add_branch_id;
DELIMITER //
CREATE PROCEDURE crm_add_branch_id(IN t VARCHAR(64))
BEGIN
  DECLARE def INT UNSIGNED;
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t) THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t AND COLUMN_NAME = 'branch_id') THEN
      SET @s = CONCAT('ALTER TABLE `', t, '` ADD COLUMN branch_id INT UNSIGNED NULL');
      PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t AND INDEX_NAME = 'idx_branch_id') THEN
      SET @s = CONCAT('ALTER TABLE `', t, '` ADD INDEX idx_branch_id (branch_id)');
      PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
    SELECT id INTO def FROM crm_branches WHERE is_default = 1 ORDER BY id LIMIT 1;
    SET @s = CONCAT('UPDATE `', t, '` SET branch_id = ', def, ' WHERE branch_id IS NULL');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL crm_add_branch_id('students');
CALL crm_add_branch_id('enrollments');
CALL crm_add_branch_id('courses');
CALL crm_add_branch_id('payments');
CALL crm_add_branch_id('expenses');
CALL crm_add_branch_id('crm_instructors');
CALL crm_add_branch_id('crm_vehicles');
CALL crm_add_branch_id('crm_lesson_bookings');
DROP PROCEDURE IF EXISTS crm_add_branch_id;
