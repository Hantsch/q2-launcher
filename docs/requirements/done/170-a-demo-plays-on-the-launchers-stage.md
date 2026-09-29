---
id: 170
title: a demo plays on the launcher's stage
status: done # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

When I play a demo, it should look like it plays **inside the launcher**: the picture sits in an area
of the Demos view (the "stage"), with the timeline and console field ([[165]], [[166]]) right beneath
it and usable, not hidden behind a fullscreen game.

Spike [[169]] proved the way: Q2PRO starts as a borderless, always-on-top window whose position and
size the launcher sets (`vid_fullscreen 0`, `win_noborder 1`, `win_notitle 1`, `win_alwaysontop 1`,
`win_noresize 1`, `vid_geometry WxH+X+Y`), laid exactly over the stage. This is **not** embedding
(concept §2 non-goal stays): the game remains its own window. Windowed stage is the **default** for
every demo playback; fullscreen is a deliberate choice ([[172]]).

These are session settings of a demo playback only; a normal game launch is unchanged.

## Acceptance Criteria

- [x] **AC1** — While a demo plays, the Demos view shows a stage area, and the timeline and console
      field are visible and operable below it.
- [x] **AC2** — A demo playback starts Q2PRO windowed, borderless and topmost, with its client area
      covering the stage exactly (physical pixels, correct at display scaling other than 100 %).
- [x] **AC3** — The window parameters are passed only to demo playbacks; a normal launch's arguments
      are unchanged.
- [x] **AC4** — The window parameters do not end up permanently in the user's own config (Q2PRO
      archives cvars on exit) — or the recorded decision states which ones do and why that is
      acceptable.
- [x] **AC5** — On a platform or session where the stage cannot position the window, the stage shows
      the reason as visible text (i18n key), and the demo still plays in a normal window.
- [x] **AC6** — Stage labels and reasons are i18n keys.

## Decisions (Sprint)

- **(User)** Stage layout: keep Q2's 4:3 ratio and use the space available in the view; the demo list/detail are not needed (hidden/collapsed) while a demo plays.
- **(User)** Archived cvars: pass stage geometry in a non-archived way; fall back to restoring after the session only if that is not possible.
- **(User)** Linux: detect Wayland, show visible-text "Not available on Wayland: ..." (i18n key) and play in a normal window.
- **Archived set, from evidence:** only `vid_fullscreen` and `vid_geometry` are archived — after the
  spike, `C:\Games\Q2Pro\opentdm\q2config.cfg` holds `seta vid_fullscreen "0"` and
  `seta vid_geometry "800x450+400+300"` (the spike's live values), while no `win_noborder`/
  `win_notitle`/`win_alwaysontop`/`win_noresize` line is written although default-valued archived
  cvars (`win_noalttab "0"`) are; so the four `win_*` go as plain `+set` with nothing to restore.
- **AC4 mechanism = restore after the session** (the User's fallback), because no non-archived path
  exists for these two: they are archived engine-side, and 171/172 must set them *live*
  (`set vid_geometry`, `vid_fullscreen 1/0`), which Q2PRO archives the same as a `+set`.
- **Restore is line-exact:** only the `vid_fullscreen`/`vid_geometry` lines of the playback game's
  engine-written `q2config.cfg` are put back to their pre-session text (or removed if absent before);
  every other byte stays — the one recorded exception to story 004's "never overwrite engine-written
  config", limited to the cvars the launcher itself changed.
- **Restore survives a launcher crash:** the snapshot is persisted before launch and applied at the
  replays module's next start if still pending, mirroring story 160's startup sweep — otherwise a
  crash leaves the user's normal game windowed.
- **The restore helper takes a cvar-name list**, so 174 (or later stories) can add a cvar without a
  second mechanism.
- **Q4 multi-monitor:** the scale of the display Electron matches to the launcher's content bounds
  (largest overlap) applies to the whole stage — through `screen.dipToScreenRect(win, rect)` where
  Electron offers it, which handles per-monitor DPI and display origins; a launcher straddling two
  differently scaled displays may be off on the minor part, accepted because 171 re-places the
  window on every move.
- **X11 gets the stage** (no reason shown): the concept expects X11 to honour `vid_geometry`; the
  real-window check is manual residue rather than a pre-emptive "not available".
- **Wayland detection:** `XDG_SESSION_TYPE === 'wayland'` or a non-empty `WAYLAND_DISPLAY`, only on
  Linux — covers native and XWayland sessions, which cannot reliably place a window.
- **"Normal window" on Wayland = `+set vid_fullscreen 0` only** (no geometry/`win_*`), so the AC5
  demo still leaves the timeline reachable; `vid_fullscreen` is restored like on the stage.
- **The rect is measured by the renderer, converted by main:** the renderer sends the stage's CSS-px
  rect (zod-bounded ints, never a path); main adds the window's content bounds and zoom factor and
  converts to physical pixels — the renderer cannot know screen pixels.
- **Measure before launch:** Play first switches the view into stage mode (list/detail hidden with CSS,
  kept mounted so the play action's error/confirm state survives), measures, then calls `demo.play`
  with the rect; the timeline slot has a fixed height in stage mode so the arming measurement equals
  the playing one.
- **Later rect changes use a new `playback.stage` handler** that sends `set vid_geometry …` through
  the existing channel; 170 sends it only when the stage's own box changes (e.g. timeline appears,
  view resized) — coalescing and window move/minimize/focus tracking stay 171's.
- **No rect → no stage args:** a `demo.play` without `stage` launches exactly as today, which keeps
  every existing caller and test unchanged.
- **Harness lever for AC5:** `Q2L_UI_SESSION_TYPE=wayland`, honoured only when `Q2L_UI_HARNESS` is
  set (precedent `Q2L_UI_PICK_FILES`), so the reason text is proven through the real surface on the
  Windows runner too.
- **Stage fit:** the largest 4:3 rect that fits the free area, centred; the stage surface is CSS only
  (token background + one i18n line), per the no-image-assets rule.

## Open Questions

- ~~**Q1 — Stage size and layout:** fixed aspect ratio (4:3 like Q2, 16:9) or whatever space the view
  leaves? Does the demo list/detail collapse while playing?~~ answered → Decisions (Sprint)
- ~~**Q2 — Archived cvars (AC4):** `vid_geometry`, `win_*` and `vid_fullscreen` are archived by Q2PRO
  and written to `q2config.cfg` on exit — restore them after the session, pass them in a way that is
  not archived, or accept?~~ answered → Decisions (Sprint)
- ~~**Q3 — Linux (parity rule):** X11 is expected to honour `vid_geometry` (unverified); Wayland cannot
  position windows. Detect Wayland and show "Not available on Wayland: …" with a normal window?~~ answered → Decisions (Sprint)
- ~~**Q4 — Multi-monitor:** the stage follows the launcher's display; which display scale applies when
  the launcher spans two?~~ answered → Decisions (Sprint)

## Plan

Demo playbacks get stage launch args built from a renderer-measured rect; normal launches never
pass through that code. Order: contract + pure helpers → main wiring → cvar restore → renderer
stage → play wiring + flows.

1. **Contract + pure helpers (D1).** `src/shared/modules/replays.ts`: optional `stage` rect on the
   `demo.play` payload, a `stage` outcome on its result, new `playback.stage` handler + schema.
   `src/main/modules/replays/stage.ts`: availability (Wayland), CSS rect → physical `WxH+X+Y`,
   the stage / normal-window arg lists.
2. **Main wiring (D2).** `demo-play.ts` `launch()` puts the stage args before `+demo` (next to the
   channel's `argsBeforeDemo`); `index.ts` injects the window's content bounds, zoom and
   `screen.dipToScreenRect`; `playback.stage` sends `set vid_geometry …` via `playback.send`.
3. **Restore (D3).** `session-cvar-restore.ts`: snapshot `vid_fullscreen`/`vid_geometry` lines of the
   game's engine-written `q2config.cfg` before launch, persist it, put the lines back on exit
   (mirroring `trackCopy`) and at module start if pending (mirroring `sweepLauncherDirs`).
4. **Renderer stage (D4).** Store `stageArmed`; `ReplaysView` in stage mode hides the filter aside,
   list and detail (CSS, kept mounted) and shows `DemoStage` (4:3 fit) above timeline + console.
5. **Play wiring + flows (D5).** `DemoPlayAction` arms, measures, plays with the rect; `DemoStage`
   reports box changes via `playback.stage` and shows the stage reason; new flows `replays-stage` and
   `replays-stage-unavailable`; `replays-play-q2pro` expectation updated.

Real-window placement (client area, topmost, 150 % scaling, X11) is manual residue: the stub engine
opens no window. Re-run `spikes/169-windowed-stage/harness.mjs`-style probing against `C:\Games\Q2Pro`.

## Deliverables

- [x] **D1 — Stage contract and pure helpers.**
  Files: `src/shared/modules/replays.ts`, `src/main/modules/replays/stage.ts` (new),
  `src/main/modules/replays/stage.test.ts` (new).
  - Add to `replaysDemoPlaySchema` (keep `.strict()`) an optional
    `stage: { x, y, width, height }`: integers in CSS px. `x`/`y` are ≥ 0 and `width`/`height` are
    1–16384, all zod-bounded. Add the same rect schema for a new `REPLAYS_HANDLERS.playbackStage =
    'playback.stage'`, registered in the module's schema map next to `playback.timeline`. The
    `demo.play` success value gains
    `stage: { placed: true } | { placed: false; reason: { key: string } }`, or null when no rect was
    sent.
  - `stage.ts` exports three helpers:
    - `stageAvailability(platform, env, harnessEnv)` returns
      `{ available: true } | { available: false, reason: { key: 'replays.stage.unavailable.wayland' } }`.
      On `linux`, `XDG_SESSION_TYPE === 'wayland'` or a non-empty `WAYLAND_DISPLAY` means
      unavailable. `Q2L_UI_SESSION_TYPE=wayland` forces unavailable on any platform, but only when
      `Q2L_UI_HARNESS` is set (mirror `Q2L_UI_PICK_FILES` in `src/main/services/dialog.ts`).
    - `stageGeometry(cssRect, { contentBounds, zoomFactor }, dipToScreen)` returns `'WxH+X+Y'` in
      physical pixels. It computes the DIP rect `contentBounds.x + x*zoom` and so on, passes that
      through the injected `dipToScreen`, and rounds.
    - `stageLaunchArgs(geometry)` returns, in this order, `+set vid_fullscreen 0 +set win_noborder 1
      +set win_notitle 1 +set win_alwaysontop 1 +set win_noresize 1 +set vid_geometry <g>`.
      `normalWindowArgs()` returns `+set vid_fullscreen 0`.
  - Tests in `stage.test.ts`:
    - Wayland detected by either env var and ignored off Linux.
    - The harness lever is honoured only with `Q2L_UI_HARNESS`.
    - Geometry at scale 1, at scale 1.5 (a `dipToScreen` that scales), with a secondary-display
      origin offset, and with zoom ≠ 1.
    - Exact arg order.
    - The schema rejects a negative, fractional, zero-size or extra-key rect.
- [x] **D2 — Main passes stage args to demo playbacks only.**
  Files: `src/main/modules/replays/demo-play.ts`, `src/main/modules/replays/index.ts`,
  `src/main/modules/replays/demo-play.test.ts`, `src/main/services/launch-plan.test.ts`.
  Uses D1's `stage.ts` helpers and schema.
  - `createDemoPlay` gets two new deps. `stageAvailability` is bound in `index.ts` to
    `process.platform`/`process.env`. `toGeometry(cssRect) → string | null` is built in `index.ts`
    from the main window's `getContentBounds()`, `webContents.getZoomFactor()` and
    `screen.dipToScreenRect(win, rect)`. Where Electron lacks `dipToScreenRect`, multiply by
    `screen.getDisplayMatching(bounds).scaleFactor`. It returns null without a window.
  - In `launch()`, when the payload has `stage`:
    - If the stage is available and `toGeometry` gives a geometry, put `stageLaunchArgs` right
      before `+demo` (after the channel's `argsBeforeDemo`) and return `stage: { placed: true }`.
    - If it is unavailable, add `normalWindowArgs()` and return `{ placed: false, reason }`.
    - Without `stage`, the args stay exactly as today and the result is `stage: null`.
  - The new `playback.stage` handler checks for a live session that was placed. If there is one, it
    calls `playback.send('set vid_geometry <g>')` and returns ok. With no session or no placed stage
    it returns a no-op ok, never an error.
  - Tests in `demo-play.test.ts`:
    - Stage args sit before `+demo` on both platforms.
    - Wayland gets `+set vid_fullscreen 0` only, plus the reason.
    - No rect means today's args.
    - `playback.stage` sends exactly one `set vid_geometry` line when placed and nothing otherwise.
  - Test in `launch-plan.test.ts`: "a normal launch carries no stage cvar". `buildLaunchArgs` for a
    plain launch contains none of `vid_fullscreen`, `vid_geometry` or `win_`.
- [x] **D3 — Archived stage cvars are restored after the session.**
  Files: `src/main/modules/replays/session-cvar-restore.ts` (new), `session-cvar-restore.test.ts`
  (new), `src/main/modules/replays/demo-play.ts`, `src/main/modules/replays/index.ts`.
  - `createCvarRestore({ names, fs, pendingPath })`. `names` is `['vid_fullscreen', 'vid_geometry']`
    for 170. 174 may append to this list.
  - `snapshot(configPath)` records, per name, the exact original line or "absent". It writes the
    snapshot to `pendingPath` before the launch starts.
  - `restore()` runs after the process has exited, because the engine writes the config on exit. In
    that file it replaces each named `seta`/`set` line with the snapshot line, or removes the line if
    it was absent before. It leaves every other line byte-identical, including line endings, and a
    missing file is a no-op. It then deletes `pendingPath`.
  - `applyPending()` runs a leftover snapshot once.
  - The config path is `<write dir>/<game>/q2config.cfg`:
    - On Windows the write dir is the game dir itself (`playbackInfo.gameDirPath`).
    - On Linux use `effectiveWriteDirs` from `discovery.ts` (`~/.q2pro/<basename(gameDirPath)>`)
      when it applies, else the game dir.
    - Take the file name from `writtenConfigName` in `src/shared/config/engine-limits.ts`.
  - `pendingPath` lives under the launcher's userData, next to the replays module's other stored
    state (use the same dir resolution).
  - Wire it in `demo-play.ts`: snapshot only for plays that received stage or normal-window args,
    and restore on `exited`/`failed`, mirroring `trackCopy` (L194). In `index.ts`, call
    `applyPending()` next to the `sweepLauncherDirs` startup call (L229).
  - Tests:
    - Round trip with other lines and CRLF preserved.
    - A cvar absent before is removed.
    - The user's non-stage changes made during the session survive.
    - A missing file does nothing.
    - A pending snapshot is applied at start and then deleted.
    - A normal launch takes no snapshot.
- [x] **D4 — The Demos view has a stage mode.**
  Files: `src/renderer/src/modules/replays/playback-store.ts`, `ReplaysView.tsx`,
  `components/DemoStage.tsx` (new), `components/DemoStage.test.tsx` (new), `stage-fit.ts` (new, pure),
  `stage-fit.test.ts` (new), `src/renderer/src/i18n/locales/en.json`.
  - The store gains `stageArmed`, `armStage()`, `disarmStage()` and `stageRect` (the last measured
    CSS rect).
  - Stage mode is `stageArmed || session !== null`. In stage mode `ReplaysView` hides the filter
    `<aside>`, the list and the detail with CSS (`hidden`). They stay mounted. The body row renders
    `DemoStage` (testid `replays-stage`) instead. `<DemoTimeline/>` and `<ConsoleCommandField/>`
    stay beneath it.
  - The timeline slot gets a fixed height in stage mode, including while armed with no session, so
    the stage box does not change when the session starts.
  - `DemoStage` measures its free area with a ResizeObserver (guard `typeof ResizeObserver`, mirror
    `components/VirtualDemoList.tsx:55-62`). `fitAspect(box, 4/3)` in `stage-fit.ts` gives the
    largest centred 4:3 rect. `DemoStage` renders that inner box (testid `replays-stage-picture`)
    with a token background and the i18n line `replays.stage.label`, and writes the box's
    `getBoundingClientRect()` (viewport CSS px, rounded) to `stageRect`.
  - An optional `reason` prop renders visible text (testid `replays-stage-reason`, `role="status"`).
  - Session end or `disarmStage()` returns the normal layout.
  - Keys go in `en.json`:
    - `replays.stage.label`: "The demo plays here"
    - `replays.stage.unavailable.wayland`: "Not available on Wayland: the launcher cannot place the
      game window, so the demo plays in its own window"
  - Tests: `fitAspect` covers wide, tall and exact boxes. `DemoStage.test.tsx` covers stage mode
    hiding list/detail while keeping them mounted, the label and reason coming from i18n keys, and
    `stageRect` being written. Mirror `DemoTimeline.test.tsx`.
- [x] **D5 — Play launches onto the stage; flows.**
  Files: `components/DemoPlayAction.tsx`, `components/DemoPlayAction.test.tsx`,
  `src/renderer/src/modules/replays/client.ts`, `components/DemoStage.tsx`,
  `scripts/flows/replays-stage.mjs` (new), `scripts/flows/replays-stage-unavailable.mjs` (new),
  `scripts/flows/replays-play-q2pro.mjs`.
  - `DemoPlayAction`: after any mod-missing confirmation, call `armStage()`, wait one animation frame,
    read `stageRect`, then call `demo.play` with `stage`. On failure, call `disarmStage()` and show
    the error as today; the component stayed mounted, so its state survives. Put the result's
    `stage.reason` in the store so `DemoStage` shows it.
  - `client.ts` gets `sendStageRect(rect)`, which calls `callModule` `playback.stage`.
  - `DemoStage`, while a session is live, calls it when the measured box changes (rounded values
    compared, so there is no resend on an unchanged rect).
  - Flows mirror `scripts/flows/replays-timeline.mjs`: same variant, fixture and stub env.
  - `replays-stage.mjs` checks, in order:
    - `replays-stage-picture` is visible with a 4:3 ± 1 px box.
    - `replays-demo-list` and the detail are hidden, and `replays-timeline` and
      `replays-console-field` sit below the picture.
    - Timeline pause and a console command reach the command log exactly once.
    - main.log's "launching" line contains the stage args, with `vid_geometry` equal to the value
      computed from the picture's box, the window's content bounds and the scale factor. Read those
      through `electronApp.evaluate`.
    - After the quit file, the list is back.
  - `replays-stage-unavailable.mjs` passes `Q2L_UI_SESSION_TYPE=wayland` in `setup()` env and checks
    that `replays-stage-reason` shows the Wayland text, that the launch line has
    `+set vid_fullscreen 0` and no `vid_geometry`, and that the timeline appears.
  - Update `replays-play-q2pro.mjs`'s `endsWith` expectation: the stage args now come before `+demo`.

## Model Hints

- D3 → deliverable-hard — it edits the user's own engine-written `q2config.cfg`. The risks are
  exit-ordering (restore must run after the engine's write-on-exit), byte-exact preservation of every
  other line (CRLF, the user's in-session changes), the Linux write-dir split and crash recovery via
  the pending file. A slip there silently damages user config outside the launcher.
- Review: → story-review-hard. Two wrong implementations would pass the stub-engine flows (which run
  at 100 % scaling and never open a window) and a spec+diff review. One restores by rewriting the
  whole config from the snapshot. The other converts DIP → physical by multiplying global
  coordinates by one scale factor instead of `dipToScreenRect`. The first loses the user's
  in-session config; the second misplaces the stage on a scaled or secondary display.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-stage.mjs` › "replays-stage" (4:3 picture, list/detail hidden,
  timeline + console beneath and operable, list back after exit); unit
  `src/renderer/src/modules/replays/components/DemoStage.test.tsx` › "stage mode hides list and detail
  but keeps them mounted"; unit `src/renderer/src/modules/replays/stage-fit.test.ts` › "fits the largest
  centred 4:3 rect".
- AC2 → unit `src/main/modules/replays/stage.test.ts` › "geometry is physical at 150 % and on an offset
  display" + "stage args in exact order"; unit `src/main/modules/replays/demo-play.test.ts` › "stage
  args sit before +demo"; e2e `scripts/flows/replays-stage.mjs` › "replays-stage" (launch line's
  `vid_geometry` matches the measured picture). **manual residue:** the real Q2PRO window's client
  area landing on the stage, borderless and topmost, at 150 % scaling and on X11 — the stub engine
  opens no window and CI has no scaled display; check against `C:\Games\Q2Pro` as in spike 169.
- AC3 → unit `src/main/services/launch-plan.test.ts` › "a normal launch carries no stage cvar"; unit
  `src/main/modules/replays/demo-play.test.ts` › "no stage rect keeps the args as they are today".
- AC4 → unit `src/main/modules/replays/session-cvar-restore.test.ts` › "restores vid_fullscreen and
  vid_geometry lines byte-exact", "removes a cvar that was absent before", "keeps the user's
  in-session changes", "applies a pending snapshot at start"; decision recorded (win_* not archived).
- AC5 → e2e `scripts/flows/replays-stage-unavailable.mjs` › "replays-stage-unavailable"; unit
  `src/main/modules/replays/stage.test.ts` › "Wayland is detected by either env var, only on linux";
  unit `src/main/modules/replays/demo-play.test.ts` › "Wayland plays a normal window with the reason".
- AC6 → unit `src/renderer/src/modules/replays/components/DemoStage.test.tsx` › "label and reason come
  from i18n keys"; unit `src/main/modules/replays/stage.test.ts` › "the unavailable reason is an i18n
  key".

## Done

Demo playbacks now launch Q2PRO windowed, borderless and topmost onto a "stage" area of the Demos view (4:3 fit, timeline and console beneath). The renderer measures the stage rect, main converts it to physical pixels via `screen.dipToScreenRect` and adds the stage args before `+demo`; `playback.stage` re-places the window when the box changes. `vid_fullscreen`/`vid_geometry` are restored line-exact after the session (and at next start if pending). Wayland plays a normal window with a visible reason.

Commit message: `170: demo plays on the launcher's stage (stage args, line-exact cvar restore, Demos stage mode)`

Verification: narrow gate only — build, typecheck, `npx vitest run --changed HEAD` (1882 passed), flows `replays-stage`, `replays-stage-unavailable`, `replays-play-q2pro` green (`npm run ui:flow -- <name>`). Review: stage 1 (default) UNCLEAR, stage 2 (hard) FAIL, both fixed (2 cycles); no third re-review of the small cycle-2 fixes, each covered by a new test. AC → test: AC1 replays-stage + DemoStage.test + stage-fit.test; AC2 stage.test + demo-play.test + replays-stage; AC3 launch-plan.test + demo-play.test; AC4 session-cvar-restore.test; AC5 replays-stage-unavailable + stage.test + demo-play.test; AC6 DemoStage.test + stage.test — all passed. Manual residue: AC2 — real Q2PRO window client area on the stage, borderless/topmost, at 150 % scaling and on X11 (stub engine opens no window).

Decisions (implementation):
- Console field always reserves its reason line (`min-h-4`) so the stage box is identical before and after session start; DemoPlayAction waits up to 30 frames for a steady rect (skipped without ResizeObserver) and plays without `stage` if the rect is under 64 px.
- `AppContext.getMainWindow` added so the replays module can reach the window for content bounds/zoom.
- `snapshot()` never overwrites a still-pending snapshot (failed restore keeps the original lines).
- `replays-play-q2pro` also updated for the current "is not fully installed" wording (stale since 18e77c0).
- Open, accepted: (1) launcher quit while the game keeps running — next-start `applyPending` restores before the engine's write-on-exit, so the stage values can persist; (2) negative display origins are emitted as `+-X` in `vid_geometry` — Q2PRO's parsing is unverified (check with the real-window manual residue); (3) `toGeometry` in `index.ts` is an inline closure without a unit test; scaled/secondary-display behaviour rests on `stage.test.ts` with an injected `dipToScreen` and the manual check.

tiers: D 5 / hard 1 · review default+hard · cycles 2 · agents 11
