import { useState, useEffect } from 'react';
import { api } from '../api/client';
import './PlayerStatsScreen.css';

const TABS = [
  { id: 'batsman', label: 'Batsman', accent: 'batting' },
  { id: 'bowler', label: 'Bowler', accent: 'bowling' },
  { id: 'fielding', label: 'Fielding', accent: 'fielding' },
];

function battingRuns(stat) {
  return Number(stat?.runs_scored ?? 0) - Number(stat?.times_dismissed ?? 0) * 5;
}

function formatOvers(legalBalls) {
  const lb = Number(legalBalls ?? 0);
  if (lb === 0) return '0';
  return lb % 6 === 0 ? String(lb / 6) : `${Math.floor(lb / 6)}.${lb % 6}`;
}

function PlayerRow({ rank, name, cells, accent }) {
  const topClass = rank <= 3 ? ` ps-row--top-${rank}` : '';

  return (
    <div className={`ps-row ps-row--${accent}${topClass}`}>
      <span className="ps-row__rank">{rank}</span>
      <span className="ps-row__name">{name}</span>
      <div className="ps-row__stats">
        {cells.map((c) => (
          <span className="ps-row__cell" key={c.label}>
            <span className="ps-row__cell-value">{c.value}</span>
            <span className="ps-row__cell-label">{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StatsList({ columns, children, accent }) {
  return (
    <div className={`ps-table ps-table--${accent}`}>
      <div className="ps-table__head">
        <span className="ps-table__head-rank">#</span>
        <span className="ps-table__head-name">Player</span>
        <div className="ps-table__head-stats">
          {columns.map((col) => (
            <span className="ps-table__head-cell" key={col}>{col}</span>
          ))}
        </div>
      </div>
      <div className="ps-table__body">{children}</div>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="ps-empty">
      <p className="ps-empty__text">{message}</p>
    </div>
  );
}

const BAT_COLUMNS = ['Runs', 'M', 'B', '4s', '6s', 'Out', 'SR'];
const BOWL_COLUMNS = ['Wkts', 'M', 'O', 'Runs', 'X'];
const FIELD_COLUMNS = ['Tot', 'M', 'Ct', 'RO', 'St'];

function BatsmanTab({ battingStats }) {
  if (!battingStats.length) {
    return <EmptyState message="No batting stats yet." />;
  }

  return (
    <StatsList columns={BAT_COLUMNS} accent="batting">
      {battingStats.map((p, i) => (
        <PlayerRow
          key={p.display_name}
          rank={i + 1}
          name={p.display_name}
          accent="batting"
          cells={[
            { label: 'Runs', value: battingRuns(p) },
            { label: 'M', value: p.matches_played },
            { label: 'B', value: p.balls_faced },
            { label: '4s', value: p.fours },
            { label: '6s', value: p.sixes },
            { label: 'Out', value: p.times_dismissed },
            { label: 'SR', value: p.strike_rate },
          ]}
        />
      ))}
    </StatsList>
  );
}

function BowlerTab({ bowlingStats }) {
  if (!bowlingStats.length) {
    return <EmptyState message="No bowling stats yet." />;
  }

  return (
    <StatsList columns={BOWL_COLUMNS} accent="bowling">
      {bowlingStats.map((p, i) => (
        <PlayerRow
          key={p.display_name}
          rank={i + 1}
          name={p.display_name}
          accent="bowling"
          cells={[
            { label: 'Wkts', value: p.wickets },
            { label: 'M', value: p.matches_bowled },
            { label: 'O', value: formatOvers(p.legal_balls_bowled) },
            { label: 'Runs', value: p.runs_conceded },
            { label: 'X', value: p.extra_runs },
          ]}
        />
      ))}
    </StatsList>
  );
}

function FieldingTab({ fieldingStats }) {
  if (!fieldingStats.length) {
    return <EmptyState message="No fielding stats yet." />;
  }

  return (
    <StatsList columns={FIELD_COLUMNS} accent="fielding">
      {fieldingStats.map((p, i) => {
        const total = Number(p.catches) + Number(p.run_outs) + Number(p.stumpings);
        return (
          <PlayerRow
            key={p.display_name}
            rank={i + 1}
            name={p.display_name}
            accent="fielding"
            cells={[
              { label: 'Tot', value: total },
              { label: 'M', value: p.matches_fielded },
              { label: 'Ct', value: p.catches },
              { label: 'RO', value: p.run_outs },
              { label: 'St', value: p.stumpings },
            ]}
          />
        );
      })}
    </StatsList>
  );
}

export default function PlayerStatsScreen({ onBack }) {
  const [tab, setTab] = useState('batsman');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await api.get('/public/player-stats');
        if (!cancelled) {
          setData(result);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load player stats.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  function handleBack() {
    if (onBack) onBack();
    else if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  }

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  if (loading) {
    return (
      <div className="player-stats-screen">
        <header className="ps-header">
          <button type="button" className="ps-header__back" onClick={handleBack} aria-label="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="ps-header__title">Player Stats</h1>
        </header>
        <div className="ps-loading">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="player-stats-screen">
        <header className="ps-header">
          <button type="button" className="ps-header__back" onClick={handleBack} aria-label="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="ps-header__title">Player Stats</h1>
        </header>
        <p className="ps-error">{error || 'Stats unavailable.'}</p>
      </div>
    );
  }

  const { matchCount, battingStats = [], bowlingStats = [], fieldingStats = [] } = data;
  const tabCounts = {
    batsman: battingStats.length,
    bowler: bowlingStats.length,
    fielding: fieldingStats.length,
  };

  return (
    <div className="player-stats-screen">
      <header className="ps-header">
        <button type="button" className="ps-header__back" onClick={handleBack} aria-label="Back">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <h1 className="ps-header__title">Player Stats</h1>
      </header>

      <div className="ps-body">
        <p className={`ps-summary ps-summary--${activeTab.accent}`}>
          <span className="ps-summary__label">All matches</span>
          <span className="ps-summary__sep">·</span>
          <span>{matchCount} matches</span>
          <span className="ps-summary__sep">·</span>
          <span>{tabCounts[tab]} {activeTab.label.toLowerCase()}s</span>
        </p>

        <div className="ps-tabs" role="tablist" aria-label="Player statistics">
          {TABS.map(({ id, label, accent }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`ps-tab ps-tab--${accent}${tab === id ? ' ps-tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ps-panel" role="tabpanel">
          {tab === 'batsman' && <BatsmanTab battingStats={battingStats} />}
          {tab === 'bowler' && <BowlerTab bowlingStats={bowlingStats} />}
          {tab === 'fielding' && <FieldingTab fieldingStats={fieldingStats} />}
        </div>
      </div>
    </div>
  );
}
