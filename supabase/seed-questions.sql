-- Seed questions for the end-of-training test.
-- Run this ONCE after the schema is set up, or re-run anytime to wipe + reload.
-- Source: Neal's Google Form (https://docs.google.com/forms/d/e/1FAIpQLScfJ-g4Opf0l7Z2WG-NV90nWjnixl8kxnofI0z4cSUSO6IZ2w/viewform)
-- Essay prompts (#21-24) are rewritten so the question text itself carries the SEO
-- (Neal's name) — the trainee's answer stays authentic on the public testimonial.

-- Wipe existing questions before re-seeding (safe — test_responses have snapshot copies)
delete from questions;

-- =========================
-- MULTIPLE CHOICE (Q1-20)
-- =========================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
('What time is the sales meeting Mon through Thurs?',
 'multiple_choice',
 '["9:00 am", "9:15 am", "9:30 am", "10:00 am"]'::jsonb,
 '9:15 am', 1, true),

('If I have a meeting with a customer it is ok to miss the sales meeting!',
 'multiple_choice',
 '["True", "False"]'::jsonb,
 'False', 2, true),

('Exposed Fastener Metal panel can be installed with a .5/12 pitch:',
 'multiple_choice',
 '["Ultra Rib", "PBR Panel"]'::jsonb,
 'PBR Panel', 3, true),

('In a sales presentation who controls the conversation?',
 'multiple_choice',
 '["The person talking", "The person with the most information", "The person asking the questions"]'::jsonb,
 'The person asking the questions', 4, true),

('What are the 4 impulse factors for buying?',
 'multiple_choice',
 '["Trust/Rapport/Value/Urgency", "Fear of Loss/Indifference/Greed/Sense of Urgency", "Price/Quality/Speed/Service", "Curiosity/Emotion/Logic/Social Proof"]'::jsonb,
 'Fear of Loss/Indifference/Greed/Sense of Urgency', 5, true),

('Where are your commission tables located?',
 'multiple_choice',
 '["Company Intranet", "Sales Rep Dashboard", "Your Manager''s Email", "Employee Handbook"]'::jsonb,
 'Sales Rep Dashboard', 6, true),

('How long has U.S. Shingle and Metal been in business?',
 'multiple_choice',
 '["10+ years", "20+ years", "15+ years", "13+ years"]'::jsonb,
 '13+ years', 7, true),

('Can we help customers with their insurance claim?',
 'multiple_choice',
 '["Yes (direct handling)", "No (manager involvement)", "No (no assistance)", "Yes (if requested)"]'::jsonb,
 'No (manager involvement)', 8, true),

('What is required for your lead to be considered Sit-Sold?',
 'multiple_choice',
 '["Verbal commitment and follow-up appointment", "All paperwork signed with financing/50% down", "All paperwork signed with full payment", "Customer reviewed proposal and agreed"]'::jsonb,
 'All paperwork signed with financing/50% down', 9, true),

('When using Sales Rabbit, it is important to put notes on each pin visited.',
 'multiple_choice',
 '["True", "False"]'::jsonb,
 'True', 10, true),

('I use the calendar in JobNimbus to create an appointment.',
 'multiple_choice',
 '["True", "False"]'::jsonb,
 'True', 11, true),

('How long is our workmanship warranty?',
 'multiple_choice',
 '["5 years non-transferrable", "10 years transferrable", "10 years non-transferrable", "Lifetime warranty"]'::jsonb,
 '10 years transferrable', 12, true),

('What does P.A.C.E. stand for?',
 'multiple_choice',
 '["Property Assessed Clean Energy", "Property Approved Clean Efficiency", "Professional Assessment of Cost Efficiency", "Property Authorized Clean Energy"]'::jsonb,
 'Property Assessed Clean Energy', 13, true),

('When is it ok to call your Sales Manager?',
 'multiple_choice',
 '["Only during business hours 9am-5pm", "Anytime", "Only with confirmed sit", "Only when closed"]'::jsonb,
 'Anytime', 14, true),

('What is the purpose of the warm-up?',
 'multiple_choice',
 '["Explain features/pricing", "Create rapport and lower guard", "Qualify customer", "Introduce self"]'::jsonb,
 'Create rapport and lower guard', 15, true),

('When going from Shingle to a Metal Roof the skylight only has to be changed if it is cracked or leaking.',
 'multiple_choice',
 '["True", "False"]'::jsonb,
 'False', 16, true),

('When you get paid, what time period is it for?',
 'multiple_choice',
 '["Current week", "Week before", "Month before", "Two weeks prior"]'::jsonb,
 'Week before', 17, true),

('What are the two things the company has absolutely no grace for?',
 'multiple_choice',
 '["Tardiness/poor performance", "Lying/gossip", "Insubordination/stealing", "Missing appointments/no follow-up"]'::jsonb,
 'Lying/gossip', 18, true),

('What percentage of radiating heat will Radiant Barrier reflect?',
 'multiple_choice',
 '["85%", "90%", "97%", "95%"]'::jsonb,
 '97%', 19, true),

('It is perfectly acceptable to offer just the roof without the energy package.',
 'multiple_choice',
 '["True", "False"]'::jsonb,
 'False', 20, true);

-- =========================
-- ESSAY — TESTIMONIAL POOL (Q21-24)
-- Rewritten so the question carries SEO (Neal's name) and the answer reads authentic on the website.
-- =========================
insert into questions (prompt, question_type, use_for_testimonial, order_index, active) values
('Before Neal Scoppettuolo''s training I used to _____, but now I realize _____. Describe how your approach to sales shifted after this week.',
 'essay', true, 21, true),

('After Neal Scoppettuolo''s training, what will you do differently in your very next sales appointment?',
 'essay', true, 22, true),

('Was Neal Scoppettuolo''s training worth your time? Tell us why in your own words.',
 'essay', true, 23, true),

('What was the one thing from Neal Scoppettuolo''s training that could make a salesperson more money?',
 'essay', true, 24, true);

-- =========================
-- OVERALL RATING (Q25)
-- Internal use only — not surfaced as a testimonial.
-- =========================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
('How would you rate this training overall?',
 'multiple_choice',
 '["1 — Needs Improvement", "2", "3", "4", "5 — Excellent"]'::jsonb,
 NULL, 25, true);
