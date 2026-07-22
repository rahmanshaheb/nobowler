import { useEffect } from 'react';
// WhatsNewScreen.jsx
import './WhatsNewScreen.css';

const features = [
  {
    title: 'Access from anywhere',
    description: 'No laptop, no HDMI cable, no TV box needed. Open noblowers.com.au on any phone or tablet and start scoring immediately.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
  {
    title: 'Live view on TV',
    description: 'Cast the live scoreboard to any screen. Just open the live view URL on a browser connected to the TV — no app, no casting device, no setup.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"/>
        <path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/>
      </svg>
    ),
  },
  {
    title: 'Co-scoring with match code',
    description: 'Share the match code with anyone to let them join as a co-scorer. Easy handover mid-match — no login, no setup, just enter the code.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    title: 'Built for The No Bowlers',
    description: 'Every rule in this app is tailored specifically to The No Bowlers indoor cricket club — pairs, overs per pair, penalty runs, zone scoring and more.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  {
    title: 'Secured with passcode & match ID',
    description: 'Creating a new match requires a passcode. Joining as a co-scorer requires the match ID. Your match data stays private.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
  },
  {
    title: 'Live scoreboard',
    description: 'Runs, overs, pair total, run this over, and ball-by-ball history all update in real time — visible to everyone watching the live view.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
      </svg>
    ),
  },
  {
    title: 'Permanent match history',
    description: 'Every match is saved. Go back and view the full scorecard of any previous match at any time from the Scorecard page.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
      </svg>
    ),
  },
  {
    title: 'Ball-by-ball history',
    description: 'Every delivery in the current over is shown as a dot — runs, wides, no balls, wickets. A complete picture of the over at a glance.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
      </svg>
    ),
  },
  {
    title: 'Auto batter change',
    description: 'The app automatically rotates the striker after each delivery based on runs scored — no manual tracking needed.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    ),
  },
  {
    title: 'Auto zone selection',
    description: 'The scoring zone is automatically suggested based on the runs scored. Scorers can override it when needed.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
    ),
  },
  {
    title: '1-ball undo',
    description: 'Made a mistake? Tap Undo to reverse the last ball scored. Works instantly with no data loss.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
      </svg>
    ),
  },
  {
    title: 'Edit team during the match',
    description: 'Need to correct a name or swap a player? Open the menu and edit either team at any point during the match.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 21a8 8 0 0 1 10.821-7.487"/>
        <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>
        <circle cx="10" cy="8" r="5"/>
      </svg>
    ),
  },
  {
    title: 'Wide ball count setup',
    description: 'Running late? Turn off wide ball counting before the first ball. Wides score 2 runs as a normal legal delivery — no extra balls bowled.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="15" cy="12" r="3"/><rect width="20" height="14" x="2" y="5" rx="7"/>
      </svg>
    ),
  },
];

export default function WhatsNewScreen({
onBack }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div className="whats-new-screen">
      <div className="whats-new-header">
        <button className="whats-new-back" onClick={onBack}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
        <h1 className="whats-new-title">What's new</h1>
      </div>
      <div className="whats-new-list">
        {features.map((f, i) => (
          <div className="whats-new-card" key={i}>
            <div className="whats-new-card__body">
              <div className="whats-new-card__icon">{f.icon}</div>
              <div>
                <h3 className="whats-new-card__title">{f.title}</h3>
                <p className="whats-new-card__desc">{f.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
