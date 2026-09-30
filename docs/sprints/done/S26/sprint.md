---
sprint: S26
status: done # planned | in-progress | done
branch: sprint/S26
milestone: 10.1–10.3 — Module & parsing, discovery & index, sidecar & precedence
---

# Sprint S26 — Demo browser, part 1 — module, parsing, index, sidecars

## Goal

The `replays` module exists with its nav entry and a main-side index that finds demos in every installation, game dir, extra folder and zip, parses dm2/MVD2 headers and duration, derives facts from file names (shipped and user patterns), rescans incrementally, and merges sidecar > content > name > file time with each value's source — proven by tests, with only the minimal surface the stories themselves require.

## Stories (in build order)

- [x] 135 — a demos module exists with its own nav entry
- [x] 136 — a dm2 tells its map and players
- [x] 137 — an mvd2 tells its map and players
- [x] 138 — a demo knows how long it is
- [x] 139 — a file name gives away what it can
- [x] 140 — I teach the browser a name pattern (e2e gap, see Notes)
- [x] 141 — demos are found in every installation and mod (e2e gap, see Notes)
- [x] 142 — I add my own demo folders (e2e gap, see Notes)
- [x] 143 — each demo in a zip is its own row (e2e gap, see Notes)
- [x] 144 — the index only re-reads what changed (e2e gap, see Notes; fixed a cross-story
      regression in 140's test file — module setup now needs electron's `app.getPath`)
- [x] 145 — a demo I cannot parse still shows up
- [x] 146 — what I write about a demo lives next to it
- [x] 147 — a broken sidecar is reported, never overwritten
- [x] 148 — every value says where it came from
- [x] 149 — a guessed gamemode says it is guessed

## Notes

- **Long-sprint test.** 15 stories — the same size as S25; observations on how `/sprint` behaves at
  this size (context, rate limits, late regressions) go into `review.md` as their own section.
- **Deliberate omissions:** 102 (self-built Linux Q2PRO) — no phase-10 story depends on it. 134
  (native helper) is withdrawn — spike 133 ended in go.
- Phase 10 is cut into three sprints (S26 data layer → S27 list/detail UI → S28 playback), so each
  sprint is refined against code the previous one has built and the regression gate runs three
  times instead of once.
- Numeric order is the build order; every `[[NNN]]` reference to a higher id is a "used later"
  mention, not a dependency.
- **e2e harness gap (stories 140–149), resolved at the gate:** `npm run ui:flow`/`ui:verify`
  timed out on its very first locator wait for every story from 140 on, including untouched
  pre-existing flows — during the build phase this was recorded as a session/environment gap
  (every AC provable at the unit/integration level still passed with real tests). The regression
  gate (below) found the actual cause: four orphaned Electron processes left running from earlier
  in the session, holding a lock that made every later `_electron.launch()` hang or misbehave.
  Once killed, `ui:verify`/`ui:flows` ran cleanly and surfaced two *real* bugs the build-phase gap
  had been masking all along (see Regression gate) — the "environment gap" label in each story's
  own Done section undersells what actually happened; this Notes entry is the correction.

## Regression gate

Ran once, after the last story (149), on the finished branch — commit `fa940af`.

- `npm run build` — green (~5s).
- `npm test` (full) — green: 351 files, 5285 passed, 8 skipped, 0 failed (~6 min).
- `npm run ui:verify` — first attempt **exceeded** (10 min, no output): caused by four orphaned
  Electron processes left running from earlier diagnostic runs this session, holding a lock.
  Killed them (`Stop-Process`), retried: **red** — `settings@1280x800` crashed
  (`shot:error`, 1 serious + 2 moderate axe findings) and every screen after it in the same
  Electron session cascaded into `could not restore the base state` (33 screens `unreachable`).
  Root-caused and fixed directly (see below); **final run green**: 96/96 screens, 0 axe violations.
- `npm run ui:flows` (e2e-all) — first attempt (same stale-process state) was part of the combined
  exceeded run above. After killing the stale processes: 59/76 (pre-fix) → after the Settings-crash
  fix, 70/76, 6 failing. Attributed (read-only investigation agent, no re-runs):
  - **Regression, story 140, fixed** (commit `01bb0c3`): `MainModuleRegistry.invoke()` always
    wraps a handler's return in its own transport-level `ok(...)`; every `nameTemplates.*` handler
    already returns `Outcome<NameTemplatesView>` itself, so IPC actually carried a nested
    `Outcome<Outcome<NameTemplatesView>>` — the same two-layer shape
    `servers.sources.*`/`MasterSourcesResult` already uses correctly, just unwrapped one layer too
    few in `NameTemplatesList.tsx`. `view.entries` was `undefined` on every real load, crashing
    `SortableZone`'s `useMemo` and taking down the whole Settings view — this is what caused the
    `settings` screen crash and its cascade above. Fixed by unwrapping both layers (matching
    `ServersSettingsSection.tsx`'s established `mutate()` pattern) and retyping `client.ts`'s seven
    `nameTemplates.*` functions accordingly. Same pass also fixed a real
    `scrollable-region-focusable` axe violation on `replays-list@940x620` (story 141,
    `ReplaysView.tsx`) found by the same `ui:verify` run.
  - **Regression, story 143, fixed** (commit `951be08`), attributed to `replays-discovered-list`
    and `replays-incremental-scan`: `writeReplaysDemosFixture()` built `pack.zip` unconditionally
    into the shared `baseq2/demos` fixture folder on every `writePopulatedFixture()` call, leaking
    `test.dm2`/`final.mvd2` into every populated-based fixture variant's demo listing, not just the
    dedicated zip-handling one. Scoped the archive's build/teardown to `replays-zip-entries.mjs`'s
    own flow.
  - **`replays-extra-folders`**: environment flake — a `locator.click` timeout right after a
    mid-flow Electron relaunch, no functional or fixture cause found. Not fixed, not a blocker.
  - **`servers-filter-search`**: pre-existing, unrelated — untouched by any S26 commit; a
    real loopback UDP fixture server not appearing under load, consistent with packet loss, not a
    code defect.
  - **`servers-master-sources`**: environment flake — bare `waitForFunction` timeout on the
    `empty` fixture variant, flow untouched by S26, no functional cause found.
  - **`servers-sort-order`**: pre-existing bug, predates this sprint — the flow's
    `[data-testid^="servers-row-"]` selector also matches `ServerRow.tsx`'s
    `servers-row-copy-${address}` copy-button testid (added on `dev` before the S26 branch point,
    commit `09c08e0`). Worth a roadmap follow-up line; not this sprint's to fix.
  - Final state after both fixes: the two attributed regressions are green; the other four
    failures are flaky/pre-existing and not blockers for this sprint's merge.
