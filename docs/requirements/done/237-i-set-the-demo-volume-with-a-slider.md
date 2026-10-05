---
id: 237
title: I set the demo's game volume with a slider
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player watching a demo, I can turn the game's sound up, down or off from the timeline with a
volume slider and a mute button, the way a video player works — without opening the console.

User feedback 2026-10-04: "volume slider (only ingame sound), like on YouTube". Today there is no
volume control in the Demos view; the only way is typing `s_volume 0.3` into the console field. The
playback channel already sends console commands (`pause`, `seek`, `timescale`), and `s_volume` is a
known cvar (Q2PRO default 0.7). "Only ingame sound" means the game's own volume — not the launcher's,
not the system mixer, and not the volume the user plays the game with normally.

Concept: [replays-module.md](../systems/replays-module.md), [demo-browser.md](../concepts/demo-browser.md).

## Acceptance Criteria

- [x] **AC1** — While a demo session runs, the timeline shows a speaker button and a volume slider
      (0–100 %), on Windows and Linux.
- [x] **AC2** — Moving the slider changes the playing game's sound volume; the slider sends the
      value through the playback channel, never by restarting the demo.
- [x] **AC3** — Dragging the slider does not flood the channel: intermediate values are coalesced and
      the value the user lets go of is the one the game ends up with.
- [x] **AC4** — The speaker button mutes and unmutes; unmute restores the volume set before muting.
      Muted state shows as a crossed-out speaker icon plus a text label, never by colour alone.
- [x] **AC5** — The slider and the button are keyboard-operable (arrow keys step the slider, the
      button toggles with Enter/Space) and carry accessible names.
- [x] **AC6** — After the session ends, the installation's `s_volume` is what it was before the demo
      started — the demo volume never leaks into normal play.
- [x] **AC7** — A new session starts at the volume of the last demo session (remembered by the
      launcher), or at the game's own value if none was set yet.

## Open Questions

- ~~**Q1** — Does "game sound" include music (`ogg_volume` in Q2PRO, if the build has it), or only
  `s_volume`? Recommendation: `s_volume` only; music is rare in demos.~~ answered → Decisions (Sprint)
- ~~**Q2** — Is the remembered volume (AC7) global or per installation? Recommendation: global — it is
  a viewing preference, not a game setting.~~ answered → Decisions (Sprint)
- ~~**Q3** — Does `s_volume` take effect live under the Windows `s_driver wave` stage setup, or does it
  need `snd_restart`? To be verified in refine against a real Q2PRO.~~ decided → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Game sound volume: s_volume only (no music).
- **(User)** Remembered volume: global.
- Q3: `s_volume` is sent as a plain live cvar change, no `snd_restart` — Q2PRO's DMA mixer (wave and
  DirectSound alike) and its OpenAL listener gain read `s_volume` every frame; the audible check on a
  real Q2PRO is the story's one manual residue.
- The control is percent 0–100 in steps of 5, sent as `s_volume <percent/100>` — 5 % matches the
  config tab's `s_volume` step (0.05) and keeps arrow-key stepping quick.
- Volume gets its own handler `playback.volume` (`{ percent, muted }`), not a new timeline action kind
  — it needs coalescing and session state the optimistic timeline chain does not model.
- Coalescing (AC3) lives in main: at most one volume line in flight, newer values replace the pending
  one, the latest is sent once the channel has settled — one place, unit-testable, independent of
  renderer timing; the renderer sends on every input change.
- Mute sends `s_volume 0` and main keeps the level; unmute re-sends the level — the level is never lost
  because the renderer always sends it alongside `muted`.
- The remembered volume (`demoVolume`, percent, in the replays state slot) is the level, never the muted
  0, and mute itself is not remembered — a session silently starting mute would look broken.
- `demoVolume` is written once when the session ends (only if the user changed the volume in it) —
  no state writes during a drag.
- Every playback session launches with `+set s_volume <start>` (remembered level, else the game's own
  value) — this one rule puts `s_volume` on the existing session-cvar restore path even when nothing was
  remembered yet, so a live change can never be archived into `q2config.cfg`.
- "The game's own value" is the last `set`/`seta s_volume` line of the session's `q2config.cfg`, else
  the Q2PRO default 0.7 — the same file the restore edits, so start value and restored value agree.
- The volume control is disabled while the demo is fullscreen, like the speed select — the Windows
  channel drops commands once fullscreen and the game holds the keyboard.
- The cinema overlay bar does not get the control in this story — AC1 names the timeline strip; the
  shared `VolumeControl` makes adding it later a one-line follow-up.
- The visible label next to the slider reads "Muted" when muted, else the percent ("70 %") — AC4's
  text label, and it doubles as the slider's value text.
- Works the same on Windows and Linux (both channels take console lines), so nothing is disabled per
  platform.

## Plan

1. **Contract + main volume path (D1).** `playback.volume` handler + schema in the replays contract;
   `ReplaysPlaybackDisplay` carries `volume: { percent, muted }`; a new `playback-volume.ts` coalesces
   and sends `s_volume` lines; `playback-control.ts` holds the session's volume for the display push.
2. **Start value, restore, memory (D2).** `demo-play.ts` adds `+set s_volume <start>` before `+demo`
   and `s_volume` joins `SESSION_RESTORE_CVARS`; the start comes from persisted `demoVolume` or the
   config's archived line (default 0.7); `persisted.ts` gains `demoVolume`, saved at session end.
3. **Renderer (D3).** `VolumeControl.tsx` (speaker `IconButton` + native range + visible label) in
   `DemoTimeline.tsx`; store reads `volume` from the display event; locale keys; changelog line.
4. **E2E (D4).** Stub engine learns `s_volume` (logs it, archives it into `q2config.cfg` on quit when
   asked); flow `replays-volume.mjs` walks AC1–AC7 on the real surface.

Order: D1 → D2 → D3 → D4. Systems doc `docs/systems/replays-module.md` is updated in D1 (handler,
display) and D2 (persisted `demoVolume`, restore list).

## Deliverables

- **D1 — `playback.volume` reaches the game, coalesced.**
  Files: `src/shared/modules/replays.ts` (handler `playbackVolume: 'playback.volume'`, payload schema
  `z.strictObject({ percent: z.number().int().min(0).max(100), muted: z.boolean() })`, wired into the
  payload-schema map like `playbackTimeline`; `ReplaysPlaybackDisplay.volume?: { percent: number;
  muted: boolean }`, optional for older callers like `speed`), new
  `src/main/modules/replays/playback-volume.ts` + `playback-volume.test.ts`,
  `src/main/modules/replays/playback-control.ts` (+ its test), `src/main/modules/replays/index.ts`,
  `docs/systems/replays-module.md` (handler list + display line).
  - `createPlaybackVolume({ playback: Pick<PlaybackControl,'send'|'settled'|'setVolume'> })` →
    `set({ percent, muted }): Outcome<void>`. Line: `s_volume ${muted ? 0 : percent / 100}`. No live
    session → the channel's `NO_SESSION` failure unchanged. Latest-wins: while one volume line is
    unsettled, a newer call only replaces the pending value and returns ok; when `settled()` resolves
    the pending value (if any) is sent. A send failure clears the pending value.
  - `playback-control.ts`: `prepare` input gains optional `volumePercent` (default 70); the session holds
    `volume: { percent, muted }` (muted false at start); `setVolume(v)` mirrors `setSpeed` (no-op without
    a live session or when equal, else emit display); `display()` carries it. `setVolume` also records
    the level (`percent`, never the muted 0) on the control itself, outside the session, and
    `takeChangedVolume(): number | null` returns that level and resets it — so it survives the session
    being cleared at its end (D2 reads it then).
  - `index.ts`: register the handler next to `playbackTimeline` (same `handle(...)` shape).
  - Tests (`playback-volume.test.ts`): "sends s_volume as a fraction", "mute sends 0 and keeps the
    level", "a burst of changes keeps one line in flight and ends on the last value", "no session is
    the no-session error"; `playback-control.test.ts`: "the display carries the session volume",
    "takeChangedVolume returns the last level once, after the session ended".

- **D2 — The session starts at the remembered volume and never leaks it.**
  Files: `src/main/modules/replays/demo-play.ts` (+ `demo-play.test.ts`),
  `src/main/modules/replays/session-cvar-restore.ts` (+ test), `src/main/modules/replays/persisted.ts`
  (+ test), `src/main/modules/replays/index.ts`, `docs/systems/replays-module.md` (persisted state).
  - `session-cvar-restore.ts`: export `readArchivedCvar(configPath, name, fs?)` → the value of the last
    `set`/`seta <name>` line (quotes stripped) or null; reuse the file's `splitLines`/`cvarNameOf`.
  - `persisted.ts`: `demoVolume: number | null` (integer percent 0–100), forgiving parse: anything else
    → null; a setter like the other slots.
  - `demo-play.ts`: `DemoPlayDeps` gains `demoVolume: () => number | null`. When a playback channel
    exists, start = `demoVolume()` ?? round(clamp01(readArchivedCvar(configPath,'s_volume')) * 100) ??
    70; add `+set s_volume <start/100>` to the stage/session args right before `+demo`, pass
    `volumePercent: start` to `playback.prepare`. Add `'s_volume'` to `SESSION_RESTORE_CVARS`, so the
    existing `overridesRestoreCvar` path snapshots and restores it with no new branch.
  - `index.ts`: wire `demoVolume` from persisted state; on `playbackControl.onStateChange` with
    `'ended'`, `const level = playbackControl.takeChangedVolume()` (D1: the last level the user set, never
    the muted 0, null when unchanged) and persist it when not null.
  - Tests: demo-play "a play launches with +set s_volume at the remembered volume", "without a remembered
    volume it starts at the config's s_volume, else 0.7", "s_volume's archived line is restored after the
    game exits (also when nothing was remembered)"; restore test "readArchivedCvar takes the last line";
    persisted "demoVolume parses forgivingly"; `index.test.ts` "a changed volume is remembered at
    session end, the level not the mute".

- **D3 — The timeline shows a speaker button and a volume slider.**
  Files: new `src/renderer/src/modules/replays/components/VolumeControl.tsx` + `VolumeControl.test.tsx`,
  `src/renderer/src/modules/replays/components/DemoTimeline.tsx` (place it before the speed select),
  `src/renderer/src/modules/replays/playback-store.ts` (take `volume` from the display event like
  `speed`), `src/renderer/src/modules/replays/client.ts` (the `playbackVolume` call),
  `src/renderer/src/modules/replays/locale/en.json`, `CHANGELOG.md` (`### Added`: "Demo timeline:
  volume slider and mute button for the game's sound.").
  - `IconButton` (`components/ui/Button`) with lucide `Volume2` / `VolumeX` (crossed-out when muted),
    label `replays.timeline.volume.mute` / `.unmute`, `aria-pressed={muted}`; native
    `<input type="range" min=0 max=100 step=5>` with `aria-label` `replays.timeline.volume.label` and
    `aria-valuetext` = the visible label; visible text `replays.timeline.volume.muted` ("Muted") or
    `replays.timeline.volume.percent` ("{{value}} %"). Every input change sends `{ percent, muted:false }`
    (main coalesces); the button sends `{ percent: level, muted: !muted }`. While dragging the local value
    wins over display pushes. Both disabled while fullscreen (mirror the speed select's `disabled`).
    Use the timeline's `FOCUS_RING`; semantic tokens only; 44px-height controls like the strip's other
    buttons (`size="lg"`).
  - Test ids: `replays-timeline-volume-toggle`, `replays-timeline-volume`,
    `replays-timeline-volume-label`.
  - Tests (`VolumeControl.test.tsx`): "shows a speaker button and a 0–100 slider", "mute shows the
    crossed-out speaker and the Muted label, unmute restores the level", "arrow keys step the slider by 5
    and Enter/Space toggle mute", "both controls carry accessible names".

- **D4 — End-to-end proof on the real surface.**
  Files: `scripts/lib/stub-engine.cjs`, new `scripts/flows/replays-volume.mjs`, fixture helpers in
  `scripts/lib/fixture.mjs` if needed. Mirror `scripts/flows/replays-timeline.mjs` (setup with
  `writeReplaysTimelineFixture`, `commands(files.commandLog)`, `expectCommands`).
  - Stub: add cvar `s_volume` (default `0.7`), log a bare `s_volume N` to the command log (like
    `timescale`); when env `Q2L_UI_ENGINE_ARCHIVE_CVARS` lists `s_volume`, on quit rewrite/append
    `seta s_volume "<value>"` in the `q2config.cfg` main's `sessionConfigPath` resolves (Windows: game
    dir; Linux: the fixture's Q2PRO write dir) — env-gated so no other flow changes.
  - Flow `replays-volume` (fixture config holds `seta s_volume "0.5"`), steps: AC1 strip shows
    toggle + slider at 50; AC2 set 30 → engine ran `s_volume 0.3`, same engine process; AC3 fill 10
    values rapidly → engine's last `s_volume` is the final value and fewer lines than inputs ran;
    AC4 mute → `s_volume 0` + "Muted" label, unmute → `s_volume 0.3`; AC5 focus slider, ArrowUp →
    `s_volume 0.35`, Space on button toggles; AC6 stop → after exit `q2config.cfg` again reads
    `seta s_volume "0.5"`; AC7 play again → slider starts at 35.

## Model Hints

- D2 → deliverable-hard: the leak AC6 guards against hides in the launch/restore ordering — `+set
  s_volume` must reach `overridesRestoreCvar` and the snapshot before spawn on both the in-place and
  staged-copy paths, and the remembered value must be read at session end before the control clears
  the session, never the muted 0.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-volume.mjs` › "replays-volume" (step AC1); unit
  `src/renderer/src/modules/replays/components/VolumeControl.test.tsx` › "shows a speaker button and a
  0–100 slider". Windows and Linux: the flow runs over both stub transports on its platform's run.
- AC2 → e2e `scripts/flows/replays-volume.mjs` › "replays-volume" (step AC2); unit
  `src/main/modules/replays/playback-volume.test.ts` › "sends s_volume as a fraction". Manual residue:
  hearing the volume change on a real Q2PRO with an audio device — the harness engine is a stub with no
  sound output.
- AC3 → unit `src/main/modules/replays/playback-volume.test.ts` › "a burst of changes keeps one line in
  flight and ends on the last value"; e2e `scripts/flows/replays-volume.mjs` › "replays-volume" (step AC3).
- AC4 → unit `src/renderer/src/modules/replays/components/VolumeControl.test.tsx` › "mute shows the
  crossed-out speaker and the Muted label, unmute restores the level"; unit
  `src/main/modules/replays/playback-volume.test.ts` › "mute sends 0 and keeps the level"; e2e
  `scripts/flows/replays-volume.mjs` › "replays-volume" (step AC4).
- AC5 → unit `src/renderer/src/modules/replays/components/VolumeControl.test.tsx` › "arrow keys step the
  slider by 5 and Enter/Space toggle mute" and › "both controls carry accessible names"; e2e
  `scripts/flows/replays-volume.mjs` › "replays-volume" (step AC5).
- AC6 → unit `src/main/modules/replays/demo-play.test.ts` › "s_volume's archived line is restored after
  the game exits (also when nothing was remembered)"; e2e `scripts/flows/replays-volume.mjs` ›
  "replays-volume" (step AC6).
- AC7 → unit `src/main/modules/replays/demo-play.test.ts` › "a play launches with +set s_volume at the
  remembered volume" and › "without a remembered volume it starts at the config's s_volume, else 0.7";
  unit `src/main/modules/replays/persisted.test.ts` › "demoVolume parses forgivingly"; unit
  `src/main/modules/replays/index.test.ts` › "a changed volume is remembered at session end, the level
  not the mute"; e2e
  `scripts/flows/replays-volume.mjs` › "replays-volume" (step AC7).

## Done

**Summary.** The demo timeline carries a speaker button and a 0-100 slider (steps of 5). Main coalesces `playback.volume` to one in-flight `s_volume` line, every channel play launches with `+set s_volume <start>` so the session restore puts the installation's value back, and the last level the user set is remembered globally (`demoVolume`) at session end.

**Commit message:** `237: demo volume slider + mute on the timeline, coalesced s_volume, restored after the session, remembered level`

**Verification (narrow gate).** build, typecheck, lint green; `npx vitest run --changed HEAD` 180 files / 1565 tests green; `src/comments.test.ts` + `src/architecture.test.ts` green. `--affected` would select 45 flows (too many for one call), so flows ran by name in batches: `replays-volume` (AC1-AC7), `replays-timeline`, `-timeline-burst`, `-timeline-optimistic`, `replays-cinema` and the stage/follow/overlays/unavailable/view-leave/x11-unreachable/cinema-*/fullscreen flows, all green. Not run (known reds, not ours): `replays-filter-search`, `replays-mod-warning`, `scripts/check-docs.test.mjs`, `scripts/flow-helper-duplication.test.mjs`. Review (default tier) PASS; fixed: schema doc comment placement, flow header comment, rejected `settled()` handling, `changedVolume` reset in `prepare`.
AC to test, all as named in Acceptance Tests and verified passing; flow steps AC1-AC7 in `replays-volume`.
Manual residue: hearing the volume change on a real Q2PRO with an audio device (the stub engine has no sound).

**Decisions.**
- The `replays-timeline` flow's Tab-order walk got two extra stops (the new toggle and slider sit before the speed select).
- Flow fixture puts `q2config.cfg` in the demo's game dir (`ctf`); the Linux write-dir path is unrun on this Windows host.
- Main calls `setVolume` (display push) when a line is actually sent; the slider's local value wins during a drag.
- The keyboard unit test asserts `step=5` and click-toggle (jsdom has no arrow-key value change); ArrowUp/Space are proven in the flow, Enter on the native button is browser behaviour.
- `docs/systems/replays-module.md` was tightened to stay within its 150-line cap.
- Environment note: a fix agent's temporary worktree wiped `node_modules`; restored with `npm ci` (lockfile unchanged).

tiers: D 4 / hard 1 · review default · cycles 1 · agents 11
