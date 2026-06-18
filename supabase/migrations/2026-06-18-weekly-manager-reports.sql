-- Weekly Rep Report (regional-manager dashboard) — one row per zone+week.
-- Backs netlify/functions/weekly-report-api.js (save / submit / history).
-- The function writes with the service key, so RLS is left off (default).
create table if not exists weekly_manager_reports (
  id            uuid primary key default gen_random_uuid(),
  zone          text not null,
  manager_name  text,
  week_start    date not null,
  rows          jsonb not null default '[]'::jsonb,  -- per-rep: insp_signed, back_to_retail, appts, sales, rode, take
  summary       text,
  status        text not null default 'draft',        -- 'draft' | 'submitted'
  submitted_at  timestamptz,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now(),
  unique (zone, week_start)                            -- required for upsert(onConflict: 'zone,week_start')
);
