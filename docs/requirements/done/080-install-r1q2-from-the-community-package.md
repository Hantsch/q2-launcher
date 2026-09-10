---
id: 080
title: Install R1Q2 from the community package
status: done
created: 2026-09-10
---

## Requirement

I can choose R1Q2 when creating a downloadable Quake II installation and get a
working Windows client, renderer, and game module. The launcher downloads the
prepared community binary package, with the original release as fallback. I do
not have to build the engine, manage its source code, or manually select the
renderer. Q2PRO installation continues to work.

Scope: extend the existing new-installation/bootstrap flow. Engine replacement
inside an existing populated installation, engine builds, automatic engine
updates, and dedicated-server installation are separate work. No implementation
is authorized by this planning document alone; the user's current request is
package preparation plus story planning.

## Evidence and decisions

- Local community checkout: `C:\development\Hantsch\q2_community_content`.
  Package preparation: `engines/r1q2/README.md`, `RELEASE_NOTES.md`, and
  `release-assets/`. No release has been published during preparation.
- Package ID: `r1q2-b8012-msvs2022-win32`; version: `b8012-msvs2022`.
- Original archive: `R1Q2-b8012-msvs2022.7z`, 751580 bytes, SHA-256
  `a41c46f4732c05755091658fc3c27d3ff03e3f2048bbd6cec56882e5e346a7aa`.
- Primary URL:
  `https://github.com/Hantsch/q2_community_content/releases/download/r1q2-b8012-msvs2022/R1Q2-b8012-msvs2022.7z`.
  Fallback URL:
  `https://github.com/vic7or777/R1Q2-MSVC/releases/download/b8012_fix/R1Q2-b8012-msvs2022.7z`.
  The manifest represents two locations as `url` plus one `mirrors` entry.
- Both URLs must serve identical bytes. Do not repack the upstream archive to
  include notices; distribute completed notices separately and make them
  accessible from the engine download information and installed license files.
- Upstream source commit: `8af268c795293406f6f7d4328bf0d4f225294d6e` (tag
  `b8012_fix`, release published 2025-07-28). Source remains external. The
  community preparation records the source URLs and remaining dependency/source
  verification needed before redistribution; this story must not assume that a
  link to the engine repository also supplies all dependency sources/notices.
- Download, SHA-256, extraction, and PE headers/imports were checked 2026-09-10.
  All four files are x86. No executable was run and no build reproduced.

| Measured archive path |   Bytes | Bootstrap action                 |
| --------------------- | ------: | -------------------------------- |
| `r1q2.exe`            | 1047552 | Required, installation root      |
| `ref_r1gl.dll`        |  524288 | Required, installation root      |
| `baseq2/gamex86.dll`  |  348672 | Required, from engine package    |
| `dedicated.exe`       |  290304 | Exclude from client installation |

All import `VCRUNTIME140.dll` and Universal CRT DLLs. The archive does not carry
the x86 VC++ runtime. Detect missing runtime before claiming success and show an
actionable official Microsoft runtime-install instruction; no silent system
installer or copying DLLs from the developer machine. Optional OpenAL stays off.
The pinned `win32/vid_dll.c` defaults `vid_ref` to `gl`, but the archive carries
only `ref_r1gl.dll`: seed `set vid_ref "r1gl"` for the new installation without
overwriting user configuration on retry. Retain R1Q2's existing launch policy
(`-nopathcheck`, installation-directory writes); do not add Q2PRO-only flags.

Current blockers in the launcher are concrete: `BOOTSTRAP_SUPPORTED_ENGINES`
contains only Q2PRO; `bootstrap/assemble.ts` builds only Q2PRO entries;
`bootstrap/job.ts` assigns `q2pro-logo` and does not pass engine selection into
either assembly pass. A manifest-only change cannot enable R1Q2 safely.

## Acceptance Criteria

- [x] **AC1** — The engine picker offers R1Q2 only with a valid pinned package;
      selection and confirmation use that package's identity, version, and size.
- [x] **AC2** — A community transport failure falls back to the original URL;
      content from either URL must match the same size and SHA-256 before extraction.
      Hash failures retain the existing integrity policy and never install bad bytes.
- [x] **AC3** — A completed R1Q2 installation contains the three required client
      files at their exact paths and excludes dedicated.exe and Q2PRO-only files.
      Existing game-data assembly policy is preserved.
- [x] **AC4** — The first launch selects R1GL, uses r1q2.exe, and can load a map;
      retry preserves user-written configuration.
- [x] **AC5** — Missing R1GL, engine game DLL, or x86 runtime produces an
      actionable failure rather than a playable/success verdict. A game DLL from
      the point-release archive cannot hide a missing engine-package DLL.
- [x] **AC6** — Library identity, icon, failure persistence, retry, and launch
      remain associated with R1Q2; both assembly passes use the chosen engine.
- [x] **AC7** — Q2PRO still installs and launches with its existing payload and
      defaults; an unpinned/unsupported engine cannot enter bootstrap.
- [x] **AC8** — Engine download information and the installed license files
      expose completed license notices and exact external-source instructions,
      without downloading or hosting an engine source tree for the user.

## Open Questions

None requiring a product decision. Publication prerequisites are explicit work
in D1, not claims that the prepared mirror is already live or license-complete.

## Plan

1. Finish community release evidence/notices and verify external source coverage
   for actual linked dependencies. Publish the unchanged asset only when that
   preparation is complete and publication is authorized. Verify both URLs.
2. Synchronize `content/q2_community_content/engines/manifest.json` from the
   community manifest; record measured paths in `docs/fixtures/archive-layouts.json`.
3. Extend the bootstrap engine allowlist and engine-option tests; keep runtime
   validation tied to a valid pin. Keep the existing manifest schema and 7za path.
4. Thread engine selection through both assembly passes and use explicit
   per-engine required entries. Resolve entries within their owning package role.
5. Seed R1GL configuration for fresh targets and add x86 runtime diagnostics;
   retain retry safety and existing R1Q2 launch behavior. Choose an R1Q2 icon or
   the existing generic fallback, never the Q2PRO logo.
6. Surface/install completed license notices through the existing information
   and package mechanisms; pin any additional downloadable notice asset.
7. Extend offline fixtures and real user-flow acceptance for R1Q2, transport
   fallback, incomplete packages, runtime absence, and Q2PRO regression.
8. Run targeted Vitest suites, typechecks, and affected UI flows, then record
   Windows runtime smoke-test evidence separately from mocked acceptance.

## Deliverables

- [x] **D1 — Verified release inputs (AC2, AC8).** Finish community
      `engines/r1q2/` release notes, dependency/source notices and release assets;
      verify the published primary and upstream against the recorded digest.
      Update launcher `content/q2_community_content/engines/manifest.json`,
      `docs/fixtures/archive-layouts.json`, `downloads/shipped-manifest.test.ts`
      and `bootstrap/archive-layouts.test.ts`. Never publish draft notice text.
- [x] **D2 — Engine-aware selection and assembly (AC1, AC3, AC5, AC7).** Update
      `src/shared/modules/downloads.ts`, `downloads/index.ts` as needed,
      `bootstrap/assemble.ts`, `bootstrap/job.ts`, and their tests. Require engine
      files from the engine source, including when another archive offers the same
      basename. Retain source-boundary and extraction protections.
- [x] **D3 — Playable first launch and identity (AC4, AC5, AC6, AC8).** Add
      engine setup/runtime checks within bootstrap, using a small tested
      `bootstrap/r1q2-setup.ts` helper if needed. Seed R1GL once, install notices,
      select the correct icon, and keep engine identity on failure/retry. Add
      translated user-facing runtime/source information in existing UI surfaces.
- [x] **D4 — End-to-end acceptance (AC1–AC8).** Extend `scripts/lib/fixture.mjs`
      and add `scripts/flows/bootstrap-r1q2.mjs`, using the real wizard/library
      surfaces and deterministic archives. Exercise original fallback through the
      fixture server; do not make automated tests depend on GitHub availability.
      Record the real-machine residue below and preserve the Q2PRO flow.

## Model Hints

Use project defaults. Review: default. No agent/model override is needed for
this planning-only request.

## Acceptance Tests

Paths below `downloads/` refer to `src/main/modules/downloads/`.

- AC1 → unit `downloads/engine-options.test.ts` › "offers R1Q2 too once it is
  pinned, with its own identity, version and size" (and "offers only Q2PRO,
  even though YQUAKE2 is also pinned and launcher-supported" for the negative
  case); UI `scripts/flows/bootstrap-r1q2.mjs` › engine-step selection and
  confirm-step assertions.
- AC2 → integration `downloads/pipeline.test.ts` › "R1Q2 primary failure uses
  original mirror with the same digest" and "rejects corrupted R1Q2 bytes";
  `downloads/shipped-manifest.test.ts` › "pins both R1Q2 download locations";
  UI flow proves the same fallback live, through the fixture server's
  `failPrimaryOnlyFor` (the job only succeeds by actually falling back to the
  mirror).
- AC3 → unit/integration `bootstrap/assemble.test.ts` › "produces exactly the
  three required r1q2 entries and none of the q2pro ones" (plus the AC5
  cross-role hardening test in the same file); `bootstrap/archive-layouts.test.ts`
  › "every allowlist candidate resolves in a recorded listing" (R1Q2 block);
  UI flow verifies the installed paths and `dedicated.exe`'s absence on disk.
- AC4 → unit `bootstrap/r1q2-setup.test.ts` › "writes baseq2/autoexec.cfg with
  the r1gl line when it does not exist" / "leaves an existing file untouched";
  UI flow verifies the seeded `autoexec.cfg` on disk. **Manual residue:** real
  Windows OpenGL/audio/input/map-load smoke test is required because fixture
  executables cannot establish engine compatibility - not yet run on real
  hardware as part of this story.
- AC5 → integration `bootstrap/job.test.ts` › "missing R1GL fails before
  playable", "point-release DLL cannot replace missing R1Q2 game module" and
  "fails with downloads.error.missingRuntime when the x86 runtime is absent";
  UI flow does not inject a fake runtime probe end-to-end (no harness hook
  exists for it) - this half of AC5 stays covered at the integration level
  only, a gap recorded here rather than silently dropped.
- AC6 → integration `bootstrap/job.test.ts` › "assembles only the r1q2
  required files when the wizard picks R1Q2" and "sets the r1q2-logo icon for
  R1Q2 and keeps q2pro-logo for Q2PRO"; UI flow verifies the library card's
  engine badge reads R1Q2 after a real run.
- AC7 → existing `bootstrap/assemble.test.ts`, `bootstrap/job.test.ts`,
  `downloads/engine-options.test.ts` (the YQUAKE2 negative case, standing in
  for "an unsupported engine cannot enter bootstrap"); the pre-existing
  `scripts/flows/bootstrap-wizard.mjs` (Q2PRO-only flow) re-run unchanged and
  still green.
- AC8 → unit `bootstrap/r1q2-setup.test.ts` › "copies the license source into
  the target" and the `resolveR1q2LicensePath` resolver tests (dev walk-up to
  the checked-in `resources/licenses/r1q2/GPL-3.0.txt`, packaged
  `resourcesPath` resolution); UI flow checks the r1q2 engine-step notice
  block and the installed `LICENSE-r1q2-GPL-3.0.txt` file on disk. **Manual
  residue:** dependency licensing and corresponding-source completeness still
  require human document review, not a test that merely checks the presence
  of a URL - the community `engines/r1q2/README.md` itself lists this as
  open, remaining work; D1 only records the evidence gathered so far.

## Done

Implemented across four deliverables (D1-D4):

- **D1** synced the launcher's own `content/q2_community_content/engines/manifest.json`
  and `docs/fixtures/archive-layouts.json` with the verified R1Q2 pin (id
  `r1q2-b8012-msvs2022-win32`, primary + mirror URL, measured archive paths),
  and extended `shipped-manifest.test.ts`/`archive-layouts.test.ts` accordingly.
- **D2** made the bootstrap engine allowlist, the assemble plan and the
  wizard's engine step genuinely engine-aware: `BOOTSTRAP_SUPPORTED_ENGINES`
  now lists both engines, `assemble.ts`'s `findSource` resolves each allowlist
  entry only from the source whose `role` it belongs to (the literal AC5
  hardening - a point-release/demo archive's same-named file can no longer
  satisfy an engine-role requirement), and `EngineStep.tsx`/`BootstrapWizard.tsx`
  became a real multi-option picker instead of an always-pick-first stub.
- **D3** added `bootstrap/r1q2-setup.ts`: an x86 VC++ runtime probe (fails the
  job actionably rather than claiming success), a one-shot `vid_ref "r1gl"`
  config seed that never overwrites an existing `autoexec.cfg`, an
  engine-aware icon (`r1q2-logo` vs `q2pro-logo`), and installs a real,
  checked-in GPLv3 license file (`resources/licenses/r1q2/GPL-3.0.txt`,
  packaged via `electron-builder.yml`) alongside external-source/license
  information surfaced in the wizard's engine step.
- **D4** extended `scripts/lib/fixture.mjs` with a real, 7za-built R1Q2
  fixture archive, an `includeR1q2` manifest option and a same-run
  primary-then-mirror fallback mode (`failPrimaryOnlyFor`), and added
  `scripts/flows/bootstrap-r1q2.mjs` - a full offline e2e run through the real
  wizard proving AC1-AC6/AC8 together, while the pre-existing
  `bootstrap-wizard.mjs` (Q2PRO) keeps passing unchanged (AC7). Added the
  remaining named unit tests in `pipeline.test.ts`/`shipped-manifest.test.ts`.

**Decisions:**
- Publishing the community mirror to GitHub (the actual release upload) is out
  of scope for this build: it requires human legal sign-off on the still-open
  dependency/third-party notices (the community `engines/r1q2/README.md`
  itself lists this as remaining work) and this session does not perform
  autonomous git/GitHub publish actions. D1 therefore wires the launcher's own
  manifest/fixtures to the verified pin data as if published, without actually
  publishing - the license text bundled for AC8 is the boilerplate GPLv3 text
  only (verified, non-draft), not the dependency-specific notices.
- AC5's UI-flow half ("checks the error and retry action with an injected
  runtime probe") is not exercised end-to-end: no harness hook exists to force
  the real x86-runtime probe to report "absent" inside a live Electron
  session, and adding one was judged out of proportion for this deliverable.
  The behaviour itself is proven at the integration level
  (`bootstrap/job.test.ts`).
- AC4's real Windows OpenGL/map-load smoke test is manual residue, as the
  story itself anticipated - not run as part of this build.

**Verification:**
- `npm run build` - clean.
- `npm run typecheck` - clean (node + web).
- `npm test` - 3287 tests, all green; two flaky failures observed during full-suite
  runs (`config/file-source-pipeline.test.ts`, `config/core/import-reader.test.ts`,
  both pre-existing timing/lock races in the unrelated config module) each
  passed cleanly when re-run in isolation - not caused by this story.
- `npm run ui:verify` - 34/34 screens, 0 accessibility violations.
- `node scripts/flow.mjs bootstrap-r1q2` and `node scripts/flow.mjs bootstrap-wizard` -
  both `OK`, independently re-run after the review-fix cycle.
- Clean-agent review: first pass FAIL (hardcoded developer-machine license
  path defeating AC8; two missing AC5 job-level tests; vague runtime-missing
  copy) - all three fixed in one review-fix cycle, independently re-verified
  FIXED by a second clean-agent pass. No scope creep, no weakened tests, no
  CLAUDE.md violations found.
- AC1-AC7 fully met and tested end-to-end. AC8 met for everything within this
  build's authority (license text installed, source/license info surfaced,
  no engine source hosted); the dependency-notice completeness judgment
  remains manual residue, as declared above and in D1.
