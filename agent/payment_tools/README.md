# Ham-Raz payment tools (`agent/payment_tools`)

Zarinpal tools for هم‌راز (the CRM's AI copilot), admin only, toggled by «ابزارهای پرداخت» in
**تنظیمات > تنظیمات هم‌راز > دستیار هم‌راز** (`settings.gateways.hamraz.payment_tools`, default on).

```
agent/payment_tools/
  index.ts            registry: PAYMENT_TOOLS, toolDefinitions(), runPaymentTool(), skillsPrompt()
  executor.ts         executePaymentAction(): runs reverse/refund, called only from the «تأیید» route
  client/index.ts     REST v4 (sandbox-aware host) + GraphQL query client; isolated AddRefund mutation
  client/errors.ts    official error-code map (docs /paymentGateway/errorList.html)
  tools/*.ts          one tool per file: name, Persian description, JSON schema, handler
  skills/*.md         loaded into the system prompt when the tools are enabled
```

| Tool | Kind | Zarinpal API |
|---|---|---|
| zarinpal_list_terminals | read | GraphQL `Terminals` (key compared server-side, never returned) |
| zarinpal_list_transactions | read | GraphQL `Session` (filter, paged, date/description filter, rial→toman) |
| zarinpal_transaction_inquiry | read | REST `/pg/v4/payment/inquiry.json` |
| zarinpal_unverified_list | read | REST `/pg/v4/payment/unVerified.json` |
| zarinpal_reconcile_list | read | GraphQL `Reconciliation` |
| zarinpal_error_explain | local | — |
| zarinpal_create_payment_link | CRM write (link row only, nothing sent) | debt-link store → `CRM_PAYMENT_LINK_BASE` + code |
| zarinpal_verify_payment | gateway verify | REST `/pg/v4/payment/verify.json` |
| zarinpal_reverse | **mutating, always confirmed** | REST `/pg/v4/payment/reverse.json` |
| zarinpal_refund | **mutating, always confirmed; off in sandbox** | GraphQL mutation `AddRefund` |

Rules: config comes from Settings → درگاه پرداخت (saved > env); REST host is `sandbox.zarinpal.com` when sandbox is
on; the GraphQL read helper rejects `mutation`; mutating tools only queue a pending action (`channel: 'payment'`)
that runs after the admin's «تأیید» — not affected by the confirm toggles; outputs never contain the merchant id,
token or a full card number. Tests: `npm run test:payment-tools`.
