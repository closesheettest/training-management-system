-- Migration: scope the Personas page to admin + HR only.
--
-- Originally Personas was in the ALWAYS_VISIBLE set hardcoded in
-- src/lib/personas.js — every role saw it regardless of config. Per
-- user feedback that's wrong: it should be admin + HR only. Admin
-- already has the '*' wildcard so they're covered automatically.
-- HR needs explicit access added to their visible_page_keys.

-- For HR: if their current array doesn't already contain
-- 'settings.personas' AND doesn't contain the '*' wildcard, append
-- 'settings.personas' to the list.
update role_settings
set visible_page_keys = visible_page_keys || array['settings.personas'],
    updated_at = now()
where role = 'hr'
  and not (visible_page_keys @> array['settings.personas'])
  and not (visible_page_keys @> array['*']);
