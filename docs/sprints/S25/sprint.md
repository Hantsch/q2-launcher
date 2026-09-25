---
sprint: S25
status: done # planned | in-progress | done
branch: sprint/S25
milestone: 9.4–9.7 — Server list UI, detail view, join/spectate/address book, experimental gate & watchlist
---

# Sprint S25 — The game browser, from list to watchlist

## Goal

The Servers view is a complete v1 game browser. It shows a live, sortable, filterable server list
that states its own loading/empty/error states, and a detail view with players, the full rule
table with `dmflags` decoded, and ping history. From list or detail a user joins or spectates with
a validated `+connect`, with no password ever in the process arguments, and writes a server into a
profile's `adr0`–`adr8`. A launcher-wide experimental-features gate (signed, device-bound unlock
code, redeemed in Settings) ships locked by default, and the watchlist behind it is fully built but
invisible until a code names `watchlist`.

## Stories (in build order)

- [x] 118 — a server row says what's going on
- [x] 119 — busy servers rise to the top
- [x] 120 — i filter and search the list
- [x] 121 — the list says what it's doing
- [x] 122 — a server's detail opens
- [x] 123 — the rules a server plays by, in full
- [x] 124 — how this server has answered
- [x] 125 — i join a server from the browser
- [x] 126 — i spectate without picking a side
- [x] 127 — a server goes into my address book
- [x] 128 — An unlock code proves what it unlocks
- [x] 130 — A locked feature does not exist
- [x] 129 — I ask for a code and see what it unlocked
- [x] 131 — The watchlist finds a name for free
- [x] 132 — The watchlist tells me where someone is

## Notes

Merges the previously planned S25–S28 (milestones 9.4–9.7) into one sprint, the last of the
game-browser milestone. It depends on S22–S24 (stories 106–117), which are done. Concept:
[docs/concepts/game-browser.md](../../concepts/game-browser.md).

**Build order is a dependency chain.**
- 118 → 119 → 120 → 121: the list. 121's states wrap what the other three produce.
- 122 → 123 → 124: the detail view, opened from 118's row. 123 and 124 render into 122's container.
- 125 → 126 → 127: actions. 126 is 125's join flow with a different composition, and reuses 125's
  mechanism for keeping passwords out of argv. 127 is independent.
- 128 → **130 → 129** → 131 → 132: 130 now comes before 129 (the old S28 had it the other way
  round). 129's AC4 (the experimental marking, supplied by the gate) and AC5 (the feature is gone
  after expiry) both need 130's enforcement. 130 proves itself with a test-only feature name (its
  AC4), so it does not need the watchlist to exist.

**Open questions were settled in planning (2026-09-25).** None is left for phase 1a, and every
answer is recorded as a `(User)` decision in its story: 119 (gamemode is a tie-break only), 124
(local mod/map availability deferred to mods/assets, former AC3/AC4 cut), 125 (join password never
in argv, new AC6), 126 (spectator composition taken from the 3.20 source, only engine confirmation
left for refine), 128 (code format, 24 h window, issuing script with an external key, re-issue on
id churn; new AC8/AC9), 131 (length cap + worker time budget for regex, entries kept on expiry,
re-check semantics; new AC9/AC10) and 132 (dedicated re-check action; new AC7–AC9).

**Out of this sprint:** story 102 (self-built Linux Q2PRO) stays a standing, separate item. The
concept's "Deliberately not in v1" list stays out: 2D observer, notifications, dashboard tile,
server statistics, mod/map download. Local mod/map availability in the detail view (GB-D5) is
now deferred as well.

**Size.** 15 stories, run one after another: plan for several hours of build. The regression
gate's `e2e-all` starts from a known red baseline. 14 of 56 flows fail deterministically and
predate S23 (see the roadmap's follow-ups). The gate's attribution step should classify them as
`pre-existing`, not bisect them.

## Regression gate

Commands (all on `sprint/S25` HEAD before the fixes below):
- `npm run build` — green (0.06 min)
- `npm test` (full) — **red**, 1 failing test, first run
- `npm run ui:verify` — green (1.75 min, 94/94 shots, 0 axe violations)
- `npm run ui:flows` (`e2e-all`, 71 flows) — **red**, 3 failing, first run (1428s / ~24 min)

**`npm test` failure:** `src/main/modules/downloads/layering.test.ts` — the main-process layering
allowlist test flagged `spawn(` in the new `watchlist-regex-host.ts` (story 131). Attribution: real
regression, not flaky, not pre-existing (file introduced this sprint). Root cause: a local
`function spawn(): Worker` collided with the guard's `spawn(` substring ban, meant for
`child_process.spawn`, not `worker_threads.Worker`. **Fixed** by renaming to `startWorker`, commit
`7e999cf`. Full `npm test` re-verified green (4882 passed, 0 failed).

**`e2e-all` failures:**
- `home-dashboard-arrange` — **pre-existing**. Fails identically on a clean HEAD re-run (a grid
  rounding/layout drift unrelated to any S25 code path); no S25 commit touched the dashboard.
- `news-cover-template` — **pre-existing / environmental**. Fails identically: the harness's own
  display-size guard trips on this machine's screen ("asked for 1280px, got 1295px"); unrelated to
  S25.
- `servers-detail` — real regression, attributed to story 126, commit `a0be1a2`. 126 added a
  visible "Spectate" button/label to the detail header, which tripped 122's AC4 "no spectator
  claim" check — a whole-detail-pane text scan for "spectat" that was broader than its actual
  intent (the players table must not imply spectator status). **Fixed** by narrowing the check to
  the players panel's own DOM subtree, a scope correction not a weakening, commit `c6e1e96`.

**Confirmation run** (after both fixes, `e2e-all` once more): 69/71 passed, 1426s (~24 min).
`servers-detail` now green; only the two pre-existing/environmental failures above remain.

**Note for next sprint's planning:** this sprint's own note above expected "14 of 56 flows fail
deterministically, predate S23," but the actual gate found only 2 of 71 failing, both pre-existing.
Either that baseline improved since it was last measured, or the note was stale — worth a quick
roadmap check, not a blocker here.
