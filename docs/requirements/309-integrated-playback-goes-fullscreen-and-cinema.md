---
id: 309
title: Integrated playback goes fullscreen and into cinema mode
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to watch a demo that plays inside the launcher big — fullscreen, or in cinema
mode with the launcher's controls over it — so that I can watch it like a video without
switching to engine mode.

Context:

- [concept §7](../concepts/integrated-demo-player.md) (engine on the renderer main thread),
  [concept §8.3](../concepts/integrated-demo-player.md) (canvas buffer follows CSS size × DPR),
  [concept §9.2](../concepts/integrated-demo-player.md).
- Today (engine mode) cinema is its own always-on-top `BrowserWindow`
  (`src/main/cinema-window.ts`, `src/main/modules/replays/cinema.ts`, `cinema-controller.ts`)
  with the overlay `src/renderer/src/modules/replays/cinema/CinemaOverlay.tsx`
  (`useIdleFade.ts`); fullscreen goes through in-game binds or the `fullscreen` timeline action
  (`timelineActionSchema` in `src/shared/replays/timeline.ts`).
- In integrated mode the canvas lives in the main window. A second window would be a second
  renderer without the engine, so cinema here is a display state of the same document: reuse
  `PlaybackMode = 'preview' | 'cinema' | 'fullscreen'` in `playback-store.ts`; `cinema` sets a
  layout flag instead of calling `playbackCinema`.
- Fullscreen: if the display contract has no way to put the main window fullscreen, a new
  contract-first channel `playbackWindowFullscreen { enter: boolean }` with a zod schema; otherwise
  the DOM Fullscreen API (check first whether `setPermissionRequestHandler` in
  `src/main/index.ts` allows `fullscreen`). Canvas size via `ResizeObserver` → engine resize.
- Today's flows: `scripts/flows/replays-cinema*.mjs`, `replays-fullscreen.mjs`; new flow
  `scripts/flows/replays-integrated-cinema.mjs` with the fake engine.
- Not in scope: changes to engine-mode cinema; an export overlay ([[303]]).
- Depends on: [[297]].

Expected manual residue: real engine, cinema and fullscreen on a 1440p and a 4K monitor (DPR
1.5/2) — sharp picture, no stutter when switching.

## Acceptance Criteria

- [ ] **AC1** — In integrated mode with a demo playing, choosing "Cinema" makes the canvas fill
      the main window's whole content area.
- [ ] **AC2** — In integrated cinema, `CinemaOverlay` lies over the canvas with the timeline
      controls and fades after inactivity, as today.
- [ ] **AC3** — Integrated cinema opens no second `BrowserWindow`.
- [ ] **AC4** — From integrated cinema, "Fullscreen", F11 or a double-click on the canvas puts
      the main window into fullscreen.
- [ ] **AC5** — Escape or a second double-click leaves fullscreen again.
- [ ] **AC6** — Switching stage → cinema → stage reports each new canvas size to the engine (fake
      engine: resize counter and size), and playback continues without a restart.
- [ ] **AC7** — With the overlay visible in integrated cinema, timeline shortcuts are not
      swallowed by the canvas: Space pauses.
- [ ] **AC8** — In engine mode cinema and fullscreen behave as before
      (`npm run ui:flow -- replays-cinema` and `npm run ui:flow -- replays-fullscreen` green).
- [ ] **AC9** — If a new IPC channel was added, contract, schema, handler and allowlist agree
      (`npx vitest run src/main/modules/handler-coverage.test.ts` green).

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
