-- Migration: track when each trainee self-served their info via the
-- public /update-info page. Lets the /active-reps UI surface "Never
-- updated" and "Updated X days ago" so admin can chase the stragglers
-- after a group-messages "update your info" blast.
--
-- The UpdateInfo.jsx submit handler stamps this column. Existing
-- records stay NULL until the rep actually fills in the form — that
-- IS the "hasn't responded yet" signal we want.

alter table trainees add column if not exists info_updated_at timestamptz;

-- Partial index for the "Never updated" filter on /active-reps (the
-- common admin query: who still needs to fill in their info?).
create index if not exists trainees_never_updated_idx
  on trainees(is_active_sales_rep)
  where is_active_sales_rep = true and info_updated_at is null;
