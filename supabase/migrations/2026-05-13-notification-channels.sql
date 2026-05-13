-- Migration: per-recipient channel preferences (text / email / both).
--
-- Each recipient can opt in to SMS, email, or both. A channel only fires if
--   (a) the recipient has the corresponding contact info (phone or email), AND
--   (b) the corresponding toggle is true.
--
-- Defaults to "both on" so existing recipients keep getting their texts.
-- Safe to re-run.

alter table notification_recipients
  add column if not exists notify_via_sms boolean not null default true;

alter table notification_recipients
  add column if not exists notify_via_email boolean not null default true;
