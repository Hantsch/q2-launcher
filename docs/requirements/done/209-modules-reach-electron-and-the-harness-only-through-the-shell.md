---
id: 209
title: modules reach Electron and the harness only through the shell
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module to be testable without an Electron stub and loadable without
the downloads module, so that the seam `modules/types.ts` describes ("a module never touches
`ipcMain`, `BrowserWindow` or the state file directly") is true, the UI-harness switch has one
definition, and shared infrastructure lives in the shell instead of in one module.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F27, F28, F26):

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

- [x] **AC1** — `AppContext` gains an `os` service (`openPath`, `showItemInFolder`,
      `openExternal`, `copyText`) that owns the harness-record branch once; the three copies are
      gone.
- [x] **AC2** — `MainWindowSnapshot` carries `zoomFactor`, `bounds` and display info (or a small
      `app.displays` service); `getMainWindow` is removed from `AppContext` (it stays a
      `DialogService` constructor dep); replays' stage code reads the snapshot.
- [x] **AC3** — A frozen `app.harness` object is resolved once at boot in `context.ts` from
      `process.env`; `window-shared.ts`, `ipc/index.ts` and every module read it from there;
      `process.env` reads under `src/main/modules/` are zero (architecture test), with the
      pre-ready read in `index.ts` and `dialog.ts` as the documented exemptions.
- [x] **AC4** — `from 'electron'` under `src/main/modules/` is zero (architecture test).
- [x] **AC5** — The infrastructure mods/servers/replays import from downloads is hoisted to
      shell-owned locations (`src/main/lib/net/`, `src/main/lib/archive/`,
      `src/main/services/package-staging.ts` or equivalents) and downloads imports them like every
      other module; the cross-module allowlist from story 208 has no `→ downloads` entries left.
- [x] **AC6** — Module index tests for replays and mods no longer mock `electron`.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Does `stagePackage` move with story 220 (which
  changes it) or with this one?

## Decisions (Sprint)

- **Q1 stagePackage:** it moves in 209, unchanged in behaviour, to
  `src/main/services/package-staging.ts` (with `getExtractDir` taken out of `pipeline.ts`), and 220
  extends it there — S32's build order runs 209 before 220, so 220 then edits one shell file instead
  of a module internal.
- **Harness shape:** `resolveUiHarness(env)` in `src/main/lib/ui-harness.ts` returns a frozen
  `UiHarness { enabled, offscreen, read(name) }`; the gate (`enabled`, `offscreen`) is computed once,
  but `read(name)` looks a `Q2L_UI_*` fixture variable up in the env object it was given at call time
  (and answers `undefined` whenever the gate is off) — three flows set fixture variables inside the
  running main process via `app.evaluate()` (`bootstrap-retail-import.mjs:509`,
  `retail-upgrade.mjs:197`, `replays-cinema-unavailable.mjs:83`), so a value snapshot would break them.
- **Harness helpers take the harness:** `resolveDownloadSource`, `resolveNewsSource`,
  `uiHarnessLanTargets`, `uiHarnessPickedFolders`, `resolveDetectedRetailSourcesOverride`,
  `discoveryHomeDir`/`scanHoldMs` and friends take a `UiHarness` instead of `{ isDev, env }` with a
  `process.env` default, and `isUiHarnessEnabled` is deleted — that is what makes the gate one
  definition instead of a fourth spelling.
- **Non-harness OS variables:** `AppContext.env` is a frozen copy of `process.env` taken at boot with
  every `Q2L_` key removed, for `SystemRoot`, `ProgramFiles`, the Linux session variables and the
  like — AC3 demands zero `process.env` reads under modules, and stripping `Q2L_` keeps the harness
  reachable only through `app.harness`.
- **Other boot facts on AppContext:** `isPackaged: boolean` and `userDataDir: string` join
  `AppContext`, so modules stop calling `electronApp.isPackaged`/`getPath('userData')` and the replays
  and mods index tests (AC6) need no `electron` mock.
- **`os` service:** `openPath`/`showItemInFolder` record via `recordHarnessRevealedPath` and
  `openExternal` via `recordHarnessExternalUrl` under the harness; `copyText` always writes the real
  clipboard — that is today's behaviour of all three copies, and config's and home's currently
  ungated `shell` calls simply gain the same harness branch.
- **Displays:** `MainWindowSnapshot` gains `zoomFactor`, `bounds` (outer window bounds) and
  `displayId`, and a shell `app.displays` service (`src/main/services/displays.ts`) owns `screen`
  (`primary()`, `all()`, `dipToScreenRect(rect, 'main' | null)` with the scale-factor fallback
  replays carries today) — replays needs whole-desktop geometry, which a window snapshot alone
  cannot carry.
- **Cinema window and the harness:** `createAppContext` takes a `createCinemaWindow(harness)`
  factory instead of a ready `CinemaWindow`, so the cinema window reads the same `app.harness` the
  context resolved instead of `window-shared.ts`'s module-scope constants.
- **Where downloads' infrastructure goes:** fetcher + verify + download-cache paths →
  `src/main/lib/net/`; extractor + `7za-path` → `src/main/lib/archive/`; `stagePackage` →
  `src/main/services/package-staging.ts`; manifest service + manifest parse + manifest schemas +
  `DownloadSource` → `src/main/services/content/`; `readEngineState`/`writeEngineState` →
  `src/main/services/engine-state.ts`; `plannedDestination`/`moveFile` → `src/main/lib/fs-utils.ts`;
  the URL/sha256 schema primitives → `src/shared/schemas.ts` — every file mods/servers/replays
  import today then has a shell owner, and nothing in it is downloads domain.
- **One ManifestService stays two instances here:** 209 only moves the class; making it one
  injected instance is story 220 AC4, which builds on the moved file.
- **`@shared/modules/downloads` type imports stay:** mods importing `DownloadsErrorKey`/
  `PackageSource` from the shared contract is not a cross-module import, so AC5 does not touch it.
- **AC4 scope:** "`from 'electron'` is zero" counts non-test source under `src/main/modules/`;
  module tests other than the replays/mods index tests (AC6) may still `vi.mock('electron')` because
  shell libs they load still import it.
- **No changelog entry:** nothing changes for a user.

## Plan

1. **Shell boot facts (D1):** `resolveUiHarness(env)` + `bootEnv()` in lib; `AppContext` gains
   `harness`, `env`, `isPackaged`, `userDataDir`; `window-shared.ts`, `window.ts`,
   `cinema-window.ts`, `ipc/index.ts`, `context.ts` read `app.harness`; `isUiHarnessEnabled` callers
   in the shell move over. Pre-ready reads in `index.ts` and `dialog.ts` stay, commented as exemptions.
2. **`app.os` (D2):** `src/main/services/os.ts` owns the harness-record branch; `ipc/app.ts` uses it.
3. **`app.displays` + richer snapshot (D3):** observer snapshot gains `zoomFactor`/`bounds`/
   `displayId`; `services/displays.ts` wraps `screen`.
4. **Hoist downloads' infrastructure (D4a net/archive/staging, D4b content/engine-state/fs/schema
   primitives):** `git mv` + import rewrites; downloads imports the new homes like every module;
   208's cross-module allowlist loses its `→ downloads` entries and its spawn/network guard names the
   new homes.
5. **Replays onto the shell (D5, hard):** stage geometry/cinema/primary-display code reads
   `app.mainWindow.snapshot()` + `app.displays`; reveal/clipboard via `app.os`; harness via
   `app.harness`; OS vars via `app.env`; index test drops its `electron` mock; `getMainWindow`
   leaves `AppContext` (stays a `createAppContext` option for `DialogService`/displays).
6. **Every other module + the architecture assertions (D6):** mods, config, home, downloads,
   servers onto `app.os`/`app.harness`/`app.env`/`app.isPackaged`/`app.userDataDir`; mods index
   test drops its `electron` mock; `src/architecture.test.ts` gains the AC1/AC3/AC4/AC5/AC6
   assertions; ARCHITECTURE.md's module seam lists the new services.

Order: D1 → D2 → D3 → D4a → D4b → D5 → D6. Gate after each D: `npm run typecheck` + `npm test`.

## Deliverables

- **D1 — boot facts on `AppContext`: `harness`, `env`, `isPackaged`, `userDataDir`.**
  In `src/main/lib/ui-harness.ts` add `export interface UiHarness { readonly enabled: boolean;
readonly offscreen: boolean; read(name: UiHarnessVar): string | undefined }`, `UiHarnessVar` a
  union of every `Q2L_UI_*` name used in `src/main` (`Q2L_UI_HARNESS`, `_VISIBLE`, `_PICK_FOLDER`,
  `_PICK_FILES`, `_CONTENT_REPO_BASE`, `_HARNESS_STORE_SOURCES`, `_STEAM_EXECUTABLE`,
  `_DETECTED_RUNNERS`, `_LAN_TARGETS`, `_SESSION_TYPE`, `_CINEMA_DISPLAY`, `_UNLOCK_PUBLIC_KEY`, …
  — grep `Q2L_UI_` to complete it), and `resolveUiHarness(env: NodeJS.ProcessEnv): UiHarness`:
  `enabled = env.Q2L_UI_HARNESS === '1'` and `offscreen = enabled && env.Q2L_UI_VISIBLE !== '1'` are
  computed once; `read(name)` returns `enabled ? env[name] : undefined`, looked up **at call time** in
  the same env object (flows mutate fixture vars in the running process via `app.evaluate()`), and
  the returned object is `Object.freeze`d. Rewrite the shell-side helpers in this file
  (`uiHarnessPickedFolders`, `uiHarnessLanTargets`, detected-runner/steam overrides,
  `recordHarness*`) to take a `UiHarness` instead of `{ isDev, env }`. `isUiHarnessEnabled` stays
  exported for now, re-implemented as `resolveUiHarness(input.env ?? process.env).enabled`, because
  module callers still use it until D5/D6; D6 deletes it. A module call site of a rewritten helper
  that the compiler flags (e.g. `servers/index.ts`'s `uiHarnessLanTargets`) gets `app.harness` —
  that one-argument change only, nothing else in modules. Add `src/main/lib/boot-env.ts`: `bootEnv(env): Readonly<Record<string, string |
undefined>>` = frozen shallow copy with every key starting `Q2L_` removed. In
  `src/main/context.ts`: `AppContext` gains `harness: UiHarness`, `env`, `isPackaged: boolean`,
  `userDataDir: string`, resolved once in `createAppContext` (`resolveUiHarness(process.env)`,
  `bootEnv(process.env)`, `electronApp.isPackaged`, `userDataDir()`); `resolveUnlockPublicKeyPem`
  uses `harness.enabled`; `createAppContext`'s `cinemaWindow` option becomes
  `createCinemaWindow: (harness: UiHarness) => CinemaWindow`. `src/main/window-shared.ts`: drop
  `IS_UI_HARNESS`/`IS_UI_HARNESS_OFFSCREEN`; `rendererWebPreferences(harness)` takes it.
  `src/main/window.ts` reads `context.harness`; `src/main/cinema-window.ts`'s
  `createCinemaWindow(harness)`; `src/main/index.ts` passes the factory (its pre-ready
  occlusion-switch read at line ~51 stays, with a one-line comment "exempt: runs before
  `createAppContext`"); `src/main/ipc/index.ts` gates `registerDevIpc` on
  `app.isDev || app.harness.enabled`. `src/main/services/dialog.ts` keeps its own read with a
  comment "exempt: shipped security gate, story 066". Every fake `AppContext` in tests that the
  compiler flags gets the new fields (use `resolveUiHarness({})` for "off").
  Tests: `src/main/lib/ui-harness.test.ts` › "resolveUiHarness freezes the gate and reads fixture
  vars live" (gate off ⇒ `read` is `undefined` even if the var is set; mutating the env object after
  resolve changes `read` but not `enabled`; `Object.isFrozen`), and existing cases ported to the new
  signatures; `src/main/lib/boot-env.test.ts` › "the boot env carries no Q2L_ keys and is frozen".
  Flow (regression): `harness-offscreen`.
  Docs: `docs/UI-VERIFICATION.md` — where it describes the gate, name `resolveUiHarness`/
  `app.harness` and state that fixture vars are read live.

- **D2 — `app.os`: the one place that opens, reveals, copies and records under the harness.**
  New `src/main/services/os.ts`: `export interface OsService { openPath(p): Promise<string>;
showItemInFolder(p): void | Promise<void>; openExternal(url): Promise<void>; copyText(text): void }`
  and `createOsService({ harness, shell, clipboard })` (electron's `shell`/`clipboard` injected so the
  test needs no electron mock). Under `harness.enabled`: `openPath` and `showItemInFolder` call
  `recordHarnessRevealedPath(harness, p)` (and `openPath` resolves `''`), `openExternal` calls
  `recordHarnessExternalUrl(harness, url)`; never the shell. Outside the harness each delegates to
  the shell once. `copyText` always writes the clipboard (today's behaviour). Add `os: OsService` to
  `AppContext` in `src/main/context.ts`. `src/main/ipc/app.ts`: `app:openExternal`, `app:copyText`
  and `app:revealPath`'s reveal call go through `app.os` (the harness branch at line ~62 is deleted;
  `isAllowedRevealTarget` stays where it is). Update `src/main/ipc/app.test.ts` to a fake `os`.
  Tests: `src/main/services/os.test.ts` › "under the harness the os service records and never calls
  the shell" and › "outside the harness each call reaches the shell exactly once".

- **D3 — `app.displays` and a snapshot that carries zoom, bounds and display.**
  `src/main/main-window-observer.ts`: `MainWindowSnapshot` gains `zoomFactor: number`,
  `bounds: MainWindowBounds` (outer window bounds, same last-un-minimized rule as `contentBounds`)
  and `displayId: number`; `ObservedWindow` gains `getBounds()` and `getZoomFactor()` (index.ts
  adapts `win.webContents.getZoomFactor()`); `createMainWindowEvents` deps gain
  `displayFor(bounds): { id: number; scaleFactor: number }` replacing `scaleFactorFor`. New
  `src/main/services/displays.ts`: `export interface DisplaysService { primary(): DisplayInfo;
all(): DisplayInfo[]; dipToScreenRect(rect, window: 'main' | null): Rect }` with `DisplayInfo =
{ id, bounds, scaleFactor }`, built by `createDisplaysService({ screen, getMainWindow })` —
  `dipToScreenRect` uses `screen.dipToScreenRect(win|null, rect)` when it is a function, else
  multiplies by the matching display's (`'main'`) or primary display's (`null`) scale factor —
  exactly the fallback `src/main/modules/replays/index.ts` lines ~264-297 carries today (read it,
  do not change it yet). `src/main/context.ts`: `AppContext` gains `displays: DisplaysService`
  (the `createAppContext` option `getMainWindow` feeds `createDisplaysService` as well as
  `DialogService`); `src/main/index.ts` wires `screen`. `AppContext.getMainWindow` itself is
  removed in D5, together with its only module user.
  Tests: `src/main/main-window-observer.test.ts` › "the snapshot carries zoom factor, outer bounds
  and display id"; `src/main/services/displays.test.ts` › "dipToScreenRect uses the screen API when
  present and the display scale factor otherwise" and › "primary and all list the screen's
  displays".

- **D4a — hoist net, archive and staging out of downloads.** `git mv` (keep history) and rewrite
  imports, behaviour unchanged:
  `src/main/modules/downloads/fetcher.ts` → `src/main/lib/net/fetcher.ts` (with `FetchImpl`,
  `electronNetFetch`, `downloadPackage`); `downloads/verify.ts` → `src/main/lib/net/verify.ts`;
  `downloads/paths.ts` → `src/main/lib/net/download-cache-paths.ts`;
  `downloads/extractor.ts` → `src/main/lib/archive/extractor.ts`; `downloads/7za-path.ts` →
  `src/main/lib/archive/7za-path.ts` (same directory depth, so its `__dirname` walk still finds
  `resources/` — keep its test green and re-check the depth comment); `downloads/stage-package.ts`
  → `src/main/services/package-staging.ts`, with `getExtractDir` moved out of `downloads/
pipeline.ts` into it (pipeline imports it back) and `electronApp.isPackaged` replaced by an
  `isPackaged` input field/param supplied by the caller (`app.isPackaged`). Their `*.test.ts`
  move alongside. Rewrite every importer — downloads itself, `mods/index.ts`, `mods/install-job.ts`
  (+test), `mods/update-job.ts` (+test), `mods/map-presence.test.ts`, `servers/scan-service.ts`
  (+test), `servers/http-list-source.ts` (+test), `servers/source-resolution.ts` (+test),
  `replays/index.ts` (+`index.test.ts`, `demo-staging.test.ts`, `discovery.test.ts`,
  `zip-demos.test.ts`), and `vi.mock('../downloads/stage-package')` paths. In story 208's
  `src/architecture.test.ts` remove the cross-module allowlist entries these imports needed, and in
  `src/main/layering.test.ts` (208's moved spawn/network guard) add the new files to the allowlist
  with reason "story 209: shell-owned download/extract infrastructure". Mechanical: if a file
  needs a logic change to move, stop and report it.
  Tests: the moved suites pass unchanged (`lib/net/fetcher.test.ts`, `lib/archive/extractor.test.ts`,
  `services/package-staging` callers); `src/architecture.test.ts` › "a main module imports another
  module only through an allowlisted edge" stays green with the shrunk allowlist (the test is named so;
  the spec said "no module imports another module's internals..."). Flows (regression):
  `mods-install`, `engine-update`, `servers-master-sources`.

- **D4b — hoist content, engine state, fs helpers and schema primitives out of downloads.**
  `git mv` and rewrite imports, behaviour unchanged: `downloads/manifest-service.ts` and
  `downloads/manifest-parse.ts` → `src/main/services/content/`; the manifest schemas they import
  (`harnessLoopbackManifestPackageSchema`, `manifestEnvelopeSchema`, `manifestPackageSchema`,
  `ManifestPinnedEntry`, `PlatformTaggedManifestPackage` and what those need) split from
  `downloads/schemas.ts` into `src/main/services/content/manifest-schemas.ts` (downloads/schemas.ts
  re-imports what it still uses); `DownloadSource`, `PRODUCTION_DOWNLOAD_SOURCE`,
  `resolveDownloadSource` (and `HARNESS_CONTENT_REPO_BASE_ENV`'s re-export) move from
  `downloads/harness.ts` to `src/main/services/content/source.ts` (`resolveDetectedRetailSourcesOverride`
  stays in downloads — only downloads uses it); `downloads/engine/installation-state.ts` →
  `src/main/services/engine-state.ts`; `plannedDestination`/`moveFile` from
  `downloads/engine/update-job.ts` → `src/main/lib/fs-utils.ts`; `harnessLoopbackUrlSchema`,
  `httpsUrlSchema`, `sha256Schema` → `src/shared/schemas.ts`. Tests move alongside. Rewrite
  importers: downloads, `mods/index.ts`, `mods/catalog-service.ts`, `mods/catalog-schema.ts`,
  `mods/engine-target.ts`, `mods/install-job.ts`, `mods/update-job.ts`. In `src/architecture.test.ts`
  delete every remaining `→ downloads` allowlist entry. Docs: `docs/UI-VERIFICATION.md` and
  `docs/systems/install-module.md` — update the paths of every moved file they name
  (`downloads/harness.ts` → `services/content/source.ts`, etc.).
  Tests: moved suites green; `src/architecture.test.ts` › "no module imports modules/downloads
  internals" (new assertion: zero imports of `modules/downloads/` from any other module, and the
  allowlist holds no entry whose target is downloads).

- **D5 — replays reaches the window, screen, shell and harness only through `app`.**
  `src/main/modules/replays/index.ts`: drop `import … from 'electron'`. `geometryAt` uses
  `app.mainWindow.snapshot()` (`contentBounds` unless the follower passes bounds, `zoomFactor`) and
  `app.displays.dipToScreenRect(dip, 'main')`; `onPrimaryDisplay` compares
  `snapshot.displayId` with `app.displays.primary().id` (true when there is no snapshot, as today);
  `primaryDisplayGeometry` uses `app.displays.primary()` + `dipToScreenRect(bounds, null)`; the
  follower's `virtualDesktopRightEdge` gets `app.displays.all()` and `dipToScreenRect(…, null)`;
  `writeClipboard` → `app.os.copyText`, `reveal` → `app.os.showItemInFolder` (harness branch gone);
  `isPackaged` → `app.isPackaged`; `userDataDir()` → `app.userDataDir`; `stageAvailability(
process.platform, app.env, { Q2L_UI_HARNESS: …, Q2L_UI_SESSION_TYPE: … })` takes its harness
  values from `app.harness.read(...)` (the `Q2L_UI_HARNESS` value as `app.harness.enabled ? '1' :
undefined`); `resolveOnPrimary(actual, …)` reads
  `app.harness.read('Q2L_UI_CINEMA_DISPLAY')`; `discoveryHomeDir`/`scanHoldMs` take `{ harness,
userData }` with no `process.env` default (adjust `src/main/modules/replays/stage.ts` /
  `cinema` helpers' signatures the same way if they default to `process.env`). Then delete
  `getMainWindow` from the `AppContext` interface and the context object in `src/main/context.ts`
  (the `createAppContext` option stays for `DialogService`/`createDisplaysService`) and fix the
  comment reference in `src/main/services/launch.ts` and any fake context that set it. Behaviour
  must be identical, including the scale-factor fallback when `screen.dipToScreenRect` is absent.
  `src/main/modules/replays/index.test.ts`: remove `vi.mock('electron', …)`; the fake `AppContext`
  supplies `userDataDir` (temp dir), `harness` (`resolveUiHarness({...})`), `env`, `os`,
  `displays` and `mainWindow` fakes; the two harness cases at ~798/822 pass a harness, not an env.
  Tests: `src/main/modules/replays/index.test.ts` › "stage geometry comes from the window snapshot
  and the displays service" (fake snapshot with zoom 1.25 + a displays fake ⇒ the expected
  `vid_geometry` string) and › "cinema is unavailable off the primary display" (snapshot
  `displayId` ≠ primary); the file has no `vi.mock('electron'`. Flows (regression):
  `replays-stage`, `replays-stage-follow`, `replays-cinema`, `replays-cinema-unavailable`,
  `replays-demo-file-actions`.

- **D6 — every other module onto the shell, and the architecture assertions.**
  `src/main/modules/mods/index.ts`: `shell.openPath` → `app.os.openPath` (harness branch gone),
  `electronApp.getPath('userData')` → `app.userDataDir`, `resolveDownloadSource(...)` gets
  `app.harness`; drop the electron import. `src/main/modules/mods/index.test.ts`: remove
  `vi.mock('electron', …)`, fake `os.openPath`. `src/main/modules/config/index.ts` (~1715):
  `shell.openPath`/`showItemInFolder` → `app.os`. `src/main/modules/home/open-slide-url.ts`:
  takes an `openExternal` dependency (the caller in `home/index.ts` passes `app.os.openExternal`);
  update `open-slide-url.test.ts`. `src/main/modules/home/news/harness.ts` +
  `news-service.ts`: `resolveNewsSource(harness)`, no `process.env` default. `src/main/modules/
downloads/index.ts`: `electronApp.isPackaged` → `app.isPackaged`, harness helpers get
  `app.harness`; `downloads/bootstrap/target.ts` and `downloads/bootstrap/r1q2-setup.ts` take the
  env from `app.env` (no `process.env` default); `downloads/retail/sources.test.ts` stops mutating
  `process.env` and passes a harness. `src/main/modules/servers/index.ts`:
  `uiHarnessLanTargets(app.harness)`. Delete `isUiHarnessEnabled`. `grep` must show zero
  `from 'electron'` and zero `process.env` in non-test files under `src/main/modules/`.
  In story 208's `src/architecture.test.ts` add: › "no module source imports electron" (non-test
  files under `src/main/modules/`), › "no module source reads process.env", › "window-shared and
  ipc/index read no process.env", › "harness reveal and external-url recording is imported only by
  the os service" (`recordHarnessRevealedPath`/`recordHarnessExternalUrl` imported nowhere but
  `src/main/services/os.ts` and `lib/ui-harness.ts` itself), › "AppContext has no getMainWindow"
  (`src/main/context.ts`'s `AppContext` interface body has no `getMainWindow`), › "the replays and
  mods index tests do not mock electron". Docs: `docs/ARCHITECTURE.md` "Adding a module" step 3 and
  the AppContext description list `os`, `displays`, `harness`, `env`, `isPackaged`, `userDataDir`
  as the module's only way to the OS, the screen and the harness.
  Tests: the architecture assertions above; flows (regression) `mods-detail`, `news-feed`,
  `bootstrap-retail-import`, `retail-upgrade`, `servers-lan-mode`.

## Model Hints

- D5 → deliverable-hard — replays' stage/cinema geometry moves from live `BrowserWindow`/`screen`
  calls to a snapshot + displays service; a subtly different DIP→physical conversion (window-scoped
  vs. primary-display scale, minimized-window bounds, the missing-`dipToScreenRect` fallback) puts
  the game window in the wrong place on mixed-DPI desktops while every unit test with a 1.0 scale
  still passes.
- Review: → story-review-hard — the plausible wrong implementation is a shell re-export shim (a
  `lib/` file that hands modules `shell`/`screen`/`process.env` under another name), or an
  `app.harness` that snapshots fixture values: both pass the grep-based architecture tests and a
  diff-only default review, while the seam stays open or the in-process fixture flips stop working.

## Acceptance Tests

- AC1 → unit `src/main/services/os.test.ts` › "under the harness the os service records and never
  calls the shell"; unit `src/main/services/os.test.ts` › "outside the harness each call reaches the
  shell exactly once"; unit `src/architecture.test.ts` › "harness reveal and external-url recording
  is imported only by the os service"; e2e `scripts/flows/mods-detail.mjs` › `mods-detail`; e2e
  `scripts/flows/replays-demo-file-actions.mjs` › `replays-demo-file-actions`
- AC2 → unit `src/main/main-window-observer.test.ts` › "the snapshot carries zoom factor, outer
  bounds and display id"; unit `src/main/services/displays.test.ts` › "dipToScreenRect uses the
  screen API when present and the display scale factor otherwise"; unit
  `src/main/services/displays.test.ts` › "primary and all list the screen displays"; unit
  `src/main/modules/replays/index.test.ts` › "stage geometry comes from the window snapshot and the
  displays service"; unit `src/main/modules/replays/index.test.ts` › "cinema is unavailable off the
  primary display"; unit `src/architecture.test.ts` › "AppContext has no getMainWindow"; e2e
  `scripts/flows/replays-stage.mjs` › `replays-stage`; e2e `scripts/flows/replays-stage-follow.mjs` ›
  `replays-stage-follow`; e2e `scripts/flows/replays-cinema.mjs` › `replays-cinema`
- AC3 → unit `src/main/lib/ui-harness.test.ts` › "resolveUiHarness freezes the gate and reads
  fixture vars live"; unit `src/main/lib/boot-env.test.ts` › "the boot env carries no Q2L_ keys and
  is frozen"; unit `src/architecture.test.ts` › "no module source reads process.env"; unit
  `src/architecture.test.ts` › "window-shared and ipc/index read no process.env"; e2e
  `scripts/flows/harness-offscreen.mjs` › `harness-offscreen`; e2e
  `scripts/flows/bootstrap-retail-import.mjs` › `bootstrap-retail-import`; e2e
  `scripts/flows/retail-upgrade.mjs` › `retail-upgrade`; e2e
  `scripts/flows/replays-cinema-unavailable.mjs` › `replays-cinema-unavailable`
- AC4 → unit `src/architecture.test.ts` › "no module source imports electron"
- AC5 → unit `src/architecture.test.ts` › "no module imports modules/downloads internals"; unit
  `src/architecture.test.ts` › "a main module imports another module only through an allowlisted edge";
  e2e `scripts/flows/mods-install.mjs` › `mods-install`; e2e `scripts/flows/engine-update.mjs` ›
  `engine-update`; e2e `scripts/flows/servers-master-sources.mjs` › `servers-master-sources`
- AC6 → unit `src/architecture.test.ts` › "the replays and mods index tests do not mock electron";
  unit `src/main/modules/replays/index.test.ts` and `src/main/modules/mods/index.test.ts` pass
  without the mock (whole files)

No AC describes a user action (the story changes nothing a user sees); the e2e lines are the
regression run targets for the paths each AC rewires.

## Done

Modules now reach the OS, screen and harness only through `app`: `AppContext` gained `harness` (frozen gate, live fixture reads), `env` (Q2L_-stripped), `isPackaged`, `userDataDir`, `os` and `displays`; `MainWindowSnapshot` carries zoom/bounds/displayId and `getMainWindow` left `AppContext`. Downloads infrastructure moved to `lib/net`, `lib/archive`, `services/package-staging.ts`, `services/content/`, `services/engine-state.ts`, `lib/fs-utils.ts`; replays and the other modules were migrated; `architecture.test.ts` enforces it.

Commit message: `209: modules reach electron/harness only via app (os, displays, harness, env); downloads infrastructure hoisted to the shell; architecture assertions`

Verification (narrow gate): build, typecheck, lint, `npx vitest run --changed HEAD` (205 files) green; full `npm test` after the review fix green (521 files, 6492 passed); flows harness-offscreen, mods-detail, replays-demo-file-actions, replays-stage, replays-stage-follow, replays-cinema, replays-cinema-unavailable, bootstrap-retail-import, retail-upgrade, mods-install, engine-update, servers-master-sources, news-feed, servers-lan-mode all OK. AC1-AC6 map to the named tests in Acceptance Tests; all ran and passed. No manual residue. Review: default + story-review-hard, both PASS after one fix cycle (stage 1: loose architecture regexes, over-wide shell-layering exemption, stale path references; stage 2: doc/comment/name findings only, fixed; that comment-only follow-up got no third review).

Decisions:

- Test names as run: "primary and all list the screen displays"; the allowlist test is "a main module imports another module only through an allowlisted edge" (208's name). Acceptance Tests lines updated.
- displays.ts: a `null`-anchored rect scales by the display the rect sits on (getDisplayMatching), not always the primary, so `virtualDesktopRightEdge` stays identical on mixed-DPI desktops (the spec's "primary" wording would have changed it).
- `onPrimaryDisplay`/`geometryAt` read the snapshot (last un-minimized content bounds) instead of live outer bounds: identical for the frameless window, benign while minimized.
- Extras beyond the plan, needed for zero `process.env`/`electron` in modules and window-shared: `lib/renderer-source.ts` (`rendererSourceFromEnv`, threaded into `hardenWebContents`/`createCinemaWindow`), `lib/native-image.ts` (home image decode), `ReplaysIndexCache` path from `app.userDataDir`.
- `shell-layering.test.ts` exempts `@shared/modules/` specifiers (shared contract types, not module internals).
- Residual, not test-enforced: modules still call `lib/paths.userDataDir()`, `lib/net/fetcher` and `lib/native-image` (narrow electron-backed shell libs); ARCHITECTURE.md/types.ts say so. `services/runners.ts` (outside modules) resolves the harness per call, same behaviour.
- `docs/systems/install-module.md` does not exist; moved paths were updated in UI-VERIFICATION.md, concepts docs and comments instead. The quiet-test-run sample path follows the moved staging test.

tiers: D 7 / hard 1 · review default+hard · cycles 2 · agents 12

Regression fix: `bootEnv` copied `process.env` into a case-sensitive object, so `env.ProgramFiles` missed `PROGRAMFILES` on Windows and the bootstrap wizard's Program Files warning vanished (flow `bootstrap-wizard`); the frozen copy now keeps the platform's lookup casing (case-folded fallback on win32, exact on linux), tested in `boot-env.test.ts`.
