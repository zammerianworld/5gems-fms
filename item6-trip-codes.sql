-- ============================================================
-- Item 6.1 — Configurable PM trip codes (Settings → Trip Codes)
-- Run this on its own — NOT part of the cumulative 5gems-setup.sql.
--
-- Adapted for 5 Gems: only 3 built-in codes (Hustling PSACC, Hauling
-- PSACC, SMC) — confirmed via PM_TRIP_CODES in src/lib/supabase.js and
-- the live CHECK constraint, both of which only ever allowed these 3.
-- DSTC's 4th built-in, Side Trip, does not exist here, so that seed
-- row is dropped entirely (not just commented out) rather than seeded
-- and never used.
--
-- Replaces the hardcoded trip_code CHECK constraint on trips_pm with a
-- `trip_codes` table. The 3 built-in codes are seeded as locked rows and keep
-- their hardcoded behavior in the app (their VAT rule is fixed in code, not
-- read from this table). New codes carry: client, VAT-inclusive rates flag,
-- and the list of inputs the trip form shows.
--
-- Does NOT modify any existing trip, invoice or client row.
-- Single transaction: any failure applies nothing.
-- ============================================================

begin;

-- 1. Table
create table if not exists public.trip_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  client text,                                   -- client nickname (trips store nickname)
  vat_inclusive boolean not null default false,  -- rates entered VAT-inclusive (like SMC)
  fields jsonb not null default '[]'::jsonb,      -- inputs shown on the trip form, in order
  is_builtin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.trip_codes (code, client, vat_inclusive, is_builtin) values
  ('Hustling PSACC', 'PSACC', false, true),
  ('Hauling PSACC',  'PSACC', false, true),
  ('SMC',            'SMC',   true,  true)
on conflict (code) do nothing;

-- 2. Custom input values on trips
alter table public.trips_pm
  add column if not exists custom_data jsonb not null default '{}'::jsonb;

-- 3. Swap the hardcoded CHECK for a foreign key to trip_codes.
--    ON UPDATE / DELETE RESTRICT: a code that has trips can't be renamed or
--    deleted, so no trip can ever end up pointing at a missing code.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.trips_pm'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%trip_code%'
  loop
    execute format('alter table public.trips_pm drop constraint %I', r.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'trips_pm_trip_code_fk') then
    alter table public.trips_pm
      add constraint trips_pm_trip_code_fk foreign key (trip_code)
      references public.trip_codes (code) on update restrict on delete restrict;
  end if;
end $$;

-- 4. Grants + RLS. Everyone logged in can read (the app needs it to
--    compute VAT, incl. viewer accounts on My Trips). Only admins can write,
--    and built-in rows can never be edited or deleted.
grant select on public.trip_codes to authenticated;
grant insert, update, delete on public.trip_codes to authenticated;
grant all on public.trip_codes to service_role;
revoke all on public.trip_codes from anon;
alter table public.trip_codes enable row level security;

drop policy if exists trip_codes_select on public.trip_codes;
create policy trip_codes_select on public.trip_codes for select to authenticated using (true);
drop policy if exists trip_codes_insert on public.trip_codes;
create policy trip_codes_insert on public.trip_codes for insert to authenticated
  with check (public.is_admin() and not is_builtin);
drop policy if exists trip_codes_update on public.trip_codes;
create policy trip_codes_update on public.trip_codes for update to authenticated
  using (public.is_admin() and not is_builtin) with check (public.is_admin() and not is_builtin);
drop policy if exists trip_codes_delete on public.trip_codes;
create policy trip_codes_delete on public.trip_codes for delete to authenticated
  using (public.is_admin() and not is_builtin);

-- 5. Global Search inside custom input values. SECURITY INVOKER (default),
--    so the caller's RLS still applies — viewers only see their own plates.
create or replace function public.search_pm_custom_data(term text)
returns setof public.trips_pm
language sql
stable
set search_path = public
as $$
  select * from public.trips_pm
  where deleted_at is null
    and custom_data <> '{}'::jsonb
    and custom_data::text ilike '%' || term || '%'
  order by trip_date desc
  limit 8
$$;
revoke all on function public.search_pm_custom_data(text) from public, anon;
grant execute on function public.search_pm_custom_data(text) to authenticated, service_role;

commit;

-- ═══ VERIFY ═══
-- select code, client, vat_inclusive, is_builtin from public.trip_codes order by code;   -- 3 rows
-- select conname from pg_constraint where conname = 'trips_pm_trip_code_fk';             -- 1 row
-- select count(*) from pg_constraint where conrelid = 'public.trips_pm'::regclass
--   and contype = 'c' and pg_get_constraintdef(oid) ilike '%trip_code%';                  -- 0

-- ============================================================
-- Follow-up to item 7b: now that trip_codes exists (created above),
-- this closes the loop flagged in item7b-permanent-delete.sql — adds
-- the trip_codes check to the clients guard in permanent_delete.
-- Run this right after the trip_codes creation above, same session.
-- ============================================================
CREATE OR REPLACE FUNCTION public.permanent_delete(p_table text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_rows int;
  v_nick text;
  v_full text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'superuser') then
    raise exception 'Unauthorized: admin or superuser required';
  end if;

  if p_table = 'trips_dump' then delete from public.trips_dump where id = p_id;
  elsif p_table = 'trips_pm' then delete from public.trips_pm where id = p_id;
  elsif p_table = 'invoices' then delete from public.invoices where id = p_id;
  elsif p_table = 'expenses' then delete from public.expenses where id = p_id;
  elsif p_table = 'orcr_records' then delete from public.orcr_records where id = p_id;
  elsif p_table = 'pdc_checks' then delete from public.pdc_checks where id = p_id;
  elsif p_table = 'clients' then
    select nickname, full_name into v_nick, v_full from public.clients where id = p_id;
    if v_nick is not null and (
         exists (select 1 from public.trips_dump where client in (v_nick, v_full))
      or exists (select 1 from public.trips_pm   where client in (v_nick, v_full))
      or exists (select 1 from public.invoices   where client in (v_nick, v_full))
      or exists (select 1 from public.trip_codes where client in (v_nick, v_full))
    ) then
      raise exception 'Client "%" still has trips, invoices or a trip code — reassign or remove those first', v_nick;
    end if;
    delete from public.clients where id = p_id;
  elsif p_table = 'extra_income' then delete from public.extra_income where id = p_id;
  elsif p_table = 'loans' then delete from public.loans where id = p_id;
  elsif p_table = 'cash_vouchers' then delete from public.cash_vouchers where id = p_id;
  elsif p_table = 'drivers' then delete from public.drivers where id = p_id;
  elsif p_table = 'trucks' then delete from public.trucks where id = p_id;
  elsif p_table = 'commodities' then delete from public.commodities where id = p_id;
  elsif p_table = 'signatories' then delete from public.signatories where id = p_id;
  elsif p_table = 'profiles' then delete from public.profiles where id = p_id;
  elsif p_table = 'check_vouchers' then delete from public.check_vouchers where id = p_id;
  elsif p_table = 'bank_templates' then delete from public.bank_templates where id = p_id;
  elsif p_table = 'saved_pm_trip_codes' then delete from public.saved_pm_trip_codes where id = p_id;
  elsif p_table = 'driver_rates' then delete from public.driver_rates where id = p_id;
  elsif p_table = 'driver_loans' then delete from public.driver_loans where id = p_id;
  elsif p_table = 'sss_brackets' then delete from public.sss_brackets where id = p_id;
  elsif p_table = 'philhealth_brackets' then delete from public.philhealth_brackets where id = p_id;
  elsif p_table = 'hdmf_brackets' then delete from public.hdmf_brackets where id = p_id;
  else raise exception 'Invalid table: %', p_table;
  end if;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  return v_rows > 0;
end;
$function$;
