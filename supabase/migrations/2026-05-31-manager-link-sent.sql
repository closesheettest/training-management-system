-- Add manager_link_sent_at to trainees so admin can see whether the
-- regional manager dashboard URL was already SMS'd via the "📲 Send
-- access link" button on /active-reps.
--
-- Stamping it as a separate timestamp (rather than overloading the
-- existing manager_access_token field) means re-sending later updates
-- the timestamp and the badge on /active-reps refreshes accordingly.

ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS manager_link_sent_at timestamptz;

COMMENT ON COLUMN trainees.manager_link_sent_at IS
  'Timestamp the regional-manager dashboard URL was last sent via SMS by send-regional-manager-link.js. Null = never sent (admin has only shared via "Copy access link" or not at all). NOT cleared on revoke — if the manager is later re-assigned, this column gets a fresh timestamp on the next send.';
