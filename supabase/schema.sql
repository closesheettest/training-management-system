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
  region text not null,
  street_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  phone text not null,
  contact_info text,
  schedule_template text,
  -- Public Supabase Storage URLs for photos of this venue. Used by auto-posting.
  photo_urls text[] not null default '{}',
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

-- Migration: add phone column, drop parking_info (no longer used)
alter table locations add column if not exists phone text;
alter table locations drop column if exists parking_info;

-- Migration: add region column (FL training area: St Pete, Jacksonville, Orlando, Miami)
-- Nullable on upgrade so existing rows aren't blocked; app enforces required.
alter table locations add column if not exists region text;
create index if not exists locations_region_idx on locations(region);

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  location_id uuid references locations(id) on delete restrict,
  week_start_date date not null,
  week_end_date date not null,
  schedule_details text,
  status text not null default 'upcoming',
  -- Workflow timestamps for the day-2 provisioning flow.
  day_2_it_notified_at timestamptz, -- when IT was texted to start provisioning
  it_completed_at timestamptz,      -- when IT clicked "Mark provisioning complete"
  -- End-of-week graduation report dedup (one email per class, ever).
  graduation_report_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Migration: ensure region column exists on classes (nullable on upgrade; app enforces required)
alter table classes add column if not exists region text;

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

-- Migration: track when the last registration SMS was sent (for "sent / no response" status)
alter table trainees add column if not exists last_sms_sent_at timestamptz;

-- Migration: track when the 24hr confirmation reminder was last sent (Phase 4)
alter table trainees add column if not exists last_reminder_sent_at timestamptz;

-- Migration: trainee response to the confirmation link in the 24hr reminder.
-- confirmation_status: null (no response), 'confirmed' (tapped Yes), 'declined' (tapped No)
alter table trainees add column if not exists confirmation_status text;
alter table trainees add column if not exists confirmation_at timestamptz;

-- Migration: per-trainee flag for whether they need hotel accommodation
-- (out-of-town trainees need lodging; local hires don't).
alter table trainees add column if not exists needs_hotel boolean not null default false;

-- Migration: timestamp the most recent 10:30 AM hotel-no-show alert about this
-- trainee (so we don't double-alert on the same day if cron fires twice).
alter table trainees add column if not exists hotel_alert_sent_at timestamptz;

-- Migration: Day-2 company email provisioning.
-- IT enters the email + initial password; trainee sees them on /credentials/:token
-- and follows phone setup instructions.
alter table trainees add column if not exists company_email text;
alter table trainees add column if not exists company_email_password text;
alter table trainees add column if not exists email_assigned_at timestamptz;
alter table trainees add column if not exists credentials_sent_at timestamptz;
alter table trainees add column if not exists credentials_viewed_at timestamptz;

-- Per-platform VA setup tracking. Stamps the time the VA marked each
-- platform set up for the trainee; NULL = not done yet.
alter table trainees add column if not exists repcard_setup_at timestamptz;
alter table trainees add column if not exists jobnimbus_setup_at timestamptz;
alter table trainees add column if not exists sales_academy_setup_at timestamptz;

-- Dropout-notification dedup. Stamped by the daily dropout cron when a
-- provisioned trainee no-shows for the first time during their class week.
alter table trainees add column if not exists dropout_notified_at timestamptz;

-- Post-test review-request email dedup. Stamped after we email the trainee
-- their Google + Yelp review links so they don't get the email twice.
alter table trainees add column if not exists review_email_sent_at timestamptz;

-- ============================================================
-- SOCIAL POST QUEUE — paced Facebook + LinkedIn auto-posts
-- ============================================================
create table if not exists social_post_queue (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  trainee_id uuid references trainees(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'linkedin')),
  message text not null,
  photo_url text,
  scheduled_post_at timestamptz not null,
  posted_at timestamptz,
  post_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists social_post_queue_pending_idx
  on social_post_queue(platform, scheduled_post_at)
  where posted_at is null;

-- ============================================================
-- TRAINEE HANDOFF CONTACTS — vCard data for end-of-test text
-- ============================================================
create table if not exists trainee_handoff_contacts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  title text,
  organization text,
  phone text,
  email text,
  region text,
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trainee_handoff_contacts_active_region_idx
  on trainee_handoff_contacts(region)
  where active = true;
alter table trainees add column if not exists handoff_contacts_sent_at timestamptz;

alter table trainee_handoff_contacts enable row level security;
drop policy if exists "trainee_handoff_contacts_public_select" on trainee_handoff_contacts;
drop policy if exists "trainee_handoff_contacts_public_insert" on trainee_handoff_contacts;
drop policy if exists "trainee_handoff_contacts_public_update" on trainee_handoff_contacts;
drop policy if exists "trainee_handoff_contacts_public_delete" on trainee_handoff_contacts;
create policy "trainee_handoff_contacts_public_select" on trainee_handoff_contacts for select using (true);
create policy "trainee_handoff_contacts_public_insert" on trainee_handoff_contacts for insert with check (true);
create policy "trainee_handoff_contacts_public_update" on trainee_handoff_contacts for update using (true);
create policy "trainee_handoff_contacts_public_delete" on trainee_handoff_contacts for delete using (true);

-- ============================================================
-- MESSAGE TEMPLATES — editable SMS body templates
-- ============================================================
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  description text,
  subject text,                       -- optional; used for email templates only
  body text not null,
  placeholders text[],
  updated_at timestamptz not null default now()
);
alter table message_templates enable row level security;
drop policy if exists "message_templates_public_select" on message_templates;
drop policy if exists "message_templates_public_insert" on message_templates;
drop policy if exists "message_templates_public_update" on message_templates;
drop policy if exists "message_templates_public_delete" on message_templates;
create policy "message_templates_public_select" on message_templates for select using (true);
create policy "message_templates_public_insert" on message_templates for insert with check (true);
create policy "message_templates_public_update" on message_templates for update using (true);
create policy "message_templates_public_delete" on message_templates for delete using (true);

alter table trainees add column if not exists declined_at timestamptz;
alter table trainees add column if not exists declined_reason text;
alter table trainees add column if not exists registration_followup_1_sent_at timestamptz;
alter table trainees add column if not exists registration_followup_2_sent_at timestamptz;
alter table trainees add column if not exists itinerary_email_sent_at timestamptz;

-- ============================================================
-- TRAINEE HOTEL STAYS — per-trainee room info for Day-1 text
-- ============================================================
create table if not exists trainee_hotel_stays (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references trainees(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  hotel_name text not null,
  hotel_street_address text,
  hotel_city text,
  hotel_state text,
  hotel_zip text,
  hotel_phone text,
  check_in_date date,
  check_out_date date,
  confirmation_number text,
  guest_name text,
  room_number text,
  notes text,
  info_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainee_id, class_id)
);
alter table trainee_hotel_stays enable row level security;
drop policy if exists "trainee_hotel_stays_public_select" on trainee_hotel_stays;
drop policy if exists "trainee_hotel_stays_public_insert" on trainee_hotel_stays;
drop policy if exists "trainee_hotel_stays_public_update" on trainee_hotel_stays;
drop policy if exists "trainee_hotel_stays_public_delete" on trainee_hotel_stays;
create policy "trainee_hotel_stays_public_select" on trainee_hotel_stays for select using (true);
create policy "trainee_hotel_stays_public_insert" on trainee_hotel_stays for insert with check (true);
create policy "trainee_hotel_stays_public_update" on trainee_hotel_stays for update using (true);
create policy "trainee_hotel_stays_public_delete" on trainee_hotel_stays for delete using (true);
create index if not exists trainee_hotel_stays_class_idx
  on trainee_hotel_stays(class_id);

-- ============================================================
-- WELCOME RESOURCES — links on the /welcome page
-- ============================================================
create table if not exists welcome_resources (
  id uuid primary key default gen_random_uuid(),
  display_order int not null default 0,
  label text not null,
  url text not null,
  description text,
  icon text,
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
alter table trainees add column if not exists welcome_texts_sent int not null default 0;
alter table trainees add column if not exists last_welcome_text_at timestamptz;

-- ============================================================
-- ROLE SETTINGS — persona-based nav filtering (UX, not auth)
-- ============================================================
create table if not exists role_settings (
  role text primary key,
  visible_page_keys text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table role_settings enable row level security;
drop policy if exists "role_settings_public_select" on role_settings;
drop policy if exists "role_settings_public_insert" on role_settings;
drop policy if exists "role_settings_public_update" on role_settings;
drop policy if exists "role_settings_public_delete" on role_settings;
create policy "role_settings_public_select" on role_settings for select using (true);
create policy "role_settings_public_insert" on role_settings for insert with check (true);
create policy "role_settings_public_update" on role_settings for update using (true);
create policy "role_settings_public_delete" on role_settings for delete using (true);
create index if not exists trainees_followup_candidates_idx
  on trainees(registered, enrolled, declined_at, last_sms_sent_at);

-- Migration: enrollment status. Trainer can unenroll trainees on day 2
-- if they don't pass the early assessment. Unenrolled trainees don't appear
-- on the provisioning roster and don't get further SMS.
alter table trainees add column if not exists enrolled boolean not null default true;
alter table trainees add column if not exists unenrolled_at timestamptz;
alter table trainees add column if not exists unenrolled_reason text;

-- Migration: years in sales tag, shown on website testimonials.
-- Values match the buckets used in the registration form / testimonial display:
-- 'New to sales', '1-4 yrs', '5-9 yrs', '10-19 yrs', '20+ yrs'
alter table trainees add column if not exists years_in_sales text;

-- ============================================================
-- NOTIFICATION RECIPIENTS — who gets SMS/email when training events fire.
-- ============================================================
-- Replaces hard-coded ADMIN_PHONE env var with a manageable list.
-- Each recipient has a role; functions look up recipients by role.
-- env var ADMIN_PHONE is still respected as a fallback when no DB
-- recipients with role='admin' exist (so nothing breaks on first deploy).

create table if not exists notification_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('admin', 'hiring_manager', 'it', 'hr', 'trainer', 'va', 'test', 'custom')),
  phone text,
  email text,
  active boolean not null default true,
  notes text,
  -- Per-event subscriptions: list of event keys this recipient is opted in to.
  -- The role is informational/organizational; subscriptions drive who gets which SMS.
  subscribed_events text[] not null default '{}',
  -- Per-recipient channel preferences. A channel only fires if both the
  -- toggle is true and the corresponding contact info (phone/email) is set.
  notify_via_sms boolean not null default true,
  notify_via_email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_recipients_role_active_idx
  on notification_recipients(role, active);

alter table notification_recipients enable row level security;
drop policy if exists "notification_recipients_public_select" on notification_recipients;
drop policy if exists "notification_recipients_public_insert" on notification_recipients;
drop policy if exists "notification_recipients_public_update" on notification_recipients;
drop policy if exists "notification_recipients_public_delete" on notification_recipients;
create policy "notification_recipients_public_select" on notification_recipients for select using (true);
create policy "notification_recipients_public_insert" on notification_recipients for insert with check (true);
create policy "notification_recipients_public_update" on notification_recipients for update using (true);
create policy "notification_recipients_public_delete" on notification_recipients for delete using (true);

-- ============================================================
-- TEST / QUIZ TABLES (end-of-training assessment)
-- ============================================================

-- Question bank — global, all classes use the active set
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  question_type text not null check (question_type in ('multiple_choice', 'essay')),
  choices jsonb,                 -- ['option a', 'option b', ...] for multiple_choice
  correct_choice text,           -- the correct value (matches one of `choices`) for multiple_choice
  use_for_testimonial boolean not null default false,  -- essay-only: surface on /testimonials and website JSON feed (Neal's brand — generic copy)
  use_for_client_review boolean not null default false, -- essay-only: surface in Google/Yelp review email copy-paste (client's business reviews — client-specific copy welcome)
  order_index integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One attempt per trainee per class (uniqueness enforced)
create table if not exists test_attempts (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references trainees(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  correct_count integer,
  total_mc integer,
  retention_pct numeric,
  unique (trainee_id, class_id)
);

-- One row per question per attempt. Snapshots the question prompt/type/
-- use_for_testimonial flag at submission so later edits to the question bank
-- don't change historical testimonials.
create table if not exists test_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references test_attempts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete restrict,
  question_prompt text not null,
  question_type text not null,
  selected_choice text,
  is_correct boolean,
  essay_response text,
  use_for_testimonial boolean not null default false,
  use_for_client_review boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists questions_active_order_idx on questions(active, order_index);
create index if not exists test_attempts_class_idx on test_attempts(class_id);
create index if not exists test_responses_attempt_idx on test_responses(attempt_id);
create index if not exists test_responses_question_idx on test_responses(question_id);

-- RLS
alter table questions enable row level security;
alter table test_attempts enable row level security;
alter table test_responses enable row level security;

drop policy if exists "questions_public_select" on questions;
drop policy if exists "questions_public_insert" on questions;
drop policy if exists "questions_public_update" on questions;
drop policy if exists "questions_public_delete" on questions;
create policy "questions_public_select" on questions for select using (true);
create policy "questions_public_insert" on questions for insert with check (true);
create policy "questions_public_update" on questions for update using (true);
create policy "questions_public_delete" on questions for delete using (true);

drop policy if exists "test_attempts_public_select" on test_attempts;
drop policy if exists "test_attempts_public_insert" on test_attempts;
drop policy if exists "test_attempts_public_update" on test_attempts;
drop policy if exists "test_attempts_public_delete" on test_attempts;
create policy "test_attempts_public_select" on test_attempts for select using (true);
create policy "test_attempts_public_insert" on test_attempts for insert with check (true);
create policy "test_attempts_public_update" on test_attempts for update using (true);
create policy "test_attempts_public_delete" on test_attempts for delete using (true);

drop policy if exists "test_responses_public_select" on test_responses;
drop policy if exists "test_responses_public_insert" on test_responses;
drop policy if exists "test_responses_public_update" on test_responses;
drop policy if exists "test_responses_public_delete" on test_responses;
create policy "test_responses_public_select" on test_responses for select using (true);
create policy "test_responses_public_insert" on test_responses for insert with check (true);
create policy "test_responses_public_update" on test_responses for update using (true);
create policy "test_responses_public_delete" on test_responses for delete using (true);

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
