/**
 * Instructor pay (حق‌التدریس): instructors, rates (per term / per session), sessions and monthly
 * settlements. Additive only: four new crm_instructor_* tables; existing tables are only read
 * (crm_course_terms for the per-term overlap check). Admin-only routes under /api/instructor-pay
 * (other roles are also blocked in canAccessApi). With MySQL disabled the same data lives in
 * db_store.json under the "instructor_pay" key. Phones are masked in every list/report response.
 * Writes go through /api/instructor-pay, so the global audit middleware logs them.
 */
import type express from 'express';
import * as db from './mysql-socks';
import { maskPhone } from './phase4';

let ready = false;
const RATE_TYPES = ['per_term', 'per_session'] as const;
type RateType = (typeof RATE_TYPES)[number];

const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const amountInt = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const str = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };
const jalali = (v: unknown): string | null => {
  const s = String(v ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/-/g, '/');
  return /^1[34]\d\d\/\d{1,2}\/\d{1,2}$/.test(s) ? s : null;
};
/** "1405/07", "1405-7" -> "1405-07" (the dash form stored in crm_instructor_settlements.year_month). */
const yearMonth = (v: unknown): string | null => {
  const s = String(v ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  if (y < 1300 || y > 1499 || mo < 1 || mo > 12) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}`;
};
const currentYearMonth = () => { const [y, m] = db.jalaliToday().split('/'); return `${y}-${m}`; };
const badRequest = (msg: string) => { throw Object.assign(new Error(msg), { status: 400 }); };
const notFound = () => { throw Object.assign(new Error('پیدا نشد'), { status: 404 }); };

export async function ensureInstructorPaySchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS crm_instructors (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(20) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inst_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructors / اساتید حق‌التدریس'`,
    `CREATE TABLE IF NOT EXISTS crm_instructor_rates (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      instructor_id INT UNSIGNED NOT NULL,
      course_term_id INT UNSIGNED NULL,
      rate_type ENUM('per_term','per_session') NOT NULL DEFAULT 'per_session',
      amount INT NOT NULL COMMENT 'Toman',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_rates_instructor (instructor_id),
      KEY idx_rates_term (course_term_id),
      CONSTRAINT fk_inst_rates_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_inst_rates_term FOREIGN KEY (course_term_id) REFERENCES crm_course_terms (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructor pay rates / نرخ حق‌التدریس'`,
    `CREATE TABLE IF NOT EXISTS crm_instructor_sessions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      instructor_id INT UNSIGNED NOT NULL,
      course_term_id INT UNSIGNED NULL,
      session_date VARCHAR(10) NOT NULL COMMENT 'Jalali yyyy/mm/dd',
      hours DECIMAL(5,1) NOT NULL DEFAULT 1,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_sessions_instructor_date (instructor_id, session_date),
      KEY idx_sessions_term (course_term_id),
      CONSTRAINT fk_inst_sessions_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_inst_sessions_term FOREIGN KEY (course_term_id) REFERENCES crm_course_terms (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: instructor sessions / جلسات تدریس'`,
    `CREATE TABLE IF NOT EXISTS crm_instructor_settlements (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      instructor_id INT UNSIGNED NOT NULL,
      year_month CHAR(7) NOT NULL COMMENT 'Jalali yyyy-mm',
      total INT NOT NULL DEFAULT 0 COMMENT 'Toman',
      paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT NULL,
      UNIQUE KEY uq_settlement (instructor_id, year_month),
      CONSTRAINT fk_inst_settlements_instructor FOREIGN KEY (instructor_id) REFERENCES crm_instructors (id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: monthly instructor settlements / تسویه ماهانه'`,
  ];
  // One try per statement: a missing crm_course_terms (its own init can fail) must not block the rest.
  for (const q of statements) {
    try { await db.sqlExec(q); } catch (err: any) { console.warn('instructor-pay schema:', err.message); }
  }
  ready = true;
}

type JsonRow = Record<string, any>;
type JsonStore = { instructors: JsonRow[]; rates: JsonRow[]; sessions: JsonRow[]; settlements: JsonRow[] };

const termLabel = (t: any) => {
  const n = Number(t?.course_number);
  const title = str(t?.course_title, 150);
  return title ? `${title} — دوره ${n || ''}` : (n ? `دوره ${n}` : null);
};

/** A per-term rate pays once for any month the term overlaps (dates are Jalali "yyyy/mm/dd" strings). */
function termOverlapsMonth(t: { start_date?: string | null; end_date?: string | null }, monthStart: string, monthEnd: string): boolean {
  const s = jalali(t.start_date); const e = jalali(t.end_date);
  if (!s && !e) return false;
  if (s && s > monthEnd) return false;
  if (e && e < monthStart) return false;
  return true;
}

/** Pure so MySQL and the JSON fallback share the exact same math (and it stays testable). */
function computeReport(ym: string, instructors: any[], rates: any[], sessions: any[], terms: any[], settlements: any[]) {
  const monthSlash = ym.replace('-', '/');
  const monthStart = `${monthSlash}/01`;
  const monthEnd = `${monthSlash}/31`; // no real date sorts above day 31, so this is a safe upper bound
  const termById = new Map(terms.map((t) => [Number(t.id), t]));
  return instructors.map((i) => {
    const iid = Number(i.id);
    const myRates = rates.filter((r) => Number(r.instructor_id) === iid);
    const mySessions = sessions.filter((s) => Number(s.instructor_id) === iid
      && String(s.session_date || '') >= monthStart && String(s.session_date || '') <= monthEnd);
    const perSessionItems: any[] = [];
    let perSessionTotal = 0;
    for (const r of myRates.filter((r) => r.rate_type === 'per_session')) {
      const per = Number(r.amount) || 0;
      const count = mySessions.filter((s) => !r.course_term_id || Number(s.course_term_id) === Number(r.course_term_id)).length;
      if (count > 0) { perSessionItems.push({ rate_id: Number(r.id), count, amount: per, total: count * per }); perSessionTotal += count * per; }
    }
    const perTermItems: any[] = [];
    let perTermTotal = 0;
    for (const r of myRates.filter((r) => r.rate_type === 'per_term')) {
      const t = termById.get(Number(r.course_term_id));
      if (!t || !termOverlapsMonth(t, monthStart, monthEnd)) continue;
      const per = Number(r.amount) || 0;
      perTermItems.push({ rate_id: Number(r.id), term_id: Number(t.id), term_label: termLabel(t), amount: per });
      perTermTotal += per;
    }
    const settlement = settlements.find((s) => Number(s.instructor_id) === iid) || null;
    const hours = mySessions.reduce((a, s) => a + (Number(s.hours) || 0), 0);
    return {
      instructor_id: iid, name: i.name, phone: maskPhone(i.phone), active: !!i.active,
      sessions_count: mySessions.length, sessions_hours: Math.round(hours * 10) / 10,
      per_session_items: perSessionItems, per_session_total: perSessionTotal,
      per_term_items: perTermItems, per_term_total: perTermTotal,
      total: perSessionTotal + perTermTotal,
      settled: !!settlement, settled_id: settlement ? Number(settlement.id) : null,
      settled_total: settlement ? Number(settlement.total) : null, settled_at: settlement?.paid_at || null,
    };
  }).filter((r) => r.active || r.sessions_count > 0 || r.total > 0 || r.settled);
}

export function registerInstructorPay(app: express.Express, deps: {
  isAdmin: (req: express.Request) => boolean;
  readJsonDb: () => any;
  writeJsonDb: (d: any) => void;
}) {
  const jsonMode = () => !db.isMysqlEnabled();
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>) => (req: express.Request, res: express.Response) => {
    if (!jsonMode() && !ready) return res.status(503).json({ error: 'این بخش فقط با دیتابیس MySQL فعال است.' });
    if (!deps.isAdmin(req)) return res.status(403).json({ error: 'فقط مدیر' });
    fn(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || 'خطای سرور' }));
  };
  const readStore = (): JsonStore => {
    const s = deps.readJsonDb()?.instructor_pay || {};
    return {
      instructors: Array.isArray(s.instructors) ? s.instructors : [],
      rates: Array.isArray(s.rates) ? s.rates : [],
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      settlements: Array.isArray(s.settlements) ? s.settlements : [],
    };
  };
  const writeStore = (s: JsonStore) => { const root = deps.readJsonDb() || {}; root.instructor_pay = s; deps.writeJsonDb(root); };
  const nextId = (rows: JsonRow[]) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
  const findInstructor = (store: JsonStore, id: number) => store.instructors.find((r) => Number(r.id) === id) || null;

  const readInstructorBody = (b: any) => {
    const name = str(b?.name, 120);
    if (!name) badRequest('نام مربی الزامی است');
    return { name, phone: str(b?.phone, 20), active: b?.active === undefined ? true : !!b.active, notes: str(b?.notes, 2000) };
  };
  const readRateBody = async (b: any) => {
    const instructor_id = posInt(b?.instructor_id);
    const rate_type: RateType = (RATE_TYPES as readonly string[]).includes(b?.rate_type) ? b.rate_type : null;
    const amount = amountInt(b?.amount);
    if (!instructor_id || !rate_type || amount === null || amount <= 0) badRequest('مربی، نوع نرخ و مبلغ الزامی است');
    let course_term_id = b?.course_term_id === '' || b?.course_term_id == null ? null : posInt(b.course_term_id);
    if (b?.course_term_id !== '' && b?.course_term_id != null && !course_term_id) badRequest('دوره نامعتبر است');
    if (rate_type === 'per_term' && !course_term_id) badRequest('نرخ «به ازای هر دوره» به انتخاب دوره نیاز دارد');
    if (jsonMode()) {
      const store = readStore();
      if (!findInstructor(store, instructor_id)) badRequest('مربی پیدا نشد');
    } else {
      const [i] = await db.sql<any>('SELECT id FROM crm_instructors WHERE id = ?', [instructor_id]);
      if (!i) badRequest('مربی پیدا نشد');
      if (course_term_id) {
        const [t] = await db.sql<any>('SELECT id FROM crm_course_terms WHERE id = ?', [course_term_id]);
        if (!t) badRequest('دوره پیدا نشد');
      }
    }
    return { instructor_id, course_term_id, rate_type, amount };
  };
  const readSessionBody = async (b: any) => {
    const instructor_id = posInt(b?.instructor_id);
    const session_date = jalali(b?.session_date);
    if (!instructor_id || !session_date) badRequest('مربی و تاریخ جلسه الزامی است');
    const hours = b?.hours === '' || b?.hours == null ? 1 : Number(b.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) badRequest('مدت جلسه باید بین ۰ تا ۲۴ ساعت باشد');
    const course_term_id = b?.course_term_id === '' || b?.course_term_id == null ? null : posInt(b.course_term_id);
    if (b?.course_term_id !== '' && b?.course_term_id != null && !course_term_id) badRequest('دوره نامعتبر است');
    if (jsonMode()) {
      const store = readStore();
      if (!findInstructor(store, instructor_id)) badRequest('مربی پیدا نشد');
    } else {
      const [i] = await db.sql<any>('SELECT id FROM crm_instructors WHERE id = ?', [instructor_id]);
      if (!i) badRequest('مربی پیدا نشد');
    }
    return { instructor_id, course_term_id, session_date, hours: Math.round(hours * 10) / 10, notes: str(b?.notes, 2000) };
  };

  /* ---------------- instructors ---------------- */
  app.get('/api/instructor-pay/instructors', wrap(async (_req, res) => {
    if (jsonMode()) { res.json(readStore().instructors.map((r) => ({ ...r, active: !!r.active, phone: maskPhone(r.phone) }))); return; }
    const rows = await db.sql<any>('SELECT id, name, phone, active, notes, created_at FROM crm_instructors ORDER BY active DESC, name');
    res.json(rows.map((r) => ({ ...r, active: !!r.active, phone: maskPhone(r.phone) })));
  }));

  // Full record (real phone) for the edit form; lists stay masked.
  app.get('/api/instructor-pay/instructors/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    const row = jsonMode() ? findInstructor(readStore(), id)
      : (await db.sql<any>('SELECT id, name, phone, active, notes, created_at FROM crm_instructors WHERE id = ?', [id]))[0];
    if (!row) notFound();
    res.json({ ...row, active: !!row.active });
  }));

  app.post('/api/instructor-pay/instructors', wrap(async (req, res) => {
    const v = readInstructorBody(req.body);
    if (jsonMode()) {
      const store = readStore();
      const row = { id: nextId(store.instructors), ...v, created_at: new Date().toISOString() };
      store.instructors.push(row); writeStore(store); res.json({ id: row.id }); return;
    }
    const r = await db.sqlExec('INSERT INTO crm_instructors (name, phone, active, notes) VALUES (?, ?, ?, ?)',
      [v.name, v.phone, v.active ? 1 : 0, v.notes]);
    res.json({ id: r.insertId });
  }));

  app.put('/api/instructor-pay/instructors/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    const v = readInstructorBody(req.body);
    if (jsonMode()) {
      const store = readStore(); const row = findInstructor(store, id); if (!row) notFound();
      Object.assign(row, v); writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('UPDATE crm_instructors SET name = ?, phone = ?, active = ?, notes = ? WHERE id = ?',
      [v.name, v.phone, v.active ? 1 : 0, v.notes, id]);
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));

  app.delete('/api/instructor-pay/instructors/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    if (jsonMode()) {
      const store = readStore();
      store.instructors = store.instructors.filter((r) => Number(r.id) !== id);
      store.rates = store.rates.filter((r) => Number(r.instructor_id) !== id);
      store.sessions = store.sessions.filter((r) => Number(r.instructor_id) !== id);
      store.settlements = store.settlements.filter((r) => Number(r.instructor_id) !== id);
      writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('DELETE FROM crm_instructors WHERE id = ?', [id]); // cascades to rates/sessions/settlements
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));

  /* ---------------- rates ---------------- */
  const RATE_SELECT = `
    SELECT r.id, r.instructor_id, i.name AS instructor_name, r.course_term_id,
           CASE WHEN t.id IS NULL THEN NULL ELSE CONCAT(COALESCE(c.title, ''), ' — دوره ', t.course_number) END AS term_label,
           r.rate_type, r.amount, r.created_at
    FROM crm_instructor_rates r
    JOIN crm_instructors i ON i.id = r.instructor_id
    LEFT JOIN crm_course_terms t ON t.id = r.course_term_id
    LEFT JOIN courses c ON c.course_id = t.course_id`;

  app.get('/api/instructor-pay/rates', wrap(async (req, res) => {
    const instructor_id = posInt((req.query as any)?.instructor_id);
    if (jsonMode()) {
      const store = readStore();
      const rows = store.rates.filter((r) => !instructor_id || Number(r.instructor_id) === instructor_id)
        .map((r): JsonRow => ({ ...r, amount: Number(r.amount) || 0, term_label: null,
          instructor_name: findInstructor(store, Number(r.instructor_id))?.name || null }))
        .sort((a, b) => Number(b.id) - Number(a.id));
      res.json(rows); return;
    }
    const where = instructor_id ? 'WHERE r.instructor_id = ?' : '';
    const rows = await db.sql<any>(`${RATE_SELECT} ${where} ORDER BY r.id DESC`, instructor_id ? [instructor_id] : []);
    res.json(rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })));
  }));

  app.post('/api/instructor-pay/rates', wrap(async (req, res) => {
    const v = await readRateBody(req.body);
    if (jsonMode()) {
      const store = readStore();
      const row = { id: nextId(store.rates), ...v, created_at: new Date().toISOString() };
      store.rates.push(row); writeStore(store); res.json({ id: row.id }); return;
    }
    const r = await db.sqlExec('INSERT INTO crm_instructor_rates (instructor_id, course_term_id, rate_type, amount) VALUES (?, ?, ?, ?)',
      [v.instructor_id, v.course_term_id, v.rate_type, v.amount]);
    res.json({ id: r.insertId });
  }));

  app.put('/api/instructor-pay/rates/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    const v = await readRateBody(req.body);
    if (jsonMode()) {
      const store = readStore(); const row = store.rates.find((r) => Number(r.id) === id); if (!row) notFound();
      Object.assign(row, v); writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('UPDATE crm_instructor_rates SET instructor_id = ?, course_term_id = ?, rate_type = ?, amount = ? WHERE id = ?',
      [v.instructor_id, v.course_term_id, v.rate_type, v.amount, id]);
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));

  app.delete('/api/instructor-pay/rates/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    if (jsonMode()) {
      const store = readStore();
      store.rates = store.rates.filter((r) => Number(r.id) !== id); writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('DELETE FROM crm_instructor_rates WHERE id = ?', [id]);
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));

  /* ---------------- sessions ---------------- */
  const SESSION_SELECT = `
    SELECT s.id, s.instructor_id, i.name AS instructor_name, s.course_term_id,
           CASE WHEN t.id IS NULL THEN NULL ELSE CONCAT(COALESCE(c.title, ''), ' — دوره ', t.course_number) END AS term_label,
           s.session_date, s.hours, s.notes, s.created_at
    FROM crm_instructor_sessions s
    JOIN crm_instructors i ON i.id = s.instructor_id
    LEFT JOIN crm_course_terms t ON t.id = s.course_term_id
    LEFT JOIN courses c ON c.course_id = t.course_id`;

  app.get('/api/instructor-pay/sessions', wrap(async (req, res) => {
    const q = req.query as Record<string, string>;
    const instructor_id = posInt(q.instructor_id);
    const from = q.from ? jalali(q.from) : null; const to = q.to ? jalali(q.to) : null;
    if ((q.from && !from) || (q.to && !to)) badRequest('تاریخ نامعتبر است');
    if (jsonMode()) {
      const store = readStore();
      const rows = store.sessions
        .filter((s) => (!instructor_id || Number(s.instructor_id) === instructor_id)
          && (!from || String(s.session_date) >= from) && (!to || String(s.session_date) <= to))
        .map((s): JsonRow => ({ ...s, hours: Number(s.hours) || 0, term_label: null,
          instructor_name: findInstructor(store, Number(s.instructor_id))?.name || null }))
        .sort((a, b) => (String(b.session_date).localeCompare(String(a.session_date))) || (Number(b.id) - Number(a.id)));
      res.json(rows); return;
    }
    const where: string[] = []; const params: any[] = [];
    if (instructor_id) { where.push('s.instructor_id = ?'); params.push(instructor_id); }
    if (from) { where.push('s.session_date >= ?'); params.push(from); }
    if (to) { where.push('s.session_date <= ?'); params.push(to); }
    const rows = await db.sql<any>(`${SESSION_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.session_date DESC, s.id DESC`, params);
    res.json(rows.map((r) => ({ ...r, hours: Number(r.hours) || 0 })));
  }));

  app.post('/api/instructor-pay/sessions', wrap(async (req, res) => {
    const v = await readSessionBody(req.body);
    if (jsonMode()) {
      const store = readStore();
      const row = { id: nextId(store.sessions), ...v, created_at: new Date().toISOString() };
      store.sessions.push(row); writeStore(store); res.json({ id: row.id }); return;
    }
    const r = await db.sqlExec('INSERT INTO crm_instructor_sessions (instructor_id, course_term_id, session_date, hours, notes) VALUES (?, ?, ?, ?, ?)',
      [v.instructor_id, v.course_term_id, v.session_date, v.hours, v.notes]);
    res.json({ id: r.insertId });
  }));

  app.put('/api/instructor-pay/sessions/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    const v = await readSessionBody(req.body);
    if (jsonMode()) {
      const store = readStore(); const row = store.sessions.find((r) => Number(r.id) === id); if (!row) notFound();
      Object.assign(row, v); writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('UPDATE crm_instructor_sessions SET instructor_id = ?, course_term_id = ?, session_date = ?, hours = ?, notes = ? WHERE id = ?',
      [v.instructor_id, v.course_term_id, v.session_date, v.hours, v.notes, id]);
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));

  app.delete('/api/instructor-pay/sessions/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    if (jsonMode()) {
      const store = readStore();
      store.sessions = store.sessions.filter((r) => Number(r.id) !== id); writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('DELETE FROM crm_instructor_sessions WHERE id = ?', [id]);
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));

  /* ---------------- monthly report & settlements ---------------- */
  const gatherReport = async (ym: string) => {
    const monthSlash = ym.replace('-', '/');
    const monthStart = `${monthSlash}/01`;
    const monthEnd = `${monthSlash}/31`;
    if (jsonMode()) {
      const store = readStore();
      const rates = store.rates;
      const termIds = [...new Set(rates.filter((r) => r.rate_type === 'per_term' && r.course_term_id).map((r) => Number(r.course_term_id)))];
      // Term dates are MySQL-only (crm_course_terms); in JSON mode per-term rates simply do not match.
      return { instructors: store.instructors, rates,
        sessions: store.sessions.filter((s) => String(s.session_date || '') >= monthStart && String(s.session_date || '') <= monthEnd),
        terms: [], settlements: store.settlements.filter((s) => String(s.year_month) === ym) };
    }
    const instructors = await db.sql<any>('SELECT id, name, phone, active FROM crm_instructors');
    const rates = await db.sql<any>('SELECT id, instructor_id, course_term_id, rate_type, amount FROM crm_instructor_rates');
    const sessions = await db.sql<any>('SELECT id, instructor_id, course_term_id, session_date, hours FROM crm_instructor_sessions WHERE session_date >= ? AND session_date <= ?',
      [monthStart, monthEnd]);
    const settlements = await db.sql<any>('SELECT id, instructor_id, year_month, total, paid_at, notes FROM crm_instructor_settlements WHERE year_month = ?', [ym]);
    const termIds = [...new Set(rates.filter((r) => r.rate_type === 'per_term' && r.course_term_id).map((r) => Number(r.course_term_id)))];
    const terms = termIds.length
      ? await db.sql<any>(`SELECT t.id, t.course_id, c.title AS course_title, t.course_number, t.start_date, t.end_date
          FROM crm_course_terms t LEFT JOIN courses c ON c.course_id = t.course_id WHERE t.id IN (${termIds.map(() => '?').join(',')})`, termIds)
      : [];
    return { instructors, rates, sessions, terms, settlements };
  };

  app.get('/api/instructor-pay/report', wrap(async (req, res) => {
    const ym = yearMonth((req.query as any)?.month) || currentYearMonth();
    const g = await gatherReport(ym);
    res.json({ month: ym, rows: computeReport(ym, g.instructors, g.rates, g.sessions, g.terms, g.settlements) });
  }));

  app.post('/api/instructor-pay/settlements', wrap(async (req, res) => {
    const instructor_id = posInt(req.body?.instructor_id); if (!instructor_id) badRequest('شناسه مربی نامعتبر');
    const ym = yearMonth(req.body?.year_month); if (!ym) badRequest('ماه نامعتبر است');
    // The stored total is always recomputed server-side from rates/sessions, never trusted from the client.
    const g = await gatherReport(ym);
    const row = computeReport(ym, g.instructors, g.rates, g.sessions, g.terms, g.settlements).find((r) => r.instructor_id === instructor_id);
    if (!row) notFound();
    const notes = str(req.body?.notes, 2000);
    if (jsonMode()) {
      const store = readStore();
      const existing = store.settlements.find((s) => Number(s.instructor_id) === instructor_id && String(s.year_month) === ym);
      if (existing) { existing.total = row.total; existing.paid_at = new Date().toISOString(); existing.notes = notes; }
      else store.settlements.push({ id: nextId(store.settlements), instructor_id, year_month: ym, total: row.total, paid_at: new Date().toISOString(), notes });
      writeStore(store); res.json({ ok: true, total: row.total }); return;
    }
    await db.sqlExec(`INSERT INTO crm_instructor_settlements (instructor_id, year_month, total, notes) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE total = VALUES(total), paid_at = CURRENT_TIMESTAMP, notes = VALUES(notes)`,
      [instructor_id, ym, row.total, notes]);
    res.json({ ok: true, total: row.total });
  }));

  app.delete('/api/instructor-pay/settlements/:id', wrap(async (req, res) => {
    const id = posInt(req.params.id); if (!id) badRequest('شناسه نامعتبر');
    if (jsonMode()) {
      const store = readStore();
      store.settlements = store.settlements.filter((r) => Number(r.id) !== id); writeStore(store); res.json({ ok: true }); return;
    }
    const r = await db.sqlExec('DELETE FROM crm_instructor_settlements WHERE id = ?', [id]);
    if (!r.affectedRows) notFound();
    res.json({ ok: true });
  }));
}
