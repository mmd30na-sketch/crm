# Front-end diagnostic report

> Generation time: 2026-10-22 00:49 UTC
> Question type: runtime / api (health sweep of production, not a single user-reported white screen)
> Scope of influence: public site `https://kermanshahcart.ir` on server-iran (`pm2` `kermanshah-site` → `127.0.0.1:5200`), Arvan edge, Chrome via SOCKS `127.0.0.1:1081`

## Problem description

- Owner asked to inspect the live Iran-hosted public site with free/flash workers, Chrome, and MCP, then save a debug dossier.
- No specific user-facing symptom was named. This is a production health + runtime/API sweep.

## Reproduction path

1. From Hydra: `curl -x socks5h://127.0.0.1:1081` against public URLs (direct GCP times out).
2. SSH `ssh-iran` read-only: `pm2`, local `curl` to `:5200` and nginx `Host: kermanshahcart.ir`, error log, disk, git.
3. Headless Chrome CDP `:9333` with `--proxy-server=socks5://127.0.0.1:1081`.
4. Desktop Chrome on Display `:1`, same SOCKS, open `https://kermanshahcart.ir`.
5. Desired: homepage and catalog 200, React hydrates, no console exceptions, payments/OTP/login healthy.
6. Actual: public pages and catalog healthy; OTP SMS, national-code login, Zarinpal course-pay, disk, and quizbot are not.

## Evidence collected

### Public HTTP (SOCKS)

- Home: HTTP/2 200, `server: ArvanCloud`, `x-cache: BYPASS`, 15859 bytes, title «کارت هوشمند رانندگان کرمانشاه | ثبت‌نام آنلاین و شهریه دوره‌ها».
- `/www`, `/articles`, `/about`, `/contact`, `/faq`, `/sitemap.xml`, `/robots.txt`, `/api/course-catalog`, `https://management.kermanshahcart.ir/`: all 200.
- Same-origin assets in the 00:44 HTML (`/assets/index-Ask7uthh.js`, `/assets/index-D23HYVFq.css`, Vazirmatn woff2, banner AVIFs, `/u/script.js`): all 200.
- Catalog: 6 courses, every `source: "crm"`, prices toman integers 4400000–7400000. Matches FAQ JSON-LD on the homepage.

Raw table: `reports/debug-2026-10-22-004900-public-http.md`

### Origin (server-iran, read-only)

- `pm2 ping` pong. `kermanshah-site` online, pid 731627, cwd `/project/kermanshahcart/site/app`, **13 restarts**.
- Local `http://127.0.0.1:5200/` 200 in 6ms; nginx with `Host: kermanshahcart.ir` 200, same 15859-byte body.
- `server_name` only `kermanshahcart.ir www.kermanshahcart.ir`; `nginx -t` ok.
- Git clean at `3857afd` «Course pages: fix header links to real routes, use main site footer».
- Disk `/` **96%** (1.4G free of 30G). RAM 3.8G, ~1.5G available. Load 1.55.
- Other pm2: `carla-crm` online (6 restarts), `gemini-relay` online, `crm-rubika-listener` online, `kermanshahcart-tgbot` online, `kermanshahcart-bot2` online, `site-error-logger` online, **`kermanshahcart-quizbot` stopped**.

`kermanshah-site-error.log` (historical, not a crash loop):

- SMS.ir: «اعتبار کافی نمیباشد» (OTP and later SMS send).
- `[login-national] DB error: Unknown column 'full_name' in 'field list'` (repeated).
- `[course-pay] Zarinpal request error: callback URL domain does not match the registered terminal domain` (`code: -14`).
- Telegram network timeout.

Raw: `reports/debug-2026-10-22-004900-origin.md`

### Chrome + CDP

- `profile=chrome` (extension MCP on `127.0.0.1:18799`) was not attached: `/json/version` → `Unauthorized`; OpenClaw `profile=chrome` had `running: false`, 0 tabs.
- Isolated HeadlessChrome/155 on `:9333` via SOCKS. After `Page.navigate`:
  - `location.href` `https://kermanshahcart.ir/`
  - `document.readyState` `complete`
  - title and h1 correct; `#root` present; `#seo-ssr` gone after hydration (expected).
  - console exceptions: 0. console API: empty.
  - bad HTTP status: 0.
  - one canceled fetch `POST /api/track/view` `net::ERR_ABORTED`; same URL also returned 204. Duplicate beacon, not a page break.
  - Live bundle in the hydrated document: `/assets/index-B7Nb07zE.js` and `/assets/index-zRBPd_Tk.css` (different hashes than the 00:44 HTML). Both 200.
- Desktop Chrome on `:1` with the same SOCKS: tab title and URL are the site; hero, nav (تماس / حساب کاربری / آدرس دفتر / سوالات / خدمات / ثبت نام آنلاین) render. Google Translate chip was Chrome UI, dismissed with Escape.

JSON: `reports/debug-2026-10-22-004900-chrome-audit.json`  
Headless shot: `reports/debug-2026-10-22-004900-chrome-home.png`  
Desktop shot: `reports/debug-2026-10-22-004900-desktop.png`

Workers: Gemini 3.8 flash (`omniroute/antigravity/gemini-3.8-flash-tiered`; origin child remapped to `omniroute/gemini-3.8-flash-tiered`, public-http child remapped to `omniroute/keepalive`).

## Hypothesis and Verification

| Hypothesis | Verification Method | Results |
| --- | --- | --- |
| Because origin/pm2/nginx is down, the public site fails | SSH `pm2 jlist`, curl `:5200` and nginx Host | Falsified. Origin 200 in 6ms, nginx 200 |
| Because Arvan or assets are broken, Chrome shows a white/broken page | SOCKS curl of HTML+assets; CDP network; desktop screenshot | Falsified. Home/catalog/assets 200; 0 console exceptions; UI visible |
| Because SMS.ir has no credit, OTP/SMS is broken | `kermanshah-site-error.log` repeated «اعتبار کافی نمیباشد» | Confirmed in logs (not re-tested live send) |
| Because MySQL is missing `full_name`, national-code login fails | same error log, three repeats | Confirmed in logs |
| Because Zarinpal terminal domain ≠ callback URL, course pay fails | log `code: -14` | Confirmed in logs |
| Because disk is nearly full, a future Vite/pm2 write will fail | `df -h /` 96%, 1.4G | Confirmed capacity risk, not an active outage |

## Root cause

- The public site is **up**. Homepage, SEO routes, catalog (`source: crm`), and Chrome hydration are healthy.
- Functional defects that are **not** a homepage outage:
  1. SMS.ir credit exhausted → OTP/SMS.
  2. `full_name` missing on the login-national query → national-code login.
  3. Zarinpal `-14` callback domain mismatch → course payment request.
  4. `/` at 96% (1.4G) → next `npm run build` / log growth is unsafe.
  5. `kermanshahcart-quizbot` is stopped.

## Fix content

- None applied. This run was inspect + dossier only.

## Verification results

- Public SOCKS: home and catalog 200.
- Origin: `:5200` and nginx 200.
- Chrome CDP: readyState complete, 0 exceptions, 0 4xx/5xx.
- Desktop Chrome: site visible on Display `:1`.

## Residual risk

- Disk 96% on a 30G root. 13 restarts on `kermanshah-site`, 6 on `carla-crm` — cause not bisected.
- HTML asset hashes changed between 00:44 curl and 00:48 Chrome (`index-Ask7uthh.js` → `index-B7Nb07zE.js`). Both generations 200; possible dist rebuild during the window.
- Clarity (`clarity.ms`) loads from abroad; if it is blocked for some Iranian clients that is analytics-only.
- `/api/track/view` abort+204 is telemetry, not UI.
- Quizbot stopped; Telegram timeout in logs.
- National login, OTP, and Zarinpal course-pay were **not** clicked end-to-end in Chrome.

## Next step

Needs owner decision (do not do until asked):

1. Charge SMS.ir credit, then one OTP send.
2. Add or stop selecting `full_name` on login-national; confirm against Chabokan schema.
3. Align Zarinpal callback domain with the registered terminal (likely `kermanshahcart.ir`).
4. Free disk on server-iran before any site/CRM rebuild.
5. If the Rubika quiz bot should be live: inspect why `kermanshahcart-quizbot` is stopped, then start it.

## Attachments

- `debug-2026-10-22-004900-origin.md`
- `debug-2026-10-22-004900-public-http.md`
- `debug-2026-10-22-004900-chrome-audit.json`
- `debug-2026-10-22-004900-chrome-home.png`
- `debug-2026-10-22-004900-desktop.png`
