---
id: 199
title: path containment is one checked rule
status: ready # draft -> ready -> in-progress -> done
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

- [x] **Q1** — Rename `absolutePathSchema` or make it honest? A real check is platform-agnostic
      only with a regex that accepts `C:\`, `\\server\share` and `/`; the review recommends the
      regex. Decide at refine. → Answered in Decisions (Sprint) D-1: the regex.

## Decisions (Sprint)

- **D-1 (Q1)** — `absolutePathSchema` stays and becomes honest via a `node:path`-free regex
  (drive letter + separator, UNC `\\server\share`, or leading `/`); every caller already sends
  dialog-picked or stored absolute paths, so the promise the name makes is the cheapest one to keep.
- **D-2** — `isInside` picks `path.win32` / `path.posix` from `process.platform` _at call time_,
  because the native `node:path` functions ignore `stubPlatform` and "tested on win32 and linux"
  must run on one host.
- **D-3** — The case rule (lowercase unless `linux`) is extracted into one private helper used by
  both `pathKey` and `isInside`; `pathKey` itself is not changed, so no other caller shifts.
- **D-4** — `isInside` is lexical (resolve, not realpath); following symlinks stays the caller's
  job, as the mods sites already `realpath` before checking and the reveal check never did.
- **D-5** — The signature is `isInside(root, target)` (root first, as AC1 names it), the reverse of
  the old `isInsideDir(child, parent)`; every migrated call site is rewritten and a reveal test
  proves a _parent_ of a root is refused, since a swapped call would pass every other test.
- **D-6** — `isStrictlyInside` (`mods/install-job.ts`, a fourth prefix copy the review missed) is
  rebuilt on `isInside` plus a not-equal check and keeps its export, so the drive-root drift is
  closed there too without touching its callers.
- **D-7** — The drive-root drift is resolved towards "a drive root contains its children"
  (`isInside('C:\\', 'C:\\x')` is true) everywhere; target.ts's protected dirs are never a drive
  root in practice, so its verdicts do not change.
- **D-8 (AC5)** — Only `mods/map-presence.ts`'s `isFile` is an exact duplicate and is replaced by
  the fs-utils import; the other copies keep a one-line reason at the site because each differs
  on purpose (lstat + rethrow, injected fs seam, sync write, unique tmp, symlink refusal).
- **D-9** — The AC2 grep and the AC6 doc wording are pinned by a guard test, so neither regresses
  silently after this story.

## Plan

1. D1 — `isInside(root, target)` in `src/main/lib/fs-utils.ts`, platform-selected path module,
   shared case-fold helper; table tests for win32 and linux via `stubPlatform`.
2. D2 — `app.ts` `isAllowedRevealTarget` calls `isInside`; `app.test.ts` proves the refusals on
   both platforms and that inside-root targets still pass.
3. D3 — the three `isInsideDir` copies and `isStrictlyInside` go through `isInside`; guard test
   for the AC2 grep and the AC6 doc; ARCHITECTURE.md paragraph names `isInside`.
4. D4 — `absolutePathSchema` gets the absoluteness regex, an honest doc comment, a new shared test;
   stale "(non-empty, NUL-free)" comments in callers are corrected.
5. D5 — fs-helper duplicates: `map-presence.ts` imports `isFile`; the deliberate copies get a
   one-line reason comment.

Order: D1 first (everything uses it); D2, D3, D4, D5 are independent afterwards. Full `npm test`
after D5. No IPC channel, renderer, i18n or changelog change (internal hardening only; the refusal
key `app.error.pathNotAllowed` already exists).

## Deliverables

- **D1 — `isInside` exists and is tested on both platforms.** In `src/main/lib/fs-utils.ts` add
  `export function isInside(root: string, target: string): boolean`: choose
  `const p = process.platform === 'win32' ? win32 : posix` (from `node:path`) **inside the
  function**, not at module load; `p.resolve` both; fold case with the pathKey rule (lowercase
  unless `process.platform === 'linux'`) — extract that rule from `pathKey` (line ~91) into a
  private `foldCase(value)` both use, without changing `pathKey`'s output; `rel = p.relative(r, t)`;
  return `rel === ''` or (`rel !== '..'`, `!rel.startsWith('..' + p.sep)`, `!p.isAbsolute(rel)`).
  Do **not** test `rel.startsWith('..')` alone — a child named `..foo` is inside. Doc comment:
  lexical check, callers that need symlink safety realpath first. Tests in
  `src/main/lib/fs-utils.test.ts`, a `describe('isInside')` run once under
  `stubPlatform('win32')` and once under `stubPlatform('linux')` (`src/test-support/platform.ts`;
  never touch `process.platform` directly — `scripts/platform-assertions.test.mjs` enforces it),
  each with its platform's paths: `<root>\..\x` false, `<root>\a\..\b` true, `Quake2-other\x`
  false for root `Quake2`, trailing separator on root and on target, drive root `C:\` containing
  `C:\x` (win32) / `/` containing `/x` (linux), other drive `D:\x` false (win32), target equal to
  root true, `..foo` child true, case-differing child true on win32 and false on linux.
- **D2 — the reveal check uses `isInside`.** In `src/main/ipc/app.ts` replace the `normalize` /
  `startsWith` body of `isAllowedRevealTarget` with `roots.some((root) => isInside(root, target))`
  (root first — the old helpers took the child first). Extend `setup()` in
  `src/main/ipc/app.test.ts` with an optional `installations` list (`{ rootPath }`) and add, under
  `describe('app:revealPath')`, for each of `stubPlatform('win32')` (root `C:\Games\Quake2`) and
  `stubPlatform('linux')` (root `/games/quake2`): `<root>/../<x>` refused, `<root>-other/<x>`
  refused, the root's _parent_ refused (`app.error.pathNotAllowed`), and `<root>/baseq2` allowed.
  Keep the existing two tests green.
- **D3 — one containment rule in main, pinned.** Delete the local `isInsideDir` in
  `src/main/modules/mods/remove.ts` (~91), `src/main/modules/mods/update-job.ts` (~148) and
  `src/main/modules/downloads/bootstrap/target.ts` (~84) and call `isInside(parent, child)` —
  note the argument order flips; rewrite each call, do not alias. Rebuild `isStrictlyInside` in
  `src/main/modules/mods/install-job.ts` (~197) as `isInside(parent, child) && pathKey(child) !==
pathKey(parent)`, export unchanged. Drop now-unused `sep` imports. In `docs/ARCHITECTURE.md`'s
  "**Paths are never trusted.**" paragraph (~line 82) add one sentence: every "is this path inside
  that folder" decision in main goes through `isInside` (`src/main/lib/fs-utils.ts`) — resolved,
  `path.relative`-based, case-folded. Add `src/main/lib/containment-guard.test.ts` that reads files
  under `src/main` (skip `*.test.ts`) and fails on `function isInsideDir` or `startsWith(normalize(`,
  and asserts the ARCHITECTURE.md paragraph contains `isInside`. Existing `remove.test.ts`,
  `update-job.test.ts`, `install-job.test.ts`, `target.test.ts` stay green.
- **D4 — `absolutePathSchema` checks what it says.** In `src/shared/schemas.ts` add a refine with
  a regex (no `node:path`; `src/shared` stays node-free): `^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|/)`,
  message `'path must be absolute'`. Rewrite the doc comment to list exactly what is accepted
  (drive letter + separator, UNC, leading `/`) and rejected (empty, NUL, relative, bare `C:`).
  New `src/shared/schemas.test.ts`: accepts `C:\x`, `c:/x`, `\\server\share\x`, `/home/x`; rejects
  `''`, `relative\x`, `./x`, `..\x`, `C:x`, `C:`, a NUL-containing path. Correct the stale
  "(non-empty, NUL-free)" wording in `src/shared/modules/replays.ts` (~631) and
  `src/main/modules/downloads/schemas.ts` (~253, ~264). Run the full `npm test` — any fixture that
  sent a relative path through this schema is a finding to fix at the fixture, not a reason to
  loosen the regex.
- **D5 — fs-helper duplicates are gone or explained.** `src/main/modules/mods/map-presence.ts`
  (~53): delete the local `isFile`, import it from `src/main/lib/fs-utils.ts` (same semantics:
  `stat`, false on any error). Add a one-line `// Not fs-utils' X: <reason>` comment above each
  deliberate copy: `mods/update-job.ts` `exists` (~154; lstat, rethrows non-ENOENT),
  `replays/demo-rename.ts` `exists` (~74; injected fs seam), `downloads/engine/rollback-job.ts`
  `listFilesRecursive` (~348; swallows read errors, relative forward-slash paths),
  `mods/install-job.ts` `collectFiles` (~219; throws, refuses symlinks), `replays/session-cvar-restore.ts`
  `writeAtomic` (~135; injected fs, tmp cleanup), `replays/playback-channel/windows-channel.ts`
  `writeAtomic` (~139; sync, per-pid tmp). No behaviour change; `map-presence.test.ts` and the full
  `npm test` stay green.

## Model Hints

- D1 → deliverable-hard — the one new security-relevant path rule: win32 drive roots, cross-drive
  `path.relative` returning an absolute path, the `..foo` vs `..` boundary and darwin's
  posix-path-but-case-folded rule must all be right while the native `node:path` ignores the
  platform stub.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/lib/fs-utils.test.ts` › "isInside on win32 …" / "isInside on linux …"
  (one `it` per case listed in D1, both platform blocks).
- AC2 → unit `src/main/lib/containment-guard.test.ts` › "no local containment copy is left under
  src/main" (D3); call-site behaviour by the existing `remove.test.ts`, `update-job.test.ts`,
  `install-job.test.ts`, `target.test.ts`.
- AC3 → unit `src/main/ipc/app.test.ts` › "app:revealPath on win32 refuses <root>\\..\\x, a
  sibling-prefix root and the root's parent" and "app:revealPath on linux refuses <root>/../x, a
  sibling-prefix root and the root's parent" (D2). No user action — IPC-level, so no e2e.
- AC4 → unit `src/shared/schemas.test.ts` › "absolutePathSchema accepts drive, UNC and posix
  absolute paths" and "absolutePathSchema rejects relative, drive-relative, empty and NUL paths" (D4).
- AC5 → unit `src/main/modules/mods/map-presence.test.ts` (existing suite) plus the full
  `npm test` green (D5).
- AC6 → unit `src/main/lib/containment-guard.test.ts` › "ARCHITECTURE.md names isInside as the
  path rule" (D3).

Coverage: AC1→D1, AC2→D3, AC3→D2, AC4→D4, AC5→D5, AC6→D3.

## Done

<!-- Filled by /build 199. -->
