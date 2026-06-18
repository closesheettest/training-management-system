-- Field Trainee chain — columns on trainees to track the per-person
-- provisioning sequence (homework → IT email → apps → instructions).
alter table trainees
  add column if not exists is_field_trainee            boolean not null default false,
  add column if not exists field_manager_id            uuid,
  add column if not exists field_homework_sent_at       timestamptz,
  add column if not exists field_email_provisioned_at   timestamptz,
  add column if not exists field_apps_done_at           timestamptz,
  add column if not exists field_instructions_sent_at   timestamptz;
