---
id: 157
title: I rename a demo and its notes move with it
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

`2026-09-26-2130-q2dm1.dm2` tells nobody anything; `final-vs-tom.dm2` does. A user renames a demo
from the launcher, and its sidecar ([[146]]) is renamed with it, so the notes never get separated
from the file (concept `docs/concepts/demo-browser.md` §3, §8.1, DEMO-14). From the user's point of
view it is one step: either both are renamed, or neither is.

The rename target is the second renderer-supplied value that touches the filesystem (§14): a
**name**, not a path — schema-validated and resolved inside the demo's own folder by main.

## Acceptance Criteria

- [x] **AC1** — The user renames a demo from its detail view; the demo file and, if present, its
      sidecar (`<new name>.json`) are both renamed.
- [x] **AC2** — If either rename fails, both files end up with their original names, and the user
      sees the reason.
- [x] **AC3** — The new name is validated in main: no path separators, no `..`, no characters or
      reserved names invalid on Windows, a length cap; the demo's extension (incl. `.gz`) is kept.
- [x] **AC4** — A name that already exists in the folder (for the demo or its sidecar) is rejected
      with its reason; nothing is overwritten.
- [x] **AC5** — After a rename the list shows the demo under its new name without losing its parsed
      facts or selection.
- [x] **AC6** — Renaming the demo that is currently playing is blocked, with the reason shown to the
      user.
- [x] **AC7** — When the renamed name no longer matches the autorecord pattern that produced the old
      name facts (date, players), those facts are written into the sidecar at rename time so they
      are not lost.

## Open Questions

- [x] ~~**Q1 — Rename while playing** (§17.13): blocked with the reason, or allowed?~~ answered →
      Decisions (Sprint)
- [x] ~~**Q2 — Name facts after rename** — a renamed file no longer matches its autorecord pattern;
      should the old name facts (date, players) be kept, e.g. by writing them into the sidecar?~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Renaming a demo that is currently playing (remote-control session) is blocked with a
  visible reason ("Cannot rename while playing") — see AC6.
- **(User)** Name facts that would otherwise be lost because the new name no longer matches the
  original autorecord pattern are preserved by writing them into the sidecar at rename time — see
  new AC7.
- **Input is the stem, the extension is fixed.** The user edits only the part before the demo's
  own extension (`.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`, matched case-insensitively, kept in its
  original case), which is shown as a fixed suffix; a typed stem that already ends in that
  extension has it stripped once — reason: AC3 says the extension is kept, and letting the user
  type it invites `final.dm2.dm2`.
- **Validation rules (AC3)**, one pure shared function used by main (authoritative) and the dialog
  (inline feedback): trimmed stem non-empty; no `/` or `\`; no `..` anywhere; none of `<>:"|?*`
  or control characters U+0000–U+001F; no trailing `.` or space; the part before the first `.`
  is not a Windows device name (CON, PRN, AUX, NUL, COM1–9, LPT1–9, case-insensitive); stem at
  most 100 characters — reason: this is the Windows-invalid set, applied on Linux too so a name
  stays portable, and 100 keeps `<stem>.mvd2.gz.json` far below 255 and deep demo folders below
  MAX_PATH.
- **The validator is new, not extracted** from `src/shared/config/profile-files.ts` or
  `src/main/modules/downloads/paths.ts` — reason: both sanitize/refuse to a much narrower
  ASCII set that would reject legitimate names like `finale vs tom`, and touching them is
  collateral change.
- **Collision check (AC4)** stats `<new file>` and `<new file>.json` in the demo's folder right
  before renaming and rejects if either exists — also when the demo has no sidecar, because a
  stray `<new>.json` would otherwise silently attach itself to the renamed demo; a target whose
  `pathKey` equals the source's (case-only rename on Windows) is not a collision — reason:
  `fs.rename` overwrites silently on both platforms, so the check is the only thing standing
  between the user and a lost file; the check-then-rename window is accepted on a single-user
  desktop.
- **Identical name** (same file name) returns the unchanged row without touching disk; the dialog
  disables Save for it — reason: nothing to do is not an error.
- **Order and rollback (AC2/AC7):** (1) if facts must be preserved, write the merged sidecar at
  the old path through the existing sidecar store, remembering the original sidecar bytes (or its
  absence); (2) rename the demo; (3) rename the sidecar if one exists; any failure undoes the
  completed steps in reverse (rename back, restore original bytes or remove the created sidecar)
  and returns the reason; if an undo step itself fails, a distinct `rollbackFailed` error names
  the files as they now are — reason: writing before renaming keeps the write inside the existing
  store (which resolves by the old id), and an honest "could not undo" beats a false "nothing
  changed".
- **Which facts are preserved (AC7):** every sidecar-storable field — `date`, `sides` (players),
  `map`, `gamemode` — whose effective value before the rename came from the `name` source
  (`resolveEffectiveValues` in `src/shared/demos/effective-values.ts`) and whose effective value
  after the rename (same inputs, new name facts) would differ, is written into the sidecar with the
  before value; `date` as `new Date(ms).toISOString()`; `pov`/`host` have no sidecar field and are
  not preserved — reason: reusing the precedence resolver preserves exactly what the user saw, and
  the sidecar schema is [[146]]'s, not this story's to extend.
- **Broken sidecar + facts to preserve** → the rename is rejected with a reason (fix or replace
  the sidecar first); a broken sidecar without facts to preserve is renamed as-is — reason:
  [[147]] forbids overwriting a broken sidecar without the user's confirmation, and dropping the
  facts silently would violate AC7.
- **"Currently playing" (AC6)** is a new in-memory registry in the replays main module
  (`begin(id)`/`end(id)`/`isPlaying(id)`), keyed by demo id; nothing registers into it until
  playback lands in S28 ([[159]]) — reason: no per-demo playback signal exists yet, and
  `LaunchService.isRunning()` would block every rename while any game runs, which is not what the
  user decided.
- **Rename while a scan runs** is rejected with a reason — reason: a running scan replaces the
  index snapshot with rows discovered before the rename and would resurrect the old path/id.
- **Archive entries** are rejected in main by this handler; the disabled control with its visible
  reason is [[158]]'s — reason: the guard belongs with the handler, the UI wording to the story
  that owns it.
- **Id churn (AC5):** the demo id is derived from its path, so a rename yields a new id; main
  patches its in-memory index (snapshot row, `id → file` map, cache entry re-keyed and persisted)
  and returns the new row; the renderer replaces the old row and moves the selection to the new
  id — reason: AC5 forbids a rescan-shaped loss of facts or selection, and the cache holds size +
  mtime, which `rename` does not change.
- **AC2 and AC6 are not driven through the real UI**: AC2's failure needs a filesystem fault
  mid-operation, and AC6 needs a playing demo, which has no trigger before [[159]]; both are
  unit-tested in main (real temp dir, fault injected only at the failing step) plus a renderer
  test that the returned reason is shown, while the e2e flow proves the reason display path with a
  main-side rejection (AC4) — reason: the P1 rule's "missing trigger" case; [[159]]'s flow should
  add the AC6 e2e step once playback exists.

## Plan

1. **Shared validator** — `src/shared/replays/demo-rename.ts`: `demoExtension(fileName)` and
   `validateDemoRename(stem, currentFileName) → { ok: true, fileName } | { ok: false, reason,
params? }`, reasons mapping 1:1 to `replays.rename.error.<reason>` keys.
2. **Index patch + playing registry** — `scan-service.ts` gets `applyRename(oldId, newAbsolutePath,
newFileName)`; `discovery.ts` exports its id derivation; new `playback-sessions.ts` registry.
3. **Rename service + handler** — `src/main/modules/replays/demo-rename.ts` orchestrates guards →
   validation → collision → fact preservation → renames with rollback → index patch; contract
   `demoRename` in `src/shared/modules/replays.ts`; wired in `src/main/modules/replays/index.ts`.
4. **Renderer** — `RenameDemoDialog.tsx` (mirror `modules/config/RenameProfileDialog.tsx`),
   "Rename" in the detail panel's file actions ([[155]]/[[156]]), row replace + re-select, i18n,
   and the `replays-rename` ui flow.

Order: D1 → D2 → D3 → D4. See `## Decisions (Sprint)` for every rule.

## Deliverables

- [ ] **D1 — Pure rename-name validator.** New `src/shared/replays/demo-rename.ts` (shared layer:
      no node, no DOM, no electron) exporting `demoExtension(fileName: string): string` (the
      trailing `.dm2`/`.mvd2`/`.dm2.gz`/`.mvd2.gz`, matched case-insensitively, returned in the
      file's original case) and `validateDemoRename(stem: string, currentFileName: string)` →
      `{ ok: true; fileName: string } | { ok: false; reason: DemoRenameReason; params?: Record<string,
string | number> }`. Rules, in this order: trim; strip the demo's own extension once if the
      stem ends with it (case-insensitive); `empty`; `separator` (`/` or `\`); `dotDot` (`..`
      anywhere); `invalidChar` (any of `<>:"|?*` or U+0000–U+001F, `params: { char }`);
      `trailingDotOrSpace`; `reserved` (part before the first `.` is CON, PRN, AUX, NUL, COM1–9,
      LPT1–9, case-insensitive, `params: { name }`); `tooLong` (stem > 100 chars, `params: { max:
100 }`). `fileName` = stem + original extension. Export `DEMO_RENAME_MAX_STEM = 100` and the
      `DemoRenameReason` union. Tests in `src/shared/replays/demo-rename.test.ts`: one case per
      reason, extension kept for all four extensions incl. mixed case (`FINAL.DM2.GZ`), typed
      extension stripped once, a name with spaces and a single inner dot accepted.
- [ ] **D2 — Index patch and playing registry.** (a) `src/main/modules/replays/discovery.ts`:
      export the existing file-id derivation (`idFor(pathKey(absolutePath))`) as
      `demoIdForPath(absolutePath: string): string` and use it at the existing call sites (no
      behaviour change). (b) `src/main/modules/replays/scan-service.ts`: add
      `applyRename(oldId: string, newAbsolutePath: string, newFileName: string):
Promise<DiscoveredDemo | undefined>` to `ReplaysScanService` — computes the new id via
      `demoIdForPath`, replaces the row in `snapshot` (new `id`, `fileName`, name facts re-matched
      with the current `nameMatcher()` through the same `withNameFacts` path `runScan` uses, all
      parsed facts and `fileTime` kept), moves the `fileById` entry (new `absolutePath`,
      `fileName`), re-keys the `lastCache` entry to the new id and persists it with
      `cache.write`; returns `undefined` for an unknown id; also expose `isScanning(): boolean`
      (the existing `running` flag). (c) New `src/main/modules/replays/playback-sessions.ts`:
      `createPlaybackSessions()` → `{ begin(id), end(id), isPlaying(id) }` over an in-memory
      `Set` (doc comment: populated by playback in S28 / story 159). Tests: extend
      `src/main/modules/replays/scan-service.test.ts` (after a scan, `applyRename` returns the new
      row with new id and file name and unchanged parsed facts; `read()` and `resolveFile(newId)`
      reflect it, `resolveFile(oldId)` is `undefined`; a second service reading the written cache
      gets a cache hit for the new id) and new `playback-sessions.test.ts` (begin/end/isPlaying).
- [ ] **D3 — Rename service and `demo.rename` handler.** Contract in
      `src/shared/modules/replays.ts`: `REPLAYS_HANDLERS.demoRename = 'demo.rename'`, payload
      schema `{ id: <existing demo-id schema>, name: z.string().max(255) }`, response
      `{ demo: DiscoveredDemo }` (mirror `sidecarWrite`'s entry). New
      `src/main/modules/replays/demo-rename.ts`: `createDemoRename({ scan, sidecars, sessions,
nameMatcher, fs? })` → `rename(id, name): Promise<Outcome<{ demo: DiscoveredDemo }>>`,
      errors as `fail('replays.rename.error.<reason>', params)`. Steps: unknown id →
      `unknownDemo`; archive entry → `archiveEntry`; `sessions.isPlaying(id)` → `playing`;
      `scan.isScanning()` → `scanning`; demo file gone → `demoMissing`; `validateDemoRename` (D1)
      → its reason; same file name → `ok` with the unchanged row, no disk access; `stat` of
      `<dir>/<new>` / `<dir>/<new>.json` exists and its `pathKey` differs from the source's →
      `exists` / `sidecarExists` (`params: { name }`). Fact preservation: read the sidecar
      (`sidecars.read(id)`); run `resolveEffectiveValues` (`src/shared/demos/effective-values.ts`)
      with the current name facts and with `nameMatcher().match(newFileName)`; every field of
      `date`/`sides`/`map`/`gamemode` whose before-source is `'name'` and whose after-value
      differs is merged into the sidecar fields (`date` as `new Date(ms).toISOString()`); a
      broken sidecar with something to preserve → `sidecarBroken`. Then, with rollback of every
      completed step in reverse on any failure: (1) if something is preserved, remember the
      original sidecar bytes or their absence and `sidecars.write(id, merged)`; (2) `fs.rename`
      demo; (3) `fs.rename` sidecar if present. Failure → `renameFailed` (`params: { code }`);
      EACCES/EPERM/EROFS → `notWritable` (`params: { folder }`); an undo step that fails →
      `rollbackFailed` (`params: { demo, sidecar }` = current file names). On success
      `scan.applyRename(...)` and return its row. Wire in `src/main/modules/replays/index.ts`
      (create the sessions registry there, `handle(REPLAYS_HANDLERS.demoRename, …)` like
      `sidecarWrite`). Tests in `src/main/modules/replays/demo-rename.test.ts` against a **real
      temp dir** (fault injected only at the failing step): renames demo + sidecar, and demo
      without sidecar (no `.json` created); fails on the 2nd rename → both original names and the
      original sidecar bytes back, error key returned; failing undo → `rollbackFailed`; each
      guard key (unknown, archive, playing, scanning, validation reason, exists, sidecarExists
      with no own sidecar); target file byte-identical after an `exists` rejection;
      r1q2-autorecord-named demo renamed to a plain name → sidecar gains `date` and keeps
      existing fields; a players template (`{p1}_vs_{p2}`) → sidecar gains `sides`; a broken
      sidecar + facts → `sidecarBroken`, nothing renamed; case-only rename allowed.
- [ ] **D4 — Rename dialog, detail-panel trigger and flow.** `src/renderer/src/modules/replays/
client.ts`: `renameDemo(id, name)` over `REPLAYS_HANDLERS.demoRename` (mirror the existing
      `callModule` wrappers). New `src/renderer/src/modules/replays/RenameDemoDialog.tsx`
      mirroring `src/renderer/src/modules/config/RenameProfileDialog.tsx` (props `demo`,
      `onClose`, `onRenamed(demo)`; `Modal` + `Field`/`Input`, Enter submits): the stem input
      prefilled with the current stem, `demoExtension()` shown as a visible fixed suffix,
      `validateDemoRename` (D1) run on every change with its reason inline via `Field error`
      (`t('replays.rename.error.<reason>', params)`, pattern from
      `modules/config/components/RenameActionDialog.tsx`), Save disabled while invalid or
      unchanged; a failed `Outcome` shows `t(error.key, error.params)` inline and keeps the dialog
      open. Add a "Rename" button to the file-actions area of the demo detail side panel built by
      [[155]]/[[156]] under `src/renderer/src/modules/replays/` (`data-testid="demo-rename"`,
      dialog `demo-rename-dialog`, input `demo-rename-input`, save `demo-rename-save`, error
      `demo-rename-error`); on success replace the row whose id was the old id with the returned
      row in the view's list state and set the selection to the new id, then reload the detail's
      sidecar for the new id. i18n in `src/renderer/src/i18n/locales/en.json` under
      `replays.rename.*` (title, label, suffix hint, save, cancel, one `error.<reason>` per D1 and
      D3 reason; `playing` reads "Cannot rename while playing") — edit preserving the file's
      existing encoding. Tests: `RenameDemoDialog.test.tsx` (inline reason + Save disabled for an
      invalid stem; a failed outcome with `replays.rename.error.playing` and one with
      `replays.rename.error.renameFailed` show their text; success calls `onRenamed`), and new
      flow `scripts/flows/replays-rename.mjs` mirroring `scripts/flows/alias-rename-dialog.mjs` +
      `scripts/flows/replays-name-templates.mjs`: the flow writes its **own** files into
      `INSTALL_ONE_ID`'s `baseq2/demos` (a `2026-09-26-2130-q2dm1.dm2` with the fixture demo
      content plus a valid sidecar with a description, and a `taken.dm2`), refreshes, selects the
      demo, and removes all of them at the end (flows never reseed). Flow steps, named exactly:
      "an invalid name shows its reason and blocks saving" (`bad/name`), "a taken name is
      rejected and nothing is overwritten" (`taken` → `demo-rename-error` visible, `taken.dm2`
      bytes unchanged), "renames the demo and its sidecar" (`final-vs-tom`), "the renamed row
      keeps its facts and selection" (row shows the new name, map unchanged, still selected),
      "the name date moves into the sidecar" (sidecar JSON on disk has `date` + the original
      description; the detail shows the date with source "sidecar").

## Model Hints

- D3 → deliverable-hard — the new write path renames two files and optionally rewrites a sidecar
  with a reverse-order rollback across three fallible steps, where a missed undo leaves the demo
  and its notes separated on disk; it also crosses the precedence resolver, the sidecar store's
  broken-sidecar guard ([[147]]) and the index patch from D2.
- Review: → story-review-hard — a rollback that restores the file names but leaves the
  preserved-facts sidecar rewritten (or a freshly created `<old>.json` behind), or a collision
  check done with a case-sensitive directory listing instead of `stat` + `pathKey`, passes tests
  that only assert file names and reads plausibly in a default review.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-rename.mjs` › step "renames the demo and its sidecar" (disk:
  `final-vs-tom.dm2` + `.dm2.json` exist, old names gone); unit
  `src/main/modules/replays/demo-rename.test.ts` › "renames a demo and its sidecar" and "renames
  a demo without a sidecar and creates none"
- AC2 → unit `src/main/modules/replays/demo-rename.test.ts` › "a failed sidecar rename restores
  both names and the original sidecar", "a failed undo reports rollbackFailed", "a failed sidecar
  rename removes the sidecar step 1 created when there was none before", "a failed demo rename
  undoes the preserved-facts sidecar write" (both sub-cases), "a transient error snapshotting an
  existing sidecar aborts before anything is written"; renderer
  `src/renderer/src/modules/replays/RenameDemoDialog.test.tsx` › "a failed outcome with
  replays.rename.error.playing shows its text" and "...renameFailed shows its text"; the
  real-surface reason display is proven by the AC4 flow step (failure needs a mid-operation
  filesystem fault the UI cannot trigger — see Decisions)
- AC3 → unit `src/shared/replays/demo-rename.test.ts` (one case per reason, extension-kept
  cases); unit `demo-rename.test.ts` › "main rejects an invalid name even without the dialog";
  e2e `scripts/flows/replays-rename.mjs` › step "an invalid name shows its reason and blocks
  saving"
- AC4 → e2e `scripts/flows/replays-rename.mjs` › step "a taken name is rejected and nothing is
  overwritten"; unit `demo-rename.test.ts` › "an existing target name is refused", "an existing
  target sidecar is refused even when the demo has none of its own", "target file byte-identical
  after an exists rejection", "a case-only rename is not a collision"
- AC5 → e2e `scripts/flows/replays-rename.mjs` › step "the renamed row keeps its facts and
  selection"; unit `src/main/modules/replays/scan-service.test.ts` › "re-keys the row, file
  lookup and cache to the new id/name, without touching disk"; unit `demo-rename.test.ts` › "a
  scan swap before the index update still answers with the renamed row"
- AC6 → unit `demo-rename.test.ts` › "a demo that is playing is refused"; renderer
  `RenameDemoDialog.test.tsx` › "a failed outcome with replays.rename.error.playing shows its
  text"; unit `src/main/modules/replays/playback-sessions.test.ts` › "isPlaying is false
  initially, true after begin, false after end"; e2e gap: no playback trigger before [[159]],
  whose flow should add the step
- AC7 → e2e `scripts/flows/replays-rename.mjs` › step "the name date moves into the sidecar"
  (sidecar JSON has `date` and the original description; detail shows the date sourced from the
  sidecar); unit `demo-rename.test.ts` › "an autorecord-named demo renamed to a plain name keeps
  its date in the sidecar", "a players-template demo renamed away keeps its players as sides",
  "a broken sidecar with facts to preserve refuses the rename and touches nothing"

## Done

Implemented rename-with-rollback for a demo + its sidecar across 4 deliverables (shared
validator, scan-index patch + playback registry, the rename service/handler, the renderer dialog

- flow), then a review-fix cycle on the hard-tier findings below.

Commit message:

```
157: I rename a demo and its notes move with it
```

Verification: narrow gate. `npm run build`, `npm run typecheck` green. `npx vitest run
--changed HEAD` green (1771 tests, up from 1766 after the review-fix cycle added 5 rollback
coverage cases). `npm run ui:flow -- replays-rename` green, all 5 steps passed (a first run
failed at step 1 on a real bug — see Decisions — fixed before the narrow gate was called done).
AC → test mapping verified as listed above; AC6's e2e gap is real and accepted (no playback
trigger exists before story [[159]]), not silently dropped.

Decisions made while building (verified against the plan + ACs):

- The build's own e2e run surfaced three real bugs, fixed before verification could pass: a
  flow selector scoped `demo-rename-save` under the dialog's content div when `Modal` renders
  `footer` as a sibling (fixed the flow); `DemoDetailPanel`'s title `<h2>` had an `id` but no
  matching `data-testid` (added it); and a genuine AC5 regression — renaming a demo that was
  only visible via an active search-filter match caused it to immediately deselect once the
  filter no longer matched the new name (fixed with a "pinned row id" in `ReplaysView.tsx` that
  keeps the just-renamed row visible until the next explicit filter change, row click or panel
  close).
- The hard-tier (`story-review-hard`) review found and this cycle fixed three further issues in
  `src/main/modules/replays/demo-rename.ts`: (1) a transient sidecar-read error (EBUSY/EPERM) was
  indistinguishable from "no sidecar", risking the rollback's own cleanup deleting a real,
  pre-existing sidecar on a later fault — now only ENOENT/ENOTDIR count as absence, anything else
  aborts before any write; (2) a non-null assertion after `scan.applyRename` could crash the
  renderer on a narrow scan-swap race (files already renamed on disk by that point) — now falls
  back to a best-effort row instead of asserting; (3) two of the three rollback/undo code paths
  had no test coverage (facts preserved + no original sidecar + step-2/step-3 failure) — 5 new
  cases added.
- Test-title wording in this file's `## Acceptance Tests` above was corrected to the tests'
  actual names (the refine-time text was descriptive, not verbatim); no test itself was
  weakened, retitled test coverage is identical or broader than planned.

Gap carried forward (named, not silently dropped): AC2's "mid-operation filesystem fault" and
AC6's "rename while playing" are unit-tested in main only, per the story's own Decisions — no
real-UI trigger exists yet for either. Story [[159]] (S28, playback) should add the AC6 e2e step
once playback lands.

tiers: D 4 / hard 1 · review default+hard · cycles 2 · agents 11
