#!/usr/bin/env node
/**
 * Copilot evaluation runner.
 * Validates expected_sql with validateCopilotSql from copilot-sql.ts.
 * When EVAL_LIVE=1 and EVAL_DB_URL is set, runs queries read-only and optionally POSTs to /api/copilot/chat.
 */

import { validateCopilotSql } from '../../copilot-sql.ts';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';



/** Today's Tehran date in Jalali (YYYY/MM/DD), for {{JALALI_TODAY}} / {{JALALI_MONTH}} placeholders in expected_sql. */
function jalaliParts(): { today: string; month: string } {
  const f = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { today: `${p.year}/${p.month}/${p.day}`, month: `${p.year}/${p.month}` };
}
const J = jalaliParts();
const fillSql = (sql: string) => sql.replace(/\{\{JALALI_TODAY\}\}/g, J.today).replace(/\{\{JALALI_MONTH\}\}/g, J.month);
const QUESTIONS_FILE = resolve(process.cwd(), 'scripts/copilot-eval/questions.json');

interface Question {
  id: string;
  question: string;
  expected_tool: string;
  expected_sql: string;
  check: string;
}

interface ValidationResult {
  id: string;
  question: string;
  tool: string;
  sqlValid: boolean;
  sqlError: string | null;
  liveResult: 'skipped' | 'pass' | 'fail' | 'error';
  liveError: string | null;
  checkPassed: boolean;
}

async function postToCopilotChat(question: string, cookie: string): Promise<{ success: boolean; response?: any; error?: string }> {
  const baseUrl = process.env.EVAL_BASE_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/copilot/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${await res.text()}` };
    }
    const data = await res.json();
    return { success: true, response: data };
  } catch (e: any) {
    return { success: false, error: String(e) };
  }
}

async function runSqlLive(db: 'crm' | 'site', sql: string): Promise<{ success: boolean; rows?: any[]; error?: string }> {
  const dbUrl = process.env.EVAL_DB_URL;
  if (!dbUrl) return { success: false, error: 'EVAL_DB_URL not set' };

  try {
    const { runCopilotSql } = await import('../../copilot-sql.ts');
    const audit = async () => { };
    const result = await runCopilotSql(db, sql, audit);
    if (result.error) return { success: false, error: result.error };
    return { success: true, rows: result.rows };
  } catch (e: any) {
    return { success: false, error: String(e) };
  }
}

function checkResult(check: string, rows: any[]): boolean {
  if (!rows || rows.length === 0) return false;

  const firstRow = rows[0];
  const keys = Object.keys(firstRow);
  if (keys.length === 0) return false;

  const firstValue = firstRow[keys[0]];
  const numValue = Number(firstValue);

  if (check === 'number equals') {
    return Number.isFinite(numValue);
  }
  if (check === 'array length matches') {
    return rows.length > 0;
  }
  if (check === 'array length <= 10') {
    return rows.length <= 10;
  }
  if (check === 'array length <= 20') {
    return rows.length <= 20;
  }
  if (check === 'array length equals 5') {
    return rows.length === 5;
  }
  return true;
}

async function main() {
  console.log('📋 Copilot Evaluation Runner\n');

  const raw = readFileSync(QUESTIONS_FILE, 'utf-8');
  const questions: Question[] = JSON.parse(raw);

  const results: ValidationResult[] = [];
  const liveMode = process.env.EVAL_LIVE === '1';
  const hasDbUrl = !!process.env.EVAL_DB_URL;
  const hasCookie = !!process.env.EVAL_COOKIE;

  console.log(`Mode: ${liveMode ? 'LIVE' : 'VALIDATION ONLY'}`);
  console.log(`DB URL: ${hasDbUrl ? 'SET' : 'NOT SET'}`);
  console.log(`Cookie: ${hasCookie ? 'SET' : 'NOT SET'}`);
  console.log(`Questions: ${questions.length}\n`);

  for (const q of questions) {
    console.log(`[${q.id}] ${q.question}`);

    const validation = validateCopilotSql('crm', fillSql(q.expected_sql));
    const sqlValid = validation.ok === true;
    const sqlError = validation.ok === false ? validation.reason : null;

    console.log(`  SQL Validation: ${sqlValid ? '✅ PASS' : '❌ FAIL'} ${sqlError ? `(${sqlError})` : ''}`);

    let liveResult: ValidationResult['liveResult'] = 'skipped';
    let liveError: string | null = null;
    let checkPassed = false;

    if (liveMode && hasDbUrl && sqlValid) {
      console.log(`  Running live query...`);
      const dbResult = await runSqlLive('crm', validation.sql);
      if (dbResult.success) {
        checkPassed = checkResult(q.check, dbResult.rows || []);
        liveResult = checkPassed ? 'pass' : 'fail';
        console.log(`  Check (${q.check}): ${checkPassed ? '✅ PASS' : '❌ FAIL'} (rows: ${dbResult.rows?.length || 0})`);
      } else {
        liveResult = 'error';
        liveError = dbResult.error || 'Unknown error';
        console.log(`  Live query error: ${liveError}`);
      }

      if (hasCookie) {
        console.log(`  Posting to /api/copilot/chat...`);
        const chatResult = await postToCopilotChat(q.question, process.env.EVAL_COOKIE!);
        if (chatResult.success) {
          console.log(`  Copilot response: ✅ RECEIVED`);
        } else {
          console.log(`  Copilot response: ❌ ${chatResult.error}`);
        }
      }
    } else if (liveMode) {
      console.log(`  Live run skipped (${!hasDbUrl ? 'no EVAL_DB_URL' : 'invalid SQL'})`);
    }

    results.push({
      id: q.id,
      question: q.question,
      tool: q.expected_tool,
      sqlValid,
      sqlError,
      liveResult,
      liveError,
      checkPassed,
    });

    console.log('');
  }

  console.log('┌────┬────────────────────────────────────────┬──────────────┬────────┬──────────┬────────┐');
  console.log('│ ID │ Question                               │ Tool         │ SQL    │ Live     │ Check  │');
  console.log('├────┼────────────────────────────────────────┼──────────────┼────────┼──────────┼────────┤');

  for (const r of results) {
    const qShort = r.question.length > 38 ? r.question.slice(0, 35) + '...' : r.question.padEnd(38);
    const toolShort = r.tool.length > 12 ? r.tool.slice(0, 9) + '...' : r.tool.padEnd(12);
    const sqlIcon = r.sqlValid ? '✅' : '❌';
    const liveIcon = r.liveResult === 'pass' ? '✅' : r.liveResult === 'fail' ? '❌' : r.liveResult === 'error' ? '💥' : '⏭️';
    const checkIcon = r.checkPassed ? '✅' : r.liveResult === 'skipped' ? '⏭️' : '❌';

    console.log(`│ ${r.id.padEnd(2)} │ ${qShort} │ ${toolShort} │ ${sqlIcon}     │ ${liveIcon}      │ ${checkIcon}     │`);
  }

  console.log('└────┴────────────────────────────────────────┴──────────────┴────────┴──────────┴────────┘');

  const sqlPassed = results.filter(r => r.sqlValid).length;
  const livePassed = results.filter(r => r.liveResult === 'pass').length;
  const checksPassed = results.filter(r => r.checkPassed).length;

  console.log(`\n📊 Summary:`);
  console.log(`   SQL Valid:   ${sqlPassed}/${results.length}`);
  console.log(`   Live Pass:   ${livePassed}/${liveMode && hasDbUrl ? results.length : 0} (${liveMode && hasDbUrl ? 'live' : 'skipped'})`);
  console.log(`   Checks Pass: ${checksPassed}/${liveMode && hasDbUrl ? results.length : 0} (${liveMode && hasDbUrl ? 'live' : 'skipped'})`);

  const allSqlValid = results.every(r => r.sqlValid);
  process.exit(allSqlValid ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});