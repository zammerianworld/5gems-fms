# Dragon Speed Trucking — Fleet Management System
## Deployment Guide (Step by Step)

---

## STEP 1 — Set up the Database (Supabase)

1. Go to **supabase.com** and open your project
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Open the file `supabase-setup.sql` (included in this folder)
5. Copy the entire contents and paste into the SQL editor
6. Click **Run** (green button)
7. You should see "Success" — all tables are now created

---

## STEP 2 — Create Your Admin Account

1. In Supabase, go to **Authentication → Users**
2. Click **Add User → Create new user**
3. Enter your email and a strong password
4. Click **Create User**
5. Now go to **SQL Editor** and run this (replace with your actual email):

```sql
update public.profiles set role = 'admin' where email = 'YOUR_EMAIL_HERE';
```

This gives you full admin access.

---

## STEP 3 — Upload the Code to GitHub

1. Go to **github.com** and sign in
2. Click **+** (top right) → **New repository**
3. Name it: `dragon-speed-trucking`
4. Set to **Private**
5. Click **Create repository**
6. Upload all the files in this folder to the repository
   - Drag and drop the entire folder, OR
   - Use GitHub Desktop app (easier — download at desktop.github.com)

---

## STEP 4 — Deploy to Vercel

1. Go to **vercel.com** and sign in with GitHub
2. Click **Add New → Project**
3. Find and select `dragon-speed-trucking` from your repositories
4. Click **Import**
5. Under **Environment Variables**, add these two:

   | Name | Value |
   |------|-------|
   | `REACT_APP_SUPABASE_URL` | `https://abfegxxcldjnkfwtogik.supabase.co` |
   | `REACT_APP_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your full key) |

6. Click **Deploy**
7. Wait ~2 minutes — Vercel will give you a live URL like:
   `https://dragon-speed-trucking.vercel.app`

---

## STEP 5 — Test Your Login

1. Open the Vercel URL in your browser
2. Log in with the admin email/password you created in Step 2
3. You should see the full dashboard with all modules

---

## STEP 6 — Create Staff Accounts

1. Log in as admin
2. Go to **Manage Users** in the sidebar
3. Click **Add User**
4. Enter the staff member's name, email, password, and role (Staff)
5. Share those credentials with them directly

---

## KEEPING SUPABASE ACTIVE (Free Tier)

Supabase pauses free projects after 7 days of inactivity.
To prevent this: just log into the app at least once a week.

Or run this in your browser console to keep it alive (optional):
You can also upgrade to Supabase Pro ($25/mo) to remove this limitation.

---

## UPDATING THE APP

When you need changes (new features, fixes):
1. Download the updated files from Claude
2. Upload/replace them in your GitHub repository
3. Vercel auto-deploys within ~1 minute — no manual steps needed

---

## YOUR CREDENTIALS (KEEP SAFE)

- Supabase URL: https://abfegxxcldjnkfwtogik.supabase.co
- Vercel URL: https://dragon-speed-trucking.vercel.app (after deployment)
- GitHub Repo: github.com/[yourusername]/dragon-speed-trucking
