# CRM Full-Stack UI/API Audit — Carla CRM (`crm`)

**Auditor:** MiniMax (fullstack code audit / QA)
**Date:** 2026-10-22
**Repo:** `/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm`
**Task:** `AUDIT_TASK.md` — audit every tab, button and user action; cross-check each triggered API endpoint against `server.ts`.
**Stack:** React 19 + Vite (TS) frontend, Express 4 + `tsx` backend, MySQL (Chabokan) primary / `db_store.json` fallback, phase-4 modules `phase4.ts` + `courseTerms.ts`.

---

## 0. Method

1. Enumerated every interactive element in `src/App.tsx` and every component it mounts (tab-by-tab).
2. For each button: traced `onClick` → handler → `src/api/*` client function → HTTP method+path → the Express route in `server.ts` / `phase4.ts` / `courseTerms.ts` → the SQL/JSON-store implementation.
3. Checked role gating in three places that must agree: `NAV_ITEMS[].roles` (`src/App.tsx:40-138`), `canAccessApi()` (`server.ts:843-869`) and the per-route `requireAdmin` / `requireStaff` guards.
4. Ran `npx vite build` (✅ passes) and `npx tsc --noEmit` (❌ fails — see **H1**).

**Files inspected (100 % of `src/`):**
`App.tsx`, `main.tsx`, `api/client.ts`, `api/phase4.ts`, `api/courseTerms.ts`, `api/scanner.ts`, `types.ts`, `utils/{finance,studentFilters,exportCsv,normalize,printDocs,labels,charts,registrationCategory,copilotDate,cardImageQuality}.ts`, and every file in `src/components/**` (30 files incl. `print/`, `forms/`).
Server side: `server.ts` (4449 lines), `phase4.ts`, `courseTerms.ts`, `mysql-socks.ts`, `scripts/backup-db.sh`.

---

## 1. Severity summary

| # | Sev | Area | Title | File:Line |
|---|-----|------|-------|-----------|
| **H1** | 🔴 Critical | Build/CI | `npm run lint` is broken and **hides every `src/` type error** | `tsconfig.json` + `reports/debug-2026-10-22-freemodel/server-slices.ts` |
| **H2** | 🔴 High | Students | Student `status` is hard-coded `'active'` → status column is fake, status can never change | `mysql-socks.ts:406,250`; `StudentsList.tsx:77-93,838-856` |
| **H3** | 🔴 High | Print | `?print=contract` renders a **completely blank contract** | `src/App.tsx:481-482`; `forms/ContractPrintForm.tsx:55-64` |
| **H4** | 🔴 High | Print/Finance | `final_price = 0` (100 % discount) prints the **full course tuition** | `src/utils/printDocs.ts:151` |
| **H5** | 🔴 High | Settings/Backup | Backup **download and restore do not exist** (list-only) | `AuditBackupPanel.tsx`; `server.ts:4357-4369` |
| **H6** | 🟠 High | Settings/Backup | `dir_configured:false` ignored → misleading "no backups yet" error | `AuditBackupPanel.tsx:31-32`; `server.ts:4367` |
| **H7** | 🟠 High | 4 tabs | Leads / Tasks / Campaigns / Terms return **HTTP 503** when MySQL is down | `phase4.ts:236-240`; `courseTerms.ts:73-76` |
| **H8** | 🟠 High | Build | `PrintInvoiceButton.tsx` imports **`jspdf-autotable` which is not installed** | `src/components/PrintInvoiceButton.tsx:4` |
| **M1** | 🟡 Medium | Students | "ارسال پیام" hard-codes `channel:'sms'` → 400 for a phone-less student; label lies | `StudentsList.tsx:308-320`; `server.ts:1823` |
| **M2** | 🟡 Medium | Students | Editing a student 400s if the stored phone isn't `09#########` (blocks *all* edits) | `client.ts:294-303`; `server.ts:1904-1910` |
| **M3** | 🟡 Medium | Students | Instructor gets 403 on `/payments` → financial column + «بدهکاران» filter are dead | `server.ts:855`; `StudentsList.tsx:612-621,739-754` |
| **M4** | 🟡 Medium | Tasks | Sidebar badge counts only *my* tasks while the table lists *all* | `phase4.ts:361-367` vs `343-359`; `App.tsx:375-380` |
| **M5** | 🟡 Medium | Leads | `GET /api/leads` silently caps at 1000 rows, no pagination | `phase4.ts:266`; `api/phase4.ts:28-29` |
| **M6** | 🟡 Medium | Campaigns | Term selector never clears the sibling key → wrong recipients, silently | `BulkMessaging.tsx:93`; `phase4.ts:139-146` |
| **M7** | 🟡 Medium | Campaigns | After a real send the preview is **not** cleared → duplicate bulk send | `BulkMessaging.tsx:57-64` |
| **M8** | 🟡 Medium | Accounting | Expense modal has no date field → every expense dated "today" | `AccountingDashboard.tsx:198-217`; `server.ts:2771` |
| **M9** | 🟡 Medium | Accounting | `category` is never persisted in MySQL mode → «دسته‌بندی» is a lie | `server.ts:2776-2781`; `client.ts:585-588` |
| **M10** | 🟡 Medium | Settings | «روش‌های پرداخت» is a hard-coded, non-editable list; no endpoint | `Settings.tsx:174-178` |
| **M11** | 🟡 Medium | Messenger | Quick-reply chips send literal `[خانوادگی]`, `[دوره]`, `[بدهی]` to students | `MessengerHub.tsx:763` |
| **M12** | 🟡 Medium | Messenger | StudentsList SMS and MessengerHub SMS behave **differently** (Rubika re-routing) | `server.ts:1789-1798`; `StudentsList.tsx:313` vs `MessengerHub.tsx:448` |
| **M13** | 🟡 Medium | Leads | Convert creates a student with **no enrollment**; UI ignores the returned id | `phase4.ts:297-311`; `App.tsx:554`; `StudentsList.tsx:46` |
| **M14** | 🟡 Medium | Site req. | `phoneKey` + `'0'+key` → **double leading zero** for 10-digit phones → 400 | `SiteRequestsHistory.tsx:18,66`; `phase4.ts:280` |
| **M15** | 🟡 Medium | Dashboard | Calendar is locked to the current month; other months unreachable | `SupervisorDashboard.tsx:95,456-536` |
| **M16** | 🟡 Medium | Settings | `rubika_active`, `rubika_channel_id`, `sms_auto_exam` are **unreachable dead config** | `Settings.tsx:120-126`; `server.ts:1601-1615,3003-3022` |
| **L1** | ⚪ Low | Build | `PrintInvoiceButton.tsx` is entirely dead code (no importer) | `src/components/PrintInvoiceButton.tsx` |
| **L2** | ⚪ Low | Code | `CopilotContextValue` interface declared twice | `CopilotWidget.tsx:40-52` and `73-83` |
| **L3** | ⚪ Low | Messenger | 5-second polling of the API never stops, even on a hidden tab | `MessengerHub.tsx:281` |
| **L4** | ⚪ Low | Messenger | A background data refresh can overwrite a hand-written SMS body | `MessengerHub.tsx:407-425` |
| **L5** | ⚪ Low | Export | CSV formula-injection guard turns negative numbers into text | `exportCsv.ts:10` |
| **L6** | ⚪ Low | Students | Excel export uses all-time aggregates, not the on-screen filters | `StudentsList.tsx:633-643`; `mysql-socks.ts:407-409` |
| **L7** | ⚪ Low | API | `sendSms()` / `syncDb()` hit endpoints that **do not exist** (404) | `client.ts:973-986` |
| **L8** | ⚪ Low | App | `new URLSearchParams(...)` evaluated twice per render | `App.tsx:481-484` |
| **L9** | ⚪ Low | UI | Button says "Excel" but writes `.csv` | `exportCsv.ts:25` |

---

## 2. Detailed findings

### 🔴 H1 — `npm run lint` fails and masks every `src/` type error

**Where**
* `tsconfig.json` — has **no `include` / `exclude`**, so `tsc --noEmit` compiles the entire repo.
* `reports/debug-2026-10-22-freemodel/server-slices.ts:1-3` — a debug scratch file that starts *mid-function*:

```ts
      user = { id: Date.now().toString(), phone, fullName: 'ادمین آموزشگاه', purchasedExams: [] };
      await saveUser(user);
```

**Evidence**
```
$ npx tsc --noEmit
reports/debug-2026-10-22-freemodel/server-slices.ts(3,5): error TS1128: Declaration or statement expected.
... 125 syntax errors, all in that one file
$ npm run lint   →  exit 1
```

TypeScript reports **syntactic** diagnostics first and *skips semantic diagnostics entirely* when any syntax error exists. So the 125 errors in `reports/` silently hide the real `src/` errors. Proof (scoped to `src` only):

```
src/App.tsx(303,64): error TS2345: Argument of type '{ username: string; role?: string; full_name?: string; }'
  is not assignable to parameter of type 'SetStateAction<{ username: string; role?: StaffRole; full_name?: string; }>'.
  Type 'string' is not assignable to type 'StaffRole'.
src/utils/printDocs.ts(52,47): error TS2580: Cannot find name 'Buffer'. Do you need to install type definitions for node?
```

**Impact**
* `npm run lint` (the only static gate in `package.json`) is permanently red → the team cannot detect new type errors.
* Two real errors are live today:
  * `src/App.tsx:303` — `LoginScreen`'s `onLoggedIn` payload types `role` as `string`, but `App` stores it as `StaffRole`. `role` is narrowed at `App.tsx:279`, so it currently works by accident; any widening of `LoginScreen`'s type silently corrupts the role gate (admin vs cashier vs instructor decides which tabs render).
  * `src/utils/printDocs.ts:52` — `Buffer` is a Node global used in `isPdfBytes()`; the browser build has no Node types.

**Fix**
```jsonc
// tsconfig.json
"include": ["src"],
"exclude": ["node_modules", "dist", "reports", "scripts"]
```
and move `reports/**` out of the TS program (or delete the scratch `.ts` file). Then fix the two real errors (`LoginScreen` → `role?: StaffRole`; `printDocs.ts` → use `Uint8Array` instead of `Buffer` in the signature).

---

### 🔴 H2 — Student status is hard-coded `'active'`: the «وضعیت» column is fake and status can never be changed

**Where**
* `mysql-socks.ts:406` — `listStudents()`: `'active' AS status,`
* `mysql-socks.ts:250` — `fetchStudentById()`: `'active' AS status`
* `src/api/client.ts:255` — `status: (s.status ?? s.registration_status ?? 'active')`
* `src/components/StudentsList.tsx:77-93` — `StatusBadge` renders «فعال / تعلیق / فارغ‌التحصیل»
* `src/components/StudentsList.tsx:838-856` — the «ویرایش پرونده» modal has **no status field**
* `server.ts:1879-1919` — `parseStudentInput()` never returns `status` in `data`
* `server.ts:2101-2108` — MySQL branch: `...data` (no `status`) → dropped
* `mysql-socks.ts:516-556` — `updateStudent()` UPDATE list has **no `status` column**
* `server.ts:2112-2120` — JSON-store branch *does* handle `body.status` (unreachable dead code)

**Impact**
* Every student always shows «فعال» in the «وضعیت» column of the students table (`StudentsList.tsx:757-759`) and in the profile card (`342`).
* «تعلیق» / «فارغ‌التحصیل» are unreachable states: the `students` table has no `status` column, the UI has no control, and the API silently discards the field.
* The JSON-store code path (`server.ts:2112-2120`) is dead code that a future maintainer will mistake for a working feature.
* Filters/queries that should exclude graduated students cannot exist.

**Fix** — add `status VARCHAR(20) NOT NULL DEFAULT 'active'` to `students` (additive, like the existing `ensureStudentExtendedColumns()`), include it in `listStudents`/`fetchStudentById`/`updateStudent`, return it from `parseStudentInput`, and add a `<select>` to the edit modal.

---

### 🔴 H3 — `?print=contract` renders a completely blank contract

**Where**
* `src/App.tsx:481-482`
```tsx
{new URLSearchParams(window.location.search).get('print') === 'contract' ? (
  <ContractPrintForm />
) : ...
```
* `src/components/forms/ContractPrintForm.tsx:55-64` — all props are **optional with placeholder defaults**:
```tsx
organizationName = 'کارت هوشمند کرمانشاه',
caseNumber = '………',
studentName = '………………',
nationalId = '………………',
courseTitle = '………………',
paymentAmount = '………………',
rules = DEFAULT_RULES,
```
* `grep -rn "print=contract" src/` → only `App.tsx`. **No button anywhere links to it.**

**Impact**
* The route is reachable by typing the URL, and produces a printable A4 contract whose name, national ID, course and payment amount are all literal dots, with a hard-coded academy name that ignores «مشخصات آموزشگاه» from Settings.
* The configurable «متن قرارداد آموزشی» (`contract_text`, Settings → مشخصات آموزشگاه, saved at `server.ts:2614-2622`) and the `DEFAULT_CONTRACT_TEXT` used by the *new* pipeline (`src/utils/printDocs.ts:77-83`) are **not** used by this form — it has its own `DEFAULT_RULES` (`ContractPrintForm.tsx:21-53`), so the two contract renderers can print different legal text.
* There is no `?print=contract&enrollment=ID` variant, so the real data can never reach it.

**Fix** — either delete the legacy `ContractPrintForm` route and keep only the `DocByKind` contract in `PrintDocs.tsx`, or wire it to `api.fetchEnrollmentDocContext(enrollmentId)` exactly like `PrintPreview.tsx:52-74` does.

---

### 🔴 H4 — `final_price = 0` prints the full course tuition

**Where** — `src/utils/printDocs.ts:151`
```ts
const tuition = Number(enrollment.final_price) || Number(course?.tuition) || 0;
```
`||` treats a legitimate **0** as "absent" and falls back to the catalogue price.

**Impact**
* A 100 %-discounted enrollment (final_price = 0, a real scenario — `StudentRegistrationForm.tsx:400-402` computes `finalPrice = c.tuition - discount` and `Math.max(0, …)`) prints «شهریه کل = <catalogue price>» on the **رسید ثبت‌نام**, the **برگ خلاصه پرونده** and the **قرارداد**, and the computed «مانده» is wrong too.
* Reached from `src/components/print/StudentDocsSection.tsx:33` (the profile-card document panel) and `src/components/print/PrintPreview.tsx:58`.
* Note the registration flow is *not* affected (`StudentRegistrationForm.tsx:661` uses `enrollmentObj.final_price || finalPrice`, and `finalPrice` is 0 in that case) — the bug only bites when the docs are regenerated later from the profile card.

**Fix** — `const tuition = enrollment.final_price != null && enrollment.final_price !== '' ? Number(enrollment.final_price) : Number(course?.tuition ?? 0);`

---

### 🔴 H5 — Backup download and restore do not exist

**Where**
* `src/components/AuditBackupPanel.tsx:40-59` — the «بکاپ خودکار دیتابیس» card only *lists* file names/sizes.
* `server.ts:4357-4369` — the only backup endpoint:
```ts
/** Nightly mysqldump files written by scripts/backup-db.sh (cron). Lists names/sizes only. */
app.get('/api/settings/backups', requireAdmin, (_req, res) => { … res.json({ dir_configured: true, files }); });
```
* `grep -rn "restore|db-backups"` → no restore route, no download route, anywhere.
* `scripts/backup-db.sh` is a **cron-only** mysqldump script; it cannot be triggered or reversed from the CRM.

**Impact**
The audit task explicitly expects "backup download/restore". Neither exists. A user who sees the panel has **no way to** download a backup, verify it, or restore it — the only recovery path is shell access to the server. The panel's "همه بکاپ‌ها" list is therefore informational only.

**Fix** — add `GET /api/settings/backups/:name/download` (stream the `.sql.gz`, admin-only, path-traversal safe) and, if restore is required, a `POST /api/settings/backups/:name/restore` that is deliberately gated (env flag + typed confirmation) and audited.

---

### 🟠 H6 — `dir_configured` is ignored → a wrong error message

**Where**
* `server.ts:4367` — `catch { res.json({ dir_configured: false, files: [] }); }`
* `src/api/client.ts:1001-1005` — the type declares `dir_configured: boolean`.
* `src/components/AuditBackupPanel.tsx:31-32` — `const [a, b] = await Promise.all([...]); setRows(a.rows); setTotal(a.total); setBackups(b.files);` → **`b.dir_configured` is never read.**
* `src/components/AuditBackupPanel.tsx:46` — renders the red «هنوز هیچ بکاپی ثبت نشده است.»

**Impact**
When `CRM_BACKUP_DIR` is unset/wrong (the default is `/project/_archive/db-backups`, `server.ts:4359`, which does not exist in this deployment) the server answers `dir_configured:false, files:[]` and the UI claims "no backups have been recorded yet" — implying the cron ran but produced nothing, instead of "the backup folder is not configured on this server". Operators chase the wrong problem.

**Fix** — branch on `b.dir_configured` and show «پوشه بکاپ روی سرور تنظیم نشده است (CRM_BACKUP_DIR)».

---

### 🟠 H7 — Four tabs return HTTP 503 when MySQL is unreachable

**Where**
* `phase4.ts:236-240`
```ts
const need = (res: express.Response) => { if (!ready) { res.status(503).json({ error: 'این بخش فقط با داتابیس MySQL فعال است.' }); return false; } return true; };
```
`ready` is only set inside `ensurePhase4Schema()`, which returns early when `!db.isMysqlEnabled()` (`phase4.ts:44`).
* `courseTerms.ts:73-76` — identical guard.

**Impact** — when the MySQL link drops (it goes through a **SOCKS proxy**: `.env` → `DB_SOCKS_HOST=iran-proxy`, `.env.local` → `127.0.0.1:1081`), `isMysqlEnabled()` flips to false and:
| Tab | Endpoint | Result |
|---|---|---|
| سرنخ‌ها (Leads) | `GET/POST/PUT /api/leads*` | 503 |
| کارها (Tasks) | `GET/POST/PUT /api/tasks*` | 503 |
| پیام انبوه (Campaigns) | `/api/campaigns*` | 503 |
| مدیریت دوره‌ها (Terms) | `/api/course-terms*` | 503 |
| Supervisor → active-trainee monitor | `GET /api/course-terms?status=active` | 503 |
| Supervisor + Students → activity timeline | `/api/activities` | 503 |

Meanwhile `GET /api/students|courses|enrollments|payments` still answer from `db_store.json`, so **the app looks half-alive**: the students list works but «سرنخ‌ها», «کارها» and «مدیریت دوره‌ها» are empty/error. `GET /api/registrations` also degrades to `[]` (`server.ts:2799-2801`) so the pending-registration panel silently empties.
The 5 tabs above are exactly the ones `App.tsx` renders unconditionally for admin/cashier (`492-560`) — there is no client-side guard for the 503.

**Fix** — (a) surface a global banner when `/api/health` reports `db: 'json-file'` while the client expects MySQL; (b) make the affected panels render an explicit «قابل استفاده نیست» state instead of an empty table; (c) at minimum, return a distinguishable error code so the UI can explain itself.

---

### 🟠 H8 — `PrintInvoiceButton.tsx` imports a package that is not installed

**Where** — `src/components/PrintInvoiceButton.tsx:3-4`
```ts
// @ts-ignore
import autoTable from 'jspdf-autotable';
```
* `package.json` dependencies: **no `jspdf-autotable`**.
* `ls node_modules | grep -i autotable` → **empty** (not installed, not even transitively).

**Impact**
* The `@ts-ignore` hides the missing-module error, and because the file is imported by nobody it never enters the Vite module graph — `vite build` passes today (verified: ✅ 2843 modules, built in 11.44 s).
* The moment anyone imports `PrintInvoiceButton` (it exports a ready-made «چاپ فاکتور رسمی» button with download) the **production build fails** with *"Failed to resolve import 'jspdf-autotable' from src/components/PrintInvoiceButton.tsx"*.
* Note `jspdf` is `^4.2.1`; `jspdf-autotable` v5 has a different API (`autoTable(doc, opts)` vs the v3 `doc.autoTable(opts)`), so the code at `PrintInvoiceButton.tsx:113-120` would also need updating.

**Fix** — `npm i jspdf-autotable` (and adapt to the v5 API), or delete the file (see **L1**).

---

## 3. Medium findings (detail)

### M1 — «ارسال پیام» hard-codes `channel:'sms'`; 400 for a phone-less student
`src/components/StudentsList.tsx:308-320` sends `{ channel: 'sms', recipient: messagingStudent.phone_number || '', … }`.
`server.ts:1823` → `if (!phone || !message) return res.status(400).json({ error: 'گیرنده و متن پیام الزامی است.' })`.
**Impact:** the modal opens and the send button is enabled for a student with no phone; the operator gets a raw server error instead of a field-level message. The button label «ارسال پیام (روبیکا/پیامک)» also contradicts the hard-coded `channel:'sms'` (the server only upgrades to Rubika when a thread already exists — `server.ts:1789-1798`).

### M2 — Editing a student 400s on a non-standard stored phone
`src/api/client.ts:294-303` sends the whole student record; `server.ts:1904-1910` validates `phone_number` with `/^09\d{9}$/` and returns 400 for anything else. **Impact:** for a legacy row (phone stored with spaces/dashes, `+98…`, or a landline) the operator cannot save *any* field (address, name…) until they also fix the phone. The modal shows the server message but does not highlight the offending field.

### M3 — Instructor role: financial column and «بدهکاران» filter are dead
`server.ts:855` → `if (path.startsWith('/payments') || path.startsWith('/expenses')) return role === 'cashier';` → an instructor gets **403** on `GET /api/payments`. `src/App.tsx:196-213` swallows the 403, so `payments` stays `[]`. The students tab *is* allowed for instructors (`App.tsx:49-56`), and `StudentsList.tsx:739-754` still renders the «وضعیت مالی» column (always «—») and `612-621` still offers the «تسویه‌شده / بدهکاران» filter, which can only ever produce an empty list.

### M4 — Tasks badge contradicts the tasks table
`phase4.ts:361-367` `GET /api/tasks/summary` counts `WHERE assignee_username = <me>`; `phase4.ts:343-359` `GET /api/tasks` with `mine=0` returns **all** tasks for an admin. The sidebar badge (`App.tsx:375-380`) therefore shows e.g. `3` while the panel lists `50` open tasks.

### M5 — `GET /api/leads` silently caps at 1000
`phase4.ts:266` `… ORDER BY l.lead_id DESC LIMIT 1000`; `src/api/phase4.ts:28-29` has no paging. Older leads simply vanish from the tab and from the counts in the status pills (`LeadsPanel.tsx:87-92`).

### M6 — BulkMessaging term selector keeps the stale key
`src/components/BulkMessaging.tsx:93`
```tsx
setFilters({ target:'term', channel: filters.channel, debtors: filters.debtors, …(k==='id'?{term_id:Number(v)}:k==='num'?{term_number:Number(v)}:{}) })
```
Choosing a course *number* after a course *id* leaves **both** set; `phase4.ts:139-146` prefers `term_id`, so the «شماره دوره» selection is silently ignored and the preview shows the wrong recipient set with no warning.

### M7 — Duplicate bulk send risk
`src/components/BulkMessaging.tsx:57-64` (`start()`) clears the confirmation modal but leaves `preview` and `removed` intact; the only reset is `useEffect(…, [filters, template])` (line 51) and neither changed. **Impact:** after a real send the operator can immediately fire the same campaign again; the server has no idempotency key (`phase4.ts:424-447`).

### M8 — Expenses are always dated "today"
`src/components/AccountingDashboard.tsx:198-217` `createExpense({title, amount, category, description})` — no `pay_date_jalali`; `server.ts:2771` `requestDate(...)` defaults to today. The expense modal has **no date input**. **Impact:** the «ماه جاری» / «تاریخ سفارشی» filters can never show a back-dated expense, and the «دفتر کل» shows every expense on today's date.

### M9 — `category` is not persisted (MySQL)
`src/api/client.ts:601-612` sends `pay_method` **and** `category`; `server.ts:2776-2781` (MySQL branch) persists only `pay_method` (which it overwrites with the category string) + `description` + date. `client.ts:588` then reads `category: ex.category ?? ''` → always `''` in MySQL. `AccountingDashboard.tsx:193` (`ex.category || ex.pay_method`) works only by accident, and `DebtorsReport`/the ledger cannot filter by the real category.

### M10 — «روش‌های پرداخت» is a static list
`src/components/Settings.tsx:174-178`
```tsx
const [paymentMethods] = useState([ { id:1, name:'کارتخوان', code:'pos', … }, … ]);
```
No setter, no add/edit/delete, no server endpoint. The payment methods actually used by the app are hard-coded literals in `StudentsList.tsx:944-949` and `StudentRegistrationForm.tsx:1258-1261` — three places to touch to add a method.

### M11 — Quick-reply chips send literal placeholders
`src/components/MessengerHub.tsx:763` → `tmpl.body.replace('[نام]', activeThread.senderName)` — only `[نام]` is substituted, and unlike the SMS path (`MessengerHub.tsx:431-435`, which blocks the send when `/\[[^\]]+\]/` remains) **the chat path has no guard**. **Impact:** the CRM can literally send *«آقای [خانوادگی]؛ با توجه به نزدیک شدن زمان آزمون…»* to a student.

### M12 — Two "send SMS" buttons behave differently
`server.ts:1789-1798`: when no `chat_id` is given and `prefer_sms !== true`, the server rewrites the request to Rubika if a Rubika conversation exists. `StudentsList.tsx:312-314` does **not** set `prefer_sms` → an SMS can silently go out over Rubika (and the success text «پیام ارسال شد.» doesn't say which channel was used). `MessengerHub.tsx:448` **does** set `prefer_sms: true` → always real SMS. The two buttons claim the same thing.

### M13 — Lead → student conversion creates no enrollment
`phase4.ts:297-311` (comment: *«enrollment is done in the registration form»*). `src/App.tsx:554` `onConverted={() => { refreshAllData(); handleActiveTabChange('students'); }}` **discards the returned `studentId`**; `StudentsList.tsx:46` declares `onActiveTabChange?: (tab, enrollmentIdOrStudentId?) => void` but `App.tsx:282-287` (`handleActiveTabChange(newTab: string)`) ignores the second argument entirely. **Impact:** after conversion the new student appears in the list with «ثبت‌نام نشده» and no course/payment, and the operator has to re-enter the registration by hand.

### M14 — Site-request → lead: double leading zero
`src/components/SiteRequestsHistory.tsx:18` `phoneKey` returns the **last 10 digits**; line 66 then does `phone_number: '0' + key`.
For an 11-digit mobile `09123456789` → key `9123456789` → `09123456789` ✅.
For a 10-digit value `9123456789` → key `9123456789` → `09123456789` ✅.
For a 10-digit value that already starts with 0 (`0912345678`) → key `0912345678` → **`00912345678`** ❌ → `phase4.ts:280` `!/^09\d{9}$/.test(b.phone_number)` → **400 «نام خانوادگی و شماره موبایل معتبر الزامی است.»**
The button is enabled in that case (`phoneKey` is non-empty), so the failure is a server error the operator cannot act on.

### M15 — The dashboard calendar can only show the current month
`src/components/SupervisorDashboard.tsx:95` `eventsOn(day)` filters `e.year === todayJalali.jy && e.month === todayJalali.jm`; the modal (`456-536`) renders only `currentMonth` with no prev/next navigation, while the card advertises «مشاهده تقویم کامل ←». The server *does* persist `year`/`month` per event (`server.ts:4382-4387`), so events for other months are stored but unreachable — and they can never be created either, since `handleAddEvent` (`153-161`) always stamps the current month.

### M16 — Unreachable gateway configuration
`server.ts:1601-1615` and `3003-3022` fully read/write `rubika_active`, `rubika_channel_id` and `sms_auto_exam`, but `src/components/Settings.tsx:120-126` never sends them and no control exists for them. `rubika_active` is additionally **never used** by the sending logic (only `rubika_bot_token` is checked, `server.ts:1679`), so it is pure write-only dead config.

---

## 4. Low findings (detail)

| ID | Detail |
|----|--------|
| **L1** | `src/components/PrintInvoiceButton.tsx` (204 lines) has **no importer** — `grep -rn "PrintInvoiceButton\|buildInvoicePdf" src/` only matches the file itself. It is dead code that also carries the missing dependency (**H8**). Delete it or wire it. |
| **L2** | `src/components/CopilotWidget.tsx:40-52` and `:73-83` declare `interface CopilotContextValue` **twice**. TypeScript merges them so it compiles, but the second declaration omits `pendingConfirmations`/`actOnPending` and the file misleads maintainers. |
| **L3** | `src/components/MessengerHub.tsx:281` `setInterval(loadRealMessages, 5000)` runs forever, even when the tab is hidden. No `visibilitychange` guard (contrast `SupervisorDashboard.tsx:169-171`, which does have one). |
| **L4** | `src/components/MessengerHub.tsx:407-425` — the SMS-template effect depends on `students/courses/enrollments/payments`, whose identity changes on every `refreshAllData()`. A background refresh can therefore **overwrite a hand-edited SMS body** with the template text. |
| **L5** | `src/utils/exportCsv.ts:10` — the formula-injection guard `/^[=+\-@\t\r]/` prepends `'`, so a negative number (`-500000`) becomes the **text** `'-500000` and stops summing/sorting as a number in Excel. Latent (no exported column is negative today) but it will corrupt a credit/refund export. |
| **L6** | `src/components/StudentsList.tsx:633-643` — the Excel export writes `course_fee / total_paid / remaining_debt` taken from `GET /api/students` (`mysql-socks.ts:407-409`), i.e. **all-time per-student aggregates**, while the table on screen is filtered by course/course-number/financial status. The exported «مانده بدهی» can therefore differ from the number displayed. |
| **L7** | `src/api/client.ts:973-977` `syncDb()` → `POST /api/db/sync` and `:979-986` `sendSms()` → `POST /api/sms/send`: **neither route exists** in `server.ts` → 404. Both are currently unused, but they are exported public helpers that will fail the moment someone wires them up. The real SMS path is `POST /api/messenger/send`. |
| **L8** | `src/App.tsx:481-484` — `new URLSearchParams(window.location.search)` is constructed **twice per render** of the root component. Trivial, but it should be a `useMemo`. |
| **L9** | The buttons read «خروجی اکسل» / «اکسل پرداخت‌ها» but `downloadCsv` writes a **`.csv`** with a UTF-8 BOM (`src/utils/exportCsv.ts:20-30`). Acceptable, but the label is inaccurate. |

---

## 5. Full tab / button / endpoint coverage matrix

### 5.1 `src/App.tsx` — navigation (12 tabs)

| Tab (id) | Roles | Component | Rendered at | Endpoint(s) | Verdict |
|---|---|---|---|---|---|
| `supervisor` | admin | `SupervisorDashboard` + `PendingRegistrationsPanel` + `CopilotBar` | `App.tsx:497-511` | `/api/dashboard-notes` (GET/PUT), `/api/course-terms`, `/api/registrations`, `/api/registrations/reviews` | ⚠️ calendar month-lock (M15), 503 on terms/activities (H7) |
| `students` | admin, cashier, instructor | `StudentList`→`StudentsList` | `512-522` | `/api/students`, `/api/enrollments`, `/api/payments`, `/api/messenger/send`, `/api/messenger/contacts*`, `/api/enrollments/:id/receipt` | ⚠️ M1, M2, M3, H2, H4 |
| `terms` | admin, cashier | `CourseTermsPanel` | `550-552` | `/api/course-terms` (GET/POST/PUT), `/api/course-terms/:id/students` | ⚠️ 503 in JSON mode (H7); admin-only writes are enforced server-side ✔ (`courseTerms.ts:116,130`) |
| `register` | admin, cashier | `StudentRegistrationForm` | `523-530` | `/api/ocr/status`, `/api/ocr`, `/api/students`, `/api/students/:id/photos`, `/api/enrollments`, `/api/payments`, `/api/registrations/:code/approve`, `/api/registrations/:code/reject`, `/api/registrations/:code/file/:kind`, `/api/enrollments/:id/receipt` | ✔ contracts match; retry-on-partial-payment logic ✔ (`StudentRegistrationForm.tsx:798-816`) |
| `accounting` | admin, cashier | `AccountingDashboard` + `DebtorsReport` | `531-540` | `/api/expenses` (GET/POST), `/api/payments`, `/api/enrollments` | ⚠️ M8, M9; expense save works, no date field |
| `copilot` | admin, cashier | `CopilotPage` | `492-496` | `POST /api/copilot/chat`, `POST /api/copilot/pending/:id/{confirm,cancel}` | ✔ OK; L2 (dup interface) |
| `messenger` | admin, cashier | `MessengerHub` | `541-549` | `/api/messenger/threads`, `/api/messenger/messages`, `/api/messenger/send`, `/api/messenger/messages/:id/{delete,edit,transcribe,media}`, `/api/messenger/threads/:chatId/{seen,attachment}`, `/api/message-templates` (GET/POST/PUT/DELETE) | ⚠️ M11, M12, L3, L4; templates CRUD contract ✔ (`server.ts:1749-1772`) |
| `leads` | admin, cashier | `LeadsPanel` | `553-555` | `/api/leads`, `/api/leads/sources`, `/api/leads/:id`, `/api/leads/:id/convert`, `/api/tasks`, `/api/activities`, `/api/messenger/contacts*` | ⚠️ 503 (H7), M5, M13 |
| `site-requests` | admin, cashier | `SiteRequestsHistory` | `556-558` | `/api/registrations`, `/api/leads`, `/api/leads/sources` | ⚠️ M14 |
| `tasks` | admin, cashier, instructor | `TasksPanel` | `559-561` | `/api/tasks`, `/api/tasks/summary`, `/api/tasks/assignees` | ⚠️ 503 (H7), M4 |
| `campaigns` | admin | `BulkMessaging` | `562-564` | `/api/campaigns/preview`, `/api/campaigns`, `/api/campaigns/:id/recipients`, `/api/campaigns/:id/cancel`, `/api/course-terms` | ⚠️ M6, M7; admin-only enforced ✔ (`server.ts:866`) |
| `settings` | admin | `Settings` + `AuditBackupPanel` | `565-570` | `/api/receipt-settings`, `/api/courses`, `/api/staff`, `/api/settings/gateways`, `/api/settings/gateways/rubika-test`, `/api/settings/rubika-account*`, `/api/health`, `/api/settings/audit-log`, `/api/settings/backups` | ⚠️ H5, H6, M10, M16 |

**Role gate cross-check (`NAV_ITEMS[].roles` vs `canAccessApi` vs route guards)** — 2 mismatches found:

1. **`/api/settings/gateways` GET is admin-only server-side** (`server.ts:857`: `path.startsWith('/settings') → false`), while `client.ts:814-830` `fetchGatewaySettings` is only called from `Settings` (admin-only tab) ✔ consistent.
2. **`GET /api/dashboard-notes`** — `server.ts:872` → non-write ⇒ `role === 'cashier'`. The Supervisor dashboard is admin-only, so ✔; but a cashier receives 403 for a read that the client treats as optional (`SupervisorDashboard.tsx:122` catches silently).

### 5.2 `StudentsList.tsx` — every action button

| Control | Line | Handler | Endpoint | Verdict |
|---|---|---|---|---|
| Row click (select student) | `684` | `selectStudent` | — | ✔ |
| Search box | `570-576` | debounced `matchesStudentSearch` | — | ✔ |
| Filter: course / course-number / financial | `584-621` | local | — | ⚠️ M3 (instructor) |
| «پاک‌سازی» clear filters | `627` | local | — | ✔ |
| «خروجی اکسل» | `633` | `downloadCsv` | — | ⚠️ L6, L9 |
| «افزودن همه به مخاطبین روبیکا» | `632` | `RubikaBulkContactsButton` | `/api/messenger/contacts/bulk/*` | ✔ contract matches (`client.ts:1067-1075` ↔ `server.ts:1421-1462`) |
| Photo zoom (personal / national card) | `364, 394` | local | — | ✔ |
| **«ویرایش پرونده»** → «ذخیره تغییرات» | `498-501`, `869` | `handleSaveStudentEdit` | `PUT /api/students/:id` | ⚠️ **H2** (no status field), **M2** (phone validation) |
| «افزودن به مخاطبین روبیکا» / «حذف مخاطب» | `502` | `RubikaContactButton` | `/api/messenger/contacts/:kind/:id/{add,delete}` | ✔ |
| **«ارسال پیام (روبیکا/پیامک)»** → «ارسال فوری» | `503-506`, `898` | `handleSendMessage` | `POST /api/messenger/send` | ⚠️ **M1**, **M12** |
| **«حذف پرونده»** → «حذف قطعی» | `508-511`, `985` | `handleDeleteStudent` | `DELETE /api/students/:id` | ✔ admin-only in UI *and* server (`server.ts:847`: `if (method==='DELETE') return false` for non-admins) |
| **«ثبت پرداختی»** → «ثبت قطعی» | `461-469`, `960` | `handleSavePayment` | `POST /api/payments` | ✔ overpay guard server-side (`server.ts:2344`); enrollment is mandatory ✔ |
| «مدارک ثبت‌نام» panel (print/download/preview/rebuild) | `477-484` | `StudentDocsSection` → `RegistrationDocsPanel` | `POST /api/enrollments/:id/receipt` | ⚠️ **H4** (0-price tuition) |
| Activity timeline (add call/note) | `492` | `ActivityTimeline` | `GET/POST /api/activities` | ⚠️ 503 (H7) |
| Pagination «قبلی / بعدی» | `779-789` | local | — | ✔ |
| **«چاپ کارت» / status change** | — | **NOT PRESENT** | — | ❌ **H2** — no print-card button and **no status control** exist in this component |

### 5.3 `StudentRegistrationForm.tsx` / `PendingRegistrationsPanel.tsx` / `SiteRequestsHistory.tsx`

| Control | Line | Endpoint | Verdict |
|---|---|---|---|
| «اسکن با اسکنر» | `1047` | local bridge `127.0.0.1:8765` (`api/scanner.ts`) | ✔ graceful `offline` state (`StudentRegistrationForm.tsx:379-383`) |
| «انتخاب فایل اسکن‌شده» / «گالری» | `1041,1060,1153,1159` | — | ✔ |
| «دوربین گوشی» / «عکس‌برداری با وب‌کم» | `1036,1148,1162` | `getUserMedia` | ✔ error surfaced (`482-487`) |
| «برش و چرخش دستی» / crop modal | `1027,1130` | — | ✔ |
| «استخراج اطلاعات از کارت» (OCR) | `1066` | `POST /api/ocr` | ✔ (`server.ts:2559`, accepts `card` **and** `nationalCard`; client sends both) |
| «چرخاندن ۹۰ درجه» / «ادامه با همین عکس» | `1082,1087` | — | ✔ |
| «اطلاعات را با کارت تطبیق دادم» | `1103` | — | ✔ blocks submit (`678-680`) |
| Pending-registrations chip → preselect | `988` | `/api/registrations` | ✔ via `sessionStorage` key `crm_open_registration_id` (`PendingRegistrationsPanel.tsx:10,68` ↔ `StudentRegistrationForm.tsx:411`) |
| «رد ثبت‌نام انتخاب‌شده» | `962` | `POST /api/registrations/:code/reject` | ✔ |
| **«ثبت و چاپ رسید»** | `1279` | approve → `RegistrationDocsPanel autoRun autoPrint` | ✔ (3 print dialogs in sequence, `docService.ts:181-200`) |
| **«ثبت و جدید»** | `1284` | create student/enroll/payment → `uploadAllDocs` | ✔ (`docService.ts:203-213` never throws) |
| «شروع دوره جدید؟» confirm | `1306-1319` | — | ✔ |
| Pending panel: «بررسی شد» / «لغو بررسی» | `141` | `POST /api/registrations/:code/review` | ✔ (`server.ts:2878`) |
| Pending panel: «تأیید» / «باز کردن» | `142,144` | → register tab | ✔ |
| Pending panel: «رد» | `143` | `POST /api/registrations/:code/reject` | ✔ |
| Doc thumbnail click | `31` | `GET /api/registrations/:code/file/:kind` | ✔ blob URL |
| Site-requests: «افزودن به سرنخ‌ها» | `132` | `POST /api/leads` | ⚠️ **M14** |
| Site-requests: search / status filter / refresh | `90,92,98` | — | ✔ |

### 5.4 `AccountingDashboard.tsx` + `DebtorsReport.tsx`

| Control | Line | Endpoint | Verdict |
|---|---|---|---|
| «اکسل پرداخت‌ها» | `238` | — | ✔ |
| «اکسل هزینه‌ها» | `251` | — | ✔ |
| Filter: course / course-number / all / this month / custom | `260-292` | — | ⚠️ M8 (expenses always today) |
| **«ثبت هزینه جدید»** → «ثبت قطعی هزینه» | `295`, `545` | `POST /api/expenses` | ✔ server contract ok; ⚠️ **M8** (no date), **M9** (category not stored) |
| Term-summary row click → sets filters | `493` | — | ✔ |
| Debtors: search / course filter / sort | `268-310` | — | ✔ |
| Debtors: «خروجی اکسل» | `316` | — | ✔ (⚠️ L5/L9) |

### 5.5 `BulkMessaging.tsx` (campaigns)

| Control | Line | Endpoint | Verdict |
|---|---|---|---|
| Group / channel / course / course-number / term / lead-status / debtors filters | `82-118` | `POST /api/campaigns/preview` | ⚠️ **M6** |
| Template variables chips | `127` | — | ✔ (`TEMPLATE_VARS` = name/first_name/last_name/course/debt — matches `phase4.ts:renderTemplate`) |
| Throttle (1-60 s) | `130` | — | ✔ server clamps to 1000-60000 ms (`phase4.ts:439`) |
| «پیش‌مایش» | `131` | `POST /api/campaigns/preview` | ✔ (`send_enabled`/`sms_configured` surfaced) |
| Per-recipient remove / restore | `158` | — | ✔ |
| **«اجرای آزمایشی»** | `166` | `POST /api/campaigns` `dry_run:true` | ✔ |
| **«ارسال واقعی...» → type «ارسال» → «ارسال»** | `167,211` | `POST /api/campaigns` `dry_run:false` + `confirm:'ارسال'` | ✔ matches `phase4.ts:427-433`; ⚠️ **M7** (preview not cleared) |
| «گزارش» (recipients) | `193` | `GET /api/campaigns/:id/recipients` | ✔ |
| «توقف» (cancel) | `194` | `POST /api/campaigns/:id/cancel` | ✔ |
| Refresh campaigns | `180` | `GET /api/campaigns` | ✔ (3 s polling while active, `47-50`) |

### 5.6 `Settings.tsx` + `AuditBackupPanel.tsx`

| Control | Line | Endpoint | Verdict |
|---|---|---|---|
| Sub-tab pills (6) | `384-408` | — | ✔ |
| Academy form → «ذخیره تغییرات هدر» | `484` | `POST /api/receipt-settings` | ✔ contract ok; empty `contract_text` falls back to the default (`printDocs.ts:92`) |
| «بازگردانی متن پیش‌فرض» | `465` | — | ✔ |
| Courses: «افزودن دوره جدید» / «ثبت» / «ویرایش» | `504,519,560` | `POST /api/courses`, `PUT /api/courses/:id` | ✔ (`parseCourseInput` ↔ `client.ts:196-227`) |
| Gateways: rubika token, webhook copy, «تست اتصال ربات» | `606,610` | `POST /api/settings/gateways/rubika-test` | ✔ |
| Gateways: rubika account send-code / sign-in / logout / active | `652,666,644` | `/api/settings/rubika-account*` | ✔ all `requireAdmin` ✔ |
| Gateways: SMS provider / key / sender line / auto-register | `688-703` | `POST /api/settings/gateways` | ⚠️ **M16** (`rubika_active`, `rubika_channel_id`, `sms_auto_exam` unreachable) |
| «ذخیره درگاه‌ها» | `715` | `POST /api/settings/gateways` | ✔ blank key = keep (server `3013,3020`) |
| Database: «بررسی دوباره اتصال» | `755` | `GET /api/health` | ✔ |
| **Backup list** | `45-57` | `GET /api/settings/backups` | ⚠️ **H5** (no download/restore), **H6** (`dir_configured` ignored) |
| Audit log: entity filter / pagination / «اکسل» / refresh | `65-75,105-106` | `GET /api/settings/audit-log` | ✔ |
| «روش‌های پرداخت» tab | `766-783` | — | ⚠️ **M10** (static) |
| Users: create / toggle / role / password | `816,857,846,865` | `POST /api/staff`, `PUT /api/staff/:id` | ✔ (`client.ts:929-958` ↔ `server.ts:949-1024`); env admin is `locked` ✔ |

### 5.7 Other tabs

| Component | Key controls | Endpoints | Verdict |
|---|---|---|---|
| `SupervisorDashboard.tsx` | «ثبت‌نام جدید», «لیست کل پرونده‌ها», task add/toggle/delete, calendar add | `/api/dashboard-notes`, `/api/course-terms` | ⚠️ M15, H7. `saveDashboardNotes` 409-guard handled (`client.ts:889-896` ↔ `server.ts:4388`) ✔ |
| `LeadsPanel.tsx` | «سرنخ جدید», edit, convert, add task, Rubika contact | `/api/leads*`, `/api/tasks`, `/api/activities` | ⚠️ M5, M13, H7 |
| `TasksPanel.tsx` | «کار جدید», save, quick status, «انجام شد», filter | `/api/tasks*` | ⚠️ M4, H7 |
| `CourseTermsPanel.tsx` | «دوره جدید», edit, students modal, filters | `/api/course-terms*` | ⚠️ H7; jalali validation matches (`courseTerms.ts:14-17,108`) ✔ |
| `CopilotWidget.tsx` | send, retry, quick prompts, pending confirm/cancel | `POST /api/copilot/chat`, `/api/copilot/pending/:id/*` | ✔ (L2) |
| `MessengerHub.tsx` | chat reply, edit/delete message, transcribe, attach, seen, SMS tab, templates CRUD | `/api/messenger/*`, `/api/message-templates` | ⚠️ M11, M12, L3, L4 |
| `Leads`/`Students` Rubika contact buttons | add/delete/bulk | `/api/messenger/contacts*` | ✔ |
| `PrintPreview.tsx` | `?print=all` (+`&enrollment=`) | `GET /api/enrollments/:id/report-context` | ⚠️ H4 |
| `ContractPrintForm.tsx` | `?print=contract` | — | ❌ **H3** |
| `PrintInvoiceButton.tsx` | print/download invoice | — | ❌ **H8**, **L1** (no importer) |

---

## 6. Endpoint contract matrix (frontend → backend)

| Frontend call | File:Line | HTTP | Server route | Verdict |
|---|---|---|---|---|
| `fetchStudents` | `client.ts:234` | GET `/api/students` | `server.ts:2042` | ✔ |
| `createStudent` | `client.ts:266` | POST `/api/students` | `server.ts:2051` | ✔ (`{status, student, already_exists}` ✔) |
| `updateStudent` | `client.ts:294` | PUT `/api/students/:id` | `server.ts:2082` | ⚠️ H2, M2 |
| `deleteStudentCascade` | `client.ts:305` | DELETE `/api/students/:id` | `server.ts:2132` | ✔ |
| `uploadStudentPhotos` | `client.ts:318` | POST `/api/students/:id/photos` | `server.ts:2179` | ✔ |
| `fetchCourses` / `saveCourse` / `addCourse` | `client.ts:178/196/212` | GET/POST/PUT `/api/courses` | `server.ts:1938/1982/2002` | ✔ |
| `fetchEnrollments` / `createEnrollment` | `client.ts:466/484` | GET/POST `/api/enrollments` | `server.ts:2286/2229` | ✔ |
| `fetchPayments` / `createPayment` | `client.ts:516/533` | GET/POST `/api/payments` | `server.ts:2351/2294` | ✔ |
| `fetchExpenses` / `createExpense` | `client.ts:576/593` | GET/POST `/api/expenses` | `server.ts:2757/2764` | ⚠️ M9 |
| `fetchRegistrations` | `client.ts:344` | GET `/api/registrations` | `server.ts:2797` | ⚠️ H7 (empty in JSON mode) |
| `approveRegistration` | `client.ts:392` | POST `/api/registrations/:code/approve` | `server.ts:2907` | ✔ (shape verified in `mysql-socks.ts:1027-1033`) |
| `rejectRegistration` | `client.ts:427` | POST `/api/registrations/:code/reject` | `server.ts:2953` | ✔ |
| `fetchRegistrationReviews` / `setRegistrationReviewed` | `client.ts:438/443` | GET/POST `/api/registrations/reviews`, `/:code/review` | `server.ts:2875/2878` | ✔ |
| `fetchRegistrationFileUrl` | `client.ts:451` | GET `/api/registrations/:code/file/:kind` | `server.ts:2891` | ✔ |
| `ocrNationalCard` | `client.ts:639` | POST `/api/ocr` | `server.ts:2559` | ✔ |
| `fetchOcrStatus` | `client.ts:632` | GET `/api/ocr/status` | `server.ts:2553` | ✔ |
| `fetchReceiptSettings` / `saveReceiptSettings` | `client.ts:682/688` | GET/POST `/api/receipt-settings` | `server.ts:2610/2614` | ✔ |
| `uploadEnrollmentReceipt` | `client.ts:766` | POST `/api/enrollments/:id/receipt` | `server.ts:2688` | ✔ (`kind` ↔ `parseDocKind` ✔) |
| `fetchEnrollmentDocContext` | `client.ts:739` | GET `/api/enrollments/:id/report-context` | `server.ts:2640` | ✔ |
| `sendMessengerMessage` | `client.ts:851` | POST `/api/messenger/send` | `server.ts:1774` | ⚠️ M1, M12 |
| `fetchMessengerThreads` / `fetchMessengerMessages` | `client.ts:904/911` | GET `/api/messenger/{threads,messages}` | `server.ts:2968/1293` | ✔ |
| `deleteMessengerMessage` / `editMessengerMessage` / `transcribeMessengerMessage` | `client.ts:1032-1037` | POST `/api/messenger/messages/:id/*` | `server.ts:1491/1515/1588` | ✔ |
| `markMessengerThreadSeen` / `sendMessengerAttachment` / `fetchMessengerMedia` | `client.ts:1038-1051` | POST/GET `/api/messenger/threads/:chatId/*`, `/messages/:id/media` | `server.ts:1550/1528/1566` | ✔ |
| `fetchRubikaContacts` / `addRubikaContact` / `deleteRubikaContact` / bulk | `client.ts:1058-1075` | `/api/messenger/contacts*` | `server.ts:1372-1462` | ✔ |
| `fetchMessageTemplates` / `saveMessageTemplate` / `deleteMessageTemplate` | `client.ts:1009-1024` | `/api/message-templates` | `server.ts:1749-1772` | ✔ (array shape ✔) |
| `fetchGatewaySettings` / `saveGatewaySettings` / `testRubikaBot` | `client.ts:795-849` | `/api/settings/gateways*` | `server.ts:2995/3010/4250` | ⚠️ M16 |
| `fetchRubikaAccount` / `rubikaAccountSendCode` / `SignIn` / `Logout` / `SetActive` | `client.ts:808-812` | `/api/settings/rubika-account*` | `server.ts:4287-4310` | ✔ |
| `fetchStaffUsers` / `createStaffUser` / `updateStaffUser` | `client.ts:922-958` | `/api/staff` | `server.ts:944/949/986` | ✔ |
| `getAuditLog` | `client.ts:993` | GET `/api/settings/audit-log` | `server.ts:4348` | ✔ |
| `getBackups` | `client.ts:1001` | GET `/api/settings/backups` | `server.ts:4358` | ⚠️ H5, H6 |
| `fetchDashboardNotes` / `saveDashboardNotes` | `client.ts:882/889` | GET/PUT `/api/dashboard-notes` | `server.ts:4371/4375` | ✔ |
| `fetchHealth` | `client.ts:898` | GET `/api/health` | `server.ts:825` | ✔ |
| `listLeads` / `listLeadSources` / `createLead` / `updateLead` / `convertLead` | `api/phase4.ts:28-33` | `/api/leads*` | `phase4.ts:248-311` | ⚠️ M5, M13, H7 |
| `listActivities` / `addActivity` | `api/phase4.ts:39/41` | `/api/activities` | `phase4.ts:313/330` | ⚠️ H7 |
| `listTasks` / `taskSummary` / `listAssignees` / `createTask` / `updateTask` | `api/phase4.ts:54-63` | `/api/tasks*` | `phase4.ts:243,343,361,375,384` | ⚠️ M4, H7 |
| `previewCampaign` / `listCampaigns` / `campaignRecipients` / `createCampaign` / `cancelCampaign` | `api/phase4.ts:80-85` | `/api/campaigns*` | `phase4.ts:399-452` | ⚠️ M6, M7, H7 |
| `listTerms` / `termStudents` / `createTerm` / `updateTerm` | `api/courseTerms.ts:24-35` | `/api/course-terms*` | `courseTerms.ts:82-137` | ⚠️ H7 |
| **`syncDb`** | `client.ts:973` | POST `/api/db/sync` | **none** | ❌ 404 (L7) |
| **`sendSms`** | `client.ts:979` | POST `/api/sms/send` | **none** | ❌ 404 (L7) |

---

## 7. Prioritised remediation plan

**P0 — do now (≈1 day)**
1. **H1** — add `"include": ["src"]` + `"exclude": ["reports", "dist"]` to `tsconfig.json`; delete `reports/debug-2026-10-22-freemodel/server-slices.ts`; fix the 2 now-visible `src` type errors. Re-enables the static gate.
2. **H8/L1** — delete `PrintInvoiceButton.tsx` (dead) *or* install `jspdf-autotable` and adapt to its v5 API.
3. **H4** — `printDocs.ts:151` `||` → `??` / explicit null check. One-line fix that stops printing the wrong tuition on discounted students.
4. **M6/M7** — `BulkMessaging.tsx:93` (clear the sibling term key) and `:57-64` (reset the preview after a send).
5. **M14** — `SiteRequestsHistory.tsx` — normalize to `0` + last 9 digits instead of `'0' + last10`.

**P1 — this week (≈2-3 days)**
6. **H2** — add the `students.status` column (additive), thread it through `listStudents`/`updateStudent`/`parseStudentInput`, and add a status `<select>` to the edit modal. Then the «وضعیت» column and «تعلیق/فارغ‌التحصیل» finally work.
7. **H5/H6** — add `GET /api/settings/backups/:name/download` + `POST /api/settings/backups/:name/restore` (env-gated + typed confirmation + audited); consume `dir_configured` in `AuditBackupPanel`.
8. **M10/M16** — make «روش‌های پرداخت» real (CRUD + endpoint) and either wire or delete `rubika_active` / `rubika_channel_id` / `sms_auto_exam`.
9. **H3** — delete the `?print=contract` branch, or wire `ContractPrintForm` to `fetchEnrollmentDocContext` (and to `settings.contract_text`).

**P2 — next sprint**
10. **H7** — add an explicit "MySQL unavailable" banner (from `GET /api/health`) and make the Leads/Tasks/Campaigns/Terms panels render a clear error state instead of an empty table.
11. **M1/M2/M3** — client-side validation for phone + sender, hide the financial column/filters for instructors.
12. **M11/M12** — block chat sends with unresolved `[...]` placeholders; make both SMS entry points use the same `prefer_sms` semantics.
13. **M4/M5** — make `GET /api/tasks/summary` match the admin's "all tasks" view; add pagination to `/api/leads`.
14. **M8/M9** — add a date field to the expense modal; persist `category` in MySQL.
15. **M13/M15** — select the converted student in the students list; add month navigation to the supervisor calendar.
16. **L1-L9** — housekeeping (duplicate interface, polling guard, SMS body overwrite, CSV negative numbers, export parity, dead `sendSms`/`syncDb`, `URLSearchParams` memo, CSV label).

---

## 8. What is **not** broken (verified)

* Role gating between `NAV_ITEMS`, `canAccessApi()` and the route guards is consistent for all 12 tabs; every destructive action (`DELETE /api/students/:id`, campaigns, staff, settings, course terms writes) is admin-only on **both** sides.
* `canAccessApi` correctly blocks `DELETE` for non-admins (`server.ts:847`) and correctly restricts `/campaigns` (`866`), `/settings` (`857`), `/staff` (`856`).
* The registration flow (create student → upload photos → create enrollment → payment → three PDFs) has correct partial-failure handling: a failed payment keeps the student/enrollment and offers a payment-only retry (`StudentRegistrationForm.tsx:798-816`), and a failed photo upload does not roll back the registration (`:737-740`, `:785-788`).
* `uploadAllDocs` never throws and reports per-document failures (`docService.ts:203-213`); `RegistrationDocsPanel` surfaces per-document status + retry (`RegistrationDocsPanel.tsx:172-231`).
* The receipt upload endpoint correctly replaces only the enrollment's own previous file of the same kind and never overwrites another enrollment's file (`server.ts:2710-2720`).
* The payment overpay guard, the "enrollment is mandatory" guard and the duplicate-enrollment guard are all enforced server-side (`server.ts:2299-2344`).
* The national-code race is handled with `GET_LOCK` inside a transaction (`mysql-socks.ts:451-453`, used by insert/update/approve).
* `DELETE /api/students/:id` cascades to enrollments, payments, chat history and outbox, and removes the student's files (`server.ts:2132-2176`).
* `vite build` passes (2 843 modules, 11.44 s); the Vazirmatn woff2 assets are emitted correctly.
* `src/utils/finance.ts` (shared with the server) clamps every enrollment balance at 0 before summing, so an overpaid/settled enrollment cannot mask another course's debt — and it is unit-tested by `scripts/test-crm-logic.mjs`.

---

*End of report.*
