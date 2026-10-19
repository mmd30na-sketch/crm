#!/usr/bin/env node
/**
 * Local scanner bridge.
 *
 * Browsers cannot talk to a USB/network scanner, so the desktop that has the scanner
 * runs this tiny helper. The CRM page calls http://127.0.0.1:8765/scan, the helper runs
 * the scan command you configure and returns the image, and the page then saves it and
 * extracts the student's data exactly like an uploaded file.
 *
 *   SCANNER_COMMAND='"C:\Program Files\NAPS2\NAPS2.Console.exe" -o "{out}" --noprofile --driver wia --dpi 300' \
 *     node scripts/scanner-bridge.mjs
 *
 * {out} is replaced with the file path the command must write (.jpg).
 * See scripts/SCANNER.md for Windows / Linux examples.
 */
import http from 'node:http';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.SCANNER_PORT || 8765);
const COMMAND = process.env.SCANNER_COMMAND || '';
const TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS || 90_000);
const ALLOWED_ORIGINS = (process.env.SCANNER_ALLOWED_ORIGINS ||
  'https://crm.mmd30na.cloud,https://mmd30na-sketch.github.io,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

let busy = false;

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chrome's Private Network Access: public site -> loopback needs this on the preflight.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    return true;
  }
  return !origin; // no Origin header = not a browser page (curl, health checks)
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  return null;
}

function runScan() {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `crm-scan-${Date.now()}.jpg`);
    const cmd = COMMAND.replaceAll('{out}', out);
    exec(cmd, { timeout: TIMEOUT_MS, windowsHide: true }, (err, _stdout, stderr) => {
      const cleanup = () => fs.unlink(out, () => {});
      if (err) { cleanup(); return reject(new Error((stderr || err.message).toString().trim().slice(0, 300))); }
      fs.readFile(out, (readErr, buf) => {
        cleanup();
        if (readErr) return reject(new Error('اسکنر فایلی تحویل نداد. مسیر {out} را در دستور بررسی کنید.'));
        if (!imageType(buf)) return reject(new Error('خروجی اسکنر تصویر JPG/PNG نیست.'));
        resolve(buf);
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) return json(res, 403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, { ok: true, configured: !!COMMAND, busy });
  }
  if (req.method === 'POST' && req.url === '/scan') {
    if (!COMMAND) return json(res, 503, { error: 'SCANNER_COMMAND تنظیم نشده است.' });
    if (busy) return json(res, 409, { error: 'اسکنر در حال کار است.' });
    busy = true;
    try {
      const image = await runScan();
      res.writeHead(200, { 'Content-Type': imageType(image), 'Cache-Control': 'no-store' });
      res.end(image);
    } catch (err) {
      json(res, 500, { error: `اسکن ناموفق بود: ${err.message}` });
    } finally {
      busy = false;
    }
    return;
  }
  json(res, 404, { error: 'Not found' });
});

// Loopback only: nothing else on the network can reach the scanner through this helper.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Scanner bridge on http://127.0.0.1:${PORT}  (command ${COMMAND ? 'configured' : 'NOT configured'})`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
