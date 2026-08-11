import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import OverBallHistory from '../components/OverBallHistory';
import './LiveViewScreen.css';

const POLL_INTERVAL_MS = 4000;
const ANIMATION_DURATION_MS = 3000;

function getBallsRemaining(liveData) {
  if (liveData.totalOvers == null) return null;
  const totalLegalBalls = liveData.totalOvers * 6;
  const legalBallsUsed = liveData.overNumber * 6 + liveData.ballNumberInOver;
  return Math.max(0, totalLegalBalls - legalBallsUsed);
}

function MainScore({ liveData, isChasing, className = 'tv-score' }) {
  if (isChasing) {
    return (
      <div className={`${className}-line`}>
        <span className={`${className} ${className}--chase`}>
          <span className={`${className}__runs`}>{liveData.totalRuns}</span>
          <span className={`${className}__slash`}>/</span>
          <span className={`${className}__target`}>{liveData.targetRuns}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`${className}-line`}>
      <span className={className}>{liveData.totalRuns}</span>
    </div>
  );
}

function ChaseInfo({ liveData, portrait = false }) {
  if (liveData.inningsNumber !== 2 || liveData.targetRuns == null) return null;

  const runsRequired = liveData.runsRequired;
  const ballsLeft = getBallsRemaining(liveData);
  const targetReached = runsRequired != null && runsRequired <= 0;

  return (
    <div className={`tv-chase-info${portrait ? ' tv-chase-info--portrait' : ''}`}>
      <div className="tv-chase-info__item">
        {targetReached ? (
          <span className="tv-chase-info__text tv-chase-info__text--solo">Target reached</span>
        ) : (
          <>
            <span className="tv-chase-info__number">{runsRequired}</span>
            <span className="tv-chase-info__text">
              run{runsRequired === 1 ? '' : 's'} required
            </span>
          </>
        )}
      </div>
      {ballsLeft != null && (
        <>
          <span className="tv-chase-info__sep" aria-hidden="true">·</span>
          <div className="tv-chase-info__item">
            <span className="tv-chase-info__number">{ballsLeft}</span>
            <span className="tv-chase-info__text">
              ball{ballsLeft === 1 ? '' : 's'} left
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function LiveViewScreen({ matchId = null }) {
  const [liveData, setLiveData] = useState(null);
  const [overDeliveries, setOverDeliveries] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [celebration, setCelebration] = useState(null); // { type: 'boundary'|'wicket', score, playerName }
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [overNotification, setOverNotification] = useState(false);
  const pollRef = useRef(null);
  const lastDeliveryIdRef = useRef(null);
  const previousOverNumberRef = useRef(null);
  const initialisedRef = useRef(false); // true after first delivery fetch — prevents stale animation on refresh
  const celebrationTimerRef = useRef(null);
  const overNotificationTimerRef = useRef(null);

  useEffect(() => {
    const endpoint = matchId ? `/public/live-now?matchId=${matchId}` : '/public/live-now';

    async function poll() {
      try {
        const data = await api.get(endpoint);
        setLiveData(data);
        setErrorMessage('');
      } catch (err) {
        if (err.status === 404) {
          setLiveData(null);
          setErrorMessage('');
        } else {
          setErrorMessage(err.message || 'Unable to reach the live score.');
        }
      } finally {
        setLoading(false);
      }
    }

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') poll();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [matchId]);

  useEffect(() => {
    if (!liveData?.matchId || !liveData?.inningsId) return;
    let cancelled = false;

    // Establish the baseline on the very first liveData we ever see,
    // regardless of ballNumberInOver — most page loads land mid-over,
    // not at ball 0. Without this, the ref stayed null until whatever
    // over transition happened to come along first, and THAT transition
    // then got treated as "just initializing" and silently suppressed,
    // so the notification only ever started working from the second
    // over completion after every page load/reload.
    if (previousOverNumberRef.current === null) {
      previousOverNumberRef.current = liveData.overNumber;
    }

    // When an over just completed, ballNumberInOver resets to 0 and
    // overNumber increments. At that point the NEW over has no
    // deliveries yet, but the boundary/wicket that triggered the over
    // completion is in the PREVIOUS over. Fetch that one instead so we
    // don't miss last-ball-of-over boundaries.
    const fetchOver = (liveData.ballNumberInOver === 0 && liveData.overNumber > 0)
      ? liveData.overNumber - 1
      : liveData.overNumber;

    // When a new over starts, clear the dots immediately so the
    // previous over's balls don't linger while we fetch the new over.
    if (liveData.ballNumberInOver === 0) {
      setOverDeliveries([]);
      // Trigger "OVER" notification if the over number changed
      if (liveData.overNumber > previousOverNumberRef.current && initialisedRef.current) {
        if (overNotificationTimerRef.current) clearTimeout(overNotificationTimerRef.current);
        setOverNotification(true);
        overNotificationTimerRef.current = setTimeout(() => {
          setOverNotification(false);
        }, 2000);
      }
      previousOverNumberRef.current = liveData.overNumber;
    }

    api
      .get(`/public/matches/${liveData.matchId}/innings/${liveData.inningsId}/over-deliveries?overNumber=${fetchOver}`)
      .then((deliveries) => {
        if (cancelled) return;

        // Only update the dot display when fetching the current over.
        if (fetchOver === liveData.overNumber) setOverDeliveries(deliveries);

        if (!deliveries.length) return;
        const last = deliveries[deliveries.length - 1];
        if (last.id === lastDeliveryIdRef.current) return;

        const isNewBall = initialisedRef.current; // false on very first fetch
        lastDeliveryIdRef.current = last.id;
        initialisedRef.current = true;

        if (!isNewBall) return; // silently record on page load, no animation

        const isZone4 = Number(last.zoneHit) === 4;
        const isZone6 = Number(last.zoneHit) === 6;

        if (last.isWicket) {
          triggerCelebration({ type: 'wicket', playerName: last.dismissedPlayerName ?? null });
        } else if (isZone4 || isZone6) {
          triggerCelebration({ type: 'boundary', score: Number(last.totalRuns), zone: isZone6 ? 6 : 4 });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [liveData?.matchId, liveData?.inningsId, liveData?.overNumber, liveData?.totalRuns, liveData?.totalWickets]);

  function triggerCelebration(data) {
    if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
    // Increment key to force a full remount of the overlay element —
    // this restarts the CSS animation from 0% even if the same zone
    // fires twice in a row (e.g. two sixes). Without this, React sees
    // identical props and skips the re-render, so the animation never
    // resets and the second boundary shows for whatever time was left
    // on the first one's timer rather than a full 5 seconds.
    setCelebrationKey((k) => k + 1);
    setCelebration(data);
    celebrationTimerRef.current = setTimeout(() => {
      setCelebration(null);
    }, ANIMATION_DURATION_MS);
  }

  if (loading) {
    return <div className="live-view-screen"><p className="live-view-status">Loading…</p></div>;
  }
  if (errorMessage) {
    return <div className="live-view-screen"><p className="live-view-status live-view-status--error">{errorMessage}</p></div>;
  }
  if (!liveData) {
    return (
      <div className="live-view-screen">
        <div className="live-view-offline">
          <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)' }}>
            <path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/>
          </svg>
          <p className="live-view-status">Nothing on air right now</p>
        </div>
      </div>
    );
  }

  const isChasing = liveData.inningsNumber === 2 && liveData.targetRuns != null;

  return (
    <div className="live-view-screen">
      {/* Over completed notification */}
      {overNotification && (
        <div className="over-notification">
          <div className="over-notification__text">OVER 🎾</div>
        </div>
      )}

      {/* Celebration overlay — sits on top of everything, full screen */}
      {celebration && (
        <div key={celebrationKey} className={`celebration-overlay celebration-overlay--${celebration.type}`}>
          {celebration.type === 'boundary' && (
            <>
              <Confetti />
              <div className="celebration-score">{celebration.zone}</div>
            </>
          )}
          {celebration.type === 'wicket' && (
            <>
              <div className="celebration-score">OUT ☝️</div>
              {celebration.playerName && (
                <div className="celebration-label">{celebration.playerName}</div>
              )}
            </>
          )}
        </div>
      )}

      <div className="tv-card">

        {/* Score, over, and ball history */}
        <div className="tv-layout tv-landscape-only">
          <div className="tv-layout__innings">
            <div className="tv-innings-label">INNINGS {liveData.inningsNumber}</div>
          </div>

          <div className="tv-left">
            <div className="tv-score-block">
              <div className="tv-score-block__main">
                <MainScore liveData={liveData} isChasing={isChasing} />
              </div>
              {isChasing && <ChaseInfo liveData={liveData} />}
            </div>

            <div className="tv-row-over">
              <span className="tv-row-over__label">OVER</span>
              <span className="tv-row-over__value">
                {liveData.overNumber}.{liveData.ballNumberInOver}
              </span>
            </div>

            <div className="tv-row-bottom">
              <div className="tv-ball-history">
                <OverBallHistory deliveries={overDeliveries} />
              </div>
            </div>
          </div>
        </div>

        {/* Portrait — score, overs, and ball history */}
        <div className="tv-portrait-only">

          <div className="tv-portrait-main">
            <div className="tv-portrait-row tv-portrait-row--innings">
              <div className="tv-portrait-label">INNINGS <span className="tv-portrait-innings-number">{liveData.inningsNumber}</span></div>
            </div>

            <div className="tv-portrait-row tv-portrait-row--over-run">
              <div className="tv-portrait-cell">
                <div className="tv-portrait-label">OVER</div>
                <div className="tv-portrait-over">{liveData.overNumber}.{liveData.ballNumberInOver}</div>
              </div>
              <div className="tv-portrait-divider" />
              <div className="tv-portrait-cell">
                <div className="tv-portrait-label">RUN THIS OVER</div>
                <div className="tv-portrait-run-this-over">{liveData.runThisOver}</div>
              </div>
            </div>

            <div className="tv-portrait-row tv-portrait-row--runs">
              <div className="tv-portrait-score-block">
                <MainScore liveData={liveData} isChasing={isChasing} className="tv-portrait-score" />
                {isChasing && <ChaseInfo liveData={liveData} portrait />}
              </div>
            </div>

            <div className="tv-portrait-row tv-portrait-row--balls">
              <div className="tv-portrait-label">THIS OVER</div>
              <div className="tv-portrait-balls">
                <OverBallHistory deliveries={overDeliveries} />
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

// Confetti — 40 pieces, purely CSS-animated. Properties are seeded
// deterministically from the index so the pattern is consistent across
// re-renders without needing a random seed in state (which would cause
// unnecessary re-renders). Each piece varies in colour, horizontal
// start position, size, fall duration, and rotation.
const CONFETTI_COLOURS = [
  '#f5c842', // yellow
  '#3ddbb8', // mint
  '#ff7f50', // orange
  '#e8533a', // coral
  '#ffffff',  // white
  '#a78bfa', // purple
];

function Confetti() {
  const pieces = Array.from({ length: 40 }, (_, i) => {
    const colour = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    const left = ((i * 37 + 11) % 100); // pseudo-random spread 0-99%
    const delay = ((i * 17) % 30) / 10; // 0–3s delay
    const duration = 2.5 + ((i * 13) % 25) / 10; // 2.5–5s fall
    const size = 8 + (i % 4) * 4; // 8, 12, 16, 20px
    const rotation = (i * 47) % 360;
    const isRect = i % 3 !== 0; // mix circles and rectangles

    return (
      <div
        key={i}
        className="confetti-piece"
        style={{
          left: `${left}%`,
          width: isRect ? size : size * 0.7,
          height: isRect ? size * 0.5 : size * 0.7,
          borderRadius: isRect ? '2px' : '50%',
          background: colour,
          animationDelay: `${delay}s`,
          animationDuration: `${duration}s`,
          transform: `rotate(${rotation}deg)`,
        }}
      />
    );
  });

  return <div className="confetti-container">{pieces}</div>;
}
