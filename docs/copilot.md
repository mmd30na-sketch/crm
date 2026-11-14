# CRM Copilot

دستیار چت داخل CRM. روی سرور ایران اجرا می‌شود و مدل را از OmniRoute روی hydra-gcp می‌گیرد.

## چه چیزی بالا است

- ویجت: `src/components/CopilotWidget.tsx`، داخل `src/App.tsx`.
- API: `POST /api/copilot/chat` در `server.ts`. احراز هویت همان نشست CRM است (`Authorization: Bearer <token>`).
- حلقه ابزار حداکثر ۴ بار صدا می‌زند، بعد جواب فارسی برمی‌گردد.
- ابزارهای فقط‌خواندنی مالی/CRM. `send_notification` در کد غیرفعال است.
- پیامک: `sms_send` فقط پیش‌نویس می‌سازد. `sms_send_direct` همان لحظه می‌فرستد و مخصوص ادمین است. تلگرام و روبیکا هنوز پیش‌نویس‌اند و تأیید ویجت می‌خواهند. الگوی OTP از هر دو مسیر پیامک بسته است.

## مدل

| متغیر | مقدار عملی |
|---|---|
| `COPILOT_API_URL` | `http://127.0.0.1:20130/v1` روی سرور ایران |
| `COPILOT_API_KEY` | کلید OmniRoute (همان کلید `openclaw` در sqlite گیت‌وی). در ریپو نیست. |
| `COPILOT_MODEL` | `cline/poolside/laguna-s-2.1:free` |

اندپوینت OpenAI-compatible است: `POST /v1/chat/completions`. مدل باید `tool_calls` برگرداند. سه مدل رایگان که این را پاس کردند: `cline/poolside/laguna-s-2.1:free`، `cline/nvidia/nemotron-3.5-lightning:free`، `cline/xiaomi/mimo-v2.6-flash`.

## تونل OmniRoute

سرور ایران مستقیم به `127.0.0.1:20130` گیت‌وی دسترسی ندارد. روی hydra-gcp سرویس `omniroute-iran-tunnel.service` یک reverse SSH می‌زند:

`ssh -N -R 127.0.0.1:20130:127.0.0.1:20130 ssh-iran`

یونیت: `/etc/systemd/system/omniroute-iran-tunnel.service`، کاربر `mmd30na`، `Restart=always`. سلامت از ایران: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20130/api/health` باید `200` باشد.

## ابزارها

مالی (read-only، روی داده CRM): جستجوی کارآموز، بدهکاران، پرداخت‌ها، آمار دوره، و خلاصه مالی. خروجی مبلغ به تومان است.

`send_notification`:

| channel | گیرنده | مسیر واقعی |
|---|---|---|
| `rubika` | guid گفتگوی اکانت اصلی | `sendRubikaMessage` (Bot API) فقط وقتی guid بات باشد. برای گفتگوی یک‌به‌یک موجود، مسیر پایدار `/api/messenger/send` با `source=account` است. |
| `telegram` | chat_id عددی | `https://api.telegram.org/bot…/sendMessage` با `TELEGRAM_BOT_TOKEN` داخل env فرآیند CRM |

شماره موبایل به‌تنهایی برای بات کافی نیست. بات فقط به chat_idای پیام می‌فرستد که از قبل با آن حرف زده باشد.

## اعلان ثبت‌نام (جدا از Copilot)

این مسیر مال سایت است، نه ویجت CRM. کد: `notifyNewRegistration` در `/project/kermanshahcart/site/app/server.ts`.

| کانال | env در `site/app/.env` | گیرنده |
|---|---|---|
| تلگرام | `TELEGRAM_BOT_TOKEN`، `TELEGRAM_CHAT_ID`، `TELEGRAM_PROXY` | چت ثابت ادمین |
| روبیکا | `RUBIKA_SELL_BOT_TOKEN` (در نبودش `RUBIKA_BOT_TOKEN`)، `RUBIKA_CHAT_ID` | چت ثابت ادمین |

`@kermanshahcartbot` در `ker.py` بات آزمون روبیکاست، نه بات اعلان ثبت‌نام.

تست انجام‌شده (۲۰۲۶-۱۰-۲۰):

- چت Copilot و کوئری بدهکار از MySQL.
- پیام از اکانت اصلی روبیکا به `09365556383` (گفتگوی ذخیره‌شده `u0JUm1q0…`).
- پیام از بات ثبت‌نام روبیکا به `RUBIKA_CHAT_ID`.
- پیام از بات تلگرام ثبت‌نام به `TELEGRAM_CHAT_ID` (message_id 10)، از پشت `TELEGRAM_PROXY`.

## استقرار

مسیر زنده: `/project/kermanshahcart/crm`. فرآیند PM2: `carla-crm`. ورودی: `dist/server.cjs`، نه `tsx server.ts`.

```sh
cd /project/kermanshahcart/crm
git pull origin main
PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH npm run build
PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH pm2 restart carla-crm --update-env
```

`pm2 restart` بدون `--update-env` متغیرهای تازه‌ی `.env` را داخل فرآیند نمی‌آورد. بیلد هر دو را می‌سازد: فرانت Vite و `dist/server.cjs` با esbuild.

اگر PM2 خالی شد و daemon زنده است: `pm2 resurrect` از `/root/.pm2/dump.pm2`. بعد از بازیابی ۲۰۲۶-۱۰-۱۹ هر پنج فرآیند (`kermanshah-site`، `gemini-relay`، `carla-crm`، `crm-rubika-listener`، `kermanshahcart-quizbot`) برگشتند. سایت `:5200` و CRM `:3001`.

## env فرآیند CRM

غیر از سه متغیر Copilot، `TELEGRAM_BOT_TOKEN` از `site/app/.env` داخل `.env` همین CRM کپی شده تا `send_notification` تلگرام از خود CRM کار کند. توکن را در لاگ و ریپو نگذار. `.env` روی سرور `0600` است.

## پایگاه دادهٔ هم‌راز (`COPILOT_DB_BACKEND`)

| مقدار | رفتار |
|---|---|
| `directus` | ابزارهای `directus_schema` / `directus_read_items` / `directus_write_items` از MCP داخلی Directus (`COPILOT_DIRECTUS_URL`, پیش‌فرض `http://127.0.0.1:8055/mcp`، توکن `COPILOT_DIRECTUS_TOKEN`). اگر MCP پایین باشد، در صورت تنظیم بودن DBHub به آن برمی‌گردد، وگرنه به SQL داخلی. نوشتن در جداول مالی و هر گونه حذف رد می‌شود و در `crm_audit_log` ثبت می‌گردد. |
| `dbhub` | ابزارهای فقط‌خواندنی DBHub (`COPILOT_DBHUB_URL` / `COPILOT_DBHUB_TOKEN`). اگر DBHub پایین باشد، SQL داخلی. |
| `builtin` (پیش‌فرض) | `run_sql_query` فقط SELECT، با allowlist (از جمله `sms_reports` و `sms_credit_log`). |

توکن Directus را در git نگذارید. تعویض بک‌اند بعد از تغییر `.env` نیاز به `pm2 restart carla-crm --update-env` دارد. نقش و مجوزهای کاربر `hamraz-agent` در مخزن `ham-admin` است و تا تأیید مالک روی سرور اعمال نمی‌شود.

## تنظیمات > تنظیمات هم‌راز (Settings, admin only)


All copilot knobs are editable in the CRM (`GET/POST /api/settings/hamraz`, `POST /api/settings/hamraz/test`) and
stored in `settings.gateways.hamraz` (JSON store, never sent to the browser; no SQL migration). Precedence per
field: saved > env > default; values are read per request, so saving needs no restart.

| Field | Env fallback | Default |
|---|---|---|
| enabled | — | on |
| API URL | `COPILOT_API_URL` | — |
| API key (write-only, `api_key_set` only) | `COPILOT_API_KEY` | — |
| model | `COPILOT_MODEL` | `gpt-4o-mini` |
| max steps (1..20) | — | 6 |
| read-only SQL | `COPILOT_SQL_ENABLED=1` | off |
| `sms_send_direct` allowed | — | on |
| confirm before send: sms_send / Telegram / Rubika | — | all on |

With a confirmation toggle off, that channel's tool sends immediately (audited as `/copilot/direct/...`), and the
system prompt rule ۶ is rebuilt to match; with the defaults rule ۶ is the original text. «تست اتصال» sends one
`ping` chat completion (`max_tokens` 5, no tools); provider errors are scrubbed of the key.

## صاحب کسب‌وکار و سطوح کاربری (تنظیمات › تنظیمات هم‌راز)

- **صاحب کسب‌وکار** (`ownerContact.ts`, `GET/POST /api/settings/business-owner`, admin): تلفن، تلگرام، روبیکا و بله با اعتبارسنجی؛ لینک‌ها `tel:`، `https://t.me/<id>`، `https://rubika.ir/<id>`، `https://ble.ir/<id>`. در `settings.gateways.business_owner` ذخیره می‌شود (در publicSettings نیست). ابزار هم‌راز `get_business_owner_contact` (فقط مدیر) آن را می‌خواند؛ ارسال همچنان با ابزارهای ارسال و قوانین تأیید.
- **سطوح کاربری** (`accessLevels.ts`, `/api/access-levels`): هر سطح یک نقش پایه (admin/cashier/instructor) و ماتریس دسترسی دارد؛ نقش پایه سقف است و ماتریس فقط محدود می‌کند. middleware سرور بعد از `canAccessApi` اعمال می‌شود؛ ابزارهای هم‌راز و تأیید پیام‌های معلق (پیامک، استرداد/ریورس) هم بررسی می‌شوند. مهاجرت idempotent: سطوح سیستمی «مدیر کل/صندوقدار/مربی» ساخته و به کاربران فعلی داده می‌شود؛ مدیر env همیشه «مدیر کل» است و این سطح قابل ویرایش/حذف نیست.
- تست‌ها: `npm run test:access-levels`؛ E2E روی سرور آزمایشی: `scripts/e2e-access-levels.mjs`.

## هویت گوینده و تاریخچهٔ هر کاربر (`copilotSpeaker.ts`)

- سرور از نشست ورود (نه از بدنهٔ درخواست) نام، نام کاربری، نقش پایه، سطح، دسترسی‌ها و «صاحب کسب‌وکار بودن» را می‌سازد (مدیر کل، یا تطبیق نام/تلفن با «صاحب کسب‌وکار») و بند ۱۱ پرامپت را اضافه می‌کند. هم‌راز کاربر را با نامش صدا می‌زند و ادعای هویت داخل گفتگو را نمی‌پذیرد.
- تاریخچه: `copilot_conversations[username]` در db_store (حداکثر ۱۰۰ نوبت). `GET /api/copilot/history` و `POST /api/copilot/history/clear` فقط برای خود کاربر؛ ویجت به ازای هر کاربر از نو mount می‌شود.
- پاسخ خالی مدل یک‌بار تکرار می‌شود و بعد خطای فارسی 502 برمی‌گردد (به‌جای پاسخ خالی).
- تست: `npm run test:copilot-speaker`.
