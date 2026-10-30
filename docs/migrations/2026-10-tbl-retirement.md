# 2026-10: Retiring the legacy Tbl* tables / بازنشسته کردن جداول قدیمی Tbl*

## English
**What:** The Access-era tables `TblStudents`, `TblEnroll`, `TblPeyment`, `TblCourse` (and empty `Tblexpenses`) were replaced by the unified tables `students`, `enrollments`, `payments`, `courses`. Since 2026-10-29 the CRM no longer reads or writes Tbl*.

**Code changes (deployed manually 2026-10-29):**
- `mysql-socks.ts`: removed `findLegacyStudents`, `pickLegacyRow`, `syncTblStudent` and every call to them (create / update / photo upload / registration approval / delete); `phoneDirectory` no longer reads `TblStudents`.
- `courseTerms.ts`: the one-time `crm_course_terms` seed reads only `enrollments` (no `UNION` with `TblEnroll`).
- `copilot-sql.ts`: Tbl* tables removed from the copilot SQL whitelist.
- `scripts/test-registration-approve.mjs`: removed the `TblStudents` cleanup.
- The public website (`kermanshah-site`, `lib/entitlements.ts`) was changed the same day to unlock courses from the new tables only.

**Data reconciled before the switch (ids only):**
- Legacy enrollment 172 → new enrollment 52 (tagged in `id_renumber_map` as `legacy_enr_restore`).
- Legacy payments 97, 98 → new payments 53, 54 on enrollments 28, 29 (description `legacy TblPeyment #97/#98 …`); those enrollments set back to their original price.
- Intentionally not migrated: test/blank students 131, 133; duplicate enrollment 175; student-less enrollments 157, 166, 167, 169 and their payments 83, 93; junk payment 66.
- Enrollments 9, 11, 12 keep their owner-settled prices (`enrollment_settle_log`).

**Verification:** `TblStudents` checksum/row count unchanged across a full create→edit→delete of a test student; entitlements for sampled trainees identical before/after (only duplicate legacy rows disappeared).

**Next steps:** after a quiet period, rename Tbl* to `_archive_*`, then hide/remove their Directus collections, then drop.

**Rollback:** server-side backups were taken before every step (`/root/backup-*-20261030-*`, not in git). Code rollback = restore the previous files and `pm2 restart carla-crm`.

## فارسی
- جداول قدیمی دوره Access (`TblStudents`، `TblEnroll`، `TblPeyment`، `TblCourse`) با جداول یکپارچه `students`، `enrollments`، `payments`، `courses` جایگزین شدند و از ۲۰۲۶-۱۰-۲۹ کد CRM دیگر آن‌ها را نمی‌خواند و در آن‌ها نمی‌نویسد.
- پیش از تغییر، ردیف‌های جامانده منتقل شدند: ثبت‌نام قدیمی ۱۷۲ ← ثبت‌نام ۵۲؛ پرداخت‌های قدیمی ۹۷ و ۹۸ ← پرداخت‌های ۵۳ و ۵۴ (ثبت‌نام‌های ۲۸ و ۲۹). ردیف‌های تستی/تکراری/بدون هنرجو عمداً منتقل نشدند.
- آزمایش: ساخت، ویرایش و حذف یک هنرجوی آزمایشی هیچ تغییری در `TblStudents` ایجاد نکرد و دسترسی دوره‌های هنرجویان پیش و پس از تغییر یکسان بود.
- گام بعدی: پس از یک دوره آرام، تغییر نام جداول Tbl* به `_archive_*`، حذف مجموعه‌های آن‌ها در Directus و سپس حذف کامل.
