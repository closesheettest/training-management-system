-- Welcome-drip SMS: add the four Team Help Lines.
--
-- Per Neal — every newly-graduated rep should have the four zone
-- manager phone numbers saved in their phone. The 7-day welcome drip
-- is the perfect surface for that: it fires once a day for a week,
-- so if the rep deletes the first text by accident, the next day's
-- still has the numbers.
--
-- Help lines (live as of 2026-06-02):
--   Zone 1 · Tony     904-560-8819
--   Zone 2 · Richard  813-797-4890
--   Zone 3 · Chad     941-837-5657
--   Zone 4 · Sam      786-807-7751
--
-- If a number changes, update both this row AND the per-zone tiles
-- in the us-shingle-rep-dashboard `index.html` (Zone Help Lines
-- section, near the bottom of the file).

update message_templates
set
  body = E'Hi {firstName}, your quick-links page (sales dashboard, how-to videos, sales meeting, prayer call): {link}\n\n' ||
         E'Team Help Lines (save these):\n' ||
         E'Zone 1 Tony — 904-560-8819\n' ||
         E'Zone 2 Richard — 813-797-4890\n' ||
         E'Zone 3 Chad — 941-837-5657\n' ||
         E'Zone 4 Sam — 786-807-7751\n\n' ||
         E'(Day {dayNumber} of 7)',
  updated_at = now()
where key = 'welcome_drip';
