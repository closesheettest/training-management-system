-- Migration: clean up duplicate welcome_resources rows + lock down the
-- table with a unique constraint on label.
--
-- The original seed used `on conflict do nothing` without specifying a
-- target column. Postgres only honors that clause when there's a
-- UNIQUE/PRIMARY KEY constraint to conflict ON — and since the only
-- unique field was id (auto-generated, never conflicts), every re-run
-- of the migration inserted a new copy of each seed row.
--
-- Existing installs that ran the seed twice ended up with each link
-- card listed twice on the /welcome-links page. This migration:
--   1. Deletes duplicate rows, keeping the oldest one per label
--   2. Adds a unique constraint on label so future re-runs are safe

delete from welcome_resources a
using welcome_resources b
where a.label = b.label
  and a.id > b.id;

alter table welcome_resources
  add constraint welcome_resources_label_key unique (label);
