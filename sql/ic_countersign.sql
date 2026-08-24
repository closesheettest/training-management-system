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

-- Anything already signed by a rep but not yet countersigned.
select trainee_id, sign_name, signed_at, company_signed_at
  from trainee_onboarding
 where signed_at is not null and company_signed_at is null;
