# پاک‌سازی تاریخچهٔ Git (History Purge) / Git History Purge

> **هشدار مهم:** این سند صرفاً راهنما و برنامهٔ آینده است. **همین حالا هیچ‌یک از دستورات بازنویسی تاریخچه را اجرا نکنید.** این PR تاریخچهٔ Git را بازنویسی نمی‌کند.

## چرا این کار لازم است؟ / Why

در گذشته، فایل‌های دادهٔ زمان اجرا (مانند `db_store.json` و پشتیبان‌های آن) و احتمالاً برخی اطلاعات حساس/رمزها در تاریخچهٔ Git ثبت شده‌اند. همچنین ممکن است پوشهٔ `StudentFiles/` یا فایل‌های `.env` در commitهای قدیمی وجود داشته باشند. حتی اگر این موارد اکنون از ایندکس خارج شده باشند، نسخه‌های قبلی آن‌ها همچنان در تاریخچهٔ مخزن قابل دسترسی است و باید در آینده — با هماهنگی و تأیید مالک — از تاریخچه حذف شوند.

In the past, runtime data files (e.g. `db_store.json` and its backups) and possibly secrets may have been committed. `StudentFiles/` or `.env` files might also exist in older commits. Even if they are now untracked, their contents remain in git history and must eventually be purged (with owner approval and coordination).

## وضعیت فعلی این PR / What this PR does (and does NOT do)

- **انجام‌شده:** اطمینان از اینکه فایل‌های runtime و حساس در Git ردیابی نمی‌شوند و در `.gitignore` قرار دارند.
- **انجام‌نشده:** **هیچ بازنویسی تاریخچه‌ای انجام نشده است.** هیچ `git filter-repo`، `git filter-branch`، `rebase` برای بازنویسی، یا `force-push` انجام ندهید.

This PR only ensures runtime/sensitive paths are untracked and ignored. **It does NOT rewrite history. No `filter-repo`, `filter-branch`, history-rewriting `rebase`, or force-push is performed.**

## مسیرهایی که باید در پاک‌سازی آینده حذف شوند / Paths to purge in a future, approved run

در صورت تأیید نهایی، این مسیرها باید از کل تاریخچه حذف شوند (نام‌ها/الگوها را پیش از اجرا با مالک بازبینی کنید):

- `db_store.json`
- `db_store.json.bak_*` (تمام پشتیبان‌ها)
- `StudentFiles/` (کل پوشه و محتوای آن)
- هر فایل `.env` که به اشتباه commit شده باشد (به‌جز `.env.example` که فقط placeholder دارد)

Paths to drop from all history (review the exact list with the owner before running):

- `db_store.json`
- `db_store.json.bak_*` (all backups)
- `StudentFiles/` (entire directory)
- Any committed `.env` files (but **not** `.env.example`, which must contain only empty placeholders)

## رویهٔ پیشنهادی آینده (فقط مرجع — اکنون اجرا نکنید) / Recommended future procedure (reference only — DO NOT RUN NOW)

ابزار پیشنهادی: [`git-filter-repo`](https://github.com/newren/git-filter-repo) (ترجیحاً به‌جای `git filter-branch`).

**پیش‌نیازها و هماهنگی:**
1. **تأیید صریح مالک مخزن** پیش از هر اقدامی که تاریخچه را تغییر می‌دهد.
2. هماهنگی با همهٔ همکاران/کلون‌ها: پس از force-push، **همه باید مخزن را دوباره clone کنند** (pull/rebase معمولی کافی نیست و باعث بازگشت تاریخچهٔ قدیمی می‌شود).
3. **چرخش (Rotate) تمام رمزها/توکن‌هایی** که ممکن است در commitهای قدیمی بوده باشند (کلیدهای API، توکن‌ها، رمزهای دیتابیس، secretهای سرویس‌ها و ...)، حتی اگر اکنون در فایل‌های زنده نیستند.

**نمونهٔ مفهومی دستورات (اجرا ممنوع در حال حاضر):**

```bash
# !!! DO NOT RUN THESE COMMANDS NOW !!!
# مثال مفهومی — فقط پس از تأیید مالک، هماهنگی تیم، و تهیهٔ بک‌آپ کامل اجرا شود.

# 1) یک کلون تازهٔ mirror برای کار روی تاریخچه بگیرید (روی کپی، نه مخزن کاری):
# git clone --mirror <REPO_URL> repo-mirror.git
# cd repo-mirror.git

# 2) حذف مسیرها از کل تاریخچه (لیست نهایی را با مالک تأیید کنید):
# git filter-repo --invert-paths \
#   --path db_store.json \
#   --path-glob 'db_store.json.bak_*' \
#   --path StudentFiles \
#   --path-glob '.env' \
#   --path-glob '.env.*' \
#   --path .env

# 3) بررسی نتیجه، سپس — فقط با تأیید مالک — force-push به remote:
# git push --force --all
# git push --force --tags

# 4) پس از آن: همه re-clone کنند و تمام اسرار مشکوک rotate شوند.
```

> نکته: در مثال بالا باید دقت شود که `.env.example` حذف نشود؛ فیلتر دقیق مسیرها را متناسب با مخزن نهایی تنظیم و قبل از اجرا بازبینی کنید. **باز هم تأکید: این دستورات اکنون نباید اجرا شوند.**

## چک‌لیست قبل از اجرای واقعی (آینده) / Checklist before any real run

- [ ] تأیید کتبی/صریح مالک مخزن دریافت شده است.
- [ ] بک‌آپ کامل و امن از مخزن و داده‌های لازم تهیه شده است.
- [ ] لیست نهایی مسیرها برای purge با مالک بازبینی شده است.
- [ ] برنامهٔ rotate کردن تمام اسرار احتمالی آماده و اجراشدنی است.
- [ ] همهٔ همکاران مطلع‌اند که پس از force-push باید re-clone کنند.
- [ ] زمان‌بندی و پنجرهٔ اجرای کار هماهنگ شده است.

**یادآوری نهایی:** هیچ‌کس بدون تأیید مالک نباید `main` را force-push کند.
