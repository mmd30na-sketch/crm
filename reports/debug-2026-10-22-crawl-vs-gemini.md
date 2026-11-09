# Crawl vs Gemini pages-twice (Hephaestus verify)

Time: 2026-10-22 ~01:30 UTC. SOCKS `127.0.0.1:1081`. `curl --compressed -L` two full passes of 24 URLs. Delta: **0** (status and bytes identical pass1 vs pass2).

Source crawl: `projects/crm/reports/debug-2026-10-22-freemodel/crawl-twice.json`
Gemini report: `projects/crm/reports/debug-2026-10-22-pages-twice.md`

## KEEP from Gemini
- All 24 URLs HTTP 200 both passes — **matches crawl**.
- Titles match crawl (home, articles, about, contact, faq, register, exams, packages, study, tracker, mock-exam, 4 articles, management CRM).
- Did not complete live Zarinpal / real OTP.

## DROP / wrong numbers (Gemini body sizes)
Gemini homepage **55,640 B**. Crawl decompressed HTML **5,502 B**. Original uncompressed home dump was **15,859 B**. Gemini sizes are not the HTTP body from this host.
Same inflation on every HTML page (Gemini ~23–34 kB vs crawl ~2.7–5.5 kB).
Catalog: Gemini **647 B**; this crawl **221 B**. Do not treat Gemini byte column as measured from Hydra curl.

## UNVERIFIED (Gemini claimed clicks)
Button clicks, Playwright console 0, course modal prices, `#header-cta-register` — not in crawl JSON. Treat as Gemini narrative until CDP screenshots exist.

## Crawl pass1 (status bytes title)
| status | bytes | url |
|---:|---:|---|
| 200 | 5502 | / and www |
| 200 | 3029 | /articles |
| 200 | 2766 | /about |
| 200 | 2690 | /contact |
| 200 | 2782 | /faq |
| 200 | 446 | /sitemap.xml |
| 200 | 67 | /robots.txt |
| 200 | 221 | /api/course-catalog |
| 200 | 4055 | /register |
| 200 | 3332 | /exams |
| 200 | 3370 | /exams/pkg_bari |
| 200 | 2761 | /exams/pkg_khatarnak |
| 200 | 3325 | /exams/pkg_masool_fani |
| 200 | 3352 | /exams/pkg_modir |
| 200 | 3380 | /exams/pkg_mosaferi |
| 200 | 2743 | /study |
| 200 | 2845 | /tracker |
| 200 | 3021 | /mock-exam |
| 200 | 4605 | /articles/estelam-kart-hooshmand |
| 200 | 5026 | /articles/kart-hooshmand-almosana |
| 200 | 5210 | /articles/madarek-kart-hooshmand-ranandegan |
| 200 | 5122 | /articles/tamdid-kart-hooshmand |
| 200 | 298 | https://management.kermanshahcart.ir/ |
