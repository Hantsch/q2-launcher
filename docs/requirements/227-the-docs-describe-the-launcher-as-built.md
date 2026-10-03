---
id: 227
title: the docs describe the launcher as built
status: draft # draft -> ready -> in-progress -> done
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

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Which sections wait for the refactoring they describe (204/205 bus, 207 state,
      219 jobs, 201 shutdown) and which are written now as the target state with a "planned in
      story NNN" marker? Recommendation: write the target state now, mark it, and let each story
      remove its marker.

## Plan

<!-- Filled by /refine 227. -->

## Deliverables

<!-- Filled by /refine 227. -->

## Model Hints

<!-- Filled by /refine 227. -->

## Acceptance Tests

<!-- Filled by /refine 227. -->

## Done

<!-- Filled by /build 227. -->
