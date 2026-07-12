-- 2026-07-12c-ongoing-training-send.sql
-- ─────────────────────────────────────────────────────────────────────
-- Daily "Ongoing Training" send + usage tracking.
--
--   • app_settings — tiny key/value store. Holds the ON/OFF toggle for the
--     daily send (default OFF — nothing goes out until an admin flips it on
--     the Ongoing Training page) and the rolling "which day is next" cursor.
--   • training_views — one row per time a manager opens their training
--     link, with a running seconds counter (heartbeat-updated) so we can
--     see who actually used it and for how long.
--
-- RLS: enabled but fully open (using true) — same open-anon pattern as the
-- rest of the app. Server writes (cron, view api) use the service key.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists app_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

alter table app_settings enable row level security;
drop policy if exists app_settings_sel on app_settings;
drop policy if exists app_settings_ins on app_settings;
drop policy if exists app_settings_upd on app_settings;
drop policy if exists app_settings_del on app_settings;
create policy app_settings_sel on app_settings for select using (true);
create policy app_settings_ins on app_settings for insert with check (true);
create policy app_settings_upd on app_settings for update using (true) with check (true);
create policy app_settings_del on app_settings for delete using (true);

insert into app_settings (key, value) values
  ('ongoing_training_daily_send', 'off'),   -- 'on' | 'off' — the toggle. Default OFF.
  ('ongoing_training_next_day',   '1')      -- rolling cursor: which day position goes out next
on conflict (key) do nothing;

-- ── Usage log ────────────────────────────────────────────────────────
create table if not exists training_views (
  id            uuid primary key default gen_random_uuid(),
  manager_token text,
  manager_id    uuid,
  manager_name  text,
  day_position  integer,
  day_title     text,
  seconds       integer not null default 0,   -- time-on-page, heartbeat-updated
  opened_at     timestamptz not null default now(),
  last_ping_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists training_views_manager_idx on training_views (manager_id, opened_at desc);
create index if not exists training_views_opened_idx on training_views (opened_at desc);

alter table training_views enable row level security;
drop policy if exists training_views_sel on training_views;
drop policy if exists training_views_ins on training_views;
drop policy if exists training_views_upd on training_views;
drop policy if exists training_views_del on training_views;
create policy training_views_sel on training_views for select using (true);
create policy training_views_ins on training_views for insert with check (true);
create policy training_views_upd on training_views for update using (true) with check (true);
create policy training_views_del on training_views for delete using (true);
