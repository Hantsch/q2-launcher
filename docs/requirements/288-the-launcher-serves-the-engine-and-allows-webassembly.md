---
id: 288
title: The launcher serves the engine and allows WebAssembly
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — `script-src` in `PRODUCTION_CSP` and `DEV_CSP` is exactly `'self' 'wasm-unsafe-eval'` and contains no `'unsafe-eval'`, pinned by a unit test in
      `renderer-source.test.ts`.
- [ ] **AC2** — A request for `/engine/q2pro.wasm` under the renderer origin answers 200 with
      `Content-Type: application/wasm` when the file exists in `resources/engine/`.
- [ ] **AC3** — A request for `/engine/q2pro.js` answers 200 with `Content-Type: text/javascript`.
- [ ] **AC4** — A request under `/engine/` with another file name, `..`, a subfolder or encoded
      separators answers 404 and never falls back to the renderer root.
- [ ] **AC5** — With no engine artefacts present, `/engine/q2pro.wasm` answers 404, main logs
      `engine artifacts missing` once, and the launcher starts normally.
- [ ] **AC6** — `npm run package:dir` exits 0 and
      `release/<version>/win-unpacked/resources/engine/q2pro.wasm` exists; `resolveResourcePath`
      finds it.
- [ ] **AC7** — An entry in `src/architecture.test.ts` (with story number) pins that
      `'wasm-unsafe-eval'` appears only in the CSP line together with the `/engine/` branch.
- [ ] **AC8** — `npm run build && npm run ui:verify` is green with no new axe findings.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
