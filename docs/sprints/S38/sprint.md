---
sprint: S38
status: in-progress # planned | in-progress | done
branch: dev # set by /sprint
milestone: 12.1 — Toolchain and spikes; 12.2 — Playback in the canvas
---

# Sprint S38 — A demo plays inside the launcher

## Goal

`npm run engine:build` builds Q2PRO as WebAssembly reproducibly, and in integrated mode a `.dm2` plays in the Demos view's stage as a picture in the launcher window, without engine overlays. The user switches between engine and integrated mode. Spikes settle the engine base, determinism, the WebCodecs matrix and audio pulling for the later increments.

## Stories (in build order)

<!-- Concept increments 1 and 2 (281–291). Spikes come first: each writes spikes/<id>-<slug>/RESULT.md and decides whether the dependent stories hold. -->

- [x] 281 — The engine builds reproducibly as WebAssembly
- [x] 283 — Test data: a shareware data cache and test demos
- [ ] 282 — Spike: what WebCodecs and Mediabunny can encode in Electron 43
- [ ] 284 — Spike: a demo frame renders in the Electron renderer
- [ ] 285 — Spike: the engine steps deterministically
- [ ] 286 — Spike: audio is pulled from the DMA mixer per step
- [ ] 288 — The launcher serves the engine and allows WebAssembly
- [ ] 287 — I choose between engine and integrated playback
- [ ] 289 — Main serves game data to the engine
- [ ] 290 — The engine canvas sits on the demo stage
- [ ] 291 — A demo plays inside the launcher

## Notes

- Deliberately left for S39 and later: one player API and sound (292–297), export (298–310), fallbacks and MVD2 (311–315), packaging and licences (316–319).
- 281 and 284 can end in "not viable" (`-O2` fails validation; renderer RAM or load time). Then 288–291 are re-cut from the spike's `RESULT.md` before they are built, and the sprint closes on the spikes.
- 281 decides the engine base (open point 2) and 289 the 1 GiB game-data ceiling (open point 8); both are resolved in `/sprint`'s clarification round.
- Open points 4 (default mode) and 5 (legal clarification) do not block this sprint: engine mode stays the default, and nothing here ships the ffmpeg or AAC-polyfill tiers.

## Regression gate

<!-- Filled by `/sprint` phase 2b: the commands run, minutes taken, result, commit, and a verdict per failure. -->
