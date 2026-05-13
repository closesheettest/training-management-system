-- Migration: dedup stamp for the weekly graduation report.
--
-- The daily cron fires the report once per class after the class ends and
-- stamps this column so a second run on a later day doesn't double-email it.
-- Safe to re-run.

alter table classes
  add column if not exists graduation_report_sent_at timestamptz;
