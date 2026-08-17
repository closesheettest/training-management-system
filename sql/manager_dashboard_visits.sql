-- sql/manager_dashboard_visits.sql
--
-- "How many times a day are the regional managers actually opening their
-- dashboard?" — Neal, 2026-08-17.
--
-- One row per VISIT, where a visit is a session, not a page load. The dashboard
-- calls `whoami` on mount and again after most actions, so counting raw calls
-- would say a manager visited 20 times when they opened it once and worked for
-- an hour. regional-manager-api only writes a new row when the manager's last
-- visit was more than VISIT_GAP_MIN (30) minutes ago.
--
-- Read by the admin Regional Managers page: today's count, the last 7 days, and
-- when they were last on it.
--
-- RLS is ON. READ is open to the app (the admin Regional Managers page queries
-- this table directly with the anon key, the same way it already reads
-- `trainees`). WRITE has no policy at all, so only the service role — i.e.
-- regional-manager-api — can record a visit. A manager can't inflate their own
-- number, and nothing here is personal data: a manager id and a timestamp.

create table if not exists manager_dashboard_visits (
  id          uuid primary key default gen_random_uuid(),
  manager_id  uuid not null references trainees(id) on delete cascade,
  visited_at  timestamptz not null default now(),
  -- The Eastern-time calendar day, stamped on write. Grouping by this is what
  -- makes "times per day" mean the manager's day rather than a UTC day that
  -- rolls over at 8 PM their time.
  et_day      date not null
);

create index if not exists mdv_manager_recent_idx on manager_dashboard_visits (manager_id, visited_at desc);
create index if not exists mdv_day_idx            on manager_dashboard_visits (et_day);

alter table manager_dashboard_visits enable row level security;

drop policy if exists mdv_read on manager_dashboard_visits;
create policy mdv_read on manager_dashboard_visits for select using (true);
-- deliberately NO insert/update/delete policy — service role only.

-- Verify:
--   select et_day, count(*) from manager_dashboard_visits group by 1 order by 1 desc limit 14;
