---
id: 281
title: The engine builds reproducibly as WebAssembly
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to build the Q2PRO engine as WebAssembly with one command,
reproducibly, so that every later story of the integrated demo player builds on the same pinned
engine artefact and nobody needs a local Emscripten installation.

The build also settles which engine source the port is based on. Upstream `skullernet/q2pro` is
gone; the MashedD fork has a working Emscripten target, and the `q2pro/q2pro` mirror is the
reference for upstream behaviour.

Context:

- [concept §8.1](../concepts/integrated-demo-player.md) (source base and build), [concept §8.7](../concepts/integrated-demo-player.md) (switched-off parts), risks R1 (`-O2`
  fails WASM validation) and R11 (base fork) in [concept §11](../concepts/integrated-demo-player.md).
- Existing web target in MashedD/q2pro @ `3139866`: `build-web.sh`, `cross-web.txt`, the `web`
  branch of `meson.build`, `src/unix/video/emscripten.c`. Read-only clones under
  `vendor/q2pro-mashed/` and `vendor/q2pro/` (not committed).
- Docker is already a prerequisite in this repo (act, `verify:release`, `.claude/ai-scrum.md`);
  `scripts/fetch-7za.mjs` is the style reference for fetch/build scripts.
- Layout: `engine/UPSTREAM` (repo + commit), `engine/patches/*.patch`, `engine/cross/emscripten.ini`,
  `engine/docker/Dockerfile` (pinned `emscripten/emsdk` image, plus meson and ninja),
  `scripts/engine/build.mjs`, `package.json` script `engine:build`. `.engine-build/` and
  `resources/engine/*.js|*.wasm` are gitignored; the engine source itself is never committed.
- First patches: web branch of `meson.build` without `q2proded`, without the game library and
  without `MAIN_MODULE`; `software-sound` allowed for `web` (`s_enable 0` until [[286]]); no
  `dependency('threads')` on web; link flags per concept §8.1 (`MODULARIZE`, `EXPORT_ES6`,
  `ENVIRONMENT=web`).
- Spike part (timebox 1 day of the 2-day story): try `-O2` first; on validation errors narrow down
  via `-O1` and flag variants.
- Not in scope: loading in Electron ([[284]]), audio driver ([[286]]), C bridge ([[294]]), a
  release/CI job ([[316]]), any change under `src/`.
- Depends on: —

## Acceptance Criteria

- [x] **AC1** — On a fresh clone with Docker, `npm run engine:build` exits 0 and writes
      `resources/engine/q2pro.js` and `resources/engine/q2pro.wasm`.
- [x] **AC2** — The build checks out exactly the commit named in `engine/UPSTREAM`
      (`git rev-parse HEAD` in the build directory equals it).
- [x] **AC3** — `engine/patches/*.patch` are applied in order; a patch that does not apply ends
      the build with a non-zero exit code.
- [x] **AC4** — With the Docker image pinned by tag/digest, two consecutive builds produce the same
      SHA-256 for `q2pro.wasm`.
- [x] **AC5** — `npm run engine:build -- --check-config` shows `libcurl=disabled` and
      `openal=disabled` and lists no `q2proded` and no `game*` target.
- [x] **AC6** — The built artefact contains no dedicated server, no game library, no curl and no
      OpenAL symbols (checked by a script over `wasm-objdump -x`).
- [x] **AC7** — `npm run engine:build -- --opt=O0|O1|O2` selects the optimisation level.
- [x] **AC8** — `spikes/281-engine-build/RESULT.md` records whether `-O2` (without `ASSERTIONS`)
      builds and validates; if not, the error, the smallest working level and a recommendation.
- [x] **AC9** — `RESULT.md` gives a reasoned recommendation for the base (MashedD fork vs.
      upstream mirror) with the patch-series size in lines for both, plus build time and WASM
      size per `-O` level.
- [x] **AC10** — After a build, `git status --short` shows no file under `resources/engine/` or
      `.engine-build/`; `npm run lint` and `npm run typecheck` are green.

## Open Questions

- ~~Which engine base does the project adopt — the MashedD fork (active, has the web target) or the
  upstream mirror — and are patches offered back to MashedD? (decided from AC9's recommendation)~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Which engine base does the project adopt: the MashedD fork; patches are not offered back (they stay local to this repo).
- AC9 still compares both bases, but the comparison is measured, not built twice: the upstream
  figure is our series plus mashed's web-target delta against `q2pro/q2pro` — the base is decided,
  so a second full port would be spent effort.
- Clone, patch and build all run **inside the container** at a fixed path (`/engine-build`, the
  bind-mounted `.engine-build/`) — Linux line endings and an identical absolute path on every run
  are what make the patches apply on a Windows host and the output byte-stable.
- `SOURCE_DATE_EPOCH` is set to the pinned commit's committer time — the source uses `__DATE__`
  (`src/common/common.c:133`), which would otherwise change the artefact every day while two
  same-day builds still hash equal.
- The build links with `--profiling-funcs` so the `name` section survives `-O2` — without names
  the AC6 symbol check would pass vacuously; stripping is the optimized build's business ([[298]]).
- Builds that need Docker are not part of `npm test` (test-gates: no network/real services in a
  blocking lane, 6-minute budget); they run as `npm run engine:verify` in a new local, non-blocking
  `engine` lane row in CLAUDE.md, which concept §13's `test:engine` ([[304]]) later extends.
- No CHANGELOG entry — nothing user-visible changes until the engine is loaded ([[284]]).
- No systems doc: the engine is not a system of the app yet; the concept doc stays the reference
  until [[316]]–[[319]].

## Plan

Pure logic in testable Node modules, the Docker build as thin glue, a local verifier that runs the
real build, the spike write-up last.

1. **Helpers + unit tests (D1)** — `scripts/engine/lib.mjs`: read `engine/UPSTREAM`, order the
   patches, parse `--opt`/`--check-config`/`--patches-dir`, render the config report from
   `meson introspect` JSON, judge `wasm-objdump -x` output against a forbidden/required symbol
   table. Unit-tested in `npm test`; no Docker.
2. **Container build (D2)** — `engine/UPSTREAM` (MashedD URL + full sha of `3139866`),
   `engine/docker/Dockerfile` (`emscripten/emsdk` pinned by digest, plus git, meson, ninja,
   wabt), `engine/docker/build.sh` (fetch exact commit, hard reset + clean, apply patches in order
   with `set -e`, meson setup/compile, copy `q2pro.js`/`.wasm` out), `engine/cross/emscripten.ini`,
   `scripts/engine/build.mjs` (docker check, image build, run, report size + elapsed),
   `engine:build` script, ignore entries in `.gitignore`, `.prettierignore`, `.oxlintrc.json`.
3. **Patch series + `-O` spike (D3)** — `engine/patches/0001-…` onwards: web branch without game
   library, `MAIN_MODULE`, hard-coded `-O0`/`ASSERTIONS`; `software-sound` allowed on web; link
   flags per concept §8.1; meson options per §8.1/§8.7 in `build.sh`. Try `-O2`, narrow down on
   validation errors; logs into `spikes/281-engine-build/results/`.
4. **Verifier + lane (D4)** — `scripts/engine/verify.mjs` (`engine:verify`) runs the real build and
   checks AC1–AC7 and AC10; CLAUDE.md gets the `engine` lane row.
5. **Spike result (D5)** — `spikes/281-engine-build/RESULT.md` from D3/D4 logs, plus a docs-lane
   test that recomputes the patch-series line count and checks the required content.

Order: D1 → D2 → D3 → D4 → D5. Nothing under `src/` changes.

## Deliverables

- **D1 — Engine build helpers.** New `scripts/engine/lib.mjs` (ESM, no dependencies; style
  reference `scripts/fetch-7za.mjs`) exporting pure functions:
  `readUpstream(text)` → `{ repo, commit }` (rejects a non-40-hex commit or a missing line);
  `orderPatches(names)` → the `*.patch` names sorted by their `NNNN-` prefix, rejecting duplicates
  and non-matching names; `parseArgs(argv)` → `{ opt: 'O0'|'O1'|'O2' (default 'O2'), checkConfig,
patchesDir }`, rejecting any other `--opt` value; `configReport(buildoptionsJson, targetsJson)` →
  lines `libcurl=disabled`, `openal=disabled`, … for the §8.1 options, then `target: <name>` per
  target; `checkSymbols(objdumpText, rules)` → `{ ok, forbidden: [...], missingRequired: [...] }`
  reading function/import/export names from `wasm-objdump -x` text. `rules` has `forbidden` regexes
  (game library, curl, OpenAL, dedicated-only — each with a source-pointer comment, e.g.
  `GetGameAPI`, `^curl_`, `^al[A-Z]`/`^alc[A-Z]`) and `required` names (e.g. `main`,
  `Com_Printf`, `CL_Init`) as the positive control: **output without a name section or without
  the required names is a failure, never a pass**. Tests in `scripts/engine/lib.test.mjs` (picked
  up by `npm test`), using a small trimmed `wasm-objdump -x` text fixture inline.
- **D2 — Reproducible container build.** Files: `engine/UPSTREAM` (two lines:
  `https://github.com/MashedD/q2pro.git` and the full sha of `3139866`, from
  `git -C vendor/q2pro-mashed rev-parse 3139866`), `engine/docker/Dockerfile`
  (`FROM emscripten/emsdk:<tag>@sha256:<digest>`, plus git, meson, ninja, wabt — versions pinned),
  `engine/docker/build.sh` (`set -Eeuo pipefail`; in `/engine-build/src`: fetch exactly the commit,
  `git reset --hard` + `git clean -fdx`, apply every patch from the mounted patches dir in
  `orderPatches` order with `git apply` — first failure exits non-zero; `meson setup` with
  `--cross-file` and `-Doptimization` from `--opt`; `ninja`; copy to `/engine-build/out/`),
  `engine/cross/emscripten.ini` (from mashed's `cross-web.txt`), `scripts/engine/build.mjs`
  (uses D1's helpers; fails with a clear message if `docker` is missing; builds the image; runs the
  container with `.engine-build/` mounted at `/engine-build` and `engine/patches/` (or
  `--patches-dir`) read-only; `SOURCE_DATE_EPOCH` = commit time; on success copies `q2pro.js` and
  `q2pro.wasm` to `resources/engine/` and prints `wasm bytes` and `elapsed`; on failure writes
  nothing to `resources/engine/`). `package.json`: `"engine:build": "node scripts/engine/build.mjs"`.
  Ignore `.engine-build/`, `resources/engine/*.js`, `resources/engine/*.wasm` in `.gitignore`, and
  `.engine-build/` in `.prettierignore` and `.oxlintrc.json` `ignorePatterns` (next to `vendor/`).
  Acceptance: with only mashed's existing web branch, `npm run engine:build -- --opt=O0` writes
  both artefacts (proved by D4's verifier).
- **D3 — Patch series and the `-O` spike.** `engine/patches/0001-*.patch` onward, made with
  `git format-patch` against the pinned commit (one concern per patch): the `web` branch of
  `meson.build` builds no `game*` target, no `q2proded`, no `MAIN_MODULE`/`SIDE_MODULE`, drops the
  `side_module_imports` export list, the hard-coded `-O0`/`-fPIC` and `-sASSERTIONS`;
  `software-sound` is allowed for `web` (sound stays `s_enable 0` until [[286]]); no
  `dependency('threads')` on web; link flags `-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2
-sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web
-sFORCE_FILESYSTEM=1 --profiling-funcs`, `EXPORTED_RUNTIME_METHODS` `FS,cwrap,HEAPU8,HEAP16`,
  `_main` exported. `engine/docker/build.sh` passes the §8.1 meson options
  (`-Dlibcurl=disabled -Dopenal=disabled -Dsdl2=disabled -Dx11=disabled -Dwayland=disabled
-Davcodec=disabled -Dlibjpeg=disabled -Dsystem-console=false -Dclient-gtv=false
-Dclient-ui=false -Dmvd-server=false -Dsave-games=false -Dtests=false -Dzlib=enabled
-Dlibpng=enabled -Dsoftware-sound=enabled`), and `--check-config` stops after `meson setup` and
  prints D1's `configReport` over `meson introspect --buildoptions`/`--targets`. Spike (timebox one
  day): build `-O2` first; on a WebAssembly validation error narrow down via `-O1` and flag
  variants (`-sBINARYEN_*`, `-fno-*`). Store the build logs (incl. elapsed time and wasm size per
  level, and the validation error verbatim if any) in `spikes/281-engine-build/results/`. Default
  `--opt` stays `O2` if it validates, otherwise the smallest working level (update D1's default
  and its test then).
- **D4 — Real-build verifier and the `engine` lane.** New `scripts/engine/verify.mjs`
  (`"engine:verify": "node scripts/engine/verify.mjs"`), needing Docker, printing one PASS/FAIL line
  per check and exiting non-zero on any FAIL: (1) removes `.engine-build/` and
  `resources/engine/` artefacts, runs `engine:build`, expects exit 0 and both files; (2)
  `git -C .engine-build/src rev-parse HEAD` equals `engine/UPSTREAM`'s commit; (3) runs the build
  with `--patches-dir` pointing at a temp copy of the series plus a `9999-broken.patch` that cannot
  apply, expects non-zero and no new artefact; (4) builds again and compares SHA-256 of
  `q2pro.wasm` with run 1, and checks the `.wasm`/`.js` do not contain today's `__DATE__` string
  (`Mmm dd yyyy`); (5) `--check-config` output contains `libcurl=disabled`, `openal=disabled` and
  no `q2proded`/`game` target; (6) `wasm-objdump -x` (inside the image) over the artefact, judged
  by D1's `checkSymbols`; (7) `--opt=O1` and `--opt=O0` each show their level in `--check-config`
  (`optimization=1` / `0`) and produce a wasm whose SHA-256 differs from O2's; (8)
  `git status --short` lists nothing under `resources/engine/` or `.engine-build/`. Its run log goes
  to `spikes/281-engine-build/results/verify.log`. Add a row to the `## Test lanes` table in
  `CLAUDE.md`: lane `engine`, trigger "local, manual (needs Docker)", command
  `npm run engine:verify`, OS Windows, Blocks "No — local; joins `verify:release` with [[304]]".
  Run `npm run check:docs` (the lane-map test in `scripts/project-docs.docs.test.mjs` checks the
  row's shape and that the npm script exists).
- **D5 — Spike result.** `spikes/281-engine-build/RESULT.md` (shape of
  `spikes/185-control-latency/RESULT.md`): whether `-O2` without `ASSERTIONS` builds and validates;
  if not, the error, the smallest working level and a recommendation; a table per `-O` level with
  build time and wasm bytes (from D3/D4 logs); the base recommendation with the patch-series size
  in lines for MashedD (`engine/patches/*.patch` total) and for the upstream mirror (our series +
  mashed's web-target diff against `vendor/q2pro`, method stated), consistent with the user's
  decision for MashedD. Plus `scripts/engine/spike-result.docs.test.mjs` (docs lane): RESULT.md
  states an `-O2` verdict, has a row for each of O0/O1/O2 with time and size, and its MashedD
  patch-line figure equals the line count recomputed from `engine/patches/*.patch`.

## Model Hints

- D3 → deliverable-hard: it carries risk R1 — the meson web-branch patches and link flags must
  build and validate at `-O2` (or document why not) without breaking the client/server split the
  later MVD2 path ([[311]]) needs, and a wrong flag (e.g. leaving `MAIN_MODULE` or `-O0`) still
  produces a loadable artefact that only fails later in [[284]]/[[298]].
- Review: → default

## Acceptance Tests

- AC1 → local `engine` lane `scripts/engine/verify.mjs` › "a clean build writes q2pro.js and
  q2pro.wasm"
- AC2 → local `engine` lane `scripts/engine/verify.mjs` › "the build checks out the UPSTREAM commit"
- AC3 → unit `scripts/engine/lib.test.mjs` › "patches apply in their numbered order" and "a
  malformed patch name is rejected"; local `scripts/engine/verify.mjs` › "a patch that does not
  apply fails the build and writes no artefact"
- AC4 → local `scripts/engine/verify.mjs` › "two builds produce the same wasm hash" (incl. the
  `__DATE__` guard)
- AC5 → unit `scripts/engine/lib.test.mjs` › "the config report lists disabled features and every
  target"; local `scripts/engine/verify.mjs` › "check-config shows curl and openal disabled and no
  server or game target"
- AC6 → unit `scripts/engine/lib.test.mjs` › "a forbidden symbol fails the check" and "output
  without the required names fails the check"; local `scripts/engine/verify.mjs` › "the artefact
  carries no server, game, curl or openal symbols"
- AC7 → unit `scripts/engine/lib.test.mjs` › "--opt accepts O0, O1, O2 and rejects anything
  else"; local `scripts/engine/verify.mjs` › "each optimisation level builds its own artefact"
- AC8 → docs `scripts/engine/spike-result.docs.test.mjs` › "the spike result states the -O2
  verdict"
- AC9 → docs `scripts/engine/spike-result.docs.test.mjs` › "the spike result's patch size matches
  the series and covers every level"
- AC10 → local `scripts/engine/verify.mjs` › "a build leaves the working tree clean"; plus the
  normal `npm run lint` / `npm run typecheck` gates of `/build`
- Gap (named for the sprint review): the real-build checks need Docker, network and minutes of
  build time, so they live in the local `engine` lane, not in `npm test`; `/build` runs
  `npm run engine:verify` for this story and commits its log.

## Done

Q2PRO builds as WebAssembly in a pinned container with `npm run engine:build` (O2 default, O0/O1 selectable): MashedD/q2pro @ 3139866 plus six local patches (`engine/patches/`), reproducible wasm hash, local `engine:verify` lane, spike result in `spikes/281-engine-build/RESULT.md`. Nothing under `src/` changed.

Change type: build
Commit message: `281: engine builds as WebAssembly in a pinned container (engine:build, engine:verify, spike result)`

Verification (narrow gate): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` green (7764 passed); `npm run check:docs` green (71); `npm run engine:verify` 8/8 PASS (~5.6 min). No e2e mapped. Review stage 1 (default): PASS with findings; fixed in one cycle (shared helpers, broken-patch check asserts the failing patch name, host passes the validated patch order to the container, redundant test dropped, import-name forbidden-symbol test added), re-verified with unit, docs, lint, typecheck and `engine:verify --only=patch|clean`.
AC -> test: AC1/2/4/10 verify.mjs checks; AC3/5/6/7 lib.test.mjs plus verify.mjs checks; AC8/AC9 spike-result.docs.test.mjs — all passed. No manual residue.

Decisions:

- O2 validates: the O1/O2 failure was meson's default `-fPIC` on the zlib-ng/libpng subprojects, fixed with `-Db_staticpic=false` in `build.sh` (no patch needed). Default `--opt` stays O2. wasm bytes O0 2495042 / O1 1079538 / O2 1013566.
- `SV_InitGameProgs` is listen-server code the client legitimately contains, so it is not in the forbidden symbol rules; `Sys_RunConsole`, `GetGameAPI`, `curl_*`, `al*`/`alc*` are. The required name is `Com_LPrintf` (`Com_Printf` is a macro).
- `build.sh` builds only the `q2pro.js` target (libpng's `pngtest` fails emscripten finalize); the image installs wabt 1.0.36 from a sha256-checked tarball, meson/ninja pinned via pip; apt git/pip are not version-pinned (the image is pinned by base digest and a Dockerfile-hash tag).
- `.gitignore` gained `!spikes/*/results/*.log` so the spike logs can be committed.
- Upstream-mirror patch size in RESULT.md (about 1322 lines) is an upper-bound estimate, method stated there.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 9
