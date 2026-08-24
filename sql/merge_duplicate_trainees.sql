-- sql/merge_duplicate_trainees.sql — RUN ON THE TMS DATABASE.
--
-- Seventeen people are in the trainees table twice. Nine of the pairs are one
-- batch created on 17 May with region "St Pete", shadowing richer records from
-- 12 May; the rest accumulated one at a time.
--
-- It is not cosmetic. The duplicates have already caused three separate
-- problems: Chris Hill and Todd Saylor read as DEPARTED on the deal boards
-- because a dead twin carried their name, Bret Dethlefsen needed off-boarding
-- twice, and any headcount that groups by person counts several people twice.
--
-- KEEPER RULE, applied in this order: has a JobNimbus id (that link is the hard
-- one to recreate), then is an active rep, then has the most fields filled in,
-- then has the most history behind it. Every pair below was checked by hand
-- against that rule.
--
-- History is MOVED, never dropped: attendance, test attempts and hotel stays are
-- repointed at the keeper first, and only a row whose day the keeper already has
-- is discarded — that is the same day recorded twice, not a second day.
--
-- Runs as ONE transaction. If anything references a duplicate that this does not
-- know about, the delete fails and the whole thing rolls back rather than
-- half-merging seventeen people.
begin;

create temporary table merge_map (keep uuid, drop_id uuid) on commit drop;
insert into merge_map (keep, drop_id) values
  ('b77dbb79-5a9d-4a96-a3f6-1ddf3c8bd0be'::uuid, '7483f360-e72d-417e-8365-1f889d57863e'::uuid)  -- Antonio Magaldi,
  ('41495441-df81-427b-b496-794cf3397108'::uuid, '9e7499e3-d8a4-4d62-abf6-a089f4854777'::uuid)  -- Ashley Eighmey,
  ('4309699f-0a8b-4552-b425-0625e2f7799c'::uuid, '5059a5a8-5b99-4112-b607-94369010eaac'::uuid)  -- Bret Dethlefsen,
  ('8d75567f-4d4e-4a1b-9cde-573b400472df'::uuid, 'efa7d720-6829-4114-848b-ea0ecdf0ee6b'::uuid)  -- Chip Williams,
  ('dd33fa73-4802-4878-9417-1a2895f42b2e'::uuid, '9ec6a208-1edc-4a93-98b7-d48c8ba3bde2'::uuid)  -- Chris Hill,
  ('84b3b88e-51d5-4b08-a074-7c0fd1e2f9bd'::uuid, '9c2ece53-9a3b-4d70-acce-2085766f501a'::uuid)  -- Eric Wendt,
  ('58c84e07-922c-4a91-843a-727f4336773d'::uuid, 'bfb7f2ac-e61d-4f31-b72d-b62009b6b264'::uuid)  -- James Morrison,
  ('983aa03b-7805-4555-a527-5042ab257e70'::uuid, '9d7f38b4-039f-4f21-8d2a-eae026638709'::uuid)  -- Jena Woodrell,
  ('b4bd1019-f6d4-445a-abd2-6c7115e2ec5d'::uuid, '72a1aa89-29d7-4562-be53-2a47cd7623f2'::uuid)  -- Joel Solar,
  ('5b8b523c-2183-42fe-bce9-d13c625e5186'::uuid, '1623ad22-9258-4b7d-84b7-bf9524b609c7'::uuid)  -- Pete Pfeiffer,
  ('2840b801-d6f0-45fe-9b19-77f8d27b7d35'::uuid, '8f2bde09-8dc1-4424-ad72-0b1b32fd6aaa'::uuid)  -- Richenader Dort,
  ('5737cee9-54ec-4389-bdd1-f746a123ba55'::uuid, '283d0f06-e1da-4cdd-9c14-b9ee621f3bb9'::uuid)  -- Robert Jurado,
  ('e24dd99e-5173-43fa-963d-7028b3db5c33'::uuid, '87d2cd8a-979b-46b9-8a47-49acd057d371'::uuid)  -- Sahid Helo,
  ('e14dfdf3-b444-4608-a10f-2a3a75af1ce7'::uuid, 'b21f2cae-0ebd-4fd0-a8b2-afd9519754f1'::uuid)  -- Timothy Cryderman,
  ('e4d3d8b3-4d92-409a-b251-dd8a5bd26a47'::uuid, 'ea4064df-0b31-42f6-98a9-234794e95f8f'::uuid)  -- Todd Saylor,
  ('62c3256a-5b55-42c8-9d13-4267fae113c1'::uuid, '1673d6c5-6dae-40a3-9733-f0632f4ab009'::uuid)  -- Verina Abdelmassieh,
  ('fc070fc5-a502-4b20-ae99-b50b1dd4c63a'::uuid, '2ba18a26-29bd-4b50-af04-5f52e5814dce'::uuid)  -- Winston Stutsman;

-- 1. Attendance the keeper does NOT already have for that day.
update attendance a
   set trainee_id = m.keep
  from merge_map m
 where a.trainee_id = m.drop_id
   and not exists (
     select 1 from attendance k
      where k.trainee_id = m.keep
        and k.attendance_date = a.attendance_date
   );

-- 2. Whatever is left is the same day recorded against both rows.
delete from attendance a using merge_map m where a.trainee_id = m.drop_id;

-- 3. Test attempts and hotel stays follow the person.
update test_attempts       t set trainee_id = m.keep from merge_map m where t.trainee_id = m.drop_id;
update trainee_hotel_stays h set trainee_id = m.keep from merge_map m where h.trainee_id = m.drop_id;

-- 4. The duplicate row itself, now carrying nothing.
delete from trainees t using merge_map m where t.id = m.drop_id;

commit;

-- Should return no rows: nobody left in the table twice.
select lower(trim(first_name)) || ' ' || lower(trim(last_name)) as who, count(*)
  from trainees
 group by 1 having count(*) > 1
 order by 2 desc;
