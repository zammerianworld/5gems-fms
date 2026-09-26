-- ============================================================
-- Item 7b: client-in-use guard on permanent_delete
-- Run this on its own — NOT part of the cumulative 5gems-setup.sql.
-- Safe to re-run (CREATE OR REPLACE).
--
-- Note: the trip_codes check from the original porting doc is NOT
-- included here, since item 6 (configurable trip codes) hasn't been
-- done yet as of this file — that table doesn't exist. This function
-- will need one more update once item 6's SQL runs, to add:
--   or exists (select 1 from public.trip_codes where client in (v_nick, v_full))
-- to the clients guard below.
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
    ) then
      raise exception 'Client "%" still has trips or invoices — reassign or remove those first', v_nick;
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
