# Deploying to AWS (Free Plan) — equivalent of the Render setup

_Written July 2026. AWS overhauled its Free Tier on July 15, 2025 — new
accounts no longer get a straightforward "free for 12 months." Read the
"Before you start" section before doing anything else._

---

## Before you start

New AWS accounts (created after July 15, 2025) get **$200 in credits**
($100 at signup + up to $100 more for completing onboarding tasks: launch
an EC2 instance, configure RDS, deploy Lambda, try Bedrock, set an AWS
Budget — $20 each). During signup you'll be asked to choose:

- **Free Plan** — usage is capped to what the credits cover. When credits
  run out or 6 months pass (whichever first), AWS **pauses your
  resources** — it does not bill you. This is the closest thing to
  Render's free tier: genuinely $0, but with a hard 6-month ceiling
  instead of running indefinitely.
- **Paid Plan** — credits apply first, then you're billed normally on a
  card on file. Don't pick this if the goal is "free."

**Choose Free Plan.** Also set a Budget alert (Billing console → Budgets)
at ~$1 as a tripwire, belt-and-suspenders even on the Free Plan.

Stick to the instance sizes below (`t2.micro`/`t3.micro`/`t4g.micro`,
`db.t3.micro`/`db.t4g.micro`) — these are the free-tier-eligible sizes the
credits are meant to cover.

This mirrors the current Render layout (Web Service + Static Site +
Postgres) as three AWS pieces: **RDS** (database), **EC2** (backend API),
**S3** (frontend static build).

---

## 1. Database — RDS PostgreSQL

1. RDS console → **Create database** → Standard create → PostgreSQL →
   template **Free tier** → instance class `db.t3.micro` or
   `db.t4g.micro` → 20 GB storage → set a master username/password →
   Public access: **Yes** (fine for a hobby project; you can restrict the
   security group to your IP) → Create.
2. Wait for it to become available, note the endpoint hostname.
3. From your machine, apply the schema (same files used for local dev):
   ```
   psql "postgresql://<user>:<pass>@<endpoint>:5432/postgres?sslmode=require" -f db/schema.sql
   psql "postgresql://<user>:<pass>@<endpoint>:5432/postgres?sslmode=require" -f db/local_dev_migrations.sql
   ```
4. Your production `DATABASE_URL`:
   ```
   postgres://<user>:<pass>@<endpoint>:5432/postgres?sslmode=require
   ```

---

## 2. Backend — EC2

1. EC2 console → **Launch instance** → Amazon Linux 2023 → `t2.micro` or
   `t3.micro` → create/download a key pair (`.pem`) → security group:
   allow inbound 22 (SSH, your IP only) and 3000 (or put Nginx in front on
   80/443 and keep 3000 internal) → Launch.
2. SSH in: `ssh -i key.pem ec2-user@<public-ip>`
3. Install Node 22 and git:
   ```
   curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
   sudo yum install -y nodejs git
   ```
4. Get the code onto the box (clone your private repo, or `scp -r
   server/` from your machine), then:
   ```
   cd server
   npm install
   ```
5. Create `.env` with the RDS `DATABASE_URL` from step 1, plus
   `JWT_SECRET`, `SUPER_ADMIN_KEY`, `PORT=3000`.
6. Seed and run persistently with pm2 (survives SSH disconnect and
   reboots):
   ```
   npm run seed
   sudo npm install -g pm2
   pm2 start src/index.js --name cricket-api
   pm2 startup && pm2 save
   ```

---

## 3. Frontend — S3 static hosting

1. Locally, point the build at your EC2 backend:
   ```
   cd web
   echo "VITE_API_BASE_URL=http://<ec2-public-ip>:3000/api" > .env.production
   npm run build
   ```
2. S3 console → **Create bucket** → uncheck "Block all public access" →
   enable **Static website hosting** (index document: `index.html`) →
   upload the contents of `web/dist/` → add a bucket policy allowing
   public `GetObject`.
3. Optional but recommended: put **CloudFront** in front of the bucket
   for HTTPS (S3 static hosting alone is HTTP-only) and a real CDN.

---

## Simpler alternative: one EC2 box for everything

If RDS + EC2 + S3 feels like too many moving parts for a first pass, you
can run Postgres on the same EC2 instance as the backend (`sudo yum
install postgresql15-server`) and have Express serve the built frontend
(`web/dist/`) as static files instead of using S3. One instance, one
thing to manage, still free-tier eligible — just less analogous to how
Render splits things up, and you lose RDS's automated backups.

---

## After the 6 months / $200 credit

Free Plan resources pause rather than bill you. To keep running past
that point you'd either switch to a Paid Plan (real charges apply — a
`t3.micro` + `db.t3.micro` pair runs roughly $15–25/month on-demand) or
migrate back to a genuinely-indefinite free host. Set a calendar
reminder — there's no automatic warning before the pause.
