# Origin Diagnostics: https://kermanshahcart.ir on server-iran

Collected at: 2026-10-22 00:45 UTC

## Summary
- **Origin Health**: Healthy and responsive; serving HTTP 200 locally on upstream port 5200 and via local Nginx reverse proxy.
- **HTTP Codes**: Both root (`/`) and API catalog (`/api/course-catalog`) returned `200 OK` (with total response times under 10ms locally).
- **PM2 Status**: `kermanshah-site` is `online` (PID 731627, cwd: `/project/kermanshahcart/site/app`, uptime since timestamp 1792622905602, 13 restarts).
- **Error Logs**: Error log contains 16 historical lines (SMS credit insufficiency, DB unknown column `full_name`, Zarinpal callback domain mismatch, Telegram network timeout); no crashing fatal errors or active loops.
- **System & Git**: Disk `/` is at 96% utilization (1.4G available); git working tree is clean on commit `3857afd`.

---

## 1. System Overview (date, uptime, df, free)
```
Thu Oct 22 12:45:23 AM UTC 2026
 00:45:23 up 2 days,  1:42,  5 users,  load average: 1.55, 0.95, 0.76
/dev/vda1        30G   27G  1.4G  96% /
               total        used        free      shared  buff/cache   available
Mem:           3.8Gi       2.3Gi       444Mi        21Mi       1.4Gi       1.5Gi
```

---

## 2. PM2 Status
```
{ msg: 'pong' }
kermanshah-site online 1792622905602 13 /project/kermanshahcart/site/app /root/.pm2/logs/kermanshah-site-error.log
gemini-relay online 1792453985320 0 /project/kermanshahcart/gemini-relay /root/.pm2/logs/gemini-relay-error.log
carla-crm online 1792628789988 6 /project/kermanshahcart/crm /root/.pm2/logs/carla-crm-error.log
crm-rubika-listener online 1792453985395 0 /project/kermanshahcart/crm /root/.pm2/logs/crm-rubika-listener-error.log
kermanshahcart-quizbot stopped 1792595975383 0 /project/kermanshahcart/site/app /root/.pm2/logs/kermanshahcart-quizbot-error.log
site-error-logger online 1792578460238 0 /opt/site-errors /root/.pm2/logs/site-error-logger-error.log
kermanshahcart-bot2 online 1792607558146 0 /project/kermanshahcart/rubika-bot /root/.pm2/logs/kermanshahcart-bot2-error.log
kermanshahcart-tgbot online 1792628790959 0 /project/kermanshahcart/telegram-bot /root/.pm2/logs/kermanshahcart-tgbot-error.log
```

---

## 3. Upstream HTTP Checks (127.0.0.1:5200)

### Root `/`
```
local5200=200 t=0.005683
<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%233b82f6' stroke='%230f172a' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6 3h12l4 6-10 13L2 9Z'/><path d='M11 3 8 9l4 13 4-13-3-6'/><path d='M2 9h20'/></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preload" href="/font
```

### Catalog API `/api/course-catalog`
```
catalog=200
{"courses":[{"courseId":1,"title":"حمل و نقل جاده ای","priceToman":6200000,"source":"crm"},{"courseId":2,"title":"محموله خطرناک","priceToman":4400000,"source":"crm"},{"courseId":3,"title":"اتوبوس برون شهری","priceToman":6200000,"source":"crm"},{"courseId":4,"title":"مدیر شرکت حمل و نقل","priceToman":7400000,"source":"crm"},{"courseId":5,"title":"مدیر شرکت مسافر برون شهری","priceToman":7400000,"source":"crm"},{"courseId":6,"title":"مسئول فنی","priceToman":5300000,"source":"crm"}]}
```

---

## 4. Local Nginx HTTP Host Header Check (`Host: kermanshahcart.ir`)
```
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Date: Thu, 22 Oct 2026 00:45:56 GMT
Content-Type: text/html; charset=utf-8
Content-Length: 15859
Connection: keep-alive
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-cache
ETag: W/"3df3-krR6nNZYKlWG2Z/m6VEsm7Nsg4c"
```

---

## 5. Nginx Configuration & Vhost Check
```
4:    server_name kermanshahcart.ir www.kermanshahcart.ir;
45:    server_name kermanshahcart.ir www.kermanshahcart.ir;
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

---

## 6. PM2 Error Log (`kermanshah-site-error.log`)
```
[OTP] SMS.ir error: اعتبار کافی نمیباشد
[OTP] SMS.ir error: اعتبار کافی نمیباشد
Telegram network error (likely filtered): The operation was aborted due to timeout
[OTP] SMS.ir error: اعتبار کافی نمیباشد
[OTP] SMS.ir error: اعتبار کافی نمیباشد
[login-national] DB error: Unknown column 'full_name' in 'field list'
[login-national] DB error: Unknown column 'full_name' in 'field list'
[login-national] DB error: Unknown column 'full_name' in 'field list'
[client-error] where=deploy-check path= msg=verify-test ua=

[SMS] smsir send failed to *******5609: اعتبار کافی نمیباشد
[SMS] smsir send failed to *******6383: اعتبار کافی نمیباشد
[course-pay] Zarinpal request error: {"message":"The callback URL domain does not match the registered terminal domain.","code":-14,"validations":[]}
TEST_SERVER_ERR verify-tail Wed Oct 21 10:28:25 UTC 2026
[client-error] where= path= msg=probe ua=
```

---

## 7. Listening Sockets (`ss -ltnp`)
```
LISTEN 0      511        127.0.0.1:18081      0.0.0.0:*    users:(("node /project/k",pid=8922,fd=20))
LISTEN 0      511          0.0.0.0:3001       0.0.0.0:*    users:(("node /project/k",pid=776361,fd=19))
LISTEN 0      511        127.0.0.1:18090      0.0.0.0:*    users:(("node",pid=430322,fd=21))
LISTEN 0      4096       127.0.0.1:8055       0.0.0.0:*    users:(("docker-proxy",pid=1603,fd=7))
LISTEN 0      511          0.0.0.0:443        0.0.0.0:*    users:(("nginx",pid=360868,fd=17),("nginx",pid=360867,fd=17),("nginx",pid=930,fd=17))
LISTEN 0      4096       127.0.0.1:1080       0.0.0.0:*    users:(("microsocks",pid=741,fd=3))
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=360868,fd=15),("nginx",pid=360867,fd=15),("nginx",pid=930,fd=15))
LISTEN 0      511          0.0.0.0:5200       0.0.0.0:*    users:(("node /project/k",pid=731627,fd=19))
LISTEN 0      511             [::]:443           [::]:*    users:(("nginx",pid=360868,fd=18),("nginx",pid=360867,fd=18),("nginx",pid=930,fd=18))
LISTEN 0      511             [::]:80            [::]:*    users:(("nginx",pid=360868,fd=16),("nginx",pid=360867,fd=16),("nginx",pid=930,fd=16))
```

---

## 8. Git Repository Status (`/project/kermanshahcart/site/app`)
```
git status --short: (clean, no modified files)
git log -1: 3857afd Course pages: fix header links to real routes, use main site footer
```
