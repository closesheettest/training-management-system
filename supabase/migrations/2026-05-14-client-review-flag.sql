-- Migration: add use_for_client_review flag to questions + test_responses.
--
-- The system now has two independent flags governing where essay answers
-- end up:
--
--   use_for_testimonial    → Neal Scoppettuolo's brand surfaces
--                             (auto FB + LinkedIn testimonial posts and
--                             the nealscoppettuolo.com testimonials feed).
--                             Copy must stay GENERIC — no client mentions.
--
--   use_for_client_review  → the client company's Google + Yelp reviews
--                             (the post-test review-request email's
--                             copy-paste blocks). U.S. Shingle-specific
--                             wording is welcome here — those reviews
--                             are *about* the client.
--
-- A question can be either, neither, or (rarely) both.
--
-- Same snapshot pattern as use_for_testimonial — we copy the flag into
-- test_responses at submission time so later edits to the question bank
-- don't rewrite history.

alter table questions
  add column if not exists use_for_client_review boolean not null default false;

alter table test_responses
  add column if not exists use_for_client_review boolean not null default false;
