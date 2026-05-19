-- Migration: regions become a managed DB table instead of a hardcoded list.
--
-- Why: admin needs to add new sales regions (e.g., when expanding into
-- Tampa or Naples) without a code deploy, and they need to move reps
-- between regions when a rep relocates. Both happen on the new
-- /regions admin page.
--
-- The hardcoded FL_REGIONS constant in src/lib/locations.js stays as a
-- seed list + a safety fallback. New regions added to this table show
-- up automatically in the picker UIs (Active Reps filter chips, Group
-- Messages region filter, Sales Team Map filter, rep-facing
-- /update-info dropdown).
--
-- latitude / longitude let the Sales Team Map drop a sensible pin even
-- before a rep in that region has filled in /update-info — the pin
-- sits at the region's metro center with a small per-trainee jitter,
-- same pattern the existing four regions use.

create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create index if not exists regions_sort_order_idx on regions(sort_order);

-- Seed with the current four regions + their existing metro-center
-- coordinates (copied from REGION_CENTERS in RepMap.jsx). Idempotent —
-- re-running the migration won't duplicate.
insert into regions (name, sort_order, latitude, longitude) values
  ('St Pete',      10, 27.7676, -82.6403),
  ('Jacksonville', 20, 30.3322, -81.6557),
  ('Orlando',      30, 28.5383, -81.3792),
  ('Miami',        40, 25.7617, -80.1918)
on conflict (name) do nothing;

-- RLS: open policies like the rest of the schema. The /regions admin
-- page is the only writer; readers are every page that shows a region
-- chip / dropdown.
alter table regions enable row level security;
drop policy if exists "regions_public_select" on regions;
drop policy if exists "regions_public_insert" on regions;
drop policy if exists "regions_public_update" on regions;
drop policy if exists "regions_public_delete" on regions;
create policy "regions_public_select" on regions for select using (true);
create policy "regions_public_insert" on regions for insert with check (true);
create policy "regions_public_update" on regions for update using (true);
create policy "regions_public_delete" on regions for delete using (true);
