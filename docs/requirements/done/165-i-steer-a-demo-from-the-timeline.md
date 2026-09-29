---
id: 165
title: I steer a demo from the timeline
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

This is the point of the whole module: a demo watched **like a video** — "like YouTube", not
`demo foo.dm2` and a prayer. While a demo plays in the engine window, the launcher shows a timeline:
play/pause, jump back and forward, click anywhere to seek there, change speed, and see the current
position and the total length (concept `docs/concepts/demo-browser.md` §3, §12.1, DEMO-26).

Commands go through [[164]]'s channel: Q2PRO `seek [+-]<time|%>` (backward through its in-memory
snapshots every `cl_demosnaps` seconds), `pause`, `timescale`. MVD2 seeking follows [[162]]; with
r1q2 the timeline is reduced ([[161]]). Jump and speed steps are concept open point §17.7 —
placeholders ±10 s / ±60 s and 0.25×–4× until decided.

## Acceptance Criteria

- [x] **AC1** — While a demo plays, the Demos view shows a timeline for that session; it disappears
      (or returns to idle) when the game exits.
- [x] **AC2** — Play/pause toggles the engine's pause state.
- [x] **AC3** — Jump back and jump forward move the playback by the step sizes decided in Q1.
- [x] **AC4** — Clicking a point on the timeline seeks to that position.
- [x] **AC5** — A speed control sets the engine's `timescale` in the steps decided in Q1, and shows
      the current speed.
- [x] **AC6** — Current position and total duration are shown and the position advances while
      playing; the duration comes from [[138]], else from the engine.
- [x] **AC7** — Every control is keyboard operable with visible focus; a control that does not
      apply (r1q2, [[161]]) is visible, disabled and says why. *(Refine: r1q2 playback is out of
      scope this sprint, so the applicable case is click-to-seek when no duration is known — see
      Decisions.)*
- [x] **AC8** — The timeline is a `ui:verify` screen with zero axe violations and an e2e flow drives
      it against a stubbed engine; any sub-44px density gets a CLAUDE.md deviation row with the
      desktop-only rationale.

## Open Questions

- [ ] ~~**Q1 — Steps** (§17.7): jump step sizes and speed steps.~~ answered → Decisions (Sprint)
- [ ] ~~**Q2 — Where the timeline lives** — inside the Demos view only, or a compact bar visible from~~ answered → Decisions (Sprint)
      every view while a demo plays?
- [ ] ~~**Q3 — Pause state** — can the launcher know about a pause the user triggered in-game via a~~ answered → Decisions (Sprint)
      bind ([[167]]), or does it infer it from the position standing still?

## Decisions (Sprint)

- **(User)** Where the timeline lives: Demos view only.
- **(User, sprint)** Playback goes through Q2PRO only; no r1q2 playback — the timeline never runs
  against r1q2, and 165 builds no reduced r1q2 timeline.
- **Q1 — Steps:** jump buttons move **±10 s**; on the focused seek bar ←/→ = ±10 s, PageUp/PageDown
  = ±60 s, Home/End = start/end; speed steps **0.25× · 0.5× · 1× · 2× · 4×** — 10 s matches Q2PRO's
  default `cl_demosnaps` (a backward seek lands on a snapshot), 60 s stays reachable through the
  standard slider keys without a second button pair, and the speed set is the concept's placeholder
  range in powers of two.
- **Q3 — Pause state:** inferred — the strip shows "paused" once the position stands still across
  two consecutive position events and "playing" as soon as it advances, whoever caused the pause,
  because spike 133 verified that `$cl_demopos` freezes while paused but verified no engine output
  carrying the pause flag itself.
- **Speed display:** shows the last speed the launcher set (1× at session start), because no engine
  readback of `timescale` was verified and inferring it from position deltas is too noisy at ~0.6 s
  channel latency; a speed changed by an in-game bind is not reflected (accepted limitation).
- **Placement:** a full-width strip docked at the bottom of the Demos view, independent of the
  selected row, rendered only while a session exists (AC1's "disappears"), because an idle strip
  would be dead chrome next to the detail panel's Play.
- **Renderer sends actions, not command text:** the invoke payload is a typed timeline action
  (togglePause / jump / seekTo / speed) and main builds the engine command, because renderer input
  is never trusted (CLAUDE.md) and [[166]]'s free line has its own validated path.
- **Absolute seek in whole seconds** (`seek 30`), because that is the spike-verified form and one
  pixel of the bar on a 10-minute demo is already more than a second.
- **Seek verb per format** comes from [[162]]'s per-format helper (162 AC2), because 162 owns that
  decision; 165 only passes it through.
- **AC7's "does not apply" case:** with no known duration (neither [[138]] nor the engine) the seek
  bar is visible, disabled, and shows "Seeking by click needs the demo's length" while the jumps stay
  usable, because a click fraction cannot become a position without a length and the r1q2 case no
  longer exists.
- **Density:** transport buttons use `IconButton size="md"` (36px) with a CLAUDE.md deviation row
  (desktop-only rationale) in D3, because it matches the app's existing dense controls and AC8 asks
  for exactly that row.

## Plan

Builds on [[159]] (Play + stub engine process, its AC8), [[162]] (seek verb per format), [[164]]
(main channel: `sendCommand` + position / session-ended `module:event`). Order D1 → D2 → D3 → D4.

1. **D1 shared pure** — `src/shared/replays/timeline.ts`: step/speed constants, action schema,
   command builder, fraction→seconds, position formatter, playback-view reducer (pause inference).
2. **D2 contract + main** — `playback.timeline` handler in `src/shared/modules/replays.ts`, handled
   in main: current session → seek verb → D1 builder → 164's `sendCommand`.
3. **D3 renderer** — client wrapper + event subscription, zustand playback store on D1's reducer,
   `DemoTimeline` strip at the bottom of `ReplaysView`, i18n `replays.timeline.*`, CLAUDE.md
   deviation row.
4. **D4 e2e** — 159's stub engine learns 164's channel protocol and logs executed commands; a
   `ui:flow` drives every control; a `replays-timeline` `ui:verify` screen (axe 0).

## Deliverables

- [x] **D1 — timeline core (pure).** New `src/shared/replays/timeline.ts` + `timeline.test.ts` (mirror
  `src/shared/demos/duration-format.ts` + its test; shared = no node/DOM/electron). Exports:
  `JUMP_STEP_S = 10`, `PAGE_STEP_S = 60`, `SPEED_STEPS = [0.25, 0.5, 1, 2, 4]`;
  `timelineActionSchema` (zod discriminated union on `kind`: `togglePause` | `jump {deltaS: -60 |
  -10 | 10 | 60}` | `seekTo {seconds: int ≥ 0}` | `speed {value ∈ SPEED_STEPS}`);
  `buildTimelineCommand(action, seekVerb)` → exactly `pause` / `<verb> +10` / `<verb> -60` /
  `<verb> 30` / `timescale 0.5` (never any other text); `seekSecondsForFraction(fraction,
  durationMs)` (clamps the fraction to 0..1, rounds to whole seconds, never past the end);
  `formatPlaybackPosition(ms)` (0 → `0:00`, m:ss / h:mm:ss like `formatDemoDuration`, which cannot be
  reused because it maps 0 to unknown); `reducePlaybackView(prev, sample)` over `{positionMs,
  engineDurationMs | null, knownDurationMs | null, ended}` → `{positionMs, durationMs (known first,
  else engine, else null), paused, ended}` with `paused` true after two consecutive samples with an
  unchanged position and false on any advance. Tests pin every command string and each rule
  (test names in `## Acceptance Tests`).
- [x] **D2 — `playback.timeline` handler.** Add `playbackTimeline: 'playback.timeline'` to
  `REPLAYS_HANDLERS` and `timelineActionSchema` (D1) to the payload-schema map in
  `src/shared/modules/replays.ts`; register it in `src/main/modules/replays/index.ts` (mirror an
  existing `handle(...)` there; logic in new `src/main/modules/replays/playback-timeline.ts`): take
  164's current playback session, get the seek verb for the playing demo's format from 162's
  per-format helper, build with `buildTimelineCommand`, send via 164's channel `sendCommand`; no
  session → 164's typed no-session error, unchanged. Test in new
  `src/main/modules/replays/playback-timeline.test.ts` (fake channel): each action reaches
  `sendCommand` as the exact D1 string; an `.mvd2` session uses 162's verb; no session rejects; an
  off-list speed and fractional seconds are refused by the schema.
- [x] **D3 — timeline strip.** `src/renderer/src/modules/replays/client.ts`: `playbackTimeline(action)`
  plus wrappers for 164's position and session-ended events (mirror `onScanProgress`). New
  `src/renderer/src/modules/replays/playback-store.ts` + `.test.ts` (zustand; feeds events through
  D1's `reducePlaybackView`; known duration = the playing demo's [[138]] `durationMs`; last-set
  speed, 1× at session start; cleared on session end). New `components/DemoTimeline.tsx` +
  `DemoTimeline.test.tsx`, mounted full-width at the bottom of `ReplaysView.tsx`, rendered only while
  a session exists: demo name; play/pause `IconButton size="md"` (lucide `Play`/`Pause`, label
  flips with the inferred state); back/forward 10 s IconButtons; seek bar = one element with
  `role="slider"`, `aria-valuemin/max/now` in seconds and `aria-valuetext` "m:ss of m:ss"; click →
  `seekTo(seekSecondsForFraction(...))`, ←/→ = jump ∓/±10, PageUp/PageDown = jump ±60, Home/End →
  `seekTo` 0 / end; speed `Select` (`components/ui/controls.tsx`) with the five steps showing the
  current one; "m:ss / m:ss" position/duration text. Without a duration the slider is
  `aria-disabled`, ignores clicks and keys, and shows `replays.timeline.seekNeedsDuration` as
  visible text. Visible `focus-visible` ring on every control, tokens only (`/design-tokens`,
  `/frontend-guidelines`). testids: `replays-timeline`, `replays-timeline-toggle`, `-back`,
  `-forward`, `-seek`, `-speed`, `-position`, `-duration`, `-seek-reason`. All strings as
  `replays.timeline.*` in `src/renderer/src/i18n/locales/en.json`. Add the CLAUDE.md `## Deviations`
  row (36px transport IconButtons in `DemoTimeline.tsx`, desktop-only mouse-and-keyboard rationale,
  story 165). Component test: each control calls `playbackTimeline` with the right action; slider
  keys; the disabled-with-reason state; strip absent without a session.
- [x] **D4 — e2e against the stub engine.** Extend 159's stub engine process (the Node script 159 AC8
  launches in place of Q2PRO in the fixture) so it speaks 164's transport on the current platform the
  way the real engine does (Windows: re-reads the launcher's control file, honours the seq guard,
  appends `logfile_prefix`-stamped `POS m:ss.f` / `ACK N` lines to `<gamedir>/logs/<logfile_name>`;
  Linux: commands on stdin, `POS` lines on stdout); it keeps a simulated clock (`pause` toggles,
  `seek ±N | N` clamped to the demo length, `timescale` scales) and appends each executed command to
  a file named by a `Q2L_UI_*` env var. New flow `scripts/flows/replays-timeline.mjs` (mirror
  `scripts/flows/replays-demo-detail.mjs`; asserts on the stub's command log, not only on UI state)
  and a `replays-timeline` screen in `scripts/lib/screens.mjs` (mirror `replays-detail`; navigate =
  Play the fixture demo, wait for `replays-timeline`).

## Model Hints

- D4 → deliverable-hard — the stub must emulate Q2PRO's side of 164's platform transport (exec'd
  control file with the seq guard, timestamp-prefixed appended logfile, or stdin/stdout) closely
  enough that the real, unmodified 164 channel talks to it; a stub shaped to the flow instead of the
  protocol passes while proving nothing, and it spans launch, channel and renderer.
- Review: → default — command strings, schema refusals and the stub's executed-command log are all
  asserted by tests, so a wrong implementation would fail a test or be visible to a spec-aware
  default review.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-timeline.mjs` › "the timeline appears while a demo plays and
  disappears when the game exits"
- AC2 → e2e `scripts/flows/replays-timeline.mjs` › "play/pause toggles the engine's pause"; unit
  `src/shared/replays/timeline.test.ts` › "position standing still for two samples reads as paused"
- AC3 → e2e `scripts/flows/replays-timeline.mjs` › "jump back and forward move by 10 s"; unit
  `src/shared/replays/timeline.test.ts` › "builds seek -10 / +10 / -60 / +60"
- AC4 → e2e `scripts/flows/replays-timeline.mjs` › "clicking the bar seeks there"; unit
  `src/shared/replays/timeline.test.ts` › "a fraction maps to whole seconds within the length"
- AC5 → e2e `scripts/flows/replays-timeline.mjs` › "the speed control sets timescale and shows it";
  unit `src/main/modules/replays/playback-timeline.test.ts` › "an off-list speed is refused"
- AC6 → e2e `scripts/flows/replays-timeline.mjs` › "position advances and duration is shown"; unit
  `src/shared/replays/timeline.test.ts` › "the known duration wins over the engine's"
- AC7 → e2e `scripts/flows/replays-timeline.mjs` › "every control works from the keyboard with
  visible focus"; component `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx` ›
  "without a duration the seek bar is disabled and says why"
- AC8 → e2e `npm run ui:verify` screen `replays-timeline` (zero axe violations) + the flow above;
  the CLAUDE.md deviation row is added in D3 and checked by the review.

## Done

Timeline strip docked at the bottom of the Demos view while a Q2PRO demo session exists: play/pause, +-10 s, click/keyboard seek slider, speed 0.25x-4x, position/duration. Renderer sends typed actions (`playback.timeline`, zod-validated); main builds the command through 162's seek verb and 164's `sendCommand`. New Node stub engine (`scripts/lib/stub-engine.cjs`) speaks 164's real transport; flow `replays-timeline` and `ui:verify` screen `replays-timeline` (axe 0).

Commit message: `165: demo timeline - play/pause, jump, seek bar, speed; playback.timeline channel; stub engine speaks 164 transport`

Verification (narrow gate: `npx vitest run --changed HEAD`, `npm run ui:flow -- replays-timeline`, `npm run ui:verify`, build, typecheck; full gate is the sprint's): all green after review fixes. AC -> test as verified: AC1-AC7 flow `replays-timeline` (all 7 scenarios passed) + named unit/component tests; AC8 `ui:verify` 59/59 screens, 0 axe. No manual residue. `profiles.test.ts` "discard" failed once in a `--changed` run, passed 3x alone and in the rerun (flaky, untouched by this story).

Decisions:
- Pause inference = two consecutive unchanged steps (three samples), not two samples: at 0.25x with 250 ms pushes and 0.1 s resolution a single repeat is legitimate playing (review finding, fixed).
- Speed/seek verb: no verb-only helper in 162, so verb = first word of `demoSeekCommand(format, ...)`; 164's `PlaybackControl.prepare` now takes the demo format and exposes `currentFormat()`.
- Session starts when `demo.play` succeeds (only place that knows demo name + 138 duration).
- Fixture demo duration is 41 s, not 138 ms-based; stub uses node.exe copied as `q2pro.exe`; Linux stdin/stdout branch of the stub is untested here.
- Beyond plan: aria-label on ActionBar's game-dir Select (axe critical on this screen); `focus-visible:outline-solid` on the timeline speed select; 159/162 flows `replays-play-q2pro`/`-mvd2` updated to 164's launch-line shape (were red since 164; assertions kept full, per platform).
- CHANGELOG entry added under Added.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 8
