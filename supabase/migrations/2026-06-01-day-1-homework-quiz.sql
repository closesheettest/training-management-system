-- Day 1 homework + Day 2 morning quiz content.
--
-- The cron-training-homework function fires at 4:30 PM ET on Day 1 and
-- texts every Day 1 attendee a link to /day-1-homework/ with:
--   • Free Roof Inspection Script (the new harvesting / opening pitch)
--   • Retail Roof Go-Back Script (the wear-&-tear second-yes pitch)
--   • The 3 outcomes that bridge them
--   • A download button for the full 118-slide training manual PDF
--     (same pattern as last week — pitch + full manual together)
--
-- Tomorrow morning (Day 2 sign-in), send-training-quiz fires a 5-question
-- SMS quiz on the Day 1 content. Quiz testing pattern: each question
-- targets a specific line from the scripts so a trainee who memorized
-- verbatim gets all 5; a trainee who only skimmed gets 1-2.
--
-- All questions are multiple-choice with 4 options, correct_index zero-
-- based. Wrong options are intentionally plausible-but-wrong rephrasings
-- so trainees can't guess by elimination.

-- 1. Enable Day 1 lesson row + populate homework SMS body + link.
update training_day_lessons
set
  label = 'Day 1 — Scripts (Free Inspection + Go-Back) + Slide 1',
  homework_sms_body =
    E'Hi {firstName}, great first day! 🎯\n\n' ||
    E'Tonight: memorize all three —\n' ||
    E'• Free Roof Inspection pitch\n' ||
    E'• Retail Roof Go-Back pitch\n' ||
    E'• Slide 1 — 15 Years in Business\n\n' ||
    E'The link below has all three AND the full 118-slide training manual. Save the PDF for offline study. Tomorrow morning at the kiosk you''ll get a quick quiz on this.',
  homework_link_url = '/day-1-homework/',
  enabled = true,
  updated_at = now()
where day_number = 1;

-- 2. Wipe any prior Day 1 quiz questions so re-running this migration is
--    idempotent (admin can also re-run after editing the SQL to update).
delete from training_day_quiz_questions where day_number = 1;

-- 3. Insert the 5 quiz questions.
insert into training_day_quiz_questions
  (day_number, position, question_text, options, correct_index)
values
  (1, 1,
   'In the Free Roof Inspection script, what reason do you give the homeowner for stopping by?',
   '[
      "We''re selling roofs in your neighborhood this week",
      "We sent you something in the mail about your roof",
      "We''re running a free inspection promotion",
      "Your neighbor signed up so we came by yours"
    ]'::jsonb,
   1),

  (1, 2,
   'What is the key question you ask the homeowner to earn the inspection appointment?',
   '[
      "Have you had your roof inspected recently?",
      "Do you have homeowners insurance?",
      "Would you rather come out of pocket to replace your roof, or have an inspection report where the insurance leaves you alone?",
      "Are you happy with your current roof?"
    ]'::jsonb,
   2),

  (1, 3,
   'What are the 3 things that can happen during the free roof inspection?',
   '[
      "Pass, fail, or repair quote",
      "Approved, denied, or pending review",
      "No damage, wear & tear, or storm damage",
      "Roof certified, partial damage, or total loss"
    ]'::jsonb,
   2),

  (1, 4,
   'In the Retail Go-Back Setup, after asking about moving plans, what is the second "right?" question?',
   '[
      "Is your roof still under warranty, right?",
      "When you do business with anyone, the company''s ethics and standing is important to you, right?",
      "You''d want to fix this sooner rather than later, right?",
      "You wouldn''t mind paying out of pocket, right?"
    ]'::jsonb,
   1),

  (1, 5,
   'What are the two main reasons the Retail Go-Back script gives for replacing the roof NOW instead of waiting?',
   '[
      "Curb appeal and resale value",
      "Today is the cheapest you''ll ever pay + insurance savings of up to 30%",
      "Manufacturer warranty and tax credits",
      "Avoiding leaks and saving on energy bills"
    ]'::jsonb,
   1),

  (1, 6,
   'In Slide 1 (15 Years in Business), what is the opening question you ask the homeowner?',
   '[
      "How long have you owned your home?",
      "Have you worked with a roofer before?",
      "When dealing with a company for your roof, how important is it to you that they are likely to be around in the future if you have a need or if something goes wrong?",
      "What''s the most important quality you look for in a contractor?"
    ]'::jsonb,
   2);
