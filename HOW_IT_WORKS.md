# How The App Works — Technical Reference

---

## Architecture Overview

```
Browser (React/Vite)
        │
        │ HTTPS / REST
        ▼
Express API (Node.js)
        │
        │ SQL
        ▼
PostgreSQL (Render)
```

No websockets. The live view polls the API every 4 seconds. All other updates are request-response.

---

## Data Model

```
match
  └── match_player (roster for both teams)
  └── scorer_session (who is co-scoring)
  └── innings (1 or 2 per match)
        └── pair_innings (one per batting pair rotation)
              └── pair_innings_state (current striker/non-striker)
              └── bowling_spell (one per bowler-over combination)
                    └── delivery (one row per ball — never deleted)
```

### Key Design Decision: Immutable Delivery Ledger

Deliveries are **never deleted**. Undo sets `is_undone = true`. This means:
- Complete audit trail of every ball ever scored
- Safe concurrent access (no race conditions on delete)
- Easy to query "what happened" vs "what is the current state"

Every query that computes live state uses `WHERE is_undone = false`.

**Known gap:** undoing the first ball of a bowler's new-over spell and then picking a *different* bowler can leave that over's deliveries split across two `bowling_spell_id`s. See "Known Issues" in `HANDOVER.md` for the full mechanism and a query to detect it.

---

## Scoring Engine (`server/src/utils/scoringEngine.js`)

Pure functions — no database access. Takes delivery input, returns computed output.

```js
computeDelivery({
  deliveryType,      // 'normal' | 'wide' | 'no_ball' | 'no_wide_count'
  zoneHit,           // null | 1 | 2 | 4 | 6
  battersCrossed,    // boolean — did batters physically cross?
  manualRunAdjustment, // stepper value
  isWicket,
  wicketType,
})
// Returns: { totalRuns, batterRuns, extraRuns, extraMandatoryRun, isLegalDelivery }
```

`shouldRotateStrike({ battersCrossed })` — returns boolean. Strike only rotates if batters physically crossed.

---

## Frontend State Machine (LiveMatchContainer.jsx)

This is the most complex file. It owns all live match state:

```
matchContext (from setup/rehydrate)
    │
    ├── inningsId         — current innings DB id
    ├── pairInningsId     — current batting pair DB id
    ├── bowlingSpellId    — current bowler's spell DB id
    ├── strikerId         — who is on strike
    ├── nonStrikerId      — who is at non-striker end
    ├── battingTeam       — 'A' or 'B'
    ├── inningsNumber     — 1 or 2 (explicit state, NOT derived)
    ├── overNumber        — 0-indexed over count
    ├── ballNumberInOver  — 0-5
    ├── runs              — current innings total
    ├── wideCountEnabled  — persisted to DB
    └── lastDeliveryId    — enables UNDO button
```

**Important:** `inningsNumber` is stored as explicit state (not derived from `battingTeam === matchContext.battingTeam`). This is intentional — the derived approach broke after refresh because `matchContext.battingTeam` reflects the rehydrated team (could be innings 2's team), making the comparison always return 1.

---

## Refresh / Rehydration Flow

On every page load, `RehydrateGate` checks localStorage for a saved `matchId`.

```
Page loads
    │
    ├── No matchId in localStorage → show homepage
    │
    └── matchId found → GET /api/matches/:id/rehydrate
            │
            ├── 404 (match gone) → clear localStorage → homepage
            │
            ├── { needsSetup: true } → match exists, no innings → homepage
            │
            ├── { isComplete: true } → match done → homepage
            │
            └── Full match state → onResume() → LiveMatchContainer
```

The rehydrate endpoint returns everything needed to restore the scoring screen: current batters, bowler, over/ball count, runs, last delivery ID (for undo).

---

## Wide Count NO Mode

When the scorer sets "Count wide balls? NO" before the first ball:

1. The toggle is saved to `match.wide_count_enabled = false` via `PATCH /matches/:id/wide-count`
2. When WIDE is tapped, `deliveryType = 'wide'` is sent with `wideCountEnabled: false`
3. Backend converts to `effectiveDeliveryType = 'no_wide_count'`
4. `scoringEngine`: 2 mandatory extra runs, stepper adds more extras (NOT batter runs), `isLegalDelivery = true`
5. Frontend: `battersCrossed = stepperValue % 2 === 1` (physical running still rotates strike)
6. Result: counts as legal ball, 2+ extras, batter rotation if odd stepper, NO batter credit

---

## 3-Dot Wicket

Tracked in `ScoringScreen.jsx` via `useMemo`:

```js
const consecutiveDots = useMemo(() => {
  let count = 0;
  for (let i = overDeliveries.length - 1; i >= 0; i--) {
    const d = overDeliveries[i];
    if (!d.isLegalDelivery) continue;   // skip wides/no-balls
    if (d.totalRuns === 0 && !d.isWicket) count++;
    else break;
  }
  return count;
}, [overDeliveries]);
```

When `consecutiveDots === 2` and scorer submits a dot → `isWicket: true, wicketType: 'three_dots'` sent automatically.

Resets every new over (overDeliveries cleared on over completion).

---

## Pair Rotation

After every 4 overs (`oversJustCompleted % 4 === 0`):
1. `atPairBoundary = true` (persists until new pair chosen)
2. `pairRotationAnimating = true` (shows "4 overs complete" overlay)
3. Scorer taps "Select next batters" → pair picker opens with `isNewPair = true`
4. `handlePairChosen` creates new `pair_innings` record with incremented `pairNumber`
5. New bowler picker shown after pair chosen

If scorer closes picker without choosing, `atPairBoundary` stays `true`. Next time pencil icon is tapped, picker opens with `isNewPair = true` again.

**Pencil-icon correction (not a boundary rotation):** tapping the pencil icon mid-pair (not at a 4-over boundary) opens the same picker with `isNewPair = false`. `handlePairChosen` only advances `pairNumber` when `isNewPair` is true — a plain correction re-sends the *current* pair number, and the backend (`matchController.js` `startPair`) updates the existing `pair_innings` row in place if it has no deliveries yet, or rejects with a "undo first" error if it does. This used to always increment regardless of `isNewPair` (fixed — see git history).

---

## Co-Scoring

Co-scorers join via the 4-digit `join_code` (different from the match UUID). They get a `scorer_session` token. Multiple scorers can submit balls — last write wins. The live state is always computed from the delivery ledger, so there's no conflict on read.

---

## PDF Scorecard

Generated client-side via browser print (`window.print()`). A print-specific CSS stylesheet hides all app chrome and formats the scorecard for A4. No server-side PDF generation.

---

## Live View (`/live`)

Rendered by `LiveViewScreen.jsx`. Polls `GET /api/public/matches/live` every 4 seconds. No auth required. Designed for casting to a TV via a browser tab.

Portrait mode: stacked layout (Innings → Over+Run → Runs large → Pair Total → ball dots)
Landscape mode: side-by-side layout (Over/Runs left, dots bottom row)

---

## Database Views

Four read-only views do the heavy lifting for scorecard data:

| View | Purpose |
|---|---|
| `v_batting_stats` | Runs, balls, 4s, 6s, dismissals per batter |
| `v_bowling_stats` | Overs, runs, wickets per bowler |
| `v_pair_innings_totals` | Runs and balls per batting pair |
| `v_innings_totals` | Total runs per innings |

---

## API Routes Summary

```
POST   /api/auth/scorer-passcode/verify        Verify passcode
POST   /api/auth/scorer-session                Create co-scorer session

POST   /api/matches                            Create match
GET    /api/matches/:id/rehydrate              Restore session after refresh
POST   /api/matches/:id/players               Add players to team
PATCH  /api/matches/:id/players/:pid          Rename player
PATCH  /api/matches/:id/team-name             Rename team
PATCH  /api/matches/:id/wide-count            Toggle wide count setting
POST   /api/matches/:id/innings               Start an innings
POST   /api/matches/:id/innings/:iid/pairs    Start a batting pair
POST   /api/matches/:id/innings/:iid/bowling-spells  Start/continue bowling spell
POST   /api/innings/:id/deliveries            Record a delivery
POST   /api/deliveries/:id/undo               Undo last delivery

GET    /api/public/matches                     List all matches (scorecard page)
GET    /api/public/matches/live               Live match data (TV view)
GET    /api/public/matches/:id                Full scorecard data

DELETE /api/admin/matches/:id                 Soft-delete a match
PATCH  /api/admin/matches/:id/man-of-the-match  Set MOTM
```

