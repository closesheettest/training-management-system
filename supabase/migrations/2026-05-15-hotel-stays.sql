-- Migration: per-trainee hotel stays for the Day-1 "here's your room" text.
--
-- Some trainees (70+ miles from training) get a hotel room booked by HR.
-- This table captures the room details so HR can text each trainee their
-- specific room info (separate from the meeting-venue address that already
-- lives on the location record — sometimes the sleeping hotel and the
-- meeting hotel are the same, sometimes different).
--
-- One row per (trainee, class). Once info_sent_at is stamped, the trainee
-- has received the text. HR can re-send manually from the Hotels page if
-- details change.

create table if not exists trainee_hotel_stays (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references trainees(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  -- Hotel details
  hotel_name text not null,
  hotel_street_address text,
  hotel_city text,
  hotel_state text,
  hotel_zip text,
  hotel_phone text,
  -- Reservation details
  check_in_date date,
  check_out_date date,
  confirmation_number text,
  -- Whose name is the room under? Defaults to the trainee but HR sometimes
  -- books under the company's name or someone else's.
  guest_name text,
  room_number text,
  -- Free-text for anything special (parking instructions, breakfast hours,
  -- special requests, etc.)
  notes text,
  -- Stamped when the trainee actually got the SMS. Re-sending updates this.
  info_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A trainee can only have one hotel stay per class week.
  unique (trainee_id, class_id)
);

-- Open RLS the same way the rest of the admin tables work.
alter table trainee_hotel_stays enable row level security;
drop policy if exists "trainee_hotel_stays_public_select" on trainee_hotel_stays;
drop policy if exists "trainee_hotel_stays_public_insert" on trainee_hotel_stays;
drop policy if exists "trainee_hotel_stays_public_update" on trainee_hotel_stays;
drop policy if exists "trainee_hotel_stays_public_delete" on trainee_hotel_stays;
create policy "trainee_hotel_stays_public_select" on trainee_hotel_stays for select using (true);
create policy "trainee_hotel_stays_public_insert" on trainee_hotel_stays for insert with check (true);
create policy "trainee_hotel_stays_public_update" on trainee_hotel_stays for update using (true);
create policy "trainee_hotel_stays_public_delete" on trainee_hotel_stays for delete using (true);

-- Fast lookup for the Hotels page (list stays for a class).
create index if not exists trainee_hotel_stays_class_idx
  on trainee_hotel_stays(class_id);

-- Seed the SMS template. Body wraps a {hotelDetails} placeholder that the
-- function assembles dynamically — that way missing fields (e.g. trainee
-- didn't get a confirmation number yet) just don't show up in the text,
-- instead of leaving blank lines.
--
-- Dollar-quoted strings ($label$...$label$) used here so apostrophes and
-- newlines in the body don't need escaping — paste-safe in the Supabase
-- SQL editor.
insert into message_templates (key, label, description, body, placeholders) values
  (
    'hotel_room_info',
    $label$Hotel room info — sent to each trainee with a room booked$label$,
    $desc$Fired from the Hotels page when HR clicks "Send info". One text per trainee with a hotel stay. The {hotelDetails} placeholder is built dynamically by the function — only filled-in fields appear in the text, so a missing confirmation number doesn't leave a blank line.$desc$,
    $body$Hi {firstName}, here's your hotel info for training week of {weekDate}:

{hotelDetails}

Reply to this text if anything looks wrong. — U.S. Shingle Training$body$,
    array['firstName', 'weekDate', 'hotelDetails']
  )
on conflict (key) do nothing;
