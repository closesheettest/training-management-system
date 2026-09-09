-- sql/comp_agreements.sql
--
-- The Draw Program + Inspection Compensation Plan signing. Run once in the TMS
-- SQL editor.
--
-- These live on trainee_onboarding, NOT a new table, because that row is already
-- "the documents this person has signed" — the IC Agreement and W-9 are there.
-- A second table would mean the office has two places to look for whether
-- someone is papered up, which is how you end up not knowing.
--
-- TWO signatures, not one (Neal, 2026-09-09). The Draw Program is money we
-- advance and they repay; the Compensation Plan is how they get paid. One
-- signature under a combined page leaves it arguable which they agreed to, so
-- each document carries its own name, drawn signature and timestamp.

alter table trainee_onboarding add column if not exists comp_draw_sign_name   text;
alter table trainee_onboarding add column if not exists comp_draw_signed_at   timestamptz;
alter table trainee_onboarding add column if not exists comp_draw_signature   text;   -- data: URL, so the PDF can be re-rendered

alter table trainee_onboarding add column if not exists comp_plan_sign_name   text;
alter table trainee_onboarding add column if not exists comp_plan_signed_at   timestamptz;
alter table trainee_onboarding add column if not exists comp_plan_signature   text;

-- Captured once, at submit — both signatures happen in one session.
alter table trainee_onboarding add column if not exists comp_signed_at        timestamptz;
alter table trainee_onboarding add column if not exists comp_sign_ip          text;
alter table trainee_onboarding add column if not exists comp_agreement_pdf_path text;  -- private trainee-docs bucket
alter table trainee_onboarding add column if not exists comp_pdf_error        text;
alter table trainee_onboarding add column if not exists comp_opened_at        timestamptz;

-- "Who still hasn't signed" is the question this gets asked, constantly, while
-- chasing a company-wide send. Partial so it stays small as people sign.
create index if not exists trainee_onboarding_comp_unsigned_idx
  on trainee_onboarding (trainee_id)
  where comp_signed_at is null;

create index if not exists trainee_onboarding_comp_signed_idx
  on trainee_onboarding (comp_signed_at desc)
  where comp_signed_at is not null;
