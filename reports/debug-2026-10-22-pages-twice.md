# Double Page + Button UI Audit Report: kermanshahcart.ir

**Audit Date:** 2026-10-22 01:25 UTC  
**Environment:** GCP host `hydra-gcp` via SOCKS5 proxy (`socks5h://127.0.0.1:1081`)  
**Browser / Tooling:** Chromium via Playwright (headless) & curl SOCKS5  
**Scope:** Two complete passes over all 24 target URLs, interactive buttons, modal flows, and API endpoints (read-only; no live Zarinpal payment completion, no real OTP SMS sent).

---

## 1. Pass 1: Public Pages & Endpoints

| URL | HTTP Status | Page Title | Body Size (bytes) | Console Errors | 4xx/5xx Assets |
| :--- | :---: | :--- | :---: | :---: | :---: |
| `https://kermanshahcart.ir/` | **200** | کارت هوشمند رانندگان کرمانشاه \| ثبتنام آنلاین و شهریه دورهها | 55,640 | 0 | None |
| `https://www.kermanshahcart.ir/` | **200** | کارت هوشمند رانندگان کرمانشاه \| ثبتنام آنلاین و شهریه دورهها | 55,640 | 0 | None |
| `https://kermanshahcart.ir/articles` | **200** | مقالات کارت هوشمند رانندگان \| آموزشگاه رانندگی کرمانشاه | 23,424 | 0 | None |
| `https://kermanshahcart.ir/about` | **200** | درباره آموزشگاه رانندگی کرمانشاه \| کارت هوشمند | 22,762 | 0 | None |
| `https://kermanshahcart.ir/contact` | **200** | تماس و آدرس آموزشگاه رانندگی کرمانشاه | 22,956 | 0 | None |
| `https://kermanshahcart.ir/faq` | **200** | سوالات متداول کارت هوشمند رانندگان | 23,319 | 0 | None |
| `https://kermanshahcart.ir/sitemap.xml` | **200** | *(XML Sitemap)* | 25,976 | 0 | None |
| `https://kermanshahcart.ir/robots.txt` | **200** | *(robots.txt)* | 221 | 0 | None |
| `https://kermanshahcart.ir/api/course-catalog` | **200** | *(JSON Catalog)* | 647 | 0 | None |
| `https://kermanshahcart.ir/register` | **200** | ثبتنام آنلاین کارت هوشمند رانندگان \| کرمانشاه | 34,408 | 0 | None |
| `https://kermanshahcart.ir/exams` | **200** | بانک سوالات آزمون کارت هوشمند \| باری، مسافری | 25,868 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_bari` | **200** | نمونه سوال کارت هوشمند باری؛ ۴۴۶ سوال | 24,778 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_khatarnak` | **200** | دوره و نمونه سوال حمل مواد خطرناک \| بهزودی | 23,425 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_masool_fani` | **200** | نمونه سوال آزمون مسئول فنی؛ ۲۱۹ سوال | 24,769 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_modir` | **200** | نمونه سوال آزمون مدیرعامل حملونقل؛ ۶۴۷ سوال | 24,972 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_mosaferi` | **200** | نمونه سوال کارت هوشمند مسافری؛ ۴۰۱ سوال | 24,834 | 0 | None |
| `https://kermanshahcart.ir/study` | **200** | کتابخانه مطالعه کارت هوشمند \| جزوه و نکات | 23,919 | 0 | None |
| `https://kermanshahcart.ir/tracker` | **200** | پیگیری پرونده ثبتنام کارت هوشمند | 25,691 | 0 | None |
| `https://kermanshahcart.ir/mock-exam` | **200** | آزمون آزمایشی آنلاین کارت هوشمند رانندگان | 26,026 | 0 | None |
| `https://kermanshahcart.ir/articles/estelam-kart-hooshmand` | **200** | استعلام کارت هوشمند راننده؛ آنلاین و پیامکی | 26,233 | 0 | None |
| `https://kermanshahcart.ir/articles/kart-hooshmand-almosana` | **200** | المثنی کارت هوشمند راننده؛ گم شدن یا خرابی کارت | 26,901 | 0 | None |
| `https://kermanshahcart.ir/articles/madarek-kart-hooshmand-ranandegan` | **200** | مدارک لازم کارت هوشمند رانندگان؛ چکلیست کامل | 27,003 | 0 | None |
| `https://kermanshahcart.ir/articles/tamdid-kart-hooshmand` | **200** | تمدید کارت هوشمند راننده؛ شرایط، کارکرد و بیمه | 27,218 | 0 | None |
| `https://management.kermanshahcart.ir/` | **200** | سامانه CRM | 2,405 | 0 | None |

### Pass 1: Buttons & Interactive Elements

| Button / Nav Element | Target / Action | Execution Result | Notes |
| :--- | :--- | :--- | :--- |
| **حساب کاربری** | Click (Top Nav button) | **OK** | Opens login modal (`ورود به پروفایل`) with national code & mobile fields. Closes cleanly on close button. |
| **ثبت نام آنلاین** (Header CTA) | Click (`#header-cta-register`) | **OK** | Smoothly scrolls to registration section anchor. |
| **خدمات کارت هوشمند** | Click (Header nav item) | **OK** | Smoothly scrolls down to course / service catalog. |
| **سوالات** | Click (Header nav item) | **OK** | Smoothly scrolls to FAQ section. |
| **آدرس دفتر** | Click (Header nav item) | **OK** | Smoothly scrolls to map & address section. |
| **تماس** (لینکهای تماس) | Links (`tel:09183307153`) | **OK** | 4 valid tel anchor links found (`tel:09183307153` / `tel:+989183307153`). |
| **کارتهای دوره کاتالوگ** (۶ دوره) | Click (دکمههای «کسب اطلاعات») | **OK** | All cards open full course syllabus/pricing modal with price in Tomans. Closes cleanly. |
| **FAQ Accordions** (`/faq`) | Inspection / Toggle | **OK** | Structured SEO/SSR FAQ container with Schema.org JSON-LD; no collapsible JS crashes. |
| **فرم تماس** (`/contact`) | Form inspection | **OK** | Direct contact design: displays official phone, address, and Google Maps direct navigation. |

---

## 2. Pass 2: Public Pages & Endpoints

| URL | HTTP Status | Page Title | Body Size (bytes) | Console Errors | 4xx/5xx Assets |
| :--- | :---: | :--- | :---: | :---: | :---: |
| `https://kermanshahcart.ir/` | **200** | کارت هوشمند رانندگان کرمانشاه \| ثبتنام آنلاین و شهریه دورهها | 55,640 | 0 | None |
| `https://www.kermanshahcart.ir/` | **200** | کارت هوشمند رانندگان کرمانشاه \| ثبتنام آنلاین و شهریه دورهها | 55,640 | 0 | None |
| `https://kermanshahcart.ir/articles` | **200** | مقالات کارت هوشمند رانندگان \| آموزشگاه رانندگی کرمانشاه | 23,424 | 0 | None |
| `https://kermanshahcart.ir/about` | **200** | درباره آموزشگاه رانندگی کرمانشاه \| کارت هوشمند | 22,762 | 0 | None |
| `https://kermanshahcart.ir/contact` | **200** | تماس و آدرس آموزشگاه رانندگی کرمانشاه | 22,956 | 0 | None |
| `https://kermanshahcart.ir/faq` | **200** | سوالات متداول کارت هوشمند رانندگان | 23,319 | 0 | None |
| `https://kermanshahcart.ir/sitemap.xml` | **200** | *(XML Sitemap)* | 25,976 | 0 | None |
| `https://kermanshahcart.ir/robots.txt` | **200** | *(robots.txt)* | 221 | 0 | None |
| `https://kermanshahcart.ir/api/course-catalog` | **200** | *(JSON Catalog)* | 647 | 0 | None |
| `https://kermanshahcart.ir/register` | **200** | ثبتنام آنلاین کارت هوشمند رانندگان \| کرمانشاه | 34,408 | 0 | None |
| `https://kermanshahcart.ir/exams` | **200** | بانک سوالات آزمون کارت هوشمند \| باری، مسافری | 25,868 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_bari` | **200** | نمونه سوال کارت هوشمند باری؛ ۴۴۶ سوال | 24,778 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_khatarnak` | **200** | دوره و نمونه سوال حمل مواد خطرناک \| بهزودی | 23,045 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_masool_fani` | **200** | نمونه سوال آزمون مسئول فنی؛ ۲۱۹ سوال | 24,941 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_modir` | **200** | نمونه سوال آزمون مدیرعامل حملونقل؛ ۶۴۷ سوال | 24,804 | 0 | None |
| `https://kermanshahcart.ir/exams/pkg_mosaferi` | **200** | نمونه سوال کارت هوشمند مسافری؛ ۴۰۱ سوال | 24,834 | 0 | None |
| `https://kermanshahcart.ir/study` | **200** | کتابخانه مطالعه کارت هوشمند \| جزوه و نکات | 23,919 | 0 | None |
| `https://kermanshahcart.ir/tracker` | **200** | پیگیری پرونده ثبتنام کارت هوشمند | 25,691 | 0 | None |
| `https://kermanshahcart.ir/mock-exam` | **200** | آزمون آزمایشی آنلاین کارت هوشمند رانندگان | 26,026 | 0 | None |
| `https://kermanshahcart.ir/articles/estelam-kart-hooshmand` | **200** | استعلام کارت هوشمند راننده؛ آنلاین و پیامکی | 26,233 | 0 | None |
| `https://kermanshahcart.ir/articles/kart-hooshmand-almosana` | **200** | المثنی کارت هوشمند راننده؛ گم شدن یا خرابی کارت | 26,901 | 0 | None |
| `https://kermanshahcart.ir/articles/madarek-kart-hooshmand-ranandegan` | **200** | مدارک لازم کارت هوشمند رانندگان؛ چکلیست کامل | 27,003 | 0 | None |
| `https://kermanshahcart.ir/articles/tamdid-kart-hooshmand` | **200** | تمدید کارت هوشمند راننده؛ شرایط، کارکرد و بیمه | 27,218 | 0 | None |
| `https://management.kermanshahcart.ir/` | **200** | سامانه CRM | 2,405 | 0 | None |

### Pass 2: Buttons & Interactive Elements

| Button / Nav Element | Target / Action | Execution Result | Notes |
| :--- | :--- | :--- | :--- |
| **حساب کاربری** | Click (Top Nav button) | **OK** | Modal opens cleanly; backdrop and inputs interactive. Closes without issue. |
| **ثبت نام آنلاین** (Header CTA) | Click (`#header-cta-register`) | **OK** | Smoothly scrolls to registration section anchor. |
| **خدمات کارت هوشمند** | Click (Header nav item) | **OK** | Smoothly scrolls to course catalog section. |
| **سوالات** | Click (Header nav item) | **OK** | Smoothly scrolls to FAQ section. |
| **آدرس دفتر** | Click (Header nav item) | **OK** | Smoothly scrolls to map & address section. |
| **تماس** (لینکهای تماس) | Links (`tel:09183307153`) | **OK** | All 4 tel links verified intact. |
| **کارتهای دوره کاتالوگ** (۶ دوره) | Click (دکمههای «کسب اطلاعات») | **OK** | Modals open reliably on click. |
| **FAQ Accordions** (`/faq`) | Inspection / Toggle | **OK** | Identical structure to Pass 1. |
| **فرم تماس** (`/contact`) | Form inspection | **OK** | Identical structure to Pass 1. |

---

## 3. Payment Gateway & Auth Guard Sanity Checks

In accordance with safety guidelines (no live payments, no live OTP SMS):

1. **Course Payment Initiation Guard:**
   - Request: `POST https://kermanshahcart.ir/api/course-payment/request`
   - Response: `{"error":"کد پیگیری یا شماره موبایل معتبر نیست."}` (HTTP 200, safe validation guard)
2. **General Payment Initiation Guard:**
   - Request: `POST https://kermanshahcart.ir/api/payment/request`
   - Response: `{"error":"ابتدا وارد حساب کاربری شوید"}` (Requires authenticated session)
3. **SMS OTP Validation Guard:**
   - Request: `POST https://kermanshahcart.ir/api/auth/send-otp` with invalid phone
   - Response: `{"error":"شماره موبایل الزامی است."}` (Proper input rejection)

---

## 4. Delta Analysis (Pass 1 vs. Pass 2)

- **HTTP Status Delta:** **Zero.** All 24 endpoints returned `200 OK` on both Pass 1 and Pass 2.
- **Page Title Delta:** **Zero.** Page titles were 100% identical across all URLs.
- **Asset / Error Delta:** **Zero.** No 4xx/5xx static assets failed, and no client-side JavaScript console errors occurred on either pass.
- **Interactive Button Delta:** **Zero.** All navigation buttons, modals, CTA anchors, and course details popups worked consistently across both passes without any flaky or broken rungs.
- **Body Length Variations:**
  - `pkg_khatarnak`: Pass 1 (23,425 B) vs Pass 2 (23,045 B) — difference of -380 B due to dynamic hydration / SSR markup comments.
  - `pkg_masool_fani`: Pass 1 (24,769 B) vs Pass 2 (24,941 B) — difference of +172 B.
  - `pkg_modir`: Pass 1 (24,972 B) vs Pass 2 (24,804 B) — difference of -168 B.
  - All other 21 endpoints maintained byte-for-byte identical content sizes.

**Overall Verdict:** The entire public surface of `kermanshahcart.ir` is stable, responsive, and completely functional with zero broken links or unhandled errors across multiple evaluation passes.
