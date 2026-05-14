-- Migration: queue table for paced social posts.
--
-- When a trainee submits a testimonial-eligible essay, instead of firing
-- the Facebook + LinkedIn posts immediately, the system queues them in
-- this table with a future scheduled_post_at. A daily cron at 9 AM
-- Eastern picks up the oldest due item per platform and posts it.
--
-- Result: a class of 12 trainees with 2 essays each produces ~24 days
-- of paced content instead of 24 simultaneous posts.

create table if not exists social_post_queue (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  trainee_id uuid references trainees(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'linkedin')),
  message text not null,
  photo_url text,
  -- When this item is eligible to post. Set at enqueue time to spread
  -- across days. Posted ASAP at or after this timestamp.
  scheduled_post_at timestamptz not null,
  -- Stamped after a successful post.
  posted_at timestamptz,
  -- Returned platform post ID after success.
  post_id text,
  -- Last error message if a post attempt failed (item stays queued).
  last_error text,
  created_at timestamptz not null default now()
);

-- Fast lookup for the daily flush cron.
create index if not exists social_post_queue_pending_idx
  on social_post_queue(platform, scheduled_post_at)
  where posted_at is null;
