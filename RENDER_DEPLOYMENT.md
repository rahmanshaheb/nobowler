# Deploying to Render — with database (step by step)

_Written July 2026, matches the current repo structure (`db/`, `server/`, `web/`)._

---

## Before you start

- Push this repo to GitHub (or GitLab) — Render deploys by connecting to
  a git repo, not by pushing directly to Render.
- Sign up at render.com — free, no card required.
- **Decide on the database plan up front.** Render's free Postgres
  expires 30 days after creation (14-day grace period to upgrade, then
  it's deleted with all data). For a throwaway test, free is fine. For
  anything you actually want to keep running — like real match
  history — use the **Starter** Postgres plan (~$7/month) instead. The
  web service and static site can both stay on the free tier regardless;
  it's just the database that has this trap.

---

## 1. Database — Render PostgreSQL

1. Dashboard → **New** → **PostgreSQL**.
2. Name it (e.g. `indoor-cricket-db`), pick a region, pick **Free** or
   **Starter** per the note above → Create Database.
3. Once it's provisioned, open it and copy the **External Database URL**
   (you need external access to run schema files from your own machine;
   the **Internal Database URL** is what the web service will use once
   deployed, since same-region internal traffic is faster and free).
4. From your machine, apply the schema and migrations:
   ```
   psql "<External Database URL>" -f db/schema.sql
   psql "<External Database URL>" -f db/local_dev_migrations.sql
   ```
   (That second file replaces the four `add-*.js` scripts, which
   hardcode SSL settings that don't always match cleanly — this SQL
   file is the safe equivalent.)

   **After the first deploy**, the backend also runs pending migrations
   automatically on every startup (`server/db/migrate.js`), so view fixes
   like `v_bowling_stats` bowler wicket credit are applied on Render
   without manual psql. You only need the psql steps above for a brand-new
   database before the first deploy.
5. Optional: restore real match history locally, then push to Render:
   ```bash
   export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
   DB_NAME=nobowlers bash server/scripts/restore-handover-db.sh
   pg_dump "<External Database URL>" ...   # or use Render backup/restore in dashboard
   ```
   Preferred handover file: `handover/database_dump_2026-08-20.dir.tar.gz` (pg_dump -Fd).
   Legacy SQL export: `handover/database_export_2026-07-09.sql`

---

## 2. Backend — Web Service

1. Dashboard → **New** → **Web Service** → connect your GitHub repo.
2. Settings:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (fine for the API; it spins down after 15 min idle
     and takes a few seconds to wake back up on the next request)
3. Environment variables (Environment tab):
   ```
   DATABASE_URL   = <Internal Database URL from step 1>
   JWT_SECRET     = <any long random string>
   SUPER_ADMIN_KEY = <a different long random string>
   NODE_ENV       = production
   ADMIN_EMAIL    = whatever you want the admin login to be
   DEFAULT_SCORER_PASSCODE = 0000 (or your own 4-digit code)
   ```
   `PORT` is set automatically by Render — don't set it yourself.
4. Create Web Service. Wait for the first deploy to finish.
5. Seed the admin account + passcode — open the service's **Shell** tab
   in the Render dashboard and run:
   ```
   node db/seed.js
   ```
6. Note the service's public URL, e.g. `https://indoor-cricket-api.onrender.com`.

---

## 3. Frontend — Static Site

1. Dashboard → **New** → **Static Site** → same GitHub repo.
2. Settings:
   - **Root Directory:** `web`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
3. Environment variable:
   ```
   VITE_API_BASE_URL = https://indoor-cricket-api.onrender.com/api
   ```
   (the exact URL from step 2.6, with `/api` appended). Vite bakes env
   vars in at build time, so if you change this later you need to
   trigger a new deploy for it to take effect.
4. Create Static Site. Once built, this is your live URL.

---

## 4. Verify

- Visit the static site URL — should load the app shell.
- Hit the backend directly to confirm it's live and talking to the
  database: `https://indoor-cricket-api.onrender.com/api/public/matches`
  should return JSON (a match list, or `[]` if you didn't restore the
  handover data).
- Worth knowing: per the project README, the frontend is currently
  wired to mock data in `App.jsx`, not the live API — so the deployed
  site may not visually reflect real backend data yet even though both
  pieces are correctly deployed. `web/src/api/client.js` has the fetch
  wrapper ready to wire in.

---

## Deploy process for future changes

```
git add . && git commit -m "message" && git push
```
Then in the Render dashboard: **Manual Deploy** on the relevant
service(s). Deploy the backend first if backend files changed, then the
frontend.

---

## Optional: one-shot deploy with a Blueprint

Render supports defining all three services in a single `render.yaml`
at the repo root, then using **New → Blueprint** to provision everything
in one pass instead of clicking through 3 separate "New" flows. It's a
nice shortcut, but the static site's `VITE_API_BASE_URL` still needs a
manual fix-up after the first deploy (Render can't auto-string-concatenate
`https://` + hostname + `/api` in the YAML), so for a first deployment
the manual steps above are more predictable. Ask if you want the
`render.yaml` written out — happy to add it once the manual path is
confirmed working, so there's a known-good fallback either way.
