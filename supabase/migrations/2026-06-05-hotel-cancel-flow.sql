-- Migration: hotel cancellation flow for no-show trainees.
--
-- Background: HR books a room for each "needs hotel" trainee (a row in
-- trainee_hotel_stays = "booked"). If that trainee then never signs into
-- class, the room is wasted money unless someone cancels it. We now nag
-- the HR/Admin no-show subscribers every hour until a human presses
-- "Cancelled Hotel" on the trainee — at which point the nag stops.
--
-- Two new columns on the stay row:
--   cancelled_at  — stamped when someone presses "Cancelled Hotel".
--                   While null AND the trainee is a no-show, the hourly
--                   nag keeps firing. Once set, the trainee is dropped
--                   from the nag list permanently.
--   cancel_nag_at — the last time the hourly "cancel this room" SMS went
--                   out for this stay. Used purely to throttle to one
--                   text per hour (so a double-fire of the cron doesn't
--                   double-text). Reset implicitly by the >55-min gate.

alter table trainee_hotel_stays
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_nag_at timestamptz;

-- Index the open (un-cancelled) bookings — the hourly cron filters on
-- "cancelled_at is null", so this keeps that scan cheap as stays pile up.
create index if not exists trainee_hotel_stays_open_idx
  on trainee_hotel_stays(class_id)
  where cancelled_at is null;
