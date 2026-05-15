-- Migration: auto-send a training itinerary email once a trainee is
-- registered AND their class has a location assigned.
--
-- Adds:
--   1. message_templates.subject column — emails need a subject line in
--      addition to a body. Existing rows (SMS templates) leave it null.
--   2. trainees.itinerary_email_sent_at — dedup stamp so the daily cron
--      doesn't re-send.
--   3. Seed row for the itinerary_email template with the wording from
--      the manual email HR has been sending, minus the iPad/shirts line.

alter table message_templates add column if not exists subject text;
alter table trainees add column if not exists itinerary_email_sent_at timestamptz;

-- Seed the itinerary template. Skipped via ON CONFLICT (key) DO NOTHING
-- so re-running the migration doesn't overwrite any edits the admin has
-- since made on the Message Templates page.
--
-- Dollar-quoted strings used for description + subject + body so the
-- multi-line body with apostrophes is paste-safe in the Supabase SQL
-- editor (no escaping needed).
insert into message_templates (key, label, description, subject, body, placeholders) values
  (
    'itinerary_email',
    'Training itinerary email',
    $desc$Auto-fires when a trainee is registered AND their class has a location assigned (no longer TBD). Daily 10 AM Eastern cron. Sent once per trainee.$desc$,
    $subj$Your training itinerary — Week of {weekDate} at {locationName}$subj$,
    $body$Hello {firstName},

We're excited to welcome you to U.S. Shingle & Metal and look forward to starting your Retail Sales training soon!

Our Retail Sales training program begins {weekDayWord} {weekDate}.

Please reply to this email to confirm your attendance for {weekDate}.

TRAINING SCHEDULE
{locationName}
{locationAddress}

{scheduleDetails}

ARRIVAL DETAILS
Plan to arrive 15 minutes early each day. Neal, the trainer, likes to keep a timely schedule.

If you're unable to attend for any reason, please respond to this email promptly so we can adjust arrangements, including hotel reservations if needed.

WHAT TO EXPECT
If traveling from more than 70 miles away, you'll receive hotel details on Monday during training.

We're thrilled to have you join the U.S. Shingle & Metal family and can't wait to see you in training!

--
{hiringManagerName}
{hiringManagerTitle}
U.S. Shingle and Metal
{hiringManagerPhone}$body$,
    array['firstName', 'locationName', 'locationAddress', 'weekDate', 'weekDayWord', 'scheduleDetails', 'hiringManagerName', 'hiringManagerTitle', 'hiringManagerPhone']
  )
on conflict (key) do nothing;
