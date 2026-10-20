# CRM Copilot

دستیار چت داخل CRM. روی سرور ایران اجرا می‌شود و مدل را از OmniRoute روی hydra-gcp می‌گیرد.

## چه چیزی بالا است

- ویجت: `src/components/CopilotWidget.tsx`، داخل `src/App.tsx`.
- API: `POST /api/copilot/chat` در `server.ts`. احراز هویت همان نشست CRM است (`Authorization: Bearer <token>`).
- حلقه ابزار حداکثر ۴ بار صدا می‌زند، بعد جواب فارسی برمی‌گردد.
- ابزارهای فقط‌خواندنی مالی/CRM به‌علاوه `send_notification`.
- `send_notification` فقط بعد از تأیید صریح کاربر در چت («بفرست» / «بله ارسال کن») باید صدا زده شود. این قید در system prompt است، نه یک قفل جدا در کد.

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
