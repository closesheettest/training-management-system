-- Migration: new-rep welcome page + daily 7-day text-link drip.
--
-- After a trainee graduates, the system texts them a link to the
-- /welcome page every day for 7 days. The page collects the few links
-- they constantly forget where to find:
--   - Sales Rep Dashboard (Google Site)
--   - How-to videos (Google Drive folder)
--   - Sales meeting Zoom (daily 9:30 AM Mon-Thu)
--   - Prayer call Zoom (daily 9:15 AM Mon-Thu, voluntary)
--
-- Goal: cut down on the "where do I find X" phone calls during a rep's
-- first week. After a week of daily reminders they should know where to
-- go (or have the link saved in their texts).

create table if not exists welcome_resources (
  id uuid primary key default gen_random_uuid(),
  display_order int not null default 0,
  -- Unique so the seed insert below uses ON CONFLICT (label) DO NOTHING
  -- and doesn't double-add rows if the migration is run twice.
  label text not null unique,         -- "Sales Rep Dashboard"
  url text not null,
  description text,                   -- one-line context shown under the link
  -- Icon emoji to render on the card. Optional, just decorative.
  icon text,
  -- True when the URL requires the user to be signed in to Google with
  -- their company credentials. Surfaces an extra "make sure you're
  -- signed in" callout on the resource card.
  requires_google_signin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table welcome_resources enable row level security;
drop policy if exists "welcome_resources_public_select" on welcome_resources;
drop policy if exists "welcome_resources_public_insert" on welcome_resources;
drop policy if exists "welcome_resources_public_update" on welcome_resources;
drop policy if exists "welcome_resources_public_delete" on welcome_resources;
create policy "welcome_resources_public_select" on welcome_resources for select using (true);
create policy "welcome_resources_public_insert" on welcome_resources for insert with check (true);
create policy "welcome_resources_public_update" on welcome_resources for update using (true);
create policy "welcome_resources_public_delete" on welcome_resources for delete using (true);

-- Seed the four resources the user listed. Dollar-quoted strings to stay
-- paste-safe in the Supabase SQL editor regardless of apostrophes.
insert into welcome_resources (display_order, label, url, description, icon, requires_google_signin) values
  (
    10,
    $$Sales Rep Dashboard$$,
    $$https://sites.google.com/shingleusa.com/repdashboard/home?pli=1&authuser=0$$,
    $$Your home base — schedule, training links, company resources. Bookmark it.$$,
    $$📊$$,
    true
  ),
  (
    20,
    $$How-to Videos$$,
    $$https://drive.google.com/drive/folders/1aR1xVB-MkPHLhqBwFMj0KiYuvVPmrpb-$$,
    $$Step-by-step videos for everything from the apps to selling techniques.$$,
    $$🎥$$,
    true
  ),
  (
    30,
    $$Daily Sales Meeting$$,
    $$https://us05web.zoom.us/j/6369476417?pwd=Jl3bB9baW5d4WOOn6196rwdTE4SVDR.1$$,
    $$9:30 AM Eastern · Monday through Thursday. (After this first week, the link will live on your dashboard — try to remember where to find it.)$$,
    $$💼$$,
    false
  ),
  (
    40,
    $$Daily Prayer Call$$,
    $$https://us05web.zoom.us/j/6369476417?pwd=Jl3bB9baW5d4WOOn6196rwdTE4SVDR.1$$,
    $$9:15 AM Eastern · Monday through Thursday. Completely voluntary — join if you want, no expectation either way.$$,
    $$🙏$$,
    false
  )
on conflict (label) do nothing;

-- Tracking columns on trainees so the daily cron knows where each
-- person is in the 7-day sequence.
alter table trainees add column if not exists welcome_texts_sent int not null default 0;
alter table trainees add column if not exists last_welcome_text_at timestamptz;

-- Seed the SMS template that the cron renders + sends. Editable on the
-- /message-templates page.
insert into message_templates (key, label, description, body, placeholders) values
  (
    'welcome_drip',
    $label$Welcome — daily new-rep quick-links text$label$,
    $desc$Fires daily for 7 days after a trainee submits their final test. Links to /welcome (Sales Rep Dashboard, how-to videos, sales meeting Zoom, prayer call Zoom). Goal: cut down on "where do I find X" calls during the first week.$desc$,
    $body$Hi {firstName}, your quick-links page (sales dashboard, how-to videos, daily sales meeting, prayer call) — save this in your contacts: {link} (Day {dayNumber} of 7)$body$,
    array['firstName', 'link', 'dayNumber']
  )
on conflict (key) do nothing;
