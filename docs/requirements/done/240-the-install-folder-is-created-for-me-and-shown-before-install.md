---
id: 240
title: the install folder is created for me and shown before I install
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a new user installing Quake II, I pick _where_ it goes and the launcher creates the installation's
own folder there, showing me the exact final path before anything is written — I never have to know
that I should create an empty folder first.

User feedback 2026-10-04: when choosing a folder you only choose where it installs to; the folder
should be created and shown — users do not realise they must create a folder.

Today the picker (`showOpenDialog`, `openDirectory` + `createDirectory`, the latter macOS-only)
returns a folder and the wizard installs **directly into it**. Users pick `D:\Games`, get a
"folder not empty" warning they do not understand, or end up with Quake II files spread over
`D:\Games`.

Concept: [install-module.md](../../systems/install-module.md).

## Acceptance Criteria

- [x] **AC1** — The target step asks for a parent location and proposes a new subfolder in it,
      named after the installation (e.g. `D:\Games\Quake II`), which the user can edit.
- [x] **AC2** — The full final path is shown as text in the target step and again on the confirm
      step, before anything is written.
- [x] **AC3** — The launcher creates the folder when the install starts; the user never has to create
      it in the file dialog.
- [x] **AC4** — If the proposed subfolder already exists and is not empty, the launcher proposes a
      free name (`Quake II (2)`) instead of warning about a non-empty target.
- [x] **AC5** — Choosing a folder that is already an empty folder still works: the user can say
      "install right here" and the subfolder is not added.
- [x] **AC6** — Unsafe or blocked targets (Program Files, not writable, already an installation) are
      still judged — on the final path, not the parent.
- [x] **AC7** — A cancelled or failed install removes the folder the launcher created, if it is
      still empty.

## Open Questions

- ~~**Q1** — Default subfolder name: the installation's name, or a fixed `Quake2`? Recommendation:
  the installation name, sanitised for the file system (depends on [[239]]'s name field).~~ answered → Decisions (Sprint)
- ~~**Q2** — Is "install right here" (AC5) automatic when the chosen folder is empty, or an explicit
  option? Recommendation: automatic for an empty folder, with the shown path making it obvious.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Default subfolder: the installation name, sanitised.
- **(User)** "Install right here": automatic when the chosen folder is empty.
- The proposal (sanitise, free name, install-here) is computed in main by a new module handler
  `bootstrap.proposeTarget`, because "exists / is empty" needs the file system and the renderer
  never joins or trusts paths.
- The sanitiser is a pure shared function (`toFolderName`), so main and renderer tests agree on one
  rule; invalid characters `<>:"/\|?*` and control characters become `_`, trailing dots/spaces are
  trimmed, Windows reserved device names get a trailing `_`, an empty result falls back to
  `Quake II`.
- The folder name follows the wizard's installation name ([[239]]'s field, its default included)
  until the user edits the folder-name field; after that it is the user's — so a rename in one place
  never silently overrides an explicit choice in the other.
- The free name (`Quake II (2)`, up to `(99)`) applies only to the automatic proposal; a folder name
  the user typed is taken as-is (sanitised) and an existing non-empty folder of that name gets the
  existing non-empty warning — the user asked for exactly that folder.
- A free-name collision is an existing entry that is non-empty or not a directory; an existing empty
  subfolder is reused, matching AC5's "an empty folder is fine to install into".
- Install-here mode hides the folder-name field and states in text that the install goes directly
  into this empty folder; there is no toggle (User decision: automatic).
- A picked path that does not exist is treated like an empty folder (install-here), since it names a
  folder the launcher will create anyway — and it keeps the failure-retry flow's adoption path.
- AC6: the existing `computeTargetVerdict` is queried with the final path only; it already handles a
  not-yet-existing path via `nearestExistingAncestor`, so no new verdict logic, only tests.
- AC3: the job `mkdir`s the final target explicitly at start (before `create()`), with
  `targetPreexisted` taken before it, so "the launcher creates it" is a stated step, not a side
  effect of `create()`'s baseq2 `mkdir`.
- AC7 vs [[077]]: on failure the job now also `rmdir`s the target root when it created it
  (`removeRoot: !targetPreexisted`, `rmdir` succeeds only if empty); the registration and
  `lastFailure` still survive, so the installation shows `missing` instead of `invalid` — 077's
  user decision explicitly allowed "an honest `missing`/`invalid` state", and the retry recreates
  the folder through the start-time `mkdir` and adopts by path as before.
- A pre-existing folder (install-here) is never removed on cancel or failure — unchanged
  `targetPreexisted` rule.

## Plan

1. **Shared + main proposal (D1).** `toFolderName(name)` in `src/shared/modules/downloads-folder-name.ts`;
   `proposeBootstrapTarget(parentPath, folderName, { userTyped })` in
   `src/main/modules/downloads/bootstrap/target.ts`; module handler `bootstrap.proposeTarget`
   (`DOWNLOADS_HANDLERS`, schema in `src/main/modules/downloads/schemas.ts`). Returns
   `{ targetPath, folderName, installHere }`.
2. **Job (D2).** Explicit start-time `mkdir` of the final target; failure cleanup gets
   `removeRoot: !targetPreexisted`; module comment in `job.ts` updated to the new failure rule.
3. **Renderer (D3).** `TargetStep` becomes "parent location + folder name + final path"; the wizard
   holds `parentPath` / `folderName` / `folderNameEdited`, queries the proposal, then the verdict on
   the proposal's `targetPath` (acks reset on that path as today). `ConfirmStep` already states the
   target path — it gets the final one. i18n `en`, CHANGELOG line.
4. **E2E (D4).** New flow `bootstrap-target-subfolder` drives AC1–AC5 through the real wizard;
   `docs/systems/install-module.md` §8 step 3 rewritten.
5. **Flow sweep (D5).** Every existing `bootstrap-*` flow whose `Q2L_UI_PICK_FOLDER` target is
   non-empty now gets a subfolder — update their expected paths; `bootstrap-failure*` assert the
   new failure cleanup.

Order: D1 → D2 → D3 → D4 → D5 (D5 last because D3 changes what every flow sees). Built after
[[239]], whose name field D3 reads.

## Deliverables

- **D1 — the target proposal in main.** Add pure `toFolderName(name: string): string` in new
  `src/shared/modules/downloads-folder-name.ts` (+ `downloads-folder-name.test.ts`): replace
  `<>:"/\|?*` and chars < 0x20 with `_`, trim whitespace and trailing dots/spaces, append `_` to
  Windows reserved device names (move the reserved-name list out of
  `src/main/modules/downloads/bootstrap/target.ts:25-48` into this shared file and import it back
  there — one list, not two), empty result → `'Quake II'`, cap at 120 chars. In `target.ts` add
  `proposeBootstrapTarget(parentPath, folderName, { userTyped }): Promise<BootstrapTargetProposal>`:
  if `parentPath` does not exist or is an empty directory → `{ targetPath: parentPath, folderName:
  '', installHere: true }`; else `base = toFolderName(folderName)`, candidate `join(parent, base)`;
  unless `userTyped`, while the candidate exists and is non-empty or not a directory try
  `base (2)` … `base (99)` (after 99 return `base`); return `{ targetPath, folderName, installHere:
  false }`. Type `BootstrapTargetProposal` and handler id `bootstrapProposeTarget:
  'bootstrap.proposeTarget'` in `src/shared/modules/downloads.ts` (next to
  `bootstrapTargetVerdict`); strict zod input `{ parentPath: absolutePathSchema, folderName:
  z.string().max(255), userTyped: z.boolean() }` in `src/main/modules/downloads/schemas.ts`
  (mirror `bootstrapTargetVerdictInputSchema` :67); register in
  `src/main/modules/downloads/index.ts` next to the verdict handler (:162). Tests in
  `target.test.ts` (real temp dirs): "proposes a subfolder named after the installation",
  "a non-empty existing subfolder gets a free name", "an existing empty subfolder is reused",
  "a typed folder name is not renumbered", "an empty or missing parent installs right here", and
  verdict-on-final-path cases "a not-yet-existing subfolder under Program Files is warned",
  "a subfolder of a non-writable parent is not writable", "the final path of a registered
  installation is blocked" (use `computeTargetVerdict` :121 with the proposal's `targetPath`).
- **D2 — the job creates the folder and removes it again on cancel or failure.** In
  `src/main/modules/downloads/bootstrap/job.ts`: after `targetPreexisted` (:828) is taken and before
  `create()`, `await mkdir(verdict.targetPath, { recursive: true })` (failure → the existing
  failed-before-job outcome path). In `failed()` change `cleanUp({ unregister: false, removeRoot:
  false })` (:1126) to `removeRoot: !targetPreexisted`; cancel (:1070) unchanged. Rewrite the
  module comment's "Failure passes …" bullet (:172-177) to the new rule: registration and
  `lastFailure` survive, the folder this job created goes when empty, the installation shows
  `missing`, retry recreates it via the start `mkdir` and adopts by path. Tests in
  `job.failure-and-retry.test.ts` (helpers `job.test-helpers.ts`): "a failed install removes the
  empty folder it created", "a failed install keeps a folder that existed before", "a retry after
  a removed folder adopts the failed installation and recreates the folder", and in
  `job.assembly.test.ts` "the job creates the target folder before writing"; update any 077 test
  that asserted the root survives a failure.
- **D3 — the target step asks for a location and shows the final path.** Files:
  `src/renderer/src/modules/downloads/bootstrap/TargetStep.tsx`, `BootstrapWizard.tsx`,
  `ConfirmStep.tsx`, `BootstrapWizard.test.tsx`, `src/renderer/src/i18n/locales/en.json`
  (or the downloads locale file the step already uses), `CHANGELOG.md`. Wizard state (replacing
  the picked `targetPath` at :102): `parentPath`, `folderName`, `folderNameEdited`; `folderName`
  follows the wizard's effective installation name (239's name field, its default included) while
  `!folderNameEdited`. Query `bootstrap.proposeTarget` with `{ parentPath, folderName, userTyped:
  folderNameEdited }` via `useModuleQuery` (mirror the verdict query :103-109), then the verdict on
  `proposal.targetPath`; acks/writeDir reset on that path (:204-214). `pickTargetFolder` (:258)
  sets `parentPath`. TargetStep: picker labelled as the location (testid
  `bootstrap-target-path-input` stays on the picker), a text input for the folder name (testid
  `bootstrap-target-folder-name`, hidden when `installHere`), the final path as visible text
  (testid `bootstrap-target-final-path`), and in install-here mode the sentence "Installs directly
  into this empty folder" (testid `bootstrap-target-install-here`). ConfirmStep's
  `bootstrap-confirm-target-path` shows `proposal.targetPath`; Start passes it as the job's target.
  Existing warnings keep their testids. CHANGELOG `## Unreleased`: one line, e.g. "New installs go
  into their own folder — the path is shown before anything is written." Tests in
  `BootstrapWizard.test.tsx`: "the target step shows the proposed final path", "editing the
  folder name updates the final path and stops following the name", "an empty folder installs
  right here without a folder-name field", "the confirm step states the final path".
- **D4 — the subfolder flow and the systems doc.** New `scripts/flows/bootstrap-target-subfolder.mjs`,
  mirroring the offline setup of `scripts/flows/bootstrap-existing-folder.mjs` (existing-folder
  data source, no downloads); fixture helpers in `scripts/lib/fixture/bootstrap.mjs` (a parent dir
  holding a non-empty `<default name>` subfolder, plus an empty dir). Picker queue: source, empty
  dir, parent. Asserts: empty dir → `bootstrap-target-install-here` visible and final path equals
  it (AC5); parent → final path `<parent>\<name> (2)` on target and confirm step (AC1, AC2, AC4);
  edit the folder name → final path follows (AC1); the subfolder does not exist before Start and
  holds `baseq2` after the job (AC3). Rewrite `docs/systems/install-module.md` §8 step 3 (:298-301)
  to: location + proposed subfolder + shown final path, free name, install-here for an empty
  folder, judged on the final path; and the failure cleanup rule from D2.
- **D5 — existing bootstrap flows follow the new target rule.** Files: `scripts/flows/bootstrap-wizard.mjs`,
  `bootstrap-existing-folder.mjs`, `bootstrap-existing-folder-demo.mjs`, `bootstrap-r1q2.mjs`,
  `bootstrap-retail-import.mjs`, `bootstrap-incomplete-package.mjs`, `bootstrap-failure.mjs`,
  `bootstrap-failure-retry.mjs`. A flow whose picked folder is empty or missing now lands in
  install-here mode (path unchanged); a flow whose picked folder is non-empty now gets
  `<picked>\<name>` — update its expected target/confirm/tree paths to the
  `bootstrap-target-final-path` text, and move 074's non-empty-warning proof in
  `bootstrap-wizard.mjs` to typing the existing folder's name into `bootstrap-target-folder-name`.
  The Program Files probe in `bootstrap-wizard.mjs` must still show its warning on the final path
  (AC6). `bootstrap-failure.mjs`: assert the created target folder is gone after the failure and
  the installation still shows its failure badge (AC7); `bootstrap-failure-retry.mjs`: the retry
  still adopts and succeeds. Run `npm run ui:flows` for the bootstrap set.

## Model Hints

- D2 → deliverable-hard — it changes the failure cleanup that story 077's adoption/retry invariant
  rests on (registration survives a now-removed folder, retry must still adopt by canonical path,
  and a pre-existing install-here folder must never be `rmdir`'d).

Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/downloads/bootstrap/target.test.ts` › "proposes a subfolder named
  after the installation"; e2e `scripts/flows/bootstrap-target-subfolder.mjs` ›
  "bootstrap-target-subfolder"
- AC2 → renderer `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.test.tsx` › "the
  confirm step states the final path"; e2e `scripts/flows/bootstrap-target-subfolder.mjs` ›
  "bootstrap-target-subfolder"
- AC3 → unit `src/main/modules/downloads/bootstrap/job.assembly.test.ts` › "the job creates the
  target folder before writing"; e2e `scripts/flows/bootstrap-target-subfolder.mjs` ›
  "bootstrap-target-subfolder"
- AC4 → unit `src/main/modules/downloads/bootstrap/target.test.ts` › "a non-empty existing
  subfolder gets a free name"; e2e `scripts/flows/bootstrap-target-subfolder.mjs` ›
  "bootstrap-target-subfolder"
- AC5 → unit `src/main/modules/downloads/bootstrap/target.test.ts` › "an empty or missing parent
  installs right here"; e2e `scripts/flows/bootstrap-target-subfolder.mjs` ›
  "bootstrap-target-subfolder"
- AC6 → unit `src/main/modules/downloads/bootstrap/target.test.ts` › "a not-yet-existing subfolder
  under Program Files is warned", "a subfolder of a non-writable parent is not writable", "the
  final path of a registered installation is blocked"; e2e `scripts/flows/bootstrap-wizard.mjs` ›
  "bootstrap-wizard"
- AC7 → unit `src/main/modules/downloads/bootstrap/job.failure-and-retry.test.ts` › "a failed
  install removes the empty folder it created", "a failed install keeps a folder that existed
  before", "a retry after a removed folder adopts the failed installation and recreates the
  folder"; e2e `scripts/flows/bootstrap-failure.mjs` › "bootstrap-failure"

## Done

**Summary.** The target step now asks for a parent location plus an editable folder name (follows the installation name until edited), proposes a free `<name> (2)` subfolder, treats an empty or missing folder as install-here, and shows the final path on target and confirm step. The job `mkdir`s the final target at start and removes it again on failure/cancel when it created it and it is empty (registration + `lastFailure` survive, installation shows `missing`, retry adopts by path).

**Commit message:** `240: install folder created for me and shown before install — bootstrap.proposeTarget, subfolder + free name, install-here, job mkdir + empty-root cleanup on failure`

**Verification (narrow gate).** build, lint, typecheck green; `npx vitest run --changed HEAD` green (1596 passed, 1 skipped); `src/comments.test.ts` + `src/architecture.test.ts` green. `ui:flows --affected` selected effectively every flow and exceeded the 10-minute call, so it was stopped; ran by name instead: bootstrap-target-subfolder, bootstrap-wizard, bootstrap-failure (batch 1) and bootstrap-incomplete-package, -failure-retry, -existing-folder, -existing-folder-demo, -r1q2, -retail-import, -no-engine-for-platform (batch 2) — all green; after the review fix bootstrap-target-subfolder + bootstrap-wizard re-run green. Full regression gate is the sprint's.
AC -> test (all ran and passed): AC1/AC4/AC5 target.test.ts + flow bootstrap-target-subfolder; AC2 BootstrapWizard.test.tsx "the confirm step states the final path" + flow; AC3 job.assembly.test.ts "the job creates the target folder before writing" + flow; AC6 target.test.ts (Program Files, registered-installation) + flow bootstrap-wizard; AC7 job.failure-and-retry.test.ts (3 tests) + flow bootstrap-failure. Open point: "a subfolder of a non-writable parent is not writable" is `skipIf` on Windows/root (chmod), same pattern as the existing extractor tests — not run on this host.

**Decisions.**
- Default folder name for an existing-folder source is the engine label (e.g. `Q2PRO`), following the installation name; flow fixtures use that name.
- The job also removes a folder it created on pre-job refusals (busy, duplicate, refused adoption) — a refused start must not leave an empty folder; non-recursive `rmdir` only.
- Review finding fixed: the wizard held the previous proposal while the next loads, so Next/Start could use a stale path; the held proposal now carries its key and gates Next/Start, and an error drops it (two tests added; one existing 239 name test now waits for the proposal to settle).
- `bootstrapProposeTargetInputSchema` lives in `src/shared/modules/downloads.ts` (no `schemas.ts` in main); new flow not registered in `scripts/flows/areas.json`.
- Format-only churn from agents in unrelated files was reverted.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 8
