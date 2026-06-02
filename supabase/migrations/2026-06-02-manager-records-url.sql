-- Surface the CCG Regional Manager records URL on the TMS side.
--
-- The actual token + URL live in CCG's regional_managers table (each
-- Supabase project owns its own data — TMS doesn't have manager auth
-- for CCG). But Neal wants the URL findable from /active-reps in TMS
-- so he doesn't have to flip to Supabase any time he wants to text a
-- manager their link.
--
-- This column is admin-pasted (one-time per manager). To populate:
--   1. Run the CCG migration 2026-06-02-regional-managers.sql in the
--      CCG Supabase project. Copy the four URLs from the SELECT
--      result.
--   2. In TMS /active-reps, open each manager's Edit Info modal and
--      paste their CCG records URL into the new "CCG Records URL"
--      field. Save.
--   3. From then on, admin can grab the URL from /active-reps with
--      one click via the Copy button next to the field.
--
-- If a token gets rotated in CCG (security-wise), update this column
-- to the new URL.

ALTER TABLE trainees ADD COLUMN IF NOT EXISTS manager_records_url text;

COMMENT ON COLUMN trainees.manager_records_url IS
  'CCG Regional Manager records page URL for this manager. Of the form https://free-roof-inspections.netlify.app/?manager=<token>. Token is owned + minted by CCG (see CCG regional_managers table). Admin pastes the URL here so it''s grabbable from TMS /active-reps without opening Supabase. Only meaningful when managed_region is set.';
