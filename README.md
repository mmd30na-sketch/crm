# کارلا (Carla CRM)

این پروژه سیستم مدیریت ارتباط با مشتری (CRM) اختصاصی برای مؤسسه **کرمانشاه کارت** (مرکز آموزش رانندگان و دوره‌های حمل و نقل در کرمانشاه) است.

## قابلیت‌های کلیدی
- مدیریت کارآموزان (هنرجویان)، دوره‌های آموزشی و ترم‌ها.
- ثبت‌نام، مدیریت پرداخت‌ها و اقساط.
- مدیریت هزینه‌ها.
- تایید ثبت‌نام‌های انجام شده از طریق وب‌سایت.
- مدیریت پیام‌ها در پیام‌رسان‌ها (روبیکا و تلگرام).
- ارسال پیامک‌های بدهی.
- تشخیص متن (OCR) کارت‌های شناسایی با استفاده از Gemini.
- تولید اسناد قابل چاپ.
- دستیار هوش مصنوعی (AI Copilot) با قابلیت اجرای پرس‌وجوهای SQL به صورت فقط-خواندنی (Read-only).

## پشته تکنولوژی (Stack)
- **فرانت‌اند:** React + Vite
- **بک‌اند:** Node.js (Version 20) + Express-style server در TypeScript
- **پایگاه داده:** MySQL 8 (مشترک با وب‌سایت اصلی و Directus)
- **بسته‌بندی:** esbuild (تبدیل به `dist/server.cjs`)

## ساختار پوشه‌ها
- `src/`: کدهای فرانت‌اند React
- `server.ts`: سرور HTTP و مسیرها (Routes)
- `mysql-socks.ts`: لایه داده‌های MySQL
- `database/`: اسکیماهای SQL و اسکریپت‌های Seed
- `scripts/`: تست‌ها، پل اسکنر، شنودگر پایتون روبیکا و بک‌آپ دیتابیس
- `docs/`: مستندات قابلیت‌ها و یادداشت‌های مهاجرت دیتابیس
- `tests/`: فایل‌های تست
- `StudentFiles/`: تصاویر و اسکن‌های شناسایی هنرجویان (در Git ذخیره نمی‌شود)
- `copilot-*.ts`: کدهای مربوط به دستیار هوش مصنوعی

## تنظیمات و راه‌اندازی
۱. کپی کردن فایل `.env.example` به `.env` و مقداردهی متغیرها.
۲. فایل‌های زیر نباید در Git متعهد (Commit) شوند:
   - `.env*`
   - `.crm-jwt-secret`
   - `db_store.json` (ذخیره‌ساز محلی داده‌های زمان اجرا)
   - پوشه‌های `StudentFiles/`, `uploads/`, `dist/`, `node_modules/`

## دستورات اجرایی (Scripts)
- `npm run dev`: اجرای سرور با tsx
- `npm run build`: بیلد فرانت‌اند با Vite و بک‌اند با esbuild
- `npm run start`: اجرای فایل نهایی `dist/server.cjs`
- `npm run lint`: بررسی تایپ‌ها با tsc
- دستورات تست: `test:logic`, `test:ocr`, `test:print`, `test:copilot-date`, `test:copilot-labels`, `test:copilot-eval`
- `npm run scanner`: پل ارتباطی اسکنر

## استقرار (Deployment)
- **محل اجرا:** سرور مؤسسه در مسیر `/project/kermanshahcart/crm`
- **پورت:** 5200
- **مدیریت فرآیند:** استفاده از PM2 با نام `carla-crm`
- **روش استقرار:** به صورت **دستی** (Manual). بیلد مستقیم روی سرور انجام شده و سپس PM2 ریستارت می‌شود.
- **نکته مهم:** مخزن GitHub صرفاً یک آینه برای **نسخه پشتیبان** است. هرگز روی سرور `git pull` یا `reset` انجام ندهید.

## یادداشت فنی
جداول قدیمی مربوط به نسخه Access (`TblStudents`, `TblEnroll`, `TblPeyment`, `TblCourse`) در تاریخ ۲۰۲۶-۱۰-۲۹ از کد خارج و بازنشسته شده‌اند. جزئیات در `docs/migrations/2026-10-tbl-retirement.md` موجود است.

---

# Carla CRM

This repository contains the dedicated CRM system for **Kermanshah Cart** (a driver-training and transport-course institute in Kermanshah).

## Features
- Management of trainees (students), courses, and course terms.
- Enrollment tracking, payments, and installment management.
- Expense tracking.
- Approval of registrations from the public website.
- Messenger thread management (Rubika/Telegram).
- Debt notification via SMS.
- ID card OCR validation using Gemini.
- Generation of printable documents.
- AI Copilot with read-only SQL access for data insights.

## Tech Stack
- **Frontend:** React + Vite (located in `src/`)
- **Backend:** Node.js (Node 20) with Express-style routing in TypeScript
- **Bundler:** esbuild (outputting to `dist/server.cjs`)
- **Database:** Shared MySQL 8 database (integrated with the public website and Directus)

## Project Structure
- `src/`: React UI components and logic.
- `server.ts`: Main HTTP server and route definitions.
- `mysql-socks.ts`: MySQL data access layer.
- `database/`: SQL schemas and seeding scripts.
- `scripts/`: Tests, scanner bridge, Rubika python listener, and `backup-db.sh`.
- `docs/`: Feature documentation and migration notes.
- `copilot-*.ts`: Logic for the AI Copilot.
- `StudentFiles/`: Trainee photos and ID scans (Not in Git).
- `dist/`: Compiled production files.

## Configuration
1. Copy `.env.example` to `.env` and fill in the required values.
2. The following files/folders are excluded from version control:
   - `.env*`
   - `.crm-jwt-secret`
   - `db_store.json` (local JSON runtime store)
   - `StudentFiles/`, `uploads/`, `dist/`, `node_modules/`

## Scripts
- `npm run dev`: Start the server using `tsx`.
- `npm run build`: Build the frontend via Vite and the backend via esbuild.
- `npm run start`: Run the production bundle (`node dist/server.cjs`).
- `npm run lint`: Type-check using `tsc --noEmit`.
- **Testing:** `test:logic`, `test:ocr`, `test:print`, `test:copilot-date`, `test:copilot-labels`, `test:copilot-eval`.
- `npm run scanner`: Executes the scanner bridge.

## Deployment
- **Environment:** Runs on the institute's local server at `/project/kermanshahcart/crm`.
- **Process Manager:** Managed by PM2 under the name `carla-crm`.
- **Port:** 5200.
- **Method:** **MANUAL deployment only**. Build directly on the server and restart the PM2 process.
- **Important:** GitHub is used ONLY as a **backup mirror**. Do not perform `git pull` or `git reset` on the production server.

## Legacy Migration
As of 2026-10-29, legacy Access-era tables (`TblStudents`, `TblEnroll`, `TblPeyment`, `TblCourse`) have been retired from the codebase. Refer to `docs/migrations/2026-10-tbl-retirement.md` for details.
