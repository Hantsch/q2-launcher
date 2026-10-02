---
id: 199
title: path containment is one checked rule
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want every "is this path inside that folder" decision in main to go through
one tested function, so that the one shell channel where the renderer supplies a path as
authority (`app:revealPath`) is guarded at least as well as the module-private copies, and so
that a containment bug is fixed once.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F01):

- `isAllowedRevealTarget` in `src/main/ipc/app.ts` is `candidate.startsWith(normalize(root))` on
  the unresolved renderer string — no `path.resolve`, no separator boundary. `C:\Games\Quake2\..\..\Windows`
  and `C:\Games\Quake2-other\x` both pass for root `C:\Games\Quake2` and reach `shell.openPath`.
  docs/ARCHITECTURE.md promises the opposite. Impact is bounded (only directories are opened, files
  go to `showItemInFolder`), but it is the weakest containment check in the codebase on the only
  renderer-authoritative path.
- `isInsideDir` exists three times (`mods/remove.ts`, `mods/update-job.ts`,
  `downloads/bootstrap/target.ts`) and the copies disagree on the trailing-separator rule, so
  `isInsideDir('C:\x', 'C:\')` is true in mods and false in target's protected-dir check.
- `absolutePathSchema` (`src/shared/schemas.ts`) documents "rejects relative paths" but is only
  `.min(1)` plus a NUL refine; absoluteness is enforced ad hoc per handler.

## Acceptance Criteria

- [ ] **AC1** — `src/main/lib/fs-utils.ts` exports one `isInside(root, target)` that resolves both
      paths, uses `path.relative`, rejects `..`-leading and absolute relatives, folds case via the
      existing `pathKey` rule, and handles a drive root. It is unit-tested on win32 and linux for:
      `..` segments, a sibling-prefix root (`Quake2-other`), trailing separators, drive roots, and
      a target equal to the root.
- [ ] **AC2** — `isAllowedRevealTarget` and the three `isInsideDir` sites call `isInside`; a repo
      grep for `function isInsideDir` and for `startsWith(normalize(` under `src/main` returns
      nothing.
- [ ] **AC3** — `app:revealPath` refuses `<root>/../<x>` and `<root>-other/<x>` for a registered
      installation root, proven in `src/main/ipc/app.test.ts`, on both platforms.
- [ ] **AC4** — `absolutePathSchema` either checks absoluteness without `node:path` (drive letter,
      UNC, or leading `/`) and is tested for relative input, or is renamed to what it does
      (`nonEmptyPathSchema`) and every handler that relied on the promise has its own check. Its
      doc comment matches its behaviour.
- [ ] **AC5** — The duplicated `exists`/`isFile`/recursive-list/atomic-byte-write helpers the
      review counted beside `fs-utils.ts` are either moved there or left with a one-line reason;
      no behaviour change elsewhere (full `npm test` green).
- [ ] **AC6** — docs/ARCHITECTURE.md's "Paths are never trusted" paragraph names `isInside` as the
      rule.

## Open Questions

- [ ] **Q1** — Rename `absolutePathSchema` or make it honest? A real check is platform-agnostic
      only with a regex that accepts `C:\`, `\\server\share` and `/`; the review recommends the
      regex. Decide at refine.

## Plan

<!-- Filled by /refine 199. -->

## Deliverables

<!-- Filled by /refine 199. -->

## Model Hints

<!-- Filled by /refine 199. -->

## Acceptance Tests

<!-- Filled by /refine 199. -->

## Done

<!-- Filled by /build 199. -->
