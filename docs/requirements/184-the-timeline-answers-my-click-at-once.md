---
id: 184
title: The timeline answers my click at once
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

When I press pause, jump, seek or change the speed, the timeline only changes once the game's
readback arrives — on Windows that can be more than a second ([[183]]). Until then the click seems to
have done nothing, so I click again and the command runs twice.

The timeline should answer my click **at once**: it shows the expected result right away (paused
icon, the seek target, the new speed) and keeps the position moving smoothly between readbacks. The
game's readback then confirms or corrects it. If the game has not confirmed after a while, the
timeline says so instead of silently showing a state that is not true.

This improves how responsive the controls feel on every platform, regardless of how far [[185]]
brings the real latency down.

## Acceptance Criteria

- [ ] **AC1** — Pressing pause/play switches the button's icon and label immediately, before the
      game's readback arrives.
- [ ] **AC2** — A jump (±) or a click/keyboard seek moves the position display and the slider to the
      target immediately.
- [ ] **AC3** — A speed change shows the new speed immediately.
- [ ] **AC4** — While the demo plays (not paused), the position advances smoothly at the current
      speed between readbacks instead of standing still and jumping when a readback burst arrives.
- [ ] **AC5** — When the readback arrives, the timeline shows the game's real state; a readback that
      disagrees with the expected state (e.g. the seek landed elsewhere) wins.
- [ ] **AC6** — A command the game has not confirmed within a bounded time shows a visible
      "waiting for the game…" state on the affected control (text, not only an icon or colour); it
      clears on confirmation or when the command is given up.
- [ ] **AC7** — A refused command (e.g. the channel reports an error) reverts the control to the
      last confirmed state and shows the error as today.

## Open Questions

- ~~Q1: The bounded time for AC6 — a fixed value (recommended: 1 s, above [[183]]'s measured p95 after
  [[185]]), or taken from [[185]]'s measured target?~~ answered → Decisions (Sprint)
- ~~Q2: Two quick jumps (+10, +10): does the display show +20 at once (accumulating expected state,
  recommended), or only the latest command's target?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** AC6 bound: fixed 1 s
- **(User)** Quick successive jumps: accumulate, two quick +10 jumps show +20 at once
- **Confirmation comes from the position readback, not from ACKs.** The renderer never sees ACKs (Windows only has them, Linux has none), while `playback.position` (`positionMs`, `paused`) reaches the renderer on both platforms every 250 ms, so a single rule works on both.
- **Stale readbacks do not undo a pending command.** Readbacks keep arriving with the pre-command state until the game runs the command (Windows: up to >1 s, [[183]]), so a readback is classified against hypotheses (the "not applied yet" state, each intermediate target, the final target): nearest match within tolerance decides; only a readback that matches none of them is a disagreement and wins (AC5). Letting every readback win would snap the display back at once and defeat the story.
- **Match tolerance = 1500 ms × max(1, speed).** It covers `$cl_demopos`'s 0.1 s resolution plus the unknown moment inside the pending window at which the game applied the command, scaled because a faster demo drifts further in that window.
- **Speed is confirmed when the channel accepts it.** The engine has no speed readback (`PlaybackSession.speed` is local only), so the speed control shows the new value at once, counts as confirmed on the `playback.timeline` invoke's `ok`, and reverts to the last confirmed speed on a refusal. Today it never reverts, which AC7 fixes.
- **Pause and position are tracked as two independent pending chains.** A pause toggle and a seek do not change each other's result, so keeping them apart keeps the matching simple. Expected paused = confirmed paused XOR (odd number of pending toggles).
- **"Given up" = 5 s after the chain's newest command was sent.** At that point the chain is dropped, the display falls back to the latest readback, and the waiting text clears. 5 s is above main's 2 s Windows ACK timeout plus one ~1.3 s log burst, so a command main still runs is normally confirmed before that. No extra error is shown, because the game's real state is then on screen.
- **Waiting shows when a chain's oldest unconfirmed command is ≥ 1 s old** (the (User) 1 s bound). It applies per chain (pause, position, speed), so only the affected control shows it.
- **Where the waiting text appears:** one visible text element in the strip's state slot names the affected control ("Waiting for the game… (seek)"). The affected control gets `aria-busy="true"` and `aria-describedby` pointing at that text. The controls are icon-only, and a caption under each one would make the strip taller. One i18n key per control, so no translated fragments are concatenated.
- **Interpolation anchors on changed readbacks only.** Between Windows log bursts, main re-pushes the same latest sample every 250 ms. Re-anchoring on those repeats would make the display stand still, so the anchor moves only when position or paused changes.
- **Projection caps at 3 s of wall time past the anchor.** This is above the measured ~1.3 s burst interval, so smooth play is not cut off. The cap stops the display from running away while the game stalls (map load, hang).
- **Small backward corrections are allowed.** The position is sampled up to ~300 ms stale (50 ms log poll + 250 ms push), so a re-anchor may step back a little. Hiding that would contradict AC5 ("the game's real state wins"), so the e2e allows a step back of up to 0.5 s.
- **The optimistic logic is renderer-only and pure.** It lives in `src/renderer/src/modules/replays/optimistic-timeline.ts`, not in `src/shared`: main never needs it, and a pure module can be unit-tested without timers or a DOM.
- **The real-surface proof needs two stub-engine levers:** a command delay (deterministic "before readback" and "waiting after 1 s") and an output burst (reproduces the Windows log bursts for AC4). Without them the stub answers within milliseconds and every AC would pass even without this story.
- **AC7's real refusal is the finished demo.** Both channels refuse sends with `noSession` once the demo has finished, while the strip stays up. That is a platform-independent refusal reachable through the UI, so no refusal lever is needed. (Windows' queue-full refusal is Windows-only.)
- **A `data-position-ms` attribute on the seek element exposes the displayed position.** `aria-valuenow` has whole-second resolution, which is too coarse to prove smooth movement in the flow.

## Plan

The strip shows an **expected state** (confirmed readback + pending commands) and projects the
position between readbacks. Readbacks confirm, correct or, if stale, are ignored.

1. **Pure core** (`optimistic-timeline.ts`, D1): pending chains, hypothesis matching, give-up,
   refusal rollback, position projection. All rules are in D1's text; fully unit-tested.
2. **Store** (`playback-store.ts`, D2): owns the chains. It sends timeline actions through a new
   `sendTimeline` (the send logic moves out of `DemoTimeline`, like `requestStop` already did),
   feeds each `applyPosition` through the core, runs the 1 s waiting and 5 s give-up timers,
   and rolls back on refusal.
3. **Strip** (`DemoTimeline.tsx`, D3): renders the expected state, a rAF-driven projected
   position, the waiting text + `aria-busy`, and `data-position-ms`; i18n keys; CHANGELOG.
4. **Real surface** (D4): stub-engine levers `Q2L_UI_ENGINE_COMMAND_DELAY_MS` and
   `Q2L_UI_ENGINE_OUTPUT_BURST_MS`, plus the flow `replays-timeline-optimistic`.

Order: D1 → D2 → D3 → D4. No IPC, main or preload change.

## Deliverables

- [ ] **D1 — Pure optimistic-timeline core.** New `src/renderer/src/modules/replays/optimistic-timeline.ts`
      (pure: no React, no timers, no IPC; `now` is a parameter) plus
      `src/renderer/src/modules/replays/optimistic-timeline.test.ts` (node env). Imports
      `JUMP_STEP_S`, `TimelineAction`, `PlaybackView` from `@shared/replays/timeline`. Rules:
      - State: `confirmed` (last accepted readback: `positionMs`, `paused`, `anchorAt` = receipt time, plus
        `speed`), and three chains: `pause` (pending toggle entries), `position` (pending jump/seekTo
        entries, each with its resulting clamped target in ms), and `speed` (at most one pending value).
        Every entry carries `id` and `sentAt`.
      - `enqueue(state, action, now)`: a jump's target = the previous entry's target (or the displayed
        projected position if the chain is empty) + deltaS×1000, clamped to [0, durationMs]. So two quick
        +10 jumps give +20 at once (User decision). A seekTo's target = seconds×1000, clamped the same way.
        Returns the entry id.
      - `expected(state, now)`: paused = confirmed.paused XOR (odd count of pause entries). The position is
        the last position entry's target, projected from its `sentAt`, or else the confirmed position
        projected from `anchorAt`. Speed = the pending speed, or else the confirmed speed.
      - `project(pos, from, now, speed, paused, durationMs)`: when not paused, pos + (now−from)×speed with
        elapsed capped at 3000 ms; clamped to [0, durationMs].
      - `applyReadback(state, view, now)`: first resolve the pause chain. A readback paused == expected
        paused confirms the chain (clears it). Otherwise it is stale and the chain stays. Then resolve the
        position chain by nearest match. The hypotheses are h0 = confirmed position projected, and
        h1..hn = each entry's target projected from its `sentAt`. Tolerance = 1500 ms × max(1, speed).
        If the nearest match is within tolerance and is hi (i≥1), entries 1..i are confirmed and the rest
        stay. If it is h0, the chain stays (stale). If nothing matches, the chain is cleared and the
        readback wins (AC5). When `view.positionMs` or `paused` changed from the previous readback,
        `confirmed` re-anchors to the readback. An unchanged repeat keeps the old anchor, so the
        projection continues. With empty chains, a changed readback always wins.
      - `confirmSpeed(state, id)` / `refuse(state, id)`: refuse drops that entry. A later position
        entry's target is recomputed from the remaining chain. A refused speed reverts to confirmed.speed
        (AC7).
      - `waiting(state, now)`: returns the set of chains whose oldest entry is ≥ 1000 ms old.
        `giveUp(state, now)`: drops every chain whose newest entry is ≥ 5000 ms old.
      Tests (in the same file) cover every rule above, including the named ACs in `## Acceptance
      Tests`.
- [ ] **D2 — Store owns the pending state.** Edit `src/renderer/src/modules/replays/playback-store.ts`
      and `playback-store.test.ts` (jsdom docblock already used there; `vi.useFakeTimers()`; mock
      `./client`). Mirror the existing `requestStop` pattern (optimistic flag, revert on refusal).
      - Add `optimistic` (the D1 state) to `PlaybackSession`, initialised in `beginSession`.
      - Add a new action `sendTimeline(action): Promise<LocalizedMessage | null>`. It calls D1
        `enqueue`, then `playbackTimeline(action)` from `./client`. On outer `!ok`, inner `!ok` or a
        throw, it calls D1 `refuse` and returns the error (`{ key: 'replays.timeline.error' }` for a
        throw). On ok, a speed entry gets `confirmSpeed`. The `fullscreen` action bypasses the chains
        (sent as today). `setSpeed` stays only as the internal confirmed-speed setter, or is removed if
        unused.
      - `applyPosition` still runs `reducePlaybackView`, then D1 `applyReadback` with `Date.now()`.
      - Timers: after each enqueue, schedule a re-evaluation at +1000 ms (sets `session.waiting` from
        D1 `waiting`) and at +5000 ms (D1 `giveUp`, then recompute `waiting`). Also recompute `waiting`
        after every readback and refusal. `endSession` clears all timers.
      Tests in `playback-store.test.ts`: see `## Acceptance Tests` (AC5 store path, AC6 timers, AC7
      rollback).
- [ ] **D3 — Strip renders the expected state.** Edit
      `src/renderer/src/modules/replays/components/DemoTimeline.tsx`,
      `components/DemoTimeline.test.tsx`, `src/renderer/src/i18n/locales/en.json` (block
      `replays.timeline`), and `CHANGELOG.md` (`### Changed`, one short user-facing line).
      - `send()` becomes a thin wrapper over the store's `sendTimeline`; the inline error display stays
        as today.
      - Toggle icon/label, speed `Select` value, position text, slider fill/thumb and `aria-valuenow`
        come from D1 `expected`. The position comes from a small hook that re-renders on
        `requestAnimationFrame` while not paused/ended/fullscreen, calling D1 `project`/`expected` with
        `Date.now()`.
      - Add `data-position-ms={Math.round(displayedMs)}` on the `replays-timeline-seek` element.
      - Waiting: when `session.waiting` is non-empty, render
        `<span data-testid="replays-timeline-waiting" id=…>` in the state slot (instead of the state
        text), using `replays.timeline.waiting.pause` / `.seek` / `.speed` (en: "Waiting for the
        game… (pause)" etc.). Pause goes before seek, seek before speed, and only the first is shown.
        The affected control (toggle, the seek slider plus both jump buttons for position, or the speed
        select) gets `aria-busy="true"` and `aria-describedby` pointing at that span.
      - Tokens only (`text-ink-muted`/existing classes); no new colours.
      Tests in `DemoTimeline.test.tsx` (store seeded, client mocked): see `## Acceptance Tests`.
- [ ] **D4 — Real-surface proof.** Edit `scripts/lib/stub-engine.cjs`, add
      `scripts/flows/replays-timeline-optimistic.mjs` (mirror `scripts/flows/replays-timeline.mjs`:
      same fixture, env wiring and `Q2L_UI_ENGINE_COMMAND_LOG` reading).
      - Stub lever `Q2L_UI_ENGINE_COMMAND_DELAY_MS`: every launcher command (Windows control-file
        sequence incl. its `ACK` echo; Linux stdin line) runs N ms after the stub first sees it. The
        command-log line, state change and ACK are all delayed. Commands stay in order.
      - Stub lever `Q2L_UI_ENGINE_OUTPUT_BURST_MS`: the stub holds all output (logfile and stdout) and
        writes it in one burst every N ms, modelling Q2PRO's buffered logfile. Both levers are off
        when unset, so existing flows are unchanged.
      - The flow has three phases, each against a freshly started demo. Phase A uses
        `COMMAND_DELAY_MS=1500`. Phase B uses `OUTPUT_BURST_MS=1500` at 1x. Phase C uses no lever.
        Each flow step is named after the AC it proves (see `## Acceptance Tests`).
      - Run `npm run ui:flow -- replays-timeline` too, and it must stay green.

## Model Hints

- D1 → deliverable-hard: the hypothesis matching (stale vs. partial confirm vs. disagreement,
  projected against send times, accumulated clamped targets, recomputed on refusal) is a new
  cross-cutting rule. A subtly wrong version snaps the display back on stale readbacks or keeps
  a wrong position after a real disagreement.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-timeline-optimistic.mjs` › "AC1 pause flips before the readback" (phase A:
  click toggle; at +300 ms the label reads Play and the command log has no `pause` yet; still so at +1200 ms)
  + unit `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx` › "the toggle shows the expected state before any readback"
- AC2 → e2e `scripts/flows/replays-timeline-optimistic.mjs` › "AC2 jump, click-seek and key-seek move at once"
  (phase A: two forward clicks give +20 s in `replays-timeline-position`/`aria-valuenow` at +300 ms, and at
  +800/+1200 ms the position stays at or past the target; a seek-bar click and ArrowRight also
  move at once) + unit `src/renderer/src/modules/replays/optimistic-timeline.test.ts` › "two quick jumps accumulate to +20"
- AC3 → e2e `scripts/flows/replays-timeline-optimistic.mjs` › "AC3 speed shows at once" (phase A: select 2x; the select
  shows 2x at +300 ms before the command log has `timescale 2`) + unit `optimistic-timeline.test.ts` › "a pending speed is the expected speed"
- AC4 → e2e `scripts/flows/replays-timeline-optimistic.mjs` › "AC4 position advances smoothly between bursts"
  (phase B: sample `data-position-ms` every 200 ms for 4 s; no two consecutive samples are equal and no step is
  > +1000 ms or < −500 ms) + unit `optimistic-timeline.test.ts` › "an unchanged repeat readback keeps projecting" and
  "projection stops after 3 s without a new readback"
- AC5 → unit `src/renderer/src/modules/replays/optimistic-timeline.test.ts` › "a stale readback keeps the pending target",
  "a readback at an intermediate target confirms only up to it", "a readback matching no hypothesis wins"; unit
  `src/renderer/src/modules/replays/playback-store.test.ts` › "a disagreeing position event replaces the expected position"; e2e
  `scripts/flows/replays-timeline-optimistic.mjs` › "AC5 readback confirms the seek" (phase A: after the delayed command
  runs, the position matches the stub's and each command is in the log exactly once)
- AC6 → e2e `scripts/flows/replays-timeline-optimistic.mjs` › "AC6 waiting text after 1 s, cleared on confirmation"
  (phase A: `replays-timeline-waiting` shows the seek text at ≥ 1100 ms, the forward button has `aria-busy="true"`, and both are
  gone after confirmation) + unit `src/renderer/src/modules/replays/playback-store.test.ts` › "waiting appears after 1 s and clears on give-up after 5 s"
  + unit `DemoTimeline.test.tsx` › "the waiting text names the affected control"
- AC7 → e2e `scripts/flows/replays-timeline-optimistic.mjs` › "AC7 a refused command reverts" (phase C: press End, wait
  for the Finished state, click forward and click the toggle; `replays-timeline-error` shows, and the position and toggle label are back at
  the confirmed values) + unit `src/renderer/src/modules/replays/playback-store.test.ts` › "a refused speed reverts to the confirmed speed"

## Done
