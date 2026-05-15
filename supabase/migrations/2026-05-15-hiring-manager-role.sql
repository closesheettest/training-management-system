-- Migration: allow 'hiring_manager' as a notification_recipients.role value.
--
-- The original table had a CHECK constraint with a fixed list of roles:
-- ('admin', 'it', 'hr', 'trainer', 'va', 'test', 'custom'). The hiring
-- manager is referenced by the itinerary email function and the persona-
-- based nav filter, so we need it in the allowed list. Drop + recreate
-- the constraint to add it.

alter table notification_recipients drop constraint if exists notification_recipients_role_check;
alter table notification_recipients
  add constraint notification_recipients_role_check
  check (role in ('admin', 'hiring_manager', 'it', 'hr', 'trainer', 'va', 'test', 'custom'));
