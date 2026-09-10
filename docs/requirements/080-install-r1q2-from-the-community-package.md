---
id: 080
title: Install R1Q2 from the community package
status: ready # Planning complete; implementation has not started.
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

- [ ] **AC1** — The engine picker offers R1Q2 only with a valid pinned package;
      selection and confirmation use that package's identity, version, and size.
- [ ] **AC2** — A community transport failure falls back to the original URL;
      content from either URL must match the same size and SHA-256 before extraction.
      Hash failures retain the existing integrity policy and never install bad bytes.
- [ ] **AC3** — A completed R1Q2 installation contains the three required client
      files at their exact paths and excludes dedicated.exe and Q2PRO-only files.
      Existing game-data assembly policy is preserved.
- [ ] **AC4** — The first launch selects R1GL, uses r1q2.exe, and can load a map;
      retry preserves user-written configuration.
- [ ] **AC5** — Missing R1GL, engine game DLL, or x86 runtime produces an
      actionable failure rather than a playable/success verdict. A game DLL from
      the point-release archive cannot hide a missing engine-package DLL.
- [ ] **AC6** — Library identity, icon, failure persistence, retry, and launch
      remain associated with R1Q2; both assembly passes use the chosen engine.
- [ ] **AC7** — Q2PRO still installs and launches with its existing payload and
      defaults; an unpinned/unsupported engine cannot enter bootstrap.
- [ ] **AC8** — Engine download information and the installed license files
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

- [ ] **D1 — Verified release inputs (AC2, AC8).** Finish community
      `engines/r1q2/` release notes, dependency/source notices and release assets;
      verify the published primary and upstream against the recorded digest.
      Update launcher `content/q2_community_content/engines/manifest.json`,
      `docs/fixtures/archive-layouts.json`, `downloads/shipped-manifest.test.ts`
      and `bootstrap/archive-layouts.test.ts`. Never publish draft notice text.
- [ ] **D2 — Engine-aware selection and assembly (AC1, AC3, AC5, AC7).** Update
      `src/shared/modules/downloads.ts`, `downloads/index.ts` as needed,
      `bootstrap/assemble.ts`, `bootstrap/job.ts`, and their tests. Require engine
      files from the engine source, including when another archive offers the same
      basename. Retain source-boundary and extraction protections.
- [ ] **D3 — Playable first launch and identity (AC4, AC5, AC6, AC8).** Add
      engine setup/runtime checks within bootstrap, using a small tested
      `bootstrap/r1q2-setup.ts` helper if needed. Seed R1GL once, install notices,
      select the correct icon, and keep engine identity on failure/retry. Add
      translated user-facing runtime/source information in existing UI surfaces.
- [ ] **D4 — End-to-end acceptance (AC1–AC8).** Extend `scripts/lib/fixture.mjs`
      and add `scripts/flows/bootstrap-r1q2.mjs`, using the real wizard/library
      surfaces and deterministic archives. Exercise original fallback through the
      fixture server; do not make automated tests depend on GitHub availability.
      Record the real-machine residue below and preserve the Q2PRO flow.

## Model Hints

Use project defaults. Review: default. No agent/model override is needed for
this planning-only request.

## Acceptance Tests

Paths below `downloads/` refer to `src/main/modules/downloads/`.

- AC1 → unit `downloads/engine-options.test.ts` › "offers pinned R1Q2 and
  omits missing pins"; UI `scripts/flows/bootstrap-r1q2.mjs` › R1Q2 selection
  and confirmation assertions.
- AC2 → integration `downloads/pipeline.test.ts` › "R1Q2 primary failure uses
  original mirror with the same digest" and "rejects corrupted R1Q2 bytes";
  `downloads/shipped-manifest.test.ts` › "pins both R1Q2 download locations".
- AC3 → unit/integration `bootstrap/assemble.test.ts` › "assembles only the
  R1Q2 client payload"; `bootstrap/archive-layouts.test.ts` › "R1Q2 required
  paths exist in the measured archive"; UI flow verifies installed paths.
- AC4 → unit `bootstrap/r1q2-setup.test.ts` › "seeds R1GL without replacing
  existing configuration"; UI flow verifies the launched executable/arguments.
  **Manual residue:** real Windows OpenGL/audio/input/map-load smoke test is
  required because fixture executables cannot establish engine compatibility.
- AC5 → integration `bootstrap/job.test.ts` › "missing R1GL fails before
  playable", "point-release DLL cannot replace missing R1Q2 game module",
  and "missing x86 runtime gives a recoverable prerequisite failure";
  UI flow checks the error and retry action with an injected runtime probe.
- AC6 → integration `bootstrap/job.test.ts` › "both R1Q2 assembly passes and
  retries preserve engine identity"; UI flow verifies badge, icon, failure
  recovery and library entry.
- AC7 → existing `bootstrap/assemble.test.ts`, `bootstrap/job.test.ts`,
  `downloads/engine-options.test.ts`, `scripts/flows/bootstrap-wizard.mjs`;
  preserve assertions for Q2PRO and a separate unsupported-engine fixture.
- AC8 → integration `bootstrap/r1q2-setup.test.ts` › "installs pinned source
  and license notices without engine sources"; UI flow checks the accessible
  source/license information. **Manual residue:** dependency licensing and
  corresponding-source completeness require document review, not a test that
  merely checks the presence of a URL. D1 records the evidence.

## Done

Not implemented. Package preparation and this plan were created on 2026-09-10.
