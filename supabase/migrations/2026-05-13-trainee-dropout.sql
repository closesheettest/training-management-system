-- Migration: dropout-notification dedup stamp on trainees.
--
-- When a provisioned trainee no-shows during their class week, a cron fires
-- two notifications (IT: delete email, HR: delete apps) and stamps this
-- column so the same trainee isn't reported on subsequent days.
-- Safe to re-run.

alter table trainees
  add column if not exists dropout_notified_at timestamptz;
