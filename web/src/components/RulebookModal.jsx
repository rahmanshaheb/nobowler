// RulebookModal.jsx

const sections = [
  {
    title: 'General',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
    items: [
      'Each match has two teams of 8–12 players each (up to 24 total).',
      'A team\'s batting innings is divided into pairs of batters. Each pair bats for 4 overs before the next pair comes in (default rule — may vary by tournament).',
      'When a new pair comes in, there is no restriction on who can be selected — including batters who have already batted.',
      '8-player teams bat 16 overs (4 pairs × 4 overs); 10-player teams bat 20 overs (5 pairs × 4 overs); 12-player teams bat 24 overs (6 pairs × 4 overs). Odd-sized squads (9 or 11) use the same over count as the next even size.',
    ],
  },
  {
    title: 'Runs & Zones',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
    ),
    items: [
      'The scoring area is divided into four zones: Zone 1, Zone 2, Zone 4, and Zone 6. Each zone represents the run value of that area.',
      'A zone only scores runs if the batters complete a physical run. A zone hit with no run scores zero.',
      'Hitting Zone 6 and completing a run is worth 7 (6 + 1). Each additional run completed adds 1 more.',
      'Batters can also score without hitting a zone — pure running scores 1 run per completed run.',
      'An odd number of runs between the wickets changes the striker; an even number keeps the same batter on strike.',
    ],
  },
  {
    title: 'Wide ball',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>
      </svg>
    ),
    items: [
      'A wide is always worth at least 1 run, awarded as an extra — never credited to the batter.',
      'No zone can apply to a wide ball.',
      'If the batters run on a wide, each completed run adds 1 more extra.',
      'A wide does not count as one of the over\'s 6 legal balls.',
      'If NO wide rule is on: each wide counts as a legal delivery with 2 runs. Any runs taken by the batter are added as extras.',
    ],
  },
  {
    title: 'No ball',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>
      </svg>
    ),
    items: [
      'A no ball is always worth at least 1 run, awarded as an extra.',
      'A no ball is a fair delivery — the batter can hit it. Bat runs are credited to the batter on top of the mandatory 1 extra.',
      'A no ball does not count as one of the over\'s 6 legal balls.',
    ],
  },
  {
    title: 'Wicket',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
      </svg>
    ),
    items: [
      'Six ways to be dismissed: Bowled, Caught & bowled, Caught, Run out, Stumped, 3 Dots.',
      '3 Dots — 3 consecutive dot balls in the same over = automatic dismissal. Resets each new over.',
      'Every dismissal except run out can only happen to the batter facing the ball.',
      'Every dismissal carries a 5-run penalty, deducted from the team total.',
      'Zone 6 is exempt from caught, caught & bowled, or run out.',
      'On a wide or no ball, only run out or stumped are possible.',
    ],
  },
  {
    title: 'Bowling',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>
      </svg>
    ),
    items: [
      'A bowler may bowl a maximum of 3 overs across the whole innings.',
      'Every bowler on the bowling team must bowl at least 1 over.',
      'An over is 6 legal balls — wides and no balls do not count toward this.',
    ],
  },
];

export default function RulebookModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--rulebook" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">Rulebook</h2>
        <div className="rulebook-list">
          {sections.map((s, i) => (
            <div className="rulebook-card" key={i}>
              <div className="rulebook-card__body">
                <div className="rulebook-card__icon">{s.icon}</div>
                <div>
                  <h3 className="rulebook-card__title">{s.title}</h3>
                  <ul className="rulebook-card__items">
                    {s.items.map((item, j) => (
                      <li key={j} className="rulebook-card__item">{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
