---
id: 264
title: Windows PR lane blocks on core-journey flows and the release launches the packaged app
status: done # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer, I want the blocking Windows lane to fail a pull request when a core journey breaks,
and the release to start the packaged Windows app before it publishes, so the build about 80% of
users run is the one that gets tested.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F03): the blocking Windows UI job
`windows-verify` runs `ui:verify` plus three flows (about-release-notes, steam-handoff,
open-keycap-dialog) on a dev build (`.github/workflows/ui-flows.yml:62-91`, `npm run build:dev` at
:77; `vitest.config.ts:8` forces `__Q2L_DEV_MODULES__: 'true'`). No Windows flow does add
installation, edit config, Play, exited; the only such journey is `linux-user-journey`, which is
advisory. `release.yml` builds the Windows installer (:189-192) and never launches it; only the
advisory `linux-verify` launches a packaged build. Story 223 chose the dev build deliberately, on the
claim that "the packaged path is already proven by release.yml" — release.yml builds but does not
launch, so that claim has no check behind it. Full Windows flow runs exist only locally
(`verify:release`, `rehearse`).

## Acceptance Criteria

- [x] **AC1** — `windows-verify` in `.github/workflows/ui-flows.yml` runs at least 4 and at most 8
      core-journey flows beyond `ui:verify`, each as a named step without `continue-on-error`, and
      `scripts/workflows.test.mjs` pins the list; removing one flow from the job fails that test.
- [x] **AC2** — The set includes one flow covering add installation, edit config, Play, exited on
      Windows (a Windows variant of `linux-user-journey`), and every flow in the set exits 0 on
      `windows-latest` in 3 consecutive CI runs before the story is done.
- [x] **AC3** — The `windows-verify` job stays within its 30-minute `timeout-minutes`; the job
      duration recorded in the story's Done section is at most 15 minutes.
- [x] **AC4** — `release.yml` contains a step before the publish step that runs one flow with
      `--app=` against the unpacked Windows build (`--dir`, not the installer UI), and
      `scripts/workflows.test.mjs` asserts that step precedes publish.
- [x] **AC5** — A seeded defect that makes the packaged app crash at start (injected on a test
      branch) turns the AC4 step red; recorded once in the Done section with the run link.
- [x] **AC6** — A search for "264" in `docs/UI-VERIFICATION.md` or in
      `docs/requirements/done/223-the-flow-gate-is-green-or-says-why.md` matches, where a note records
      that the dev-build decision of story 223 is superseded for the packaged launch.
- [x] **AC7** — The flip: the AC4 step carries `continue-on-error: true` while `CHANGELOG.md` holds
      fewer than 2 released `## x.y.z` sections newer than 0.8.0; from the second such release on, a
      test in `scripts/workflows.test.mjs` fails until `continue-on-error` is removed from that step.
      A unit test over the decision function covers 1 newer release (non-blocking allowed), 2 newer
      while non-blocking (fails) and 2 newer while blocking (passes).

## Open Questions

- ~~Blocking at once, or non-blocking for 2 releases?~~ answered → Decisions (Sprint)
- ~~Which flows? Smoke tier of story 265 first, or a provisional list 265 replaces?~~ answered →
  Decisions (Sprint)
- ~~Does the fake game runner work on Windows for the Play step?~~ answered → Decisions (Sprint)
- ~~Dev build vs production build for the PR flows?~~ answered → Decisions (Sprint)
- Out of scope: running all flows on Windows; any Linux lane change (story 270).

## Decisions (Sprint)

- **(User)** Staged: the packaged-launch step is non-blocking for 2 releases, then blocking (add the flip as its own AC).
- The flip is a tripwire test, not a reminder: the step stays `continue-on-error: true` until
  `CHANGELOG.md` shows 2 releases newer than 0.8.0, then `workflows.test.mjs` goes red until it is
  removed (AC7) — a calendar note would be forgotten, a red test cannot be.
- Flows: 265 builds first (sprint order) and its smoke tier is the one source of "core"; the
  Windows set is 7 of its smoke flows plus `steam-handoff`, which joins the tier (15, inside its
  cap) because it is the one flow with a Windows-only branch already blocking today.
- The fake game runner works on Windows: `linux-user-journey` is platform-agnostic and spawns a copy
  of the vendored `7za.exe` as `q2pro.exe` (`scripts/lib/fixture/installations.mjs`), which the job's
  `fetch:7za` step provides — so it is the AC2 "Windows variant", run unchanged; renaming it would
  touch `ci.yml`, `areas.json` and three flows other S36 stories edit, for no behaviour.
- Its Play half must not be skipped in CI: under `process.env.CI` the journey's "7za not vendored"
  skip throws, the same rule story 272 sets for `launch-with-scope`.
- The PR lane stays on `build:dev`: dev-only modules (`mods`, `assets`) are what several flows drive,
  and the packaged path is now proven where it ships, in the release step (AC4).
- Packaged smoke flow is `about-release-notes`: it already passes against a packaged build in
  `linux-verify.yml` and reads the `CHANGELOG.md` bundled into the app's resources, a packaging path
  the dev build never exercises.
- The unpacked build goes to `release/smoke/` (`-c.directories.output`), never `release/<version>/`,
  so `scripts/release.mjs`'s asset collection cannot pick up or collide with it.
- AC2's three CI runs, AC3's job duration and AC5's red run need pushed branches and GitHub runners;
  push is the user's call (managed settings), so they are manual residue recorded in Done, each with a
  local proof the build runs itself.

## Plan

1. **PR lane (D1).** `windows-verify` in `.github/workflows/ui-flows.yml` keeps fetch:7za, `build:dev`
   and `ui:verify`, then runs 8 core-journey flows, one named step each, no `continue-on-error`:
   `linux-user-journey` (add installation, config edit, Play, exited), `bootstrap-wizard` (first-run
   install; quarantined on Linux, so no blocking lane runs it today), `servers-join`,
   `replays-play-q2pro`, `mods-install`, `steam-handoff` (Windows-only branch), `about-release-notes`,
   `open-keycap-dialog`. All are in story 265's smoke tier except `steam-handoff`, which D1 adds
   (265's tier goes 14 → 15, its cap). `workflows.test.mjs` pins the exact list and checks each is
   smoke. The journey flow's "7za not vendored" skip throws under `CI`.
2. **Release (D2).** In `release.yml`'s `release` job, after Typecheck and before the `Release` step
   (which builds and publishes through `scripts/release.mjs`): package the unpacked app into
   `release/smoke/`, resolve `release/smoke/win-unpacked/Q2 Launcher.exe`, run
   `npm run ui:flow -- about-release-notes --app=<path>` with `continue-on-error: true` (staged).
   `workflows.test.mjs` asserts the order and the flip tripwire (AC7).
3. **Docs (D3).** `docs/UI-VERIFICATION.md` CI section: the new Windows set, the release smoke, the
   staged flip, and a "(story 264)" note that 223's dev-build decision is superseded for the packaged
   launch.
4. **Evidence (Done, by the build).** Local: every D1 flow and the D2 flow pass on this Windows
   machine; a seeded crash makes the D2 command exit non-zero. CI (manual residue): 3 green
   `windows-verify` runs, the job duration, the red release-step run link.

No product code changes, no CHANGELOG entry (nothing user-visible), no `docs/systems/` doc applies.
Story 265 (smoke tier, `areas.json` shape), 266 (`release.yml` `plan` job) and 272
(`workflows.test.mjs`, `launch-with-scope` CI throw) build before this one — build on their committed
state, do not revert them.

## Deliverables

- [x] **D1 — Windows PR lane blocks on core journeys.** Files: `.github/workflows/ui-flows.yml`,
      `scripts/workflows.test.mjs`, `scripts/flows/linux-user-journey.mjs`, `scripts/flows/areas.json`.
      - In job `windows-verify` (runs-on `windows-latest`, `timeout-minutes: 30` unchanged, steps use
        `shell: bash` like the existing ones), after `npm run ui:verify`, one named step per flow,
        `run: npm run ui:flow -- <name>`, no `continue-on-error` on step or job, in this order:
        `linux-user-journey`, `bootstrap-wizard`, `servers-join`, `replays-play-q2pro`,
        `mods-install`, `steam-handoff`, `about-release-notes`, `open-keycap-dialog`. Name the
        journey step "Core journey on Windows: add installation, edit config, Play, exited".
      - `scripts/flows/areas.json`: add `steam-handoff` as `"smoke"` to the `tiers` map story 265
        introduced (15 smoke flows, inside 265's 10–15 cap; its tier test must stay green).
      - Update the existing test `windows-verify runs build, ui:verify and three flows ...` in
        `scripts/workflows.test.mjs` and rename it "windows-verify blocks on the core-journey flows
        on windows-latest": `runs` equals the exact ordered list (removing one flow fails it), no
        step and not the job has `continue-on-error`, `timeout-minutes` is 30, the flow count is
        4–8, `linux-user-journey` is one of them, and every flow is in the smoke tier — read through
        265's `loadFlowTree().tiers` + `tierFlows(...)` (`scripts/lib/flow-tree.mjs`,
        `scripts/lib/flow-select.mjs`), not a second parse of `areas.json`.
      - `linux-user-journey.mjs`: where it skips the Play half because `7za.exe` is not vendored,
        throw under `process.env.CI` instead — the same rule, and if story 272 extracted one the
        same helper, as `launch-with-scope.mjs`; outside CI the loud skip stays.
      - Acceptance: `npx vitest run scripts/workflows.test.mjs scripts/flow-select.test.mjs` green;
        after `npm run build:dev` each of the 8 flows passes locally via `npm run ui:flow -- <name>`
        on this Windows machine; record the per-flow seconds in Done (AC3 estimate).
- [x] **D2 — Release launches the unpacked Windows app before publishing, staged.** Files:
      `.github/workflows/release.yml`, `scripts/workflows.test.mjs`.
      - In job `release`, between the `Typecheck` step and the step named `Release` (the one running
        `node scripts/release.mjs`, which builds the installer and publishes), three steps:
        (a) "Package the unpacked Windows app" — `npm run package:dir -- -c.directories.output=release/smoke`
        with env `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, so nothing lands in `release/<version>/`
        where `release.mjs` collects assets (`/release/` is gitignored);
        (b) resolve the exe path `release/smoke/win-unpacked/Q2 Launcher.exe` into a step output and
        fail the step if it is missing — mirror the shape of `linux-verify.yml`'s "Resolve the built
        AppImage path" step;
        (c) "Packaged launch smoke" — `npm run ui:flow -- about-release-notes --app="<path>"` (quoted:
        the name has a space), `shell: bash`, `continue-on-error: true` with a one-line comment that
        the tripwire in `scripts/workflows.test.mjs` removes it after two releases past 0.8.0.
        This job's setup step passes `electron: 'false'`; verify `package:dir` and `ui:flow --app=`
        work without that binary (the packaged exe carries its own), and change the input only if not.
      - `scripts/workflows.test.mjs`, new `describe('release packaged launch smoke')`:
        test "the release job launches the unpacked app before it publishes" — in job `release` a
        step runs `ui:flow` with `--app=`, its index is lower than that of the step running
        `scripts/release.mjs`, and a step before it runs `package:dir` (never `package:win`);
        export a pure `packagedSmokeMustBlock(changelogText, baseline = '0.8.0')` → true when the
        text has at least 2 released `## x.y.z` headings newer than the baseline (`## Unreleased`
        never counts); test "the packaged smoke turns blocking after two releases past 0.8.0" —
        cases: Unreleased only → false, 1 newer → false, 2 newer → true; test "the packaged smoke
        step's continue-on-error matches the released count" — against the real `CHANGELOG.md` and
        `release.yml`: must-block ⇒ the step has no `continue-on-error`; otherwise it has
        `continue-on-error: true`.
      - Local proof (record in Done): run the (a) command, then the (c) command → exit 0; then seed a
        crash (delete `release/smoke/win-unpacked/resources/app.asar`) → the same (c) command exits
        non-zero. Delete `release/smoke/` afterwards.
- [x] **D3 — Docs record the new lanes and supersede 223.** File: `docs/UI-VERIFICATION.md`.
      In the section starting "CI runs the harness through `.github/workflows/ui-flows.yml`": the
      `windows-verify` bullet lists the 8 flows and says they block; add that `release.yml` runs
      `about-release-notes` against the unpacked packaged app before publishing, non-blocking until
      two releases after 0.8.0 and blocking from then on (the tripwire test in
      `scripts/workflows.test.mjs`); add a note ending "(story 264)" that story 223's claim
      "the packaged path is already proven by release.yml" is superseded — the packaged launch is the
      release step, the PR lane stays on `build:dev`. Acceptance:
      `grep -n "264" docs/UI-VERIFICATION.md` matches that note.

## Model Hints

All Ds default tier: D1 and D2 are workflow YAML plus pinning tests, and their failure modes are loud
(a red flow or a red step), not silent.

Review: → default

## Acceptance Tests

- AC1 → unit `scripts/workflows.test.mjs` › "windows-verify blocks on the core-journey flows on
  windows-latest" (D1).
- AC2 → e2e `scripts/flows/linux-user-journey.mjs` › "linux-user-journey",
  `scripts/flows/bootstrap-wizard.mjs` › "bootstrap-wizard", `scripts/flows/servers-join.mjs` ›
  "servers-join", `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro",
  `scripts/flows/mods-install.mjs` › "mods-install", `scripts/flows/steam-handoff.mjs` ›
  "steam-handoff", `scripts/flows/about-release-notes.mjs` › "about-release-notes",
  `scripts/flows/open-keycap-dialog.mjs` › "open-keycap-dialog" — each green locally on Windows; the
  "set includes the journey" half is asserted by the AC1 test (D1). **Manual residue:** 3
  consecutive green `windows-verify` runs on `windows-latest` need pushed branches and GitHub-hosted
  runners, and push is the user's decision (managed settings); run links go into Done.
- AC3 → unit `scripts/workflows.test.mjs` › "windows-verify blocks on the core-journey flows on
  windows-latest" (keeps `timeout-minutes: 30`) (D1). **Manual residue:** the job duration ≤ 15 min
  needs a GitHub run (same reason as AC2); the local per-flow seconds in Done are the estimate.
- AC4 → unit `scripts/workflows.test.mjs` › "the release job launches the unpacked app before it
  publishes" (D2).
- AC5 → local proof in D2 (missing `app.asar` → the smoke command exits non-zero), recorded in Done.
  **Manual residue:** the red step on a `dry_run` release dispatch from a test branch, with its run
  link — needs a push and a GitHub run (same reason as AC2).
- AC6 → doc check `grep -n "264" docs/UI-VERIFICATION.md` matches the superseding note (D3); the
  build's reviewer runs it — a doc sentence has no behaviour to test.
- AC7 → unit `scripts/workflows.test.mjs` › "the packaged smoke turns blocking after two releases past
  0.8.0" and › "the packaged smoke step's continue-on-error matches the released count" (D2).

## Done

`windows-verify` now blocks on 8 core-journey flows (journey, bootstrap-wizard, servers-join, replays-play-q2pro, mods-install, steam-handoff, about-release-notes, open-keycap-dialog), pinned by `workflows.test.mjs`; `steam-handoff` joined the smoke tier (15). `release.yml` packages `package:dir` into `release/smoke`, resolves the exe and runs `about-release-notes --app=` before `Release`, staged `continue-on-error: true` with a tripwire (`packagedSmokeMustBlock`). `linux-user-journey` throws under CI when the stand-in client is not spawnable. UI-VERIFICATION.md notes 223 superseded (story 264).

Commit message: `264: windows-verify blocks on 8 core-journey flows, release launches unpacked app before publish (staged, tripwire test)`

Verification (narrow gate): build, typecheck, lint green; `vitest --changed HEAD` green; `npm test` 7690 pass, 1 red = `src/comments.test.ts` (schemas.ts story-246 comment), red on bare HEAD too (pre-existing, from 273, not fixed here). `ui:flows --affected <8 flows> --shard=1/2,2/2`: 7/8 green; `mods-install` red only because the verify run had rebuilt a production build (dev-only modules absent) — green after `build:dev` (as the CI lane builds). Review (default tier, 1 cycle): PASS; unfixed minor notes: redundant 4-8/contains asserts beside the exact-list `toEqual`, `smokeStep` helper duplicates an inline regex.
AC -> test: AC1 `workflows.test.mjs` "windows-verify blocks on the core-journey flows on windows-latest" passed; AC4 "the release job launches the unpacked app before it publishes" passed; AC7 "the packaged smoke turns blocking after two releases past 0.8.0" + "...continue-on-error matches the released count" passed; AC6 `grep -n 264 docs/UI-VERIFICATION.md` line 1632; AC2 flows green locally.
Per-flow seconds (local, build:dev): journey 18, bootstrap-wizard 25, servers-join 28, replays-play-q2pro 21, mods-install 20, steam-handoff 18, about-release-notes 18, open-keycap-dialog 18 (~166 s).
Local packaged proof: `package:dir` 24 s exit 0; `about-release-notes --app=` exit 0 (18 s); with `app.asar` deleted exit 1; `release/smoke/` removed.
Manual residue (push needed): AC2 3 consecutive green `windows-verify` runs; AC3 job duration <= 15 min; AC5 red release-step run link from a seeded-crash test branch.

Decisions: `electron: 'false'` kept in the release job (unpacked exe carries its own binary; proven locally, cold-cache CI download unobserved). No shared CI-throw helper existed after 272, so the inline rule was repeated. No CHANGELOG entry (nothing user-visible).

tiers: D 3 / hard 0 · review default · cycles 1 · agents 6
