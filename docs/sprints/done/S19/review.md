# Sprint S19 Review — Retail data comes home

## Overview

**Goal.** The bootstrap wizard can produce a real, non-demo installation without the user
downloading anything they already own — copying retail data straight out of a detected
Steam/GOG/Epic installation or out of any folder the user points it at — and an existing demo
installation gets an explicit way out of the demo state.

| Story | Status | Commit |
| --- | --- | --- |
| 088 — Retail import from a detected store installation | done | `2ea394e` |
| 089 — The wizard gains an existing-folder data source | done | `9ae658f` |
| 090 — A demo installation upgrades to retail | done | `d108974` |

All three stories of the sprint are done; nothing is blocked.

## Implemented stories

**088.** The bootstrap wizard's game-data step gained a second source: copy retail
`pak0.pak`/`pak1.pak` (+ `pak2.pak`/`video`/`players` when present) out of a detected Steam/GOG/Epic
installation. Built the reusable core `retail-source.ts` (`inspectRetailSource`,
`listDetectedRetailSources`, `copyRetailGameData`) that both later stories reuse verbatim, and
routed the copy through the wizard's existing allowlist copier so "baseq2 only" is a property of
the code, not a test fixture.

**089.** The wizard's game-data step gained a third, always-offered source: point at an existing
folder. A new `inspectGameDataSource()` classifies the folder's `baseq2/` as retail/demo/unusable
by pak size, and a folder-sourced install proceeds through the same job/copy machinery 088 built,
downloading the engine only. An unusable or target-overlapping folder is refused server-side before
any installation is registered.

**090.** A demo installation now offers an "import retail data" action on every surface the Demo
marker appears on. The action reuses 088's detection/copy functions unchanged, runs as a cancellable
`Job`, refuses while the installation's game is running, and promotes only the two paks via
stage-then-rename so a demo marker can never be left half-cleared by a partial write.

## Findings & decisions (input for future sprint planning)

- **Reuse held across all three stories.** No story wrote a second implementation of the pak-size
  check or copy routine — 089 and 090 both grepped 088's actual (not just planned) exports and
  reconciled against them, exactly as the refine-time reconciliation notes anticipated.
- **088's `BootstrapDataSource` stayed a flat string union**, not the discriminated `{kind:...}`
  object union 089's refine had planned — 088 never built that shape, and forking the type two ways
  for one concept would have been worse than the union 089 originally wanted to avoid. Worth keeping
  in mind for the next story that touches this contract: it's a flat union today, by decision, not
  by accident.
- **Two comparison routines, one constant.** 089's `game-data-source.ts` duplicates a small
  comparison/verdict function (2-way vs 088's 3-way logic) rather than the `RETAIL_PAK_SIZES`
  constant itself — a deliberate call, not an oversight, since the two verdict shapes are genuinely
  different.
- **A real pre-existing bug was found and fixed in 090**, outside its own story's original
  scope: `checkSchema`'s zod severity enum was missing `'info'`, silently wiping an installation's
  entire `checks` array (including `validation.pak0NotRetail`, the demo marker itself) whenever its
  only check was info-severity. Fixed with a regression test.
- **088's F6 (pre-existing 074 double-copy on the toggle-on extras pass) is still open.** 090
  confirmed it is unreachable from the upgrade action's own code path (which never calls
  `startBootstrap`), so it was correctly left out of 090's scope — but the bug itself remains in
  `bootstrap/job.ts` and is worth a follow-up story if the extras toggle sees more use.
- **Two low-severity gaps accepted, not fixed, in 090:** no guard stops launching a game while an
  upgrade job is copying into its folder (INST-J7's wait-then-continue machinery doesn't exist yet,
  out of scope by design); and a rename failure between the two paks could theoretically leave
  `pak0.pak` promoted but not `pak1.pak`, with no in-app retry surface — accepted as a narrow,
  low-probability window rather than building transactional two-file promotion.
- **Minor unused-type residue from 089:** `GameDataSourceUnusableReasonKey`'s union/array is unused
  today because `GameDataSourceVerdict.reason` stayed a plain `string`; no user-facing effect, worth
  tightening if a later story does main→renderer reason-key typing work generally.

## Blocked / open

None — no story was blocked, and the refine phase's clarification round closed all deliberately
open decisions before build started.

## Acceptance

Acceptance is the test suite; every criterion below was proven by an automated test, all through
the real surface (`npm run ui:verify` / `npm run ui:flow`) where the criterion described something
a user does.

**088.**
- AC1, AC2, AC3 — `scripts/flows/bootstrap-retail-import.mjs` (both option-present and
  option-absent halves) + `retail-source.test.ts`.
- AC4 — `bootstrap-retail-import.mjs` (on-disk byte comparison) + `retail-source.test.ts` +
  `job.test.ts`.
- AC5, AC6 — `bootstrap-retail-import.mjs` + `job.test.ts`.
- AC7 — `assemble.test.ts` + the e2e's on-disk directory assertion.

**089.**
- AC1, AC2, AC3, AC6, AC7 — `scripts/flows/bootstrap-existing-folder.mjs`.
- AC4, AC5 — `scripts/flows/bootstrap-existing-folder-demo.mjs`.

**090.**
- AC1 — `scripts/flows/retail-upgrade.mjs` (all three trigger surfaces).
- AC2 — `retail-upgrade.mjs` + `retail/sources.test.ts`.
- AC3 — `retail-upgrade.mjs` (empty-state, no picker shown).
- AC4 — `upgrade-job.test.ts` (full before/after file snapshot) + e2e on-disk byte comparison.
- AC5 — `retail-upgrade.mjs` (marker gone from all 3 surfaces) + `upgrade-job.test.ts`.
- AC6 — `upgrade-job.test.ts` (rejected before `jobs.create`) + e2e reason display.
- AC7 — `retail-upgrade.mjs` (via the new dev-only `dev:simulateLaunch` channel) +
  `upgrade-job.test.ts`.

**Manual residue: none.** All three stories declared zero manual residue — every criterion has a
passing automated test, and none needed an OS dialog, specific hardware or paid external service to
prove. `testplan.md` is not written for this sprint (per `testplan: optional` in the profile).
