---
id: 002
title: Profile-installation assignment and default profile
status: in-progress
created: 2026-08-14
---

## Requirement

As a user, I want to assign a config profile to one or more of my installations, and mark one
assigned profile per installation as the default, so the launcher knows which profile belongs
on which installation and which one applies at launch.

Per [docs/concepts/config-module.md](../concepts/config-module.md), assignment is many-to-many:
a profile can be assigned to several installations, and an installation can have several
assigned profiles. Builds on story 001 (profile CRUD exists). Does not write anything to disk
yet — that is story 004.

## Acceptance Criteria

- [ ] From a profile, I can assign it to, and unassign it from, any of my registered
      installations.
- [ ] An installation can have more than one assigned profile at the same time.
- [ ] Exactly one assigned profile per installation can be marked default; marking a new
      default un-marks the previous one for that installation.
- [ ] Assignment and default state persist across app restarts.
- [ ] For a given installation, I can see which profiles are assigned and which one is
      currently the default.
- [ ] Deleting a profile that is assigned to installations removes those assignments cleanly
      (no orphaned references).

## Open Questions

None — all detail questions were decided during refine, see [Decisions (Sprint)](#decisions-sprint).

## Decisions (Sprint)

1. **Assignments live on the profile** (`ConfigProfile.assignments: { installationId, isDefault }[]`
   inside the module's `configProfiles` state), not as new `Installation` fields — keeps the
   feature inside the module as CLAUDE.md demands ("never edit the shell") and needs no
   `Installation` schema bump/migration.
2. **Orphans after installation removal:** the config module reconciles assignments against
   `app.installations.list()` once at module setup and filters unknown installation ids on every
   read — resolves open point 4 of the concept without injecting a config callback into
   `InstallationsService.remove()`.
3. **Deleting a profile needs no sweep:** its assignments are part of the profile record, so
   deletion (story 001) removes them by construction; a test pins that no installation-side view
   can still resolve the deleted id.
4. **First assignment becomes the default automatically, and unassigning the default promotes the
   next remaining assignment** — guarantees the invariant "assignments exist ⇒ exactly one
   default" without a dead UI state the user has to repair by hand.
5. **No new IPC channels:** three module handlers `assign` / `unassign` / `setDefault` over the
   shell's `module:invoke` envelope, per ARCHITECTURE.md ("a module can never widen the
   renderer's IPC surface").
6. **Mutations return the full profile list** (`Outcome<ConfigProfile[]>`) — mirrors the
   installations convention of pushing the whole list on change and keeps the renderer in sync in
   one round trip. If story 001 fixed a different return convention for its handlers, follow 001.
7. **No extra "assignments by installation" query:** the installation-side overview derives from
   the profile list plus the installations already in `useLauncher` — keeps the contract minimal
   (story 003 gets the engine set of a profile the same way).
8. **Payload validation in a module-owned `src/main/modules/config/schemas.ts`** mirroring the zod
   patterns of `src/main/lib/schemas.ts` — only opaque ids cross here, no paths, so the shell's
   schema file stays untouched.
9. **The invariant logic is pure and unit-tested** (`assignments.ts` + colocated `.test.ts`),
   mirroring `launch-plan.ts` / `launch-plan.test.ts` — rules like "exactly one default" are
   cheaper to pin in tests than to click through.
10. **UI placement:** assignment editing sits in the profile detail of the config view from story
    001; the installation-side view is a read-only "By installation" panel in the same view — no
    edits to the installation rail or any other shell surface.
11. **i18n:** new keys under a top-level `config.assignment.*` block in
    `src/renderer/src/i18n/locales/en.json`, error keys as `config.error.*` returned by `fail()` —
    matches the `library` precedent.
12. **Storage/naming follows story 001** (refined in parallel): profile type and store file names
    are taken from 001's result; the names used below are the expected ones, not a second source
    of truth.

## Plan

Build order (each step small enough to review on its own):

1. **Contract** — extend `src/shared/modules/config.ts` (created in 001): `ProfileAssignment`,
   `assignments` on `ConfigProfile`, and `CONFIG_HANDLERS.assign / unassign / setDefault` plus
   their payload types. No `src/shared/ipc.ts` change (Decision 5).
2. **Pure logic** — `src/main/modules/config/assignments.ts`: `assign`, `unassign`, `setDefault`,
   `reconcileAssignments(profiles, knownInstallationIds)`. Pure array-in/array-out over the
   profile list, so all invariants (many-to-many, one default per installation, auto-default,
   promotion on unassign, orphan drop) are unit-testable without Electron.
3. **Main wiring** — extend the `configModule` from 001 in `src/main/modules/config/index.ts`:
   register the three handlers, validate payloads via a module-owned
   `src/main/modules/config/schemas.ts`, persist through 001's profile store, run the reconcile
   sweep once in `setup()`.
4. **Renderer, profile side** — typed client functions in `src/renderer/src/modules/config/client.ts`,
   plus a `ProfileAssignmentsPanel` in the profile detail of `ConfigView`: one row per registered
   installation with an assign toggle and a "default" marker on assigned rows.
5. **Renderer, installation side** — a read-only "By installation" panel in the same view:
   each installation with its assigned profiles and a badge on the default one.
6. **Strings** — `config.assignment.*` and `config.error.*` in `en.json`.

Affected files: `src/shared/modules/config.ts`, `src/main/modules/config/{index,assignments,
assignments.test,schemas}.ts`, `src/renderer/src/modules/config/client.ts`,
`src/renderer/src/views/ConfigView.tsx`, `src/renderer/src/components/config/*.tsx`,
`src/renderer/src/i18n/locales/en.json`.

Patterns to mirror: `src/shared/modules/library.ts` (contract), `src/main/modules/library/index.ts`
(module shape), `src/main/services/launch-plan.ts` + `.test.ts` (pure logic + colocated test),
`src/main/lib/schemas.ts` (zod payload validation → `fail('ipc.error.invalidPayload')`),
`src/renderer/src/modules/library/client.ts` (typed client),
`src/renderer/src/components/installations/` and `src/renderer/src/views/LibraryView.tsx`
(component/layout conventions, `Panel`/`SectionLabel`/`Badge`/`Checkbox`/`Button` primitives).

## Deliverables

- [ ] **D1 — Assignment contract.** `src/shared/modules/config.ts`: `ProfileAssignment
      { installationId: string; isDefault: boolean }`, `assignments: ProfileAssignment[]` on
      `ConfigProfile`, three new `CONFIG_HANDLERS` entries + payload types.
      *Mirror:* `src/shared/modules/library.ts`.
      *Acceptance:* `npm run build` green; no entry added to `src/shared/ipc.ts`.
- [ ] **D2 — Pure assignment rules + tests.** `src/main/modules/config/assignments.ts` and
      `assignments.test.ts`. *Mirror:* `src/main/services/launch-plan.ts` / `launch-plan.test.ts`.
      *Acceptance:* `npm test` green with cases for: a profile assigned to several installations;
      an installation carrying several profiles; the first assignment becoming default; setting a
      new default clearing the previous one **for that installation only**; unassigning the default
      promoting the next remaining assignment; unassigning the last one leaving no default;
      `reconcileAssignments` dropping assignments whose installation id is unknown.
- [ ] **D3 — Main wiring + persistence.** `src/main/modules/config/index.ts` (extend 001's module),
      `src/main/modules/config/schemas.ts`. *Mirror:* `src/main/modules/library/index.ts`,
      `src/main/lib/schemas.ts`. *Acceptance:* the three handlers mutate through the pure functions
      of D2 and persist via 001's store; a malformed payload returns
      `fail('ipc.error.invalidPayload')`, an unknown profile/installation id a `config.error.*`
      failure; the reconcile sweep runs at `setup()`; assignment + default survive an app restart.
- [ ] **D4 — Profile-side assignment UI.** `src/renderer/src/modules/config/client.ts`,
      `src/renderer/src/components/config/ProfileAssignmentsPanel.tsx`,
      `src/renderer/src/views/ConfigView.tsx`, `src/renderer/src/i18n/locales/en.json`.
      *Mirror:* `src/renderer/src/modules/library/client.ts`, `LibraryView.tsx`.
      *Acceptance:* from an open profile I can assign it to and unassign it from every registered
      installation, and mark it default for any installation it is assigned to — all through the
      real UI, built only from existing design-system primitives.
- [ ] **D5 — Installation-side overview.** `src/renderer/src/components/config/InstallationProfilesPanel.tsx`,
      `ConfigView.tsx`, `en.json`. *Acceptance:* a panel lists every registered installation with
      its assigned profiles and a badge on the default one, empty state when none; it updates
      immediately after a D4 action and shows nothing for a deleted profile.

**Coverage gate (AC → D):** AC1 → D1+D3+D4 · AC2 → D2+D4 · AC3 → D2+D3+D4 · AC4 → D3 ·
AC5 → D5 · AC6 → D2+D3 (assignments are part of the profile record, plus the reconcile sweep).

## Model Hints

- D2 → `deliverable-hard` — the cross-profile invariant ("exactly one default per installation"
  spans *all* profiles, plus auto-default and promotion-on-unassign) is the one place where a
  subtle off-by-one leaves an installation with two defaults or none, which no later story checks.
- D1, D3, D4, D5 → default tier.
- Review: → default (contained new module surface, no shell or IPC-channel changes).

## Test Plan (manual acceptance)

Prerequisite: at least two registered installations and two profiles (story 001).

1. `npm run dev`, open **Config**, select profile A.
2. In the assignments panel, assign A to installation 1 and installation 2 → both show as
   assigned, and installation 1 (the first assigned) is marked default for A.
3. Select profile B, assign it to installation 1 → installation 1 now has two assigned profiles.
4. On B, mark it default for installation 1 → B is default there, A is no longer default for
   installation 1 but is still default for installation 2.
5. In the "By installation" panel: installation 1 lists A and B with the default badge on B;
   installation 2 lists A with the badge.
6. Restart the app, open Config → the same assignments and defaults are shown (AC4).
7. Unassign B from installation 1 → A becomes default for installation 1 again (promotion).
8. Delete profile A → no installation still lists A anywhere in the overview (AC6).

## Done
