-- Recap email template — seeded so it shows up in the
-- /group-messages "Pick a template" dropdown alongside the other
-- system templates. Used with the new `class_attended_today` scope
-- to send Neal's day-of training recap to everyone who actually
-- showed up that day.
--
-- The body has two clearly-marked sections (RECAP + HOMEWORK).
-- Neal types into both when composing — placeholder text in
-- {recapBody} and {homeworkBody} gets substituted on send. {firstName}
-- substitution happens per-recipient as it does for all templates.
--
-- ON CONFLICT (key) DO NOTHING so re-running this migration doesn't
-- overwrite any edits Neal makes via /message-templates.

insert into message_templates (key, label, description, subject, body, placeholders) values
  (
    'recap_email',
    'Day-of training recap',
    $desc$Send to everyone who attended today's training. Two sections — what was covered + what to study tonight. Pair with the "Trainees who attended today's class" scope on /group-messages so it only goes to people who actually showed up.$desc$,
    $subj$Today's training recap — {firstName}$subj$,
    $body$Hi {firstName},

Quick recap of what we covered today and what I need you to study tonight.

— TODAY —
{recapBody}

— HOMEWORK FOR TONIGHT —
{homeworkBody}

Get a good night's sleep, drink water, and show up ready tomorrow.

— Neal$body$,
    array['firstName', 'recapBody', 'homeworkBody']
  )
on conflict (key) do nothing;
