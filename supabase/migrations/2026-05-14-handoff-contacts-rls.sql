-- Migration: open up RLS on trainee_handoff_contacts so the website can
-- read / insert / update / delete rows.
--
-- Matches the pattern other admin tables use (notification_recipients,
-- locations, classes, etc.) — RLS stays enabled at the table level, but
-- four permissive policies make the table fully public. The app has no
-- per-user auth; admin pages are gated by being unlinked from the public
-- nav of nealscoppettuolo.com (and by being behind the TMS Netlify site
-- which only Neal uses).

alter table trainee_handoff_contacts enable row level security;

drop policy if exists "trainee_handoff_contacts_public_select" on trainee_handoff_contacts;
drop policy if exists "trainee_handoff_contacts_public_insert" on trainee_handoff_contacts;
drop policy if exists "trainee_handoff_contacts_public_update" on trainee_handoff_contacts;
drop policy if exists "trainee_handoff_contacts_public_delete" on trainee_handoff_contacts;
create policy "trainee_handoff_contacts_public_select" on trainee_handoff_contacts for select using (true);
create policy "trainee_handoff_contacts_public_insert" on trainee_handoff_contacts for insert with check (true);
create policy "trainee_handoff_contacts_public_update" on trainee_handoff_contacts for update using (true);
create policy "trainee_handoff_contacts_public_delete" on trainee_handoff_contacts for delete using (true);
