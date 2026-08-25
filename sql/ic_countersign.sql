-- Company countersignature on the Independent Contractor Agreement.
-- RUN ON THE TMS DATABASE.
--
-- The agreement is between two parties and was only ever signed by one. The rep
-- signs, and the PDF was rendered there and then with the company's half of the
-- signature block blank — an agreement nobody at U.S. Shingle had executed
-- (Neal, 2026-08-24).
--
-- Now: rep signs → Jennifer is texted → she signs → THEN the PDF is created,
-- carrying both signatures.
alter table trainee_onboarding add column if not exists company_signature      text;
alter table trainee_onboarding add column if not exists company_sign_name      text;
alter table trainee_onboarding add column if not exists company_sign_title     text;
alter table trainee_onboarding add column if not exists company_signed_at      timestamptz;
alter table trainee_onboarding add column if not exists company_sign_ip        text;
-- The link texted to Jennifer. One per agreement, unguessable.
alter table trainee_onboarding add column if not exists countersign_token      uuid default gen_random_uuid();
alter table trainee_onboarding add column if not exists countersign_sent_at    timestamptz;

create index if not exists trainee_onboarding_countersign_token
  on trainee_onboarding (countersign_token);

-- BACKFILL. `default gen_random_uuid()` only fires for rows inserted AFTER the
-- column exists, so every agreement signed before this migration would come out
-- of it with a NULL token and stay unsignable. Monday's Week A class signed
-- while this file was still sitting unrun — they are exactly those rows.
update trainee_onboarding
   set countersign_token = gen_random_uuid()
 where countersign_token is null;

-- Anything already signed by a rep but not yet countersigned.
select trainee_id, sign_name, signed_at, company_signed_at
  from trainee_onboarding
 where signed_at is not null and company_signed_at is null;

-- Which signature style Jennifer picked (a typed font name, or 'drawn').
-- Part of the audit trail for how the signature was produced.
alter table trainee_onboarding add column if not exists company_sign_style text;

-- Initials on Exhibit A (the commission schedule). Optional: agreements signed
-- before this existed stay complete without it.
alter table trainee_onboarding add column if not exists agent_initials text;
