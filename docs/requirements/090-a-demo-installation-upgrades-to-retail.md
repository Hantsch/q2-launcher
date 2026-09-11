---
id: 090
title: A demo installation upgrades to retail
status: ready
created: 2026-09-11
---

## Requirement

[[074]] gave a demo installation a visible marker but no way out of the demo state. This story
closes that loop — INST-D4: a demo installation offers an action that imports retail data from a
detected store installation, using the exact copy step [[088]] built, and turns the installation
into a normal, non-demo one without re-running the wizard or re-downloading the engine.

## Acceptance Criteria

- [ ] **AC1** — An installation carrying the Demo marker offers an "import retail data" action,
      reachable from wherever the marker itself appears ([[074]]'s tile, library card and action
      bar).
- [ ] **AC2** — When at least one store installation is detected, the action lets the user pick
      which one to copy retail data from, the same way [[088]]'s wizard step does.
- [ ] **AC3** — When no store installation is detected, the action says so plainly instead of
      offering a picker with nothing in it.
- [ ] **AC4** — Completing the action copies `pak0.pak`/`pak1.pak` (never links) from the chosen
      store installation into the existing installation's own folder, overwriting only the demo
      versions of those files — nothing else in the installation is touched.
- [ ] **AC5** — After the action completes, `inspectInstallation` no longer reports the demo check,
      the Demo marker disappears from tile, library card and action bar, and the installation's
      status is re-derived from the inspector, never hand-set.
- [ ] **AC6** — A chosen store installation whose paks cannot be verified as retail (per [[088]]'s
      AC3 check) is rejected with the same reason, before anything is copied.
- [ ] **AC7** — While the installation's own Quake II process is running, the action is unavailable
      (or refuses to start) rather than overwriting files out from under a running game.

## Decisions (Sprint)

- **(User)** Upgrade scope: paks only — the action copies `pak0.pak`/`pak1.pak` and does not
  backfill `video`/`players`, keeping it scoped to leaving the demo state (INST-D4), not media
  assets.

### Decided during refine

- **Job, not a direct copy (the story's own open question, now closed).** The action runs as a
  `JobsService` job (`moduleId: 'downloads'`, `installationId`, `cancellable: true`), visible in the
  Downloads tab like every other download job. Reason: the copy moves ~197 MB (`pak0.pak` 183 997 730 B
  + `pak1.pak` 12 992 754 B) out of a store folder that may sit on an HDD or an external drive — that
  needs progress, and INST-J1 forbids introducing a second progress mechanism next to `Job`;
  [[088]] runs the identical copy inside its bootstrap job, so reuse is cheapest with the same wrapper.
- **Expected reuse surface from [[088]]** (best guess, to be reconciled at build time — 088 is being
  refined in parallel): a main-side retail-source module under
  `src/main/modules/downloads/bootstrap/` (working names `retail-source.ts` / `retail-copy.ts`)
  exporting (a) a *verify* function that judges a candidate store folder's `pak0.pak`/`pak1.pak`
  against `RETAIL_PAK_SIZES` (`src/shared/constants.ts:54`) — 088's AC3 — and (b) a *copy* function
  that copies those two files into an installation — 088's AC4 — plus a `DOWNLOADS_HANDLERS` entry
  that lists detected store sources for the wizard's picker (088 AC1/AC2). **D1/D2 must call
  whatever 088 actually built and never add a second implementation**; if 088's routine is bound to
  the bootstrap job's internals, the build's first act is to lift it out, not to fork it.
- **The guard is a refusal, not a deferred write (AC7).** The action is disabled on every surface
  while `LaunchState.installationId === installation.id` and `phase` is `'starting'`/`'running'`
  (the pattern `ActionBar.tsx:257` already uses), and main refuses the start with
  `downloads.error.installationRunning`. Reason: AC7 explicitly allows "refuses to start", and
  INST-J7's wait-then-continue machinery does not exist yet — inventing it here would be a second
  story inside this one.
- **Overwrite is temp-file + rename, into the inspector-resolved base dir.** Each pak is written to
  `<baseDir>/<name>.part` and renamed over the target; the base directory is resolved
  case-insensitively the way `inspector.ts:164` does, never as a hardcoded `baseq2`. Reason: an
  interrupted 184 MB copy must not leave a truncated `pak0.pak` that the inspector then reports as
  demo data — the failure mode this story exists to remove.
- **No new state on `Installation`.** The demo state stays derived from the inspector check
  `validation.pak0NotRetail` ([[074]]'s decision, `src/renderer/src/lib/demo-data.ts:16`); the job
  finishes with `InstallationsService.validate(id)` and never sets a status or a flag by hand, and
  `Installation.source` is left untouched. Reason: AC5 demands exactly that, and it keeps the
  marker's single truth source intact.
- **The action is always offered on a demo installation; emptiness is explained inside the dialog.**
  AC3's "no store installation detected" message is a state of the dialog, not a hidden action.
  Reason: AC1 requires the action to be present wherever the marker is, so hiding it on an
  undetected-store machine would contradict AC1.
- **Detection uses the existing fast pass only** (`DetectionService.scan`,
  `src/main/services/detection/index.ts:52`), filtered to `source` ∈ steam/gog/epic; the opt-in deep
  drive walk is not triggered. Reason: the concept's INST-D2 says "found by the existing detection
  service", and a multi-minute drive scan behind a dialog button is not an upgrade action.
- **Entry points (AC1):** library card action cluster (`LibraryView.tsx:316`), action bar
  (`ActionBar.tsx:127`) and — for the rail tile — the tile's **hover card**
  (`InstallationRail.tsx:283`), which is where [[074]] put the tile's `DemoBadge`; the 64px tile
  itself keeps only its CSS microtag. Reason: the tile has no room for a button, and the hover card
  is the tile's own surface, so "wherever the marker appears" is satisfied without a new tile layout.
- **Shell files never import the module.** All three triggers are plain shell buttons calling
  `openDialog({ kind: 'module', moduleId: 'downloads', view: 'retail-upgrade' })` through the seam
  [[074]] D5 built; the dialog itself lives in the downloads module. Reason: CLAUDE.md's "a feature
  is a module — never edit the shell", resolved the same way 074 resolved it.
- **A dev-only `dev:simulateLaunch` channel** (`src/shared/ipc.ts`, `DEV_ONLY_CHANNELS`,
  `src/main/ipc/dev.ts`) lets the e2e flow put one installation into `running` through the real
  surface. Reason: fixture engine binaries are filler bytes and cannot be launched, so AC7 has no
  real-surface trigger otherwise — this is the same affordance class as the existing
  `dev:simulateJob`, behind the same dev-only allowlist, not a new production surface.
- **Fixture retail paks are created by `truncateSync` to the exact `RETAIL_PAK_SIZES` value**, not by
  writing 197 MB of real bytes. Reason: the check under test is a size check, and a length-only file
  keeps fixture setup instant while the copy itself still moves real data.

## Open Questions

None — the job/direct-copy question above is answered under "Decided during refine".

## Plan

1. **Contract + handlers** — `src/shared/modules/downloads.ts` gains `retail.sources` (only if
   [[088]] did not already add an equivalent lister) and `retail.upgradeStart` plus their input/result
   interfaces and `downloads.error.*` keys; schemas in the module's `schemas.ts`; handlers registered
   in `src/main/modules/downloads/index.ts`; renderer client in `modules/downloads/client.ts`.
2. **The upgrade job** (`src/main/modules/downloads/retail/upgrade-job.ts`) — resolve installation →
   refuse if that installation is running → verify the chosen source with [[088]]'s retail check →
   copy `pak0.pak`/`pak1.pak` via [[088]]'s copy routine into the inspector-resolved base dir
   (temp + rename) → `InstallationsService.validate(id)`; progress and cancel through `jobs.create`
   exactly as `bootstrap/job.ts:698` does.
3. **The dialog** (`modules/downloads/retail/RetailUpgradeDialog.tsx`, reached through the module's
   `Dialogs.tsx` `view` switch) — source picker (store + path, same rendering as 088's wizard step),
   the "nothing detected" state, the rejected-source reason, and the running job's state.
4. **The triggers** — library card, action bar, rail hover card; disabled while that installation's
   game runs.
5. **`dev:simulateLaunch`** — dev-only channel so the harness can produce a running installation.
6. **E2e** — a demo fixture installation + a fixture store source, and
   `scripts/flows/retail-upgrade.mjs` walking the whole action on the real surface.

Order: D1 → D2 → D3 → D4 → D5 → D6. D3/D4 may start once D1 exists.

## Deliverables

- [ ] **D1 — Contract, schemas and handlers.** `src/shared/modules/downloads.ts`,
  `src/main/modules/downloads/schemas.ts`, `src/main/modules/downloads/index.ts`,
  `src/renderer/src/modules/downloads/client.ts`. Mirror [[074]] D1's `bootstrap.start` /
  `bootstrap.engineOptions` wiring. **First step: read what [[088]] landed and reuse its
  store-source lister instead of declaring a second one.** *Acceptance:* `module:invoke` reaches a
  `retail.upgradeStart` handler and a store-source lister; every handler carries a zod schema;
  typecheck + build green. Test: `src/main/modules/downloads/retail/sources.test.ts` — "only
  steam/gog/epic candidates are offered, each with store and path".
- [ ] **D2 — The upgrade job.** `src/main/modules/downloads/retail/upgrade-job.ts` (+
  `upgrade-job.test.ts`), error keys in the module's `errors.ts`. Mirror
  `src/main/modules/downloads/bootstrap/job.ts` (job creation, cancel callback, error mapping).
  *Acceptance (with fakes for the launch service, the inspector and [[088]]'s copy routine):*
  refuses while that installation is running; rejects an unverifiable source before writing a byte;
  writes only `pak0.pak`/`pak1.pak` into the resolved base dir via temp + rename; leaves every other
  file untouched; finishes by calling `InstallationsService.validate()` and never sets a status by
  hand. Proves AC4, AC6, AC7 (main) and AC5's "re-derived, never hand-set" half.
- [ ] **D3 — The retail-upgrade dialog.**
  `src/renderer/src/modules/downloads/retail/RetailUpgradeDialog.tsx`,
  `src/renderer/src/modules/downloads/bootstrap/Dialogs.tsx` (switch on `view`),
  `src/renderer/src/i18n/locales/en.json`. Mirror the wizard's step components for dialog shape and
  reuse [[088]]'s source-list rendering where it is a component. *Acceptance:* with sources present
  the dialog lists each by store and path and starts the job on confirm; with none it renders the
  plain "no store installation detected" message and no picker; a rejected source shows [[088]]'s
  reason. `data-testid`s for the flow. Proves AC2, AC3.
- [ ] **D4 — The three triggers.** `src/renderer/src/views/LibraryView.tsx`,
  `src/renderer/src/components/shell/ActionBar.tsx`,
  `src/renderer/src/components/shell/InstallationRail.tsx` (hover card),
  `src/renderer/src/i18n/locales/en.json`. Mirror `LibraryView.tsx:107`'s
  `openDialog({ kind: 'module', … })` call and `ActionBar.tsx:257`'s launch-state gate.
  *Acceptance:* the action appears exactly where `isDemoData` is true, on all three surfaces, opens
  the D3 dialog, is disabled while that installation is running, and no shell file imports a
  downloads component. Proves AC1 and AC7's renderer half.
- [ ] **D5 — Dev-only launch-state simulation.** `src/shared/ipc.ts` (channel + `DEV_ONLY_CHANNELS`),
  `src/main/ipc/dev.ts`, `src/preload` channel arrays. Mirror `dev:simulateJob` exactly, including
  its dev-only registration. *Acceptance:* `dev:simulateLaunch` puts one installation into
  `running`/`idle` and broadcasts `launch:state`; a test asserts the channel is in
  `DEV_ONLY_CHANNELS` and is not registered outside dev.
- [ ] **D6 — Offline end-to-end proof.** `scripts/lib/fixture.mjs` (a demo installation with a
  non-retail `pak0.pak`, plus a fixture "store" folder whose paks are `truncateSync`'d to the exact
  `RETAIL_PAK_SIZES`, and a second one with wrong sizes), `scripts/flows/retail-upgrade.mjs`,
  `docs/UI-VERIFICATION.md`. Mirror `scripts/flows/bootstrap-wizard.mjs` (on-disk assertions) and
  `scripts/flows/downloads-badge-count.mjs` (dev-channel seeding). *Acceptance:*
  `npm run ui:flow -- retail-upgrade` sees the action on tile hover card, card and action bar; picks
  the good source; the job completes; the Demo marker is gone from all three surfaces afterwards; an
  on-disk check shows exactly `pak0.pak`/`pak1.pak` changed and a marker file elsewhere in the
  installation untouched; the bad source is rejected with its reason; and with `dev:simulateLaunch`
  the action is disabled. No network access.

## Model Hints

- `D2 → deliverable-hard` — it overwrites ~197 MB in place inside an already-registered
  installation the shell believes in: a mis-resolved base dir, a non-atomic rename or a missed
  running-game guard destroys user data instead of upgrading it, and it consumes a routine another
  story built in parallel.
- All other deliverables: default tier.
- `Review: → story-review-hard` — the story mutates a live installation's files destructively, adds
  a dev-only channel that fakes launch state, and AC4's "nothing else is touched" is a negative
  requirement a diff-blind review would nod through.

## Acceptance Tests

- AC1 → e2e `npm run ui:flow -- retail-upgrade` (`scripts/flows/retail-upgrade.mjs`) › "the demo
  installation offers the import-retail action on rail hover card, library card and action bar"
- AC2 → e2e `scripts/flows/retail-upgrade.mjs` › "the dialog lists every detected store
  installation by store and path", plus unit
  `src/main/modules/downloads/retail/sources.test.ts` › "only steam/gog/epic candidates are offered"
- AC3 → e2e `scripts/flows/retail-upgrade.mjs` › "with no store installation detected the dialog
  says so instead of showing an empty picker"
- AC4 → unit `src/main/modules/downloads/retail/upgrade-job.test.ts` › "only pak0.pak and pak1.pak
  are written, every other file in the installation is untouched", plus the on-disk assertion in
  `scripts/flows/retail-upgrade.mjs` › "only the two paks changed on disk"
- AC5 → e2e `scripts/flows/retail-upgrade.mjs` › "after the upgrade the Demo marker is gone from
  hover card, library card and action bar", plus unit `…/retail/upgrade-job.test.ts` › "the status
  comes from InstallationsService.validate(), never hand-set"
- AC6 → unit `…/retail/upgrade-job.test.ts` › "a source whose paks fail the retail check is rejected
  before anything is copied", plus e2e `scripts/flows/retail-upgrade.mjs` › "the unverifiable source
  is rejected with its reason"
- AC7 → e2e `scripts/flows/retail-upgrade.mjs` › "while the installation is running the action is
  disabled on every surface" (running state produced through the real surface via D5's
  `dev:simulateLaunch`), plus unit `…/retail/upgrade-job.test.ts` › "the job refuses to start while
  that installation is running"

No manual residue: every criterion has an automated test. The one risk carried into the build is
D1/D2's dependency on [[088]]'s retail verify/copy routine — if 088 named it differently, that is an
import fix, not a re-plan; if 088 left it welded into its bootstrap job, D2's first task is to lift
it out rather than fork it.
