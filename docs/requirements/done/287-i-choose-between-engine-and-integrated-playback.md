---
id: 287
title: I choose between engine and integrated playback
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to choose whether demos play in the native Q2PRO window (engine mode) or right
inside the launcher (integrated mode), so that I can try the new player and go back to the proven
path at any time.

Context:

- [concept §9.5](../../concepts/integrated-demo-player.md) (switching modes), [concept §9.2](../../concepts/integrated-demo-player.md) (capabilities per mode); default mode is an
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

- [x] **AC1** — A `state.json` without `replays.playbackMode`, or with an invalid value, reads as
      mode `engine`; the other fields of the `replays` slot are untouched (persisted and golden
      tests).
- [x] **AC2** — The contract-first handlers `playbackMode.read` and `playbackMode.set` (zod
      `z.enum(['engine','integrated'])`) exist; after `set` with `integrated`, `read` returns
      `integrated`, also after a restart.
- [x] **AC3** — In Settings → Demos the "Playback" switch between "Engine window" and "Integrated
      (experimental)" stores the chosen value.
- [x] **AC4** — The Demos view shows a segmented switch with both modes next to "Play" that reads
      and writes the same value.
- [x] **AC5** — While a demo plays, the switch is disabled and shows the visible text "Stop the
      demo to switch" (`replays.player.mode.lockedWhilePlaying`), not only a tooltip.
- [x] **AC6** — In mode `integrated`, an `.mvd2` demo has Play disabled with the visible reason
      "MVD2 demos play in engine mode for now" (`replays.player.unavailable.mvd2Integrated`).
- [x] **AC7** — In mode `engine`, eligibility is unchanged from today.
- [x] **AC8** — In mode `integrated`, a demo is playable when the active installation has
      `baseq2` but only R1Q2 or no recognised engine.
- [x] **AC9** — `npm run ui:flow -- replays-play-q2pro` stays green (engine mode unchanged).

## Open Questions

## Decisions (Sprint)

- **Default stays `engine`** (sprint note, concept §17 Q4): integrated mode is opt-in and experimental this sprint.
- **The Demos-view switch sits in the view header** next to "All installations" / Refresh: "Play" (View) is the shell's action-bar button, which a module may not edit and which has no slot for module controls.
- **Settings and the Demos view render the same `PlaybackModeSwitch`**, one segmented control with "Engine window" / "Integrated (experimental)": one component means both places read, write and lock identically.
- **The segmented shape is extracted into `components/ui/SegmentedControl.tsx`** and `ServersModeToggle` + `LayerSwitcher` move onto it: the shape already exists twice, a third copy is a refine error.
- **The renderer holds the mode in a small module store** (`playback-mode-store.ts`) that reads once and replaces its value with main's returned value after `set`: Settings, the view header and every `useDemoPlay` instance must see one value.
- **Until the first read lands, the store reports `engine`**: the persisted default, so existing flows' timing and AC7/AC9 are unchanged; the read resolves before any human click.
- **The lock applies to both switches** (Settings and view) while a playback session exists or a play is starting (`usePlaybackStore` `session !== null`): concept §9.5 says the control is disabled while a demo plays, with no exception for Settings.
- **`demoPlayEligibility` takes a required `mode`**; main's `demo.play` path passes `'engine'` and stays engine-only: the renderer never calls `demo.play` in integrated mode, and 291 adds the integrated path.
- **Integrated eligibility rules, in order:** no active installation, or one whose `root-exists` / `base-game-dir` / `base-paks` check has severity `error` → `replays.player.unavailable.noBasePaks`; game running → existing `gameRunning`; `.mvd2` (incl. `.gz`) → `mvd2Integrated`; mod missing → the existing acknowledgeable `modMissing` warning; otherwise playable. The engine, Steam-runner and R1Q2-protocol rules do not apply: integrated mode launches no engine and needs only `baseq2` paks (concept §9.2).
- **A running game still refuses integrated play**: one playback at a time keeps sound and CPU single-owned; 291 may revisit it.
- **The interim "not ready" gate lives in `useDemoPlay`, not in the shared eligibility**: AC8 requires eligibility to say "playable", and 291 deletes one renderer branch to remove the gate.
- **No platform gate**: integrated mode is meant for Windows and Linux alike, so nothing is disabled per platform here.
- **AC6 is proven below e2e** (shared eligibility + `useDemoPlay` rendering the i18n text): the new flow uses the timeline fixture, whose stub keeps a `.dm2` session alive for the lock; a second fixture would need a second flow for a display-only state.

## Plan

1. **Shared + main (D1):** `PlayerMode` + zod schema + default in `src/shared/replays/player-mode.ts`;
   `replays.playbackMode` in the persisted slot (forgiving, default `engine`); contract handlers
   `playbackMode.read` / `playbackMode.set`; main handlers; golden fixture; systems doc.
2. **Eligibility (D2):** `demoPlayEligibility` takes `mode`; integrated rules per Decisions;
   ok-result discriminated by `mode`; main passes `'engine'`; reason strings in `en.json`.
3. **UI kit (D3):** extract `SegmentedControl`, move `ServersModeToggle` and `LayerSwitcher` onto it.
4. **Renderer state (D4):** client calls, `playback-mode-store.ts`, `useDemoPlay` passes the mode
   and adds the interim `integratedNotReady` gate.
5. **Renderer UI + flow (D5):** `PlaybackModeSwitch` in Settings → Demos and in the Demos view
   header, lock text while playing; flow `replays-playback-mode`; `areas.json`; CHANGELOG line.

Order: D1 → D2 → D3 → D4 → D5. D3 is independent of D1/D2.

## Deliverables

- **D1 — The mode is persisted and served over IPC.**
  - New `src/shared/replays/player-mode.ts`: `export const PLAYER_MODES = ['engine', 'integrated'] as const`, `export type PlayerMode`, `export const playerModeSchema = z.enum(PLAYER_MODES)`, `export const DEFAULT_PLAYER_MODE: PlayerMode = 'engine'`. Pure (zod only). Not to be confused with `PlaybackMode` in the renderer's `playback-store.ts`.
  - `src/main/modules/replays/persisted.ts`: add `playbackMode: PlayerMode` to `ReplaysState`, parsed field-level forgivingly exactly like `demoVolume` (missing/invalid → `'engine'`, other fields untouched), default in `replaysSpec.defaults`. Add `setPlaybackMode(state, mode)` next to `rememberDemoVolume`.
  - `src/shared/modules/replays.ts`: `REPLAYS_HANDLERS.playbackModeRead: 'playbackMode.read'`, `playbackModeSet: 'playbackMode.set'`; input schemas `replaysNoInputSchema` and `z.object({ mode: playerModeSchema }).strict()`; both return `PlayerMode` in `ReplaysContract` (mirror `modWarningRead` / `modWarningSetEnabled` at lines ~64, ~706, ~743, ~867).
  - `src/main/modules/replays/index.ts`: register both next to the `modWarning` handlers (~line 647); `set` returns the stored value.
  - Golden: add `"playbackMode": "bogus"` to the `replays` slot of `src/main/modules/__fixtures__/state/v5-full.json`, regenerate every `*.expected.json` with `GOLDEN_UPDATE=1 npx vitest run src/main/modules/persisted-state.golden.test.ts`, check each expected file now carries `"playbackMode": "engine"` and nothing else changed.
  - `docs/systems/replays-module.md`: the persisted-state section names `playbackMode`; the handler list names `playbackMode.read` / `playbackMode.set`.
  - Tests: `src/main/modules/replays/persisted.test.ts` › "playbackMode parses forgivingly" (missing, `'integrated'`, `'bogus'`, `3`, `null`; `demoVolume`/`listSort` in the same input survive); `src/main/modules/replays/index.test.ts` › "playbackMode handlers persist the mode across a reload" (mirror "modWarning handlers persist enabled and trusted mods": read → engine, set integrated → integrated, reload a fresh `StateStore` → integrated) and "playbackMode.set rejects a mode outside the enum" (`ipc.error.invalidPayload`). Update existing `persisted.test.ts` default-object expectations (lines ~24, ~97).

- **D2 — Eligibility knows the mode.**
  - `src/shared/replays/demo-play.ts`: `DemoPlayInput` gains required `mode: PlayerMode` (import from `./player-mode`) and `checks` in the installation `Pick`. `mode: 'engine'` runs today's code unchanged. `mode: 'integrated'` checks, in this order: no active installation, or an active one with a `root-exists`, `base-game-dir` or `base-paks` check of severity `'error'` → `refuse('replays.player.unavailable.noBasePaks')`; `gameRunning` → existing `replays.play.unavailable.gameRunning`; `demo.format === 'mvd2'` → `refuse('replays.player.unavailable.mvd2Integrated')`; mod dir missing and not acknowledged → the existing acknowledgeable `modMissing` refusal; else ok. Engine kind, Steam runner and the R1Q2 protocol rule are not checked in integrated mode.
  - Result type: the ok variant becomes a union discriminated by `mode` — `{ ok: true, mode: 'engine', installationId, gameDir, inPlace, extraArgs, playEngine, engine? }` and `{ ok: true, mode: 'integrated', installationId, gameDir }`. Add an overload so a call with `mode: 'engine'` is typed as the engine result (no runtime narrowing in main). Extend `DemoPlayReasonKey` with `replays.player.unavailable.noBasePaks`, `…mvd2Integrated`, `…integratedNotReady` (the last is produced by the renderer until story 291).
  - `src/main/modules/replays/demo-play.ts` (~line 464): pass `mode: 'engine'`; nothing else changes. `src/renderer/src/modules/replays/useDemoPlay.ts`: pass `mode: 'engine'` for now (D4 wires the real mode) and keep compiling against the new ok shape.
  - `src/renderer/src/modules/replays/locale/en.json`, under `replays.player.unavailable`: `noBasePaks` "Integrated playback needs an installation with the Quake II game files (baseq2). Pick one in the left rail.", `mvd2Integrated` "MVD2 demos play in engine mode for now", `integratedNotReady` "Integrated mode is not ready yet — switch to Engine window to play."
  - Tests in `src/shared/replays/demo-play.test.ts` (the helper at line ~40 gains `mode: 'engine'` by default so every existing test stays as is): "integrated mode plays on an R1Q2-only or engine-less installation that has baseq2 paks", "integrated mode refuses an mvd2 and an mvd2.gz with the engine-mode reason", "integrated mode refuses an installation whose base paks are missing", "integrated mode ignores the Steam runner but still refuses a running game and warns on a missing mod", "integrated reasons are reported in the fixed order".

- **D3 — One segmented control in the UI kit.**
  - New `src/renderer/src/components/ui/SegmentedControl.tsx`: generic over a string value; props `label` (aria-label of the `role="group"`), `options: { value, label, testId? }[]`, `value`, `onChange`, `disabled?`. Renders `Button size="sm"` with `variant` `primary`/`neutral` and `aria-pressed`, `flex flex-wrap items-center gap-1.5` — exactly today's markup in `src/renderer/src/modules/servers/ServersModeToggle.tsx`.
  - Move `ServersModeToggle.tsx` and `src/renderer/src/modules/config/components/LayerSwitcher.tsx` onto it; their test ids, aria labels and outside behaviour stay identical (LayerSwitcher keeps its leading label span and its "nothing when no layers").
  - Test: `src/renderer/src/components/ui/SegmentedControl.test.tsx` › "the chosen option is pressed and a click reports the other value" and "a disabled control reports nothing". Existing servers/config tests stay green unchanged.

- **D4 — The renderer knows the mode and Play follows it.**
  - `src/renderer/src/modules/replays/client.ts`: `readPlaybackMode()` / `setPlaybackMode(mode)` (mirror `readModWarning` / `setModWarningEnabled`, ~line 323).
  - New `src/renderer/src/modules/replays/playback-mode-store.ts` (zustand, like `folder-store.ts`): `mode: PlayerMode` (starts `'engine'`), `loaded`, `error: LocalizedMessage | null`, `busy`, `load()` (reads once; repeated calls are no-ops while loaded or loading), `set(mode)` (calls `setPlaybackMode`, then takes main's returned value; a refusal sets `error`, the value stays).
  - `src/renderer/src/modules/replays/useDemoPlay.ts`: read `mode` from the store (and call `load()` on mount), pass it into both `demoPlayEligibility` calls. Interim gate until story 291: when `mode === 'integrated'` and the eligibility is ok, return `refuse('replays.player.unavailable.integratedNotReady')` as the hook's `eligibility` (a refusal never calls `playDemo`). Mark it `(story 291)` in a trailing comment.
  - Tests in `src/renderer/src/modules/replays/useDemoPlay.test.ts`: "in integrated mode an mvd2 shows the engine-mode reason" (rendered text "MVD2 demos play in engine mode for now"), "in integrated mode a playable demo says integrated mode is not ready and never starts", "engine mode still plays through demo.play". Store test `playback-mode-store.test.ts` › "set takes main's returned mode and a refusal keeps the old one".

- **D5 — The user switches the mode in Settings and in the Demos view.**
  - New `src/renderer/src/modules/replays/components/PlaybackModeSwitch.tsx`: `SegmentedControl` (from D3) over `PLAYER_MODES`, labels `replays.player.mode.engine` "Engine window" / `replays.player.mode.integrated` "Integrated (experimental)", group label `replays.player.mode.label` "Playback"; props `testIdPrefix`. Reads/writes `usePlaybackModeStore` (D4), calls `load()` on mount. Disabled while `usePlaybackStore` has a `session` or the store is `busy`; while a session exists it renders the visible text `replays.player.mode.lockedWhilePlaying` "Stop the demo to switch" (`data-testid="<prefix>-locked"`), never only a tooltip. A store error renders as `role="alert"` text. Test ids `<prefix>-engine`, `<prefix>-integrated`.
  - `ReplaysSettingsSection.tsx`: a `PlaybackSettings` block (SectionLabel "Playback", same `border-t` block shape as `ModWarningSettings`) with prefix `replays-settings-playback-mode`, first in the section.
  - `ReplaysView.tsx` header (~line 799, the `flex items-center gap-4` group): the switch before the scope `Switch`, prefix `replays-playback-mode`.
  - Strings in `src/renderer/src/modules/replays/locale/en.json` under `replays.player.mode`.
  - New flow `scripts/flows/replays-playback-mode.mjs` on the timeline fixture (mirror `replays-stop.mjs`: `variant = REPLAYS_TIMELINE_VARIANT`, `writeReplaysTimelineFixture`, its engine env, demo `REPLAYS_PLAY_CTF_DEMO`); flow name "replays-playback-mode". Steps: Settings → Demos, click Integrated → pressed, and `window.q2.invoke('module:invoke', { moduleId: 'replays', type: 'playbackMode.read' })` returns `integrated`; open Demos → view switch shows Integrated pressed; select the demo → `actionbar-play[data-action="view"]` disabled, `actionbar-action-reason` text "Integrated mode is not ready yet …"; click Engine in the view → read returns `engine`, Play enabled; Play → timeline visible → both view buttons disabled and `replays-playback-mode-locked` visible with "Stop the demo to switch"; stop via `replays-timeline-stop` → buttons enabled again. Register it in `scripts/flows/areas.json` area `replays-playback` and add the paths `src/shared/replays/demo-play.ts`, `src/shared/replays/player-mode.ts`, `src/renderer/src/modules/replays/playback-mode-store.ts`, `src/renderer/src/modules/replays/components/PlaybackModeSwitch.tsx`.
  - `CHANGELOG.md` `## Unreleased` → `### Added`: "- Demos can play inside the launcher (experimental), switchable in Settings." (later stories of this feature edit this line).

## Model Hints

- D2 → deliverable-hard: the ok-result becomes a mode-discriminated union with an overload, consumed by main's engine launch path and two renderer callers — a mistyped narrowing or a reordered check silently changes engine-mode eligibility (AC7) or launches the engine from integrated mode.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/persisted.test.ts` › "playbackMode parses forgivingly"; golden `src/main/modules/persisted-state.golden.test.ts` › "every fixture state.json loads to the golden document" (v5-full carries an invalid value).
- AC2 → unit `src/main/modules/replays/index.test.ts` › "playbackMode handlers persist the mode across a reload" and "playbackMode.set rejects a mode outside the enum".
- AC3 → e2e `scripts/flows/replays-playback-mode.mjs` › "replays-playback-mode" (Settings step + IPC read).
- AC4 → e2e `scripts/flows/replays-playback-mode.mjs` › "replays-playback-mode" (view switch shows the Settings value, its click is read back).
- AC5 → e2e `scripts/flows/replays-playback-mode.mjs` › "replays-playback-mode" (lock step).
- AC6 → unit `src/shared/replays/demo-play.test.ts` › "integrated mode refuses an mvd2 and an mvd2.gz with the engine-mode reason"; renderer `src/renderer/src/modules/replays/useDemoPlay.test.ts` › "in integrated mode an mvd2 shows the engine-mode reason".
- AC7 → unit `src/shared/replays/demo-play.test.ts` (every existing `demoPlayEligibility` test, now run with `mode: 'engine'`, e.g. › "reasons are reported in the fixed order"); `src/renderer/src/modules/replays/useDemoPlay.test.ts` › "engine mode still plays through demo.play".
- AC8 → unit `src/shared/replays/demo-play.test.ts` › "integrated mode plays on an R1Q2-only or engine-less installation that has baseq2 paks".
- AC9 → e2e `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro" (existing, unchanged).
- Expected manual residue from the requirement (wording and placement) is not a criterion; the placement is decided above.

## Done

Summary: the playback mode (`engine` default / `integrated`) is persisted forgivingly in the `replays` slot and served by `playbackMode.read` / `playbackMode.set`. `demoPlayEligibility` takes a required `mode` with the integrated rules; `useDemoPlay` follows the mode and shows `integratedNotReady` until 291. One `PlaybackModeSwitch` (on the new `SegmentedControl` UI-kit primitive, which `ServersModeToggle` and `LayerSwitcher` now use) sits in Settings → Demos and the Demos view header and locks with visible text while a demo plays.

Change type: feat

Commit message: `287: playback mode engine/integrated (persisted, IPC, eligibility, switch in Settings + Demos view), SegmentedControl UI kit, flow replays-playback-mode`

Verification (narrow gate): `npm run build:dev` (mods flows need a dev-modules build; a production `npm run build` hides `nav-mods`, which turned 4 mods flows red until rebuilt), typecheck, lint green; `npx vitest run --changed HEAD` green (194 files, 1807 tests); `ui:flows -- --affected <replays-playback-mode, replays-play-q2pro> --shard=1/2, 2/2` ran on the production build: only the 4 mods flows (mods-install, mods-install-refused, replays-mod-install, replays-mod-warning) red, then all four plus both story flows green on the dev build (run singly via `ui:flow`). Review: default stage, PASS, 1 fix cycle.
AC → test: AC1 persisted.test.ts "playbackMode parses forgivingly" + golden test; AC2 replays/index.test.ts both named tests; AC3/AC4/AC5 flow `replays-playback-mode`; AC6 demo-play.test.ts mvd2 test + useDemoPlay.test.ts "in integrated mode an mvd2 shows the engine-mode reason"; AC7 demo-play.test.ts existing tests + "engine mode still plays through demo.play"; AC8 demo-play.test.ts R1Q2-only test; AC9 flow `replays-play-q2pro`. All passed. manual residue: wording and placement of the switch (as in the requirement).
Decisions: ReplaysView hint ("Plays with this installation's Q2PRO") now shows only for `mode === 'engine'` (ok result is a union); `useDemoPlay.play()` also returns early in integrated mode so an acknowledged mod warning cannot reach `playDemo`; replays view/dialog tests gained a `readPlaybackMode` mock because the store loads on mount; `i18n` bundle snapshot updated.
Unfixed review findings (accepted): "engine mode still plays through demo.play" overlaps neighbouring play tests (kept, it is the AC7 named test); the Settings switch's lock is proven by the shared component's unit test and the view switch's flow step, not a second flow step; the flow asserts the interim "not ready" text, which story 291 removes together with the gate; PlaybackModeSwitch test omits `busy` and error states.
Note for the gate: `scripts/repo-hygiene.test.mjs` CRLF report seen by D5 did not reproduce in the verify run.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 8
