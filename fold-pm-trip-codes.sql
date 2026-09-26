-- ============================================================
-- Fold "PM Trip Codes" (saved_pm_trip_codes — simple name list)
-- into "Trip Codes" (trip_codes — full configuration).
--
-- Run this BEFORE deploying the code that removes the old
-- PM Trip Codes tab, so nothing anyone already typed in there
-- goes missing from the Trip Code dropdown afterward.
--
-- Each old code is inserted as a normal (non-built-in) trip
-- code with no client attached, VAT-exclusive, and no fields —
-- exactly matching how it behaved before (a plain selectable
-- name with no extra structure). Existing trip_codes rows and
-- built-in names are left alone; nothing is overwritten.
--
-- Safe to re-run.
-- ============================================================
insert into public.trip_codes (code, client, vat_inclusive, fields, is_builtin, active)
select s.label, null, false, '[]'::jsonb, false, true
from public.saved_pm_trip_codes s
where not exists (
  select 1 from public.trip_codes t where lower(t.code) = lower(s.label)
);

-- ═══ VERIFY ═══
-- select code, client, is_builtin from public.trip_codes order by is_builtin desc, code;
-- Every label that was in saved_pm_trip_codes should now also appear here.
-- The old saved_pm_trip_codes table is left in place (unused after this),
-- so nothing is lost even if something needs to be checked later.
