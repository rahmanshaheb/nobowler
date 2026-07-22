// OverBallHistory.jsx
import { useEffect, useRef } from 'react';

export default function OverBallHistory({ deliveries }) {
  const scrollRef = useRef(null);
  const lastRealDotRef = useRef(null);

  const legalCount = deliveries.filter((d) => d.isLegalDelivery).length;
  const placeholdersNeeded = Math.max(0, 6 - legalCount);

  useEffect(() => {
    lastRealDotRef.current?.scrollIntoView({ inline: 'end', block: 'nearest' });
  }, [deliveries]);

  return (
    <div className="over-ball-history" ref={scrollRef}>
      {deliveries.map((d, i) => (
        <BallDot
          key={d.id}
          delivery={d}
          dotRef={i === deliveries.length - 1 ? lastRealDotRef : null}
        />
      ))}
      {Array.from({ length: placeholdersNeeded }).map((_, i) => (
        <span key={`placeholder-${i}`} className="ball-dot ball-dot--placeholder" />
      ))}
    </div>
  );
}

function BallDot({ delivery, dotRef }) {
  const { deliveryType, totalRuns, penaltyRuns = 0, isWicket } = delivery;
  const isWide   = deliveryType === 'wide';
  const isNoBall = deliveryType === 'no_ball';
  const isExtra  = isWide || isNoBall;

  const netScore = Number(totalRuns) + Number(penaltyRuns);

  let variant;
  if (isWicket && isExtra) variant = 'wicket-extra';
  else if (isWicket)       variant = 'wicket';
  else if (isExtra)        variant = 'extra';
  else                     variant = 'normal';

  // Normal ball — plain circle, no tab
  if (!isExtra && !isWicket) {
    return (
      <span className={`ball-dot ball-dot--${variant}`} ref={dotRef}>
        <span className="ball-dot__value">{netScore}</span>
      </span>
    );
  }

  // All extras and wickets get a tab
  const labelText = isWicket && isExtra
    ? (isWide ? 'WD WKT' : 'NB WKT')
    : isWicket ? 'WKT'
    : isWide   ? 'WD'
    : 'NB';

  return (
    <span className={`ball-dot-tabbed ball-dot-tabbed--${variant}`} ref={dotRef}>
      <span className="ball-dot-tabbed__tab">{labelText}</span>
      <span className="ball-dot-tabbed__circle">
        <span className="ball-dot__value">{netScore}</span>
      </span>
    </span>
  );
}
