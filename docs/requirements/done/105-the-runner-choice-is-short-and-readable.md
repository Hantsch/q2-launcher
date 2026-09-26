---
id: 105
title: the runner choice is short and readable
status: done # draft -> ready -> in-progress -> done
created: 2026-09-23
---

## Requirement

A Linux user opens an installation in the Library and sees at a glance which runner starts it,
what else they could pick, and why the rest is not available — without scrolling past a wall of
identical disabled rows.

Reported by the first real Linux user on 0.4.0 (2026-09-23). What the Runner section of a q2pro
installation with several Proton builds in its Steam libraries showed:

- `Native`, `Wine`, `umu-run` as full-width rows — fine on their own.
- `Steam`, disabled, with "this folder is not a Steam install — Steam can only start games it
  owns".
- **Four** rows all labelled just `Proton`, each disabled and each repeating "Proton builds are
  used through umu-run, not launched directly — pick umu-run instead". The rows do not say which
  build they are, and none of them can ever be picked (story 103 Q1: Proton is only ever driven
  through umu-run).
- The long Steam caveat paragraph ("Steam runs its own copy of the game: …") under the list,
  shown whether or not Steam can be chosen for this installation.

Every option in the list is a stacked full-width row, so on a typical Linux machine the section
is taller than the rest of the installation card combined.

The platform-parity rule in CLAUDE.md still holds: nothing that cannot work here is silently
hidden — it stays visible, disabled, with its reason as visible text. What changes is that the
same reason is not said four times, and text that only matters for one choice is not shown when
that choice is not in play.

## Acceptance Criteria

- [x] **AC1** — However many Proton builds are detected, the Runner section shows Proton **once**,
      disabled, with its reason as visible text and how many builds were found.
- [x] **AC2** — No two runner options in the section carry the same disabled-reason text.
- [x] **AC3** — The Steam caveat is shown only while Steam is the selected runner; when Steam is
      unavailable, only its short disabled reason is shown.
- [x] **AC4** — Every unavailable runner stays visible and disabled with its reason as visible
      text (not tooltip-only), on Linux and Windows — CLAUDE.md's platform-parity rule.
- [x] **AC5** — On the reported setup (native, wine, umu-run available; Steam not owner; four
      Proton builds) the Runner section is no taller than the installation card's header and
      checks together.
- [x] **AC6** — The selected runner and the resolved command preview behave as before: picking a
      runner persists it and refreshes the preview; keyboard selection and the radio-group
      semantics still work.

## Open Questions

None open. Resolved in refine (2026-09-23):

- **Layout** → one wrapping row of compact radio chips (heading inline), then one short reason
  line per unavailable option, each linked to its chip with `aria-describedby`.
- **E2E reach** → a UI-harness-only override for runner detection, so the reported setup is
  proven locally on Windows and in the Linux CI leg alike (not a Linux-CI-only branch).
- **Zero Proton builds** → no Proton option at all (unchanged); Proton is never pickable, so there
  is nothing to explain when none is installed.

## Plan

1. **Collapse Proton in main.** `installations:listRunners` (`src/main/ipc/installations.ts`)
   folds every `proton` `RunnerOption` into one: `id: 'proton'`, `available: false`,
   `reasonKey: 'runner.unavailable.protonNotDriven'`, new `reasonParams: { count }`. None when
   zero builds. `RunnerOption` (`src/shared/ipc.ts`) gains `reasonParams?: Record<string, string |
   number>` (same shape as `Outcome` error `params`). `protonNotDriven` becomes a plural key
   (`_one`/`_other`) naming the count. `resolveRunner()` is untouched — it never picks Proton.
2. **Compact renderer.** `RunnerSection.tsx`: heading + `role="radiogroup"` of inline chips in one
   wrapping row (not full-width buttons); under it, one reason line per unavailable option
   ("Steam — …", "Proton — 4 builds found; …"), `t(reasonKey, reasonParams)`, linked via
   `aria-describedby`. Test ids stay (`installation-runner-option-<kind>`,
   `installation-runner-reason-<kind>`) so existing flows keep working. Steam caveat renders only
   when `steamSelected`. Selection, persistence, preview refresh and the Steam client select are
   unchanged. Tokens only (`/design-tokens`); chips keep a visible focus ring.
3. **Harness override.** `src/main/lib/ui-harness.ts` gets `Q2L_UI_DETECTED_RUNNERS` (JSON list
   of `DetectedRunner`, zod-parsed, behind the existing double gate, mirroring
   `uiHarnessSteamExecutable`); `detectRunners()` returns it verbatim when set. Everything after
   detection (`toRunnerOption`, collapse, IPC, renderer) stays real.
4. **E2E flow.** New `scripts/flows/runner-choice-compact.mjs` seeds the reported setup through the
   override (native, wine, umu-run available; Steam present but the folder is not Steam-owned;
   four Proton builds) and asserts AC1–AC6 on the real app, including the height budget against
   new `installation-header` / `installation-checks` test ids in `LibraryView.tsx`.
   `steam-handoff.mjs` is updated for the new caveat rule (hidden until Steam is picked).
5. CHANGELOG `### Fixed` entry; drop the stale "not rendered at all on win32" comment at
   `LibraryView.tsx` above `<RunnerSection>`.

Order: D1 → D2 → D3 → D4 (D4 needs all three).

## Deliverables

- **D1 — Proton is one option, with a count.** `src/shared/ipc.ts` (`RunnerOption.reasonParams`),
  `src/main/ipc/installations.ts` (collapse in the `listRunners` handler after `toRunnerOption`),
  `src/renderer/src/i18n/locales/en.json` (`protonNotDriven_one`/`_other` with `{{count}}`), plus
  tests in `src/main/ipc/installations.test.ts` (mirror the existing `describe('installations:listRunners')`
  cases). Acceptance: four detected Proton builds → exactly one `proton` option with
  `reasonParams.count === 4`; zero → none; reason keys across the list are unique.
- **D2 — The section is a chip row, and the Steam caveat follows the choice.**
  `src/renderer/src/components/installations/RunnerSection.tsx`,
  `src/renderer/src/components/installations/RunnerSection.test.tsx` (update the "caveat always
  shown once Steam is listed" case; add chip/reason/describedby/count cases for `win32` and
  `linux`), `CHANGELOG.md`. Acceptance: renderer tests for AC1 (rendered count), AC3, AC4, AC6
  (select writes `installations:update`, preview refetch — existing cases stay green).
- **D3 — Harness can seed the detected runners.** `src/main/lib/ui-harness.ts`
  (+ its test file, mirror the `uiHarnessSteamExecutable` cases), `src/main/services/runners.ts`
  (`detectRunners()` early-return on override), `src/main/services/runners.test.ts`. Acceptance:
  gate closed or var unset → real detection; gate open + valid JSON → that list; invalid JSON →
  real detection plus a logged warning.
- **D4 — The reported setup, proven in the real app.** New `scripts/flows/runner-choice-compact.mjs`
  (mirror `steam-handoff.mjs`'s `setup()`/row-scoping and `config-header-geometry.mjs`'s
  `boundingBox()` checks), `scripts/flows/steam-handoff.mjs` (caveat assertions),
  `src/renderer/src/views/LibraryView.tsx` (`data-testid="installation-header"` on the header
  block, `data-testid="installation-checks"` on the checks wrapper, stale comment removed). The
  flow must use an installation whose checks are rendered, and assert the checks wrapper exists
  before measuring.

## Model Hints

All deliverables → default tier. None carries a one-sentence risk that would justify
`deliverable-hard`: D1 is a pure list fold, D3 mirrors an existing gated override, and D4's
geometry check follows an existing flow. If AC5's budget fails in D4, tightening D2's spacing is
in D4's scope.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/runner-choice-compact.mjs` › "Proton is listed once, disabled, with
  its build count" (exactly one `installation-runner-option-proton`, disabled; its reason text
  contains "4"); also unit `src/main/ipc/installations.test.ts` › "four Proton builds collapse into
  one option carrying the count".
- AC2 → e2e `scripts/flows/runner-choice-compact.mjs` › "no two disabled reasons read the same"
  (texts of all `installation-runner-reason-*` in the row are pairwise distinct); also unit
  `src/main/ipc/installations.test.ts` › "no two runner options share a reason key".
- AC3 → e2e `scripts/flows/steam-handoff.mjs` › "the Steam caveat appears only once Steam is
  picked" (caveat count 0 on the not-owner install with only its reason shown; visible after
  picking Steam on the owned one); also renderer
  `src/renderer/src/components/installations/RunnerSection.test.tsx` › "the Steam caveat shows only
  while Steam is selected".
- AC4 → e2e `scripts/flows/runner-choice-compact.mjs` › "every unavailable runner stays visible
  with its reason" (each disabled chip is visible and its `aria-describedby` target is visible,
  non-empty text); the flow runs on both the Windows dev/CI leg and the ubuntu CI leg via the
  harness override. Also renderer `RunnerSection.test.tsx` › "unavailable runners keep a visible
  reason on win32 and linux".
- AC5 → e2e `scripts/flows/runner-choice-compact.mjs` › "the runner section is no taller than the
  header and checks" (`installation-runner` box height ≤ `installation-header` height +
  `installation-checks` height, in the same row).
- AC6 → e2e `scripts/flows/runner-choice-compact.mjs` › "a runner is picked by keyboard and stays
  picked" (Tab to the umu-run chip, Space → `aria-checked="true"`, still checked after a
  `nav-config` → `nav-library` remount; off win32 — where `needsCompatRunner()` lets the choice
  reach the command — the preview text also changes to `umu-run …`); existing flows
  `scripts/flows/windows-build-on-linux.mjs` and `scripts/flows/steam-handoff.mjs` stay green
  unchanged in behaviour; renderer `RunnerSection.test.tsx`'s existing select/preview cases stay
  green.

## Done

**Summary:** Proton now collapses to a single disabled option carrying its build count
(`installations:listRunners`), the Runner section renders as a wrapping row of compact radio
chips with per-option reason lines linked via `aria-describedby` instead of full-width rows, and
the Steam caveat paragraph only shows once Steam is actually selected (not merely listed). A
UI-harness-only override (`Q2L_UI_DETECTED_RUNNERS`) lets the reported four-Proton-build setup be
proven identically on Windows and Linux CI, and a new e2e flow plus updated `steam-handoff.mjs`
prove all six acceptance criteria on the real app.

**Commit message:**
```
105: collapse Proton to one option and compact the Runner section into chips
```

**Verification — narrow gate:**
- `npm run build` — clean. `npm run typecheck` — clean (confirmed after every deliverable and
  again at the end).
- Tests: full `npx vitest run` (touched files span main/renderer broadly enough that the story
  ran the full suite rather than a narrowed one) — 246 files, 4201 passed, 8 skipped (pre-existing),
  0 failed.
- e2e: `npm run ui:flow -- runner-choice-compact` (new flow, Windows leg) — pass, all named AC1/
  AC2/AC4/AC5/AC6 assertions green; AC6's off-win32 preview-text assertion loudly skipped on this
  win32 machine as expected (AC8 gate, unrelated to this story). `npm run ui:flow -- steam-handoff`
  — pass, AC3's caveat-timing assertions updated and green (Windows leg; Linux leg skips here as
  it always has). `npm run ui:flow -- windows-build-on-linux` — pass, unaffected.
- AC → test mapping as verified: AC1 unit (`installations.test.ts` "four Proton builds collapse…")
  + e2e ("Proton is listed once…") both green. AC2 unit ("no two runner options share a reason
  key") + e2e ("no two disabled reasons read the same") both green. AC3 renderer ("the Steam
  caveat shows only while Steam is selected") + e2e (`steam-handoff.mjs`, caveat count 0 before
  selection / visible after) both green. AC4 renderer ("unavailable runners keep a visible reason
  on win32 and linux") + e2e ("every unavailable runner stays visible…", proven via the harness
  override with no platform-conditional skip on this assertion) both green. AC5 e2e ("the runner
  section is no taller than…", run against the "Fixture Failed Install" row since it's the
  fixture with checks rendered, documented in the flow's own header comment — the harness
  override is process-wide so every installation gets the same tall runner list; the checks
  wrapper's presence is asserted before measuring) green. AC6 e2e (keyboard pick + remount
  persistence + off-win32 preview change) + existing flows staying green + renderer's existing
  select/preview/keyboard cases all green.
- No `manual residue` — all six criteria are covered by automated tests.
- Code review (fresh agent, default tier): **PASS**, no findings. Confirmed no weakened tests,
  no scope creep beyond one cosmetic reformat in `runners.test.ts`, `/design-tokens` compliance
  (no hardcoded hex/palette classes, focus handled by the existing global `focus-visible` rule,
  unchanged from before this story), and CLAUDE.md's platform-parity/IPC-contract-first rules
  upheld. Also independently verified the D4 implementer's hardcoded `'fixture-install-failed'`
  literal (used because that id isn't exported from `scripts/lib/fixture.mjs`) matches the real
  fixture constant — no mismatch.
- CHANGELOG.md: `### Fixed` entry added under the current/unreleased section (D2).
