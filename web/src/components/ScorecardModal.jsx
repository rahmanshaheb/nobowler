// ScorecardModal.jsx
import { useState, useEffect } from 'react';
import { api } from '../api/client';

// This format always plays out both innings in full regardless of
// wickets or target reached (no early finish), so "won by N wickets"
// doesn't apply here the way it does in standard cricket — the result
// is always purely a run-margin comparison between the two final totals.
function getResultSummary(match, innings) {
  if (innings.length < 2) return null;
  const [inn1, inn2] = innings;
  const teamName = (inn) => (inn.batting_team === 'A' ? match.team_a_name : match.team_b_name);
  const runs1 = Number(inn1.total_runs ?? 0);
  const runs2 = Number(inn2.total_runs ?? 0);
  if (runs1 === runs2) return 'Match tied';
  const margin = Math.abs(runs1 - runs2);
  const winner = runs1 > runs2 ? teamName(inn1) : teamName(inn2);
  return `${winner} won by ${margin} run${margin === 1 ? '' : 's'}`;
}

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
    return () => { cancelled = true; };
  }, [matchId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--scorecard" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">Scorecard</h2>
        {error && <p className="scorecard-status scorecard-status--error">{error}</p>}
        {!error && !data && <p className="scorecard-status">Loading…</p>}
        {data && (() => {
          const innings = [...(data.innings || [])].sort((a, b) => a.innings_number - b.innings_number);
          const activeBatterIds = [strikerId, nonStrikerId].filter(Boolean);
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
          const resultSummary = getResultSummary(data.match, innings);
          return (
            <div className="scorecard-content">
              {(resultSummary || data.match.wide_count_enabled === false) && (
                <div className="scorecard-summary-box">
                  {resultSummary && (
                    <div className="scorecard-summary-row scorecard-summary-row--result">{resultSummary}</div>
                  )}
                  {data.match.wide_count_enabled === false && (
                    <div className="scorecard-summary-row scorecard-summary-row--no-wide">
                      No wide count for this match
                    </div>
                  )}
                </div>
              )}
              {innings.map((inn) => {
                const battingTeamKey = inn.batting_team;
                const bowlingTeamKey = battingTeamKey === 'A' ? 'B' : 'A';
                const battingTeamName = battingTeamKey === 'A' ? data.match.team_a_name : data.match.team_b_name;
                const bowlingTeamName = bowlingTeamKey === 'A' ? data.match.team_a_name : data.match.team_b_name;
                const innZones = (data.zoneStats || []).filter((z) => Number(z.innings_number) === inn.innings_number);
                const innFielding = (data.fieldingStats || []).filter((f) => Number(f.innings_number) === inn.innings_number);
                return (
                  <InningsScorecard
                    key={inn.innings_id}
                    inningsNumber={inn.innings_number}
                    inn={inn}
                    battingTeamName={battingTeamName}
                    bowlingTeamName={bowlingTeamName}
                    battingTeamKey={battingTeamKey}
                    bowlingTeamKey={bowlingTeamKey}
                    battingStats={data.battingStats}
                    bowlingStats={data.bowlingStats}
                    pairStats={data.pairStats || []}
                    activeBatterIds={activeBatterIds}
                    zoneStats={innZones}
                    fieldingStats={innFielding}
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

function InningsScorecard({ inningsNumber, inn, battingTeamName, bowlingTeamName, battingTeamKey, bowlingTeamKey, battingStats, bowlingStats, pairStats, activeBatterIds, zoneStats, fieldingStats }) {
  const everAtCreaseIds = new Set(
    pairStats
      .filter((p) => p.batting_team === battingTeamKey && Number(p.innings_number) === inningsNumber && (Number(p.legal_balls_faced) > 0 || Number(p.extra_runs ?? 0) > 0))
      .flatMap((p) => [p.batter_1_id, p.batter_2_id].filter(Boolean))
  );
  const battedPlayers = battingStats.filter((p) => p.team === battingTeamKey && (Number(p.balls_faced) > 0 || activeBatterIds.includes(p.player_id) || everAtCreaseIds.has(p.player_id)));
  const bowledPlayers = bowlingStats.filter((p) => p.team === bowlingTeamKey && (Number(p.legal_balls_bowled) > 0 || Number(p.extra_runs ?? 0) > 0));
  const teamPairs = pairStats
    .filter((p) => p.batting_team === battingTeamKey && Number(p.innings_number) === inningsNumber && Number(p.legal_balls_faced) > 0)
    .map((p, i) => ({ ...p, displayNumber: i + 1 }));

  // Consolidate fielding per player
  const fieldingByPlayer = {};
  (fieldingStats || []).forEach(({ fielder, wicket_type, count }) => {
    if (!fieldingByPlayer[fielder]) fieldingByPlayer[fielder] = { catches: 0, run_outs: 0, stumpings: 0 };
    if (wicket_type === 'caught') fieldingByPlayer[fielder].catches += Number(count);
    else if (wicket_type === 'run_out') fieldingByPlayer[fielder].run_outs += Number(count);
    else if (wicket_type === 'stumped') fieldingByPlayer[fielder].stumpings += Number(count);
  });
  const fielders = Object.entries(fieldingByPlayer)
    .map(([name, f]) => ({ name, ...f, total: f.catches + f.run_outs + f.stumpings }))
    .sort((a, b) => b.total - a.total);

  return (
    <section className="scorecard-team">
      <h3 className="scorecard-team__title">
        Innings {inningsNumber} — {battingTeamName}{' '}
        <span style={{ color: 'var(--color-mint)' }}>{Number(inn?.total_runs ?? 0)}</span>
      </h3>

      <h4 className="scorecard-section-label scorecard-section-label--batting">Batting</h4>
      {battedPlayers.length === 0 ? (
        <p className="scorecard-empty">No batters yet.</p>
      ) : (
        <div className="scorecard-list">
          {battedPlayers.map((p) => (
            <div className="scorecard-player-card" key={p.player_id}>
              <div className="scorecard-player-card__name">
                {activeBatterIds.includes(p.player_id) && (
                  <span style={{ color: 'var(--color-mint)', marginRight: 6, fontSize: 14, verticalAlign: 'middle', lineHeight: 1 }}>●</span>
                )}
                {p.display_name}
              </div>
              <div className="scorecard-player-card__stats">
                <Stat label="Runs" value={Number(p.runs_scored) - (Number(p.times_dismissed ?? 0) * 5)} />
                <Stat label="Balls" value={p.balls_faced} />
                <Stat label="4s" value={p.fours} />
                <Stat label="6s" value={p.sixes} />
                <Stat label="Out" value={p.times_dismissed ?? 0} />
              </div>
            </div>
          ))}
        </div>
      )}

      {teamPairs.length > 0 && (
        <>
          <h4 className="scorecard-section-label scorecard-section-label--pairs">Pair Totals</h4>
          <div className="scorecard-list">
            {teamPairs.map((p) => (
              <div className="scorecard-player-card scorecard-player-card--pair" key={p.pair_innings_id}>
                <div className="scorecard-player-card__name">
                  Pair {p.displayNumber} — {p.batter_1_name} & {p.batter_2_name}
                </div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Runs" value={Number(p.pair_total_runs)} highlight={Number(p.pair_total_runs) < 0} />
                  <Stat label="Balls" value={Number(p.legal_balls_faced)} />
                  <Stat label="Extra" value={Number(p.extra_runs ?? 0)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(zoneStats || []).length > 0 && (
        <>
          <h4 className="scorecard-section-label scorecard-section-label--zones">Zone Breakdown</h4>
          <div className="scorecard-player-card">
            <div className="scorecard-player-card__stats">
              {(zoneStats || []).map((z) => (
                <Stat key={z.zone_hit} label={`Zone ${z.zone_hit}`} value={Number(z.runs)} />
              ))}
            </div>
          </div>
        </>
      )}

      <h4 className="scorecard-section-label scorecard-section-label--bowling">Bowling — {bowlingTeamName}</h4>
      {bowledPlayers.length === 0 ? (
        <p className="scorecard-empty">No bowlers yet.</p>
      ) : (
        <div className="scorecard-list">
          {bowledPlayers.map((p) => {
            const lb = Number(p.legal_balls_bowled);
            const overs = lb % 6 === 0 ? String(lb / 6) : `${Math.floor(lb / 6)}.${lb % 6}`;
            const f = fieldingByPlayer[p.display_name];
            return (
              <div className="scorecard-player-card" key={`${p.player_id}-${p.innings_id}`}>
                <div className="scorecard-player-card__name">{p.display_name}</div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Overs" value={overs} />
                  <Stat label="Runs" value={p.runs_conceded} />
                  <Stat label="Wkts" value={p.bowler_credited_wickets} />
                  <Stat label="Extra" value={Number(p.extra_runs ?? 0)} />
                  {f?.catches > 0 && <Stat label="Catch" value={f.catches} />}
                  {f?.run_outs > 0 && <Stat label="Runout" value={f.run_outs} />}
                  {f?.stumpings > 0 && <Stat label="Stumped" value={f.stumpings} />}
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
  const battedPlayers = battingStats.filter((p) => p.team === teamKey && Number(p.balls_faced) > 0);
  const bowledPlayers = bowlingStats.filter((p) => p.team === teamKey && Number(p.legal_balls_bowled) > 0);
  const teamPairs = pairStats
    .filter((p) => p.batting_team === teamKey && Number(p.legal_balls_faced) > 0)
    .map((p, i) => ({ ...p, displayNumber: i + 1 }));

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
                  <span style={{ color: 'var(--color-mint)', marginRight: 6, fontSize: 14, verticalAlign: 'middle', lineHeight: 1 }}>●</span>
                )}
                {p.display_name}
              </div>
              <div className="scorecard-player-card__stats">
                <Stat label="Runs" value={Number(p.runs_scored) - (Number(p.times_dismissed ?? 0) * 5)} />
                <Stat label="Balls" value={p.balls_faced} />
                <Stat label="4s" value={p.fours} />
                <Stat label="6s" value={p.sixes} />
                <Stat label="Out" value={p.times_dismissed ?? 0} />
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
                  Pair {p.displayNumber} — {p.batter_1_name} & {p.batter_2_name}
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
            const lb = Number(p.legal_balls_bowled);
            const overs = lb % 6 === 0 ? String(lb / 6) : `${Math.floor(lb / 6)}.${lb % 6}`;
            return (
              <div className="scorecard-player-card" key={`${p.player_id}-${p.innings_id}`}>
                <div className="scorecard-player-card__name">{p.display_name}</div>
                <div className="scorecard-player-card__stats">
                  <Stat label="Overs" value={overs} />
                  <Stat label="Runs" value={p.runs_conceded} />
                  <Stat label="Wkts" value={p.bowler_credited_wickets} />
                  <Stat label="Extra" value={Number(p.extra_runs ?? 0)} />
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
