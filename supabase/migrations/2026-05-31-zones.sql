-- Add the new owner-defined Zones to the regions table.
--
-- Background (2026-05-31): The owner restructured the sales territory
-- model. Instead of city-named regions (Jacksonville / Orlando / etc.)
-- the company now uses 4 numbered Zones tied to Florida counties:
--
--   Zone 1 — Tony      (NE / North-Central FL)
--     Nassau, Duval, Baker, Union, Bradford, Clay, St. Johns, Putnam,
--     Flagler, Alachua, Levy, Marion, Citrus, Hernando, Sumter, Lake,
--     Seminole, Volusia, plus the NORTH half of Brevard and Orange
--
--   Zone 2 — Richard   (Central / East-Central FL)
--     Pasco, Hillsborough, Polk, Osceola, Indian River, Highlands,
--     Okeechobee, St. Lucie, plus the SOUTH half of Brevard and Orange
--
--   Zone 3 — Chad      (Gulf Coast / SW FL)
--     Pinellas, Manatee, Sarasota, Charlotte, Lee, Collier, Monroe,
--     Hardee, DeSoto, Glades, Hendry
--
--   Zone 4 — Sam       (SE FL)
--     Martin, Palm Beach, Broward, Miami-Dade
--
-- ** Brevard and Orange are split between Zone 1 and Zone 2. Rt 50 is
--    the dividing line — north of Rt 50 = Zone 1, south = Zone 2.
--    Reps on the border get assigned by admin discretion / home address.
--
-- Decisions for this migration (Neal 2026-05-31):
--   1. ADD the 4 Zones; don't touch the existing St Pete / Jacksonville
--      / Orlando / Miami regions yet. They stay until every rep has
--      been moved off them, then Neal deletes via /regions.
--   2. Existing reps stay on their current region. Neal will manually
--      reassign each one via the ✏️ Edit info modal on /active-reps —
--      he knows the team better than a county lookup.
--   3. Tony, Richard, Chad, Sam will be set up as the regional managers
--      for Zones 1-4 via the 👑 Make regional manager button after the
--      reps land in their zones.
--
-- sort_order values 1-4 push the new Zones to the top of every
-- dropdown so they're the obvious default when Neal edits a rep.
-- The old city regions stay at 10/20/30/40 below them.
--
-- Lat/long is the zone centroid — only used by the Sales Team Map to
-- drop a default pin for reps who haven't filled in /update-info. Real
-- per-rep coordinates from update-info still override.

insert into regions (name, sort_order, latitude, longitude) values
  ('Zone 1', 1, 29.6516, -82.3248),  -- Gainesville-ish (NE / N-Central)
  ('Zone 2', 2, 28.0395, -81.9498),  -- Lakeland-ish (Central)
  ('Zone 3', 3, 27.3364, -82.5307),  -- Sarasota-ish (SW Gulf)
  ('Zone 4', 4, 26.1224, -80.1373)   -- Fort Lauderdale-ish (SE)
on conflict (name) do nothing;
