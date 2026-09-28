# Sprint S26 review — Demo browser, part 1: module, parsing, index, sidecars

## Overview

Goal: the `replays` module exists with its nav entry and a main-side index that finds demos in
every installation, game dir, extra folder and zip, parses dm2/MVD2 headers and duration, derives
facts from file names (shipped and user patterns), rescans incrementally, and merges
sidecar > content > name > file time with each value's source — proven by tests, with only the
minimal surface the stories themselves require. This is the first of three sprints for phase 10
(S26 data layer → S27 list/detail UI → S28 playback).

| Story | Status | Commit |
| --- | --- | --- |
| 135 — a demos module exists with its own nav entry | done | `5a7d747` |
| 136 — a dm2 tells its map and players | done | `d0fe465` |
| 137 — an mvd2 tells its map and players | done | `84a3609` |
| 138 — a demo knows how long it is | done | `8b80cae` |
| 139 — a file name gives away what it can | done | `134efc0` |
| 140 — I teach the browser a name pattern | done (regression fixed at gate) | `16d9551` + `01bb0c3` |
| 141 — demos are found in every installation and mod | done | `ff0854c` |
| 142 — I add my own demo folders | done | `4f9d280` |
| 143 — each demo in a zip is its own row | done (regression fixed at gate) | `3cce3a7` + `951be08` |
| 144 — the index only re-reads what changed | done (cross-story fix included) | `294b463` |
| 145 — a demo I cannot parse still shows up | done (rescoped) | `62a9dbd` |
| 146 — what I write about a demo lives next to it | done | `42bbe42` |
| 147 — a broken sidecar is reported, never overwritten | done | `53934c4` |
| 148 — every value says where it came from | done | `7686241` |
| 149 — a guessed gamemode says it is guessed | done | `000b3b8` |

All 15 stories are done; nothing is blocked. No story was omitted from the sprint list.

## Implemented stories

- **135** registers the `replays` module end to end (shared contract, main handler, renderer
  settings section, "Demos" nav entry right after Servers with a `Film` icon, `PlannedModuleView`
  placeholder) — the shell every later demo story lands in.
- **136/137** are pure header parsers for `.dm2` (protocol 34 + 343x) and `.mvd2` (protocol 37,
  versions 2009–2013), proven against the user's own real capture files
  (`docs/fixtures/demos/test.dm2`, `PFAU_20221127-053327_q2dm1.mvd2`) as well as synthetic ones.
  137's build caught and fixed a real bounds bug (the MVD2 player list bled OpenTDM's scoreboard
  configstrings in).
- **138** computes exact demo duration by streaming frame count (not an estimate, per the user's
  call that a timeline needs a precise seek bar) — measured 410 frames/41.0 s and 6201
  frames/10:20 on the two real fixtures, both matching an independent oracle exactly.
- **139/140** are the file-name pattern engine (four shipped patterns, a capped ambiguity-safe
  matcher) and its Settings UI — one ordered, editable list of shipped + user patterns, with
  tombstone/restore for removed or edited shipped entries.
- **141/142/143** are discovery: every installation × game dir's `demos/` folder plus the
  effective write directory, user-added extra folders (top-level only, no recursion — the user's
  call), and each zip archive's demo entries as their own read-only rows via the bundled `7za`.
- **144** ties discovery and parsing into an incremental, cached, single-flight scan (scan on
  open + manual refresh, no watcher, live-write skip while a game runs, cached rows shown
  immediately then swapped once the scan finishes).
- **145** proves an unparsable demo still becomes an index entry (`readable: false`, closed
  9-code reason, name facts and file time kept, no parsed fields) — rescoped to the data layer
  mid-sprint after its refine pass correctly flagged that its original ACs assumed UI surfaces
  that don't exist until S27/S28 (user decision, see Findings).
- **146/147** are the sidecar: schema, atomic id-addressed read/write, and defensive reading of a
  broken sidecar (valid fields kept, the rest flagged; a write over a broken or read-only sidecar
  needs explicit confirmation).
- **148/149** are the precedence resolver (sidecar → content → name → file time, each value's
  source shown as text) and the gamemode heuristic (sidecar → pattern → mod heuristic → unknown,
  heuristic values marked "guessed").

## Findings & decisions

- **Clarification round.** 12 genuine product/direction questions were bundled to the user before
  refine (real sample demos vs. synthetic fixtures, exact vs. estimated duration, pattern
  precedence, scan recursion, the zip reader dependency, live-scan behaviour, unreadable-demo
  Play, sidecar-clear/read-only/broken-sidecar handling, the gamemode heuristic's scope, nav
  placement). The user also supplied two real demo captures used as fixtures throughout. All
  answers are recorded per-story under `## Decisions (Sprint)`, marked `(User)`.
- **145's scope-vs-sprint-cut.** Its refine pass correctly identified that four of five ACs
  assumed the list/detail/reveal/rename/Play surfaces S27/S28 build, not S26 — a genuine
  BLOCKED-for-user-question case, not a triage failure. Put to the user, resolved as "rescope to
  the data layer, keep it in S26" (option A of three offered); AC5 moved to story 159 (S28).
- **The concept's biggest open points got resolved as a side effect of building, not just
  refine**: §17.1 (Windows remote channel) was already closed by spike 133 before this sprint;
  §17.2 (name-template syntax) by 139/140; §17.4 (duration cost) by 138, measured on the real
  fixtures; §17.5 (gamemode heuristic) by 149; §17.16 (nav icon/order) by 135.
- **Two cross-story regressions surfaced only once multiple stories' code ran together** — exactly
  the case the regression gate exists for (see below); one was caught and fixed *during* the build
  phase (144 breaking 140's test file), the other two only surfaced once the e2e harness could
  actually run at the gate (see next point).
- **The session's `ui:flow`/`ui:verify` timeouts all sprint were not a permanent environment
  limitation** — they were four orphaned Electron processes left running from early diagnostic
  runs, holding a lock. Killing them let the harness run cleanly and immediately surfaced two real
  bugs (a Settings-crashing double-wrapped `Outcome` in story 140, and a zip-fixture leak in story
  143) that ten separate stories' build-phase "environment gap" label had been quietly masking.
  Lesson for future sprints: a *consistent* first-locator timeout across unrelated flows is worth
  a leftover-process check before it's accepted as environment noise, even mid-sprint, not only in
  the phase 2b gate.

## Blocked / open

Nothing is blocked. One question was raised and resolved before it could block anything (145's
scope-vs-sprint-cut, above).

## Regression gate

Ran once, after the last story, on the finished branch (commit `fa940af`; both fixes below landed
afterward, at `01bb0c3` and `951be08`).

- `npm run build` — green (~5 s).
- `npm test` (full) — green: 351 files, 5285 passed, 8 skipped, 0 failed (~6 min).
- `npm run ui:verify` — exceeded once (four orphaned Electron processes from earlier in the
  session; killed, not a code issue), then **red** (`settings` screen crashed, cascading 33 other
  screens into `unreachable`), then **green** after the fix below: 96/96 screens, 0 axe violations.
- `npm run ui:flows` (e2e-all) — 59/76 → 70/76 after the Settings-crash fix. Of the 6 remaining
  failures, attribution (read-only investigation, no re-runs) found:
  - **Story 140, fixed** (`01bb0c3`): the module registry always wraps a handler's return in its
    own transport-level `Outcome`; every `nameTemplates.*` handler already returns an `Outcome`
    itself (correctly, matching `servers.sources.*`'s established two-layer pattern), but
    `NameTemplatesList.tsx` only unwrapped one layer, so `view.entries` was `undefined` on every
    real load — crashing `SortableZone` and the whole Settings view. Fixed by unwrapping both
    layers, matching `ServersSettingsSection.tsx`'s `mutate()`. The same pass fixed a real
    `scrollable-region-focusable` axe violation on `replays-list@940x620` (story 141).
  - **Story 143, fixed** (`951be08`), attributed to `replays-discovered-list` and
    `replays-incremental-scan`: the zip test fixture was built unconditionally into the *shared*
    `baseq2/demos` folder on every populated-variant fixture write, leaking two extra files into
    every other flow's demo listing. Scoped the zip's build/teardown to its own flow.
  - `replays-extra-folders`, `servers-master-sources` — environment flake (a bare locator/
    `waitForFunction` timeout, no functional or fixture cause found); not fixed, not blockers.
  - `servers-filter-search` — pre-existing, unrelated (a loopback UDP fixture server not
    appearing under load); untouched by any S26 commit.
  - `servers-sort-order` — pre-existing bug predating this sprint: the flow's row selector also
    matches a copy-address button's testid, added on `dev` before the S26 branch point
    (`09c08e0`). Worth a roadmap follow-up line, not this sprint's to fix.
- Final state: both attributed regressions are green; the other four are named, not blockers.

## Acceptance

Every acceptance criterion maps to a named test (see each story's own `## Acceptance Tests` /
Done section for the exact file and test name — kept there, not duplicated here, per each story's
own record). Summary by story:

| Story | Criteria proven by | Gaps named |
| --- | --- | --- |
| 135 | unit + `replays-module-shell` e2e flow | — |
| 136 | unit, incl. real `test.dm2` fixture | — |
| 137 | unit, incl. real MVD2 fixture; a review-caught bounds bug fixed before merge | — |
| 138 | unit, exact-count cross-checked against an independent oracle on both real fixtures | — |
| 139 | unit, incl. a brute-force ambiguity oracle | — |
| 140 | unit + e2e (`replays-name-templates`, `replays-module-shell`) — both now provably green | — |
| 141 | unit + e2e (`replays-discovered-list`) — now green | write-dir case (Linux-only) has no e2e, unit-covered |
| 142 | unit + e2e (`replays-extra-folders`) | e2e flaky in the gate run (environment, not code) |
| 143 | unit + e2e (`replays-zip-entries`) — now green after the fixture-leak fix | — |
| 144 | unit + e2e (`replays-incremental-scan`) — now green | — |
| 145 | unit only (data-layer rescope; UI half moves to 150/155/159 in S27/S28) | by design, see Decisions |
| 146 | unit only (editor surface is story 155, S27) | AC7's reason text has no UI yet |
| 147 | unit only (confirm-dialog UI is S27) | — |
| 148 | unit only (source label isn't mounted until 155, S27) | — |
| 149 | unit only (row/detail/filter surfaces are 150/153/155, S27) | — |

No manual residue anywhere in this sprint — every story's own Done section says so explicitly.
`testplan.md` is therefore not written (per `testplan: optional`).

## Tier record

| Story | D | hard | Review | Cycles | Agents |
| --- | --- | --- | --- | --- | --- |
| 135 | 3 | 0 | default | 0 | 5 |
| 136 | 2 | 0 | default | 1 | 4 |
| 137 | 2 | 0 | default | 1 | 6 |
| 138 | 4 | 1 | default | 0 | 6 |
| 139 | 2 | 1 | default | 1 | 4 |
| 140 | 3 | 0 | default | 1 | 5 |
| 141 | 5 | 0 | default | 1 | 7 |
| 142 | 5 | 0 | default | 1 | 9 |
| 143 | 4 | 1 | default | 1 | 8 |
| 144 | 4 | 1 | default | 0 | 6 |
| 145 | 3 | 0 | default | 1 | 5 |
| 146 | 3 | 0 | default | 0 | 5 |
| 147 | 3 | 1 | default | 1 | 5 |
| 148 | 2 | 0 | default | 0 | 4 |
| 149 | 2 | 0 | default | 1 | 4 |
| **Total** | **47** | **5** | | **10** | **83** |

No story used a hard-tier (second-pass) review this sprint — every Model Hints line judged
"default" sufficient, and the two real regressions the gate found were both integration bugs a
single-story review (of any tier) structurally cannot see: they only exist once two stories'
independently-correct code runs together. That is exactly what the regression gate is for, and it
did its job. Gate-phase agents (attribution + one fix), on top of the table above: 2. Refine-phase
agents: 15 (one per story; 145 needed a second round after its scope question was resolved).

## Sprint-scale observations (S26 is a 15-story sprint, same size as S25)

- Refine (15 stories, one message, foreground): completed without incident; one story (145)
  correctly escalated a scope question instead of guessing.
- Build (15 stories sequential): one cross-story regression caught *during* the build phase itself
  (144 → 140's test file) by the standing instruction to sweep the wider replays test surface on
  every story, not just `--changed HEAD` — this worked as intended and should stay standard
  practice for sprints that build many stories on the same module in sequence.
- The two regressions the *gate* caught (not the per-story sweep) were both integration-level:
  a nested-Outcome unwrap depth and a shared-fixture leak. Neither is the kind of thing a
  per-story narrow gate could have caught, by design — they needed the full suites running
  together, which is the regression gate's entire reason to exist, restated here because this
  sprint is direct evidence for it.
- The apparent "environment gap" that recurred across ten stories' build reports was in fact one
  root cause (orphaned processes) that nobody thought to check until the gate — a reminder that a
  *pattern* of identical failures across unrelated code is itself a signal worth a two-minute
  process check, even under the "don't over-verify" discipline this workflow otherwise correctly
  enforces.
