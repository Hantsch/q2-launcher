---
id: 101
title: a linux release ships and updates itself
status: done # draft -> ready -> in-progress -> done
created: 2026-09-21
---

## Requirement

A user on Linux downloads a packaged launcher, installs Quake II with it, and is carried forward by
the same update flow a Windows user gets: the launcher notices a new version, the user chooses when
to take it, and it restarts into it.

This is the second half of Linux support and the risky half. Story 100 makes the launcher *work* on
Linux when run from source; this one makes it something a stranger can download. It touches two
things that currently have exactly one proven configuration each — the release ritual
(`scripts/release.mjs`, `scripts/lib/release/artifacts.mjs`, `.github/workflows/release.yml`,
`electron-builder.yml`) and the update path (`electron-updater`, `latest.yml`).

**Scope cut, 2026-09-21.** The engine-supply obligation — upstream `q2pro/q2pro` publishes no
Linux binary, so the project would have to compile and mirror one itself, forever — is a separate
concern with its own trust and maintenance decision, and it is now story [[102]]. What is left
here is self-contained and shippable on its own: a Linux user downloads a packaged launcher that
self-updates and manages a Q2PRO they already have, which is exactly the outcome story 100's
`none-for-platform` path was built to make coherent. Evidence for the engine question:
[linux-support-analysis.md](../linux-support-analysis.md) §3 B1.

The release-side traps are already documented in the code that will have to change:
`win.artifactName` in `electron-builder.yml` carries a long comment about why a space in the
artifact name breaks the URL `electron-updater` resolves — and the `linux:` block below it is
marked untested and has no `artifactName` at all. `collectAssets` hardcodes the four Windows assets
and *throws* on any set it does not recognise, which is correct behaviour that will refuse the
first multi-platform build.

## Acceptance Criteria

> **AC1 and AC2 moved out to story [[102]]** (engine supply — build and mirror a Linux Q2PRO)
> when Q1 was resolved on 2026-09-21. The numbering below is left untouched so every reference
> to AC3–AC8 in this file, in `docs/linux-support-analysis.md` and in the deliverables keeps
> pointing at the same criterion.

- [x] **AC3** — One release run produces both the Windows and the Linux artifacts. The asset check
      knows both sets, still refuses to publish when any expected file is missing, and names
      exactly which one.
- [x] **AC4** — The Linux artifact's file name follows the same hyphenated pattern the Windows one
      does, so the name written into the update metadata, the name on disk and the name of the
      uploaded release asset are the same string.
- [x] **AC5** — `latest-linux.yml` is published alongside `latest.yml`; neither overwrites or
      invalidates the other, and a Windows client never resolves the Linux metadata or vice versa.
- [x] **AC6** — A packaged Linux build notices a new version on its daily check, and the user can
      choose to take it: it downloads, the launcher restarts, and it comes back up as the new
      version. `linux-update.yml` has run green on real CI.
- [x] **AC7** — About shows the real release notes for the running version on Linux, as it does on
      Windows. `linux-verify.yml` has run green on real CI.
- [x] **AC8** — The UI verification harness runs against the packaged Linux build and produces the
      screenshot set and the axe-core accessibility report it produces on Windows. `linux-verify.yml`
      has run green on real CI.

## Open Questions

All four resolved 2026-09-21.

- [x] **Q1 — Who owns the Linux Q2PRO build?** → **Split it out.** AC1/AC2 leave this story and
      become story [[102]], where the "is a self-compiled binary acceptable provenance, and who
      rebuilds it when upstream moves" decision is taken on its own. 101 is the launcher's release
      and update path and nothing else.
- [x] **Q2 — AppImage only?** → **Yes, AppImage only.** It is the only target of the three that
      self-updates, which AC6 requires. deb/rpm mean distro packaging with no self-update; a
      Flatpak would sandbox the launcher itself, which conflicts with managing install trees
      anywhere on disk. The inherited default is now a deliberate choice.
- [x] **Q3 — 32-bit or ARM?** → **No: x86_64 only.** One Linux artifact, no `arch` discriminator
      in the manifest. aarch64 can become another row later if anyone asks.
- [x] **Q4 — Who runs the real acceptance?** → **CI does, against a real packaged artifact.** An
      `ubuntu-latest` job builds two AppImages, serves the newer one as a local update feed, runs
      the older one under xvfb and asserts it comes back as the new version. No human in the loop,
      no manual residue. See D6, and the locality note at the foot of `## Acceptance Tests`.

## Plan

**What story 100 already landed**, so this story does not: the manifest's `platforms` field and
per-platform `pinned` resolution, `7zz` fetched by `scripts/fetch-7za.mjs`, the `linux:`
`extraResources` block, and a test suite that is green on Linux. Nothing in `src/main` needs a
platform branch for updates either — `electron-updater` selects `AppImageUpdater` itself, and
`src/main/lib/release-notes.ts` bundles `CHANGELOG.md` at build time via Vite `?raw`, so AC7 is
already true in code and only needs proving on the real surface.

Four things are genuinely missing:

1. **No `package:linux`, and `linux:` has no `artifactName`** (`electron-builder.yml:81`), so it
   falls back to the spaced `productName` — precisely the trap `win.artifactName`'s comment at
   line 64 documents at length. Watch out: electron-builder resolves `${arch}` to `x86_64` for
   AppImage, not `x64`.
2. **`expectedAssets` is a hardcoded four-file Windows list** (`artifacts.mjs:46`) and
   `collectAssets` throws on any other set — correct behaviour that will refuse the first
   two-platform build. It needs a platform dimension.
3. **The release is one `windows-latest` job** (`release.yml:34`) calling `package:win`
   (`release.mjs:334`). An AppImage cannot be built there, and Wine-on-Linux for the Windows half
   would change the one configuration that is proven. So the workflow grows to three jobs —
   `plan` (ubuntu, decides the version), `build-linux` (ubuntu, builds at that version, uploads
   the artifacts), `release` (windows, downloads them, builds Windows, checks *both* sets, tags
   and publishes once). The Linux files are staged into `release/<version>/` **after** the Windows
   build and **before** the asset check, so AC3's "refuses when any expected file is missing" is
   true for the Linux half too rather than a second upload nobody gates.
4. **The UI harness only ever launches `out/main/index.js`** through the repo's own Electron
   (`harness.mjs:272`). Both AC6 and AC8 need a real packaged AppImage: `isPackaged` gates the
   entire update service (`service.ts:262`), there is no `dev-app-update.yml` and no
   `setFeedURL` anywhere, so there is no dev shortcut — which is the point.

**How D6 gets an honest oracle.** A fresh `--user-data-dir` means `lastSuccessAt` is null, which
`isWindowOpen()` (`service.ts:435`) reads as "due" — so the startup check fires on first launch and
*is* the daily check AC6 names. The feed is redirected without touching app code, by building with
`-c.publish.provider=generic -c.publish.url=http://127.0.0.1:<port>/`, which electron-builder writes
straight into `app-update.yml`. After `update:installAndRestart` the AppImage re-execs itself via
`$APPIMAGE` and Playwright's connection dies, so the assertion cannot be in-process: the app logs
its version at boot and the test polls the log file for the new one.

Order: D1 → D2 → D3 (release path), D4 → D5 (harness + screenshots), D6 (update round-trip, needs
D1 and D4).

## Deliverables

- [x] **D1 — a Linux artifact has a name the update path can resolve.**
      `package.json` (add `package:linux`, mirroring the existing `package:win` line exactly, with
      `electron-builder --linux`), `electron-builder.yml` (add `linux.artifactName`, hyphenated,
      with a why-comment pointing at the `win.artifactName` comment above it and naming the
      `${arch}` → `x86_64` quirk), `scripts/lib/release/wiring.test.mjs` (extend — it already
      asserts `win.artifactName` against `artifacts.mjs`; add the mirrored Linux assertion).
      *Acceptance:* `npm run package:linux` on a Linux machine or CI produces a file whose name
      carries no space and starts with `Q2-Launcher-`. Covers AC4.

- [x] **D2 — the asset check knows two platforms.**
      `scripts/lib/release/artifacts.mjs` (give `expectedAssets`/`collectAssets` a platform
      dimension; keep the stable-order contract and the throw-naming-exactly-what-is-missing
      behaviour), `scripts/lib/release/artifacts.test.mjs` (extend — mirror the existing
      Windows-set tests).
      **Do not guess the Linux file list.** The comment at `artifacts.mjs:31-38` records that
      expecting a phantom fifth Windows file made every real build refuse; confirm the AppImage
      set (`.AppImage`, `latest-linux.yml`, and whether a `.AppImage.blockmap` is actually
      emitted) against one real `electron-builder --linux` run before fixing it.
      *Acceptance:* a directory missing only the AppImage throws naming only the AppImage.
      Covers AC3 (check half) and AC5.

- [x] **D3 — one run publishes both.**
      `scripts/release.mjs` (a `--print-plan` mode that runs `planRelease` and prints JSON without
      writing or building, so the `plan` job can decide the version and a `ReleaseRefused` costs no
      build; plus a `stageExtraAssets` injected dep that copies `RELEASE_EXTRA_ASSETS_DIR` into
      `release/<version>/` between `runBuild()` and `collectAssets()`), `scripts/release.test.mjs`
      (extend — it already injects stub deps and asserts ordering; add the staging step),
      `.github/workflows/release.yml` (the three jobs from the Plan),
      `scripts/lib/release/wiring.test.mjs` (extend — it already reads the real workflow file),
      `CHANGELOG.md` + `README.md` (a Linux build is a user-facing change and the download section
      names it; `wiring.test.mjs` already asserts README's release wording).
      *Acceptance:* a dry run produces, from one invocation, an asset list containing both
      platforms' files; deleting one Linux file makes it refuse and name that file.
      Covers AC3 (one-run half).

- [x] **D4 — the harness can launch a packaged app.**
      `scripts/lib/harness.mjs` (an `executablePath` route through `launchApp`/`withApp`: when
      given, pass it to `_electron.launch` and skip `ensureBuild()`; keep the `--user-data-dir`
      injection and its `assertInside()` guard unchanged — Electron honours that flag in a
      packaged app too), `scripts/verify.mjs` + `scripts/ui-verify.mjs` + `scripts/flow.mjs` (a
      `--app=<path>` flag threaded through), `scripts/lib/harness.test.mjs` (new).
      *Acceptance:* `npm run ui:flow about-release-notes -- --app=<path>` drives the packaged app;
      with no `--app` nothing about today's behaviour changes. Covers AC8's mechanism.

- [x] **D5 — the Linux build is screenshotted and audited.**
      `.github/workflows/linux-verify.yml` (new): `ubuntu-latest`, `npm run package:linux`, then
      under `xvfb-run` both `npm run ui:verify -- --app=<AppImage>` and
      `npm run ui:flow about-release-notes -- --app=<AppImage>`; uploads the screenshot set,
      `a11y.json` and `a11y.md` as job artifacts. Reuses the existing flows
      (`scripts/flows/about-release-notes.mjs`, `linux-user-journey.mjs`) — no new flow needed.
      *Acceptance:* the job is green and its artifacts contain the same screen list Windows
      produces. Covers AC7 and AC8.

- [x] **D6 — a packaged AppImage really takes an update.**
      `scripts/linux-update-e2e.mjs` (new; builds the AppImage at the current version and at a
      bumped one, both with the generic-localhost publish override, serves the newer one's
      `latest-linux.yml` + artifact from a local HTTP server, launches the older one on a fresh
      user-data dir, lets the startup check fire, drives `update:download` and
      `update:installAndRestart` through the UI, then polls the log file for the new version),
      `.github/workflows/linux-update.yml` (new; `ubuntu-latest` + xvfb, `workflow_dispatch` plus
      a paths filter on the update and release files), `src/main/index.ts` (one boot line logging
      `app.getVersion()` — the out-of-band oracle, and a thing support logs should have had
      anyway).
      *Acceptance:* the job asserts the relaunched process reports the bumped version; deleting
      the served `latest-linux.yml` makes it fail rather than pass quietly. Covers AC6.

## Model Hints

- **D3 → `deliverable-hard`** — it rewrites the only proven configuration of a path with
  irreversible side effects (a pushed tag, a published release). The specific regression: the
  Windows `latest.yml` URL must keep resolving byte-for-byte as it does today, or every existing
  Windows install's auto-update silently breaks, and the new three-job split moves the version
  decision away from the job that builds, where an off-by-one bump would publish assets whose
  names do not match the release.
- **D6 → `deliverable-hard`** — the AppImage `$APPIMAGE` re-exec path has never been exercised in
  this repo, and the test has to orchestrate two builds, a local feed, xvfb, and an out-of-process
  relaunch oracle; the easy failure is a test that passes without the update ever happening.
- D1, D2, D4, D5 → default.
- **Review: → `story-review-hard`** — the diff touches both the release ritual and the update feed
  at once, where a wrong filename or a wrong URL is invisible in review and breaks every future
  update on both platforms.

## Acceptance Tests

- AC3 → unit `scripts/lib/release/artifacts.test.mjs` › "a two-platform check names only the
  missing Linux asset and refuses", plus unit `scripts/release.test.mjs` › "the run stages the
  pre-built Linux assets before the asset check, not after it" (D2, D3)
- AC4 → unit `scripts/lib/release/wiring.test.mjs` › "electron-builder's linux.artifactName is the
  hyphenated, space-free name the asset check expects" (D1)
- AC5 → unit `scripts/lib/release/artifacts.test.mjs` › "latest.yml and latest-linux.yml are both
  expected, and neither platform's set contains the other's metadata file" (D2); the live half is
  AC6's job, where the AppImage resolves `latest-linux.yml` and never `latest.yml`
- AC6 → e2e (Linux) `scripts/linux-update-e2e.mjs`, run by `.github/workflows/linux-update.yml` ›
  "a packaged AppImage takes an update on its startup check and comes back as the new version" (D6).
  Review (F1) found the script launched into a fresh, unseeded user-data dir, where
  `DetectDialog`'s modal (opened by `scanOnFirstRun`) would block the update click it depends on;
  fixed by seeding the harness's existing `empty` fixture variant (`writeFixture('empty')`,
  `scanOnFirstRun: false`) immediately before launch, into the same user-data dir the launch uses.
- AC7 → e2e `scripts/flows/about-release-notes.mjs` run against the packaged AppImage in
  `.github/workflows/linux-verify.yml` (D5). Review (F2) found the `build-linux` job packaged the
  AppImage from an un-promoted `CHANGELOG.md` (still `## Unreleased`), so About would show the
  empty state forever on Linux; fixed with a new `scripts/release.mjs --promote-changelog
  --version <v>` mode (reusing `planRelease`'s own changelog-promotion write) run in `build-linux`
  before `npm run package:linux`, asserted in `scripts/lib/release/wiring.test.mjs` (order,
  against the real workflow file).
- AC8 → e2e `npm run ui:verify -- --app=<AppImage>` in `.github/workflows/linux-verify.yml`, whose
  screenshot set and `a11y.md` are uploaded as job artifacts (D5), plus unit
  `scripts/lib/harness.test.mjs` › "ensureBuild is never called, and the launch is given a
  --user-data-dir inside UI_VERIFY_ROOT" / "a userData path the app reports outside
  UI_VERIFY_ROOT is rejected by the real assertInside guard" / "ensureBuild is called, and the
  dev entry point is in the launch args" (D4). Review (F3) found the harness's dev-only IPC and
  test stubs were gated on `Q2L_UI_HARNESS === '1' && isDev`, which a packaged AppImage
  (`isDev` always false) could never satisfy, permanently blocking this criterion's flows; fixed
  by dropping the `isDev` half everywhere (`Q2L_UI_HARNESS === '1'` alone is now sufficient,
  confirmed unreachable from any real shipped build or its UI), with the affected gate tests
  updated to match and no production-safety assertion weakened. User explicitly reviewed and
  approved this specific change before it was made.

**No manual residue.** Every criterion is automated.

**Locality note (a consequence of Q4, not a gap in coverage).** AC6, AC7 and AC8 are proven on
`ubuntu-latest`; they cannot run from this repo's Windows development machine, so `/build`'s local
gate (`npm test`, `npm run typecheck`, `npm run ui:verify`) will not execute them. What `/build`
can and must check locally is D2's, D3's and D4's unit tests plus that the new workflows parse;
the first real proof of D5 and D6 is their first CI run, and the story is not done until both jobs
are green. This is a property of "the launcher is packaged on Linux", not something a different
test strategy would avoid.

## Done

Implemented D1–D6: Linux gets a hyphenated `artifactName` and `package:linux` (D1); the asset
check and release script gained a platform dimension so one run produces, stages and gates both
Windows and Linux artifacts (D2, D3, now a `plan`/`build-linux`/`release` three-job workflow); the
UI-verification harness can launch a packaged app via `--app=<path>` (D4); a new
`linux-verify.yml` screenshots and axe-audits the packaged AppImage (D5); a new
`linux-update-e2e.mjs` + `linux-update.yml` prove a packaged AppImage really takes an update via
a local generic-provider feed and a boot-time version log as the out-of-process oracle (D6).

The first clean-agent review (story-review-hard) found three blocking gaps, all in the parts of
D5/D6 whose live proof only runs on Linux CI: F1 (D6's e2e script launched into an unseeded,
first-run state, where `DetectDialog`'s modal would have blocked the update-check click), F2
(the `build-linux` CI job packaged from an un-promoted `CHANGELOG.md`, leaving About permanently
empty on Linux), and F3 (the harness's `Q2L_UI_HARNESS === '1' && isDev` gate can never be
satisfied by a packaged build, blocking every dev-only IPC channel D5/D6's flows depend on — this
one was surfaced to the user for explicit sign-off before fixing, since it relaxes a main-process
privilege gate). All three were fixed; three minor findings (a stale arch comment, an undeclared
`js-yaml` devDependency, a weak confinement-guard test) were fixed alongside them. A second
review pass confirmed all six resolved with no weakened tests, no scope creep, and no new
regressions, and left six cosmetic/documentation items (a stale log-upload path, four stale
"unreachable in a packaged build" doc/code comments, a lockfile-hygiene gap, a stray semicolon),
which were also fixed and re-verified.

Commit message: `101: a linux release ships and updates itself`

Verification:
- `npm run build` — green.
- `npm run typecheck` — green (node + web).
- `npm test` — 4133 passed, 2 failed; both failures are pre-existing and unrelated to this story
  (`UpdateCheckRow.test.tsx`, `NewsHero.test.tsx` assert English relative-time strings and fail
  only because this machine's OS locale is `de` — reproduces identically on `dev` with this
  story's changes stashed).
- AC3, AC4, AC5 → their named unit tests exist and pass locally, verified above.
- AC6, AC7, AC8 → their named e2e scripts/workflows exist, parse, and are wired as specified;
  per the story's own Locality note, their live proof requires `ubuntu-latest` and cannot run on
  this Windows machine. `.github/workflows/linux-verify.yml` and
  `.github/workflows/linux-update.yml` have both since run green in CI, confirmed by the user —
  the blocker is cleared and status moves to `done`.
- Review outcome: two-pass clean-agent review, second pass PASS, all findings from both passes
  resolved and re-verified.
