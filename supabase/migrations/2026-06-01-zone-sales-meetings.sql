-- Migration: split the single "Daily Sales Meeting" welcome resource
-- into one card per Zone, since each Zone runs its own meeting under
-- its own regional manager now.
--
-- Schedule stays the same across all four (same sales training time).
-- Zone 4 ships with Sam's link populated; Zones 1-3 launch as
-- "Coming soon" — when each manager sends Neal their Zoom URL, admin
-- updates the row on /welcome-links.
--
-- Two structural pieces:
--   1. Allow welcome_resources.url to be NULL. The Welcome page already
--      treated empty URLs as a "no clickable link" case in the upcoming
--      render update; the schema needs to let that state exist.
--   2. Delete the old generic "Daily Sales Meeting" row and seed four
--      zone-specific rows in its place. display_order 30/31/32/33 to
--      keep the row Block right where it lived before (after How-to
--      Videos at 20, before Daily Prayer Call at 40).

ALTER TABLE welcome_resources ALTER COLUMN url DROP NOT NULL;

-- Drop the legacy single row. Safe even if it doesn't exist.
DELETE FROM welcome_resources
WHERE label = $$Daily Sales Meeting$$;

-- Seed four zone-scoped rows. Zone 4 gets the link Neal provided;
-- Zones 1-3 launch as Coming Soon (url IS NULL → renderer flips the
-- card into a non-clickable "Coming soon" state).
INSERT INTO welcome_resources (display_order, label, url, description, icon, requires_google_signin) VALUES
  (
    30,
    $$Daily Sales Meeting · Zone 1$$,
    NULL,
    $$9:30 AM Eastern · Monday through Thursday. Zoom link coming soon — your regional manager will share it.$$,
    $$💼$$,
    false
  ),
  (
    31,
    $$Daily Sales Meeting · Zone 2$$,
    NULL,
    $$9:30 AM Eastern · Monday through Thursday. Zoom link coming soon — your regional manager will share it.$$,
    $$💼$$,
    false
  ),
  (
    32,
    $$Daily Sales Meeting · Zone 3$$,
    NULL,
    $$9:30 AM Eastern · Monday through Thursday. Zoom link coming soon — your regional manager will share it.$$,
    $$💼$$,
    false
  ),
  (
    33,
    $$Daily Sales Meeting · Zone 4$$,
    $$https://trainingmanagementsys.netlify.app/regional-manager/08e95b5784494cfabb79015ff1ae1519$$,
    $$9:30 AM Eastern · Monday through Thursday.$$,
    $$💼$$,
    false
  )
ON CONFLICT (label) DO UPDATE
  SET url = EXCLUDED.url,
      description = EXCLUDED.description,
      display_order = EXCLUDED.display_order,
      icon = EXCLUDED.icon;
