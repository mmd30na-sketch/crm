/**
 * Theme settings («تم»): light/dark/system mode, primary color, font and the login-screen logo.
 * Additive only: the config lives in the existing app_settings key-value table (MySQL, key
 * 'theme.config'; created by database/migrations/20260720_app_settings.sql) and in
 * db_store.json settings.theme as the JSON fallback. No existing table or column is modified.
 * The logo image is uploaded via multer into uploads/theme/ and is served publicly (the login
 * screen has no session), so it is registered before the protected /uploads route in server.ts.
 */
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import type express from 'express';
import * as db from './mysql-socks';

export interface ThemeConfig {
  mode: 'light' | 'dark' | 'system';
  primary: string;
  font: 'vazirmatn' | 'tahoma' | 'system';
  /** Public path under /uploads/theme, or null for the built-in logo. */
  logo_url: string | null;
}

export const THEME_KEY = 'theme.config';

export const DEFAULT_THEME: ThemeConfig = {
  mode: 'system',
  primary: '#0ea5e9',
  font: 'vazirmatn',
  logo_url: null,
};

const MODES: readonly string[] = ['light', 'dark', 'system'];
const FONTS: readonly string[] = ['vazirmatn', 'tahoma', 'system'];

export function normalizeTheme(input: any): ThemeConfig {
  const d = input && typeof input === 'object' ? input : {};
  const primary = typeof d.primary === 'string' ? d.primary.trim() : '';
  return {
    mode: MODES.includes(d.mode) ? d.mode : DEFAULT_THEME.mode,
    primary: /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : DEFAULT_THEME.primary,
    font: FONTS.includes(d.font) ? d.font : DEFAULT_THEME.font,
    logo_url: typeof d.logo_url === 'string' && d.logo_url.trim() ? d.logo_url.trim() : null,
  };
}

/** Creates app_settings when the migration has not run yet (CREATE TABLE IF NOT EXISTS: additive). */
export async function ensureThemeSettingsSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS app_settings (
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
      COMMENT='Global/app configuration key-value store'`);
  } catch (err: any) {
    console.warn('Could not prepare app_settings for the theme:', err.message);
  }
}

/**
 * Reads the theme: MySQL app_settings when connected, db_store.json settings.theme as the
 * fallback. A row that cannot be decoded falls back to the JSON store, then to the defaults.
 */
export async function readThemeConfig(jsonSettings: any): Promise<ThemeConfig> {
  if (db.isMysqlEnabled()) {
    try {
      const rows = await db.sql<{ setting_value: any }>(
        'SELECT setting_value FROM app_settings WHERE setting_key = ?',
        [THEME_KEY]
      );
      const raw = rows[0]?.setting_value;
      if (raw !== undefined && raw !== null && raw !== '') {
        const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
        if (parsed) return normalizeTheme(parsed);
      }
    } catch (err: any) {
      console.warn('Reading the theme from app_settings failed:', err.message);
    }
  }
  return normalizeTheme(jsonSettings?.theme);
}

/** Writes the theme to both stores: app_settings (MySQL) and settings.theme (JSON fallback). */
export async function writeThemeConfig(jsonSettings: any, cfg: ThemeConfig): Promise<void> {
  if (jsonSettings && typeof jsonSettings === 'object') jsonSettings.theme = cfg;
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(
      `INSERT INTO app_settings (setting_key, setting_value, value_type, label_fa, description_fa, is_public)
       VALUES (?, ?, 'json', 'تنظیمات تم ظاهری', 'حالت روشن/تاریک/سیستمی، رنگ اصلی، فونت و لوگو', 1)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), value_type = VALUES(value_type)`,
      [THEME_KEY, JSON.stringify(cfg)]
    );
  } catch (err: any) {
    console.warn('Writing the theme to app_settings failed:', err.message);
  }
}

function safeJson(raw: string): any {
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Logo upload (image only, 2 MB, fixed public name under uploads/theme/) ──────────────────────

export const THEME_LOGO_DIR = path.join(process.cwd(), 'uploads', 'theme');

class UploadError extends Error {
  status = 400;
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
function imageFileFilter(_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || !String(file.mimetype).startsWith('image/')) {
    return cb(new UploadError('فقط تصویر با فرمت JPG، PNG یا WEBP مجاز است.'));
  }
  cb(null, true);
}

const themeLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try { fs.mkdirSync(THEME_LOGO_DIR, { recursive: true }); } catch {}
    cb(null, THEME_LOGO_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, `logo${ext}`);
  },
});

export const uploadThemeLogo = multer({
  storage: themeLogoStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

/** Removes every stored logo (used when the admin resets to the default logo). */
export function removeThemeLogos(): void {
  try {
    for (const name of fs.readdirSync(THEME_LOGO_DIR)) fs.unlinkSync(path.join(THEME_LOGO_DIR, name));
  } catch {}
}

/** Drops a previous logo with a different extension (the new one already has its own name). */
export function removeOtherThemeLogos(keepPath: string): void {
  try {
    const keep = path.resolve(keepPath);
    for (const name of fs.readdirSync(THEME_LOGO_DIR)) {
      const abs = path.join(THEME_LOGO_DIR, name);
      if (path.resolve(abs) !== keep) fs.unlinkSync(abs);
    }
  } catch {}
}
