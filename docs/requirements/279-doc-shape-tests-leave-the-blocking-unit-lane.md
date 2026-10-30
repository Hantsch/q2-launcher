---
id: 279
title: Doc-shape tests leave the blocking unit lane
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

About 50 tests in about eight files assert on Markdown prose: the roadmap's follow-up line count,
TECH-DEBT row format, sentences in `docs/ARCHITECTURE.md` and `docs/systems/`, the `CLAUDE.md`
deviation rows and lane-map shape, links between docs. They run in `npm test`, so in every PR and
in the release job. Since S33 they were six of the eleven red unit tests in sprint gates, and the
cause of the red S36 PR on 2026-10-29; none of them found a product defect. The sprint process
edits these docs all the time, so the rules break where docs are written, not where code is.

Doc rules are checked where docs are written — `/roadmap check` and sprint phase 3 — and never
block a PR or a release. Code rules stay in the blocking lane.

## Acceptance Criteria

- [ ] **AC1** — `npm test` runs no test that asserts on the prose or shape of a project doc
      (`docs/**/*.md`, `CLAUDE.md`, `.claude/**/*.md`, `README.md`). Tests of Markdown the
      product or the release reads (`CHANGELOG.md` for release notes and the release plan) stay.
- [ ] **AC2** — `npm run check:docs` runs every moved rule and exits non-zero on a violation; a
      rule dropped instead of moved is listed in this story's Done with its reason.
- [ ] **AC3** — `.claude/ai-scrum.md` `## Notes` has `/roadmap check` and sprint phase 3 run
      `npm run check:docs` and fix a violation in the doc before the review commit.
- [ ] **AC4** — The code rules stay in `npm test`: layering and architecture, the comment rule,
      IPC coverage, repo hygiene on source files.
- [ ] **AC5** — `CLAUDE.md` `## Test lanes` has a `docs` row (local, `npm run check:docs`,
      blocks no PR or release).

## Open Questions

~~Should `check:docs` also run on PRs as a warning-only step (yellow, never red), or stay local?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** warning-only check:docs on PRs: local only — no PR step
- The docs lane is a second vitest config over `*.docs.test.*` files, mirroring the perf lane
  (`vitest.perf.config.ts`), because moving the rules verbatim keeps them as code and costs no rewrite.
- `npm run check:docs` = `node scripts/check-docs.mjs && vitest run --config vitest.docs.config.ts`,
  because the link/README/TECH-DEBT checker already exists and both halves must fail the command.
- AC1 is proven by a runtime guard (a unit-lane setup file that makes `readFileSync`/`readFile` of
  `docs/**/*.md`, `CLAUDE.md`, `.claude/**/*.md` throw), because a static grep misses `readRepoFile`,
  `new URL(...)` and path constants and would also flag the synthetic `docs/a.md` fixtures.
- Root `README.md` is not guarded: `planRelease` reads its Status line, so a real-README read in a
  release test is "Markdown the release reads" (AC1 exception); README prose tests still move.
- Tests of doc-checking *code* on synthetic input (`check-docs.test.mjs` fixtures, `checkTechDebt`
  on fixture rows, `overdueTechDebt`, `flow-select` paths, release fixtures) stay in `npm test`,
  because they assert on the script, not on a project doc.
- `content/q2_community_content/**` (templates-kit) stays: it is the news content the product
  reads, not a project doc in AC1's list.
- Mixed tests are split: the code half stays (platform-parity source scan, wiring CHANGELOG half,
  checkTechDebt fixtures), only the doc half moves, because AC4 keeps code rules blocking.
- Dropped, not moved (listed in Done by the build): the lane-map row-count bound (6–8), TECH-DEBT
  "first six rows are F34…F75", the roadmap "links no story 199–231" check, the roadmap
  "Open / unprioritised lists the codebase review" row, the roadmap "no Vite pin follow-up" check,
  and "no broken link in ROADMAP/TECH-DEBT" — the first is a size preference S37's own lane edits
  break, the next four pin a one-off historic state that `/roadmap check` legitimately removes, the
  last duplicates the link check `check:docs` already runs.
- AC3/AC5 assertions live in the docs lane, not in `npm test`, because they are doc-shape rules
  themselves; `/build` runs `npm run check:docs` to prove them.
- No CHANGELOG entry and no systems doc: nothing a user sees changes and no module behaviour moves.

## Plan

1. **Lane plumbing (D1):** `vitest.docs.config.ts` (spread of base like `vitest.perf.config.ts`,
   include `src/**/*.docs.test.ts` + `scripts/**/*.docs.test.mjs`); base config excludes
   `**/*.docs.test.*`; `package.json` gets `check:docs`. Hygiene tests pin the wiring.
2. **Move the script-side rules (D2):** doc halves of `tech-debt`, `check-docs`, `workflows`,
   `wiring`, `repo-hygiene` tests go into one new `scripts/project-docs.docs.test.mjs`; drops per
   Decisions.
3. **Move the src-side rules + guard (D3):** four whole files renamed to `.docs.test.ts`; single
   doc tests from six mixed files go into a new `src/project-docs.docs.test.ts`; the read guard
   joins the unit lane's `setupFiles` and surfaces any reader missed here.
4. **Process docs (D4):** `.claude/ai-scrum.md` `## Notes` and `CLAUDE.md` `## Test lanes` `docs`
   row, with their docs-lane assertions.

Order D1 → D2 → D3 → D4. Gate per D: `npm test`, `npm run typecheck`, `npm run lint`, and from D2
on `npm run check:docs` green. No e2e: no user surface changes.

## Deliverables

- **D1 — the docs lane exists and `check:docs` runs it.**
  Files: `vitest.docs.config.ts` (new; mirror `vitest.perf.config.ts`: spread `base`, override
  `test.include` to `['src/**/*.docs.test.ts', 'scripts/**/*.docs.test.mjs']`,
  `test.exclude: configDefaults.exclude`), `vitest.config.ts` (add `'**/*.docs.test.*'` to
  `exclude`, next to the perf glob), `package.json` (`"check:docs": "node scripts/check-docs.mjs &&
  vitest run --config vitest.docs.config.ts"` — `&&`, never `;`, and no `--passWithNoTests`, so
  an empty glob also fails), `scripts/repo-hygiene.test.mjs` (two tests in the existing
  `test discovery` describe, reusing its `matchesGlob`/`git ls-files` helpers: "every docs-lane
  test file runs in check:docs and not in npm test" — each tracked `*.docs.test.*` matches a docs
  config include glob and a base config exclude glob; and "check:docs fails when either the link
  checker or the docs lane fails" — the script chains `node scripts/check-docs.mjs` and
  `--config vitest.docs.config.ts` with `&&`). Until D2 lands no `*.docs.test.*` exists, so the
  first test passes vacuously; `check:docs` is not run in this D.

- **D2 — script-side doc rules move to `scripts/project-docs.docs.test.mjs`.**
  New file `scripts/project-docs.docs.test.mjs` takes these assertions verbatim (keep their test
  names; describe per doc):
  - `scripts/check-docs.test.mjs` › describe "the repo itself" (real-repo links + README version)
    — remove it from the source file; the fixture tests stay.
  - `scripts/tech-debt.test.mjs`: the six-column header check of the real `docs/TECH-DEBT.md`
    (drop its "first six rows are F34…F75" half); `checkTechDebt(real)` → `[]` (the fixture
    assertions of that test stay); "check-docs --overdue exits 0"; both "ageing and escalation
    rule placement" tests; "the roadmap's follow-up list is at most ten lines" (drop its 199–231
    link loop). Drop "Open / unprioritised lists the codebase review…" and "check-docs finds no
    broken link in ROADMAP.md or TECH-DEBT.md". The fixture-only tests stay in `tech-debt.test.mjs`
    and its top-level `real` read goes.
  - `scripts/workflows.test.mjs` › describe "lane map in CLAUDE.md": both tests move, minus the
    `data.length` 6–8 bound.
  - `scripts/lib/release/wiring.test.mjs`: the README half of the first test (SmartScreen,
    releases URL, "No release build" sentence; the CHANGELOG half stays), "CLAUDE.md states that a
    release needs a green ci run on its SHA", and the `.claude/ai-scrum.md` `changelog-path` test.
    The real-README `planRelease` read (~line 195) stays — the release reads README.
  - `scripts/repo-hygiene.test.mjs`: drop "the roadmap carries no Vite pin follow-up".
  Files: the five sources above + the new file (6). Done when `npm test` and `npm run check:docs`
  are green and `grep -nE "docs/|CLAUDE\.md|\.claude/"` over the five sources finds only fixture
  or comment hits.

- **D3 — src-side doc rules move to the docs lane, and the unit lane refuses doc reads.**
  `git mv` to `.docs.test.ts` (content unchanged): `src/main/modules/architecture-doc.test.ts`,
  `src/main/modules/home/images/deviation-doc.test.ts`,
  `src/main/modules/replays/name-template-doc.test.ts`, `src/main/modules/systems-docs.test.ts`.
  Move these single tests verbatim into a new `src/project-docs.docs.test.ts` (reuse
  `readRepoFile` from `src/test-support/source-tree.ts`): `src/architecture.test.ts` › "CLAUDE.md's
  key rules name src/architecture.test.ts" and › "config-module.md states the shared/config
  dependency direction"; `src/comments.test.ts` › "the build review prompt checks comments against
  the convention"; `src/main/layering.test.ts` › "every allowlisted spawn/network file is
  documented in docs/ARCHITECTURE.md" (import `ALLOWED_MAIN_SPAWN_NETWORK_FILES` from where
  layering.test gets it); `src/main/shell-layering.test.ts` › "ARCHITECTURE.md states the two-tier
  migration rule"; `src/renderer-health.test.ts` › "ARCHITECTURE.md states the four state kinds";
  `src/main/modules/servers/platform-parity.test.ts` — only its `CLAUDE.md` `toContain` line moves
  (as "CLAUDE.md carries the platform-parity rule"); the source scan stays.
  Guard: new `src/test-support/doc-read-guard.ts`, appended to `setupFiles` in `vitest.config.ts`;
  `vitest.docs.config.ts` sets `setupFiles: ['src/test-support/setup.ts']` so the docs lane is
  unguarded. It wraps `fs.readFileSync` and `fs.promises.readFile`, throws
  `unit lane read project doc <repo-rel path> — move the test to a *.docs.test.* file` for a path
  inside `REPO_ROOT` matching `docs/**/*.md`, `CLAUDE.md` or `.claude/**/*.md` (not root
  `README.md`, not `docs/fixtures/**` non-md), and calls `syncBuiltinESMExports()` from
  `node:module` so named `import { readFileSync } from 'node:fs'` bindings see the wrapper. Its
  own test `src/test-support/doc-read-guard.test.ts`: "reading a project doc in the unit lane
  throws" (named-import `readFileSync` of `CLAUDE.md` and `readRepoFile('docs/ARCHITECTURE.md')`
  throw) and "reading source, fixtures and README stays allowed". Any further reader the guard
  surfaces in `npm test` moves the same way (scripts side into `scripts/project-docs.docs.test.mjs`).
  Done when `npm test` and `npm run check:docs` are both green.

- **D4 — the process runs `check:docs` and the lane map says so.**
  `.claude/ai-scrum.md` `## Notes`: one paragraph — `/roadmap check` and `/sprint` phase 3 run
  `npm run check:docs` and fix a violation in the doc before the review commit; it blocks no PR or
  release. `CLAUDE.md` `## Test lanes`: a `docs` row — Trigger "local, `/roadmap check` and sprint
  phase 3", Command `npm run check:docs`, OS "Windows", Blocks "No — blocks no PR or release". Add
  to `scripts/project-docs.docs.test.mjs` (lane-map describe and a notes describe): "the lane map
  has a local docs row that runs check:docs and blocks nothing" and "the ai-scrum notes have
  roadmap check and sprint phase 3 run check:docs". Touch only those rows/paragraphs: stories
  276/277/278/280 edit other lane-map rows in the same sprint. Done when `npm run check:docs` is
  green.

## Model Hints

- D3 → deliverable-hard: the guard patches `node:fs` for every unit-test worker via
  `syncBuiltinESMExports` — a wrong patch either silently guards nothing (named ESM imports keep
  the original) or breaks unrelated file reads across ~316 test files, and it must stay out of the
  docs lane's setup.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/test-support/doc-read-guard.test.ts` › "reading a project doc in the unit lane
  throws" (with the guard active in every `npm test` file, a remaining doc-prose test fails the run)
- AC2 → unit `scripts/repo-hygiene.test.mjs` › "every docs-lane test file runs in check:docs and
  not in npm test" and › "check:docs fails when either the link checker or the docs lane fails";
  dropped rules listed in Done (see Decisions)
- AC3 → docs lane `scripts/project-docs.docs.test.mjs` › "the ai-scrum notes have roadmap check and
  sprint phase 3 run check:docs"
- AC4 → unit `scripts/repo-hygiene.test.mjs` › "every tracked test file is inside a vitest include
  glob" (existing) — `src/architecture.test.ts`, `src/comments.test.ts`, `src/main/ipc/index.test.ts`
  and `scripts/repo-hygiene.test.mjs` keep their names, so they stay in `npm test`
- AC5 → docs lane `scripts/project-docs.docs.test.mjs` › "the lane map has a local docs row that
  runs check:docs and blocks nothing"

## Done
