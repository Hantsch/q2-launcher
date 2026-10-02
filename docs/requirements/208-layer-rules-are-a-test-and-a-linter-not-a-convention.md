---
id: 208
title: layer rules are a test and a linter, not a convention
status: ready # draft -> ready -> in-progress -> done
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

- ~~**Q1**~~ answered → Decisions (Sprint) — Soft size caps (e.g. a module `index.ts` ≤ 400 lines) in the same test, or leave
  size to the per-area stories (210, 213)? The review suggests a soft cap once 210 has landed.

## Decisions (Sprint)

- **(User)** soft size caps: No; size is left to stories 210/213.
- **Linter tool: `oxlint`** (pinned devDependency, `.oxlintrc.json`), not ESLint or Biome — it does
  not depend on the TypeScript version 226 leaves behind (TS 7), already ships react, react-hooks
  and import rules plus `no-restricted-imports` with per-file `overrides`, and a trial run of
  1.86.0 over `src scripts` produced ~140 findings, so a green baseline is cheap to reach.
- **`npm run lint` = `oxlint --deny-warnings --report-unused-disable-directives-severity=error`**
  — "green" has to mean zero findings, and a disable comment that silences nothing is exactly the
  stale-comment class AC5 removes, so it must fail the run.
- **Rules on in `.oxlintrc.json`:** oxlint's default `correctness` set plus
  `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps` and `no-unused-vars` as errors;
  this covers the requirement's three named classes (unused imports, hook deps, restricted imports).
- **Rules off, each with a one-line reason in the config:** the React-compiler family
  (`set-state-in-effect`, `refs`, `globals`, `purity`, `immutability`, `static-components`) because
  that refactor is story 213's (F41); stylistic `unicorn` rules that fired in the trial
  (`no-useless-spread`, `no-new-array`, `no-useless-fallback-in-spread`,
  `prefer-string-starts-ends-with`) because they are outside the three classes and would add
  diff churn right after 226's format commit. Anything else that fires is fixed, not turned off.
- **`no-restricted-imports` in oxlint mirrors only the allowlist-free rules** (shared: no `node:*`,
  `electron`, main or renderer paths; renderer: no `electron`, `node:*`, main paths), off for
  `*.test.ts(x)`; the cross-module and shell rules live only in `src/architecture.test.ts`, because
  they carry a story-referenced allowlist a lint config cannot validate and two allowlists would drift.
- **Disable-comment syntax:** every surviving disable is rewritten as
  `// oxlint-disable-next-line <rule> -- <reason>`; `eslint-disable` disappears from `src/`
  entirely, so a reader no longer has to guess which tool a comment talks to.
- **"No new `as any`" is a ratchet in the architecture test** (count in non-test source ≤ a
  baseline constant measured at build time), not a lint rule — enabling `no-explicit-any` would
  need ~23 new disable comments, which is the opposite of AC5.
- **Rules apply to production files only; `*.test.ts(x)` are exempt** from the cross-module and
  shell rules, because tests legitimately reach sibling fixtures (12 main and 6 renderer test-file
  cross imports today) and nothing in them ships; 209 removes the main-side ones anyway.
- **Renderer modules are checked too** (`renderer/modules/<a>` → `modules/<b>` only via an
  allowlisted entry; 9 production imports today), because the requirement says "modules do not
  reach into each other" and F06's point — accepted vs. accidental is indistinguishable — applies
  equally to the renderer.
- **Renderer "shell" = every renderer file outside `modules/`**, not only `components/**` and
  `views/**`, because `cinema/main.tsx` → `modules/replays/cinema/CinemaOverlay` is the same kind of
  shell→module import and would otherwise slip through; it gets an allowlist entry like the others.
  Shell files may import the root files of `modules/` (`index.ts`, `moduleClient.ts`).
- **"No DOM types in shared" is enforced by the existing `typecheck:node`** (whose `lib` is
  `ES2023` without DOM and whose include covers `src/shared/**`); the architecture test pins those
  two facts in `tsconfig.node.json` instead of trying to detect DOM types by regex.
- **Import scanning is a small comment-stripping regex scanner** in a new shared helper
  `src/test-support/source-tree.ts`, not the TypeScript compiler API, because TS 7's JS API is not a
  stable dependency to build on; the helper has its own fixture tests so it cannot pass vacuously.
- **The tree walk is extracted once** into that helper and used by both `src/architecture.test.ts`
  and the moved `src/main/layering.test.ts`, because it already exists in two places
  (`downloads/layering.test.ts`, `shell-home-ownership.test.ts`) and a third copy is a refine error.
- **Allowlist entries are `{ from, to, story, reason }` per production import edge**; the test fails
  on an entry whose `story` is not three digits with a matching `docs/requirements/{,done/}NNN-*.md`,
  and on an entry that no longer matches a real import, so the list can only shrink (AC3).
- **The four purity checks being removed** are the `purity` blocks in `src/shared/servers/address.test.ts`
  and `protocol.test.ts` and the whole `shell-home-ownership.test.ts` (its import guard is subsumed;
  its HeroPanel/`hero.*`-gone checks guard a one-off removal from story 081, not a layer rule); only
  three such files exist, so the AC's "four" is read as these three plus part 1 of
  `downloads/layering.test.ts` (renderer never imports downloads), which is subsumed by the new
  "renderer imports nothing from `src/main`" rule and dropped in the move.
  `demo-guard.test.ts`'s `tsconfig.web.json` exclude stays: its reason is the node-only cbuf
  simulator, not a purity check.
- **ARCHITECTURE.md has no security section today**, so D2 adds `## Layering and security guards`
  after "Process model", holding both the layer rules (pointing at the test) and the spawn/network
  allowlist table; a test keeps every allowlisted path named in that section.
- **The two roadmap follow-ups this story closes** (the per-file purity exclude bullet and the
  "ESLint is absent" half of the TS7 bullet, keeping the Vite-pin half) are removed by D5, and
  `.claude/ai-scrum.md`'s `lint: none` becomes `lint: npm run lint` so `/build` runs it from then on.
- **No CHANGELOG entry** — nothing user-visible changes.
- **Counts in this story (18 main cross imports, 9 renderer, 29 disables, 23 `as any`) were
  measured before 226/207**; the build re-measures them and the allowlist reflects the tree it finds.
  If a `shell → modules` edge outside `context.ts → modules/registry` survives 207, that is a 207
  defect: the build reports it rather than allowlisting it (AC3).

## Plan

Order: D1 → D2 → D3 → D4 → D5. Runs after 207 (shell→modules empty) and before 209 (which adds its
`process.env`/`electron` rules to the same test and empties the `→ downloads` entries).

1. **D1** — shared helper `src/test-support/source-tree.ts` (walk, read, `scanImports`, resolve
   relative + `@shared`/`@main`/`@renderer` aliases to repo-relative POSIX paths) with fixture tests;
   `src/architecture.test.ts` with a rule table + allowlist + `as any` ratchet + tsconfig pins;
   delete the three purity checks and their `tsconfig.*.json` entries.
2. **D2** — move `downloads/layering.test.ts` to `src/main/layering.test.ts` on the helper (drop
   part 1, subsumed); new ARCHITECTURE.md section with the allowlist table + layer rules; a doc-sync
   assertion.
3. **D3** — add `oxlint`, `.oxlintrc.json`, `npm run lint`; make main/preload/shared/scripts clean
   (findings fixed, disables converted or deleted).
4. **D4** — make `src/renderer` clean the same way; wire `npm run lint` into `ci.yml`,
   `scripts/verify-release.mjs` and `.claude/ai-scrum.md`; wiring + disable-syntax assertions.
5. **D5** — CLAUDE.md Key rules pointer, ROADMAP follow-ups removed, assertion on CLAUDE.md.

Affected beyond tests: `package.json`/lockfile, `.oxlintrc.json`, `tsconfig.node.json`,
`tsconfig.web.json`, `.github/workflows/ci.yml`, `scripts/verify-release.mjs`, `docs/ARCHITECTURE.md`,
`CLAUDE.md`, `docs/ROADMAP.md`, `.claude/ai-scrum.md`, plus the source files whose lint findings are
fixed (mechanical: unused vars/imports, hook deps, escapes).

## Deliverables

- [ ] **D1 — the architecture test and its scanner.** Create `src/test-support/source-tree.ts`
      exporting `listSourceFiles(dirRepoRel)` (recursive, `.ts`/`.tsx`, repo-relative POSIX paths — use
      `/` on Windows too), `isTestFile(path)` (`.test.ts(x)`/`.spec.ts(x)`), `scanImports(sourceText)`
      (returns every module specifier) and `resolveSpecifier(fromFile, spec)` (relative →
      repo-relative path without extension; `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`,
      `@renderer/*` → `src/renderer/src/*`; bare specifiers returned unchanged). `scanImports` first
      strips `/* */` and `//` comments (not `//` inside a string such as a URL), then matches: static
      `import … from`, `import type … from`, multi-line `import {\n a,\n b\n} from`, `export … from`,
      `export * from`, side-effect `import 'x'`, dynamic `import('x')`, `require('x')`. Its tests in
      `src/test-support/source-tree.test.ts` cover each form plus a doc comment mentioning
      `from 'electron'` that must not count. Mirror the walk in `src/main/modules/downloads/layering.test.ts`
      (lines ~25-60) but do not copy it — this helper replaces it.
      Create `src/architecture.test.ts` (node environment) with one `it` per rule, each collecting
      offenders over **production files only** (`!isTestFile`) and expecting `[]`:
      (a) `src/shared/**` imports no `node:*`, `electron`, and nothing resolving into `src/main`,
      `src/renderer` or `src/preload`; plus `tsconfig.node.json` includes `src/shared/**/*.ts` and its
      `lib` has no `DOM` entry (that is what keeps DOM types out — `typecheck:node`);
      (b) `src/renderer/**` imports no `electron`, `node:*`, nothing resolving into `src/main`;
      (c) a file in `src/main/modules/<a>/` resolving into `src/main/modules/<b>/` (b ≠ a) is an offender
      unless the edge is allowlisted (`src/main/modules/types` is not a module and is always allowed);
      (d) a file under `src/main/` outside `modules/` may resolve into `src/main/modules/` only as
      `src/main/modules/index` or `src/main/modules/registry`; the allowlist for this rule is an empty
      array and a test asserts it stays empty;
      (e) a renderer file outside `src/renderer/src/modules/` may resolve into `modules/` only to a root
      file (`modules/index`, `modules/moduleClient`) or an allowlisted edge;
      (f) a file in `src/renderer/src/modules/<a>/` resolving into `modules/<b>/` is an offender unless
      allowlisted.
      The allowlist is `const ALLOWED: ReadonlyArray<{ from: string; to: string; story: string; reason: string }>`
      with one entry per production edge found today (at refine: 18 main mods/servers/replays →
      downloads, 4 renderer `components`/`views` → modules, `cinema/main.tsx` → `modules/replays/cinema/CinemaOverlay`,
      9 renderer module→module); find each `story` via `git log --follow -S` on the import line or the
      story under `docs/requirements/done/` that introduced the file. Extra tests: every entry's `story`
      matches `^\d{3}$` and `docs/requirements/NNN-*.md` or `docs/requirements/done/NNN-*.md` exists;
      every entry still matches a real import (no stale entries); a non-vacuity check that the scanner
      finds > 500 import edges in `src/`. Ratchet: count `as any` in production `src/**` files, expect
      ≤ `AS_ANY_BASELINE` (set to the count measured now, comment "shrinks only"). Add
      `src/*.ts` to `tsconfig.node.json`'s `include`.
      Delete the `describe('purity', …)` blocks in `src/shared/servers/address.test.ts` and
      `src/shared/servers/protocol.test.ts` (and their now-unused `node:*` imports), delete
      `src/renderer/src/components/shell/shell-home-ownership.test.ts`, and remove their three entries
      (and comments) from `tsconfig.web.json`'s `exclude` and the shell-home-ownership entry from
      `tsconfig.node.json`'s `include`; `demo-guard.test.ts`'s exclude stays. A test in
      `src/architecture.test.ts` asserts `tsconfig.web.json`'s `exclude` is exactly
      `["src/shared/replays/demo-guard.test.ts"]` (parse as JSONC — strip comments first).
      Acceptance: `npx vitest run src/architecture.test.ts src/test-support/source-tree.test.ts` green;
      `npm run typecheck` green.

- [ ] **D2 — the spawn/network guard is repo-level and documented.** Move
      `src/main/modules/downloads/layering.test.ts` to `src/main/layering.test.ts` (`git mv`), rewrite
      its walk on `listSourceFiles` from `src/test-support/source-tree.ts`, fix its `REPO_ROOT`/import of
      `../../lib/renderer-source` → `./lib/renderer-source`, and drop its part 1 ("not imported by any file
      under src/renderer/src") — `src/architecture.test.ts` rule (b) now covers it. Keep parts 2-4
      (renderer/preload token check, main confinement with `ALLOWED_MAIN_SPAWN_NETWORK_FILES`, CSP pin)
      and their names. In `docs/ARCHITECTURE.md` add `## Layering and security guards` after "Process
      model": a short list of the layer rules with "enforced by `src/architecture.test.ts`" and how to add
      an allowlist entry (story number required, list only shrinks), then a table of every
      `ALLOWED_MAIN_SPAWN_NETWORK_FILES` path with its one-line reason, enforced by
      `src/main/layering.test.ts`. Add a test there: every path in `ALLOWED_MAIN_SPAWN_NETWORK_FILES`
      appears in `docs/ARCHITECTURE.md`. Acceptance: `npx vitest run src/main/layering.test.ts` green and
      the old file is gone.

- [ ] **D3 — oxlint runs, and main/preload/shared/scripts are clean.** `npm i -D oxlint` (exact
      current version, lockfile updated). Create `.oxlintrc.json` with plugins
      `["typescript","react","import","unicorn","oxc"]`, `ignorePatterns` for `out/`, `dist/`,
      `release/`, `node_modules/`, `vendor/` and any build output present; rules: default `correctness`
      plus `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `no-unused-vars` as `error`;
      `off` with a `//` reason comment: `react/set-state-in-effect`, `react/refs`, `react/globals`,
      `react/purity`, `react/immutability`, `react/static-components` ("React-compiler refactor is story
      213 / F41") and `unicorn/no-useless-spread`, `unicorn/no-new-array`,
      `unicorn/no-useless-fallback-in-spread`, `unicorn/prefer-string-starts-ends-with` ("stylistic,
      outside this story's three classes"). `overrides`: `src/shared/**` → `no-restricted-imports` with
      patterns `node:*`, `electron`, `@main/*`, `@renderer/*`, `**/main/**`, `**/renderer/**`;
      `src/renderer/**` → `no-restricted-imports` with `node:*`, `electron`, `@main/*`, `**/main/**`;
      a later override for `**/*.test.ts`, `**/*.test.tsx` turns `no-restricted-imports` off. Add
      `"lint": "oxlint --deny-warnings --report-unused-disable-directives-severity=error"` to
      `package.json` (verify the flag names against `npx oxlint --help` for the installed version).
      Then fix every finding under `src/main`, `src/preload`, `src/shared`, `scripts`: remove unused
      vars/imports, correct hook deps, fix the escapes; delete each `eslint-disable` comment that
      silences nothing; rewrite each one still needed as `// oxlint-disable-next-line <rule> -- <reason>`.
      Fix, do not disable, unless the code is intentional (e.g. a control-char regex) — then the
      comment says why. No new `as any`. Acceptance:
      `npm run lint -- src/main src/preload src/shared scripts` exits 0; `npm test` and
      `npm run typecheck` green.

- [ ] **D4 — the renderer is clean and lint is a gate.** With the `.oxlintrc.json` and `npm run
lint` from D3, fix every finding under `src/renderer` the same way (unused vars/imports, hook deps
      — a missing dep is added or the hook restructured, never silenced without a reason; stale
      `eslint-disable` comments deleted, needed ones rewritten as
      `// oxlint-disable-next-line <rule> -- <reason>`). Wire it in: `.github/workflows/ci.yml` test job
      gets a `- name: Lint` / `run: npm run lint` step right after Typecheck; `scripts/verify-release.mjs`
      gets `{ label: 'lint', run: () => npm(['run', 'lint'], H, R) === 0 }` next to the typecheck step
      (~line 341); `.claude/ai-scrum.md` `lint: none` → `lint: npm run lint`. Add to
      `src/architecture.test.ts`: `ci.yml` contains `npm run lint`; `verify-release.mjs` contains
      `['run', 'lint']`; no file under `src/` contains `eslint-disable`; every `oxlint-disable` comment
      under `src/` has `--` followed by a reason; `.oxlintrc.json` (JSONC) has the shared and renderer
      `no-restricted-imports` overrides with `electron` and `node:*`. Acceptance: `npm run lint` exits 0
      on the whole repo; `npm test`, `npm run typecheck`, `npm run build` green.

- [ ] **D5 — the rules point at their enforcement.** In `CLAUDE.md` "Key rules" add one bullet:
      layering (shared pure, renderer no node/electron, modules don't import each other, shell doesn't
      import module internals) is enforced by `src/architecture.test.ts` and `npm run lint`; an exception
      is an allowlist entry with a story number. In `docs/ROADMAP.md` delete the follow-up about the
      per-file purity `tsconfig.web.json` excludes and the "ESLint is absent …" sentence (keep the Vite-pin
      sentence). Add to `src/architecture.test.ts`: CLAUDE.md's "## Key rules" section mentions
      `src/architecture.test.ts`. Acceptance: that test green.

## Model Hints

- D1 → deliverable-hard — a scanner or resolver that silently misses multi-line imports, aliases or
  Windows `\` separators makes every rule pass vacuously, and the allowlist's story attribution needs
  git archaeology across ~30 edges; the fixture tests and the non-vacuity/stale-entry checks are the
  guard and must be written first.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/architecture.test.ts` › "src/shared imports no node:, electron, main, renderer or preload module",
  "shared is typechecked without DOM types", "src/renderer imports no electron, node: or src/main",
  "a main module imports another module only through an allowlisted edge",
  "a main shell file imports only modules/index and modules/registry",
  "a renderer shell file imports only modules root files or an allowlisted edge",
  "a renderer module imports another module only through an allowlisted edge"; unit
  `src/test-support/source-tree.test.ts` › "scanImports finds every import form and ignores comments" (D1)
- AC2 → unit `src/architecture.test.ts` › "the per-file purity checks and their tsconfig excludes are gone" (D1);
  unit `src/main/layering.test.ts` › "confines child_process/net.fetch/7za/spawn( usage in src/main to the downloads module and the pre-existing allowlist",
  "every allowlisted spawn/network file is documented in docs/ARCHITECTURE.md" (D2)
- AC3 → unit `src/architecture.test.ts` › "the shell → modules allowlist is empty",
  "every allowlist entry names an existing story", "every allowlist entry still matches a real import" (D1)
- AC4 → verify `npm run lint` exits 0 (D3, D4); unit `src/architecture.test.ts` ›
  "lint runs in ci.yml and verify:release", "oxlint restricts electron and node imports in shared and renderer" (D4)
- AC5 → unit `src/architecture.test.ts` › "no eslint-disable comment survives and every oxlint-disable carries a reason" (D4),
  "as any in production source does not exceed the baseline" (D1); unused disables fail `npm run lint` (D3, D4)
- AC6 → unit `src/architecture.test.ts` › "CLAUDE.md's key rules name src/architecture.test.ts" (D5)

No AC describes a user action; no e2e flow applies.

## Done

<!-- Filled by /build 208. -->
