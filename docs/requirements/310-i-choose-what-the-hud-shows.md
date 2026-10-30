---
id: 310
title: I choose what the HUD shows in both modes
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a viewer I want to turn the demo's HUD parts on and off — status bar, crosshair, chat HUD, all
2D — so that I can watch a scene without distraction or prepare it for an export.

Context:

- `HudOptions` in [concept §9.1](../concepts/integrated-demo-player.md), the native adapter in
  [concept §9.4](../concepts/integrated-demo-player.md) (`setHud` → fixed console lines plus the
  restore list), overlays off in [concept §8.3](../concepts/integrated-demo-player.md).
- Q2PRO cvars: `scr_draw2d` 0/1/2, `scr_chathud`, `crosshair`, `scr_demobar`, `scr_showpause`
  (manual and `q2pro:src/client/screen.c` `SCR_Draw2D`).
- Engine-mode restore: `SESSION_RESTORE_CVARS` in `src/main/modules/replays/demo-play.ts`, helper
  `src/main/modules/replays/session-cvar-restore.ts`; `scr_chathud` is already on it through
  `NOTIFY_SESSION_CVARS` (`playback-channel/protocol.ts`).
- Integrated: `q2l_set_cvar` with an allowlist in JS ([[294]] / [[296]]).
- Constraints: allowlist and the `HudOptions` → cvar-line mapping are one pure function in
  `src/shared/replays/hud-options.ts`, used by both adapters. In engine mode the lines go as
  `+set` at launch (like `notifySessionArgs`), otherwise via `playbackConsoleSend`; story 174
  AC4 is the model for keeping them out of the config. Persistence: a new contract-first handler
  pair `hudOptionsRead/Write` with a zod schema, or the existing settings structure, following
  `persisted.ts`. UI: a small menu in the timeline bar (`components/ui/Menu.tsx`).
- Not in scope: export HUD presets ([[308]]); showing HUD values in the launcher UI ([[315]]).
- Depends on: [[297]].

Expected manual residue: real engine in both modes — do status bar and crosshair visibly go, and
is the installation's config unchanged after the session?

## Acceptance Criteria

- [ ] **AC1** — In integrated mode, choosing "2D off" in the HUD menu makes the adapter call
      `q2l_set_cvar('scr_draw2d', '0')` (unit test), and the fake-engine flow shows the menu
      state.
- [ ] **AC2** — In engine mode (Q2PRO), choosing "Crosshair off" makes `NativePlayer` send exactly
      the console line `crosshair 0` through `playbackConsoleSend` (stub-engine command log,
      `Q2L_UI_ENGINE_COMMAND_LOG`).
- [ ] **AC3** — `scr_draw2d`, `crosshair`, `scr_demobar` and `scr_showpause` are in
      `SESSION_RESTORE_CVARS`; after an engine session that changed them, the installation's
      config holds the earlier archived values (`npx vitest run src/main/modules/replays/demo-play.test.ts`).
- [ ] **AC4** — A `setHud` command with a cvar name outside the allowlist is refused with
      `fail('replays.player.error.hudOption')` (`npx vitest run src/shared/replays/hud-options.test.ts`).
- [ ] **AC5** — In an R1Q2 session the HUD menu is disabled, with a visible reason text.
- [ ] **AC6** — HUD options chosen once apply again to the next demo in the same mode
      (persisted in the `replays` slot, forgiving parse).
- [ ] **AC7** — `npm run ui:flow -- replays-hud-options` is green and the flow is registered in
      `scripts/flows/areas.json`.
- [ ] **AC8** — `docs/systems/replays-module.md` lists the new restore cvars.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
