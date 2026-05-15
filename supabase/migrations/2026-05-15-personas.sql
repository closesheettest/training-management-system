-- Migration: persona-based nav filtering.
--
-- This is UX personalization, NOT auth. Anyone with the URL can still
-- type /notifications or /attendance and load the page. The role-page
-- visibility config just decides which nav items show up by default
-- when a person picks their name on the landing splash.
--
-- One row per role. visible_page_keys is the opt-in list of pages they
-- see in their nav. Admin gets a special "all" sentinel — admins
-- always see every page including ones added in future releases
-- without needing a config update.

create table if not exists role_settings (
  role text primary key,
  visible_page_keys text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Seeds — sensible defaults per role. The Personas admin page lets the
-- user override any of these later.
insert into role_settings (role, visible_page_keys) values
  ('admin',         array['*']),
  ('hiring_manager', array['home', 'schedule', 'setup.manager', 'setup.hotels', 'settings.overview']),
  ('it',            array['home', 'provisioning', 'settings.overview']),
  ('hr',            array['home', 'schedule', 'setup.hotels', 'settings.notifications', 'settings.overview']),
  ('va',            array['home', 'settings.overview']),
  ('trainer',       array['home', 'schedule', 'attendance', 'setup.questions', 'settings.messages', 'settings.overview']),
  ('test',          array['*']),
  ('custom',        array['home', 'settings.overview'])
on conflict (role) do nothing;

-- Open RLS to match the rest of the admin tables in this app.
alter table role_settings enable row level security;
drop policy if exists "role_settings_public_select" on role_settings;
drop policy if exists "role_settings_public_insert" on role_settings;
drop policy if exists "role_settings_public_update" on role_settings;
drop policy if exists "role_settings_public_delete" on role_settings;
create policy "role_settings_public_select" on role_settings for select using (true);
create policy "role_settings_public_insert" on role_settings for insert with check (true);
create policy "role_settings_public_update" on role_settings for update using (true);
create policy "role_settings_public_delete" on role_settings for delete using (true);
