-- Migration: seed message templates for the "update your info" workflow.
--
-- After importing 70+ reps via CSV into the system, most of them have
-- a company phone but no personal email or home address on file. The
-- group-messages page lets admin text/email all of them with a link
-- to /update-info/<token> where they self-serve their info.
--
-- Two seeds:
--   update_info_request_sms  — short SMS body with the link
--   update_info_request_email — longer email body with the link
--
-- Both editable on /message-templates.

insert into message_templates (key, label, description, body, placeholders) values
  (
    'update_info_request_sms',
    $label$Update info request — SMS$label$,
    $desc$Sent from the Group Messages page to ask each rep to update their personal email + home address. Fired manually; one text per recipient with their personalized self-service link.$desc$,
    $body$Hi {firstName}, we're updating our records — please take 30 seconds to enter your personal email + home address: {link}$body$,
    array['firstName', 'link']
  ),
  (
    'group_meeting_reminder_sms',
    $label$Group meeting reminder — SMS$label$,
    $desc$Generic template for one-off meeting reminders. Edit the wording on the Group Messages page or here. Supports {firstName} and {link} placeholders.$desc$,
    $body$Hi {firstName}, reminder about our company meeting tomorrow. See you there!$body$,
    array['firstName', 'link']
  )
on conflict (key) do nothing;

insert into message_templates (key, label, description, subject, body, placeholders) values
  (
    'update_info_request_email',
    $label$Update info request — email$label$,
    $desc$Email version of the update-info request. Sent from the Group Messages page when the channel is set to Email. Skipped for any recipient without an email on file.$desc$,
    $subj$Quick favor — update your info ({firstName})$subj$,
    $body$Hi {firstName},

We're keeping our records up to date in the new training system. Please take 30 seconds to enter your personal email + home address using your private link below:

{link}

It pre-fills with what we already have on file — just confirm or correct, then save.

Thanks!
— U.S. Shingle Training Team$body$,
    array['firstName', 'link']
  )
on conflict (key) do nothing;

-- Dedup column on trainees so the UI can show "last group message sent
-- to this person at X" if we want. Optional — leave null when not set.
alter table trainees add column if not exists last_group_message_sent_at timestamptz;
