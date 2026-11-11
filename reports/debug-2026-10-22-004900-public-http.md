# Public HTTP Audit: kermanshahcart.ir

**Audit Date:** 2026-10-22 00:47 UTC  
**Environment:** GCP Host `hydra-gcp` via SOCKS5 proxy (`socks5h://127.0.0.1:1081`)  
**Scope:** Read-only public HTTP endpoint & asset audit

---

## 1. Summary of Endpoint Checks

| URL | HTTP Status | Response Time | Content-Type | Notes / Title / First 200 Bytes |
| :--- | :---: | :---: | :--- | :--- |
| `https://kermanshahcart.ir/` | **200** | ~0.43s - 0.62s | `text/html; charset=utf-8` | Title: `کارت هوشمند رانندگان کرمانشاه \| ثبتنام آنلاین و شهریه دورهها` |
| `https://www.kermanshahcart.ir/` | **200** | ~0.43s - 0.68s | `text/html; charset=utf-8` | Title: `کارت هوشمند رانندگان کرمانشاه \| ثبتنام آنلاین و شهریه دورهها` |
| `https://kermanshahcart.ir/articles` | **200** | ~0.36s - 0.38s | `text/html; charset=utf-8` | Title: `مقالات کارت هوشمند رانندگان \| آموزشگاه رانندگی کرمانشاه` |
| `https://kermanshahcart.ir/about` | **200** | ~0.36s - 0.37s | `text/html; charset=utf-8` | Title: `درباره آموزشگاه رانندگی کرمانشاه \| کارت هوشمند` |
| `https://kermanshahcart.ir/contact` | **200** | ~0.36s - 0.37s | `text/html; charset=utf-8` | Title: `تماس و آدرس آموزشگاه رانندگی کرمانشاه` |
| `https://kermanshahcart.ir/faq` | **200** | ~0.36s - 0.39s | `text/html; charset=utf-8` | Title: `سوالات متداول کارت هوشمند رانندگان` |
| `https://kermanshahcart.ir/sitemap.xml` | **200** | ~0.36s - 0.38s | `application/xml` | XML sitemap containing canonical URLs (`<?xml version="1.0" encoding="UTF-8"?>...`) |
| `https://kermanshahcart.ir/api/course-catalog` | **200** | ~0.34s - 0.60s | `application/json; charset=utf-8` | Valid JSON array with 6 active courses (`{"courses":[{"courseId":1,...`) |
| `https://kermanshahcart.ir/robots.txt` | **200** | ~0.34s - 0.40s | `text/plain; charset=UTF-8` | `User-agent: *\nAllow: /\nSitemap: https://kermanshahcart.ir/sitemap.xml` |
| `https://management.kermanshahcart.ir/` | **200** | ~0.34s - 0.61s | `text/html; charset=UTF-8` | Status-only check via HEAD request. Up and healthy. |

---

## 2. Same-Origin Static Asset Audit

Parsed from `/tmp/kermanshahcart-home.html` (scripts, stylesheets, preloaded fonts & banner images):

| Asset Path | Type | HTTP Status | Response Time | Content-Type | Result |
| :--- | :--- | :---: | :---: | :--- | :---: |
| `/u/script.js` | Script (analytics) | **200** | 0.428s | `application/javascript; charset=UTF-8` | OK |
| `/assets/index-Ask7uthh.js` | Main JS bundle | **200** | 0.067s | `application/javascript; charset=UTF-8` | OK |
| `/assets/index-D23HYVFq.css` | Main CSS stylesheet | **200** | 0.093s | `text/css; charset=UTF-8` | OK |
| `/fonts/vazirmatn-arabic-wght-normal.woff2` | Web font (preload) | **200** | 0.085s | `font/woff2` | OK |
| `/assets/banner-750-BaPQdv68.avif` | Responsive banner 750w | **200** | 0.103s | `application/octet-stream` | OK |
| `/assets/banner-1200-De1V3Z0V.avif` | Responsive banner 1200w | **200** | 0.343s | `application/octet-stream` | OK |
| `/assets/banner-1600-Cg3qKHFT.avif` | Responsive banner 1600w | **200** | 0.083s | `application/octet-stream` | OK |
| `/assets/banner-2400-B7J2nBRs.avif` | Responsive banner 2400w | **200** | 0.354s | `application/octet-stream` | OK |

*Note: Favicon is an inline SVG data URI (`data:image/svg+xml,...`). All external/same-origin assets referenced in HTML return 200 OK without errors.*

---

## 3. Course Catalog JSON Analysis (`/api/course-catalog`)

- **Total Courses Count:** 6
- **Source Field:** All 6 records have `source: "crm"`
- **Price Structure:** All prices are positive integer values representing Iranian Tomans (e.g. `6200000`, `4400000`, `7400000`, `5300000`).
- **Course Summary:**
  1. `courseId: 1` — حمل و نقل جاده ای — `6,200,000` تومان (source: `crm`)
  2. `courseId: 2` — محموله خطرناک — `4,400,000` تومان (source: `crm`)
  3. `courseId: 3` — اتوبوس برون شهری — `6,200,000` تومان (source: `crm`)
  4. `courseId: 4` — مدیر شرکت حمل و نقل — `7,400,000` تومان (source: `crm`)
  5. `courseId: 5` — مدیر شرکت مسافر برون شهری — `7,400,000` تومان (source: `crm`)
  6. `courseId: 6` — مسئول فنی — `5,300,000` تومان (source: `crm`)

---

## 4. ArvanCloud Edge Headers

Checked via `curl -sS -D - -o /dev/null`:

### Home (`https://kermanshahcart.ir/`)
```http
server: ArvanCloud
server-timing: total;dur=372
x-cache: BYPASS
x-request-id: 868319f6fa16c5fb483d81a6c3cfd395
x-sid: 6980
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
cache-control: no-cache
```

### Catalog API (`https://kermanshahcart.ir/api/course-catalog`)
```http
server: ArvanCloud
server-timing: total;dur=272
x-cache: BYPASS
x-request-id: b356c0e64a2d962c7f816f41bf7d63da
x-sid: 6980
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
cache-control: public, max-age=60
```

---

## 5. Broken vs Healthy Route Findings

- **Broken Routes (4xx / 5xx):** None (0).
- **Empty Bodies:** None.
- **JSON Parsing Errors:** None; `/api/course-catalog` is valid and well-formatted JSON.
- **Missing Titles:** All HTML routes have populated, descriptive Persian `<title>` tags. Non-HTML endpoints (`sitemap.xml`, `robots.txt`, `course-catalog`) returned expected MIME types and valid bodies.
- **Subdomain Health:** `management.kermanshahcart.ir` returned `HTTP/2 200` with ArvanCloud headers intact.
- **Verdict:** All 10 tested endpoints and 8 referenced same-origin static assets are **100% HEALTHY**.
