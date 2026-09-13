---
id: 077
title: A failed install stays in my library and shows its last error
status: done
created: 2026-09-08
---

## Requirement

On 2026-09-08 a real bootstrap run failed ([[075]], [[076]]). Afterwards the library was
**empty**: name, target folder and engine the user had picked in the wizard were gone, and the
only way forward was to walk the whole wizard again from the empty state
("NO QUAKE II INSTALLATIONS YET"). That is the wrong outcome — the user made decisions, the
launcher threw them away because a download failed.

The mechanism is deliberate today. The bootstrap job registers the installation early
([job.ts:440](../../src/main/modules/downloads/bootstrap/job.ts#L440)) and its `cleanUp()`
un-registers it again on failure and on cancel
([job.ts:552](../../src/main/modules/downloads/bootstrap/job.ts#L552)), with the reason stated in
the code: "no observer can ever see a `failed` job next to a still-registered half-built
installation" ([job.ts:577](../../src/main/modules/downloads/bootstrap/job.ts#L577)). The
invariant it protects is real — a half-built folder must never look playable — but the price is
too high: the launcher's own memory of what the user asked for is the first thing it deletes.

So: an installation the user created survives a failed download. It stays in the library, it says
what it is (not playable) and **why** (the download failed, with the failure's own error), and the
retry starts from it instead of from an empty library. A failure becomes a state of an
installation, not the deletion of one.

This also closes a second gap the same run exposed: the failure is currently only findable in the
Downloads tab. The library — the screen the user actually lands on — showed nothing at all.

## Acceptance Criteria

- [x] **AC1** — A bootstrap job that fails leaves its installation registered. After an app
      restart it is still in the library with the name, root path and engine the user chose in the
      wizard.
- [x] **AC2** — A cancelled job keeps [[074]]'s behaviour of the user's explicit "never mind" —
      whichever way this resolves (see Open Questions), cancel and failure are distinguishable and
      the choice is stated in the story, not left to the reader of the diff.
- [x] **AC3** — The surviving installation carries its last failure: the downloads error key, when
      it happened and which job it was — persisted with the installation, machine-readable, no
      prose across IPC.
- [x] **AC4** — The last failure is cleared as soon as that installation reaches a playable state
      (a later download succeeds, or the user points it at real game files) — a stale red mark on a
      working installation is worse than none.
- [x] **AC5** — The library card and the rail tile show the failed state distinguishably from a
      merely `invalid` folder, with a non-colour indicator as well as the tone
      (`/design-tokens`), and the card names the failure using its existing i18n key.
- [x] **AC6** — Launching a failed installation stays impossible: `isPlayable` still gates the
      Play action, and nothing in this story makes a half-built folder look ready.
- [x] **AC7** — Retrying works from the surviving installation and does **not** trip
      `installations.error.duplicate` ([installations.ts:94](../../src/main/services/installations.ts#L94)) —
      the wizard pointed at the same folder must adopt the existing failed installation instead of
      failing to create a second one.
- [x] **AC8** — A `state.json` written before this story loads unchanged, and an installation
      without the new field renders exactly as today.

## Open Questions

- ~~**Q1 — Do the half-built *files* stay too?**~~ answered → Decisions (Sprint)
- ~~**Q2 — Cancel (AC2).**~~ answered → Decisions (Sprint)

None open. Everything else the refine needed (where the record lives, who clears it, how the retry
adopts, the shell surfaces, the offline proof) was decided against the ACs, [[074]]/[[075]]/[[076]],
`docs/concepts/install-module.md` and the guardrails — see "Decided during refine".

## Decisions (Sprint)

- **(User)** Q1 — half-built files on failure: delete the files, keep the registration. The
  installation lands in an honest `missing`/`invalid` state pointing at an empty/cleaned folder;
  retry re-downloads from scratch rather than risking a half-built folder that looks closer to
  playable than it is.
- **(User)** Q2 — cancel (AC2): cancel keeps today's full removal (installation and files both
  deleted) — it is the one case where the user explicitly said "never mind"; only a real failure
  survives in the library.

### Decided during refine

- **The record is a first-class field on `Installation`, not `moduleData`.** New optional
  `lastFailure?: { errorKey: string; at: number; jobId: string }` in
  `src/shared/types/installation.ts` next to `icon`. Reason: `moduleData` is an untyped
  `Record<string, unknown>` ([installation.ts:116](../../src/shared/types/installation.ts#L116)) that
  no zod schema can validate and no shell surface can render without guessing, and AC3 asks for a
  machine-readable, persisted record; the field itself stays module-agnostic (a plain i18n key,
  epoch ms, a job id), so nothing in the core type learns about downloads.
- **Written through a dedicated `setLastFailure(id, failure | null)` on `InstallationsService`,**
  mirroring `setIcon` ([installations.ts:270](../../src/main/services/installations.ts#L270)) and its
  `commit()` path. Reason: `UpdateInstallationInput` is the user-editable patch shape and revalidates
  on path-affecting fields; a job-written status marker does not belong in it.
- **Cleared centrally in the service's inspection-applying helper** (`applyInspection`, the one
  place that writes `status`/`checks` from `inspectInstallation`, used by `validate()` and by add/
  create), whenever the resulting verdict is playable. Reason: that single point covers both AC4
  triggers — a later successful download revalidates, and so does an installation the user points at
  real game files — instead of two call sites that can drift apart.
- **"Playable" in main is `status !== 'invalid' && status !== 'missing'`,** the same expression
  `job.ts` already uses for `markPlayable` ([job.ts:541](../../src/main/modules/downloads/bootstrap/job.ts#L541)).
  Reason: `isPlayable` lives in the renderer's `lib/status.ts`; main must not import from the shell,
  and inventing a third predicate for one comparison is worse than restating the existing one.
- **On failure the target root directory stays,** even when the job itself created it — the failure
  cleanup deletes the assembled files and the extract cache but passes `removeRoot: false`. Reason:
  the User decision wants an honest state "pointing at an empty/cleaned folder"; keeping the folder
  makes that `invalid` rather than `missing`, and the retry's target step then sees an ordinary empty
  directory. Cancel keeps today's `!targetPreexisted` behaviour untouched.
- **The failure path revalidates before the job flips to `failed`:** delete files → `setLastFailure`
  → `installations.validate(id)` → `jobs.finish(..., 'failed')`. Reason: preserves the invariant
  [job.ts:577](../../src/main/modules/downloads/bootstrap/job.ts#L577) states ("no observer sees a
  `failed` job next to a half-built installation") in the only form still available once the
  registration survives — the files are gone and the status is re-derived before anything can look.
- **Retry adopts only an installation that carries a `lastFailure`** (AC7): the job looks the target
  path up before/after `create()` and reuses that installation; every other duplicate keeps today's
  `installations.error.duplicate` ([installations.ts:163](../../src/main/services/installations.ts#L163)).
  Reason: adopting any same-path installation would let the wizard silently take over a working one.
- **Adoption updates the name from the wizard, not the engine.** Reason: `update()` has no
  `engineKind` path, and the wizard offers Q2PRO only ([[074]] AC1) — a retry that changes engine on
  the same folder is not reachable this sprint and is not invented here.
- **Editing the shell surfaces is deliberate and bounded** (`LibraryView.tsx`,
  `InstallationRail.tsx`, `InstallationTile.tsx`): AC5 names the library card and the rail tile, and
  [[074]] D7's Demo marker set the precedent for a module-agnostic installation marker rendered by
  the shell. Reason: the field is on `Installation`, so no shell file imports anything from the
  downloads module.
- **AC5's shape mirrors the Demo marker exactly:** a text-bearing `Badge` (new
  `components/ui/FailureBadge.tsx`, mirroring `DemoBadge.tsx`) plus the failure sentence
  `t(lastFailure.errorKey)` on the card, and a CSS-only corner microtag on the tile mirroring
  `.tile-demo-tag` ([surfaces.css:236](../../src/renderer/src/styles/surfaces.css#L236)). Reason: text
  and a glyph are the non-colour indicator `/design-tokens` asks for, and a merely `invalid`
  installation renders no badge at all, which is the distinction AC5 wants.
- **No IPC contract change.** `Installation` already crosses IPC whole; the new field rides along on
  `installations:list`. Reason: nothing here needs a channel, so `src/shared/ipc.ts` stays shut.
- **AC1's "after an app restart" is proven by booting the app from a fixture `state.json` that
  carries a failed installation.** Reason: that state document is literally what a restart reads, and
  the flow runner gives a flow exactly one app (`scripts/flow.mjs` → one `withApp`), so an in-flow
  relaunch would mean harness surgery this story does not otherwise need.
- **The offline failing run comes from a fixture-server option** that 404s one package's primary
  *and* mirror on its first attempt only, then serves it normally. Reason: `Q2L_UI_CONTENT_REPO_BASE`
  is fixed at launch, so failing-then-succeeding has to be a property of the server if one flow is to
  cover the failure (AC1/AC5) and the adopting retry (AC4/AC7) in one app session.
- **The Downloads tab's failure log is not touched.** The global, dismissible log ([[073]]/[[075]])
  and the installation's own `lastFailure` coexist and are written from the same failure exit.
  Reason: the log answers "what went wrong recently", the field answers "what is wrong with *this*
  installation"; merging them was concept open question 20 and is not what any AC asks for.

### Decided during review

Findings from the `story-review-hard` pass over the finished diff, each resolved before the story
closed rather than left for a reader of `job.ts`'s comments to reconstruct (AC2 explicitly asks for
that).

- **`InstallationLastFailure` gained an optional `params` field** (F1: a templated key like
  `downloads.error.packageIncomplete` reads `{{packageId}}`; without interpolation values the
  library card rendered the raw placeholder). `job.ts`'s `failed()` attaches the *same* `params`
  object it already hands `Job.error`, so the library card and the Downloads tab render identical
  wording for one failure. Additive and optional, so AC8 (a record predating this field parses
  unchanged) is untouched.
- **Cancelling an *adopted* retry (D3) keeps the installation registered and restores the
  `lastFailure` that adoption cleared when the retry started** (F2). Decisions (Sprint) Q2 ("cancel
  keeps today's full removal") was decided before D3's adoption existed and covers the ordinary
  case (a cancel unregisters an installation *this run* created) unchanged. Adoption is different:
  the installation predates this run, so deleting it on cancel would recreate the empty-library
  problem this story exists to fix, and merely leaving it registered *without* restoring
  `lastFailure` would still dead-end every later retry on that folder at
  `installations.error.duplicate` — the adoption predicate (D3) only matches an installation that
  carries a `lastFailure`. So a cancelled adopted retry now returns the installation to exactly its
  pre-retry state: same registration, same restored failure record, same badge. See
  `cancelledOutcome()` in `job.ts` for the mechanics (`wasAdopted`/`previousFailure`).
- **The engine-preservation guard added during D2 (`applyInspection`, `installations.ts`) is scoped
  to installations that carry a `lastFailure`** (F4). The unscoped version preserved a known engine
  kind whenever re-inspection came back `unknown` — correct for AC1 (a failed installation's
  cleanup-emptied folder must not lose the wizard's engine choice) but *also* live for any ordinary
  installation whose folder happens to inspect as `unknown` for any other reason, which is exactly
  what AC8 ("an installation without the new field renders exactly as today") rules out. Scoping the
  guard to `installation.lastFailure !== undefined` makes it fire only for the case this story
  introduces; an ordinary installation keeps the pre-077 unconditional overwrite. `job.ts`'s
  `failed()` records the failure *before* calling `validate()` (not after) specifically so this
  guard can see it — see the comment at that call site.
- **Considered and rejected: revalidating before recording the failure**, to close the (narrower,
  one-commit) window where a renderer subscribed between the two writes could see the failure badge
  next to a not-yet-revalidated status. Rejected because it directly conflicts with the F4 fix above
  — for a *first* failure, `validate()` needs `lastFailure` already written to preserve the known
  engine kind. The original order (record, then validate) stays; the residual window is bounded by
  the job itself never reporting `failed` until after both writes.

## Plan

Bottom-up: the persisted shape and its lifecycle first, then the job's two exits, then the surfaces,
then the offline proof.

1. **Shape + lifecycle** — `src/shared/types/installation.ts` gains `InstallationLastFailure` and
   `Installation.lastFailure?`; `src/main/lib/schemas.ts` gains the forgiving field mirroring `icon`
   ([schemas.ts:93](../../src/main/lib/schemas.ts#L93)); `src/main/services/installations.ts` gains
   `setLastFailure()` (mirroring `setIcon`, [installations.ts:270](../../src/main/services/installations.ts#L270)),
   `findByRootPath()` and the clear-on-playable rule inside `applyInspection`.
2. **The job's failure exit** — `bootstrap/job.ts`: `cleanUp()` gets a mode
   (`{ unregister: boolean; removeRoot: boolean }`); `cancelledOutcome()` keeps today's values,
   `failed()` deletes files, records the failure, revalidates and finishes.
3. **Retry adoption** — same file, at the `create()` call
   ([job.ts:440](../../src/main/modules/downloads/bootstrap/job.ts#L440)): a `lastFailure`-carrying
   installation at the same canonical path is adopted (name updated, failure cleared) instead of
   erroring `installations.error.duplicate`.
4. **Surfaces** — `FailureBadge.tsx`, the card block in `LibraryView.tsx`, the `.tile-failed-tag`
   microtag in `surfaces.css` + `InstallationTile.tsx`, the rail's hover card, i18n keys.
5. **Offline proof** — a fixture installation carrying a `lastFailure`, a fixture server that fails
   one package's first attempt, and a flow that runs the wizard twice against the same target.

Order: D1 → D2 → D3 → D4 → D5. D4 may start once D1 exists.

## Deliverables

- [x] **D1 — The persisted failure record and when it disappears.**
  Edit `src/shared/types/installation.ts` (`InstallationLastFailure`, `Installation.lastFailure?`,
  next to `icon` at [installation.ts:77](../../src/shared/types/installation.ts#L77)); edit
  `src/main/lib/schemas.ts` (forgiving `.optional().catch(undefined)` field mirroring the `icon`
  block at [schemas.ts:90](../../src/main/lib/schemas.ts#L90)); edit
  `src/main/services/installations.ts` (`setLastFailure(id, failure | null)` mirroring `setIcon`;
  `findByRootPath(rootPath)` using the same `pathKey(canonicalizePath(...))` comparison the two
  inline duplicate checks already use; clear-on-playable inside the inspection-applying helper).
  *Acceptance:* the record round-trips through `state.json`; an installation written before this
  story parses unchanged and reports `lastFailure: undefined`; a garbage `lastFailure` drops only
  that field, not the row; `setLastFailure(id, null)` removes it; a `validate()` whose verdict is
  `ok`/`warning`/`unknown` clears it while an `invalid`/`missing` verdict keeps it;
  `findByRootPath` matches the same way `create()`'s duplicate check does (canonicalised,
  case-insensitive where `pathKey` is) and returns `undefined` for an unrelated path.
  Tests: `src/main/services/installations.test.ts`, `src/main/lib/schemas.test.ts`.

- [x] **D2 — A failed bootstrap keeps its installation; a cancelled one still does not.**
  Edit `src/main/modules/downloads/bootstrap/job.ts` only: split `cleanUp()`
  ([job.ts:550](../../src/main/modules/downloads/bootstrap/job.ts#L550)) into a parameterised
  cleanup; `cancelledOutcome()` ([job.ts:565](../../src/main/modules/downloads/bootstrap/job.ts#L565))
  keeps `{ unregister: true, removeRoot: !targetPreexisted }`; `failed()`
  ([job.ts:571](../../src/main/modules/downloads/bootstrap/job.ts#L571)) uses
  `{ unregister: false, removeRoot: false }`, then `installations.setLastFailure(id, { errorKey: key,
  at: Date.now(), jobId })`, then `installations.validate(id)`, then `jobs.finish(..., 'failed')`.
  *Acceptance:* every failure exit (`packageUnavailable`/`allMirrorsFailed`, verification,
  extraction, disk write, `installationNotPlayable`) leaves the installation registered with the
  wizard's name, root path and engine, an `invalid`/`missing` status that came from
  `inspectInstallation` (never hand-set), and a `lastFailure` carrying that exit's key, a timestamp
  and the job id; the assembled files and the extract cache are gone and the target root directory
  still exists; a cancel removes installation *and* files exactly as today; the success path is
  untouched; the Downloads tab failure log still receives its entry.
  Test: `src/main/modules/downloads/bootstrap/job.test.ts` (extend the existing fake-deps setup).

- [x] **D3 — Retrying adopts the failed installation.**
  Edit `src/main/modules/downloads/bootstrap/job.ts` around the registration at
  [job.ts:440](../../src/main/modules/downloads/bootstrap/job.ts#L440): before `create()`, look the
  canonical target path up via `findByRootPath`; if the hit carries a `lastFailure`, adopt it
  (update the name to the wizard's, clear the failure, keep the existing id/engine/icon/sortOrder)
  and skip `create()`; otherwise proceed exactly as today.
  *Acceptance:* a second wizard run pointed at a failed installation's folder starts a job on the
  existing installation and never returns `installations.error.duplicate`; the adopted installation
  keeps its id (so the rail's position and any assignments survive) and loses its `lastFailure` when
  the run starts; a duplicate *without* `lastFailure` still fails with
  `installations.error.duplicate`; a run on a fresh path still creates as before; the adopted run's
  own failure records a new `lastFailure` again.
  Test: `src/main/modules/downloads/bootstrap/job.test.ts`.

- [x] **D4 — The library card and the rail tile say a download failed.**
  New `src/renderer/src/components/ui/FailureBadge.tsx` (mirror
  `src/renderer/src/components/ui/DemoBadge.tsx`); edit `src/renderer/src/views/LibraryView.tsx`
  (badge + a line reading `t(installation.lastFailure.errorKey)` above the existing checks list at
  [LibraryView.tsx:230](../../src/renderer/src/views/LibraryView.tsx#L230)); edit
  `src/renderer/src/components/installations/InstallationTile.tsx` and
  `src/renderer/src/styles/surfaces.css` (a `.tile-failed-tag` corner microtag mirroring
  `.tile-demo-tag` at [surfaces.css:236](../../src/renderer/src/styles/surfaces.css#L236)); edit
  `src/renderer/src/components/shell/InstallationRail.tsx` (badge in the hover card, next to
  `DemoBadge`); edit `src/renderer/src/i18n/locales/en.json`.
  *Acceptance:* an installation with `lastFailure` shows the badge (text, not colour alone), the
  translated failure sentence and the microtag on its tile; an `invalid` installation *without*
  `lastFailure` renders exactly as today (no badge, no microtag); the Play control stays disabled
  for the failed one via the unchanged `isPlayable(status)` gate; no raw i18n key and no prose from
  main is rendered; no shell file imports from `modules/downloads`.
  Tests: `src/renderer/src/components/ui/FailureBadge.test.tsx` (new),
  `src/renderer/src/components/installations/InstallationTile.test.tsx` (extend).

- [x] **D5 — Offline proof: a real failing run, and the retry that adopts it.**
  Edit `scripts/lib/fixture.mjs` (a fourth installation in `populatedInstallations()`
  ([fixture.mjs:192](../../scripts/lib/fixture.mjs#L192)) carrying a `lastFailure`, additive per that
  function's own documented rule — `sortOrder: 3`, no profile assignment; and a
  `startBootstrapFixtureServer({ failFirstAttemptFor })` option that 404s one package's primary and
  mirror on its first attempt only); new `scripts/flows/bootstrap-failure-retry.mjs` (mirror
  `scripts/flows/bootstrap-wizard.mjs`, including its `setup()`/`teardown()` shape); edit
  `docs/UI-VERIFICATION.md`.
  *Acceptance:* `npm run ui:flow -- bootstrap-failure-retry` passes offline and proves, through the
  real surface: the wizard's first run fails; the Library still shows that installation with its
  chosen name, the failure badge, the translated reason and a disabled Play button; the target
  folder on disk is empty; a second wizard run on the same folder starts without a duplicate error,
  succeeds, and the badge and microtag are gone afterwards. `npm run ui:verify -- --screens=library`
  stays axe-clean with the seeded failed installation visible and the three existing installations
  rendering unchanged.

## Model Hints

- **D2 → `deliverable-hard`** — `cleanUp()` is the job's only destructive path (`rm -rf` of assembled
  files plus an `rmdir` of a directory the job may have created), it is reached from five failure
  exits and from cancel, and this story makes those two callers behave differently for the first
  time. A mode threaded one branch off either deletes a user-picked folder that must survive, or
  leaves a half-built folder registered as playable — both silent.
- **D3 → `deliverable-hard`** — adoption bypasses the duplicate guard that exists to stop the wizard
  from writing into an installation the user already owns; the predicate that decides "this is my own
  leftover" is the whole safety of the change, and a too-wide match is invisible in a green test run.
- D1, D4, D5 → default tier.
- **`Review: → story-review-hard`** — the story changes a destructive cleanup path, relaxes a
  duplicate guard and adds a persisted field with a migration promise (AC8); each can pass its own
  tests while being wrong about the case the story exists for.

## Acceptance Tests

- **AC1** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "a failed run leaves the
  installation registered with the wizard's name, root path and engine" (D2); unit
  `src/main/lib/schemas.test.ts` › "an installation with a lastFailure round-trips through
  state.json" (D1); e2e `scripts/flows/bootstrap-failure-retry.mjs` › "the Library still shows the
  installation after the run failed" (D5); the restart half → e2e
  `npm run ui:verify -- --screens=library` with the fixture-seeded failed installation, which is the
  app booting from a `state.json` that carries one (D5).
- **AC2** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "a cancelled run still removes
  the installation and its files" and › "a failed run removes the files but not the registration"
  (D2) — the two together are the stated distinction; plus, for the adopted-retry case the review
  added (Decided during review), › "finding fix: cancelling an adopted retry keeps the installation
  registered" and › "finding fix: cancelling an ordinary (non-adopted) run is unchanged" (D3).
- **AC3** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "the surviving installation
  carries the error key, the timestamp and the job id" and › "a templated error key records the
  params its sentence interpolates" (D2); unit `src/main/services/installations.test.ts` ›
  "setLastFailure persists a machine-readable record" (D1); unit `src/main/lib/schemas.test.ts` ›
  "a templated lastFailure carries its params through unchanged" and › "a garbage params drops only
  params, not the rest of lastFailure" (D1).
- **AC4** → unit `src/main/services/installations.test.ts` › "a playable verdict clears the last
  failure, an invalid one keeps it" (D1); unit `bootstrap/job.test.ts` › "an adopted retry clears the
  previous failure when it starts" (D3); e2e `scripts/flows/bootstrap-failure-retry.mjs` › "the badge
  is gone once the retry succeeds" (D5).
- **AC5** → unit `src/renderer/src/components/ui/FailureBadge.test.tsx` › "a failed installation
  shows a text badge and its reason, an invalid one without a failure shows neither" (D4); unit
  `src/renderer/src/components/installations/InstallationTile.test.tsx` › "the failed microtag
  renders only with a lastFailure" (D4); e2e `scripts/flows/bootstrap-failure-retry.mjs` › "the card
  and the tile mark the failed installation" plus `npm run ui:verify -- --screens=library` (axe,
  D5).
- **AC6** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "the surviving installation's
  status comes from inspectInstallation and is not playable" (D2); e2e
  `scripts/flows/bootstrap-failure-retry.mjs` › "Play stays disabled on the failed installation"
  (D5).
- **AC7** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "a retry on a failed
  installation's folder adopts it instead of failing with installations.error.duplicate" and › "a
  duplicate without a lastFailure is still refused" (D3); e2e
  `scripts/flows/bootstrap-failure-retry.mjs` › "the second run starts on the same folder and
  succeeds" (D5).
- **AC8** → unit `src/main/lib/schemas.test.ts` › "an installation written before this story parses
  unchanged" and › "a garbage lastFailure drops the field, not the row" (D1); unit
  `src/renderer/src/components/installations/InstallationTile.test.tsx` › "an installation without
  the field renders exactly as before" (D4); e2e `npm run ui:verify -- --screens=library`, where the
  three pre-existing fixture installations render unchanged next to the seeded failed one (D5); plus,
  for the engine-preservation guard the review narrowed (Decided during review), unit
  `src/main/services/installations.test.ts` › "AC8: an ordinary installation without a lastFailure
  still resets to unknown - unchanged from before this story".

No manual residue: every criterion has a named automated test.

## Done

A bootstrap failure no longer deletes the installation it registered: `InstallationsService`
gained a persisted `lastFailure` record (`errorKey`/`at`/`jobId`, optional `params` for a
templated sentence), cleared automatically the moment a later verdict is playable and preserved
across an app restart. `bootstrap/job.ts`'s failure exit now deletes only the assembled files (not
the registration or the target root), records the failure, and revalidates before flipping the job
to `failed`, so the surviving installation is honestly `invalid`/`missing` and never looks
playable. A retry pointed at the same folder adopts that installation (name updated, `lastFailure`
cleared) instead of tripping `installations.error.duplicate`, and cancelling that adopted retry
restores the pre-retry registration and failure record rather than deleting it or leaving a
duplicate-guard dead end. The Library card and rail tile gained a `FailureBadge`/`.tile-failed-tag`
pair (text + tone, mirroring the Demo marker) naming the failure via its own i18n key, and a real
offline flow (`bootstrap-failure-retry.mjs`) proves a first run failing, the library surviving it,
and a second run on the same folder adopting and succeeding.

**Commit message:** `077: a failed install stays in my library and shows its last error`

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` — clean (both TS projects).
- `npm test` — 154 files / 3142 tests passed.
- `npm run ui:verify` — 34/34 screens, 0 axe violations.
- `npm run ui:verify -- --screens=library` — 2/2 shots, axe-clean.
- `npm run ui:flow -- bootstrap-failure-retry` — OK (AC1/AC4/AC5/AC6/AC7 through the real UI,
  offline).

**Review (`story-review-hard`):** the build was resumed after an interruption mid review-fix. A
fresh full-diff `story-review-hard` pass (after confirming the in-flight fixes) found the story's
three prior findings (F1 raw `{{packageId}}` placeholder, F2 cancel-of-adopted-retry dead-end, F4
engine-preservation guard narrowness) already correctly fixed in the code, but surfaced two real
gaps in what shipped alongside those fixes and two test-quality nits — see "Decided during review"
above for the reasoning, resolved as follows:
- **N1 (AC8 regression)** — the D2 engine-preservation guard (`applyInspection`) was unconditional,
  so it also changed the engine badge for *ordinary* installations whose folder happens to inspect
  as `unknown` (two of the three standing fixture installations, concretely). Fixed: scoped to
  `installation.lastFailure !== undefined`; a new negative test
  (`installations.test.ts` › "AC8: an ordinary installation…") pins the pre-077 behaviour for an
  installation that never failed.
- **N2 (AC2 documentation)** — the adopted-retry cancel semantics (registration + `lastFailure`
  restored, not deleted) existed only in `job.ts` code comments, while AC2 requires the choice
  stated in the story. Fixed: added to "Decided during review" above.
- **A stale test from the interrupted fix cycle** — `job.test.ts` › "finding fix: cancelling an
  adopted retry keeps the installation registered" still asserted the *pre-F2-fix* behaviour
  (`lastFailure` staying cleared after cancel), left over from before the F2 fix landed. Corrected
  to assert the restored record, independently re-verified against the F2 fix's own reasoning by
  the fresh review pass (dead-end avoidance) rather than trusted at face value.
- **N4/nit (test coverage)** — added a forgiving-parse pair for `lastFailure.params` in
  `schemas.test.ts`, and an `expect(firstFailure).toBeDefined()` guard against a vacuous pass in
  the cancel-of-adopted-retry test.
- **N3 (considered, reverted)** — the review also suggested revalidating before recording the
  failure, to close a narrower one-commit window where a renderer could observe the failure badge
  next to a not-yet-revalidated status. Attempted and reverted: it broke the AC1 test outright,
  because the engine-preservation guard (N1's fix) needs `lastFailure` already written by the time
  `validate()` runs on a *first* failure. The original order stays; recorded under "Decided during
  review" as a rejected alternative rather than silently dropped.
No other findings from either review pass; no weakened or deleted tests, no scope creep beyond
the fixes above, no CLAUDE.md guardrail violations (no IPC channel touched, no raw renderer path
trusted, no image asset added, i18n keys/params only across the boundary).

**AC → test mapping, as verified:** all eight criteria PASS — see the "Acceptance Tests" section
above (updated with the review's added tests) for the exact test names; every criterion has a
passing automated test, no manual residue.

**Open points:** none blocking.
