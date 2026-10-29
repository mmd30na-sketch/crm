# Email: transactional + campaigns / ایمیل تراکنشی و کمپین

## Safety defaults / پیش‌فرض‌های ایمنی
- `CRM_EMAIL_ENABLED` is off by default. Until it is `1` **and** `SMTP_HOST` and `CRM_EMAIL_FROM` are set, every
  attempt is logged as `skipped_disabled` and nothing leaves the server.
- Every send API and screen defaults to **dry-run**: it only writes a `dry_run` row to the log.
- `CRM_EMAIL_TEST_TO`: when set, **every** real email goes to that one address instead of the trainee. The subject
  gets a `[TEST]` prefix and the log row is marked `test_override`.
- Rate limits:
  - `CRM_EMAIL_MAX_PER_HOUR` (default 100; `0` blocks all real sends). The count comes from the log plus an
    in-process counter.
  - `CRM_EMAIL_THROTTLE_MS` sets the delay between campaign emails (default 1500).
  - A campaign that hits the hourly cap stops; it is not queued.
- Campaigns: a real send needs all of the following. Only one campaign can send at a time.
  - `CRM_EMAIL_ENABLED=1` and SMTP configured.
  - `CRM_EMAIL_UNSUB_SECRET`.
  - The typed confirmation «ارسال».
- Campaign emails carry a signed unsubscribe link (HMAC-SHA256) in the footer, plus `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers (one-click). Unsubscribed addresses are skipped (`skipped_unsubscribed`).
  Transactional mail (receipts, certificates, reminders) has no unsubscribe link.
- Privacy:
  - The log and the UI only show masked addresses (`ab***@domain`).
  - Unsubscribes are stored as `sha256(lower(email))`.
  - SMTP credentials are never returned by the API or logged; transport errors are reduced to a code with
    addresses removed.

## Configuration (`.env`, names only in `.env.example`)
`CRM_EMAIL_ENABLED`, `CRM_EMAIL_TEST_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
`CRM_EMAIL_FROM`, `CRM_EMAIL_FROM_NAME`, `CRM_EMAIL_MAX_PER_HOUR`, `CRM_EMAIL_THROTTLE_MS`, `CRM_EMAIL_UNSUB_SECRET`.
Campaign unsubscribe links use `PUBLIC_BASE_URL` (falls back to the request host).

## Data
Additive tables (`database/migrations/20261028_crm_email.sql`, also created at boot):
- `crm_email_contacts`: students have no email column, so addresses are kept here.
- `crm_email_unsubscribes`
- `crm_email_templates` (overrides)
- `crm_email_campaigns`
- `crm_email_log`

MySQL is required; on the JSON fallback store the endpoints return 503.

## Templates
Built-in Persian RTL templates in `emailTemplates.ts`: `receipt`, `certificate`, `reminder`, `campaign`. Admins can
override the subject and body (and reset them).
- The body is plain text with `{placeholders}`. Paragraphs are separated by a blank line.
- A paragraph starting with `[[table]]` turns its `label: value` lines into a table.
- `[[certificate]]` draws a framed certificate.
- HTML is table-based with inline styles. Every value is escaped, and the subject is plain text with newlines
  removed.

Variables:
- Common: `name`, `family`, `full_name`, `course`, `date`, `debt`, `academy`.
- Receipt: `amount`, `pay_method`, `receipt_no`, taken from `payment_id`, which must belong to the student.
- Reminder: `message`, `due_date`.

## API (admin + cashier unless noted)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/email/status` | flags only; no secrets |
| GET / PUT | `/api/email/contacts[/:studentId]` | `{email}`; empty removes |
| GET | `/api/email/templates` | |
| PUT / DELETE | `/api/email/templates/:key` | admin |
| POST | `/api/email/templates/:key/preview` | sample or real student vars; never sends |
| POST | `/api/email/send` | `{template_key, student_id, payment_id?, enrollment_id?, vars?, dry_run (default true)}` |
| POST | `/api/email/campaigns/preview` | admin; audience counts and a rendered sample; never sends |
| GET / POST | `/api/email/campaigns` | admin; create draft `{name, subject, body, filters}` |
| POST | `/api/email/campaigns/:id/send` | admin; `{dry_run, confirm:'ارسال'}`; runs in the background |
| POST | `/api/email/campaigns/:id/cancel` | admin |
| GET | `/api/email/log` | `kind`, `status`, `campaign_id`, `limit`, `offset` |
| GET / POST | `/api/email/unsubscribe?t=` | **public**, HMAC-verified; RTL confirmation page |

Audience filters: `all` (students with an email), `course` (enrolled in `course_id`), `debtors` (total balance ≥
`min_debt`). Capped at 5000 recipients.

## Automation
`sendTemplateEmail(key, studentId, {dryRun, ...})` is exported for an automation "send email" action. It is not
wired yet, because the automation engine (PR #8) is not on `main`.

## Tests
`npm run test:email` runs pure tests: rendering and escaping, tokens, masking, config defaults and filters.
