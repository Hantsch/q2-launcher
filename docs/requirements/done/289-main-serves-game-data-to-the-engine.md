---
id: 289
title: Main serves an installation's game data to the engine
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user in integrated mode I want the launcher to hand my installation's game data to the
engine, so that demos play with my own paks and mod data — without the renderer gaining access to
arbitrary files.

Context:

- [concept §8.5](../concepts/integrated-demo-player.md) (file system and game data), [concept §7](../concepts/integrated-demo-player.md) (responsibilities), risk R2; the RAM ceiling is
  an open point of the concept.
- Resolving demo id and installation as today: `src/main/modules/replays/demo-play.ts` (index
  lookup, `demoPlayEligibility`, containment, `SAFE_FILE_NAME`), staging of zip entries and foreign
  demos `demo-staging.ts`, zip reading `zip-demos.ts`, discovery `discovery.ts`
  (`effectiveWriteDirs`). Helpers `src/main/lib/fs-utils.ts` (`isFile`, `listDir`, `pathKey`).
- Protocol handler `src/main/lib/renderer-source.ts`, registration `src/main/index.ts`; contract
  `src/shared/modules/replays.ts`. `/electron-arch` (never trust renderer paths), `/typed-ipc`.
- New `src/main/modules/replays/integrated-session.ts` (manifest, token via `crypto.randomUUID()`).
  The protocol handler gets a narrow port (`resolveEngineData(token, index) → { path, size } |
null`) so `lib/` imports no module (`src/main/layering.test.ts`, `shell-layering.test.ts`).
  Streaming via `fs.createReadStream` → `Readable.toWeb` into a `Response` with `Content-Length`;
  no `Range` (MEMFS needs whole files). Zip entries reuse the `zip-demos.ts` read path.
- `docs/systems/replays-module.md` handler list gains `integrated.prepare`/`integrated.release`;
  no `CHANGELOG.md` line (part of [[287]]'s feature line).
- Not in scope: loading into the engine ([[291]]), renderer UI, a worker/WORKERFS (own story only
  if [[284]] recommends it).
- Depends on: [[288]]

## Acceptance Criteria

- [x] **AC1** — `integrated.prepare({ demoId, installationId })` (zod, no paths) returns
      `{ token, gameDir, files: [{ index, vpath, size }], demo: { index, vpath, size } }` for a
      valid demo and installation.
- [x] **AC2** — Every `vpath` is a relative Quake path (`baseq2/pak0.pak`,
      `<gamedir>/maps/x.bsp`, `<gamedir>/demos/_launcher/<safe-name>`), never an OS path.
- [x] **AC3** — The manifest holds `pak*.pak`/`*.pkz` of `baseq2` and of the demo's game dir,
      plus loose files in `maps`, `textures`, `models`, `sprites`, `sound`, `pics`, `players`,
      `env` of the game dir, with case handled as discovery does (unit test with a fixture tree).
- [x] **AC4** — When the sum of file sizes exceeds the limit (a constant, 1 GiB to start),
      `prepare` refuses with `replays.integrated.error.dataTooLarge` and `{ sizeMb }`.
- [x] **AC5** — `/engine-data/<token>/<index>` with a valid token and index streams the file with 200.
- [x] **AC6** — A zip-entry demo is served unpacked and a `.gz` demo unchanged, as today's staging
      does.
- [x] **AC7** — An unknown, expired or foreign token, an index outside the manifest, or a path
      with `..` answers 404 without opening any file (unit test with a file-system spy).
- [x] **AC8** — After `integrated.release({ token })` or a new `prepare`, the old token is invalid;
      at most one token is active.
- [x] **AC9** — A manifest file replaced by a symlink to outside the installation after `prepare`
      answers 404 (real path re-checked against the installation root).
- [x] **AC10** — The handler-coverage tests (`src/main/modules/handler-coverage.test.ts`,
      `src/renderer/src/modules/handler-coverage.test.ts`) and the layering tests are green.

## Open Questions

- ~~Is 1 GiB of game data in renderer memory acceptable as the ceiling for integrated mode, beyond
  which the user is pointed to engine mode? (concept open point on RAM)~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Is 1 GiB of game data in renderer memory acceptable as the ceiling: yes, 1 GiB as a constant; above it prepare refuses and the user is pointed to engine mode.
- `prepare` does not run `demoPlayEligibility`: its engine, runner and game-running rules are about the native launch, while the integrated engine only needs the data; it re-checks only what concerns the data (below).
- The payload's `installationId` must be the active installation, else `replays.play.unavailable.unsupportedEngine` — the same rule and key as `demo.play`, so the renderer never picks the data source.
- An `.mvd2` demo is refused with [[287]]'s `replays.player.unavailable.mvd2Integrated` — main re-checks what the renderer disables.
- Existing keys are reused for shared failures: `replays.play.error.notFound`, `.fileMissing`, `.archiveEntry {code}`, `.gameDirMissing {mod}` (baseq2 or the demo's game dir exists in no root), `replays.play.unavailable.unsafeName` — the user sees the same reasons in both modes.
- Roots are the installation root plus `effectiveWriteDirs` (Linux Q2PRO's `~/.q2pro`); on a vpath collision the write-dir copy wins — Q2PRO searches its homedir before basedir, and downloaded maps live there.
- vpaths are ASCII-lower-cased below the root (`baseq2`, the demo's game dir, asset folders, file names); a later case-collision is skipped — MEMFS is case-sensitive and Quake references assets in lower case.
- Asset folders are walked recursively, symlinked directories are not followed, and every file's realpath must lie in the root it was found under — a link out of the installation never enters the manifest.
- The size sum includes the demo; `sizeMb` is `ceil(bytes / 2^20)`; the limit is the exported constant `INTEGRATED_DATA_LIMIT_BYTES = 1024 ** 3`, injectable only for tests — no 1 GiB fixture.
- The demo's index is `files.length` (the last index) — one index space, one route.
- Each manifest entry pins the realpath and size seen at `prepare`; serving re-reads the realpath, answers 404 on any difference, and opens the pinned realpath, never the manifest path — a swap between check and open cannot redirect the read.
- A zip-entry demo is read once at `prepare` through `readZipEntry` (64 MiB cap) and served from memory; a file demo (also `.gz`) is served as its own bytes — exactly what staging writes today, without a disk copy.
- Token lifecycle: `crypto.randomUUID()`, no time-based expiry; `prepare` invalidates the current token on entry, only the latest-started `prepare` may install its token (generation counter), and a refused `prepare` leaves none — "expired" in AC7 means released or replaced.
- `release` with a token that is not the active one is a silent `ok` no-op — the renderer learns nothing by probing.
- The route is `/engine-data/` on the existing `app` host, decided on the decoded path before the renderer root and never falling through, like `/news-image/`: exactly two segments, a lower-case UUID token and a decimal index (`^(0|[1-9][0-9]{0,5})$`); anything else is 404 before the port is asked.
- Responses carry `Content-Type: application/octet-stream`, `Content-Length`, `Cache-Control: no-store` and the CSP header, like every response of the handler.
- The port is a shell service `EngineDataPort` on `AppContext` (holder with `provide`/`resolve`, unprovided → `null`); `index.ts` passes a late-bound `resolve` over `context`, because the protocol handler is registered before the context exists and `index.ts`/`lib` may not import a module (`shell-layering.test.ts`).
- The route exists only where the scheme handler is registered; the dev-server mode follows whatever [[288]] does for `/engine/`.

## Plan

1. **Session core (D1)** — `src/main/modules/replays/integrated-session.ts`: `createIntegratedSession(deps)` with
   `prepare(demoId, installationId)`, `release(token)`, `resolve(token, index)`.
   - Lookup as `demo-play.ts`: `readDemos`/`resolveFile`, installation by id, must be active.
   - Game dir = `demoGameDir(demo)`; roots = installation root + `effectiveWriteDirs`; folders
     found case-insensitively (`listDir(...).byLowerName`).
   - Manifest: `pak*.pak`/`*.pkz` of baseq2 and the game dir, loose files under the eight asset
     folders of the game dir, demo at `<gamedir>/demos/_launcher/<stagedFileName>`.
   - Sum > limit → `dataTooLarge { sizeMb }`. Token store with a generation counter.
   - `resolve` → `{ kind: 'file', path, size } | { kind: 'bytes', bytes, size } | null`, re-checking
     the pinned realpath and size.
2. **Contract + handlers (D2)** — `REPLAYS_HANDLERS.integratedPrepare/integratedRelease`, zod schemas,
   result type in `src/shared/modules/replays.ts`; `handle(...)` in `replays/index.ts`; client
   methods; en locale key; systems doc.
3. **Route + port (D3)** — `EngineDataPort` service on `AppContext`, replays module `provide`s the
   session's `resolve`, `createRendererProtocolHandler` gains `engineData` and the
   `/engine-data/<token>/<index>` branch, `index.ts` wires a late-bound port and a stream opener
   (`fs.createReadStream` → `Readable.toWeb`).

Order D1 → D2 → D3. No `CHANGELOG.md` line ([[287]] carries the feature line).

## Deliverables

- [x] **D1 — Integrated session: manifest, size cap, token, resolve** (+ tests)
  - New `src/main/modules/replays/integrated-session.ts` + `integrated-session.test.ts`.
  - Deps (injected, as `DemoPlayDeps` does in `demo-play.ts`): `readDemos`, `resolveFile`, `installations`,
    `activeInstallationId`, `discoveryContext` (for `effectiveWriteDirs` from `discovery.ts` and `zipDeps`),
    `fs: { realpath, stat }` (default `node:fs/promises`; the tests spy on them), `randomUUID`,
    `limitBytes` (default exported `INTEGRATED_DATA_LIMIT_BYTES = 1024 ** 3`).
  - Reuse: `listDir`, `isFile`, `pathKey` (`src/main/lib/fs-utils.ts`), `demoGameDir` and
    `DEMO_BASE_GAME_DIR` (`src/shared/replays/demo-play.ts`), `stagedFileName` + `LAUNCHER_DIR_NAME`
    (`demo-staging.ts`), `listZipEntries`/`readZipEntry` (`src/main/lib/zip-entries.ts`, the same
    entry lookup as `stageDemo`). Do not copy `SAFE_FILE_NAME` a third time; export the one in `demo-play.ts`.
  - `prepare` refusals, in order: demo not in index/resolvable → `replays.play.error.notFound`;
    installation not found or ≠ active → `replays.play.unavailable.unsupportedEngine`;
    `demo.format === 'mvd2'` → `replays.player.unavailable.mvd2Integrated`; unsafe staged name →
    `replays.play.unavailable.unsafeName`; baseq2 or game dir in no root →
    `replays.play.error.gameDirMissing { mod }`; demo file missing → `replays.play.error.fileMissing`;
    zip entry unreadable → `replays.play.error.archiveEntry { code }`; sum of all sizes (demo included)
    > `limitBytes` → `replays.integrated.error.dataTooLarge { sizeMb: ceil(bytes / 2^20) }`.
  - Manifest per root (installation root, then write dirs; write-dir entry wins a vpath collision):
    `pak*.pak` and `*.pkz` (case-insensitive) directly in baseq2 and in the game dir; every regular file
    found recursively in the game dir's `maps textures models sprites sound pics players env` (folders
    matched case-insensitively). Symlinked dirs are not followed; a file whose realpath is outside its
    root is skipped. vpath = `<lower gamedir>/<lower relative path>` with `/` separators; a later
    lower-case collision is skipped. `files` sorted by vpath, indices 0..n-1; demo index = n,
    vpath `<lower gamedir>/demos/_launcher/<stagedFileName(demo)>`.
  - Each entry stores (main-only) its pinned realpath and size; a zip-entry demo stores its bytes.
  - Token: `prepare` clears the active token on entry and increments a generation; it installs its
    new token only if its generation is still current; failure leaves none. `release(token)` clears
    only when it matches, else no-op; returns `ok`.
  - `resolve(token, index)`: unknown/stale token or index outside 0..n → `null` without calling `fs`;
    file entry: `realpath(path)` must equal the pinned realpath and `stat` size the pinned size, else
    `null`; returns `{ kind: 'file', path: <pinned realpath>, size }` or `{ kind: 'bytes', bytes, size }`.
  - Tests: tmp-dir fixture tree with mixed-case `BaseQ2/PAK0.PAK`, `Maps/`, a `.txt` outside asset
    folders, a mod dir; fake `fs.realpath` to simulate a swapped symlink (real symlinks need admin
    on Windows).
- [x] **D2 — Contract, handlers, client, locale, systems doc** (+ schema test)
  - `src/shared/modules/replays.ts`: `REPLAYS_HANDLERS.integratedPrepare: 'integrated.prepare'`,
    `integratedRelease: 'integrated.release'`; `replaysIntegratedPrepareSchema` =
    `{ demoId: replaysDemoIdSchema, installationId: z.string().min(1).max(512) }.strict()`;
    `replaysIntegratedReleaseSchema` = `{ token: z.string().uuid() }.strict()`; result types
    `ReplaysIntegratedPrepareResult { token; gameDir; files: { index; vpath; size }[]; demo: { index; vpath; size } }`
    and an empty release result; handler-map entries. Mirror `replaysDemoPlaySchema` (~line 654).
  - `src/main/modules/replays/index.ts`: create the session from D1 with the same deps as `createDemoPlay`
    (~line 460) and `handle(...)` both channels (pattern ~line 543); the main response carries only the
    public fields, never pinned paths.
  - `src/renderer/src/modules/replays/client.ts`: `integratedPrepare`/`integratedRelease` via
    `client.call(REPLAYS_HANDLERS.…)` (pattern `client.ts:122`).
  - `src/renderer/src/modules/replays/locale/en.json`: `replays.integrated.error.dataTooLarge` =
    "This demo needs {{sizeMb}} MB of game data, more than integrated playback can hold. Play it in engine mode."; regenerate
    `src/renderer/src/i18n/__snapshots__/en.bundle.json`.
  - `docs/systems/replays-module.md` `## Handlers`: two bullets (what they take, that main resolves
    everything, one active token).
  - Test in `integrated-session.test.ts`: the prepare schema rejects an extra `path` key.
- [x] **D3 — `/engine-data/` route and the engine-data port** (+ tests)
  - `src/main/lib/renderer-source.ts`: export `ENGINE_DATA_PATH_PREFIX = '/engine-data/'`, types
    `EngineDataEntry = { kind: 'file'; path; size } | { kind: 'bytes'; bytes: Uint8Array; size }` and
    `EngineDataSource { resolve(token, index): Promise<EngineDataEntry | null>; openFile(path): ReadableStream<Uint8Array> }`;
    optional `engineData` input (absent → 404). The branch sits next to `/news-image/` on the decoded path,
    never falls through, parses exactly `<uuid lower-case>/<index>`, else 404 before `resolve`;
    200 with `application/octet-stream`, `Content-Length`, `Cache-Control: no-store`, CSP.
  - New `src/main/services/engine-data-port.ts`: `createEngineDataPort()` → `{ provide(resolve), resolve(token, index) }`
    (unprovided → `null`); add `engineData` to `AppContext` (`src/main/context.ts`) and to its test
    builders in `src/test-support/` if they build an `AppContext`.
  - `src/main/modules/replays/index.ts`: `app.engineData.provide((t, i) => session.resolve(t, i))`.
  - `src/main/index.ts` `serveRendererFromScheme`: `engineData: { resolve: (t, i) => context?.engineData.resolve(t, i) ?? Promise.resolve(null), openFile: (p) => Readable.toWeb(createReadStream(p)) }`.
  - Tests in `src/main/lib/renderer-source.test.ts` with a fake source and spies.

## Model Hints

- D1 → deliverable-hard — the new trust boundary: the generation-guarded token swap (a late
  `prepare` must never resurrect a token), realpath pinning across prepare/serve, and case-folded
  vpath collisions across two roots are subtle and break silently.
- Review: → story-review-hard — an implementation that checks the realpath and then opens the
  manifest path instead of the pinned realpath (a check-then-swap hole) passes every named test and
  looks right to a default review.

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/integrated-session.test.ts` › "prepare returns a token, the game dir and an indexed manifest for a demo of the active installation" (D1); "the prepare payload takes no path" (D2)
- AC2 → unit `src/main/modules/replays/integrated-session.test.ts` › "every vpath is a lower-case relative Quake path" (D1)
- AC3 → unit `src/main/modules/replays/integrated-session.test.ts` › "the manifest holds the paks of baseq2 and the game dir and the loose files of its asset folders, whatever their case" (D1)
- AC4 → unit `src/main/modules/replays/integrated-session.test.ts` › "game data over the limit is refused with its size in MB" (D1)
- AC5 → unit `src/main/lib/renderer-source.test.ts` › "an engine-data request with a live token and index streams the file with its length" (D3)
- AC6 → unit `src/main/modules/replays/integrated-session.test.ts` › "a zip-entry demo resolves to its unpacked bytes and a .gz demo to its own file" (D1); unit `src/main/lib/renderer-source.test.ts` › "an in-memory entry is served as its bytes" (D3)
- AC7 → unit `src/main/lib/renderer-source.test.ts` › "a malformed, traversing or encoded engine-data path is a 404 before the source is asked" (D3); unit `src/main/modules/replays/integrated-session.test.ts` › "an unknown or stale token or an index outside the manifest resolves to nothing without touching the file system" (D1)
- AC8 → unit `src/main/modules/replays/integrated-session.test.ts` › "a release or a new prepare invalidates the previous token" and "a prepare that finishes after a later one never installs its token" (D1)
- AC9 → unit `src/main/modules/replays/integrated-session.test.ts` › "a file whose realpath changed after prepare resolves to nothing" (D1)
- AC10 → existing `src/main/modules/handler-coverage.test.ts`, `src/renderer/src/modules/handler-coverage.test.ts`, `src/main/layering.test.ts`, `src/main/shell-layering.test.ts`, `src/architecture.test.ts` (D2, D3)

Coverage: AC1 D1+D2 · AC2 D1 · AC3 D1 · AC4 D1 · AC5 D3 · AC6 D1+D3 · AC7 D1+D3 · AC8 D1 · AC9 D1 · AC10 D2+D3. No user-facing action (the surface arrives in [[291]]), so no e2e line.

## Done

Main now hands an installation's game data to the engine: `integrated.prepare` builds an indexed manifest of paks and loose asset files (case-folded vpaths, write dir wins, 1 GiB cap) behind one active token, `integrated.release` drops it, and `/engine-data/<token>/<index>` on the `app` scheme streams the pinned realpath (or the unpacked zip entry from memory). Port `EngineDataPort` on `AppContext` keeps `lib/` free of module imports.

Change type: test
Commit message: `289: integrated.prepare/release, token + pinned-realpath manifest, /engine-data/ route, EngineDataPort`
Verification: narrow gate (`npx vitest run --changed HEAD`, 208 files / 1964 tests), typecheck, lint, build, prettier green after the last fix; no e2e line (no user-facing surface). AC1-AC10 walked to their named tests (all ran and passed; AC10 via handler-coverage, layering, shell-layering, architecture). No manual residue. Review: default PASS (findings fixed: pinned-vs-manifest path test, stale-session recheck test, double-encoded path and throwing resolve/openFile tests, comment nits), hard review PASS focused on check-then-swap (the opened path is the pinned realpath on every route).
Decisions:
- Added `replays.integrated.error.superseded` (a prepare overtaken by a later one) with en string; not in the plan.
- `readDemoEntry` extracted from `stageDemo` (shared zip lookup); `SAFE_FILE_NAME` exported; `index.test.ts` payload table extended.
- `%2f`/`%5c` in the raw path are rejected before parsing (decoded `<uuid>%2f1` would otherwise pass).
- `gameDir` in the result is lower-case, matching the vpaths. `entry.bytes as unknown as ArrayBuffer` is a typing workaround (commented).
Unfixed, documented: (1) residual TOCTOU: the pinned realpath's own last component or a parent dir swapped after the check is followed by `createReadStream`; needs a local writer with the user's privileges, not reachable from the renderer; the Decision "cannot redirect the read" holds for the manifest link only. Hard links pass containment. (2) A junctioned `baseq2`/mod dir passes `gameDirMissing` but contributes an empty manifest (safe, silent). (3) The zip/.gz resolve test is `skipIf` without 7za.
Follow-up note (not a change): spike 284 measured renderer RSS about 2.2x data size, so the 1 GiB cap may extrapolate to about 2.3 GiB RSS; the cap is a user decision.
tiers: D 3 / hard 1 · review default+hard · cycles 2 · agents 8
