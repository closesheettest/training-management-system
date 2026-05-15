-- Migration: text trainees a personal link to their final-test results.
--
-- Trainees can tap the link to see exactly which questions they got
-- right or wrong on the multiple-choice section, plus their own essay
-- answers. Useful as a self-coaching tool — they can revisit material
-- they missed.
--
-- Triggered manually from the TestResults section on a Class detail
-- page (per-trainee Send button + bulk Send-all-submitted button).
-- One text per trainee — dedup via test_results_link_sent_at.

alter table trainees add column if not exists test_results_link_sent_at timestamptz;

insert into message_templates (key, label, description, body, placeholders) values
  (
    'test_results_link',
    $label$Final test results — personal link text$label$,
    $desc$Sent when an admin clicks "Send results" on a trainee in the Final Test Results section of the Class detail page (or "Send to all submitted" for the whole class). Links to /results/{token}, a private page showing that trainee's right/wrong on each multiple-choice question plus their essay responses. Each token only opens that trainee's own results.$desc$,
    $body$Hi {firstName}, your final test results from training are ready — see what you got right and wrong: {link}$body$,
    array['firstName', 'link']
  )
on conflict (key) do nothing;
