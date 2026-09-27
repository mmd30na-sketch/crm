/**
 * Dynamic report template registry API
 */
import { Router } from 'express';
import { z } from 'zod';
import pool from '../../config/db.js';
import { DEFAULT_REPORT_TEMPLATES } from './defaultTemplates.js';

const router = Router();

function mapRow(row: Record<string, unknown>) {
  let schema = row.placeholders_schema;
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch {
      /* keep string */
    }
  }
  return {
    ...row,
    is_active: Number(row.is_active) === 1,
    is_default_selected: Number(row.is_default_selected) === 1,
    placeholders_schema: schema,
  };
}

// GET /api/report-templates
router.get('/', async (req, res) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const activeOnly = req.query.active !== '0';
    const includeBody = req.query.include_body === '1';

    const cols = includeBody
      ? '*'
      : `template_id, template_key, title_fa, description_fa, category,
         is_active, is_default_selected, sort_order, paper_size, orientation,
         engine, copies_default, version, placeholders_schema`;

    let sql = `SELECT ${cols} FROM report_templates WHERE 1=1`;
    const params: unknown[] = [];
    if (activeOnly) {
      sql += ' AND is_active = 1';
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY sort_order ASC, template_id ASC';

    const [rows] = (await pool.query(sql, params)) as [
      Array<Record<string, unknown>>,
      unknown,
    ];

    if (!rows.length) {
      let fallback = DEFAULT_REPORT_TEMPLATES.filter((t) =>
        activeOnly ? t.is_active === 1 : true
      );
      if (category) {
        fallback = fallback.filter((t) => t.category === category);
      }
      return res.json({
        templates: fallback.map((t) =>
          mapRow(
            includeBody
              ? (t as unknown as Record<string, unknown>)
              : ({ ...t, body_html: undefined, body_css: undefined } as Record<
                  string,
                  unknown
                >)
          )
        ),
        fallback: true,
      });
    }

    res.json({
      templates: rows.map((r) => mapRow(r)),
      fallback: false,
    });
  } catch (error) {
    console.warn('report_templates query failed, using defaults:', error);
    let fallback = DEFAULT_REPORT_TEMPLATES;
    if (req.query.category) {
      fallback = fallback.filter((t) => t.category === String(req.query.category));
    }
    const includeBody = req.query.include_body === '1';
    res.json({
      templates: fallback.map((t) =>
        mapRow(
          includeBody
            ? (t as unknown as Record<string, unknown>)
            : ({ ...t, body_html: undefined, body_css: undefined } as Record<
                string,
                unknown
              >)
        )
      ),
      fallback: true,
    });
  }
});

// GET /api/report-templates/:key
router.get('/:key', async (req, res) => {
  try {
    const [rows] = (await pool.query(
      'SELECT * FROM report_templates WHERE template_key = ? LIMIT 1',
      [req.params.key]
    )) as [Array<Record<string, unknown>>, unknown];

    if (rows.length) {
      return res.json(mapRow(rows[0]));
    }

    const fb = DEFAULT_REPORT_TEMPLATES.find(
      (t) => t.template_key === req.params.key
    );
    if (fb) return res.json(mapRow(fb as unknown as Record<string, unknown>));
    return res.status(404).json({ error: 'Template not found' });
  } catch (error) {
    const fb = DEFAULT_REPORT_TEMPLATES.find(
      (t) => t.template_key === req.params.key
    );
    if (fb) return res.json(mapRow(fb as unknown as Record<string, unknown>));
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/report-templates/resolve — body: { keys: string[] }
router.post('/resolve', async (req, res) => {
  try {
    const keys = z.array(z.string().min(1)).min(1).parse(req.body?.keys ?? []);
    const placeholders = keys.map(() => '?').join(',');
    let rows: Array<Record<string, unknown>> = [];
    try {
      const [dbRows] = (await pool.query(
        `SELECT * FROM report_templates
         WHERE template_key IN (${placeholders}) AND is_active = 1
         ORDER BY sort_order ASC`,
        keys
      )) as [Array<Record<string, unknown>>, unknown];
      rows = dbRows;
    } catch {
      rows = [];
    }

    const byKey = new Map(rows.map((r) => [String(r.template_key), r]));
    const ordered = keys
      .map((k) => {
        if (byKey.has(k)) return mapRow(byKey.get(k)!);
        const fb = DEFAULT_REPORT_TEMPLATES.find((t) => t.template_key === k);
        return fb ? mapRow(fb as unknown as Record<string, unknown>) : null;
      })
      .filter(Boolean);

    res.json({ templates: ordered });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error resolving templates:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
