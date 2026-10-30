# Sprint S38 review

**Goal:** `npm run engine:build` builds Q2PRO as WebAssembly reproducibly, and in integrated mode a `.dm2` plays in the Demos view's stage without engine overlays; spikes settle base, determinism, the WebCodecs matrix and audio pulling.

Run on `dev`, 11/11 stories done, regression gate green with no fixes needed. Nothing is pushed.

## Overview

| Story                                         | Status | Commit                                                                               |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| 281 Engine builds reproducibly as WebAssembly | done   | b48d8abc `engine:build`, `engine:verify`, patches 0001–0006, O2 builds and validates |
| 283 Shareware data cache and test demos       | done   | f0433479 `engine:data`, `move-fire.dm2` recorded with native Q2PRO                   |
| 282 Spike: WebCodecs and Mediabunny           | done   | a3cc048c Windows tier 1, Linux tier 2, ffmpeg fallback P3                            |
| 284 Spike: a demo frame renders               | done   | e1590e45 engine runs under `'wasm-unsafe-eval'`, 60 fps, 0 CSP violations            |
| 285 Spike: deterministic stepping             | done   | 9e2f4abb `q2l_step` (patch 0007), stable per renderer                                |
| 286 Spike: DMA audio pull                     | done   | 3bd8eade `snddma_web` (patch 0008), capture hashes identical                         |
| 288 Launcher serves the engine                | done   | 683d793c `q2launcher://app/engine/`, CSP allows WebAssembly                          |
| 287 Engine or integrated playback             | done   | b29c470e persisted mode, switch in Settings and Demos view                           |
| 289 Main serves game data                     | done   | 08c9131e token + pinned-realpath manifest, `/engine-data/`                           |
| 290 Engine canvas on the demo stage           | done   | 28259afa patch 0009, loader, `EngineCanvas`, fake-engine harness                     |
| 291 A demo plays inside the launcher          | done   | 59f69962 patch 0010, integrated session, play/stop routing                           |

## Implemented stories

- **281** A pinned emsdk container builds the engine from the MashedD fork plus a local patch series; O2 validates (1.0 MB wasm) and repeated builds hash equal. Base decision (user): MashedD, patches not offered back.
- **283** `npm run engine:data` fetches the shareware pak into a hash-locked cache outside the repo; a 29.5 s native-recorded demo ships under `tests/engine/`.
- **282/284/285/286** All four spikes came back viable; each has a `RESULT.md` under `spikes/`.
- **288/289** Engine files and game data are served by main from an allowlist and per-session tokens; the 1 GiB cap (user decision) is a constant.
- **287/290/291** A demo plays in the stage canvas in integrated mode (experimental); engine mode stays the default and MVD2 stays engine-only.

## Findings & decisions

- **User decisions in this run:** engine base = MashedD fork without upstreaming (281); game-data ceiling 1 GiB (289).
- **For the user:** spike 284 measured renderer RSS at about 2.2× the data size, so the 1 GiB cap extrapolates to about 2.3 GiB RSS. The roadmap carries it as a follow-up; the cap stays as decided.
- **Spike verdicts for 12.3+:** goldens are per renderer (SwiftShader and GPU differ in 20/20 frames), the seed is required, real-time audio uses the MessagePort transport (16–24 underruns/min, cause not isolated), `com_eventTime` needs stepping in story 300, and the ffmpeg fallback (313) drops to P3.
- **Plan gap:** the shareware pak0 has no `base1`; the test demo is on `demo1`.
- **Cross-story:** 291 narrowed 290's AC1 (canvas only while an integrated session exists); recorded in both stories.
- **Environment trap:** `npm run build` yields a production `out/` without the mods and assets modules, so `ui:verify` reported four unreachable screens until `build:dev`. Not a regression; build agents hit it three times.
- **Late fixes in the gate phase:** `check:docs` failed three docs tests (replays-module.md over 150 lines and missing the new handler names, spike 281's patch-size figure) plus broken concept links in `done/` stories; fixed in the docs, tests untouched.
- **Unfixed findings** are `docs/TECH-DEBT.md` rows TD-070 to TD-078 (patch 0009's invalid runtime-method exports, dead mouse-look and context-loss recovery, the realpath-swap hole, undeclared esbuild, patch 0008 side effects, unpinned build image, 283 test gaps, a >1 GiB flow write, 287 test gaps) and one roadmap follow-up (the cap).
- **Named gap:** the Docker-based engine lane (`engine:build`, `engine:verify`) is local and non-blocking; no CI lane builds the engine before story 316. It is in the CLAUDE.md lanes table.
- **Not run:** the advisory Linux check (`verify:linux`) was not run in this sprint.
- **Module docs:** stories 287, 289, 290 and 291 each touched `docs/systems/replays-module.md`; no misses.
- **Changelog:** one Added line (287) covers the feature; 288 is `chore`, 289–291 carry no line by their specs. No late additions, no published section changed.
- **Trail:** timestamps were monotonic; no typed lines found.

## Blocked / open

Nothing blocked. Open for the user: whether the 1 GiB cap holds (roadmap follow-up), and merging `dev`.

## Regression gate

Green on `59f69962`: build, `npm test` (7883), `ui:verify` (118/118 on the dev build), `e2e-all` 184/184 flows in 22 min. No failures, attribution or quarantine. Details in `sprint.md`.

## Acceptance

Every AC was proven by the test or harness command named in its story's Done section (`docs/requirements/done/281…291`); the spikes by their harness exit codes and committed result JSON. Criteria covered a level below the real surface: 291's AC5 (console output) holds only against the fake engine, with the real-engine check falling to story 304's lane; 290's flow uses a fake engine, so the real engine's picture on the stage is manual residue. Manual residue, each with its reason, is in [testplan.md](testplan.md).

## Tier record

| Story     | Ds     | hard Ds | Review                     | Cycles | Agents | Build min |
| --------- | ------ | ------- | -------------------------- | ------ | ------ | --------- |
| 281       | 5      | 1       | default                    | 1      | 9      | 66        |
| 283       | 2      | 1       | default                    | 1      | 7      | 11        |
| 282       | 3      | 0       | default                    | 1      | 6      | 12        |
| 284       | 3      | 1       | default                    | 1      | 7      | 30        |
| 285       | 3      | 1       | default+hard               | 2      | 6      | 16        |
| 286       | 4      | 1       | default                    | 1      | 9      | 49        |
| 288       | 3      | 0       | default                    | 1      | 7      | 17        |
| 287       | 5      | 1       | default                    | 1      | 8      | 34        |
| 289       | 3      | 1       | default+hard               | 2      | 8      | 17        |
| 290       | 7      | 1       | default                    | 1      | 13     | 53        |
| 291       | 6      | 1       | default                    | 1      | 12     | 64        |
| **Total** | **44** | **9**   | 2 of 11 with a hard review | 14     | 92     | **369**   |

The hard reviews: 285's passed with wording fixes only; 289's traced the check-then-swap hole and found that a swap of the pinned path's parent is still followed (TD-072), a low-severity point the default review had not named.
