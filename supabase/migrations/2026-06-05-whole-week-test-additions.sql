-- Whole-week test additions — 2026-06-05
-- Adds ~2 fresh multiple-choice questions per training DAY (plus a fuller
-- financing block, since that's the new last-day lesson), so the final
-- test samples the entire week, not just Days 1-3.
--
-- Grounded in the real course content:
--   Day 1  — Retail Foundation / sales psychology (FITD, the 3 inspection
--            outcomes)
--   Day 2  — Products (Energy Package = Radiant Barrier + Insulation; GAF
--            asphalt line)
--   Day 3  — The 3 daily apps (Roofr, RepCard)
--   Day 4  — Objection handling (R.I.S.C. flow)
--   Finance — the waterfall from /finance-slides/ (Upgrade → Service
--            Finance → PACE → credit-repair fallback; no prepay penalty)
--
-- order_index range for this batch: 500-599 (grouped by day in 10s).
--   500-509  Day 1
--   510-519  Day 2
--   520-529  Day 3
--   530-539  Day 4 — objection handling
--   540-549  Financing
--
-- Other batches own these ranges (left untouched):
--   1-25     original seed
--   100-199  kiosk-quiz copies
--   200-399  Job Nimbus / Day 3 practice deal
--   400-499  platform essays
--
-- RE-RUNNABLE: we delete only THIS batch's range first, so re-running
-- refreshes these 13 without duplicating and without disturbing any other
-- question. Safe to paste into the Supabase SQL editor as-is.

delete from questions where order_index between 500 and 599;

-- ============================================================
-- Day 1 — Retail Foundation + sales psychology
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('The free roof inspection — a small, easy "yes" that opens the door to a bigger commitment — is an example of which sales-psychology principle?',
   'multiple_choice',
   '["Foot-in-the-Door (FITD)", "Fear of Loss", "Anchoring", "Door-in-the-Face"]'::jsonb,
   'Foot-in-the-Door (FITD)', 500, true),

  ('At a free roof inspection, what are the THREE outcomes you walk the homeowner through?',
   'multiple_choice',
   '["No damage / Wear & tear / Storm damage", "Approved / Pending / Denied", "Repair / Replace / Refer", "Cash / Finance / Insurance"]'::jsonb,
   'No damage / Wear & tear / Storm damage', 501, true);

-- ============================================================
-- Day 2 — Products
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('The Energy Package upgrade is made up of which two products?',
   'multiple_choice',
   '["Radiant Barrier + Insulation", "Underlayment + Drip Edge", "Ridge Vent + Soffit", "Skylight + Solar"]'::jsonb,
   'Radiant Barrier + Insulation', 510, true),

  ('Our asphalt shingle product line is manufactured by:',
   'multiple_choice',
   '["GAF", "Owens Corning", "CertainTeed", "Tilcore"]'::jsonb,
   'GAF', 511, true);

-- ============================================================
-- Day 3 — The 3 daily apps
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('You need a roof measurement report without climbing on the roof. Which of the 3 daily apps do you use?',
   'multiple_choice',
   '["Roofr", "RepCard", "JobNimbus", "Sales Rabbit"]'::jsonb,
   'Roofr', 520, true),

  ('Which app is your door-to-door map, where you log each house you knock (Not Home / Pitched / Booked / Sold)?',
   'multiple_choice',
   '["RepCard", "Roofr", "JobNimbus", "Google Maps"]'::jsonb,
   'RepCard', 521, true);

-- ============================================================
-- Day 4 — Objection handling (R.I.S.C.)
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('What does the R.I.S.C. objection-handling flow stand for?',
   'multiple_choice',
   '["Repeat → Isolate → Solve → Close", "Restate → Inform → Sell → Confirm", "Relax → Identify → Submit → Close", "Reject → Ignore → Switch → Close"]'::jsonb,
   'Repeat → Isolate → Solve → Close', 530, true),

  ('Using R.I.S.C., what is the FIRST thing you do when a homeowner raises an objection?',
   'multiple_choice',
   '["Repeat the objection back to them", "Drop the price", "Call your manager", "Ask them to sign"]'::jsonb,
   'Repeat the objection back to them', 531, true);

-- ============================================================
-- Financing — the waterfall (last-day lesson, /finance-slides/)
-- ============================================================
insert into questions (prompt, question_type, choices, correct_choice, order_index, active) values
  ('Which finance company do we ALWAYS submit to first, and why?',
   'multiple_choice',
   '["Upgrade Financial — it''s a soft pull, so a decline won''t hurt their credit", "PACE — it approves everyone", "Service Finance — it has the lowest rate", "Whichever one the homeowner picks"]'::jsonb,
   'Upgrade Financial — it''s a soft pull, so a decline won''t hurt their credit', 540, true),

  ('With Service Finance, if the automated system declines the application, what should you do?',
   'multiple_choice',
   '["Call customer service for a manual second-look review (cosigners are also accepted)", "Tell the homeowner they don''t qualify", "Resubmit it to Upgrade", "Raise the down payment"]'::jsonb,
   'Call customer service for a manual second-look review (cosigners are also accepted)', 541, true),

  ('PACE (Property Assessed Clean Energy) approves a homeowner based primarily on what?',
   'multiple_choice',
   '["The home''s equity (with mortgage and property taxes current), not just a credit score", "The homeowner''s credit score only", "The age of the roof", "The size of the down payment"]'::jsonb,
   'The home''s equity (with mortgage and property taxes current), not just a credit score', 542, true),

  ('Every financing program U.S. Shingle offers has NO prepayment penalty. What does that mean for the homeowner?',
   'multiple_choice',
   '["They can pay the loan off early — partial or in full — with no extra fee", "They must keep the loan for the full term", "They get a discount for paying late", "They can skip payments whenever they want"]'::jsonb,
   'They can pay the loan off early — partial or in full — with no extra fee', 543, true),

  ('If a customer is declined by every lender, what do we offer them?',
   'multiple_choice',
   '["We sign them up for credit repair (we pay for it), fix their credit, then come back and get them their roof", "We tell them to come back in a year", "We require full cash payment", "We give them a lower-quality roof"]'::jsonb,
   'We sign them up for credit repair (we pay for it), fix their credit, then come back and get them their roof', 544, true);
