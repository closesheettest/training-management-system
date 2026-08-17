-- sql/training_days_track.sql
--
-- Split `training_days` into two independent tracks.
--
-- The table holds two different things that were only ever separated by
-- position: the in-home PRESENTATION (Slide 1 → Slide 23) and MANAGER-curriculum
-- material about free roof inspections and going back to retail, which has
-- nothing to do with the presentation and was showing up in the trainees'
-- homework (Neal, 2026-08-17).
--
-- It was capped at "position <= 17" as a stopgap. That's a magic number — add
-- one more manager item at position 21 and it lands in front of trainees again,
-- with nobody knowing why. A track makes the split explicit: new presentation
-- slides are included automatically, new manager items are excluded
-- automatically, and neither has to remember a number.
--
-- The homework page falls back to the position rule when this column is absent,
-- so the trainees' link keeps working whether or not this has been run.

alter table training_days
  add column if not exists track text not null default 'presentation';

-- The three that belong to the manager curriculum. Identified by what they are,
-- not by position: every presentation row carries a real slide reference in
-- `subject` ("Slide 1", "Slides 17–21"), while these carry a sentence.
update training_days
   set track = 'manager'
 where subject is null
    or subject !~ '^Slides?\s*[0-9]';

create index if not exists training_days_track_pos_idx on training_days (track, position);

-- Verify — expect 17 presentation, 3 manager:
--   select track, count(*), min(position), max(position)
--     from training_days group by track order by track;
