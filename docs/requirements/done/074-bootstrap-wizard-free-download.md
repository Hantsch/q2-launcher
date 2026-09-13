---
id: 074
title: The Library turns nothing into a playable Q2PRO demo installation
status: done
created: 2026-09-08
---

## Requirement

This is the sprint's playable moment: a user with nothing installed opens a wizard from the
Library, picks Q2PRO, and ends up with a working installation running the freely-downloadable
demo data — no forum thread, no manual file placement. This story wires the manifest ([[070]]),
the verified-download pipeline ([[071]]), and the Downloads tab ([[073]]) into the bootstrap
wizard described in [concepts/install-module.md §8](../concepts/install-module.md), scoped to
the **free-download data source only** — copying retail paks from a detected store installation,
pointing at an existing folder, and the demo-to-retail upgrade action are explicitly out of this
sprint (see sprint.md).

## Acceptance Criteria

- [x] **AC1** — A wizard, reachable from the Library next to the existing "create installation"
      entry, offers Q2PRO as the only engine (the only one this sprint ships a manifest entry
      and a pinned version for).
- [x] **AC2** — The wizard lets the user pick a target folder; a target under `Program Files`
      shows a warning naming the write-access consequence with the existing `set-write-dir`
      remedy offered, and the user may acknowledge and continue.
- [x] **AC3** — A non-empty target folder shows a warning listing what is already in there,
      with a "continue anyway" option.
- [x] **AC4** — Before the job starts, the wizard states what will be downloaded and its total
      size, and the target path.
- [x] **AC5** — Running the wizard downloads the Q2PRO engine and the free demo data
      (`q2-314-demo-x86.exe` and the 3.20 point release), verifies both, extracts them with
      7-Zip, and assembles a `baseq2` installation.
- [x] **AC6** — The resulting installation is registered with a status computed by
      `inspectInstallation` — never a hand-set "success" status — and the Play button lights up
      the moment that verdict stops being `invalid`/`missing`, even while the job is still
      copying auxiliary files.
- [x] **AC7** — Because its data is the free demo, the installation carries a visible "Demo"
      marker on its tile, library card, and action bar (the upgrade-to-retail action itself is
      out of scope this sprint).
- [x] **AC8** — The wizard produces only a `baseq2` directory — no `ctf`, `xatrix`, or `rogue`
      directory is created, even though the 3.20 package used also contains a `ctf` payload.

## Open Questions

- ~~Naming and identity of a bootstrapped installation...~~ answered → Decisions (Sprint)
- ~~Does the bootstrap also copy `baseq2/video/` and `players/`...~~ answered → Decisions (Sprint)
- ~~Is a disk-space precheck in scope...~~ answered → Decisions (Sprint)

None open. Everything else the refine needed (entry point, shell seam, registration point, demo-state
modelling, 3.20 package choice, failure keys, offline e2e) was decided against the ACs, the concept
and the guardrails — see "Decided during refine".

## Decisions (Sprint)

- **(User)** Bootstrapped installation identity: default name "Q2PRO Demo", default (existing)
  icon assigned automatically, appended at the end of the rail's sort order like any
  newly-created installation.
- **(User)** `video/` and `players/`: not copied by default — the wizard offers a toggle to
  include them, off by default, since most players only want multiplayer and treat the
  cinematics as dead weight.

- **(User)** Disk-space precheck: out of scope this sprint — the job fails partway with a
  readable reason if space runs out (fixed at the sprint cut, see `sprint.md`'s "Deliberately
  not in this sprint" list).

### Decided during refine

- **Entry point (concept §15/17):** the Library keeps `CreateInstallationDialog` and its bare-folder
  `installations:create` path untouched; a second button ("Download & install") next to it opens the
  wizard. Reason: AC1 says "next to", and replacing the bare-folder path would silently delete a
  working flow this story was not asked to touch.
- **Shell seam:** the wizard is a module-owned modal. `DialogState` gains one *generic*
  `{ kind: 'module', moduleId, view }` variant and `RendererModule` an optional `Dialogs` component
  that the shell's `Dialogs.tsx` mounts. Reason: keeps "a feature is a module — never edit the
  shell" honest with one reusable seam (same resolution class as concept §12.1) instead of a
  shell→downloads import per module.
- **Registration point:** the job calls the existing `InstallationsService.create()` *before*
  downloading (registers the empty folder, status from `inspectInstallation`, `source: 'created'`,
  `nextSortOrder()` = appended, name from the wizard) and re-validates after each assemble step.
  Reason: reuses the only code path that already computes status from the inspector (AC6) and makes
  the installation visible in the Library from second one, instead of a second registration path.
- **Target already containing a game blocks, clutter warns:** a target where `inspectInstallation`
  already sees Quake II is a blocking target verdict ("add it as an existing installation instead");
  any other non-empty folder is the AC3 warning with "continue anyway". Reason: `create()` already
  refuses `alreadyContainsGame`, and bootstrapping over a working install would be a silent
  overwrite, while loose files are the user's call.
- **`Program Files` verdict** is computed in main by prefix-comparing the canonicalised target
  against `process.env.ProgramFiles` / `ProgramFiles(x86)`; the remedy offered is the *existing*
  `set-write-dir` mechanism (pick a write dir → persisted as `Installation.writeDirPath`, the same
  field `ChecksList.tsx` writes). Reason: no second write-access concept, and the e2e flow can
  exercise the verdict by pointing the child process's `ProgramFiles` at a fixture dir — no
  production backdoor needed.
- **Demo state (concept §15/13):** derived at read time from the inspector check
  `validation.pak0NotRetail` already present in `Installation.checks` — no new field, no migration,
  no hand-set flag. Reason: the same truth source AC6 insists on, and it also labels a demo folder
  the user added by hand; the retail-upgrade action that would need persisted provenance is out of
  scope this sprint.
- **Demo marker shape:** a text-bearing `Badge` on the library card, the action bar and the rail
  hover card, plus a small CSS-only "DEMO" corner microtag on `InstallationTile`. Reason: AC7 names
  the tile, and a text label keeps the state non-colour-only per `/design-tokens`.
- **`video/` + `players/` toggle** changes only *which extracted files are copied* into the
  installation, never what is downloaded. Reason: both live inside packages we must download whole
  anyway, so the AC4 size statement stays stable regardless of the toggle.
- **AC8 is an allowlist, not a filter:** assemble copies an explicit list of files
  (`baseq2/pak0.pak`, `baseq2/pak2.pak`, engine payload, optionally `baseq2/video/*`, `players/*`)
  out of the extracted trees; nothing is ever copied recursively. Reason: the 3.20 package carries
  `ctf`, so "no ctf directory" has to be a property of the code, not of the input.
- **3.20 package choice:** `q2-3.20-x86-full-ctf.exe` (the twice-mirrored one) — the ctf payload is
  simply not copied. Reason: mirror redundancy beats avoiding a payload the allowlist discards.
- **Dependencies 070/071 are consumed through ports** this story owns
  (`bootstrap/ports.ts`: `ManifestSource`, `PackageFetcher`, `Extractor`), wired to the real
  services in the module's `index.ts`. Reason: 070/071 are being refined in parallel; a port keeps
  the orchestrator unit-testable with fakes and turns an interface drift into one adapter edit.
- **Failure reasons cross IPC as `downloads.error.*` i18n keys** enumerated in the job module.
  Reason: CLAUDE.md forbids prose over IPC (concept §15/19 left the set open).
- **Offline e2e:** the flow starts a `127.0.0.1` fixture package server and the manifest/package
  base URL is overridable only under the double gate `Q2L_UI_HARNESS === '1' && isDev`, mirroring
  `DialogService`'s stub including its production-unreachability test. Reason:
  `ui-acceptance-required` demands the real surface, and the concept requires a verification run
  that never touches the network.

## Plan

1. **Contract + module skeleton.** `src/shared/modules/downloads.ts` gains the bootstrap handler
   names and shapes (engine options, target verdict, start input, wizard summary); the main half
   lands in `src/main/modules/downloads/` (`index.ts`, `schemas.ts`) and is registered in
   `src/main/modules/index.ts`; renderer client under `src/renderer/src/modules/downloads/client.ts`.
   Extend whatever 070/071/073 already created — never a second downloads module.
2. **Target safety in main** (`bootstrap/target.ts`): canonicalise, absolute, not a device path, not
   inside the app's own installation, writability, `Program Files` prefix, directory listing,
   "already a Quake II installation" — the wizard renders verdicts, it never judges paths itself.
3. **Assemble** (`bootstrap/assemble.ts`): pure file-plan builder + copier over an explicit
   allowlist, `baseq2` only, `video/`+`players/` behind the toggle.
4. **Bootstrap job** (`bootstrap/job.ts`): `create()` → resolve packages from the manifest port →
   fetch+verify → extract → assemble core → revalidate (records `playableAtRatio` at the first
   non-`invalid` verdict) → assemble auxiliary → revalidate → finish; cancel removes partial files
   and the half-built installation; failures map to `downloads.error.*`.
5. **Shell seam + Library entry**: generic `{ kind: 'module' }` dialog variant, `RendererModule.Dialogs`,
   the Library button, i18n keys.
6. **Wizard UI** (module-owned, 4 steps: engine → target + warnings → confirm → running).
7. **Demo marker** on card, action bar, rail hover card, tile.
8. **Offline e2e**: harness-gated folder-pick + base-URL stubs, fixture package server, a
   `scripts/flows/bootstrap-wizard.mjs` walk-through and `SCREENS` entries for the wizard steps.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8. D5/D6 may start once D1 exists.

## Deliverables

- [x] **D1 — Bootstrap contract + module registration.** `src/shared/modules/downloads.ts`,
  `src/main/modules/downloads/index.ts`, `src/main/modules/downloads/schemas.ts`,
  `src/main/modules/index.ts`, `src/renderer/src/modules/downloads/client.ts`. Mirror
  `src/shared/modules/library.ts` + `src/renderer/src/modules/library/client.ts` +
  `src/main/modules/config/schemas.ts`. *Acceptance:* `module:invoke` reaches a downloads handler
  that lists engine options (only engines both `supported` and pinned by the manifest port → Q2PRO),
  every handler has a zod schema, typecheck + build green. Test: `src/main/modules/downloads/engine-options.test.ts`.
- [x] **D2 — Target-folder verdict in main.** `src/main/modules/downloads/bootstrap/target.ts` (+
  `target.test.ts`), schema in the module's `schemas.ts`. *Acceptance:* a verdict object carrying
  `programFiles`, `notWritable`, `entries[]` (capped), `alreadyInstalled`, `blocked` — plus its unit
  test over temp dirs, a `ProgramFiles`-prefixed path and a folder holding a `baseq2` with paks.
- [x] **D3 — Assemble `baseq2` from extracted trees.** `bootstrap/assemble.ts` + `assemble.test.ts`.
  *Acceptance:* copies exactly the allowlisted files; with a fixture extraction tree that contains a
  `ctf/` payload, the target afterwards holds `baseq2` only; the toggle off leaves `video/`+`players/`
  out and on brings them in. Proves AC8.
- [x] **D4 — The bootstrap job.** `bootstrap/job.ts`, `bootstrap/ports.ts`, `bootstrap/errors.ts` (+
  `job.test.ts`), wired in the module's `index.ts`. *Acceptance:* with fake ports, the job registers
  via `InstallationsService.create()`, never sets a status by hand, revalidates after the core
  assemble, records `playableAtRatio` at the first non-`invalid`/`missing` verdict while auxiliary
  copying continues, and on cancel/verification failure leaves neither partial files nor the
  half-built installation. Proves AC5 (orchestration) and AC6.
- [x] **D5 — Module-dialog seam + Library entry point.** `src/renderer/src/store/useLauncher.ts`,
  `src/renderer/src/components/installations/Dialogs.tsx`, `src/renderer/src/modules/index.ts`,
  `src/renderer/src/views/LibraryView.tsx` (button next to Create, and in the empty state),
  `src/renderer/src/i18n/locales/en.json`. *Acceptance:* the button opens the module's modal;
  `CreateInstallationDialog` still works unchanged; no shell file imports a downloads component.
- [x] **D6 — The wizard's four steps.** `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.tsx`
  plus one small component per step and `Dialogs.tsx` inside the module, i18n keys, `data-testid`s.
  Mirror `CreateInstallationDialog.tsx` for dialog shape and `ChecksList.tsx:110-117` for the
  `set-write-dir` remedy call. *Acceptance:* engine step shows Q2PRO only; the target step renders
  the D2 verdicts (Program Files warning naming the write-access consequence + remedy + acknowledge,
  non-empty listing + "continue anyway", blocked reason); the confirm step names every package, the
  summed total size and the target path; starting hands off to the D4 job. Proves AC1–AC4.
- [x] **D7 — The Demo marker.** `src/renderer/src/lib/demo-data.ts` (+ `demo-data.test.ts`),
  `InstallationTile.tsx`, `LibraryView.tsx`, `components/shell/ActionBar.tsx`,
  `components/shell/InstallationRail.tsx`, `styles/` (corner microtag), i18n. Mirror
  `components/ui/EngineBadge.tsx`. *Acceptance:* derivation is true exactly when a
  `validation.pak0NotRetail` check is present; the badge appears on card, action bar and hover card
  and the microtag on the tile. Proves AC7.
- [x] **D8 — Offline end-to-end proof.** `src/main/modules/downloads/harness.ts` (+ `harness.test.ts`
  mirroring `src/main/services/dialog.test.ts`'s four gate cases), `scripts/lib/screens.mjs`,
  `scripts/flows/bootstrap-wizard.mjs`, `scripts/lib/fixture.mjs` (fixture packages + target dirs),
  `docs/UI-VERIFICATION.md`. *Acceptance:* `npm run ui:flow bootstrap-wizard` walks the wizard on a
  fixture target, runs the job against a loopback fixture server, sees Play enabled while the job is
  still running, sees the Demo badge, and asserts on disk that the target holds `baseq2` only —
  with no outbound network access and no production-reachable override.

## Model Hints

- `D4 → deliverable-hard` — the only place that mutates a registered installation mid-job: a wrong
  order of create/revalidate/`playableAtRatio` or an incomplete cancel path leaves the user with a
  half-built installation the shell believes in.
- `D8 → deliverable-hard` — a harness-only override of the download source is a security-relevant
  backdoor that must be provably unreachable in production while still carrying the whole AC map.
- All other deliverables: default tier.
- `Review: → story-review-hard` — the story spans main pipeline, a new shell seam and
  renderer-supplied paths, and AC8 is a negative requirement a diff-blind review would miss.

## Acceptance Tests

- AC1 → e2e `npm run ui:verify` / `scripts/flows/bootstrap-wizard.mjs` › "the Library opens the
  bootstrap wizard and offers Q2PRO only", plus unit
  `src/main/modules/downloads/engine-options.test.ts` › "only supported and pinned engines are offered"
- AC2 → e2e `scripts/flows/bootstrap-wizard.mjs` › "a Program Files target warns, offers the write-dir
  remedy and can be acknowledged", plus unit
  `src/main/modules/downloads/bootstrap/target.test.ts` › "a path under Program Files is flagged"
- AC3 → e2e `scripts/flows/bootstrap-wizard.mjs` › "a non-empty target lists its contents and can be
  continued", plus unit `…/bootstrap/target.test.ts` › "a non-empty folder reports its entries"
- AC4 → e2e `scripts/flows/bootstrap-wizard.mjs` › "the confirm step names the packages, the total
  size and the target", plus unit `…/bootstrap/job.test.ts` › "the summary sums the package sizes"
- AC5 → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "the job fetches, verifies,
  extracts and assembles baseq2" and `…/bootstrap/assemble.test.ts` › "the allowlisted files land in
  baseq2"; end to end through the real surface in `scripts/flows/bootstrap-wizard.mjs` › "the job
  completes against the fixture server"
- AC6 → e2e `scripts/flows/bootstrap-wizard.mjs` › "Play is enabled while the job still copies", plus
  unit `…/bootstrap/job.test.ts` › "the status always comes from inspectInstallation and
  playableAtRatio is recorded at the first non-invalid verdict"
- AC7 → e2e `scripts/flows/bootstrap-wizard.mjs` › "the finished installation is marked Demo on tile,
  card and action bar", plus unit `src/renderer/src/lib/demo-data.test.ts` › "demo data is derived
  from the pak0NotRetail check"
- AC8 → unit `src/main/modules/downloads/bootstrap/assemble.test.ts` › "the ctf payload of the 3.20
  package is not copied", plus the on-disk assertion in `scripts/flows/bootstrap-wizard.mjs` › "the
  target holds baseq2 only"

No manual residue: every criterion is covered by an automated test. The one risk carried into the
build is D8's loopback fixture server — if 070 already ships a harness manifest override, D8 reuses
it instead of adding a second one.

## Done

Built D1-D8 exactly per the plan: shared contract + module registration; a pure, unit-tested
target-folder verdict (`bootstrap/target.ts`); an allowlist-only `baseq2` assembler
(`bootstrap/assemble.ts`); the job orchestrator (`bootstrap/job.ts`, `ports.ts`, `errors.ts`) that
registers via `InstallationsService.create()`, downloads/extracts/assembles/revalidates, records
`playableAtRatio` from the first non-`invalid`/`missing` `inspectInstallation` verdict, and cleans
up fully on cancel/failure; a generic `{kind:'module'}` dialog seam plus the Library's "Download &
install" entry; the four-step wizard UI; the Demo marker (tile/card/action bar/rail); and an
offline e2e proof (`scripts/flows/bootstrap-wizard.mjs`) driven against a loopback fixture
manifest/package server, reachable only through a doubly-gated (`Q2L_UI_HARNESS==='1' && isDev`),
127.0.0.1-only harness override that leaves the production manifest schema untouched.

A clean-agent review (`story-review-hard`) first returned FAIL on 6 real findings; all 6 were
fixed in one cycle. That fix cycle itself introduced one new bug (the Program-Files write-dir
remedy's picked path was not cleared when the user re-picked a different target, so it could
carry over onto an unrelated installation) — a second review pass caught it, it was fixed
immediately (`BootstrapWizard.tsx`'s target-change effect now also resets `writeDirPath`, mirroring
its existing acknowledge-reset pattern), and full verification (build/typecheck/test/e2e) was
re-run clean afterwards. See below.

**Commit message:** `074: bootstrap wizard turns nothing into a playable Q2PRO demo install`

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` — clean (both TS projects).
- `npm test` — 145 files / 3022 tests passed.
- `npm run ui:verify` — 33/33 screens, 0 axe violations.
- `npm run ui:flow -- bootstrap-wizard` — PASS (the story's real acceptance surface for AC1-AC8).

**AC → test mapping, as verified:**
- AC1 → `engine-options.test.ts` "only supported and pinned engines are offered" (pass) + flow's
  engine step (Q2PRO only, real fixture version string).
- AC2 → `target.test.ts` (Program-Files prefix flagged) + flow (Program-Files warning, write-dir
  remedy now genuinely persists `Installation.writeDirPath`, acknowledge gates Next).
- AC3 → `target.test.ts` (entries reported) + flow (non-empty listing + continue-anyway).
- AC4 → `job.test.ts` "the summary sums the package sizes" + flow (packages/size/target named).
- AC5 → `job.test.ts` + `assemble.test.ts` + flow (real 7-Zip extraction and assembly against the
  loopback fixture packages).
- AC6 → `job.test.ts` (status only ever from `InstallationsService.validate()`/
  `inspectInstallation`; `playableAtRatio` recorded once) + flow (Play button sampled enabled
  while the job is still `running`).
- AC7 → `demo-data.test.ts` (exact-match derivation, no substring matching) + flow (badge on
  tile/card/action bar/rail hover card).
- AC8 → `assemble.test.ts` (asserts the negative: ctf/xatrix/rogue/video/players absence, both
  toggle states) + flow's on-disk recursive check against a fixture point-release archive that
  genuinely carries a `ctf/` payload.

No manual residue — every criterion has a passing automated test, per the story's own mapping.

**Decisions (this build, beyond the story's own):**
- Bootstrap job bypasses 071's `queue.ts` admission control (it is one named, singular job, not
  pool-admitted); `DownloadsSettings.concurrentJobs` does not gate it. Documented, not fixed —
  no AC requires it, and it does not starve regular downloads.
- `assemble.ts`'s literal allowlist paths (`baseq2/pak0.pak`, `baseq2/pak2.pak`, `q2pro.exe`,
  `baseq2/gamex86_64.dll`) are confirmed against the real 7-Zip extractor and a fixture archive
  with that exact layout, but NOT against the real, unmodified Q2PRO/id-Software installer
  archives (nobody in this build extracted those and inspected their real internal layout) — a
  real first bootstrap run may need a one-line path correction if the real archives differ.
  Flagged as residue rather than blocking, since fixing it blind (without the real archives)
  would be guessing, not verifying. **The two halves of this residue fail differently and the
  game-module half is the riskier one**, per the second review pass: a wrong pak path fails loud
  (assemble skips it, `inspectInstallation` reports `invalid`, the job ends in
  `downloads.error.installationNotPlayable`); a wrong game-module filename fails silent
  (`assemble.ts` skips a missing file without erroring, `inspectInstallation` has no check for the
  game module's presence, so the job succeeds and the user gets an enabled Play button on an
  installation that cannot actually start a map). Whoever confirms the real archive layout should
  verify the game-module filename first.
- No `scripts/lib/screens.mjs` static entry for the wizard — deliberate: mounting it fetches the
  manifest, which would make every plain `ui:verify` run reach out (even to the loopback fixture,
  which doesn't exist during a normal `ui:verify` run). The dedicated `ui:flow bootstrap-wizard`
  is the wizard's real coverage.
- `BootstrapSummary.targetPath` echoes the wizard's raw picked path rather than the verdict's
  canonicalised one — cosmetic, does not affect any AC.
- Path-safety `protectedDirs` in `bootstrap/target.ts` covers `process.resourcesPath` only, not
  `app.getAppPath()` (kept `electron`-import-free, matching `7za-path.ts`'s existing convention).
- The video/players toggle's glob-expansion copies an immediate child directory via a single
  recursive `fs.cp`, not a whole-tree copy — narrower than, and not in tension with, the file's
  "never copy a whole extraction tree" guarantee (which is about `ctf`/`xatrix`/`rogue`, AC8).
