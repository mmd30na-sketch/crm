# Trainee portal PWA (پرتال کارآموز)

URL: `https://<crm-host>/?portal=1` — mobile-first, RTL, installable (Android/Chrome "نصب برنامه", iOS "Add to Home Screen").

## Pieces
| file | role |
|---|---|
| `public/trainee-manifest.webmanifest`, `public/trainee-icon-*.png` | web app manifest (fa, rtl, standalone, start `/?portal=1`) + icons made from `logo.png` |
| `public/trainee-sw.js` | service worker: offline shell (network-first navigations, `/?portal=1` cached), stale-while-revalidate for `/assets/*` and images; **never** touches `/api/`, `/uploads/`, `/p/` |
| `src/components/TraineePortal.tsx`, `src/api/traineePortal.ts` | UI + client; manifest/SW are attached only when the portal renders, so the staff app is unchanged |
| `traineePortal.ts` | `/api/trainee-portal/*` (public routes, own token check; bypass the staff session like `/trainee-payments`) |

## Login
1. Mobile + 5-digit OTP: `POST /api/trainee-portal/otp/request {mobile}` then `/otp/verify {mobile, code}` → one signed
   trainee token per student on that mobile (30 days). The token is the same `{kind:'trainee', student_id}` token the
   existing `/api/trainee-payments/*` routes accept.
   - SMS uses the existing `sms_templates` key `otp` through `sharedSms.sendTemplate` (vars `CODE`, `code`).
   - **Off by default**: `CRM_TRAINEE_OTP_SMS_ENABLED=1` is required to send; `CRM_TRAINEE_OTP_TEST_MOBILE` restricts sends
     to that single number; `CRM_TRAINEE_OTP_TEMPLATE_KEY` overrides the key. `CRM_TRAINEE_OTP_DEV_ECHO=1` returns the code
     in the response only when `NODE_ENV !== 'production'` (local testing).
   - Same response for unknown numbers (no enumeration) and no SMS to them; per-IP (10/10 min) and per-mobile (3/10 min,
     60 s gap) send limits, 30 verifies/10 min per IP, 5 tries per code, 120 s expiry, codes stored hashed in memory only.
2. Fallback: the existing student id + last 4 digits of national code (`/api/trainee-payments/login`).

## Pages
- **جلسات من**: `GET /api/trainee-portal/lessons` (from `crm_lesson_bookings`, lesson-calendar PR; empty when the table is missing).
- **بدهی و اقساط**: `GET /api/trainee-portal/installments` (`crm_installments`, overdue flagged) + remaining per enrollment.
- **پرداخت**: existing Zarinpal flow `POST /api/trainee-payments/zarinpal/request`; the gateway return
  (`/?trainee=1&payment=ok|failed`) is routed back to the portal when the payment was started there.
- **وضعیت ثبت‌نام**: `GET /api/trainee-portal/status` (enrollments, course term status/dates, price/paid/remaining).

Offline: last successful responses are kept in `localStorage` and shown with an offline banner; paying needs a connection;
logout clears the session and cached data. No tables are created or altered.
