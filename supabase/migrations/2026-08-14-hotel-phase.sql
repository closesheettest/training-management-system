-- Two-week training → a trainee needs TWO separate hotel bookings:
--   • Week A room: Mon + Tue night, checkout Wed (2 nights)
--   • Week B room: Mon–Thu nights, checkout Fri (4 nights)
-- with a gap between (they go home Thu–Sun of Week A for field-from-home).
--
-- The old unique (trainee_id, class_id) allowed only ONE booking per trainee per
-- class. Add a `phase` ('A' | 'B') and key uniqueness on it so each trainee can
-- hold an A room and a B room at the same time.
--
-- Safe to run more than once.

alter table trainee_hotel_stays add column if not exists phase text;

-- Existing single-week bookings are effectively the Week A room.
update trainee_hotel_stays set phase = 'A' where phase is null;

-- Swap the uniqueness key: (trainee, class) → (trainee, class, phase).
alter table trainee_hotel_stays drop constraint if exists trainee_hotel_stays_trainee_id_class_id_key;
alter table trainee_hotel_stays
  add constraint trainee_hotel_stays_trainee_class_phase_key unique (trainee_id, class_id, phase);
