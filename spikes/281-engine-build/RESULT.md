# Story 281 D5 - result: the engine builds reproducibly as WebAssembly

Base: MashedD/q2pro @ `313986660942c1c2f98a1fff189bbbe6703fec19` plus `engine/patches/0001..0006`. Logs: `results/`.

**-O2 verdict:** builds and validates

The default build (`npm run engine:build`, `-O2`, no `ASSERTIONS`, no `-g`) exits 0 and `wasm-validate` (wabt 1.0.36) exits 0.
`flags.log`: all 125 compile units and the link use `-O2` only; none has `-fPIC`, `MAIN_MODULE`, `SIDE_MODULE`, `ASSERTIONS` or `-g`.
The `-O0` build has emcc's default `ASSERTIONS=1`; nothing in the build sets it.

Earlier O1/O2 failure (`O1.log`, `O2.log`, earlier variants): `wasm-emscripten-finalize` failed with "Fatal: error in parsing input",
and `wasm-validate` reported type mismatches only in zlib-ng functable stubs. The logs record that meson compiled the static
subprojects (zlib-ng, libpng) with `-fPIC`, and that `-Db_staticpic=false` in `engine/docker/build.sh` made O1 and O2 build and
validate with no zlib-ng option change. The logs do not show which function type caused the parse error.
Two other fixes from the same variants: `-sINITIAL_MEMORY=128MB` (patch 0005, wasm-ld "initial memory too small") and the
`SV_MvdMulticast` stub arity (patch 0006, "too many arguments provided to function-like macro invocation" at `server/send.c:311`).

## Build per optimisation level

Time includes the docker image check and clone.

| level | build time (s) | wasm bytes |
| ----- | -------------- | ---------- |
| O0    | 48             | 2495042    |
| O1    | 45             | 1079538    |
| O2    | 50             | 1013566    |

## Base: MashedD fork vs upstream mirror

**MashedD patch series:** 291 lines (`cat engine/patches/*.patch | wc -l`, 6 patches).

**Upstream mirror patch series:** about 1322 lines = 291 (our series) + 1031 (mashed's web-target diff against `vendor/q2pro`).
Method: files in mashed that mention emscripten, webgl or wasm, `git diff --no-index --numstat` against `vendor/q2pro`, added + removed lines.
That is 609 lines in 10 files that exist in both (`meson.build` 449, `gl.h` 66, `input.c` 23, `qgl.c` 20, `system.c` 17, `video/meson.build` 14,
`refresh.c` 9, `common.c` 7, `hunk.c` 2, `ui.c` 2) plus 422 lines in 3 files that upstream lacks (`build-web.sh` 63, `cross-web.txt` 15, `src/unix/video/emscripten.c` 344).
Caveats: the `meson.build` figure also contains non-web changes of the fork (an upper bound); files without those keywords are not counted
(for example `src/refresh/backend.c`, `gl_backend.h`, which exist only in mashed); `vendor/q2pro-mashed` and `vendor/q2pro` differ in 151 paths in total.

**Recommendation:** MashedD fork is the base. It carries the web target already, so our series is 291 lines against roughly 1322 on
the upstream mirror. The patches stay local to this repo and are not offered back to MashedD.

## Reproducibility, symbols, client/server split

- Reproducible: two O2 builds of the same tree give the identical sha256 `aa92eb37be2b136b918d5a84cf4c78c20c670393f2ae7d5e50554c71e7cd4a1b`, as did an earlier O2 build; `verify.log` "two builds produce the same wasm hash" passes.
- Symbol check: `checkSymbols(defaultSymbolRules)` is ok at O0, O1 and O2 (no forbidden, none missing); no server, game, curl or openal symbols.
  `main`, `Com_LPrintf`, `CL_Init`, `SV_Init` are present at O2 (`--profiling-funcs` keeps names).
- Client/server split intact: the listen-server code stays in the build. `SV_InitGameProgs` (`src/server/game.c`) is present at O0/O1 and inlined away at O2, so it is not a forbidden name.
