/**
 * Persian RTL email templates (receipt, certificate of completion, reminder, campaign) and a tiny renderer.
 * Bodies are plain text with {placeholders}; blank lines separate paragraphs, "label: value" lines inside a
 * paragraph that starts with a [[table]] line become a two-column table, and [[certificate]] draws a framed
 * certificate box. All values are HTML-escaped; layout is table-based with inline styles for mail clients.
 */
// Template bodies, rendering, and placeholder filling were drafted with a free model (codestral) and then reviewed.
export type EmailTemplateKey = 'receipt' | 'certificate' | 'reminder' | 'campaign';
export type EmailVars = Record<string, string | number | null | undefined>;

export const EMAIL_TEMPLATES: Record<EmailTemplateKey, { title: string; subject: string; body: string; vars: string[] }> = {
  receipt: {
    title: 'رسید پرداخت',
    subject: 'رسید پرداخت شما — {academy}',
    body: `{full_name} عزیز، سلام.
پرداخت شما با موفقیت ثبت شد.

[[table]]
دوره: {course}
مبلغ: {amount} تومان
تاریخ: {date}
روش پرداخت: {pay_method}
شماره رسید: {receipt_no}
مانده بدهی: {debt} تومان

از اعتماد شما سپاسگزاریم.`,
    vars: ['name', 'family', 'full_name', 'course', 'amount', 'date', 'pay_method', 'receipt_no', 'debt', 'academy'],
  },
  certificate: {
    title: 'گواهی پایان دوره',
    subject: 'گواهی پایان دوره {course} — {academy}',
    body: `[[certificate]]
بدین‌وسیله گواهی می‌شود
{full_name}
دوره «{course}» را با موفقیت به پایان رسانده است.
تاریخ: {date}

{full_name} عزیز، این موفقیت را به شما تبریک می‌گوییم. نسخهٔ رسمی گواهی را می‌توانید از آموزشگاه دریافت کنید.`,
    vars: ['name', 'family', 'full_name', 'course', 'date', 'academy'],
  },
  reminder: {
    title: 'یادآوری',
    subject: 'یادآوری — {academy}',
    body: `{full_name} عزیز، سلام.

{message}

[[table]]
تاریخ سررسید: {due_date}
مانده بدهی: {debt} تومان

در صورت پرداخت، این پیام را نادیده بگیرید.`,
    vars: ['name', 'family', 'full_name', 'message', 'due_date', 'debt', 'course', 'academy'],
  },
  campaign: {
    title: 'کمپین ایمیلی',
    subject: 'خبری تازه از {academy}',
    body: `{full_name} عزیز، سلام.

متن پیام خود را اینجا بنویسید.`,
    vars: ['name', 'family', 'full_name', 'academy'],
  },
};

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] as string));
}

/** Replace {key} with vars[key]; unknown keys become ''. `escape` HTML-escapes the values (not the template). */
export function fillPlaceholders(tpl: string, vars: EmailVars, escape: boolean): string {
  return String(tpl).replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    const s = v === null || v === undefined ? '' : String(v);
    return escape ? escapeHtml(s) : s;
  });
}

const FONT = "Vazirmatn, Tahoma, 'Segoe UI', Arial, sans-serif";
const P = `margin:0 0 14px 0;font-family:${FONT};font-size:14px;line-height:1.9;color:#1e293b;text-align:right;direction:rtl;`;

function renderParagraph(raw: string): { html: string; text: string } {
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length) return { html: '', text: '' };
  if (lines[0] === '[[table]]') {
    const rows = lines.slice(1).map((l) => {
      const i = l.indexOf(':');
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ['', l];
    });
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px 0;direction:rtl;">${rows
      .map(([k, v]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:${FONT};font-size:13px;color:#64748b;text-align:right;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:${FONT};font-size:14px;color:#0f172a;font-weight:bold;text-align:right;">${escapeHtml(v)}</td></tr>`)
      .join('')}</table>`;
    return { html, text: rows.map(([k, v]) => (k ? `${k}: ${v}` : v)).join('\n') };
  }
  return { html: `<p style="${P}">${lines.map(escapeHtml).join('<br>')}</p>`, text: lines.join('\n') };
}

/**
 * Render subject + body (with placeholders) into { subject, html, text }. The subject is plain text (not escaped,
 * newlines stripped); every value placed in HTML is escaped exactly once.
 */
export function renderEmail(opts: {
  subject: string;
  body: string;
  vars: EmailVars;
  academyName: string;
  unsubscribeUrl?: string | null;
  preheader?: string;
}): { subject: string; html: string; text: string } {
  const academy = opts.academyName || '';
  const vars: EmailVars = { academy, ...opts.vars };
  const subject = fillPlaceholders(opts.subject, vars, false).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  let body = fillPlaceholders(opts.body, vars, false).replace(/\r\n/g, '\n');
  const certificate = /^\s*\[\[certificate\]\]\s*$/m.test(body);
  body = body.replace(/^\s*\[\[certificate\]\]\s*$/m, '');
  const paras = body.split(/\n\s*\n/).map(renderParagraph).filter((p) => p.html);
  let content = paras.map((p) => p.html).join('');
  if (certificate && paras.length) {
    const [first, ...rest] = paras;
    content = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;"><tr><td style="border:3px double #b45309;border-radius:10px;background:#fffbeb;padding:26px 18px;text-align:center;">
<div style="font-family:${FONT};font-size:20px;font-weight:bold;color:#92400e;margin-bottom:12px;">گواهی پایان دوره</div>
${first.html.replace('text-align:right', 'text-align:center')}
</td></tr></table>${rest.map((p) => p.html).join('')}`;
  }
  const unsub = opts.unsubscribeUrl
    ? `<br><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">لغو اشتراک ایمیل‌های خبری</a>`
    : '';
  const pre = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>` : '';
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;direction:rtl;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;" dir="rtl">
<tr><td style="background:#4f46e5;padding:16px 22px;font-family:${FONT};font-size:17px;font-weight:bold;color:#ffffff;text-align:right;">${escapeHtml(academy || subject)}</td></tr>
<tr><td style="padding:22px;" dir="rtl">${content}</td></tr>
<tr><td style="padding:14px 22px;background:#f8fafc;font-family:${FONT};font-size:12px;color:#64748b;text-align:center;line-height:1.8;">${escapeHtml(academy)}${unsub}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  const textParts = paras.map((p) => p.text);
  if (certificate) textParts.unshift('— گواهی پایان دوره —');
  let text = textParts.join('\n\n');
  if (academy) text += `\n\n${academy}`;
  if (opts.unsubscribeUrl) text += `\n\nلغو اشتراک ایمیل‌های خبری: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}
