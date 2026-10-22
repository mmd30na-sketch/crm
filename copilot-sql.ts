/**
 * Copilot read-only SQL tool (admin only, behind COPILOT_SQL_ENABLED=1).
 * Defence in depth: (1) node-sql-parser allows one SELECT over allowlisted tables/columns;
 * (2) MySQL runs as copilot_ro (SELECT-only grants, no secret tables/columns) with MAX_EXECUTION_TIME;
 * (3) the site SQLite file is opened readonly + query_only. Every attempt is written to crm_copilot_queries.
 */
import nodeSqlParser from 'node-sql-parser';
const Parser = (nodeSqlParser as any).Parser || nodeSqlParser;
import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';

export type SqlDb = 'crm' | 'site';
const MAX_ROWS = 200;
const MAX_RESULT_CHARS = 20000;
const TIMEOUT_MS = 5000;

/** Secret-looking column names are never readable (password, hash, token, secret, key, auth...). */
const SECRET_COL = /pass|hash|token|secret|key|auth/i;
const BLOCKED_TABLE = /^(directus_|staff_users$|otp_codes$|tblotp$|app_settings$|academy_settings$|crm_copilot_queries$)/i;
const BLOCKED_DB = /^(information_schema|performance_schema|mysql|sys|crm_import|crm_merge\w*)$/i;
/** Raw-text guard for things the AST check does not cover. */
const BLOCKED_TEXT = /\b(sleep|benchmark|load_file|get_lock|release_lock|is_free_lock|master_pos_wait|into\s+(out|dump)file|pragma|attach|detach|load_extension|readfile|writefile|sqlite_master|sqlite_schema|sqlite_temp_master|information_schema|performance_schema|for\s+update|lock\s+in\s+share\s+mode)\b/i;

const CRM_TABLES = new Set([
  'courses', 'students', 'enrollments', 'payments', 'payment_installments', 'expenses', 'expense_categories', 'bank_accounts',
  'registrations', 'site_registration_payments', 'site_accounts', 'site_checks', 'leads', 'lead_sources', 'lead_followups',
  'crm_tasks', 'crm_activities', 'crm_course_terms', 'crm_campaigns', 'crm_campaign_recipients', 'crm_audit_log',
  'messenger_threads', 'messenger_messages', 'messenger_outbox', 'enrollment_documents', 'enrollment_settle_log',
  'instructor_settlements', 'report_templates', 'id_renumber_map',
  'tblcourse', 'tblenroll', 'tblpeyment', 'tblstudents', 'tblexpenses',
  'v_daily_cashflow', 'v_enrollment_balances', 'v_expenses_by_category', 'v_messenger_thread_summary',
  'v_overdue_installments', 'v_pending_lead_followups', 'v_profit_and_loss_monthly', 'v_sales_funnel_summary',
]);
/** Site SQLite: table -> columns hidden from the tool. */
const SITE_TABLES: Record<string, string[]> = {
  users: [], registrations: [], visits: [], site_pageviews: [], otp_attempts: [], course_payments: ['authority'],
};
/** CRM tables with hidden (non-granted) columns; SELECT * on these is rejected with a clear message. */
const CRM_HIDDEN: Record<string, string[]> = { payments: ['authority'], report_templates: ['template_key'], enrollment_documents: ['template_key'] };

export const COPILOT_SQL_SCHEMA = [
  'پایگاه crm (MySQL): students(student_id, first_name, last_name, national_code, phone_number, father_name, birth_date_jalali, address, created_at)،',
  'courses(course_id, title, price تومان, is_active, capacity, duration_days)، enrollments(enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid)،',
  'payments(payment_id, enrollment_id, student_id, account_id, pay_date_jalali, amount, pay_method, payment_kind, ref_id, card_pan, description)، v_enrollment_balances(enrollment_id, student_id, course_id, final_price, amount_paid_from_payments, balance_due)،',
  'registrations(tracking_code, national_code, full_name, phone_number, category, status pending/approved/rejected, student_id, approved_at, created_at)، site_registration_payments (ممکن است هنوز وجود نداشته باشد)،',
  'leads(lead_id, first_name, last_name, phone_number, source_id, interested_course_id, status, next_followup_date_jalali)، lead_sources، crm_tasks، crm_activities، crm_course_terms(course_id, course_number, start_date, end_date, capacity, status)،',
  'expenses، expense_categories، bank_accounts، payment_installments، messenger_threads، messenger_messages، crm_campaigns، crm_audit_log، site_accounts، site_checks، Tbl* (داده قدیمی) و viewهای v_*.',
  'پایگاه site (SQLite): registrations(trackingId, nationalId, fullName, phone, category, status, timestamp ISO UTC, mysqlSynced)، users(id, phone, fullName, purchasedExams)،',
  'site_pageviews(ts, day, kind, path, visitor, referrer, device)، visits(id, count)، otp_attempts(createdAt, phone, ip, userAgent, purpose, result, reason)، course_payments(trackingId, phone, category, courseId, amountToman, status, refId, cardPan, createdAt, verifiedAt).',
  'زمان‌های datetime به UTC ذخیره شده‌اند (تهران = UTC+3:30). فقط یک دستور SELECT؛ حداکثر ۲۰۰ ردیف.',
].join('\n');

const parser = new Parser();

/** Quote the identifier after each `AS` outside string literals, so reserved-word aliases parse. Security checks then run on the quoted query. */
export function quoteBareAliases(sql: string, q: '`' | '"'): string {
  return sql.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)/).map((part, i) =>
    i % 2 ? part : part.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi, (_m, id) => `AS ${q}${id}${q}`)).join('');
}

export function validateCopilotSql(db: SqlDb, sqlRaw: string): { ok: true; sql: string; bounded: string } | { ok: false; reason: string } {
  let sql = String(sqlRaw || '').trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, reason: 'empty query' };
  if (sql.length > 4000) return { ok: false, reason: 'query too long' };
  if (sql.includes(';')) return { ok: false, reason: 'multiple statements are not allowed' };
  if (/--|\/\*|#/.test(sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''"))) return { ok: false, reason: 'comments are not allowed' };
  if (BLOCKED_TEXT.test(sql)) return { ok: false, reason: `blocked keyword/function: ${sql.match(BLOCKED_TEXT)![0]}` };
  const opt = { database: db === 'crm' ? 'MySQL' : 'Sqlite' };
  let ast: any;
  let tables: string[]; let columns: string[];
  const parseAll = (q: string) => { ast = parser.astify(q, opt); tables = parser.tableList(q, opt); columns = parser.columnList(q, opt); };
  try {
    parseAll(sql);
  } catch (e: any) {
    // Retry once with bare aliases quoted (e.g. `AS count`), which the parser rejects as reserved words.
    const quoted = quoteBareAliases(sql, db === 'crm' ? '`' : '"');
    if (quoted === sql) return { ok: false, reason: `SQL parse error: ${String(e?.message || e).slice(0, 160)}` };
    try { parseAll(quoted); sql = quoted; } catch {
      return { ok: false, reason: `SQL parse error: ${String(e?.message || e).slice(0, 160)}` };
    }
  }
  const stmts = Array.isArray(ast) ? ast : [ast];
  if (stmts.length !== 1 || stmts[0]?.type !== 'select') return { ok: false, reason: 'only a single SELECT statement is allowed' };
  if (stmts[0]?.into?.position) return { ok: false, reason: 'SELECT ... INTO is not allowed' };
  const cte = new Set<string>(((stmts[0]?.with || []) as any[]).map((w) => String(w?.name?.value ?? w?.name ?? '').toLowerCase()).filter(Boolean));
  const used = new Set<string>();
  for (const t of tables) {
    const [op, schema, name] = t.split('::');
    if (op.toLowerCase() !== 'select') return { ok: false, reason: `operation not allowed: ${op}` };
    const n = String(name || '').toLowerCase();
    if (cte.has(n)) continue;
    if (schema && schema !== 'null') {
      if (db === 'site' || BLOCKED_DB.test(schema) || schema.toLowerCase() !== 'nodejs430_carla') return { ok: false, reason: `schema not allowed: ${schema}` };
    }
    if (BLOCKED_TABLE.test(n)) return { ok: false, reason: `table not allowed: ${name}` };
    const allowed = db === 'crm' ? CRM_TABLES.has(n) : Object.prototype.hasOwnProperty.call(SITE_TABLES, n);
    if (!allowed) return { ok: false, reason: `table not in allowlist: ${name}` };
    used.add(n);
  }
  const hidden = db === 'crm' ? CRM_HIDDEN : SITE_TABLES;
  for (const c of columns) {
    const [, , col] = c.split('::');
    const cname = String(col || '');
    if (cname === '(.*)') {
      const t = [...used].find((u) => (hidden[u] || []).length);
      if (t) return { ok: false, reason: `SELECT * is not allowed on ${t}; list the columns (hidden: ${hidden[t].join(', ')})` };
      continue;
    }
    if (SECRET_COL.test(cname)) return { ok: false, reason: `column not allowed: ${cname}` };
    for (const u of used) if ((hidden[u] || []).includes(cname.toLowerCase())) return { ok: false, reason: `column not allowed: ${cname}` };
  }
  // Append LIMIT directly when the query has none (keeps ORDER BY reliable); otherwise wrap it.
  const hasLimit = Boolean(stmts[0]?.limit?.value?.length);
  const bounded = hasLimit ? `SELECT * FROM (${sql}) AS copilot_q LIMIT ${MAX_ROWS + 1}` : `${sql} LIMIT ${MAX_ROWS + 1}`;
  return { ok: true, sql, bounded };
}

let roPool: mysql.Pool | null = null;
function crmPool() {
  if (roPool) return roPool;
  const user = String(process.env.COPILOT_RO_DB_USER || '').trim();
  const password = String(process.env.COPILOT_RO_DB_PASSWORD || '');
  if (!user || !password) throw new Error('COPILOT_RO_DB_USER / COPILOT_RO_DB_PASSWORD not set');
  roPool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user, password, database: process.env.DB_NAME || 'nodejs430_carla',
    connectionLimit: 2, dateStrings: true, multipleStatements: false, connectTimeout: 5000,
  });
  return roPool;
}

let siteDb: Database.Database | null = null;
function sitePath() { return process.env.COPILOT_SITE_DB_PATH || '/project/kermanshahcart/site/app/data/database.sqlite'; }
function site() {
  if (siteDb) return siteDb;
  siteDb = new Database(sitePath(), { readonly: true, fileMustExist: true, timeout: TIMEOUT_MS });
  siteDb.pragma('query_only = ON');
  return siteDb;
}

function capRows(rows: any[]) {
  const truncatedRows = rows.length > MAX_ROWS;
  let out = rows.slice(0, MAX_ROWS);
  let json = JSON.stringify(out);
  while (json.length > MAX_RESULT_CHARS && out.length > 1) { out = out.slice(0, Math.max(1, Math.floor(out.length * 0.7))); json = JSON.stringify(out); }
  return { rows: out, truncated: truncatedRows || out.length < Math.min(rows.length, MAX_ROWS) };
}

/** Audit entry for a query that passed validation but failed in the database: logged as not allowed, with the error. */
export function executionErrorAudit(db: string, sql: string, msg: string, ms: number | null) {
  return { db, sql, allowed: false, reason: `execution error: ${String(msg).slice(0, 300)}`, rows: null, ms };
}

export async function runCopilotSql(
  dbArg: unknown, sqlArg: unknown,
  audit: (e: { db: string; sql: string; allowed: boolean; reason: string | null; rows: number | null; ms: number | null }) => Promise<void>,
): Promise<any> {
  const db: SqlDb | null = dbArg === 'crm' || dbArg === 'site' ? dbArg : null;
  const raw = String(sqlArg ?? '');
  if (!db) { await audit({ db: String(dbArg ?? ''), sql: raw, allowed: false, reason: 'database must be crm or site', rows: null, ms: null }); return { error: 'database باید crm یا site باشد.' }; }
  const v = validateCopilotSql(db, raw);
  if (v.ok === false) { await audit({ db, sql: raw, allowed: false, reason: v.reason, rows: null, ms: null }); return { error: `پرس‌وجو رد شد: ${v.reason}` }; }
  const t0 = Date.now();
  try {
    let rows: any[];
    if (db === 'crm') {
      const conn = await crmPool().getConnection();
      try {
        await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${TIMEOUT_MS}`);
        const [r] = await conn.query({ sql: v.bounded, timeout: TIMEOUT_MS + 1000 });
        rows = r as any[];
      } finally { conn.release(); }
    } else {
      const stmt = site().prepare(v.bounded);
      if (!stmt.reader) throw new Error('not a read statement');
      rows = stmt.all() as any[];
    }
    const ms = Date.now() - t0;
    const capped = capRows(rows);
    await audit({ db, sql: v.sql, allowed: true, reason: null, rows: rows.length, ms });
    return { database: db, row_count: capped.rows.length, truncated: capped.truncated, rows: capped.rows };
  } catch (e: any) {
    const ms = Date.now() - t0;
    const msg = String(e?.sqlMessage || e?.message || e).slice(0, 300);
    await audit(executionErrorAudit(db, v.sql, msg, ms));
    return { error: `اجرای پرس‌وجو ناموفق بود: ${msg}` };
  }
}
