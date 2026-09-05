---
id: 051
title: The file header is a small banner, not a technical block
status: draft
created: 2026-09-05
---

## Requirement

The first thing a player sees when opening their own `.cfg` is the launcher's header, and today it
reads like a debug dump:

```
// q2-launcher profile 3f9c2a1e-fd01-4353-81c9-3e6961d5ac72 - hand-edited changes are read back
// =============================================================================
//  My Profile [q2l v=1]
//  Q2 Launcher - hand-edited changes to this file are read back
// =============================================================================
```

An opaque id, the same sentence twice (once in the sentinel line, once as the banner's second
line), a machine tag in the title line, two full-width rules - five lines, and not one of them is
for the player. My own configs open with a name card, not a manifest.

What I want: a small, non-technical, cosmetic header. The profile name, framed so it looks good in
a text editor, and nothing that has to be explained. Whatever the launcher itself needs to
recognise its own file must still be there, but compact, in one place, and never as prose. If it
looks cool for the player, it is right.

**Today** (facts, not solution):

- `src/shared/config/render.ts:1243-1258` prepends `sentinelLine(profile.id)` (`:1101-1103`,
  marker `:1089`) and then `buildHeaderBlock` (`:921-927`): two `=` rules, the name with
  `[q2l v=1]`, and `HAND_EDIT_SENTENCE` (`:38-39`) - the sentence the sentinel already carries.
- Readers that depend on the header: ownership by the literal first line
  (`main/modules/config/writer.ts:237-239`, `canonical.ts:101-134` feeding rebuild-on-missing-record,
  `cleanup.ts:132-133`, the open-in-editor guard `main/modules/config/index.ts:1353-1355`); the `v`
  field (`profile-restore.ts:680-693`, tolerant - missing is a warning); the display name recovered
  as "the line after the first `=` rule" (`rebuild.ts:83-118`); `HAND_EDIT_SENTENCE` used verbatim
  as a guard (`rebuild.ts:116`) and to swallow the decoration lines so they are not listed as
  unrecognised (`profile-restore.ts:602-633`).
- Story 040 decided: no timestamp (byte-identical determinism), plain ASCII only (latin-1 round
  trip). Story 043 made the sentinel id the profile's identity (a renamed file is still found by
  it; rebuild keeps installation assignments through it).

## Acceptance Criteria

- [ ] The header contains no profile id in prose and no sentence that appears twice.
- [ ] The header is at most four lines including its frame; the profile name is the visually
      dominant element; every word in it is written for the player - no "hand-edited", no
      "metadata", no "version", no "generated".
- [ ] Everything the launcher needs to recognise its own file - ownership (the profile id) and the
      format version - travels in exactly one compact `[q2l ...]` tag on one header line; that tag
      is the only technical thing in the header.
- [ ] Ownership detection, rebuild-from-file (name and id recovered), the overwrite/delete/
      open-in-editor guards, external-edit detection and the import's "this is a launcher file"
      recognition all keep working against the new header - proven by tests that render the new
      shape and read it back through the real pipeline, not by a diff read (carry-over rule).
- [ ] The header lines never show up as unrecognised/preserved lines on import or reload.
- [ ] Story 042's round-trip property still holds (render -> parse -> restore -> render is
      byte-identical) across the whole fixture corpus.
- [ ] A file carrying the previous header shape (as written by the S10 build) is still recognised as
      launcher-owned and is rewritten in the new shape on its next save - no profile on a dev
      machine goes missing or is reported as "changed outside the launcher" because of this story.
- [ ] Rendering stays deterministic and latin-1 safe (no timestamp, nothing outside ASCII in the
      frame).
- [ ] The Raw file tab and the write-preview dialog show the new header with syntax highlighting
      intact; `docs/systems/profile-file-format.md` describes the header block.

## Open Questions

1. **Does the id stay in the file at all?** Without it a renamed file cannot be matched to its
   record and a rebuild-from-file loses every installation assignment (story 043). Options: (a) keep
   it, but only inside the compact tag (`[q2l v=1 id=...]`), never as prose; (b) drop it and accept
   that rebuild matches by file name only. Recommendation: (a).
2. **Look of the banner:** (a) one fixed launcher look (a name card); (b) it follows the profile's
   section header style (dashes / brackets / plain); (c) its own selectable style next to the
   section style. Recommendation: (b) - one style setting for the whole file, no new control.
3. **A tagline under the name:** none, or one short non-technical line (e.g. "made with Q2
   Launcher")? Recommendation: none - the name and its frame are the header.
4. **Where the tag sits:** on the name line (`//  My Profile [q2l v=1 id=...]`) or on its own, last
   header line. Recommendation: on the name line - one line the reader anchors on for name, id and
   version; the frame stays pure decoration.
5. **Old header compatibility:** the reader accepts both shapes for good, or a one-time startup
   rewrite like story 043's `configFileSourceMigratedAt` sweep. Recommendation: accept both on read
   during this pre-release phase and rewrite on the next save - no new migration machinery.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
