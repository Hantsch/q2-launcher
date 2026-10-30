# Story 282 spike — result

Run on 2026-10-30 (one run per platform, one machine). Both runs use **Electron 43.8.4 / Chrome
150.0.7871.250** (`matrix-win32.json`, `matrix-linux.json` agree on both). win32: Windows 11 native.
linux: `node:22-bookworm` container under Xvfb, run by `run-linux.mjs`, Electron installed in the
container at the repo's version, with `--no-sandbox` and software WebGL (`--use-angle=swiftshader`)
passed only for the container (no GPU, so WebGL2 is otherwise blocklisted: the first Linux run failed
with "no webgl2 context"). The launcher's `webPreferences` (`sandbox: true`) are unchanged in the
probe. Evidence: `results/matrix-win32.json`, `results/matrix-linux.json`; samples
`results/sample-<label>.mp4` are gitignored. Harness: `harness.mjs`, `main.mjs`, `probe.js`,
`run-linux.mjs`, `verify-sample.mjs`.

## Verdict

WebCodecs delivers H.264 at every tested size and rate on both platforms, but AAC only on Windows.
**Windows is tier 1, Linux tier 2** (H.264 from WebCodecs, AAC from `@mediabunny/aac-encoder`).
Tiers 1-2 cover both targets, so the ffmpeg fallback (story 313) drops to P3.

## Video configs (`VideoEncoder.isConfigSupported`)

Y = supported, n = not. Columns are `hardwareAcceleration`: no-preference / prefer-hardware /
prefer-software. Each row holds for both frame rates (30 and 60) unless noted; every one of the 60
entries per platform is in the JSON.

| Codec (string)               | Size        | win32 | linux |
| ---------------------------- | ----------- | ----- | ----- |
| H.264 High `avc1.640028`     | 720p, 1080p | Y Y Y | Y n Y |
| H.264 Main `avc1.4d0028`     | 720p, 1080p | Y Y Y | Y n Y |
| H.264 Baseline `avc1.42e01f` | 720p        | Y Y Y | Y n Y |
| H.264 Baseline `avc1.42e01f` | 1080p       | n n n | n n n |
| VP9 `vp09.00.10.08`          | 720p, 1080p | Y n Y | Y n Y |
| AV1 `av01.0.04M.08`          | 720p, 1080p | Y Y Y | Y n Y |

- 1080p60 H.264 High is supported with no-preference and prefer-software on both platforms; the
  fps-above-30 `false` from electron/electron#55456 does not appear (that issue is VA-API only).
- Baseline `42e01f` at 1080p fails on both platforms and every acceleration. `1f` is level 3.1,
  below 1080p; this is an inference from the codec string, not a probed cause.
- Linux prefer-hardware is `n` for everything: the container has no hardware encoder.

## Audio and Mediabunny

| Check                                      | win32       | linux             |
| ------------------------------------------ | ----------- | ----------------- |
| `AudioEncoder` AAC-LC `mp4a.40.2` 48k/2ch  | supported   | **not supported** |
| `AudioEncoder` Opus 48k/2ch                | supported   | supported         |
| Mediabunny AAC before `registerAacEncoder` | true        | **false**         |
| Mediabunny AAC after `registerAacEncoder`  | true        | true              |
| Sample audio path (`sample.audioPath`)     | `webcodecs` | `polyfill`        |

## AC5 canvas capture (`VideoFrame` from a WebGL2 canvas)

| Attempt      | win32     | linux     |
| ------------ | --------- | --------- |
| `sameTask`   | `pattern` | `pattern` |
| `afterAwait` | `blank`   | `blank`   |

`pattern` means the frame held the drawn pixels; `blank` that it did not. On both platforms a
`VideoFrame` taken in the same task as the draw has real pixels, and one taken after an `await`
is blank (WebGL drawing buffer cleared after compositing). An exporter must capture synchronously
after each draw (or set `preserveDrawingBuffer`, not tested). The Linux result is with SwiftShader
software GL, not a real GPU.

## Sample files

Both are 1280x720 `avc1.640028`, 10 s.

| Platform | Size (bytes) | `verify-sample.mjs` output |
| -------- | ------------ | -------------------------- |
| win32    | 9,270,577    | `frames=600 audio=10.01s`  |
| linux    | 2,919,540    | `frames=600 audio=10.01s`  |

The Linux file is smaller; the JSON does not say why (encoder and bitrate control differ), not
investigated.

## GPU-process crashes

`childProcessGone` is `[]` on win32 and on linux (on Linux only `isConfigSupported` ran for each
`hardwareAcceleration` value; no encode or canvas `VideoFrame` ran with `prefer-hardware` or
`prefer-software`, as the sample's CanvasSource sets no `hardwareAcceleration`, so the #55456 trigger
path was not exercised and "prefer-software avoids it" is untested). **This does not test electron/electron#55456.** The
container has no VA-API, so the crash (canvas `VideoFrame` with a VA-API encoder) cannot happen
there. The harness records `child-process-gone` for the whole run, not per `hardwareAcceleration`
value, so it could not attribute a crash to one setting even if it occurred. Running the matrix on a
Linux desktop with VA-API is a **manual residue** of this spike.

## Recommendation

| Platform | Encoder tier (§10.4)                                    | `hardwareAcceleration`                                                      |
| -------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Windows  | **1**: WebCodecs H.264 High + WebCodecs AAC             | `no-preference` (all 8 H.264 High/Main `no-preference` entries are Y)       |
| Linux    | **2**: WebCodecs H.264 High + `@mediabunny/aac-encoder` | `prefer-software` (as §10.4; measured Y at 1080p60 here, VA-API unmeasured) |

- **Software H.264 is present.** `prefer-software` for `avc1` is Y at High, Main and Baseline-720p on
  both platforms, including 1080p60 High. On
  Windows the JSON cannot show whether that path is OpenH264 or the OS encoder. OpenH264 is
  Constrained Baseline by design, yet High (`640028`) reported Y; whether the produced stream is
  actually High was not inspected.
- **Story 313 (ffmpeg fallback): P3.** Rule: P3 if tiers 1-2 deliver H.264 + AAC on both Windows and
  Linux in the measured matrix. Measured: win32 H.264 + WebCodecs AAC; linux H.264 + polyfill AAC,
  a verified 600-frame, 10.01 s MP4 on each. No platform is uncovered. Caveats: Linux was measured
  without GPU or VA-API, and Windows N (no Media Feature Pack) was not tested.
