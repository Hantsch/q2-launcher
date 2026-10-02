---
id: 209
title: modules reach Electron and the harness only through the shell
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module to be testable without an Electron stub and loadable without
the downloads module, so that the seam `modules/types.ts` describes ("a module never touches
`ipcMain`, `BrowserWindow` or the state file directly") is true, the UI-harness switch has one
definition, and shared infrastructure lives in the shell instead of in one module.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F27, F28, F26):

- Six module files import `electron` directly (`shell`, `app`, `clipboard`, `screen`);
  `replays/index.ts` calls `app.getMainWindow()` then `getContentBounds`/`getZoomFactor`/
  `screen.getDisplayMatching` although `AppContext.mainWindow` (the observer) exists for exactly
  this; the "record under harness, else call shell" branch is copy-pasted in `ipc/app.ts`,
  `mods/index.ts` and `replays/index.ts`; mods reads `electronApp.getPath('userData')` although
  `userDataDir()` exists.
- The harness gate (13 `Q2L_UI_*` variables) is spelled three ways (`IS_UI_HARNESS`,
  `process.env[UI_HARNESS_ENV] === '1'`, `isUiHarnessEnabled({ isDev })`) — one already differs
  in whether it combines `isDev` — and modules read `process.env` directly.
- mods (14 imports across 6 files), servers (3) and replays (1) import downloads' internals:
  `stage-package`, `manifest-service`, `harness`, `extractor`, `paths`, `electronNetFetch`,
  `resolveExtractorPath`. What is shared is infrastructure, not downloads domain.

Depends on story 208 (the architecture test that keeps this true).

## Acceptance Criteria

- [ ] **AC1** — `AppContext` gains an `os` service (`openPath`, `showItemInFolder`,
      `openExternal`, `copyText`) that owns the harness-record branch once; the three copies are
      gone.
- [ ] **AC2** — `MainWindowSnapshot` carries `zoomFactor`, `bounds` and display info (or a small
      `app.displays` service); `getMainWindow` is removed from `AppContext` (it stays a
      `DialogService` constructor dep); replays' stage code reads the snapshot.
- [ ] **AC3** — A frozen `app.harness` object is resolved once at boot in `context.ts` from
      `process.env`; `window-shared.ts`, `ipc/index.ts` and every module read it from there;
      `process.env` reads under `src/main/modules/` are zero (architecture test), with the
      pre-ready read in `index.ts` and `dialog.ts` as the documented exemptions.
- [ ] **AC4** — `from 'electron'` under `src/main/modules/` is zero (architecture test).
- [ ] **AC5** — The infrastructure mods/servers/replays import from downloads is hoisted to
      shell-owned locations (`src/main/lib/net/`, `src/main/lib/archive/`,
      `src/main/services/package-staging.ts` or equivalents) and downloads imports them like every
      other module; the cross-module allowlist from story 208 has no `→ downloads` entries left.
- [ ] **AC6** — Module index tests for replays and mods no longer mock `electron`.

## Open Questions

- [ ] **Q1** — Does `stagePackage` move with story 220 (which changes it) or with this one? Land
      220 first if both are in one sprint.

## Plan

<!-- Filled by /refine 209. -->

## Deliverables

<!-- Filled by /refine 209. -->

## Model Hints

<!-- Filled by /refine 209. -->

## Acceptance Tests

<!-- Filled by /refine 209. -->

## Done

<!-- Filled by /build 209. -->
