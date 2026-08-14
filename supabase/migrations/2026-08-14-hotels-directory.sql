-- Hotel directory — the list of hotels HR books rooms from. Jen maintains this
-- list once; the booking form then just picks a hotel from a dropdown (which
-- auto-fills address + phone + contact), instead of typing it every time.
--
-- Also adds hotel_contact_email to each booking so we know who at the hotel Jen
-- is dealing with — that's who the "email the rooming list" button writes to.
--
-- Safe to run more than once.

create table if not exists hotels (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  street_address    text,
  city              text,
  state             text,
  zip               text,
  phone             text,
  contact_name      text,          -- the person Jen usually talks to
  contact_email     text,          -- where the rooming list is emailed
  notes             text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

alter table hotels enable row level security;
drop policy if exists "hotels_public_select" on hotels;
drop policy if exists "hotels_public_insert" on hotels;
drop policy if exists "hotels_public_update" on hotels;
drop policy if exists "hotels_public_delete" on hotels;
create policy "hotels_public_select" on hotels for select using (true);
create policy "hotels_public_insert" on hotels for insert with check (true);
create policy "hotels_public_update" on hotels for update using (true);
create policy "hotels_public_delete" on hotels for delete using (true);

-- Who Jen is dealing with for THIS booking (defaults from the hotel's contact
-- when picked from the directory, but editable per booking).
alter table trainee_hotel_stays add column if not exists hotel_contact_email text;
