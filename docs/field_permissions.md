# دسترسی ریزدانه به فیلدهای حساس / Field-level permissions

Settings → «دسترسی به فیلدهای حساس» (admin only). Code: `fieldPolicy.ts`, wiring in `server.ts`, UI `src/components/FieldPolicyPanel.tsx`.

## Model
- Field groups: `national_code`, `mobile` (phone_number/mobile/phone…), `address` (+postal_code), `personal_details`
  (father_name, birth date), `id_documents` (ID scan, registration PDFs), `personal_photo`, `financial`
  (final_price, total_paid, remaining_debt, course_fee, amount, paid, balance, debt…). The key list is in `FIELD_GROUPS`.
- Access per role (cashier, instructor, api): `edit` | `view` | `masked` | `hidden`. Admin is always full access.
  Documents, photos and financial amounts cannot be masked (masked → hidden).
- **Defaults = behaviour before this change**: cashier edit on everything; instructor sees name, mobile and personal
  photo only (the existing instructor whitelist stays; the policy can only widen it to listed keys, then view/mask applies).
  Verified by comparing a build of `main` with this branch for admin/cashier/instructor on 8 list endpoints: identical.

## Enforcement (server side)
- Responses: every JSON response under `/api` (`res.json`) is walked (nested objects/arrays) and mapped keys are masked or
  removed for the caller's role.
- Writes: JSON bodies of POST/PUT/PATCH lose keys the role may not write (PUT/PATCH need `edit`; POST = create also
  accepts `view`). Blocked groups are audited as `blocked_edit`. Student PUT is partial, so stripped keys keep stored values.
- Uploads: `POST /api/students/:id/photos` needs edit on id_documents + personal_photo; `POST /api/enrollments/:id/receipt`
  needs edit on id_documents.
- Files: `/StudentFiles/*` → personal photos need view on personal_photo, all other files view on id_documents.
  `/api/registrations/:code/file/:kind` likewise.
- Audit: `crm_field_access_log` (MySQL) or `field_access_log` ring buffer (2000) in db_store.json: user, role, method,
  path (ids → `:id`), field groups, record count, action (view / blocked_edit / file). **Values are never logged.**
  Same user+path+fields+action is logged at most once a minute. Toggle in the UI.

## Routes (admin)
`GET/PUT /api/settings/field-policy`, `POST /api/settings/field-policy/reset`, `GET /api/settings/field-access-log?username&field&limit`.
Stored in `settings.field_policy`.

## Integration points / not covered
- **/api/v1 (public-api PR #9):** not on main yet. After merge, apply `applyFieldPolicy(row, 'api', fieldPolicy.get().policy)`
  to the outputs of `apiStudent/apiEnrollment/apiPayment` and `stripWrites(body, 'api', policy, true)` on v1 POSTs.
  The skip list already excludes `/v1/` from the session-based filter. The v1 whitelists remain the outer limit.
- **Copilot (دستیار هوشمند):** answers are free text generated from SQL/tool results; values inside text are not masked.
  Restrict Copilot for roles with masked/hidden fields, or route its tool results through `applyFieldPolicy`.
- Non-JSON responses (`res.send`, streams), e.g. messenger media and `/uploads` (old receipts), are not filtered.
- Client UI: when a field is hidden the UI shows empty values; masked values are display-only (writes are stripped server side).
- Messenger/SMS screens use phone numbers; masking `mobile` for cashiers will limit those features.
- Tests: `npm run test:field-policy`.
