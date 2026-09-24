-- Sales Training Customer: one row per practice presentation a trainee gives
-- to an AI homeowner (page /sales-practice, trainer-only). Written and read only
-- by the practice-api / practice-grade-background functions with the secret key,
-- so RLS is on with no policies: the browser never touches this table directly.
create table if not exists sales_practice_sessions (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid references trainees(id) on delete set null,
  trainee_name text,                -- kept even if the trainee row goes
  class_id uuid references classes(id) on delete set null,
  trainer_name text,                -- who ran it (their PinGate sign-in name)
  persona_key text not null,
  section text not null,            -- full | survey | why_today | close
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_sec integer,
  transcript jsonb not null default '[]'::jsonb,  -- [{who:'rep'|'homeowner'|'slide', text, at}]
  close_silence jsonb,              -- {held:bool, seconds:number} measured at the ask
  grade_status text not null default 'pending',   -- pending | done | failed
  grade_error text,
  score integer,                    -- 0-100
  report jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sales_practice_sessions_trainee_idx on sales_practice_sessions(trainee_id, started_at desc);
create index if not exists sales_practice_sessions_started_idx on sales_practice_sessions(started_at desc);
alter table sales_practice_sessions enable row level security;
