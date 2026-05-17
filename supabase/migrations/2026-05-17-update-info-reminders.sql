-- Migration: track automated "update your info" reminder SMS.
--
-- The send-update-info-reminders cron fires hourly and texts active
-- reps who still have info_updated_at = null. Two columns track when
-- we last bugged each rep and how many times total, so the cron can:
--   - Skip reps texted within the last UPDATE_REMINDER_INTERVAL_HOURS
--   - Give up entirely after UPDATE_REMINDER_MAX_ATTEMPTS reminders
--     (defensive — don't nag forever, save SMS quota + protect carrier
--     reputation)
--
-- last_update_reminder_sent_at — timestamp of most recent reminder
-- update_reminder_count        — total reminders sent (defaults to 0;
--                                 once it hits MAX_ATTEMPTS the rep is
--                                 quietly dropped from the cron)

alter table trainees add column if not exists last_update_reminder_sent_at timestamptz;
alter table trainees add column if not exists update_reminder_count int not null default 0;

-- Partial index to make the cron's "due-for-a-reminder" query cheap:
-- the only rows worth scanning are active reps who haven't updated.
create index if not exists trainees_reminder_due_idx
  on trainees(last_update_reminder_sent_at)
  where is_active_sales_rep = true and info_updated_at is null;
