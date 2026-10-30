---
id: 282
title: 'Spike: what WebCodecs and Mediabunny can encode in Electron 43'
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to know which video and audio encoders Electron 43 really
offers through WebCodecs on Windows and Linux, and whether a WebGL2 canvas can be grabbed as a
`VideoFrame` right after rendering, so that the export's encoder tiers rest on measurements rather
than assumptions.

Spike, timebox 1.5 days: delivers `spikes/282-webcodecs-matrix/RESULT.md` with measurements and a
recommendation, no production code.

Context:

- [concept §10.4](../concepts/integrated-demo-player.md) (encoder selection and fallback), [concept §10.5](../concepts/integrated-demo-player.md) (streaming), [concept §8.3](../concepts/integrated-demo-player.md)
  (`preserveDrawingBuffer`), risks R4 and R5.
- Electron 43.8.4 (`node_modules/electron/package.json`). External facts:
  [electron/electron#55456](https://github.com/electron/electron/issues/55456) (Linux VA-API crash),
  [MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection),
  [Mediabunny writing](https://mediabunny.dev/guide/writing-media-files).
- No engine needed: a WebGL2 canvas with an animated test pattern is enough. Harness
  `spikes/282-webcodecs-matrix/harness.mjs` + `probe.html` + `probe.js`; Mediabunny and
  `@mediabunny/aac-encoder` are installed only in the spike folder's own `package.json`.
- File writing goes through `StreamTarget` → a `WritableStream` → a preload bridge call →
  positioned `fs.writeSync` in main (a dry run for [[299]]). Read-back via Mediabunny
  `new Input({ source: new BufferSource(buf), formats: ALL_FORMATS })`.
- Linux run via act in the existing Linux container (cf. `ci:local:verify`) or a Linux desktop.
- Not in scope: the engine, production code, root `package.json` changes, export UI, encoder
  selection logic ([[302]]).
- Depends on: —

Expected manual residue: `results/sample-win32.mp4` plays smoothly in VLC and the Windows media
player, the sine tone is audible, no artefacts.

## Acceptance Criteria

- [x] **AC1** — `cd spikes/282-webcodecs-matrix && npm install && node harness.mjs` exits 0 in a
      window with the launcher's `webPreferences` and writes `results/matrix-win32.json`.
- [x] **AC2** — The matrix holds the `VideoEncoder.isConfigSupported()` result for every
      combination of codec (`avc1.640028`, `avc1.4d0028`, `avc1.42e01f`, `vp09.00.10.08`,
      `av01.0.04M.08`), resolution (1280×720, 1920×1080), frame rate (30, 60) and
      `hardwareAcceleration` (`no-preference`, `prefer-hardware`, `prefer-software`).
- [x] **AC3** — The matrix holds `AudioEncoder.isConfigSupported` for AAC (`mp4a.40.2`, 48 kHz,
      stereo, 160 kbit/s) and for Opus.
- [x] **AC4** — The matrix holds Mediabunny's `canEncodeAudio('aac')` before and after
      `registerAacEncoder()` from `@mediabunny/aac-encoder`.
- [x] **AC5** — With `preserveDrawingBuffer: false`, a `new VideoFrame(canvas)` created in the
      same task right after drawing and read via `copyTo` contains test-pattern pixels; the result
      of a second attempt after an `await` (new task) is recorded too.
- [x] **AC6** — With the first supported H.264 config, Mediabunny writes 10 s of test pattern at
      60 fps plus a 10 s sine tone via `StreamTarget` to `results/sample-win32.mp4`.
- [x] **AC7** — `node spikes/282-webcodecs-matrix/verify-sample.mjs results/sample-win32.mp4`
      prints `frames=600 audio=10.00s` (± 1 frame) and exits 0.
- [x] **AC8** — A Linux run (`harness.mjs --platform-label=linux`) writes
      `results/matrix-linux.json`; `RESULT.md` records whether `prefer-hardware` crashes the GPU
      process (#55456) and whether `prefer-software` avoids it.
- [x] **AC9** — `RESULT.md` recommends an encoder tier (1/2/3 per concept §10.4) per platform and
      whether the ffmpeg fallback ([[313]]) stays P2 or becomes P3.
- [x] **AC10** — `git diff --stat package.json package-lock.json` shows no change.

## Open Questions

- ~~Does the ffmpeg fallback ([[313]]) stay P2 or drop to P3, given the measured matrix? (concept
  open point on ffmpeg)~~ answered by the spike itself → Decisions (Sprint): `RESULT.md` records
  the recommendation (AC9), the maintainer adopts it at the sprint review.

## Decisions (Sprint)

- The ffmpeg P2/P3 question is not decided in refine: `RESULT.md` recommends it by the rule of
  concept §17.9 — P3 ("could") if tiers 1–2 deliver H.264 + AAC on Windows and Linux in the
  measured matrix, otherwise P2 with the uncovered platform named; the question needs the
  measurement, which only the spike produces.
- `harness.mjs` is a plain Node script that spawns the root `node_modules/electron` binary on a
  spike-local `main.mjs`; AC1 runs it with `node`, and the root Electron is the version under test.
- The probe page is served from a spike-local privileged scheme `spike282://` (`standard, secure,
supportFetchAPI`, as `src/main/index.ts` registers `q2launcher://`), so secure-context and origin
  behaviour match the launcher rather than `file://`.
- The window copies `rendererWebPreferences` from `src/main/window-shared.ts` by value
  (`contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`, a CJS preload) plus
  `backgroundThrottling: false` and `show: false`; a spike may not import `src/` (no build step).
- No CSP on the probe page: the launcher's CSP and `wasm-unsafe-eval` are [[288]]'s question, and
  a CSP refusal here would mask the encoder measurement.
- The harness validates its own output (combination counts, required fields) and exits non-zero on
  a gap, so AC1–AC6 are proven by its exit code, the spike's equivalent of a test.
- AC5's "test-pattern pixels" means four scissor-cleared quadrants in distinct colours over a black
  clear colour, each sampled at its centre and matched within ±8 per channel — a blank or
  cleared-only frame cannot pass.
- The sample uses the first `supported: true` H.264 entry with 60 fps in AC2's iteration order and
  AAC through Mediabunny, registering `@mediabunny/aac-encoder` only when `canEncodeAudio('aac')`
  is false; the matrix records which audio path wrote it.
- `results/matrix-*.json` are committed as evidence; `results/*.mp4` and the spike's
  `node_modules/` are ignored by a spike-local `.gitignore`, its `package-lock.json` is committed
  with exact versions; a regenerable multi-MB binary does not belong in git.
- The Linux run is `run-linux.mjs`: `docker run` of `node:22-bookworm` with xvfb, installing
  `electron@<root version>` and the spike deps inside the container, not via act; act's workflow
  wrapper adds nothing for a single non-gating probe.
- A container has no VA-API device, so the #55456 crash cannot occur there: `RESULT.md` records the
  container result plus "not reproducible without VA-API", and the VA-API desktop run is a manual
  residue; a GPU-process crash is detected via `app.on('child-process-gone')` (type `GPU`).
- Spike files must pass the root `npm run format:check` and `npm run lint`, which already cover
  `spikes/`; nothing is added to `.prettierignore` or `.oxlintrc.json`.

## Plan

Throwaway spike under `spikes/282-webcodecs-matrix/`; no `src/`, root `package.json` or
`package-lock.json` change. Style reference: `spikes/186-cinema-overlay/` (header comment, fail-soft
probes, `results/`).

1. **Scaffold + Electron harness (D1).** Spike `package.json` (exact `mediabunny`,
   `@mediabunny/aac-encoder`), `.gitignore`, `README.md`. `harness.mjs` spawns Electron on
   `main.mjs`; `main.mjs` registers `spike282://`, opens a hidden window with the launcher's
   webPreferences and `preload.cjs`, waits for the probe's report, writes
   `results/matrix-<label>.json`, validates it, exits.
2. **Matrix probe (D1).** `probe.js` iterates AC2's 60 video combinations, AC3's two audio
   configs, AC4's before/after `canEncodeAudio('aac')`, and AC5's two capture attempts. Each probe
   fails soft (error recorded, run continues).
3. **Sample write + read-back (D2).** `probe.js` writes 10 s pattern at 60 fps + 10 s 440 Hz sine
   via Mediabunny `Output`/`Mp4OutputFormat`/`StreamTarget` → `WritableStream` → preload
   `spike.write(position, bytes)` → positioned `fs.writeSync` in `main.mjs`.
   `verify-sample.mjs` reads it back in Node with `Input` + `BufferSource` + `ALL_FORMATS`.
4. **Linux run + result (D3).** `run-linux.mjs` runs the harness in Docker under xvfb with
   `--platform-label=linux`. `RESULT.md`: matrix tables per platform, AC5 verdict, #55456 finding,
   tier recommendation per platform, ffmpeg P2/P3 recommendation.

Order: D1 → D2 → D3 (each needs the previous one's run).

## Deliverables

- **D1 — Harness and encoder matrix.** Create in `spikes/282-webcodecs-matrix/`: `package.json`
  (private, `"type": "module"`, exact-pinned `mediabunny` and `@mediabunny/aac-encoder`; commit its
  `package-lock.json`), `.gitignore` (`node_modules/`, `results/*.mp4`), `README.md` (how to run,
  one paragraph), `harness.mjs`, `main.mjs`, `preload.cjs`, `probe.html`, `probe.js`.
  - `harness.mjs` (Node): parses `--platform-label=<label>` (default `process.platform`), resolves
    the Electron binary with `createRequire(import.meta.url)('electron')` (walks up to the root
    `node_modules`), spawns it on `main.mjs`, forwards the exit code.
  - `main.mjs` (Electron main): `protocol.registerSchemesAsPrivileged` for `spike282` with
    `{ standard: true, secure: true, supportFetchAPI: true }` (mirror `src/main/index.ts:41`),
    a `protocol.handle` serving read-only files from the spike folder (incl. its `node_modules`),
    and a `BrowserWindow({ show: false, webPreferences })` whose `webPreferences` copy
    `rendererWebPreferences` in `src/main/window-shared.ts` by value (`preload` = `preload.cjs`,
    `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`,
    `spellcheck: false`, `backgroundThrottling: false`). Records every
    `app.on('child-process-gone')` with its `type`/`reason` into the result.
  - `preload.cjs` (sandboxed, CJS, `contextBridge` only): `spike.report(json)`.
  - `probe.js` (ES module, imports Mediabunny's ESM bundle via `spike282://` path): writes
    `{ electron, chrome, platform, video[], audio[], mediabunny, capture }` where `video[]` has one
    entry `{ codec, width, height, framerate, hardwareAcceleration, supported, error? }` per
    combination of codecs `avc1.640028, avc1.4d0028, avc1.42e01f, vp09.00.10.08, av01.0.04M.08` ×
    1280×720, 1920×1080 × 30, 60 fps × `no-preference, prefer-hardware, prefer-software`
    (60 entries, bitrate 8 Mbit/s); `audio[]` = AAC `mp4a.40.2` 48 kHz stereo 160000 bit/s and
    Opus 48 kHz stereo 128000 bit/s; `mediabunny = { aacBefore, aacAfter }` around
    `registerAacEncoder()`.
  - Capture (AC5): a DOM `<canvas>` with a WebGL2 context, `preserveDrawingBuffer: false`; clear to
    black, scissor-clear four quadrants red/green/blue/white; in the same task
    `new VideoFrame(canvas, { timestamp: 0 })` → `copyTo` with `format: 'RGBA'` → sample each
    quadrant centre; pattern = all four within ±8 per channel. Second attempt: draw, then
    `await new Promise((r) => setTimeout(r, 0))`, then capture. Record
    `capture = { sameTask, afterAwait }` each as `pattern | blank | error:<msg>`.
  - `main.mjs` validates before writing exit 0: 60 video entries with boolean `supported`, 2 audio
    entries, both mediabunny booleans, both capture fields; otherwise exit 1 with the gap named.
  - Acceptance: `cd spikes/282-webcodecs-matrix && npm install && node harness.mjs` exits 0 and
    writes `results/matrix-win32.json`; `git diff --stat package.json package-lock.json` (root) is
    empty; root `npm run format:check` and `npm run lint` are green.
- **D2 — Sample MP4 via StreamTarget, and read-back.** Files: `spikes/282-webcodecs-matrix/`
  `probe.js`, `preload.cjs`, `main.mjs`, new `verify-sample.mjs`.
  - `preload.cjs` adds `spike.write(position, bytes)` (Uint8Array) and `spike.finish()` via
    `ipcRenderer.invoke`; `main.mjs` opens `results/sample-<label>.mp4` with `fs.openSync(…, 'w')`,
    handles writes with positioned `fs.writeSync(fd, bytes, 0, bytes.length, position)`, closes on
    finish. Bounds: reject a non-integer or negative position.
  - `probe.js`, after the matrix: picks the first `video[]` entry with `supported: true`,
    `codec` starting `avc1.` and `framerate: 60`; if `canEncodeAudio('aac')` was false before
    registration, uses the registered polyfill. `new Output({ format: new Mp4OutputFormat({
fastStart: false }), target: new StreamTarget(writable, { chunked: true }) })` where `writable`
    is a `WritableStream` whose `write({ data, position })` awaits `spike.write`. A
    `CanvasSource` (or `VideoSampleSource`) gets 600 frames of the animated pattern (quadrant
    colours rotate each frame) at timestamps `i/60`; an `AudioSampleSource` gets 10 s of 440 Hz sine,
    48 kHz stereo f32, in 1024-frame chunks. `await add()` for backpressure, then `finalize()`.
    Records `sample = { codec, width, height, audioPath: 'webcodecs' | 'polyfill', bytes }` in the
    matrix; `main.mjs`'s validation requires it.
  - `verify-sample.mjs <file>` (Node): `new Input({ source: new BufferSource(readFileSync(file)),
formats: ALL_FORMATS })`; counts the primary video track's packets with `EncodedPacketSink`,
    audio duration via `computeDuration()` on the primary audio track; prints
    `frames=<n> audio=<s.ss>s` and exits 0 only if `599 ≤ n ≤ 601` and `|audio − 10| ≤ 1/60`.
  - Acceptance: `node harness.mjs` exits 0 and writes `results/sample-win32.mp4`;
    `node spikes/282-webcodecs-matrix/verify-sample.mjs spikes/282-webcodecs-matrix/results/sample-win32.mp4`
    prints `frames=600 audio=10.00s` (±1 frame) and exits 0.
- **D3 — Linux run and RESULT.md.** Files: new `spikes/282-webcodecs-matrix/run-linux.mjs`,
  `results/matrix-linux.json`, new `RESULT.md` (shape of `spikes/186-cinema-overlay/RESULT.md`).
  - `run-linux.mjs`: `docker run --rm --shm-size=2g` of `node:22-bookworm` with the spike folder
    copied in (not the host `node_modules`); inside: `apt-get` xvfb + Electron's runtime libs,
    `npm install --no-save electron@<version from root node_modules/electron/package.json>`,
    `npm install`, `xvfb-run -a node harness.mjs --platform-label=linux`; copies `results/` back.
    Exits non-zero when Docker is missing or the harness fails.
  - `RESULT.md`: Electron/Chrome versions; a table per platform of supported video configs
    (codec × resolution × fps × acceleration) and audio/Mediabunny results; AC5 verdict for both
    attempts; GPU-process crashes per `hardwareAcceleration` on Linux with the note that the
    container has no VA-API, so #55456 is not reproducible there; sample file size and the
    `verify-sample.mjs` output; `## Recommendation`: encoder tier (1/2/3, concept §10.4) per
    platform, `hardwareAcceleration` per platform, whether software H.264 (OpenH264) is present,
    and ffmpeg ([[313]]) P2 or P3 by the rule in this story's Decisions (P3 if tiers 1–2 cover
    H.264 + AAC on both platforms, else P2 naming the uncovered platform).
  - Acceptance: `node spikes/282-webcodecs-matrix/run-linux.mjs` exits 0 and writes
    `results/matrix-linux.json`; `RESULT.md` holds every section above; root `npm run format:check`
    green (run `npx prettier --write spikes/282-webcodecs-matrix` after the runs).

## Model Hints

All three deliverables run on the default tier: a throwaway spike with no production code, and the
one subtle check (AC5) is specified down to the sampled pixels.

Review: → default

## Acceptance Tests

The spike has no vitest or flow tests (it ships no code); its checks are the scripts' exit codes,
run by `/build` as the D's acceptance.

- AC1 → spike run `cd spikes/282-webcodecs-matrix && npm install && node harness.mjs` › exits 0,
  writes `results/matrix-win32.json` (D1)
- AC2 → same run › `main.mjs` validation "60 video entries with boolean `supported`" (D1)
- AC3 → same run › validation "2 audio entries" (D1)
- AC4 → same run › validation "mediabunny `aacBefore`/`aacAfter` present" (D1)
- AC5 → same run › validation "capture `sameTask` and `afterAwait` recorded"; the pixel match is
  the ±8 quadrant check in `probe.js` (D1)
- AC6 → same run › validation "`sample` present" and `results/sample-win32.mp4` exists (D2)
- AC7 → `node spikes/282-webcodecs-matrix/verify-sample.mjs spikes/282-webcodecs-matrix/results/sample-win32.mp4`
  › prints `frames=600 audio=10.00s`, exits 0 (D2)
- AC8 → `node spikes/282-webcodecs-matrix/run-linux.mjs` › exits 0, writes
  `results/matrix-linux.json` with the `child-process-gone` record (D3); **manual residue:** the
  #55456 crash itself needs a Linux desktop with a VA-API GPU, which neither the container nor this
  machine has.
- AC9 → **manual residue:** a recommendation is a judgement, not a behaviour; the default review
  checks `RESULT.md` `## Recommendation` against the matrices (D3).
- AC10 → `git diff --stat package.json package-lock.json` at the repo root prints nothing (D1).
- Expected residue (story text) → **manual residue:** `results/sample-win32.mp4` plays smoothly in
  VLC and the Windows media player with an audible sine — playback quality needs eyes and ears.

## Done

Spike delivered in `spikes/282-webcodecs-matrix/`: harness + probe (60-entry video matrix, audio, Mediabunny AAC before/after,
`VideoFrame` capture), a 10 s 60 fps + sine MP4 via `StreamTarget`, `verify-sample.mjs`, a Docker/xvfb Linux run and `RESULT.md`
(Windows tier 1, Linux tier 2 with the AAC polyfill, ffmpeg [[313]] recommended P3). Electron 43.8.4 / Chrome 150.

Change type: docs

Commit message: `282: spike WebCodecs/Mediabunny matrix (win32 + linux), sample mp4, RESULT.md recommendation`

Verification (narrow gate; no `test-story`/`e2e-story` line applies, the spike has no flows): `node harness.mjs` exit 0 (AC1-AC6),
`verify-sample.mjs` on win32 and linux samples `frames=600 audio=10.01s` (AC7, within 1/60 s), `run-linux.mjs` exit 0 with
`matrix-linux.json` (AC8), `git diff --stat package.json package-lock.json` empty (AC10), `npm run build`, `typecheck`, `lint`,
`prettier --check spikes/282-webcodecs-matrix` and `npx vitest run --changed HEAD` (7781 passed) green. Review (default): PASS, findings fixed.
AC9 checked by the reviewer against both matrices. Root `npm run format:check` has pre-existing failures outside the spike.
Manual residue: sample plays in VLC/Windows player with audible tone; #55456 crash needs a Linux desktop with VA-API.

Findings and decisions:

- `capture.afterAwait` is blank on both platforms (`preserveDrawingBuffer: false`): capture must happen in the drawing task.
- `ELECTRON_RUN_AS_NODE` is removed from the child env by `harness.mjs`; probe.html carries an import map for the Mediabunny bundles.
- The container run needs `--no-sandbox` and SwiftShader WebGL, passed only via `SPIKE282_ELECTRON_ARGS`; the harness's validation checks counts and types, not values.
- #55456 is not exercised (no VA-API, only `isConfigSupported` ran per acceleration value); stated in `RESULT.md`.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 6
