-- Final test additions — 2026-05-28
-- Layered on TOP of the existing seed-questions.sql (Q1-Q25). Adds:
--   1. A dynamic copy of every authored kiosk quiz question from
--      training_day_quiz_questions (whatever Neal authored throughout
--      the week) so each day's content is represented on the final.
--   2. Fresh MC questions covering today's Job Nimbus lesson and the
--      Day 3 practice deal (verifies they actually ran the homework).
--   3. Platform-targeted essay prompts (Google review, Yelp review,
--      Facebook post, LinkedIn post) — tied to online relationship
--      management. Each prompt name-checks Neal for SEO; the trainee's
--      verbatim answer goes out as their public testimonial.
--
-- order_index ranges:
--   1-25     existing seed (untouched)
--   100-199  copies from training_day_quiz_questions
--   200-299  Job Nimbus walkthrough MC
--   300-399  Day 3 practice deal specifics MC
--   400-499  platform-targeted essays
--
-- DO NOT re-run seed-questions.sql after this — it wipes all questions
-- via `delete from questions` and would erase these additions. If you
-- need to re-seed, paste this file into the seed-questions.sql tail
-- BEFORE running the wipe.

-- ============================================================
-- 1. Copy authored kiosk quiz questions → final test
-- ============================================================
-- training_day_quiz_questions stores correct_index as a 0-based int into
-- the options jsonb array. The questions table stores correct_choice as
-- a string that must match one of the choices. We pluck the string at
-- correct_index when copying.
--
-- order_index: 100 base + (day_number * 10) + position. Day 2 questions
-- land in 120s, Day 3 in 130s, etc. — so they stay grouped by day.
--
-- Idempotent: skips any row whose prompt text already exists in the
-- questions table (prevents duplicates if migration is re-run).
insert into questions (prompt, question_type, choices, correct_choice, order_index, active)
select
  q.question_text,
  'multiple_choice',
  q.options,
  -- options is a JSON array; ->> with text index pulls the string at correct_index
  (q.options ->> q.correct_index)::text,
  100 + (q.day_number * 10) + q.position,
  true
from training_day_quiz_questions q
where not exists (
  select 1 from questions existing where existing.prompt = q.question_text
);

-- ============================================================
-- 2. Job Nimbus walkthrough MC (today's lesson)
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('In Job Nimbus, what should you set the Location field to when creating a practice / test contact?',
   'multiple_choice',
   '["My region", "test", "Practice", "Leave it blank"]'::jsonb,
   'test', 200, true),

  ('In Job Nimbus, an appointment is created as which kind of record inside a Job?',
   'multiple_choice',
   '["A Contact", "A Note", "A Task", "A Photo"]'::jsonb,
   'A Task', 201, true),

  ('When building an estimate, what field do you fill in with the number of roofing squares?',
   'multiple_choice',
   '["Price", "Total", "Quantity", "Subtotal"]'::jsonb,
   'Quantity', 202, true),

  ('Which is the correct order to create a new homeowner''s deal from scratch in Job Nimbus?',
   'multiple_choice',
   '["Job → Contact → Appointment", "Contact → Appointment → Job", "Contact → Job → Appointment (Task)", "Appointment → Contact → Job"]'::jsonb,
   'Contact → Job → Appointment (Task)', 203, true),

  ('On the Job Details page of an estimate, the Additional Job Details field should always END with which exact phrase?',
   'multiple_choice',
   '["See contract for details", "All terms agreed", "No other promises made", "Subject to manager approval"]'::jsonb,
   'No other promises made', 204, true),

  ('On the Edit Job page, the Roof Price ONLY field should contain:',
   'multiple_choice',
   '["The total contract price including all add-ons", "The price of the roof BY ITSELF (no Radiant Barrier, no Insulation, no other add-ons)", "Whatever was financed", "The price per square"]'::jsonb,
   'The price of the roof BY ITSELF (no Radiant Barrier, no Insulation, no other add-ons)', 205, true),

  ('Radiant Barrier SqFt and Insulation SqFt are measured in:',
   'multiple_choice',
   '["Squares (1 square = 100 sq ft)", "Square feet", "Linear feet", "Either, depending on the product"]'::jsonb,
   'Square feet', 206, true),

  ('In the Edit Job IRBADS / Radiant Barrier / Insulation Cost fields, the dollar amount you enter is:',
   'multiple_choice',
   '["The price per square foot", "The TOTAL charge for that add-on on this job", "The wholesale cost only", "The customer''s monthly payment"]'::jsonb,
   'The TOTAL charge for that add-on on this job', 207, true),

  ('On a metal roof, Measurements Needed should be set to:',
   'multiple_choice',
   '["No — Roofr is enough for metal", "Yes — production hand-measures every metal roof", "Only if the homeowner asks", "Yes — the sales rep hand-measures the roof"]'::jsonb,
   'Yes — production hand-measures every metal roof', 208, true),

  ('Which field on the Edit Job page should you NEVER touch?',
   'multiple_choice',
   '["Sold Date", "Roof Price ONLY", "DO NOT TOUCH", "Payment Type"]'::jsonb,
   'DO NOT TOUCH', 209, true),

  ('In Job Nimbus, after you finish a Sign Now signature, which button on Review & Share do you tap if you''re sitting in front of the homeowner?',
   'multiple_choice',
   '["Send for Signing (emails them a link)", "Sign Now (they sign on your phone right there)", "Mark as Signed (skips the homeowner)", "Save Draft"]'::jsonb,
   'Sign Now (they sign on your phone right there)', 210, true),

  ('When you tap the X in the top left of the estimate, what happens?',
   'multiple_choice',
   '["The estimate is saved", "The estimate is saved as a draft", "The estimate is closed without saving", "The estimate is sent to the homeowner"]'::jsonb,
   'The estimate is closed without saving', 211, true);

-- ============================================================
-- 3. Day 3 practice deal specifics MC
-- (verifies the trainee actually ran the homework practice deal)
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('In the Day 3 homework practice deal, what is the total of the estimate (Exposed Fastener + Insulation + Radiant Barrier)?',
   'multiple_choice',
   '["$27,000", "$32,000", "$39,450", "$42,000"]'::jsonb,
   '$39,450', 300, true),

  ('In the practice deal, how many squares of Exposed Fastener Metal at what price per square?',
   'multiple_choice',
   '["30 squares at $900/sq", "25 squares at $1,080/sq", "30 squares at $1,000/sq", "20 squares at $1,500/sq"]'::jsonb,
   '30 squares at $900/sq', 301, true),

  ('In the practice deal, what is the Roof Price ONLY value (NOT the full contract total)?',
   'multiple_choice',
   '["$39,450", "$32,000", "$27,000", "$8,250"]'::jsonb,
   '$27,000', 302, true),

  ('In the practice deal, what is the color and how is the homeowner financing?',
   'multiple_choice',
   '["Brown / Cash", "Black / Upgrade", "Charcoal / GoodLeap", "Black / Cash"]'::jsonb,
   'Black / Upgrade', 303, true);

-- ============================================================
-- 4. Platform-targeted essay prompts
-- Same SEO pattern as Q21-Q24: prompts name-check Neal so the public
-- testimonial inherits the SEO; the trainee's answer is verbatim.
-- ============================================================
insert into questions (prompt, question_type, use_for_testimonial, order_index, active) values
  ('Write what you would post as a Google review for U.S. Shingle &amp; Metal''s training program led by Neal Scoppettuolo. Be specific — share one thing from this week that will help you close more deals.',
   'essay', true, 400, true),

  ('Write what you would post as a Yelp review describing your training week with Neal Scoppettuolo at U.S. Shingle &amp; Metal. Mention one specific moment that stood out.',
   'essay', true, 401, true),

  ('Write a Facebook post (the way you''d share it on your own page) about something Neal Scoppettuolo taught you this week that you''re excited to use on your next door knock.',
   'essay', true, 402, true),

  ('Write a LinkedIn post about your training week with Neal Scoppettuolo and U.S. Shingle &amp; Metal — the way you''d professionally describe what you gained.',
   'essay', true, 403, true);
