# پرداخت آنلاین اقساط کارآموز (Online installment payments)

Additive feature: a new table `crm_online_payments` (MySQL) and a `online_payments` array in the JSON store
(`db_store.json`) fallback. No existing table, column or endpoint is changed. `POST /api/payments` keeps its
behaviour; its body was extracted into `createPaymentCore()` so admin approval can reuse the exact same path.

## Trainee identification (no trainee login existed)

The CRM only had staff auth (JWT-ish HMAC session tokens). Trainees are not staff, so two minimal entry
points were added; both mint the same short-lived **signed token**:

1. **Signed link (primary)** — staff (admin/cashier) calls
   `POST /api/online-payments/link/:studentId` and sends the returned URL to the trainee:
   `https://<host>/?trainee=1&t=<token>` (valid 7 days).
2. **Lookup (fallback)** — the trainee enters their student id and the **last 4 digits of their national
   code** at `POST /api/trainee-payments/login`; the server compares against the stored national code and
   returns a 2-hour token. Rate limited per IP (15 / 10 min).

The token is `signToken({ kind: 'trainee', student_id })` and is only accepted by `/api/trainee-payments/*`
(these routes bypass the staff middleware); the staff API refuses it. The SPA detects `trainee=1` and renders
`TraineePaymentsPanel` without a staff session.

## Trainee endpoints (token via `Authorization: Bearer` or `?t=`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/trainee-payments/login` | student id + national last 4 -> token |
| GET | `/api/trainee-payments/me` | own enrollments with remaining balance |
| GET | `/api/trainee-payments/payments` | own submissions + statuses |
| POST | `/api/trainee-payments/zarinpal/request` | start a Zarinpal installment (`{enrollment_id, amount}`; capped at remaining) |
| GET | `/api/trainee-payments/zarinpal/callback` | Zarinpal return (`Authority`,`Status`) -> verify -> redirect to SPA |
| POST | `/api/trainee-payments/receipt` | multipart `receipt` (image/PDF, <=8MB) + `{enrollment_id, amount}` |
| GET | `/api/trainee-payments/receipts/:id/file` | stream own uploaded receipt |
| GET | `/api/trainee-payments/link/:code` | public short-link info (`kind: 'debt' \| 'installment'`; the code is the auth) |
| POST | `/api/trainee-payments/link/:code/zarinpal` | start a Zarinpal payment from a short link |

## Short payment links

`/p/<code>` redirects to `/?trainee=1&code=<code>`. The code is a 12-char base62 value from
`crm_debt_links` (remaining-debt SMS, see `docs/debt_sms.md`) or the legacy `crm_installment_links`; the
debt resolver runs first and the installment resolver is the fallback. A debt link charges its full amount
capped at the balance still owed; an installment link charges its own amount capped at that enrollment's
remaining balance. The online payment created from a debt link is attached to the trainee's oldest owing
enrollment and the link is burned on a successful verify (idempotently).

## Staff endpoints (admin/cashier session)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/online-payments?status=pending` | review list (masked phone) |
| POST | `/api/online-payments/:id/approve` | insert a real `payments` row via `createPaymentCore` |
| POST | `/api/online-payments/:id/reject` | reject with `admin_note` |
| POST | `/api/online-payments/link/:studentId` | mint a trainee signed link |

## Zarinpal

See `zarinpal.ts` and `zarinpalSettings.ts`. Sandbox by default (`ZARINPAL_SANDBOX !== '0'`).

### Settings → درگاه پرداخت

Admin-only page (`GET/POST /api/settings/zarinpal`, `POST /api/settings/zarinpal/test`,
`GET /api/settings/zarinpal/transactions`). Values are stored in the JSON settings store under
`settings.gateways.zarinpal` (no SQL migration). Each field: saved value > env > default:

| Field | Env fallback |
|---|---|
| merchant id | `ZARINPAL_MERCHANT_ID` (then legacy `settings.gateways.zarinpal_merchant_id`) |
| sandbox | `ZARINPAL_SANDBOX` (anything but `0` = sandbox) |
| currency | `ZARINPAL_CURRENCY` (`IRR` default) |
| public base | `PUBLIC_BASE_URL` (else request host) |
| payment link base | `CRM_PAYMENT_LINK_BASE` (else `https://kermanshahcart.ir/p/`) |
| access token | `ZARINPAL_ACCESS_TOKEN` |

With nothing saved the behavior is identical to the env-only setup. The browser only ever gets the last 4
chars of the merchant id and `access_token_set`. «تست اتصال» checks the merchant UUID format and, when a
token is set, runs `query { Me { id } }` on `https://next.zarinpal.com/api/v4/graphql/` (a leading `Bearer `
and whitespace are stripped). «همگام‌سازی تراکنش‌های زرین‌پال» is read-only: `Terminals` + `Session`
(all statuses, no `filter`, paged with limit/offset until a short page, de-duplicated by id; amounts in Rial shown as Toman, card masked to the last 4); nothing is stored. The page lives under «تنظیمات > تنظیمات هم‌راز», next to a read-only هم‌راز status card (`GET /api/settings/copilot-status`). Only GraphQL
`query` operations are sent — the helper rejects `mutation`.

Amounts are stored in Toman and sent as
Rial (`ZARINPAL_CURRENCY=IRT` to send Toman directly). No key is hardcoded and nothing calls the gateway at
build/boot time.
