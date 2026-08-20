#!/usr/bin/env bash
# Restore handover match data into a local Postgres database.
#
# Prefers the latest handover/database_dump_*.dir.tar.gz (pg_dump -Fd,
# PostgreSQL 18 format from Render). Falls back to handover/database_export_*.sql.
#
# Usage (from project root):
#   bash server/scripts/restore-handover-db.sh
#   DB_NAME=mydb bash server/scripts/restore-handover-db.sh
#
# Directory dumps need PostgreSQL 18+ pg_restore to read the archive.
# They can be restored onto PostgreSQL 16 servers via SQL conversion.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HANDOVER_DIR="$PROJECT_DIR/handover"
DB_NAME="${DB_NAME:-nobowlers}"
EXTRACT_DIR="$HANDOVER_DIR/.restore_extract"

find_pg_restore() {
  for candidate in \
    "${PG_RESTORE:-}" \
    "$(command -v pg_restore 2>/dev/null || true)" \
    /opt/homebrew/opt/postgresql@18/bin/pg_restore \
    /opt/homebrew/opt/postgresql@17/bin/pg_restore \
    /usr/local/opt/postgresql@18/bin/pg_restore; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

find_latest_dump() {
  local dir_dump sql_dump root_dump
  dir_dump="$(ls -t "$HANDOVER_DIR"/database_dump_*.dir.tar.gz 2>/dev/null | head -1 || true)"
  sql_dump="$(ls -t "$HANDOVER_DIR"/database_export_*.sql 2>/dev/null | head -1 || true)"
  root_dump="$(ls -t "$PROJECT_DIR"/*.dir.tar.gz 2>/dev/null | head -1 || true)"

  if [ -n "$dir_dump" ]; then
    echo "dir:$dir_dump"
  elif [ -n "$root_dump" ]; then
    echo "dir:$root_dump"
  elif [ -n "$sql_dump" ]; then
    echo "sql:$sql_dump"
  else
    echo ""
  fi
}

recreate_database() {
  echo "Recreating database '$DB_NAME'..."
  psql postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  dropdb --if-exists "$DB_NAME"
  createdb "$DB_NAME"
}

server_major_version() {
  psql postgres -Atqc "SHOW server_version_num;" | cut -c1-2
}

restore_sql_export() {
  local sql_file="$1"
  recreate_database
  echo "Applying schema + migrations, then SQL data export..."
  psql "$DB_NAME" -v ON_ERROR_STOP=1 -f "$PROJECT_DIR/db/schema.sql"
  psql "$DB_NAME" -v ON_ERROR_STOP=1 -f "$PROJECT_DIR/db/local_dev_migrations.sql"
  psql "$DB_NAME" -v ON_ERROR_STOP=1 -f "$sql_file"
}

restore_dir_dump() {
  local archive="$1"
  local pg_restore_bin dump_dir list_file filtered_list sql_file server_major

  pg_restore_bin="$(find_pg_restore)" || {
    echo "ERROR: pg_restore not found."
    echo "Directory dumps require PostgreSQL 18+ client tools."
    echo "Install: brew install postgresql@18"
    echo "Then:    export PATH=\"/opt/homebrew/opt/postgresql@18/bin:\$PATH\""
    exit 1
  }

  echo "Using pg_restore: $pg_restore_bin ($("$pg_restore_bin" --version))"

  rm -rf "$EXTRACT_DIR"
  mkdir -p "$EXTRACT_DIR"
  tar -xzf "$archive" -C "$EXTRACT_DIR"

  dump_dir="$(find "$EXTRACT_DIR" -name toc.dat | head -1 | xargs dirname)"
  if [ -z "$dump_dir" ] || [ ! -f "$dump_dir/toc.dat" ]; then
    echo "ERROR: Could not find pg_dump directory inside $archive"
    exit 1
  fi

  if ! "$pg_restore_bin" -l "$dump_dir" >/dev/null 2>&1; then
    echo "ERROR: This dump needs a newer pg_restore (created by PostgreSQL 18)."
    echo "Your version: $("$pg_restore_bin" --version)"
    echo "Install PostgreSQL 18 client tools and re-run this script."
    exit 1
  fi

  recreate_database

  server_major="$(server_major_version)"
  echo "Restoring from $(basename "$archive") into PostgreSQL server ${server_major}.x ..."

  if [ "$server_major" -ge 18 ] 2>/dev/null; then
    list_file="$(mktemp)"
    filtered_list="$(mktemp)"
    trap 'rm -f "$list_file" "$filtered_list"' EXIT
    "$pg_restore_bin" -l "$dump_dir" > "$list_file"
    grep -v ' DATABASE ' "$list_file" | grep -v ' DATABASE PROPERTIES ' > "$filtered_list" || true
    "$pg_restore_bin" \
      --no-owner \
      --no-acl \
      --exit-on-error \
      -L "$filtered_list" \
      -d "$DB_NAME" \
      "$dump_dir"
    rm -f "$list_file" "$filtered_list"
    trap - EXIT
  else
    sql_file="$(mktemp)"
    trap 'rm -f "$sql_file"' EXIT
    "$pg_restore_bin" --no-owner --no-acl -f "$sql_file" "$dump_dir"
    grep -v 'transaction_timeout' "$sql_file" | psql "$DB_NAME" -v ON_ERROR_STOP=1 -f -
    rm -f "$sql_file"
    trap - EXIT
  fi

  echo "Applying local view/migration fixes..."
  psql "$DB_NAME" -v ON_ERROR_STOP=1 -f "$PROJECT_DIR/db/local_dev_migrations.sql" || true

  rm -rf "$EXTRACT_DIR"
}

main() {
  local choice
  choice="$(find_latest_dump)"
  if [ -z "$choice" ]; then
    echo "No handover dump found."
    echo "Place one of these in handover/ (or project root for *.dir.tar.gz):"
    echo "  - database_dump_YYYY-MM-DD.dir.tar.gz  (pg_dump -Fd, preferred)"
    echo "  - database_export_YYYY-MM-DD.sql       (legacy INSERT export)"
    exit 1
  fi

  case "$choice" in
    dir:*)
      restore_dir_dump "${choice#dir:}"
      ;;
    sql:*)
      restore_sql_export "${choice#sql:}"
      ;;
    *)
      echo "Unknown dump type: $choice"
      exit 1
      ;;
  esac

  echo "✓ Handover database restored into '$DB_NAME'."
  psql "$DB_NAME" -Atqc "SELECT 'matches=' || COUNT(*) FROM match; SELECT 'deliveries=' || COUNT(*) FROM delivery;"
}

main "$@"
