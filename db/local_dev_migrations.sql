-- Combined equivalent of server/db/add-*.js migrations, safe to run
-- against a plain local Postgres (no SSL). The four add-*.js scripts
-- hardcode `ssl: { rejectUnauthorized: false }`, which most local
-- Postgres installs (Homebrew, Postgres.app) will reject since they
-- don't speak SSL on localhost. Run this file instead of the scripts
-- for local dev. Logic mirrors the originals exactly.
--
-- Usage: psql "$DATABASE_URL" -f db/local_dev_migrations.sql
-- Run AFTER db/schema.sql, BEFORE restoring any handover data export.

-- add-join-code.js
ALTER TABLE match ADD COLUMN IF NOT EXISTS join_code SMALLINT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_join_code_key'
  ) THEN
    ALTER TABLE match ADD CONSTRAINT match_join_code_key UNIQUE (join_code);
  END IF;
END $$;

-- add-wide-count-enabled.js
ALTER TABLE match ADD COLUMN IF NOT EXISTS wide_count_enabled BOOLEAN NOT NULL DEFAULT true;

-- add-three-dots-wicket.js
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'delivery'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%wicket_type%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE delivery DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE delivery
ADD CONSTRAINT delivery_wicket_type_check
CHECK (wicket_type IN ('bowled','caught_and_bowled','caught','run_out','stumped','three_dots'));

CREATE OR REPLACE VIEW v_bowling_stats AS
SELECT
  mp.id AS player_id, mp.match_id, mp.display_name, mp.team, bs.innings_id,
  COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls_bowled,
  COALESCE(SUM(d.total_runs), 0) + COALESCE(SUM(d.penalty_runs), 0) AS runs_conceded,
  COALESCE(SUM(CASE WHEN d.is_wicket AND d.wicket_type IN ('bowled','caught_and_bowled','caught','three_dots','stumped') THEN 1 ELSE 0 END), 0) AS bowler_credited_wickets,
  COALESCE(SUM(CASE WHEN d.is_wicket THEN 1 ELSE 0 END), 0) AS total_wickets_in_spell
FROM match_player mp
JOIN bowling_spell bs ON bs.bowler_id = mp.id
LEFT JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
GROUP BY mp.id, mp.match_id, mp.display_name, mp.team, bs.innings_id;

-- add-times-dismissed.js
DROP VIEW IF EXISTS v_batting_stats CASCADE;
CREATE VIEW v_batting_stats AS
SELECT
    mp.id AS player_id,
    mp.match_id,
    mp.display_name,
    mp.team,
    COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS balls_faced,
    COALESCE(SUM(d.batter_runs), 0) AS runs_scored,
    COALESCE(SUM(CASE WHEN d.zone_hit = 4 THEN 1 ELSE 0 END), 0) AS fours,
    COALESCE(SUM(CASE WHEN d.zone_hit = 6 THEN 1 ELSE 0 END), 0) AS sixes,
    BOOL_OR(d.is_wicket AND d.dismissed_player_id = mp.id) AS was_dismissed,
    COALESCE((
      SELECT COUNT(*)
      FROM delivery dw
      WHERE dw.dismissed_player_id = mp.id
        AND dw.is_undone = false
    ), 0) AS times_dismissed,
    CASE WHEN COUNT(d.id) FILTER (WHERE d.is_legal_delivery) > 0
        THEN ROUND(100.0 * COALESCE(SUM(d.batter_runs), 0) / COUNT(d.id) FILTER (WHERE d.is_legal_delivery), 2)
        ELSE 0 END AS strike_rate
FROM match_player mp
LEFT JOIN delivery d ON d.striker_id = mp.id AND d.is_undone = false
GROUP BY mp.id, mp.match_id, mp.display_name, mp.team;

-- Only needed if you also restore a handover/database_export_*.sql dump:
-- that export references a match.active_scorer_token column that isn't
-- in schema.sql (dropped at some point, export script never updated).
-- Always NULL in the dump, unreferenced anywhere in app code.
ALTER TABLE match ADD COLUMN IF NOT EXISTS active_scorer_token TEXT;
