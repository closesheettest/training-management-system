-- Migration: editable SMS message templates + trainee decline + registration followup tracking.
--
-- Adds:
--   1. message_templates table — admin can edit the text of any of the
--      three registration texts (initial + 2 paced followups) from a UI.
--      Placeholders like {firstName} are substituted at send time.
--   2. trainees.declined_at / declined_reason — captured when the trainee
--      clicks "I can't attend" on the registration page. Also sets
--      enrolled=false so they drop off active lists.
--   3. trainees.registration_followup_1_sent_at / _2_sent_at — dedup
--      stamps for the daily cron that fires the two follow-up texts.

create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  -- Unique programmatic key — referenced from netlify functions.
  -- Don't rename existing keys; the functions look them up by this.
  key text unique not null,
  -- Human label shown on the message-templates admin page.
  label text not null,
  -- One-line explainer shown under the label on the admin page.
  description text,
  -- The actual text that gets sent. Placeholders in {curly} substituted
  -- at send time from a dictionary the calling function provides.
  body text not null,
  -- List of supported placeholder names for this template (e.g.
  -- 'firstName', 'locationName', 'weekDate', 'link'). Shown as a hint
  -- on the admin page so the user knows what they can use.
  placeholders text[],
  updated_at timestamptz not null default now()
);

-- Seed the three registration templates with the current hardcoded copy.
-- ON CONFLICT (key) DO NOTHING so re-running this migration is safe and
-- doesn't overwrite anything the admin has since edited.
insert into message_templates (key, label, description, body, placeholders) values
  (
    'registration_initial',
    'Registration — initial text',
    $desc$First text sent when HR clicks "Send" on the Class detail page. Goes to every trainee added to the class.$desc$,
    $body$Hi {firstName}, you're scheduled for training the week of {weekDate} at {locationName}. Please complete your registration here: {link}$body$,
    array['firstName', 'locationName', 'weekDate', 'link']
  ),
  (
    'registration_followup_1',
    'Registration — follow-up #1',
    $desc$Auto-fires 24 hours after the initial text if the trainee hasn't registered yet. Daily 10 AM Eastern cron.$desc$,
    $body$Hi {firstName}, quick reminder — please finish your training registration so we can confirm your spot for the week of {weekDate}: {link}$body$,
    array['firstName', 'locationName', 'weekDate', 'link']
  ),
  (
    'registration_followup_2',
    'Registration — follow-up #2 (final)',
    $desc$Auto-fires 48 hours after follow-up #1 if still not registered AND class is within 7 days. This is the last text — no more after this.$desc$,
    $body$Hi {firstName}, final reminder — we need to confirm your spot for training the week of {weekDate}. Please register here today: {link}. If you can't attend, please text back so we can give your spot to someone else.$body$,
    array['firstName', 'locationName', 'weekDate', 'link']
  )
on conflict (key) do nothing;

-- Open RLS so the admin UI can read/write templates.
alter table message_templates enable row level security;
drop policy if exists "message_templates_public_select" on message_templates;
drop policy if exists "message_templates_public_insert" on message_templates;
drop policy if exists "message_templates_public_update" on message_templates;
drop policy if exists "message_templates_public_delete" on message_templates;
create policy "message_templates_public_select" on message_templates for select using (true);
create policy "message_templates_public_insert" on message_templates for insert with check (true);
create policy "message_templates_public_update" on message_templates for update using (true);
create policy "message_templates_public_delete" on message_templates for delete using (true);

-- Trainee columns
alter table trainees add column if not exists declined_at timestamptz;
alter table trainees add column if not exists declined_reason text;
alter table trainees add column if not exists registration_followup_1_sent_at timestamptz;
alter table trainees add column if not exists registration_followup_2_sent_at timestamptz;

-- Index for the daily followups cron — narrows the candidate set fast.
create index if not exists trainees_followup_candidates_idx
  on trainees(registered, enrolled, declined_at, last_sms_sent_at);
