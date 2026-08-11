// ScoreSummaryScreen.jsx — full-page match score summary (app theme).

import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { totalOversForSquadSize } from '../hooks/useDeliveryComputation';
import './ScoreSummaryScreen.css';
import '../screens/ScoringScreen.css';

const POLL_MS = 5000;

function getResultSummary(match, innings) {
  if (match.result_summary) return match.result_summary;
  if (!innings || innings.length < 2) return null;
  const [inn1, inn2] = [...innings].sort((a, b) => a.innings_number - b.innings_number);
  const teamName = (inn) => (inn.batting_team === 'A' ? match.team_a_name : match.team_b_name);
  const runs1 = Number(inn1.total_runs ?? 0);
  const runs2 = Number(inn2.total_runs ?? 0);
  if (runs1 === runs2) return 'Match tied';
  const margin = Math.abs(runs1 - runs2);
  const winner = runs1 > runs2 ? teamName(inn1) : teamName(inn2);
  return `${winner} won by ${margin} run${margin === 1 ? '' : 's'}`;
}

function formatMatchDate(match) {
  const d = new Date(match.match_date || match.created_at);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function maxOversForTeam(roster, teamKey) {
  const size = roster.filter((p) => p.team === teamKey).length;
  try {
    return totalOversForSquadSize(size);
  } catch {
    return 16;
  }
}

function formatOversLabel(inn, maxOvers, isInningsComplete, liveOver) {
  if (liveOver) {
    const { overNumber, ballNumberInOver } = liveOver;
    if (ballNumberInOver === 0 && overNumber > 0) return `${overNumber} overs`;
    if (overNumber === 0 && ballNumberInOver === 0) return '0 overs';
    return `${overNumber}.${ballNumberInOver} overs`;
  }

  const over = Number(inn.last_over_number ?? 0);
  const ball = Number(inn.last_ball_number ?? 0);

  if (isInningsComplete) return `${maxOvers} overs`;
  if (over === 0 && ball === 0) return '0 overs';
  if (ball === 6) return `${over + 1} overs`;
  if (ball === 0) return `${over} overs`;
  return `${over}.${ball} overs`;
}

function formatBowlerOvers(legalBalls) {
  const lb = Number(legalBalls);
  if (lb === 0) return '0.0';
  return lb % 6 === 0 ? String(lb / 6) : `${Math.floor(lb / 6)}.${lb % 6}`;
}

function getInningsBatters(roster, battingStats, teamKey) {
  const statsById = new Map(
    battingStats.filter((b) => b.team === teamKey).map((b) => [b.player_id, b])
  );

  return roster
    .filter((p) => p.team === teamKey)
    .sort((a, b) => (a.squad_position ?? 0) - (b.squad_position ?? 0))
    .map((p) => {
      const stat = statsById.get(p.id);
      const ballsFaced = Number(stat?.balls_faced ?? 0);

      if (ballsFaced === 0) {
        return { id: p.id, name: p.display_name, didNotBat: true };
      }

      const outs = Number(stat?.times_dismissed ?? 0);
      const runs = Number(stat?.runs_scored ?? 0) - outs * 5;
      const notOut = outs === 0;

      return {
        id: p.id,
        name: p.display_name,
        runs,
        balls: ballsFaced,
        outs,
        notOut,
        didNotBat: false,
      };
    });
}

function getInningsBowlers(roster, bowlingStats, bowlingTeamKey, inningsId) {
  const statsById = new Map(
    bowlingStats
      .filter((b) => b.team === bowlingTeamKey && b.innings_id === inningsId)
      .map((b) => [b.player_id, b])
  );

  return roster
    .filter((p) => p.team === bowlingTeamKey)
    .sort((a, b) => (a.squad_position ?? 0) - (b.squad_position ?? 0))
    .map((p) => {
      const stat = statsById.get(p.id);
      const legalBalls = Number(stat?.legal_balls_bowled ?? 0);

      if (legalBalls === 0) {
        return { id: p.id, name: p.display_name, didNotBowl: true };
      }

      return {
        id: p.id,
        name: p.display_name,
        overs: formatBowlerOvers(legalBalls),
        wickets: Number(stat.bowler_credited_wickets ?? 0),
        runs: Number(stat.runs_conceded ?? 0),
        didNotBowl: false,
      };
    });
}

function SummaryStatTable({ columns, rows }) {
  return (
    <div className="summary-stat-table">
      <div className="summary-stat-table__head">
        {columns.map((col) => (
          <span
            key={col.key}
            className={`summary-stat-table__cell summary-stat-table__cell--${col.align}${col.key === 'name' ? ' summary-stat-table__cell--name' : ''}`}
          >
            {col.label}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          className={`summary-stat-table__row${row.idle ? ' summary-stat-table__row--idle' : ''}`}
          key={row.key}
        >
          {columns.map((col) => (
            <span
              key={col.key}
              className={`summary-stat-table__cell summary-stat-table__cell--${col.align}${col.key === 'name' ? ' summary-stat-table__cell--name' : ''}${col.key === 'run' && row.notOut ? ' scorecard-not-out' : ''}`}
            >
              {row[col.key]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TeamInningsBlock({
  inn,
  match,
  roster,
  battingStats,
  bowlingStats,
  isInningsComplete,
  liveInningsId,
  liveTotals,
  liveOver,
}) {
  const battingTeamKey = inn.batting_team;
  const bowlingTeamKey = battingTeamKey === 'A' ? 'B' : 'A';
  const battingTeamName = battingTeamKey === 'A' ? match.team_a_name : match.team_b_name;
  const bowlingTeamName = bowlingTeamKey === 'A' ? match.team_a_name : match.team_b_name;
  const maxOvers = maxOversForTeam(roster, battingTeamKey);

  const isLiveInnings = liveInningsId === inn.innings_id;
  const totalRuns = isLiveInnings && liveTotals ? liveTotals.runs : Number(inn.total_runs ?? 0);
  const totalWickets = isLiveInnings && liveTotals ? liveTotals.wickets : Number(inn.total_wickets ?? 0);

  const batters = getInningsBatters(roster, battingStats, battingTeamKey);
  const bowlers = getInningsBowlers(roster, bowlingStats, bowlingTeamKey, inn.innings_id);

  const battingColumns = [
    { key: 'name', label: 'Batsman', align: 'left' },
    { key: 'run', label: 'Run', align: 'right' },
    { key: 'ball', label: 'Ball', align: 'right' },
    { key: 'out', label: 'Out', align: 'right' },
  ];
  const battingRows = batters.map((b) => ({
    key: b.id,
    idle: b.didNotBat,
    notOut: b.notOut,
    name: b.name,
    run: b.didNotBat ? '—' : `${b.runs}${b.notOut ? '*' : ''}`,
    ball: b.didNotBat ? '—' : b.balls,
    out: b.didNotBat ? '—' : b.outs,
  }));

  const bowlingColumns = [
    { key: 'name', label: 'Bowler', align: 'left' },
    { key: 'overs', label: 'Overs', align: 'right' },
    { key: 'runs', label: 'Runs', align: 'right' },
    { key: 'wkt', label: 'Wkt', align: 'right' },
  ];
  const bowlingRows = bowlers.map((b) => ({
    key: b.id,
    idle: b.didNotBowl,
    name: b.name,
    overs: b.didNotBowl ? '—' : b.overs,
    runs: b.didNotBowl ? '—' : b.runs,
    wkt: b.didNotBowl ? '—' : b.wickets,
  }));

  return (
    <section className="summary-innings-card">
      <div className="summary-innings-card__head">
        <div className="summary-innings-card__head-left">
          <span className="summary-innings-card__inn">Innings {inn.innings_number}</span>
          <h2 className="summary-innings-card__team">{battingTeamName}</h2>
        </div>
        <div className="summary-innings-card__head-right">
          <span className="summary-innings-card__total">{totalRuns}-{totalWickets}</span>
          <span className="summary-innings-card__overs">
            {formatOversLabel(
              inn,
              maxOvers,
              isInningsComplete && !isLiveInnings,
              isLiveInnings ? liveOver : null
            )}
          </span>
        </div>
      </div>

      <div className="summary-innings-card__cols">
        <div className="summary-col">
          <h3 className="scorecard-section-label scorecard-section-label--batting">Batting</h3>
          <SummaryStatTable columns={battingColumns} rows={battingRows} />
        </div>

        <div className="summary-col">
          <h3 className="scorecard-section-label scorecard-section-label--bowling">
            Bowling — {bowlingTeamName}
          </h3>
          <SummaryStatTable columns={bowlingColumns} rows={bowlingRows} />
        </div>
      </div>
    </section>
  );
}

export default function ScoreSummaryScreen({ matchId, onBack }) {
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!matchId) {
      setError('No match ID provided.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        const result = await api.get(`/public/matches/${matchId}`);
        if (!cancelled) {
          setData(result);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load match summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMatch();
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    if (!matchId || data?.match?.status !== 'live') {
      setLive(null);
      return;
    }

    let cancelled = false;
    let timer;

    async function pollLive() {
      try {
        const result = await api.get(`/public/live-now?matchId=${matchId}`);
        if (!cancelled) setLive(result);
      } catch {
        if (!cancelled) setLive(null);
      }
    }

    pollLive();
    timer = setInterval(pollLive, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [matchId, data?.match?.status]);

  function handleBack() {
    if (onBack) onBack();
    else if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  }

  if (!matchId) {
    return (
      <div className="summary-screen">
        <p className="scorecard-status scorecard-status--error">Open a match from the Scorecard list.</p>
        <button type="button" className="summary-back-link" onClick={() => { window.location.href = '/'; }}>Home</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="summary-screen">
        <p className="scorecard-status">Loading score summary…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="summary-screen">
        <header className="summary-header">
          <button type="button" className="summary-back" onClick={handleBack} aria-label="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        </header>
        <p className="scorecard-status scorecard-status--error">{error || 'Match not found.'}</p>
      </div>
    );
  }

  const { match, roster = [], battingStats, bowlingStats, innings = [] } = data;
  const sortedInnings = [...innings].sort((a, b) => a.innings_number - b.innings_number);
  const resultSummary = getResultSummary(match, sortedInnings);
  const isLive = match.status === 'live';
  const statusLabel = isLive ? 'Live' : match.status === 'completed' ? 'Completed' : match.status === 'setup' ? 'Setup' : match.status;

  const liveTotals = live ? { runs: live.totalRuns, wickets: live.totalWickets } : null;
  const liveOver = live ? { overNumber: live.overNumber, ballNumberInOver: live.ballNumberInOver } : null;

  return (
    <div className="summary-screen">
      <header className="summary-header">
        <button type="button" className="summary-back" onClick={handleBack} aria-label="Back">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <h1 className="summary-title">Score Summary</h1>
      </header>

      <div className="summary-body">
        <section className="summary-match-meta">
          <h2 className="summary-match-meta__teams">{match.team_a_name} vs {match.team_b_name}</h2>
          <p className="summary-match-meta__date">{formatMatchDate(match)}</p>
          <div className="summary-match-meta__tags">
            <span className={`summary-badge summary-badge--${match.status}`}>{statusLabel}</span>
            {match.join_code && (
              <span className="summary-match-meta__code">Code {match.join_code}</span>
            )}
          </div>
          <button
            type="button"
            className="summary-stats-link"
            onClick={() => { window.location.href = '/stats'; }}
          >
            Player stats
          </button>
        </section>

        {(resultSummary || match.wide_count_enabled === false) && (
          <div className="scorecard-summary-box">
            {resultSummary && (
              <div className="scorecard-summary-row scorecard-summary-row--result">{resultSummary}</div>
            )}
            {match.wide_count_enabled === false && (
              <div className="scorecard-summary-row scorecard-summary-row--no-wide">
                No wide count for this match
              </div>
            )}
          </div>
        )}

        {isLive && (
          <section className="summary-live">
            <span className="summary-live__badge">LIVE</span>
            <div className="summary-live__score">
              <span className="summary-live__team">
                {live?.battingTeam === 'A' ? match.team_a_name : match.team_b_name}
              </span>
              <span className="summary-live__runs">
                {live?.totalRuns ?? '—'}
                {live?.inningsNumber === 2 && live?.targetRuns != null && (
                  <span className="summary-live__target"> / {live.targetRuns}</span>
                )}
              </span>
              <span className="summary-live__meta">
                Inn {live?.inningsNumber ?? '…'} · Over {live?.overNumber ?? 0}.{live?.ballNumberInOver ?? 0}
                {live?.totalWickets != null ? ` · ${live.totalWickets} wkts` : ''}
              </span>
            </div>
            {(live?.strikerName || live?.bowlerName) && (
              <div className="summary-live__detail">
                {live.strikerName && (
                  <span>{live.strikerName} & {live.nonStrikerName ?? '—'}</span>
                )}
                {live.bowlerName && (
                  <span>Bowling: {live.bowlerName}</span>
                )}
              </div>
            )}
            {!resultSummary && live?.runsRequired != null && (
              <p className="summary-live__required">
                {live.runsRequired > 0 ? `${live.runsRequired} runs required` : 'Target reached'}
              </p>
            )}
          </section>
        )}

        {sortedInnings.length === 0 ? (
          <p className="scorecard-empty">Match not started yet.</p>
        ) : (
          sortedInnings.map((inn) => (
            <TeamInningsBlock
              key={inn.innings_id}
              inn={inn}
              match={match}
              roster={roster}
              battingStats={battingStats}
              bowlingStats={bowlingStats}
              isInningsComplete={
                match.status === 'completed' ||
                (inn.innings_number === 1 && sortedInnings.some((i) => i.innings_number === 2))
              }
              liveInningsId={live?.inningsId}
              liveTotals={liveTotals}
              liveOver={liveOver}
            />
          ))
        )}

        <footer className="summary-sponsor">
          <p className="summary-sponsor__label">Sponsored by</p>
          <img src="/sponsor-logo.svg" alt="Sponsor" className="summary-sponsor__logo" />
        </footer>
      </div>
    </div>
  );
}
