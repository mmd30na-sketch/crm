You are an expert Fullstack Code Auditor and QA Engineer.
Analyze the CRM codebase at `/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm`.
Your goal is to audit EVERY SINGLE TAB, BUTTON, AND USER ACTION in the UI:
1. `src/App.tsx` (all navigation tabs: copilot, supervisor, students, register, accounting, messenger, terms, leads, site-requests, tasks, campaigns, settings)
2. `src/components/StudentsList.tsx` (all action buttons: edit student, delete, print card, export, filter, search, payment modal, status change)
3. `src/components/RegistrationForm.tsx` / `PendingRegistrationsModal.tsx` / `SiteRegistrationsList.tsx`
4. `src/components/AccountingDashboard.tsx` (all payment actions, receipt printing, debts, filters)
5. `src/components/BulkMessaging.tsx` (send SMS/Rubika/Telegram, template selection, recipient filtering)
6. `src/components/SettingsModal.tsx` & `AuditBackupPanel.tsx` (backup download/restore, system settings save, theme switch)
7. Check corresponding API endpoints in `server.ts` to see if the button triggers an endpoint that is broken, returns 500, has missing parameters, has SQL syntax errors, or unhandled promise rejections.

List all discovered bugs, broken buttons, missing onClick handlers, non-functional features, or API contract mismatches.
Write your detailed findings in Persian or English with exact file paths, line numbers, and impact description.
