-- Track when each trainee was sent the Day 1 onboarding link via SMS
-- so the kiosk-sign-in trigger only fires it once per trainee.
--
-- send-onboarding-sms.js (new in this same change) is no-op if this
-- column is already non-null. Kiosk.jsx fires the function fire-and-
-- forget after every sign-in so it doesn't matter if the trainee
-- signs in once or 50 times — the SMS goes out exactly once.

ALTER TABLE trainees ADD COLUMN IF NOT EXISTS onboarding_sms_sent_at timestamptz;

COMMENT ON COLUMN trainees.onboarding_sms_sent_at IS
  'When the Day 1 onboarding SMS (HomeMaxx funnel link) was sent. Stamped by send-onboarding-sms.js the first time the trainee signs in at the kiosk. NULL = never sent. Used to guard against double-firing.';
