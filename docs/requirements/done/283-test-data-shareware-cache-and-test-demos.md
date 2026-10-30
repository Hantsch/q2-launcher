---
id: 283
title: 'Test data: a shareware data cache and test demos'
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want one command that provides reproducible game data on any
machine, plus short test demos of our own, so that spikes, golden frames and A/V-sync checks run
without a retail installation and without committing game data.

Context:

- [concept §13](../concepts/integrated-demo-player.md) (test strategy, test demos), risk R13, licence point L8 in [concept §12](../concepts/integrated-demo-player.md).
- The bootstrap already knows the shareware archive: `src/main/modules/downloads/bootstrap/assemble.ts`
  (`q2-314-demo-x86.exe`), unpacked with 7-Zip; fetch style follows `scripts/fetch-7za.mjs`.
- `docs/fixtures/demos/*` need retail or mod maps (assumption) and do not suit automated tests.
- Demo writers exist: `src/shared/demos/dm2-writer.ts`, `dm2-frames-writer.ts`; the header reader
  is `src/shared/demos/demo-header.ts`.
- Script `scripts/engine/fetch-data.mjs`, `package.json` script `engine:data`; URL and hash in
  `tests/engine/data.lock.json`; unpacking with the launcher's `7za` (`resources/bin/`,
  `npm run fetch:7za`). Test demos recorded with native Q2PRO on the shareware data (`record`),
  `.gz` via `gzip -9`. The header test reads repo files only, no network (`/test-gates`).
- Not in scope: golden frames ([[304]]), A/V analysis ([[307]]), shareware data in the repo,
  network access in `npm test`.
- Depends on: —

Expected manual residue: watch the test demos once in native Q2PRO — map, movement and shots as
described in the README.

## Acceptance Criteria

- [x] **AC1** — On a machine without a Quake II installation, `npm run engine:data` exits 0,
      writes `baseq2/pak0.pak` into a cache outside the repo (`%LOCALAPPDATA%/q2l-engine-test` or
      `~/.cache/q2l-engine-test`, overridable via `Q2L_ENGINE_DATA`) and prints the cache path as
      its last line.
- [x] **AC2** — When the archive's or `pak0.pak`'s SHA-256 differs from
      `tests/engine/data.lock.json`, the command exits non-zero with a message naming the hash
      mismatch (`Q2L_ENGINE_DATA_LOCK=tests/engine/data.lock.broken.json npm run engine:data`).
- [x] **AC3** — A second call with a valid cache downloads nothing, prints `cached` and finishes
      in under 2 s.
- [x] **AC4** — `Q2L_ENGINE_DATA` pointing inside the repo folder is refused.
- [x] **AC5** — `tests/engine/demos/` holds `move-fire.dm2` (20–40 s on a shareware map such as
      `base1`, movement and weapon fire) and `move-fire.dm2.gz` (gzip of the same file);
      `pause-section.dm2` is optional.
- [x] **AC6** — `tests/engine/demos/README.md` names the recording commands, map, length and the
      frames with weapon fire.
- [x] **AC7** — A unit test reads map name and protocol of each test demo through
      `src/shared/demos/demo-header.ts` without errors (`npx vitest run tests/engine/demos`).
- [x] **AC8** — `git ls-files "*.pak" "*.pkz"` prints nothing; `npm run lint` and
      `npm run typecheck` are green.

## Open Questions

None open for this story. Follow-up for the legal clarification (licence point L8, concept §12 /
open point 5): does the shareware licence cover automated test runs in CI (data downloaded at test
time, never redistributed)? Until it is answered, see the first decision below.

## Decisions (Sprint)

- **L8, conservative:** shareware data is fetched only by the developer command `npm run engine:data`
  into a cache outside the repo, never committed, never redistributed, and no CI workflow fetches it
  in this story; wiring it into CI waits for the legal answer to L8 (follow-up, not a blocker).
- **Lock copies the manifest's demo package** (`content/q2_community_content/gamedata/manifest.json`,
  id `q2-314-demo-x86`: url, mirrors, sizeBytes, sha256) and a unit test pins the two equal, because
  the story wants the hash in `tests/engine/data.lock.json` and two copies must not drift.
- **`pak0.pak`'s SHA-256 is pinned from one real run** of the command during D1, because no source
  in the repo knows it today; the run's output goes into `## Done`.
- **The cache keeps no archive:** after extraction the archive is deleted and a marker
  `<cache>/data.lock.json` records the lock it came from, to keep the cache at one `pak0.pak`.
- **A cached call re-hashes `pak0.pak` against the lock** (cheap, no network), so AC2 runs offline
  with `data.lock.broken.json` = correct archive fields + wrong `pak0` hash.
- **A marker whose archive hash differs from the lock refetches** instead of failing, because a
  changed lock is a re-pin; the fetched archive is then checked against the lock (AC2's archive half).
- **Downloads try `url`, then each mirror**, as the bootstrap does, because one dead host must not
  break the command.
- **Extraction uses the vendored `resources/bin/7za.exe` / `7zz`** with the bootstrap's two
  candidate paths (`baseq2/pak0.pak`, `Install/Data/baseq2/pak0.pak`); a missing binary exits
  non-zero naming `npm run fetch:7za`.
- **Linux cache honours `XDG_CACHE_HOME`** (default `~/.cache`), the platform convention.
- **AC3's "under 2 s" is proven by cost** (zero downloads, zero extractions on a cached call), per
  `/test-gates`; no wall-clock assertion.
- **AC4's containment check is a local `.mjs` copy of `isInside`** (`src/main/lib/fs-utils.ts:145`)
  semantics, because a plain node script cannot import main-process TypeScript.
- **The header test lives in `tests/engine/demos/`** as AC7 names it, so `vitest.config.ts`'s
  `include` gains `tests/**/*.test.ts` and `tsconfig.node.json` gains `tests/**/*.ts`
  (`scripts/repo-hygiene.test.mjs` already fails an orphan test file).
- **Demos are recorded, never synthesized:** native Q2PRO (`C:\Games\Q2Pro\q2pro.exe`) on the cached
  shareware data, scripted input from a committed cfg (`+forward`/`+attack` with `wait`), because
  synthetic keystrokes never reach Q2PRO and `dm2-writer` output is not a real engine recording.
- **Protocol 34** (Q2PRO's default `record`, no `-e`), the most portable choice for the later engine
  port and the original 3.20 client.
- **`pause-section.dm2` is not recorded here** (optional in AC5); the story that first needs a pause
  records it.
- **README's weapon-fire frames are the scripted `+attack` windows in demo frames (10 Hz),
  marked approximate (±2 frames)**; exact event times are story 307's parser's job.
- **The no-pak guard (AC8) is a test in `scripts/repo-hygiene.test.mjs`**, next to its other
  `git ls-files` guards, so a committed `.pak`/`.pkz` fails `npm test`, not only a manual command.
- **No changelog entry and no systems doc:** developer tooling, no user-visible change, no system
  under `docs/systems/` changes.

## Plan

1. **D1 — the data command.** `scripts/engine/data.mjs` holds pure-ish logic with injected
   `download`/`extract`/`log`: `resolveCacheDir`, `assertOutsideRepo`, `readLock`,
   `ensureEngineData`. `scripts/engine/fetch-data.mjs` is the thin CLI (`npm run engine:data`).
   Lock files `tests/engine/data.lock.json` (+ `.broken.json`). Unit tests in
   `scripts/engine/data.test.mjs` (already inside vitest's `scripts/**/*.test.mjs`), no network.
   One real run pins `pak0.pak`'s hash. No-pak guard in `scripts/repo-hygiene.test.mjs`.
2. **D2 — the test demos.** Record `move-fire.dm2` with native Q2PRO on the D1 cache from a
   committed cfg, `gzip -9` it, write the README, and add `tests/engine/demos/test-demos.test.ts`
   reading every demo through `parseDemoHeader` (+ frame count for the 20–40 s length). Widen the
   vitest include and the node tsconfig include to `tests/`.

Order: D1 → D2 (D2 needs the cache). Nothing touches `src/`; no IPC, no renderer, no CI workflow.

## Deliverables

- [x] **D1 — `npm run engine:data` fetches, verifies and caches the shareware `pak0.pak`.**
      Files: `scripts/engine/data.mjs` (new), `scripts/engine/fetch-data.mjs` (new, CLI),
      `scripts/engine/data.test.mjs` (new), `tests/engine/data.lock.json` (new),
      `tests/engine/data.lock.broken.json` (new), `package.json` (script
      `"engine:data": "node scripts/engine/fetch-data.mjs"`), `scripts/repo-hygiene.test.mjs`.
      Mirror the download/7-Zip style of `scripts/fetch-7za.mjs` (plain `fetch`, `execFileSync`,
      binary name `7za.exe` on win32 else `7zz` in `resources/bin/`, see
      `src/main/lib/archive/7za-path.ts`).
      - Lock shape: `{ "archive": { "url", "mirrors": [], "sizeBytes", "sha256", "fileName":
        "q2-314-demo-x86.exe" }, "pak0": { "path": "baseq2/pak0.pak", "sha256" } }`; archive values
        copied from `content/q2_community_content/gamedata/manifest.json` package
        `q2-314-demo-x86`. `Q2L_ENGINE_DATA_LOCK` overrides the lock path (resolved against the
        repo root). `data.lock.broken.json` = same archive fields, `pak0.sha256` of 64 zeros.
      - Cache dir: `Q2L_ENGINE_DATA` if set; else win32 `%LOCALAPPDATA%\q2l-engine-test`; else
        `${XDG_CACHE_HOME:-~/.cache}/q2l-engine-test`. Resolved absolute; refused (exit non-zero,
        message names the repo) when equal to or inside the repo root — lexical containment with
        case folding on win32, a whole `..` segment only escapes (semantics of `isInside` in
        `src/main/lib/fs-utils.ts:145`; reimplement in the `.mjs`, do not import TS).
      - Cached path: marker `<cache>/data.lock.json` exists, its `archive.sha256` equals the lock's,
        `<cache>/baseq2/pak0.pak` exists → hash it; equal → print `cached`, then the cache path as
        the last line, exit 0; different → exit non-zero with `pak0.pak SHA-256 mismatch` +
        expected/actual. No download, no extraction.
      - Fetch path (no cache, or marker archive hash ≠ lock): download into `<cache>/.tmp/` trying
        `url` then each mirror; SHA-256 ≠ lock → exit non-zero with `archive SHA-256 mismatch` +
        expected/actual; extract with the vendored 7-Zip (`x <archive> -o<tmp> -y`), take the first
        existing of `baseq2/pak0.pak`, `Install/Data/baseq2/pak0.pak`; hash-check against the lock
        (same mismatch message); move to `<cache>/baseq2/pak0.pak`, write the marker, delete
        `.tmp/`; print the cache path as the last line. Missing 7-Zip binary → exit non-zero naming
        `npm run fetch:7za`.
      - Pin `pak0.sha256`: run `npm run engine:data` once for real, put the hash it reports into
        `data.lock.json`, run it twice more (second prints `cached`), and run the AC2 command;
        paste the three outputs' last lines into the story's `## Done`.
      - Tests in `scripts/engine/data.test.mjs` (injected `download`/`extract`, temp dirs, no
        network): "resolves the cache dir per platform and honours Q2L_ENGINE_DATA"; "refuses a
        cache dir inside the repo"; "a fresh fetch writes baseq2/pak0.pak and prints the cache path
        last" (real vendored 7-Zip packs a tiny archive at test time holding
        `Install/Data/baseq2/pak0.pak`; `skipIf` the binary is missing, like
        `src/main/lib/archive/extractor.test.ts`); "a cached call downloads and extracts nothing and
        prints cached" (counts calls of the injected functions); "an archive hash mismatch fails
        naming the archive"; "a pak0 hash mismatch fails naming pak0.pak"; "the lock's archive
        matches the shipped manifest's demo package".
      - In `scripts/repo-hygiene.test.mjs`, beside the other `git ls-files` guards and with the
        same `IS_WORK_TREE_ROOT` skip: "no game data pak is tracked" (`git ls-files "*.pak"
        "*.pkz"` is empty).
- [x] **D2 — Test demos recorded with native Q2PRO on shareware data, read by a header test.**
      Files: `tests/engine/demos/record-move-fire.cfg` (new), `tests/engine/demos/move-fire.dm2`
      (new), `tests/engine/demos/move-fire.dm2.gz` (new), `tests/engine/demos/README.md` (new),
      `tests/engine/demos/test-demos.test.ts` (new), `vitest.config.ts`, `tsconfig.node.json`.
      Precondition: `npm run engine:data` (D1) has filled the cache; it prints the cache path.
      - Record — never synthesize with `src/shared/demos/dm2-writer.ts`/`dm2-frames-writer.ts`:
        native `C:\Games\Q2Pro\q2pro.exe` with `+set basedir <cache>` (the game library comes from
        the native install, e.g. Q2PRO's `libdir` cvar or a temp copy outside the repo — never
        copy game data into the repo), `+map base1`, `+exec` of the committed cfg. The cfg waits
        for the level to load, runs `record move-fire` (protocol 34, no `-e`), drives movement and
        fire with `+forward`/`-forward`, `+left`/`+right`, `+attack`/`-attack` and `wait`, records
        20–40 s, then `stop` and `quit`. Pitfalls known on this machine: synthetic keystrokes never
        reach Q2PRO (scripted input only); Q2PRO's logfile is buffered, so end via `quit`/WM_CLOSE,
        never kill. Copy the recorded file from Q2PRO's demos dir into `tests/engine/demos/`, then
        `gzip -9 -k` it (or an equivalent node `zlib` level 9) for `move-fire.dm2.gz`.
      - `README.md`: the exact command line and cfg used, map `base1`, length in seconds and demo
        frames, the `+attack` windows as demo-frame ranges (10 Hz, marked approximate ±2 frames),
        that the data is the shareware `pak0.pak` from `npm run engine:data` and that no game data
        is committed, and the manual check (watch once in native Q2PRO).
      - `vitest.config.ts`: add `'tests/**/*.test.ts'` to `test.include`. `tsconfig.node.json`:
        add `"tests/**/*.ts"` to `include`.
      - Test `tests/engine/demos/test-demos.test.ts` (repo files only, no network; `node:fs` +
        `node:zlib` `gunzipSync`): for every `*.dm2` and `*.dm2.gz` in the folder, "each test demo
        names its map and protocol" (`parseDemoHeader` from `@shared/demos/demo-header` → `ok`,
        `format: 'dm2'`, `map === 'base1'`, `protocol === 34`); "the gz demo is the same recording"
        (gunzipped bytes equal `move-fire.dm2`); "move-fire runs 20 to 40 seconds"
        (`createDm2FrameCounter` from `@shared/demos/dm2-frames` → `durationMs` in
        [20 000, 40 000]).

## Model Hints

- D2 → deliverable-hard: driving native Q2PRO with scripted input has known pitfalls on this
  machine (starved command buffer, buffered logfile, game library under a foreign `basedir`), and
  the tempting fallback — a demo synthesized with `dm2-writer` — passes every test while being the
  wrong artefact.
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/engine/data.test.mjs` › "a fresh fetch writes baseq2/pak0.pak and prints the
  cache path last" and › "resolves the cache dir per platform and honours Q2L_ENGINE_DATA" (D1;
  the real-network run that pins the hash is recorded in `## Done`, not a test — `npm test` has no
  network).
- AC2 → unit `scripts/engine/data.test.mjs` › "an archive hash mismatch fails naming the archive"
  and › "a pak0 hash mismatch fails naming pak0.pak" (D1).
- AC3 → unit `scripts/engine/data.test.mjs` › "a cached call downloads and extracts nothing and
  prints cached" (D1; speed proven by cost).
- AC4 → unit `scripts/engine/data.test.mjs` › "refuses a cache dir inside the repo" (D1).
- AC5 → unit `tests/engine/demos/test-demos.test.ts` › "move-fire runs 20 to 40 seconds", › "the gz
  demo is the same recording" and › "each test demo names its map and protocol" (D2); movement and
  fire in the picture → manual residue: judging what a demo shows needs a person watching it until
  the golden-frame lane (304) exists.
- AC6 → manual residue, README content: a prose document's correctness (commands, frames with
  fire) is read, not asserted — the unit lane's doc-read guard keeps doc prose out of `npm test`,
  and whether the listed frames really show fire needs the viewing of AC5's residue (D2).
- AC7 → unit `tests/engine/demos/test-demos.test.ts` › "each test demo names its map and protocol"
  (D2).
- AC8 → unit `scripts/repo-hygiene.test.mjs` › "no game data pak is tracked" (D1); lint and
  typecheck are the build's own verify steps.

## Done

Change type: chore

Summary: `npm run engine:data` fetches the shareware archive, verifies archive and `pak0.pak` against
`tests/engine/data.lock.json` and caches `baseq2/pak0.pak` outside the repo. `tests/engine/demos/`
holds `move-fire.dm2` (+ `.gz`), recorded with native Q2PRO on that cache (29.5 s, 295 frames,
protocol 34), its cfg, README and a header/duration test. `tests/` joined vitest's include and the
node tsconfig.

Commit message: `283: engine:data shareware cache and native-recorded test demos (move-fire.dm2)`

Decisions:
- Map is `demo1`, not `base1`: the shareware `pak0.pak` has only demo1-demo3 (demo1 is "Outer Base");
  README and test say demo1, AC5 "such as base1" is met in spirit.
- The 7-Zip existence check runs only on the extract path, so a cached call needs no 7za (review fix).
- `engine/cross/emscripten.ini` was CRLF in the worktree (LF in the index, story 281): normalised to LF
  so `repo-hygiene` "every text file is LF" is green; no diff against the index.
- Attack windows in the README are approximate (50-70, 85-110, 130-145, 175-195 frames), not decoded.
- Unfixed review notes: no test for `fetch-data.mjs` CLI/exit code or `.tmp` cleanup on failure
  (thin, spec-conformant); `test-demos.test.ts` existence check overlaps the header test (harmless).

Real run, pak0 pin (cache `C:\Users\darkp\AppData\Local\q2l-engine-test`, pak0 sha256
`cae257182f34d3913f3d663e1d7cf865d668feda6af393d4ecf3e9e408b48d09`), last lines: fresh fetch exit 0 ->
`C:\Users\darkp\AppData\Local\q2l-engine-test`; second and third call -> `cached` then the same path;
AC2 command with `data.lock.broken.json` -> exit 1, `pak0.pak SHA-256 mismatch`, `actual cae25718...48d09`.

Verification (narrow gate; full gate is the sprint's): `npm run build`, `typecheck`, `lint` green;
`npx vitest run --changed HEAD` 7778 passed; `npx vitest run tests/engine scripts/engine
scripts/repo-hygiene.test.mjs` 42 passed after fixes; `git ls-files "*.pak" "*.pkz"` empty. No e2e
mapped. AC1-AC4, AC7, AC8 map to the named tests (all ran, passed); AC5 files/length/gz tests passed.
Manual residue: AC5 movement and fire in the picture; AC6 README content (watch once in native Q2PRO).
Review: clean-agent stage 1 PASS, findings fixed (1 cycle). No changelog entry (developer tooling).

tiers: D 2 / hard 1 · review default · cycles 1 · agents 7
