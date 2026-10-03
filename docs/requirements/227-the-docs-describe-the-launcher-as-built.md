---
id: 227
title: the docs describe the launcher as built
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer, and as every agent that reads CLAUDE.md and docs/ARCHITECTURE.md before a
task, I want those files to describe the launcher that exists — eight modules, the module bus,
jobs, persisted state per module, the harness, shutdown, errors and logging, renderer state and
placement rules — and the "Adding a module" checklist to be the real step list, so that a wrong
checklist cannot cost another rediscovery and a stale status line cannot invite re-scaffolding.
And I want a test that catches the next drift.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F23, F33, F51, F60, F61,
F66, F73; partly a roadmap follow-up since S22): CLAUDE.md line 9 says "config/download/mods/asset
modules are scaffolded but not implemented" after 197 stories and 0.6.0; CLAUDE.md and
CONTRIBUTING.md name an `install`/`assets` module that does not exist; docs/ARCHITECTURE.md says
"four planned modules", "No module produces jobs yet", "`MIGRATIONS` is empty at v1", documents
the cast-based bus as design, and its 5-step checklist omits the `moduleId` enum, the state slot
and the layering allowlist; README says 0.3.0 and "Servers (next release)"; `ipc-schemas.ts`'s
header still says the schemas are "exported-but-unused by design"; 12 roadmap links and 7 systems
links are broken. There is no written error-handling or logging policy (114 bare catches, warn
211x vs error 48x), no renderer state rule (five stores, five contexts), no placement rule inside
renderer modules, and no comment convention. The CLAUDE.md deviations table repeats one 44px
rule in 15 near-identical rows (~550 characters each) that every agent reads on every task. The
story and sprint templates cite `tests/e2e/*.spec.ts` paths that do not exist and lack the
`## Decisions (Sprint)` and `## Regression gate` sections 176 of 195 stories carry.

## Acceptance Criteria

- [ ] **AC1** — docs/ARCHITECTURE.md has a "Modules as built" section (the eight modules, the
      module bus and its contract after stories 204–205, jobs and the runner, per-module persisted
      state, features/unlock, protocol handler, harness, main-window observer, shutdown order) and
      an "Adding a module" checklist verified by walking `replays`: contract type, `ModuleId` +
      manifest, state slot, main and renderer index, i18n, flows/screen registry, `Outcome`
      return rule, dispose, docs touch. Sentences the review listed as false are gone.
- [ ] **AC2** — docs/ARCHITECTURE.md gains three short sections: "Errors and logging"
      (`Outcome` for expected failures, throw for bugs, a bare catch names the swallowed class in
      a comment, level definitions, always pass the `Error`, no secrets or user paths at
      `info`), "Renderer state" (main-owned data → query hook or mirror; cross-view → module
      store; subtree → context; else component state), and "Inside a renderer module" (View +
      tabs at root, `components/`, `dialogs/`, `hooks/` camelCase, `lib/` React-free). A
      `log.caught(message, error)` helper exists on `scopedLogger`.
- [ ] **AC3** — CLAUDE.md's status line, module names and link targets are correct; the 15
      `/design-tokens` 44px rows collapse into one project-wide deviation (desktop,
      mouse-and-keyboard only; floors 28px dense controls, 24px in-row selects; below 24px needs
      its own row) plus a short bullet list of the sub-28 cases; CLAUDE.md gains a one-paragraph
      comment convention (state the invariant or the non-obvious why; a story pointer only as a
      trailing `(story 052)`; never review-round narrative; deliverable/AC ids never in code).
- [ ] **AC4** — README's version and status match `package.json` and the roadmap;
      `ipc-schemas.ts`'s header is current; the templates under `docs/requirements` and
      `docs/sprints/_TEMPLATE` carry the real test paths and the `Decisions (Sprint)` /
      `Regression gate` sections (via the project-specific block `/ai-scrum:setup` preserves).
- [ ] **AC5** — `scripts/check-docs.mjs` runs in `npm test`: every relative `.md` link in
      CLAUDE.md, README.md, CONTRIBUTING.md and `docs/**` resolves, and the README version equals
      `package.json`'s; it is red before this story and green after.

## Decisions (Sprint)

- **(User)** Q1: Write the target state now with a "planned in story NNN" marker; each story removes its marker.
- Markers only for stories still open at build time: 201/204/205/207/219 are already in `done/`,
  so their sections are written as plain fact; a test fails on a marker whose story is done,
  because that is the drift Q1 wants each story to clean up.
- `check-docs` checks the whole of `docs/**` including `requirements/done/` and `sprints/done/`,
  because AC5 says `docs/**` and 104 of today's 132 broken links are archive links nobody fixes.
- `check-docs --fix` rewrites a broken link to the single repo file whose path ends with the
  link's trailing segments (ambiguous or none → reported, fixed by hand), because files moving into
  `done/` is the recurring cause and must stay a one-command repair.
- Only `.md` targets, outside code spans and fenced blocks, are checked; anchors are not, because
  the AC names files and anchor slugging would add a second fragile rule.
- The README version is read from its `**Status: … (x.y.z)**` line and must equal `package.json`.
- The story/sprint `_TEMPLATE` files are plugin-generated and overwritten by `/ai-scrum:setup`;
  they already carry `## Decisions (Sprint)` / `## Regression gate` (ai-scrum 4.5.0), so the real
  test paths go into `docs/README.md`'s `## Project-specific` section — the one block setup
  preserves — and the templates are only checked, not edited.
- `log.caught(message, error)` logs at `warn` with the `Error` object as last argument, because a
  caught-and-handled failure is "degraded but handled", the policy's definition of `warn`.
- The 114 existing bare catches are not migrated here; the policy and helper exist, the sweep is
  story 230's file-by-file pass, so this story stays docs-sized.
- The ModuleId list has eight ids (`assets` still planned); "eight modules" in the docs means
  seven built plus `assets` shown as planned, because that is what `MODULE_MANIFESTS` ships.
- The comment block in `src/shared/types/module.ts` that repeats the 5-step checklist is replaced
  by a pointer to `docs/ARCHITECTURE.md#adding-a-module`, so the checklist has one home.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Which sections wait for the refactoring they describe (204/205 bus, 207 state,
      219 jobs, 201 shutdown) and which are written now as the target state with a "planned in
      story NNN" marker? Recommendation: write the target state now, mark it, and let each story
      remove its marker.

## Plan

Docs-only story plus one logger helper and one checker script. Order: guard first, then content.

1. **D1** — `scripts/check-docs.mjs` (link + version checker, `--fix` mode) with fixture tests.
2. **D2** — run `--fix` over the repo (132 broken links today: archives, ROADMAP, systems), hand-fix
   the rest, correct README version/status; a repo-wide test goes green.
3. **D3** — ARCHITECTURE.md "Modules as built" + the real "Adding a module" checklist, walked on
   `replays`; false sentences gone; extend `architecture-doc.test.ts`.
4. **D4** — ARCHITECTURE.md "Errors and logging", "Renderer state", "Inside a renderer module";
   `log.caught` on `scopedLogger`.
5. **D5** — CLAUDE.md (status, module names, links, one 44px deviation, comment convention),
   CONTRIBUTING.md, `ipc-schemas.ts` header, test paths in `docs/README.md` `## Project-specific`.

Facts gathered in refine (for the Ds): `ModuleId` = home, library, config, downloads, mods, assets
(planned), servers, replays (`src/shared/types/module.ts`). Logger: `src/main/lib/logger.ts`
(`scopedLogger` returns `log.scope`). Existing doc test: `src/main/modules/architecture-doc.test.ts`.
`npm test` = `vitest run`, which already includes `scripts/**/*.test.mjs`.

## Deliverables

- [ ] **D1 — the docs checker exists.** New `scripts/check-docs.mjs` exporting
      `checkDocs(root)` → `{ brokenLinks: [{ file, target }], versionMismatch: null | { readme, pkg } }`
      and `fixDocs(root)`; CLI `node scripts/check-docs.mjs [--fix]` prints findings, exits 1 if
      any. Scope: `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, every `docs/**/*.md`. A link is
      `](target)` whose target is relative (no scheme, not `#…`) and ends in `.md` after stripping
      `#anchor`; links inside fenced blocks and inline code spans are ignored; the target resolves
      against the linking file's directory (URL-decoded). Version: README's
      `**Status: … (x.y.z)…**` line must equal `package.json` `version`; a missing line is a
      mismatch. `--fix`: for each broken link, find repo files (skip `node_modules`, `out`,
      `dist`, `.git`) whose path ends with the link's trailing segments — basename first, then
      widen to `dir/basename` while more than one matches; exactly one match → rewrite the link
      relative to the linking file (keep the anchor); otherwise leave it and report it. Tests in
      new `scripts/check-docs.test.mjs` against a temp-dir fixture (mirror the temp-dir pattern
      in `scripts/repo-hygiene.test.mjs`): "a broken relative md link is reported", "links in
      code spans, fences, external and anchor-only links are ignored", "a README version that
      differs from package.json is reported", "--fix rewrites a link to a uniquely moved file and
      leaves an ambiguous one".
- [ ] **D2 — the repo's docs are link-clean.** Run `node scripts/check-docs.mjs --fix`, then fix
      the leftovers by hand (expected: `spikes/…/RESULT.md` links, `sprints/S32/…` links in
      `docs/ROADMAP.md` now under `sprints/done/S32/`, `home-screen.md` in
      `docs/systems/install-module.md`, links into concepts that moved); a target that no longer
      exists anywhere becomes plain text (keep the words, drop the link). `README.md`: status
      line → `0.6.0`, and the status sentence and the "Servers (next release)" heading match
      `docs/ROADMAP.md`'s "where we stand" (servers and replays shipped, mods per roadmap). Add
      test "the repo's docs have no broken links and README matches package.json" to
      `scripts/check-docs.test.mjs` (calls `checkDocs(repoRoot)`, expects empty). Record the
      pre-fix count in the Done section (red before, green after).
- [ ] **D3 — ARCHITECTURE.md describes the modules as built.** In `docs/ARCHITECTURE.md`: a new
      `## Modules as built` section — the eight `ModuleId`s (one line each, `assets` as planned),
      the module bus (`module:invoke`, `defineModule`, contract, `Outcome` envelope, coverage
      tests), jobs and `JobRunner`, per-module persisted state + `persisted-migrations.ts`,
      features/unlock, the protocol handler (`src/main/index.ts`), the UI harness (`app.harness`,
      `Q2L_UI_*`), the main-window observer (`src/main/main-window-observer.ts`), shutdown order
      (`src/main/shutdown.ts`) — linking existing sections instead of repeating them. Rewrite
      `## Adding a module` as the real step list, verified by walking `replays`
      (`src/shared/modules/replays.ts`, `src/main/modules/replays/`, `src/renderer/src/modules/replays/`):
      contract type; `ModuleId` + manifest; state slot (`persisted.ts`, migrations); main index +
      registry; renderer index + client; i18n; flows (`scripts/flows/`) and the screen registry
      (`scripts/lib/screens.mjs`); every handler returns `Outcome`; dispose via `onDispose`; layering
      allowlist (`src/architecture.test.ts`); docs touch (ARCHITECTURE + `docs/systems/<id>.md`).
      Remove the false sentences ("all four planned modules", "`config`, `downloads`, `mods`,
      `assets`" as the module list, "No module produces jobs yet", "`MIGRATIONS` is empty at v1",
      any cast-based-bus description) and correct "One Zustand store" in `## Renderer`. Any part
      whose story is still open at build time carries "(planned in story NNN)". Replace the
      5-step comment in `src/shared/types/module.ts` with a pointer to
      `docs/ARCHITECTURE.md#adding-a-module`. Tests in `src/main/modules/architecture-doc.test.ts`:
      "Modules as built names every ModuleId" (reads ids from `module.ts`), "Adding a module lists
      every step" (contract, ModuleId, persisted, registry, moduleClient, i18n, flows, screens,
      Outcome, onDispose, architecture.test, docs/systems), "the sentences the review found false
      are gone", "every planned-in-story marker points at an open story" (marker's NNN has no file
      in `docs/requirements/done/`).
- [ ] **D4 — errors, logging, renderer state and placement are written down.** In
      `docs/ARCHITECTURE.md` three short sections: `## Errors and logging` (`Outcome` for expected
      failures, throw for bugs; a bare `catch` names the swallowed failure class in a comment or
      calls `log.caught`; levels — `error` a bug or lost user data, `warn` degraded but handled,
      `info` lifecycle, `debug` developer detail; always pass the `Error` object; no secrets or user
      paths at `info`), `## Renderer state` (main-owned data → query hook or mirror; cross-view →
      module store; subtree → context; else component state), `## Inside a renderer module` (View +
      tabs at the module root, `components/`, `dialogs/`, `hooks/` with camelCase `useX.ts`, `lib/`
      React-free). `src/main/lib/logger.ts`: `scopedLogger` returns `Logger & { caught(message:
      string, error: unknown): void }`, `caught` logging at `warn` with the error as last argument;
      `logger` keeps working for existing callers. Tests: `src/main/lib/logger.test.ts` › "caught
      logs at warn with the error object" (spy the electron-log stub's scope); 
      `src/main/modules/architecture-doc.test.ts` › "the errors, renderer-state and placement
      sections exist with their rules" (asserts headings plus `Outcome`, `log.caught`, `query hook`,
      `components/`, `lib/`).
- [ ] **D5 — CLAUDE.md and the small docs are current.** `CLAUDE.md`: status line describes the
      shipped launcher (no "scaffolded but not implemented"); the module names in Key rules are the
      real ids; all links resolve; the 15 `/design-tokens` 44px rows become one row (desktop,
      mouse-and-keyboard only; floors 28px dense controls, 24px in-row selects/toolbar; below
      24px needs its own row) followed by a short bullet list of the sub-28 cases (Controls grid
      30px bind slot is ≥28 so not listed; list: Raw File toolbar 24px, config tab strip 26px, demo
      rating select 24px, and any other row naming a size under 28px); the two bitmap rows stay; a
      one-paragraph comment convention (state the invariant or the non-obvious why; a story pointer
      only as a trailing `(story 052)`; never review-round narrative; deliverable/AC ids never in
      code). `CONTRIBUTING.md`: module names match `ModuleId`. `src/shared/ipc-schemas.ts`: header
      no longer says "exported-but-unused by design" (say how schemas are wired today).
      `docs/README.md` `## Project-specific`: a "Test paths for story/sprint templates" bullet —
      e2e flows `scripts/flows/<name>.mjs` run by `npm run ui:flow -- <name>`, unit/component
      `src/**/*.test.ts(x)`, script tests `scripts/**/*.test.mjs`. New `scripts/docs-facts.test.mjs`:
      "CLAUDE.md has one 44px deviation row and a comment convention", "CLAUDE.md and CONTRIBUTING
      name no install or scaffolded module", "ipc-schemas header is current", "the templates carry
      Decisions (Sprint) and Regression gate and docs/README names the real test paths".

## Model Hints

- D3 → deliverable-hard: the as-built section and checklist must be verified claim by claim
  against code across shared/main/renderer/scripts while walking `replays`; a fluent but false
  sentence passes every string test, which is exactly F23's failure.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/architecture-doc.test.ts` › "Modules as built names every
  ModuleId", "Adding a module lists every step", "the sentences the review found false are gone",
  "every planned-in-story marker points at an open story" (D3)
- AC2 → unit `src/main/modules/architecture-doc.test.ts` › "the errors, renderer-state and
  placement sections exist with their rules" + unit `src/main/lib/logger.test.ts` › "caught logs
  at warn with the error object" (D4)
- AC3 → unit `scripts/docs-facts.test.mjs` › "CLAUDE.md has one 44px deviation row and a comment
  convention", "CLAUDE.md and CONTRIBUTING name no install or scaffolded module"; links via
  `scripts/check-docs.test.mjs` › "the repo's docs have no broken links and README matches
  package.json" (D5, D2)
- AC4 → unit `scripts/check-docs.test.mjs` › "the repo's docs have no broken links and README
  matches package.json" (README version, D2) + `scripts/docs-facts.test.mjs` › "ipc-schemas header
  is current", "the templates carry Decisions (Sprint) and Regression gate and docs/README names
  the real test paths" (D5)
- AC5 → unit `scripts/check-docs.test.mjs` › "a broken relative md link is reported", "a README
  version that differs from package.json is reported" (red path, D1) and "the repo's docs have no
  broken links and README matches package.json" (green, D2; pre-fix count recorded in Done)
- No user action in this story, so no e2e flow; all criteria are proven by `npm test`.

## Done

<!-- Filled by /build 227. -->
