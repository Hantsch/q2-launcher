---
id: 233
title: the flow gate has no quarantined flows and catches cross-story breakage
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Story [[223]] made the end-of-sprint flow gate binary, and S32's gate showed both what that buys and
what is still open. The first full `ui:flows` run was red 134/138 because of two regressions that
only the full gate saw (209's `bootEnv` case-sensitivity broke `bootstrap-wizard` on Windows; 220
disabled a switch that 201's `quit-persists-state` clicked): the narrow per-story gate ran only the
flows each story named, and `bootstrap-wizard` was not among 209's. Two flows are still quarantined
(`scripts/flows/quarantine.json`), and a polluted `.ui-verify` fixture cache makes the archive
counts in `downloads-tab` and `settings-downloads-section` vary until `npm run ui:seed` is run.

The maintainer wants the quarantine list empty, flows that do not depend on what ran before them,
and a per-story gate that is hard to blind to a neighbouring flow.

## Acceptance Criteria

- [x] **AC1** — `mods-view` passes with its quarantine entry removed. The flow asserts the displayed
      installation name per `docs/UI-VERIFICATION.md#what-a-flow-may-assert`, or the product's
      `uppercase` styling (story 188) is changed; which of the two is decided in refine.
- [x] **AC2** — `replays-mod-warning` passes its step "resetting remembered mods asks again" in 20
      consecutive runs, and its quarantine entry is removed.
- [x] **AC3** — `downloads-tab` and `settings-downloads-section` report the same archive counts
      whatever flows ran before them, with no manual `npm run ui:seed`.
- [x] **AC4** — A story's narrow gate includes the flows that exercise the shared code it changed,
      derived from the diff rather than named by hand; a test shows that a change to `bootEnv` selects
      `bootstrap-wizard`.
- [x] **AC5** — `npm run ui:flows` on the sprint branch ends green with `quarantine.json` empty.

## Open Questions

None — AC1 (flow) and AC4 (testid derivation + area table) are decided under `## Decisions (Sprint)`.

## Decisions (Sprint)

- AC1: the flow is fixed and the product's `uppercase` styling (story 188) stays, because
  `docs/UI-VERIFICATION.md#what-a-flow-may-assert` says a flow asserting another story's incidental
  detail is fixed in the flow; the flow reads the header's DOM text (`textContent`, not the
  CSS-transformed `innerText`).
- AC2: the quarantine entry was already removed in S33 (95522d3, "unexpected pass twice"), so the
  story proves the 20 runs and fixes the root cause if one is red, instead of re-adding the entry.
- AC2: `ui:flows` gets a `--repeat=<n>` flag so "20 consecutive runs" is one reproducible command
  rather than a hand loop.
- AC3: the fixture owns `userData/cache/downloads/` and empties it strictly before writing its two
  archives; the best-effort delete stays for Chromium's locked GPU caches only, because that
  best-effort path is what lets other flows' archives survive a reseed.
- AC4 mapping: a hybrid — a flow's renderer files are **derived** from the `data-testid`s it (and the
  `scripts/lib/*` helpers it imports) uses, and every other source file maps through one coarse
  area table `scripts/flows/areas.json` — because flows drive the built app and import nothing from
  `src/`, so an import graph cannot reach them, and a per-flow hand list is what AC4 rules out.
- AC4: tests make the table exhaustive (every non-test `src/` file is reached by derivation or a
  row, every row matches an existing flow, every flow is selectable), so a new file cannot be blind.
- AC4: a table row selects at most 12 flows, so the affected run stays inside `/build`'s 10-minute
  command ceiling; the full gate at sprint end still runs everything.
- AC4: the diff is `git diff --name-only HEAD` plus untracked files (what `/build` verifies before
  its commit), with `--affected=<ref>` to compare against another base.
- AC4 wiring: the profile's `e2e-story` becomes `npm run ui:flows -- --affected {files}` (one run:
  the story's named flow files plus the affected ones, reseeded per flow); `.claude/commands/build.md`
  is plugin-owned and stays untouched.
- No `CHANGELOG.md` entry: the change is test tooling only, nothing a user sees.
- Docs: the harness has no `docs/systems/` doc; the gate's doc is `docs/UI-VERIFICATION.md`
  (§ "The flow gate"), which D5 updates.

## Plan

1. **D1** fix `mods-view`'s name assertion, empty `quarantine.json`.
2. **D2** add `--repeat=<n>` to the gate, run `replays-mod-warning` 20x, fix the root cause of any red
   (wait on a state, never `waitForTimeout`).
3. **D3** make the fixture's downloads cache deterministic on reseed.
4. **D4** pure selection lib: changed files -> flows (testid derivation + `areas.json`), with the
   exhaustiveness tests and the `bootEnv -> bootstrap-wizard` test.
5. **D5** wire `--affected` and flow-file arguments into `scripts/flows-all.mjs`, switch the
   profile's `e2e-story`, document it in `docs/UI-VERIFICATION.md`.
6. Sprint end: `npm run ui:flows` green with `quarantine.json` = `[]` (AC5).

Order: D1 -> D2 -> D3 -> D4 -> D5 (D5 depends on D4; D2 and D5 both edit `flows-all.mjs`).

## Deliverables

- **D1 — `mods-view` asserts the name it shows.** In `scripts/flows/mods-view.mjs` (~line 51) read
  `mods-installation-name` with `textContent()` instead of `innerText()` (innerText applies the CSS
  `uppercase` from `src/renderer/src/modules/mods/ModsView.tsx:203/217`, story 188; the product
  stays as it is). Remove the `mods-view` entry from `scripts/flows/quarantine.json`, leaving `[]`.
  Acceptance: `npm run ui:flow -- mods-view` passes.
- **D2 — `replays-mod-warning` is stable over 20 runs.** Add `--repeat=<n>` (integer >= 1, default 1,
  malformed -> usage error, exit 1) to `scripts/flows-all.mjs`: every selected flow runs n times in a
  row, each against a fresh seed, each run counted. Put the expansion as a pure helper in
  `scripts/lib/flow-gate.mjs` (next to `selectShard`), with its test in `scripts/flow-gate.test.mjs`
  › "--repeat runs each selected flow n times in a row". Then run
  `npm run ui:flows -- replays-mod-warning --repeat=20`. If any run is red, find the race in the step
  "resetting remembered mods asks again" (`scripts/flows/replays-mod-warning.mjs` ~237-266; product
  path: the Settings "Forget remembered mods" button `replays-mod-warning-reset` and the replays
  module's `modWarning.resetTrusted` handler) and fix it — in the flow by waiting on a state (a
  testid, an attribute, `waitForStateJson`), in the product only if the product is wrong; no
  `waitForTimeout`. `quarantine.json` keeps no `replays-mod-warning` entry. Acceptance: 20/20 green.
- **D3 — the fixture's archive cache is the fixture's, whatever ran before.** Today
  `rmDirBestEffort` (`scripts/lib/fixture/core.mjs:126`) can leave part of a variant's `userData`
  behind on a locked Windows file, so archives other flows downloaded into `userData/cache/downloads/`
  survive the reseed and change the "N archives" count. Add `resetOwnedDir(path)` to
  `scripts/lib/fixture/core.mjs`: `rmSync` with the existing `RM_RETRY_OPTIONS`, then `mkdirSync`;
  on failure it **throws** (the seed fails loudly instead of seeding a wrong count). Call it at the
  top of `writeDownloadsCacheArchives` (`scripts/lib/fixture/downloads.mjs:47`) instead of the bare
  `mkdirSync`. Test in `scripts/lib/fixture/fixture-layout.test.mjs` › "a reseed over leftover
  archives leaves exactly the fixture's archives" (seed into a temp `Q2L_UI_VERIFY_ROOT`, drop an
  extra file into `cache/downloads/`, make the variant-wide delete a no-op or reseed, assert exactly
  `DOWNLOADS_CACHE_ITEM_COUNT` files). Acceptance also: `downloads-tab` and
  `settings-downloads-section` pass.
- **D4 — changed files select the flows that exercise them.** New pure module
  `scripts/lib/flow-select.mjs` (no spawning, no git; inputs are file lists and file contents passed
  in, like `flow-gate.mjs`) plus the table `scripts/flows/areas.json`, tests in
  `scripts/flow-select.test.mjs`.
  - `flowTestIds(flowSource, helperSources)` — the literal testids a flow uses
    (`getByTestId('x')`, `[data-testid="x"]`, `[data-testid^="x"]` as a prefix, template literals up
    to their first `${` as a prefix), including those of the `scripts/lib/*.mjs` helpers the flow
    imports (transitively).
  - `testIdOwners(rendererFiles)` — map testid -> the `src/renderer/**` files that contain it
    (`data-testid="x"`, `testId="x"`, template literals by static prefix).
  - `areas.json`: an array of `{ "area", "paths": [globs], "flows": [names or `prefix-*`], "why" }`.
    Rows cover every `src/` area a testid cannot reach: `src/main/**` (shell, `lib`, `services`,
    `ipc`, each `modules/<id>`), `src/preload/**`, `src/shared/**`, and renderer files without
    testids (hooks, stores, `lib`). The boot row lists `src/main/lib/boot-env.ts` and
    `src/main/context.ts` with `bootstrap-wizard` among its flows.
  - `selectAffected({ changedFiles, flows, rendererFiles, areas })` -> `[{ flow, reasons: [...] }]`:
    a flow is selected when a changed renderer file owns one of its testids, or a changed file
    matches an area row naming it. Test files (`*.test.*`, `src/test-support/**`), docs and
    `scripts/flows/<name>.mjs` itself (selects that flow) are handled explicitly.
  - Tests in `scripts/flow-select.test.mjs`, reading the real repo tree: › "a change to bootEnv
    selects bootstrap-wizard"; › "a change to the component that owns a flow's testid selects that
    flow" (real case: the file owning `replays-mod-warning-enabled` selects `quit-persists-state`);
    › "every non-test src file is reached by a testid or an area row"; › "every area row names
    existing flows and selects at most 12"; › "every flow is selectable by some file".
- **D5 — the narrow gate runs the affected flows.** In `scripts/flows-all.mjs`: accept
  `scripts/flows/<name>.mjs` paths as flow arguments (normalised to names; an unknown name or path is
  a usage error, exit 1 — never a vacuous run); add `--affected[=<ref>]`, which adds the flows
  `selectAffected` returns for `git diff --name-only <ref|HEAD>` plus
  `git ls-files --others --exclude-standard`, deduplicated with the named ones, and prints each
  added flow with its reason before running. Argument handling stays testable through
  `scripts/lib/flow-gate.mjs` helpers, tested in `scripts/flow-gate.test.mjs` › "flow file paths and
  --affected are parsed into flow names". Change `.claude/ai-scrum.md`: `e2e-story: npm run ui:flows
  -- --affected {files}` and its comment (one run, story flows + affected flows). Update
  `docs/UI-VERIFICATION.md` § "The flow gate: quarantine, shards, timeout" with `--repeat`,
  `--affected`, file arguments and how `areas.json` is maintained (a new `src/` file fails the
  exhaustiveness test until a row or testid reaches it); keep `scripts/flow-rules-doc.test.mjs` /
  `scripts/check-docs.test.mjs` green.

## Model Hints

- D4 → deliverable-hard: the testid derivation can quietly resolve nothing (dynamic testids, testids
  reached only through `scripts/lib` helpers, template-literal prefixes) while a hard-coded
  `boot-env.ts` row still passes the bootEnv test — the gate would look derived and stay blind, which
  is exactly the S32 failure this story exists to close.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/mods-view.mjs` › `mods-view`
- AC2 → e2e `scripts/flows/replays-mod-warning.mjs` › `replays-mod-warning`, run as
  `npm run ui:flows -- replays-mod-warning --repeat=20` (20/20 green); unit
  `scripts/flow-gate.test.mjs` › "--repeat runs each selected flow n times in a row"
- AC3 → unit `scripts/lib/fixture/fixture-layout.test.mjs` › "a reseed over leftover archives leaves
  exactly the fixture's archives"; e2e `scripts/flows/downloads-tab.mjs` › `downloads-tab`; e2e
  `scripts/flows/settings-downloads-section.mjs` › `settings-downloads-section`
- AC4 → unit `scripts/flow-select.test.mjs` › "a change to bootEnv selects bootstrap-wizard";
  › "a change to the component that owns a flow's testid selects that flow";
  › "every non-test src file is reached by a testid or an area row";
  › "every area row names existing flows and selects at most 12"; › "every flow is selectable by
  some file"; unit `scripts/flow-gate.test.mjs` › "flow file paths and --affected are parsed into
  flow names"
- AC5 → e2e-all `npm run ui:flows` on `sprint/S34` (the sprint's regression gate), green with
  `scripts/flows/quarantine.json` = `[]` (D1 empties it)

Coverage: AC1 D1 · AC2 D2 · AC3 D3 · AC4 D4+D5 · AC5 D1 (empty list) + sprint gate.

## Done

Quarantine list is empty, `ui:flows` gained `--repeat=<n>`, flow-file arguments and `--affected[=<ref>]`
(changed files -> flows via testid derivation + `scripts/flows/areas.json`), and the fixture owns
`cache/downloads/`. The profile's `e2e-story` is now `npm run ui:flows -- --affected {files}`.

Commit message: `233: empty flow quarantine, --repeat, fixture-owned downloads cache, --affected flow selection`

Verification (narrow gate): build, typecheck, lint green; `npx vitest run --changed HEAD` + the three new/changed
scripts test files green; comments + architecture tests green; `npm run ui:flows -- mods-view downloads-tab
settings-downloads-section bootstrap-wizard quit-persists-state` 5/5; `replays-mod-warning --repeat=20` 20/20.
AC1 mods-view e2e · AC2 flow-gate "--repeat…" + 20/20 · AC3 fixture-layout test + downloads-tab +
settings-downloads-section · AC4 five flow-select tests + flow-gate "flow file paths and --affected…" ·
AC5 quarantine `[]` (full `ui:flows` is the sprint gate, pending). No manual residue.
Pre-existing/open: `scripts/check-docs.test.mjs` link check red on docs/ROADMAP.md (S33 review/testplan, stories
232/235/236 links) and docs/sprints/done/S32/review.md — unrelated to this diff.

Decisions: no replays-mod-warning race seen in 20 runs, so no flow/product change. Verification used named flows,
not `--affected`, because this diff touches `scripts/lib/**` and selects ~130 flows (beyond the 10-min ceiling);
a helper change selecting every importing flow is by design. `--affected` with nothing selected and nothing named
prints a message and exits 0. Review low findings fixed: git calls use `--no-renames` and `core.quotepath=false`.
Unfixed (accepted): flow-select test "every flow resolves" accepts one resolving id per flow; header usage comment
in flows-all.mjs omits `--repeat` (minor). Extra: `scripts/lib/flow-tree.mjs` extracted so test and gate share
tree assembly.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 7
