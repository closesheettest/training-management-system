-- Migration: per-event notification subscriptions on notification_recipients.
--
-- Adds two new roles ('trainer' and 'va') and a subscribed_events array column,
-- so each recipient can opt in to specific automated SMS events rather than
-- being routed purely by their role.
--
-- Safe to re-run: every step is idempotent.

-- 1. Extend the role check constraint to include 'trainer' and 'va'.
alter table notification_recipients
  drop constraint if exists notification_recipients_role_check;
alter table notification_recipients
  add constraint notification_recipients_role_check
  check (role in ('admin', 'it', 'hr', 'trainer', 'va', 'test', 'custom'));

-- 2. Add the subscribed_events column (Postgres text array, empty by default).
alter table notification_recipients
  add column if not exists subscribed_events text[] not null default '{}';

-- 3. Backfill existing recipients so today's behavior continues unchanged:
--    - admins keep getting the day-2 provisioning notification
--    - hr recipients keep getting the hotel no-show alert
update notification_recipients
   set subscribed_events = array_append(subscribed_events, 'day_2_provision_complete')
 where role = 'admin'
   and not (subscribed_events @> array['day_2_provision_complete']);

update notification_recipients
   set subscribed_events = array_append(subscribed_events, 'hotel_noshow_alert')
 where role = 'hr'
   and not (subscribed_events @> array['hotel_noshow_alert']);
