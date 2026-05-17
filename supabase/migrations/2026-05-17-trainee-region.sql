-- Migration: per-trainee region + rename Group meeting → Company meeting.
--
-- Why per-trainee region: today the region only lives on classes, which
-- means the 74 bulk-imported reps (all sitting under one attendance-only
-- meeting class) share that class's region — useless for slicing them by
-- where they actually live. Once we hire regional managers, each manager
-- needs to broadcast to just their own region, so trainees need their
-- own region field independent of any class.
--
-- Why rename Group → Company: the template was named for "group meetings"
-- but the actual use is the company-wide meetings, so the label should
-- match what admin actually picks it for. The key stays the same so
-- nothing else has to change.

alter table trainees add column if not exists region text;
create index if not exists trainees_region_idx on trainees(region);

-- Backfill: copy class's region into each trainee row as the starting
-- point. For bulk-imported reps living under a Florida-wide meeting
-- class, the value will be whatever that class is set to — they'll
-- correct it themselves on /update-info (which now asks them to pick
-- the region closest to where they live).
update trainees t
set region = c.region
from classes c
where c.id = t.class_id
  and t.region is null;

-- Rename the existing meeting-reminder template label so the dropdown
-- on /group-messages says "Company meeting" instead of "Group meeting".
-- Body wording is unchanged — admin types their own message anyway.
update message_templates
set label = 'Company meeting reminder — SMS',
    description = 'Generic template for one-off company-wide meeting reminders. Edit the wording on the Group Messages page or here. Supports {firstName} and {link} placeholders.',
    updated_at = now()
where key = 'group_meeting_reminder_sms';

-- Update the "update info request" template bodies to also ask for
-- region — the public /update-info page now has a region picker, so
-- it makes sense to call that out in the text the rep receives.
update message_templates
set body = 'Hi {firstName}, we''re updating our records — please take 30 seconds to enter your personal email, home address, and pick your region: {link}',
    updated_at = now()
where key = 'update_info_request_sms';

update message_templates
set body = $body$Hi {firstName},

We're keeping our records up to date in the new training system. Please take 30 seconds to enter your personal email, home address, and the region closest to where you live using your private link below:

{link}

It pre-fills with what we already have on file — just confirm or correct, then save.

Thanks!
— U.S. Shingle Training Team$body$,
    updated_at = now()
where key = 'update_info_request_email';
