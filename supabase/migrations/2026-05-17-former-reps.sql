-- Migration: track former reps so admin has a punch list of accounts
-- to deactivate in the other systems (GHL, RepCard, JobNimbus, Sales
-- Academy, Google Workspace).
--
-- When admin clicks "No longer a sales rep" on /active-reps, we set:
--   is_active_sales_rep = false       (drops them from broadcast list)
--   left_company_at     = now()        (timestamp for the punch list)
--   left_company_reason = '...'        (optional, free-text)
--
-- The cleanup-pending list on /active-reps surfaces every trainee
-- with left_company_at IS NOT NULL AND cleanup_done_at IS NULL. Each
-- row has a "✓ All cleanup done" button that stamps cleanup_done_at,
-- which removes them from the visible list. The columns persist so
-- you can audit former-rep removals later.

alter table trainees add column if not exists left_company_at timestamptz;
alter table trainees add column if not exists left_company_reason text;
alter table trainees add column if not exists cleanup_done_at timestamptz;

-- Partial index so the "pending cleanup" query is cheap.
create index if not exists trainees_pending_cleanup_idx
  on trainees(left_company_at)
  where left_company_at is not null and cleanup_done_at is null;
