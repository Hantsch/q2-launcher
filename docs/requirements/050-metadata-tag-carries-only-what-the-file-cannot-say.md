---
id: 050
title: The metadata tag carries only what the file cannot say itself
status: draft
created: 2026-09-03
---

## Requirement

The `[q2l …]` tag story 042 added to every generated line has grown into noise. A player opening
their own `.cfg` sees this on each bind:

```
bind mouse1 "+attack"   // Attack [q2l e=b8df77ed k=bind cid=movement:attack slot=1]
```

Three of those four fields carry nothing the file does not already say, or nothing anyone needs:

- `e` — an opaque 8-hex ref. Unreadable, unexplainable to the person whose file it is, and only
  there to pair the two lines of a two-key entry.
- `k=bind` — it is a `bind` line. The kind is visible from the line itself, and the reader already
  has a function that derives an entry's kind from its body (`entryKindFor`, story 041).
- `slot=1` — irrelevant. A command may be bound as often as the player likes, and file order
  already says which one comes first. First occurrence is slot 1, the next one slot 2.

What must stay is the part the config syntax genuinely has no place for: the catalogue link, the
display name, category and layer membership, and — for a modified key that has no `bind` line at
all — the anchor's key and modifier.

Goal: the tag shrinks to the non-derivable minimum, and slot identity comes from the order the
lines appear in the file instead of from a field. The file stays lossless in the story-042 sense
(render → parse → restore is still a fixed point), and a file written by the current version still
imports.

## Acceptance Criteria

- [ ] `e`, `k` and `slot` no longer appear in any tag the renderer writes.
- [ ] The bind line above renders as `// Attack [q2l cid=movement:attack]`.
- [ ] An entry's key slots are recovered from file order: the first line claiming a key for that
      entry is slot 1, the second is slot 2.
- [ ] Two `bind` lines running the same command are paired back into one entry with two keys — no
      ref field involved.
- [ ] A modified key slot's anchor line still identifies its entry and still carries its key and
      modifier, without `e`/`slot`.
- [ ] Story 042's round-trip property still holds on the whole fixture corpus: render → parse →
      restore → render is byte-identical.
- [ ] A file written by the *current* (pre-050) format still imports with the same result as
      before — old tags are read, the dropped keys are ignored rather than reported as unknown.
- [ ] `docs/systems/profile-file-format.md` describes the reduced key registry, the order rule and
      the version bump; the removed keys are named as removed, with the reason.

## Open Questions

1. **Anchor identity without `e`.** An anchor line is a comment with no code to read an entry off,
   and `e` is what ties it to its entry today. Options: name the entry by its alias name (`an`,
   already in the registry) — but an anchor may belong to an entry that has no alias line; or key
   the anchor by its own prose display name; or something else. Needs a decision before build.
2. **More than two key slots.** The order rule covers the first two occurrences. What happens to a
   third — dropped, or does the model grow past two slots? Out of scope for this story unless the
   answer is "drop and warn".
3. **Version.** Does this bump `META_FORMAT_VERSION` (reader must accept both shapes), or is the
   old shape simply tolerated forever as "unknown keys we deliberately ignore"?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
