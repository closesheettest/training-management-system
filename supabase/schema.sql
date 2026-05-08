-- Training Management System schema
-- Run this in Supabase Dashboard → SQL Editor → New query → paste → Run

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  week_end_date date not null,
  location_name text not null,
  location_address text not null,
  schedule_details text,
  status text not null default 'upcoming',
  created_at timestamptz not null default now()
);

create table if not exists trainees (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  phone text not null,
  address text,
  city text,
  state text,
  zip text,
  registered boolean not null default false,
  registration_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references trainees(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  attendance_date date not null,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  unique (trainee_id, attendance_date)
);

-- Useful indexes
create index if not exists trainees_class_id_idx on trainees(class_id);
create index if not exists trainees_token_idx on trainees(registration_token);
create index if not exists attendance_class_date_idx on attendance(class_id, attendance_date);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Stage 1: permissive policies so the app works without auth.
-- Stage 3 will add Supabase Auth and tighten these to authenticated users only.

alter table classes enable row level security;
alter table trainees enable row level security;
alter table attendance enable row level security;

-- Classes: public read/write (will tighten later)
drop policy if exists "classes_public_select" on classes;
drop policy if exists "classes_public_insert" on classes;
drop policy if exists "classes_public_update" on classes;
create policy "classes_public_select" on classes for select using (true);
create policy "classes_public_insert" on classes for insert with check (true);
create policy "classes_public_update" on classes for update using (true);

-- Trainees: public read/write
drop policy if exists "trainees_public_select" on trainees;
drop policy if exists "trainees_public_insert" on trainees;
drop policy if exists "trainees_public_update" on trainees;
create policy "trainees_public_select" on trainees for select using (true);
create policy "trainees_public_insert" on trainees for insert with check (true);
create policy "trainees_public_update" on trainees for update using (true);

-- Attendance: public read/write
drop policy if exists "attendance_public_select" on attendance;
drop policy if exists "attendance_public_insert" on attendance;
drop policy if exists "attendance_public_update" on attendance;
create policy "attendance_public_select" on attendance for select using (true);
create policy "attendance_public_insert" on attendance for insert with check (true);
create policy "attendance_public_update" on attendance for update using (true);
