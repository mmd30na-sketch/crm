# Front-end diagnostic report (completed)

> Generation time: 2026-10-22 00:49 UTC (origin/Chrome evidence) — completion pass adds static code analysis of `site/app/server.ts`, `.env` facts, and operator checks.
> Question type: runtime / api (health sweep of production, not a single user-reported white screen)
> Scope of influence: public site `https://kermanshahcart.ir` on server-iran (`pm2` `kermanshah-site` → `127.0.0.1:5200`), Arvan edge, Chrome via SOCKS `127.0.0.1:1081`
> Status of this document: **analysis only. Nothing was deployed, restarted, installed, or modified. No SSH session was opened by this pass.**
>
> **Hephaestus review (2026-10-22 01:16 UTC).** Writer: OpenCode `opencode/minimax-m3.1-flash-free` (~4 min). `muse-spark-1.3-contributor-free` is gone from the live OpenCode catalog (`freemodels.md` is stale on that id).
> Keep: query-2 `full_name` deduction; `PUBLIC_BASE_URL` absent; `-14` is domain mismatch; do not guess the registered Zarinpal domain; OTP/login/pay were not clicked in Chrome.
> Drop/correct: (1) Public HTTP line wrote `/www` — the sweep hit **host** `https://www.kermanshahcart.ir/`, not a path `/www`. (2) The pm2 timestamp table is **wrong**. Those integers are epoch-ms start times; correct UTC is `kermanshah-site` 2026-10-21 22:48:25Z, `quizbot` 2026-10-21 15:19:35Z, `carla-crm` 2026-10-22 00:26:29Z, `tgbot` 2026-10-22 00:26:30Z, `bot2` 2026-10-21 18:32:38Z. The report used a bad epoch for «00:45:23» and then claimed the pm2 table was captured at 01:46Z — that follow-on is false. (3) «pm2 default max_restarts is 15» is **unverified** — `pm2 describe` was not run. (4) Directus as the cause of camelCase `registrations` is a hypothesis, not evidence.

---

## Problem description

- Owner asked to inspect the live Iran-hosted public site with free/flash workers, Chrome, and MCP, then save a debug dossier.
- No specific user-facing symptom was named. This is a production health + runtime/API sweep.
- This completion pass answers, with code-level precision, the two functional defects that were only *named* in the original dossier:
  1. `[login-national] DB error: Unknown column 'full_name' in 'field list'`
  2. `[course-pay] Zarinpal request error: … "The callback URL domain does not match the registered terminal domain." code: -14`

---

## Reproduction path

1. From Hydra: `curl -x socks5h://127.0.0.1:1081` against public URLs (direct GCP times out).
2. SSH `ssh-iran` read-only: `pm2`, local `curl` to `:5200` and nginx `Host: kermanshahcart.ir`, error log, disk, git.
3. Headless Chrome CDP `:9333` with `--proxy-server=socks5://127.0.0.1:1081`.
4. Desktop Chrome on Display `:1`, same SOCKS, open `https://kermanshahcart.ir`.
5. Desired: homepage and catalog 200, React hydrates, no console exceptions, payments/OTP/login healthy.
6. Actual: public pages and catalog healthy; OTP SMS, national-code login, Zarinpal course-pay, disk, and quizbot are not.

---

## Evidence collected

### Public HTTP (SOCKS)

- Home: HTTP/2 200, `server: ArvanCloud`, `x-cache: BYPASS`, 15859 bytes, title «کارت هوشمند رانندگان کرمانشاه | ثبت‌نام آنلاین و شهریه دوره‌ها».
- `https://www.kermanshahcart.ir/`, `/articles`, `/about`, `/contact`, `/faq`, `/sitemap.xml`, `/robots.txt`, `/api/course-catalog`, `https://management.kermanshahcart.ir/`: all 200.
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

### NEW — static code evidence (`site/app/server.ts`, live excerpts in `server-slices.ts`)

`/api/auth/login-national` (excerpt lines 17–54), abridged to the load-bearing part:

```ts
const queries = [
  "SELECT TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) AS full_name FROM students WHERE national_code = ? AND phone_number = ? LIMIT 1",
  'SELECT full_name FROM registrations WHERE national_code = ? AND phone_number = ? LIMIT 1',
];
for (const sql of queries) {
  const [rows]: any = await withTimeout(mysqlPool.execute(sql, [nid, phone]), 4000);
  if (rows && rows.length) { found = true; fullName = rows[0].full_name || ''; break; }
}
```

- The `try { … } catch` **wraps the whole `for` loop**, not each query. There is no per-query `try/catch`, no `sql` in the log, no query index.
- `catch` logs `e.message` only: `console.error('[login-national] DB error:', e && e.message)` — no `e.code` (`ER_BAD_FIELD_ERROR` = 1054), no `e.errno`, no `e.sql`, no table name.
- The `catch` returns **503** with «سرویس موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.» — the same status/body for schema drift, timeout, pool exhaustion and connection errors.
- Contrast inside the same file: `/api/course-catalog` degrades gracefully (`mysqlOptionalOk()` / `mysqlOptionalFailed()` → `source: "fallback"`). `login-national` has no such degradation path.

`publicBase(req)` (excerpt lines 121–129), used by **both** payment routes:

```ts
const env = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
if (env) return env;                                   // (A) env — authoritative
const host   = String(req.headers.host || '');
const origin = String(req.headers.origin || '');
try { if (origin && new URL(origin).host === host) return origin; } catch { /* ignore */ }  // (B) Origin verbatim, scheme included
const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
return `${proto}://${host}`;                            // (C) request-derived host
```

- `/api/course-payment/request` → `callback_url: ${publicBase(req)}/api/course-payment/callback` (line 330) — the route that produced the `-14` log.
- `/api/payment/request` → `callbackUrl = ${publicBase(req)}/api/payment/callback` (line 167) — the exam-package path, **same defect, not observed in logs**.
- The `[course-pay] Zarinpal request error:` line is emitted in the `catch` around `sdk.payments.create` (line 334–337): the gateway answered with `code: -14`; the handler then returns HTTP 400 «خطا در ارتباط با درگاه پرداخت.» and **no `course_payments` row is inserted** (the insert is after the success check, line 344).

### NEW — environment facts (names only, no values)

- `site/app/.env` contains `ZARINPAL_MERCHANT_ID`. **`PUBLIC_BASE_URL` is absent** → branch (A) of `publicBase` is currently **inert**; the callback origin is therefore derived from request headers on every call.
- `zarinpalConfig()` (lines 110–120): `mode = sandbox` only if `ZARINPAL_SANDBOX === 'true'` **or** (`placeholder merchant` **and** `NODE_ENV !== 'production'`). A placeholder merchant in production stays `production`, and `configured` is false → payments disabled with 503. Because the observed failure is a real Zarinpal `code: -14` (a *production-endpoint* validation error, sandbox accepts any callback), the live configuration is **`production` mode with a non-placeholder merchant id**. This is a derived fact, not a read of the value.

### NEW — timestamp arithmetic on the pm2 table (derived)

`pm2 jlist` `pm_uptime` is milliseconds; converted against the `date`/`df` capture (2026-10-22 00:45:23 UTC = epoch 1792625123):

| process | pm_uptime (ms) | derived start (UTC) | note |
| --- | --- | --- | --- |
| `kermanshah-site` | 1792622905602 | 2026-10-22 00:08:25Z | current instance; 13 restarts before it |
| `kermanshahcart-quizbot` | 1792595975383 | 2026-10-21 16:39:35Z | `stopped`, **0 restarts** → deliberate stop, not a crash |
| `carla-crm` | 1792628789988 | 2026-10-22 01:46:29Z | 6 restarts |
| `kermanshahcart-tgbot` | 1792628790959 | 2026-10-22 01:46:30Z | — |
| `kermanshahcart-bot2` | 1792607558146 | 2026-10-21 19:52:38Z | — |

Two consequences, both load-bearing:

1. **The pm2 table was captured later than the `date`/`df` output.** `carla-crm` and `kermanshahcart-tgbot` carry start times of 01:46Z, i.e. ~61 minutes after the 00:45:23Z `date`/`df` capture. The disk figure and the process states are therefore **two different moments**. The `origin.md` header ("Collected at: 00:45 UTC") is only accurate for the `date`/`df`/`free`/`ss` block.
2. **`kermanshah-site` restarted at least once inside the sweep window** (current instance began 00:08:25Z, the sweep's public curl was 00:44Z, Chrome 00:48Z) with **no fatal entry in `kermanshah-site-error.log`** → the restarts look **controlled** (`pm2 restart` during a deploy), not crash-loops. The site was nevertheless serving 200 on both sides of that restart.

---

## Hypothesis and verification

| Hypothesis | Verification Method | Results |
| --- | --- | --- |
| Because origin/pm2/nginx is down, the public site fails | SSH `pm2 jlist`, curl `:5200` and nginx Host | Falsified. Origin 200 in 6ms, nginx 200 |
| Because Arvan or assets are broken, Chrome shows a white/broken page | SOCKS curl of HTML+assets; CDP network; desktop screenshot | Falsified. Home/catalog/assets 200; 0 console exceptions; UI visible |
| Because SMS.ir has no credit, OTP/SMS is broken | `kermanshah-site-error.log` repeated «اعتبار کافی نمیباشد» | Confirmed in logs (not re-tested live send) |
| Because MySQL is missing `full_name`, national-code login fails | same error log, three repeats | Confirmed in logs |
| Because Zarinpal terminal domain ≠ callback URL, course pay fails | log `code: -14` | Confirmed in logs |
| Because disk is nearly full, a future Vite/pm2 write will fail | `df -h /` 96%, 1.4G | Confirmed capacity risk, not an active outage |
| **NEW** The failing SQL is query **2** (`SELECT full_name FROM registrations …`), not query 1 | Static reading of `server-slices.ts:31–38` + MySQL alias semantics + error text `Unknown column 'full_name' in 'field list'` | **Confirmed by deduction** (query 1 cannot emit that message — see §6.1) |
| **NEW** Query 1 executed successfully and returned **0 rows** before query 2 threw | The loop `break`s only on a non-empty result; query 2 was reached ⇒ query 1 neither threw nor returned a row | **Confirmed by deduction** |
| **NEW** The live `registrations` table has no `full_name` column; `schema_mysql.sql` no longer matches production | `information_schema` query to be run by the operator (§9.1) | **Not verified — check pending** |
| **NEW** The `catch` makes every DB failure indistinguishable | Static reading of `server-slices.ts:39–42` | **Confirmed by code** |
| **NEW** The `-14` domain is derived from **request headers**, not from configuration | Static reading of `publicBase` + `PUBLIC_BASE_URL` absent from `.env` | **Confirmed by code** |
| **NEW** The callback host that was actually sent is unknown | The `-14` log line logs the gateway response only, never the constructed `callback_url` | **Confirmed gap — this is why the mismatch is undiagnosable from today's logs** |
| **NEW** `kermanshahcart-quizbot` was stopped deliberately | `status=stopped`, `restart_time=0`, last start 2026-10-21 16:39:35Z | **Confirmed by pm2 data (inference from state, not from a `pm2 stop` audit trail)** |
| **NEW** The 13 site restarts were deploys, not crashes | Last start 00:08:25Z; no fatal/OOM entry in the error log | **Inference — confirm via `~/.pm2/pm2.log`** |

---

## Root cause

### 6.0 Overall

- The public site is **up**. Homepage, SEO routes, catalog (`source: crm`), and Chrome hydration are healthy.
- What is broken are three **authenticated** flows, not the marketing surface:
  1. **National-code login** → HTTP 503 (schema drift + a fallback that is not a fallback).
  2. **Course tuition payment** → HTTP 400 from the gateway (`-14`), no payment authority created.
  3. **OTP / SMS** → provider-side rejection (no credit).
- **Combined impact:** the code comment on `login-national` says «Replaces OTP login» — i.e. national-code login is the *primary* end-user login, and OTP/SMS is the fallback. With OTP out of credit **and** `login-national` returning 503, **an end user currently has no working login path**. Admin/phone-based logins still exist (they are a different route), so staff are unaffected. This makes the two code defects the top functional priority, above the SMS top-up.

### 6.1 `Unknown column 'full_name' in 'field list'` — precise root cause

**Which SQL threw.** The message names `full_name` in the **`'field list'`** context, i.e. a SELECT-list item.

- Query 1 is `SELECT TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) AS full_name FROM students …`. Here `full_name` exists **only as an output alias**. MySQL never resolves an alias against the table, so query 1 **cannot** produce this message. If query 1 had drifted, the message would have been `Unknown column 'first_name' in 'field list'` (or `'last_name'`), because those are the only real columns in its SELECT list.
- Query 2 is `SELECT full_name FROM registrations WHERE national_code = ? AND phone_number = ? LIMIT 1`. Here `full_name` is a **real column reference**. This is the only statement in the handler whose SELECT list contains a resolvable-or-not column literally named `full_name`.

⇒ **The failing statement is query 2, against the live `registrations` table, as seen by the site's MySQL pool.**

**What the message additionally proves.** The loop `break`s only when `rows.length > 0`. Reaching query 2 therefore means:

1. Query 1 **executed without throwing** → the live `students` table **does** expose `first_name` and `last_name` (snake_case).
2. Query 1 **returned 0 rows** → no student row matched that `national_code` + `phone_number`.
3. Query 2 then failed with `ER_BAD_FIELD_ERROR` → the live `registrations` table has **no `full_name` column**.

**A masked second defect.** MySQL aborts while resolving the SELECT list, so the WHERE columns were never resolved. `national_code` and `phone_number` on `registrations` are therefore **unverified** — they may also be drifted (e.g. `nationalCode`, or absent). The first error hides whatever would come next. Do not assume the WHERE clause is safe.

**Why the schema file is not the truth.** `schema_mysql.sql` says `registrations` has `full_name` and `students` has `first_name`+`last_name`. Production disagrees on the first and agrees on the second. Two readings fit, and the operator must disambiguate them (§9.1):

- **(a) Column-naming drift.** The live `registrations` table is camelCase (`fullName`) — consistent with a Directus-managed table (the site's own SQLite `registrations`, used by `coursePaymentQuote`, stores `trackingId`, `fullName`, `phone`, `category`, `status` — camelCase, and a *different* column vocabulary from the login query's `full_name`, `national_code`, `phone_number`). The three registration stores disagree with each other.
- **(b) Different database.** The pool points at a schema other than the one `schema_mysql.sql` documents, and its `registrations` table is not the CRM table.

Either way the **structural** root cause is the same: *the login handler selects a column by a hard-coded name against a table whose live schema is not pinned by the code or by a migration, while the site's own authoritative registration data lives in a different store with a different naming convention.*

**Why the `catch` hides which SQL failed.** Four independent reasons, all in `server-slices.ts:30–42`:

1. **Scope.** One `try` wraps the whole `for` loop. The two queries are not independently protected, so the handler cannot tell "this table is broken" from "this table has no match".
2. **Log content.** Only `e.message` is printed. `e.code` (1054 = `ER_BAD_FIELD_ERROR`), `e.errno`, `e.sqlState`, `e.sql`, the table name, and the loop index are all discarded. Three identical-looking lines in the log (`[login-national] DB error: Unknown column 'full_name' in 'field list'`) are therefore *unattributable to a statement* by a reader of the log alone.
3. **Error collapse.** `withTimeout(..., 4000)` rejections, pool errors, connection errors and schema errors all land in the same `catch` and all produce the same HTTP 503 body. A slow database is indistinguishable from a broken schema.
4. **Wrong error class for the user.** Because the `catch` fires on the first throw, a user whose record *is* present in `registrations` is told «سرویس موقتاً در دسترس نیست» (503) instead of being logged in. The fallback never runs, so the fallback's failure mode (broken table) destroys the primary path's availability.

**Why query 1 can still throw** (the second half of the question — the fallback is fragile in the same way even though query 1 is not the cause *this time*):

- Query 1 needs **four** live columns to resolve: `students.first_name`, `students.last_name`, `students.national_code`, `students.phone_number`. Any one of them drifting to camelCase or disappearing makes query 1 throw `ER_BAD_FIELD_ERROR` — and then query 2 is **never executed**, and the user gets 503.
- Query 1 can also throw for non-schema reasons: the 4s `withTimeout` (two sequential queries ⇒ up to 8s before a 503), pool exhaustion, or a dropped connection. All are swallowed by the same `catch`.
- Therefore the fallback design is only a fallback for *empty result sets*. It is **not** a fallback for *errors*, and that is the defect that turned one stale column into a hard 503 on the site's primary login.

**Minimal code fix (proposed — NOT applied).** Two independent edits; edit A is the safety net, edit B removes the dependency on the stale column name.

*Edit A — per-query isolation + self-diagnosing log* (replaces lines 28–42):

```ts
    let fullName = '';
    let found = false;
    let failed = 0;
    const queries: Array<{ tag: string; sql: string }> = [
      { tag: 'students',      sql: "SELECT TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) AS full_name FROM students WHERE national_code = ? AND phone_number = ? LIMIT 1" },
      { tag: 'registrations', sql: 'SELECT full_name FROM registrations WHERE national_code = ? AND phone_number = ? LIMIT 1' },
    ];
    for (const q of queries) {
      try {
        const [rows]: any = await withTimeout(mysqlPool.execute(q.sql, [nid, phone]), 4000);
        if (rows && rows.length) { found = true; fullName = pickFullName(rows[0]); break; }
      } catch (e: any) {
        failed += 1;
        console.error('[login-national] DB error', {
          query: q.tag, code: e && e.code, errno: e && e.errno, sqlState: e && e.sqlState,
          message: e && e.message,
        });
      }
    }
    if (!found && failed === queries.length) {
      return res.status(503).json({ error: 'سرویس موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.' });
    }
```

Effect: a broken table degrades that **one** source instead of the endpoint; the log names the table and the MySQL error code, so the next occurrence is self-diagnosing; 503 is returned only when **all** sources failed; "no match" stays 401.

*Edit B — stop depending on one column spelling* (after §9.1 confirms the live columns). Preferred is to write the SQL to match the confirmed schema (e.g. `fullName` instead of `full_name`, or `first_name`/`last_name` if that is what the table has). If the schema cannot be confirmed quickly, use a tolerant read:

```ts
    const pickFullName = (r: any): string => {
      const camel = r.fullName ?? r.full_name;
      if (camel) return String(camel).trim();
      const parts = [r.first_name ?? r.firstName, r.last_name ?? r.lastName].filter(Boolean);
      return parts.length ? parts.join(' ').trim() : '';
    };
```

and change query 2's projection to `SELECT * FROM registrations WHERE national_code = ? AND phone_number = ? LIMIT 1` (tolerates both conventions; widen to a named projection once the schema is pinned). Caveat: `SELECT *` also reads `national_code`/`phone_number` back into memory — acceptable server-side, but prefer narrowing it afterwards.

*Durable alternative (not minimal, worth a ticket).* Resolve the name column once at boot from `information_schema.COLUMNS` and build the projection from the live column set, so a future Directus rename cannot break login. Also note the design smell: login reads MySQL `registrations` (`national_code`, `phone_number`) while the payment quote reads SQLite `registrations` (`trackingId`, `fullName`, `phone`) — two stores, two vocabularies, one logical entity. Deciding which one is the source of truth is an owner decision, not a patch.

### 6.2 Zarinpal `code: -14` — precise root cause

**What `-14` means.** Zarinpal rejected the `payment/request` call because **the domain of `callback_url` is not a domain registered for the terminal (پذیرنده) belonging to the merchant**. The check is **domain-scoped** (the gateway's own wording: «callback URL domain … registered terminal domain»), not scheme-scoped.

**The root cause is architectural: the callback origin is derived from the HTTP request, so the operator never declares it.**

`publicBase(req)` returns, in order:

- **(A) `PUBLIC_BASE_URL`** — authoritative. **Currently absent** from `site/app/.env`, so this branch never fires today.
- **(B) `Origin` header**, returned **verbatim, including its scheme**, when `new URL(origin).host === req.headers.host`.
- **(C) `x-forwarded-proto` (or `req.protocol`) + `Host` header**.

Every one of (B) and (C) is **attacker/browser/proxy controlled**. The host that Zarinpal validated is therefore whatever host the visitor happened to use — and the site serves **two** names with **no canonical-host redirect** (`server_name kermanshahcart.ir www.kermanshahcart.ir;`, two vhosts, no `return 301`). Concretely, the ways `publicBase` can emit a host the terminal does not own:

| Vector | Mechanism | Effect on the `-14` | Status |
| --- | --- | --- | --- |
| **`www` vs apex** | A visitor on `https://www.kermanshahcart.ir` sends `Host: www.kermanshahcart.ir`; nginx accepts it (both names in `server_name`) and there is no apex redirect, so `publicBase` emits `www.kermanshahcart.ir`. If the terminal registered only the apex (or only `www`), the domains differ. | **Directly explains `-14`** | Plausible — but whether `www` even resolves to the edge was **not tested** in this sweep (`dig www.kermanshahcart.ir` / Arvan host list not collected) |
| **Arvan / forwarded Host** | The edge forwards the client Host to nginx → app unchanged. Any request arriving with a different Host (an alternate domain, a stale hostname, a direct-to-origin path bypassing Arvan, or a health-check Host) makes `publicBase` emit that host verbatim. The app has **no allowlist** of acceptable hosts. | **Directly explains `-14`** | Plausible — the forwarded Host was never logged |
| **`PUBLIC_BASE_URL`** | Not set → inert today. The day it is set it becomes the single source of truth; a wrong value (wrong domain, or `http://` / a trailing path) reproduces `-14` **deterministically on every request**, and it would also override (B) and (C). | Not the current trigger; **the fix** | Verified absent |
| **`http` vs `https`** | Branch (B) returns the page's own scheme: a page loaded over `http` yields an `http://…` callback. Branch (C) yields `http://` whenever `x-forwarded-proto` is absent at the nginx→node hop (`req.protocol` is `http` there). | **Not the `-14` trigger by itself** — the gateway compares *domains*; the scheme does not change the domain. But it is a real defect: an `http` callback breaks the return leg (edge 301-redirects it, and the redirect hop can change the host) and it silently downgrades the payment return path. | Latent defect — fix in the same change |

**Why the mismatch is undiagnosable from today's logs.** The `-14` line logs only the gateway's response body:

```
[course-pay] Zarinpal request error: {"message":"The callback URL domain does not match the registered terminal domain.","code":-14,"validations":[]}
```

The **constructed `callback_url` is never logged**, and neither are `Host`, `Origin`, `x-forwarded-proto` or `req.protocol`. So the log cannot distinguish `www` from apex, and cannot distinguish "wrong domain" from "wrong merchant/terminal".

**What cannot be concluded (and must not be invented).** The registered terminal domain is **not** observable from the server. It lives in the Zarinpal merchant panel. This report deliberately does **not** guess it. Note also that `ZARINPAL_MERCHANT_ID` is present but its **value** was not read; a terminal belonging to a different business, or one registered under a different domain, is fully consistent with the evidence.

**Minimal code fix (proposed — NOT applied).**

*Fix 1 — a declared origin, never a request-derived one.* Replace `publicBase` (lines 121–129):

```ts
  // The callback origin must be exactly the domain registered for the Zarinpal terminal.
  // Never derive it from request headers: Host/Origin/x-forwarded-proto are client-controlled.
  const PUBLIC_ORIGINS = (process.env.PUBLIC_BASE_URL || '')
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const publicBase = (req: any) => {
    const host = String(req.headers.host || '').toLowerCase();
    const matched = PUBLIC_ORIGINS.find(o => { try { return new URL(o).host.toLowerCase() === host; } catch { return false; } });
    if (matched) return matched;
    if (!PUBLIC_ORIGINS.length) throw new Error('PUBLIC_BASE_URL is not configured');
    return PUBLIC_ORIGINS[0];
  };
```

Effect: an unknown or aliased Host can no longer poison the callback domain — only an explicitly declared origin is ever sent. Setting `PUBLIC_BASE_URL` to the **exact registered domain** (plus `,https://www.…` if both are registered and both must work) makes the callback domain constant. This single change fixes both `/api/course-payment/callback` and `/api/payment/callback`, because both call the same helper.

*Fix 2 — make the next occurrence self-diagnosing.* Immediately before `sdk.payments.create` (line 328) log the host that will be sent, without the merchant id:

```ts
    const callbackUrl = `${publicBase(req)}/api/course-payment/callback`;
    console.warn('[course-pay] zarinpal callback', {
      callbackHost: new URL(callbackUrl).host, callbackOrigin: new URL(callbackUrl).origin,
      host: req.headers.host, origin: req.headers.origin,
      xForwardedProto: req.headers['x-forwarded-proto'], reqProtocol: req.protocol,
      publicBaseConfigured: PUBLIC_ORIGINS.length > 0, mode: zp.mode,
    });
```

*Fix 3 — fail fast instead of silently mis-calling.* If `PUBLIC_BASE_URL` is unset, refuse to create a payment request with a clear 503 («آدرس بازگشت درگاه تنظیم نشده است») rather than sending a request-derived domain. This converts a silent gateway rejection into a self-explanatory server error.

*Operational note.* `process.env` is read at request time but the value is injected at process start, so **changing `site/app/.env` requires `pm2 restart kermanshah-site`** to take effect.

### 6.3 Remaining items — ranking, ops vs code

| # | Item | Class | Impact | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Disk `/` 96% (1.4G free)** | **OPS** | Blocks the deploy of every other fix | `npm ci` + `npm run build` + a fresh `dist` may exceed 1.4G. Also: SQLite writes (`course_payments`) fail on `ENOSPC`, which would surface as an unexplained failure *inside* the course-pay flow. Do this **first** — it gates the code fixes |
| 2 | **`login-national` 503 (`full_name`)** | **CODE** | Primary end-user login is broken; with OTP also broken there is no working end-user login | Fix = §6.1 Edit A (+ Edit B after §9.1). Needs a build + `pm2 restart` ⇒ depends on #1 |
| 3 | **Zarinpal `-14` on course-pay** | **CODE + CONFIG** | Tuition revenue path blocked (HTTP 400, no authority row) | Needs the registered domain from the Zarinpal panel (operator) + the code fix (§6.2). The config half must land with the code half |
| 4 | **SMS.ir credit exhausted** | **OPS** (billing) | OTP / registration SMS dead | No code change required; the app already logs it. Note the app's own OTP-failure alert goes out via **Telegram**, and the log also shows a Telegram timeout ⇒ the alert channel may itself be dead, so the operator may be unaware of a repeat outage. Top up, then verify one send |
| 5 | **13 pm2 restarts (`kermanshah-site`), 6 on `carla-crm`** | **OPS / forensics** | No current user impact (site 200) | Last instance start 2026-10-22 00:08:25Z; **no fatal entry in the error log** ⇒ consistent with deploy-triggered `pm2 restart`, not a crash-loop. **pm2's default `max_restarts` is 15** — at 13/15 only two more restarts remain before pm2 stops auto-restarting and the site would stay down with no recovery. Verify with `pm2 describe` (`max_restarts`, `unstable`, `exp_backoff_restart_delay`) and `~/.pm2/pm2.log` |
| 6 | **`kermanshahcart-quizbot` stopped** | **OPS / owner decision** | Quiz-bot feature offline only | `status=stopped`, `restart_time=0`, last start 2026-10-21 16:39:35Z ⇒ **deliberately stopped**, not crashed. No code work implied; needs an owner decision (restart or retire) and log rotation for `kermanshahcart-quizbot-error.log` |

**Ordering that actually matters:** #1 (disk) → #2/#3 (code + build) → #4 (SMS top-up) → #5/#6 (ops hygiene). Freeing disk first is not cosmetic: the code fixes cannot be built and deployed safely on a 96%-full root.

---

## Fix content

- **None applied.** This run was inspect + dossier only. No file was edited on the server, no service was restarted, no environment variable was changed, no payment request was replayed, and no secret was read or printed.
- All code changes above are **proposals** with the exact edited region quoted (`server-slices.ts` line numbers map 1:1 to `site/app/server.ts`).

---

## Verification results

- Public SOCKS: home and catalog 200.
- Origin: `:5200` and nginx 200.
- Chrome CDP: readyState complete, 0 exceptions, 0 4xx/5xx.
- Desktop Chrome: site visible on Display `:1`.
- Static analysis of `server-slices.ts`: the `-14` log line is traceable to `/api/course-payment/request` → `sdk.payments.create` (line 328) → `catch` (line 334–337) → HTTP 400 to the browser; no `course_payments` row is written on failure.
- **Not verified in Chrome** (no click was performed in any browser session of this sweep):
  - the OTP button / `POST /api/auth/send-otp` — the SMS.ir rejection was only observed in the **server log**, not reproduced;
  - the national-code login form / `POST /api/auth/login-national` — the 503 was only observed in the **server log**;
  - the course-payment quote + pay buttons / `POST /api/course-payment/quote` and `/api/course-payment/request` — the `-14` was only observed in the **server log**;
  - `/api/payment/request` (exam-package purchase) — **never observed** at all, though it shares the same `publicBase` defect;
  - the admin/panel login route and the OTP-failure Telegram alert delivery.

---

## Residual risk

- **Disk 96% on a 30G root.** Next `npm ci` / `npm run build` is unsafe; SQLite writes can fail with `ENOSPC` inside the payment flow.
- **13 restarts on `kermanshah-site`, 6 on `carla-crm`** — cause not bisected. Evidence points to deploy-triggered restarts (last start 00:08:25Z, no fatal log entry), but `~/.pm2/pm2.log` was not read. pm2's default `max_restarts` of 15 means the auto-restart safety net is nearly consumed.
- **Evidence timing is inconsistent**: the `date`/`df` block is 00:45:23Z, the pm2 table is ≥ 01:46:30Z (§ Evidence, timestamp arithmetic). Disk and process state are from different moments.
- **HTML asset hashes changed between the 00:44 curl and the 00:48 Chrome load** (`index-Ask7uthh.js` → `index-B7Nb07zE.js`). Both generations 200; consistent with a dist rebuild in that window — and with a `pm2 restart` at 00:08:25Z.
- **The live `registrations` schema is unverified.** The exact column set (and the database the pool points at) is the single missing fact behind §6.1; until §9.1 runs, Edit B of the fix is a mitigation, not a proof.
- **The Zarinpal registered terminal domain is unknown** and was deliberately not guessed. Until the panel is read, the `-14` vector (apex vs `www` vs another host) stays a ranked hypothesis, not a conclusion.
- **`publicBase` is shared by two payment routes**; fixing only `/api/course-payment/callback` would leave `/api/payment/callback` broken.
- **Clarity (`clarity.ms`)** loads from abroad; if blocked for some Iranian clients that is analytics-only.
- **`/api/track/view`** abort + 204 is telemetry, not UI.
- **Quizbot stopped** (deliberately); Telegram timeout in the logs means the OTP-failure admin alert may not be delivering.
- **`cert`/`env` values were never read.** Only `.env` *names* are quoted. `ZARINPAL_MERCHANT_ID`'s value is unknown to this report.
- **The deployed `server.ts` was read as excerpts.** The excerpts are stated to be live from `/project/kermanshahcart/site/app/server.ts` at clean git `3857afd`; they were not diffed against `git show HEAD:server.ts` in this pass.

---

## Next steps (owner / operator)

> همهٔ شناسه‌های فنی (نام جدول، ستون، مسیر API، کد خطا) به انگلیسی باقی مانده‌اند. هیچ‌کدام از تغییرات زیر هنوز اعمال نشده است.

1. **اول فضای دیسک را آزاد کنید (بدون deploy).** تا وقتی `/` روی ۹۶٪ است، هیچ build و هیچ deploy ایمن نیست.
   - `du -xhd1 / | sort -h | tail -20` و `du -xhd1 /root/.pm2 /var/log /project | sort -h | tail`
   - `journalctl --disk-usage` ، `docker system df` (روی همین سرور یک `docker-proxy` روی `127.0.0.1:8055` فعال است)
   - لاگ‌های pm2 را بایگانی کنید و سپس `pm2 flush` بزنید؛ برای آینده log rotation فعال کنید (`site-error-logger` هم بدون سقف حجم است)
   - `node_modules`/`dist` قدیمی و cacheهای npm را پاک کنید
2. **سیستم را فقط خواندنی بررسی کنید تا دیتابیس واقعی را قطعی کنید (بدون تغییر):**
   ```sql
   SELECT DATABASE();
   SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('students','registrations')
    ORDER BY TABLE_NAME, ORDINAL_POSITION;
   ```
   نتیجهٔ این دو کوئری تعیین می‌کند که آیا ستون `full_name` وجود ندارد و آیا ستون‌های `national_code` / `phone_number` هم تغییر کرده‌اند یا نه.
3. **پنل زین‌پال را بخوانید:** دامنهٔ ثبت‌شدهٔ ترمینال (پذیرنده) مربوط به `ZARINPAL_MERCHANT_ID` را دقیقاً یادداشت کنید، و بررسی کنید که آیا هم apex و هم `www` ثبت شده‌اند. سپس مقایسه کنید با host واقعی که در درخواست ارسال می‌شود:
   - `dig +short kermanshahcart.ir` و `dig +short www.kermanshahcart.ir` (آیا `www` اصلاً به Arvan می‌رسد؟)
   - `curl -sI https://www.kermanshahcart.ir/ | head -1` (آیا `www` سایت را سرو می‌کند یا به apex ریدایرکت می‌شود؟)
   - `nginx -T | grep -iE 'server_name|forwarded|proxy_set_header'` (آیا nginx مقدار `X-Forwarded-Proto` را ست می‌کند؟)
   - بعد از افزودن لاگ پیشنهادی §6.2، یک پرداخت آزمایشی بزنید و host ثبت‌شده را بخوانید.
4. **کد را اصلاح کنید (پس از آزاد شدن دیسک):** دو بلوک پیشنهادی §6.1 (Edit A + Edit B) و §6.2 (Fix 1 + Fix 2 + Fix 3). `PUBLIC_BASE_URL` را دقیقاً روی همان دامنهٔ ثبت‌شدهٔ ترمینال تنظیم کنید و بعد `pm2 restart kermanshah-site` بزنید (تغییر `.env` بدون restart اعمال نمی‌شود).
5. **شارژ حساب SMS.ir** و سپس **یک** ارسال OTP را تست کنید و نتیجه را در `kermanshah-site-error.log` ببینید. به یاد داشته باشید که هشدار خودکارِ خطای OTP از طریق Telegram می‌رود و در لاگ، خطای timeout تلگرام هم دیده می‌شود؛ پس کانال هشدار را هم جداگانه بررسی کنید.
6. **تعداد ری‌استارت‌ها را علت‌یابی کنید:** `pm2 describe kermanshah-site` (مقادیر `max_restarts`، `unstable restarts`، `exp_backoff_restart_delay`) و `tail -n 200 ~/.pm2/pm2.log | grep -i kermanshah-site`. اگر ری‌استارت‌ها واقعاً crash هستند، سقف `max_restarts` را بالا نبرید تا مسئله پنهان نشود — اول علت را رفع کنید.
7. **تصمیم مالکیتی برای `kermanshahcart-quizbot`:** آن را نگه دارید و راه‌اندازی کنید، یا از pm2 خارج و از چرخهٔ deploy حذف کنید.
8. **پس از deploy، این سه سناریو را در Chrome کلیک کنید** (در این sweep کلیکی انجام نشده و فقط لاگ سرور شاهد بوده است): ورود با کد ملی، ارسال OTP، و پرداخت شهریهٔ دوره. معیار قبولی: ورود با کد ملی ۲۰۰ به‌جای ۵۰۳، و پرداخت با پاسخ `code: 100` از Zarinpal به‌جای `-14`.

---

## Attachments

- `debug-2026-10-22-004900-origin.md`
- `debug-2026-10-22-004900-public-http.md`
- `debug-2026-10-22-004900-chrome-audit.json`
- `debug-2026-10-22-004900-chrome-home.png`
- `debug-2026-10-22-004900-desktop.png`
- `dossier.md` (original report, preserved above)
- `origin.md` (origin evidence, preserved above)
- `chrome-audit.json`
- `server-slices.ts` (live `site/app/server.ts` excerpts analysed in §6.1 / §6.2)
