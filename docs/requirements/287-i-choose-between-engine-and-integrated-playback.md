---
id: 287
title: I choose between engine and integrated playback
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to choose whether demos play in the native Q2PRO window (engine mode) or right
inside the launcher (integrated mode), so that I can try the new player and go back to the proven
path at any time.

Context:

- [concept §9.5](../concepts/integrated-demo-player.md) (switching modes), [concept §9.2](../concepts/integrated-demo-player.md) (capabilities per mode); default mode is an
  open point of the concept.
- Persistence: `src/main/modules/replays/persisted.ts` (forgiving parse like `demoVolume`),
  golden test `src/main/modules/persisted-state.golden.test.ts`. Contract:
  `src/shared/modules/replays.ts` (`REPLAYS_HANDLERS`, schemas, `ReplaysContract`).
- Eligibility: `src/shared/replays/demo-play.ts` (`demoPlayEligibility`), renderer
  `src/renderer/src/modules/replays/useDemoPlay.ts`. UI: `ReplaysSettingsSection.tsx`
  (Settings → Demos), `ReplaysView.tsx`, strings in `src/renderer/src/modules/replays/locale/en.json`.
- `PlayerMode` is created here in `src/shared/replays/player-mode.ts`; [[292]] re-exports it from
  `player-api.ts`. The segmented switch uses the existing UI-kit primitives
  (`components/ui/controls`), no raw colours (`/design-tokens`).
- Until [[291]] lands, Play in integrated mode shows the visible reason
  `replays.player.unavailable.integratedNotReady`; [[291]] removes it.
- New flow `scripts/flows/replays-playback-mode.mjs`, registered in `scripts/flows/areas.json`.
- `CHANGELOG.md` under `## Unreleased`: one line "Demos can play inside the launcher
  (experimental), switchable in Settings"; later stories of this feature edit this line instead
  of adding new ones. `docs/systems/replays-module.md` persisted-state section gains
  `playbackMode`.
- Not in scope: engine playback ([[291]]), timeline/store rework ([[297]]), changing the default
  mode (stays `engine`).
- Depends on: —

Expected manual residue: wording and placement of the switch in the Demos view.

## Acceptance Criteria

- [ ] **AC1** — A `state.json` without `replays.playbackMode`, or with an invalid value, reads as
      mode `engine`; the other fields of the `replays` slot are untouched (persisted and golden
      tests).
- [ ] **AC2** — The contract-first handlers `playbackMode.read` and `playbackMode.set` (zod
      `z.enum(['engine','integrated'])`) exist; after `set` with `integrated`, `read` returns
      `integrated`, also after a restart.
- [ ] **AC3** — In Settings → Demos the "Playback" switch between "Engine window" and "Integrated
      (experimental)" stores the chosen value.
- [ ] **AC4** — The Demos view shows a segmented switch with both modes next to "Play" that reads
      and writes the same value.
- [ ] **AC5** — While a demo plays, the switch is disabled and shows the visible text "Stop the
      demo to switch" (`replays.player.mode.lockedWhilePlaying`), not only a tooltip.
- [ ] **AC6** — In mode `integrated`, an `.mvd2` demo has Play disabled with the visible reason
      "MVD2 demos play in engine mode for now" (`replays.player.unavailable.mvd2Integrated`).
- [ ] **AC7** — In mode `engine`, eligibility is unchanged from today.
- [ ] **AC8** — In mode `integrated`, a demo is playable when the active installation has
      `baseq2` but only R1Q2 or no recognised engine.
- [ ] **AC9** — `npm run ui:flow -- replays-play-q2pro` stays green (engine mode unchanged).

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
