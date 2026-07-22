// matchStorage.js
//
// Tiny localStorage wrapper for remembering which match is "active" so
// a page refresh can resume it. Deliberately stores ONLY the matchId —
// not a snapshot of runs/overs/etc — since the database is the actual
// source of truth for everything else (see RehydrateGate.jsx).

const STORAGE_KEY = 'noBowlers.activeMatchId';

export function saveActiveMatchId(matchId) {
  try {
    localStorage.setItem(STORAGE_KEY, matchId);
  } catch {
    // localStorage can fail (private browsing, storage full, disabled) —
    // refresh-recovery just won't work in that case, which is a
    // degradation, not a crash. Scoring itself is unaffected either way.
  }
}

export function clearActiveMatchId() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see above
  }
}

export function getActiveMatchId() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
