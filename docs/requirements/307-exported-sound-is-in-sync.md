---
id: 307
title: Exported sound is in sync with the picture
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a developer I want the sync between picture and sound in an exported video measured
automatically, so that an offset larger than one video frame turns the test red before a user
hears it.

Context:

- [concept §13](../concepts/integrated-demo-player.md) (A/V sync check), success criterion K5 in
  [concept §1](../concepts/integrated-demo-player.md), audio timestamps in
  [concept §10.1](../concepts/integrated-demo-player.md).
- Test demos with weapon fire and known sound events from [[283]] (`tests/engine/demos/`), game
  data from `npm run engine:data`.
- The launcher's demo readers live in `src/shared/demos/` (`dm2-frames.ts`, `dm2-facts.ts`);
  `svc_sound` is not read today and has to be added.
- The check is added to the engine lane `npm run test:engine` from [[304]].
- Constraints: `extractSoundEvents` is pure (`src/shared/demos/dm2-sounds.ts`) and counts demo
  time like `frame-count.ts`; expected times are relative to the export start (range start minus
  the 500 ms pre-roll, concept §10.3). Onset detection: short-time energy (5 ms windows), a jump
  over an adaptive threshold, 50 ms dead time. Pairing is nearest neighbour within 100 ms. The
  report goes to `.engine-test/av-sync/` as JSON and text. Tolerances are named constants that
  point at K5.
- Not in scope: changes to the export pipeline (an offset found here becomes a fix for [[305]] /
  [[306]], never a silently raised tolerance); engine mode (it has no export).
- Depends on: [[306]], [[283]].

Expected manual residue: watching an exported test demo and a real retail demo — do shots and
muzzle flashes feel in sync?

## Acceptance Criteria

- [ ] **AC1** — `extractSoundEvents(bytes)` returns the demo time (ms) of every `svc_sound`
      event; a unit test proves it on a synthetic `.dm2` built with
      `src/shared/demos/dm2-writer.ts` with known events (`npx vitest run src/shared/demos/dm2-sounds.test.ts`).
- [ ] **AC2** — `detectOnsets(pcm, sampleRate)` finds every click in a synthetic signal
      (silence plus clicks at known times) with an error ≤ 2 ms and reports no extra onset
      (`npx vitest run src/renderer/src/modules/replays/export/onset.test.ts`).
- [ ] **AC3** — When the real engine exports the test demo with sound (1080p60 or 720p30) and
      expected and detected times are paired, every pair has |Δ| ≤ 1 video frame (16.7 ms at
      60 fps); `npm run test:engine -- --only=av-sync` is green and
      `.engine-test/av-sync/report.json` carries the median and `maxDeltaMs ≤ 16.7`.
- [ ] **AC4** — Reading the same MP4 with Mediabunny `Input`, audio and video track durations
      differ by ≤ 1 video frame.
- [ ] **AC5** — In the same MP4 the video timestamps are strictly monotonic with a constant
      `1/fps` spacing (CFR).
- [ ] **AC6** — An expected sound event that must be audible and has no detected partner fails
      the check; the report names its attenuation.
- [ ] **AC7** — `npm run test:engine -- --only=av-sync --inject-audio-offset=50` exits non-zero
      with a report naming an offset of about 50 ms (the check can go red).

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
