-- Migration: rep <-> regional-manager SMS mirror (rep_messages).
--
-- WHY: team texts go out 1:1 through GoHighLevel (the company line), so
-- when a rep replies it lands in GHL's conversation inbox — a place the
-- regional manager never opens. Managers asked to see + answer those
-- replies from the ONE place they already use: their /regional-manager
-- portal. This table mirrors the conversation so the portal can render an
-- inbox and the manager can reply. GHL stays the source of truth (every
-- message is still in GHL); this is a convenience window into it.
--
-- WHAT LANDS HERE:
--   - direction='inbound'  : a rep's reply, pulled from GHL every minute by
--     the cron-poll-rep-replies function (we poll GHL's conversations API;
--     GHL's push/Workflow webhook wasn't usable on this account).
--   - direction='outbound' : a manager's reply, sent from the portal via
--     regional-manager-api send_reply (and pushed to GHL).
-- The original team blast is NOT logged here in v1 — the thread shows the
-- actual back-and-forth. (Add blast-context later if managers want it.)
--
-- REGION ROUTING: every row carries region (denormalized from the matched
-- trainee) so the manager portal can filter to its own region with one
-- indexed query, and so a reply from an unknown/edge phone (trainee_id
-- null) simply never surfaces to any manager rather than erroring.

create table if not exists rep_messages (
  id uuid primary key default gen_random_uuid(),

  -- The rep this conversation is with. Null when an inbound reply came
  -- from a phone we can't match to a trainee (parked, shown to nobody).
  trainee_id uuid references trainees(id) on delete set null,

  -- Denormalized region for fast, indexed manager-portal lookups. Null
  -- when trainee_id is null (unmatched sender).
  region text,

  -- 'inbound' = from the rep; 'outbound' = from the manager (or system).
  direction text not null check (direction in ('inbound', 'outbound')),

  -- The message text.
  body text not null default '',

  -- Phones as sent/received (for audit + matching). Stored verbatim.
  from_phone text,
  to_phone text,

  -- Who authored an outbound message: the manager's trainee id. Null for
  -- inbound. Lets the portal label "You" vs the rep.
  manager_id uuid references trainees(id) on delete set null,

  -- GHL identifiers. ghl_message_id makes the minute-by-minute poll
  -- idempotent — the poller re-scans an overlapping window, so a unique
  -- constraint dedupes messages it has already mirrored.
  ghl_message_id text,
  ghl_contact_id text,

  -- When the manager opened the thread. Null = unread (drives the badge).
  read_at timestamptz,

  created_at timestamptz not null default now()
);

-- Manager portal reads by (region, newest-first). Partial-free since both
-- inbound and outbound are shown in the thread.
create index if not exists rep_messages_region_created_idx
  on rep_messages (region, created_at desc);

-- Thread view + reply target lookups go by trainee.
create index if not exists rep_messages_trainee_created_idx
  on rep_messages (trainee_id, created_at desc);

-- Idempotency for the inbound poll. Unique only when an id is present
-- (outbound rows we author have none), so multiple null-id rows are fine.
create unique index if not exists rep_messages_ghl_message_id_uidx
  on rep_messages (ghl_message_id)
  where ghl_message_id is not null;

comment on table rep_messages is
  'Mirror of rep<->regional-manager SMS so the manager portal can show an inbox + reply. GHL remains source of truth. inbound=rep reply (cron-poll-rep-replies, polls GHL every minute), outbound=manager reply (regional-manager-api send_reply).';
