---
id: 214
title: profile-restore is a folder of named stages
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the config restore pipeline's stages to be files with their own imports
and tests instead of banner comments inside one 4,185-line module, so that a grouping or
identity regression lands in a 300-line file and the hardest function in the repo is readable
as named steps.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F14, F65, confirmed by an
independent re-count): `src/shared/config/profile-restore.ts` has 4,185 lines, 63 top-level
functions, two exported functions (`restoreProfileParts`, `foreignBannerCommentText`) plus nine
exported types, nine `// ----` banner sections at lines 307/399/508/1518/1921/2138/2594/3042/3320,
`groupEntryLines` spanning 3432–3918 (487 lines, 13 named closures), `scanComments` 227 lines,
`categoryRegistry` 188, `buildEntry` 137, a 254-line header essay and 55 % comment lines. The
2,396-line test exercises only the two public exports, so a split is behaviour-safe. The wider
`src/shared/config` folder is 42 production modules plus 40 tests in one directory with no
grouping or stated dependency direction.

Priority P3: the file has had zero commits since 2026-09-10; do this when the next config
file-format story opens it, or as a quiet sprint filler.

## Acceptance Criteria

- [x] **AC1** — `src/shared/config/profile-restore/` contains one file per banner section
      (`types.ts`, `comment-scan.ts`, `categories.ts`, `cvar-sections.ts`, `entry-grouping.ts`,
      `entry-build.ts`, `two-part.ts`, `layers.ts`, `index.ts`); `src/shared/config/profile-restore.ts`
      stays as a thin facade re-exporting the public API so none of the 21 importers change.
- [x] **AC2** — `groupEntryLines`' closures are lifted into named functions taking the `groups`
      registry as a parameter; `entry-grouping.ts` has its own unit test covering the grouping
      rules the closures encode.
- [x] **AC3** — No file in the folder exceeds 800 lines; no function exceeds 150.
- [x] **AC4** — `profile-restore.test.ts` and `round-trip.test.ts` run unchanged and green; the
      round-trip fixed-point property is the gate.
- [x] **AC5** — The 254-line header essay is reduced to a present-tense pipeline overview (parse
      → fold → restore → store → render → sync) of ≤ 40 lines; the history moves to
      docs/systems/config-module.md (story 228) or is dropped.
- [x] **AC6** — docs/systems/config-module.md gains a one-paragraph dependency-direction note for
      `src/shared/config` (syntax → catalog → aliases/validation → profile → render), and any
      sub-folder grouping done here follows it.

## Decisions (Sprint)

- **(User)** Q1: Group ALL of `src/shared/config` into sub-folders in this story (mechanical path rewrite over the renderer importers), not only `profile-restore/`.
- **D-a — Folder location.** The stage folder lives at `src/shared/config/profile/profile-restore/` and the
  thin facade at `src/shared/config/profile/profile-restore.ts` (file wins over directory under
  `moduleResolution: bundler`). Reason: Q1 puts every module in a group folder; the facade still keeps
  importers' symbol imports unchanged, only their path prefix moves.
- **D-b — AC1 "none of the importers change" is read as "no importer changes beyond the Q1 path
  rewrite".** Reason: Q1 (User) rewrites all ~117 importer files anyway; the facade's job is that
  no importer changes *what* it imports.
- **D-c — A tenth stage file.** The comment-scan banner (523–1578, ~1,056 lines) splits into
  `comment-parse.ts` (tag/comment parsing, decoration and foreign-wrap helpers,
  `foreignBannerCommentText`) and `comment-scan.ts` (`scanComments` and header-rule helpers). Reason:
  AC3's 800-line cap beats AC1's one-file-per-banner list; nothing else in AC1 changes.
- **D-d — Shared internals go to `types.ts`.** `Section`, `sectionFor`, `sectionEnd`, `TaggedLine`,
  `UnboundEntryLine`, `EntryGroup` and `HEURISTIC_SUBCATEGORY_PREFIX` move to `types.ts`;
  `sectionCategoryKey` moves to `categories.ts`. Reason: each is used by 3+ stages, and
  `sectionCategoryKey` is the only edge forming a cycle (two-part ↔ entry point).
- **D-e — The groups.** `syntax/` (config-syntax, command-tokenizer, entry-idioms, key-names,
  engine-limits, q2-charset, color-cvars, cfg-layout), `catalog/` (cvar-facts, cvar-catalog,
  cvar-defaults, demo-speed, action-catalog, catalog-rows, action-slots, chat-macros, autorecord),
  `aliases/` (alt-layers, alias-names, alias-render, action-mirror, alias-references, alias-import,
  modifier-layers, switch-bind, drop-entries), `validation/` (validation, validate-actions,
  validate-cvars, validate-structure, bind-collision), `profile/` (profile-metadata, profile-baseline,
  profile-diff, profile-files, profile-restore, tidy-up, bind-adoption), `render/` (render,
  comment-labels, file-ownership); `fixtures/` stays at `src/shared/config/fixtures/` and takes
  `profile-fixtures.ts`; `profile-restore.test-helpers.ts` goes to `profile/`; each test moves next to
  its module. Modules added by stories 210/211 before this one is built (e.g. `profile-schema.ts`) go to
  the lowest group their imports allow. Reason: this is the import graph read at refine time, and it
  has exactly one edge against the direction (next decision).
- **D-f — Direction rule and its one violation.** A file in a group imports only from its own group
  or groups to its left in `syntax → catalog → aliases/validation → profile → render`; aliases and
  validation are one tier. profile-restore's imports from `render.ts` (`COMMENT_PREFIX`,
  `CVAR_DEFAULTS_SECTION_ID`, `HAND_EDIT_SENTENCE`, `OTHER_CATEGORY_LABEL`, `OWNERSHIP_MARKER`,
  `UNOWNED_BINDS_LABEL`) move into `syntax/file-vocabulary.ts`; `render.ts` imports and re-exports
  them so its importers keep compiling. Reason: these are the file format's written vocabulary, not
  render logic, and moving them is cheaper than an allowlist exception.
- **D-g — No barrels per group.** Importers name `@shared/config/<group>/<module>` directly. Reason:
  that is today's style, and barrels invite cycles.
- **D-h — The header history is dropped, not moved.** `index.ts` keeps a ≤ 40-line present-tense
  overview. An invariant the essay states that still holds goes as a short comment next to the code it
  constrains, e.g. "the config line wins over its tag". Reason: git keeps the history, and story 230
  asks for invariant-only comments; story 228 owns the system doc's shape.
- **D-i — AC4's test names are today's files.** No file named `profile-restore.test.ts` or
  `round-trip.test.ts` exists. The gate is the five `profile-restore.*.test.ts` suites, plus
  `src/main/modules/config/round-trip/*.test.ts` with its fixed-point suite in
  `fixed-point-and-kinds.test.ts`. "Unchanged" means only their import specifiers and location change
  (the Q1 move). Reason: the review's file names are stale, and the intent is behaviour-safety.
- **D-j — Structure is checked in `src/architecture.test.ts`.** AC3's caps, AC5's header length and
  AC6's direction are assertions there. Reason: that file already scans `src` with an import graph
  (`resolveSpecifier`), and node file reads are not allowed under `src/shared/**`.
- **D-k — "Function length".** This is the line span of a top-level `function` declaration or
  top-level `const x = (…) =>` from its first line to its closing column-0 `}`. Reason: once the
  closures are lifted, only top-level functions remain, and this is measurable without a TS parser.
- **D-l — The grouping is one scripted D despite touching > 8 files.** Reason: `git mv` plus an
  import-specifier rewrite cannot be cut. Typecheck is red until every importer is rewritten, and the
  turn count of a codemod does not grow with file count.
- **D-m — Path mentions in code comments and `scripts/` comments follow the move; done stories and
  sprint docs do not.** Reason: comments should point at real files, and history documents describe
  their own time.
- **D-n — No CHANGELOG entry.** Reason: there is no user-visible change.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Group the whole `src/shared/config` into sub-folders in this story (mechanical path
      rewrite over 41 renderer importers) or only `profile-restore/`? Recommendation: only
      `profile-restore/` now, grouping as a follow-up once the direction note exists.

## Plan

Order: split the module in place first (no importer churn), lift the closures, then move the whole
folder into groups, then the docs.

1. **D1:** Move the lower stages out of `src/shared/config/profile-restore.ts` into
   `src/shared/config/profile-restore/` (`types.ts`, `comment-parse.ts`, `comment-scan.ts`,
   `categories.ts`, `cvar-sections.ts`). Cut `scanComments`, `categoryRegistry` and
   `cvarSectionRegistry` to ≤ 150 lines each.
2. **D2:** Move the upper stages (`entry-build.ts`, `two-part.ts`, `layers.ts`, `entry-grouping.ts`)
   and `index.ts` with `restoreProfileParts` (≤ 150 lines) and the ≤ 40-line overview.
   `profile-restore.ts` becomes the facade.
3. **D3:** Lift `groupEntryLines`' 13 closures into named functions taking a `groups` state
   parameter. Add `entry-grouping.test.ts` and the AC3 structure test.
4. **D4:** Group `src/shared/config` into `syntax/ catalog/ aliases/ validation/ profile/ render/`
   (decision D-e), move the render vocabulary to `syntax/file-vocabulary.ts`, run the import codemod
   over `src` + `scripts`, and add the direction test.
5. **D5:** Add the dependency-direction paragraph and the new paths to `docs/systems/config-module.md`
   (and fix paths in `profile-file-format.md`), plus the doc assertion.

Behaviour gate throughout: the five `profile-restore.*.test.ts` suites and
`src/main/modules/config/round-trip/` stay green with no assertion edits.

## Deliverables

- **D1 — lower stages move into `profile-restore/`.**
  - Create `src/shared/config/profile-restore/types.ts`:
    - the public types of the "Input" (≈306–397) and "Output" (≈398–522) banners, including
      `RESTORE_WARNING_KEYS`;
    - the cross-stage internals `Section`, `sectionFor`, `sectionEnd`, `TaggedLine`,
      `UnboundEntryLine`, `EntryGroup` and `HEURISTIC_SUBCATEGORY_PREFIX`.
  - Create `comment-parse.ts` (≈523–~1128: sentinel, `ParsedComment`, `parseComment`,
    `claimsEntryAnchor`, tag readers, `adoptableId`, the decoration/mirror/foreign-wrap helpers,
    `foreignBannerCommentText`, `decorationCounts`, `heuristicSubcategoryParent`, `claims*`,
    `bannerTitle`).
  - Create `comment-scan.ts` (≈1129–1578: header-rule helpers, `CommentScan`, `scanComments`).
  - Create `categories.ts` ("Categories" banner, plus `sectionCategoryKey` moved from the entry-point
    banner ≈3413) and `cvar-sections.ts` ("Cvar sections" banner).
  - `profile-restore.ts` imports these back, so the rest of it is untouched.
  - `scanComments`, `categoryRegistry` and `cvarSectionRegistry` are each cut into named helpers of ≤ 150 lines.
  - Pure move: no logic change, no test edits. Keep each moved function's doc comment, and drop
    sprint-history sentences from them.
  - Acceptance: `npx vitest run src/shared/config src/main/modules/config` and `npm run typecheck`
    are green, and no new file has more than 800 lines.
- **D2 — upper stages, entry point and facade.**
  - Create in `src/shared/config/profile-restore/`:
    - `entry-build.ts` ("Entries" banner ≈2203–2659);
    - `two-part.ts` ("Two-part entries" ≈2660–3115);
    - `layers.ts` ("Layers" ≈3116–3396);
    - `entry-grouping.ts` (≈3397–4110: `groupEntryLines`, `orderGroupsByFile`,
      `applyForeignSubcategoryHeuristic`);
    - `index.ts` (`restoreProfileParts`, cut to ≤ 150 lines, plus re-exports of `types.ts`'s public
      types, `RESTORE_WARNING_KEYS` and `foreignBannerCommentText`).
  - Export `TwoPartMerge` from `two-part.ts`. `MODIFIER_TRIGGERS`, `CHUNK_SUFFIX`, `HELPER_SUFFIX`,
    `foldedAliasBody`, `commandsFromAliases`, `buildEntry`, `entryProse` and `keySlotsFrom` are
    exported from `entry-build.ts`.
  - `src/shared/config/profile-restore.ts` becomes a facade: `export * from './profile-restore/index'`
    (plus `export type` as needed). No importer changes.
  - Replace the 254-line header essay with a ≤ 40-line present-tense pipeline overview at the top of
    `index.ts`: parse → fold → restore → store → render → sync, which stage file does what, and the
    one rule "the config line wins over its tag". Drop the history.
  - Add a test `it('profile-restore/index.ts opens with a pipeline overview of at most 40 lines')`
    to `src/architecture.test.ts` (inside `describe('architecture')`). It checks the leading block
    comment is ≤ 40 lines and names all six stage words.
  - Acceptance: the same vitest scope plus typecheck are green, and the new test passes.
- **D3 — `groupEntryLines` as named functions, plus its own tests.**
  - In `src/shared/config/profile-restore/entry-grouping.ts`, turn the state `groupEntryLines` closes
    over into one explicit state object passed as a parameter: `groups` (Map category→key→EntryGroup),
    `untaggedAliases`, `aliasLines`, `chains`, `ownedAliasNames`, merges/half-groups and `warnings`.
  - Lift every closure (`groupFor`, `categoryKeyOf`, `allGroups`, `insideLayer`, `readTag`, `chain`,
    `prosesOf`, `cidOf`, `unboundOnly`, `matchAnchor`, `joinableUnboundGroup`,
    `catalogueMirrorCandidate`, `matchUnbound`) into an exported top-level function taking that state.
  - Turn each phase loop (aliases, owned names, binds, comments) into a named phase function, so that
    `groupEntryLines` reads as a ≤ 150-line sequence of phases. Keep the mutation order exactly as it
    is today.
  - Add `src/shared/config/profile-restore/entry-grouping.test.ts`. It unit-tests the rules the
    closures encode through the lifted functions:
    - get-or-create a group per (category, key);
    - an anchor comment attaches to the nearest claiming group, preferring the same scope;
    - an unbound line joins an existing group by cid only when joinable;
    - a catalogue-mirror candidate matches;
    - a position inside a layer section is recognised;
    - a missing or invalid tag degrades to inference with a warning.
  - Add the `src/architecture.test.ts` test `it('no profile-restore stage file exceeds 800 lines and
    no function exceeds 150')` (function span per decision D-k).
  - Acceptance: entry-grouping tests, the profile-restore suites, round-trip and architecture are green.
- **D4 — `src/shared/config` grouped into dependency-ordered folders (scripted).**
  - Move the render vocabulary (`COMMENT_PREFIX`, `CVAR_DEFAULTS_SECTION_ID`, `HAND_EDIT_SENTENCE`,
    `OTHER_CATEGORY_LABEL`, `OWNERSHIP_MARKER`, `UNOWNED_BINDS_LABEL`) from `render.ts` into a new
    `syntax/file-vocabulary.ts`. `render.ts` imports and re-exports them, and profile-restore's stages
    and `file-ownership.ts` import them from `syntax/file-vocabulary.ts`.
  - `git mv` every module and its tests into the folder assignment of decision D-e:
    - `profile-restore.ts` and its folder go to `profile/`;
    - `profile-fixtures.ts` goes to `fixtures/`;
    - `profile-restore.test-helpers.ts` goes to `profile/`;
    - modules added since refine go to the lowest group their imports allow.
  - Write a one-off Node script in the scratchpad (not committed). It rewrites every
    `@shared/config/<module>` and relative intra-folder specifier in `src/**` and `scripts/**`
    (~117 files outside the folder, plus the folder itself), and path mentions in code comments
    (`scripts/flows/*.mjs`, `scripts/lib/fixture.mjs`, `scripts/lib/screens.mjs`,
    `src/main/services/update/service.actions.test.ts`). Also repoint the profile-restore paths that
  D2/D3 put into `src/architecture.test.ts` to `src/shared/config/profile/profile-restore/`.
  - Add the `src/architecture.test.ts` test `it('src/shared/config groups import only leftward:
    syntax → catalog → aliases/validation → profile → render')`. Build it on the existing import graph
    (`resolveSpecifier`): rank syntax 0, catalog 1, aliases/validation 2, profile 3, render 4;
    `fixtures/` is exempt as test-only. It also asserts no production `.ts` file remains directly in
    `src/shared/config/`.
  - Acceptance: `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` are green.
- **D5 — systems doc: direction note and paths.**
  - In `docs/systems/config-module.md` §6 (Integration / architecture notes), add one paragraph: the
    `src/shared/config` groups, the rule "import only from your own group or leftward: syntax →
    catalog → aliases/validation → profile → render", that `src/architecture.test.ts` enforces it, and
    that `profile/profile-restore/` is a folder of named stages (one line per stage file).
  - Update every `src/shared/config/<module>` path in `config-module.md` and
    `docs/systems/profile-file-format.md` to its grouped path.
  - Add the `src/architecture.test.ts` test `it('config-module.md states the shared/config dependency
    direction')`, asserting the doc contains `syntax → catalog → aliases/validation → profile → render`.
  - Acceptance: the architecture test is green, and no `src/shared/config/<flat-module>.ts` path is
    left in either systems doc.

## Model Hints

- D3 → deliverable-hard — lifting 13 closures that share mutable `groups`/chain state into
  parameterised functions can silently reorder mutations or capture a stale map. Only some grouping
  edge cases (scope preference in `matchAnchor`, cid joins in `joinableUnboundGroup`) are pinned by
  round-trip fixtures, so a regression there is plausible.
- D1, D2, D4, D5 → default. They are pure moves or codemods gated by typecheck and the existing
  suites.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/architecture.test.ts` › "src/shared/config groups import only leftward: syntax →
  catalog → aliases/validation → profile → render" (asserts the grouped layout, no flat production
  file left). The stage files plus facade are proven by `npm run typecheck` and the unchanged
  suites under AC4 importing through the facade (D2, D4).
- AC2 → unit `src/shared/config/profile/profile-restore/entry-grouping.test.ts` › "groupEntryLines'
  rules as named functions" (D3)
- AC3 → unit `src/architecture.test.ts` › "no profile-restore stage file exceeds 800 lines and no
  function exceeds 150" (D3)
- AC4 → unit, unchanged suites:
  - `src/shared/config/profile/profile-restore.{anchors,metadata,roundtrip,toggle-and-foreign,unbound-alias}.test.ts`;
  - `src/main/modules/config/round-trip/fixed-point-and-kinds.test.ts` › "render(parse(render(p)))
    is a fixed point over the fixture corpus" plus the other `round-trip/*.test.ts`.
  
  These run green after every D. The review checks that their diff contains only specifier/path
  changes (D1–D4).
- AC5 → unit `src/architecture.test.ts` › "profile-restore/index.ts opens with a pipeline overview of
  at most 40 lines" (D2)
- AC6 → unit `src/architecture.test.ts` › "config-module.md states the shared/config dependency
  direction" (D5) and "src/shared/config groups import only leftward: …" (D4)
- No user action: there is no e2e flow, and `ui-acceptance-required` does not apply. There is no
  manual residue.

## Done

Profile restore is now a folder of named stage files under `src/shared/config/profile/profile-restore/`
(types, comment-parse, comment-scan, categories, cvar-sections, entry-build, two-part, layers,
entry-grouping, entry-matching, index) behind a one-line facade. `groupEntryLines` is a phase sequence over an
explicit state object with its closures lifted; all of `src/shared/config` is grouped into
syntax/catalog/aliases/validation/profile/render with the direction rule enforced in `architecture.test.ts`.

Commit: `214: profile-restore as stage folder, groupEntryLines lifted, shared/config grouped by dependency direction`

Verification (narrow gate; story is a big move, so full `npm test` ran instead of `vitest --changed HEAD`): build, lint, typecheck green; `npm test` 6697 passed, 2 red = pre-existing (shell-layering "no shell file imports from modules" via fixture-parity.test.ts; repo-hygiene LF flags on other stories' docs/requirements files and done/INDEX.md, 214 not flagged). No e2e (no user surface). After the review-fix (comment-only) vitest config+round-trip+architecture, typecheck, oxlint, prettier re-run green.
AC -> test: AC1/AC6 architecture "groups import only leftward" + "config-module.md states the dependency direction"; AC2 entry-grouping.test.ts (6 tests); AC3 architecture 800/150; AC4 profile-restore.*.test.ts + round-trip/*.test.ts (specifier/path edits only); AC5 architecture overview <=40 lines. All passed. No manual residue. Review: clean agent PASS.

Decisions:
- Group file placement: profile-schema went to `aliases/` (imports alt-layers, engine-limits, q2-charset).
- Besides the six D-f constants, COMMENT_LINE_BUDGET, STRICTEST_LINE_BUDGET and ENGINES_WITH_LINE_LIMITS also moved to `syntax/file-vocabulary.ts` (entry-build imported them); render.ts re-exports all eight.
- `entry-matching.ts` added (lifted closures + state) because one file hit 809 lines; two-part helpers (proseCutOf etc.) live in entry-build.ts to avoid a cycle.
- Leftward architecture test covers production files only (tests and fixtures/ exempt: round-trip tests legitimately import render).
- Review findings fixed: story/review-history narration stripped from moved comments (kept "(story NNN)" pointers); weak spots left: overview test is a keyword check, 800/150 scan is column-0 text scan (accepted per D-k).
- No CHANGELOG entry (D-n). A few relative path mentions in comments may remain stale.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 8
