# DEPLOY.md — استقرار ویژگی‌های ادغام‌شده / Deploying the merged features

> **فقط چک‌لیست است؛ این شاخه هیچ چیزی را روی سرور اجرا نمی‌کند.** هر مرحله را خودِ مدیر سرور، دستی و به ترتیب اجرا کند.
> *Checklist only — nothing in this branch touches the server.* Run every step by hand, in order.

Features covered: **theme settings (پوسته)**, **instructor pay (حق‌التدریس)**, **Zarinpal online payments + trainee portal**,
**installments / full-balance payment links `/p/<code>` + remaining-debt SMS**, **AI smart-crop of ID / 3x4 photos**.

Server layout (read-only inspection, 2026-10-28): app in `/project/kermanshahcart/crm`, pm2 process `carla-crm`
(`PORT=3001`), MySQL in the `mysql-local` docker container (DB `nodejs430_carla`), Node from
`/root/.nvm/versions/node/v20.20.2`, deploy helper `/root/deploy-crm.sh`, shared SMS helper
`/project/kermanshahcart/shared/sms.ts`.

---

## 0. وضعیت فعلی (observed, read-only)
- The live checkout is already at `de61230` and the server auto-created the feature tables at boot
  (`ensure*Schema()`): `crm_instructor*`, `crm_online_payments` (+ `installment_id`), `crm_installments`,
  `crm_installment_links`, `crm_debt_links`, `crm_debt_sms_log`, `app_settings.theme.config`,
  `sms_templates.debt_balance → 472328` all exist.
- **Not present:** `crm_installment_reminders` (only the migration creates it; harmless/unused) and the env vars
  `ZARINPAL_*`, `PUBLIC_BASE_URL`, `CRM_DEBT_SMS_*`, `CRM_PAYMENT_LINK_BASE` in the live `.env`.
  → In practice the remaining work is **§3 env + §2 migrations (idempotent re-run) + restart + smoke tests**.

## 1. پشتیبان‌گیری / Backups (always first)
```bash
# DB dump (credentials stay inside the container; nothing is printed)
bash /project/kermanshahcart/crm/scripts/backup-db.sh && tail -1 /project/_archive/db-backups/backup.log
#   equivalent one-off:
# docker exec mysql-local sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces nodejs430_carla' | gzip -9 > /project/_archive/db-backups/ham-taraz-predeploy-$(date +%Y%m%d-%H%M).sql.gz

# App copy (code + .env + uploads); /root/deploy-crm.sh also archives the old dir automatically
TS=$(date +%Y%m%d-%H%M); cp -a /project/kermanshahcart/crm/.env /project/_archive/crm-env-$TS.bak; chmod 600 /project/_archive/crm-env-$TS.bak
cp -a /project/kermanshahcart/shared/sms.ts /project/_archive/shared-sms-$TS.ts
```
- [ ] dump ends with `Dump completed` (backup-db.sh checks this) and is > 0 bytes
- [ ] `.env` and `shared/sms.ts` copies saved

## 2. مایگریشن‌ها به ترتیب / Migrations (in this order)
All five files are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `ALTER`, `ON DUPLICATE KEY UPDATE`).
The server creates most of them at boot too, so re-running is safe. Verify first:
```bash
cd /project/kermanshahcart/crm && node scripts/preflight-check.mjs      # static checks, no DB
node scripts/preflight-check.mjs --db                                   # + read-only schema check
```
Apply (each line is safe to repeat):
```bash
cd /project/kermanshahcart/crm
for f in 20261017_theme_settings 20261017_instructor_pay 20261017_crm_online_payments 20261018_crm_installments 20261019_crm_debt_sms; do
  echo "== $f"; docker exec -i mysql-local sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" nodejs430_carla' < database/migrations/$f.sql || break
done
```
Order matters: `instructor_pay` references `crm_course_terms`; `crm_installments` alters `crm_online_payments`.
- [ ] 20261017_theme_settings  (`app_settings` + `theme.config` row)
- [ ] 20261017_instructor_pay  (`crm_instructors`, `_rates`, `_sessions`, `_settlements`)
- [ ] 20261017_crm_online_payments (`crm_online_payments`)
- [ ] 20261018_crm_installments (`crm_installments`, `crm_installment_links`, `crm_installment_reminders`, `crm_online_payments.installment_id`)
- [ ] 20261019_crm_debt_sms (`crm_debt_links`, `crm_debt_sms_log`)
- [ ] `sms_templates` has the `debt_balance` row → sms.ir verify template **472328**, params `NAME,AMOUNT,CODE`, enabled.
  Check: `SELECT provider_template_id, enabled, param_names FROM sms_templates WHERE \`key\`='debt_balance';`
  If missing, add it from **CRM → تنظیمات → قالب‌های پیامک** (or the SMS-templates admin of the site) rather than by hand-written SQL.

## 3. متغیرهای محیطی / Environment (`/project/kermanshahcart/crm/.env`, mode 600)
Names only — see `.env.example`. Never paste values into chat, tickets or git.

| Name | Purpose | Safe first value |
|---|---|---|
| `ZARINPAL_MERCHANT_ID` | Zarinpal merchant UUID (can also be set in Settings → gateways) | real merchant id |
| `ZARINPAL_SANDBOX` | `1` sandbox, `0` real money | **`1` first**, `0` after a sandbox round-trip |
| `ZARINPAL_CURRENCY` | `IRR` (Toman×10, default) or `IRT` | `IRR` |
| `PUBLIC_BASE_URL` | origin used in gateway callback + trainee links | `https://<crm public host>` |
| `CRM_DEBT_SMS_ENABLED` | hard gate for debt SMS (`1` = on) | **empty/0** until tested |
| `CRM_DEBT_SMS_TEST_MOBILE` | when set, the ONLY number that can receive debt SMS | the admin's own mobile |
| `CRM_PAYMENT_LINK_BASE` | base of the SMS payment link (code appended) | `https://kermanshahcart.ir/p/` |
| `SMS_API_KEY`, `SMS_SENDER_LINE` | sms.ir (already present) | — |

- [ ] `PUBLIC_BASE_URL` callback host is reachable from Zarinpal (`<base>/api/trainee-payments/zarinpal/callback`)
- [ ] `CRM_PAYMENT_LINK_BASE` host actually serves `/p/<code>` (the site must proxy `/p/` to the CRM, or point it at the CRM host)
- [ ] `node scripts/preflight-check.mjs --db` → `0 failed`

## 4. کد و ساخت / Code + build
`shared/sms.ts`: the CRM imports `./shared/sms` (bundled into `dist/server.cjs` by esbuild), and the site uses
`/project/kermanshahcart/shared/sms.ts`. **Keep both copies identical** (preflight warns when the hashes differ);
change the template logic in one place and copy it to the other in the same deploy.

Preferred (already archives the old dir and auto-rolls-back on a failed health check):
```bash
bash /root/deploy-crm.sh main         # clone → npm install → npm run build → pm2 restart carla-crm → health check
```
Manual equivalent:
```bash
cd /project/kermanshahcart/crm && git fetch && git checkout <commit>
export PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH
npm install --no-audit --no-fund
npm run build                          # vite build + esbuild → dist/server.cjs
PORT=3001 NODE_ENV=production pm2 restart carla-crm --update-env && pm2 save
```
- [ ] smart-crop: `python3 -c "import PIL"` works on the server (Pillow; 12.3.0 observed)
- [ ] `pm2 logs carla-crm --lines 50` shows `Server started` and no schema errors

## 5. تست دود / Smoke tests
1. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/ocr/status` → `401` (deploy script's health probe); `/api/health` → `{"ok":true,"db":"chabokan-mysql"}`.
2. Login page shows the logo; **تنظیمات → تم و ظاهر**: switch light/dark/system, colour, font → persists after reload.
3. **حق‌التدریس** (admin): add an instructor, a rate, a session → monthly report shows the amount; cashier gets 403.
4. **Trainee portal** `/?trainee=1`: OTP login (test student) → payment list; Zarinpal **sandbox** payment → callback → row in **پرداخت‌های آنلاین**, cashier approve → payment appears in the ledger once (no double credit on refresh).
5. Receipt upload from the trainee panel → cashier approve/reject.
6. **پیامک بدهی** with `CRM_DEBT_SMS_TEST_MOBILE` set: preview → send to one student → only the test mobile receives template 472328 with name/amount/code; second send same day is blocked; log shows masked phone.
7. Open the received `/p/<code>` → trainee panel with the amount preset; legacy installment links still resolve.
8. Student edit modal → upload ID/3x4 photo → **برش هوشمند** returns a crop.
9. Copilot, registrations approve/reject, SMS inbox still work (regression).
10. Only after 4 + 6 pass: set `ZARINPAL_SANDBOX=0`, then `CRM_DEBT_SMS_ENABLED=1` and clear `CRM_DEBT_SMS_TEST_MOBILE` → `pm2 restart carla-crm --update-env`.

## 6. بازگشت / Rollback
- **Feature kill-switches (no redeploy):** `CRM_DEBT_SMS_ENABLED=` (empty) stops all debt SMS; `ZARINPAL_SANDBOX=1` or removing
  `ZARINPAL_MERCHANT_ID` stops real gateway payments → `pm2 restart carla-crm --update-env`.
- **Code:** `/root/deploy-crm.sh` appends the exact rollback line to `/project/_archive/README.txt`:
  `pm2 stop carla-crm; mv /project/kermanshahcart/crm /project/_archive/crm-failed; mv /project/_archive/crm-before-keys-<TS> /project/kermanshahcart/crm; pm2 restart carla-crm`
- **Env:** restore `/project/_archive/crm-env-<TS>.bak` → `.env`, restart with `--update-env`.
- **DB:** the migrations only add tables/columns, so the old code ignores them — normally **no DB rollback is needed**.
  Restore the dump only for data corruption (stops the app first):
  `pm2 stop carla-crm && zcat /project/_archive/db-backups/ham-taraz-<TS>.sql.gz | docker exec -i mysql-local sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" nodejs430_carla' && pm2 start carla-crm` (backups made before the rename are named `carla-<TS>.sql.gz`)
  (this discards every write since the dump — online payments taken after it must be re-entered from the Zarinpal panel).
- **shared/sms.ts:** restore `/project/_archive/shared-sms-<TS>.ts` and restart the site process too (`kermanshah-site`).
