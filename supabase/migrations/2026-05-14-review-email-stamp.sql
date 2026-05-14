-- Migration: dedup stamp for the post-test review-request email.
--
-- Set when the system emails a trainee asking them to leave a Google / Yelp
-- review. Keeps the system from re-sending if they re-load TestDone or
-- somehow re-submit. Safe to re-run.

alter table trainees
  add column if not exists review_email_sent_at timestamptz;
