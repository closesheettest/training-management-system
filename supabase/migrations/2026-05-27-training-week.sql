-- Migration: Training Week — daily homework SMS + mini-quiz infra.
--
-- Phase 1 of the "daily homework + morning quiz" feature. THIS MIGRATION
-- ONLY ADDS TABLES + SEED ROWS. The triggers (nightly cron + kiosk hook)
-- come in Phase 2 once admin has populated some content.
--
-- Design:
--   • Single shared template across all classes. One set of "Day 1 / Day
--     2 / ..." content used for every training week. Per-class overrides
--     can come later if needed.
--   • Quiz questions are multiple-choice only (mirrors the existing
--     end-of-week test) — speeds up authoring and grading.
--   • Per-trainee attempt log so we can see "11/12 completed Day 1 quiz,
--     avg score 4.2/5" and drill down to individual responses.

-- ============================================================
-- 1. training_day_lessons — one row per day-of-training (1..N).
--    Day 1 = first day of every class's training week.
--    Seeded below with 5 empty rows so the admin UI has something to
--    edit; admin fills in the sms body / link / questions as they go.
-- ============================================================
create table if not exists training_day_lessons (
  day_number int primary key,
  -- Friendly label for the admin UI ("Day 1 — Door pitch homework").
  label text,
  -- The SMS body that gets sent at end-of-day. Supports {firstName}
  -- substitution (same convention as message_templates / group-messages).
  homework_sms_body text,
  -- Where the homework SMS link points. Relative path (/sales-pitch/) or
  -- absolute URL. Stored separate from the SMS body so admin can change
  -- the destination without re-typing the message.
  homework_link_url text,
  -- Optional notes for the admin themselves (not sent anywhere).
  admin_notes text,
  -- Soft-disable toggle. When false, the cron in Phase 2 will skip this
  -- day even if the body is filled in. Useful for testing one day at a
  -- time without wiping content.
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. training_day_quiz_questions — multiple-choice questions for the
--    morning quiz that fires on kiosk sign-in for the PREVIOUS day's
--    content. 3-5 questions per day is the sweet spot per the spec.
-- ============================================================
create table if not exists training_day_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  day_number int not null references training_day_lessons(day_number) on delete cascade,
  -- Display order within the day's quiz.
  position int not null default 0,
  question_text text not null,
  -- Stored as a JSON array of strings: ["First option", "Second option", ...].
  -- Index into this array is what `correct_index` references.
  options jsonb not null default '[]'::jsonb,
  -- Zero-based index into `options` for the correct answer.
  correct_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. training_day_attempts — per-trainee log of homework sent + quiz
--    sent/completed/scored. UNIQUE on (trainee_id, day_number) since
--    a trainee should only ever attempt a given day once.
-- ============================================================
create table if not exists training_day_attempts (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references trainees(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  day_number int not null references training_day_lessons(day_number) on delete restrict,
  -- Nightly cron stamps this when the homework SMS goes out.
  homework_sent_at timestamptz,
  -- Kiosk sign-in stamps these when the morning quiz SMS goes out.
  -- quiz_token is the random URL token for /quiz/<token>.
  quiz_token text unique,
  quiz_sent_at timestamptz,
  quiz_started_at timestamptz,
  quiz_completed_at timestamptz,
  -- Score = count correct out of count asked. Both nullable until quiz
  -- is completed.
  quiz_score int,
  quiz_total int,
  -- Snapshot of submitted answers for audit. Shape:
  -- [{"question_id":"...", "selected_index":2, "is_correct":true}, ...]
  quiz_answers jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainee_id, day_number)
);

-- Indexes — both the cron and the kiosk hook query by class + day, so
-- index those. quiz_token gets a unique index automatically from the
-- column constraint.
create index if not exists training_day_quiz_questions_day_pos_idx
  on training_day_quiz_questions(day_number, position);
create index if not exists training_day_attempts_class_day_idx
  on training_day_attempts(class_id, day_number);
create index if not exists training_day_attempts_trainee_idx
  on training_day_attempts(trainee_id);

-- RLS — same open-anon pattern as the rest of the app. The app has no
-- auth; the admin UI is hidden behind persona-based nav filtering and
-- the token-gated /quiz/<token> page validates its token server-side
-- when Phase 2 wires up the public route.
alter table training_day_lessons enable row level security;
alter table training_day_quiz_questions enable row level security;
alter table training_day_attempts enable row level security;

drop policy if exists "training_day_lessons_public_select" on training_day_lessons;
drop policy if exists "training_day_lessons_public_insert" on training_day_lessons;
drop policy if exists "training_day_lessons_public_update" on training_day_lessons;
drop policy if exists "training_day_lessons_public_delete" on training_day_lessons;
create policy "training_day_lessons_public_select" on training_day_lessons for select using (true);
create policy "training_day_lessons_public_insert" on training_day_lessons for insert with check (true);
create policy "training_day_lessons_public_update" on training_day_lessons for update using (true);
create policy "training_day_lessons_public_delete" on training_day_lessons for delete using (true);

drop policy if exists "training_day_quiz_questions_public_select" on training_day_quiz_questions;
drop policy if exists "training_day_quiz_questions_public_insert" on training_day_quiz_questions;
drop policy if exists "training_day_quiz_questions_public_update" on training_day_quiz_questions;
drop policy if exists "training_day_quiz_questions_public_delete" on training_day_quiz_questions;
create policy "training_day_quiz_questions_public_select" on training_day_quiz_questions for select using (true);
create policy "training_day_quiz_questions_public_insert" on training_day_quiz_questions for insert with check (true);
create policy "training_day_quiz_questions_public_update" on training_day_quiz_questions for update using (true);
create policy "training_day_quiz_questions_public_delete" on training_day_quiz_questions for delete using (true);

drop policy if exists "training_day_attempts_public_select" on training_day_attempts;
drop policy if exists "training_day_attempts_public_insert" on training_day_attempts;
drop policy if exists "training_day_attempts_public_update" on training_day_attempts;
drop policy if exists "training_day_attempts_public_delete" on training_day_attempts;
create policy "training_day_attempts_public_select" on training_day_attempts for select using (true);
create policy "training_day_attempts_public_insert" on training_day_attempts for insert with check (true);
create policy "training_day_attempts_public_update" on training_day_attempts for update using (true);
create policy "training_day_attempts_public_delete" on training_day_attempts for delete using (true);

-- ============================================================
-- Seed: 5 empty day_lesson rows so the admin UI has something to edit.
-- enabled=false on each so the Phase 2 cron will skip them until admin
-- explicitly flips the toggle after authoring content. Labels are
-- placeholders — admin can rename in the UI.
-- ============================================================
insert into training_day_lessons (day_number, label, enabled) values
  (1, 'Day 1 — Intro / company / apps', false),
  (2, 'Day 2 — Door pitch homework', false),
  (3, 'Day 3 — In-home sales script', false),
  (4, 'Day 4 — Objection handling', false),
  (5, 'Day 5 — Test prep', false)
on conflict (day_number) do nothing;
