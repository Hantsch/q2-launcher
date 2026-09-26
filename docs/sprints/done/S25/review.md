# Sprint S25 review — The game browser, from list to watchlist

## Overview

**Goal:** the Servers view becomes a complete v1 game browser — a live, sortable, filterable
server list with its own loading/empty/error states, a detail view with players, the full rule
table (`dmflags` decoded) and ping history, join/spectate with a validated `+connect` that never
puts a password in argv, a write into a profile's `adr0`–`adr8`, and a launcher-wide
experimental-features gate (signed, device-bound unlock code) behind which the watchlist ships
fully built but invisible until unlocked.

All 15 stories are `done`. This closes phase 9 (game browser) of the roadmap: milestones
9.4–9.7, merged from the previously separate S25–S28 plan into this one sprint.

| Story | Status | Commit |
| --- | --- | --- |
| 118 — a server row says what's going on | done | `2787cd4` |
| 119 — busy servers rise to the top | done | `0bb870a` |
| 120 — i filter and search the list | done | `501d2c6` |
| 121 — the list says what it's doing | done | `50ae417` |
| 122 — a server's detail opens | done | `f3eb9c8` |
| 123 — the rules a server plays by, in full | done | `ba8113a` |
| 124 — how this server has answered | done | `72d2586` |
| 125 — i join a server from the browser | done | `b9b8aab` |
| 126 — i spectate without picking a side | done | `a0be1a2` (+ gate fix `c6e1e96`) |
| 127 — a server goes into my address book | done | `443ea19` |
| 128 — an unlock code proves what it unlocks | done | `244cb3a` |
| 130 — a locked feature does not exist | done | `a9b39d3` |
| 129 — i ask for a code and see what it unlocked | done | `17f13c5` |
| 131 — the watchlist finds a name for free | done | `5a2351e` (+ gate fix `7e999cf`) |
| 132 — the watchlist tells me where someone is | done | `2623164` |

## Implemented stories

- **118 — a server row says what's going on.** Shared pure derivations (`row-markers.ts`:
  gamemode, known player count, "waiting for an opponent") feed a new `ServerRow` with visible
  icon+text markers for password, gamemode, favourite, stale and the duel-waiting signal. Fixed
  a pre-existing bug on the way: `needpass` is now read as a bitfield (`3` = password + spectator
  password), and a silent favourite/manual server gets a placeholder row instead of vanishing.
- **119 — busy servers rise to the top.** A pure sort engine (favourites first, then occupancy,
  then gamemode, then name/address as a stable tie-break), a clickable sort bar with a visible
  "current sort" line, and persistence in `state.json` via two new IPC channels.
- **120 — i filter and search the list.** A pure filter/search engine composed after 119's sort
  (never reorders), free-text search across name/address/roster, four boolean toggles and three
  dropdowns, a "Showing X of Y" count, and a distinct no-match state.
- **121 — the list says what it's doing.** Loading/empty/idle/populated states wrapping 118–120's
  list, live progress counts, per-source failure reporting by address, and rows that stream in as
  a scan progresses instead of only updating at the end. New loopback stub library for `ui:verify`.
- **122 — a server's detail opens.** A second-column detail pane opened from a row: header
  (address, mod, map, gamemode, players, ping, password, engine/protocol), a sortable players
  table with four distinct states, and a `ServerDetailSection` error-boundary wrapper that 123/124
  reuse.
- **123 — the rules a server plays by, in full.** The full `serverinfo` rule table (known keys
  formatted, everything else raw and sorted) plus `dmflags` decoded bit by bit, with a visible
  caveat that mods may reuse those bits.
- **124 — how this server has answered.** A reachability statement (did the last round answer,
  when did it last) plus an in-memory, session-scoped, 20-sample response-time history, newest
  first.
- **125 — i join a server from the browser.** A one-shot `+exec`'d cfg file carries the join
  password out of the game's argv entirely (never written to the command line, mode 0600, removed
  on exit/error/failure, leftover swept at the next launch). Mod-mismatch and password-prompt
  dialogs, join recorded in history. This story's hard-tier review caught two real defects before
  ship — see Findings.
- **126 — i spectate without picking a side.** Reuses 125's exact password mechanism for the
  spectator password (never a second mechanism); a Spectate action next to Join in both surfaces.
  Its own build was clean, but it collided with an earlier story's acceptance check — see
  Findings.
- **127 — a server goes into my address book.** A dialog writing a server's address into one of a
  chosen profile's nine `adr0`–`adr8` slots through the config module's own cvar-write path
  (always a fresh full-map read before write, so no other cvar is ever clobbered).
- **128 — an unlock code proves what it unlocks.** A signed (Ed25519), device-bound wire format,
  a pure verifier, a main-process `UnlockService`, a device id derived from the machine
  GUID/machine-id (never logged), and an out-of-repo issuing script. Hard-tier review caught four
  real defects, all fixed — see Findings.
- **130 — a locked feature does not exist.** A boot-time feature gate (`app.features`) that
  simply never registers a locked feature's IPC handlers, so a locked feature answers exactly
  like an unknown one — not merely hidden, genuinely indistinguishable. Hard review added a
  missing end-to-end test against the real verifier.
- **129 — i ask for a code and see what it unlocked.** A Settings panel to redeem a code, see the
  installation id (with copy), the redemption result (one of five distinct reasons) and every
  stored code with its status — including "expired". States plainly that a redemption only takes
  effect at the next restart.
- **131 — the watchlist finds a name for free.** Regex/exact/substring name matching that runs
  exclusively inside a long-lived worker thread with a 100 ms per-job budget (terminate + restart
  on overrun) — the scan itself never waits on it. Gated behind feature `watchlist`; locked means
  no handlers, no service, no worker, and `state.json`'s `watchlist` key untouched. Hard review
  caught a real race at the worker boundary — see Findings.
- **132 — the watchlist tells me where someone is.** A gated tab in the Servers view rendering
  131's snapshot: offline/found/left/too-slow states per entry, re-check, edit, remove, and
  Join/Spectate/open-detail on each match, reusing 125/126/122's existing components rather than
  duplicating them.

## Findings & decisions

- **Hard-tier review earned its keep everywhere it ran.** All four stories with a dispatched
  `story-review-hard` pass (125, 128, 130, 131) had it find something the default review missed,
  and in three of the four (125, 128, 131) that something was a real, shippable defect — not a
  style nit:
  - **125:** a race between two overlapping launches could let the second call's cleanup delete
    the first call's just-written password cfg before the game read it; and the e2e flow's
    cfg-removal assertion passed vacuously whether the file was removed or had never existed.
    Both fixed and re-verified.
  - **128:** a case-sensitive path check let a differently-cased path defeat the issuing script's
    "refuse a signing key inside the repo" guard on Windows/NTFS; the script could sign codes the
    verifier would itself reject as malformed; stored-code growth was unbounded past the intended
    32-entry cap; and dedupe used an untrimmed code string. All four fixed.
  - **131:** a stale regex-worker job resolving after its entry was edited or removed could
    re-apply a stale `tooSlow`/match result to the new state — a genuine concurrency bug in the
    exact mechanism the hard review exists to check. Fixed with a per-entry generation counter.
  - **130:** the default review's coverage gap (no test proved the gate end-to-end against a real
    `UnlockService` + real signature verifier, only a hand-built stub) was closed, no functional
    defect found.
  - This is a strong signal for future sprints: keep the hard tier and its dedicated review on
    anything crypto-, concurrency-, or argv/logging-adjacent — three defects out of four hard
    reviews this sprint would have shipped otherwise.
- **A cross-story acceptance conflict, caught only by the sprint-wide regression gate, not any
  single story's own narrow gate.** Story 126 legitimately added a visible "Spectate" button/label
  to the detail header; story 122's AC4 ("no spectator claim") enforced that via a whole-detail-pane
  text scan that was broader than its actual intent (the players table must not imply spectator
  status). Each story's own narrow gate was green in isolation — only the full `e2e-all` run after
  all 15 stories caught the collision. Fixed by narrowing 122's check to the players panel's own
  DOM subtree — a scope correction, not a weakening; the assertion is exactly as strict within that
  scope. This is exactly the scenario `## Regression gate` exists to catch (see also the roadmap's
  own S18 follow-up making the point).
- **A second real regression, this one purely mechanical:** story 131's `watchlist-regex-host.ts`
  declared a local `function spawn(): Worker`, which collided by substring with the downloads
  module's layering guard (`layering.test.ts`, banning `spawn(` outside downloads — meant for
  `child_process.spawn`, not `worker_threads.Worker`). Renamed to `startWorker`; no functional
  change.
- **Decisions of note** (full one-line reasons are in each story's `## Decisions (Sprint)`):
  favourite status is always read live, never from `origins`; the join/spectate password never
  touches argv under any code path (a one-shot exec'd cfg, always cleaned up); a redeemed unlock
  code only takes effect at the next app start, because the feature gate is decided once at boot;
  regex matching for the watchlist runs only inside a worker thread, never on main's thread, under
  any code path including validation and re-match-on-edit; a locked feature's IPC handlers are
  never registered at all, so "locked" and "doesn't exist" produce an identical answer.
- **Non-blocking findings left as documented follow-ups**, added to the roadmap: `AppContext`
  exposes both the frozen feature gate and the live `unlock` service side by side, which a future
  handler could read directly to see a mid-session redemption before the boot-time gate does — not
  exploitable today, worth hardening before a feature needs to read `unlock` directly.

## Blocked / open

None. All 15 stories completed without a user-facing blocker.

## Regression gate

Commands run on the finished branch (`sprint/S25`, before the two fixes below):

| Command | Result | Time |
| --- | --- | --- |
| `npm run build` | green | 0.06 min |
| `npm test` (full) | **red** — 1 failing test | 0.27 min |
| `npm run ui:verify` | green — 94/94 shots, 0 axe violations | 1.75 min |
| `npm run ui:flows` (`e2e-all`, 71 flows) | **red** — 3 failing | ~24 min |

- `npm test`: `layering.test.ts`'s main-process spawn/network allowlist flagged
  `watchlist-regex-host.ts` (story 131) — a false positive from a local function named `spawn`.
  Fixed (`7e999cf`), full suite re-verified green (4882 passed, 0 failed).
- `home-dashboard-arrange`, `news-cover-template`: pre-existing / environmental, confirmed
  unrelated to any S25 commit by re-running each in isolation.
- `servers-detail`: real regression, story 126 vs. story 122's AC4 (see Findings above). Fixed
  (`c6e1e96`).

**Confirmation run** (`e2e-all` once more, after both fixes): 69/71 passed, 1426s (~24 min) — only
the two pre-existing/environmental failures remain. Gate is **green** (modulo those two, which
predate this sprint and block nothing).

Note for the next sprint's planning: this sprint's own plan expected "14 of 56 flows fail
deterministically, pre-date S23"; the actual count found was 2 of 71. See the roadmap's
follow-ups — worth a dedicated sweep before trusting either number.

## Acceptance

Acceptance is the test suite; every criterion below was proven by an automated test written as
part of its story (unit/component test, or the named `ui:flow`/`ui:verify` script where the
criterion describes a user action). Full AC→test mappings are in each story's own
`## Acceptance Tests` section under `docs/requirements/done/`.

| Story | Criteria proven by |
| --- | --- |
| 118 | Unit tests on `row-markers.ts`/`scan-service.ts`/`scan-merge.ts` + e2e `servers-row-markers` |
| 119 | Unit tests on `list-sort.ts` + e2e `servers-sort-order` (default order, direction cycling, persistence) |
| 120 | Unit/component tests on `list-filter.ts`/`ServerListFilterBar` + e2e `servers-filter-search` |
| 121 | Unit/component tests on `list-state.ts`/`ServersListStatus` + e2e `servers-list-states` + `ui:verify` screens |
| 122 | Unit tests (`server-engine.ts`, `player-sort.ts`) + component tests + e2e `servers-detail` |
| 123 | Unit tests (`dmflags.ts`, `rule-table.ts`) + component tests + e2e `servers-detail-rules` |
| 124 | Unit tests (`scan-merge.ts`, `scan-service.ts`) + component test + e2e `servers-detail-reachability` |
| 125 | Unit tests across `userinfo.ts`/`launch-plan.ts`/`launch.ts`/`join-flow.ts` + e2e `servers-join` (asserts the password nowhere in argv/log) |
| 126 | Unit tests (`scan-service.ts`, `launch-plan.ts`) + e2e `servers-spectate` |
| 127 | Unit/component tests (`address-book.ts`, `AddToAddressBookDialog`) + e2e `servers-address-book` |
| 128 | Unit tests across `unlock.ts`/`verify.ts`/`service.ts`/`launcher-install-id.ts`/issuing script — no e2e (no user-facing surface; that's 129's) |
| 130 | Unit tests on `gate.ts`/`registry.ts`/`features.ts` — no e2e (no user action criterion; first real surface is 132's) |
| 129 | Unit/component tests (`UnlockCodePanel`, IPC) + e2e `unlock-code` |
| 131 | Unit tests across `watchlist-entries.ts`/`watchlist-matcher.ts`/`watchlist-regex-host.ts`/`watchlist-service.ts` — no e2e (132 renders the results and owns that flow) |
| 132 | Unit/component tests (`useWatchlist`, `WatchlistPanel`) + e2e `servers-watchlist` (locked→redeem→restart→unlocked, add/found/offline/left/re-check/edit/remove/join/spectate) |

**Manual residue: none.** Every story explicitly confirmed no criterion required a human step;
`testplan.md` is not written for this sprint (per `testplan: optional`, nothing to collect).

## Tier record

| Story | D | hard D | Review | Cycles | Agents |
| --- | --- | --- | --- | --- | --- |
| 118 | 3 | 0 | default | 0 | 5 |
| 119 | 3 | 0 | default | 0 | 5 |
| 120 | 2 | 0 | default | 1 | 4 |
| 121 | 3 | 0 | default | 1 | 8 |
| 122 | 4 | 0 | default | 0 | 6 |
| 123 | 3 | 0 | default | 1 | 8 |
| 124 | 2 | 0 | default | 1 | 6 |
| 125 | 5 | 1 | default+hard | 1 | 10 |
| 126 | 3 | 0 | default | 0 | 5 |
| 127 | 2 | 0 | default | 1 | 5 |
| 128 | 4 | 1 | default+hard | 2 | 10 |
| 130 | 3 | 1 | default+hard | 1 | 7 |
| 129 | 4 | 1 | default | 0 | 6 |
| 131 | 5 | 1 | default+hard | 1 | 10 |
| 132 | 4 | 0 | default | 1 | 7 |
| **Totals** | **50** | **5** | **4 hard reviews of 5 hard D's** | **11** | **102** |

Plus 15 refine agents (one per story) and 5 gate-phase agents (1 short-suite runner, 2
attribution, 2 fix) — **122 agents dispatched this sprint in total**.

**Did the hard tier earn its cost?** Yes, decisively: of the 4 stories where `story-review-hard`
actually ran (125, 128, 130, 131 — 129 had a hard-tier deliverable but only a default review per
its own refine budget), 3 surfaced a real, shippable defect the default review had missed
(concurrency/race conditions and a signing-guard bypass), and the fourth closed a genuine test-
coverage gap. Keep the hard tier at its current bar for anything touching cryptography,
concurrency, or the argv/logging boundary.
