/**
 * App settings API — key/value store (receipt print, school branding, …)
 */
import { Router } from 'express';
import { z } from 'zod';
import pool from '../../config/db.js';

const router = Router();

/** Built-in defaults when app_settings table is empty / missing */
const DEFAULT_RECEIPT_SETTINGS: Record<string, unknown> = {
  paper_size: 'a5',
  copies: 1,
  footer_text:
    'این رسید صرفاً اعلام دریافت وجه است و به‌منزله گواهی پایان دوره نمی‌باشد.',
  header_title: 'آموزشگاه',
  header_phone: '',
  header_logo_path: null,
  show_national_code: true,
  show_balance: true,
  font_scale: 1,
  margin_mm: 8,
};

function parseJsonValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function stripPrefix(
  rows: Array<{ setting_key: string; setting_value: unknown }>,
  prefix: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    let key = row.setting_key;
    if (prefix && key.startsWith(prefix)) {
      key = key.slice(prefix.length);
    }
    out[key] = parseJsonValue(row.setting_value);
  }
  return out;
}

// GET /api/settings?prefix=receipt.
router.get('/', async (req, res) => {
  try {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
    const publicOnly = req.query.public !== '0';

    let sql = 'SELECT setting_key, setting_value, value_type, label_fa, is_public FROM app_settings WHERE 1=1';
    const params: unknown[] = [];
    if (prefix) {
      sql += ' AND setting_key LIKE ?';
      params.push(`${prefix}%`);
    }
    if (publicOnly) {
      sql += ' AND is_public = 1';
    }
    sql += ' ORDER BY setting_key ASC';

    const [rows] = (await pool.query(sql, params)) as [
      Array<{
        setting_key: string;
        setting_value: unknown;
        value_type: string;
        label_fa: string | null;
        is_public: number;
      }>,
      unknown,
    ];

    res.json({
      settings: rows.map((r) => ({
        ...r,
        setting_value: parseJsonValue(r.setting_value),
      })),
      map: stripPrefix(
        rows.map((r) => ({
          setting_key: r.setting_key,
          setting_value: r.setting_value,
        })),
        prefix
      ),
    });
  } catch (error) {
    console.warn('app_settings query failed, returning defaults:', error);
    res.json({
      settings: [],
      map: prefixIsReceipt(req.query.prefix)
        ? { ...DEFAULT_RECEIPT_SETTINGS }
        : {},
      fallback: true,
    });
  }
});

function prefixIsReceipt(prefix: unknown): boolean {
  return typeof prefix === 'string' && prefix.startsWith('receipt');
}

// GET /api/settings/receipt — flattened receipt.* object
router.get('/receipt', async (_req, res) => {
  try {
    const [rows] = (await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key LIKE 'receipt.%' AND is_public = 1`
    )) as [Array<{ setting_key: string; setting_value: unknown }>, unknown];

    const map = {
      ...DEFAULT_RECEIPT_SETTINGS,
      ...stripPrefix(rows, 'receipt.'),
    };
    res.json(map);
  } catch (error) {
    console.warn('settings/receipt fallback:', error);
    res.json({ ...DEFAULT_RECEIPT_SETTINGS, fallback: true });
  }
});

const ReceiptSettingsSchema = z.object({
  paper_size: z.enum(['a4', 'a5', 'thermal_80']).optional(),
  copies: z.number().int().min(1).max(5).optional(),
  footer_text: z.string().max(2000).optional(),
  header_title: z.string().max(255).optional(),
  header_phone: z.string().max(64).optional(),
  header_logo_path: z.string().nullable().optional(),
  show_national_code: z.boolean().optional(),
  show_balance: z.boolean().optional(),
  font_scale: z.number().min(0.8).max(1.4).optional(),
  margin_mm: z.number().min(0).max(25).optional(),
});

// PUT /api/settings/receipt — upsert receipt.* keys
router.put('/receipt', async (req, res) => {
  try {
    const data = ReceiptSettingsSchema.parse(req.body ?? {});
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No settings provided' });
    }

    for (const [key, value] of entries) {
      const fullKey = `receipt.${key}`;
      const jsonVal = JSON.stringify(value);
      const valueType =
        typeof value === 'boolean'
          ? 'boolean'
          : typeof value === 'number'
            ? 'number'
            : value === null
              ? 'json'
              : 'string';

      await pool.query(
        `INSERT INTO app_settings (setting_key, setting_value, value_type, is_public)
         VALUES (?, CAST(? AS JSON), ?, 1)
         ON DUPLICATE KEY UPDATE
           setting_value = CAST(? AS JSON),
           value_type = VALUES(value_type),
           updated_at = CURRENT_TIMESTAMP`,
        [fullKey, jsonVal, valueType, jsonVal]
      );
    }

    const [rows] = (await pool.query(
      `SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'receipt.%'`
    )) as [Array<{ setting_key: string; setting_value: unknown }>, unknown];

    res.json({
      ...DEFAULT_RECEIPT_SETTINGS,
      ...stripPrefix(rows, 'receipt.'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating receipt settings:', error);
    res.status(500).json({ error: 'Failed to update settings (is app_settings migrated?)' });
  }
});

export default router;
