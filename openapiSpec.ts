/**
 * OpenAPI 3.0.3 document + a static (script-free, CDN-free) Persian docs page for the public API /api/v1.
 * Served by publicApi.ts at GET /api/v1/openapi.json and GET /api/v1/docs (both public).
 */
import { WEBHOOK_EVENTS } from './webhooks';

const err = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const ok = (description: string, schema: any) => ({ description, content: { 'application/json': { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const list = (item: string) => ({
  allOf: [ref('ListMeta'), { type: 'object', properties: { data: { type: 'array', items: ref(item) } }, required: ['data'] }],
});
const q = (name: string, description: string, schema: any = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const paging = [{ $ref: '#/components/parameters/limit' }, { $ref: '#/components/parameters/offset' }];
const common = { '401': { $ref: '#/components/responses/Unauthorized' }, '429': { $ref: '#/components/responses/TooManyRequests' } };
const writeErrors = {
  ...common,
  '400': err('Validation error / خطای اعتبارسنجی'),
  '403': err('Key lacks the write scope / کلید مجوز نوشتن ندارد'),
  '404': err('Referenced record not found'),
  '409': err('Conflict (duplicate / inactive course / overpayment)'),
};
const jalali = { type: 'string', pattern: '^1[34]\\d\\d/\\d{1,2}/\\d{1,2}$', example: '1405/08/06', description: 'Jalali date yyyy/mm/dd' };

export function buildOpenApiSpec(serverUrl: string): Record<string, unknown> {
  const base = `${String(serverUrl || '').replace(/\/+$/, '')}/api/v1`;
  const webhookOps: Record<string, unknown> = {};
  for (const ev of [...WEBHOOK_EVENTS, 'ping']) {
    webhookOps[ev] = {
      post: {
        summary: `Webhook: ${ev}`,
        description: 'Sent by Ham-Taraz CRM to your URL. Verify X-Ham-Taraz-Signature before trusting the body.',
        parameters: [
          { name: 'X-Ham-Taraz-Signature', in: 'header', required: true, schema: { type: 'string' }, description: 't=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>' },
          { name: 'X-Ham-Taraz-Event', in: 'header', required: true, schema: { type: 'string', example: ev } },
          { name: 'X-Ham-Taraz-Delivery', in: 'header', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Event id (same on retries; use it to de-duplicate)' },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: ref('WebhookEvent') } } },
        responses: { '2XX': { description: 'Delivered. Any other status (or a 10s timeout) is retried after 1m, 5m, 30m, 2h, 6h.' } },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ham-Taraz CRM Public API',
      version: '1.0.0',
      description: [
        'API عمومی همتراز CRM (آموزشگاه). احراز هویت با کلید API که مدیر در «تنظیمات ← API و وب‌هوک» می‌سازد.',
        '',
        'Authentication: `Authorization: Bearer crm_live_…` or `X-API-Key: crm_live_…`. Keys have scopes `read` / `write`.',
        'Rate limit: per key, per minute (default 60). Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix seconds); 429 adds `Retry-After`.',
        'Amounts are Toman (integer). Dates are Jalali `yyyy/mm/dd`. Errors are `{ "error": "<Persian message>" }`.',
        'Webhooks: see `x-webhooks`; payloads are signed with HMAC-SHA256 (header `X-Ham-Taraz-Signature`).',
      ].join('\n'),
    },
    servers: [{ url: base }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    tags: [{ name: 'students' }, { name: 'courses' }, { name: 'enrollments' }, { name: 'payments' }, { name: 'meta' }],
    paths: {
      '/me': { get: { tags: ['meta'], summary: 'کلید فعلی / Current API key', operationId: 'getMe', responses: { '200': ok('Key info', ref('Me')), ...common } } },
      '/students': {
        get: { tags: ['students'], summary: 'فهرست کارآموزان / List students', operationId: 'listStudents',
          parameters: [...paging, q('q', 'Search name / phone / national code'), q('status', 'Student status')],
          responses: { '200': ok('Students', list('Student')), ...common } },
        post: { tags: ['students'], summary: 'ثبت کارآموز / Create student (scope write)', operationId: 'createStudent',
          description: 'Same national code = same person: the existing record is returned with `already_exists: true`.',
          requestBody: { required: true, content: { 'application/json': { schema: ref('StudentInput') } } },
          responses: { '201': ok('Created', ref('StudentCreated')), '200': ok('Already existed', ref('StudentCreated')), ...writeErrors } },
      },
      '/students/{id}': { get: { tags: ['students'], summary: 'یک کارآموز + ثبت‌نام‌ها / One student with enrollments', operationId: 'getStudent', parameters: [idParam],
        responses: { '200': ok('Student', { allOf: [ref('Student'), { type: 'object', properties: { enrollments: { type: 'array', items: ref('Enrollment') } } }] }), '404': err('Not found'), ...common } } },
      '/courses': { get: { tags: ['courses'], summary: 'فهرست دوره‌ها / List courses', operationId: 'listCourses', parameters: [...paging, q('active', 'Only active courses (1)', { type: 'string', enum: ['0', '1'] })],
        responses: { '200': ok('Courses', list('Course')), ...common } } },
      '/courses/{id}': { get: { tags: ['courses'], summary: 'یک دوره / One course', operationId: 'getCourse', parameters: [idParam], responses: { '200': ok('Course', ref('Course')), '404': err('Not found'), ...common } } },
      '/enrollments': {
        get: { tags: ['enrollments'], summary: 'فهرست ثبت‌نام‌ها / List enrollments', operationId: 'listEnrollments',
          parameters: [...paging, q('student_id', 'Filter by student', { type: 'integer' }), q('course_id', 'Filter by course', { type: 'integer' })],
          responses: { '200': ok('Enrollments', list('Enrollment')), ...common } },
        post: { tags: ['enrollments'], summary: 'ثبت‌نام در دوره / Create enrollment (scope write)', operationId: 'createEnrollment',
          description: 'Emits the `enrollment.created` webhook.',
          requestBody: { required: true, content: { 'application/json': { schema: ref('EnrollmentInput') } } },
          responses: { '201': ok('Created', ref('Enrollment')), ...writeErrors } },
      },
      '/enrollments/{id}': { get: { tags: ['enrollments'], summary: 'یک ثبت‌نام / One enrollment', operationId: 'getEnrollment', parameters: [idParam], responses: { '200': ok('Enrollment', ref('Enrollment')), '404': err('Not found'), ...common } } },
      '/payments': {
        get: { tags: ['payments'], summary: 'فهرست پرداخت‌ها / List payments', operationId: 'listPayments',
          parameters: [...paging, q('student_id', 'Filter by student', { type: 'integer' }), q('enrollment_id', 'Filter by enrollment', { type: 'integer' }), q('from', 'From Jalali date (inclusive)', jalali), q('to', 'To Jalali date (inclusive)', jalali)],
          responses: { '200': ok('Payments', list('Payment')), ...common } },
        post: { tags: ['payments'], summary: 'ثبت پرداخت / Record a payment (scope write)', operationId: 'createPayment',
          description: 'At most the remaining balance; may be split over the student\'s enrollments (oldest first). Emits `payment.succeeded`.',
          requestBody: { required: true, content: { 'application/json': { schema: ref('PaymentInput') } } },
          responses: { '201': ok('Created', { allOf: [ref('Payment'), { type: 'object', properties: { allocations: { type: 'integer' } } }] }), ...writeErrors } },
      },
      '/payments/{id}': { get: { tags: ['payments'], summary: 'یک پرداخت / One payment', operationId: 'getPayment', parameters: [idParam], responses: { '200': ok('Payment', ref('Payment')), '404': err('Not found'), ...common } } },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'API key: `crm_live_…`' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      parameters: {
        limit: { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        offset: { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
      },
      responses: {
        Unauthorized: err('Missing / invalid / revoked API key'),
        TooManyRequests: err('Rate limit exceeded (see Retry-After)'),
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        ListMeta: { type: 'object', properties: { total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } }, required: ['total', 'limit', 'offset'] },
        Me: { type: 'object', properties: { key: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, prefix: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['read', 'write'] } }, rate_limit_per_min: { type: 'integer' } } } } },
        Student: { type: 'object', properties: {
          id: { type: 'integer' }, first_name: { type: 'string' }, last_name: { type: 'string' }, father_name: { type: 'string', nullable: true },
          national_code: { type: 'string' }, phone_number: { type: 'string' }, birth_date_jalali: { type: 'string', nullable: true },
          status: { type: 'string', nullable: true }, created_at: { type: 'string', nullable: true } } },
        StudentInput: { type: 'object', required: ['first_name', 'last_name', 'national_code', 'phone_number'], properties: {
          first_name: { type: 'string' }, last_name: { type: 'string' }, national_code: { type: 'string', pattern: '^\\d{10}$' },
          phone_number: { type: 'string', example: '09121234567' }, father_name: { type: 'string' }, birth_date_jalali: jalali, address: { type: 'string' } } },
        StudentCreated: { type: 'object', properties: { student: ref('Student'), already_exists: { type: 'boolean' }, warnings: { type: 'array', items: { type: 'string' } } } },
        Course: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' }, code: { type: 'string', nullable: true }, price: { type: 'number' }, duration_days: { type: 'integer', nullable: true }, is_active: { type: 'boolean' } } },
        Enrollment: { type: 'object', properties: {
          id: { type: 'integer' }, student_id: { type: 'integer' }, course_id: { type: 'integer' }, course_number: { type: 'integer', nullable: true },
          signup_date_jalali: { type: 'string' }, final_price: { type: 'number' }, amount_paid: { type: 'number' }, remaining_debt: { type: 'number' } } },
        EnrollmentInput: { type: 'object', required: ['student_id', 'course_id'], properties: {
          student_id: { type: 'integer' }, course_id: { type: 'integer' }, course_number: { type: 'integer' },
          final_price: { type: 'number', description: 'Defaults to the course price' }, signup_date_jalali: { ...jalali, description: 'Defaults to today' } } },
        Payment: { type: 'object', properties: {
          id: { type: 'integer' }, student_id: { type: 'integer' }, enrollment_id: { type: 'integer', nullable: true }, amount: { type: 'number', description: 'Toman' },
          pay_date_jalali: { type: 'string' }, pay_method: { type: 'string' }, payment_kind: { type: 'string' }, description: { type: 'string', nullable: true } } },
        PaymentInput: { type: 'object', required: ['student_id', 'enrollment_id', 'amount'], properties: {
          student_id: { type: 'integer' }, enrollment_id: { type: 'integer' }, amount: { type: 'integer', minimum: 1, description: 'Toman' },
          pay_date_jalali: { ...jalali, description: 'Defaults to today' }, pay_method: { type: 'string', example: 'pos' }, payment_kind: { type: 'string', example: 'downpayment' }, description: { type: 'string' } } },
        WebhookEvent: { type: 'object', required: ['id', 'event', 'created_at', 'data'], properties: {
          id: { type: 'string', format: 'uuid' }, event: { type: 'string', enum: [...WEBHOOK_EVENTS, 'ping'] }, created_at: { type: 'string', format: 'date-time' },
          data: { type: 'object', description: 'enrollment.* → {enrollment, student?, tracking_code?}; payment.succeeded → {payments[], student_id, amount, source}; student.created → {student}' } } },
      },
    },
    'x-webhooks': webhookOps,
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Server-rendered docs page (no JavaScript, no external assets: works behind CSP and when CDNs are blocked). */
export function docsHtml(spec: any, specUrl: string): string {
  const resolveParam = (p: any) => (p?.$ref ? spec.components.parameters[String(p.$ref).split('/').pop() as string] : p);
  const rows: string[] = [];
  for (const [path, ops] of Object.entries<any>(spec.paths || {})) {
    for (const [method, op] of Object.entries<any>(ops)) {
      const params = (op.parameters || []).map(resolveParam).filter(Boolean)
        .map((p: any) => `<li><code>${esc(p.name)}</code> <small>(${esc(p.in)})</small> ${esc(p.description || '')}</li>`).join('');
      const body = op.requestBody?.content?.['application/json']?.schema?.$ref;
      const bodyName = body ? String(body).split('/').pop() : '';
      const req = bodyName ? (spec.components.schemas[bodyName]?.required || []) : [];
      const fields = bodyName ? Object.keys(spec.components.schemas[bodyName]?.properties || {}).map((f) => `<code>${esc(f)}${req.includes(f) ? '*' : ''}</code>`).join(' ') : '';
      rows.push(`<div class="op"><h3><span class="m ${esc(method)}">${esc(method.toUpperCase())}</span> <code dir="ltr">/api/v1${esc(path)}</code></h3>
        <p>${esc(op.summary || '')}</p>${op.description ? `<p class="d">${esc(op.description)}</p>` : ''}
        ${params ? `<ul>${params}</ul>` : ''}${fields ? `<p>بدنه (JSON): ${fields}</p>` : ''}</div>`);
    }
  }
  const events = (spec.components?.schemas?.WebhookEvent?.properties?.event?.enum || []).map((e: string) => `<code>${esc(e)}</code>`).join(' ');
  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>مستندات API همتراز</title>
<style>
body{font-family:Vazirmatn,Tahoma,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#0f172a;background:#f8fafc}
h1{font-size:1.6rem}h2{margin-top:2rem;border-bottom:1px solid #cbd5e1}h3{font-size:1rem;margin:.2rem 0}
code,pre{font-family:ui-monospace,Consolas,monospace;direction:ltr;unicode-bidi:embed}pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:.6rem;overflow:auto;text-align:left}
.op{background:#fff;border:1px solid #e2e8f0;border-radius:.8rem;padding:.6rem 1rem;margin:.6rem 0}.d{color:#475569;font-size:.9rem}
.m{display:inline-block;min-width:3.5rem;text-align:center;border-radius:.4rem;color:#fff;font-size:.8rem;padding:0 .4rem}.get{background:#0284c7}.post{background:#16a34a}
@media (prefers-color-scheme:dark){body{background:#0b1220;color:#e2e8f0}.op{background:#111827;border-color:#1f2937}.d{color:#94a3b8}}
</style></head><body>
<h1>مستندات API عمومی همتراز CRM <small>v${esc(spec.info?.version)}</small></h1>
<p>نسخهٔ ماشین‌خوان: <a href="${esc(specUrl)}">OpenAPI 3 (JSON)</a> — قابل استفاده در Postman / Insomnia / Swagger Editor.</p>
<h2>احراز هویت</h2>
<p>کلید را مدیر سیستم در «تنظیمات ← API و وب‌هوک» می‌سازد (فقط یک‌بار نمایش داده می‌شود). در هر درخواست یکی از این هدرها را بفرستید:</p>
<pre>Authorization: Bearer crm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-API-Key: crm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</pre>
<p>دسترسی‌ها: <code>read</code> برای GET و <code>write</code> برای ثبت (POST). مبالغ به تومان و تاریخ‌ها شمسی (<code>1405/08/06</code>) هستند. خطاها به شکل <code>{"error": "…"}</code> برمی‌گردند.</p>
<h2>محدودیت نرخ</h2>
<p>هر کلید در هر دقیقه سقف مشخصی دارد (پیش‌فرض ۶۰). هدرهای <code>X-RateLimit-Limit</code>، <code>X-RateLimit-Remaining</code> و <code>X-RateLimit-Reset</code> (ثانیهٔ یونیکس) در همهٔ پاسخ‌ها هست؛ در صورت عبور از سقف پاسخ <code>429</code> با <code>Retry-After</code> برمی‌گردد.</p>
<h2>مسیرها</h2>
${rows.join('\n')}
<h2>وب‌هوک‌ها</h2>
<p>رویدادها: ${events}. بدنه: <code>{"id","event","created_at","data"}</code>. هدرها: <code>X-Ham-Taraz-Event</code>، <code>X-Ham-Taraz-Delivery</code> (شناسهٔ رویداد؛ در تلاش‌های مجدد ثابت است — برای حذف تکراری‌ها) و <code>X-Ham-Taraz-Signature</code>.</p>
<p>پاسخ 2xx یعنی تحویل موفق؛ در غیر این صورت (یا پس از ۱۰ ثانیه) دوباره پس از ۱ دقیقه، ۵ دقیقه، ۳۰ دقیقه، ۲ ساعت و ۶ ساعت ارسال می‌شود (حداکثر ۶ تلاش).</p>
<pre>// Node.js (Express): verify X-Ham-Taraz-Signature on the RAW body
const crypto = require('crypto');
app.post('/ham-taraz-webhook', express.raw({ type: 'application/json' }), (req, res) =&gt; {
  const header = req.get('X-Ham-Taraz-Signature') || '';
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) =&gt; p.split('=')));
  const expected = crypto.createHmac('sha256', process.env.HAM_TARAZ_WEBHOOK_SECRET)
    .update(t + '.' + req.body.toString('utf8')).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) &lt; 300;
  if (!fresh || !v1 || v1.length !== 64 ||
      !crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'))) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString('utf8'));
  // handle event.event / event.data, de-duplicate by event.id
  res.sendStatus(204);
});</pre>
</body></html>`;
}
