// Unit tests for email templates, unsubscribe tokens and config defaults (no DB, no SMTP, nothing is sent).
// Run: npm run test:email
import assert from 'node:assert/strict';
import { renderEmail, fillPlaceholders, escapeHtml, EMAIL_TEMPLATES } from '../emailTemplates.ts';
import { emailConfig, emailStatus, makeUnsubscribeToken, verifyUnsubscribeToken, maskEmail, isValidEmail, normalizeFilters, todayJalali } from '../emailService.ts';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok -', name); };

t('escapeHtml / fillPlaceholders', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(fillPlaceholders('سلام {name} {missing}!', { name: '<b>' }, true), 'سلام &lt;b&gt; !');
  assert.equal(fillPlaceholders('{name}', { name: '<b>' }, false), '<b>');
});

t('receipt renders RTL HTML with table rows and escaped values', () => {
  const tpl = EMAIL_TEMPLATES.receipt;
  const r = renderEmail({ subject: tpl.subject, body: tpl.body, academyName: 'آموزشگاه <تست>', vars: { full_name: 'علی <script>', course: 'پایتون', amount: '۱٬۰۰۰', date: '1405/08/06', pay_method: 'نقد', receipt_no: '12', debt: '۰' } });
  assert.match(r.html, /<html lang="fa" dir="rtl">/);
  assert.ok(!r.html.includes('<script>'), 'value must be escaped');
  assert.ok(r.html.includes('علی &lt;script&gt;'));
  assert.ok(r.html.includes('آموزشگاه &lt;تست&gt;'));
  assert.ok(r.html.includes('<table role="presentation"') && r.html.includes('مبلغ'));
  assert.equal(r.subject, 'رسید پرداخت شما — آموزشگاه <تست>'); // subject is plain text
  assert.ok(r.text.includes('مبلغ: ۱٬۰۰۰ تومان') && !r.text.includes('&lt;'));
  assert.ok(!r.html.includes('لغو اشتراک'), 'transactional mail has no unsubscribe link');
});

t('certificate draws the framed box', () => {
  const tpl = EMAIL_TEMPLATES.certificate;
  const r = renderEmail({ subject: tpl.subject, body: tpl.body, academyName: 'X', vars: { full_name: 'سارا', course: 'طراحی', date: '1405/08/06' } });
  assert.ok(r.html.includes('border:3px double') && r.html.includes('گواهی پایان دوره'));
  assert.ok(!r.html.includes('[[certificate]]') && !r.text.includes('[[certificate]]'));
});

t('campaign footer has the unsubscribe link (html + text); subject newlines stripped', () => {
  const r = renderEmail({ subject: 'خبر\r\nBcc: x@y.z', body: 'سلام {full_name}', academyName: 'A', vars: { full_name: 'رضا' }, unsubscribeUrl: 'https://crm.example/api/email/unsubscribe?t=a.b' });
  assert.ok(r.html.includes('href="https://crm.example/api/email/unsubscribe?t=a.b"'));
  assert.ok(r.text.includes('https://crm.example/api/email/unsubscribe?t=a.b'));
  assert.ok(!/[\r\n]/.test(r.subject));
});

t('unsubscribe token round-trip, tamper and wrong secret', () => {
  const tok = makeUnsubscribeToken('User@Example.com', 's3');
  assert.equal(verifyUnsubscribeToken(tok, 's3'), 'user@example.com');
  assert.equal(verifyUnsubscribeToken(tok, 'other'), null);
  assert.equal(verifyUnsubscribeToken(tok.slice(0, -1) + (tok.endsWith('0') ? '1' : '0'), 's3'), null);
  const forged = Buffer.from('victim@example.com').toString('base64url') + '.' + tok.split('.')[1];
  assert.equal(verifyUnsubscribeToken(forged, 's3'), null);
  assert.equal(verifyUnsubscribeToken(tok, ''), null);
  assert.equal(verifyUnsubscribeToken('garbage', 's3'), null);
});

t('maskEmail / isValidEmail', () => {
  assert.equal(maskEmail('someone@example.com'), 'so***@example.com');
  assert.equal(maskEmail('a@b.co'), 'a***@b.co');
  assert.equal(maskEmail('bad'), '');
  assert.ok(isValidEmail('a.b+c@example.ir'));
  assert.ok(!isValidEmail('a@b'));
  assert.ok(!isValidEmail('a b@example.com'));
  assert.ok(!isValidEmail('x@y.com\r\nBcc: z@w.com'));
});

t('config: off by default, test override validated, sane limits', () => {
  const keys = ['CRM_EMAIL_ENABLED', 'CRM_EMAIL_TEST_TO', 'SMTP_HOST', 'CRM_EMAIL_FROM', 'CRM_EMAIL_MAX_PER_HOUR', 'CRM_EMAIL_THROTTLE_MS', 'SMTP_PASS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  let c = emailConfig();
  assert.equal(c.enabled, false); assert.equal(c.configured, false); assert.equal(c.maxPerHour, 100); assert.equal(c.throttleMs, 1500); assert.equal(c.port, 587);
  process.env.CRM_EMAIL_TEST_TO = 'not-an-email';
  assert.equal(emailConfig().testTo, '');
  process.env.CRM_EMAIL_TEST_TO = 'qa@example.com'; process.env.CRM_EMAIL_MAX_PER_HOUR = '999999'; process.env.SMTP_PASS = 'hunter2';
  c = emailConfig();
  assert.equal(c.testTo, 'qa@example.com'); assert.equal(c.maxPerHour, 10000);
  const st = JSON.stringify(emailStatus());
  assert.ok(!st.includes('hunter2') && !st.includes('qa@example.com') && st.includes('qa***@example.com'));
  keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

t('normalizeFilters', () => {
  assert.deepEqual(normalizeFilters({ target: 'evil' }), { target: 'all' });
  assert.deepEqual(normalizeFilters({ target: 'course', course_id: '7' }), { target: 'course', course_id: 7 });
  assert.deepEqual(normalizeFilters({ target: 'debtors' }), { target: 'debtors', min_debt: 1 });
});

t('todayJalali format', () => {
  assert.equal(todayJalali(new Date('2026-10-28T12:00:00Z')), '1405/08/06');
});

console.log(`\n${n} email tests passed`);
