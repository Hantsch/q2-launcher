---
id: 076
title: The bootstrap assembles the real archives, not the fixtures
status: done
created: 2026-09-08
---

## Requirement

[[074]]'s bootstrap wizard fails on a real machine. Every download succeeds and verifies, every
extraction exits 0, and the run still ends with `downloads.error.installationNotPlayable` and a
target directory that is empty after cleanup.

The cause is not the network and not the extractor: `assemble.ts`'s allowlist
([assemble.ts:52](../../src/main/modules/downloads/bootstrap/assemble.ts#L52)) was written
against [[074]] D8's synthetic fixture archives (`scripts/lib/fixture.mjs`), and the real
archives are laid out differently. The file's own doc comment already flags this as "still
unverified residue" and carries a `TODO` about the engine's game-module filename — this story is
that residue coming due.

Measured on 2026-09-08 against the three archives the shipped manifest actually pins, extracted
with the vendored `resources/bin/7za.exe`:

| Package | Allowlist expects | Real layout | Result |
| --- | --- | --- | --- |
| `q2-314-demo-x86.exe` | `baseq2/pak0.pak` | `Install/Data/baseq2/pak0.pak` (49.9 MB) | not copied |
| `q2pro-client_win64_x64.zip` | `q2pro.exe` | `q2pro64.exe` at the zip root | not copied |
| `q2pro-client_win64_x64.zip` | `baseq2/gamex86_64.dll` | `baseq2/gamex86_64.dll` | correct |
| `q2-3.20-x86-full-ctf.exe` | `baseq2/pak2.pak` | `baseq2/pak2.pak` | correct |
| `q2-3.20-x86-full-ctf.exe` | *(not in the allowlist)* | `baseq2/pak1.pak` also ships | never copied |
| either package | `players/` at the source root | `baseq2/players/` in both | not copied |
| either package | `video/` at the source root | present in neither | nothing to copy |

The demo *is* fully extractable — the earlier suspicion that its InstallShield `data1.cab` blocks
7za is wrong; that CAB is a 2.5 KB stub and the payload sits uncompressed under `Install/Data/`.
So no new extraction tooling is needed. What is needed is an allowlist that matches reality, and
a failure that says which package came up empty instead of only reporting the verdict at the very
end (that half is [[075]]'s job; the two stories meet at the same run).

AC8 of [[074]] stays untouched: the fix is more literal entries, never a recursive copy or a
search — `ctf/`, `xatrix/` and `rogue/` must still be impossible to pull in.

## Acceptance Criteria

- [x] **AC1** — A bootstrap run against the three really pinned archives produces an installation
      whose `inspectInstallation` verdict is neither `invalid` nor `missing`, containing at
      minimum the engine binary, `baseq2/pak0.pak`, `baseq2/pak1.pak` and `baseq2/pak2.pak`.
- [x] **AC2** — The allowlist covers the real source paths from the table above; every added
      entry is a literal relative path, and nothing outside the allowlist is ever read or copied.
- [x] **AC3** — The engine binary is copied under the name the target expects, whatever the
      release zip calls it — `q2pro64.exe` today, without hard-coding an assumption that the two
      names always agree.
- [x] **AC4** — `players/` is sourced from `baseq2/players/` and lands at `baseq2/players/`; the
      absence of `video/` in every real archive is a normal outcome, not a failure.
- [x] **AC5** — When an allowlisted file required for playability is missing from every source
      dir, the job fails naming *that package*, not the generic end-of-run verdict — and the
      reason survives into [[075]]'s diagnostics.
- [x] **AC6** — [[074]] D8's fixture archives are re-laid-out to mirror the real ones, so
      `scripts/flows/bootstrap-wizard.mjs` stops passing against a layout that does not exist.
      A fixture that disagrees with reality is what let this ship.
- [x] **AC7** — A test pins each real archive's relevant layout facts (the paths in the table),
      so a future manifest re-pin that changes a layout fails a test instead of a user's install.

## Open Questions

- ~~Does `q2pro-client_win64_x64.zip` also ship `q2ded64.exe`, and does the launcher want it?~~
  answered → Decisions (Sprint)
- ~~Should `baseq2/q2pro.menu` be part of the allowlist?~~ answered → Decisions (Sprint)
- ~~AC7 needs the archives available in CI.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** `q2ded64.exe` allowlisting: client only — do not allowlist the dedicated-server
  binary; the measured listing didn't show it and the launcher only needs to run the client.
- **(User)** `baseq2/q2pro.menu`: allowlist it — it ships alongside the engine binary and DLL in
  the same package.
- **(User)** AC7 CI data source: checked-in tiny listings — record the relevant layout facts (the
  paths from the table) as small checked-in fixtures/snapshots, no large binaries in the repo, so
  the test always runs (no offline skip needed).
- **Candidate lists, not a search:** an allowlist entry gets an ordered list of *literal* `from`
  candidates (`q2pro.exe`, then `q2pro64.exe`; `baseq2/pak0.pak`, then `Install/Data/baseq2/pak0.pak`)
  and the first that exists wins — more literal entries is exactly what AC2/AC8 permit, while a
  single hard-coded path would break the moment a release renames or re-nests one file.
- **The target name comes from `ENGINE_DEFINITIONS`:** the engine entry's `to` is q2pro's
  `executables[0]` (`q2pro.exe`, `src/shared/types/engine.ts:99`), so "the name the target expects"
  (AC3) is read from the one table `inspectInstallation` already detects with, not written twice.
- **Detection is not widened:** `q2pro64.exe` is *not* added to `ENGINE_DEFINITIONS.markers` — this
  story assembles an installation, and changing how the launcher classifies folders a user added
  by hand is a different story with a different blast radius.
- **`sourceDirs` stays `string[]`:** the package a missing file belongs to is expressed as a
  `role` (`engine` | `demo` | `point-release`) on the allowlist entry and resolved to a
  `ManifestPackage.id` by `job.ts` (which already holds that mapping), so every source dir keeps
  being searched in order and "first found wins" tolerance is unchanged.
- **AC5 needs a new error key, not prose:** `downloads.error.packageIncomplete` joins
  `DOWNLOADS_ERROR_KEYS` and carries `params: { packageId }` — `Job.error`/`DownloadFailure.error`
  already carry `params`, `FailureLogEntry` derives its known-key set from `DOWNLOADS_ERROR_KEYS`,
  so a manifest package id (data, not prose) crosses IPC and the sentence stays in `en.json`.
- **AC5's "survives into 075's diagnostics" needs no 075 shape change:** `failed()`
  ([job.ts:571](../../src/main/modules/downloads/bootstrap/job.ts#L571)) already warns through the
  teed `BootstrapLog`, so the missing paths land in `DownloadDiagnostics.logTail` and the key in
  `errorKey` — both already in the copied report.
- **Required vs. optional:** the engine binary, `baseq2/gamex86_64.dll` and `baseq2/pak{0,1,2}.pak`
  are `required` (AC1's playability list plus the DLL without which no map loads);
  `baseq2/q2pro.menu`, `players/` and `video/` are not — AC4 makes an absent `video/` a normal
  outcome.
- **AC1 is proven by fixture-mirrors-reality, not by a live download:** the offline flow runs the
  real job against fixtures re-laid-out to the measured layouts (AC6) and a checked-in listing test
  pins that those layouts are the real ones (AC7); the 190 MB run against the public mirrors stays
  a manual residue, per the user's "no large binaries in the repo" decision.
- **Fixture parity is machine-checked:** `scripts/lib/fixture.mjs` exports its bootstrap layout as
  data and the listing test asserts every fixture path is a recorded real path — otherwise AC6 is
  a promise a reviewer has to keep, which is precisely what let this ship.
- **Listings live in `docs/fixtures/archive-layouts.json`**, read the way
  `shipped-manifest.test.ts` reads the shipped manifests — checked-in test data does not belong in
  `src/main` (it would enter the production bundle) nor in `content/`, which mirrors published
  content.

## Plan

Bottom-up: the allowlist first, then what it reports, then the job's failure, then the fixtures and
the listing that keeps them honest.

1. **Allowlist** — `bootstrap/assemble.ts`: `AssembleFileEntry` gains `from: string[]` (ordered
   literal candidates), `to`, `role` and `required`. Entries per the Requirement's table, `to` for
   the engine taken from `ENGINE_DEFINITIONS`. `GLOB_DIRS` becomes candidate-listed too
   (`baseq2/players` → `baseq2/players`, `baseq2/video` → `baseq2/video`).
2. **Reporting** — `assembleInstallation` additionally returns `missingRequired: { role, from }[]`;
   nothing else changes about how it copies (no recursion, ever).
3. **Failure** — new `downloads.error.packageIncomplete` in `src/shared/modules/downloads.ts` +
   `bootstrap/errors.ts`; `job.ts` fails right after the core assemble pass when
   `missingRequired` is non-empty, with `params: { packageId }` resolved from the role, and
   `failed()` gains a `params` argument. `en.json` gets the sentence.
4. **Fixtures** — `scripts/lib/fixture.mjs`'s bootstrap packages are re-laid-out to the real
   shapes (`Install/Data/baseq2/pak0.pak`, `q2pro64.exe`, `baseq2/pak1.pak`, `baseq2/players/`,
   no `video/`), exported as a layout constant; `scripts/flows/bootstrap-wizard.mjs`'s on-disk
   assertions follow (pak0+pak1+pak2 and `q2pro.exe` in the target).
5. **Listing** — `docs/fixtures/archive-layouts.json` records id/sha256/paths per pinned package;
   `bootstrap/archive-layouts.test.ts` cross-checks it against the shipped manifests, the
   allowlist and the fixture layout.
6. **Named-failure flow** — `scripts/flows/bootstrap-incomplete-package.mjs` runs the real job
   against a package set whose demo archive contributes nothing, and asserts the named reason on
   the running step and the Downloads failure card.

## Deliverables

- [x] **D1 — the allowlist matches the real archives.**
  Files: `src/main/modules/downloads/bootstrap/assemble.ts`,
  `src/main/modules/downloads/bootstrap/assemble.test.ts`.
  Candidate-list `from`, `role`, `required`; all entries from the Requirement's table incl.
  `baseq2/pak1.pak` and `baseq2/q2pro.menu`; engine `to` from `ENGINE_DEFINITIONS`; `players`
  sourced from `baseq2/players`, `video` from `baseq2/video`, absent `video/` is not an error.
  Tests in the same file (extend the existing suite, keeping its AC8 negative assertions):
  › "the allowlist covers the real source layouts and copies nothing else", › "the engine binary
  lands as q2pro.exe whatever the zip calls it", › "players comes from baseq2/players and a
  missing video/ is a normal outcome".
  Acceptance: AC2, AC3, AC4 green; every existing assemble test still green.

- [x] **D2 — assemble says what is missing.**
  Files: `src/main/modules/downloads/bootstrap/assemble.ts`,
  `src/main/modules/downloads/bootstrap/assemble.test.ts`.
  `AssembleInstallationResult.missingRequired: { role, from: string[] }[]`; optional entries never
  appear in it. Test › "a source set without pak0 reports the demo role as missing required".
  Acceptance: the copy behaviour is byte-identical to D1's; only the return value grows.

- [x] **D3 — the job fails naming the package.**
  Files: `src/shared/modules/downloads.ts`, `src/main/modules/downloads/bootstrap/errors.ts`,
  `src/main/modules/downloads/bootstrap/job.ts`,
  `src/renderer/src/i18n/locales/en.json`,
  `src/main/modules/downloads/bootstrap/job.test.ts`.
  Mirror `PACKAGE_UNAVAILABLE` in `errors.ts` and the `packageUnavailable` entry in
  `DOWNLOADS_ERROR_KEYS`/`en.json`. `failed(key, reason, params?)`; the new check sits between the
  core assemble pass and the first revalidation. Test in `job.test.ts` › "a package that
  contributes no required file fails the job naming that package" (asserts `error.key`,
  `error.params.packageId`, and that the failure's log tail names the missing paths).
  Acceptance: AC5's main-side half; cleanup/cancel behaviour unchanged.

- [x] **D4 — the fixtures mirror the real archives.**
  Files: `scripts/lib/fixture.mjs`, `scripts/flows/bootstrap-wizard.mjs`.
  Re-lay-out the three fixture archives (`q2pro64.exe` + `baseq2/{gamex86_64.dll,q2pro.menu}`;
  `Install/Data/baseq2/pak0.pak` + `Install/Data/baseq2/players/…`; `baseq2/pak1.pak` +
  `baseq2/pak2.pak` + `baseq2/players/…` + the `ctf`/`xatrix`/`rogue` payloads); export the layout
  as `BOOTSTRAP_FIXTURE_LAYOUT`. Flow: assert `q2pro.exe`, `baseq2/pak0.pak`, `baseq2/pak1.pak`,
  `baseq2/pak2.pak` on disk and keep the AC8 negative assertions.
  Run: `npm run ui:flow -- bootstrap-wizard`.
  Acceptance: AC1's offline half and AC6.

- [x] **D5 — the checked-in listing keeps fixture and reality in step.**
  Files: `docs/fixtures/archive-layouts.json` (new),
  `src/main/modules/downloads/bootstrap/archive-layouts.test.ts` (new).
  Mirror `src/main/modules/downloads/shipped-manifest.test.ts` for the repo-root file reading.
  The JSON records, per pinned package: `id`, `sha256`, `measuredOn`, `paths[]` (the Requirement's
  table). Tests: › "the recorded listings match the shipped manifests' pinned ids and digests",
  › "every allowlist candidate resolves in a recorded listing", › "every bootstrap fixture path is
  a recorded real path".
  Acceptance: AC7, plus AC6's machine-checked half.

- [x] **D6 — the named failure on the real surface.**
  Files: `scripts/flows/bootstrap-incomplete-package.mjs` (new), `scripts/lib/fixture.mjs`
  (an option that builds the demo archive without its pak), mirroring
  `scripts/flows/bootstrap-wizard.mjs` for the loopback server, `setup()`/`teardown()` and the
  wizard walk.
  Asserts the running step shows the reason naming the demo package and that the Downloads tab's
  failure card carries the same key.
  Run: `npm run ui:flow -- bootstrap-incomplete-package`.
  Acceptance: AC5's user-facing half.

## Model Hints

- D3 → `deliverable-hard` — it inserts a new terminal exit into `job.ts`'s ordered
  download/assemble/revalidate/cleanup sequence, where a misplaced `return` silently changes
  cancel semantics or leaves a half-built installation registered.
- D1, D2, D4, D5, D6 → default.
- Review: → `story-review-hard` — this story exists because a wrong allowlist passed a fully green
  suite whose fixture agreed with it, so the review must check fixture-vs-listing-vs-allowlist
  parity, not only that the diff is internally consistent.

## Acceptance Tests

- **AC1** → e2e `scripts/flows/bootstrap-wizard.mjs` › "the target holds q2pro.exe plus
  baseq2/pak0, pak1 and pak2 and a non-invalid verdict" (D4), against fixtures pinned to the real
  layouts by unit `src/main/modules/downloads/bootstrap/archive-layouts.test.ts` › "every
  bootstrap fixture path is a recorded real path" (D5).
  **manual residue:** the same run against the live 190 MB archives on the public mirrors is not
  automated — it depends on two external mirrors and would download ~190 MB per suite run; the
  listing test is what makes the offline run equivalent, and a re-pin that changes a layout fails
  it.
- **AC2** → unit `src/main/modules/downloads/bootstrap/assemble.test.ts` › "the allowlist covers
  the real source layouts and copies nothing else" plus the suite's retained
  `ctf`/`xatrix`/`rogue` negative assertions (D1); unit
  `…/bootstrap/archive-layouts.test.ts` › "every allowlist candidate resolves in a recorded
  listing" (D5).
- **AC3** → unit `…/bootstrap/assemble.test.ts` › "the engine binary lands as q2pro.exe whatever
  the zip calls it" (D1); e2e `scripts/flows/bootstrap-wizard.mjs` › the on-disk `q2pro.exe`
  assertion (D4).
- **AC4** → unit `…/bootstrap/assemble.test.ts` › "players comes from baseq2/players and a missing
  video/ is a normal outcome" (D1); e2e `scripts/flows/bootstrap-wizard.mjs` › the on-disk
  `baseq2/players` assertion with the extras toggle on (D4).
- **AC5** → unit `…/bootstrap/assemble.test.ts` › "a source set without pak0 reports the demo role
  as missing required" (D2); unit `…/bootstrap/job.test.ts` › "a package that contributes no
  required file fails the job naming that package" (D3); e2e
  `scripts/flows/bootstrap-incomplete-package.mjs` › "the failure names the demo package on the
  running step and on the Downloads card" (D6).
- **AC6** → e2e `scripts/flows/bootstrap-wizard.mjs`, run end to end against the re-laid-out
  fixtures (D4); unit `…/bootstrap/archive-layouts.test.ts` › "every bootstrap fixture path is a
  recorded real path" (D5).
- **AC7** → unit `…/bootstrap/archive-layouts.test.ts` › "the recorded listings match the shipped
  manifests' pinned ids and digests" and › "every allowlist candidate resolves in a recorded
  listing" (D5).

## Done

D1–D6 replaced `assemble.ts`'s guessed allowlist with one matching the three really-pinned
archives (candidate `from` lists, `role`/`required`, engine target read from
`ENGINE_DEFINITIONS`), taught `assembleInstallation` to report `missingRequired`, taught
`job.ts` to fail naming the specific package (`downloads.error.packageIncomplete`) before the
first revalidation, re-laid-out the fixture archives and the two e2e flows to match, and added
`docs/fixtures/archive-layouts.json` + `archive-layouts.test.ts` as the checked-in listing that
keeps the allowlist, the fixture and the shipped manifests honest against each other.

**Commit message:** `076: bootstrap assembles the real archives, not the fixtures`

**Resumed build:** this run picked up after an interruption. All six deliverables were already
implemented; the story's `## Done` section was empty and a review-fix cycle for finding F1 had a
`started` progress line with no matching `done`. Investigation showed F1's actual code fix
(`PRUNABLE_TARGET_DIRS` in `job.ts` corrected from stale root-level `players`/`video` to
`baseq2/players`/`baseq2/video`) was already applied and correct, but its regression test helper
(`breakTargetOnSecondValidate` in `job.test.ts`) had been written and left unused (unread, causing
a `tsc` `TS6133` failure) — the review-fix was interrupted between writing the fix and finishing
its test. Completed that: added the missing test
"cleans up baseq2/players fully when the run fails after the extras pass (F1 regression)",
confirmed it fails against the pre-fix code and passes against the fix.

**Fresh clean-agent review (`story-review-hard`):** verdict **PASS**, 7/7 acceptance criteria
met, 5 non-blocking findings (F1–F5, review's own numbering, unrelated to the F1 above except by
coincidence of name):
- **F1 (fixed)** — `GLOB_DIRS` (`baseq2/players`/`baseq2/video`) sat outside `buildAssemblePlan()`
  and so was never cross-checked against `archive-layouts.json` at all, unlike the fixed
  allowlist entries. Fixed: exported `GLOB_DIRS` from `assemble.ts` and added
  `archive-layouts.test.ts` › "every GLOB_DIRS candidate resolves in a recorded listing, except
  the documented video/ absence" (treats `baseq2/video`'s absence from every listing as the
  positive, AC4-required fact it is, not a gap in coverage).
- **F2 (reviewed, not changed)** — the reviewer flagged that `archive-layouts.json` records the
  demo's players dir at `Install/Data/baseq2/players` while the Requirement's summary table says
  "baseq2/players/ in both" archives. Checked against `scripts/lib/fixture.mjs`'s D4 comment
  (`buildBootstrapPackages`'s `demo` builder), which explicitly attributes the nested path to the
  same 2026-09-08 measurement and to the InstallShield demo's own layout (consistent with the
  demo's `pak0.pak` also living under `Install/Data/baseq2/`) — and against the Plan section's D1
  line, which specifies the `GLOB_DIRS` candidate as exactly `baseq2/players` (no `Install/Data`
  alternative), matching what shipped. The table's terse "in both" is summary prose, not a second
  measurement; `archive-layouts.json` is the literal recording and is internally consistent with
  the fixture and the Plan. Functionally inert either way: the entry is optional
  (`required: false`) and the point-release package supplies a directly-reachable
  `baseq2/players`, so "first found wins" already covers it. No real archives are available in
  this environment to re-measure and settle the wording gap outright (same constraint as the
  Decisions section's "no large binaries in the repo").
- **F3 (fixed)** — `archive-layouts.test.ts` only checked fixture-paths-are-recorded (one
  direction); a fixture that silently stopped writing a recorded real path would still pass.
  Added the reverse test, "every recorded real path is mirrored in the bootstrap fixture".
- **F4 (no change, already documented)** — `baseq2/q2pro.menu` is allowlisted by Sprint Decision,
  not measurement, and is deliberately excluded from the listing check; already commented at
  `archive-layouts.test.ts`'s "every allowlist candidate resolves in a recorded listing".
- **F5 (no change, accepted as-is)** — `job.test.ts`'s harness fixture still uses the flat
  pre-076 demo layout (`baseq2/pak0.pak`) for most of its scenarios, exercising only the first
  `from` candidate; the nested real layout and every candidate's fallback order are proven at the
  unit level in `assemble.test.ts` and end-to-end in `scripts/flows/bootstrap-wizard.mjs`, so this
  is narrower framing in one comment, not a coverage hole.
- No weakened/deleted tests, no scope creep, no correctness bugs or CLAUDE.md guardrail
  violations found. The review separately swept for any other stale root-level
  `players`/`video` assumption beyond `PRUNABLE_TARGET_DIRS` and found none (`NON_GAME_DIRS` in
  `src/shared/constants.ts` is an unrelated hand-added-install exclusion list).

**Verification (re-run after the F1/F3 fixes):**
- `npm run build` — clean.
- `npm test` — 152 files / 3110 tests passed (2 new tests added to `archive-layouts.test.ts`; the
  F1 regression test in `job.test.ts` included).
- `npm run typecheck` — clean (the unused-helper `TS6133` from the interrupted run is resolved).
- `npm run ui:verify` — 68/68 screens, 0 axe violations.
- `npm run ui:flow -- bootstrap-wizard` — OK (AC1's offline half, AC3, AC4, AC6).
- `npm run ui:flow -- bootstrap-incomplete-package` — OK (AC5's user-facing half).
- The `assemble.ts`/`archive-layouts.test.ts` edits made after the e2e runs only add an `export`
  keyword to an already-existing constant and new test cases — no production-code behaviour
  changed, so the e2e results above remain valid and were not re-run a second time.

**AC → test mapping, as verified:**
- AC1 → e2e `bootstrap-wizard.mjs` (passed) against fixtures pinned by
  `archive-layouts.test.ts` › "every bootstrap fixture path is a recorded real path" (passed).
  Manual residue unchanged: the live 190 MB run against the public mirrors is not automated.
- AC2 → unit `assemble.test.ts` › "the allowlist covers the real source layouts and copies
  nothing else" + retained `ctf`/`xatrix`/`rogue` negatives (passed); `archive-layouts.test.ts` ›
  "every allowlist candidate resolves in a recorded listing" (passed) and, for the glob entries,
  the new "every GLOB_DIRS candidate resolves in a recorded listing…" (passed).
- AC3 → unit `assemble.test.ts` › "the engine binary lands as q2pro.exe whatever the zip calls
  it" (passed); e2e `bootstrap-wizard.mjs` on-disk `q2pro.exe` assertion (passed).
- AC4 → unit `assemble.test.ts` › "players comes from baseq2/players and a missing video/ is a
  normal outcome" (passed); e2e `bootstrap-wizard.mjs` `baseq2/players` assertion with extras on
  (passed).
- AC5 → unit `assemble.test.ts` › "a source set without pak0 reports the demo role as missing
  required" (passed); unit `job.test.ts` › "a package that contributes no required file fails the
  job naming that package" (passed); e2e `bootstrap-incomplete-package.mjs` (passed).
- AC6 → e2e `bootstrap-wizard.mjs` end to end against re-laid-out fixtures (passed); unit
  `archive-layouts.test.ts` › "every bootstrap fixture path is a recorded real path" (passed) and
  the new reverse-direction "every recorded real path is mirrored in the bootstrap fixture"
  (passed).
- AC7 → unit `archive-layouts.test.ts` › "the recorded listings match the shipped manifests'
  pinned ids and digests" and "every allowlist candidate resolves in a recorded listing" (both
  passed).

**Open points:** none blocking. F2 above is a documentation-wording ambiguity in the Requirement's
summary table versus the more precise checked-in listing, functionally inert given the optional/
first-found-wins tolerance; resolving it fully would need re-measuring the real demo archive,
which is out of scope per the Decisions section's no-large-binaries constraint.
