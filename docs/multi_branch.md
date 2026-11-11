# Multi-branch (چندشعبه)

Built to stay **dormant** until the academy really opens a second branch.

| state | what happens |
|---|---|
| `CRM_MULTI_BRANCH` unset (default) or JSON mode (no MySQL) | nothing: no DDL, no filtering, no menu item; `/api/branches/config` → `{enabled:false}`, other `/api/branches*` → 404 |
| `CRM_MULTI_BRANCH=1`, one active branch | at start-up: `crm_branches` + `crm_user_branches` are created, a default branch «شعبه مرکزی» (`main`) is added, `branch_id` is added to the scoped tables and every existing row is backfilled to it. Admin gets the «شعبه‌ها» page. **No filtering, no switcher**: the CRM works exactly as before |
| `CRM_MULTI_BRANCH=1`, 2+ active branches | scoping below is active; the header shows a branch picker (only for users with 2+ branches) |

Deactivating every branch except one returns to the dormant behaviour. Rollback = unset the flag (columns/tables stay, unused).

## Data
- `crm_branches(id, code, name, is_default, is_active, academy_name, address, phone, sms_sender_line, manager_name, …)`
- `crm_user_branches(username, branch_id)` — username lower-case (env admin, local or MySQL staff).
- `branch_id INT UNSIGNED NULL` + `idx_branch_id` on: `students, enrollments, courses, payments, expenses, crm_instructors`
  and, when the lesson-calendar tables exist (PR #10), `crm_vehicles, crm_lesson_bookings` (picked up at start-up or
  within ~1 minute of the tables appearing; start-up order does not matter).
- **`NULL` always means the default branch**, so a row missed by stamping is never lost, it shows in the default branch.
- Migration: `database/migrations/20261028_multi_branch.sql` (idempotent; the server runs the same steps itself).

## Who sees what
- **Admin**: all branches («همه شعبه‌ها», default) or one branch picked in the header.
- **Other roles**: the branches assigned in «شعبه‌ها → کاربران و شعبه»; nobody assigned → the default branch only.
  A request for a branch the user does not have → 403.
- The picked branch is sent as header `x-branch-id` (sessionStorage `carla_crm_branch`, added to every `/api/` fetch).

## Scoping (2+ branches)
- Lists filtered on the response: `GET /api/students, /enrollments, /courses, /payments, /expenses,
  /instructor-pay/instructors, /lessons/vehicles, /lessons/bookings`. A student is visible in their home branch **and** in
  every branch where they have an enrollment.
- By-id routes (`/api/students/:id/*`, `/enrollments/:id/*`, `/courses/:id`, `/instructor-pay/instructors/:id`,
  `/lessons/vehicles/:id`, `/lessons/bookings/:id`) of another branch → 404.
- New rows: students, courses, expenses, instructors, vehicles, bookings get the active branch (or `branch_id` in the
  body if allowed; admin in «همه» → default). Enrollments take their **course's** branch, payments their
  **enrollment's** branch (filled right after the write and every 5 minutes; website registrations → default branch).
- Everything the front-end computes from those lists (accounting, debtors, dashboards) becomes per-branch automatically.

## Per-branch settings & reports
- «شعبه‌ها» page (admin): create/edit branches (code, name, academy name, address, phone, SMS sender line, manager,
  active), set default, assign users, and «گزارش شعب»: per-branch students, enrollments, tuition, received, expenses and
  remaining, with optional Jalali range (`GET /api/branches/report?from=1405/08/01&to=1405/08/30`).
- `GET /api/branches/active-settings` returns the active branch's academy info.
- Free-text (bulk) SMS sent while working in one branch use that branch's `sms_sender_line` when set (shared helper
  `sendText(..., { lineNumber })`); otherwise the global line. sms.ir *verify* templates have no sender line.

## Not scoped yet (follow-ups)
Copilot SQL/tools, messenger/leads/tasks/campaigns, debt-SMS candidate lists, course terms, instructor-pay reports,
website-registration review, audit log, print templates (still use the global academy name), the public REST API
(PR #9) and automation rules (PR #8). Admins see everything anyway; for **restricted non-admin users** these screens
still show all branches, so restrict those roles' menus until they are scoped.

## Local test (never against production)
`scripts/test-branches.mjs <off|one|multi>` against a throwaway MySQL + local build (see the header of the script).
