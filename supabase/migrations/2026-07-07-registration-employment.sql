-- Registration: capture the candidate's employment status.
-- Added to Register.jsx (the hiring-manager registration link):
--   • currently_employed — "Are you currently employed?"
--   • two_week_notice_date — if employed, the date they gave 2-week notice
--       (NULL when they haven't; that path rejects the registration instead)
--   • last_employed_date  — if not employed, when they were last employed
-- The "still employed, no notice given" rejection reuses the existing
-- decline flow (declined_at / declined_reason via decline-registration).

alter table trainees add column if not exists currently_employed boolean;
alter table trainees add column if not exists two_week_notice_date date;
alter table trainees add column if not exists last_employed_date date;
