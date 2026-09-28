---
id: 138
title: a demo knows how long it is
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

"Is this the full 20-minute match or a 30-second clip?" — a user deciding what to watch needs a
demo's length in the list, and the timeline ([[165]]) needs it to draw a seek bar (concept
`docs/concepts/demo-browser.md` §6.3, DEMO-6).

The demo header does not store a duration. Q2PRO emits 10 Hz demo frames, so duration ≈
`svc_frame` count × 100 ms. An exact count needs decoding every message (messages carry no length of
their own) but not entity state; a cheap estimate is roughly one block per frame. Which one runs at
scan time is concept open point §17.4 — to be decided by measuring on real demos, because a library
of thousands of demos is scanned on every module open ([[144]]).

## Acceptance Criteria

- [ ] **AC1** — Every `.dm2` and `.mvd2` that [[136]]/[[137]] can parse gets a duration.
- [ ] **AC2** — The method chosen in Q1 is documented in the module's code and in the concept
      (§17.4 resolved), including its accuracy against an exact frame count.
- [ ] **AC3** — Computing durations stays inside the scan-time budget decided in Q2, asserted by a
      test on a large synthetic demo.
- [ ] **AC4** — A demo whose duration cannot be determined shows "unknown", never `0:00`.
- [ ] **AC5** — Durations are shown as `m:ss`, or `h:mm:ss` from one hour on.

## Open Questions

- [x] ~~**Q1 — Exact vs. estimate** (§17.4) — needs measurements on real demos; which method?~~
      answered → Decisions (Sprint)
- [x] ~~**Q2 — Budget** — what scan cost per demo (or per MB) is acceptable?~~ answered →
      Decisions (Sprint)
- [x] ~~**Q3 — Exact later?** If the estimate is chosen, is an exact duration computed lazily when a
      demo is opened in the detail view or played?~~ moot, see Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Duration method: exact frame-count decode at scan time, not an estimate — the
  timeline ([[165]]) needs a precise duration/seek bar, and an approximate value "brings little"
  for that purpose. Q3 (lazy exact-later) is therefore moot: exact is computed up front. Q2
  (scan-time budget) stays open for refine to size against real fixture demos.
- **Measured on the real fixtures (refine, 2026-09-28):** `test.dm2` — 415 blocks, 5 header blocks,
  410 frame blocks, `svc_frame` serverframes run 1…410 without a gap → **410 frames = 41.0 s**.
  `PFAU_…_q2dm1.mvd2` (MVD version 2010) — 6202 blocks, 1 gamestate block, every other block holds
  exactly one `mvd_frame` (615 of them behind a reliable `mvd_configstring`/`mvd_print`/
  `mvd_unicast_r` prefix) → **6201 frames = 620.1 s (10:20)**, consistent with a 10-minute OpenTDM
  match plus countdown/intermission, which also confirms 10 Hz for MVD. The block-count estimate is
  0 frames off on both; that is the "accuracy against an exact count" AC2 documents. Reason: AC2
  asks for the number, and the user's choice of exact stands regardless of it.
- **Exact count = decode every message of a block up to its frame message.** Per block, messages
  are decoded (sized, not interpreted) from the block's start; reaching `svc_frame` (20) /
  `mvd_frame` (6) counts one frame and ends that block. Reason: every known writer puts exactly one
  frame per block — vanilla/r1q2 record one server packet per block (one `svc_frame` per packet,
  reliable data before it), Q2PRO `CL_EmitDemoFrame` and MVD `rec_frame` write one block per
  frame — so decoding the rest of the frame (playerstate/entity deltas, three protocol variants of
  field tables) adds cost and risk without changing the count; the build agent confirms this
  invariant in q2pro `master` (`src/client/demo.c`, `src/server/mvd.c`) and records it in the code
  comment. Frame-less blocks (header, `svc_spawnbaseline`, mid-demo `svc_serverdata`/
  `mvd_serverdata` gamestate, print-only) count zero — that is what makes it exact, not an estimate.
- **Duration = frames × 100 ms.** Reason: §6.3 — demo frames are 10 Hz, and the MVD fixture's
  10:20 confirms it; a map change inside a demo simply keeps counting.
- **Q2 — Budget:** the pure counter must count a **32 MiB synthetic demo, pushed in 64 KiB chunks,
  in ≤ 1000 ms** (≈ 30 ms/MiB); the main reader streams the file once (64 KiB chunks, plain or
  gunzip), holding at most one block plus one chunk in memory. Reason: the prototype scan measured
  6 ms for 34 MiB (≈ 0.2 ms/MiB) and a whole 34 MiB `readFileSync` 13 ms, so I/O dominates and
  [[144]] re-reads only changed files; the 150× margin keeps the test stable on slow CI while still
  failing an accidental quadratic buffer (re-concatenating the remainder per chunk).
- **Unknown instead of a wrong number:** an opcode the decoder cannot size, a size that overruns its
  block, a first block that is not serverdata → `ok: false` with a closed reason
  (`not-a-demo` | `undecodable` | `no-frames` | `unreadable`), never a partial count. A demo whose
  last block is cut or lacks the terminator (a crashed recording) keeps the frames of its complete
  blocks and reports `complete: false`. Zero frames → `no-frames`. Reason: AC4 — a short count is a
  wrong seek bar; a crash-cut demo still plays up to the cut in Q2PRO.
- **Display** — `formatDemoDuration(ms)` rounds to whole seconds, a positive duration under 0.5 s
  shows `0:01`; `null`/non-finite/≤ 0 → `{ kind: 'unknown' }`. Reason: AC4 reserves `0:00` as
  never shown, so a real sub-second clip must not look like one.
- **No visible string in this story:** the formatter returns a typed `unknown`; S27's list renders
  it via the i18n key `replays.duration.unknown` ("unknown"). Reason: S26 is the data layer with
  no demo list yet (sprint note), and an i18n key without a consumer is dead text.
- **Placement:** pure counters in `src/shared/demos/`, the streaming file reader
  `readDemoDuration(path)` added to [[136]]'s `src/main/lib/demo-bytes.ts`; format by content
  (`MVD2` magic), gzip by magic, as [[136]]/[[137]]. The counter reads the protocol / MVD version
  from serverdata itself and does not import the header parsers. Reason: one decode path per file,
  no coupling to header exports that are still being refined — the exact [[136]]/[[137]] export
  names used by the AC1 cross test are confirmed at build time.
- **No UI, no CHANGELOG entry, no i18n keys.** Reason: nothing user-visible ships in S26.

## Plan

1. **D1 — shared counter core + `.dm2` counter** (`src/shared/demos/`): block framing with a
   streaming buffer (`push(chunk)` / `finish()`), per-block message sizer for the protocol-34
   opcode set (+ confirmed 343x deviations), frame count, result types. Synthetic dm2 writer.
2. **D2 — `.mvd2` counter** on D1's core: `uint16` blocks, 5-bit opcode + 3 extra bits, sizers
   for the MVD non-frame ops. Synthetic MVD2 writer.
3. **D3 — duration formatter** `m:ss` / `h:mm:ss` / typed unknown (pure).
4. **D4 — main reader** `readDemoDuration(path)` in `demo-bytes.ts` (stream, gzip sniff, `MVD2`
   sniff → counter), real-fixture tests, AC1 cross test with the header parsers, concept §6.3 /
   §17.4 resolved.

Order: D1 → D2 → D4; D3 independent. Depends on [[136]] (and [[137]] for D4's cross test) built
first.

Result shape (D1 exports it):

```ts
type FrameCountResult =
  | { ok: true; frames: number; durationMs: number; complete: boolean }
  | { ok: false; reason: 'not-a-demo' | 'undecodable' | 'no-frames' | 'unreadable'
      ; at?: number /* file offset of the failing block */ }
interface FrameCounter { push(chunk: Uint8Array): void; finish(): FrameCountResult; readonly failed: boolean }
```

## Deliverables

- **D1 — counter core + `.dm2` frame counter + synthetic writer + tests.**
  Files: new `src/shared/demos/frame-count.ts` (types, `DEMO_FRAME_MS = 100`, streaming block
  buffer), `src/shared/demos/dm2-frames.ts`, `src/shared/demos/dm2-frames-writer.ts`,
  `src/shared/demos/dm2-frames.test.ts`. Pure (no `node:*`, no `Buffer`); mirror the style of
  `src/shared/demos/dm2-header.ts` / `dm2-writer.ts` (story 136) and `src/shared/servers/`.
  Spec: `createDm2FrameCounter(): FrameCounter` (types above). Framing: `int32 LE` length, `-1` =
  end (later bytes ignored), other negative or > 1 MiB → `not-a-demo`; the buffer keeps only the
  unconsumed tail (at most one block + one chunk; no re-concatenation of the whole remainder per
  push — use a growable buffer with a read offset). First block's first opcode must be
  `svc_serverdata` (12) → read `int32` protocol (34, 3434, 3435, 3436 accepted, else `not-a-demo`).
  Per block, decode messages from offset 0 until: `svc_frame` (20) → `frames++`, next block;
  `svc_serverdata` (12, header or mid-demo map change; re-read protocol) or `svc_spawnbaseline`
  (14) → block is frame-less, next block; `svc_configstring` (13: `uint16` + string), `svc_print`
  (10: byte + string), `svc_stufftext` (11), `svc_centerprint` (15), `svc_layout` (4) (strings),
  `svc_inventory` (5: 256 × int16), `svc_nop` (6), `svc_disconnect` (7) / `svc_reconnect` (8),
  `svc_muzzleflash` / `2` (1/2: int16 + byte), `svc_sound` (9: flags byte, index byte, optional
  volume/attenuation/offset bytes, entity int16, pos 3 × int16 by flag), `svc_download` (16: int16
  size, byte, size bytes when > 0), `svc_temp_entity` (3: byte type + the per-type field list —
  port the complete protocol-34 table from packetflinger/libq2 (Apache-2.0), incl. `TE_STEAM`'s
  conditional `int32`) → sized and skipped; any other opcode, a size past the block end, an
  unterminated string → `undecodable` (sticky: later pushes are ignored, `failed` = true). Before
  coding, confirm in q2pro `master` (`src/client/parse.c`, `inc/common/protocol.h`, read for facts
  only, nothing GPL copied) (a) the one-frame-per-block invariant (`src/client/demo.c`) and (b)
  which of these messages differ for 3434–3436 (at least the 16-bit sound index flag); implement
  them keyed by protocol and write both findings into the file's header comment, together with the
  method, "exact, not an estimate", and the fixture accuracy (block estimate 0 frames off on both
  real fixtures) — AC2's code half. `finish()`: cut last block / missing terminator → keep counted
  frames, `complete: false`; 0 frames → `no-frames`; else `{ ok, frames, durationMs: frames × 100,
  complete }`. Never throws, every loop advances.
  Writer: `buildDm2Stream(opts)` → `Uint8Array`: serverdata block (protocol), header configstring
  blocks, then a list of blocks each built from messages (`frame` with serverframe, `print`,
  `configstring`, `sound`, `tempEntity(type)`, `baseline`, `serverdata`, `raw(opcode, bytes)`),
  optional terminator.
  Tests (names in Acceptance Tests): frames preceded by every sized reliable message count once;
  frame-less blocks (print-only, baselines, mid-demo serverdata) count zero — so a block counter
  fails; each 343x protocol with its confirmed deviations; unknown opcode / overrun → `undecodable`;
  cut tail → `complete: false`; zero frames → `no-frames`; same result for 1-byte, 7-byte and
  64 KiB pushes; 1000 seeded mutations never throw; **budget:** a 32 MiB synthetic stream pushed in
  64 KiB chunks counts correctly in ≤ 1000 ms (`performance.now()` around push+finish).

- **D2 — `.mvd2` frame counter + synthetic writer + tests.**
  Files: new `src/shared/demos/mvd2-frames.ts`, `src/shared/demos/mvd2-frames-writer.ts`,
  `src/shared/demos/mvd2-frames.test.ts`. Mirror D1's `dm2-frames.ts` / writer / test and reuse
  `frame-count.ts` (types, `DEMO_FRAME_MS`, streaming block buffer).
  Spec: `createMvd2FrameCounter(): FrameCounter`. Input starts with magic `MVD2` (else
  `not-a-demo`), then `uint16 LE` length blocks, `0` = end. Opcode byte: low 5 bits = op, high 3
  bits = extra bits. First block must start with `mvd_serverdata` (4): read `int32` protocol (37)
  and `int16` version (2009–2013, else `not-a-demo`); a serverdata block (header or mid-file
  gamestate) is frame-less. Per block decode until `mvd_frame` (6) → `frames++`, next block; sized
  and skipped: `mvd_nop` (1), `mvd_configstring` (5: `uint16` + string), `mvd_print` (17: byte +
  string), `mvd_unicast`/`_r` (8/9: length = byte | extra << 8, byte clientnum, length bytes),
  `mvd_multicast_*` (10–15: length = byte | extra << 8; `_pvs`/`_phs` variants (11, 12, 14, 15)
  add `uint16` leaf; length bytes), `mvd_sound` (16: layout per version — confirm); anything else
  → `undecodable`. Confirm every layout and the one-frame-per-block `rec_frame` invariant against
  aq2replay (MIT) and q2pro `master` `src/server/mvd.c` / `src/server/mvd/parse.c` (facts only) and
  note them in the header comment. `finish()` as D1.
  Tests: frames behind configstring/print/unicast/multicast prefixes count once; print-only and
  gamestate blocks count zero; versions 2009–2013 accepted, 2008 → `not-a-demo`; unknown op →
  `undecodable`; cut tail → `complete: false`; push-size independence; 1000 seeded mutations never
  throw; budget as D1 (32 MiB MVD2 in 64 KiB pushes ≤ 1000 ms).

- **D3 — duration formatter + tests.**
  Files: new `src/shared/demos/duration-format.ts`, `src/shared/demos/duration-format.test.ts`.
  Pure; mirror any small pure formatter under `src/shared/` (e.g. `src/shared/servers/`).
  Spec: `formatDemoDuration(ms: number | null | undefined): { kind: 'known'; text: string } |
  { kind: 'unknown' }`. `null`, `undefined`, `NaN`, `±Infinity`, `≤ 0` → `unknown`. Else
  `s = max(1, round(ms / 1000))`; `s < 3600` → `m:ss` (minutes unpadded: `0:41`, `10:20`,
  `59:59`); from 3600 → `h:mm:ss` (`1:00:00`, `1:02:05`, `12:00:01`). Doc comment: the
  `unknown` case is rendered by the list via i18n key `replays.duration.unknown` (S27).
  Tests: the boundary table above incl. 3599.4 s → `59:59`, 3599.6 s → `1:00:00`, 1 ms → `0:01`,
  and "no input ever yields `0:00`" over a sweep of 0…10 000 ms plus the invalid inputs.

- **D4 — main streaming reader + real-fixture tests + concept.**
  Files: `src/main/lib/demo-bytes.ts` (add `readDemoDuration`; leave 136/137's functions
  unchanged), `src/main/lib/demo-bytes.test.ts` (add a `describe` block), `docs/concepts/demo-browser.md`.
  Mirror the gzip-sniffing stream path 136 built in `readDemoPrefix`.
  Spec: `readDemoDuration(path): Promise<FrameCountResult>` — `createReadStream` (64 KiB
  `highWaterMark`); gzip by magic `1f 8b` → pipe through `createGunzip()`; the first 4
  (decompressed) bytes `MVD2` → `createMvd2FrameCounter`, else `createDm2FrameCounter`; push every
  chunk; stop and destroy the streams as soon as `counter.failed`; a gunzip error mid-stream →
  `finish()` on what was pushed (a cut `.gz` behaves like a cut file); an I/O error → `{ ok: false,
  reason: 'unreadable' }`. Never rejects.
  Tests: real `docs/fixtures/demos/test.dm2` → `{ ok: true, frames: 410, durationMs: 41000,
  complete: true }` and its frames equal the `svc_frame` serverframe span (last − first + 1, read
  independently in the test) — the exactness oracle; real `PFAU_20221127-053327_q2dm1.mvd2` →
  6201 frames / 620 100 ms / complete (refine's prototype number — if the built counter disagrees,
  investigate, do not edit the expectation to fit); `gzipSync` copies of both yield deep-equal
  results; a `.dm2`-named copy of the MVD2 still yields 6201; a missing path → `unreadable`; **AC1
  cross test:** for both real fixtures and synthetic protocol 3434/3435/3436 dm2 and MVD version
  2009/2013 files (D1/D2 writers, headers shaped so 136/137's parser accepts them), the header
  reader (`readDemoHeader` / `parseDemoHeader` — exact names confirmed at build time) returns
  `ok: true` **and** `readDemoDuration` returns `ok: true` with `frames > 0`.
  Concept: §6.3 "Duration" and §17.4 rewritten as resolved — exact frame count by per-block decode
  up to the frame, the one-frame-per-block invariant, 10 Hz, the budget, and the fixture numbers
  (410 / 6201 frames, block estimate 0 off) — AC2's concept half.

## Model Hints

- D1 → deliverable-hard — the message sizer is a hand-ported opcode/temp-entity table plus
  per-protocol 343x deviations that the real `test.dm2` never exercises (its frame blocks have no
  reliable prefix), so one mis-sized field silently turns valid demos `undecodable` or, worse,
  realigns into a wrong count; and the streaming buffer is where a quadratic re-concat hides.
- D2 → default (same pattern on D1's core; the real MVD2 fixture exercises its prefix opcodes)
- D3 → default
- D4 → default
- Review: → default — the plausible wrong implementation (count blocks instead of decoding, which
  passes both real fixtures because their block estimate is exact) is defeated by D1/D2's
  frame-less-block and reliable-prefix tests, which a default review can check in the diff.

## Acceptance Tests

- AC1 → unit `src/main/lib/demo-bytes.test.ts` › "every demo the header parsers accept gets a duration"
  and › "the real test.dm2 lasts 410 frames and the real PFAU mvd2 6201 frames, plain and gzipped"
- AC2 → unit `src/main/lib/demo-bytes.test.ts` › "the dm2 frame count equals the serverframe span of the real fixture"
  (accuracy half); unit `src/shared/demos/dm2-frames.test.ts` › "frame-less blocks count zero so the count is not a block estimate"
  and `src/shared/demos/mvd2-frames.test.ts` › "print-only and gamestate blocks count zero";
  the documentation half (code header comment + concept §6.3/§17.4) has no runtime behaviour and is
  checked by the story review against the diff.
- AC3 → unit `src/shared/demos/dm2-frames.test.ts` › "a 32 MiB dm2 is counted within the scan budget"
  and `src/shared/demos/mvd2-frames.test.ts` › "a 32 MiB mvd2 is counted within the scan budget"
- AC4 → unit `src/shared/demos/duration-format.test.ts` › "an unknown or non-positive duration is unknown and nothing ever formats as 0:00"
  and `src/shared/demos/dm2-frames.test.ts` › "undecodable input and zero frames give no duration instead of a partial one"
  and `src/shared/demos/mvd2-frames.test.ts` › "undecodable input gives no duration";
  the visible "unknown" text is rendered by S27's demo list (no list exists in S26), which maps
  `{ kind: 'unknown' }` to `replays.duration.unknown` — gap named for the sprint review.
- AC5 → unit `src/shared/demos/duration-format.test.ts` › "durations format as m:ss below an hour and h:mm:ss from one hour"
  (display on the list is S27's, as above)

## Done

<!-- Filled by /build 138. -->
