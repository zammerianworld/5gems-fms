-- ============================================================
-- 5 GEMS TRUCKING SERVICES -- FULL DATABASE SETUP
-- Consolidated from DSTC's supabase-setup.sql + add-viewer-role.sql +
-- fix-performance-indexes.sql + create-historical-payments.sql, PLUS
-- untracked live schema drift reconciled July 2026 (payroll module,
-- company loans, PDC checks, expense stocks, PIN lockout, invoice/
-- payroll locking, remarks_color, custom permissions).
--
-- Run entire script once in a NEW Supabase project's SQL editor.
-- Safe to re-run -- uses IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
--
-- STRIPPED FROM THE ORIGINAL DSTC FILES (do not carry over):
--   - DSTC's own bank account details (Security Bank template insert)
--   - DSTC's SMC client seed row (commented out -- see note below)
--   - DSTC's Q1 2026 audited payment figures (historical_payments insert)
--   - company_name default (blank here -- set in Phase 2 branding step)
--   - Payroll signatory name defaults (were Ken's own staff -- blanked)
--
-- RESOLVED: Ken confirmed SMC and the PSACC trip codes (Hustling PSACC /
--   Hauling PSACC) are shared with DSTC's setup -- SMC client seed is now
--   active below. PSACC needed no schema change (already generic enum
--   values on trips_pm.trip_code in the base schema).
--
-- FLAG FOR KEN #2: payroll_employees/payroll_entries/payroll_cash_advances
--   SELECT policies allow the 'anon' role on live DSTC (not just
--   'authenticated') -- unusual for payroll data. Preserved here for
--   parity with the working system, but worth a deliberate decision
--   for 5 Gems rather than carrying it over silently.
-- ============================================================

-- ============================================================
-- DRAGON SPEED TRUCKING — FULL DATABASE SETUP v2
-- Run entire script in Supabase SQL Editor
-- Safe to re-run — uses IF NOT EXISTS and ON CONFLICT DO NOTHING
-- ============================================================

-- PROFILES
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text, full_name text,
  role text default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'staff'))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- COMPANY SETTINGS (single row)
create table if not exists public.company_settings (
  id int primary key default 1 check (id = 1),
  company_name text default '5 Gems Trucking Corp.',
  vat_tin text default '',
  address text default 'Purok 2, Brgy. Tologan, Hagonoy, Davao del Sur',
  contact text default '09392282119',
  email text default 'kimberlyconcepciontorrecampo@gmail.com',
  prepared_by_name text default '',
  prepared_by_title text default 'VP for Finance / Treasurer',
  noted_by_name text default '',
  noted_by_title text default 'President',
  updated_at timestamptz default now()
);
insert into public.company_settings (id) values (1) on conflict (id) do nothing;

-- COMMODITIES
create table if not exists public.commodities (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  created_at timestamptz default now()
);
insert into public.commodities (name) values
  ('Sand'),('Gravel'),('Crushed Stone'),('Fill Soil'),
  ('Riprap'),('Cement Bags'),('Steel Bars'),('Lumber'),('Equipment'),('Others')
on conflict (name) do nothing;

-- TRUCKS
create table if not exists public.trucks (
  id uuid default gen_random_uuid() primary key,
  plate text unique not null,
  truck_code text,
  truck_type text not null check (truck_type in ('Dump Truck', 'Prime Mover')),
  make text, model text, year text, notes text,
  active boolean default true,
  created_at timestamptz default now()
);

-- CLIENTELE
create table if not exists public.clients (
  id uuid default gen_random_uuid() primary key,
  nickname text not null,
  full_name text not null,
  address text default '',
  tin text default '',
  contact text default '',
  created_at timestamptz default now()
);
insert into public.clients (nickname, full_name, address, tin, contact)
  values
    ('SMC', 'SMC SHIPPING AND LIGHTERAGE CORPORATION', 'SMC WHARF, LOOC, MANDAUE CITY 6014', '000-190-742-00001', ''),
    ('PSACC', 'PHILIPPINE SPAN ASIA CARRIER CORPORATION', '', '', '')
on conflict do nothing;

-- SAVED ROUTES
create table if not exists public.saved_routes (
  id uuid default gen_random_uuid() primary key,
  label text unique not null
);

-- SAVED RATES
create table if not exists public.saved_rates (
  id uuid default gen_random_uuid() primary key,
  truck_type text,
  rate numeric(12,2) not null,
  unique(truck_type, rate)
);

-- DUMP TRUCK TRIPS
create table if not exists public.trips_dump (
  id uuid default gen_random_uuid() primary key,
  trip_date date not null,
  truck_plate text not null,
  route text not null,
  client text not null,
  commodity text not null,
  smcsl_wb text default '',
  supplier_doc_ref text default '',
  island_zone_origin text default 'MIN',
  island_origin_code text default '',
  island_zone_dest text default 'MIN',
  island_dest_code text default 'MIN Davao Plant',
  weight_tons numeric(10,3) default 0,
  rmsd_smfi_saf_dr text default '',
  sto_no text default '',
  rate_per_ton numeric(12,2) default 0,
  remarks text default '',
  invoice_id uuid,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

-- PRIME MOVER TRIPS
create table if not exists public.trips_pm (
  id uuid default gen_random_uuid() primary key,
  trip_date date not null,
  truck_plate text not null,
  trip_code text not null check (trip_code in ('Hustling PSACC', 'Hauling PSACC', 'SMC')),
  container_size text check (container_size in ('40ft', '20ft')),
  containers jsonb default '[]',
  -- Hustling PSACC
  waybill_no text default '',
  vessel text default '',
  cts_no text default '',
  van_status text default '',
  -- Hauling PSACC
  voyage text default '',
  emr_date date,
  date_completion date,
  consignee text default '',
  emr_no text default '',
  bl_no text default '',
  -- SMC
  smcsl_waybill_no text default '',
  supplier_doc text default '',
  transaction_type text default 'TD',
  port_origin text default '',
  port_destination text default '',
  shipper_address text default '',
  consignee_address text default '',
  seal_no text default '',
  commodity text default '',
  -- Amounts
  supplier_amount numeric(12,2) default 0,
  stripping_fee numeric(12,2) default 0,
  remarks text default '',
  invoice_id uuid,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

-- INVOICES
create table if not exists public.invoices (
  id uuid default gen_random_uuid() primary key,
  invoice_no text unique not null,
  invoice_date date not null,
  truck_type text not null,
  trip_code text default '',
  client text not null,
  billing_period_start date,
  billing_period_end date,
  total_sales_net numeric(12,2) default 0,
  status text default 'Invoiced' check (status in ('Invoiced', 'Paid', 'Returned', 'On Hold')),
  actual_amount_credited numeric(12,2),
  date_credited date,
  remarks text default '',
  created_by uuid references auth.users,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- EXPENSES
create table if not exists public.expenses (
  id uuid default gen_random_uuid() primary key,
  expense_date date not null, category text not null,
  description text not null, amount numeric(12,2) default 0,
  expense_type text default 'operation' check (expense_type in ('admin', 'operation')),
  scope text default 'all' check (scope in ('all', 'individual')),
  truck_id text, reference_no text, remarks text,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);
-- Add expense_type column if upgrading from previous version
alter table public.expenses add column if not exists expense_type text default 'operation';

-- FINANCES
create table if not exists public.finances (
  id uuid default gen_random_uuid() primary key,
  finance_date date not null, type text not null check (type in ('income', 'expense')),
  category text not null, description text not null, amount numeric(12,2) default 0,
  reference_no text, remarks text,
  created_by uuid references auth.users, created_at timestamptz default now()
);

-- VOUCHERS
create table if not exists public.vouchers (
  id uuid default gen_random_uuid() primary key,
  voucher_no text unique not null, voucher_date date not null,
  payee text not null, bank text not null, account_no text, check_no text,
  amount numeric(12,2) default 0, amount_in_words text, particulars text,
  status text default 'pending' check (status in ('pending', 'released', 'cleared', 'cancelled')),
  created_by uuid references auth.users, created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.company_settings enable row level security;
alter table public.commodities enable row level security;
alter table public.trucks enable row level security;
alter table public.clients enable row level security;
alter table public.saved_routes enable row level security;
alter table public.saved_rates enable row level security;
alter table public.trips_dump enable row level security;
alter table public.trips_pm enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.finances enable row level security;
alter table public.vouchers enable row level security;

create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles 
    where id = auth.uid() and role in ('admin', 'superuser')
  );
$$ language sql security definer;

-- Drop existing policies first (safe to re-run)
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "settings_select" on public.company_settings;
drop policy if exists "settings_update" on public.company_settings;
drop policy if exists "comm_select" on public.commodities;
drop policy if exists "comm_insert" on public.commodities;
drop policy if exists "comm_delete" on public.commodities;
drop policy if exists "trucks_select" on public.trucks;
drop policy if exists "trucks_write" on public.trucks;
drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_write" on public.clients;
drop policy if exists "routes_all" on public.saved_routes;
drop policy if exists "rates_all" on public.saved_rates;
drop policy if exists "dump_all" on public.trips_dump;
drop policy if exists "pm_all" on public.trips_pm;
drop policy if exists "inv_select" on public.invoices;
drop policy if exists "inv_write" on public.invoices;
drop policy if exists "exp_all" on public.expenses;
drop policy if exists "exp_select" on public.expenses;
drop policy if exists "exp_insert" on public.expenses;
drop policy if exists "exp_update" on public.expenses;
drop policy if exists "exp_delete" on public.expenses;
drop policy if exists "fin_all" on public.finances;
drop policy if exists "vouch_all" on public.vouchers;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (auth.role() = 'authenticated');
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);
drop policy if exists "settings_select" on public.company_settings;
create policy "settings_select" on public.company_settings for select using (auth.role() = 'authenticated');
drop policy if exists "settings_update" on public.company_settings;
create policy "settings_update" on public.company_settings for update using (public.is_admin());
drop policy if exists "comm_select" on public.commodities;
create policy "comm_select" on public.commodities for select using (auth.role() = 'authenticated');
drop policy if exists "comm_insert" on public.commodities;
create policy "comm_insert" on public.commodities for insert with check (auth.role() = 'authenticated');
drop policy if exists "comm_delete" on public.commodities;
create policy "comm_delete" on public.commodities for delete using (auth.role() = 'authenticated');
drop policy if exists "trucks_select" on public.trucks;
create policy "trucks_select" on public.trucks for select using (auth.role() = 'authenticated');
drop policy if exists "trucks_write" on public.trucks;
create policy "trucks_write" on public.trucks for all using (auth.role() = 'authenticated');
drop policy if exists "clients_select" on public.clients;
create policy "clients_select" on public.clients for select using (auth.role() = 'authenticated');
drop policy if exists "clients_write" on public.clients;
create policy "clients_write" on public.clients for all using (public.is_admin());
drop policy if exists "routes_all" on public.saved_routes;
create policy "routes_all" on public.saved_routes for all using (auth.role() = 'authenticated');
drop policy if exists "rates_all" on public.saved_rates;
create policy "rates_all" on public.saved_rates for all using (auth.role() = 'authenticated');
drop policy if exists "dump_all" on public.trips_dump;
create policy "dump_all" on public.trips_dump for all using (auth.role() = 'authenticated');
drop policy if exists "pm_all" on public.trips_pm;
create policy "pm_all" on public.trips_pm for all using (auth.role() = 'authenticated');
drop policy if exists "inv_select" on public.invoices;
create policy "inv_select" on public.invoices for select using (auth.role() = 'authenticated');
drop policy if exists "inv_write" on public.invoices;
create policy "inv_write" on public.invoices for all using (auth.role() = 'authenticated');
-- All authenticated users can select expenses
drop policy if exists "exp_select" on public.expenses;
create policy "exp_select" on public.expenses for select using (auth.role() = 'authenticated');
-- All authenticated users can insert expenses
drop policy if exists "exp_insert" on public.expenses;
create policy "exp_insert" on public.expenses for insert with check (auth.role() = 'authenticated');
-- All authenticated users can update expenses
drop policy if exists "exp_update" on public.expenses;
create policy "exp_update" on public.expenses for update using (auth.role() = 'authenticated');
-- Only admin/superuser can delete expenses
drop policy if exists "exp_delete" on public.expenses;
create policy "exp_delete" on public.expenses for delete using (public.is_admin());
drop policy if exists "fin_all" on public.finances;
create policy "fin_all" on public.finances for all using (public.is_admin());
drop policy if exists "vouch_all" on public.vouchers;
create policy "vouch_all" on public.vouchers for all using (public.is_admin());

create index if not exists idx_dump_date on public.trips_dump(trip_date);
create index if not exists idx_dump_client on public.trips_dump(client);
create index if not exists idx_dump_plate on public.trips_dump(truck_plate);
create index if not exists idx_dump_invoice on public.trips_dump(invoice_id);
create index if not exists idx_pm_date on public.trips_pm(trip_date);
create index if not exists idx_pm_plate on public.trips_pm(truck_plate);
create index if not exists idx_pm_invoice on public.trips_pm(invoice_id);
create index if not exists idx_inv_no on public.invoices(invoice_no);
create index if not exists idx_inv_status on public.invoices(status);

-- After running: go to Auth > Users > Add user, then:
-- update public.profiles set role = 'admin' where email = 'YOUR_EMAIL';

-- ============================================================
-- PATCH: Add missing columns to invoices table (safe to run)
-- ============================================================
alter table public.invoices add column if not exists actual_amount_credited numeric(12,2);
alter table public.invoices add column if not exists date_credited date;
alter table public.invoices add column if not exists updated_at timestamptz default now();

-- ============================================================
-- PATCH: Amortization and Insurance tables
-- ============================================================
create table if not exists public.amortizations (
  id uuid default gen_random_uuid() primary key,
  truck_id uuid references public.trucks(id) on delete cascade,
  description text not null,
  monthly_amount numeric(12,2) not null,
  start_date text not null,
  end_date text,
  remarks text,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

create table if not exists public.insurances (
  id uuid default gen_random_uuid() primary key,
  insurance_type text not null check (insurance_type in ('Cargo Insurance', 'Own Damage Insurance')),
  description text not null,
  annual_amount numeric(12,2) not null,
  start_date date not null,
  truck_ids jsonb default '[]',
  remarks text,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

alter table public.amortizations enable row level security;
alter table public.insurances enable row level security;

drop policy if exists "amort_all" on public.amortizations;
drop policy if exists "amort_select" on public.amortizations;
drop policy if exists "amort_write" on public.amortizations;
drop policy if exists "ins_all" on public.insurances;
drop policy if exists "ins_select" on public.insurances;
drop policy if exists "ins_write" on public.insurances;

-- All authenticated users can read amortizations and insurances
drop policy if exists "amort_select" on public.amortizations;
create policy "amort_select" on public.amortizations for select using (auth.role() = 'authenticated');
drop policy if exists "amort_write" on public.amortizations;
create policy "amort_write" on public.amortizations for all using (public.is_admin());
drop policy if exists "ins_select" on public.insurances;
create policy "ins_select" on public.insurances for select using (auth.role() = 'authenticated');
drop policy if exists "ins_write" on public.insurances;
create policy "ins_write" on public.insurances for all using (public.is_admin());

-- Add expense_type column if not exists
alter table public.expenses add column if not exists expense_type text default 'operation';

-- ============================================================
-- PATCH v3: Additional signatory columns for reports
-- ============================================================
alter table public.company_settings
  add column if not exists mgmt_prepared_by_name text default '',
  add column if not exists mgmt_prepared_by_title text default '',
  add column if not exists mgmt_noted_by_name text default '',
  add column if not exists mgmt_noted_by_title text default '',
  add column if not exists bk_prepared_by_name text default '',
  add column if not exists bk_prepared_by_title text default '',
  add column if not exists bk_noted_by_name text default '',
  add column if not exists bk_noted_by_title text default '',
  add column if not exists aging_prepared_by_name text default '',
  add column if not exists aging_prepared_by_title text default '',
  add column if not exists aging_noted_by_name text default '',
  add column if not exists aging_noted_by_title text default '';

-- ============================================================
-- PATCH v4: 19-item fix batch
-- ============================================================

-- Add client column to trips_pm
alter table public.trips_pm add column if not exists client text default '';

-- Add policy_no to insurances
alter table public.insurances add column if not exists policy_no text default '';

-- Rename insurance type (update existing data)
update public.insurances set insurance_type = 'Own Damage Insurance' where insurance_type = 'On-Damage Insurance';

-- Drivers table
create table if not exists public.drivers (
  id uuid default gen_random_uuid() primary key,
  driver_name text not null,
  truck_id uuid references public.trucks(id) on delete set null,
  notes text default '',
  active boolean default true,
  created_at timestamptz default now()
);

alter table public.drivers enable row level security;
drop policy if exists "drivers_select" on public.drivers;
drop policy if exists "drivers_write" on public.drivers;
drop policy if exists "drivers_select" on public.drivers;
create policy "drivers_select" on public.drivers for select using (auth.role() = 'authenticated');
drop policy if exists "drivers_write" on public.drivers;
create policy "drivers_write" on public.drivers for all using (public.is_admin());

-- Add maintenance_category to expenses for sub-classification
alter table public.expenses add column if not exists maintenance_category text default '';

-- Add username column to profiles for passwordless email login
alter table public.profiles add column if not exists username text unique;

-- PATCH: Fix insurance_type check constraint to allow 'Own Damage Insurance'
alter table public.insurances drop constraint if exists insurances_insurance_type_check;
alter table public.insurances add constraint insurances_insurance_type_check
  check (insurance_type in ('Cargo Insurance', 'Own Damage Insurance'));
-- Update any old data
update public.insurances set insurance_type = 'Own Damage Insurance' where insurance_type = 'On-Damage Insurance';

-- PATCH: Add logo_url to company_settings
alter table public.company_settings add column if not exists logo_url text default '';

-- CRITICAL: Fix insurance check constraint
alter table public.insurances drop constraint if exists insurances_insurance_type_check;
alter table public.insurances add constraint insurances_insurance_type_check
  check (insurance_type in ('Cargo Insurance', 'Own Damage Insurance'));
update public.insurances set insurance_type = 'Own Damage Insurance' where insurance_type = 'On-Damage Insurance';

-- ============================================================
-- PATCH v5: Fix num_20ft column and other missing columns
-- ============================================================
alter table public.trips_pm add column if not exists num_20ft integer default 1;
alter table public.trips_pm add column if not exists client text default '';
alter table public.trips_pm add column if not exists voyage text default '';
alter table public.trips_pm add column if not exists consignee text default '';
alter table public.trips_pm add column if not exists supplier_doc text default '';
alter table public.trips_pm add column if not exists port_origin text default '';
alter table public.trips_pm add column if not exists port_destination text default '';
alter table public.trips_pm add column if not exists shipper_address text default '';
alter table public.trips_pm add column if not exists consignee_address text default '';
alter table public.trips_pm add column if not exists smcsl_waybill_no text default '';
alter table public.trips_pm add column if not exists transaction_type text default 'TD';

-- ============================================================
-- PATCH: Swap island zone and code columns (data was entered backwards)
-- ============================================================
-- Proper swap using temp column
ALTER TABLE public.trips_dump ADD COLUMN IF NOT EXISTS _tmp_zone text;

-- Swap origin: zone_origin <-> origin_code
UPDATE public.trips_dump SET _tmp_zone = island_zone_origin;
UPDATE public.trips_dump SET island_zone_origin = island_origin_code;
UPDATE public.trips_dump SET island_origin_code = _tmp_zone;

-- Swap dest: zone_dest <-> dest_code
UPDATE public.trips_dump SET _tmp_zone = island_zone_dest;
UPDATE public.trips_dump SET island_zone_dest = island_dest_code;
UPDATE public.trips_dump SET island_dest_code = _tmp_zone;

-- Clean up temp column
ALTER TABLE public.trips_dump DROP COLUMN IF EXISTS _tmp_zone;

-- ============================================================
-- PATCH: Login logs table
-- ============================================================
create table if not exists public.login_logs (
  id uuid default gen_random_uuid() primary key,
  user_name text not null,
  user_role text not null,
  email text default '',
  status text not null check (status in ('success', 'failed')),
  device text default '',
  browser text default '',
  ip_address text default '',
  created_at timestamptz default now()
);

alter table public.login_logs enable row level security;
drop policy if exists "logs_select" on public.login_logs;
create policy "logs_select" on public.login_logs for select using (auth.role() = 'authenticated');
drop policy if exists "logs_insert" on public.login_logs;
create policy "logs_insert" on public.login_logs for insert with check (true);

-- ============================================================
-- PATCH: Check Vouchers and Bank Templates
-- ============================================================
create table if not exists public.bank_templates (
  id uuid default gen_random_uuid() primary key,
  bank_name text not null,
  account_name text default '',
  account_number text default '',
  branch text default '',
  check_width_mm numeric default 215.9,
  check_height_mm numeric default 88.9,
  -- Field positions (in mm from top-left of check)
  date_x numeric default 150,
  date_y numeric default 12,
  payee_x numeric default 25,
  payee_y numeric default 28,
  amount_figures_x numeric default 160,
  amount_figures_y numeric default 28,
  amount_words_x numeric default 15,
  amount_words_y numeric default 38,
  amount_words_x2 numeric default 15,
  amount_words_y2 numeric default 45,
  signature_x numeric default 140,
  signature_y numeric default 68,
  -- Font sizes
  font_size_date numeric default 9,
  font_size_payee numeric default 10,
  font_size_amount numeric default 10,
  font_size_words numeric default 9,
  -- Background image (base64 or URL of voided check scan)
  check_bg_image text default '',
  is_default boolean default false,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.check_vouchers (
  id uuid default gen_random_uuid() primary key,
  voucher_no text not null,
  voucher_date date not null,
  payee text not null,
  bank_template_id uuid references public.bank_templates(id),
  check_no text default '',
  check_date date,
  amount numeric default 0,
  particulars text default '',
  account_charged text default '',
  status text default 'Pending' check (status in ('Pending', 'Approved', 'Released', 'Cancelled')),
  prepared_by text default '',
  approved_by text default '',
  received_by text default '',
  received_date date,
  remarks text default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.bank_templates enable row level security;
alter table public.check_vouchers enable row level security;

drop policy if exists "bank_templates_select" on public.bank_templates;
create policy "bank_templates_select" on public.bank_templates for select using (auth.role() = 'authenticated');
drop policy if exists "bank_templates_write" on public.bank_templates;
create policy "bank_templates_write" on public.bank_templates for all using (public.is_admin());
drop policy if exists "vouchers_select" on public.check_vouchers;
create policy "vouchers_select" on public.check_vouchers for select using (auth.role() = 'authenticated');
drop policy if exists "vouchers_write" on public.check_vouchers;
create policy "vouchers_write" on public.check_vouchers for all using (auth.role() = 'authenticated');

-- PATCH: Add missing columns to check_vouchers
alter table public.check_vouchers add column if not exists mode text default 'single';
alter table public.check_vouchers add column if not exists description text default '';
alter table public.check_vouchers add column if not exists check_rows jsonb default '[]';

-- ============================================================
-- PATCH: Security Bank default template
-- ============================================================
-- insert into public.bank_templates (
--   bank_name, account_name, account_number, branch,
--   check_width_mm, check_height_mm,
--   date_x, date_y,
--   payee_x, payee_y,
--   amount_figures_x, amount_figures_y,
--   amount_words_x, amount_words_y,
--   amount_words_x2, amount_words_y2,
--   font_size_date, font_size_payee, font_size_amount, font_size_words,
--   is_default
-- ) values (
--   'Security Bank Corp', 'Dragon Speed Trucking Corporation', '000-059838-392', 'Lapu Lapu Branch',
--   203.2, 76.2,
--   145, 18,
--   28, 35,
--   155, 35,
--   12, 48,
--   12, 54,
--   8, 9, 9, 8,
--   true
-- ) on conflict do nothing;

-- Add is_recurring to expenses
alter table public.expenses add column if not exists is_recurring boolean default false;
-- Add maintenance_category (if not exists)
alter table public.expenses add column if not exists maintenance_category text default '';


-- ============================================================
-- PATCH: Audit Trail
-- ============================================================
create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() primary key,
  tab text not null check (tab in ('destructive', 'generate')),
  action text not null,
  module text not null,
  record_id text default '',
  description text not null,
  performed_by uuid references public.profiles(id) on delete set null,
  performed_by_name text default '',
  created_at timestamptz default now()
);
alter table public.audit_logs enable row level security;
drop policy if exists "audit_select" on public.audit_logs;
create policy "audit_select" on public.audit_logs for select using (auth.role() = 'authenticated');
drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert" on public.audit_logs for insert with check (auth.role() = 'authenticated');
drop policy if exists "audit_delete" on public.audit_logs;
create policy "audit_delete" on public.audit_logs for delete using (public.is_admin());

-- Add audit_enabled and audit_retention to company_settings
alter table public.company_settings add column if not exists audit_enabled boolean default false;
alter table public.company_settings add column if not exists audit_retention text default '1year';
alter table public.company_settings add column if not exists audit_enabled_since timestamptz;
alter table public.company_settings add column if not exists audit_last_purge timestamptz;
alter table public.company_settings add column if not exists audit_last_export timestamptz;

-- ============================================================
-- PATCH: Sub-con trucks support
-- ============================================================
alter table public.trucks add column if not exists ownership text default 'company' check (ownership in ('company', 'subcon'));
alter table public.trucks add column if not exists subcon_name text default '';

-- ============================================================
-- PATCH: Sub-con trip payment tracking
-- ============================================================
alter table public.trips_dump add column if not exists subcon_paid boolean default false;
alter table public.trips_dump add column if not exists subcon_paid_date date;
alter table public.trips_dump add column if not exists subcon_cost numeric default 0;
alter table public.trips_dump add column if not exists subcon_paid_notes text default '';

alter table public.trips_pm add column if not exists subcon_paid boolean default false;
alter table public.trips_pm add column if not exists subcon_paid_date date;
alter table public.trips_pm add column if not exists subcon_cost numeric default 0;
alter table public.trips_pm add column if not exists subcon_paid_notes text default '';

-- Auto-purge setting
alter table public.company_settings add column if not exists audit_auto_purge boolean default false;

-- ============================================================
-- PATCH: Special sub-con, Loans, OR/CR tracking
-- ============================================================
-- Update ownership constraint to include special_subcon
alter table public.trucks drop constraint if exists trucks_ownership_check;
alter table public.trucks add constraint trucks_ownership_check check (ownership in ('company', 'subcon', 'special_subcon'));

-- Loans table
create table if not exists public.loans (
  id uuid default gen_random_uuid() primary key,
  lender text not null,
  description text default '',
  principal numeric default 0,
  interest_rate numeric default 0,
  term_months integer default 0,
  start_date date,
  monthly_payment numeric default 0,
  status text default 'active' check (status in ('active', 'paid', 'restructured')),
  notes text default '',
  created_at timestamptz default now()
);
alter table public.loans enable row level security;
drop policy if exists "loans_select" on public.loans;
create policy "loans_select" on public.loans for select using (auth.role() = 'authenticated');
drop policy if exists "loans_insert" on public.loans;
create policy "loans_insert" on public.loans for insert with check (auth.role() = 'authenticated');
drop policy if exists "loans_update" on public.loans;
create policy "loans_update" on public.loans for update using (auth.role() = 'authenticated');
drop policy if exists "loans_delete" on public.loans;
create policy "loans_delete" on public.loans for delete using (public.is_admin());

-- OR/CR tracking table
create table if not exists public.orcr_records (
  id uuid default gen_random_uuid() primary key,
  vehicle_name text not null,
  plate_no text not null,
  vehicle_type text default 'truck',
  or_number text default '',
  cr_number text default '',
  or_expiry date,
  cr_expiry date,
  mv_file_no text default '',
  owner text default '',
  notes text default '',
  created_at timestamptz default now()
);
alter table public.orcr_records enable row level security;
drop policy if exists "orcr_select" on public.orcr_records;
create policy "orcr_select" on public.orcr_records for select using (auth.role() = 'authenticated');
drop policy if exists "orcr_insert" on public.orcr_records;
create policy "orcr_insert" on public.orcr_records for insert with check (auth.role() = 'authenticated');
drop policy if exists "orcr_update" on public.orcr_records;
create policy "orcr_update" on public.orcr_records for update using (auth.role() = 'authenticated');
drop policy if exists "orcr_delete" on public.orcr_records;
create policy "orcr_delete" on public.orcr_records for delete using (public.is_admin());

-- Payment method on expenses (cash/transfer/check)
alter table public.expenses add column if not exists payment_method text default 'cash';

-- SubconTrips client payment tracking
alter table public.trips_dump add column if not exists client_paid boolean default false;
alter table public.trips_dump add column if not exists client_paid_date date;
alter table public.trips_dump add column if not exists subcon_voucher_no text default '';
alter table public.trips_dump add column if not exists subcon_expense_share numeric default 0;
alter table public.trips_pm add column if not exists client_paid boolean default false;
alter table public.trips_pm add column if not exists client_paid_date date;
alter table public.trips_pm add column if not exists subcon_voucher_no text default '';
alter table public.trips_pm add column if not exists subcon_expense_share numeric default 0;

-- Override PIN for admin users (for invoiced trip edit authorization)
alter table public.profiles add column if not exists override_pin text default null;

-- ── Extra Income ───────────────────────────────────────────────────────────
create table if not exists public.extra_income (
  id uuid default gen_random_uuid() primary key,
  income_date date not null,
  source_type text not null default 'Side Trip',
  truck_id uuid references public.trucks(id) on delete set null,
  amount numeric not null default 0,
  description text default '',
  payment_method text default 'cash',
  notes text default '',
  created_at timestamptz default now()
);
alter table public.extra_income enable row level security;
drop policy if exists "extra_income_select" on public.extra_income;
drop policy if exists "extra_income_insert" on public.extra_income;
drop policy if exists "extra_income_update" on public.extra_income;
drop policy if exists "extra_income_delete" on public.extra_income;
drop policy if exists "extra_income_select" on public.extra_income;
create policy "extra_income_select" on public.extra_income for select using (auth.role() = 'authenticated');
drop policy if exists "extra_income_insert" on public.extra_income;
create policy "extra_income_insert" on public.extra_income for insert with check (auth.role() = 'authenticated');
drop policy if exists "extra_income_update" on public.extra_income;
create policy "extra_income_update" on public.extra_income for update using (auth.role() = 'authenticated');
drop policy if exists "extra_income_delete" on public.extra_income;
create policy "extra_income_delete" on public.extra_income for delete using (auth.role() = 'authenticated');

-- ── Cash Vouchers ──────────────────────────────────────────────────────────
create table if not exists public.cash_vouchers (
  id uuid default gen_random_uuid() primary key,
  voucher_date date not null,
  voucher_no text default '',
  payee text not null,
  amount numeric not null default 0,
  purpose text default '',
  received_by text default '',
  remarks text default '',
  status text default 'Pending' check (status in ('Pending','Approved','Cancelled')),
  created_at timestamptz default now()
);
alter table public.cash_vouchers enable row level security;
drop policy if exists "cash_vouchers_select" on public.cash_vouchers;
drop policy if exists "cash_vouchers_insert" on public.cash_vouchers;
drop policy if exists "cash_vouchers_update" on public.cash_vouchers;
drop policy if exists "cash_vouchers_delete" on public.cash_vouchers;
drop policy if exists "cash_vouchers_select" on public.cash_vouchers;
create policy "cash_vouchers_select" on public.cash_vouchers for select using (auth.role() = 'authenticated');
drop policy if exists "cash_vouchers_insert" on public.cash_vouchers;
create policy "cash_vouchers_insert" on public.cash_vouchers for insert with check (auth.role() = 'authenticated');
drop policy if exists "cash_vouchers_update" on public.cash_vouchers;
create policy "cash_vouchers_update" on public.cash_vouchers for update using (auth.role() = 'authenticated');
drop policy if exists "cash_vouchers_delete" on public.cash_vouchers;
create policy "cash_vouchers_delete" on public.cash_vouchers for delete using (public.is_admin());

-- ── Historical Data ────────────────────────────────────────────────────────
create table if not exists public.historical_data (
  id uuid default gen_random_uuid() primary key,
  period_year text not null,
  period_month text not null,
  truck_id uuid references public.trucks(id) on delete set null,
  sales_dump numeric default 0,
  sales_pm numeric default 0,
  expenses jsonb default '{}',
  notes text default '',
  is_historical boolean default true,
  created_at timestamptz default now()
);
alter table public.historical_data enable row level security;
drop policy if exists "historical_data_select" on public.historical_data;
drop policy if exists "historical_data_insert" on public.historical_data;
drop policy if exists "historical_data_update" on public.historical_data;
drop policy if exists "historical_data_delete" on public.historical_data;
drop policy if exists "historical_data_select" on public.historical_data;
create policy "historical_data_select" on public.historical_data for select using (auth.role() = 'authenticated');
drop policy if exists "historical_data_insert" on public.historical_data;
create policy "historical_data_insert" on public.historical_data for insert with check (auth.role() = 'authenticated');
drop policy if exists "historical_data_update" on public.historical_data;
create policy "historical_data_update" on public.historical_data for update using (auth.role() = 'authenticated');
drop policy if exists "historical_data_delete" on public.historical_data;
create policy "historical_data_delete" on public.historical_data for delete using (public.is_admin());

-- Historical data additional columns for 3 template types
alter table public.historical_data add column if not exists entry_type text default 'detailed';
alter table public.historical_data add column if not exists credited_to_bank numeric default 0;
alter table public.historical_data add column if not exists total_expenses_simple numeric default 0;

-- ── New signatory columns for Settings ────────────────────────────────────
alter table public.company_settings add column if not exists cv_prepared_by_name text default '';
alter table public.company_settings add column if not exists cv_prepared_by_title text default '';
alter table public.company_settings add column if not exists cv_noted_by_name text default '';
alter table public.company_settings add column if not exists cv_noted_by_title text default '';
alter table public.company_settings add column if not exists cashv_prepared_by_name text default '';
alter table public.company_settings add column if not exists cashv_prepared_by_title text default '';
alter table public.company_settings add column if not exists cashv_noted_by_name text default '';
alter table public.company_settings add column if not exists cashv_noted_by_title text default '';
alter table public.company_settings add column if not exists orcr_prepared_by_name text default '';
alter table public.company_settings add column if not exists orcr_prepared_by_title text default '';
alter table public.company_settings add column if not exists orcr_noted_by_name text default '';
alter table public.company_settings add column if not exists orcr_noted_by_title text default '';
alter table public.company_settings add column if not exists aging_prepared_by_name text default '';
alter table public.company_settings add column if not exists aging_prepared_by_title text default '';
alter table public.company_settings add column if not exists aging_noted_by_name text default '';
alter table public.company_settings add column if not exists aging_noted_by_title text default '';

-- Separate dump/pm commodities
alter table public.commodities add column if not exists for_type text default 'dump' check (for_type in ('dump','pm'));

-- Add missing update policy for commodities
drop policy if exists "comm_update" on public.commodities;
create policy "comm_update" on public.commodities for update using (auth.role() = 'authenticated');

-- Soft delete support
alter table public.trips_dump add column if not exists deleted_at timestamptz;
alter table public.trips_pm add column if not exists deleted_at timestamptz;
alter table public.invoices add column if not exists deleted_at timestamptz;
alter table public.expenses add column if not exists deleted_at timestamptz;

-- Signatory Directory
create table if not exists public.signatories (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  title text not null,
  is_default_prepared boolean default false,
  is_default_approved boolean default false,
  sort_order integer default 0,
  created_at timestamptz default now()
);
alter table public.signatories enable row level security;
drop policy if exists "sig_select" on public.signatories;
drop policy if exists "sig_all" on public.signatories;
drop policy if exists "sig_select" on public.signatories;
create policy "sig_select" on public.signatories for select using (auth.role() = 'authenticated');
drop policy if exists "sig_all" on public.signatories;
create policy "sig_all" on public.signatories for all using (public.is_admin());

-- Print Layout Templates
create table if not exists public.print_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  doc_type text not null default 'soa_dump',
  columns jsonb not null default '[]',
  font_size text default 'medium',
  density text default 'normal',
  is_default boolean default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.print_templates enable row level security;
drop policy if exists "pt_select" on public.print_templates;
create policy "pt_select" on public.print_templates for select using (auth.role() = 'authenticated');
drop policy if exists "pt_all" on public.print_templates;
create policy "pt_all" on public.print_templates for all using (public.is_admin());

-- Fix print_templates RLS - allow all authenticated users to write (admin check done in app)
drop policy if exists "pt_all" on public.print_templates;
create policy "pt_all" on public.print_templates for all using (auth.role() = 'authenticated');

-- Payslip drafts (save for later print/edit)
create table if not exists public.payslip_drafts (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  position text,
  cutoffs jsonb not null default '[]',
  deductions jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.payslip_drafts enable row level security;
grant select, insert, update, delete on public.payslip_drafts to authenticated;
grant select, insert, update, delete on public.payslip_drafts to service_role;
drop policy if exists "payslip_drafts_all" on public.payslip_drafts;
create policy "payslip_drafts_all" on public.payslip_drafts for all using (auth.role() = 'authenticated');

-- ============================================================
-- VIEWER ROLE (optional feature -- table list updated to include
-- all tables added below, so it stays correct if ever used)
-- ============================================================

-- ============================================================
-- VIEWER ROLE — read-only, plate-scoped external accounts
-- (e.g. a special subcon who should see only their own trips)
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- 1. Allow 'viewer' as a role, add plate-scoping column to profiles.
--    'superuser' is included too in case the live constraint was already
--    loosened outside this file — this only ever widens, never narrows.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'staff', 'superuser', 'viewer'));
alter table public.profiles add column if not exists viewer_plates text[] default '{}';

-- 2. Helper functions used by the policies below.
create or replace function public.is_viewer() returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'viewer'
  );
$$ language sql security definer stable;

create or replace function public.viewer_plates() returns text[] as $$
  select coalesce(
    (select viewer_plates from public.profiles where id = auth.uid()),
    '{}'::text[]
  );
$$ language sql security definer stable;

-- 3. Trip tables: viewers get SELECT scoped to their own truck plate(s) only,
--    and are blocked from insert/update/delete entirely — even on their own
--    truck's rows. These are RESTRICTIVE policies, so they layer on top of
--    (and narrow) the existing "authenticated" policies without touching or
--    weakening them for admin/staff/superuser.
drop policy if exists "viewer_dump_select" on public.trips_dump;
create policy "viewer_dump_select" on public.trips_dump as restrictive for select
  using (not public.is_viewer() or truck_plate = any(public.viewer_plates()));
drop policy if exists "viewer_dump_block_insert" on public.trips_dump;
create policy "viewer_dump_block_insert" on public.trips_dump as restrictive for insert
  with check (not public.is_viewer());
drop policy if exists "viewer_dump_block_update" on public.trips_dump;
create policy "viewer_dump_block_update" on public.trips_dump as restrictive for update
  using (not public.is_viewer());
drop policy if exists "viewer_dump_block_delete" on public.trips_dump;
create policy "viewer_dump_block_delete" on public.trips_dump as restrictive for delete
  using (not public.is_viewer());

drop policy if exists "viewer_pm_select" on public.trips_pm;
create policy "viewer_pm_select" on public.trips_pm as restrictive for select
  using (not public.is_viewer() or truck_plate = any(public.viewer_plates()));
drop policy if exists "viewer_pm_block_insert" on public.trips_pm;
create policy "viewer_pm_block_insert" on public.trips_pm as restrictive for insert
  with check (not public.is_viewer());
drop policy if exists "viewer_pm_block_update" on public.trips_pm;
create policy "viewer_pm_block_update" on public.trips_pm as restrictive for update
  using (not public.is_viewer());
drop policy if exists "viewer_pm_block_delete" on public.trips_pm;
create policy "viewer_pm_block_delete" on public.trips_pm as restrictive for delete
  using (not public.is_viewer());

-- 4. Profiles: a viewer may only ever see their OWN row (needed for login
--    itself to work) — never the full user list.
drop policy if exists "viewer_profiles_scope" on public.profiles;
create policy "viewer_profiles_scope" on public.profiles as restrictive for select
  using (not public.is_viewer() or id = auth.uid());

-- 5. Everything else: viewers get zero access, full stop. Loops over every
--    other table that could exist in this project and adds one restrictive
--    deny-all policy per table. Skips any table that doesn't exist, so it's
--    safe to run even if some of these were added outside supabase-setup.sql.
--    This does NOT touch or weaken any existing policy for anyone else.
do $$
declare
  t text;
  tables text[] := array[
    'commodities','trucks','clients','saved_routes','saved_rates',
    'invoices','expenses','amortizations','insurances','drivers',
    'login_logs','bank_templates','check_vouchers','audit_logs','loans',
    'orcr_records','extra_income','cash_vouchers','historical_data',
    'signatories','print_templates','payslip_drafts',
    'payroll_employees','payroll_entries','company_loans','finances','vouchers',
    'company_loan_payments','payroll_13th_manual','payroll_cash_advances',
    'pdc_checks','expense_stocks','pin_attempts','historical_payments'
  ];
  pname text;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security;', t);
      pname := 'viewer_block_' || t;
      execute format('drop policy if exists %I on public.%I;', pname, t);
      execute format('create policy %I on public.%I as restrictive for all using (not public.is_viewer());', pname, t);
    end if;
  end loop;
end $$;

-- ============================================================
-- After running this, create the viewer's account in the app
-- (Manage Users → + Add User → Role: Viewer), then set which
-- truck plate(s) they can see, e.g.:
--
--   update public.profiles set viewer_plates = array['ABC-1234']
--   where email = 'the-account-email-you-used';
--
-- (The Manage Users screen also has a field for this — see below.)
-- ============================================================

-- ── Performance indexes (partial, on live/non-deleted rows) ──
CREATE INDEX IF NOT EXISTS idx_dump_live ON public.trips_dump (trip_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dump_live_invoice ON public.trips_dump (invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dump_live_plate ON public.trips_dump (truck_plate) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_live ON public.trips_pm (trip_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_live_invoice ON public.trips_pm (invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_live_plate ON public.trips_pm (truck_plate) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_live_date ON public.invoices (invoice_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_live_credited ON public.invoices (date_credited DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_live_status ON public.invoices (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exp_live_date ON public.expenses (expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exp_live_truck ON public.expenses (truck_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_extra_date ON public.extra_income (income_date DESC);

-- ── Historical Payments (schema only — no seed data; 5 Gems doesn't
--    have DSTC's Jan-Mar 2026 data-quality issue, so nothing to backfill) ──
CREATE TABLE IF NOT EXISTS public.historical_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  period_year text NOT NULL,
  period_month text NOT NULL,
  total_amount numeric(12,2) DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.historical_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "historical_payments_all" ON public.historical_payments;
CREATE POLICY "historical_payments_all" ON public.historical_payments
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- UNTRACKED DRIFT — reconciled from live DSTC schema queries
-- (never existed in supabase-setup.sql or any other tracked file)
-- Safe to re-run — uses IF NOT EXISTS throughout.
-- ============================================================

-- ── New columns on existing tables ──────────────────────────
alter table public.trucks add column if not exists start_date date default '2024-01-01';
alter table public.trucks add column if not exists end_date date;
alter table public.expenses add column if not exists updated_at timestamptz default now();
alter table public.expenses add column if not exists is_from_stock boolean default false;
alter table public.invoices add column if not exists remarks_color text;
alter table public.invoices add column if not exists locked_at timestamptz;
alter table public.profiles add column if not exists permissions jsonb;

-- Payroll signatory fields — defaults intentionally blank (DSTC's live
-- defaults here are Ken's own staff names; do not carry those into a
-- different company's database. Set actual 5 Gems signatories in Phase 2.)
alter table public.company_settings add column if not exists payroll_prepared_by text default '';
alter table public.company_settings add column if not exists payroll_prepared_title text default '';
alter table public.company_settings add column if not exists payroll_noted_by text default '';
alter table public.company_settings add column if not exists payroll_noted_title text default '';
alter table public.company_settings add column if not exists payroll_approved_by text default '';
alter table public.company_settings add column if not exists payroll_approved_title text default '';

alter table public.company_settings add column if not exists app_version text default '1.0';
alter table public.company_settings add column if not exists app_beta boolean default true;
alter table public.company_settings add column if not exists app_beta_label text default 'BETA — Testing Phase';

-- ── PAYROLL EMPLOYEES ────────────────────────────────────────
create table if not exists public.payroll_employees (
  id uuid default gen_random_uuid() primary key,
  full_name text not null,
  position text,
  basic_rate_monthly numeric default 0,
  allowance_monthly numeric default 0,
  sss_employee numeric default 0,
  sss_employer numeric default 0,
  philhealth_employee numeric default 0,
  philhealth_employer numeric default 0,
  hdmf_employee numeric default 0,
  hdmf_employer numeric default 0,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── PAYROLL ENTRIES ──────────────────────────────────────────
create table if not exists public.payroll_entries (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references public.payroll_employees(id) on delete cascade,
  cutoff_date date not null,
  basic_days numeric default 13,
  basic_rate numeric default 0,
  overtime_hours numeric default 0,
  overtime_rate numeric default 50,
  hazard_rate numeric default 0,
  basic_salary numeric default 0,
  overtime_pay numeric default 0,
  rest_day_duty numeric default 0,
  salary_adjustment numeric default 0,
  allowance numeric default 0,
  cash_advance_deduction numeric default 0,
  hdmf_loan numeric default 0,
  hdmf_premium numeric default 0,
  philhealth_premium numeric default 0,
  sss_loan numeric default 0,
  sss_premium numeric default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  locked_at timestamptz
);

-- ── PAYROLL 13TH MONTH (manual entries) ──────────────────────
create table if not exists public.payroll_13th_manual (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  year integer not null,
  month text not null,
  amount numeric default 0,
  created_at timestamptz default now(),
  unique (employee_id, year, month)
);

-- ── PAYROLL CASH ADVANCES ────────────────────────────────────
create table if not exists public.payroll_cash_advances (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references public.payroll_employees(id) on delete set null,
  date date not null,
  amount numeric not null,
  type text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── COMPANY LOANS (money lent out — receivable) ──────────────
create table if not exists public.company_loans (
  id uuid default gen_random_uuid() primary key,
  borrower text not null,
  borrower_type text not null default 'Employee',
  purpose text,
  principal numeric not null,
  interest_rate numeric not null default 0,
  term_months integer not null,
  start_date date not null,
  monthly_payment numeric not null,
  total_collectible numeric not null,
  status text not null default 'Active',
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.company_loan_payments (
  id uuid default gen_random_uuid() primary key,
  loan_id uuid not null references public.company_loans(id) on delete cascade,
  payment_date date not null,
  amount numeric not null,
  notes text,
  created_at timestamptz default now()
);

-- ── POST-DATED CHECKS (separate from check_vouchers) ─────────
create table if not exists public.pdc_checks (
  id uuid default gen_random_uuid() primary key,
  payee text not null,
  purpose text,
  bank text,
  check_no text not null,
  check_date date not null,
  amount numeric not null,
  status text not null default 'Pending',
  group_id uuid,
  group_label text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── EXPENSE STOCKS (inventory tracking under Expenses) ───────
create table if not exists public.expense_stocks (
  id uuid default gen_random_uuid() primary key,
  purchase_date date not null,
  category text not null,
  description text not null,
  quantity integer not null default 1,
  quantity_remaining integer not null default 1,
  unit text,
  unit_cost numeric not null,
  total_cost numeric not null,
  reference_no text,
  notes text,
  expense_id uuid references public.expenses(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- expenses.stock_id links back here — added now that expense_stocks exists
alter table public.expenses add column if not exists stock_id uuid references public.expense_stocks(id) on delete set null;

-- ── PIN ATTEMPTS (backs verify_override_pin lockout logic) ───
create table if not exists public.pin_attempts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz default now()
);

-- ============================================================
-- RLS + POLICIES + GRANTS for all 9 new tables
-- (naming/logic matches exactly what's live on DSTC)
-- ============================================================
alter table public.payroll_employees enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_13th_manual enable row level security;
alter table public.payroll_cash_advances enable row level security;
alter table public.company_loans enable row level security;
alter table public.company_loan_payments enable row level security;
alter table public.pdc_checks enable row level security;
alter table public.expense_stocks enable row level security;
alter table public.pin_attempts enable row level security;

grant select, insert, update, delete on public.payroll_employees to authenticated, service_role;
grant select, insert, update, delete on public.payroll_entries to authenticated, service_role;
grant select, insert, update, delete on public.payroll_13th_manual to authenticated, service_role;
grant select, insert, update, delete on public.payroll_cash_advances to authenticated, service_role;
grant select, insert, update, delete on public.company_loans to authenticated, service_role;
grant select, insert, update, delete on public.company_loan_payments to authenticated, service_role;
grant select, insert, update, delete on public.pdc_checks to authenticated, service_role;
grant select, insert, update, delete on public.expense_stocks to authenticated, service_role;
grant select, insert, update, delete on public.pin_attempts to authenticated, service_role;
-- NOTE: live DSTC's select policy on these 3 tables also allows the 'anon'
-- role — unusual for payroll data specifically. Preserved here for parity,
-- but worth deciding deliberately for 5 Gems rather than carrying it over
-- silently — see note below.
grant select on public.payroll_employees to anon;
grant select on public.payroll_entries to anon;
grant select on public.payroll_cash_advances to anon;

drop policy if exists "payroll_employees_select" on public.payroll_employees;
drop policy if exists "payroll_employees_insert" on public.payroll_employees;
drop policy if exists "payroll_employees_update" on public.payroll_employees;
drop policy if exists "payroll_employees_delete" on public.payroll_employees;
drop policy if exists "payroll_employees_select" on public.payroll_employees;
create policy "payroll_employees_select" on public.payroll_employees for select using (auth.role() = any (array['authenticated','anon']));
drop policy if exists "payroll_employees_insert" on public.payroll_employees;
create policy "payroll_employees_insert" on public.payroll_employees for insert with check (auth.role() = 'authenticated');
drop policy if exists "payroll_employees_update" on public.payroll_employees;
create policy "payroll_employees_update" on public.payroll_employees for update using (auth.role() = 'authenticated');
drop policy if exists "payroll_employees_delete" on public.payroll_employees;
create policy "payroll_employees_delete" on public.payroll_employees for delete using (public.is_admin());

drop policy if exists "payroll_entries_select" on public.payroll_entries;
drop policy if exists "payroll_entries_insert" on public.payroll_entries;
drop policy if exists "payroll_entries_update" on public.payroll_entries;
drop policy if exists "payroll_entries_delete" on public.payroll_entries;
drop policy if exists "payroll_entries_select" on public.payroll_entries;
create policy "payroll_entries_select" on public.payroll_entries for select using (auth.role() = any (array['authenticated','anon']));
drop policy if exists "payroll_entries_insert" on public.payroll_entries;
create policy "payroll_entries_insert" on public.payroll_entries for insert with check (auth.role() = 'authenticated');
drop policy if exists "payroll_entries_update" on public.payroll_entries;
create policy "payroll_entries_update" on public.payroll_entries for update using (auth.role() = 'authenticated');
drop policy if exists "payroll_entries_delete" on public.payroll_entries;
create policy "payroll_entries_delete" on public.payroll_entries for delete using (public.is_admin());

drop policy if exists "13th_select" on public.payroll_13th_manual;
drop policy if exists "13th_insert" on public.payroll_13th_manual;
drop policy if exists "13th_update" on public.payroll_13th_manual;
drop policy if exists "13th_delete" on public.payroll_13th_manual;
drop policy if exists "13th_select" on public.payroll_13th_manual;
create policy "13th_select" on public.payroll_13th_manual for select using (auth.role() = 'authenticated');
drop policy if exists "13th_insert" on public.payroll_13th_manual;
create policy "13th_insert" on public.payroll_13th_manual for insert with check (auth.role() = 'authenticated');
drop policy if exists "13th_update" on public.payroll_13th_manual;
create policy "13th_update" on public.payroll_13th_manual for update using (auth.role() = 'authenticated');
drop policy if exists "13th_delete" on public.payroll_13th_manual;
create policy "13th_delete" on public.payroll_13th_manual for delete using (auth.role() = 'authenticated');

drop policy if exists "payroll_ca_select" on public.payroll_cash_advances;
drop policy if exists "payroll_ca_insert" on public.payroll_cash_advances;
drop policy if exists "payroll_ca_update" on public.payroll_cash_advances;
drop policy if exists "payroll_ca_delete" on public.payroll_cash_advances;
drop policy if exists "payroll_ca_select" on public.payroll_cash_advances;
create policy "payroll_ca_select" on public.payroll_cash_advances for select using (auth.role() = any (array['authenticated','anon']));
drop policy if exists "payroll_ca_insert" on public.payroll_cash_advances;
create policy "payroll_ca_insert" on public.payroll_cash_advances for insert with check (auth.role() = 'authenticated');
drop policy if exists "payroll_ca_update" on public.payroll_cash_advances;
create policy "payroll_ca_update" on public.payroll_cash_advances for update using (auth.role() = 'authenticated');
drop policy if exists "payroll_ca_delete" on public.payroll_cash_advances;
create policy "payroll_ca_delete" on public.payroll_cash_advances for delete using (public.is_admin());

drop policy if exists "cloan_select" on public.company_loans;
drop policy if exists "cloan_insert" on public.company_loans;
drop policy if exists "cloan_update" on public.company_loans;
drop policy if exists "cloan_delete" on public.company_loans;
drop policy if exists "cloan_select" on public.company_loans;
create policy "cloan_select" on public.company_loans for select using (auth.role() = 'authenticated');
drop policy if exists "cloan_insert" on public.company_loans;
create policy "cloan_insert" on public.company_loans for insert with check (public.is_admin());
drop policy if exists "cloan_update" on public.company_loans;
create policy "cloan_update" on public.company_loans for update using (public.is_admin());
drop policy if exists "cloan_delete" on public.company_loans;
create policy "cloan_delete" on public.company_loans for delete using (public.is_admin());

drop policy if exists "cloanpay_select" on public.company_loan_payments;
drop policy if exists "cloanpay_insert" on public.company_loan_payments;
drop policy if exists "cloanpay_update" on public.company_loan_payments;
drop policy if exists "cloanpay_delete" on public.company_loan_payments;
drop policy if exists "cloanpay_select" on public.company_loan_payments;
create policy "cloanpay_select" on public.company_loan_payments for select using (auth.role() = 'authenticated');
drop policy if exists "cloanpay_insert" on public.company_loan_payments;
create policy "cloanpay_insert" on public.company_loan_payments for insert with check (public.is_admin());
drop policy if exists "cloanpay_update" on public.company_loan_payments;
create policy "cloanpay_update" on public.company_loan_payments for update using (public.is_admin());
drop policy if exists "cloanpay_delete" on public.company_loan_payments;
create policy "cloanpay_delete" on public.company_loan_payments for delete using (public.is_admin());

drop policy if exists "pdc_select" on public.pdc_checks;
drop policy if exists "pdc_insert" on public.pdc_checks;
drop policy if exists "pdc_update" on public.pdc_checks;
drop policy if exists "pdc_delete" on public.pdc_checks;
drop policy if exists "pdc_select" on public.pdc_checks;
create policy "pdc_select" on public.pdc_checks for select using (auth.role() = 'authenticated');
drop policy if exists "pdc_insert" on public.pdc_checks;
create policy "pdc_insert" on public.pdc_checks for insert with check (auth.role() = 'authenticated');
drop policy if exists "pdc_update" on public.pdc_checks;
create policy "pdc_update" on public.pdc_checks for update using (auth.role() = 'authenticated');
drop policy if exists "pdc_delete" on public.pdc_checks;
create policy "pdc_delete" on public.pdc_checks for delete using (public.is_admin());

drop policy if exists "stocks_select" on public.expense_stocks;
drop policy if exists "stocks_insert" on public.expense_stocks;
drop policy if exists "stocks_update" on public.expense_stocks;
drop policy if exists "stocks_delete" on public.expense_stocks;
drop policy if exists "stocks_select" on public.expense_stocks;
create policy "stocks_select" on public.expense_stocks for select using (auth.role() = 'authenticated');
drop policy if exists "stocks_insert" on public.expense_stocks;
create policy "stocks_insert" on public.expense_stocks for insert with check (auth.role() = 'authenticated');
drop policy if exists "stocks_update" on public.expense_stocks;
create policy "stocks_update" on public.expense_stocks for update using (auth.role() = 'authenticated');
drop policy if exists "stocks_delete" on public.expense_stocks;
create policy "stocks_delete" on public.expense_stocks for delete using (public.is_admin());

drop policy if exists "pin_attempts_all" on public.pin_attempts;
create policy "pin_attempts_all" on public.pin_attempts for all using (auth.role() = 'authenticated');

-- ============================================================
-- FUNCTIONS — exact definitions pulled via pg_get_functiondef()
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_user_permissions(p_user_id uuid, p_permissions jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role <> 'superuser' then raise exception 'Unauthorized'; end if;
  update public.profiles set permissions = p_permissions where id = p_user_id;
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.expense_share_truck_count(for_date date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select greatest(count(*)::integer, 1) from public.trucks
  where coalesce(ownership, '') <> 'subcon'
    and for_date >= coalesce(start_date, '2024-01-01'::date)
    and for_date <= coalesce(end_date, '9999-12-31'::date)
$function$;

CREATE OR REPLACE FUNCTION public.bulk_delete_trips(p_table text, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_rows int;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'superuser') then
    raise exception 'Unauthorized';
  end if;

  if p_table = 'trips_dump' then
    delete from public.trips_dump where id = any(p_ids);
  elsif p_table = 'trips_pm' then
    delete from public.trips_pm where id = any(p_ids);
  elsif p_table = 'invoices' then
    delete from public.invoices where id = any(p_ids);
  else
    raise exception 'Invalid table: %', p_table;
  end if;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  return v_rows;
end;
$function$;

CREATE OR REPLACE FUNCTION public.profiles_update_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if NEW.role <> OLD.role then
    if auth.uid() is not null and not exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'superuser'
    ) then
      raise exception 'Unauthorized: only a superuser can change roles';
    end if;
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_payroll_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if OLD.locked_at is not null then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'superuser')
    ) then
      raise exception 'Payroll entry is locked for cutoff %. Admin PIN override required.', OLD.cutoff_date;
    end if;
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_invoice_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if OLD.locked_at is not null then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'superuser')
    ) then
      raise exception 'Invoice is locked. Admin PIN override required to unlock.';
    end if;
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lock_payroll_cutoff(p_cutoff_date date, p_lock boolean, p_pin text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_count integer;
  v_pin_valid boolean;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role in ('admin', 'superuser') then
    null;
  elsif p_pin is not null and not p_lock then
    select exists(
      select 1 from public.profiles
      where role in ('admin', 'superuser')
      and override_pin is not null
      and upper(override_pin) = upper(p_pin)
    ) into v_pin_valid;
    if not v_pin_valid then
      raise exception 'Invalid override PIN.';
    end if;
  else
    raise exception 'Unauthorized';
  end if;

  update public.payroll_entries
    set locked_at = case when p_lock then now() else null end
    where cutoff_date = p_cutoff_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lock_invoice(p_invoice_id uuid, p_lock boolean, p_pin text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_pin_valid boolean;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role in ('admin', 'superuser') then
    null;
  elsif p_pin is not null and not p_lock then
    select exists(
      select 1 from public.profiles
      where role in ('admin', 'superuser')
      and override_pin is not null
      and upper(override_pin) = upper(p_pin)
    ) into v_pin_valid;
    if not v_pin_valid then
      raise exception 'Invalid override PIN.';
    end if;
  else
    raise exception 'Unauthorized';
  end if;

  update public.invoices
    set locked_at = case when p_lock then now() else null end
    where id = p_invoice_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalc_invoice_total(p_invoice_id uuid, p_table text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_newnet numeric;
  v_first_code text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'superuser') then
    raise exception 'Unauthorized';
  end if;

  if p_table = 'trips_dump' then
    select coalesce(sum((weight_tons::numeric) * (rate_per_ton::numeric)), 0)
    into v_newnet
    from public.trips_dump
    where invoice_id = p_invoice_id and deleted_at is null;
  elsif p_table = 'trips_pm' then
    select coalesce(sum((coalesce(supplier_amount,0)::numeric) + (coalesce(stripping_fee,0)::numeric)), 0),
           min(trip_code)
    into v_newnet, v_first_code
    from public.trips_pm
    where invoice_id = p_invoice_id and deleted_at is null;
    if v_first_code = 'SMC' then v_newnet := v_newnet / 1.12; end if;
  else
    raise exception 'Invalid table';
  end if;

  update public.invoices set total_sales_net = v_newnet where id = p_invoice_id;
  return v_newnet;
end;
$function$;

CREATE OR REPLACE FUNCTION public.permanent_delete(p_table text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_rows int;
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
  else raise exception 'Invalid table: %', p_table;
  end if;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  return v_rows > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_override_pin(p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_attempts integer;
  v_locked_until timestamptz;
  v_match boolean;
begin
  select attempts, locked_until into v_attempts, v_locked_until
  from public.pin_attempts where user_id = v_user_id;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'PIN locked. Try again after %', v_locked_until;
  end if;

  select exists(
    select 1 from public.profiles
    where override_pin = upper(p_pin)
    and id != v_user_id
  ) into v_match;

  if not v_match then
    select exists(
      select 1 from public.profiles where override_pin = upper(p_pin)
    ) into v_match;
  end if;

  if v_match then
    insert into public.pin_attempts(user_id, attempts, locked_until, updated_at)
    values (v_user_id, 0, null, now())
    on conflict (user_id) do update set attempts = 0, locked_until = null, updated_at = now();
    return true;
  else
    insert into public.pin_attempts(user_id, attempts, locked_until, updated_at)
    values (v_user_id, 1, null, now())
    on conflict (user_id) do update
      set attempts = pin_attempts.attempts + 1,
          locked_until = case when pin_attempts.attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
          updated_at = now();
    return false;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_app_version(p_version text, p_beta boolean, p_beta_label text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role <> 'superuser' then raise exception 'Unauthorized'; end if;
  update public.company_settings set app_version = p_version, app_beta = p_beta, app_beta_label = p_beta_label where id = 1;
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.viewer_truck_ids()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select coalesce(array_agg(id::text), '{}'::text[])
  from public.trucks where plate = any(public.viewer_plates());
$function$;

CREATE OR REPLACE FUNCTION public.get_my_invoices()
 RETURNS TABLE(invoice_id uuid, invoice_no text, invoice_date date, status text, date_credited date, my_trip_count integer, my_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  with my_trips as (
    select
      td.invoice_id,
      (coalesce(td.weight_tons,0) * coalesce(td.rate_per_ton,0)) as amount
    from public.trips_dump td
    where td.truck_plate = any(public.viewer_plates())
      and td.invoice_id is not null
      and td.deleted_at is null
    union all
    select
      tp.invoice_id,
      case when tp.trip_code = 'SMC'
        then (coalesce(tp.supplier_amount,0) + coalesce(tp.stripping_fee,0)) / 1.12
        else (coalesce(tp.supplier_amount,0) + coalesce(tp.stripping_fee,0))
      end as amount
    from public.trips_pm tp
    where tp.truck_plate = any(public.viewer_plates())
      and tp.invoice_id is not null
      and tp.deleted_at is null
  )
  select
    i.id, i.invoice_no, i.invoice_date, i.status, i.date_credited,
    count(mt.*)::integer, sum(mt.amount)
  from my_trips mt
  join public.invoices i on i.id = mt.invoice_id
  group by i.id, i.invoice_no, i.invoice_date, i.status, i.date_credited
  order by i.invoice_date desc nulls last;
$function$;

-- ============================================================
-- TRIGGERS
-- ============================================================
drop trigger if exists profiles_update_check_trigger on public.profiles;
create trigger profiles_update_check_trigger
  before update on public.profiles
  for each row execute function public.profiles_update_check();

drop trigger if exists payroll_entries_lock_check on public.payroll_entries;
create trigger payroll_entries_lock_check
  before update on public.payroll_entries
  for each row execute function public.check_payroll_lock();

drop trigger if exists invoices_lock_check on public.invoices;
create trigger invoices_lock_check
  before update on public.invoices
  for each row execute function public.check_invoice_lock();

-- ============================================================
-- INDEXES for the new tables (mirrors idx_*_live convention)
-- ============================================================
create index if not exists idx_payroll_entries_cutoff on public.payroll_entries(cutoff_date);
create index if not exists idx_payroll_entries_employee on public.payroll_entries(employee_id);
create index if not exists idx_payroll_ca_employee on public.payroll_cash_advances(employee_id);
create index if not exists idx_company_loan_payments_loan on public.company_loan_payments(loan_id);
create index if not exists idx_pdc_checks_date on public.pdc_checks(check_date);

-- ============================================================
-- PLACEHOLDER FLEET/DRIVER DATA
-- Real fleet/driver list not yet collected — these are obvious
-- placeholders to unblock Phase 3/4 testing. DELETE before go-live
-- and replace with 5 Gems' actual fleet once provided.
-- ============================================================
insert into public.trucks (plate, truck_type, notes, ownership)
  values ('ASD1234', 'Dump Truck', 'PLACEHOLDER — delete once real fleet list is provided', 'company')
on conflict do nothing;

insert into public.drivers (driver_name, notes)
  values ('Placeholder Driver', 'PLACEHOLDER — delete once real driver list is provided')
on conflict do nothing;
