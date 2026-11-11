/**
 * Visual lead pipeline («پایپ‌لاین سرنخ‌ها»): configurable stages over the existing `leads` table, drag-and-drop
 * moves with a stage history, owner assignment, notes (crm_activities) and a conversion-rate report.
 *
 * Decision: the CRM already has a lead entity (phase4.ts: `leads`, `lead_sources`, statuses new/contacted/
 * in_negotiation/converted/lost, convert-to-student). Online registrations / enrollments are customers, not
 * leads, so the pipeline reuses `leads`. Each stage may map to a legacy `leads.status`; moving a lead into such
 * a stage also updates `status`, so the existing Leads screen and campaigns stay consistent.
 *
 * Additive only: tables crm_lead_stages + crm_lead_stage_history, and three nullable columns on leads
 * (pipeline_stage_id, owner_username, stage_changed_at). MySQL only (leads live in MySQL).
 */
import type express from 'express';
import { toGregorian, toJalaali } from 'jalaali-js';
import * as db from './mysql-socks';

export type LeadPipelineDeps = {
  session(req: express.Request): { username: string; role: string } | null;
  sanitize(v: unknown, max: number): string;
  staffDirectory(): Array<{ username: string; full_name: string; role: string; is_active: boolean }>;
};

export const STAGE_COLORS = ['slate', 'sky', 'amber', 'indigo', 'emerald', 'rose', 'violet', 'teal', 'orange'] as const;
const LEGACY_STATUSES = ['new', 'contacted', 'in_negotiation', 'converted', 'lost'] as const;

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
const intOrNull = (v: unknown) => { const n = Number(toLatin(v)); return Number.isInteger(n) && n > 0 ? n : null; };
const maskPhone = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); const k = d.length >= 10 ? d.slice(-10) : ''; return k ? `0${k.slice(0, 3)}***${k.slice(-2)}` : ''; };
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const p2 = (n: number) => String(n).padStart(2, '0');

/** 'yyyy/mm/dd' Jalali (Persian digits allowed) -> UTC midnight of the Gregorian day, or null. */
export function jalaliToGregorianDate(s: unknown): Date | null {
  const m = toLatin(s).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1]; const jm = +m[2]; const jd = +m[3];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  try { const g = toGregorian(jy, jm, jd); return new Date(Date.UTC(g.gy, g.gm - 1, g.gd)); } catch { return null; }
}
/** Jalali 'yyyy/mm' of an instant, in Tehran time. */
export function jalaliMonthOf(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const { jy, jm } = toJalaali(get('year'), get('month'), get('day'));
  return `${jy}/${p2(jm)}`;
}
export const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 10000 : 0);

type StageRow = { id: number; title: string; color: string; position: number; status_key: string | null; is_won: boolean; is_lost: boolean; is_active: boolean };
const stageOut = (r: any): StageRow => ({
  id: Number(r.id), title: String(r.title), color: String(r.color), position: Number(r.position), status_key: r.status_key || null,
  is_won: !!Number(r.is_won), is_lost: !!Number(r.is_lost), is_active: !!Number(r.is_active),
});

let ready = false;
export async function ensureLeadPipelineSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  try {
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_lead_stages (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: lead pipeline stages / مراحل پایپ‌لاین'`);
    await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_lead_stage_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      lead_id INT NOT NULL,
      from_stage_id INT UNSIGNED NULL,
      to_stage_id INT UNSIGNED NOT NULL,
      changed_by VARCHAR(80) NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_hist_lead (lead_id, changed_at),
      KEY idx_hist_stage (to_stage_id, changed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: lead stage moves / تاریخچه مراحل سرنخ'`);
    const cnt = await db.sql<{ c: number }>('SELECT COUNT(*) AS c FROM crm_lead_stages');
    if (!Number(cnt[0]?.c)) {
      await db.sqlExec(`INSERT INTO crm_lead_stages (title, color, position, status_key, is_won, is_lost) VALUES
        ('جدید', 'sky', 10, 'new', 0, 0), ('تماس گرفته شد', 'amber', 20, 'contacted', 0, 0), ('در حال مذاکره', 'indigo', 30, 'in_negotiation', 0, 0),
        ('ثبت‌نام شد', 'emerald', 40, 'converted', 1, 0), ('از دست رفت', 'rose', 50, 'lost', 0, 1)`);
    }
    const cols = new Set((await db.sql<{ Field: string }>('SHOW COLUMNS FROM leads')).map((c) => c.Field));
    if (!cols.has('pipeline_stage_id')) await db.sqlExec('ALTER TABLE leads ADD COLUMN pipeline_stage_id INT UNSIGNED NULL');
    if (!cols.has('owner_username')) await db.sqlExec('ALTER TABLE leads ADD COLUMN owner_username VARCHAR(80) NULL');
    if (!cols.has('stage_changed_at')) await db.sqlExec('ALTER TABLE leads ADD COLUMN stage_changed_at DATETIME NULL');
    await db.sqlExec(`UPDATE leads l JOIN (SELECT status_key, MIN(id) AS id FROM crm_lead_stages WHERE status_key IS NOT NULL GROUP BY status_key) s
      ON s.status_key = l.status SET l.pipeline_stage_id = s.id WHERE l.pipeline_stage_id IS NULL`);
    ready = true;
  } catch (err: any) {
    console.warn('Lead pipeline schema setup failed:', err?.message || err);
  }
}

const CARD_SELECT = `SELECT l.lead_id AS id, l.first_name, l.last_name, l.phone_number, l.source_id, ls.title AS source_title,
    c.title AS course_title, l.owner_username, l.pipeline_stage_id, l.status, l.next_followup_date_jalali, l.created_at, l.stage_changed_at,
    (SELECT COUNT(*) FROM crm_activities a WHERE a.entity_type = 'lead' AND a.entity_id = l.lead_id AND a.kind = 'note') AS notes_count
  FROM leads l LEFT JOIN lead_sources ls ON ls.source_id = l.source_id LEFT JOIN courses c ON c.course_id = l.interested_course_id`;

/** Stage of a lead for display: its pipeline stage, else the first stage mapped to its legacy status. */
function stageOfLead(l: any, stages: StageRow[]): number | null {
  const own = Number(l.pipeline_stage_id) || null;
  if (own && stages.some((s) => s.id === own)) return own;
  return stages.find((s) => s.status_key === l.status)?.id ?? own;
}
const cardOut = (r: any, stages: StageRow[]) => ({
  id: Number(r.id), first_name: r.first_name || null, last_name: String(r.last_name || ''), phone_masked: maskPhone(r.phone_number),
  source_id: r.source_id === null ? null : Number(r.source_id), source_title: r.source_title || null, course_title: r.course_title || null,
  owner_username: r.owner_username || null, stage_id: stageOfLead(r, stages), status: String(r.status || ''),
  next_followup_date_jalali: r.next_followup_date_jalali || null, created_at: iso(r.created_at), stage_changed_at: iso(r.stage_changed_at),
  notes_count: Number(r.notes_count) || 0,
});

/** Pure report builder (exported for tests). */
export function buildReport(leads: Array<{ id: number; source_id: number | null; source_title: string | null; status: string; stage_id: number | null; created_at: Date }>,
  stages: StageRow[], history: Array<{ lead_id: number; to_stage_id: number; changed_at: Date }>) {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const won = (l: typeof leads[number]) => !!(l.stage_id && stageById.get(l.stage_id)?.is_won) || l.status === 'converted';
  const lost = (l: typeof leads[number]) => !won(l) && (!!(l.stage_id && stageById.get(l.stage_id)?.is_lost) || l.status === 'lost');
  const ids = new Set(leads.map((l) => l.id));
  const reachedBy = new Map<number, Set<number>>();
  const add = (stage: number, lead: number) => { if (!reachedBy.has(stage)) reachedBy.set(stage, new Set()); reachedBy.get(stage)!.add(lead); };
  for (const h of history) if (ids.has(h.lead_id)) add(h.to_stage_id, h.lead_id);
  for (const l of leads) if (l.stage_id) add(l.stage_id, l.id);
  const total = leads.length;
  const wonCount = leads.filter(won).length; const lostCount = leads.filter(lost).length;
  const by_stage = stages.filter((s) => s.is_active).sort((a, b) => a.position - b.position).map((s) => {
    const reached = reachedBy.get(s.id)?.size || 0;
    return { stage_id: s.id, title: s.title, color: s.color, current: leads.filter((l) => l.stage_id === s.id).length, reached, reach_rate: rate(reached, total) };
  });
  const src = new Map<string, { source_id: number | null; title: string; leads: number; won: number; lost: number }>();
  for (const l of leads) {
    const k = String(l.source_id ?? 'none');
    if (!src.has(k)) src.set(k, { source_id: l.source_id, title: l.source_title || 'نامشخص', leads: 0, won: 0, lost: 0 });
    const r = src.get(k)!; r.leads += 1; if (won(l)) r.won += 1; if (lost(l)) r.lost += 1;
  }
  const per = new Map<string, { period: string; leads: number; won: number }>();
  for (const l of leads) {
    const k = jalaliMonthOf(l.created_at);
    if (!per.has(k)) per.set(k, { period: k, leads: 0, won: 0 });
    const r = per.get(k)!; r.leads += 1; if (won(l)) r.won += 1;
  }
  // Days from creation to the first move into a won stage.
  const firstWin = new Map<number, number>();
  for (const h of history) {
    if (!ids.has(h.lead_id) || !stageById.get(h.to_stage_id)?.is_won) continue;
    const t = h.changed_at.getTime(); const prev = firstWin.get(h.lead_id);
    if (prev === undefined || t < prev) firstWin.set(h.lead_id, t);
  }
  const days = leads.filter((l) => firstWin.has(l.id)).map((l) => Math.max(0, (firstWin.get(l.id)! - l.created_at.getTime()) / 86_400_000));
  return {
    totals: { leads: total, won: wonCount, lost: lostCount, open: total - wonCount - lostCount, conversion_rate: rate(wonCount, total) },
    by_stage,
    by_source: [...src.values()].sort((a, b) => b.leads - a.leads).map((r) => ({ ...r, conversion_rate: rate(r.won, r.leads) })),
    by_period: [...per.values()].sort((a, b) => a.period.localeCompare(b.period)).map((r) => ({ ...r, conversion_rate: rate(r.won, r.leads) })),
    avg_days_to_win: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
  };
}

export function registerLeadPipeline(app: express.Express, deps: LeadPipelineDeps) {
  type Who = { username: string; role: string };
  const route = (adminOnly: boolean, fn: (req: express.Request, res: express.Response, who: Who) => Promise<void>) =>
    async (req: express.Request, res: express.Response) => {
      const who = deps.session(req);
      if (!who || !['admin', 'cashier'].includes(who.role)) { res.status(403).json({ error: 'دسترسی ندارید.' }); return; }
      if (adminOnly && who.role !== 'admin') { res.status(403).json({ error: 'فقط مدیر می‌تواند مراحل را تغییر دهد.' }); return; }
      if (!db.isMysqlEnabled() || !ready) { res.status(503).json({ error: 'این بخش فقط با دیتابیس MySQL فعال است.' }); return; }
      try { await fn(req, res, who); } catch (err: any) {
        const status = Number(err?.status) || 500;
        if (status >= 500) console.warn(`[lead-pipeline] ${req.method} ${req.path}:`, err?.message || err);
        res.status(status).json({ error: status < 500 ? err.message : 'خطای داخلی سرور.' });
      }
    };
  const loadStages = async (all = true) => (await db.sql(`SELECT * FROM crm_lead_stages ${all ? '' : 'WHERE is_active = 1'} ORDER BY position, id`)).map(stageOut);
  const stageBody = (b: any, existing?: StageRow) => {
    const title = deps.sanitize(b?.title ?? existing?.title, 80);
    if (!title) throw httpError(400, 'عنوان مرحله الزامی است.');
    const color = String(b?.color ?? existing?.color ?? 'slate');
    if (!(STAGE_COLORS as readonly string[]).includes(color)) throw httpError(400, 'رنگ نامعتبر است.');
    const sk = b?.status_key === undefined ? existing?.status_key ?? null : (b.status_key || null);
    if (sk !== null && !(LEGACY_STATUSES as readonly string[]).includes(sk)) throw httpError(400, 'وضعیت متناظر نامعتبر است.');
    const isWon = b?.is_won === undefined ? !!existing?.is_won : !!b.is_won;
    const isLost = b?.is_lost === undefined ? !!existing?.is_lost : !!b.is_lost;
    if (isWon && isLost) throw httpError(400, 'یک مرحله نمی‌تواند هم «موفق» و هم «از دست رفته» باشد.');
    const isActive = b?.is_active === undefined ? (existing ? existing.is_active : true) : !!b.is_active;
    return { title, color, status_key: sk, is_won: isWon, is_lost: isLost, is_active: isActive };
  };
  const idParam = (req: express.Request) => { const id = intOrNull(req.params.id); if (!id) throw httpError(400, 'شناسه نامعتبر است.'); return id; };

  app.get('/api/lead-pipeline/stages', route(false, async (req, res) => {
    const stages = await loadStages(req.query.all === '1');
    const counts = await db.sql<{ stage_id: number; c: number }>('SELECT pipeline_stage_id AS stage_id, COUNT(*) AS c FROM leads GROUP BY pipeline_stage_id');
    const cm = new Map(counts.map((r) => [Number(r.stage_id), Number(r.c)]));
    res.json(stages.map((s) => ({ ...s, lead_count: cm.get(s.id) || 0 })));
  }));
  app.post('/api/lead-pipeline/stages', route(true, async (req, res) => {
    const b = stageBody(req.body);
    const mx = await db.sql<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM crm_lead_stages');
    const r = await db.sqlExec('INSERT INTO crm_lead_stages (title, color, position, status_key, is_won, is_lost, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [b.title, b.color, Number(mx[0]?.p || 0) + 10, b.status_key, b.is_won ? 1 : 0, b.is_lost ? 1 : 0, b.is_active ? 1 : 0]);
    res.status(201).json({ id: r.insertId });
  }));
  app.put('/api/lead-pipeline/stages/:id', route(true, async (req, res) => {
    const id = idParam(req);
    const existing = (await loadStages()).find((s) => s.id === id);
    if (!existing) throw httpError(404, 'مرحله یافت نشد.');
    const b = stageBody(req.body, existing);
    await db.sqlExec('UPDATE crm_lead_stages SET title = ?, color = ?, status_key = ?, is_won = ?, is_lost = ?, is_active = ? WHERE id = ?',
      [b.title, b.color, b.status_key, b.is_won ? 1 : 0, b.is_lost ? 1 : 0, b.is_active ? 1 : 0, id]);
    res.json({ ok: true });
  }));
  app.post('/api/lead-pipeline/stages/reorder', route(true, async (req, res) => {
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(intOrNull).filter((x: number | null): x is number => !!x);
    const known = new Set((await loadStages()).map((s) => s.id));
    if (!ids.length || ids.some((x) => !known.has(x)) || new Set(ids).size !== ids.length) throw httpError(400, 'فهرست مراحل نامعتبر است.');
    for (let i = 0; i < ids.length; i += 1) await db.sqlExec('UPDATE crm_lead_stages SET position = ? WHERE id = ?', [(i + 1) * 10, ids[i]]);
    res.json({ ok: true });
  }));
  app.delete('/api/lead-pipeline/stages/:id', route(true, async (req, res) => {
    const id = idParam(req);
    const used = await db.sql<{ c: number }>('SELECT COUNT(*) AS c FROM leads WHERE pipeline_stage_id = ?', [id]);
    if (Number(used[0]?.c)) throw httpError(409, 'این مرحله سرنخ دارد؛ ابتدا سرنخ‌ها را جابه‌جا کنید یا مرحله را غیرفعال کنید.');
    const r = await db.sqlExec('DELETE FROM crm_lead_stages WHERE id = ?', [id]);
    if (!r.affectedRows) throw httpError(404, 'مرحله یافت نشد.');
    res.json({ ok: true });
  }));

  app.get('/api/lead-pipeline/board', route(false, async (req, res) => {
    const q = req.query as Record<string, string>;
    const where: string[] = []; const params: any[] = [];
    const sid = intOrNull(q.source_id); if (sid) { where.push('l.source_id = ?'); params.push(sid); }
    const cid = intOrNull(q.course_id); if (cid) { where.push('l.interested_course_id = ?'); params.push(cid); }
    if (q.owner === '__none') where.push('l.owner_username IS NULL');
    else if (q.owner) { where.push('l.owner_username = ?'); params.push(deps.sanitize(q.owner, 80)); }
    const term = deps.sanitize(toLatin(q.q || ''), 80);
    if (term) { where.push("(CONCAT(COALESCE(l.first_name, ''), ' ', l.last_name) LIKE ? OR l.phone_number LIKE ?)"); params.push(`%${term}%`, `%${term.replace(/\D/g, '') || term}%`); }
    const stages = await loadStages(false);
    const rows = await db.sql(`${CARD_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.lead_id DESC LIMIT 2000`, params);
    const all = await loadStages(true);
    res.json({ stages, leads: rows.map((r: any) => cardOut(r, all)) });
  }));
  app.post('/api/lead-pipeline/leads/:id/move', route(false, async (req, res, who) => {
    const id = idParam(req);
    const target = intOrNull(req.body?.stage_id);
    const stages = await loadStages(true);
    const stage = stages.find((s) => s.id === target);
    if (!stage || !stage.is_active) throw httpError(400, 'مرحله مقصد نامعتبر است.');
    const [lead] = await db.sql('SELECT lead_id, status, pipeline_stage_id FROM leads WHERE lead_id = ?', [id]);
    if (!lead) throw httpError(404, 'سرنخ یافت نشد.');
    const current = stageOfLead(lead, stages);
    if (current !== stage.id) {
      await db.sqlExec(`UPDATE leads SET pipeline_stage_id = ?, stage_changed_at = NOW()${stage.status_key ? ', status = ?' : ''} WHERE lead_id = ?`,
        stage.status_key ? [stage.id, stage.status_key, id] : [stage.id, id]);
      await db.sqlExec('INSERT INTO crm_lead_stage_history (lead_id, from_stage_id, to_stage_id, changed_by) VALUES (?, ?, ?, ?)', [id, current, stage.id, who.username || null]);
    }
    const [row] = await db.sql(`${CARD_SELECT} WHERE l.lead_id = ?`, [id]);
    res.json({ ...cardOut(row, stages), unchanged: current === stage.id });
  }));
  app.put('/api/lead-pipeline/leads/:id/owner', route(false, async (req, res) => {
    const id = idParam(req);
    const raw = deps.sanitize(req.body?.owner_username ?? '', 80);
    if (raw && !deps.staffDirectory().some((s) => s.is_active && s.username === raw)) throw httpError(400, 'کاربر انتخاب‌شده معتبر نیست.');
    const r = await db.sqlExec('UPDATE leads SET owner_username = ? WHERE lead_id = ?', [raw || null, id]);
    if (!r.affectedRows) throw httpError(404, 'سرنخ یافت نشد.');
    res.json({ ok: true, owner_username: raw || null });
  }));
  app.get('/api/lead-pipeline/leads/:id/notes', route(false, async (req, res) => {
    const rows = await db.sql(`SELECT id, body, staff_username, occurred_at FROM crm_activities
      WHERE entity_type = 'lead' AND entity_id = ? AND kind = 'note' ORDER BY occurred_at DESC, id DESC LIMIT 200`, [idParam(req)]);
    res.json(rows.map((r: any) => ({ id: Number(r.id), body: r.body || '', staff_username: r.staff_username || null, occurred_at: iso(r.occurred_at) })));
  }));
  app.post('/api/lead-pipeline/leads/:id/notes', route(false, async (req, res, who) => {
    const id = idParam(req);
    const body = deps.sanitize(req.body?.body, 2000);
    if (!body) throw httpError(400, 'متن یادداشت الزامی است.');
    const [lead] = await db.sql('SELECT lead_id FROM leads WHERE lead_id = ?', [id]);
    if (!lead) throw httpError(404, 'سرنخ یافت نشد.');
    const r = await db.sqlExec("INSERT INTO crm_activities (entity_type, entity_id, kind, outcome, body, staff_username) VALUES ('lead', ?, 'note', 'pipeline', ?, ?)", [id, body, who.username || null]);
    res.status(201).json({ id: r.insertId });
  }));

  app.get('/api/lead-pipeline/report', route(false, async (req, res) => {
    const q = req.query as Record<string, string>;
    const from = q.from ? jalaliToGregorianDate(q.from) : null;
    const to = q.to ? jalaliToGregorianDate(q.to) : null;
    if ((q.from && !from) || (q.to && !to)) throw httpError(400, 'تاریخ شمسی را به شکل ۱۴۰۵/۰۱/۰۱ وارد کنید.');
    const where: string[] = []; const params: any[] = [];
    // Dates are Tehran calendar days; leads.created_at is stored in server time (assumed UTC, as elsewhere in the CRM).
    if (from) { where.push('l.created_at >= ?'); params.push(new Date(from.getTime() - 3.5 * 3_600_000)); }
    if (to) { where.push('l.created_at < ?'); params.push(new Date(to.getTime() + 86_400_000 - 3.5 * 3_600_000)); }
    const sid = intOrNull(q.source_id); if (sid) { where.push('l.source_id = ?'); params.push(sid); }
    const stages = await loadStages(true);
    const rows = await db.sql(`SELECT l.lead_id AS id, l.source_id, ls.title AS source_title, l.status, l.pipeline_stage_id, l.created_at
      FROM leads l LEFT JOIN lead_sources ls ON ls.source_id = l.source_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} LIMIT 50000`, params);
    const leads = rows.map((r: any) => ({
      id: Number(r.id), source_id: r.source_id === null ? null : Number(r.source_id), source_title: r.source_title || null, status: String(r.status || ''),
      stage_id: stageOfLead(r, stages), created_at: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
    }));
    const history = leads.length
      ? (await db.sql('SELECT lead_id, to_stage_id, changed_at FROM crm_lead_stage_history ORDER BY id LIMIT 200000')).map((h: any) => ({
        lead_id: Number(h.lead_id), to_stage_id: Number(h.to_stage_id), changed_at: h.changed_at instanceof Date ? h.changed_at : new Date(String(h.changed_at)),
      }))
      : [];
    res.json({ range: { from: q.from ? toLatin(q.from) : null, to: q.to ? toLatin(q.to) : null }, ...buildReport(leads, stages, history) });
  }));
}
