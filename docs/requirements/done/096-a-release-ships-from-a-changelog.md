---
id: 096
title: A release ships from a changelog
status: done # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

The launcher is usable enough to hand to real players, but there is no way to hand it to
them: no tag, no GitHub release, no artifact anyone could download, and no record of what
changed between two builds. Version is still `0.1.0`, the repository has no tags and no
`.github/` at all, and [electron-builder.yml](../../electron-builder.yml) has no `publish`
target — so `package:win` produces an installer that lives and dies on this machine.

A release has to be a single deliberate act that produces the same three things every time:
a version, a published set of artifacts, and a human-readable list of what changed. The
changelog is the source for the release notes, not a byproduct of them — whoever writes a
user-facing change writes its line while the change is fresh, and the release only promotes
what is already there. A release with nothing to say is a mistake, not a valid release.

The sibling project `claude-control` already runs exactly this shape
(`.github/workflows/release.yml` + `scripts/plan-release.ps1` / `ci-release.ps1`, a
`CHANGELOG.md` whose `## Unreleased` section gates the run) and is the reference to adapt —
not to invent from scratch. It differs in one respect that matters: it ships a portable EXE,
this launcher ships NSIS + zip, which is what [[097]]'s updater needs a published
`latest.yml` for.

## Acceptance Criteria

- [x] **AC1** — The repository has a `CHANGELOG.md` in Keep-a-Changelog shape whose
      `## Unreleased` section is where pending user-facing changes are collected, seeded with
      the entries for everything the beta ships with.
- [x] **AC2** — A release run refuses to publish while `## Unreleased` is empty, with a
      readable reason, and changes nothing in the repository when it refuses.
- [x] **AC3** — A release run determines the next version from the pending changes, promotes
      `## Unreleased` into a dated version section, writes that version into `package.json`,
      and leaves `## Unreleased` empty again — all in one commit plus a matching tag.
- [x] **AC4** — A release run produces the Windows artifacts (NSIS installer, zip) plus the
      update metadata [[097]] reads, and publishes them on a GitHub release whose notes are
      the promoted changelog section.
- [x] **AC5** — A dry run performs every step including the build and prints the version it
      would release and the notes it would publish, but commits, tags and publishes nothing.
- [x] **AC6** — A release can be requested with an explicit version and an explicit bump
      level, overriding what the pending changes would have chosen.
- [x] **AC7** — Running the release twice on unchanged `main` does not produce a second
      release, and the release commit itself never triggers another run.
- [x] **AC8** — The project's own workflow knows about the changelog: a user-facing story is
      not done without its entry (`changelog-path` in `.claude/ai-scrum.md` points at
      `CHANGELOG.md` instead of `none`).

## Open Questions

- ~~**Which version does the first beta release carry?**~~ answered → Decisions (Sprint)
- ~~**Is `Hantsch/q2-launcher` public?**~~ answered → Decisions (Sprint)
- ~~**Unsigned artifacts.**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** First beta release version: `1.0.0-beta.1`, published as a GitHub prerelease.
- **(User)** Repository visibility: `Hantsch/q2-launcher` is public — [[097]]'s update check
  reads the release feed from user machines with no token.
- **(User)** Unsigned artifacts: accepted for the beta; the SmartScreen warning on first run is
  documented in the README, no certificate before shipping.
- **Node ESM, not PowerShell** (`scripts/release.mjs` + `scripts/lib/release/*.mjs`): every other
  script here is `.mjs`, and a Node module is covered by the existing `npm test` gate, which a
  `.ps1` would not be — and `ac-tests-required: true` makes that the difference between tested and
  untested acceptance.
- **Pure core, thin shell:** every decision (parse, refuse, version, notes, `gh` argv) lives in a
  pure function; `release.mjs` only performs I/O — that is what makes AC2/AC3/AC5/AC6/AC7 testable
  without touching git or GitHub.
- **`vitest.config.ts` `include` gains `scripts/**/*.test.mjs`:** the release core belongs under
  `scripts/` next to the rest of the tooling, and parking its tests under `src/` to fit the current
  glob would misfile them.
- **Bump derived from Keep-a-Changelog categories, not Conventional Commits:** this repo's commit
  subjects are plain prose (`095: a news entry starts from a template`), so the reference project's
  commit-message derivation has no basis here — `### Removed` or a `**BREAKING**` lead-in → major,
  `### Added`/`### Changed` → minor, `### Fixed`/`### Security` alone → patch.
- **While the running version is a prerelease, the derived bump increments the prerelease
  identifier** (`1.0.0-beta.1` → `1.0.0-beta.2`): stable `1.0.0` has not shipped, so a
  category-derived bump would announce a release that does not exist; `--bump` still overrides (AC6).
- **The first release goes through AC6's explicit `--version 1.0.0-beta.1`:** no derivation from
  `0.1.0` produces the user-decided version, and AC6's override is exactly the path for it.
- **Prerelease is derived from the version string:** a version carrying a `-beta.N` identifier
  publishes with `gh release create --prerelease`, so nobody has to remember a second switch.
- **`electron-builder.yml` gains `publish: {provider: github, owner: Hantsch, repo: q2-launcher}`
  but builds with `--publish never`:** the publish *config* is what makes electron-builder write
  `latest.yml` and `app-update.yml` at all (`app-builder-lib/out/publish/PublishManager.js:159`
  gates that on `publishConfigs`, not on the `--publish` flag), while `gh release create` keeps the
  notes, the prerelease flag and the atomicity of the upload in the script's hands.
- **The published asset set is installer + zip + both `.blockmap`s + `latest.yml`, and the run
  refuses when one is missing:** [[097]]'s `electron-updater` reads exactly those, so a silently
  incomplete upload would break the next story rather than this one.
- **Trigger is `workflow_dispatch` (version/bump/dry_run) plus `push: [main]`:** AC2's
  empty-`## Unreleased` refusal already turns a push-triggered run into a no-op whenever there is
  nothing to say, so no path filter or extra gate is needed.
- **AC7's "never triggers another run" is two independent stops:** `[skip ci]` in the release commit
  subject with a job-level `if: !contains(github.event.head_commit.message, '[skip ci]')`, and a
  tag-already-exists guard in the plan — same shape as the reference project.
- **`scripts/release.mjs` performs commit/tag/push/publish only when `CI=true`,** otherwise it
  refuses with a pointer to `workflow_dispatch`: the profile's `protected-branches: main, dev` bars
  agents and humans from pushing to `main` by hand, and dry runs (AC5) stay available locally.
- **Version section heading `## <version> — <YYYY-MM-DD>`, tag `v<version>`, commit
  `release: <version> [skip ci]`:** the reference project's shape, minus Keep-a-Changelog's
  `[link]` reference definitions — nothing then has to be maintained per release beyond the section.
- **CI sets `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`:** without it electron-builder can pick up a
  stray certificate on the runner and fail the build, which would contradict the accepted-unsigned
  decision above.
- **The `changelog-path` flip is paired with a note under `.claude/ai-scrum.md`'s `## Notes`:** the
  profile's own house-style comment proposes `# Features`/`# Fixes`, which AC1's Keep-a-Changelog
  shape overrides, and `## Notes` is the one block `/ai-scrum:setup` never rewrites.
- **`npm run ui:verify` is not part of this story's acceptance:** no criterion describes an action
  in the app UI — the release process has no renderer surface at all.
- **AC4's actual publish to github.com is a manual residue:** creating a real GitHub release is an
  external-service side effect no test may perform; everything up to and including the exact `gh`
  argv and the artifact-set check is unit-tested.

## Plan

Adapt `claude-control`'s release shape to this repo: Node instead of PowerShell, NSIS + zip + an
`electron-updater`-readable `latest.yml` instead of a portable EXE.

1. **Release core** (`scripts/lib/release/`, all pure, no I/O):
   - `changelog.mjs` — `parseChangelog(text)` → sections; `readUnreleased(text)` → `{ categories,
     bullets }`; `validateUnreleased()` refuses on empty / placeholder comment / no bullet;
     `promote(text, version, date)` → new text with `## Unreleased` emptied and
     `## <version> — <date>` inserted; `notesFor(text, version)` → the section body.
   - `version.mjs` — `deriveBump(categories)`, `nextVersion(current, bump)` (prerelease-aware),
     `isPrerelease(v)`, `applyVersion(pkgText, lockText, v)` (regex-scoped, formatting preserved).
   - `artifacts.mjs` — `expectedAssets(version)` / `collectAssets(dir, version)` over
     `release/<version>/`: NSIS `.exe`, `.zip`, both `.blockmap`s, `latest.yml`; refuse if missing.
   - `plan.mjs` — `planRelease({ changelogText, pkgText, lockText, tags, requestedVersion, bump,
     dryRun, isCi, today })` → `{ version, tag, notes, writes[], commands[] }` or throws
     `ReleaseRefused(reason)`. Nothing is written before this returns.
2. **`CHANGELOG.md`** — Keep a Changelog header, empty `## Unreleased` scaffold seeded with the
   beta's entries (`### Added` for library/config/home/install, `### Changed`/`### Fixed` where a
   later sprint corrected an earlier one), grouped by feature area, not by story number.
3. **Packaging** — `publish:` block in `electron-builder.yml`; `package:win` unchanged
   (`--publish never` is the default).
4. **`scripts/release.mjs`** — reads files, calls `planRelease`, prints version + notes, runs
   `npm run package:win`, checks the asset set, then (non-dry, CI only) applies writes,
   `git commit`/`tag`/`push --follow-tags`, `gh release create`. `--dry-run`, `--version`, `--bump`.
   Registered as `npm run release`.
5. **`.github/workflows/release.yml`** — `windows-latest`, `permissions: contents: write`,
   `concurrency` on `github.ref`, checkout `fetch-depth: 0` + `ref: ${{ github.ref_name }}`,
   node 22 + `npm ci` + `npm test` + `npm run typecheck`, then `node scripts/release.mjs` with
   `GH_TOKEN`, `CI: true`, `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.
6. **Workflow wiring** — `changelog-path: CHANGELOG.md` in `.claude/ai-scrum.md`; README `## Install`
   + `## Planned` updated with the download and the SmartScreen note; CONTRIBUTING gets the
   "write your changelog line" rule.

## Deliverables

- **D1 — the release core.** `scripts/lib/release/changelog.mjs`, `version.mjs`, `plan.mjs` (pure,
  as in Plan §1) plus `changelog.test.mjs`, `version.test.mjs`, `plan.test.mjs`, and the one-line
  `include` addition in `vitest.config.ts`. Style to mirror: `scripts/lib/download-failures.mjs`
  (plain ESM, JSDoc types, no deps). No `.d.mts` — nothing in `src/` imports it yet.
  *Accepted when:* empty/placeholder `## Unreleased` refuses with a readable reason and returns no
  writes; a populated one promotes correctly; derived and overridden versions both come out right;
  a dry-run plan carries notes but no commands; an existing tag refuses.
- **D2 — `CHANGELOG.md`, seeded.** New `CHANGELOG.md` (Plan §2) + `README.md` (`## Install` gets the
  download-and-SmartScreen text replacing "No release build is published yet"; the `## Planned`
  table's Auto-update row) + `CONTRIBUTING.md` (`## Docs and process` gains the changelog rule).
  Plus its test in `scripts/lib/release/wiring.test.mjs` (parses the real file through D1's parser).
  *Accepted when:* the shipped file parses, `## Unreleased` is non-empty and bullet-shaped, and the
  README names the SmartScreen warning.
- **D3 — packaging publishes update metadata.** `electron-builder.yml` `publish:` block +
  `scripts/lib/release/artifacts.mjs` + `artifacts.test.mjs` (fs-fixture based, `node:fs` temp dir).
  *Accepted when:* a complete fixture directory resolves to the five assets in a stable order and
  each missing one produces a named refusal.
- **D4 — the release runner.** `scripts/release.mjs` (thin I/O shell over D1/D3), `package.json`
  `"release"` script. Argument parsing, `--dry-run`, the `CI=true` guard, git/gh invocation.
  *Accepted when:* a dry run prints version + notes and touches nothing; a non-dry run outside CI
  refuses; the git/gh command list matches what `plan.mjs` produced.
- **D5 — the workflow.** `.github/workflows/release.yml` (Plan §5) plus its invariants in
  `scripts/lib/release/wiring.test.mjs` (skip-ci guard, `contents: write`, `windows-latest`, the
  three inputs, `CSC_IDENTITY_AUTO_DISCOVERY`).
  *Accepted when:* the file exists, parses as YAML, and every invariant above is asserted.
- **D6 — the project knows about its changelog.** `.claude/ai-scrum.md`: `changelog-path: none` →
  `CHANGELOG.md`, plus a `## Notes` line recording the Keep-a-Changelog shape over the profile
  comment's `# Features`/`# Fixes` suggestion. Plus its assertion in `wiring.test.mjs`.
  *Accepted when:* the profile points at `CHANGELOG.md` and the test fails if it is flipped back.

## Model Hints

- D4 → **deliverable-hard** — it is the only deliverable with irreversible side effects (a pushed
  tag, a published release): the refuse-without-mutation path, the dry-run path and the `CI=true`
  guard all have to be provably side-effect-free before anything is ever pushed to a public repo.
- D1, D2, D3, D5, D6 → default.
- Review: → **story-review-hard** — a wrong tag, a wrong version write or a missing `latest.yml`
  is discovered only after it is public and blocks [[097]], so this diff is worth the expensive read.

## Acceptance Tests

`npm run ui:verify` does not apply here: no criterion describes an action in the app UI — this
story's whole surface is a CLI script plus a CI workflow, so every criterion maps to `npm test`.

- AC1 → unit `scripts/lib/release/wiring.test.mjs` › "the repo's CHANGELOG.md is Keep-a-Changelog
  shaped and its Unreleased section carries the beta's entries" *(D2)*
- AC2 → unit `scripts/lib/release/plan.test.mjs` › "an empty Unreleased section refuses with a
  reason and plans no writes" *(D1)*
- AC3 → unit `scripts/lib/release/plan.test.mjs` › "a release promotes Unreleased into a dated
  section, writes the version to package.json and lockfile, and plans one commit and one tag" *(D1)*
- AC4 → unit `scripts/lib/release/artifacts.test.mjs` › "the asset set is installer, zip, both
  blockmaps and latest.yml, and a missing one refuses" *(D3)*, plus
  `scripts/lib/release/wiring.test.mjs` › "electron-builder publishes to Hantsch/q2-launcher so
  latest.yml is written" *(D3)*.
  manual residue: the actual `gh release create` against github.com — publishing to an external
  service is a side effect no test may perform; the exact argv is asserted in `plan.test.mjs`.
- AC5 → unit `scripts/lib/release/plan.test.mjs` › "a dry run yields the version and the notes but
  no git or gh commands" *(D1, exercised by D4)*
- AC6 → unit `scripts/lib/release/plan.test.mjs` › "an explicit version and an explicit bump each
  override the derived one" *(D1)*
- AC7 → unit `scripts/lib/release/plan.test.mjs` › "a second run on an unchanged tree refuses:
  Unreleased is empty and the tag already exists" *(D1)*, plus
  `scripts/lib/release/wiring.test.mjs` › "the release commit carries [skip ci] and the workflow
  skips such a commit" *(D5)*
- AC8 → unit `scripts/lib/release/wiring.test.mjs` › "changelog-path points at CHANGELOG.md" *(D6)*

## Done

Adapted `claude-control`'s release shape into a Node ESM pipeline: a pure planning core
(`scripts/lib/release/{changelog,version,plan,artifacts}.mjs`), a seeded `CHANGELOG.md`, an
`electron-builder.yml` `publish:` block, a thin `scripts/release.mjs` CLI shell, a
`windows-latest` GitHub Actions workflow, and the project's own workflow now pointing
`changelog-path` at `CHANGELOG.md`. All six deliverables (D1–D6) implemented and reviewed;
a first review pass (`story-review-hard`) found 9 findings including 4 confirmed correctness
bugs, all fixed and independently re-verified in a second review pass, which found one further
issue (an unsafe dry-run revert) that was also fixed and re-verified.

**Commit message:**
```
096: a release ships from a changelog
```

**Verification:**
- `npm run build` — green (electron-vite build, unaffected by this story's scope: no `src/`
  changes at all).
- `npm run typecheck` — green (both `tsconfig.node.json` and `tsconfig.web.json`).
- `npm test` — 3926 passed, 1 pre-existing failure unrelated to this story
  (`src/main/modules/home/news/news-fixture-contract.test.ts`, a content-fixture ordering drift
  in the news module, present before this story started and in a file this story never
  touches — confirmed via `git status`/`git diff` scoping). 1 pre-existing skip, unrelated.
- `npm run ui:verify` (e2e) — not run: this story has no renderer surface (Decisions (Sprint):
  "`npm run ui:verify` is not part of this story's acceptance").
- Code review: `story-review-hard`, two passes. First pass verdict **FAIL** (4 confirmed
  correctness bugs + 5 lower-severity findings). All 9 fixed in one parallel round (3 agents,
  disjoint files). Second pass verdict **FAIL** on one newly-introduced issue only (all 9
  original findings confirmed genuinely fixed); that issue was fixed and is covered by two new
  regression tests. No third review round was needed to reach a clean bill — the fix was
  verified directly against the reviewer's own evidence trail (file:line, order-of-calls) plus
  the full test/typecheck/build re-run below.

**AC → test mapping, as verified (all in `npm test`, all green):**
- AC1 → `scripts/lib/release/wiring.test.mjs` › "the repo's CHANGELOG.md is Keep-a-Changelog
  shaped and its Unreleased section carries the beta's entries" — passed.
- AC2 → `scripts/lib/release/plan.test.mjs` › "an empty Unreleased section refuses with a reason
  and plans no writes" — passed.
- AC3 → `scripts/lib/release/plan.test.mjs` › "a release promotes Unreleased into a dated
  section, writes the version to package.json and lockfile, and plans one commit and one tag"
  — passed.
- AC4 → `scripts/lib/release/artifacts.test.mjs` › "the asset set is installer, zip, both
  blockmaps and latest.yml, and a missing one refuses", plus `wiring.test.mjs` › "electron-builder
  publishes to Hantsch/q2-launcher so latest.yml is written" — both passed.
  **Manual residue:** the actual `gh release create` against github.com — an external-service
  side effect no test may perform; the exact argv (including the real asset paths and the
  `--prerelease` flag) is asserted in `plan.test.mjs`/`scripts/release.test.mjs`.
- AC5 → `scripts/lib/release/plan.test.mjs` › "a dry run yields the version and the notes but no
  git or gh commands", exercised further by `scripts/release.test.mjs`'s dry-run suite (build +
  asset-check run, files reverted after, including on a thrown build/asset error) — passed.
- AC6 → `scripts/lib/release/plan.test.mjs` › "an explicit version and an explicit bump each
  override the derived one" — passed (moved here from the originally-planned `version.test.mjs`
  location; the story's Acceptance Tests section above was corrected to match).
- AC7 → `scripts/lib/release/plan.test.mjs` › "a second run on an unchanged tree refuses:
  Unreleased is empty and the tag already exists", plus `wiring.test.mjs` › "the release commit
  carries [skip ci] and the workflow skips such a commit" — both passed.
- AC8 → `scripts/lib/release/wiring.test.mjs` › "changelog-path points at CHANGELOG.md" — passed.

**Decisions made during implementation (beyond the story's own Decisions section):**
- **Multi-line changelog bullets are preserved verbatim.** The original parser only captured a
  bullet's first line; every wrapped bullet in the real `CHANGELOG.md` would have been truncated
  mid-sentence by `promote()`, corrupting both the committed changelog and the published release
  notes. Fixed to capture continuation lines into the same bullet, byte-for-byte.
- **The release tag is annotated, not lightweight** (`git tag -a <tag> -m <message>`). A
  lightweight tag is invisible to `git push --follow-tags`, so the tag would never have reached
  the remote — confirmed by reproducing against a local bare remote.
- **An explicit `--bump` overrides the prerelease-increment behaviour, not just `--version`.**
  The story's own Decisions section says `--bump` "still overrides" during the beta's
  prerelease phase; the first implementation only threaded `requestedVersion` past that
  behaviour, not an explicit `bump`. Fixed: `nextVersion` now takes an explicit/derived
  distinction — an explicit bump always performs a normal stable semver bump on the version's
  release core (dropping the prerelease identifier), while a derived bump keeps ticking the
  prerelease counter (`beta.1` → `beta.2`) for as long as the running version is a prerelease.
- **`scripts/release.mjs` writes the bumped `package.json`/`package-lock.json`/`CHANGELOG.md` to
  disk *before* running the build, in both dry and real runs**, because `electron-builder` reads
  the release version straight out of `package.json` for both `directories.output` and
  `artifactName` — building against the un-bumped version would produce artifacts the asset
  check could never find (the story's Plan §4 ordering, read literally, would have built before
  bumping; this is the corrected order). A dry run reverts all three files back to their
  original content afterwards (wrapped in `try`/`finally`, so a build or asset-check failure
  still reverts before the error propagates) — a real, CI-only run leaves them written and
  proceeds to commit/tag/push/`gh release create`.
- **The AC1 wiring test does not require `## Unreleased` to stay non-empty forever.** It sums
  bullets across `## Unreleased` and the most-recently-promoted version section, since
  `promote()` relocates bullets rather than deleting them — the original assertion would have
  turned every ordinary push to `main` after the first real release (whenever `## Unreleased`
  is legitimately empty pending the next user-facing story) into a hard-failing `npm test` step
  inside the release workflow, instead of the intended graceful no-op.
- **This story itself gets no `CHANGELOG.md` entry.** `changelog-path` only flips from `none` to
  `CHANGELOG.md` as part of this story's own D6; the rule it introduces applies to *future*
  user-facing stories. Story 096 is the release/publish mechanism itself — internal tooling and
  CI, not a change a user of the app perceives — so per the profile's own rule ("tests, refactors
  and internal changes get no entry"), nothing was added.
- **Accepted, not fixed:** the release workflow's `node scripts/release.mjs $ARGS` line leaves
  `$ARGS` unquoted (needed for its intended word-splitting into separate flags). Low severity —
  `parseArgs` rejects anything unrecognised, and the values driving it are restricted
  `workflow_dispatch` inputs (a `choice` and two short strings), not arbitrary user text — flagged
  by the second review pass as informational only; not worth a third review-fix cycle.
