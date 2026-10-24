# پیامک مانده بدهی با لینک پرداخت (Remaining-debt SMS)

For every trainee who still owes tuition the CRM can send **one SMS a day** with the trainee's first name,
the **whole remaining balance**, and a short payment link for that full amount. Implemented in
`debtSms.ts`; additive only.

## Data (additive)

Two new tables (JSON-store fallback in `db_store.json.debt_links` / `debt_sms_log`):

| Table | Purpose |
| --- | --- |
| `crm_debt_links` | `code` (12-char base62 PK), `student_id`, `amount` (Toman = full remaining balance at send time), `expires_at` (default +7 days), `used_at`, `online_payment_id`, `created_at` |
| `crm_debt_sms_log` | `student_id`, `send_day` (Jalali `yyyy/mm/dd`, Tehran), `mobile_masked`, `amount`, `link_code`, `status` (`sending`/`sent`/`failed`/`skipped_test_mode`), `provider_message_id`, `error`, `created_by`, `created_at`, `UNIQUE(student_id, send_day)` |

Nothing existing is altered or dropped. The legacy `crm_installments` / `crm_installment_links` /
`crm_installment_reminders` tables are left in place; links minted before this change still resolve (see
below). The balance itself keeps coming from `v_enrollment_balances` (MySQL) or `owedByEnrollment()` (JSON) —
the feature never creates or changes money.

## Safety rules

- `CRM_DEBT_SMS_ENABLED=1` is a **hard gate**: nothing is sent unless it is set *and* the settings value is
  not `false`. Settings can only disable, never enable while the env flag is off.
- `CRM_DEBT_SMS_TEST_MOBILE`, when set, is the **only** number that can ever receive; every other eligible
  trainee is written to the log as `skipped_test_mode`. The env value always wins over a settings value,
  which can only apply while the env value is empty.
- **One SMS per trainee per day**: the `(student_id, send_day)` slot is reserved as `sending` *before*
  sms.ir is called (`UNIQUE` key). A rejected insert means another run already handled that trainee today.
  The row is then updated to `sent` or `failed`.
- A bulk run holds an in-process lock, so two bulk runs can never overlap in one process.
- **Preview / dry runs** create no links and write no log rows.
- Full phone numbers and the API key are never stored; only the masked phone is.

## SMS content

The text comes from the sms.ir template (default `472328`, «مانده بدهی»); the CRM only passes params:

- `NAME` — trainee's first name (or full name, else «کارآموز»).
- `AMOUNT` — Toman with Persian thousands separators and **no** «تومان» (the template has it), e.g.
  `۱٬۵۰۰٬۰۰۰`.
- `CODE` — the 12-char link code only (not the URL).

The preview text is «{NAME} عزیز، مانده بدهی شما {AMOUNT} تومان است. پرداخت: {LINK}».

## Endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/debt-sms/settings` | admin/cashier | gate / test-mode / template status |
| PUT | `/api/debt-sms/settings` | **admin** | enable (only if the env gate is on), template id, test mobile |
| GET | `/api/debt-sms/preview?term_id=` | admin/cashier | no-side-effect list of debtors (`would_send`, `reason`, `text_preview`) |
| POST | `/api/debt-sms/student/:id` | admin/cashier | send to one trainee (`{confirm:'ارسال'}`) |
| POST | `/api/debt-sms/bulk` | admin/cashier | send to all filtered debtors (`{confirm:'ارسال', term_id?, student_ids?, dry_run?}`) |
| GET | `/api/debt-sms/log` | admin/cashier | recent send log |

`term_id` filters by a `crm_course_terms` row (same course + course number), like `phase4.ts`.

## Payment link

The public URL is `CRM_PAYMENT_LINK_BASE` (default `https://kermanshahcart.ir/p/`) + the code; `/p/<code>`
redirects the SPA to the trainee panel with the amount preset, served by the trainee routes in
`onlinePayments.ts`:

- `GET /api/trainee-payments/link/:code` — `kind:'debt'`, the link amount and the live `debt_total`.
- `POST /api/trainee-payments/link/:code/zarinpal` — charges `min(link amount, balance still owed)`; refuses
  when the link is expired/used or the balance is now 0. On success the online payment is created against
  the trainee's **oldest owing enrollment** (like `splitPayment`), the link is linked to the payment and
  burned (idempotent), and the usual cashier approval step posts a real `payments` row
  (`payment_kind='debt'`).

Debt links and the legacy installment links use separate resolvers; the debt resolver runs first and the
installment resolver is the fallback.

## UI

- `DebtSmsPanel.tsx` («ارسال به بدهکاران»): term filter, per-row remove, typed «ارسال» confirmation, dry run,
  bulk send, gate/test-mode/template status and the send log.
- The trainee profile card in `StudentsList.tsx` has an «ارسال پیامک بدهی» button (shown while the balance is
  positive) that opens a dialog with the balance, masked mobile, gate/test-mode status and a typed
  confirmation.

## Env

```
CRM_DEBT_SMS_ENABLED=            # hard gate, off by default
CRM_DEBT_SMS_TEST_MOBILE=        # only this number may receive while set
SMS_API_KEY=                     # shared SMS helper (../shared/sms); never stored in DB/JSON
CRM_PAYMENT_LINK_BASE=https://kermanshahcart.ir/p/
```

## SMS transport (CRM main, Oct 2026)

Sending goes through the shared SMS helper `../shared/sms` (`sendTemplate('debt_balance', mobile, {NAME, AMOUNT, CODE})`).
The `sms_templates` row `debt_balance` (channel_kind `verify`, provider_template_id `472328`, param_names
`NAME,AMOUNT,CODE`; the template text renders the link as `kermanshahcart.ir/p/#CODE#`) is the canonical
source; when the row is missing, the configured template id (settings `debt_sms.template_id`, default 472328)
is used with params `NAME,AMOUNT,CODE`. The old direct `smsir-js` SDK / `SMSIR_*` env vars are no longer used.
