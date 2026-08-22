---
id: 042
title: A launcher-written profile file re-imports without losing anything
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

`bind q "q2l_a_ssg_sg_9a2f"` is **SSG + SG** in the UI and sits in the **weapons** category. If I
took that file to another machine and imported it, both facts would be gone: the display name, the
category, the entry kind, which layer an override belongs to, which two keys are the same entry's
two slots. The file is what a player keeps and carries; if it cannot carry that, the launcher's own
output is a downgrade of its own state.

This is the prerequisite for story 043 (the file becomes the source of truth): a file cannot be
authoritative for state it does not contain.

Story 040 already puts the display name into a trailing comment per line. This story makes those
comments a **defined, parsed format** and closes the remaining gaps (category, entry kind, own
alias name, layer membership, slot pairing, catalogue identity), so that render -> parse -> render
is a fixed point.

## Acceptance Criteria

- [ ] There is one documented metadata format, carried in comments, that is legal Quake II config
      text and ignored by the engine. A human reading the file sees a normal comment.
- [ ] Round-trip is a fixed point, asserted as a property test over every fixture profile:
      `render(parse(render(profile))) === render(profile)`.
- [ ] Round-trip preserves at minimum: entry display name, `kind`, `categoryId` (built-in and custom,
      including custom category names), own alias name (story 039), `catalogId`, `key` +
      `secondaryKey` pairing, `keyModifier`/`secondaryKeyModifier`, layer identity/name/mode/trigger
      and which overrides belong to which layer, and command order within an entry.
- [ ] The profile `id` is *not* adopted from the file on import - importing a colleague's file must
      create a new profile, not collide with or overwrite a local one with the same id.
- [ ] A file whose metadata comments were edited or deleted by hand still imports as a valid profile,
      degrading to what the plain config lines say. A malformed metadata comment is reported, never
      fatal, and never silently discards the config line it sits on.
- [ ] Metadata never contradicts the config line it annotates. Where it does (comment says `weapons`,
      the alias is gone), the config line wins and the discrepancy is reported.
- [ ] Importing a file the launcher wrote is recognised as such (the existing `OWNERSHIP_MARKER`
      check) and shown differently in the import dialog than a foreign config: "restore this profile"
      rather than "best-effort import".
- [ ] A foreign config (my `dm.cfg`) still imports exactly as story 041 leaves it - no metadata,
      no regression.
- [ ] The format is versioned, so a future field addition does not make older files unreadable.

## Open Questions

- Format of the metadata comment. A trailing key/value comment per line
  (`bind q "ssg_sg"   // SSG + SG @weapons`) reads best but has little room; a `//@q2l ...` line
  above each entry is unambiguous but doubles the line count; a single compact block at the end of
  the file is the least intrusive but is the one thing a hand-editor will delete. Needs a decision
  before anything is built.
- Does the same format also have to survive a user reordering, reformatting or re-indenting the file
  by hand - i.e. is the parser positional, or does every entry carry its own self-contained
  metadata?
- Custom categories and layers are profile-level, not per-line. Header block, or synthesised from
  the per-entry metadata?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
