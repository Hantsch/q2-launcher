---
id: 162
title: an mvd2 plays and seeks
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A server-side `.mvd2` ([[137]]) contains every player, not one POV. Q2PRO plays it through the same
`demo` command (auto-detected) and seeks it with `mvdseek` rather than `seek` (concept
`docs/concepts/demo-browser.md` §6.4, §9.1). A user plays an MVD2 exactly like a `.dm2` ([[159]]) and
the timeline ([[165]]) works on it — but which player the camera follows, and whether the launcher
offers a choice, is concept open point §17.9, and the concept puts a POV choice beyond Q2PRO's own
playback outside v1 (§2).

## Acceptance Criteria

- [x] **AC1** — Play on an `.mvd2` (and `.mvd2.gz`) starts Q2PRO with `+set game` and `+demo`, like
      [[159]].
- [x] **AC2** — Timeline seeking on an MVD2 uses the command decided in Q2, and a unit test pins the
      command per format.
- [x] **AC3** — Which player is followed after the start is documented (Q1), and the detail view
      states it where it matters.
- [x] **AC4** — On r1q2, MVD2 stays disabled with its reason ([[161]] AC3).

## Open Questions

- [x] ~~**Q1 — Followed player** (§17.9): whom does Q2PRO follow by default, and does v1 offer~~
      ~~nothing more than Q2PRO's own in-game controls for switching?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — `mvdseek` vs `seek`** — which one the timeline sends for MVD2, and whether both accept~~
      ~~the same relative/absolute syntax.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User, sprint-level)** Playback goes through Q2PRO only for now; no r1q2 playback support.
- **Q1 — Followed player:** the launcher does not choose or pin the followed player; Q2PRO's own MVD
  viewer decides whom the camera follows at start, and v1 offers nothing beyond Q2PRO's in-game
  controls (`cmd invnext` / `cmd invprev`, `cmd chase [player]`, also typeable in [[166]]'s console
  field) — the concept puts a POV choice outside v1 (§2), and spike 133 verified exactly these
  controls but never recorded the engine's initial chase state, so the launcher must not claim a
  specific default.
- **Q2 — `seek` for both formats:** the timeline sends Q2PRO's `seek [+-]<seconds>|<percent>%` for
  `.dm2` and `.mvd2` alike, not `mvdseek` — spike 133 measured `seek +30`, `seek -20`, `seek 30`,
  `seek 50%` and `seek 10%` taking effect on an MVD started with `demo x.mvd2`, so one syntax covers
  both; the per-format function keeps a future divergence a one-line change.
- **AC4 under the Q2PRO-only rule:** nothing plays on r1q2 this sprint, so an MVD2 on an r1q2
  active installation is disabled by [[159]]'s general "not Q2PRO" rule and visible reason — no
  MVD2-specific r1q2 reason is added; AC4 is proven by a test that this holds for `format: 'mvd2'`.
- **`.mvd2.gz` plays natively:** passed to `+demo` as-is with its full file name — concept §11.2
  lists gzip copies only for r1q2, i.e. Q2PRO reads gzip demos itself; no decompressed copy.
- **Full extension on `+demo`:** the relative path always keeps `.mvd2` / `.mvd2.gz` — spike 133
  fix #5: without an extension `demo` assumes `.dm2`.

## Plan

Builds on [[159]] (Play, installation choice, `+set game`/`+demo` args, stub-engine e2e fixture).
162 adds no new launch path — it pins that 159's path is format-agnostic and fills the MVD2 gaps.

1. **D1 — MVD2 plays like a `.dm2`:** 159's Play availability and play-args builder accept
   `format: 'mvd2'` (plain and `gzip: true`) and keep the full extension on `+demo`; unit tests for
   args and for the r1q2-disabled case; an e2e flow plays both an `.mvd2` and an `.mvd2.gz` against
   159's stub engine.
2. **D2 — one seek command per format:** a pure shared builder that the timeline ([[165]]) sends
   through [[164]]'s channel; a unit test pins `seek` for both formats. Correct concept §6.4 / §17.9.
3. **D3 — the detail view says who is followed:** an MVD2-only note in the detail panel (i18n key),
   renderer test, and a step in D1's flow asserting it is visible.

Order D1 → D2 → D3 (D2 is independent). No IPC channel change is expected; if D1 finds 159
filtering MVD2 out, the fix stays inside 159's files.

## Deliverables

- **D1 — MVD2 / MVD2.gz play through 159's path.**
  Locate 159's play-args builder and Play-availability resolver (`grep -rn "'+demo'" src/main
  src/shared` and `grep -rln "demomap" src --include=*.test.ts`; expected under
  `src/main/modules/replays/` and/or `src/shared/replays/`). Ensure: (a) a row with
  `format: 'mvd2'` (`gzip` false or true; `demoFormatSchema` in `src/shared/modules/replays.ts`) is
  playable on a qualifying Q2PRO installation exactly like a `.dm2`; (b) the args are
  `+set game <gamedir>` and `+demo <path relative to the game dir, forward slashes>` with the full
  file name kept (`team_q2dm3.mvd2`, `tourney.mvd2.gz`) — Q2PRO's `demo` assumes `.dm2` without an
  extension and reads gzip itself, so no decompressed copy; (c) with a non-Q2PRO (r1q2) active
  installation an MVD2 is disabled with 159's existing "not Q2PRO" visible reason (no new reason).
  Tests: add cases to 159's existing args test file and availability test file.
  E2E: new flow `scripts/flows/replays-play-mvd2.mjs`, mirroring 159's play flow (same stub engine
  and fixture helpers in `scripts/lib/fixture.mjs`): seed an `.mvd2` and an `.mvd2.gz` inside the
  Q2PRO fixture installation's `<gamedir>/demos/` (next to `REPLAYS_FIXTURE_DEMOS`, reusing its
  literals), click Play on each, and assert the stub engine's recorded argv contains
  `+set game <gamedir>` and `+demo demos/<file>` with the full extension.
  Touches: 159's args/availability files + their tests, `scripts/lib/fixture.mjs`,
  `scripts/flows/replays-play-mvd2.mjs`.
- **D2 — `demoSeekCommand(format, target)`.**
  New pure file `src/shared/replays/demo-control.ts` (no node/DOM/electron; header style of
  `src/shared/replays/demo-detail.ts`):
  `type SeekTarget = { kind: 'relative'; seconds: number } | { kind: 'absolute'; seconds: number }
  | { kind: 'percent'; percent: number }` and
  `demoSeekCommand(format: DemoFormat, target: SeekTarget): string` returning `seek +10` /
  `seek -10` (relative, sign always written, whole seconds via `Math.round`), `seek 30` (absolute,
  clamped ≥ 0), `seek 50%` (percent, whole number clamped 0–100) — for **both** `'dm2'` and `'mvd2'`
  (Q2PRO's `seek`, verified on MVD by spike 133 `spikes/133-q2pro-control/RESULT.md`; not `mvdseek`).
  The doc comment says [[165]] sends seeks only through this function. Test
  `src/shared/replays/demo-control.test.ts` pins the command per format and each target kind.
  Also correct `docs/concepts/demo-browser.md` §6.4 ("seeking uses `mvdseek`" → `seek`, per spike
  133) and mark open point §17.9 decided: launcher does not pick the followed player, Q2PRO's own
  in-game controls (`cmd invnext`/`cmd invprev`/`cmd chase`) switch it, timeline sends `seek`.
  Touches: those three files.
- **D3 — MVD2 detail note.**
  In `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`, when the row's `format` is
  `'mvd2'` (plain or gz), render a short visible text note (`data-testid="demo-detail-mvd2-note"`,
  semantic tokens only, no image) from new key `replays.detail.mvd2Note` in
  `src/renderer/src/i18n/locales/en.json`: "Server-side demo with every player. Q2PRO chooses whom
  the camera follows — switch in game with invnext / invprev or cmd chase <player>." Not shown for
  `.dm2`. Test in `DemoDetailPanel.test.tsx`: present for an mvd2 row (plain and gz), absent for a
  dm2 row. Add a step to `scripts/flows/replays-play-mvd2.mjs` (from D1) asserting the note is
  visible on the selected MVD2 row before Play.
  Touches: those four files.

## Model Hints

All deliverables default tier — small, pattern-following changes on top of 159.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-play-mvd2.mjs` › "an mvd2 and an mvd2.gz play in Q2PRO with +set game and +demo" (D1)
- AC1 → unit 159's play-args test file › "an mvd2 / mvd2.gz keeps its full extension on +demo" (D1)
- AC2 → unit `src/shared/replays/demo-control.test.ts` › "seek command per format: dm2 and mvd2 both send seek" (D2)
- AC3 → unit `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` › "an mvd2 row states who the camera follows; a dm2 row does not" (D3)
- AC3 → e2e `scripts/flows/replays-play-mvd2.mjs` › "the mvd2 detail note is visible" (D3); documented in Decisions (Sprint) + concept §17.9 (D2)
- AC4 → unit 159's Play-availability test file › "an mvd2 on an r1q2 active installation is disabled with the not-Q2PRO reason" (D1)

## Done

Server-side `.mvd2` / `.mvd2.gz` demos play through 159's format-agnostic path (no production change
needed, pinned by tests). One pure `demoSeekCommand(format, target)` sends `seek` for both formats; the
detail panel states, for MVD2 rows, that Q2PRO chooses the followed player. Concept §6.4/§17.9 corrected.

Commit message: `162: mvd2 plays and seeks — play args pinned, demoSeekCommand (seek for dm2+mvd2), MVD2 detail note`

Verification (narrow gate; full regression gate is the sprint's): `npm run build`, `npm run typecheck`,
`npx vitest run --changed HEAD` (101 files / 777 tests), `npm run ui:flow -- replays-play-mvd2` — all green.
AC1 -> flow replays-play-mvd2.mjs + demo-play.test.ts "keeps its full extension"; AC2 -> demo-control.test.ts;
AC3 -> DemoDetailPanel.test.tsx + flow note step; AC4 -> demo-play.test.ts r1q2 case. All passed. No manual residue.
Review (default tier): PASS, no findings.

Decisions:
- In-place play passes `+demo <fileName>` (relative to `demos/`, as 159's own flow asserts), not `demos/<file>`; kept 159's behaviour, full extension retained.
- The fixture MVD2's header names gamedir `opentdm`, so the flow's Q2PRO fixture gains an `opentdm` game dir and asserts `+set game opentdm`.
- The MVD2 note also shows when Play is disabled on r1q2 (it describes Q2PRO behaviour; harmless).
- CHANGELOG entry added under Added.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
