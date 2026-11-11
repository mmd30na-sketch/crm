# Double page + button audit (two full passes)

Target: https://kermanshahcart.ir
Access from Hydra: `curl -x socks5h://127.0.0.1:1081` or Chrome with SOCKS 1081. Direct GCP times out.
Do not deploy. Do not print secrets. Do not click live payment confirm.

## Pass 1 then Pass 2 (same list, twice)

Public pages:
- https://kermanshahcart.ir/
- https://www.kermanshahcart.ir/
- https://kermanshahcart.ir/articles
- https://kermanshahcart.ir/about
- https://kermanshahcart.ir/contact
- https://kermanshahcart.ir/faq
- https://kermanshahcart.ir/sitemap.xml
- https://kermanshahcart.ir/robots.txt
- https://kermanshahcart.ir/api/course-catalog
- https://kermanshahcart.ir/register
- https://kermanshahcart.ir/exams
- https://kermanshahcart.ir/exams/pkg_bari
- https://kermanshahcart.ir/exams/pkg_khatarnak
- https://kermanshahcart.ir/exams/pkg_masool_fani
- https://kermanshahcart.ir/exams/pkg_modir
- https://kermanshahcart.ir/exams/pkg_mosaferi
- https://kermanshahcart.ir/study
- https://kermanshahcart.ir/tracker
- https://kermanshahcart.ir/mock-exam
- https://kermanshahcart.ir/articles/estelam-kart-hooshmand
- https://kermanshahcart.ir/articles/kart-hooshmand-almosana
- https://kermanshahcart.ir/articles/madarek-kart-hooshmand-ranandegan
- https://kermanshahcart.ir/articles/tamdid-kart-hooshmand
- https://management.kermanshahcart.ir/

For each page record: HTTP status, title, console exceptions, broken buttons, empty body, 4xx/5xx assets.

Buttons / nav (click once per pass, screenshot if broken):
- ثبت نام آنلاین
- حساب کاربری
- تماس
- آدرس دفتر
- سوالات
- خدمات
- هر کارت دوره در کاتالوگ (۶ دوره CRM)
- FAQ accordion items
- فرم تماس اگر هست

Do NOT complete Zarinpal payment. Stop at gateway redirect and record callback_url/domain.
Do NOT send a real OTP SMS (credit is empty). Record the error JSON instead.

Write:
`/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm/reports/debug-2026-10-22-pages-twice.md`
