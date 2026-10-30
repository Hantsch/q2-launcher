---
id: 291
title: A demo plays inside the launcher in integrated mode
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to click "Play" in integrated mode and watch the demo inside the launcher — no
console spam, no PAUSED picture, no engine demo bar — so that playback feels like a built-in
player.

Context:

- [concept §8.3](../concepts/integrated-demo-player.md) (overlays off), [concept §8.5](../concepts/integrated-demo-player.md), [concept §9.5](../concepts/integrated-demo-player.md); success criteria K1 and K3.
- Building blocks: mode and eligibility ([[287]]), `integrated.prepare` and `/engine-data/`
  ([[289]]), `EngineCanvas` and loader ([[290]]).
- Today's play path in the renderer: `src/renderer/src/modules/replays/useDemoPlay.ts` (`play`),
  `playback-store.ts` (`beginSession`, `pendingSeekS`), `client.ts`. Engine behaviour:
  `CL_PlayDemo_f` (`vendor/q2pro/src/client/demo.c`), `cl_demowait`, `cl_autopause`
  (`vendor/q2pro/src/client/main.c` `CL_CheckForPause`), `scr_showpause`, `scr_demobar`
  (`vendor/q2pro/src/client/screen.c`).
- New `src/renderer/src/modules/replays/integrated/integrated-session.ts`: `prepare` → fetch per
  file → `FS.mkdirTree`/`FS.writeFile` → `callMain(args)`, or `q2l_console("demo …")` when the
  engine already runs. Control here only via `q2l_console` (patch with `Cbuf_AddText` if [[284]]
  lacks it); the typed API follows in [[294]]/[[296]]. The console capture for the no-plumbing
  check is `Module.print`/`printErr` into a ring buffer readable by tests.
- Position and timeline are not wired yet: in integrated mode the timeline shows "—" and disabled
  controls with the visible reason `replays.player.unavailable.controlsComingSoon`; [[297]] removes
  it.
- Flow `scripts/flows/replays-play-integrated.mjs` with the fake engine; the real engine is
  checked by `npm run engine:smoke` and later the engine lane ([[304]]). [[287]]'s
  `CHANGELOG.md` line stays one line.
- Not in scope: sound ([[293]]), timeline control ([[297]]), MVD2 ([[319]]), a worker.
- Depends on: [[287]], [[289]], [[290]], [[283]]

Expected manual residue: with a real installation, play a `.dm2`, a `.dm2.gz` and a demo from a
zip in integrated mode — no PAUSED, no console lines, no demo bar, correct picture; judge load time
and UI stalls on a retail map (R8).

## Acceptance Criteria

- [ ] **AC1** — In mode `integrated`, Play on a `.dm2` of the active installation loads the
      manifest files into MEMFS, starts the engine with `+set basedir /q2 +set homedir /q2home +set game <gamedir>` and plays the demo in the canvas.
- [ ] **AC2** — In integrated mode the engine-mode path (`demoPlay` handler, Q2PRO process) is
      not called.
- [ ] **AC3** — A `.dm2.gz` and a zip-entry demo play the same way.
- [ ] **AC4** — During playback the session cvars `scr_showpause 0`, `cl_autopause 0`,
      `con_notifylines 0`, `scr_demobar 0` and `cl_demowait 1` are set.
- [ ] **AC5** — The engine console capture contains no line with `q2l_` or `Execing`.
- [ ] **AC6** — The stage shows the loading state (`replays.integrated.loading`) one animation
      frame before the synchronous `demo` call starts.
- [ ] **AC7** — At the demo's end the last picture stays (no disconnect screen) and the store
      receives `finished`.
- [ ] **AC8** — Stop ends playback, calls `integrated.release` and puts the placeholder back on
      the stage.
- [ ] **AC9** — When `integrated.prepare` refuses (e.g. `dataTooLarge`), the stage shows the
      reason and a one-click "Play in engine mode" action that switches the mode.
- [ ] **AC10** — The interim reason `replays.player.unavailable.integratedNotReady` from [[287]]
      is gone.
- [ ] **AC11** — `npm run ui:flow -- replays-play-integrated` and
      `npm run ui:flow -- replays-play-q2pro` are green; `npm run engine:smoke` still exits 0.

## Open Questions

## Decisions (Sprint)

- The session cvars (AC4) plus `s_enable 0` go into `callMain` as `+set` on the first start and are re-sent as `set` lines before every later `demo`, because a `game` change re-runs the filesystem init and sound is [[293]]'s.
- `q2l_console` runs `Cbuf_AddText` then `Cbuf_Execute` synchronously, so the `demo` call is the measurable blocking point that the loading frame (AC6) precedes.
- The demo's end is read from one minimal export `q2l_demo_eof()` polled once per animation frame, because with `cl_demowait 1` the engine sets `cls.demo.eof` silently and prints nothing; [[294]]'s `q2l_state` replaces it.
- AC5 is about lines the launcher causes: the fake engine echoes `Execing <file>` for every `exec` and `Unknown command "<x>"` like Q2PRO does, so an exec/`q2l_` plumbing would show; the real engine's boot-time `Execing default.cfg` from the installation's own pak is not launcher plumbing and is not asserted here (the real-engine lane is [[304]]).
- A later play reuses the running instance: files already in MEMFS with the same vpath and size are not fetched again, the previous `_launcher` demo is removed, and `disconnect` plus `game <dir>` (only when the game dir changes) precede `demo`, because demos never change the game dir themselves (`parse.c` "never allow demos to change gamedir").
- Play while an integrated session runs stops that session first (disconnect + release), because two tokens are never active ([[289]] AC8).
- In integrated mode the stage shows `EngineCanvas` only while an integrated session exists (loading, playing, finished) and the placeholder otherwise; this refines [[290]] AC1 so AC8's "placeholder back" holds, while the canvas element's lifetime stays with [[290]]'s loader.
- "Play in engine mode" (AC9) sets the mode to `engine` and starts engine-mode play of the same demo in the same click, because the label promises playing; a refusal there shows as today.
- A failed fetch or engine start releases the token and shows `replays.integrated.error.loadFailed` with the same "Play in engine mode" action, so no failure leaves a black stage.
- The console capture is a 500-line ring buffer in `integrated/engine-console.ts`; flows read it through a window hook that exists only under [[290]]'s fake-engine harness switch, so production exposes nothing.
- The playback session carries `kind: 'engine' | 'integrated'`; Stop of an integrated session never calls the `playbackStop` IPC but the session's own stop, which ends the session directly (there is no `ended` event from main).
- The flow triggers `dataTooLarge` with a second fixture installation whose pak is extended by `truncate` past 1 GiB, because a test-only override of the limit in main would be a backdoor.

## Plan

1. **Engine (D1).** One patch in `engine/patches/` exports `q2l_console(const char*)` (Cbuf add +
   execute, synchronous) and `q2l_demo_eof()`; link flags add both to `EXPORTED_FUNCTIONS`,
   `callMain`/`FS` to `EXPORTED_RUNTIME_METHODS`, `INVOKE_RUN=0`. `engine-module.ts` types them.
2. **Capture + fake (D2).** `engine-console.ts` ring buffer fed by the loader's `print`/`printErr`;
   [[290]]'s fake engine gains a fake FS, `callMain`, `q2l_console`, `q2l_demo_eof` and Q2PRO-like
   echoes, so every renderer test and the flow drive the same interface.
3. **Session (D3, hard).** `integrated/integrated-session.ts`: `prepare` → fetch each
   `/engine-data/<token>/<index>` → `FS.mkdirTree`/`writeFile` under `/q2/` → loading state → one
   rAF → `callMain(args)` or `q2l_console(…)` → poll `q2l_demo_eof` per frame → `finished`. Stop =
   `disconnect` + `integrated.release` + end. Refusals and failures map to stage reasons.
4. **Store + hook (D4).** `useDemoPlay.play` branches on the mode from [[287]]; the store session
   gets `kind`; `requestStop` routes integrated sessions to the session's stop. `integratedNotReady`
   leaves eligibility and the locale.
5. **Stage + timeline (D5).** `DemoStage`: canvas only with an integrated session, loading text,
   refusal reason + "Play in engine mode" button. `DemoTimeline`: "—" and disabled controls with
   `replays.player.unavailable.controlsComingSoon`.
6. **Flow + docs (D6).** `scripts/flows/replays-play-integrated.mjs` (fake engine): `.dm2`,
   `.dm2.gz`, zip entry, finished, stop, `dataTooLarge` → engine mode. `replays-playback-mode`
   updated; `areas.json`; `docs/systems/replays-module.md`. `CHANGELOG.md` keeps [[287]]'s one line.

Order: D1 ∥ D2 → D3 → D4 → D5 → D6. Gates: `npm run engine:build`, `npm run engine:smoke`,
`npm test`, `npm run ui:flow -- replays-play-integrated`, `npm run ui:flow -- replays-play-q2pro`.

## Deliverables

- [ ] **D1 — The engine takes console commands and reports the demo's end.** New patch
      `engine/patches/<next-number>-q2l-console.patch` (numbering as the series from story 281) adds
      a small C file in the web branch with `EMSCRIPTEN_KEEPALIVE void q2l_console(const char *text)`
      (`Cbuf_AddText(&cmd_buffer, text); Cbuf_AddText(&cmd_buffer, "\n"); Cbuf_Execute(&cmd_buffer);`
      — synchronous on purpose) and `int q2l_demo_eof(void)` (returns `cls.demo.playback &&
    cls.demo.eof`). The web link flags gain `_q2l_console,_q2l_demo_eof` in `EXPORTED_FUNCTIONS`,
      `callMain,FS` in `EXPORTED_RUNTIME_METHODS` and `-sINVOKE_RUN=0`. Update
      `src/renderer/src/modules/replays/integrated/engine-module.ts` (TS type from story 290) with
      `callMain(args: string[])`, `FS.mkdirTree/writeFile/unlink/analyzePath/stat`, `_q2l_console`
      (via `ccall`/`cwrap` string marshalling) and `_q2l_demo_eof`. Acceptance: `npm run
    engine:build` exits 0 and `npx wasm-objdump -x resources/engine/q2pro.wasm` lists both
      exports; `npm run engine:smoke` still exits 0. Files: the patch, the web link-flag location
      of the series, `engine-module.ts`.
- [ ] **D2 — Console capture and a fake engine that behaves like Q2PRO.** New
      `src/renderer/src/modules/replays/integrated/engine-console.ts`: a 500-line ring buffer with
      `pushLine(text)`, `consoleLines(): string[]`, `clearConsole()`; story 290's
      `engine-loader.ts` passes `print`/`printErr` that call `pushLine` into the module factory
      options. When story 290's fake-engine harness switch is on (and only then) the loader exposes
      `window.__q2lEngineConsole = consoleLines` for flows. Extend
      `integrated/fake-engine.ts` behind the same interface: an in-memory `FS` (`mkdirTree`,
      `writeFile`, `unlink`, `analyzePath`, `stat`) whose written paths/sizes and `callMain` args are
      readable for tests (and through the same harness-only hook `window.__q2lFakeEngine`);
      `q2l_console` parses `;`/newline-separated commands: `set <cvar> <v>` records the cvar, `exec
    <f>` prints `Execing <f>`, `demo <name>` checks the file exists under
      `/q2/<game>/demos/<name>` (else prints `Couldn't open demos/<name>`), draws its pattern and
      reports `q2l_demo_eof() === 1` after a fixed play time (default 1500 ms, harness-settable),
      keeping the last picture; `disconnect` clears the demo; any other word prints `Unknown command
    "<word>"`. `callMain` applies `+set`/`+demo` args the same way. Tests in
      `integrated/engine-console.test.ts` ("the ring keeps the newest 500 lines") and
      `integrated/fake-engine.test.ts` ("an exec prints Execing like Q2PRO", "a demo reaches its end
      and keeps the last picture"). Files: `engine-console.ts` (+test), `engine-loader.ts`,
      `fake-engine.ts` (+test), `engine-module.ts`.
- [ ] **D3 — The integrated session plays a demo.** New
      `src/renderer/src/modules/replays/integrated/integrated-session.ts` with
      `playIntegrated({ demoId, installationId }, hooks)` and `stopIntegrated()`; hooks are
      `onLoading()`, `onPlaying()`, `onFinished()`, `onRefused(reason)` (reason is a
      `LocalizedMessage` with `canPlayInEngineMode: true`). Steps: if a session runs, stop it first;
      call `integratedPrepare` (add `integratedPrepare`/`integratedRelease` to
      `src/renderer/src/modules/replays/client.ts`, wrapping story 289's `integrated.prepare` /
      `integrated.release` handlers); a refusal (e.g. `replays.integrated.error.dataTooLarge` with
      `{ sizeMb }`) goes to `onRefused` and stops. Else `onLoading()`, fetch every manifest file
      from `/engine-data/<token>/<index>` (relative to the document origin) and write it to
      `/q2/<vpath>` (`FS.mkdirTree` of the dirname, `FS.writeFile` with the `Uint8Array`), skipping
      a file whose `/q2/<vpath>` already exists with the same size; remove the previous demo under
      `/q2/*/demos/_launcher/`; write the demo to `/q2/<demo.vpath>`. Then wait exactly one
      `requestAnimationFrame`, then: first start of the instance → `FS.mkdirTree('/q2home')` and
      `callMain(['+set','basedir','/q2','+set','homedir','/q2home','+set','game',gameDir,
    ...SESSION_CVARS,'+demo','_launcher/<name>'])`; later plays → one
      `q2l_console('disconnect')`, `game <gameDir>` only when it differs from the last one, the
      `set` lines of `SESSION_CVARS`, then `demo _launcher/<name>`. `SESSION_CVARS` is one constant:
      `scr_showpause 0`, `cl_autopause 0`, `con_notifylines 0`, `scr_demobar 0`, `cl_demowait 1`,
      `s_enable 0`. Never `exec`, never a cfg file. After the call `onPlaying()`, then poll
      `_q2l_demo_eof()` once per animation frame and call `onFinished()` once when it turns 1
      (keep polling stopped, the picture stays). A fetch failure or a throwing engine call releases
      the token and goes to `onRefused({ key: 'replays.integrated.error.loadFailed' })`.
      `stopIntegrated()`: stop the poll, `q2l_console('disconnect')`, `integratedRelease({ token
    })`. Tests in `integrated/integrated-session.test.ts` against the D2 fake engine and a mocked
      client — names listed under Acceptance Tests. Files: `integrated-session.ts` (+test),
      `client.ts`.
- [ ] **D4 — Play and Stop route by mode.** `src/renderer/src/modules/replays/useDemoPlay.ts`:
      in mode `integrated` (story 287's mode read) `play` calls D3's `playIntegrated` and never
      `playDemo`/`armStage`; `beginSession` gets `kind: 'integrated'` and
      `controlsUnavailable: { key: 'replays.player.unavailable.controlsComingSoon' }`; hooks set
      the store's new `integratedPhase: 'loading' | 'playing' | 'finished' | null` and, on
      `onFinished`, `applyState('finished')`; `onRefused` sets `stageReason` plus a new
      `stageEngineModeOffer: true`. `src/renderer/src/modules/replays/playback-store.ts`: session
      field `kind: 'engine' | 'integrated'` (engine is today's default), `integratedPhase`,
      `stageEngineModeOffer`; `requestStop` on an integrated session calls `stopIntegrated()` and
      `endSession()` directly (no `playbackStop` IPC). `playInEngineMode(demo)` in `useDemoPlay`:
      story 287's `playbackMode.set('engine')`, clear the offer, then the engine-mode `play`.
      Remove `replays.player.unavailable.integratedNotReady` from `src/shared/replays/demo-play.ts`
      eligibility and from `src/renderer/src/modules/replays/locale/en.json`. Tests in
      `useDemoPlay.test.ts`, `playback-store.test.ts`, `src/shared/replays/demo-play.test.ts`.
      Files: `useDemoPlay.ts`, `playback-store.ts`, `demo-play.ts`, `en.json` and the three tests.
- [ ] **D5 — The stage and timeline show integrated playback.**
      `src/renderer/src/modules/replays/components/DemoStage.tsx`: in mode `integrated` render
      story 290's `EngineCanvas` only while `session?.kind === 'integrated'`, else today's
      placeholder; while `integratedPhase === 'loading'` overlay the visible text
      `replays.integrated.loading` (`data-testid="replays-integrated-loading"`, `role="status"`);
      when `stageEngineModeOffer` is set, show the reason in the existing `replays-stage-reason`
      element plus a UI-kit button "Play in engine mode" (`replays.integrated.playInEngineMode`,
      `data-testid="replays-stage-play-engine"`) calling D4's `playInEngineMode`.
      `components/DemoTimeline.tsx`: for an integrated session position and duration read "—" and
      every control is `aria-disabled` with the visible reason from `session.controlsUnavailable`
      through the existing reason element (mirror `replays-playback-engine-reason`), Stop stays
      enabled. Strings in `locale/en.json`: `replays.integrated.loading` ("Loading demo…"),
      `replays.integrated.playInEngineMode` ("Play in engine mode"),
      `replays.integrated.error.loadFailed` ("The demo could not be loaded into the launcher."),
      `replays.player.unavailable.controlsComingSoon` ("Timeline controls are coming soon for
      integrated playback."), and `dataTooLarge` if story 289 did not add it ("This installation's
      game data ({{sizeMb}} MB) is too large for integrated playback."). Tokens only
      (`/design-tokens`). Tests in `DemoStage.test.tsx`, `DemoTimeline.test.tsx`. Files:
      `DemoStage.tsx`, `DemoTimeline.tsx`, `en.json`, two tests.
- [ ] **D6 — Flow and docs.** New `scripts/flows/replays-play-integrated.mjs` (mirror
      `scripts/flows/replays-play-q2pro.mjs` and its fixture `writeReplaysPlayFixture`; story 290's
      fake-engine switch on), registered in `scripts/flows/areas.json` under the replays area that
      lists `src/renderer/src/modules/replays/integrated/**`. Steps: set mode integrated; play the
      `.dm2` → loading text seen, canvas visible, `window.__q2lFakeEngine` shows the manifest
      files under `/q2/`, the `callMain` args with basedir/homedir/game and the session cvars;
      `main.log` holds no client launch; wait for the finished state (timeline shows ended, canvas
      still there); `window.__q2lEngineConsole()` has no line containing `q2l_` or `Execing`; play
      the `.dm2.gz` and the zip-entry demo → each written under `demos/_launcher/` and played;
      Stop → placeholder back, token released (a fetch of the old `/engine-data/<token>/0` answers
      404); a second fixture installation whose `baseq2/pak1.pak` is extended with `truncate` past
      1 GiB → the stage shows the `dataTooLarge` reason, clicking "Play in engine mode" switches the
      mode switch to engine and launches the client (main.log). Update story 287's
      `scripts/flows/replays-playback-mode.mjs` where it asserts `integratedNotReady` (Play is now
      enabled). `docs/systems/replays-module.md`: Map gains `integrated/` (session, console,
      loader, fake), Limitations gains "integrated mode: no timeline control or sound yet".
      `CHANGELOG.md`: no new line. Files: the new flow, `areas.json`, `replays-playback-mode.mjs`,
      the fixture helper if a second installation needs a writer, `docs/systems/replays-module.md`.

## Model Hints

- D3 → deliverable-hard: the session owns a new cross-file ordering — token lifetime against
  story 289's single-token rule, MEMFS reuse across instances and game-dir changes, the
  loading-frame-before-blocking-call sequence and the eof poll — where a wrong order (fetch after
  release, `game` change without `disconnect`, a poll left running after Stop) still looks green
  in a naive test.
- Review: → default — the hard D carries the ordering risk and every AC has a test through the
  fake engine or the flow.

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/replays/integrated/integrated-session.test.ts` › "the first play writes the manifest into MEMFS and starts the engine with basedir, homedir and game"; e2e `scripts/flows/replays-play-integrated.mjs` › `replays-play-integrated`
- AC2 → unit `src/renderer/src/modules/replays/useDemoPlay.test.ts` › "integrated mode never calls the engine-mode play"; e2e `replays-play-integrated` (no client launch in main.log)
- AC3 → e2e `replays-play-integrated` (`.dm2.gz` and zip-entry steps)
- AC4 → unit `integrated-session.test.ts` › "the session cvars are set on start and before every later demo"
- AC5 → unit `integrated-session.test.ts` › "the console capture holds no plumbing lines"; e2e `replays-play-integrated` (reads `window.__q2lEngineConsole`)
- AC6 → unit `integrated-session.test.ts` › "the loading state comes one animation frame before the demo command"; unit `src/renderer/src/modules/replays/components/DemoStage.test.tsx` › "the stage shows the loading text while an integrated demo loads"; e2e `replays-play-integrated` (loading text seen)
- AC7 → unit `integrated-session.test.ts` › "the demo's end reports finished once and keeps the picture"; e2e `replays-play-integrated` (ended state, canvas still shown)
- AC8 → unit `integrated-session.test.ts` › "stop disconnects and releases the token"; unit `src/renderer/src/modules/replays/playback-store.test.ts` › "stopping an integrated session ends it without the engine-mode stop"; e2e `replays-play-integrated` (placeholder back, old token 404)
- AC9 → unit `DemoStage.test.tsx` › "a refused integrated play offers playing in engine mode"; e2e `replays-play-integrated` (`dataTooLarge` step)
- AC10 → unit `src/shared/replays/demo-play.test.ts` › "integrated mode with baseq2 paks is playable"; unit `src/renderer/src/i18n/keys.test.ts` › "every leaf key is referenced literally or under an allowlisted dynamic prefix" (existing, catches a leftover key); e2e `scripts/flows/replays-playback-mode.mjs` › `replays-playback-mode` (updated)
- AC11 → e2e `scripts/flows/replays-play-integrated.mjs` › `replays-play-integrated`, `scripts/flows/replays-play-q2pro.mjs` › `replays-play-q2pro` (existing); command `npm run engine:smoke` exits 0 (D1 gate)
- Timeline interim reason (context, removed by [[297]]) → unit `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx` › "an integrated session shows dashes and disabled controls with their reason"
- Manual residue: real installation — `.dm2`, `.dm2.gz`, zip demo in integrated mode show the correct picture with no PAUSED, console lines or demo bar, and load time / UI stall on a retail map is acceptable (R8) — needs retail game data and a human judgement of picture and stall, which the fake engine cannot give.

## Done
