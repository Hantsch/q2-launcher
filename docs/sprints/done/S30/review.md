# Sprint S30 — Review

## Overview

**Goal:** the Demos view shows only what helps right now (no idle console field, no sort caption, a lean
detail panel, edit in place, one-click favourite and rating); the action bar button becomes the main control
for the open tab (Play, Join, View, Stop); a missing-mod warning is asked once; timeline controls answer a
click at once and reach the game faster on Windows.

| Story | Status | Commit |
| --- | --- | --- |
| 176 — the Demos view shows only what helps right now | done | d0b8d0f |
| 177 — the demo detail reads at a glance | done | 0dad912 |
| 178 — I edit a demo's details where I read them | done | 13f63c8 |
| 179 — I favourite and rate a demo with one click | done | aaa4cff |
| 180 — the action bar button speaks for the tab I'm on | done | 53468fb |
| 181 — I join the selected server from the action bar | done | 1c60ec3 |
| 182 — a missing-mod warning is asked once | done | 2179b0c |
| 183 — a spike finds where demo-control latency comes from | done | c2ff9e7 |
| 184 — the timeline answers my click at once | done | 0133f57 |
| 185 — demo commands reach the game without waiting | done | 852e616, regression fix 040bacf |

## Implemented stories

- **176** — the console field renders only while a demo plays; the sort caption is gone (the active header
  button carries an sr-only direction text).
- **177** — the detail model emits seven facts in two groups under a large name title; provenance labels and
  "(guessed)" in the list row are removed.
- **178** — Edit happens in the panel itself (facts turn into inputs, Save/Cancel in a footer); file actions
  and Edit are header icon buttons; the separate notes form is gone.
- **179** — favourite is a one-click toggle, rating a 10-star radiogroup; both save at once. The store
  serialises sidecar writes per demo, closing the S27 lost-write race.
- **180** — a small shell seam (`lib/primary-action.ts`) lets the open tab contribute the action bar's
  primary button; Demos publishes View, and a mod-missing demo asks Play anyway / Cancel.
- **181** — Servers publishes Join for the selected server through 180's seam (`useJoinFlow`).
- **182** — the missing-mod warning persists "Don't ask again" per mod; Settings has the switch and "Forget
  remembered mods"; main's eligibility re-check is unchanged.
- **183** — spike, no `src/` change: the delay is the log flush, not the tick; recommends
  `logfile_flush 3` + multi-seq at wait 13.
- **184** — the timeline shows the expected state at once (pending commands, projected position), a waiting
  text after 1 s, give-up after 5 s, rollback on refusal.
- **185** — Windows commands reach the game at once (monotone `if $q2l_seq < N` guard per in-flight seq,
  pipelined control file, `logfile_flush 3`); proven by unit tests, a stub burst flow and a real-Q2PRO probe.

## Findings & decisions

- **183 headline:** the baseline control-to-ACK p95 is about 1.5 s and that is the log flush (~1.3 s
  interval), not the 200 ms tick. `flush3` + `multiseq` at wait 13 (`combo-4`) measured p95 <= 293 ms.
  Wait 1 is a console flood (~91-101 lines/s against the 10/s cap) and only a latency floor.
- **183 review:** stage 1 passed with findings; the second-stage (hard) review **failed the first
  recommendation** (combo-1 at 91 lines/s broke the line budget). Fixed by measuring `combo-4` and rewriting
  RESULT.md. CPU stays inconclusive. A third review cycle was not spent; the rewrite was re-verified by a
  number walk.
- **185 measured:** ACK p95 227.6 ms at the 50 ms poll grid (183 target <= 350; baseline 1545 ms); burst
  last-ACK p95 358.5 ms, slightly above 183's ~350 (AC2 sets no bound); POS interval p95 250 ms. The hard
  review **failed D3**: the stub never wrote the `@<ms>` stamp, so the burst flow could not fail. Fixed and
  re-verified (sanity check: a serialised channel gives 3007 ms).
- **185 decisions:** a timed-out seq keeps its command file until `close()`; an ACK for a never-sent seq is
  ignored; AC4 read as "lines per tick unchanged vs 174" (raw 11.8 lines/s in run A stated in RESULT.md);
  four old windows-channel tests changed expectation because one-at-a-time is intentionally gone; probe
  numbers come from one launch each.
- **184:** AC4's backward bound loosened to 750 ms; an extra `LEVERS_FILE` stub lever.
- **180:** the shell seam needed the recorded decision (CLAUDE.md: features never edit the shell); it replaces
  only the `play` case. Pre-existing: Play anyway on a mod whose game dir does not exist fails in main (ENOENT
  writing `q2l_back.cfg`) and is not shown as a play error.
- **181:** with no installation, a contribution is returned forced-disabled; installation-level states win.
- **182:** `gameDir` exempted in the path-leak heuristic of `shared/modules/replays.test.ts`.
- **178/179:** axe heading-order fixed with an sr-only h2 in edit mode; `confirmQuickEdit` added; overlay clear
  waits two macrotasks (assumption about React commit order, covered by store test + 3 green flow runs).
- **Unfixed minor review findings:** 176 double blank line in `ReplaysView.tsx`; 177 `as` cast around
  `describeGamemode`, `truncate` on `<dd>` without tooltip, stale "Story 155 D1" comment, thin "omitted" test;
  179 controls show the old value while a replace dialog is open; 180 `confirmingModMissing` not reset on
  selection change, `'/replays'` literal, stale comment in `DemoTimeline.test.tsx:7`; 181 no test for a stale
  pending row across dialog steps or the invalid-address branch, Join stays enabled for a filtered-out server;
  182 AC7 unit test's StateStore not wired into main, no re-entry guard in `runPlay`, failed `trustMod` still
  plays, `replays.modWarning.error` likely unused, list separators outside i18n; 184 misplaced comment and
  redundant `positionMs` alias, rAF keeps rendering after the 3 s cap, waiting texts for pause/speed untested,
  even count of pending toggles lets a stale readback clear the chain early.
- **Process:** build-agent trail timestamps were monotonic. The user's uncommitted edits in
  `docs/ROADMAP.md` and `docs/concepts/demo-browser.md` were left out of all sprint commits. The concept
  `demo-browser.md` is not fully implemented (later stages, WASM row) and stays in `concepts/`.
- **CHANGELOG sweep:** every user-facing story (176-182, 184, 185) already had its Unreleased entry; nothing
  was added late. 183 is a spike with no entry by design.

## Blocked / open

- No story is blocked. Nothing is red because of this sprint; the merge is the user's call.
- Four flows are red and **pre-existing** (see gate): `replays-extra-folders` (unstable),
  `servers-filter-search`, `servers-master-sources`, `servers-sort-order`. Open item: a dedicated sweep.
- Linux stdout buffering / control latency is unmeasured (no Linux Q2PRO available); Linux is untouched by 185.
- The 40-minute `ui:flows` suite was not re-run after the fix commit `040bacf`.

## Regression gate

Ran on commit `852e616`:

| Command | Minutes | Result |
| --- | --- | --- |
| `npm run build` | < 1 | green |
| `npm test` | 0.7 | green — 5968 passed, 8 skipped |
| `npm run ui:verify` | 2.2 | green — 60/60 screens, axe 0 |
| `npm run ui:flows` | 40 | 113 flows, 107 passed, 6 failed |

- `replays-play-mvd2`, `replays-play-q2pro` → story 185 (stale `logfile_flush 1` assertion against the new
  `logfile_flush 3`); fixed in `040bacf`, both re-run green individually, `npm test` green. The full suite was
  **not** re-run after the fix.
- `replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order` →
  pre-existing (red at merge-base `759db2b` too), not fixed here; extra-folders fails at an earlier step at the
  merge-base, i.e. unstable.
- `replays-archive-readonly` passed in the gate, although 178/179/180 reported it red as pre-existing.

## Acceptance

Per story, the criteria and the test that proved them (from the Done sections). All ran and passed unless
noted.

- **176** — AC1-AC4: unit ConsoleCommandField / DemoListHeader; flows `replays-console-command`,
  `replays-stop`, `replays-stage`, `replays-sort-order`.
- **177** — AC1-AC5: flow `replays-demo-detail` + `DemoDetailPanel.test.tsx` / `demo-detail.test.ts`; AC6:
  mvd2 flow step + kept units; AC7: `replays-demo-rows` duel step + `DemoRow.test.tsx` / `gamemode.test.ts`.
- **178** — AC1-AC6, AC8: flows `replays-edit-sidecar`, `replays-edit-sides-tags`, `replays-rename`,
  `replays-demo-file-actions` + units; ui:verify axe 0 incl. `replays-detail-edit`. AC7: unit passed; flow
  `replays-archive-readonly` was green for its AC7 steps but red at a later Play-reason step (pre-existing then;
  green in the final gate).
- **179** — AC1-AC6: flow `replays-detail-quick-edit` + units (DemoDetailPanel, StarRating,
  demo-editor-store); AC7: units (flow pre-existing red at a later step, as above); AC8: `replays-edit-sidecar`
  + unit; AC9: `DemoListFilterBar.test.tsx`.
- **180** — AC1-AC9: `action-bar-view`, `replays-play-q2pro`, `replays-stage`, `replays-stop` + ActionBar.test,
  ReplaysView.test, DemoDetailPanel.test (mapping in the story).
- **181** — AC1-AC5 and the no-installation decision: flow `servers-actionbar-join` + ServersView.actionbar,
  useJoinFlow.test, ActionBar.test.
- **182** — AC1-AC6: flow `replays-mod-warning` + ReplaysView.test, schemas.test, index.test,
  ReplaysSettingsSection.test; AC7: demo-play.test "a mod-missing play without acknowledgement is refused…".
- **183** — AC1-AC5 via `harness.mjs --config <name> --samples 30` per config and RESULT.md (~80 figures
  spot-checked against the JSONs); AC6 as "not measured" plus code assessment of `linux-channel.ts`.
- **184** — AC1-AC7: flow `replays-timeline-optimistic` + DemoTimeline, optimistic-timeline and store unit
  tests; `replays-timeline` green.
- **185** — AC2: flow `replays-timeline-burst` + windows-channel tests; AC5: windows-channel tests, flows
  `replays-fullscreen` / `replays-stop`; AC4: protocol.test line budget; AC1/AC3: protocol.test launch args;
  AC6: linux-channel + playback-control tests. Real-Q2PRO probe outside CI (`spikes/185-control-latency/`).

**Manual residue** (see `testplan.md`):
- 183 — the per-config screenshots were judged by eye, not asserted (AC4: visible console/notify lines,
  `combo-4` vs baseline).
- 183 AC6 / 185 — Linux delay not measured (no Linux Q2PRO on this machine).
- Also not measured: burst serialisation at production's 50 ms poll and wait2 + flush3 (183).

Covered below the real surface: 185's AC1-AC5 are proven by unit tests and a stub flow; the real-engine
proof is the one-off probe, not a CI test.

## Tier record

| Story | Ds | Hard Ds | Review stages | Review cycles | Agents | Build min |
| --- | --- | --- | --- | --- | --- | --- |
| 176 | 2 | 0 | default | 1 | 4 | 8 |
| 177 | 3 | 0 | default | 1 | 5 | 8 |
| 178 | 4 | 1 | default | 1 | 7 | 42 |
| 179 | 5 | 1 | default | 1 | 10 | 26 |
| 180 | 6 | 1 | default | 1 | 8 | 24 |
| 181 | 2 | 0 | default | 1 | 5 | 10 |
| 182 | 3 | 0 | default | 1 | 5 | 13 |
| 183 | 2 | 1 | default + hard | 2 | 10 | 85 |
| 184 | 4 | 1 | default | 0 | 7 | 25 |
| 185 | 4 | 1 | default + hard | 1 | 9 | 34 |
| **Total** | **35** | **6** | | | **70** | **275** |

Did the hard review find anything the default review had missed? Yes, in both stories that had one: 183
(the recommendation broke the line budget) and 185 (the burst flow's stub could not fail).
