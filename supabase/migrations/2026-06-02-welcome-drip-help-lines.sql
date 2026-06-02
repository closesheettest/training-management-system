-- Welcome-drip SMS: include zone-specific Sales Meeting Zoom + four
-- Team Help Lines.
--
-- Per Neal (2026-06-02):
--   1. The Sales Meeting Zoom link is now per-zone (each regional
--      manager hosts their own room). The cron renders
--      {salesMeetingZoom} from the manager's manager_zoom_url for
--      the rep's region. Zones without a Zoom yet (1-3 as of today)
--      get "(Zoom coming soon — check the dashboard)" as the fallback.
--   2. The trigger also flipped — see send-welcome-texts.js header
--      comment. Welcome now fires when the trainer ASSIGNS a zone
--      (region NOT NULL), not at graduation.
--   3. The four zone help-line numbers go in every drip so reps can
--      pin one text and have all four handy.
--
-- Help lines (live as of 2026-06-02):
--   Zone 1 · Tony     904-560-8819
--   Zone 2 · Richard  813-797-4890
--   Zone 3 · Chad     941-837-5657
--   Zone 4 · Sam      786-807-7751
--
-- If a help-line number or a Zone's Zoom changes, update the
-- corresponding row(s) in the trainees table (managed_region anchors
-- which manager owns each zone). The Zoom flows from manager_zoom_url
-- automatically next cron fire.

update message_templates
set
  body = E'Hi {firstName}, your quick-links page (sales dashboard, how-to videos, sales meeting, prayer call): {link}\n\n' ||
         E'Sales Meeting Zoom ({region}):\n{salesMeetingZoom}\n\n' ||
         E'Team Help Lines (save these):\n' ||
         E'Zone 1 Tony — 904-560-8819\n' ||
         E'Zone 2 Richard — 813-797-4890\n' ||
         E'Zone 3 Chad — 941-837-5657\n' ||
         E'Zone 4 Sam — 786-807-7751\n\n' ||
         E'(Day {dayNumber} of 7)',
  placeholders = ARRAY['firstName', 'link', 'dayNumber', 'salesMeetingZoom', 'region'],
  updated_at = now()
where key = 'welcome_drip';
