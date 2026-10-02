---
id: 208
title: layer rules are a test and a linter, not a convention
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the layering rules in CLAUDE.md and docs/ARCHITECTURE.md — shared is
pure, the renderer never touches node or electron, modules do not reach into each other or into
the shell, the shell does not import module internals — to fail a test when broken, so that they
hold without a reviewer remembering them. And I want a linter back, so that unused imports,
hook-dependency mistakes and restricted imports are caught by a machine.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F56, F06, F59): there is
no eslint/oxlint/biome; `package.json` has only `typecheck`. Shared purity is checked by four
hand-written tests that read their own source with `node:fs`, each needing its own
`tsconfig.web.json` exclude (the roadmap already flags this). Nothing checks `src/renderer` for
`electron`/`node:` imports, `modules/<a>` → `modules/<b>`, or shell → `modules/`; the
cross-module imports that exist are each a recorded story decision (F06 was refuted on that
ground), but nothing distinguishes an accepted one from an accidental one. 29
`eslint-disable-next-line` comments refer to rules nobody runs; 23 `as any` in non-test source. A
repo-wide spawn/network allowlist guard lives in `src/main/modules/downloads/layering.test.ts`
and went red at an S31 gate because the implementing agent could not find it. ESLint is blocked
by typescript-eslint vs TS 7 (roadmap); `oxlint` is TS-version independent.

## Acceptance Criteria

- [ ] **AC1** — One node-project vitest file `src/architecture.test.ts` walks the tree and
      asserts: `src/shared/**` imports no `node:`, `electron` or DOM types; `src/renderer/**`
      imports no `electron`/`node:`; `src/main/modules/<a>/**` imports nothing from
      `src/main/modules/<b>/` except `../types` and entries on an explicit allowlist that names
      the story that decided each; shell files under `src/main` import only `modules/index` and
      `modules/registry` from the modules tree; renderer `components/**`/`views/**` import nothing
      from `modules/**` except `modules/index` and the allowlisted cases.
- [ ] **AC2** — The four per-file purity tests and the matching `tsconfig.web.json` excludes are
      deleted; the whole-tree spawn/network guard moves from the downloads module to
      `src/main/layering.test.ts` with its allowlist documented in docs/ARCHITECTURE.md's security
      section.
- [ ] **AC3** — The allowlist is empty for `shell → modules` after story 207 and otherwise
      shrinks only; adding an entry requires a story reference (the test fails on an entry
      without one).
- [ ] **AC4** — `oxlint` runs as `npm run lint` with react, react-hooks and import plugins and
      per-directory `no-restricted-imports` mirroring AC1; it is green on `dev` and part of
      `ci.yml` and `verify:release`.
- [ ] **AC5** — The 29 stale `eslint-disable` comments are deleted or converted to the linter's
      syntax with a reason; no new `as any` is introduced.
- [ ] **AC6** — CLAUDE.md's "Key rules" point at `src/architecture.test.ts` as the enforcement of
      the layering rules.

## Open Questions

- [ ] **Q1** — Soft size caps (e.g. a module `index.ts` ≤ 400 lines) in the same test, or leave
      size to the per-area stories (210, 213)? The review suggests a soft cap once 210 has landed.

## Plan

<!-- Filled by /refine 208. -->

## Deliverables

<!-- Filled by /refine 208. -->

## Model Hints

<!-- Filled by /refine 208. -->

## Acceptance Tests

<!-- Filled by /refine 208. -->

## Done

<!-- Filled by /build 208. -->
