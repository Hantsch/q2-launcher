---
id: 288
title: The launcher serves the engine and allows WebAssembly
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want the WASM engine served over the launcher's own scheme and the
CSP extended by exactly `'wasm-unsafe-eval'`, so that the renderer can load the engine while the
rest of the security architecture stays as it is.

Context:

- [concept §8.6](../concepts/integrated-demo-player.md) (embedding in Electron), risk R9 (relaxing the launcher document's CSP). Spike
  result: `spikes/284-demo-frame-in-electron/RESULT.md`.
- CSP and scheme: `src/main/lib/renderer-source.ts` (`PRODUCTION_CSP`, `DEV_CSP`, `RENDERER_SCHEME`,
  `createRendererProtocolHandler`, model `NEWS_IMAGE_PATH_PREFIX` / `isSafeNewsImageFileName`);
  registration in `src/main/index.ts` (`registerSchemesAsPrivileged`, `protocol.handle`). Tests:
  `src/main/lib/renderer-source.test.ts`, `src/architecture.test.ts`.
- Packaging: `electron-builder.yml` `extraResources` (model `geoip`), path resolution
  `src/main/lib/resource-path.ts` — `resources/engine/` in dev, `process.resourcesPath/engine` when
  packaged. File allowlist as a constant (`ENGINE_FILE_NAMES = ['q2pro.js', 'q2pro.wasm']`).
- The reason for the CSP change is a comment on `PRODUCTION_CSP` (invariant, `(story 288)`). Read
  `/electron-arch`; if it forbids CSP extensions, add a deviation row to `CLAUDE.md`.
- Not in scope: game data over the protocol ([[289]]), a canvas in the UI ([[290]]), a release job
  that builds the engine ([[316]]); no `CHANGELOG.md` line (not user-visible).
- Depends on: [[284]]

## Acceptance Criteria

- [x] **AC1** — `script-src` in `PRODUCTION_CSP` is exactly `'self' 'wasm-unsafe-eval'` and has no
      `'unsafe-eval'` token; `DEV_CSP`'s `script-src` carries `'wasm-unsafe-eval'` alongside its
      existing dev-only allowances; both pinned by unit tests in `renderer-source.test.ts`.
      (Reworded in refine, see Decisions.)
- [x] **AC2** — A request for `/engine/q2pro.wasm` under the renderer origin answers 200 with
      `Content-Type: application/wasm` when the file exists in `resources/engine/`.
- [x] **AC3** — A request for `/engine/q2pro.js` answers 200 with `Content-Type: text/javascript`.
- [x] **AC4** — A request under `/engine/` with another file name, `..`, a subfolder or encoded
      separators answers 404 and never falls back to the renderer root.
- [x] **AC5** — With no engine artefacts present, `/engine/q2pro.wasm` answers 404, main logs
      `engine artifacts missing` once, and the launcher starts normally.
- [x] **AC6** — `npm run package:dir` exits 0 and
      `release/<version>/win-unpacked/resources/engine/q2pro.wasm` exists; `resolveResourcePath`
      finds it.
- [x] **AC7** — An entry in `src/architecture.test.ts` (with story number) pins that
      `'wasm-unsafe-eval'` appears only in the CSP line together with the `/engine/` branch.
- [x] **AC8** — `npm run build && npm run ui:verify` is green with no new axe findings.

## Open Questions

## Decisions (Sprint)

- **AC1 for `DEV_CSP`:** dev keeps `'unsafe-inline' 'unsafe-eval'` and gains an explicit
  `'wasm-unsafe-eval'`; only `PRODUCTION_CSP` is exact — the literal AC would drop
  `'unsafe-inline'`, which the Vite React preamble needs, and dev CSP never ships (electron-arch
  documents the dev allowances).
- **Engine URL is a path on the app host, `q2launcher://app/engine/<name>`, not a host
  `q2launcher://engine/`** (concept §8.6 shorthand) — a second host is a second origin, and
  `'self'` would no longer cover the script/wasm fetch (same reasoning as story 084's `/news-image/`).
- **Name allowlist, not path sanitising:** `/engine/` serves only `ENGINE_FILE_NAMES` matched as
  an exact bare name on the decoded path — the news-image branch's proven pattern, and it rejects
  `..`, subfolders and `%2F`/`%5C` in one check.
- **The side-root branch is shared, not copied:** the news-image and engine branches use one
  helper — two hand-written copies of a containment path are how they drift apart.
- **`engine artifacts missing` is logged lazily, at most once per handler, on the first failed
  engine read** — boot then does no engine IO at all, so "starts normally" holds by construction.
- **`resources/engine/` exists on every clone (`.gitkeep`)** so `extraResources` has a source on
  CI, where the engine is not built until [[316]]; the artefacts themselves stay gitignored (281).
- **Dev-server mode does not serve the engine** (the scheme handler is only registered in scheme
  mode, unchanged); loading the engine under `npm run dev` belongs to [[290]].
- **AC6 is proven by config + path unit tests, plus one `package:dir` run recorded in Done** —
  packaging needs the Docker-built artefact, which no CI lane builds yet.
- **CLAUDE.md gets a deviation row** for electron-arch's "production policy has no `unsafe-*`":
  `'wasm-unsafe-eval'` is such a keyword.

## Plan

1. `src/main/lib/renderer-source.ts`: CSP token, `.wasm` MIME, `ENGINE_PATH_PREFIX = '/engine/'`,
   `ENGINE_FILE_NAMES`, an optional `engine` source on the handler input, one shared side-root
   helper used by both `/news-image/` and `/engine/`. Pure, unit-tested with the in-memory fake.
2. Wiring: `src/main/index.ts` passes `engine: { root: resolveResourcePath(..., 'engine'), readFile,
onMissing }`; `electron-builder.yml` `extraResources` gets `resources/engine → engine`;
   `resources/engine/.gitkeep`; a one-off `npm run package:dir` proves the packaged layout.
3. Guards and docs: an `architecture.test.ts` entry pins where `'wasm-unsafe-eval'` may appear;
   CLAUDE.md deviation row; `docs/ARCHITECTURE.md` protocol-handler bullet names `/engine/`.
4. Gate: `npm run build && npm run ui:verify` green with no new axe findings.

No IPC, no renderer code, no CHANGELOG line, no `docs/systems/` doc (no module is touched).

## Deliverables

- **D1 — CSP and the `/engine/` branch (pure lib).** Files: `src/main/lib/renderer-source.ts`,
  `src/main/lib/renderer-source.test.ts`.
  - `PRODUCTION_CSP` `script-src 'self' 'wasm-unsafe-eval'`; `DEV_CSP` `script-src 'self'
'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`. On `PRODUCTION_CSP` a comment states the
    invariant: only `'wasm-unsafe-eval'` is allowed, never `'unsafe-eval'`, because the engine is
    compiled in the launcher document `(story 288)`.
  - The existing test `expect(PRODUCTION_CSP).not.toContain('unsafe-eval')` would now fail on the
    substring inside `'wasm-unsafe-eval'` — replace it with a **token** check (split the
    `script-src` directive on whitespace; assert the token list equals
    `["'self'", "'wasm-unsafe-eval'"]` and has no `'unsafe-eval'`). Do not just delete it.
  - `MIME_TYPES['.wasm'] = 'application/wasm'`.
  - `export const ENGINE_PATH_PREFIX = '/engine/'`,
    `export const ENGINE_FILE_NAMES = ['q2pro.js', 'q2pro.wasm'] as const`.
  - Input gains `engine?: { root: string; readFile; onMissing: () => void }`. Extract the body of
    `serveNewsImage` into one helper `serveFromSideRoot(source, fileName, isAllowedName)` (bare
    name check → `resolveWithinRoot` → `readFile` → 404 on any failure, CSP on every response) and
    use it for both branches; the engine's name check is `ENGINE_FILE_NAMES.includes(name)`.
    The engine prefix is decided on the **decoded** path before the renderer root, like
    `/news-image/`, and never falls through. A failed engine read calls `onMissing` at most once
    per handler instance. No engine configured → 404.
  - Tests (in `renderer-source.test.ts`, existing news-image tests stay green unchanged):
    "production script-src is exactly self plus wasm-unsafe-eval", "dev script-src allows
    wasm-unsafe-eval", "the engine wasm is served as application/wasm", "the engine loader is
    served as text/javascript", "an engine request outside the allowlist is a 404 and never reaches
    the renderer root" (table: `other.wasm`, `../index.html`, `sub/q2pro.wasm`, `%2E%2E%2Findex.html`,
    `..%2Fq2pro.wasm`, `..%5Cq2pro.wasm`, `q2pro.wasm/`; assert the renderer-root fake was never
    read), "missing engine artefacts answer 404 and report once" (two requests, `onMissing`
    called once).

- **D2 — Wiring and packaging.** Files: `src/main/index.ts`, `electron-builder.yml`,
  `resources/engine/.gitkeep` (new, empty), `scripts/lib/release/wiring.test.mjs`,
  `src/main/lib/resource-path.test.ts`.
  - `index.ts` `serveRendererFromScheme`: add `engine: { root: resolveResourcePath({ isPackaged:
app.isPackaged, resourcesPath: process.resourcesPath }, 'engine'), readFile: (p) => readFile(p),
onMissing: () => logger.warn('engine artifacts missing: <root>') }` (mirror the `newsImages`
    entry and `servers/index.ts`'s `resolveResourcePath` call). Boot does no engine IO.
  - `electron-builder.yml` top-level `extraResources`: `- from: resources/engine / to: engine /
filter: ['q2pro.js', 'q2pro.wasm']` with a one-line comment like the `geoip` entry.
  - Ensure `.gitignore` ignores `resources/engine/*.js` and `*.wasm` but not `.gitkeep` (add the
    lines if 281 did not).
  - Tests: in `wiring.test.mjs` "electron-builder ships exactly the engine artefacts under
    resources/engine" (parse YAML, find the entry, assert `from`/`to`/`filter`); in
    `resource-path.test.ts` "a packaged engine resolves under resourcesPath/engine".
  - Evidence (not a lane test): with the engine built (`npm run engine:build` from 281 if
    `resources/engine/q2pro.wasm` is absent), `npm run package:dir` exits 0 and
    `release/<version>/win-unpacked/resources/engine/q2pro.wasm` exists; then move the artefacts
    aside and run `npm run package:dir` again — it must still exit 0 (CI has no engine). Record
    both results in `## Done`.

- **D3 — Guard and docs.** Files: `src/architecture.test.ts`, `CLAUDE.md`, `docs/ARCHITECTURE.md`.
  - New `it('wasm-unsafe-eval appears only in the renderer CSP beside the engine branch', ...)`
    with a trailing `(story 288)` comment: over all non-test production sources under `src/`
    (the file already has the scanner and `TEXT` map), the string `wasm-unsafe-eval` occurs only
    in `src/main/lib/renderer-source.ts`; that file also contains `ENGINE_PATH_PREFIX`; and no
    production source contains the token `'unsafe-eval'` outside `DEV_CSP`'s line.
  - `CLAUDE.md` `## Deviations`: one row — skill `/electron-arch` (production CSP has no
    `unsafe-*`); deviation: `PRODUCTION_CSP` `script-src` carries `'wasm-unsafe-eval'`
    (`src/main/lib/renderer-source.ts`); reason: the integrated demo player compiles the Q2PRO
    engine in the launcher document, `'unsafe-eval'` stays forbidden, engine only from
    `q2launcher://app/engine/`, pinned by `architecture.test.ts` (story 288, concept §8.6, R9).
  - `docs/ARCHITECTURE.md` "The protocol handler" bullet: add the engine artefacts under
    `q2launcher://app/engine/` from `resources/engine/` and the `'wasm-unsafe-eval'` allowance.

## Model Hints

- D1, D2, D3 → default.
- Review: → default — the risks (substring CSP test, fall-through to the renderer root, a second
  place widening the CSP) are each pinned by a named test, so a wrong implementation fails a test
  rather than passing silently.

## Acceptance Tests

- AC1 → unit `src/main/lib/renderer-source.test.ts` › "production script-src is exactly self plus
  wasm-unsafe-eval" and › "dev script-src allows wasm-unsafe-eval" (D1)
- AC2 → unit `src/main/lib/renderer-source.test.ts` › "the engine wasm is served as
  application/wasm" (D1)
- AC3 → unit `src/main/lib/renderer-source.test.ts` › "the engine loader is served as
  text/javascript" (D1)
- AC4 → unit `src/main/lib/renderer-source.test.ts` › "an engine request outside the allowlist is
  a 404 and never reaches the renderer root" (D1)
- AC5 → unit `src/main/lib/renderer-source.test.ts` › "missing engine artefacts answer 404 and
  report once" (D1); "starts normally" → e2e `npm run ui:verify` on the pr-ui lane, which runs
  without engine artefacts (D2 wiring)
- AC6 → unit `scripts/lib/release/wiring.test.mjs` › "electron-builder ships exactly the engine
  artefacts under resources/engine" and `src/main/lib/resource-path.test.ts` › "a packaged engine
  resolves under resourcesPath/engine" (D2); the `package:dir` runs are D2 build evidence in Done
- AC7 → unit `src/architecture.test.ts` › "wasm-unsafe-eval appears only in the renderer CSP beside
  the engine branch" (D3)
- AC8 → e2e `npm run build && npm run ui:verify` (whole run; the harness reads the live CSP header)

## Done

Served the engine at `q2launcher://app/engine/` (name allowlist `q2pro.js` / `q2pro.wasm`, one shared side-root helper with the news-image route), added `'wasm-unsafe-eval'` to `PRODUCTION_CSP` / `DEV_CSP`, wired `resources/engine` into `extraResources` and `index.ts`, pinned the CSP placement in `architecture.test.ts`, added the CLAUDE.md deviation row and the ARCHITECTURE.md note.

Change type: chore

Commit message: `288: serve WASM engine at q2launcher://app/engine/, CSP allows wasm-unsafe-eval (allowlist, extraResources, arch guard)`

Verification (narrow gate: `npx vitest run --changed HEAD`, `npm run build`, `typecheck`, `lint`, `npm run ui:verify`): all green after one fix cycle; `renderer-source.test.ts`, `resource-path.test.ts`, `wiring.test.mjs`, `architecture.test.ts`, `layering.test.ts` pass. ui:verify 116/116 screens, 0 unreachable, 0 critical/serious axe (one moderate on `config-conflict-dialog@940x620` appeared once, not on the rerun). Review stage 1: PASS. AC to test: AC1-AC7 pass by the tests named in `## Acceptance Tests`; AC8 = ui:verify green. No manual residue.

Evidence AC6: `npm run package:dir` exit 0 with artefacts, `win-unpacked/resources/engine/` holds `q2pro.js` and `q2pro.wasm`; with artefacts moved aside it still exits 0 (no engine dir) and the artefacts were put back.

Decisions:
- The allowlist test table omits `../index.html`: the URL parser collapses it to `/index.html` before the handler, a legitimate renderer request; the encoded escapes do reach the engine route.
- `layering.test.ts` pinned the old production `script-src 'self'`; updated to the new exact policy plus a quoted `'unsafe-eval'` absence check (not loosened).
- `ui:verify` drives the existing `out/`; mods and assets screens exist only in a development build (`npm run build:dev`), so a release-style `build` leaves four screens unreachable. Not caused by this story.
- `onMissing` fires on any failed engine read, not only ENOENT (minor, unfixed).
- Unfixed review notes: architecture guard checks `ENGINE_PATH_PREFIX` by text only (as specified); `ENGINE_FILE_NAMES` constant assertion is low value.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 7
