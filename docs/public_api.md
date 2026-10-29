# API عمومی و وب‌هوک‌ها / Public API v1 + webhooks

- **Docs page:** `GET /api/v1/docs` (Persian, server-rendered, no external assets) · **OpenAPI 3:** `GET /api/v1/openapi.json`
- **Admin UI:** تنظیمات ← «API و وب‌هوک» (admin only): create / revoke keys, add webhooks, test, rotate secret, delivery log.
- **Code:** `publicApi.ts` (key auth, rate limit, routes, admin routes), `webhooks.ts` (subscriptions, signing, retries),
  `openapiSpec.ts` (spec + docs page), `src/components/ApiIntegrationsPanel.tsx`, migration `database/migrations/20261028_public_api.sql`.

## Auth / rate limit
`Authorization: Bearer crm_live_…` or `X-API-Key: crm_live_…`. Only `sha256(key)` is stored (`crm_api_keys.key_hash`);
the key is shown once. Scopes: `read` (GET) / `write` (POST). Per-key fixed 60-second window (default 60/min, max 1000),
headers `X-RateLimit-Limit|Remaining|Reset`, `429` + `Retry-After`. The global per-IP limit (180/min on `/api`) still applies.
Staff session tokens are **not** accepted on `/api/v1`, and API keys are not accepted anywhere else.

## Endpoints
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | key info |
| GET/POST | `/students`, GET `/students/{id}` | `?q`, `?status`; POST reuses the staff validation (same national code ⇒ existing record, `already_exists`) |
| GET | `/courses`, `/courses/{id}` | `?active=1` |
| GET/POST | `/enrollments`, GET `/enrollments/{id}` | `?student_id`, `?course_id`; POST = staff rules (active course, duplicate class check) |
| GET/POST | `/payments`, GET `/payments/{id}` | `?student_id`, `?enrollment_id`, `?from`, `?to` (Jalali); POST = staff overpay check, `pay_method` defaults to `api` |

Lists: `?limit` (1–200, default 50), `?offset` → `{data, total, limit, offset}`. Response fields are whitelisted
(no address, ID-card / photo paths, PDFs, or internal columns).

## Webhooks
Events: `student.created`, `enrollment.created` (staff or API), `enrollment.approved` / `enrollment.rejected`
(online registration review), `payment.succeeded` (staff, API, or an approved online/Zarinpal payment).
Body `{id, event, created_at, data}`; headers `X-Ham-Taraz-Event`, `X-Ham-Taraz-Delivery` (= event id, stable across retries),
`X-Ham-Taraz-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`. 2xx = delivered; otherwise retried after
1m, 5m, 30m, 2h, 6h (6 attempts), then `failed`. Targets must be `https://` public hosts (no private IPs, no redirects
followed). `CRM_WEBHOOK_ALLOW_LOCAL=1` allows `http://localhost` for local testing only — never set it on the server.

## Deploy notes
Additive only. Tables are created at boot; the migration file is optional and idempotent. No new env vars are required.
If nginx/the site proxies only some paths to the CRM, add `/api/v1/` to the proxied paths.
