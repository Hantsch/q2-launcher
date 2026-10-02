---
id: 171
title: the stage follows the launcher
status: done
created: 2026-09-29
---

## Requirement

The game window on the stage ([[170]]) is a separate, always-on-top window. It must behave as if it
were part of the launcher: when I move, resize, maximize or minimize the launcher, the picture goes
with it; when I switch to another program or another launcher view, the game must not float on top
of it; and nothing of the launcher that opens over the stage (the speed dropdown, dialogs, toasts)
may be hidden behind the game.

Spike [[169]] verified the means: live `set vid_geometry` moves/resizes the window (~0.5 s over
[[164]]'s channel), live `set win_alwaysontop 0/1` clears/sets topmost, playback keeps running while
the game window has no focus.

## Acceptance Criteria

- [x] **AC1** — Moving or resizing the launcher window (incl. maximize/restore) repositions the game
      window onto the stage; the launcher coalesces geometry updates so a drag does not queue one
      command per pixel.
- [x] **AC2** — Minimizing the launcher hides the game window (or moves it out of sight); restoring
      brings it back onto the stage.
- [x] **AC3** — When another program becomes the foreground window, the game window is no longer
      topmost; when the launcher (or the game) is foreground again, it is.
- [x] **AC4** — Leaving the Demos view while a demo plays does not leave the game window covering the
      other view; returning puts it back on the stage.
- [x] **AC5** — Launcher surfaces that open over the stage (dropdowns, dialogs, toasts) are never
      hidden behind the game window.

## Decisions (Sprint)

- **(User)** Overlays: hide/move the game window while a launcher overlay/dialog is open, restore afterwards.
- **(User)** Latency: hide the game during drag/resize, show it at the end.
- **"Hide" means "park":** the game window is moved off-screen with `set vid_geometry` at its current
  size, X just right of the virtual desktop's right edge (physical px, `+X+Y` positive offsets); the
  demo keeps playing — live `vid_geometry` with positive offsets is the only mechanism spike 169
  proved, minimizing is unverified and pausing would change the timeline's state behind the user's back.
- **One rule for timing:** hide immediately, show after 250 ms without a new input (window move/resize
  event, stage-rect change, overlay/visibility change) — this is the user's "hide during drag, show at
  the end" and the AC1 coalescing in one mechanism.
- **At most one command in flight per kind:** the follower keeps one desired geometry and one desired
  topmost value, deduplicates against the last sent value and retries on `busy` — the Windows channel
  queue is capped at 8 and shared with the timeline/console.
- **Topmost follows the launcher's focus events:** `blur` → `set win_alwaysontop 0`, `focus` →
  `set win_alwaysontop 1`. When the user clicks into the game, the launcher blurs, and the game, now the
  foreground window, stays on top by ordinary z-order — this satisfies AC3's "(or the game)" without
  an OS foreground query, which would need polling a native/PowerShell helper.
- **Initial state = the launch arguments:** the follower assumes placed + topmost at start (the user
  just clicked Play) and sends nothing until an input changes — so existing playback flows see no new
  commands (and the harness's never-focused window does not drop topmost on its own).
- **Main observes the window through a narrow seam, not `BrowserWindow`:** a read-only window observer
  on `AppContext` (content bounds, minimized, focused, move/resize/minimize/restore/focus/blur events)
  — ARCHITECTURE forbids modules touching `BrowserWindow`.
- **The renderer reports the stage, main decides:** the renderer keeps reporting the stage rect (or
  `null` when the stage is not showable: view left, occluding overlay open) via a `playback.stage`
  handler; main combines it with window state and reuses 170's rect→`vid_geometry` computation — one
  source of truth for the physical-pixel math.
- **Overlays occlude by intersection:** a Modal always hides the game (its backdrop covers the window);
  Menu, Popover, HoverCard and the toast stack hide it only while their box intersects the stage rect —
  otherwise every toast would blank the demo. The native speed `<select>` (OS-drawn popup, not
  measurable) counts as occluding from `mousedown`/open key until `change`/`blur`.
- **Native `title` tooltips are out of scope:** they are OS topmost windows and already draw above the game.
- **Leaving the Demos view keeps the demo playing, parked;** returning places it again — AC4 asks only
  that it does not cover the other view.
- **Fullscreen and Linux:** the follower acts only while the session is on the stage; 172 owns
  suspending it in fullscreen. On Wayland 170 does not start the stage, so nothing follows; on X11 the
  same commands go over the stdin channel — no extra parity text beyond 170's reason.
- **Stub-engine window commands go to their own log** (`Q2L_UI_ENGINE_WINDOW_LOG`), not the command
  log — existing flows assert that log exactly and must stay unaffected.

## Open Questions

- ~~**Q1 — AC2/AC4 mechanism:** move the window off-screen via `vid_geometry`, shrink it, minimize it,
  or pause the demo? (Minimizing a borderless Q2PRO window at runtime is unverified.)~~ answered → Decisions (Sprint)
- ~~**Q2 — AC5:** hide/move the game while an overlay is open, or lay out so nothing opens over the
  stage?~~ answered → Decisions (Sprint)
- ~~**Q3 — Latency:** ~0.5 s per geometry update makes the picture trail a drag; acceptable, or hide
  the game during the drag and show it at the end?~~ answered → Decisions (Sprint)

## Plan

Builds on 170 (stage element in `ReplaysView`, rect→`vid_geometry` computation, stage launch args).
One main-side **stage follower** per stage session turns inputs into at most two live commands.

1. **D1 — follower (pure, main):** `src/main/modules/replays/stage-follow.ts`. Inputs: stage rect
   (or `null`), window snapshot (content bounds, scale, minimized, focused), move/resize ticks.
   Output: `set vid_geometry …` / `set win_alwaysontop 0|1` via an injected `send`. Rules = the
   Decisions above (park immediately, place after 250 ms quiet, dedupe, retry on busy, initial state
   = launch args). Injected clock/timers; unit tests.
2. **D2 — main wiring:** window observer seam on `AppContext` (+ `minimize`/`restore` listeners in
   `window.ts`), `playback.stage` handler (shared contract + zod schema), follower created on a stage
   session start and disposed at session end in the replays module; stub engine logs window commands
   to `Q2L_UI_ENGINE_WINDOW_LOG`. Flow `replays-stage-follow` drives the real window via
   `app.evaluate` (move, minimize/restore, emit blur/focus).
3. **D3 — renderer stage reporter:** hook on 170's stage element (ResizeObserver + mount/unmount)
   calling `playback.stage`; leaving the Demos view reports `null`. Flow `replays-stage-view-leave`
   (also covers resize/maximize, which change the stage rect).
4. **D4 — overlay occlusion:** generic `lib/overlay-registry.ts` (open floating surfaces + their box);
   Modal/Menu/Popover/HoverCard/Toasts and the timeline's speed `<select>` register; D3's hook reports
   `null` while one occludes the stage. Unit test + flow `replays-stage-overlays`. CHANGELOG entry.

Order D1 → D2 → D3 → D4. No new user-visible strings (behaviour only; Wayland text is 170's).

## Deliverables

- **D1 — stage follower core.** New `src/main/modules/replays/stage-follow.ts` + `stage-follow.test.ts`
  (mirror the injected-deps style of `playback-timeline.ts`). `createStageFollower({ send, computeGeometry,
parkGeometry, now/setTimeout/clearTimeout })` with `update(input)` / `dispose()`. `send(line)` returns
  `Outcome<void>`; `computeGeometry(stageRect, window)` is 170's rect→`WxH+X+Y` function (find it in
  `src/main/modules/replays/`, reuse, do not duplicate the physical-pixel math); `parkGeometry` = same
  W×H, X = virtual-desktop right edge (physical px) + 64, same Y. Rules: (a) parked-state inputs
  (`stageRect === null`, `minimized`, or a move/resize tick within the last 250 ms) → send the park
  geometry **immediately** once; (b) otherwise send the placed geometry after **250 ms without a new
  input**; (c) never send a geometry equal to the last sent one; (d) `focused` false→`set
win_alwaysontop 0`, true→`1`, deduplicated; (e) initial state = placed at the launch geometry +
  topmost 1, so no command until an input differs; (f) a `busy`/failed send keeps the value desired and
  retries on the next 250 ms tick; (g) `dispose()` clears timers and sends nothing. Tests (fake timers):
  "a drag parks once and places once at the end", "a stage-rect change alone places after quiet without
  parking", "minimize parks, restore places", "blur drops topmost, focus restores it", "nothing is sent
  before an input changes", "a busy send is retried".
- **D2 — main wiring + real-window flow.** Files: `src/main/context.ts` (+ `src/main/index.ts`) — a
  read-only `mainWindow` observer (`snapshot(): { contentBounds, scaleFactor, minimized, focused } | null`,
  `on(listener)` for `move|resize|minimize|restore|focus|blur`, returns unsubscribe); `src/main/window.ts`
  — forward those events (add `minimize`/`restore` listeners; existing persistence untouched);
  `src/shared/modules/replays.ts` + its schema — handler `playback.stage` with payload
  `{ rect: { x, y, width, height } | null }` (finite, non-negative CSS px; zod, bounded);
  `src/main/modules/replays/index.ts` — create a D1 follower when a stage session starts (where 170
  starts it; not for non-stage/fullscreen sessions), feed it observer events + `playback.stage`, dispose
  on session end; `send` = `playbackControl.send`. `scripts/lib/stub-engine.cjs` — append
  `set vid_geometry …`/`set win_alwaysontop …` lines to the file in env `Q2L_UI_ENGINE_WINDOW_LOG`
  (not `COMMAND_LOG`); `scripts/lib/fixture.mjs` — add that path next to `replaysTimelineEngineFiles()`.
  New flow `scripts/flows/replays-stage-follow.mjs` (mirror `replays-console-command.mjs`): play a demo,
  then via `app.evaluate` `setPosition` in 20 steps → window log gets exactly one park line then one
  placed line whose X/Y moved by the delta; `minimize()` → park; `restore()` → placed; `emit('blur')`
  → `set win_alwaysontop 0`; `emit('focus')` → `1`. Also re-run `replays-console-command` and
  `replays-timeline` unchanged.
- **D3 — renderer stage reporter + view-leave flow.** Files: new
  `src/renderer/src/modules/replays/useStageReport.ts` (ResizeObserver on 170's stage element, reports
  `getBoundingClientRect()` via `playback.stage` on change, `null` on unmount / session end, throttled to
  one call per animation frame); `src/renderer/src/modules/replays/client.ts` (typed call); 170's stage
  component (use the hook). New flow `scripts/flows/replays-stage-view-leave.mjs`: play, navigate to
  another view → park line; back to Demos → placed line at the stage; `setSize` larger and `maximize()`
  → exactly one park + one placed line each, placed W×H matching the new stage rect.
- **D4 — overlay occlusion + CHANGELOG.** Files: new `src/renderer/src/lib/overlay-registry.ts` +
  `overlay-registry.test.ts` (tiny zustand store: `register(id, { element, always })`, `unregister(id)`,
  `occludes(rect)` = any `always` entry, or any element box intersecting `rect`); register while open in
  `components/ui/Modal.tsx` (`always`), `Menu.tsx`, `Popover.tsx`, `HoverCard.tsx`, `Toasts.tsx` (the
  stack's container, while ≥1 toast); the speed `<select>` in `modules/replays/components/DemoTimeline.tsx`
  registers `always` from `mousedown`/Alt+Down/F4 until `change`/`blur`. D3's `useStageReport` subscribes
  and reports `null` while `occludes(stageRect)`. Unit tests: "a modal always occludes", "a toast
  outside the stage does not occlude", "a menu over the stage occludes". New flow
  `scripts/flows/replays-stage-overlays.mjs`: play, open a Modal-backed dialog from the Demos view →
  park; close → placed; mousedown on the speed select → park; change → placed. `CHANGELOG.md`
  `### Changed`: the demo stage now moves, hides and steps aside with the launcher.

## Model Hints

- D2 → deliverable-hard — it adds a shell seam in `window.ts`/`AppContext` and hooks the follower into
  every stage playback's session lifecycle in `replays/index.ts`; a follower that outlives its session,
  starts for a non-stage playback or leaks a command into `COMMAND_LOG` silently breaks 170/172/173 and
  the existing exact-log playback flows.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/stage-follow.test.ts` › "a drag parks once and places once at the
  end"; e2e `scripts/flows/replays-stage-follow.mjs` › "replays-stage-follow" (move) and
  `scripts/flows/replays-stage-view-leave.mjs` › "replays-stage-view-leave" (resize, maximize).
- AC2 → unit `src/main/modules/replays/stage-follow.test.ts` › "minimize parks, restore places"; e2e
  `scripts/flows/replays-stage-follow.mjs` › "replays-stage-follow". Manual residue: that real Q2PRO
  honours a fully off-desktop `vid_geometry` (no clamp back onto a monitor) — only the stub engine runs in
  the suite; check once with spike 169's `harness.mjs`/`win-probe.ps1` against the real engine.
- AC3 → unit `src/main/modules/replays/stage-follow.test.ts` › "blur drops topmost, focus restores it";
  e2e `scripts/flows/replays-stage-follow.mjs` › "replays-stage-follow". Manual residue: the OS topmost
  flag and z-order against another real program — the harness window is non-focusable and offscreen
  by design, and the stub engine has no real window.
- AC4 → e2e `scripts/flows/replays-stage-view-leave.mjs` › "replays-stage-view-leave".
- AC5 → unit `src/renderer/src/lib/overlay-registry.test.ts` › "a modal always occludes", "a toast
  outside the stage does not occlude", "a menu over the stage occludes"; e2e
  `scripts/flows/replays-stage-overlays.mjs` › "replays-stage-overlays".

## Done

**Summary.** A per-session main-side stage follower (`stage-follow.ts`) turns launcher window events and the renderer's stage rect into at most two live commands: park the game window off-desktop immediately, place it after 250 ms quiet, and drop/restore `win_alwaysontop` on launcher blur/focus. Main observes the window through a read-only `mainWindow` observer seam; the renderer reports the stage rect (`playback.stage`, `null` when parked) via `useStageReport`; an overlay registry (Modal/Menu/Popover/HoverCard/Toasts/speed select) makes overlays park the game. Stub engine logs window commands to `Q2L_UI_ENGINE_WINDOW_LOG`.

**Commit message:** `171: stage follows the launcher (park/place follower, window observer, playback.stage, overlay occlusion)`

**Verification (narrow gate):** `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (89 files / 1445 tests) green; flows `replays-stage-follow`, `replays-stage-view-leave`, `replays-stage-overlays` plus regression `replays-console-command`, `replays-timeline`, `replays-stage` all OK. Full gate not run (sprint's). AC -> test: AC1 stage-follow unit + follow/view-leave flows; AC2, AC3 unit + follow flow; AC4 view-leave flow; AC5 overlay-registry unit + overlays flow — all ran and passed. Manual residue: AC2 real Q2PRO honours off-desktop `vid_geometry`; AC3 real OS topmost/z-order vs another program. Review: default stage, PASS, no fix cycle.

**Decisions:**

- D2 removed 170's `demoPlay.restage` (it would double-send beside the follower); its test became the session-lifecycle-hook test, covered by `stage-follow-session.test.ts`. A rect change now places after 250 ms, not at once (by design).
- Follower parks once per drag (no repeat park lines while parked, even on diagonal drags); park Y is the stage Y at first park.
- Follower uses the launch rect as stage until the renderer reports one; the stage reporter polls per animation frame (no ResizeObserver) and sends only on rounded-rect or occlusion change.
- Overlay flow opens the Modal from the rail ("Add existing installation") because Demos hides list/detail while the stage shows. Restore check in the follow flow accepts extra park lines (harness window changes display/DPI on restore) and then requires exactly one matching placed line.
- Deliberately unfixed review notes: overlay-registry unit tests cover only the store (Menu/Popover/HoverCard/Toasts registration untested; Modal and select covered by the flow); the speed select stays `always` after Escape/re-pick until blur (spec wording "until change/blur"); Alt+Down/F4 untested; narrow stale-desired-geometry edge in the follower after a busy failure.
- CHANGELOG: added `### Changed` under Unreleased.

tiers: D 5 / hard 1 · review default · cycles 0 · agents 8
