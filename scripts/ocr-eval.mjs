#!/usr/bin/env node
/**
 * Accuracy check for POST /api/ocr on a running CRM, against a local folder of card photos.
 *
 * Usage:
 *   CRM_URL=http://localhost:3000 CRM_TOKEN=<cashier/admin token> node scripts/ocr-eval.mjs [dir] [expected.json]
 *
 *   dir            folder with .jpg/.jpeg/.png/.webp card images (default: ocr-eval-data)
 *   expected.json  optional map  filename -> { first_name, last_name, national_code, father_name,
 *                  birth_date_jalali, card_expiry_jalali }  (default: <dir>/expected.json when present)
 *
 * Keep the images and expected.json locally: ocr-eval-data/ is git-ignored and must never be committed.
 * Prints per-field exact-match accuracy (after normalization), checksum pass rate, needs_review rate,
 * latency, and a list of digit confusions (expected -> read) in the national code.
 */
import fs from 'fs';
import path from 'path';
import { isValidNationalCode, normalizeName, normalizeJalaliDate, normalizeNationalCode } from '../ocrValidate.ts';

const BASE = (process.env.CRM_URL || '').replace(/\/$/, '');
const TOKEN = process.env.CRM_TOKEN;
if (!BASE || !TOKEN) {
  console.error('Set CRM_URL and CRM_TOKEN. Run with: node --import tsx scripts/ocr-eval.mjs [dir] [expected.json]');
  process.exit(2);
}
const dir = process.argv[2] || 'ocr-eval-data';
const expectedPath = process.argv[3] || path.join(dir, 'expected.json');
const expected = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : {};
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const files = fs.readdirSync(dir).filter((f) => MIME[path.extname(f).toLowerCase()]).sort();
if (!files.length) { console.error(`No images in ${dir}`); process.exit(2); }

const norm = {
  first_name: normalizeName, last_name: normalizeName, father_name: normalizeName,
  national_code: normalizeNationalCode, birth_date_jalali: normalizeJalaliDate, card_expiry_jalali: normalizeJalaliDate,
};
const stats = Object.fromEntries(Object.keys(norm).map((k) => [k, { ok: 0, n: 0 }]));
const confusions = {};
let checksumOk = 0, review = 0, failed = 0, expiredCount = 0;
const latencies = [];

for (const f of files) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(path.join(dir, f))], { type: MIME[path.extname(f).toLowerCase()] });
  form.append('card', blob, f);
  const t0 = Date.now();
  let data = null;
  try {
    const res = await fetch(`${BASE}/api/ocr`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
    data = await res.json().catch(() => null);
    if (!res.ok && !data) data = null;
  } catch (e) { console.error(f, 'request failed:', e.message); }
  const ms = Date.now() - t0;
  latencies.push(ms);
  if (!data || data.success === false) { failed++; console.log(`${f}: FAILED (${ms} ms)`); continue; }
  if (isValidNationalCode(data.national_code || '')) checksumOk++;
  if (data.needs_review) review++;
  if (data.card_expired) expiredCount++;
  const exp = expected[f];
  const wrong = [];
  if (exp) {
    for (const [k, fn] of Object.entries(norm)) {
      if (exp[k] === undefined) continue;
      stats[k].n++;
      if (fn(exp[k]) === fn(data[k] || '')) stats[k].ok++; else wrong.push(k);
    }
    const e = normalizeNationalCode(exp.national_code), g = normalizeNationalCode(data.national_code);
    if (e && e !== g && e.length === g.length) {
      for (let i = 0; i < e.length; i++) if (e[i] !== g[i]) { const key = `${e[i]}->${g[i]}`; confusions[key] = (confusions[key] || 0) + 1; }
    }
  }
  const w = Object.entries(data.field_warnings || {}).flatMap(([k, v]) => v.map((x) => `${k}:${x}`));
  console.log(`${f}: ${ms} ms, review=${!!data.needs_review}, checksum=${isValidNationalCode(data.national_code || '')}, pass2=${data.second_pass || '-'}${wrong.length ? `, WRONG: ${wrong.join(',')}` : ''}${w.length ? `, warnings: ${w.join(' ')}` : ''}`);
}

const done = files.length - failed;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
console.log('\n--- summary ---');
console.log(`images: ${files.length}, read: ${done}, failed: ${failed}`);
console.log(`checksum pass rate: ${pct(checksumOk, done)}`);
console.log(`needs_review rate: ${pct(review, done)}`);
console.log(`card expired (informational): ${expiredCount}`);
latencies.sort((a, b) => a - b);
console.log(`latency ms: avg ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}, median ${latencies[Math.floor(latencies.length / 2)]}, max ${latencies[latencies.length - 1]}`);
if (Object.keys(expected).length) {
  console.log('per-field exact match:');
  for (const [k, s] of Object.entries(stats)) console.log(`  ${k}: ${s.ok}/${s.n} (${pct(s.ok, s.n)})`);
  const list = Object.entries(confusions).sort((a, b) => b[1] - a[1]);
  console.log('digit confusions (expected->read):', list.length ? list.map(([k, v]) => `${k} x${v}`).join(', ') : 'none');
} else console.log(`(no expected.json at ${expectedPath}: accuracy not computed)`);
