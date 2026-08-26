-- One-time. Idempotency stamp for the Week A presentation-audio send, so a
-- re-fire (or the cron running twice) can never text a trainee the same 27
-- minutes of audio again.
alter table trainees add column if not exists presentation_sent_at timestamptz;
