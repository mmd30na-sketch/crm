# SMS

sms.ir is called directly from `shared/sms.ts`. There is no `smsir-js` or `sms-typescript` dependency.
The site process uses `/project/kermanshahcart/shared/sms.ts`; that copy must stay identical to this one.

## Config

| What | Where | Used for |
|---|---|---|
| `SMS_API_KEY` | environment only | header `x-api-key` on every call. Never written to MySQL or JSON |
| `app_settings['sms.config']` | MySQL | `provider` (`smsir`), `lineNumber`, `apiKeyRef` (`env:SMS_API_KEY`), `autoRegister`, `autoExam` |
| `SMS_SENDER_LINE` | environment | bulk line only when `lineNumber` is empty |
| `sms_templates` | MySQL | verify template id, parameter names, review status, bulk body |

`resolveSenderLine()` is the only line lookup: explicit branch line, then `sms.config.lineNumber`, then `SMS_SENDER_LINE`.
Verify sends do not use a line. A saved gateway API key from the UI is ignored.

## Calls

All go through `smsirCall` / `smsirRead` in `shared/sms.ts`. Copilot report reads use `smsirRead` and keep their own 2s gap.

- `POST /v1/send/verify` — `mobile`, `templateId`, `parameters: [{ name, value }]`. `name` has no `#`. `value` max 25 characters.
- `POST /v1/send/bulk` — `lineNumber`, `messageText`, `mobiles` (max 100).
- `GET /v1/credit`, `GET /v1/line`, `GET /v1/templates?pageNumber&pageSize` (page size max 100).

HTTP 200 is not enough. The JSON `status` must be `1`. `20` is the panel rate limit. `114` means a verify value exceeded 25 characters.

A template can be used for verify only when its review status is `2` (approved). `1` is still in review and cannot be edited. `3` is rejected; `rejectionReason` says why.
The sandbox key does not send real SMS and does not change real templates. Its verify fixture is template `123456` with `#CODE#`.
