---
sprint: S35
status: in-progress # planned | in-progress | done
branch: sprint/S35
milestone: 11.4 — user feedback 2026-10-26
---

# Sprint S35 — Launch where I play, safe config writes, and calmer server and demo browsing

## Goal

Mod and map are chosen only where the game is started, and a map start works in release builds. Assigning
a config never destroys a user's file: the original state is backed up and restorable, name clashes ask
first. The server and demo browsers keep their detail pane, the server list is keyboard- and
double-click-joinable with trustworthy pings and shows where each server is, filterable by
region and country, and demo details show teams side by side plus OpenTDM
accuracy stats.

## Stories (in build order)

- [x] 251 — Launch with applies only when I start the game
- [x] 252 — I pick a map in the footer and Play starts in it
- [x] 253 — An unassigned config profile tells me it is not used
- [x] 254 — The first assignment backs up the original configs and I can restore them
- [x] 255 — Assigning a profile never overwrites a foreign config silently
- [x] 256 — Server details are always shown
- [x] 257 — I join a server with double-click or Enter and move through the list with arrow keys
- [x] 258 — Server pings match what I get in game
- [ ] 259 — Batch actions show from one selected demo
- [ ] 260 — Demo details are always shown
- [ ] 261 — The demo players are split by team
- [ ] 262 — Demo details show the POV player's accuracy stats
- [ ] 263 — I see where a server is and filter by region or country

## Notes

- Source: user and key-user feedback 2026-10-26. Open questions were answered live at the cut and are
  recorded as `(User)` lines in each story's `## Decisions (Sprint)`; the clarification round should find
  nothing open.
- **Order.** 251 before 252 (the footer rule the map select follows); 254 before 255 (the backup folder
  255 writes into); 256 before 257 (selection that never clears is what arrow keys move); 259 and 260
  touch the same `ReplaysView` layout, then 261 and 262 the same detail panel; 263 after 256–258 (same
  server list and detail pane) and builds on 248's `MultiSelect`.
- 252 removes the dev-only "Play with…" dialog (story 249) in favour of the footer select — the user can
  veto this before `/sprint`.
- 262's reference demo lives on the user's machine (`C:\Games\Q2Pro\opentdm\demos\…`); the test fixture
  must be a synthetic `.dm2` carrying the same `svc_print` block unless the user allows committing the
  real demo.
- 263 ships a third-party GeoIP database (DB-IP Lite, CC-BY 4.0) — the user can veto the database or
  the column text ("EU · Germany") before `/sprint`.
- Deliberately out: demo sharing (the user runs a separate spike), `.mvd2` stats, the team result from
  "X wins, a to b".

## Regression gate
