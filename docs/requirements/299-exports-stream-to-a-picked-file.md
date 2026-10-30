---
id: 299
title: Exports stream to a file the user picked
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

An exported video is written straight into a file I chose, without first sitting completely in
memory. Cancelling never leaves half a file behind. The renderer never learns or chooses a path:
it addresses the target through a handle that main hands out.

Context:

- [concept §10.5](../concepts/integrated-demo-player.md) (streaming to disk),
  [concept §10.6](../concepts/integrated-demo-player.md) (progress and cancel),
  [concept §7](../concepts/integrated-demo-player.md) (handle instead of path).
- CLAUDE.md: IPC is contract-first (`src/shared/modules/replays.ts`, zod schemas), and paths from
  the renderer are never trusted.
- Dialogs: `src/main/services/dialog.ts` (`DialogService`, harness stub via `Q2L_UI_HARNESS` and
  `Q2L_UI_PICK_FILES`); the replays module uses `app.dialog.pickFolder()`
  (`src/main/modules/replays/index.ts`). Shutdown order: `src/main/shutdown.ts`.
- Constraints:
  - New `src/main/modules/replays/export-sink.ts` with the handlers `exportOpen`, `exportWrite`,
    `exportFinish` and `exportAbort`, contract-first with zod (`bytes` as `Uint8Array`, size
    bounded).
  - A handle is a random id in a map in main. Writes go to `<target>.part` with
    `fs.write(fd, bytes, 0, len, position)`; `finish` renames the file to the target.
  - `DialogService.pickSaveFile({ defaultName, filters: [{ name: 'MP4', extensions: ['mp4'] }] })`
    gets a harness stub.
  - At most 4 writes per handle are in flight (the renderer limits them); main serialises per fd.
  - Tests in `src/main/modules/replays/export-sink.test.ts`, helpers from `src/test-support/`.
- Not in scope: encoding ([[302]]), UI ([[303]]), ffmpeg ([[313]]).

## Acceptance Criteria

- [ ] **AC1** — `export.open({ demoId, suggestedName: 'final-q2dm1.mp4' })` answers `{ handle }`
      once the user picks a location in the save dialog.
- [ ] **AC2** — Dismissing the save dialog answers `{ cancelled: true }`.
- [ ] **AC3** — The response schema of `export.open` has no path field (type test).
- [ ] **AC4** — Chunks written with `export.write({ handle, position, bytes })` in any order,
      including a jump back to position 0, produce, after `export.finish`, a file whose bytes equal
      the written chunks.
- [ ] **AC5** — `export.abort({ handle })` deletes the partial file.
- [ ] **AC6** — After an abort, a further `write` on that handle returns
      `fail('replays.export.error.unknownHandle')`.
- [ ] **AC7** — An unknown, expired or foreign handle, a `position < 0` or `bytes` over 64 MiB is
      refused (zod schema or check), and nothing is written.
- [ ] **AC8** — Quitting the app with an open handle deletes the partial file first (shutdown
      hook).
- [ ] **AC9** — A failing write with `ENOSPC` returns `fail('replays.export.error.diskFull')`, and
      the partial file is deleted.
- [ ] **AC10** — Under the UI harness (`Q2L_UI_HARNESS=1`), `export.open` opens no dialog and takes
      its target from `Q2L_UI_SAVE_FILE`.
- [ ] **AC11** — `npx vitest run src/main/modules/handler-coverage.test.ts` passes, with the new
      handlers registered and the preload allowlist in sync.
- [ ] **AC12** — The `replays.export.error.*` keys are in
      `src/renderer/src/modules/replays/locale/en.json`.
- [ ] **AC13** — The handler list in `docs/systems/replays-module.md` is extended.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
