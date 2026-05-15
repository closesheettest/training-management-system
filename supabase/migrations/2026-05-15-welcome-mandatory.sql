-- Migration: per-resource "mandatory" flag on welcome_resources.
--
-- When mandatory=true, the public /welcome page renders the card in
-- red with a banner across the top showing the mandatory_note text
-- ("MANDATORY — YOU CAN NOT MISS ANY · CAMERA MUST BE ON"). Future
-- mandatory items can be flagged the same way from the admin page.

alter table welcome_resources add column if not exists mandatory boolean not null default false;
alter table welcome_resources add column if not exists mandatory_note text;

-- Flag the existing Daily Sales Meeting row. Only updates if the row
-- isn't already mandatory — so re-running the migration doesn't
-- overwrite a custom note the admin set later.
update welcome_resources
set mandatory = true,
    mandatory_note = $$MANDATORY — YOU CAN NOT MISS ANY · CAMERA MUST BE ON$$,
    updated_at = now()
where label = $$Daily Sales Meeting$$
  and mandatory = false;
