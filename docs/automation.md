# اتوماسیون قاعده‌محور / Rule-based automation

**رویداد → شرط → اقدام.** Admin tab «اتوماسیون» (admin only; `/api/automation/*`).

## Events
| key | source |
|---|---|
| `enrollment_created` | `POST /api/enrollments` |
| `enrollment_approved` / `enrollment_rejected` | `POST /api/registrations/:code/approve` / `reject` |
| `payment_succeeded` | `createPaymentCore` (cashier payments and approved online payments) |
| `installment_due` (`params.days_before`) / `installment_overdue` | daily scheduler, `crm_installments` (MySQL only) |
| `debt_above_threshold` (`params.threshold` Toman) | daily scheduler, `v_enrollment_balances` |
| `daily` | daily scheduler (one context: today's date) |

Scheduled rules repeat at most once per `params.repeat_days` (default 1) per entity.

## Conditions
Field comparisons (`eq neq gt gte lt lte contains not_contains empty not_empty in`) in groups `all` (AND) / `any` (OR), nested up to 3 levels, max 30 leaves. Persian digits accepted.

## Actions
`sms_template` (shared `sms.sendTemplate`, vars `name family course amount debt date due_date days_overdue tracking_code reason`), `sms_text` (shared `sms.sendText`), `task` (crm_tasks), `notify_admin` (Telegram / Rubika bot to `CRM_AUTOMATION_ADMIN_*_CHAT`), `note` (crm_activities on the student).

## Safety
- `CRM_AUTOMATION_ENABLED=1` is required for anything to run; otherwise `emit()` is a no-op and a manual «اجرای اکنون» is a dry run.
- New rules: disabled + dry-run. Dry runs only log previews in `crm_automation_runs`.
- `CRM_AUTOMATION_TEST_MOBILE` (env, wins) or the rule's test mobile receives every SMS of the rule instead of the real recipient.
- Idempotency: `UNIQUE(rule_id, dedupe_key, mode)` — the slot is reserved before any action runs.
- Rate limits: `max_per_hour` live runs per rule; `CRM_AUTOMATION_MAX_SMS_PER_DAY` SMS overall (in-memory, per process, per Tehran day).
- Run rows store masked names/mobiles only. Rule CRUD is audit-logged by the `/api` audit middleware.

## Tables (additive)
`database/migrations/20261028_crm_automation.sql` (also created at startup): `crm_automation_rules`, `crm_automation_runs`. JSON fallback: `db_store.json` → `automation_rules`, `automation_runs`.

Tests: `npm run test:automation`.
