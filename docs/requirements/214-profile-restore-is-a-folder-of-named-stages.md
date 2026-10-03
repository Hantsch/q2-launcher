---
id: 214
title: profile-restore is a folder of named stages
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — `src/shared/config/profile-restore/` contains one file per banner section
      (`types.ts`, `comment-scan.ts`, `categories.ts`, `cvar-sections.ts`, `entry-grouping.ts`,
      `entry-build.ts`, `two-part.ts`, `layers.ts`, `index.ts`); `src/shared/config/profile-restore.ts`
      stays as a thin facade re-exporting the public API so none of the 21 importers change.
- [ ] **AC2** — `groupEntryLines`' closures are lifted into named functions taking the `groups`
      registry as a parameter; `entry-grouping.ts` has its own unit test covering the grouping
      rules the closures encode.
- [ ] **AC3** — No file in the folder exceeds 800 lines; no function exceeds 150.
- [ ] **AC4** — `profile-restore.test.ts` and `round-trip.test.ts` run unchanged and green; the
      round-trip fixed-point property is the gate.
- [ ] **AC5** — The 254-line header essay is reduced to a present-tense pipeline overview (parse
      → fold → restore → store → render → sync) of ≤ 40 lines; the history moves to
      docs/systems/config-module.md (story 228) or is dropped.
- [ ] **AC6** — docs/systems/config-module.md gains a one-paragraph dependency-direction note for
      `src/shared/config` (syntax → catalog → aliases/validation → profile → render), and any
      sub-folder grouping done here follows it.

## Decisions (Sprint)

- **(User)** Q1: Group ALL of `src/shared/config` into sub-folders in this story (mechanical path rewrite over the renderer importers), not only `profile-restore/`.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Group the whole `src/shared/config` into sub-folders in this story (mechanical path
      rewrite over 41 renderer importers) or only `profile-restore/`? Recommendation: only
      `profile-restore/` now, grouping as a follow-up once the direction note exists.

## Plan

<!-- Filled by /refine 214. -->

## Deliverables

<!-- Filled by /refine 214. -->

## Model Hints

<!-- Filled by /refine 214. -->

## Acceptance Tests

<!-- Filled by /refine 214. -->

## Done

<!-- Filled by /build 214. -->
