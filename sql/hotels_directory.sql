-- sql/hotels_directory.sql
--
-- The hotel directory Jen maintains. The /hotels screen has shipped against this
-- table for days, but the table was never created — so "Save" silently had
-- nowhere to write and she couldn't add a hotel at all (reported 2026-08-17).
--
-- Columns are exactly what Hotels.jsx reads and writes:
--   loadHotels()  → select * where active order by name
--   save()        → insert/update { name, street_address, city, state, zip,
--                                   phone, contact_name, contact_email, updated_at }
--   remove()      → update { active: false }   ← soft delete, so a hotel that's
--                   already on past bookings never disappears from history
--
-- contact_name / contact_email are the person Jen actually deals with at that
-- hotel — that's who the rooming-list email goes to.
--
-- RLS is ON with read+write for the app, same as the other office-facing tables
-- (/hotels sits behind the app's own login). Nothing here is personal data
-- beyond a business contact.

create table if not exists hotels (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  street_address text,
  city           text,
  state          text,
  zip            text,
  phone          text,
  contact_name   text,
  contact_email  text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

-- The screen lists active hotels by name; this keeps that ordering cheap.
create index if not exists hotels_active_name_idx on hotels (active, name);

alter table hotels enable row level security;

drop policy if exists hotels_rw on hotels;
create policy hotels_rw on hotels for all using (true) with check (true);

-- Verify — should return 0 rows and no error, then Jen can add the first one:
--   select id, name, city, contact_email from hotels order by name;
