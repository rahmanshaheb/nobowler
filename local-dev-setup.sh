#!/usr/bin/env bash
# One-shot local dev setup for the No Bowlers scoring app.
# Run from the project root:  bash local-dev-setup.sh
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=== 1. Postgres ==="
if ! command -v psql >/dev/null 2>&1; then
  echo "Installing postgresql@18 via Homebrew (needed for handover pg_dump restores)..."
  brew install postgresql@18 || brew install postgresql@16
  brew services start postgresql@18 2>/dev/null || brew services start postgresql@16
  export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
  sleep 3
fi

export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"

HAS_DIR_DUMP=false
if ls handover/database_dump_*.dir.tar.gz >/dev/null 2>&1 || ls *.dir.tar.gz >/dev/null 2>&1; then
  HAS_DIR_DUMP=true
fi

if [ "$HAS_DIR_DUMP" = true ]; then
  read -p "Load real match history from handover pg_dump? [Y/n] " LOAD_DATA
  LOAD_DATA="${LOAD_DATA:-Y}"
else
  read -p "Load real match history from handover export? [y/N] " LOAD_DATA
fi

if [[ "$LOAD_DATA" =~ ^[Yy]$|^[Yy][Ee][Ss]$|^$ ]]; then
  echo "=== 2. Restore handover database ==="
  bash server/scripts/restore-handover-db.sh
else
  echo "=== 2. Schema + migrations (empty database) ==="
  createdb nobowlers 2>/dev/null && echo "Created database 'nobowlers'." || echo "Database 'nobowlers' already exists, continuing."
  psql nobowlers -f db/schema.sql
  psql nobowlers -f db/local_dev_migrations.sql
fi

echo "=== 3. Backend ==="
cd "$PROJECT_DIR/server"
if [ ! -f .env ]; then
  cp .env.example .env
  # Overwrite with working local defaults
  cat > .env << 'EOF'
DATABASE_URL=postgres://localhost:5432/nobowlers
JWT_SECRET=local-dev-jwt-secret-change-me
SUPER_ADMIN_KEY=local-dev-super-admin-key-change-me
PORT=3000
NODE_ENV=development
ADMIN_EMAIL=admin@example.com
DEFAULT_SCORER_PASSCODE=0000
EOF
  echo "Created server/.env with local defaults."
fi

npm install
npm run seed
echo "Starting backend on http://localhost:3000 ..."
npm run dev > "$PROJECT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID (logs: backend.log)"
sleep 3

echo "=== 4. Frontend ==="
cd "$PROJECT_DIR/web"
if [ ! -f .env.local ]; then
  echo "VITE_API_BASE_URL=http://localhost:3000/api" > .env.local
fi
npm install
echo "Starting frontend on http://localhost:3001 ..."
npm run dev > "$PROJECT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID (logs: frontend.log)"
sleep 3

echo ""
echo "=== Done ==="
echo "Backend:  http://localhost:3000  (PID $BACKEND_PID)"
echo "Frontend: http://localhost:3001  (PID $FRONTEND_PID)"
echo "Admin login: admin@example.com / noBowlers"
echo "Scorer passcode: 0000"
echo ""
echo "Opening browser..."
open http://localhost:3001

echo "Press Ctrl+C to stop both servers."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
