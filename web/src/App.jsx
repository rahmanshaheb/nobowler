import { useState, useEffect } from 'react';
import './styles/tokens.css';
import './App.css';
import MatchSetupScreen from './screens/MatchSetupScreen';
import LiveMatchContainer from './screens/LiveMatchContainer';
import LiveViewScreen from './screens/LiveViewScreen';
import RehydrateGate from './components/RehydrateGate';
import RulebookModal from './components/RulebookModal';
import MatchesScreen from './screens/MatchesScreen';
import WhatsNewScreen from './screens/WhatsNewScreen';
import JoinMatchScreen from './screens/JoinMatchScreen';
import { saveActiveMatchId } from './utils/matchStorage';
import { api } from './api/client';

const DISABLE_NEW_MATCH = false;

const livePathMatch = window.location.pathname.replace(/\/$/, '').match(/^\/live(?:\/([^/]+))?$/);
const isLiveViewPath = !!livePathMatch;
const liveMatchIdFromUrl = livePathMatch?.[1] ?? null;

const IconNewMatch = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
  </svg>
);

const IconJoin = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m10 17 5-5-5-5"/>
    <path d="M15 12H3"/>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
  </svg>
);

const IconLive = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"/>
    <path d="M7 21h10"/>
    <rect width="20" height="14" x="2" y="3" rx="2"/>
  </svg>
);

const IconLock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const IconScorecard = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const IconRulebook = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>
    <path d="M8 11h8"/>
    <path d="M8 7h6"/>
  </svg>
);

export default function App() {
  const [matchContext, setMatchContext] = useState(null);
  const [mode, setMode] = useState(() => {
    if (isLiveViewPath) return 'live';
    return sessionStorage.getItem('app_mode') || null;
  });
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [rehydrationChecked, setRehydrationChecked] = useState(false);

  function setModePersisted(m) {
    if (m) sessionStorage.setItem('app_mode', m);
    else sessionStorage.removeItem('app_mode');
    setMode(m);
  }

  if (mode === 'live') return <LiveViewScreen matchId={liveMatchIdFromUrl} />;

  if (!rehydrationChecked) {
    return (
      <RehydrateGate
        onResume={(resumedContext) => {
          setMatchContext(resumedContext);
          setModePersisted('score');
          setRehydrationChecked(true);
        }}
        onNoMatch={() => setRehydrationChecked(true)}
      />
    );
  }

  if (mode === 'join') {
    return (
      <JoinMatchScreen
        onJoined={(context) => {
          saveActiveMatchId(context.matchId);
          setMatchContext(context);
          setModePersisted('score');
        }}
        onBack={() => setModePersisted(null)}
      />
    );
  }

  if (mode === 'matches') {
    return <MatchesScreen onBack={() => setModePersisted(null)} />;
  }

  if (mode === 'whats-new') {
    return <WhatsNewScreen onBack={() => setModePersisted(null)} />;
  }

  if (mode === null) {
    return (
      <div className="landing-screen">
        <div className="landing-top">
          <p className="landing-welcome">Welcome to</p>
          <h1 className="landing-title">The NO Bowlers</h1>
          <div className="landing-pills">
            <button className="landing-pill" onClick={() => setRulebookOpen(true)}>
              <IconRulebook />
              Rulebook
            </button>
            <button className="landing-pill" onClick={() => setModePersisted('whats-new')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
                <path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>
              </svg>
              What's new
            </button>
          </div>
        </div>
        <div className="landing-buttons">
          <button className="landing-button" onClick={() => setModePersisted('score')} disabled={DISABLE_NEW_MATCH} style={DISABLE_NEW_MATCH ? { opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' } : {}}>
            {DISABLE_NEW_MATCH ? <IconLock /> : <IconNewMatch />}
            New match
          </button>
          <button className="landing-button landing-button--secondary" onClick={() => setModePersisted('join')}>
            <IconJoin />
            Join a match
          </button>
          <button className="landing-button landing-button--secondary" onClick={() => window.open('/live', '_blank')}>
            <IconLive />
            Live view
          </button>
          <button
            className="landing-button landing-button--secondary"
            onClick={() => setModePersisted('matches')}
          >
            <IconScorecard />
            Scorecard
          </button>
        </div>

        <div className="landing-sponsor">
          <p className="landing-version">V1.0</p>
          <p className="landing-sponsor__label">Sponsored by</p>
          <img src="/sponsor-logo.svg" alt="Sponsor" className="landing-sponsor__logo" />
        </div>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  if (!matchContext) {
    return (
      <MatchSetupScreen
        onBack={() => setModePersisted(null)}
        onReady={(context) => {
          saveActiveMatchId(context.matchId);
          setMatchContext(context);
        }}
      />
    );
  }

  function handleReturnHome() {
    setModePersisted(null);
    setMatchContext(null);
  }

  return <LiveMatchContainer matchContext={matchContext} onReturnHome={handleReturnHome} />;
}
