# اقساط و یادآوری خودکار (Installments & automatic reminders)

Additive feature: three new MySQL tables — `crm_installments`, `crm_installment_links`,
`crm_installment_reminders` — plus a `installments` / `installment_links` / `installment_reminders` array in the
JSON store (`db_store.json`) fallback. No existing table, column or endpoint is changed. The server creates the
tables at boot (`CREATE TABLE IF NOT EXISTS`); `database/migrations/20261018_crm_installments.sql` documents them
and adds one NULLable `installment_id` column to the new-in-branch `crm_online_payments`.

## Installment schedule (admin/cashier)

Amounts are Toman, the same unit as `payments.amount`. An enrollment's schedule is only a plan: the remaining
balance still comes from `owedByEnrollment(final_price - payments)`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/installments?enrollment_id=&student_id=&status=&from=&to=` | list schedule rows (masked phone) |
| POST | `/api/installments` | `{enrollment_id, amount, due_date_jalali}` = one row, or `{enrollment_id, count, start_date_jalali, split:true}` = split the remaining balance into `count` monthly rows |
| PUT | `/api/installments/:id` | edit amount / due date / notes (unpaid rows only) |
| POST | `/api/installments/:id/cancel` | cancel an unpaid row |
| POST | `/api/installments/:id/link` | get-or-create the short payment link (`{code, url, expires_at, amount}`) |

A `paid` row is immutable. The split never exceeds the remaining balance (the last row absorbs the rounding
remainder), and links only exist for unpaid rows.

## Per-installment payment link (no login)

`POST /api/installments/:id/link` mints a 12-char random base62 `code` and returns
`https://<host>/p/<code>`, which redirects to `/?trainee=1&code=<code>`. The code is the auth (like the trainee
signed token) and is accepted only by:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/trainee-payments/link/:code` | installment summary to show a preset amount (404 unknown, 410 expired, 409 not payable) |
| POST | `/api/trainee-payments/link/:code/zarinpal` | start a Zarinpal payment for exactly that installment |

On a successful Zarinpal callback the linked `crm_online_payments` row (`installment_id`) marks the
installment paid and burns the link (`markLinksUsed`); approving that row still inserts the real `payments` row
through the normal `createPaymentCore` path.

## Automatic reminders (sms.ir)

A daily `node-cron` task (`CRM_REMINDER_CRON`, default `0 10 * * *`, timezone `Asia/Tehran`) finds unpaid
installments whose Jalali due date is `CRM_REMINDER_DAYS_BEFORE` days away. It reserves the
`(installment_id, send_day)` slot by inserting a `sending` log row *before* sending (a rejected
`UNIQUE(installment_id, send_day)` means another pass already owns the slot, logged `already_sent`), creates
the per-installment link and then sends one sms.ir verify-code using `SMSIR_REMINDER_TEMPLATE_ID` with params
`NAME` / `AMOUNT` / `DATE` / `LINK`; the row is then updated to `sent` / `failed`. An in-process lock makes
the cron and a manual `run-now` mutually exclusive. See `reminders.ts` and `SMSIR_API_KEY` /
`SMSIR_LINE_NUMBER` in `.env.example`.

Safety:
- `CRM_INSTALLMENT_REMINDER_ENABLED=1` is a **hard gate**: reminders run only when it is set *and* the
  settings override is not `false`. A settings value can only disable, never enable while the env flag is off;
  the task is registered only when enabled and the cron expression validates.
- `CRM_REMINDER_TEST_MOBILE` always wins: when set, every other recipient is logged as `skipped_test_mode`, so
  no real phone can be messaged by accident. A settings test mobile applies only while the env value is empty,
  and clearing it from the UI never disables an env test mobile.
- If the per-installment link cannot be created, the SMS is **not** sent with the placeholder link; the row is
  logged `failed` with error `link_failed`.
- A missing gateway config makes each attempt a logged `failed` (never a crash). The phone number is masked
  (`0912***4567`) everywhere.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/installment-reminders/settings` | current config + `env_enabled` / `test_mode` / `test_mobile_env` / `configured` |
| PUT | `/api/installment-reminders/settings` | `{enabled, days_before, template_id, cron, test_mobile}`; enabling is refused while the env flag is off |
| GET | `/api/installment-reminders/preview?days=N` | who would be messaged on the target date (no side effects) |
| GET | `/api/installment-reminders/log?limit=` | send log |
| POST | `/api/installment-reminders/run-now` | `{confirm:'ارسال', days?}`; refuses unless enabled. `dry_run:true` returns the results only and writes **no** log rows (so it can never block the real send) |

## UI

- `src/components/InstallmentsPanel.tsx` — nav tab «اقساط» (admin/cashier): list + single/split form per
  enrollment, cancel, copy payment link. Renders the admin-only reminder panel.
- `src/components/InstallmentRemindersPanel.tsx` — settings, no-side-effect preview, log, and a dry-run button
  (typing «ارسال» confirms).
- `src/components/TraineePaymentsPanel.tsx` — also renders the `/p/<code>` link page (preset amount + pay).
