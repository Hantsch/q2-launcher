# Spike 286: audio pulled from the DMA mixer

Throwaway. Checks that the engine's web sound driver (patch 0008) mixes into a ring the host pulls
with `q2l_audio_take`, that every `q2l_step` yields exactly `48 * ms` frames, and that the PCM is
reproducible.

## Run

    npm run engine:build            # once, after any change to engine/patches
    node spikes/286-dma-audio-pull/harness.mjs --mode=capture --frames=600 --fps=60
    node spikes/286-dma-audio-pull/harness.mjs --mode=capture --runs=2 --seed=1

Options: `--frames=N`, `--fps=30|60`, `--runs=N`, `--seed=N`.

## Results (`results/`)

- `counts.json`: steps, expected and got frames per step, mismatches, nonZeroSamples.
- `pcm-hashes.json`: SHA-256 of each run's PCM and whether they are equal.
- `capture-run1.wav`: the PCM of the first run.

## Real time (AudioWorklet)

    node spikes/286-dma-audio-pull/harness.mjs --mode=realtime --seconds=60
    node spikes/286-dma-audio-pull/harness.mjs --mode=realtime --seconds=60 --transport=sab

The engine runs on its own main loop (capture off, default `s_mixahead`); a pump on every animation
frame calls `q2l_audio_consumed` with the worklet's consumed frames and `q2l_audio_take`, and hands
1024-frame blocks to `worklet.js` over the port (default) or a SharedArrayBuffer ring (`sab`, which
serves COOP `same-origin` + COEP `require-corp` and exits 1 naming the reason if
`crossOriginIsolated` is false). The window is focused, which activates the client; the demo loops
through `+set nextserver "demo move-fire"`. No CSP change: `script-src 'self'` covers the worklet.

Results: `results/realtime.json` (`realtime-sab.json` for sab): transport, seconds, underruns,
underrunsPerMinute, latencyMs, nonSilentBlocks, crossOriginIsolated. Exit 0 iff nonSilentBlocks > 0.
