-- Migration: handoff contacts for trainees.
--
-- After a trainee submits their final test, the system texts them a link
-- to a vCard containing their go-to people at the company — sales manager,
-- support helpline, etc. Stored as rows in this table so admins can edit
-- names/phones/emails from the website without touching env vars or code.
--
-- Region routing:
--   - region IS NULL  → contact applies to every trainee (universal — use
--     for the helpline, customer service, anything everyone needs)
--   - region IS SET   → only trainees whose class.region matches get this
--     contact (use for regional sales managers)

create table if not exists trainee_handoff_contacts (
  id uuid primary key default gen_random_uuid(),
  -- Display fields
  display_name text not null,        -- "Joe Bloggs" or "U.S. Shingle Helpline"
  title text,                         -- "Sales Manager"
  organization text,                  -- "U.S. Shingle & Metal"
  phone text,
  email text,
  -- NULL = every trainee gets this contact. Set = only matching class.region.
  region text,
  -- Manual disable without deleting the row.
  active boolean not null default true,
  -- Lower numbers appear first on the page and in the vCard.
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Most lookups filter on (active, region) — partial index keeps the read fast.
create index if not exists trainee_handoff_contacts_active_region_idx
  on trainee_handoff_contacts(region)
  where active = true;

-- Dedup stamp on trainees so the post-test "save your team contacts" SMS
-- fires once per trainee even if they re-submit the test.
alter table trainees add column if not exists handoff_contacts_sent_at timestamptz;
