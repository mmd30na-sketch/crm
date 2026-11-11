# فاکتور رسمی، گزارش‌های مالی و خروجی حسابداری / Invoices, finance reports, accounting export

## فاکتور رسمی (Official invoices) — `invoices.ts`, UI tab «فاکتورها»
- شماره‌گذاری ترتیبی به ازای هر سال شمسی: `{prefix}{yyyy}-{00001}`؛ شمارنده اتمیک در `crm_invoice_counters`
  (`INSERT … ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq+1)`).
- فاکتور حذف نمی‌شود؛ فقط «ابطال» با علت (فقط مدیر). اگر ثبت ردیف‌ها خطا دهد، فاکتور خودکار باطل می‌شود تا شماره خالی نماند.
- مشخصات فروشنده از تنظیمات آموزشگاه (قابل ویرایش در تنظیمات فاکتور، فقط مدیر) و خریدار از پرونده کارآموز (کد ملی الزامی)؛
  هر دو در لحظهٔ صدور در خود فاکتور ذخیره (snapshot) می‌شوند.
- ردیف‌ها: شرح، تعداد، مبلغ واحد، تخفیف؛ مالیات بر ارزش افزوده قابل تنظیم (پیش‌فرض خاموش، نرخ ۱۰٪، حالت «قیمت شامل مالیات»).
  معافیت خدمات آموزشی را با مشاور مالیاتی تأیید کنید.
- چاپ/PDF: نمای چاپی RTL فارسی (از «چاپ» مرورگر → Save as PDF). خروجی فهرست فاکتورها: CSV / Excel.
- Draft from enrollment: `POST /api/invoices/draft {enrollment_id}` پیش‌نویس با شهریه و تخفیف ثبت‌نام.

| Route | Roles |
|---|---|
| `GET /api/invoices?from&to&status&q&student_id`, `GET /api/invoices/:id`, `POST /api/invoices`, `POST /api/invoices/draft`, `GET /api/invoices/export?format=csv\|xls` | admin, cashier |
| `GET /api/invoices/settings` | admin, cashier |
| `PUT /api/invoices/settings`, `POST /api/invoices/:id/cancel` | admin |

## گزارش‌های مالی — `financeReports.ts`, UI tab «گزارش مالی»
- درآمد بر اساس ماه / روز / دوره / مربی / روش پرداخت، با جمع بازپرداخت‌ها و خالص. (گروه «مربی» فقط با MySQL؛ مبلغ هر پرداخت
  بین مربیان همان دورهٔ ترم (crm_course_terms + نرخ/جلسات مربی) به تساوی تقسیم می‌شود — تقریبی است.)
- سن مطالبات (۰–۳۰، ۳۱–۶۰، ۶۱–۹۰، ۹۱–۱۸۰، +۱۸۰ روز از تاریخ ثبت‌نام): مانده = شهریه نهایی − پرداختی هر ثبت‌نام.
- اقساط: پرداخت‌شده / پرداخت‌نشده / معوق با روز تأخیر.
- بازپرداخت (Refund): دفتر جدا `crm_refunds` (فقط مدیر ثبت/ابطال می‌کند؛ بیشتر از خالص پرداختی کارآموز مجاز نیست).
  پرداخت‌ها و مانده بدهی ثبت‌نام‌ها را تغییر نمی‌دهد (رفتار فعلی CRM حفظ می‌شود).
- همه گزارش‌ها با `?format=csv|xls` قابل دانلودند (CSV با BOM برای اکسل؛ محافظت در برابر فرمول‌تزریقی).
- Routes: `GET /api/finance-reports/{income,aging,installments,refunds}` (admin, cashier); `POST /api/refunds`, `POST /api/refunds/:id/void` (admin).

## خروجی حسابداری — `accounting.ts` (admin only)
- سند تراز روزانه (`CRM-yyyymmdd`)، کد تفصیلی کارآموز `S<id>`، کدهای حساب قابل تنظیم (پیش‌فرض: صندوق 1101، بانک 1102،
  کارتخوان 1103، درگاه 1104، حساب دریافتنی 1301، درآمد آموزش 6101، مالیات پرداختنی 2201، برگشت از فروش 6102 — باید با
  کدینگ حساب‌های آموزشگاه تطبیق داده شود).
- مبنا: نقدی (هر دریافت = درآمد) یا تعهدی (فاکتور صادره = درآمد + مالیات؛ دریافت = تسویه حساب دریافتنی).
- Pluggable adapters (`AccountingAdapter { id, label, formats, status, notes, build(lines) }`):

| Adapter | Status | Note |
|---|---|---|
| generic | ready | CSV / Excel 2003 XML |
| holoo | needs confirmation | Holoo «ورود لیستی سند» expects Excel 97-2003 with Latin file/sheet names and manual column mapping. Our .xls is SpreadsheetML: open in Excel and Save As 97-2003. |
| sepidar | needs confirmation | Needs the academy's own «الگوی دریافت سند حسابداری» sample; accounts/tafsili must exist in Sepidar. |
| mahak | stub (501) | Only base-data Excel import is publicly documented. |
| moadian | stub (501) | Tax system submission intentionally NOT implemented (needs tax memory id, private key/cert, signed+encrypted packets). |

No vendor API is called; exports are files downloaded by an admin. **Needs confirmation:** exact Sepidar/Holoo column layouts
(send a sample file exported from the academy's software), account codes, VAT applicability.

## Deploy notes
- Tables are created at boot (`ensureInvoicesSchema`, `ensureFinanceSchema`); the same DDL is in
  `database/migrations/20261028_invoices_finance.sql`. Additive only.
- Settings live in `settings.invoice` and `settings.accounting` (db_store.json settings, like `debt_sms`).
- Tests: `npm run test:invoices` (unit, no DB).
