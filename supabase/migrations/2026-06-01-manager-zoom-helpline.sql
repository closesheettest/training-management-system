-- Two new columns on trainees so each regional sales manager can
-- carry their own Zone Zoom URL + (eventually) help-line contact
-- that appears on /regional-manager/:token as quick-action buttons.
--
-- Only the regional manager's own row matters — these fields stay
-- NULL for everyone else. The dashboard page reads them off the
-- manager (whoami action in regional-manager-api.js) so the manager
-- never sees anyone else's data through these columns.
--
-- manager_zoom_url
--   The Zone's daily sales training Zoom URL. Each Zone has a
--   different one (Tony/Richard/Chad/Sam each host their own room
--   per the 2026-06-01 reorg). Admin sets this via Edit Info on
--   /active-reps when the manager sends Neal the link.
--
-- manager_helpline_url
--   Reserved for the company help-line contact card / tel:// link
--   Neal is going to provide shortly. Stored as text — could be a
--   tel:1234567890 URL, a vCard endpoint, or a static help-page URL.
--   The dashboard renders the button as "Coming soon" when this is
--   NULL or blank.

ALTER TABLE trainees ADD COLUMN IF NOT EXISTS manager_zoom_url text;
ALTER TABLE trainees ADD COLUMN IF NOT EXISTS manager_helpline_url text;

COMMENT ON COLUMN trainees.manager_zoom_url IS
  'Daily sales training Zoom URL for the Zone this trainee manages. Renders as a Join Zoom button on /regional-manager/:token. Null = Coming soon. Only meaningful when managed_region is set.';

COMMENT ON COLUMN trainees.manager_helpline_url IS
  'Help-line URL for this Zone (tel://, vCard endpoint, or static page). Renders as a Help Line button on /regional-manager/:token. Null = Coming soon. Neal to provide.';
