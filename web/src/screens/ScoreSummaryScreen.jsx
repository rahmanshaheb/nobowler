// ScoreSummaryScreen.jsx — full-page match score summary (app theme).

import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { totalOversForSquadSize } from '../hooks/useDeliveryComputation';
import './ScoreSummaryScreen.css';
import '../screens/ScoringScreen.css';

const POLL_MS = 5000;

const IconTrophy = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"/>
    <path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"/>
    <path d="M18 9h1.5a1 1 0 0 0 0-5H18"/>
    <path d="M4 22h16"/>
    <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/>
    <path d="M6 9H4.5a1 1 0 0 1 0-5H6"/>
  </svg>
);

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

function getInningsBatters(roster, battingStats, teamKey, activeBatterIds) {
  const statsById = new Map(
    battingStats.filter((b) => b.team === teamKey).map((b) => [b.player_id, b])
  );

  return roster
    .filter((p) => p.team === teamKey)
    .sort((a, b) => (a.squad_position ?? 0) - (b.squad_position ?? 0))
    .map((p) => {
      const stat = statsById.get(p.id);
      const ballsFaced = Number(stat?.balls_faced ?? 0);
      const isActive = activeBatterIds.includes(p.id);

      if (ballsFaced === 0 && !isActive) {
        return { id: p.id, name: p.display_name, didNotBat: true };
      }

      const runs = stat
        ? Number(stat.runs_scored) - Number(stat.times_dismissed ?? 0) * 5
        : 0;
      const notOut = stat ? Number(stat.times_dismissed ?? 0) === 0 : isActive;

      return { id: p.id, name: p.display_name, runs, notOut, didNotBat: false, isActive };
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
        wickets: Number(stat.bowler_credited_wickets ?? 0),
        runs: Number(stat.runs_conceded ?? 0),
        didNotBowl: false,
      };
    });
}

function TeamInningsBlock({
  inn,
  match,
  roster,
  battingStats,
  bowlingStats,
  activeBatterIds,
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

  const batters = getInningsBatters(roster, battingStats, battingTeamKey, activeBatterIds);
  const bowlers = getInningsBowlers(roster, bowlingStats, bowlingTeamKey, inn.innings_id);

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
          <ul className="summary-player-list">
            {batters.map((b) => (
              <li className={`summary-player-row${b.didNotBat ? ' summary-player-row--idle' : ''}`} key={b.id}>
                <span className="summary-player-row__name">
                  {b.isActive && <span className="summary-player-row__live">●</span>}
                  {b.name}
                </span>
                <span className={`summary-player-row__value${b.notOut && !b.didNotBat ? ' scorecard-not-out' : ''}`}>
                  {b.didNotBat ? '—' : `${b.runs}${b.notOut ? '*' : ''}`}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="summary-col">
          <h3 className="scorecard-section-label scorecard-section-label--bowling">
            Bowling — {bowlingTeamName}
          </h3>
          <ul className="summary-player-list">
            {bowlers.map((b) => (
              <li className={`summary-player-row${b.didNotBowl ? ' summary-player-row--idle' : ''}`} key={b.id}>
                <span className="summary-player-row__name">{b.name}</span>
                <span className="summary-player-row__value">
                  {b.didNotBowl ? '—' : `${b.wickets}-${b.runs}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function ScoreSummaryScreen({ matchId, onBack }) {
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [activeBatterIds, setActiveBatterIds] = useState([]);
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

  useEffect(() => {
    if (!matchId || data?.match?.status !== 'live') {
      setActiveBatterIds([]);
      return;
    }

    let cancelled = false;

    api.get(`/matches/${matchId}/rehydrate`)
      .then((r) => {
        if (!cancelled && r.strikerId) {
          setActiveBatterIds([r.strikerId, r.nonStrikerId].filter(Boolean));
        }
      })
      .catch(() => {
        if (!cancelled) setActiveBatterIds([]);
      });

    return () => { cancelled = true; };
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

  const { match, roster = [], battingStats, bowlingStats, innings = [], manOfMatch } = data;
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

        {(resultSummary || manOfMatch || match.wide_count_enabled === false) && (
          <div className="scorecard-summary-box">
            {resultSummary && (
              <div className="scorecard-summary-row scorecard-summary-row--result">{resultSummary}</div>
            )}
            {manOfMatch && (
              <div className="scorecard-summary-row scorecard-summary-row--motm">
                <IconTrophy />
                <span>Man of the match: {manOfMatch.name}</span>
              </div>
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
              activeBatterIds={activeBatterIds}
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
