-- Migration: per-day kiosk sign-in lockout.
--
-- After class begins, trainer taps "Close sign-in" on the kiosk to
-- lock the day's attendance. After that, the kiosk shows a "Sign-in
-- closed" banner and disables the name tiles. Stops people who showed
-- up late from back-stamping themselves present.
--
-- Tomorrow's kiosk re-opens automatically (no closure record for
-- tomorrow exists). The trainer closes it again at the end of each
-- day if they want the same lock.

create table if not exists sign_in_closures (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  attendance_date date not null,
  closed_at timestamptz not null default now(),
  -- Optional — who closed it. Recorded when the page knows who's
  -- using the kiosk; usually null on a shared tablet.
  closed_by text,
  unique (class_id, attendance_date)
);

create index if not exists sign_in_closures_class_date_idx
  on sign_in_closures(class_id, attendance_date);

alter table sign_in_closures enable row level security;
drop policy if exists "sign_in_closures_public_select" on sign_in_closures;
drop policy if exists "sign_in_closures_public_insert" on sign_in_closures;
drop policy if exists "sign_in_closures_public_update" on sign_in_closures;
drop policy if exists "sign_in_closures_public_delete" on sign_in_closures;
create policy "sign_in_closures_public_select" on sign_in_closures for select using (true);
create policy "sign_in_closures_public_insert" on sign_in_closures for insert with check (true);
create policy "sign_in_closures_public_update" on sign_in_closures for update using (true);
create policy "sign_in_closures_public_delete" on sign_in_closures for delete using (true);
