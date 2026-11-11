Owner Sina (gateway-owner). Time: 08:00 Asia/Tehran 2026-10-22.

Review then commit. Do not deploy to server-iran. Do not send OTP. Do not complete Zarinpal.

1. Read if present:
- projects/crm/reports/debug-2026-10-22-004900.md
- projects/crm/reports/debug-2026-10-22-gemini-audit.md
- projects/crm/reports/debug-2026-10-22-freemodel/dossier-complete.md
- projects/crm/reports/debug-2026-10-22-pages-twice.md
2. Review each finding one by one against origin.md / public-http.md / chrome-audit.json. Drop anything unverified or fake.
3. git -C projects/crm status --short. Commit ONLY report files under projects/crm/reports/debug-2026-10-22*. Do not commit CopilotWidget, App.tsx, or other unrelated dirty files.
4. After npm/tsc is N/A for markdown: git add the report files, commit in Persian/English technical message, push origin of mmd30na-sketch/crm.
5. Reply with commit SHA and which findings were kept vs dropped.
