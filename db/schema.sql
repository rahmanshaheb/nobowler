-- ============================================================
-- INDOOR CRICKET SCORING APP — POSTGRES SCHEMA
-- ============================================================
-- Design notes (read before modifying):
--
-- 1. EXTRAS MODEL: wide/no-ball never count as a legal delivery
--    (is_legal_delivery = false). Each carries a mandatory +1
--    extra. An OPTIONAL second +1 ("physical run") can be added
--    if the batters cross — this is tracked separately as
--    extra_physical_run so it can be reversed (-5) if a run-out
--    happens on that same delivery (per the "Wide + Wicket" flow).
--
-- 2. ZONE RUNS: only zones 1, 2, 4, 6 exist. Hitting a zone scores
--    that many runs to the batter. If batters cross after a zone
--    hit, +1 additional run is added (also credited to batter,
--    per rule 13). Zone runs and the "swap" run are both batter
--    runs, never extras.
--
-- 3. PENALTY ON OUT: rule 3 says "-5 for each out." This is
--    modeled as a delivery-level penalty_runs field applied to
--    the pair's/team's total — NOT subtracted from the batter's
--    personal tally. Confirm this against your matches; the
--    design screenshots show negative pair/player run tallies
--    (e.g. "-3 Runs | 0 Wicket") which supports penalties hitting
--    the scorecard at team or bowling-credit level.
--
-- 4. PAIR ROTATION: a pair can resume after a break (rain, multi-
--    session matches), so pair stats are NOT capped at exactly 4
--    overs — "End of 8 overs" in the design = the pair's second
--    4-over stint. pair_innings groups deliveries into stints;
--    a pair can have multiple pair_innings rows in one match.
--
-- 5. HELPER / ODD PLAYER RULE: rule 4 (odd squad size) is handled
--    by allowing a delivery to record a temporary helper batter
--    distinct from the two "owners" of the pair_innings, capped
--    at 2 overs of involvement — enforced in application logic,
--    not the DB, but the data model supports it via
--    delivery.striker_player_id being any squad player.
--
-- 6. CO-SCORING: last-write-wins, but every delivery row stores
--    which scorer_session recorded it, and an audit log captures
--    edits/undos so conflicting submissions are traceable.
--
-- 7. BOWLING CONCEDED RUNS: a single player can appear as both a
--    batter and bowler across the match (confirmed by design:
--    same names appear on both teams' scorecards across innings
--    since teams swap bowling/batting). Stats are always computed
--    per (match, player), not per team, so this falls out naturally.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ------------------------------------------------------------
-- AUTH / ACCESS CONTROL
-- ------------------------------------------------------------

-- Single admin account (the app has one admin role per app features doc).
-- Super admin is NOT in the DB — it's an env var / deploy-time secret
-- checked in application code, per your spec ("super admin: code-level access").
CREATE TABLE admin_account (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The scorer passcode is a single global 4-digit app-wide passcode
-- (per Screens 117-120: "App access passcode... For scorer").
-- Stored hashed; admin can view/copy plaintext in their own UI flow,
-- so app code should keep a reversible-but-protected representation
-- (e.g. encrypt, not one-way hash) OR store plaintext server-side only
-- and never expose it over a public API except to authenticated admins.
CREATE TABLE scorer_passcode (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
    passcode        TEXT NOT NULL, -- store encrypted, see note above
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- CORE ENTITIES: MATCHES, PLAYERS, TEAMS
-- ------------------------------------------------------------
-- NOTE ON ORDERING: `match` has no FK dependencies of its own, but
-- almost everything else (scorer_session, match_player, innings...)
-- references it. It must be created first. `match.man_of_the_match_id`
-- references match_player, which is created right after and creates a
-- circular-looking dependency — resolved by adding that FK separately
-- via ALTER TABLE once match_player exists (see below).

CREATE TABLE match (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_date          DATE NOT NULL,
    passcode_snapshot   TEXT, -- optional: passcode active when match was created (audit only)
    team_a_name         TEXT NOT NULL DEFAULT 'Team A',
    team_b_name         TEXT NOT NULL DEFAULT 'Team B',
    batting_first_team  TEXT CHECK (batting_first_team IN ('A', 'B')), -- locked once set, enforced in app logic per "cannot be changed" rule
    status              TEXT NOT NULL DEFAULT 'setup'
                            CHECK (status IN ('setup', 'live', 'completed', 'abandoned')),
    man_of_the_match_id UUID, -- FK added below, after match_player exists
    result_summary      TEXT, -- e.g. "Team A won by 19 runs"
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ, -- set when ball 1 is recorded -> match goes LIVE
    completed_at        TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ, -- soft delete, for "Delete this match" (admin)
    -- Human-readable 4-digit join code (1000-9999) for "Join a match" flow.
    -- Unique, generated on match creation. Much easier to share verbally
    -- mid-game than the UUID or 8-char hex prefix.
    join_code           SMALLINT UNIQUE
);

-- Tracks each device/tab currently scoring a match (co-scoring feature).
-- Used to show "2 scorers are scoring" and to attribute deliveries.
CREATE TABLE scorer_session (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active       BOOLEAN NOT NULL DEFAULT true
);

-- A player is scoped to a match (per design: team rosters are typed
-- in fresh per match, e.g. "Player 1".."Player 8", editable mid-match).
-- This avoids cross-match player-identity matching problems (typos,
-- nicknames) while still allowing stats aggregation by exact name
-- if you want a "career" view later — that's a v2 concern.
CREATE TABLE match_player (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    team            TEXT NOT NULL CHECK (team IN ('A', 'B')),
    display_name    TEXT NOT NULL,
    squad_position  SMALLINT NOT NULL, -- 1..20, original entry order
    is_helper_only  BOOLEAN NOT NULL DEFAULT false, -- rule 4: odd-squad helper
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, team, squad_position)
);

-- Resolve the match -> match_player FK now that both tables exist.
-- ON DELETE CASCADE here (and on every other FK to match_player below)
-- was missing originally — a real bug, only discovered when actually
-- trying to delete a match: Postgres processes a multi-table cascade
-- from `match` in an order that isn't guaranteed to delete dependent
-- rows (pair_innings, delivery, etc.) before match_player itself, so
-- without CASCADE on these, deleting a match correctly cascaded `match`
-- and `match_player` but then failed with a foreign key violation the
-- moment match_player rows tried to disappear while pair_innings/
-- delivery/etc. still referenced them.
ALTER TABLE match
    ADD CONSTRAINT fk_match_man_of_the_match
    FOREIGN KEY (man_of_the_match_id) REFERENCES match_player(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- INNINGS / PAIRS / BOWLING SPELLS
-- ------------------------------------------------------------

CREATE TABLE innings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    innings_number  SMALLINT NOT NULL CHECK (innings_number IN (1, 2)),
    batting_team    TEXT NOT NULL CHECK (batting_team IN ('A', 'B')),
    target_runs     INTEGER, -- set on innings 2 (first innings total + 1)
    is_complete     BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (match_id, innings_number)
);

-- A pair_innings is one continuous batting stint for a pair of batters.
-- Most pairs have exactly one (4 overs), but a pair can resume after
-- a break, producing a second pair_innings row for the same two players
-- (handles the "8 overs" pair-stat screen).
CREATE TABLE pair_innings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    innings_id          UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
    pair_number         SMALLINT NOT NULL, -- 1, 2, 3... order pairs batted in
    stint_number        SMALLINT NOT NULL DEFAULT 1, -- 2nd+ if pair resumes after interruption
    batter_1_id         UUID NOT NULL REFERENCES match_player(id) ON DELETE CASCADE,
    batter_2_id         UUID NOT NULL REFERENCES match_player(id) ON DELETE CASCADE,
    helper_player_id    UUID REFERENCES match_player(id) ON DELETE CASCADE, -- rule 4: odd squad helper, max 2 overs
    overs_allotted      NUMERIC(3,1) NOT NULL DEFAULT 4.0,
    is_complete         BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (innings_id, pair_number, stint_number)
);

-- Tracks who is on strike at any point within a pair_innings, since
-- the striker can change every ball based on swap rules. Derived data
-- (could be computed from deliveries), but materializing the "current
-- striker" simplifies the live scoring UI state.
CREATE TABLE pair_innings_state (
    pair_innings_id     UUID PRIMARY KEY REFERENCES pair_innings(id) ON DELETE CASCADE,
    current_striker_id  UUID REFERENCES match_player(id) ON DELETE CASCADE,
    current_non_striker_id UUID REFERENCES match_player(id) ON DELETE CASCADE
);

-- A bowling spell groups overs bowled by one bowler in one innings.
-- Rule 15: max 3 overs per bowler per innings.
CREATE TABLE bowling_spell (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    innings_id      UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
    bowler_id       UUID NOT NULL REFERENCES match_player(id) ON DELETE CASCADE,
    activated_after_sequence INTEGER NOT NULL DEFAULT 0,
    UNIQUE (innings_id, bowler_id) -- one spell aggregate per bowler per innings; overs tracked via deliveries
);

-- ------------------------------------------------------------
-- DELIVERIES — the core scoring ledger
-- ------------------------------------------------------------
-- One row per ball bowled (legal or not). This is the source of
-- truth; all stats (batting, bowling, pair totals, TV view) are
-- derived from this table, not stored redundantly, to avoid drift
-- when an UNDO or "change decision" happens.

CREATE TABLE delivery (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    innings_id              UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
    pair_innings_id         UUID NOT NULL REFERENCES pair_innings(id),
    bowling_spell_id        UUID NOT NULL REFERENCES bowling_spell(id),

    -- over/ball sequencing (legal-ball based, e.g. "0.1", "0.2"...)
    over_number             SMALLINT NOT NULL,
    ball_number_in_over      SMALLINT NOT NULL, -- 1..6, only increments on legal deliveries
    sequence_number          INTEGER NOT NULL, -- global monotonic order within innings (handles wide/no-ball not incrementing ball_number)

    striker_id              UUID NOT NULL REFERENCES match_player(id) ON DELETE CASCADE,
    non_striker_id          UUID NOT NULL REFERENCES match_player(id) ON DELETE CASCADE,

    delivery_type           TEXT NOT NULL DEFAULT 'normal'
                                CHECK (delivery_type IN ('normal', 'wide', 'no_ball')),
    is_legal_delivery       BOOLEAN NOT NULL, -- false for wide/no_ball; does not consume an over ball

    zone_hit                SMALLINT CHECK (zone_hit IN (1, 2, 4, 6)), -- null if no zone hit (e.g. dot ball, wide, no-ball with no zone)
    batters_crossed         BOOLEAN NOT NULL DEFAULT false, -- "swap" — adds +1 run per rules 5/6/8-11

    -- run breakdown — kept granular so any single component can be
    -- corrected/audited without recomputing the whole delivery
    zone_runs               SMALLINT NOT NULL DEFAULT 0,   -- base value of zone_hit (0 if none)
    crossing_run             SMALLINT NOT NULL DEFAULT 0,   -- the +1 from batters_crossed
    extra_mandatory_run      SMALLINT NOT NULL DEFAULT 0,   -- the forced +1 on wide/no_ball
    extra_physical_run       SMALLINT NOT NULL DEFAULT 0,   -- optional 2nd +1 if batters cross on a wide/no_ball
    manual_run_adjustment    SMALLINT NOT NULL DEFAULT 0,   -- stepper +/- for any other ad hoc run entry

    batter_runs              SMALLINT NOT NULL DEFAULT 0,   -- runs credited to striker's personal tally (zone_runs + crossing_run + manual, EXCLUDES wide/no_ball mandatory run per rule 13)
    extra_runs               SMALLINT NOT NULL DEFAULT 0,   -- runs credited to team extras only (extra_mandatory_run + extra_physical_run)
    total_runs               SMALLINT NOT NULL DEFAULT 0,   -- batter_runs + extra_runs, convenience column

    is_wicket                BOOLEAN NOT NULL DEFAULT false,
    wicket_type              TEXT CHECK (wicket_type IN
                                ('bowled', 'caught_and_bowled', 'caught', 'run_out', 'stumped', 'three_dots')),
    dismissed_player_id      UUID REFERENCES match_player(id) ON DELETE CASCADE, -- which batter is out (relevant for run-outs where either could be out)
    fielder_id               UUID REFERENCES match_player(id) ON DELETE CASCADE, -- who effected the catch/run-out/stump, from bowling side
    penalty_runs              SMALLINT NOT NULL DEFAULT 0,    -- rule 3: -5 per out; stored as -5, applied at team-total level. Zone 6 is exempt from outs (no catch/run-out) per rule 14, enforced in app logic.

    note                      TEXT, -- quick note tied to this ball, if added at the time

    recorded_by_session_id    UUID REFERENCES scorer_session(id),
    is_undone                 BOOLEAN NOT NULL DEFAULT false, -- soft-delete for UNDO, preserves audit trail
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT zone_runs_match_check CHECK (
        (zone_hit IS NULL AND zone_runs = 0) OR (zone_hit IS NOT NULL AND zone_runs = zone_hit)
    )
);

CREATE INDEX idx_delivery_innings ON delivery (innings_id) WHERE is_undone = false;
CREATE INDEX idx_delivery_pair_innings ON delivery (pair_innings_id) WHERE is_undone = false;
CREATE INDEX idx_delivery_bowling_spell ON delivery (bowling_spell_id) WHERE is_undone = false;
CREATE INDEX idx_delivery_striker ON delivery (striker_id) WHERE is_undone = false;

-- ------------------------------------------------------------
-- NOTES (per-match quick notes, auto-deleted at innings end)
-- ------------------------------------------------------------

CREATE TABLE match_note (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    innings_id      UUID REFERENCES innings(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    -- Deletion on innings-end is an application-layer job
    -- (DELETE FROM match_note WHERE innings_id = ?), not a DB trigger,
    -- so the "Yes/No — 3 notes will be deleted" confirmation step
    -- stays in app control.
);

-- ------------------------------------------------------------
-- RULES / STATIC CONTENT (public rulebook page)
-- ------------------------------------------------------------

CREATE TABLE rule_section (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sort_order      SMALLINT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL
);

-- ------------------------------------------------------------
-- AUDIT LOG (admin actions, co-scoring conflict tracing)
-- ------------------------------------------------------------

CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID REFERENCES match(id) ON DELETE CASCADE,
    actor            TEXT NOT NULL, -- 'admin', 'scorer_session:<id>', 'super_admin'
    action           TEXT NOT NULL, -- e.g. 'delivery_undo', 'passcode_changed', 'match_deleted'
    detail           JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- VIEWS — derived stats, computed from delivery ledger
-- ============================================================

-- Per-player batting stats for a given match (aggregates across all
-- pair_innings stints the player batted in, across both innings if
-- they batted twice — unlikely in indoor cricket but not structurally
-- prevented).
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
        JOIN innings i ON i.id = dw.innings_id
        WHERE dw.dismissed_player_id = mp.id
          AND i.match_id = mp.match_id
          AND dw.is_undone = false
    ), 0) AS times_dismissed,
    CASE WHEN COUNT(d.id) FILTER (WHERE d.is_legal_delivery) > 0
        THEN ROUND(100.0 * COALESCE(SUM(d.batter_runs), 0) / COUNT(d.id) FILTER (WHERE d.is_legal_delivery), 2)
        ELSE 0 END AS strike_rate
FROM match_player mp
LEFT JOIN delivery d
    ON d.striker_id = mp.id AND d.is_undone = false
GROUP BY mp.id, mp.match_id, mp.display_name, mp.team;

-- Per-player bowling stats for a given match.
CREATE VIEW v_bowling_stats AS
SELECT
    mp.id AS player_id,
    mp.match_id,
    mp.display_name,
    mp.team,
    bs.innings_id,
    COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls_bowled,
    -- Deliberately NOT + penalty_runs — the -5 wicket penalty is a
    -- batting-team/pair scoring deduction (see v_pair_innings_totals),
    -- not runs actually conceded off this bowler's deliveries. Including
    -- it here made a bowler's figures go negative the more wickets they
    -- took (e.g. 5 wickets in a spell showing "-6 runs conceded"),
    -- inverting what the stat is supposed to mean.
    COALESCE(SUM(d.total_runs), 0) AS runs_conceded,
    COALESCE(SUM(CASE WHEN d.is_wicket AND d.wicket_type IN ('bowled','caught_and_bowled','caught','three_dots','stumped') THEN 1 ELSE 0 END), 0) AS bowler_credited_wickets,
    COALESCE(SUM(CASE WHEN d.is_wicket THEN 1 ELSE 0 END), 0) AS total_wickets_in_spell
FROM match_player mp
JOIN bowling_spell bs ON bs.bowler_id = mp.id
LEFT JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
GROUP BY mp.id, mp.match_id, mp.display_name, mp.team, bs.innings_id;

-- Pair total per stint (the "End of N overs" screen).
CREATE VIEW v_pair_innings_totals AS
SELECT
    pi.id AS pair_innings_id,
    pi.innings_id,
    pi.pair_number,
    pi.stint_number,
    pi.batter_1_id,
    pi.batter_2_id,
    -- Includes penalty_runs (the -5 per wicket) so this can go negative,
    -- e.g. a pair that's lost a wicket with few runs scored — confirmed
    -- explicitly as the intended behavior for the live TV "PAIR TOTAL"
    -- display. This was missing penalty_runs originally; fixed here.
    COALESCE(SUM(d.total_runs), 0) + COALESCE(SUM(d.penalty_runs), 0) AS pair_total_runs,
    COALESCE(SUM(d.batter_runs) FILTER (WHERE d.striker_id = pi.batter_1_id), 0) AS batter_1_runs,
    COALESCE(SUM(d.batter_runs) FILTER (WHERE d.striker_id = pi.batter_2_id), 0) AS batter_2_runs,
    COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls_faced
FROM pair_innings pi
LEFT JOIN delivery d ON d.pair_innings_id = pi.id AND d.is_undone = false
GROUP BY pi.id, pi.innings_id, pi.pair_number, pi.stint_number, pi.batter_1_id, pi.batter_2_id;

-- Innings running total (for TV/Live view).
CREATE VIEW v_innings_totals AS
SELECT
    i.id AS innings_id,
    i.match_id,
    i.innings_number,
    i.batting_team,
    COALESCE(SUM(d.total_runs), 0) + COALESCE(SUM(d.penalty_runs), 0) AS total_runs,
    COALESCE(SUM(CASE WHEN d.is_wicket THEN 1 ELSE 0 END), 0) AS total_wickets,
    -- over_number/ball_number_in_over of the most recent ball, ordered by
    -- true sequence (not string concatenation, which sorts "10.2" before "9.1").
    (ARRAY_AGG(d.over_number ORDER BY d.sequence_number DESC))[1] AS last_over_number,
    (ARRAY_AGG(d.ball_number_in_over ORDER BY d.sequence_number DESC))[1] AS last_ball_number,
    COALESCE(SUM(CASE WHEN d.delivery_type = 'wide' THEN 1 ELSE 0 END), 0) AS wides,
    COALESCE(SUM(CASE WHEN d.delivery_type = 'no_ball' THEN 1 ELSE 0 END), 0) AS no_balls
FROM innings i
LEFT JOIN delivery d ON d.innings_id = i.id AND d.is_undone = false
GROUP BY i.id, i.match_id, i.innings_number, i.batting_team;
