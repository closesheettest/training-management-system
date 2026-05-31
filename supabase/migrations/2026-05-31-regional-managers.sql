-- Regional Sales Managers — give one rep per region a stripped-down
-- public page where they can see their team, deactivate someone they've
-- fired, and SMS / email the whole region.
--
-- Two new columns on trainees:
--   managed_region        which region this person manages (nullable;
--                          when non-null they ARE a regional manager).
--                          Constrained to exactly one region at a time
--                          per Neal's 2026-05-31 decision — multi-region
--                          managers can come later if we ever need it.
--   manager_access_token  the secret in the public URL the manager
--                          opens. Token-only auth: anyone with the link
--                          can use the page, no login. Token is rotated
--                          if the assignment moves to a different person
--                          or the region changes.
--
-- The public page lives at /regional-manager/:token and calls one
-- Netlify function (regional-manager-api.js) that resolves the token
-- back to the manager + region and gates every action by that region
-- so they can't reach anyone outside it.

ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS managed_region text,
  ADD COLUMN IF NOT EXISTS manager_access_token text;

-- Unique index on the token so two managers can't accidentally collide
-- (and so we can resolve by token in O(log n) inside the API function).
-- Partial — NULL tokens don't conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS trainees_manager_access_token_idx
  ON trainees(manager_access_token)
  WHERE manager_access_token IS NOT NULL;

COMMENT ON COLUMN trainees.managed_region IS
  'When non-null, this trainee is the regional sales manager for that region. One region per manager. See /regional-manager/:token public page + netlify/functions/regional-manager-api.js.';

COMMENT ON COLUMN trainees.manager_access_token IS
  'Random secret used as the path segment in the regional-manager public URL. Rotated when assignment changes or region changes.';
