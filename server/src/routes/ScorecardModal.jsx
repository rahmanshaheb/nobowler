// ScorecardModal.jsx
import { useState, useEffect } from 'react';
import { api } from '../api/client';

/**
 * In-match scorecard — reachable from the hamburger menu mid-match, not
 * just post-match. Reuses GET /public/matches/:matchId, the SAME
 * endpoint MatchResultScreen already calls, since v_batting_stats and
 * v_bowling_stats are plain live-aggregating views over the delivery
 * table with no "match complete" gating — they're just as accurate
 * mid-match as they are after the final ball. No new backend endpoint
 * needed.
 *
 * Grouped by TEAM (mp.team, 'A'/'B'), not by innings — a player's team
 * is fixed for the whole match regardless of which innings they're
 * batting/bowling in, which is the natural grouping for "under each
 * team" as requested, and sidesteps the (rare, but schema-permitted)
 * case of a bowler appearing across two different bowling_spell rows
 * if they somehow bowled in both innings.
 */
export default function ScorecardModal({ matchId, strikerId, nonStrikerId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.get(`/public/matches/${matchId}`);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load scorecard.');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--scorecard" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal-title">Scorecard</h2>

        {error && <p className="scorecard-status scorecard-status--error">{error}</p>}
        {!error && !data && <p className="scorecard-status">Loading…</p>}

        {data && (() => {
          const innings = [...(data.innings || [])].sort((a, b) => a.innings_number - b.innings_number);
          const activeBatterIds = [strikerId, nonStrikerId].filter(Boolean);

          // If no innings data yet, fall back to team-based layout
          if (!innings.length) {
            return (
              <div className="scorecard-content">
                <TeamScorecard teamLabel={data.match.team_a_name} teamKey="A"
                  battingStats={data.battingStats} bowlingStats={data.bowlingStats}
                  pairStats={data.pairStats || []} activeBatterIds={activeBatterIds} />
                <TeamScorecard teamLabel={data.match.team_b_name} teamKey="B"
                  battingStats={data.battingStats} bowlingStats={data.bowlingStats}
                  pairStats={data.pairStats || []} activeBatterIds={activeBatterIds} />
              </div>
            );
          }

          return (
            <div className="scorecard-content">
              {innings.map((inn) => {
                const battingTeamKey = inn.batting_team;
                const bowlingTeamKey = battingTeamKey === 'A' ? 'B' : 'A';
                const battingTeamName = battingTeamKey === 'A' ? data.match.team_a_name : data.match.team_b_name;
                const bowlingTeamName = bowlingTeamKey === 'A' ? data.match.team_a_name : data.match.team_b_name;
                return (
                  <InningsScorecard
                    key={inn.innings_id}
                    inningsNumber={inn.innings_number}
                    battingTeamName={battingTeamName}
                    bowlingTeamName={bowlingTeamName}
                    battingTeamKey={battingTeamKey}
                    bowlingTeamKey={bowlingTeamKey}
                    battingStats={data.battingStats}
                    bowlingStats={data.bowlingStats}
                    pairStats={data.pairStats || []}
                    activeBatterIds={activeBatterIds}
                  />
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function InningsScorecard({ inningsNumber, battingTeamName, bowlingTeamName, battingTeamKey, bowlingTeamKey, battingStats, bowlingStats, pairStats, activeBatterIds }) {
  const battedPlayers = battingStats.filter((p) => p.team === battingTeamKey && Number(p.balls_faced) > 0);
  const bowledPlayers = bowlingStats.filter((p) => p.team === bowlingTeamKey && Number(p.legal_balls_bowled) > 0 && p.innings_id);
  const teamPairs = pairStats.filter((p) => p.batting_team === battingTeamKey && p.innings_number === inningsNumber && Number(p.legal_balls_faced) > 0);

  return (
    <section className="scorecard-team">
      <h3 className="scorecard-team__title">Innings {inningsNumber} — {battingTeamName}</h3>

      <h4 className="scorecard-section-label">Batting</h4>
      {battedPlayers.length === 0 ? (
        <p className="scorecard-empty">No batters yet.</p>
      ) : (
        <div className="scorecard-list">
          {battedPlayers.map((p) => (
            <div className="scorecard-player-card" key={p.player_id}>
              <div className="scorecard-player-card__name">
                {activeBatterIds.includes(p.player_id) && (
                  <span style={{ color: 'var(--color-mint)', marginRight: 6, fontSize: 10 }}>●</span>
                )}
                {p.display_name}
                {!p.was_dismissed && Number(p.balls_faced) > 0 && <span className="scorecard-not-out"> *</span>}
              </div>
              <div className="scorecard-player-card__stats">
                <Stat label="Runs" value={p.runs_scored} />
                <Stat label="Balls" value={p.balls_faced} />
                <Stat label="4s" value={p.fours} />
                <Stat label="6s" value={p.sixes} />
                <Stat label="Out" value={p.times_dismissed ?? 0} />
                <Stat label="SR" value={p.strike_rate} />
              </div>
            </div>
          ))}
        </div>
      )}

      {teamPairs.length > 0 && (
        <>
          <h4 className="scorecard-section-label">Pair Totals</h4>
          <div className="scorecard-list">
            {teamPairs.map((p) => (
              <div className="scorecard-player-card" key={p.pair_innings_id}>
                <div className="scorecard-player-card__name">
                  Pair {p.pair_number} — {p.batter_1_name} & {p.batter_2_name}
                </div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Runs" value={Number(p.pair_total_runs)} highlight={Number(p.pair_total_runs) < 0} />
                  <Stat label="Balls" value={Number(p.legal_balls_faced)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h4 className="scorecard-section-label">Bowling — {bowlingTeamName}</h4>
      {bowledPlayers.length === 0 ? (
        <p className="scorecard-empty">No bowlers yet.</p>
      ) : (
        <div className="scorecard-list">
          {bowledPlayers.map((p) => {
            const legalBalls = Number(p.legal_balls_bowled);
            const oversDisplay = legalBalls % 6 === 0 ? `${legalBalls / 6}` : `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
            return (
              <div className="scorecard-player-card" key={`${p.player_id}-${p.innings_id}`}>
                <div className="scorecard-player-card__name">{p.display_name}</div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Overs" value={oversDisplay} />
                  <Stat label="Runs" value={p.runs_conceded} />
                  <Stat label="Wkts" value={p.bowler_credited_wickets} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TeamScorecard({ teamLabel, teamKey, battingStats, bowlingStats, pairStats, activeBatterIds = [] }) {
  const teamBatting = battingStats.filter((p) => p.team === teamKey);
  const teamBowling = bowlingStats.filter((p) => p.team === teamKey);
  const teamPairs = pairStats.filter((p) => p.batting_team === teamKey);

  // A player only shows in the batting table if they've actually faced
  // at least one ball (or been dismissed for a duck, which still has
  // balls_faced >= 1 since you have to face a ball to be out) — keeps
  // this from listing every roster player with a blank "0 (0)" row
  // before they've even batted yet, mid-innings-1 while team B's whole
  // roster technically already "exists" in v_batting_stats via the
  // LEFT JOIN's zero-row fallback.
  const battedPlayers = teamBatting.filter((p) => Number(p.balls_faced) > 0);
  // Same idea for bowling: only show bowlers who've actually bowled at
  // least one legal ball.
  const bowledPlayers = teamBowling.filter((p) => Number(p.legal_balls_bowled) > 0);

  return (
    <section className="scorecard-team">
      <h3 className="scorecard-team__title">{teamLabel}</h3>

      <h4 className="scorecard-section-label">Batting</h4>
      {battedPlayers.length === 0 ? (
        <p className="scorecard-empty">No batters yet.</p>
      ) : (
        <div className="scorecard-list">
          {battedPlayers.map((p) => (
            <div className="scorecard-player-card" key={p.player_id}>
              <div className="scorecard-player-card__name">
                {activeBatterIds.includes(p.player_id) && (
                  <span style={{ color: 'var(--color-mint)', marginRight: 6, fontSize: 10 }}>●</span>
                )}
                {p.display_name}
                {!p.was_dismissed && Number(p.balls_faced) > 0 && <span className="scorecard-not-out"> *</span>}
              </div>
              <div className="scorecard-player-card__stats">
                <Stat label="Runs" value={p.runs_scored} />
                <Stat label="Balls" value={p.balls_faced} />
                <Stat label="4s" value={p.fours} />
                <Stat label="6s" value={p.sixes} />
                <Stat label="Out" value={p.times_dismissed ?? 0} />
                <Stat label="SR" value={p.strike_rate} />
              </div>
            </div>
          ))}
        </div>
      )}

      {teamPairs.filter(p => Number(p.legal_balls_faced) > 0).length > 0 && (
        <>
          <h4 className="scorecard-section-label">Pair Totals</h4>
          <div className="scorecard-list">
            {teamPairs.filter(p => Number(p.legal_balls_faced) > 0).map((p) => (
              <div className="scorecard-player-card" key={p.pair_innings_id}>
                <div className="scorecard-player-card__name">
                  Pair {p.pair_number} — {p.batter_1_name} & {p.batter_2_name}
                </div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Runs" value={Number(p.pair_total_runs)} highlight={Number(p.pair_total_runs) < 0} />
                  <Stat label="Balls" value={Number(p.legal_balls_faced)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h4 className="scorecard-section-label">Bowling</h4>
      {bowledPlayers.length === 0 ? (
        <p className="scorecard-empty">No bowlers yet.</p>
      ) : (
        <div className="scorecard-list">
          {bowledPlayers.map((p) => {
            const legalBalls = Number(p.legal_balls_bowled);
            const completedOvers = Math.floor(legalBalls / 6);
            const ballsIntoCurrentOver = legalBalls % 6;
            // Same "X.Y" overs format already used by the bowler
            // picker (RosterPickerModal/getBowlerOvers) — kept
            // consistent rather than inventing a different display
            // convention just for this screen.
            const oversDisplay =
              ballsIntoCurrentOver === 0 ? `${completedOvers}` : `${completedOvers}.${ballsIntoCurrentOver}`;
            return (
              <div className="scorecard-player-card" key={`${p.player_id}-${p.innings_id}`}>
                <div className="scorecard-player-card__name">{p.display_name}</div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Overs" value={oversDisplay} />
                  <Stat label="Runs" value={p.runs_conceded} />
                  {/* bowler_credited_wickets (bowled/caught_and_bowled
                      only) is the figure that belongs on a bowling
                      line, NOT total_wickets_in_spell — a run-out or
                      stumping during this bowler's over is a real
                      wicket but isn't conventionally credited to the
                      bowler's own tally. */}
                  <Stat label="Wkts" value={p.bowler_credited_wickets} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className="scorecard-stat">
      <span className="scorecard-stat__value" style={highlight ? { color: 'var(--color-coral)' } : undefined}>{value}</span>
      <span className="scorecard-stat__label" style={highlight ? { color: 'var(--color-coral)' } : undefined}>{label}</span>
    </div>
  );
}
