-- Off-board Bret Dethlefsen.  RUN ON THE TMS DATABASE.
--
-- He finished Week A, was held out of Week B pending a week of effort, and has
-- not responded to anything since (Neal, 2026-08-24). The hold was the chance;
-- no answer is the answer.
--
-- Mirrors EXACTLY what the Active Reps page writes when it off-boards someone,
-- so he lands in the same place with the same fields as everyone else. He is a
-- field trainee rather than an activated rep, which is why he does not appear on
-- that page and this has to be done here.
--
-- week_b_hold is cleared: the hold meant "waiting on a decision", and the
-- decision has been made. Leaving it set would show him on the calendar's
-- "on hold" chip forever, waiting for a return that is not coming.
--
-- ONE THING THIS DOES AUTOMATICALLY: setting left_company_at stops every text
-- and email to him, company-wide. The send helpers check it now, so no drip,
-- broadcast or nag can reach him after this runs.
update trainees
   set is_active_sales_rep  = false,
       became_active_rep_at = null,
       left_company_at      = now(),
       left_company_reason  = 'No response. Held from Week B pending a week of effort in the field and did not engage.',
       cleanup_done_at      = null,
       week_b_hold          = false,
       week_b_hold_reason   = null
 where last_name = 'Dethlefsen'
   and first_name = 'Bret';
-- BOTH of his records, deliberately. He is in the table twice — same phone
-- (727-744-5944) and same email, enrolled against two different classes. One is
-- the Zone 3 field trainee who was on hold; the other is an older row with no
-- region. Off-boarding only one leaves the other looking like a current trainee,
-- and he would keep turning up in class counts.
--
-- (Ten names are duplicated like this in the roster. Chris Hill and Todd Saylor
-- are the two where an active and an inactive record collide, which is what made
-- working reps read as departed on the deal boards.)

select first_name, last_name, region, is_active_sales_rep, left_company_at, left_company_reason, week_b_hold
  from trainees where last_name = 'Dethlefsen';
