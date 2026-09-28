---
sprint: S26
status: in-progress # planned | in-progress | done
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
- [ ] 141 — demos are found in every installation and mod
- [ ] 142 — I add my own demo folders
- [ ] 143 — each demo in a zip is its own row
- [ ] 144 — the index only re-reads what changed
- [ ] 145 — a demo I cannot parse still shows up
- [ ] 146 — what I write about a demo lives next to it
- [ ] 147 — a broken sidecar is reported, never overwritten
- [ ] 148 — every value says where it came from
- [ ] 149 — a guessed gamemode says it is guessed

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
- **e2e harness gap (from 140):** `npm run ui:flow` timed out on its very first locator wait for
  both a story flow and an untouched pre-existing one (`servers-master-sources`), independently
  reproduced by the orchestrator with no leftover Electron process and no stale build — a
  session/environment issue, not a regression. Every AC provable at the unit/integration level
  still passed with real tests. This is recorded once, here, rather than repeated per story; any
  later story whose e2e half is likewise unverified names it the same way instead of re-diagnosing
  it. The regression gate (phase 2b) re-attempts the full e2e suites once and records the outcome.
