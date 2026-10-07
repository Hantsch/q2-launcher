# Sprint S32 — review

## Overview

Goal: the end-of-sprint flow gate is binary; the two safety findings (path containment, shell handlers
that throw prose) are closed; every module answers through one typed `Outcome` envelope with one refusal
shape, owns its persisted state and reaches Electron only through the shell, enforced by a test and a
linter; jobs, package staging, HTTP fetches and platform rules each exist once. Users see no change
except a correct error message. All 18 stories are done on `sprint/S32`; the merge into `dev` is the
user's decision (see Blocked / open).

| Story                     | Status | Commit                                                                                        |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| 223 flow gate             | done   | aa58f5c quarantine list, shards, timeout, setup action, ui-flows CI, flow rules               |
| 226 format + dependencies | done   | 20c8c79 format once, 736c09b Electron 43.7.7, dependabot, repo hygiene tests                  |
| 225 test kit              | done   | 4c86012 quiet test run, one test-support kit, mockClient, files under 1,500 lines             |
| 199 path containment      | done   | 11fb221 `isInside` is the one rule, `absolutePathSchema` honest                               |
| 200 thrown handler        | done   | 16a7ec6 shell IPC answers `ipc.error.handlerFailed`, not prose                                |
| 201 ordered shutdown      | done   | 88a10f1 awaited shutdown, persist-failure retry + toast, `onDispose`, debounced `state.json`  |
| 202 slice mutators        | done   | 3c57ed0 `updateSlice` replaces read-spread-set; installations merge on live                   |
| 203 forgiving rows        | done   | 79250ec `lib/forgiving.ts`                                                                    |
| 204 one Outcome envelope  | done   | d93dbe5 flatteners gone; every error key proven to resolve                                    |
| 206 one refusal shape     | done   | fa58546 `Refusal`/`refuse()` with full keys; `lib/toast.ts`                                   |
| 205 typed module contract | done   | e2d5130 `defineModule`/`createModuleClient`, home + servers converted, dead handlers removed  |
| 207 modules own state     | done   | fe59935 `StateStore.section`, per-module `persisted.ts`, migrations out of the shell          |
| 208 layer rules           | done   | b519108 `architecture.test.ts` + oxlint (`npm run lint`)                                      |
| 209 modules via the shell | done   | 9a5b2ec `app.os/displays/harness/env`; regression fix 4d8f9e7                                 |
| 221 HTTP policy           | done   | 3af6844 `lib/http.ts` `fetchWithPolicy`; list sources 10 s / 2 MiB                            |
| 222 platform module       | done   | b343287 `lib/platform.ts`, `createListenerSet`, `looksLikeQuake2` once                        |
| 220 package staging       | done   | dd4e2a3 one `stagePackage`, dead queue removed, one `ManifestService`; regression fix 26a7c24 |
| 219 job runner            | done   | b9f3c76 one `JobRunner`, one busy rule, failure log for every module                          |

Also on the branch: c73921f (refine of the 18 stories) and 376e5fe (quarantine of the pre-existing
`mods-view` flow). Gate on `376e5fe`.

## Implemented stories

- **223** — the four chronically red flows fixed at their cause; `flows-all.mjs` reads
  `scripts/flows/quarantine.json`, supports `--shard=i/n` and `--timeout`; new `ui-flows.yml`
  (4 shards, `windows-verify`); UI-VERIFICATION.md says what a flow may assert.
- **226** — repo is LF and formatted once (blame-ignored), `format:check` in CI; patch-package gone;
  Electron 43.7.7 and js-yaml 4.3.2 with both audits at 0; dependabot weekly.
- **225** — quiet test runs that need no Electron binary; `src/test-support/` kit (`installTempDir`,
  `fakeAppContext`, fixtures); 42 renderer mocks via `mockClient`; eight oversized test files split.
- **199** — `isInside` in `lib/fs-utils.ts` is the single containment rule (reveal, install, update,
  remove, rollback); `absolutePathSchema` really checks absoluteness.
- **200** — both shell IPC wrappers catch a throwing handler and answer with the
  `ipc.error.handlerFailed` key; the original error is logged with the channel.
- **201** — shutdown is an awaited, bounded sequence (playback, dispose, settle, quit); failed
  persistence retries once and toasts; modules release through `onDispose`; `state.json` writes are debounced.
- **202** — `StateStore.updateSlice` replaces whole-section setters; installations `patch`/`validate`
  merge at commit time; write failures delta-merge.
- **203** — one forgiving row-parsing helper replaces eight hand parsers and three module loops.
- **204** — module handlers return `Outcome<R>`, the registry passes it through with a fail-closed
  guard; all flatteners gone; `error-keys.test.ts` proves every `fail()` literal resolves in `en.json`.
- **206** — in-band results are `DomainResult` with full i18n keys; four reason-templated renderer
  keys became literal records; `lib/toast.ts` is the one error-toast path.
- **205** — typed module seam (`ModuleContract`, `defineModule`, `createModuleClient`); `home` and
  `servers` converted; six dead handlers and `demos.list` removed; bus-wide handler-coverage tests.
- **207** — `StateStore.section()` typed handles; downloads, home, servers, replays, config and unlock
  each own a `persisted.ts`; config migrations moved out of the shell; golden state test.
- **208** — `src/architecture.test.ts` enforces import rules with a story-referenced allowlist; the
  spawn/network guard is repo-level; oxlint runs in CI and `verify:release`.
- **209** — `AppContext` gained `harness`, `env`, `os`, `displays`, `isPackaged`, `userDataDir`;
  `getMainWindow` left it; downloads infrastructure hoisted to the shell; no module imports `electron`.
- **221** — `lib/http.ts` is the one timeout, retry and size policy for feeds, images, content repo,
  bleeding-edge probe and server-list sources.
- **222** — five call-time platform helpers in `lib/platform.ts` (darwin now folds everywhere);
  `createListenerSet` replaces ten hand-written emitters; `looksLikeQuake2` defined once.
- **220** — dead download pipeline deleted; bootstrap, repair and engine update stage through one
  `stagePackage` (bleeding-edge now stalls, retries and caps size); one `ManifestService`; assemble
  scope `core`/`extras`; the two queue settings are shown disabled with a visible reason.
- **219** — every job runs on `JobRunner` (one lifecycle, one installation-wide busy rule
  `jobs.error.installationBusy`, revalidate-after-write); the failure log covers every module.

## Findings & decisions

**Decisions made in the sprint**

- 200: only handlers are wrapped; the preload bridge is deliberately untouched.
- 204: handlers return `Outcome<R>` at compile time (user decision), so the wire shape changed for
  handlers that already returned an Outcome, contrary to AC6's wording; `home-tile-states` was corrected.
- 205: request schemas live in shared, persisted and manifest schemas stay in main (user decision);
  `servers` is the second converted module because it has the feature-gated handler map.
- 207: `new StateStore(path)` without `migrations` runs none; production always passes them.
- 209: `displays.ts` scales a rect by the display it sits on, not the primary, to keep mixed-DPI behaviour.
- 220: queue settings are disabled with a reason, no migration (user decision); a bleeding-edge
  transport failure now ends `allMirrorsFailed` instead of `network`, as pinned downloads do.
- 226: `.prettierignore` keeps two NUL-bearing historical docs byte-identical.
- 219: bootstrap is exclusive only for a retry adopting an existing installation, after admission.

**Found by the gate, fixed:** two regressions only the full `ui:flows` saw (see Regression gate):
209's `bootEnv` lost Windows case-insensitive lookup (fixed in 4d8f9e7); 220 disabled a switch that
201's `quit-persists-state` flow clicked (fixed in 26a7c24, the flow now flips an enabled switch).

**Process observations**

- Narrow per-story gates missed cross-story breakage: `bootstrap-wizard` was not among 209's named
  flows. A polluted `.ui-verify` fixture cache makes the archive counts in `downloads-tab` and
  `settings-downloads-section` vary until `npm run ui:seed`. Both → [233](../../../requirements/done/233-the-flow-gate-has-no-quarantined-flows-and-catches-cross-story-breakage.md).
- Agents wrote some files with CRLF; the repo hygiene test caught it, it was fixed once and later
  agents were told. Guarded by the test, no follow-up.
- One deliverable agent ran `git stash` by mistake; harmless, nothing lost.
- 204's AC2 `.value.ok` grep was narrowed to a listed set of 7 files and its fix got no second review pass → 236.
- 225 changed `parseMissingKeyHandler` in the renderer i18n: an unknown unlock feature id now renders
  as the id. Marginally user-visible, so no changelog entry was added (checked in the changelog sweep) → 236.

**Deliberately unfixed or open, with where each went**

| Finding (story)                                                                                                                                                  | Where                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Handlers of config, downloads, mods, replays, library are not typed from a contract (205 FU1–FU5; S33 does not cover them)                                       | [232](../../../requirements/done/232-every-modules-handlers-are-typed-from-a-contract.md)                                                |
| `mods-view` quarantined (flow vs uppercase, 188); `replays-mod-warning` flake; fixture-cache pollution; narrow gates miss neighbours (223, 209, 220)             | [233](../../../requirements/done/233-the-flow-gate-has-no-quarantined-flows-and-catches-cross-story-breakage.md)                         |
| `verify:release` not run (226, nothing in this sprint ran it); `ci:local`/`ci:local:flows` not observed; Linux-only red flows undetermined; runner timings (223) | [234](../../../requirements/done/234-release-verification-and-ci-rehearsals-run-before-a-merge-to-main.md); manual part in `testplan.md` |
| Late `cinema.set(true)` after dispose; `quitAndInstall` through held `before-quit` untested; cinema/stage-follow disposal only helper-tested (201)               | [235](../../../requirements/done/235-shutdown-state-store-and-job-edge-cases-are-closed.md)                                              |
| `StateStore` without `migrations` runs none; `withEngineState` prototype view (207)                                                                              | [235](../../../requirements/done/235-shutdown-state-store-and-job-edge-cases-are-closed.md)                                              |
| `commitAdoption` throw outside bootstrap's catch; debounce-race fix inferred, not measured (219)                                                                 | [235](../../../requirements/done/235-shutdown-state-store-and-job-edge-cases-are-closed.md)                                              |
| Bleeding-edge transport failure now `allMirrorsFailed` instead of `network` (220)                                                                                | [235](../../../requirements/done/235-shutdown-state-store-and-job-edge-cases-are-closed.md) AC6                                          |
| Modules still use `lib/paths.userDataDir()`, `lib/net/fetcher`, `lib/native-image` (209); oxlint builtin list shorter than the test's (208)                      | [236](../../../requirements/done/236-the-layer-and-error-key-rules-have-no-known-holes.md)                                               |
| `${reason}` templates in five files, scan misses `fail(\`...\`)`(206);`.value.ok`grep narrowed, stale comment paths (204, 207);`parseMissingKeyHandler` (225)    | [236](../../../requirements/done/236-the-layer-and-error-key-rules-have-no-known-holes.md)                                               |
| `dedupeByKey` (203) and `toastRefusal` (206) have no production caller                                                                                           | roadmap follow-up                                                                                                                        |
| Split test files with story numbers in describe titles, a few `as never` casts in client-mock overrides (225); renderer reference regex matches comments (205)   | roadmap follow-up                                                                                                                        |
| No darwin tests at steam/diagnostics call sites, thin `looksLikeQuake2` test (222); no per-site swapped-argument test for `isInside` at four call sites (199)    | roadmap follow-up                                                                                                                        |

## Blocked / open

Nothing blocked. Open: merging `sprint/S32` into `dev` is the user's decision; S33 starts after it
(it builds on S32's contract). Pushes and pull requests are not done by agents. The manual residue in
`testplan.md` waits on the user.

## Regression gate

Ran on `376e5fe` (sprint branch HEAD after two fix commits).

| Command                                         | Minutes | Result                                    |
| ----------------------------------------------- | ------- | ----------------------------------------- |
| `npm run build` / `typecheck` / `lint`          | ~0.2    | green                                     |
| `npm test`                                      | 0.4     | green (524 files, 6563 passed, 8 skipped) |
| `npm run ui:verify`                             | 1.9     | green (60/60 screens, 0 axe violations)   |
| `npm run ui:flows` (first run, on `b9f3c76`)    | 49.8    | red: 134/138                              |
| `npm run ui:flows` (confirmation, on `376e5fe`) | 49.4    | green: 136/138, `mods-view` expected fail |

`verify:release` was not run (Docker daemon down, run exceeds the 10-minute call ceiling).

- `bootstrap-wizard` — story 209, commit 9a5b2ec: `bootEnv` copied `process.env` case-sensitively, so
  `ProgramFiles` was not found on Windows. **Fixed in 4d8f9e7.**
- `quit-persists-state` — story 220, commit dd4e2a3 (attributed from the code, no bisect): the flow from
  201 clicked a switch 220 now disables. **Fixed in 26a7c24.**
- `mods-view` — **pre-existing** (red at the merge-base): `uppercase` class on the installation name
  since story 188. Quarantined in `scripts/flows/quarantine.json` (376e5fe); fix is story 233.
- `replays-mod-warning` (already quarantined, flaky) reported an unexpected pass; kept in quarantine as a
  known 1–2 of ~6 flake.

## Acceptance

Every criterion below has a named automated test (listed in full in each story's `## Done` and
`## Acceptance Tests`, docs/requirements/done/). Per story:

- **223** — AC1 four repaired flows (`servers-sort-order`, `servers-master-sources`,
  `replays-extra-folders`, `servers-filter-search`); AC2/AC3 `scripts/flow-gate.test.mjs`; AC3/AC5/AC6
  `scripts/workflows.test.mjs`; AC4 `scripts/flow-rules-doc.test.mjs`.
- **226** — AC1–AC6 `scripts/repo-hygiene.test.mjs` plus `format:check` and both `npm audit` runs.
- **225** — AC1 `scripts/quiet-test-run.test.mjs`; AC2–AC5 `scripts/test-kit.test.mjs`,
  `src/test-support/temp-dir.test.ts`, `mock-client.test.ts`; AC6 full suite.
- **199** — AC1 `fs-utils.test.ts`; AC2/AC6 `containment-guard.test.ts`; AC3 `ipc/app.test.ts`;
  AC4 `shared/schemas.test.ts`; AC5 `map-presence.test.ts`.
- **200** — AC1–AC4 five tests in `src/main/ipc/index.test.ts`; AC5 additions-only diff.
- **201** — AC1 `shutdown.test.ts` + flow `quit-persists-state`; AC2 `registry.test.ts`, servers and
  downloads index tests; AC3 replays `index.test.ts`; AC4 `persistence.test.ts` + per-owner tests;
  AC5 `json-store.test.ts`, `state.test.ts`; AC6 `state.test.ts`; AC7 flow `quit-persists-state`.
- **202** — AC1 `state.test.ts`; AC2 servers/replays `index.test.ts`; AC3 `installations.test.ts`;
  AC4 `write-failures.test.ts` + `index.write-failures.test.ts`; AC5 `list-sort.test.ts`.
- **203** — AC1 `forgiving.test.ts`; AC2/AC3 `schemas.test.ts`; AC4 `catalog-parse.test.ts`,
  `manifest-parse.test.ts`; AC5 existing suites unchanged.
- **204** — AC1 `registry.test.ts`, `common.test.ts`; AC2 renderer `client.test.ts` files; AC3–AC5
  `src/main/error-keys.test.ts`, `install-job.test.ts`; AC6 full suite + nine flows.
- **206** — AC1 `common.test.ts`; AC2 five module tests + `reason-templates.test.ts`; AC3 `toast.test.ts`;
  AC4 `error-keys.test.ts`; AC5 `common.test.ts`; AC6 five flows (master-sources, quick-filters,
  watchlist, extra-folders, demo-file-actions).
- **205** — AC1 `contract.test.ts`, `home.test.ts`; AC2 `define-module.test.ts`, `moduleClient.test.ts`;
  AC3–AC5 both `handler-coverage.test.ts`, `registry.test.ts`; AC6 `ipc-schemas.test.ts`; AC7
  `architecture-doc.test.ts`; regression flows `news-feed`, `home-dashboard-arrange`, `servers-join`,
  `servers-watchlist`, `servers-quick-filters`.
- **207** — AC1/AC3/AC5 `shell-layering.test.ts`, six `persisted.test.ts`; AC2 `state.test.ts`; AC4
  `persisted-migrations.test.ts`, `migrations.test.ts`; AC6 `persisted-state.golden.test.ts`.
- **208** — AC1–AC6 `src/architecture.test.ts`, `src/main/layering.test.ts`,
  `src/test-support/source-tree.test.ts`; AC4 also `npm run lint`.
- **209** — AC1 `os.test.ts` + flows `mods-detail`, `replays-demo-file-actions`; AC2 `displays.test.ts`,
  replays `index.test.ts` + flows `replays-stage`, `-stage-follow`, `-cinema`; AC3 `ui-harness.test.ts`,
  `boot-env.test.ts` + four flows; AC4–AC6 `architecture.test.ts`, `mods-install`, `engine-update`.
- **221** — AC1 `http.test.ts` (5); AC2 feed/image fetcher suites; AC3 `source-resolution.test.ts`,
  `http-list-source.test.ts`; AC4 `content-repo.test.ts`, `bleeding-edge.test.ts`, `scan-runner.test.ts`;
  AC5 checked in diff review (a doc edit has no runtime test).
- **222** — AC1 `platform.test.ts`; AC2 `scripts/platform-assertions.test.mjs`; AC3 `listeners.test.ts`;
  AC4 `inspector.test.ts`; AC5 full suite at the gate.
- **220** — AC1 `downloads/index.test.ts`, `DownloadsSettingsSection.test.tsx`, flow
  `settings-downloads-section`; AC2 `fetcher.test.ts`, `update-job.test.ts`, `layering.test.ts`,
  `stage-package.test.ts`; AC3 `layering.test.ts`, `fs-utils.test.ts`; AC4 `content-repo.test.ts`,
  `mods/index.test.ts`; AC5 `assemble.test.ts`, `job.test.ts`; AC6 downloads index test + eight bootstrap/repair/mods flows.
- **219** — AC1 `job-runner.test.ts`; AC2 `update-job.test.ts` + flow `jobs-installation-busy`;
  AC3 `job-runner.test.ts`, repair and retail upgrade tests; AC4 "no module job builds its own
  lifecycle"; AC5 `downloads/index.test.ts`, `FailureCauseDetail.test.tsx`; AC6 doc test + 22 downloads/mods flows.

**Manual residue** (reason each; all in `testplan.md`; none holds a story or the sprint open):

- 223 AC3 — real GitHub-runner wall time per shard: measurable only on a pull request into `main`, and
  agents may not open one (org policy).
- 223 AC6 — the `windows-verify` run on GitHub's `windows-latest`: needs a PR or dispatch on GitHub.
  The same commands ran green on the local Windows host.
- 226 AC4 — `npm run verify:release`: not run (Docker daemon down; exceeds the 10-minute call ceiling).
  A named gap, not a declared residue in the story; nothing in the sprint ran it.
- 226 AC6 — the memory note `prettier-repo-wide-churn.md` lives outside the repo; deleted by D4 and
  recorded in Done. Nothing left to walk.

**Criteria covered below the real surface**

- 223 AC5 and AC3 (workflow rehearsal) — `ci:local` and `ci:local:flows` (`act`) were not observed
  (over the call ceiling); the workflow YAML is asserted by unit tests only, never executed.
- 201 AC5 — the persist-failure toast is not driven through the UI (unit tests on the store and shutdown).
- 201 AC2 — cinema and stage-follow disposal are proven by helper tests, not at module level.
- 205, 207, 208, 209 — no user-facing criterion; the listed flows are regression proof, not acceptance
  of a user action.
- 204 AC6 — wire shape changed for handlers that already returned an Outcome (the AC said unchanged).

**Changelog sweep:** `CHANGELOG.md` `## Unreleased` carries entries for 200, 201, 219, 220 (two
lines), 221 and 226; no entry was missing and none was added. 225's i18n fallback change is marginally
user-visible and has none (see Findings); 206 decided against one (a discard-changes toast now shows its params).

## Tier record

| Story     | Ds      | hard Ds | review       | cycles | agents  | build min |
| --------- | ------- | ------- | ------------ | ------ | ------- | --------- |
| 223       | 6       | 1       | default      | 1      | 9       | 34        |
| 226       | 4       | 1       | default      | 1      | 6       | 22        |
| 225       | 17      | 1       | default      | 1      | 23      | 47        |
| 199       | 5       | 1       | default      | 0      | 8       | 6         |
| 200       | 1       | 0       | default      | 1      | 3       | 4         |
| 201       | 12      | 1       | default      | 1      | 16      | 55        |
| 202       | 5       | 1       | default      | 0      | 8       | 13        |
| 203       | 3       | 0       | default      | 1      | 5       | 6         |
| 204       | 7       | 0       | default      | 1      | 10      | 32        |
| 206       | 10      | 0       | default      | 1      | 14      | 23        |
| 205       | 11      | 1       | default      | 1      | 13      | 21        |
| 207       | 13      | 1       | default      | 1      | 17      | 41        |
| 208       | 5       | 1       | default      | 1      | 10      | 22        |
| 209       | 7       | 1       | default+hard | 2      | 12      | 56        |
| 221       | 4       | 0       | default      | 2      | 8       | 12        |
| 222       | 6       | 0       | default      | 1      | 8       | 15        |
| 220       | 8       | 1       | default      | 1      | 13      | 30        |
| 219       | 10      | 1       | default+hard | 3      | 20      | 66        |
| **Total** | **134** | **12**  | 2 hard of 18 | 21     | **203** | **~505**  |

Refine took 10 min; the gate took 2.7 min (short suites) plus 49.8 and 49.4 min of `ui:flows`. The hard
review did find what the default missed in 219 (four real defects: failed mod jobs shown as an unknown
reason; cancel freed the installation while the body still ran; bootstrap retry mutated the record
before admission; no test caught a dropped `exclusive`), but not in 209, where it found doc, comment and
name issues only.
