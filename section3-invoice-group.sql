-- ============================================================
-- Port to 5 Gems — Part 2, Section 3: Invoice Group field
-- Run this on its own — NOT part of the cumulative 5gems-setup.sql,
-- so it doesn't need the rest of that script re-run alongside it.
-- Safe to re-run (IF NOT EXISTS guard).
-- ============================================================
alter table public.trucks add column if not exists invoice_group text default '';
