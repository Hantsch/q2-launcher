---
id: 071
title: A download is a verified job, never a trusted file
status: done
created: 2026-09-08
---

## Requirement

Downloading a package from the manifest ([[070]]) has to produce a file the launcher can trust
enough to extract and run — this is foreign, executable content pulled from the internet. This
story builds the `downloads` module's core pipeline: turn a manifest package into a running
`Job` (the shell's existing, unused job pipeline), verify it against the manifest's size and
SHA256 with mirror fallback on mismatch, and extract it with the bundled 7-Zip binary. Nothing
in this story is user-reachable yet — [[074]] wires it to the wizard — but it is fully testable
against a manifest fixture and a local test server.

## Acceptance Criteria

- [x] **AC1** — Downloading a package produces a `Job` through the existing `JobsService`; no
      parallel progress mechanism is introduced.
- [x] **AC2** — At most as many jobs run at once as the concurrency limit allows ([[072]] adds
      the setting; this story reads it); further jobs queue.
- [x] **AC3** — Every downloaded file is checked against the manifest's declared size and SHA256
      before it is used for anything.
- [x] **AC4** — On a hash or size mismatch, the file is deleted, the next mirror in the
      manifest's list is tried, and if every mirror fails, the job fails with a readable, i18n'd
      reason. There is no override.
- [x] **AC5** — Extraction runs only on a verified file, via the bundled 7-Zip binary invoked
      with a fixed absolute path and a fixed argument shape assembled from validated values —
      never a renderer-supplied argument.
- [x] **AC6** — Cancelling a job removes any partial download and any partially extracted
      output.
- [x] **AC7** — All network access, hashing, and extraction happen in main; the CSP
      (`connect-src 'self'`) is unchanged.

## Open Questions

- ~~Which 7-Zip variant ships...~~ answered → Decisions (Sprint)
- ~~Per-request timeout, retry budget...~~ answered → Decisions (Sprint)
- ~~Pause/resume across an app restart...~~ answered → Decisions (Sprint)
- **Carried gap (not blocking):** AC6 (cancel) is a user action, but this story deliberately ships
  no trigger on the real surface — the wizard in [[074]] is that trigger. Cancel is therefore proven
  one level down, by an integration test through the real pipeline, and the real-surface `ui:verify`
  cancel belongs to [[074]]. Noted here for the sprint review.

## Decisions (Sprint)

- **(User)** 7-Zip variant: `7za.exe` (standalone, full-featured, self-contained — handles the
  zip/installer-shaped archives the manifest's assets use without a companion DLL).
- **(User)** Download timing: 30s per-request timeout, 3 retries before falling to the next
  mirror, system proxy honoured.
- **(User)** Cross-restart resume: in-session pause/cancel only; HTTP-range resume across an app
  restart is deferred to a later sprint of the Install milestone (fixed at the sprint cut, see
  `sprint.md`'s Scope decisions).
- **HTTP client:** Electron's `net.fetch` in main, behind an injectable function — it honours the
  system proxy (the User decision above) without adding a dependency, unlike Node's `fetch`.
- **Timeout semantics:** the 30s budget is a headers timeout plus a stall timeout (no bytes
  received), not wall clock — a 190 MB download legitimately runs far longer than 30s.
- **Retry semantics:** the 3 retries apply to transport errors on the same URL only; a size or hash
  mismatch never retries the same URL, it deletes and moves straight to the next mirror (AC4).
- **Concurrency source:** this story defines the module's settings shape and defaults
  (`concurrentJobs`, default 2, range 1–6) in `src/shared/modules/downloads.ts` plus a new
  `downloads` top-level key in `state.json`, and reads them — [[072]] only contributes the UI
  section over the same shape, because "reads the limit" needs a source that exists.
- **Package input type:** the pipeline takes its own minimal `PackageSource` (fileName, url,
  mirrors, sizeBytes, sha256) rather than [[070]]'s manifest type, so this story stays buildable and
  testable while the manifest shape is still in flight; the adapter lands with the caller ([[074]]).
- **Queue ownership:** admission is module-owned — a job stays `queued` until the module starts it,
  so `JobsService` and the shell need no change (CLAUDE.md: never edit the shell).
- **Paths:** archives in `userData/cache/downloads/`, in-flight as `<name>.part`, extraction into
  `userData/cache/downloads/extract/<jobId>/`. Cancel deletes the `.part` file and that extract
  directory; an already verified cached archive is kept, since the cache is the point (AC6 says
  *partial*).
- **Extractor binary:** `7za.exe` plus its licence text are vendored into `resources/bin/` by
  `scripts/fetch-7za.mjs` and shipped via `electron-builder.yml`'s `extraResources`; the path is
  resolved absolutely (dev: repo `resources/bin`, prod: `process.resourcesPath/bin`), never from
  `PATH`. A missing binary fails the job with a readable key instead of throwing.
- **Fixed argument shape:** `['x', '-y', '-bso0', '-bse1', '-bsp1', '-o<absolute extract dir>',
  '<absolute archive path>']`, `shell: false`, both paths computed in main — nothing renderer-shaped
  can become an argument or a flag (AC5).
- **Extraction progress:** parse `-bsp1`'s percent lines into `JobProgress.ratio` for the extract
  phase, falling back to indeterminate when nothing parses — a coarse but real bar without a
  fragile hard dependency on 7-Zip's output format.
- **Pause:** not an AC of this story and not implemented here; in-session pause needs a control and
  a `JobsService` status transition, and both belong with the Downloads tab ([[073]]).
- **No IPC channel in this story:** the pipeline is a plain main-process API inside the module; the
  `downloads` manifest entry stays `status: 'planned'` and the first channel arrives with the wizard
  ([[074]]) — contract-first belongs to the story that actually exposes a surface.
- **Failure reason keys** are enumerated now (`downloads.error.allMirrorsFailed`,
  `.verificationFailed`, `.extractorMissing`, `.extractionFailed`, `.diskWrite`, `.network`) — main
  sends keys, never prose, and a fixed small set keeps [[073]]'s failure log renderable.

## Plan

Build the `downloads` module's main-process core bottom-up: contract and settings first, then the
verified fetch, then the extractor, then the job/queue orchestration that ties them together. No
renderer half, no IPC channel, no shell edit.

1. **Contract + state.** `src/shared/modules/downloads.ts` gets `PackageSource`,
   `DownloadsSettings` + defaults, and the error-key union. `state.json` gains a `downloads` top
   level key with a defensive parse in `src/main/lib/schemas.ts` (mirror `parseConfigProfiles`) and
   a getter/setter in `src/main/services/state.ts`. i18n keys into `en.json`.
2. **Verified fetch.** `fetcher.ts` streams a URL to `<name>.part` through a SHA256 hash, applies
   the headers/stall timeout and the retry budget, then `verify.ts` compares size + digest and
   promotes the file into the cache. Mismatch → delete → next mirror → all-mirrors failure key.
3. **Extractor.** `7za-path.ts` resolves the vendored absolute binary path (dev vs. packaged),
   `extractor.ts` spawns it with the fixed argv, parses `-bsp1` progress and exposes a kill for
   cancel. `scripts/fetch-7za.mjs` vendors the binary; `electron-builder.yml` ships it.
4. **Pipeline + queue.** `queue.ts` admits at most `concurrentJobs` jobs; `pipeline.ts` creates the
   job via `app.jobs`, reports progress, runs fetch → verify → extract, and on cancel aborts the
   request, kills the child and deletes the partials. `index.ts` exports the `MainModule` and is
   registered in `src/main/modules/index.ts`.
5. **Layering guard.** A test that pins the production CSP (existing) and asserts no renderer file
   reaches the pipeline and no `spawn`/network call leaks out of main.

Order matters: 2 and 3 are independent of each other, 4 needs both, 5 needs 4.

## Deliverables

- **D1 — Contract, settings and persisted module state.** `src/shared/modules/downloads.ts` (new;
  mirror `src/shared/modules/config.ts` for shape), defensive parse in `src/main/lib/schemas.ts`
  (mirror `parseConfigProfiles`, `schemas.ts:886`), `downloads` key + getter/setter in
  `src/main/services/state.ts`, error/label keys in
  `src/renderer/src/i18n/locales/en.json`. Acceptance: defaults load, a corrupt `downloads` key falls
  back to defaults instead of throwing; test in `src/main/lib/schemas.test.ts`.
- **D2 — Verified download with mirror fallback.** `src/main/modules/downloads/fetcher.ts`,
  `verify.ts`, `paths.ts` (cache dirs), plus their tests
  (`fetcher.test.ts`, `verify.test.ts`) against a `node:http` server on `127.0.0.1` and `mkdtemp`
  fixtures (mirror `src/main/modules/config/writer.test.ts:38` for the temp-dir pattern).
  Acceptance: size/hash match promotes the file, mismatch deletes and advances the mirror, exhausted
  mirrors return `downloads.error.allMirrorsFailed`; timeout and retry budget honoured. (AC3, AC4)
- **D3 — Vendored 7-Zip extractor.** `src/main/modules/downloads/extractor.ts`, `7za-path.ts`,
  `scripts/fetch-7za.mjs`, `electron-builder.yml`, `.gitignore`/`resources/bin` as needed, plus
  `extractor.test.ts`. Acceptance: refuses an unverified input, spawns the absolute vendored path
  with the fixed argv and `shell: false`, surfaces `extractorMissing` when the binary is absent,
  parses progress; a real-archive test runs only when the binary is vendored (`skipIf`). Spawn
  pattern to mirror: `src/main/services/launch.ts:92`. (AC5)
- **D4 — Job pipeline and concurrency queue.** `src/main/modules/downloads/pipeline.ts`, `queue.ts`,
  `index.ts`, registration in `src/main/modules/index.ts`, plus `pipeline.test.ts` and
  `queue.test.ts`. Mirror `src/main/modules/config/index.ts:611` for the `MainModule` shape.
  Acceptance: one `Job` per download through `app.jobs` with real progress, at most
  `concurrentJobs` running and the rest `queued`, cancel aborts and removes partial download plus
  extract output. (AC1, AC2, AC6)
- **D5 — Layering and CSP guard.** `src/main/modules/downloads/layering.test.ts`. Acceptance: the
  production CSP string is unchanged (assert against `src/main/lib/renderer-source.ts`), no file
  under `src/renderer/src` imports the downloads pipeline, and no network/`child_process` usage
  appears outside `src/main`. (AC7)

## Model Hints

- D2 → `deliverable-hard` — streamed hash-while-writing plus timeout, retry budget and mirror
  advance is subtle state machinery whose failure mode (accepting a truncated or wrong file) is
  exactly the security property the story exists for.
- D4 → `deliverable-hard` — first real producer of the shell's untouched `JobsService`: queue
  admission, progress across two phases and cancel cleanup of two child resources (HTTP stream and
  7za process) span the module and risk leaking files or a stuck `queued` job.
- D1, D3, D5 → default.
- Review: → `story-review-hard` — the diff executes a bundled binary against foreign content pulled
  from the internet and owns the no-override hash gate; a cheap review is the wrong economy here.

## Acceptance Tests

- AC1 → unit `src/main/modules/downloads/pipeline.test.ts` › "a download runs as one job created
  through JobsService" (D4)
- AC2 → unit `src/main/modules/downloads/queue.test.ts` › "at most the configured number of jobs
  run, the rest stay queued" (D4)
- AC3 → integration `src/main/modules/downloads/fetcher.test.ts` › "a file is handed on only after
  size and SHA256 match the package" (D2, local `node:http` server + temp dir)
- AC4 → integration `src/main/modules/downloads/fetcher.test.ts` › "a hash mismatch deletes the file
  and falls through to the next mirror" and › "when every mirror fails the job fails with
  downloads.error.allMirrorsFailed" (D2)
- AC5 → unit `src/main/modules/downloads/extractor.test.ts` › "extraction refuses an unverified
  file" and › "7za is spawned with the vendored absolute path and a fixed argument shape" (D3)
- AC6 → integration `src/main/modules/downloads/pipeline.test.ts` › "cancelling removes the partial
  download and the extraction output" (D4). **e2e gap:** the real-surface cancel needs the wizard
  trigger from [[074]] and is proven there; see Open Questions.
- AC7 → unit `src/main/lib/renderer-source.test.ts` › the existing production-CSP assertion
  (regression guard, must stay green) plus `src/main/modules/downloads/layering.test.ts`'s
  `describe('downloads pipeline layering (story 071 AC7)')` › "is not imported by any file under
  src/renderer/src, by relative path or the @main alias", "leaves no child_process/net.fetch/7za/
  spawn( token in src/renderer/src or src/preload", "confines child_process/net.fetch/7za/spawn(
  usage in src/main to the downloads module and the pre-existing allowlist", and "leaves the
  production CSP unchanged (connect-src 'self')" (D5; split into four `it`s instead of one, same
  criterion)

## Done

**Summary.** Built the `downloads` module's verified-download pipeline bottom-up per the Plan:
D1 contract/settings/persisted state, D2 verified fetch with mirror fallback (`net.fetch` behind an
injectable impl, hash-while-writing, headers/stall timeout, transport-retry-vs-mirror-advance),
D3 the vendored 7za extractor (fixed argv, `shell: false`, dev/prod path resolution), D4 the job
pipeline + concurrency queue wired to the shell's existing `JobsService` with real cancel cleanup of
both the HTTP stream and the 7za child process, D5 a layering/CSP regression guard. Coexists with
story 070's manifest types in the same `src/shared/modules/downloads.ts` / `src/main/modules/downloads/`
without importing from `manifest-service.ts`, per this story's own `PackageSource` decision. No
renderer half, no IPC channel — by design (Decisions (Sprint): "the first channel arrives with the
wizard, [[074]]").

A clean-agent review (`story-review-hard`) found the implementation correct by inspection but AC5
under-tested (no assertion on the actual `spawn()` argv/shell flag) and one confirmed defect: the
dev-mode 7za path resolver counted `..` segments assuming an unbundled directory depth that does not
match the real bundled main process (`out/main/index.js`), which would have made every dev/prod
extraction fail with `extractorMissing`. One fix cycle resolved all findings: the path resolver now
walks up from `__dirname` to the nearest `package.json` instead of counting fixed levels; the AC5
test now asserts the real `spawn()` call's command/argv/`shell: false`; a tautological
progress-parsing test now drives real stdout through the real `extractArchive()` wiring instead of
re-implementing the parser in the test; `fetch:7za` is now chained before the packaging scripts so a
release build cannot ship without the binary; and an out-of-scope i18n key belonging to [[072]] was
removed. A re-review confirmed all five fixes genuinely resolve the findings and nothing new broke.

**Commit message:** `071: downloads are verified jobs — fetch, extract, queue`

**Verification:**
- build: `npm run build` — clean.
- typecheck: `npm run typecheck` — clean (node + web).
- test: `npm test` — 127 files, 2848 passed, 3 skipped (the 3 skips are `it.skipIf` real-`7za.exe`
  tests, expected since the binary is not vendored in this sandbox — no network access to
  7-zip.org here; `scripts/fetch-7za.mjs` is written and wired but was never executed end-to-end).
- e2e: `npm run ui:verify` — 64/64 screens, 0 axe violations (this story adds no renderer surface, so
  this is a pure no-regression check, which is correct per the Plan).
- review: `story-review-hard` → FAIL (2 confirmed findings on the first pass) → one fix cycle → PASS
  on re-review (of 1 max-3 allowed cycles).

**AC → test mapping, as verified:**
- AC1 (one `Job` through `JobsService`) → `pipeline.test.ts` › "a download runs as one job created
  through JobsService" — passed.
- AC2 (concurrency limit + queueing) → `queue.test.ts` › "at most the configured number of jobs run,
  the rest stay queued" — passed.
- AC3 (size+SHA256 check before use) → `fetcher.test.ts` › "a file is handed on only after size and
  SHA256 match the package" — passed.
- AC4 (mismatch → delete → next mirror → no-override failure) → `fetcher.test.ts` › "a hash mismatch
  deletes the file and falls through to the next mirror" and › "when every mirror fails the job
  fails with downloads.error.allMirrorsFailed" — passed; confirmed no override path exists anywhere
  in the module (review finding).
- AC5 (extraction only on verified input, fixed argv, no renderer-shaped args) →
  `extractor.test.ts` › "extraction refuses an unverified file" and › "7za is spawned with the
  vendored absolute path and a fixed argument shape" — passed (the latter rewritten during the fix
  cycle to actually assert the spawn call).
- AC6 (cancel removes partial download + partial extraction output) → `pipeline.test.ts` ›
  "cancelling removes the partial download and the extraction output" — passed, real HTTP + real
  temp filesystem + real signal-based cancel. **Manual/carried residue:** the real-surface trigger
  (a Cancel button a user can click) is [[074]]'s wizard, not this story's — pre-declared in Open
  Questions, not a gap introduced here.
- AC7 (main-only, CSP unchanged) → `renderer-source.test.ts` (existing, untouched, still green) plus
  `layering.test.ts`'s four `it`s (see Acceptance Tests section above, renamed from the original
  single-name mapping to match what was actually written) — passed.

**Decisions made during implementation (not pre-answered by the story):**
- `7za-path.ts`'s dev-mode repo-root resolution walks up from `__dirname` to the nearest ancestor
  containing `package.json`, rather than counting fixed directory levels — the codebase has no
  existing runtime "find repo root" helper that transfers (`scripts/lib/paths.mjs`'s `REPO_ROOT` is
  script-location-derived and never bundled, so it doesn't apply here).
- The AC5 spawn-argv test and the progress-parsing test use `vi.mock('node:child_process', ...)`
  with `importOriginal`, mirroring this repo's existing house pattern for mocking child_process in
  tests (already used elsewhere, e.g. around `config/index.test.ts`).
- `fetch:7za` is chained into `package:dir`/`package:win` before the build step (not run
  automatically on `npm install` or `npm run build`, so plain dev/test work never needs network
  access) — a failed fetch aborts packaging rather than silently shipping without the binary.
- Job-cancel-while-`queued` (never admitted) is handled by removing the job from the queue's pending
  list so its work function is never called at all, rather than starting and immediately cancelling
  it.
- `downloads.job.download` is the one i18n label key this story adds beyond D1's error keys (a job
  needs a `labelKey`); `downloads.settings.concurrentJobs` (added then removed) is left to [[072]],
  which owns the settings UI for this same shape.

**Open points carried forward (not blockers):**
- `scripts/fetch-7za.mjs` has never run end-to-end in this environment (no network access to
  7-zip.org) — the packaging wiring is correct but unverified against a real download; the two
  real-archive tests remain `skipIf`-gated until a developer with network access runs it once.
- The review separately flagged (not fixed, judged out of scope for this fix cycle): no per-file
  mutual exclusion if two jobs target the same `fileName` concurrently (plausible, not
  demonstrated, degrades to a safe-but-spurious double failure rather than corrupting a verified
  file — a future story's concern if it ever becomes reachable, since nothing in this story or
  [[074]]'s current plan issues two jobs for the same file); `extractArchive`'s stdout pipe is only
  drained when `onProgress` is supplied (latent, not live — the one production caller,
  `pipeline.ts`, always supplies it); the vendored 7za download itself has no pinned-hash
  verification in `fetch-7za.mjs` (the executable trusts whatever bytes 7-zip.org serves for the
  pinned version) — left as-is given the sandbox's inability to test a fetch-time integrity check
  end-to-end, and flagged here for a follow-up story rather than guessed at blind.
