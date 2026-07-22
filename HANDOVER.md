# The No Bowlers — Handover Document

_Last updated: 2026-07-09_

## What This Is

A live indoor cricket scoring web app built specifically for **The No Bowlers** indoor cricket club in Sydney, Australia. It handles match setup, live ball-by-ball scoring, a TV live view, co-scoring, and permanent match history with scorecards.

Live at: **https://www.nobowlers.com.au**

---

## People

- **Owner / Product:** Asif Shahid
- **Original Developer:** Built with Claude (Anthropic) via chat + Claude Code
- **Repo:** `github.com/asifshahid80/indoor-cricket-app` (private)
- **Local path (Asif's machine):** `/Users/asifshahid/Desktop/NBCricScore/V2/repo`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, plain CSS (no Tailwind) |
| Backend | Node.js + Express |
| Database | PostgreSQL (hosted on Render, production) |
| Hosting | Render (Singapore region) |
| Domain | nobowlers.com.au (DNS via domain registrar) |

---

## Services on Render

| Service | Name | Type |
|---|---|---|
| Backend API | `indoor-cricket-api` | Web Service |
| Frontend | `cricket-app-web` | Static Site |
| Database | (attached to indoor-cricket-api) | PostgreSQL |

**Deploy process:**
1. `git add . && git commit -m "message" && git push`
2. Go to Render → Manual Deploy on the relevant service(s)
3. Deploy backend first when backend files changed, then frontend

**This handover does NOT include Render/production access.** The new developer works against their own local copy of the database (see below). Production deploys remain Asif's responsibility unless separately arranged.

---

## Repository Structure

```
repo/
├── web/                          # React frontend
│   ├── src/
│   │   ├── App.jsx               # Root — routing, RehydrateGate, mode state
│   │   ├── App.css               # Homepage styles
│   │   ├── main.jsx              # Entry point — also wires up the app-wide click sound listener
│   │   ├── styles/tokens.css     # Design system tokens (colours, fonts, spacing)
│   │   ├── api/client.js         # Fetch wrapper (BASE_URL from VITE_API_BASE_URL)
│   │   ├── hooks/
│   │   │   └── useDeliveryComputation.js  # totalOversForSquadSize, zone logic
│   │   ├── utils/
│   │   │   ├── matchStorage.js   # localStorage save/clear for active matchId
│   │   │   ├── sound.js          # Submit bell sound + app-wide click sound
│   │   │   └── haptics.js        # triggerSubmitHaptic
│   │   ├── screens/
│   │   │   ├── LiveMatchContainer.jsx  # ⭐ Main orchestrator — all match state
│   │   │   ├── ScoringScreen.jsx       # Scoring UI (keys, zones, stepper, pills)
│   │   │   ├── MatchSetupScreen.jsx    # 4-step setup (passcode → teams → batting)
│   │   │   ├── JoinMatchScreen.jsx     # Join via match code
│   │   │   ├── MatchesScreen.jsx       # Historical matches list (verified-icon legend)
│   │   │   ├── LiveViewScreen.jsx      # TV view at /live (landscape + portrait)
│   │   │   ├── WhatsNewScreen.jsx      # App features list
│   │   │   ├── EditTeamsScreen.jsx     # Mid-match team editing (saves on × close, no separate Save button)
│   │   │   └── MatchResultScreen.jsx   # End of match result
│   │   └── components/
│   │       ├── RehydrateGate.jsx       # Restore session on refresh
│   │       ├── MatchMenuModal.jsx      # Hamburger menu
│   │       ├── WicketModal.jsx         # Wicket type picker
│   │       ├── RosterPickerModal.jsx   # Batter/bowler/fielder picker
│   │       ├── ScorecardModal.jsx      # In-match and historical scorecard, incl. result summary banner
│   │       ├── InningsSummaryModal.jsx # End of innings 1 summary
│   │       ├── OverBallHistory.jsx     # Current over ball dots
│   │       ├── OverCompleteOverlay.jsx # Full-screen over-complete prompt
│   │       ├── UndoConfirmModal.jsx    # Undo confirmation
│   │       └── RulebookModal.jsx       # Club rules reference
│
├── server/                       # Express backend
│   ├── scripts/
│   │   └── export-data.js        # Handover data export (see Database Handover below)
│   └── src/
│       ├── index.js              # Entry point, port 3000
│       ├── db/pool.js            # PostgreSQL pool (DATABASE_URL env var)
│       ├── controllers/
│       │   ├── matchController.js     # Match CRUD, rehydrate, players, innings
│       │   └── deliveryController.js  # Record delivery, undo delivery
│       ├── utils/
│       │   └── scoringEngine.js       # All scoring rules (pure functions)
│       ├── middleware/auth.js         # Scorer session auth
│       └── routes/
│           ├── scoringRoutes.js       # POST /matches, /innings, /deliveries etc.
│           ├── publicRoutes.js        # GET /public/matches/:id (scorecard data)
│           ├── authRoutes.js          # Passcode verify, scorer sessions
│           └── adminRoutes.js         # Admin: delete match, man of match
│
├── db/
│   └── schema.sql                # Full PostgreSQL schema + views (structure only, no data)
│
└── handover/                     # NOT committed to git — see Database Handover below
    └── database_export_*.sql     # Data dump generated by server/scripts/export-data.js
```

---

## Environment Variables

### Backend (Render → indoor-cricket-api → Environment)
```
DATABASE_URL=postgresql://...    # Render PostgreSQL connection string
PORT=3000                        # Set automatically by Render
ADMIN_TOKEN=...                  # For admin API endpoints
```

### Frontend (Render → cricket-app-web → Environment)
```
VITE_API_BASE_URL=https://indoor-cricket-api.onrender.com/api
```

### Local development
Create `server/.env`:
```
DATABASE_URL=<your_local_postgres_url>
PORT=3000
```

Create `web/.env.local`:
```
VITE_API_BASE_URL=http://localhost:3000/api
```

---

## Running Locally

```bash
# Terminal 1 — Backend
cd server
npm install
npm run dev        # node --watch src/index.js, port 3000

# Terminal 2 — Frontend
cd web
npm install
npm run dev        # Vite dev server, http://localhost:3001 (fixed port, see web/vite.config.js)
```

The Vite dev server is pinned to port **3001** (not the Vite default 5173) via `web/vite.config.js`.

---

## Database Handover

A new developer should **not** be given production `DATABASE_URL` access. Instead:

1. Set up your own local (or your own hosted) PostgreSQL instance.
2. Run `db/schema.sql` against it to create all tables/views (empty).
3. Restore the data dump:
   ```bash
   psql "$DATABASE_URL" -f handover/database_export_<date>.sql
   ```
4. Manually insert one row each into `admin_account` and `scorer_passcode` — these were **deliberately excluded** from the data export since they hold real login credentials. Pick your own local email/password/passcode for these; see `db/schema.sql` for the column shapes.

**Regenerating the export** (e.g. before a future handover, or to refresh the new developer's local data): `node server/scripts/export-data.js` — connects using the `DATABASE_URL` currently in `server/.env`, writes a timestamped file to `handover/`. That directory is gitignored (real player names/scores shouldn't sit in git history indefinitely) — share the generated file directly (e.g. AirDrop, a private link), don't commit it.

`pg_dump`/`psql` binaries were not available in the environment this was generated in, so `export-data.js` is a hand-rolled equivalent (plain `INSERT` statements via the existing `pg` npm dependency) — it was spot-checked for correct SQL escaping and FK insertion order but **not** end-to-end tested against a real restore. Do a first restore into a throwaway database and sanity-check row counts / a scorecard render before relying on it.

---

## Key Files to Understand First

If you're picking this up fresh, read these in order:

1. `db/schema.sql` — understand the data model
2. `server/src/utils/scoringEngine.js` — all the rules in pure functions
3. `web/src/screens/LiveMatchContainer.jsx` — the heart of the app (state, flow)
4. `web/src/styles/tokens.css` — design tokens (colours, spacing, typography)

---

## Design System

All colours, fonts, and spacing are in `web/src/styles/tokens.css`.

| Token | Value | Usage |
|---|---|---|
| `--color-navy-900` | `#102564` | Main background, modals |
| `--color-text-primary` | `#ffffff` | All body text |
| `--color-text-secondary` | `#7a90b4` | Labels, muted text |
| `--color-yellow` | `#f5c842` | CTAs, scores, active states |
| `--color-mint` | `#3ecf8e` | Success, ball dots |
| `--color-coral` | `#ef7b5e` | Wickets, errors, alerts |
| `--color-border` | `#648BC3` | All borders/dividers — also used directly as `#648BC3` in many places rather than via the token; functionally identical, just not consistently referenced by name |
| `--font-display` | Sora | Score numbers, titles |
| `--font-body` | Inter | Everything else |

The palette was deliberately trimmed recently — two near-duplicate blues (`#284589`, unused; `#4A63B0`, used for the TV score/target text) were consolidated into `#648BC3` to reduce the number of near-identical blues.

---

## Known Issues (unresolved as of this handover)

### Bowler misattribution after undo + bowler swap mid-over

**Not yet fixed at the code level.** If a scorer picks bowler A for a new over, bowls one ball, undoes it, and picks a *different* bowler B for the replacement ball, the app's undo-restoration logic falls back to whoever bowled the *previous* over rather than clearing the bowler selection — so the rest of that over gets recorded under bowler B's spell even though bowler A's aborted first ball still shows in the log. Net effect: an over's deliveries can end up split across two different `bowling_spell_id`s, corrupting both bowlers' over/wicket counts on the scorecard.

This has been found and manually corrected in individual matches multiple times (matches 7091, 8081, 9567) but the underlying code path was never fixed, so it can recur any time a scorer does that specific undo-then-different-bowler sequence. See `server/src/controllers/deliveryController.js` (`undoDelivery`) and `web/src/screens/LiveMatchContainer.jsx` (`handleUndo`'s bowler-restoration logic).

**Suggested fix (not yet implemented):** when undoing the first ball of a new over, clear the current bowler entirely (force the bowler picker to reopen) instead of reverting to the previous over's bowler.

**To check for other undiscovered instances**, run this against any database (find overs whose deliveries are split across more than one bowling spell):
```sql
SELECT i.match_id, d.innings_id, d.over_number, COUNT(DISTINCT d.bowling_spell_id) AS distinct_spells
FROM delivery d
JOIN innings i ON i.id = d.innings_id
WHERE d.is_undone = false
GROUP BY i.match_id, d.innings_id, d.over_number
HAVING COUNT(DISTINCT d.bowling_spell_id) > 1;
```

---

## Recently Fixed (this handover's session)

- Undo could be tapped repeatedly to walk backwards through an entire innings, not just the single most recent ball (frontend gating gap — the backend already rejected non-most-recent undos, but nothing stopped sequential one-at-a-time chaining).
- The pencil-icon "change who's batting" edit always incremented the pair number, even for a same-slot correction — now only the real 4-over rotation advances the pair number.
- `v_bowling_stats.runs_conceded` included the -5-per-wicket dismissal penalty, making a bowler's figures go negative the more wickets they took. Fixed to reflect only actual runs off that bowler's deliveries.
- The "End of Innings" undo path (a second, separate undo handler) cleared `lastDeliveryId` to `null` instead of restoring it, which broke `canSwapBatting`/`hasDeliveries` state for the rest of that innings.
- Various Live View (TV) portrait/landscape layout, sound effect, and Scorecard UI polish — see git log for the full list.

---

## Known Limitations (v1.0)

- Refresh during team setup (before first ball) returns to homepage — scorer must re-enter teams
- No automated tests beyond `scoringEngine.test.js` and `crossedDerivation.test.js` (neither is wired into a CI or an npm `test` script for the frontend — see Testing below)
- Scorecard is view/print only — no server-side PDF generation
- Session timeout not implemented — long idle periods may require re-joining
- See "Known Issues" above for the bowler-misattribution gap

---

## Testing

- `server/src/utils/scoringEngine.test.js` — runs via `npm test` in `server/` (`node --test`)
- `web/src/screens/crossedDerivation.test.js` — exists but **not currently wired to any runner**; `web/package.json` has no test script. Whoever picks this up next should either add a test runner (Vitest is the natural fit for a Vite project) or fold this logic into the backend's `node --test` suite.
- No automated coverage of the undo/bowler-attribution logic that has caused the most real-world data bugs — worth prioritizing given the Known Issues above.

---

## Planned Next (Post v1.0)

- **Fix the bowler-misattribution root cause** (see Known Issues)
- **6-a-side tournament mode** — 6 players, 9 overs, 3 overs/pair (configurable per match)
- **Full AA accessibility audit**
- **Supabase migration** (discussed, deferred)

---

## Git Tags

| Tag | Description |
|---|---|
| `v1.0` | First stable release — match-ready |
| `v1.1-pre-wise` | Stable before Wise design system experiment |
| `v1.1-pre-uber` | Stable before Uber design system experiment |
