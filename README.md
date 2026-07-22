# Indoor Cricket Scoring App

A web-based scoring app for indoor cricket: password-protected live scoring,
public match stats, and a rulebook page.

## Structure

```
db/        PostgreSQL schema (schema.sql)
server/    Express API (Node.js), includes db/seed.js for initial setup
web/       React (Vite) frontend — currently just the live scoring screen
```

## Local setup

### 1. Database
Run `db/schema.sql` against a Postgres instance (local or hosted).

### 2. Backend
```
cd server
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, SUPER_ADMIN_KEY
npm install
npm run seed            # creates the admin account + default scorer passcode
npm run dev
```
Runs on `http://localhost:3000` by default.

### 3. Frontend
```
cd web
npm install
npm run dev
```
Runs on `http://localhost:5173` by default. Currently wired to mock data in
`App.jsx`, not yet connected to the live API — see `src/api/client.js` for
the fetch wrapper ready to be wired in.

## Deployment

Deployed on Render.com:
- `server/` as a Web Service (Node environment, root directory `server`)
- `web/` as a Static Site (root directory `web`, build command `npm run
  build`, publish directory `dist`)
- A Render PostgreSQL instance, schema applied via `db/schema.sql`, seeded
  via `server/db/seed.js`

## Status

Phase 3 (scoring interface) built. Public stats/rules pages (Phase 4),
admin panel (Phase 5), and full deployment wiring (Phase 6) are still in
progress.

Admin password is currently fixed in `server/db/seed.js` and not
changeable through the app (see comment in `server/src/routes/authRoutes.js`).
