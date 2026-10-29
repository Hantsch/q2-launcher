---
id: 275
title: Demos play in an R1Q2 installation, with the controls it cannot offer disabled
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

As a player whose active installation runs R1Q2 only, I want to play a demo from the Demos view,
even if seeking, pausing or the position readout are not available, so I can watch a demo without
setting up Q2PRO.

Today (user feedback 2026-10-29): `demoPlayEligibility` (`src/shared/replays/demo-play.ts:93-140`)
refuses with `replays.play.unavailable.notQ2pro` unless the active installation is Q2PRO-capable,
and an R1Q2 installation with a detected Q2PRO is played with the Q2PRO binary. The playback
channel (position / fullscreen / pause poll, `src/main/modules/replays/playback-channel/`) is built
on Q2PRO commands.

Per the platform-parity rule in `CLAUDE.md`, a control R1Q2 cannot drive stays visible, disabled,
with its reason as visible text (an i18n key), not only a tooltip.

## Acceptance Criteria

- [ ] **AC1** — With an R1Q2-only active installation, Play on a demo launches R1Q2 with the demo
      (in place or via the temporary copy) and the game opens playing it.
- [ ] **AC2** — An installation that has Q2PRO keeps playing through Q2PRO, unchanged.
- [ ] **AC3** — During an R1Q2 playback, every playback control R1Q2 cannot support is visible,
      disabled, and shows its reason as visible text.
- [ ] **AC4** — The mod-missing warning, the game-running refusal and the Steam-runner refusal apply
      to R1Q2 playback as they do to Q2PRO.
- [ ] **AC5** — A demo R1Q2 cannot play (protocol it does not read) is refused before launch with
      its own reason.
- [ ] **AC6** — R1Q2 playback leaves the user's `config.cfg` settings as they were before the demo.

## Open Questions

- ~~Which controls survive on R1Q2: stop (close the game) only, or also pause / speed via console
  commands? Refine probes r1q2's console (see the Q2PRO probing pitfalls note — logfile buffering,
  no synthetic keys).~~ answered → Decisions (Sprint)
- ~~Which demo protocols does R1Q2 read (34/35 yes; Q2PRO's 36)? Decides AC5.~~ answered →
  Decisions (Sprint)
- ~~Linux: keep today's "no Q2PRO → refuse" rule, or does R1Q2 demo play apply there too?~~
  answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Refine probes r1q2's console to decide which controls survive; unavailable ones stay visible, disabled, with reason text. Linux follows the Windows rule. Protocols 34/35 only.
- **Probe result (r1q2 b8012, `C:\Games\R1Q2\r1q2.exe`, string scan of the binary):** no `demo`
  command — demos play only via `demomap <file>` (relative to `demos/`); no `cl_demopos`, no
  `demoseek`, no `if`, no `logfile_flush`; `pause`, `timescale`, `s_volume`, `logfile` and `wait`
  exist. So position readout and seeking are impossible, and every launcher control channel today
  depends on `if` (run-once guard) and `$cl_demopos`.
- **Surviving controls: Stop only.** Pause, speed, back/forward jump, seek, position readout, volume,
  console command, add-comment-at-position, fullscreen, cinema and the stage are disabled with one
  visible reason. Reason: pause/speed/volume would need a new R1Q2 file channel without a run-once
  guard over a buffered logfile — a second protocol, beyond this story's one-hard-D budget; it is a
  follow-up candidate, not part of 275. Stop needs no channel: a refused `quit` terminates the game
  at once (`playback-stop.ts`).
- **Engine choice:** Q2PRO-capable (own or detected Q2PRO) plays through Q2PRO exactly as today
  (AC2); otherwise an R1Q2-capable installation (`engineKind` r1q2, or a detected supported r1q2)
  plays through R1Q2; anything else is refused. Reason: AC2 pins the Q2PRO path, AC1 adds R1Q2 only.
- **Linux:** `linuxNoQ2pro` is removed; Linux uses the same rule as Windows. Reason: binding user
  decision. `notQ2pro` is renamed `unsupportedEngine` (text: needs Q2PRO or R1Q2), since R1Q2 now
  plays.
- **What R1Q2 refuses (AC5), one reason key `r1q2CannotPlay`:** `.mvd2`, a `.gz` demo, and a demo
  whose known protocol is neither 34 nor 35. A demo whose protocol is unknown (unreadable header
  without a protocol) is tried, as Q2PRO tries it. Reason: user decision "34/35 only"; r1q2 has no
  gz demo reader and staging never decompresses (`demo-staging.ts:10`).
- **Rows carry the protocol:** a readable `.dm2` row gets `protocol` (the header's wire protocol);
  the index cache version is bumped so every row re-parses. Reason: today a readable row cannot tell
  34 from Q2PRO's 3434–3436, so AC5 cannot be decided without it.
- **`demomap` and stufftext (reverses story 161's R1Q2 cut):** `demomap` is R1Q2's only route and
  executes the demo's stufftext, so AC6 is met by restoring the **whole** `config.cfg` (bytes, or
  its absence) after an R1Q2 session, with the same crash-safe pending snapshot as story 170's
  line restore; in-game changes made during an R1Q2 demo are reverted too. Reason: any cvar or bind
  can be stuffed and archived, so only the whole file guarantees AC6. Q2PRO sessions keep the
  line-wise restore unchanged. 161's "never demomap" tests stay for every Q2PRO-played installation.
- **R1Q2 sessions launch without channel args, volume `+set` or stage args** and without pipes on
  Linux. Reason: none of them work in R1Q2, and a `+set` the engine archives is what AC6 forbids.

## Plan

Engine choice and refusals live in the shared eligibility rule (renderer and main both run it);
main launches R1Q2 with `+demomap` through an engine-less playback session, so the session
lifecycle (`playing` → `ended`, Stop) stays the one `PlaybackControl` owns; the display event tells
the renderer which controls are unavailable and why.

1. **D1 rows carry `protocol`** — `discoveredDemoSchema` + scan/zip row builders + cache bump.
2. **D2 eligibility** — `demoPlayEligibility` picks `playEngine` (q2pro | r1q2), returns
   `+demomap` for R1Q2, refuses with `r1q2CannotPlay`, drops `linuxNoQ2pro`, renames `notQ2pro`;
   all new i18n keys; rename fallout in tests and `replays-play-q2pro` flow.
3. **D3 engine-less session** — `PlaybackControl.prepare({ engine: 'r1q2' })` uses a channel with
   no args that refuses every line; `ReplaysPlaybackDisplay.controlsUnavailable` carries the reason.
4. **D4 R1Q2 launch + config restore** (hard) — `demo-play.ts` launches R1Q2 (in place / staged),
   no volume/stage/channel args, stage refused with the R1Q2 reason, whole-file `config.cfg`
   restore; systems doc.
5. **D5 renderer** — every channel-backed control visible + disabled with one visible reason line.
6. **D6 e2e** — runnable R1Q2 stub in the `replays-play` fixture, flow `replays-play-r1q2`, areas
   registration, CHANGELOG.

Order: D1 → D2 → D3 → D4 → D5 → D6. Files per D are named in the D.

## Deliverables

- [ ] **D1 — A readable `.dm2` row carries its wire protocol.** Add `protocol: z.number().int()
      .nullable().optional()` to `discoveredDemoSchema` (`src/shared/modules/replays.ts`, doc
      comment: the header's wire protocol for a readable `.dm2`, null for `.mvd2` and unreadable
      rows — an unreadable row's protocol stays in `unreadable.protocol`). Fill it where rows are
      built: `DemoHeaderFacts` + `toRow` + `readDemoFacts` in
      `src/main/modules/replays/scan-service.ts` (from the ok `Dm2Header.protocol`; the mvd2 header
      gives null), the zip row in `src/main/modules/replays/zip-demos.ts` (~line 220), and discovery's
      placeholder row in `src/main/modules/replays/discovery.ts` (~line 608, null). Bump
      `REPLAYS_INDEX_CACHE_VERSION` 7 → 8 in `src/main/modules/replays/index-cache.ts` so cached rows
      re-parse. Tests in `src/main/modules/replays/scan-service.test.ts` › "a readable dm2 row carries
      its header's protocol, an mvd2 row carries null" and `zip-demos.test.ts` › "a zipped dm2 row
      carries its header's protocol" (use the existing fixture demos, protocol 34).
      Files: `src/shared/modules/replays.ts`, `scan-service.ts`, `zip-demos.ts`, `discovery.ts`,
      `index-cache.ts`, their two tests.
- [ ] **D2 — Eligibility plays R1Q2 and refuses what R1Q2 cannot play.** In
      `src/shared/replays/demo-play.ts`:
  - Engine: Q2PRO-capable active installation → exactly today's result (incl. `engine: 'q2pro'`
    override for an R1Q2 installation with a detected Q2PRO). Otherwise R1Q2-capable
    (`engineKind === 'r1q2'` or a detected `{ kind: 'r1q2', supported: true }`) → R1Q2, with
    `engine: 'r1q2'` override only when `engineKind !== 'r1q2'`. Otherwise refuse
    `replays.play.unavailable.unsupportedEngine` (renamed from `notQ2pro`; also the `WRONG_INSTALLATION`
    constant in `src/main/modules/replays/demo-play.ts`). Remove the Linux check and the
    `linuxNoQ2pro` key — Linux follows the same rule.
  - Add `playEngine: 'q2pro' | 'r1q2'` to the ok result and export `demoPlayCommand(engine)` →
    `'+demo'` | `'+demomap'`; in-place `extraArgs` is `[demoPlayCommand(playEngine), fileName]`.
  - Order: engine → Steam runner → game running → **R1Q2 only:** refuse
    `replays.play.unavailable.r1q2CannotPlay` when `format === 'mvd2'`, `gzip`, or the known
    protocol (`demo.protocol` for a readable row, `demo.unreadable?.protocol` for an unreadable one)
    is neither 34 nor 35 → mod-missing warning last (unchanged).
  - Locale `src/renderer/src/modules/replays/locale/en.json` (+ regenerate
    `src/renderer/src/i18n/__snapshots__/en.bundle.json`): `unsupportedEngine` "Demos play in Q2PRO
    or R1Q2 — the selected installation has neither. Pick one in the left rail.";
    `r1q2CannotPlay` "Not available in R1Q2: it plays only uncompressed .dm2 demos (protocol 34 or
    35). This demo needs Q2PRO."; `replays.playback.unavailable.r1q2` "Not available in R1Q2:
    pausing, speed, seeking, the position, volume, console commands, fullscreen and cinema need
    Q2PRO."; `replays.stage.unavailable.r1q2` "Not available in R1Q2: the launcher cannot place
    the game window, so the demo plays in its own window". Drop `notQ2pro`/`linuxNoQ2pro`.
  - Rename fallout: `src/renderer/src/modules/replays/useDemoPlay.test.ts`,
    `ReplaysView.test.tsx`, and `scripts/flows/replays-play-q2pro.mjs` — delete its tail
    (~:182-199) that selects the R1Q2 tile and expects "is not Q2PRO" (that path now plays; D6 owns it).
  - Tests in `src/shared/replays/demo-play.test.ts`: "an r1q2-only installation plays through
    r1q2 with demomap", "an r1q2 installation with a detected Q2PRO still plays through Q2PRO"
    (keep/adjust the existing one), "r1q2 refuses mvd2, gz and a protocol other than 34 or 35 with
    its own reason, and plays 34 and 35", "an unknown protocol is tried in r1q2", "the mod-missing
    warning, a running game and a Steam runner apply to r1q2 as to Q2PRO", "linux follows the
    windows rule". Rewrite story 161's "demo args never contain demomap…" to "a Q2PRO-played demo
    never gets demomap" (all engine kinds that end on Q2PRO). In
    `src/main/modules/replays/demo-play.test.ts` narrow 161's "a non-Q2PRO installation never gets a
    demo launch" loop to engine kinds that are neither Q2PRO- nor R1Q2-capable (key
    `unsupportedEngine`), and "the real builder never emits demomap" to Q2PRO launches.
- [ ] **D3 — An R1Q2 session has no control channel and says why.** In
      `src/main/modules/replays/playback-control.ts`, `prepare` takes `engine: 'q2pro' | 'r1q2'`
      (default `'q2pro'`). For `'r1q2'` it uses a new
      `src/main/modules/replays/playback-channel/engine-less-channel.ts` implementing
      `PlaybackChannel` (`types.ts`): empty `argsBeforeDemo`/`argsAfterDemo`, `start`/`close`
      no-ops, `send` and `enterFullscreen` → `fail('replays.playback.unavailable.r1q2')`, `settled`
      resolves at once, `latest()` → `{ positionMs: null, paused: null, finished: false }`,
      `display()` `'stage'`, `onFinished`/`onDisplayChange` never fire. Skip the position timer for
      it. Add `controlsUnavailable?: { key: string } | null` to `ReplaysPlaybackDisplay`
      (`src/shared/modules/replays.ts`); `display()` sets `{ key: 'replays.playback.unavailable.r1q2' }`
      for a live R1Q2 session, null otherwise; cinema availability for an R1Q2 session is
      unavailable with the same key. Lifecycle is unchanged: `playing` on attach, `ended` on
      exit/failed. Tests in `playback-control.test.ts` › "an r1q2 session plays and ends without a
      channel and reports its controls unavailable", "a console line to an r1q2 session is refused
      with the r1q2 reason"; `playback-stop.test.ts` › "stopping an r1q2 demo closes the game at once"
      (the refused `quit` terminates without the 5 s wait — existing behaviour, pinned for r1q2).
      Files: `playback-control.ts`, new `engine-less-channel.ts`, `src/shared/modules/replays.ts`,
      `playback-control.test.ts`, `playback-stop.test.ts`.
- [ ] **D4 — Main launches R1Q2 with the demo and puts `config.cfg` back.** In
      `src/main/modules/replays/demo-play.ts`, for `eligibility.playEngine === 'r1q2'`:
  - In place: `extraArgs` from eligibility (`+demomap <file>`); staged: `['+demomap',
    staged.value.relativePath]` (use `demoPlayCommand` for both engines — never a literal).
    Pass the eligibility's `engine` override as today.
  - `deps.playback.prepare({ …, engine: 'r1q2' })` (D3); no `s_volume` `+set`
    (`startVolumePercent` not consulted); a stage rect gets `stage: refuse('replays.stage.unavailable.r1q2')`
    and **no** stage or `normalWindowArgs` args; launch `start(input, { demo: true })` on every
    platform (no pipes); `attach(undefined)`; staged-copy cleanup and session tracking as today.
  - AC6: before spawn, snapshot the **whole** R1Q2 config file; after exit/failure/never-started,
    write it back byte-identical (or remove it if it did not exist). Extend
    `src/main/modules/replays/session-cvar-restore.ts`: `snapshot(configPath, { wholeFile: true })`
    records the file's bytes (base64, or null when absent) in the same pending JSON (additive
    optional field), `restore()`/`applyPending()` write them back through the existing
    `writeAtomic`/`serial` — one restore implementation, no second copy. Make `sessionConfigPath`
    take the playing engine: R1Q2 → `<root>/<gameDir>/config.cfg` (`limitsFor('r1q2')
    .writtenConfigName`, never a write dir); Q2PRO unchanged. Q2PRO launches keep the line-wise
    restore and byte-identical args.
  - Tests in `src/main/modules/replays/demo-play.test.ts`: "an r1q2 demo in place launches r1q2
    with exactly +demomap and the file", "an r1q2 demo from elsewhere plays its staged copy with
    +demomap", "an r1q2 launch carries no channel, volume or stage args and refuses the stage with
    the r1q2 reason", "a Q2PRO launch is unchanged" (keep the story 159 args test green), and in
    `session-cvar-restore.test.ts`: "a whole-file snapshot puts config.cfg back byte for byte after
    the game rewrote it", "a whole-file snapshot of a missing config removes the file the game
    wrote", "a pending whole-file snapshot is applied on the next start".
  - Update `docs/systems/replays-module.md` (Map/Handlers/Limitations): R1Q2 plays via
    `+demomap` with an engine-less session (Stop only), what R1Q2 refuses, whole-file config
    restore and why (stufftext), protocol on rows.
    Files: `demo-play.ts`, `session-cvar-restore.ts`, their tests, `docs/systems/replays-module.md`.
- [ ] **D5 — The timeline shows R1Q2's unavailable controls disabled with their reason.** The
      renderer reads `controlsUnavailable` from `playback.display` into the session in
      `src/renderer/src/modules/replays/playback-store.ts`. When set, in
      `components/DemoTimeline.tsx` the pause toggle (`replays-timeline-toggle`), back/forward,
      speed, seek, add-comment, cinema and fullscreen stay **visible**, are disabled
      (`aria-disabled` + `aria-describedby`, keep them focusable like the cinema pattern at
      ~:408-421/:455-463), the position readout shows its empty placeholder, `VolumeControl` gets
      `disabled`, and one visible line `<p data-testid="replays-playback-engine-reason">` renders
      `t(controlsUnavailable.key)` — every disabled control points at it; the seek/comment/cinema
      reason lines are not shown in addition. Stop (`replays-timeline-stop`) stays enabled.
      `components/ConsoleCommandField.tsx`: in such a session the field is visible, its input and
      Send disabled, `replays-console-reason` shows the same reason. No new colours (design
      tokens). Tests: `DemoTimeline.test.tsx` › "with controls unavailable every channel control is
      visible, disabled and described by the visible reason, and Stop stays enabled";
      `ConsoleCommandField.test.tsx` › "with controls unavailable the field is visible, disabled
      and shows the reason"; `playback-store.test.ts` › "a display push carries controlsUnavailable
      into the session".
      Files: `playback-store.ts`, `DemoTimeline.tsx`, `ConsoleCommandField.tsx`, (`VolumeControl.tsx`
      only if its `disabled` lacks a describedby hook), their tests.
- [ ] **D6 — The R1Q2 path end to end.**
  - Fixture: `scripts/lib/fixture/replays-play.mjs` gets an option `r1q2Stub: true` that installs a
    **runnable** stand-in as the R1Q2 installation's executable via `writeStubEngine(root, exe,
    { engine: 'r1q2', lifetimeMs: 60000 })` (writes `engine` into `stub-engine.json`), seeds
    `baseq2/demos/play-base.dm2`, an `.mvd2` (reuse the mvd2 variant's copy, ~:288-310) and a
    `baseq2/config.cfg` with known content, and makes the R1Q2 installation active.
    **Windows obstacle:** R1Q2's launch argv starts with `-nopathcheck`, which `node.exe` rejects as
    its own option (`bad option`, exit 9), so the `node.exe`-as-exe + `+set.js` trick cannot run it.
    Build a tiny wrapper exe once per fixture run with the .NET Framework `csc.exe`
    (`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, present on windows-latest) that
    starts node on `stub-engine.cjs` with the raw command line tail and forwards the exit code;
    if `csc.exe` is absent, the flow **skips loudly** like the missing-7za skip. Off Windows the
    existing `#!/bin/sh` wrapper already works.
  - `scripts/lib/stub-engine.cjs`: in `engine: 'r1q2'` mode accept `+demomap <file>` (not `+demo`),
    speak no control protocol, append a `set` line to `<game>/config.cfg` at start (models stufftext
    + R1Q2 archiving), live `lifetimeMs` or until killed.
  - New flow `scripts/flows/replays-play-r1q2.mjs` (template `replays-play-q2pro.mjs`): Play on
    `play-base.dm2` → main.log `launching … r1q2…` with `+demomap play-base.dm2` and no `+demo`,
    `logfile`, `q2l_` or `s_volume` arg; phase `running` (AC1). While running: pause toggle, back,
    forward, speed, seek, volume, add-comment, cinema, fullscreen and console input visible and
    disabled, `replays-playback-engine-reason` visible with "Not available in R1Q2" (AC3). Stop →
    phase leaves `running`; then `baseq2/config.cfg` equals the seeded bytes (AC6). Select the
    `.mvd2` → `actionbar-play` disabled, `actionbar-action-reason` contains "Not available in R1Q2"
    (AC5). Register it in `scripts/flows/areas.json` area `replays-playback` (cap 12 flows; else
    `replays-playback-launch`).
  - `CHANGELOG.md` `## Unreleased` › `### Added`: "Demos play in R1Q2 installations — Stop only;
    seeking, pause and the position need Q2PRO."
    Files: `scripts/lib/fixture/replays-play.mjs`, `scripts/lib/stub-engine.cjs`, new
    `scripts/flows/replays-play-r1q2.mjs`, `scripts/flows/areas.json`, `CHANGELOG.md` (+ the
    wrapper source if kept as a file under `scripts/lib/`).

## Model Hints

- D4 → deliverable-hard: it reverses story 161's guard on the one path that spawns a process from
  a renderer id — the R1Q2 branch must leave the Q2PRO args and line-wise restore byte-identical,
  and the whole-file restore must survive never-started, failed and crashed sessions through the
  pending snapshot without ever writing a stale snapshot over a newer one.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-play-r1q2.mjs` › "replays-play-r1q2" (launch argv `+demomap`,
  phase `running`); unit `src/main/modules/replays/demo-play.test.ts` › "an r1q2 demo in place
  launches r1q2 with exactly +demomap and the file" and › "an r1q2 demo from elsewhere plays its
  staged copy with +demomap"
- AC2 → e2e `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro" (existing, exact Q2PRO
  argv); unit `src/shared/replays/demo-play.test.ts` › "an r1q2 installation with a detected Q2PRO
  still plays through Q2PRO" and `src/main/modules/replays/demo-play.test.ts` › "a Q2PRO launch is
  unchanged"
- AC3 → e2e `scripts/flows/replays-play-r1q2.mjs` › "replays-play-r1q2" (controls disabled + reason
  line while running); component `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx`
  › "with controls unavailable every channel control is visible, disabled and described by the
  visible reason, and Stop stays enabled"
- AC4 → unit `src/shared/replays/demo-play.test.ts` › "the mod-missing warning, a running game and a
  Steam runner apply to r1q2 as to Q2PRO" — the renderer shows these through the same eligibility
  call and UI path the Q2PRO flows already walk, so no new flow.
- AC5 → e2e `scripts/flows/replays-play-r1q2.mjs` › "replays-play-r1q2" (`.mvd2` step); unit
  `src/shared/replays/demo-play.test.ts` › "r1q2 refuses mvd2, gz and a protocol other than 34 or 35
  with its own reason, and plays 34 and 35"
- AC6 → e2e `scripts/flows/replays-play-r1q2.mjs` › "replays-play-r1q2" (config.cfg equals the
  seeded bytes after Stop); unit `src/main/modules/replays/session-cvar-restore.test.ts` › "a
  whole-file snapshot puts config.cfg back byte for byte after the game rewrote it"

## Done

<Leave empty. Filled by `/build 275` after implementation:

- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
