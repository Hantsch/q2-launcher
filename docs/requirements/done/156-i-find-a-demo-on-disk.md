---
id: 156
title: I find a demo on disk
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user wants to send a demo to a friend, upload it, or open its folder. From any demo they can
reveal it in the system file manager or copy its path (concept `docs/concepts/demo-browser.md` §3,
§13, DEMO-20). Both work on Windows and Linux through `shell.showItemInFolder` and the clipboard.

## Acceptance Criteria

- [x] **AC1** — "Reveal in file manager" opens the system file manager with the demo file selected,
      on Windows and Linux.
- [x] **AC2** — "Copy path" puts the demo's absolute path on the clipboard and confirms it visibly.
- [x] **AC3** — For an archive entry ([[143]]), both actions act on the archive file itself: "reveal"
      selects the archive in the file manager, "copy path" copies the archive's absolute path (the
      entry has no path of its own on disk).
- [x] **AC4** — Both handlers take the demo's id, never a path; main resolves the path from its
      index.
- [x] **AC5** — A demo whose file vanished since the last scan reports that visibly instead of
      revealing nothing.

## Open Questions

- [x] ~~**Q1 — Archive entries** — reveal the archive; copy the archive path, or `archive.zip!entry`?~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Archive entries: both "reveal" and "copy path" act on the archive file itself, not an
  `archive.zip!entry`-style path — that path isn't openable/pasteable outside this app.
- Two new module handlers `demos.reveal` / `demos.copyPath` in `REPLAYS_HANDLERS`, not the core
  `app:revealPath` / `app:copyText` — those take a renderer-supplied path/text, and AC4 forbids the
  renderer from ever holding the path to send.
- The clipboard is written **in main** (`electron.clipboard.writeText`) by `demos.copyPath`, and
  the path never crosses IPC — a loose file's `absolutePath` is deliberately main-only
  (`discovery.ts` `DiscoveredDemoFile`), and returning it would open that up for no gain.
- Both handlers resolve through `scanService.resolveFile(id)` and use its `absolutePath`, which for
  an archive entry already _is_ the archive's own path — so AC3 needs no special branch, only a test.
- Payload is `{ demoId }` with `replaysDemoIdSchema`, `.strict()` — same id primitive and strictness
  as `sidecar.write`, so an extra `path` key is rejected rather than silently stripped (AC4).
- Result is a domain union `{ ok: true } | { ok: false; reason: 'unknownDemo' | 'fileMissing' }`
  nested in the transport `Outcome`, mirroring `ExtraFoldersResult` — the module's existing refusal
  style; the renderer maps `reason` to an i18n key.
- "Vanished" (AC5) = `fs.stat` fails with `ENOENT`/`ENOTDIR`; any other stat error does not block
  the action — only a missing file is the state AC5 names, and a permission error still has a real,
  revealable path.
- The existence check applies to **both** actions — copying the path of a file that is gone would
  confirm success for something the user can no longer use.
- Under the UI-harness gate (`isUiHarnessEnabled`), `demos.reveal` records the path to
  `userData/ui-harness-revealed.json` instead of calling `shell.showItemInFolder`, mirroring
  `recordHarnessExternalUrl` — an e2e run must not open real Explorer/Nautilus windows on the
  desktop, and the flow needs something to assert against.
- The actions live in 155's detail side panel as a small `DemoFileActions` component (concept §10:
  "Detail / edit … file actions (reveal, copy path, rename)"); 157's rename joins the same spot.
- Success of "Copy path" is confirmed by the existing `pushToast` success toast (ServerRow's copy
  pattern); a failure (`fileMissing` / `unknownDemo`) is persistent inline `role="alert"` text in
  the actions area — a vanished file is a state to read, not an event that should time out.
- No platform-disabled state: `shell.showItemInFolder` and the clipboard work on Windows and Linux
  (concept §13), so both controls are enabled on both.

## Plan

1. **Contract** (`src/shared/modules/replays.ts`): add `demosReveal: 'demos.reveal'` and
   `demosCopyPath: 'demos.copyPath'` to `REPLAYS_HANDLERS`, one strict `{ demoId }` payload
   schema, the `DemoFileActionResult` union, and both entries in `REPLAYS_HANDLER_SCHEMAS`.
   `REPLAYS_PATH_PAYLOAD_HANDLERS` stays `['extraFolders.add']`.
2. **Main** (`src/main/modules/replays/file-actions.ts`, new): a pure-ish factory with injected
   `resolveFile`, `stat`, `reveal`, `writeClipboard`; registered in `replays/index.ts` next to the
   sidecar store. Harness recorder `recordHarnessRevealedPath` in `src/main/lib/ui-harness.ts`.
3. **Renderer**: two client functions, a `DemoFileActions` component (two buttons + inline alert),
   mounted in 155's detail panel; i18n keys in `en.json`.
4. **Acceptance flow** `scripts/flows/replays-demo-file-actions.mjs`: loose demo, zip entry and a
   vanished file, against the real app, reading back the harness reveal file and the real clipboard.

Order: D1 → D2. D2 needs 155's detail panel to exist (build order 155 before 156).

## Deliverables

- [ ] **D1 — `demos.reveal` / `demos.copyPath` in the contract and main, id-addressed**
  - `src/shared/modules/replays.ts`: add `demosReveal: 'demos.reveal'`, `demosCopyPath:
'demos.copyPath'` to `REPLAYS_HANDLERS` (with doc comments); add
    `replaysDemoFileActionSchema = z.object({ demoId: replaysDemoIdSchema }).strict()`; add
    `export type DemoFileActionResult = { ok: true } | { ok: false; reason: 'unknownDemo' | 'fileMissing' }`;
    register both handlers in `REPLAYS_HANDLER_SCHEMAS`. Do **not** add them to
    `REPLAYS_PATH_PAYLOAD_HANDLERS`.
  - `src/main/modules/replays/file-actions.ts` (new): `createDemoFileActions({ resolveFile, stat,
reveal, writeClipboard })` returning `{ reveal(id), copyPath(id) }`, both `Promise<DemoFileActionResult>`.
    Each: `resolveFile(id)` → `undefined` ⇒ `{ ok: false, reason: 'unknownDemo' }`; `stat(absolutePath)`
    rejecting with `code` `ENOENT`/`ENOTDIR` ⇒ `{ ok: false, reason: 'fileMissing' }` (any other stat
    error: proceed); else call `reveal(absolutePath)` / `writeClipboard(absolutePath)` and return
    `{ ok: true }`. Use `absolutePath` as-is — for an archive entry it is already the archive file's
    own path; never build an `archive!entry` string. The path is never part of the return value.
  - `src/main/modules/replays/index.ts`: create it next to `createSidecarStore` with
    `resolveFile: (id) => scanService.resolveFile(id)`, `stat` from `node:fs/promises`,
    `writeClipboard: (p) => clipboard.writeText(p)`, and `reveal`: if
    `isUiHarnessEnabled({ isDev: app.isDev })` then `recordHarnessRevealedPath(p)` else
    `shell.showItemInFolder(p)`. Register both with `handle(...)` and the new schema.
  - `src/main/lib/ui-harness.ts`: add `HARNESS_REVEALED_PATHS_FILE = 'ui-harness-revealed.json'`,
    `harnessRevealedPathsFilePath()` and `recordHarnessRevealedPath(path, { filePath? })` — same
    append-to-JSON-array shape as `recordHarnessExternalUrl` (reuse its read helper).
  - Tests: `src/main/modules/replays/file-actions.test.ts` (new, fakes for all four deps) and a
    case in the existing `src/main/lib/ui-harness.test.ts` (create beside it if absent) for the
    recorder; schema cases next to the existing replays contract test (`src/shared/modules/replays.test.ts`
    or wherever `REPLAYS_HANDLER_SCHEMAS` is iterated today). Names are in `## Acceptance Tests`.
  - Mirror: `sidecarStore` wiring in `replays/index.ts:129-144`; `recordHarnessExternalUrl` and its
    gate use in `src/main/ipc/app.ts:58-70`.

- [ ] **D2 — "Reveal in file manager" / "Copy path" in the demo detail panel, plus its flow**
  - `src/renderer/src/modules/replays/client.ts`: `revealDemo(demoId)` and `copyDemoPath(demoId)`,
    both `Promise<Outcome<DemoFileActionResult>>` via `callModule('replays', REPLAYS_HANDLERS.demosReveal|demosCopyPath, { demoId })`
    (nested Outcome, like `addExtraFolder`).
  - `src/renderer/src/modules/replays/components/DemoFileActions.tsx` (new): props `{ demoId }`;
    two buttons, testids `replays-demo-reveal` and `replays-demo-copy-path`, visible text labels
    (i18n). Copy success ⇒ `useLauncher(s => s.pushToast)` success toast `replays.fileActions.pathCopied`
    (mirror `src/renderer/src/modules/servers/ServerRow.tsx:65-74`). Any failure (inner
    `ok: false` or transport error) ⇒ persistent inline text, testid `replays-demo-file-action-error`,
    `role="alert"`: `fileMissing` ⇒ `replays.fileActions.fileMissing` ("This demo's file is no longer
    on disk — rescan to update the list."), `unknownDemo` ⇒ `replays.fileActions.unknownDemo`,
    transport error ⇒ its own `LocalizedMessage`. The alert clears on the next action or a
    `demoId` change. Semantic tokens only; existing `Button`/`IconButton` atoms, default size.
  - Mount `<DemoFileActions demoId=… />` in the file-actions area of the detail side panel story 155
    added under `src/renderer/src/modules/replays/` (find it by 155's detail testid).
  - `src/renderer/src/i18n/locales/en.json`: `replays.fileActions.{reveal,copyPath,pathCopied,fileMissing,unknownDemo}`.
  - Test `src/renderer/src/modules/replays/components/DemoFileActions.test.tsx` (new, mocked client).
  - Flow `scripts/flows/replays-demo-file-actions.mjs` (new; mirror `replays-zip-entries.mjs`'s
    `setup`/`teardown` + selectors, and `about-release-notes.mjs:98` for reading the harness file
    from `variantUserDataDir('populated')`, `downloads-tab.mjs:247` for
    `app.evaluate(({ clipboard }) => clipboard.readText())`). `setup()`: write `pack.zip`
    (`writeReplaysZipPackArchive`) and copy one loose fixture demo to a throwaway `vanish-156.dm2`
    in the same demos folder; `teardown()`: remove both. Steps named as in `## Acceptance Tests`;
    the vanished case deletes `vanish-156.dm2` after the list rendered, then clicks Reveal.
    Add a short section for it in `docs/UI-VERIFICATION.md` next to the other replays flows.
  - `CHANGELOG.md`: one `### Added` line.

## Model Hints

- D1 → default. D2 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/file-actions.test.ts` › "reveal hands the resolved absolute
  path to the reveal dependency"; unit `src/main/lib/ui-harness.test.ts` › "recordHarnessRevealedPath
  appends each revealed path"; e2e `scripts/flows/replays-demo-file-actions.mjs` (flow
  `replays-demo-file-actions`) › step "reveal on a loose demo records that demo's absolute path".
- AC1 (real window) → manual residue: that the OS file manager (Explorer / the Linux FileManager1
  implementation) actually opens with the file selected happens outside the Electron app; the flow
  stops at the harness-recorded `showItemInFolder` argument so no real window opens on the desktop.
- AC2 → unit `file-actions.test.ts` › "copyPath writes the resolved absolute path to the clipboard
  and never returns it"; unit `DemoFileActions.test.tsx` › "a successful copy shows the path-copied
  toast"; e2e `replays-demo-file-actions` › step "copy path on a loose demo puts its absolute path on
  the clipboard and shows a confirmation".
- AC3 → unit `file-actions.test.ts` › "an archive entry reveals and copies the archive file's own
  path"; e2e `replays-demo-file-actions` › step "reveal and copy path on a pack.zip entry act on
  pack.zip itself".
- AC4 → unit `file-actions.test.ts` › "an unknown id is refused as unknownDemo without touching the
  shell or clipboard"; unit (replays contract test) › "demos.reveal and demos.copyPath reject a
  payload carrying a path" and "no demo file action is a path-payload handler".
- AC5 → unit `file-actions.test.ts` › "a vanished file is refused as fileMissing for both actions";
  unit `DemoFileActions.test.tsx` › "fileMissing shows a persistent inline alert"; e2e
  `replays-demo-file-actions` › step "reveal on a vanished demo shows the file-missing alert and
  reveals nothing".

## Done

Added id-addressed `demos.reveal`/`demos.copyPath` (main resolves the path via
`scanService.resolveFile`, never trusting a renderer-supplied path), a `DemoFileActions` component
(two buttons + persistent inline alert) mounted into 155's `DemoDetailPanel`, and the acceptance
flow `replays-demo-file-actions`.

Commit message: `156: I find a demo on disk`

Verification — narrow gate: `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD`
(138 files / 1950 passed, 3 skipped, 0 failed) green; e2e `npm run ui:flow -- replays-demo-file-actions`
green after a fix cycle (see Decisions). AC1–AC5 walked against `## Acceptance Tests`: every named
unit test found, ran and passed; every e2e step ran and passed. AC1's "a real OS file manager
actually opens" half stays `manual residue` per the story's own Decisions (harness records the
`showItemInFolder` argument instead).

Review: default-tier PASS, no findings. No hard-tier stage (`Review: → default`).

Decisions made during implementation (beyond `## Decisions (Sprint)`):

- `DemoDetailPanel.tsx` had no existing "file-actions area" (the Plan's reference to one was
  aspirational) — added `<div data-testid="replays-detail-file-actions">` between the known-fields
  `<dl>` and the sidecar-issues block, without renaming any existing testid.
- Verification's first e2e run failed on two bugs in the new flow script (not the app): a
  Playwright strict-mode violation from two stacked "Path copied" toasts matching the same text
  locator (fixed with `.last()`), and the vanished-demo row not rendering because the demo list is
  virtualized (fixed by filtering via `replays-filter-search` first, the same pattern
  `replays-filter-search.mjs` already uses). Both fixed in one cycle; no app code touched.

No blockers.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 5

Narrow gate only. The full regression gate (`npm test`, `npm run ui:verify`, `npm run ui:flows`)
has not run — it is the sprint's, after the last story.
