-- 2026-07-12b-remove-permalock.sql
-- ─────────────────────────────────────────────────────────────────────
-- Permalock is discontinued — U.S. Shingle no longer offers this product.
-- Remove the "Permalock Aluminum Shingle" day from the Ongoing Training
-- curriculum and close the position gap so the live curriculum runs
-- 1..N with no hole.
--
-- Idempotent: safe to re-run; a no-op once Permalock is already gone.
--
-- SCOPE NOTE: this only touches the training curriculum. Historical
-- Permalock INSTALL records, crew pay rates, and sales-audit logic in the
-- claims app are intentionally left alone — roofs already installed still
-- need to be tracked and synced.
-- ─────────────────────────────────────────────────────────────────────

delete from training_days where title = 'Permalock Aluminum Shingle';

-- Re-sequence the live (active) days so positions are contiguous 1..N.
with ordered as (
  select id, row_number() over (order by position) as rn
  from training_days
  where status = 'active'
)
update training_days t
set position = o.rn, updated_at = now()
from ordered o
where t.id = o.id and t.position <> o.rn;
