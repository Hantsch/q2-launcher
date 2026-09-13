---
id: 094
title: An installation can be removed from disk
status: done
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) (INST-X1–X3) closes the last open
part of Phase 4 M1: today removing an installation only removes its entry from the library,
never the files on disk. Since the launcher now creates installation folders itself (the
bootstrap wizard, retail import, updates), entry-only removal is no longer enough. Removal
from disk requires a confirmation that shows the path, and is locked for installations whose
`source` is Steam, GOG or Epic — the launcher must never dismantle a store-managed game
folder; those keep entry-only removal with a note that the store uninstalls the game.

## Acceptance Criteria

- [x] **AC1** — Removing an installation whose `source` is not a store offers a choice between
      entry-only removal and removal from disk.
- [x] **AC2** — Choosing removal from disk shows a confirmation naming the exact path that will
      be deleted before anything happens.
- [x] **AC3** — Confirming deletes the installation's own folder and everything inside it, and
      nothing outside that folder.
- [x] **AC4** — An installation whose `source` is Steam, GOG or Epic offers entry-only removal
      only, with a note that the store uninstalls the game — there is no removal-from-disk
      option to select.
- [x] **AC5** — Removal from disk on an installation whose game is currently running waits per
      [[091]]'s guard, or is refused with that reason, rather than deleting files out from under
      a running process.
- [x] **AC6** — After removal from disk, the installation no longer appears anywhere in the
      library, rail or dashboard — the same end state entry-only removal already produces.
- [x] **AC7** — A removal that fails partway (e.g. a locked file) leaves the library entry in
      place with a readable reason, rather than silently succeeding or losing track of the
      installation.

## Decisions (Sprint)

- **No new IPC channel — `installations:remove` finally honours its reserved `deleteFromDisk`
  flag** (`src/shared/types/installation.ts:178`, schema `src/shared/ipc-schemas.ts:86`, today
  hard-rejected in `src/main/services/installations.ts:340`). Reason: the contract for this story
  was already declared in step 1 and reserved for exactly this module, so adding a second channel
  would duplicate it.
- **Deletion is a direct main-side operation, not a `Job`.** Reason: unlike download/copy jobs
  there is nothing to resume, cancel-with-cleanup or show progress for, and INST-J1's
  "no second progress mechanism" argues against, not for, a job here.
- **AC5 is answered as a refusal, not a wait.** Removal from disk of an installation whose game is
  running fails with a readable running-game reason (091's error key/predicate if it exposes one,
  otherwise a local check against `LaunchService.getState()`), and the UI disables the disk option
  while that installation runs — the same shape [[090]] chose for its AC7. Reason: AC5 explicitly
  allows the refusal, and "wait, then delete the folder the user is looking at minutes later" is
  the wrong semantics for a destructive one-shot action; the story therefore only depends on
  [[091]] at the acceptance level, not on its internals.
- **The running check is injected, not a new service dependency:** an optional
  `isRunning?: (id: string) => boolean` in `InstallationsDeps`, bound in `src/main/context.ts` to
  the (later-constructed) `LaunchService`. Reason: `InstallationsService` is deliberately
  launch-agnostic and constructed before `LaunchService`; a callback keeps it unit-testable
  without booting Electron, the way `onRemoved` already does.
- **`fs.rm(root, { recursive: true, force: true })`, not `shell.trashItem`.** Reason: the point of
  the action is reclaiming the disk space of a multi-GB game folder; moving it to the Recycle Bin
  would report success while freeing nothing. `fs.rm` also unlinks symlinks instead of following
  them, which is what AC3's "nothing outside that folder" needs.
- **Safety fence before the first unlink** (AC3): canonicalize `rootPath`
  (`canonicalizePath`, `src/main/lib/fs-utils.ts:71`), then refuse when it is not an existing
  directory, is a drive/filesystem root or has fewer than two path segments, equals or contains
  the app's `userData` dir, equals the user's home dir, or is an ancestor of (or equal to) another
  registered installation's canonical root (`pathKey`, `fs-utils.ts:85`). Reason: every one of
  these would delete something the user did not point at, and the story's whole risk is exactly that.
- **Store-managed sources are locked in main *and* in the UI**, via one shared predicate
  (`isStoreManaged(source)` in `src/shared/types/installation.ts`) covering `steam`, `gog`, `epic`
  **and `bethesda`**. Reason: AC4 enumerates the three the concept names, and `bethesda` is the
  same class of store-managed folder in the existing `InstallationSource` union — locking it too
  satisfies AC4 and closes the obvious hole; `manual`, `retail`, `created` and `unknown` stay
  removable.
- **Order of operations: files first, entry second** (AC6/AC7). The library entry is only removed
  after the folder is gone; a failed/partial delete returns the failure and leaves the entry (and
  `activeInstallationId`) exactly as it was. Reason: AC7 requires precisely this, and the reverse
  order would orphan a folder the launcher no longer knows about.
- **The dialog becomes a chooser, and `confirmBeforeRemoving: false` can only skip it where there
  is nothing to choose.** For a removable installation the remove action always opens
  `RemoveInstallationDialog`; for a store-managed one (single possible outcome, entry-only) the
  setting keeps today's skip-the-confirm behaviour. Reason: AC1 must hold in both settings states,
  and a choice between two different outcomes — one irreversible — cannot be silently pre-answered.
- **Disk removal is opt-in inside that dialog and confirms in a second step** that names the exact
  canonical path in a danger-toned block, with a `Delete folder` confirm button; no typed-name
  gate. Reason: AC2 asks for a confirmation showing the path, and the repo has no typed-confirm
  pattern anywhere (`DeleteProfileDialog.tsx` etc. are plain danger confirms) — inventing one here
  would be a UI deviation this story does not need.
- **Failure surfacing reuses the existing path:** `toastError` in
  `src/renderer/src/store/useLauncher.ts:349` already renders a failed removal's error key, so
  AC7's "readable reason" is new i18n keys (`installations.error.deleteFromDisk*`), not new
  plumbing. The now-dead `installations.error.deleteFromDiskUnsupported` key is removed with its
  rejection.

## Open Questions

None.

## Plan

1. **Shared** — `isStoreManaged(source)` predicate in `src/shared/types/installation.ts`; retire
   the "reserved / rejected" comment on `RemoveInstallationInput.deleteFromDisk`.
2. **Main, delete side** — new `src/main/services/installation-removal.ts`: canonicalize + safety
   fence + `fs.rm` recursive, returning `Outcome<null>` with the specific error keys.
3. **Main, policy side** — `InstallationsService.remove` honours `deleteFromDisk`: store-managed
   refusal → running-game refusal → folder delete → existing entry removal (incl.
   `activeInstallationId` fallback and `onRemoved` icon teardown). `isRunning` dep wired in
   `src/main/context.ts`.
4. **Renderer** — `RemoveInstallationDialog.tsx` becomes a chooser with the disk confirm step and
   the store note; `LibraryView.tsx` always opens it for removable installations; i18n keys.
5. **E2e** — a store-source fixture installation + `scripts/flows/installation-remove-from-disk.mjs`
   covering both branches, the on-disk result and the running-game refusal (via the existing
   dev-only `dev:simulateLaunch` channel from [[090]]).

Order: D1 → D2 → D3 → D4. D3 may start once D1 exists.

## Deliverables

- [x] **D1 — Safe folder deletion (main).** `src/main/services/installation-removal.ts` +
  `installation-removal.test.ts`, `src/shared/types/installation.ts` (`isStoreManaged`),
  error keys in `src/renderer/src/i18n/locales/en.json`. Mirror `src/main/lib/fs-utils.ts` for the
  path helpers (`canonicalizePath`, `pathKey`, `isDirectory`) and `installations.ts`'s
  `ok`/`fail` Outcome style. *Acceptance (tmp-dir tests):* deletes a folder tree including nested
  dirs and read-only-ish files; refuses a drive root, a one-segment path, the `userData` dir, the
  home dir, a missing path, and a root that contains another registered installation's root, each
  with its own error key and before touching anything; a symlink inside the folder is unlinked, its
  target outside survives; a failing unlink (injected) surfaces as a failure, not a silent success.
  Proves AC3 and AC7's main half.
- [x] **D2 — Removal policy in the service.** `src/main/services/installations.ts` (`remove`,
  `InstallationsDeps.isRunning`), `src/main/context.ts`, `src/shared/types/installation.ts`
  (comment on `deleteFromDisk`), `src/main/services/installations.test.ts`,
  `src/renderer/src/i18n/locales/en.json` (drop `deleteFromDiskUnsupported`). Mirror the existing
  `remove` body for entry teardown and `onRemoved` for the injected-callback pattern.
  *Acceptance:* `deleteFromDisk: true` on a store-managed source (steam/gog/epic/bethesda) fails
  with the store key and deletes nothing; on a running installation fails with the running key and
  deletes nothing; on a removable one calls the D1 deleter, then removes the entry, reassigns
  `activeInstallationId` and runs `onRemoved`; when the deleter fails the entry, the active id and
  the icon are all still there; `deleteFromDisk` absent/false behaves exactly as today.
  Proves AC4 (main), AC5 (main), AC6 (main) and AC7's entry-kept half.
- [x] **D3 — The chooser dialog and its trigger.**
  `src/renderer/src/components/installations/RemoveInstallationDialog.tsx` (+
  `RemoveInstallationDialog.test.tsx`, jsdom), `src/renderer/src/views/LibraryView.tsx`,
  `src/renderer/src/store/useLauncher.ts` (pass `deleteFromDisk`),
  `src/renderer/src/i18n/locales/en.json`. Mirror `DeleteProfileDialog.tsx` for the danger-confirm
  idiom and `ActionBar.tsx:257` for the launch-state gate. *Acceptance:* a removable installation's
  dialog offers both outcomes; choosing disk removal shows a second step naming `rootPath` before
  any invoke happens; confirming invokes `installations:remove` with `deleteFromDisk: true`; a
  store-managed installation shows only entry-only removal plus the "the store uninstalls the game"
  note and has no disk option in the DOM; the disk option is disabled while that installation's
  game runs; `data-testid`s for the flow. Proves AC1, AC2, AC4 (UI), AC5 (UI).
- [x] **D4 — Offline end-to-end proof.** `scripts/lib/fixture.mjs` (one `source: 'steam'`
  installation, and a sentinel file in a sibling folder next to the removable install's root),
  `scripts/flows/installation-remove-from-disk.mjs`, `docs/UI-VERIFICATION.md`. Mirror
  `scripts/flows/retail-upgrade.mjs` (on-disk assertions + `dev:simulateLaunch` seeding).
  *Acceptance:* `npm run ui:flow -- installation-remove-from-disk` walks the real surface: the
  removable installation offers both outcomes, the confirm step shows its path, confirming makes
  the folder disappear from disk while the sibling sentinel survives, and the installation is gone
  from library, rail and dashboard; the steam installation offers entry-only removal with the store
  note and no disk option; with `dev:simulateLaunch` the disk option is refused/disabled with the
  running-game reason. No network access. Proves AC1, AC2, AC3 (on disk), AC4, AC5, AC6.

## Model Hints

- `D1 → deliverable-hard` — it is the one irreversible recursive `fs.rm` in the codebase: a
  mis-canonicalized root, a missed ancestor check or a followed symlink deletes a user's data
  outside the installation folder, and no test after the fact can undo it.
- D2, D3, D4: default tier.
- `Review: → story-review-hard` — the story ships destructive filesystem code whose central
  criterion (AC3's "nothing outside that folder") and whose store lock (AC4) are negative
  requirements a diff-blind cheap review nods through.

## Acceptance Tests

- AC1 → e2e `npm run ui:flow -- installation-remove-from-disk`
  (`scripts/flows/installation-remove-from-disk.mjs`) › "AC1: reopen the remove dialog and assert
  both outcomes are offered", plus unit
  `src/renderer/src/components/installations/RemoveInstallationDialog.test.tsx` › "AC1: a removable
  installation offers both outcomes"
- AC2 → e2e `scripts/flows/installation-remove-from-disk.mjs` › "AC2: choose removal from disk and
  assert the confirm step names the exact path", plus unit `RemoveInstallationDialog.test.tsx` ›
  "AC2: the disk confirm step names the rootPath and invokes nothing before its own confirm"
- AC3 → unit `src/main/services/installation-removal.test.ts` › "AC3: the installation folder and
  its contents are gone and nothing outside it is touched" and › "AC3: a root that is a drive root,
  the userData dir, the home dir or an ancestor of another installation is refused", plus the
  on-disk assertion in `scripts/flows/installation-remove-from-disk.mjs` › "AC3: the installation
  folder is gone, and the sibling sentinel survives untouched"
- AC4 → unit `src/main/services/installations.test.ts` › "AC4: removal from disk is refused for a
  %s installation and deletes nothing" (parametrized over steam/gog/epic/bethesda), plus e2e
  `scripts/flows/installation-remove-from-disk.mjs` › "AC4: the store note is shown, and there is
  no disk option in the DOM at all" (and its entry-only removal regression check right after)
- AC5 → unit `src/main/services/installations.test.ts` › "AC5: removal from disk of a running
  installation is refused with the running-game reason and deletes nothing", plus e2e
  `scripts/flows/installation-remove-from-disk.mjs` › "AC5: the disk option is disabled, with a
  non-empty reason, while the game runs", plus unit `RemoveInstallationDialog.test.tsx` › "AC5: the
  disk option is disabled while this installation is running"
- AC6 → e2e `scripts/flows/installation-remove-from-disk.mjs` › "AC6: the installation is gone from
  the library" and › "AC6: the installation is gone from the rail" (the dashboard's own tiles -
  `ConfigProfilesTile`/`PlaytimeTile` - are aggregate and name no specific installation, so there is
  nothing dashboard-side for this criterion to check; the flow's own header comment records this),
  plus unit `src/main/services/installations.test.ts` › "AC6: a successful disk removal drops the
  entry, moves the active installation and tears down the icon"
- AC7 → unit `src/main/services/installations.test.ts` › "AC7: a failed folder deletion keeps the
  entry, the active id and the icon, and returns a readable error key", plus unit
  `src/main/services/installation-removal.test.ts` › "AC3: a failing delete surfaces as a failure
  instead of a silent success" (named AC3 in that file - it proves the same "no silent success"
  half of both AC3 and AC7, D1 predates the per-AC test-naming convention D2 onward uses)

## Done

Removal from disk is implemented end to end: a chooser dialog offers entry-only vs. delete-from-disk
for any non-store installation, confirms the exact path before deleting, and a new main-side safety
fence (`deleteInstallationFolder`) refuses drive roots, the launcher's own userData dir, the user's
home dir, and any overlap with another registered installation before ever calling `fs.rm`.
Store-managed installations (steam/gog/epic/bethesda, one shared `isStoreManaged` predicate) and
installations whose own game is running (reusing story 091's `InstallationWriteGuard.isBlockedFor`,
refusal rather than a wait - a destructive one-shot action is not queued) get no disk option at all.
Files are deleted before the library entry is dropped, so a refusal or a failed delete leaves the
entry, the active-installation id and the stored icon untouched.

Commit message: `094: an installation can be removed from disk`

### Verification

- `npm run typecheck` — clean (both `tsconfig.node.json`/`tsconfig.web.json`).
- `npm test` — 216 test files, 3845 passed, 1 pre-existing skip. (One run mid-story hit an unrelated
  flaky timeout in `src/main/modules/config/core/import-reader.test.ts`, a pre-existing perf test
  untouched by this story; it passed in isolation and on the final full-suite run.)
- `npm run build` — clean.
- `npm run ui:flow -- installation-remove-from-disk` — green, run twice (once after D4, once again
  after the review-fix cycle touched `RemoveInstallationDialog.tsx`/`useLauncher.ts`/`installations.ts`).
- Code review (`story-review-hard`, per Model Hints): verdict **PASS** with 1 must-fix + 3 minor
  findings, all four fixed and re-verified (see Decisions below).
- AC → test mapping, as verified (see `## Acceptance Tests` above for exact names): AC1-AC7 each
  have a passing unit and/or e2e test; no `manual residue`.

### Decisions

- **Review finding fixed - wrong success toast on disk deletion.** The pre-094 toast
  (`installations.toast.removed`) reassures "the files are still on disk", which became false for a
  successful `deleteFromDisk: true` removal. Added `installations.toast.removedFromDisk` and had
  `useLauncher.removeInstallation` pick between the two by whether `deleteFromDisk` was requested.
- **Review finding fixed - fail-open safety-fence default.** `InstallationsService`'s `userDataDir`/
  `homeDir` deps defaulted to `''` when unset, which `canonicalizePath` resolves to `process.cwd()` -
  a caller that forgot to wire them would get a silently-wrong guard instead of a loud failure. Now
  `remove()` refuses with a new `installations.error.deleteFromDiskMisconfigured` key before calling
  the deleter when either is empty, keeping every other existing test fixture free of having to
  supply values it never uses.
- **Review finding fixed - tautological AC6 test.** `installations.test.ts`'s harness gave every
  fixture installation the same hardcoded `rootPath`, so the "successful disk removal" test's
  `otherInstallationRoots` assertion compared the deleted installation's root against itself - a
  combination the real safety fence would refuse as a self-overlap. The harness now derives a
  distinct `rootPath` per id, and the assertion checks the exact forwarded object (`rootPath`,
  `otherInstallationRoots`, `userDataDir`, `homeDir`) instead of `expect.any(String)`.
- **Review finding fixed - mid-dialog running-game race.** `RemoveInstallationDialog` disabled the
  "remove from disk" *option* while the game runs, but not the confirm step's submit button if the
  game started running after the disk step was already open. Main already refused this server-side
  (no data-loss risk), but the UI could still let a doomed submit through. The footer's confirm
  button is now also disabled in that combination.
- **AC6's "dashboard" half has no dedicated assertion.** The dashboard's two tiles
  (`ConfigProfilesTile`, `PlaytimeTile`) are aggregate and name no specific installation, so there is
  nothing dashboard-side that could still show a removed installation - the e2e flow's header
  comment records this instead of asserting a no-op. Library and rail are asserted directly.
- **D1's own tests predate the per-AC naming convention D2 onward uses**: `installation-removal.test.ts`
  labels its "no silent success on a failing delete" test `AC3:` rather than `AC7:`, even though it
  also proves half of AC7. Left as-is (renaming would only be cosmetic) and cross-referenced in
  `## Acceptance Tests` above.
- No `manual residue`: every acceptance criterion has a real, passing automated test at unit and/or
  e2e level.
