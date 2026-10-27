---
id: 255
title: Assigning a profile never overwrites a foreign config silently
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, assigning a launcher profile to an installation never silently replaces a config file of
mine that happens to have the same name.

User feedback 2026-10-26: when a config is assigned to an installation, check whether a config with that
name already exists, so an existing config is not overwritten.

Today the profile file name (`<sanitized-profile-name>.cfg`) is checked only against the launcher's own
profiles; a foreign `baseq2/<name>.cfg` is backed up once and overwritten without a prompt.

## Acceptance Criteria

- [ ] **AC1** — Assigning a profile whose file name matches an existing file in the installation that the
      launcher did not write opens a dialog naming the file and the installation, before anything is
      written.
- [ ] **AC2** — "Cancel" leaves the assignment undone and the existing file byte-identical.
- [ ] **AC3** — "Write" backs up the existing file (story 254's folder), then completes the assignment.
- [ ] **AC4** — A file that the launcher wrote itself (ownership stamp) is updated without the dialog.
- [ ] **AC5** — Assigning to several installations at once asks once per conflicting installation; the
      others are assigned normally.

## Open Questions

## Decisions (Sprint)

- **(User)** When a file with the profile's file name already exists and was not written by the launcher,
  the assignment stops and asks: "Write (the existing file is backed up first)" or "Cancel". Cancel leaves
  the user to rename the profile; there is no automatic free name.
- The backup taken on "Write" goes into story 254's backup folder.
- Only the profile's own `<name>.cfg` in `baseq2` is checked; `autoexec.cfg` (baseq2 and mod folders) is
  the launcher's loader, always written and covered by story 254's backup — asking about it on every
  first assignment would make the dialog noise, and the feedback names the profile's config name.
- "Several installations at once" (AC5) means ticking several installations in the existing assignments
  popover (`ProfileAssignmentsPanel`); each tick is its own `assign` call checked on its own and no batch
  action is added — none exists today, and per-call checking yields "once per conflicting installation"
  by construction.
- The check runs in main's `assign` before the store commits anything, and only when the profile is not
  yet assigned there — an idempotent re-assign writes nothing, so there is nothing to ask about.
- "Foreign" means the file exists and `isLauncherOwnedFile` is false — the test `writeTargetFile` already
  uses, so dialog and writer can never disagree (a stamp with any profile id counts as ours, AC4).
- The conflict is a normal result, not an error: `assign` answers
  `{ status: 'assigned', profiles } | { status: 'foreignFile', fileName, installationId }`, mirroring
  `discard`'s discriminated result — an error would toast and force the renderer to branch on a key.
- "Write" re-sends `assign` with `overwriteForeign: true`; main keeps no pending state between the two
  calls, so a file changed meanwhile is backed up as it is at write time.
- A non-ENOENT read error during the check fails the assign with `config.error.writeFailed` and assigns
  nothing — the ownership check could not run, which the writer also treats as "do not proceed".
- Dialog: `ConfirmDialog`, tone `danger`, confirm label "Write"; the body names file and installation and
  says the existing file is backed up first and that Cancel leaves it so the profile can be renamed — the
  (User) wording is kept as body text so the button stays short.
- Renaming an assigned profile onto a foreign file name is out of scope: the story is about assigning, and
  254's backup still catches that write.

## Plan

1. **Contract** (`src/shared/modules/config.ts`, `config-schemas.ts`): `AssignProfileInput` gains
   optional `overwriteForeign`; `assign` answers `AssignProfileResult` (`assigned` + list |
   `foreignFile` + `fileName` + `installationId`). `assign` gets its own schema; `unassign`/`setDefault`
   keep the old shape.
2. **Main** (`profile-writes.ts` `assign`, helper in `writer.ts`): before `profiles.assign`, if the
   profile is not yet assigned there and `overwriteForeign` is unset, resolve its file name
   (`resolveProfileFileNames`) and read `<root>/baseq2/<fileName>`; foreign → answer `foreignFile`, no
   commit, no write. With `overwriteForeign`, back the file up through story 254's backup-folder helper,
   then assign and sync as today.
3. **Renderer** (`ProfileAssignmentsPanel.tsx`, new `ForeignConfigDialog.tsx`, `client.ts`, locale): a
   `foreignFile` answer opens the dialog; Cancel closes it (checkbox stays unticked); Write re-sends with
   `overwriteForeign: true`.
4. **Flow** `scripts/flows/assign-foreign-config.mjs` proves AC1–AC5 on the real app; systems doc and
   changelog updated.

Order: D1 before D2. Story 254 is built first; its backup-folder helper is reused, never re-implemented.

## Deliverables

- **D1 — `assign` refuses to overwrite a foreign profile file without consent (contract + main).**
  Files:
  - `src/shared/modules/config.ts`: `overwriteForeign?: boolean` on `AssignProfileInput`; new
    `AssignProfileResult = { status: 'assigned'; profiles: ConfigProfile[] } | { status: 'foreignFile';
    fileName: string; installationId: string }` (shape like `DiscardProfileResult`); the `assign` row of
    the handler map answers it.
  - `src/shared/modules/config-schemas.ts`: `assignProfileInputSchema` gains
    `overwriteForeign: z.boolean().optional()`; `unassignProfileInputSchema`/`setDefaultProfileInputSchema`
    stop aliasing it and keep `profileId` + `installationId` only.
  - `src/main/modules/config/writer.ts`: new exported `isForeignFile(path): Promise<boolean>` — exists
    (via the existing `readExisting`, which rethrows non-ENOENT errors) and `!isLauncherOwnedFile(content)`.
    Reuse both; no second read routine.
  - `src/main/modules/config/profile-writes.ts` `assign`: after the installation lookup, when the profile
    is not already assigned to that installation and `overwriteForeign !== true`, resolve the name with
    `resolveProfileFileNames(deps.profiles.list()).get(profileId)` and check
    `join(installation.rootPath, BASE_GAME_DIR, name)`. Foreign → `ok({ status: 'foreignFile', fileName,
    installationId })` without calling `profiles.assign` or any sync. Read error →
    `fail('config.error.writeFailed')`, nothing assigned. With `overwriteForeign: true` and a foreign file,
    first call story 254's "copy this file into the installation's backup folder, first original wins"
    helper (in `src/main/modules/config/backup.ts` after 254 — reuse it, do not write a copy routine),
    then the existing assign + `syncAndPersist`, answering `ok({ status: 'assigned', profiles })`.
    `index.ts`'s handler stays a pass-through.
  - `docs/systems/config-module.md`: assign's foreign-file check and the two-step consent.
  Tests: new `src/main/modules/config/profile-writes.assign-foreign.test.ts` on
  `profile-writes.test-helpers.ts`' harness with a real temp installation — "a foreign profile file stops
  the assignment before anything is written" (answers `foreignFile` with the file name; no new assignment
  in the store; `baseq2/<name>.cfg` and `baseq2/autoexec.cfg` exactly as before; backup folder empty),
  "overwriteForeign backs the foreign file up and assigns" (backup folder holds the original bytes; the
  file now carries the ownership stamp; assignment present), "a launcher-stamped file is assigned without
  asking" (stamp with a different profile id), "an absent file is assigned without asking", "an
  already-assigned installation is not re-checked". Extend `src/shared/modules/config-schemas.test.ts`:
  `overwriteForeign` is accepted on assign and rejected (stripped/strict as the file's other cases do) on
  unassign/setDefault.

- **D2 — the assignments popover asks before writing (renderer + flow).**
  Files:
  - `src/renderer/src/modules/config/client.ts`: `assignConfigProfile` returns
    `Outcome<AssignProfileResult>`.
  - new `src/renderer/src/modules/config/components/ForeignConfigDialog.tsx`: wraps
    `src/renderer/src/components/ui/ConfirmDialog.tsx`, tone `danger`, confirm "Write", title "A config
    named {{fileName}} already exists", body naming the installation and saying the existing file is
    backed up first, and that Cancel leaves it untouched so the profile can be renamed; testIds
    `foreign-config-write` / `foreign-config-cancel`.
  - `src/renderer/src/modules/config/ProfileAssignmentsPanel.tsx`: assign goes through a second
    `useProfileSave<AssignProfileResult>` instance (`lib/useProfileSave.ts`, already generic) whose
    `onChanged` calls the context's `save(profiles)` for `assigned` and sets dialog state
    `{ fileName, installationId }` for `foreignFile` — no toast, no state change. Write re-sends with
    `overwriteForeign: true` and closes; Cancel only closes. Unassign and setDefault unchanged.
  - `src/renderer/src/modules/config/locale/en.json`: keys under `config.assignment.foreignFile.*`
    (update `src/renderer/src/i18n/__snapshots__/en.bundle.json` if the bundle snapshot test asks).
  - `CHANGELOG.md` `## Unreleased` › `### Added`: "Assigning a profile asks before replacing a config file
    of yours with the same name."
  Tests: component `src/renderer/src/modules/config/ProfileAssignmentsPanel.foreign.test.tsx` — "a foreign
  file answer opens the dialog instead of a toast", "Write re-sends with overwriteForeign". Flow
  `scripts/flows/assign-foreign-config.mjs` with the three tests named in `## Acceptance Tests`; selectors
  as in `scripts/flows/engine-badge-surfaces.mjs` ("N of M assigned" trigger, popover `ul > li` rows);
  plant files with `installationConfigFilePath` from `scripts/lib/fixture.mjs` as
  `scripts/flows/care-drift-sync-now.mjs` does. Use the unassigned fixture profile "Imported Profile"
  (`scripts/lib/fixture/controls.mjs`) and hardcode its file name with a "mirrors
  `sanitizeProfileFileBase`" comment.

## Model Hints

No `deliverable-hard`: D1 is one guarded early return plus a reused helper; D2 is a dialog on an
existing generic save hook.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/assign-foreign-config.mjs` › "a foreign config asks before anything is
  written" (plant a foreign `<name>.cfg` in install A, tick A: dialog shows the file name and A's name;
  the file and `autoexec.cfg` are untouched while it is open) + unit
  `src/main/modules/config/profile-writes.assign-foreign.test.ts` › "a foreign profile file stops the
  assignment before anything is written"
- AC2 → e2e `scripts/flows/assign-foreign-config.mjs` › "a foreign config asks before anything is
  written" (Cancel: A stays unticked, the file is byte-identical, the backup folder has no entry for it)
- AC3 → e2e `scripts/flows/assign-foreign-config.mjs` › "write backs the foreign config up and assigns"
  (tick A again, Write: the backup folder holds the original bytes, A is ticked, the file carries the
  launcher stamp) + unit `src/main/modules/config/profile-writes.assign-foreign.test.ts` ›
  "overwriteForeign backs the foreign file up and assigns"
- AC4 → e2e `scripts/flows/assign-foreign-config.mjs` › "a launcher-written config is updated without
  asking" (copy a stamped installation copy into install C under the profile's file name, tick C: no
  dialog, assigned) + unit `src/main/modules/config/profile-writes.assign-foreign.test.ts` › "a
  launcher-stamped file is assigned without asking"
- AC5 → e2e `scripts/flows/assign-foreign-config.mjs` › "write backs the foreign config up and assigns"
  (in one popover session tick install B, which has no such file: assigned without a dialog; then A:
  exactly one dialog) + component `src/renderer/src/modules/config/ProfileAssignmentsPanel.foreign.test.tsx`
  › "a foreign file answer opens the dialog instead of a toast"

## Done
