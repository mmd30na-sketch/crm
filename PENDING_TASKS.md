# 📋 Carla CRM & Ecosystem v5.1 — Task Status & Backlog

**Last Updated:** 2026-07-29  
**Status Overview:** Frontend-Backend Integration ✅ Complete | Multi-Agent WebSocket Bridge ✅ Online | DB Connected ✅

---

## ✅ Completed Tasks (انجام‌شده)

### 1. Backend & DB Alignment (`C:\dev\eco_v4\apps\crm\backend`)
- [x] Verified MySQL database connection to `services.irn5.chabokan.net:52691` (`nodejs430_carla`).
- [x] Confirmed 36 tables & views (Students, Courses, Payments, Enrollments, Expenses, Settings, Reports).
- [x] Added 7 missing REST API endpoints in `server.ts`:
  - `GET /api/payments` — Fetch payment history for accounting & student ledger.
  - `POST /api/students` — Direct student registration endpoint.
  - `POST /api/students/:id/photos` — Multipart upload for ID card & personal photos.
  - `GET /api/enrollments` — List student course enrollments.
  - `POST /api/enrollments` — Create course enrollment record.
  - `GET /api/enrollments/:id/report-context` — Receipt PDF context generator.
  - `POST /api/enrollments/:id/receipt` — Upload generated PDF receipt.

### 2. Frontend Adaptation (`C:\Users\hi\OneDrive\Desktop\remix-carla-crm-updated`)
- [x] Configured `vite.config.ts` proxy to route `/api/*` and `/uploads/*` to `http://localhost:3001`.
- [x] Completely rewrote `src/api/client.ts` as DTO adapter layer to map MySQL schema fields to React UI states.
- [x] Updated `src/types.ts` with status enums and backend join fields (`total_paid`, `remaining_debt`, etc.).
- [x] Fixed date field mismatch in `AccountingDashboard.tsx` (`pay_date_jalali` vs `expense_date`).
- [x] Verified TypeScript compilation with 0 errors (`tsc --noEmit` passed).

### 3. Multi-Agent Ecosystem v5.1
- [x] Master Bridge Server running on port `9100`.
- [x] Activated Vanguard IDE Agent watchdog daemon (`vanguard_agent.js`).
- [x] Verified WebSocket live messaging between `vanguard`, `gemi`, and `anti`.
- [x] Consulted Grok AI (`agent_call.py`) for architectural review on contract-first DTO pattern.

---

## ⏳ Pending Tasks & Next Steps (کارهای در انتظار)

### Phase 1: Live Runtime Smoke Test (تست عملیاتی همزمان)
- [ ] Run backend server (`cd C:\dev\eco_v4\apps\crm\backend && npm run dev`) on port `3001`.
- [ ] Run frontend app (`cd C:\Users\hi\OneDrive\Desktop\remix-carla-crm-updated && npm run dev`) on port `3000`.
- [ ] Test complete student registration flow (OCR scan -> Form Submit -> Payment -> PDF Receipt).

### Phase 2: Refinements & Polish (بهینه‌سازی و پولیش)
- [ ] Add Rubika / SMS notification gateway trigger on student registration.
- [ ] Add PDF print preview modal directly inside React UI instead of raw download link.
- [ ] Implement pagination & filter debounce on `StudentsList` component for large student datasets.

---

## 🛠️ Quick Commands

```powershell
# Start Backend
cd C:\dev\eco_v4\apps\crm\backend
npm run dev

# Start Frontend
cd C:\Users\hi\OneDrive\Desktop\remix-carla-crm-updated
npm run dev

# Start v5 Ecosystem
cd C:\Users\hi\OneDrive\Desktop\v5.1\v5
.\start_all.ps1
```
