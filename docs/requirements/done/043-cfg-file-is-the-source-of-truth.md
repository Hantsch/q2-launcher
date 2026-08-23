---
id: 043
title: The .cfg file is the source of truth, state.json becomes a cache
status: done # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

The `.cfg` is the artefact that matters. It is what the engine reads, what a player keeps for years,
what gets shared on a forum, copied to a LAN machine, edited in Notepad at two in the morning.
`state.json` is the launcher's own bookkeeping. Today that is inverted: `state.json` holds the
profile and the `.cfg` is disposable output stamped *"generated, do not edit"*. Hand-edit the file
and the next save silently overwrites it.

Decided with the user: **the file becomes the real source of truth; `state.json` becomes a cache.**

This is a deliberate architectural inversion and the largest item in this batch. It only makes sense
on top of story 042 - a file can only be authoritative for state it can actually carry. It also
touches the write pipeline, the sync engine (022), Raw File (023) and Care's sync section (025), all
of which currently assume "the launcher writes, the disk receives".

Concretely, what changes for me as a user:

- I can edit `<name>.cfg` in an editor and the launcher picks the change up instead of clobbering it.
- What the Controls/Settings tabs show is derived from the file, so the two can never disagree.
- "generated, do not edit" comes off the header - that claim stops being true.

## Acceptance Criteria

- [x] The canonical `<name>.cfg` is authoritative for profile content. `state.json` holds only what
      the file cannot: profile list membership, installation assignments, played mods, ids, and the
      cache itself.
- [x] Deleting the cached entry (or a corrupt/absent `state.json` profile record) loses nothing that
      the files on disk still hold - the profile list rebuilds from the files.
- [x] An external edit to a profile's file is detected while the launcher is open and the UI reflects
      it, with an explicit indication that the file changed underneath - never a silent swap of what
      the user is editing.
- [x] A file that is unparseable, or that fails to parse into a valid profile, does not take the
      profile down: the last good cached state stays usable and the parse failure is reported with
      the file and line.
- [x] The launcher never overwrites a hand-edit it has not read. A change made in the UI while the
      file also changed on disk is a **conflict**, surfaced with both versions (story 024's viewer is
      already the diff/preview surface) and resolved by the user, not by timestamp.
- [x] The per-installation copies stay generated output, not sources - sync (story 022) still flows
      canonical file -> installations, and an edit to an installation copy is reported as out-of-sync
      exactly as today.
- [x] The header's "generated, do not edit" is replaced by wording that is actually true.
- [x] Migration: existing profiles keep working. On first run after the update, each profile's file is
      brought to the story-040/042 format from cached state, and the file is authoritative from then
      on. Nothing is deleted; `state.json.bak` and the backup-once contract still apply.
- [x] Care's sync section and Raw File keep working against the new direction, and the five sync
      states (022 decision 5) still mean what they say.

## Open Questions

- ~~Change detection...~~ answered → Decisions (Sprint)
- ~~Write cadence...~~ answered → Decisions (Sprint)
- ~~Conflict granularity...~~ answered → Decisions (Sprint)
- ~~Does the cache stay in `state.json`...~~ answered → Decisions (Sprint)
- ~~A profile whose file was deleted outside the launcher...~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Change detection: re-read on window focus, tab open, and before write — no
  `fs.watch`. Avoids Windows watcher noise and self-triggering on the launcher's own writes, at
  the cost of not being instantaneous.
- **(User)** Write cadence: explicit save, not auto-write on every keystroke, now that the file
  is authoritative. This is a behaviour change from today's `useProfileAutoWrite.ts` and needs a
  visible "unsaved changes" state.
- **(User)** Conflict granularity: whole file. UI-edit vs. disk-edit conflicts are shown as
  whole-file old-vs-new (story 024's viewer), not per-section/per-entry.
- **(User)** Cache location: stays in `state.json`, not a separate per-profile cache file — kept
  under the existing migration/schema-version framework.
- **(User)** A profile whose file was deleted outside the launcher is an error state awaiting a
  decision, not treated as a deleted profile. It stays in the list marked "file missing"; the
  user can rewrite it from cache or explicitly remove the profile.

Decided during refine (no user involvement):

- **Change detection compares a hash, not stored text.** The cache keeps `fileHash` (sha-256 of
  the latin1 file bytes the launcher last read *or* wrote) + `fileSeenAt`; "did the file change
  underneath us" is a byte-hash comparison, never a timestamp. The conflict view needs no stored
  copy — the launcher's side is `renderProfileFile(cache)`, the disk side is read live — so
  duplicating a 30 KB file inside `state.json` per profile buys nothing.
- **New cache fields are additive optional with `.catch()` and no migration entry**
  (`fileHash`, `fileSeenAt`, `dirty`, `fileState`) — this repo's convention for additive fields,
  `MIGRATIONS` is still empty (040 D4 precedent). AC8's one-time file migration is an on-disk
  action, not a schema shape change, so it is gated by a new top-level state key
  (`configFileSourceMigratedAt`), mirroring `configPlayedMods`' "new key, no schema bump".
- **Ownership detection becomes wording-tolerant before the header wording changes.**
  `findOwnCanonicalFile` (`canonical.ts:88`) today compares the first line to
  `sentinelLine(profileId)` **exactly**; changing the trailing clause would orphan every file
  written before the update. It switches to `ownedProfileId(firstLine) === profileId`
  (`writer.ts:237`, already the forgiving prefix parser every other call site uses).
- **A rebuild from the launcher's own file keeps the sentinel id**, unlike 042 AC4's import rule:
  a launcher-owned file's sentinel id *is* that profile's identity, so restoring it must not mint
  a new one. Foreign import keeps minting a new id. The two paths therefore stay separate
  functions even though both end in `ProfilesStore`'s commit path.
- **Re-read is scoped to the selected profile** on window focus and tab open, and to the whole
  list only at startup — reading n files on every focus event would make focus latency scale with
  the profile count for no user-visible gain.
- **Explicit save inverts 022 decision 8 for the canonical file only.** Mutating handlers keep
  persisting into `state.json` immediately (a crash must not lose an edit) but stop touching
  disk; one new `save` handler does re-read → conflict check → render → write canonical → run the
  existing sync cascade. Installation copies therefore still only ever come from the canonical
  file (AC6).
- **No sixth sync state.** A profile with unsaved edits reports its canonical file as
  `outOfSync` with an explicit reason (`unsavedChanges` / `changedOnDisk`) carried in the existing
  `messageKey` field; 022 decision 5's five states keep their meanings (AC9). The only semantic
  change is what `outOfSync` on the *canonical* row invites: adopt/compare, not "rewrite it".
- **An unparseable file leaves the profile editable**, serving the last good cache, and a save
  over it is treated as a conflict (an unreadable file counts as "changed on disk"). Locking the
  profile read-only would be more scope and would strand a user whose only fix is in the UI.
- **Conflict resolution offers exactly two outcomes** — take the file (discard my edits) or
  overwrite the file with my version — matching the whole-file granularity the user decided. No
  merge, no per-section picking.
- **042's parser is consumed through one main-side seam**, a new
  `src/main/modules/config/file-source.ts`. 043 does not reach into 042's internals, so if 042's
  parser entry point is named differently only that one file changes.
- **`useProfileAutoWrite.ts` and `lib/auto-write.ts` are deleted, not gated** — a disabled
  auto-write hook is a loaded gun for the next feature that "just re-enables" it.
- **The machine-detectable prefix stays line 1** (040's standing rule): only the trailing clause
  of `sentinelLine()` and `HAND_EDIT_SENTENCE` (`render.ts:25`) change wording.
- **Care gets no new section** — the existing canonical (`own`) sync row grows Reload/Compare
  affordances instead, so "the file changed" lives where "the file is out of sync" already lives.

## Plan

Invert the direction: the canonical `<name>.cfg` is read before it is ever written, and a write
only happens when the user asks and the disk still looks the way the launcher last saw it.

1. **Header wording first** (`render.ts` + `canonical.ts`): make ownership detection tolerant of
   the sentinel's trailing clause, *then* replace "generated, do not edit" and
   `HAND_EDIT_SENTENCE` with true wording. Re-baseline the five test files that pin the literal.
2. **A read layer in main** — new `file-source.ts`: read the canonical file (latin1), hash it,
   parse it via 042's parser, and classify against the cached hash as
   `unchanged | changedOnDisk | missing | unparseable | readError`. The cache gains
   `fileHash`/`fileSeenAt`/`dirty`/`fileState`.
3. **The cache becomes rebuildable** — new `rebuild.ts`: at startup, scan the canonical dir for
   launcher-owned `.cfg` files, rebuild a profile record for any sentinel id `state.json` has no
   record for (keeping the id), and run AC8's one-time migration (rewrite each existing profile's
   file from cache into the 040/042 format, seed its hash) behind `configFileSourceMigratedAt`.
4. **Write cadence** — mutating handlers stop calling the sync engine; a new `save` handler does
   the whole save. `sync.ts`'s unconditional `writeCanonicalProfileFile` at the top of
   `syncOneProfile` becomes conditional on a caller-supplied "the canonical file is ours to
   write" decision.
5. **Re-read + conflict on the wire** — new `refreshFromFiles` handler returning per-profile file
   state plus, on conflict, both texts (disk / `renderProfileFile(cache)`).
6. **Renderer**: delete auto-write, add an explicit Save + unsaved-changes indicator, add the
   focus/tab-open re-read, the "the file changed on disk" notice, the "file missing" banner with
   its two actions, and a two-pane conflict dialog built from 024's `ConfigCodeView`.
7. **Direction updates**: Care's sync row, Raw File, and the parse-error report (file + line).
8. **Adversarial pass** (S07 carry-over rule): constructed edge-case profiles through
   write → external edit → re-read → render, asserting nothing is lost or mislabelled.

Affected: `src/shared/config/render.ts`, `src/shared/modules/config.ts`, `src/main/lib/schemas.ts`,
`src/main/services/state.ts`, `src/main/modules/config/{canonical,sync,index,profiles,schemas}.ts`
plus new `file-source.ts`/`rebuild.ts`,
`src/renderer/src/modules/config/{ConfigView,RawFileTab,RawConfigPanel,CareSyncSection,client}.tsx/.ts`,
new `ConfigConflictDialog.tsx`, `lib/{useProfileAutoWrite,auto-write}.ts` (deleted),
`src/renderer/src/i18n/locales/en.json`, the `ui:verify` screen registry,
`docs/systems/config-module.md`.
Not touched: `renderLoaderFile`, `OWNERSHIP_MARKER` itself, the per-installation write path.

## Deliverables

### D1 — Honest header wording, wording-tolerant ownership [x]

- Files: `src/shared/config/render.ts` (`sentinelLine`, `HAND_EDIT_SENTENCE`),
  `src/main/modules/config/canonical.ts` (`findOwnCanonicalFile` → `ownedProfileId`), and the
  literal-pinning expectations in `src/main/modules/config/{render,writer,canonical,cleanup}.test.ts`
  and `src/shared/config/validate-structure.test.ts`.
- Mirror: `ownedProfileId` (`src/main/modules/config/writer.ts:237`) is the existing forgiving
  parser — reuse it, do not add a second.
- Acceptance: line 1 still starts with `OWNERSHIP_MARKER` followed by the profile id; the
  trailing clause and the header banner sentence no longer claim the file must not be edited and
  instead say the launcher reads it back; a file whose first line still carries the **old**
  trailing clause is still recognised as that profile's own canonical file (regression test with
  the literal old line); latin-1 round-trip and per-line budget hold; determinism assertions pass.

### D2 — The file-read layer and the cache's new fields [x]

- Files: new `src/main/modules/config/file-source.ts` + `file-source.test.ts`,
  `src/main/lib/schemas.ts` (`fileHash`, `fileSeenAt`, `dirty`, `fileState` — optional,
  `.catch()`), `src/shared/modules/config.ts` (the `ProfileFileState` union + fields on
  `ConfigProfile`).
- Mirror: `src/main/modules/config/canonical.ts`'s read idioms (latin1, ENOENT-only-is-missing);
  042's parser entry point for the parse step.
- Acceptance: `readFileState(baseDir, fileName, cachedHash)` returns exactly one of
  `unchanged | changedOnDisk | missing | unparseable | readError`, with the parsed profile on
  `changedOnDisk`/`unchanged` and `{ file, line, message }` on `unparseable`; the hash is over the
  latin1 bytes and equals the hash of what `writeCanonicalProfileFile` just wrote (a write seeds
  the baseline, so the launcher's own write is never mistaken for an external edit); a file with
  hand-deleted metadata comments still parses (042's degradation rule) and is reported as
  `changedOnDisk`, not `unparseable`; no new migration entry.

### D3 — `state.json` becomes a rebuildable cache (+ AC8 migration) [x]

- Files: new `src/main/modules/config/rebuild.ts` + `rebuild.test.ts`,
  `src/main/modules/config/index.ts` (startup hook), `src/main/services/state.ts`
  (`configFileSourceMigratedAt`), `docs/systems/config-module.md`.
- Mirror: `src/main/modules/config/import.ts`'s build-a-profile-from-parsed-content path and
  `ProfilesStore`'s commit path (`profiles.ts:57/73-80`); `readCanonicalOwnership`
  (`canonical.ts:119`) for the disk scan.
- Acceptance: with a profile record deleted from `state.json` (or its record corrupt), the profile
  reappears in the list on next start, rebuilt from its file, **with the same id** the sentinel
  carries, and its assignments/played-mods absence is the only loss; a foreign `.cfg` in the
  canonical dir is not adopted; the migration runs once (guard key set), brings every existing
  profile's file to the 040/042 format from cache, seeds each `fileHash`, deletes nothing, and
  `state.json.bak` plus the backup-once contract are untouched; a second start is a no-op.

### D4 — Explicit save replaces write-on-every-change (main) [x]

- Files: `src/main/modules/config/index.ts` (mutating handlers + new `save` handler),
  `src/main/modules/config/sync.ts` (canonical write becomes conditional),
  `src/main/modules/config/schemas.ts`, `src/shared/modules/config.ts`
  (`CONFIG_HANDLERS.save`, `SaveProfileInput/Result`).
- Mirror: `setWriteUnbindall` (`index.ts`, story 040 D4) for handler shape; 022 decision 8 is the
  contract being deliberately inverted — say so in the doc comment.
- Acceptance: `setCvars`/`setBinds`/`setLayers`/`setActions`/`rename`/`setWriteUnbindall` persist
  to `state.json` and mark the profile `dirty` but write **no** file (asserted on disk); `save`
  re-reads first and refuses to write when the file changed underneath, returning a conflict
  instead; on a clean save it writes the canonical file, seeds the new hash, clears `dirty`, and
  runs the existing installation sync cascade unchanged; `assign`/`unassign`/`setDefault` still
  sync installations immediately (they are not profile *content*); IPC contract/coverage tests green.

### D5 — Re-read and conflict detection on the wire [x]

- Files: `src/main/modules/config/index.ts` (`refreshFromFiles` handler),
  `src/main/modules/config/schemas.ts`, `src/shared/modules/config.ts`,
  `src/main/modules/config/index.test.ts`.
- Acceptance: `refreshFromFiles({ profileId? })` returns per profile its `fileState` and, when the
  file changed with no unsaved edits, the adopted profile (cache updated, hash reseeded); when the
  file changed **and** the profile is dirty, it returns a conflict payload carrying both whole-file
  texts (disk content, `renderProfileFile(cache)`) and adopts nothing; `unparseable` returns the
  `{ file, line, message }` diagnostic and leaves the cached profile intact and usable;
  `missing` sets `fileState: 'missing'` and never deletes the profile.

### D6 — Unsaved-changes state and an explicit Save in the UI [x]

- Files: `src/renderer/src/modules/config/ConfigView.tsx`, new
  `src/renderer/src/modules/config/components/ProfileSaveBar.tsx`,
  `src/renderer/src/modules/config/client.ts`,
  `src/renderer/src/modules/config/lib/useProfileAutoWrite.ts` + `lib/auto-write.ts` (**deleted**,
  with their tests), `src/renderer/src/i18n/locales/en.json`.
- Mirror: `RawFileTab.tsx`'s existing action row for button/label styling; `useProfileDraft.ts`
  for how local edits reconcile against the server profile.
- Acceptance: editing anything in Settings/Controls/Raw File shows an "unsaved changes" state and
  an enabled Save; Save writes and the state clears; the indication is not colour-only and the
  button is keyboard-reachable with a visible focus ring; leaving the profile or closing the app
  with unsaved edits does not lose them (they are in the cache) and the state is still shown on
  return; no new axe violation in `npm run ui:verify`.

### D7 — Re-read triggers, external-change notice, file-missing banner [x]

- Files: `src/renderer/src/modules/config/ConfigView.tsx`, new
  `src/renderer/src/modules/config/lib/useFileSourceRefresh.ts`,
  `src/renderer/src/store/useLauncher.ts` (expose `chrome.focused` as a selector if not already),
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: the existing `window:state` subscription (`useLauncher.ts:138`) is the focus signal —
  do not add a DOM `focus` listener.
- Acceptance: editing the file in Notepad and clicking back into the launcher (or switching to the
  config tab) makes the UI show the new content with an explicit "this file changed on disk and
  was reloaded" notice — never a silent swap; deleting the file outside the launcher leaves the
  profile in the list with a "file missing" banner offering **Rewrite from cache** and **Remove
  profile**, both working through the UI; an unparseable file shows the parse error with file and
  line and the profile keeps working off the last good cache.

### D8 — The whole-file conflict dialog (024's viewer, two panes) [x]

- Files: new `src/renderer/src/modules/config/ConfigConflictDialog.tsx`,
  `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/i18n/locales/en.json`, the `ui:verify` screen registry +
  `docs/UI-VERIFICATION.md`.
- Mirror: `ImportProfileDialog.tsx` for dialog shell/focus handling;
  `components/ConfigCodeView.tsx` used twice (it is single-pane by design — compose, do not
  rewrite it into a diff component).
- Acceptance: saving while the file changed on disk opens a dialog showing both whole-file
  versions side by side, labelled "on disk" and "your unsaved changes", both syntax-highlighted
  and searchable; exactly two resolutions, both reachable from the UI: take the file (discard my
  edits) or overwrite the file with my version; cancelling resolves nothing and leaves the profile
  dirty; the dialog is in the screen registry and a full `ui:verify` run stays at zero axe
  violations.

### D9 — Care, Raw File and the sync direction [x]

- Files: `src/renderer/src/modules/config/CareSyncSection.tsx`,
  `src/renderer/src/modules/config/lib/care-sync.ts` (+ its test),
  `src/renderer/src/modules/config/{RawFileTab,RawConfigPanel}.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Acceptance: the canonical (`own`) row explains an out-of-sync canonical file as an external edit
  and offers Reload / Compare instead of only Retry; an unsaved-changes profile reads as
  "unsaved changes", not as a broken file; installation rows keep today's exact meaning and an
  edited installation copy is still reported out-of-sync with a working Retry; the five states of
  022 decision 5 still each mean what their copy says (pinned in `care-sync.test.ts`).

### D10 — Adversarial round-trip pass (S07 carry-over rule) [x]

- Files: `src/main/modules/config/file-source.test.ts`,
  `src/shared/config/render-invariants.test.ts`, `src/shared/config/profile-fixtures.ts`.
- Acceptance: over every fixture profile plus constructed edge cases (an action whose command
  equals its own alias name, a layer whose trigger collides with a base bind, a custom category
  with latin-1-only characters, a hand-reordered file, a file with a metadata comment deleted, a
  file with CRLF line endings, an empty file, a file truncated mid-line): write → read back →
  render is a fixed point where 042 promises it is, and every non-fixed-point case lands in a
  named diagnostic rather than in silent data loss. No profile loses a bind, an alias name, a
  category or a layer across the cycle.

## Model Hints

- `D3 → deliverable-hard` — it is the only deliverable that can lose user data: a rebuild that
  mints a new id, or a migration that runs twice or writes over a hand-edit it never read, is
  invisible in a green test run and irreversible on a real user's disk.
- `D4 → deliverable-hard` — it inverts 022 decision 8 across ten handlers and makes `sync.ts`'s
  unconditional canonical write conditional; getting the condition wrong either clobbers hand-edits
  (the exact bug this story exists to fix) or silently stops writing files the engine needs.
- `D10 → deliverable-hard` — this is the S07 carry-over rule's adversarial pass over the
  render/alias-mirror mechanism, which needed four build rounds in 039 because reading diffs was
  not enough; it has to actively construct the failure cases, not confirm the happy path.
- D1, D2, D5, D6, D7, D8, D9 → default tier.
- `Review: → story-review-hard` — the story rewires when and whether the launcher writes a user's
  config file at all, and its worst failure mode (a hand-edit clobbered, or a profile silently
  reduced to what an incomplete parse recovered) leaves no trace in tests or logs.

## Test Plan (manual acceptance)

1. Start the app on an existing `state.json` (pre-update profiles). Open Config: every profile is
   still there, and its Raw File tab shows the 040/042 format with the new, honest header wording —
   no "generated, do not edit".
2. Edit a cvar in Settings. An **unsaved changes** indicator appears and Save becomes enabled;
   the file on disk (Raw File → Reveal in folder) is still the old one. Press Save: the file
   changes and the indicator clears.
3. Quit with unsaved edits, restart, reopen the profile: the edits and the unsaved-changes state
   are both still there.
4. With the launcher open, edit the profile's `.cfg` in Notepad (change a `sensitivity` value and
   a trailing comment) and save. Click back into the launcher: a notice says the file changed and
   was reloaded, and Settings/Controls show the new value.
5. Conflict: edit a cvar in the UI (do not save), then edit the same file in Notepad and save.
   Press Save in the launcher → the conflict dialog opens with both whole files side by side.
   Choose **take the file**: the UI shows the Notepad version. Repeat and choose **overwrite with
   my version**: the file on disk becomes the UI's version.
6. Corrupt the file (delete a closing quote mid-line) and click back into the launcher: the parse
   error is shown with the file and the line, and the profile still works off its cached state.
7. Delete the file outside the launcher and click back in: the profile stays in the list with a
   "file missing" banner. Use **Rewrite from cache** — the file comes back. Delete it again and
   use **Remove profile** — the profile goes, and nothing else does.
8. Delete the profile's record from `state.json` (launcher closed), restart: the profile is back
   in the list, rebuilt from its file, with the same name and content; only its installation
   assignment needs redoing.
9. Care tab: the canonical row for an externally edited file offers Reload/Compare; hand-edit an
   *installation* copy and confirm it still reports out-of-sync with a working Retry.
10. Launch the installation once and confirm Quake II starts with the profile applied.

## Coverage

| AC | Deliverable |
| --- | --- |
| File is authoritative; `state.json` holds only list/assignments/mods/ids + cache | D2 (fields) + D4 (write cadence) + D5 (adoption) |
| Deleting the cached entry loses nothing — list rebuilds from files | D3 |
| External edit detected while open, UI reflects it, never a silent swap | D5 (main) + D7 (triggers + notice) |
| Unparseable file: last good cache stays usable, error with file + line | D2 (diagnostic) + D5 (wire) + D7 (surface) |
| Never overwrite an unread hand-edit; UI-vs-disk is a surfaced conflict | D2 (hash baseline) + D4 (save refuses) + D8 (dialog) |
| Installation copies stay generated output; edited copy still out-of-sync | D4 (sync cascade unchanged) + D9 (Care copy) |
| "generated, do not edit" replaced by true wording | D1 |
| Migration: existing profiles keep working, files brought to 040/042 format | D3 |
| Care + Raw File keep working; the five sync states still mean what they say | D9 |
| S07 carry-over: adversarial re-render/re-parse pass | D10 |

## Done

### Summary

Inverted the direction 022 established: the canonical `<name>.cfg` is now read before it is ever
written, and `state.json` is a rebuildable cache of it plus what the file cannot carry (list
membership, assignments, played mods, ids). Ten deliverables, built bottom-up (main read/write
layer first, then the renderer surfaces, then a genuinely adversarial cross-cutting pass):

- **D1** made the sentinel/hand-edit wording honest and ownership detection wording-tolerant, so no
  file already on a user's disk is orphaned by the wording change.
- **D2** added `file-source.ts`'s `readFileState` (latin1 hash classification: `unchanged` /
  `changedOnDisk` / `missing` / `unparseable` / `readError`) and the cache's new optional fields
  (`fileHash`, `fileSeenAt`, `dirty`, `fileState`).
- **D3** made `state.json` rebuildable: a deleted/corrupt profile record reappears from its file
  with the same id at next start, and a one-time migration (`configFileSourceMigratedAt`) brings
  every pre-existing profile's file to the current format and seeds its hash.
- **D4** inverted the write cadence: mutating handlers persist to `state.json` and mark `dirty` but
  stop touching disk; a new `save` handler re-reads, refuses on `changedOnDisk`, and otherwise
  writes/reseeds/clears `dirty` and runs the existing sync cascade.
- **D5** added `refreshFromFiles`: adopts an external, non-conflicting change into the cache,
  returns a two-text conflict payload for a dirty-vs-changed profile, and never deletes a profile
  for `missing`/`unparseable`.
- **D6** deleted the old write-on-every-keystroke hook outright and added an explicit Save +
  unsaved-changes indicator.
- **D7** wired the two re-read triggers (window focus, Config tab open) to the selected profile,
  an explicit "reloaded" notice, a file-missing banner (Rewrite from cache / Remove profile), and
  a persistent parse-error diagnostic.
- **D8** built the real two-pane conflict dialog (`ConfigConflictDialog.tsx`, composing
  `ConfigCodeView` twice) with exactly two resolutions, adding a minimal `force` flag to `save` and
  a `discardLocalEdits` flag to `refreshFromFiles` for them.
- **D9** taught Care's canonical row to tell unsaved edits apart from an external edit and added
  working Reload/Compare, reusing D5/D8's machinery with no new IPC surface.
- **D10**, the adversarial pass, found and fixed three real, confirmed defects that a green diff
  read would have missed (see Decisions below) and named two deliberate, documented limitations.

### Decisions (one-sentence reason each)

- **`setSectionHeaderStyle` joins the no-immediate-write set alongside `setCvars`/`setBinds`/
  `setLayers`/`setActions`/`rename`/`setWriteUnbindall` (D4)**, even though the deliverable's own
  acceptance list didn't name it, because its own doc comment already says it mirrors
  `setWriteUnbindall` exactly and it is equally write-affecting - excluding it would make it the one
  content setter still stamping the file on every change.
- **A dirty profile's installation copies are read from the canonical file's on-disk bytes (located
  via the ownership sentinel), never from the in-memory render (D4)**, because installation copies
  are supposed to only ever come from the canonical file (AC6) - rendering the unsaved draft into an
  installation would leak an edit the user has not saved yet through a side door.
- **`refreshFromFiles` locates a profile's file by ownership sentinel, not by resolved name (D4/D10
  fix)**, because a renamed-but-unsaved profile's file is still under its old name, and a
  name-based lookup falsely reported it `missing` and offered to remove a profile that was fine.
- **The canonical write gate checks the file's real on-disk bytes/hash, not only `profile.dirty`
  (D10 fix)**, because `assign`/`setDefault`/rename-cascade and the startup retry sweep could
  otherwise clobber a hand-edit on a NON-dirty profile before any focus/tab-open re-read had run -
  exactly the bug this story exists to fix, and invisible in a green test run until actually
  constructed.
- **`file-source.ts` rejects non-text/binary/NUL-truncated bytes before parsing, with a real
  file/line/column, instead of letting them fall through as `changedOnDisk` (D10 fix)**, because a
  corrupt file was being silently adopted over the last good cache - the exact thing AC4 promises
  never happens - and `unparseable` had rested on a branch D2's own author suspected was
  unreachable.
- **Care's Reload = `refreshProfilesFromFiles`, Compare = a plain `saveConfigProfile` call reused
  for its refusal payload (D9)**, because `save` already returns the exact `diskContent`/
  `ourContent` pair `ConfigConflictDialog` needs when it refuses on `changedOnDisk`, and a refusal
  touches neither cache nor disk - no new IPC surface was needed to give Care a real Compare.
- **A dirty canonical row shows "unsaved changes" with no action button, not Reload/Compare (D9)**,
  because Care is not where a save happens (`ProfileSaveBar` already owns that), and offering an
  action here would either duplicate Save or invite discarding an edit from the wrong tab.
- **The `config.fileSource.conflict` toast copy was corrected mid-story (D9 self-fix)**, because it
  still said resolving a conflict "needs the conflict dialog, which isn't built yet" after D8 had
  already built it - a user-facing inaccuracy left behind by sequencing, not a design choice.
- **The stale fixture literal in `scripts/lib/fixture.mjs` was corrected at closing, not left as a
  new story**, because the `config-import-restore` ui:verify screen's hand-edit-sentence line is a
  hardcoded duplicate of `HAND_EDIT_SENTENCE` (never an import - scripts run as plain Node ESM with
  no TS bridge into `src/shared`), and D1's wording change silently drifted it out of sync,
  reintroducing exactly the `scrollable-region-focusable` axe violation story 042's fix-cycle-5 had
  already closed once. Added a doc comment tying the two literals together so the next wording
  change doesn't repeat this.

### Known, accepted limitations (named, not silently absorbed)

- **A keyless catalogue entry has no representation in the rendered file at all** (042's own
  format), so an adopt/rebuild cannot restore one - it is bound to nothing, so no engine behaviour
  is lost, but fixing this needs a 042 format change, which is out of this story's scope.
- **A hand-added free-text comment (no `[q2l ...]` tag, not a recognised section header) survives
  on disk but is not adopted into the cache**, so a subsequent save drops it - `restoreProfileParts`
  has no `unrecognized`-line carry-through into the live-adoption path today. Worth a follow-up
  story if hand-added prose comments turn out to matter to users in practice.
- **`CareTidyUpSection`'s `tidyUp.apply` still writes the canonical file immediately** rather than
  marking `dirty` and waiting for an explicit Save - it is protected from clobbering a hand-edit by
  D10's real-bytes write gate, but its own cache-vs-file change shows no unsaved-changes indicator
  in the meantime. Story 025's tidy-up flow was not in this story's Plan/Deliverables list, so this
  was left as a named gap rather than pulled in as unplanned scope.

### Verification

`npm run build`, `npm run typecheck` (node + web) and `npm test` (71 files / 1612 tests) are all
green. `npm run ui:verify` is green at 0 critical/serious/moderate/minor axe violations across the
full 48-screenshot, 24-screen run (including the new `config-conflict-dialog` screen) - the first
run surfaced 2 serious violations on `config-import-restore`, traced to the stale fixture literal
described above (not a product-code regression) and closed by the fix named in Decisions, with a
clean re-run confirming it. D10's adversarial pass constructed and ran, against the real pipeline
(not mocked past the interesting part), all seven scenario classes the sprint's carry-over rule and
this story's own Model Hints called for: external edit during a UI session, conflicting
simultaneous changes (assign/setDefault/rename-cascade races and the startup retry sweep),
corrupt/binary/NUL-truncated files, deleted files (clean and dirty), migration of a pre-042/
pre-040 profile, rebuild-with-same-id, and no bind/alias/category/layer lost across any of 042's
fixture profiles run through the full cycle. Three confirmed, real defects were found and fixed
this way (see Decisions); two deliberate limitations were named rather than silently absorbed.

### Commit message

```
043: the .cfg file becomes the source of truth, state.json becomes a cache

Inverts story 022 decision 8 for the canonical file only: explicit Save replaces
write-on-every-keystroke, a re-read-before-write gate keyed on the file's real on-disk
bytes (not just a dirty flag) refuses to clobber an unread hand-edit, external edits are
adopted or surfaced as a two-pane conflict depending on whether the profile is dirty, a
deleted or corrupt state.json record rebuilds from its file with the same id, and
existing profiles migrate to the current file format once on first run. Closes three
real defects an adversarial cross-cutting pass found beyond the per-deliverable tests:
a hand-edit-clobber race through assign/setDefault/rename-cascade/the startup retry
sweep, refreshFromFiles resolving a profile's file by stale name instead of ownership
sentinel, and a corrupt/binary file being silently adopted over the last good cache
instead of reported as unparseable.
```
