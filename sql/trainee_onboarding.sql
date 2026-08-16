-- sql/trainee_onboarding.sql
--
-- Day-1 paperwork: the W-9 and the Independent Contractor Agreement (+ Exhibit A)
-- that every rep signs when they check in. Replaces the HomeMaxx funnel link the
-- kiosk used to text out.
--
-- Flow: kiosk sign-in → text + email a link → they fill the W-9 and e-sign the
-- agreement → we render both PDFs, store them privately, and email the rep and
-- Jenn a copy. Class doesn't start until the roster shows everyone done.
--
-- Run this in the TMS Supabase SQL editor.

-- ── the signed paperwork, one row per trainee ────────────────────────────────
create table if not exists trainee_onboarding (
  trainee_id            uuid primary key references trainees(id) on delete cascade,
  class_id              uuid references classes(id) on delete set null,

  -- W-9 (IRS Form W-9 fields — filled onto the official template)
  w9_name               text,
  w9_business_name      text,
  w9_tax_classification text,          -- individual | c_corp | s_corp | partnership | trust | llc | other
  w9_llc_class          text,          -- C / S / P when tax_classification = llc
  w9_address            text,
  w9_city_state_zip     text,
  w9_tin_type           text,          -- ssn | ein
  w9_tin                text,          -- SENSITIVE. Never expose via the anon key.

  -- Personal (the old HomeMaxx funnel's "Confidential Independent Contractor
  -- Information" — everything it collected now lives here)
  first_name            text,
  last_name             text,
  preferred_name        text,
  shirt_size            text,
  emergency_name        text,
  emergency_phone       text,

  -- LLC (optional — most reps sign as an individual)
  business_name         text,
  business_ein          text,
  business_address      text,

  -- Direct deposit. DELIBERATELY NOT part of the "can class start?" gate:
  -- people routinely turn up without their bank details and Neal doesn't hold
  -- the class for it. Left blank, a daily text + email chases them until it's
  -- filled (see cron-onboarding-banking-reminder).
  bank_name             text,
  bank_account_name     text,
  bank_routing          text,
  bank_wire_routing     text,
  bank_account_number   text,
  banking_completed_at  timestamptz,
  banking_reminded_at   timestamptz,
  banking_reminders_sent int not null default 0,

  -- Independent Contractor Agreement + Exhibit A
  agent_legal_name      text,          -- the "(AGENT)" blank on page 1
  agent_address         text,
  agent_email           text,
  agent_phone           text,
  agent_dob             date,
  sign_name             text,          -- printed name
  sign_title            text,
  signature             text,          -- drawn signature, data URL — kept so the
                                       -- PDF can be REGENERATED if it's ever lost
  signed_at             timestamptz,
  sign_ip               text,

  -- rendered documents (private bucket 'trainee-docs')
  w9_pdf_path           text,
  agreement_pdf_path    text,
  pdf_error             text,          -- non-null = submission saved but a PDF failed

  emailed_rep_at        timestamptz,
  emailed_office_at     timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists trainee_onboarding_class_idx on trainee_onboarding (class_id);
create index if not exists trainee_onboarding_signed_idx on trainee_onboarding (signed_at);
-- the daily banking chase reads this
create index if not exists trainee_onboarding_banking_idx
  on trainee_onboarding (banking_completed_at) where banking_completed_at is null;

-- ── lock it down ─────────────────────────────────────────────────────────────
-- This table holds SSNs AND bank account numbers. The browser never reads it directly: the signing page
-- and the roster both go through trainee-onboarding-api, which uses the service
-- key. RLS on with NO policies = the anon key can't touch it at all.
alter table trainee_onboarding enable row level security;

-- ── the documents bucket (PRIVATE) ───────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('trainee-docs', 'trainee-docs', false)
on conflict (id) do update set public = false;

-- ── the on-check-in link ─────────────────────────────────────────────────────
-- Reuses the trainee's existing registration_token, so there's no new secret to
-- mint or leak; the signing page resolves it server-side.
comment on table trainee_onboarding is
  'Day-1 W-9 + Independent Contractor Agreement + direct deposit. RLS on, no policies: service key only (holds SSNs and bank account numbers). Banking is optional at signing time and chased daily until filled.';
