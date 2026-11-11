You are a read-only debugger. Complete the existing production debug dossier. Do not deploy. Do not call SSH. Do not print secrets.

Working directory: /tmp/kermanshah-debug-freemodel
Write the completed report to: /tmp/kermanshah-debug-freemodel/dossier-complete.md

Inputs (already on disk):
- dossier.md = current health-sweep report (homepage is UP)
- origin.md = pm2/nginx/disk/error-log evidence
- chrome-audit.json = CDP network/console
- server-slices.ts = live origin excerpts from /project/kermanshahcart/site/app/server.ts

Known facts (do not re-litigate):
- Public site https://kermanshahcart.ir HTTP 200, Arvan x-cache BYPASS, catalog 6 courses source=crm
- Chrome: 0 exceptions, 0 4xx/5xx, hydration OK
- Origin kermanshah-site online, git 3857afd clean, disk 96% (1.4G), quizbot stopped
- Logs: SMS.ir no credit; [login-national] Unknown column 'full_name'; [course-pay] Zarinpal code -14 callback domain mismatch

Code already in server-slices.ts:
login-national queries:
1) SELECT TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) AS full_name FROM students WHERE national_code=? AND phone_number=?
2) SELECT full_name FROM registrations WHERE national_code=? AND phone_number=?
A thrown query aborts the whole handler with 503.

publicBase(req):
- if PUBLIC_BASE_URL env set, use that
- else origin if origin.host===host
- else x-forwarded-proto + host
course-pay request callback_url = `${publicBase(req)}/api/course-payment/callback`

Task: write dossier-complete.md as a Front-end diagnostic report that ADDS:
1. Precise root cause for Unknown column full_name (which query, why first query can still throw, why catch hides which SQL failed). Propose the minimal code fix (do not apply).
2. Precise root cause for Zarinpal -14 (how publicBase can send a domain the terminal does not own: www vs apex, http vs https, PUBLIC_BASE_URL, Arvan Host). Propose the check the operator must do (registered terminal domain vs actual callback). Do not invent the registered domain.
3. Rank remaining items: SMS credit, disk 96%, quizbot stopped, 13 pm2 restarts — ops vs code.
4. Keep original evidence. Mark anything not verified in Chrome (OTP click, pay click).
5. Persian is OK for user-facing next steps; technical IDs stay English.

Output only the markdown file. No git. No live changes.
