---
id: 071
title: A download is a verified job, never a trusted file
status: ready
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

- [ ] **AC1** — Downloading a package produces a `Job` through the existing `JobsService`; no
      parallel progress mechanism is introduced.
- [ ] **AC2** — At most as many jobs run at once as the concurrency limit allows ([[072]] adds
      the setting; this story reads it); further jobs queue.
- [ ] **AC3** — Every downloaded file is checked against the manifest's declared size and SHA256
      before it is used for anything.
- [ ] **AC4** — On a hash or size mismatch, the file is deleted, the next mirror in the
      manifest's list is tried, and if every mirror fails, the job fails with a readable, i18n'd
      reason. There is no override.
- [ ] **AC5** — Extraction runs only on a verified file, via the bundled 7-Zip binary invoked
      with a fixed absolute path and a fixed argument shape assembled from validated values —
      never a renderer-supplied argument.
- [ ] **AC6** — Cancelling a job removes any partial download and any partially extracted
      output.
- [ ] **AC7** — All network access, hashing, and extraction happen in main; the CSP
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
  (regression guard, must stay green) plus `src/main/modules/downloads/layering.test.ts` › "the
  downloads pipeline is unreachable from the renderer and does no work outside main" (D5)

## Done
