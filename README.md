# 5 Gems Trucking Corp. — Fleet Management System

A fleet management system for trip logging, billing/invoicing, expenses, payroll, and reporting.

---

## Tech Stack

- **Frontend:** React (Create React App), deployed on Vercel
- **Backend:** Supabase (Postgres + Auth + Edge Functions)
- **Styling:** Plain CSS with custom properties (no framework)

---

## Local Development Setup

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** → New Query
3. Paste the entire contents of `5gems-setup.sql` and run it
   - Safe to re-run if needed — every statement is idempotent (`IF NOT EXISTS` / `DROP ... IF EXISTS` throughout)
4. Go to **Settings → API** and copy your **Project URL**, **anon key**, and **service_role key**

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in the values from step 1:

```
REACT_APP_SUPABASE_URL=
REACT_APP_SUPABASE_ANON_KEY=
REACT_APP_APP_SECRET=
```

`REACT_APP_APP_SECRET` can be any random string you choose — it just needs to match the `APP_SECRET` secret you'll set on the edge function in step 4. Never commit `.env` — it's already in `.gitignore`.

### 3. Create Your Superuser Account

1. Supabase → **Authentication → Users → Add User** — enter your email + password
2. Back in **SQL Editor**, run (replace with your actual email):
   ```sql
   update public.profiles set role = 'superuser' where email = 'YOUR_EMAIL_HERE';
   ```
   `superuser` is the highest role — it's required for Payroll, App Version, PWA Icon settings, and full Manage Users access. `admin` (settable later, from Manage Users) is one level below and doesn't include those.

### 4. Deploy the Edge Function

The `create-user` edge function (used by Manage Users to create staff accounts) is **not** deployed by Vercel — it's separate:

1. Supabase → **Edge Functions** → deploy a new function named `create-user`
2. Paste in the contents of `supabase/functions/create-user/index.ts`
3. Add a secret: **Edge Functions → create-user → Secrets** → `APP_SECRET` = the same value you used for `REACT_APP_APP_SECRET`

### 5. Run Locally

```bash
npm install
npm start
```

Opens at `http://localhost:3000`.

---

## Deploying to Production (Vercel)

1. Push this repo to GitHub (private recommended)
2. In Vercel: **Add New → Project → Import Git Repository**
3. Add the same three environment variables from step 2 above, plus `SUPABASE_SERVICE_ROLE_KEY` (server-side only — never prefix this with `REACT_APP_`, or it'll be exposed in the browser bundle)
4. Deploy

Vercel auto-redeploys on every push to `main` after that — no manual steps needed for future updates.

---

## Keeping Supabase Active (Free Tier)

Supabase pauses free-tier projects after 7 days of inactivity. Logging into the app at least once a week prevents this. Supabase Pro ($25/mo) removes the limit entirely if that becomes a hassle.

---

## Project Structure Notes

- `5gems-setup.sql` — the complete database schema (tables, RLS policies, functions, triggers). Source of truth for the database; keep it updated if you make schema changes directly in Supabase's SQL editor, or future re-deploys will drift from what's actually live.
- `supabase/functions/create-user/` — the only backend logic outside the database itself; deployed separately from the rest of the app (see step 4).
- Role hierarchy: `staff` < `admin` < `superuser`, plus a separate `viewer` role for read-only external access (e.g. a subcontractor checking their own trips only).
