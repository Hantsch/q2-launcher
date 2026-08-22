---
id: 043
title: The .cfg file is the source of truth, state.json becomes a cache
status: draft # draft -> ready -> in-progress -> done
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

- [ ] The canonical `<name>.cfg` is authoritative for profile content. `state.json` holds only what
      the file cannot: profile list membership, installation assignments, played mods, ids, and the
      cache itself.
- [ ] Deleting the cached entry (or a corrupt/absent `state.json` profile record) loses nothing that
      the files on disk still hold - the profile list rebuilds from the files.
- [ ] An external edit to a profile's file is detected while the launcher is open and the UI reflects
      it, with an explicit indication that the file changed underneath - never a silent swap of what
      the user is editing.
- [ ] A file that is unparseable, or that fails to parse into a valid profile, does not take the
      profile down: the last good cached state stays usable and the parse failure is reported with
      the file and line.
- [ ] The launcher never overwrites a hand-edit it has not read. A change made in the UI while the
      file also changed on disk is a **conflict**, surfaced with both versions (story 024's viewer is
      already the diff/preview surface) and resolved by the user, not by timestamp.
- [ ] The per-installation copies stay generated output, not sources - sync (story 022) still flows
      canonical file -> installations, and an edit to an installation copy is reported as out-of-sync
      exactly as today.
- [ ] The header's "generated, do not edit" is replaced by wording that is actually true.
- [ ] Migration: existing profiles keep working. On first run after the update, each profile's file is
      brought to the story-040/042 format from cached state, and the file is authoritative from then
      on. Nothing is deleted; `state.json.bak` and the backup-once contract still apply.
- [ ] Care's sync section and Raw File keep working against the new direction, and the five sync
      states (022 decision 5) still mean what they say.

## Open Questions

- Change detection: a real `fs.watch` on every profile file, or re-read on window focus / tab open /
  before write? A watcher is immediate but noisy on Windows and fires on the launcher's own writes.
- Write cadence: the profile currently auto-writes on edit
  (`src/renderer/src/modules/config/lib/useProfileAutoWrite.ts`). With the file authoritative, does
  every keystroke still hit disk, or does this become an explicit save?
- Conflict granularity - whole file, or per section/entry? Whole file is honest and simple; per-entry
  is what a user would actually want.
- Does the cache stay in `state.json` at all, or move to its own file per profile? Keeping it in
  `state.json` means the migration framework and its schema version keep covering it.
- A profile whose file was deleted outside the launcher: is that a deleted profile, or a profile in
  an error state awaiting a decision?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
