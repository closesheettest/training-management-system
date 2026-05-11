-- Training Management System schema (v2 — Locations Library added)
-- Run this in Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run — idempotent.

-- ============================================================
-- TABLES
-- ============================================================

-- Saved hotels / training sites — picked from a dropdown when creating a class
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  street_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  parking_info text,
  contact_info text,
  schedule_template text,
  created_at timestamptz not null default now()
);

-- Migration: ensure structured address columns exist if table was created with earlier schema (single `address` column).
alter table locations add column if not exists street_address text;
alter table locations add column if not exists city text;
alter table locations add column if not exists state text;
alter table locations add column if not exists zip text;
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='locations' and column_name='address') then
    execute 'alter table locations alter column address drop not null';
  end if;
end $$;

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete restrict,
  week_start_date date not null,
  week_end_date date not null,
  schedule_details text,
  status text not null default 'upcoming',
  created_at timestamptz not null default now()
);

-- Upgrade path from earlier schema (v1 had location_name/location_address as required columns on classes).
-- Relax those if present and ensure location_id exists.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='classes' and column_name='location_name') then
    execute 'alter table classes alter column location_name drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_name='classes' and column_name='location_address') then
    execute 'alter table classes alter column location_address drop not null';
  end if;
end $$;
alter table classes add column if not exists location_id uuid references locations(id) on delete restrict;

create table if not exists trainees (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  phone text not null,
  street_address text,
  city text,
  state text,
  zip text,
  registered boolean not null default false,
  registered_at timestamptz,
  registration_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Migration: rename legacy 'address' column to 'street_address' for consistency with locations table
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='trainees' and column_name='address')
     and not exists (select 1 from information_schema.columns where table_name='trainees' and column_name='street_address') then
    execute 'alter table trainees rename column address to street_address';
  end if;
end $$;

-- Migration: add registered_at if missing
alter table trainees add column if not exists registered_at timestamptz;

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references trainees(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  attendance_date date not null,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  unique (trainee_id, attendance_date)
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists trainees_class_id_idx on trainees(class_id);
create index if not exists trainees_token_idx on trainees(registration_token);
create index if not exists attendance_class_date_idx on attendance(class_id, attendance_date);
create index if not exists classes_location_idx on classes(location_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Stage 1: permissive policies so the app works without auth.
-- Stage 3 will add Supabase Auth and tighten these to authenticated users only.

alter table locations enable row level security;
alter table classes enable row level security;
alter table trainees enable row level security;
alter table attendance enable row level security;

-- Locations
drop policy if exists "locations_public_select" on locations;
drop policy if exists "locations_public_insert" on locations;
drop policy if exists "locations_public_update" on locations;
drop policy if exists "locations_public_delete" on locations;
create policy "locations_public_select" on locations for select using (true);
create policy "locations_public_insert" on locations for insert with check (true);
create policy "locations_public_update" on locations for update using (true);
create policy "locations_public_delete" on locations for delete using (true);

-- Classes
drop policy if exists "classes_public_select" on classes;
drop policy if exists "classes_public_insert" on classes;
drop policy if exists "classes_public_update" on classes;
drop policy if exists "classes_public_delete" on classes;
create policy "classes_public_select" on classes for select using (true);
create policy "classes_public_insert" on classes for insert with check (true);
create policy "classes_public_update" on classes for update using (true);
create policy "classes_public_delete" on classes for delete using (true);

-- Trainees
drop policy if exists "trainees_public_select" on trainees;
drop policy if exists "trainees_public_insert" on trainees;
drop policy if exists "trainees_public_update" on trainees;
drop policy if exists "trainees_public_delete" on trainees;
create policy "trainees_public_select" on trainees for select using (true);
create policy "trainees_public_insert" on trainees for insert with check (true);
create policy "trainees_public_update" on trainees for update using (true);
create policy "trainees_public_delete" on trainees for delete using (true);

-- Attendance
drop policy if exists "attendance_public_select" on attendance;
drop policy if exists "attendance_public_insert" on attendance;
drop policy if exists "attendance_public_update" on attendance;
drop policy if exists "attendance_public_delete" on attendance;
create policy "attendance_public_select" on attendance for select using (true);
create policy "attendance_public_insert" on attendance for insert with check (true);
create policy "attendance_public_update" on attendance for update using (true);
create policy "attendance_public_delete" on attendance for delete using (true);
