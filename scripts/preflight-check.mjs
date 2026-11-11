#!/usr/bin/env node
/**
 * Read-only deployment preflight for Carla CRM (see DEPLOY.md).
 *
 *   node scripts/preflight-check.mjs          # env names + migration files + build/shared checks
 *   node scripts/preflight-check.mjs --db     # also inspect the MySQL schema (SELECT / information_schema only)
 *
 * It never changes anything: no INSERT/UPDATE/ALTER/CREATE, the DB session is READ ONLY and rolled back.
 * Env VALUES are never printed, only names and OK / MISSING / format hints.
 * Exit code 1 when any ✖ check fails (⚠ warnings do not fail).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('Usage: node scripts/preflight-check.mjs [--db]\n  --db  also inspect the MySQL schema (read-only)');
  process.exit(0);
}

let failed = 0;
let warned = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ✖ ${m}`); };
const warn = (m) => { warned += 1; console.log(`  ⚠ ${m}`); };
const env = (k) => String(process.env[k] ?? '').trim();
const has = (k) => env(k) !== '';

// ── 1. Environment (names only) ─────────────────────────────────────────────
console.log('\n[1] Environment variables (values are never printed)');
const REQUIRED = [
  'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'SMS_API_KEY',
  'ZARINPAL_MERCHANT_ID', 'ZARINPAL_SANDBOX', 'ZARINPAL_CURRENCY',
  'PUBLIC_BASE_URL', 'CRM_PAYMENT_LINK_BASE',
];
// Present-but-empty is a valid value for these (empty = feature off / no test number).
const DECLARED = ['CRM_DEBT_SMS_ENABLED', 'CRM_DEBT_SMS_TEST_MOBILE'];
for (const k of REQUIRED) (has(k) ? ok(`${k} set`) : bad(`${k} MISSING or empty`));
for (const k of DECLARED) (k in process.env ? ok(`${k} declared${has(k) ? '' : ' (empty)'}`) : warn(`${k} not declared (feature defaults apply)`));

if (has('ZARINPAL_SANDBOX') && !['0', '1'].includes(env('ZARINPAL_SANDBOX'))) bad('ZARINPAL_SANDBOX must be 0 or 1');
if (env('ZARINPAL_SANDBOX') === '1') warn('ZARINPAL_SANDBOX=1 → sandbox gateway, no real money is collected');
if (has('ZARINPAL_CURRENCY') && !['IRR', 'IRT'].includes(env('ZARINPAL_CURRENCY').toUpperCase())) bad('ZARINPAL_CURRENCY must be IRR or IRT');
if (has('ZARINPAL_MERCHANT_ID')) {
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env('ZARINPAL_MERCHANT_ID'))
    ? ok('ZARINPAL_MERCHANT_ID format ok (UUID)') : bad('ZARINPAL_MERCHANT_ID bad format (expected 36-char UUID)');
}
for (const k of ['PUBLIC_BASE_URL', 'CRM_PAYMENT_LINK_BASE']) {
  if (has(k) && !env(k).startsWith('https://')) bad(`${k} must start with https://`);
}
if (has('CRM_PAYMENT_LINK_BASE') && !env('CRM_PAYMENT_LINK_BASE').endsWith('/p/')) warn('CRM_PAYMENT_LINK_BASE usually ends with /p/ (link = base + code)');
const debtSms = env('CRM_DEBT_SMS_ENABLED');
if (!['', '0', '1'].includes(debtSms)) bad('CRM_DEBT_SMS_ENABLED must be empty, 0 or 1');
if (debtSms === '1' && !has('CRM_DEBT_SMS_TEST_MOBILE')) warn('CRM_DEBT_SMS_ENABLED=1 without CRM_DEBT_SMS_TEST_MOBILE → REAL SMS to every debtor');
if (debtSms === '1' && has('CRM_DEBT_SMS_TEST_MOBILE')) ok('debt SMS in test mode (only the test mobile can receive)');
if (debtSms !== '1') ok('debt SMS hard-off (CRM_DEBT_SMS_ENABLED != 1)');

// ── 2. Migration files: static idempotency check ───────────────────────────
console.log('\n[2] Migration files (static idempotency check)');
const MIGRATIONS = [
  '20261017_theme_settings.sql',
  '20261017_instructor_pay.sql',
  '20261017_crm_online_payments.sql',
  '20261018_crm_installments.sql',
  '20261019_crm_debt_sms.sql',
];
/** Removes -- / # line comments and /* *\/ blocks outside quoted strings, then splits on ; outside strings. */
function statements(sql) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]; const n = sql[i + 1];
    if (q) { cur += c; if (c === '\\') { cur += n ?? ''; i++; } else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if ((c === '-' && n === '-') || c === '#') { while (i < sql.length && sql[i] !== '\n') i++; cur += '\n'; continue; }
    if (c === '/' && n === '*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 1; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquoted = (s) => s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
for (const file of MIGRATIONS) {
  const p = path.join('database', 'migrations', file);
  if (!fs.existsSync(p)) { bad(`${file} MISSING`); continue; }
  const problems = [];
  for (const st of statements(fs.readFileSync(p, 'utf8'))) {
    const s = unquoted(st).replace(/\s+/g, ' ').trim().toUpperCase();
    if (/^CREATE TABLE /.test(s) && !/^CREATE TABLE IF NOT EXISTS /.test(s)) problems.push('CREATE TABLE without IF NOT EXISTS');
    if (/^INSERT /.test(s) && !/^INSERT IGNORE /.test(s) && !/ ON DUPLICATE KEY UPDATE /.test(s)) problems.push('INSERT without ON DUPLICATE KEY UPDATE / IGNORE');
    if (/^ALTER TABLE /.test(s)) problems.push('bare ALTER TABLE (must be guarded via information_schema + PREPARE)');
    if (/^(DROP|TRUNCATE|DELETE|RENAME|UPDATE) /.test(s)) problems.push(`destructive statement: ${s.split(' ')[0]}`);
  }
  problems.length ? bad(`${file}: ${[...new Set(problems)].join('; ')}`) : ok(`${file} idempotent / additive`);
}

// ── 3. Build + shared SMS helper ───────────────────────────────────────────
console.log('\n[3] Build artefacts and shared/sms.ts');
fs.existsSync('dist/server.cjs') ? ok('dist/server.cjs present') : warn('dist/server.cjs missing (run npm run build)');
fs.existsSync('dist/index.html') ? ok('dist/index.html present') : warn('dist/index.html missing (run npm run build)');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if (!fs.existsSync('shared/sms.ts')) bad('shared/sms.ts missing');
else {
  ok('shared/sms.ts present');
  const serverCopy = path.resolve('..', 'shared', 'sms.ts'); // /project/kermanshahcart/shared/sms.ts on the server
  if (fs.existsSync(serverCopy)) {
    sha('shared/sms.ts') === sha(serverCopy) ? ok('shared/sms.ts == ../shared/sms.ts') : warn('shared/sms.ts differs from ../shared/sms.ts (keep them in sync; the site uses the outer copy)');
  } else warn('../shared/sms.ts not found (only expected on the server layout)');
}

// ── 4. Database (read-only, opt-in) ────────────────────────────────────────
async function checkDb() {
  console.log('\n[4] Database schema (read-only)');
  if (!['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].every(has)) { bad('DB_* not set, skipped'); return; }
  let mysql;
  try { mysql = await import('mysql2/promise'); } catch { bad('mysql2 not installed (npm install first)'); return; }
  let conn;
  try {
    conn = await mysql.createConnection({
      host: env('DB_HOST'), port: Number(env('DB_PORT') || 3306), user: env('DB_USER'),
      password: env('DB_PASSWORD'), database: env('DB_NAME'), connectTimeout: 10000,
    });
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    await conn.query('START TRANSACTION READ ONLY');
    const TABLES = [
      'app_settings', 'sms_templates',
      'crm_instructors', 'crm_instructor_rates', 'crm_instructor_sessions', 'crm_instructor_settlements',
      'crm_online_payments', 'crm_installments', 'crm_installment_links', 'crm_installment_reminders',
      'crm_debt_links', 'crm_debt_sms_log',
    ];
    const [rows] = await conn.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [TABLES]);
    const found = new Set(rows.map((r) => r.t));
    // crm_installment_reminders is only created by the migration (the reminder sender was removed from the
    // server), so a missing one is a warning: apply 20261018_crm_installments.sql to create it.
    const OPTIONAL = new Set(['crm_installment_reminders']);
    for (const t of TABLES) {
      if (found.has(t)) ok(`table ${t}`);
      else if (OPTIONAL.has(t)) warn(`table ${t} missing (unused by the server; created by 20261018_crm_installments.sql)`);
      else bad(`table ${t} MISSING (apply its migration)`);
    }
    const [col] = await conn.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_online_payments' AND COLUMN_NAME = 'installment_id'");
    col.length ? ok('column crm_online_payments.installment_id') : bad('column crm_online_payments.installment_id MISSING (20261018_crm_installments.sql)');
    if (found.has('sms_templates')) {
      const [tpl] = await conn.query("SELECT provider_template_id, enabled FROM sms_templates WHERE `key` = 'debt_balance'");
      if (!tpl.length) bad("sms_templates row 'debt_balance' MISSING (template 472328)");
      else if (String(tpl[0].provider_template_id) !== '472328') warn(`sms_templates debt_balance uses template ${tpl[0].provider_template_id}, expected 472328`);
      else if (!Number(tpl[0].enabled)) warn('sms_templates debt_balance (472328) is disabled');
      else ok('sms_templates debt_balance → 472328, enabled');
    }
    if (found.has('app_settings')) {
      const [th] = await conn.query("SELECT 1 FROM app_settings WHERE setting_key = 'theme.config'");
      th.length ? ok("app_settings 'theme.config'") : warn("app_settings 'theme.config' missing (server falls back to defaults)");
    }
    await conn.query('ROLLBACK');
  } catch (err) {
    bad(`DB check failed: ${err?.code || ''} ${String(err?.message || err).replace(/'[^']*'@/g, "'***'@")}`);
  } finally {
    try { await conn?.end(); } catch { /* ignore */ }
  }
}

if (args.has('--db')) await checkDb();
else console.log('\n[4] Database: skipped (pass --db to inspect the schema read-only)');

console.log(`\n${failed ? '✖' : '✔'} preflight: ${failed} failed, ${warned} warnings`);
process.exit(failed ? 1 : 0);
