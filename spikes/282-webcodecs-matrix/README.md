# Spike 282: WebCodecs encoder matrix

Throwaway spike for story 282, not imported by `src/` and not wired into any build or test. It runs the repo's Electron against `VideoEncoder`/`AudioEncoder` `isConfigSupported` for H.264, VP9 and AV1 at 720p/1080p, 30/60 fps and each hardware-acceleration preference, checks Mediabunny's AAC support before and after `registerAacEncoder()`, and tests whether a WebGL2 canvas can be captured into a `VideoFrame` with real pixels. Run `npm install` here once, then `node harness.mjs [--platform-label=<label>]` (label defaults to `process.platform`); it writes `results/matrix-<label>.json`, validates it, and exits non-zero if any probe entry is missing.

`verify-sample.mjs <file>` reads the spike's sample MP4 back with Mediabunny and exits 1 if the frame count or audio duration has a gap. `run-linux.mjs` runs the matrix on Linux inside a `node:22-bookworm` container under Xvfb and copies `results/` back (needs Docker).
