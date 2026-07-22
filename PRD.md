# Product Requirements Document — The No Bowlers Scoring App

**Version:** 1.0  
**Date:** June 2026  
**Owner:** Asif Shahid  

---

## Overview

A mobile-first web app for scoring indoor cricket matches played by The No Bowlers club. It replaces manual scorekeeping (paper, spreadsheets) with a live digital system accessible from any phone or tablet. The app is tailored to the club's specific rules and does not attempt to be a generic cricket scoring tool.

---

## Goals

- Any member can score a match from their phone — no laptop, no setup
- Live scoreboard visible on a TV via browser
- Multiple scorers can join the same match (co-scoring, handover)
- Full scorecard preserved permanently after the match
- Secure: passcode to create, match code to join

---

## Users

**Primary:** The designated scorer for a match (one person per match at a time, though co-scoring is supported)

**Secondary:** Players watching the live view on a TV or their own phone

**Admin:** Asif (can delete matches, set man of the match)

---

## Match Format (Default)

| Setting | Value |
|---|---|
| Teams | 2 teams, 8–10 players each (16–20 total) |
| Innings | 2 innings (one per team) |
| Overs | 16 (8-player team) or 20 (10-player team) |
| Overs per pair | 4 |
| Max overs per bowler | 3 |
| Min overs per bowler | 1 (all bowlers must bowl) |

---

## Scoring Rules

### Runs
- Four scoring zones: Zone 1, Zone 2, Zone 4, Zone 6
- A zone only scores if batters complete a physical run
- Zone 6 + 1 run = 7 total. Each additional run adds 1
- Pure running (no zone) scores 1 per completed run
- Odd runs = striker changes. Even runs = striker stays

### Wide Ball
- Always worth at least 1 run (extra, never batter credit)
- Does not count as a legal delivery
- No zone can apply
- **Wide Count NO mode:** Wide counts as legal delivery, 2 mandatory extras. Batter rotation still applies on odd stepper runs

### No Ball
- Always worth at least 1 run (extra)
- IS a fair delivery — batter can hit it and score bat runs
- Does not count as a legal delivery

### Wickets
Six dismissal types:
1. **Bowled** — not valid on wide or no ball
2. **Caught & Bowled** — not valid on wide or no ball
3. **Caught** — not valid on wide or no ball. Not valid in Zone 6
4. **Run Out** — valid on any delivery type
5. **Stumped** — valid on wide and no ball
6. **3 Dots** — 3 consecutive dot balls in same over = automatic dismissal

Every dismissal = **−5 runs** from team total. Resets each new over (for 3-dots tracking).

### Bowling
- Max 3 overs per bowler per innings
- All bowlers must bowl at least 1 over
- Bowler must be selected before each over

---

## App Flows

### New Match
1. Enter passcode (4-digit, set by admin)
2. Enter Team A name + 8–10 player names
3. Enter Team B name + 8–10 player names
4. Choose who bats first
5. Select opening pair (2 batters)
6. Select first bowler
7. Score balls

### Scoring a Ball
1. Tap a number (0–6) on the numpad — sets zone/run count
2. Optionally: tap WIDE or NB pill to change delivery type
3. Optionally: tap WKT to open wicket modal
4. Optionally: use stepper for additional batter runs (NB) or physical runs (WIDE)
5. Tap Submit to record

### Pair Rotation (every 4 overs)
- App shows "4 overs complete" overlay
- Scorer selects new batting pair from roster
- Scorer then selects new bowler for the over

### End of Innings
- App auto-triggers at final over, or scorer can manually end via menu
- Innings 1 summary shown (total + pair totals)
- Continue to Innings 2 setup

### Co-Scoring / Handover
- From hamburger menu, share the 4-digit match code
- Second scorer opens app → Join a match → enters code
- Both scorers see same live state, last to submit wins

---

## Non-Functional Requirements

- **Mobile-first:** Designed for portrait phone use. Tablet and desktop supported
- **Offline resilience:** Refresh during active scoring must restore state (rehydrate endpoint)
- **No auth friction:** Passcode only for creation. Match code only for joining
- **Performance:** Ball submission must complete within 2 seconds on 4G
- **Live view:** TV view updates every ~4 seconds via polling

---

## Out of Scope (v1.0)

- Player statistics across matches
- Tournament brackets
- Push notifications
- Offline mode (service worker)
- 6-a-side format (planned for v1.1)

---

## Security

- Match creation gated by a 4-digit scorer passcode (stored hashed)
- Co-scoring requires the match's unique join code
- No user accounts or passwords
- All data served over HTTPS
- Admin endpoints protected by ADMIN_TOKEN header
- Matches soft-deleted (not removed) — data preserved for disputes

---

## Design Principles

1. **Speed over beauty** — the scorer is under pressure in a loud hall
2. **No surprises** — every action is reversible (1-ball undo) or confirmable
3. **Phone-sized tap targets** — minimum 44px touch targets on all interactive elements
4. **Club-specific** — no generic cricket features that don't apply to this club

