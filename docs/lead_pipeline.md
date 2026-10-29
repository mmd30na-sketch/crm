# Lead pipeline (Kanban) / پایپ‌لاین سرنخ‌ها

## Data model / مدل داده
- Reuses the existing **`leads`** table (phase 4). Online registrations and enrollments are customers/sales, not
  pre-sale leads, so they are not used as the pipeline entity. Converting a lead still goes through the existing
  Leads screen (`/api/leads/:id/convert`).
- New, additive: `crm_lead_stages`, `crm_lead_stage_history`, and NULLable `leads.pipeline_stage_id`,
  `leads.owner_username`, `leads.stage_changed_at`. Created at boot by `ensureLeadPipelineSchema()`; the same DDL is in
  `database/migrations/20261028_crm_lead_pipeline.sql`.
- Default stages are seeded once and mapped to the legacy `leads.status` values (`new`, `contacted`,
  `in_negotiation`, `converted`, `lost`). Moving a lead into a stage with a `status_key` also updates `leads.status`,
  so the old Leads screen, follow-ups and reports stay consistent.
- Notes are stored in the existing `crm_activities` table (`entity_type='lead'`, `kind='note'`).
- Owner = a staff username from the staff directory (env admin + active `staff_users`). It is a new column, separate
  from the legacy numeric `assigned_staff_id`.

## API (admin + cashier; stage configuration is admin-only; MySQL required, otherwise 503)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/lead-pipeline/stages?all=1` | stages with `lead_count` |
| POST/PUT/DELETE | `/api/lead-pipeline/stages[/:id]` | admin; DELETE refuses (409) when leads are in the stage |
| POST | `/api/lead-pipeline/stages/reorder` | `{ids:[...]}` admin |
| GET | `/api/lead-pipeline/board?source_id&owner&q&course_id` | cards with masked phone only |
| POST | `/api/lead-pipeline/leads/:id/move` | `{stage_id}`; writes history |
| PUT | `/api/lead-pipeline/leads/:id/owner` | `{owner_username|null}` |
| GET/POST | `/api/lead-pipeline/leads/:id/notes` | `{body}` |
| GET | `/api/lead-pipeline/report?from=1405/01/01&to=1405/08/30&source_id` | Jalali range (Tehran time) |

Report: totals + conversion rate, funnel by stage ("reached" = lead was ever moved into the stage or is in it now),
by source, by Jalali month, and average days from creation to the first won move. Leads moved before this feature
have no history, so their "reached" count only reflects their current stage.

## UI
Tab «پایپ‌لاین فروش»: board (HTML5 drag-and-drop with optimistic update/revert, plus a per-card stage select for
touch screens), lead drawer (owner, stage, notes), report (CSS bar charts, no chart library) and stage settings (admin).

## Tests
`npm run test:lead-pipeline` — pure tests for `buildReport` and the Jalali helpers.
