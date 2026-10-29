# Practical-lesson calendar (تقویم جلسات عملی)

Staff tab **تقویم جلسات عملی** (admin + cashier). Backend: `lessonCalendar.ts`, pure helpers: `lessonCore.ts`
(tested by `npm run test:lessons`). MySQL only (the routes answer 503 when the CRM runs on the JSON store).

## Data (additive, `database/migrations/20261028_lesson_calendar.sql`, also created at startup)
| table | purpose |
|---|---|
| `crm_vehicles` | training cars / motorcycles (name, plate, kind, gearbox, active) |
| `crm_instructor_availability` | weekly hours per instructor (`weekday` 0 = شنبه … 6 = جمعه, `HH:MM`) |
| `crm_lesson_bookings` | student + instructor (`crm_instructors`) + optional vehicle, Jalali `lesson_date`, `start_time`/`end_time`, status `scheduled/done/cancelled/no_show`, notes, reminder state, `instructor_session_id` |

Instructors are the existing حق‌التدریس instructors (`crm_instructors`). Nothing existing is altered.

## Rules
- **Conflicts**: a booking is rejected (HTTP 409 with the conflicting bookings) when the same instructor, vehicle
  or student already has a `scheduled`/`done` booking overlapping `[start, end)` on the same date. Check + write run
  under a MySQL named lock (`GET_LOCK('crm_lesson_booking')`) so two clerks cannot double-book concurrently.
  Restoring a cancelled booking is conflict-checked too.
- **Availability**: if an instructor has availability rows, a booking outside them needs an explicit
  "force" confirmation (stored as a warning); instructors without rows are unrestricted.
- **Instructor pay link**: marking a lesson **برگزار شد** can log one `crm_instructor_sessions` row
  (date, duration in hours, note `جلسه عملی #id`), so per-session rates in حق‌التدریس pick it up. It is logged once.
- Moving a booking (date/time change) resets its reminder state so a new reminder can go out.

## SMS reminder (off by default)
| env | default | meaning |
|---|---|---|
| `CRM_LESSON_SMS_ENABLED` | unset (off) | `1` is the hard gate; without it the job never starts and "real send" returns 400 |
| `CRM_LESSON_SMS_TEST_MOBILE` | unset | when set, **every** reminder goes only to this number (test mode) |
| `CRM_LESSON_SMS_HOURS_BEFORE` | `24` | window before the lesson start (Asia/Tehran) |
| `CRM_LESSON_SMS_TEMPLATE_KEY` | `class_time` | `sms_templates` key used through `sharedSms.sendTemplate` |
| `CRM_LESSON_SMS_TEMPLATE_ID` | `926976` | sms.ir verify template id used when the key has no DB row |
| `CRM_LESSON_SMS_PARAMS` | `NAME,DATE,TIME` | verify parameter names used when the key has no DB row |

Job: every 10 min (first run 60 s after start) picks `scheduled` bookings with no reminder yet whose start is within
the window, sends once, and stores `reminder_status` (`sent` / `failed` / `no_mobile`) + `reminder_sent_at`.
Admins can preview candidates (dry run) from the **یادآور پیامکی** sub-tab; phones are always masked.

**Before enabling**: confirm the `sms_templates` row for template 926976 (its key and `param_map`/`param_names`).
If its key is not `class_time`, set `CRM_LESSON_SMS_TEMPLATE_KEY`. Variables passed: `name, family, date, time,
instructor, vehicle, NAME (full name), DATE, TIME`.

## API
`/api/lessons/vehicles`, `/instructors`, `/availability`, `/bookings` (+ `/:id/cancel`, `/:id/status`),
`/reminders/config`, `/reminders/run` (admin, `dry_run` defaults to true). Cashiers cannot DELETE (global rule).
