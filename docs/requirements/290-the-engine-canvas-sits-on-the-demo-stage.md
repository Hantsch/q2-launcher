---
id: 290
title: The engine canvas sits on the demo stage
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user in integrated mode I want the demo's picture to appear right in the stage area of the
Demos view, moving and scaling with the window, so that I no longer manage a second window.

Context:

- [concept §7](../concepts/integrated-demo-player.md) (engine host), [concept §8.3](../concepts/integrated-demo-player.md) (canvas size, DPR).
- Today's stage: `src/renderer/src/modules/replays/components/DemoStage.tsx` (4:3 area, `fitAspect`
  from `stage-fit.ts`, `useStageReport`). In engine mode it reports its rect to main; in integrated
  mode it hosts the canvas.
- Engine artefacts under `/engine/` ([[288]]); the ES6 module from `-sMODULARIZE -sEXPORT_ES6` is
  loaded with dynamic `import()`. Canvas target and resize callbacks in
  `vendor/q2pro-mashed/src/unix/video/emscripten.c` (`TARGET "canvas"`, `window_resized_cb`,
  `mode_changed`).
- New module files: `src/renderer/src/modules/replays/integrated/engine-loader.ts` (singleton),
  `integrated/EngineCanvas.tsx`, `integrated/engine-module.ts` (TS type of the engine interface),
  and `integrated/fake-engine.ts` — a fake engine drawing a WebGL2 test pattern behind the same
  interface, chosen by a harness switch like the stub engine (`scripts/lib/stub-engine.cjs`,
  `scripts/lib/fixture.mjs`); unit tests and flows use it.
- Keyboard: Emscripten's html5 callbacks are registered on the canvas element; a needed engine
  patch goes into `engine/patches/`. No `requestPointerLock` in integrated mode.
- `/renderer-guidelines`, `/design-tokens`, `/ui-verify`; new flow registered in
  `scripts/flows/areas.json`.
- Not in scope: game data, starting a demo ([[291]]), sound ([[293]]), fullscreen/cinema ([[309]]).
- Depends on: [[288]]

Expected manual residue: with the real engine (after [[291]]) move and resize the window — the
picture stays sharp, no flicker.

## Acceptance Criteria

- [ ] **AC1** — In mode `integrated`, `DemoStage` renders `<canvas data-testid="replays-engine-canvas">` in the 4:3 area instead of the placeholder.
- [ ] **AC2** — In mode `engine`, `DemoStage` behaves as today (existing tests and
      `npm run ui:flow -- replays-stage` green).
- [ ] **AC3** — After a resize, the canvas buffer size equals CSS size × `devicePixelRatio`
      (rounded), and the engine receives the new size (the fake counts resize calls).
- [ ] **AC4** — Starting a second demo does not instantiate the WASM module again (loader
      singleton, test with a fake loader).
- [ ] **AC5** — Leaving the Demos view or stopping the demo stops the rAF loop and makes the
      engine release demo resources (`disconnect`); quitting the app discards the instance.
- [ ] **AC6** — On `webglcontextlost` the stage shows the visible text "The 3D view was lost.
      Press Play to restart." (`replays.integrated.error.contextLost`) instead of a black picture.
- [ ] **AC7** — Typing in the list's filter field during playback does not reach the engine
      (`npm run ui:flow -- replays-integrated-canvas`).
- [ ] **AC8** — `npm run ui:verify` is green and has a screenshot of the Demos view with the
      canvas; `src/architecture.test.ts` stays green (no cross-module imports).

## Open Questions

## Decisions (Sprint)

- **Trigger:** Play in integrated mode arms the stage and begins a local session (no `demoPlay`
  IPC, no demo loaded), Stop ends it locally — ACs 4, 5 and 7 presume a start/stop path and [[291]]
  fills that path with data and the `demo` command.
- **287's interim reason** `replays.player.unavailable.integratedNotReady` moves from the disabled
  Play button to the stage reason while the canvas is shown, so the key survives until [[291]]
  removes it (its AC10); if 291 does not land in S38, Play in integrated mode is re-gated.
- **Canvas ownership:** the loader singleton creates and owns the one `<canvas id="q2l-engine-canvas">`
  and `EngineCanvas` only attaches/detaches it, because a WebGL context is bound to its element and a
  remounted canvas would orphan the engine's context.
- **Buffer size has one owner — JS:** the patch stops the engine from setting the canvas size itself
  and exports `q2l_resize()` (runs `mode_changed`), because the engine truncates `css × dpr` while
  AC3 rounds and only window resizes reach it, not stage reflows.
- **Engine target** is patched from `"canvas"` to `"#q2l-engine-canvas"`, so no other `<canvas>`
  in the document can be picked up by Emscripten's selector lookup.
- **Keyboard:** the patch registers keydown/keyup on the canvas target instead of the window and
  the canvas is not focusable, so the engine gets no keys in integrated mode (the launcher steers it
  through calls); pointer lock is never requested.
- **Fake engine selection:** `fake-engine.ts` mimics the raw Emscripten module (default-export
  factory), and under the UI harness the fixture transpiles it to `q2pro.js` in a fixture engine dir
  that main serves via a harness-only `Q2L_UI_ENGINE_DIR` override — production code never imports
  the fake and the real loader/adapter path runs in flows.
- **AC7 field:** the filter bar is hidden in stage mode, so the flow types into the detail panel's
  comment input, the text field visible beside the stage; the AC's intent is unchanged.
- **Context loss** discards the engine instance (the GL context is gone) and keeps the session and
  stage so the text stays visible; AC4's reuse applies to normal Stop/Play only.
- **Stage report:** `useStageReport` gets an `enabled` flag, off in integrated mode, because there
  is no main-side follower to tell about the rect.
- **Platform parity:** WebGL2 and the canvas work the same on Windows and Linux, so there is no
  unavailable state to add.
- **No CHANGELOG line:** [[287]]'s single integrated-playback line covers this story.

## Plan

Engine side, then host, then harness, then the stage, then the user path.

1. **Engine patch** (`engine/patches/`, applied by [[281]]'s build): canvas target id, key
   callbacks on the canvas, no pointer lock, JS-owned buffer size + `q2l_resize` export,
   `q2l_console` export (reuse if [[284]] already added it), `pauseMainLoop`/`resumeMainLoop` in
   `EXPORTED_RUNTIME_METHODS`. Pinned by a test over the patch text; `npm run engine:build` exits 0.
2. **Host** (`integrated/engine-module.ts`, `integrated/engine-loader.ts`): the `EngineHost`
   interface (`canvas`, `resize`, `pauseLoop`, `resumeLoop`, `disconnect`, `discard`), an adapter
   over the raw Emscripten module, and a singleton loader that owns the canvas, imports
   `/engine/q2pro.js` once and discards on `pagehide`.
3. **Fake engine** (`integrated/fake-engine.ts`): the raw-module shape, a WebGL2 test pattern,
   counters on `globalThis.__q2lFakeEngine` for flows.
4. **Harness wiring:** `Q2L_UI_ENGINE_DIR` (harness-gated) in main's `/engine/` handler from
   [[288]]; fixture transpiles the fake into it and seeds `playbackMode: integrated` for a new
   variant.
5. **Stage** (`integrated/EngineCanvas.tsx`, `DemoStage.tsx`): mode prop, attach/detach the
   owned canvas, DPR sizing per animation frame, loop resume/pause + `disconnect` on unmount,
   context-lost text; `useStageReport` disabled in integrated mode.
6. **User path** (`useDemoPlay.ts`, `playback-store.ts`, `ReplaysView.tsx`): integrated Play arms
   the stage + local session, Stop ends it locally.
7. **e2e:** flow `replays-integrated-canvas`, ui:verify screen `replays-integrated-stage`,
   `docs/systems/replays-module.md`.

## Deliverables

- **D1 — Engine patch: canvas-only input, JS-owned size, exports.** New
  `engine/patches/<next-number>-integrated-canvas-host.patch` against
  `vendor/q2pro-mashed/src/unix/video/emscripten.c` (and the link flags where [[281]] sets them):
  (a) `#define TARGET "#q2l-engine-canvas"`; (b) `emscripten_set_keydown_callback` /
  `emscripten_set_keyup_callback` registered on `TARGET`, not `EMSCRIPTEN_EVENT_TARGET_WINDOW`;
  (c) no `emscripten_request_pointerlock` call remains (`grab_mouse`, `mousedown_cb`); (d)
  `window_resized_cb` and the window resize callback no longer call
  `emscripten_set_canvas_element_size` — the engine never sizes the canvas; a new
  `EMSCRIPTEN_KEEPALIVE void q2l_resize(void)` calls `mode_changed()`; (e)
  `EMSCRIPTEN_KEEPALIVE void q2l_console(const char *text)` → `Cbuf_AddText(&cmd_buffer, text)`
  unless [[284]]'s patches already export it; (f) `pauseMainLoop`, `resumeMainLoop`, `ccall` in
  `EXPORTED_RUNTIME_METHODS`, `_q2l_resize`/`_q2l_console` in `EXPORTED_FUNCTIONS`. Test
  `scripts/engine/integrated-host-patch.test.mjs` reads the patch text and pins (a)–(d).
  Acceptance: the test is green and `npm run engine:build` exits 0 with the patch applied.
- **D2 — Engine host type, adapter and singleton loader.** New
  `src/renderer/src/modules/replays/integrated/engine-module.ts`: `RawEngineModule` (the
  Emscripten surface used: `_q2l_resize`, `pauseMainLoop`, `resumeMainLoop`, `ccall`),
  `EngineFactory = (args: { canvas: HTMLCanvasElement; noInitialRun: true; locateFile(p: string): string }) => Promise<RawEngineModule>`,
  `EngineHost` (`canvas`, `resize()`, `pauseLoop()`, `resumeLoop()`, `disconnect()` =
  `ccall('q2l_console', null, ['string'], ['disconnect'])`) and `adaptEngineModule(raw, canvas)`.
  New `integrated/engine-loader.ts`: `createEngineLoader(importFactory)` with `load()` (memoised
  promise; creates the one canvas `id="q2l-engine-canvas"`, `data-testid="replays-engine-canvas"`,
  calls the factory once, `locateFile` → `/engine/<p>`), `discard()` (pause loop, disconnect, drop
  instance and canvas so the next `load()` instantiates afresh) and a `pagehide` listener calling
  `discard()`; the default export `engineLoader` imports `/engine/q2pro.js` via
  `import(/* @vite-ignore */ url)`. Tests `integrated/engine-loader.test.ts`: "a second load reuses
  the instantiated engine", "pagehide discards the engine instance", and adapter mapping in
  `integrated/engine-module.test.ts` › "the host maps resize, loop and disconnect onto the engine's
  exports". No runtime imports beyond the replays module.
- **D3 — Fake engine.** New `src/renderer/src/modules/replays/integrated/fake-engine.ts`, **no
  runtime imports** (type-only), default export an `EngineFactory` returning a `RawEngineModule`:
  gets a WebGL2 context on `args.canvas` once at instantiation (skip drawing when `getContext`
  returns null, as in jsdom), `resumeMainLoop` starts a rAF loop clearing to a fixed non-black
  colour pattern, `pauseMainLoop` cancels it, `_q2l_resize` records `{ width, height }` of the
  canvas, `ccall('q2l_console', …, ['disconnect'])` counts disconnects, a `keydown` listener on the
  canvas counts key events. Counters live on `globalThis.__q2lFakeEngine` (`instances`,
  `resizes`, `disconnects`, `keyEvents`, `loopRunning`). Test `integrated/fake-engine.test.ts` ›
  "the fake engine counts what the host does to it" (through `adaptEngineModule` from D2).
- **D4 — Harness serves the fake as the engine.** `src/main/lib/ui-harness.ts`: add
  `'Q2L_UI_ENGINE_DIR'` to `UiHarnessVar`; the `/engine/` branch [[288]] added to
  `src/main/lib/renderer-source.ts` resolves its directory from that variable when
  `UiHarness.enabled`, else from `resolveResourcePath` as today — same `ENGINE_FILE_NAMES`
  allowlist either way. `scripts/lib/fixture.mjs`: `writeFakeEngine(dir)` transpiles D3's file with
  Vite's `transformWithEsbuild` to `<dir>/q2pro.js` plus an empty `q2pro.wasm`, and a variant
  `REPLAYS_INTEGRATED_VARIANT` (model: `REPLAYS_TIMELINE_VARIANT`) whose `state.json` carries
  `replays.playbackMode: 'integrated'` and whose env sets `Q2L_UI_ENGINE_DIR`. Test in
  `src/main/lib/renderer-source.test.ts` › "under the UI harness the engine directory comes from
  Q2L_UI_ENGINE_DIR, outside it never".
- **D5 — The stage hosts the engine canvas.** New
  `src/renderer/src/modules/replays/integrated/EngineCanvas.tsx`: on mount `engineLoader.load()`,
  appends the owned canvas into its container (`block h-full w-full`, `role="img"`, `aria-label`
  `replays.integrated.canvasLabel`), `resumeLoop()`; each animation frame compares the canvas CSS
  size × `devicePixelRatio` (each `Math.round`ed) to `canvas.width/height` and on change sets them
  and calls `resize()`; on `webglcontextlost` pauses, calls `engineLoader.discard()` and renders
  `replays.integrated.error.contextLost` ("The 3D view was lost. Press Play to restart.") as
  visible `role="status"` text over a token-coloured panel; on unmount `pauseLoop()`,
  `disconnect()`, detaches the canvas (never destroys it). `DemoStage.tsx` takes
  `mode: PlayerMode` (from [[287]]'s `src/shared/replays/player-mode.ts`): `integrated` renders
  `EngineCanvas` inside the 4:3 picture box instead of the label; `engine` unchanged.
  `useStageReport.ts` gets `enabled: boolean` (false → no measuring, no `sendStageRect`). Strings in
  `src/renderer/src/modules/replays/locale/en.json` (`replays.integrated.*`). Tests
  `integrated/EngineCanvas.test.tsx` (fake loader injected via a prop or module mock): "a resize sets
  the buffer to CSS size times devicePixelRatio and tells the engine", "unmounting stops the loop
  and disconnects the engine", "a lost WebGL context shows the restart text"; `DemoStage.test.tsx`:
  "in integrated mode the stage holds the engine canvas instead of the placeholder", "in engine mode
  the stage keeps the placeholder and reports its rect". Read `/renderer-guidelines`,
  `/design-tokens`.
- **D6 — Integrated Play and Stop drive the stage.** `useDemoPlay.ts`: in mode `integrated`,
  `play` calls `armStage()`, `beginSession(demo.fileName, demo.durationMs, { id, archived,
mode: 'integrated' })` and `setStageReason({ key: 'replays.player.unavailable.integratedNotReady' })`
  — no `playDemo` IPC; Play is no longer disabled by that reason. `playback-store.ts`: the session
  carries `mode: PlayerMode` (default `engine`); `requestStop` on an integrated session calls
  `endSession()` without `playbackStop()`. `ReplaysView.tsx` passes the current playback mode (the
  value [[287]]'s switch reads) to `<DemoStage mode=… />`. Update any step of
  `scripts/flows/replays-playback-mode.mjs` that asserts Play disabled with `integratedNotReady`.
  Tests: `useDemoPlay.test.ts` › "integrated Play arms the stage without calling demo play";
  `playback-store.test.ts` › "stopping an integrated session ends it without asking main".
- **D7 — e2e for the integrated stage + systems doc.** New
  `scripts/flows/replays-integrated-canvas.mjs` (variant `REPLAYS_INTEGRATED_VARIANT`, selectors
  `replays-engine-canvas`, `replays-stage`, detail comment input), registered in
  `scripts/flows/areas.json` under the replays area with `src/renderer/src/modules/replays/integrated/**`.
  Steps: Play → canvas visible in the stage, a centre pixel read via `page.evaluate` is non-black;
  resize the window (`app.evaluate` → `BrowserWindow.setSize`) → `canvas.width ===
Math.round(clientWidth × dpr)` and `__q2lFakeEngine.resizes` grew; type into the comment input →
  the field holds the text and `keyEvents === 0`; Stop → `loopRunning false`, `disconnects` grew;
  Play again → `instances === 1`; leave Demos and return → pixel still non-black; lose the context
  via `WEBGL_lose_context` → the contextLost text is visible. `scripts/lib/screens.mjs`: screen
  `replays-integrated-stage` (variant above, Play on the first demo, wait for
  `replays-engine-canvas`). `docs/systems/replays-module.md`: the integrated host (loader,
  canvas ownership, fake engine, harness dir) in Map and Limitations.

## Model Hints

- D5 → deliverable-hard: the owned canvas must survive unmount/remount with its WebGL context,
  the DPR sizing runs per frame without fighting the engine, and the loop/disconnect/discard order
  across `EngineCanvas`, `engine-loader` and context loss is where a remount or a lost context
  silently leaves a dead or doubly-driven engine.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/replays/components/DemoStage.test.tsx` › "in integrated
  mode the stage holds the engine canvas instead of the placeholder"; e2e
  `scripts/flows/replays-integrated-canvas.mjs` › `replays-integrated-canvas` (D5, D7)
- AC2 → unit `src/renderer/src/modules/replays/components/DemoStage.test.tsx` › "in engine mode
  the stage keeps the placeholder and reports its rect" plus the existing tests; e2e existing
  `scripts/flows/replays-stage.mjs` › `replays-stage` (D5)
- AC3 → unit `src/renderer/src/modules/replays/integrated/EngineCanvas.test.tsx` › "a resize sets
  the buffer to CSS size times devicePixelRatio and tells the engine"; e2e
  `replays-integrated-canvas` resize step (D5, D7)
- AC4 → unit `src/renderer/src/modules/replays/integrated/engine-loader.test.ts` › "a second load
  reuses the instantiated engine"; e2e `replays-integrated-canvas` Play-again step (D2, D7)
- AC5 → unit `src/renderer/src/modules/replays/integrated/EngineCanvas.test.tsx` › "unmounting
  stops the loop and disconnects the engine"; unit `integrated/engine-loader.test.ts` › "pagehide
  discards the engine instance"; e2e `replays-integrated-canvas` Stop and leave-view steps
  (D2, D5, D6, D7)
- AC6 → unit `src/renderer/src/modules/replays/integrated/EngineCanvas.test.tsx` › "a lost WebGL
  context shows the restart text"; e2e `replays-integrated-canvas` context-loss step (D5, D7)
- AC7 → e2e `scripts/flows/replays-integrated-canvas.mjs` › `replays-integrated-canvas` (fake
  engine, typing step); unit `scripts/engine/integrated-host-patch.test.mjs` › "the engine takes
  keys only from its canvas and never locks the pointer" for the real engine (D1, D3, D7)
- AC8 → e2e `npm run ui:verify` screen `replays-integrated-stage` (D7); existing
  `src/architecture.test.ts` (all Ds)
- Manual residue: with the real engine (after [[291]]) move and resize the window — the picture
  stays sharp, no flicker; needs the real engine and a GPU, which the UI harness does not run.

## Done
