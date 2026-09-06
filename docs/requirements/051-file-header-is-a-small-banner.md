---
id: 051
title: The file header is a small banner, not a technical block
status: ready
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

~~1. **Does the id stay in the file at all?**~~ answered → Decisions (Sprint)
~~2. **Look of the banner?**~~ answered → Decisions (Sprint)
~~3. **A tagline under the name?**~~ answered → Decisions (Sprint)
~~4. **Where the tag sits?**~~ answered → Decisions (Sprint)
~~5. **Old header compatibility?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Does the id stay in the file at all: keep it, in the compact tag — and the tag itself
  should be made to look nice/deliberate, not a raw technical dump; it is not prose either way.
- **(User)** Look of the banner: one fixed launcher look (a name card), not tied to the profile's
  own section header style.
- **(User)** A tagline under the name: none.
- **(User)** Where the tag sits: on its own, last header line - not on the name line.
- **(User)** Old header compatibility: accept both shapes on read, rewrite to the new shape on the
  next save.

- **Header shape** is four lines - `=` rule, name, `=` rule, and the tag alone on the last line,
  right-aligned to `BANNER_WIDTH` (80) so it reads as a small stamp under the card instead of a
  dumped line; the name is the only prose and the only thing inside the frame:
  ```
  // ==============================================================================
  //  My Profile
  // ==============================================================================
  //                              [q2l v=1 id=3f9c2a1e-fd01-4353-81c9-3e6961d5ac72]
  ```
  Reason: the user's decision puts the tag on its own *last* header line, and right-alignment is the
  cheapest way to make it look deliberate without inventing a second decoration vocabulary.
- **Ownership travels as a new `id` key in the existing `[q2l …]` grammar** (registered in
  `KNOWN_META_KEYS`), not as a second literal format. Reason: one tag parser already exists and is
  tested; a parallel format would be a second thing every reader has to know.
- **`META_FORMAT_VERSION` stays 1**; old and new shape are told apart by whether the `v` line also
  carries `id`. Reason: story 050's reasoning still holds (pre-release, nothing to migrate), and the
  discriminator is free.
- **The loader `autoexec.cfg` keeps `sentinelLine()` unchanged.** Reason: it is a two-line generated
  stub, not the player's own config, and its sentinel is exactly what keeps a loader from outvoting
  the profile file in `scanComments`' "same file as the version marker wins" rule.
- **One shared dual-shape parser** - new `src/shared/config/file-ownership.ts`; `writer.ts`,
  `cleanup.ts`, `canonical.ts`, `index.ts`, `rebuild.ts` stop matching the literal themselves.
  Reason: the marker check is triplicated today, and each copy is one more place the new shape can
  be silently missed - the failure mode AC7 is written against.
- **Ownership detection scans the first 8 lines**, not just line 1 (same bound `rebuild.ts` already
  uses as `HEADER_SCAN_LINES`). Reason: the id is no longer on line 1 of a profile file.
- **`consumeHeaderDecoration` gains a backward branch** (rule/name/rule at `versionIndex −1/−2/−3`)
  and keeps the existing forward branch for the legacy block. Reason: the tag moved from the middle
  of the block to its end. Confirmed safe: an untagged name line between `=` rules is *not* picked up
  by story 053's section heuristics (`decorationWrap`/`mirroredWrapTitle` exclude `-`/`=`;
  `bannerTitle`'s `PURE_DECORATION` empties a rule's title), so consumption is only about AC5, not
  about phantom sections.
- **The name line is emitted `trimEnd()`ed.** Reason: with no tag beside it any more, an empty or
  whitespace-only name would write `//  ` - a trailing-whitespace line, and a risk to the
  byte-identical fixed point.
- **`HAND_EDIT_SENTENCE` stays exported but is never written again** - legacy-read constant only.
  Reason: the old block still has to be swallowed and its name line still has to be told apart from
  the sentence.
- **`scripts/lib/fixture.mjs`'s hand-written `q2l-restore-fixture/config.cfg` stays in the OLD
  shape.** Reason: it is the only checked-in literal header in the repo and it becomes the live-smoke
  probe for AC7 instead of needing an update.
- **No change to `config-syntax.ts`.** Reason: the highlighter emits one flat `comment` token from
  the first unquoted `//` to end of line - it never looked at the sentinel, the rules or the tag - so
  AC9's highlighting half needs a regression test, not new code.

## Plan

The id leaves prose and moves into the tag; the sentinel line disappears from the *profile* file
(the loader keeps it). That makes "is this file ours" a header scan instead of a line-1 prefix test,
which is where the whole risk of this story sits.

1. **Tag grammar** (`shared/config/profile-metadata.ts`): register `id` in `KNOWN_META_KEYS` /
   `MetaTagFields`, ordered right after `v`, so the header tag renders `[q2l v=1 id=…]`.
2. **Ownership module** (new `shared/config/file-ownership.ts`): `readOwnershipStamp(text)` scans the
   first 8 lines and returns `{ id, version, shape: 'banner' | 'sentinel' }` for both shapes -
   banner = a comment line whose tag carries `id`; sentinel = `OWNERSHIP_MARKER` + first whitespace
   token (today's `ownedProfileId` semantics, unchanged). `isLauncherOwnedFile(text)` on top of it.
3. **Writer** (`shared/config/render.ts`): `buildHeaderBlock` = `banner([bannerText(name).trimEnd()],
   { fill: '=' })` plus the right-aligned tag line; `renderProfileFile` no longer prepends
   `sentinelLine`. `renderLoaderFile` untouched. `HAND_EDIT_SENTENCE` no longer rendered.
4. **Main-side readers** (`writer.ts`, `cleanup.ts`, `canonical.ts`, `index.ts`): `ownedProfileId`
   becomes a thin wrapper over the module; the two bare `startsWith(OWNERSHIP_MARKER)` guards in
   `writer.ts` (158, 371) and the one in `cleanup.ts` (133) become `isLauncherOwnedFile` - these
   three are the ones that would otherwise treat every new-shape profile file as foreign.
5. **Rebuild** (`rebuild.ts`): id via the module; `recoverProfileName` learns the new shape (the line
   after the first rule, no tag to strip) and keeps the legacy path incl. the `HAND_EDIT_SENTENCE`
   guard.
6. **Restore reader** (`shared/config/profile-restore.ts`): a `v` line that also carries `id` pushes
   `{ id, file }` into `sentinels` (so `sourceProfileId` / `import.ts`'s `ownWrittenFile` keep
   working with no sentinel line present); `consumeHeaderDecoration` consumes backward for that
   shape, forward for the legacy one.
7. **Round trip + adversarial** (`fixtures/profiles.ts`, `round-trip.test.ts`,
   `render-invariants.test.ts`): re-run story 042's property over the whole corpus, plus hand-edit
   variants (tag line deleted, id removed, rules removed, name renamed, a profile *named* `[q2l
   id=…]`, a whole legacy-shape file).
8. **Docs** (`docs/systems/profile-file-format.md`) + one `config-syntax` regression test.

Not touched: the loader, section headers (`titledSection`), per-entry tags, the cvar/bind/layer
bodies, `META_FORMAT_VERSION`.

## Deliverables

**D1 - `id` in the tag grammar + the ownership module.** Register `id` in `KNOWN_META_KEYS` /
`MetaTagFields` (directly after `v`, with a registry doc entry in the file's existing style). New
`src/shared/config/file-ownership.ts` exporting `readOwnershipStamp(text: string)` and
`isLauncherOwnedFile(text: string)`, both accepting **banner** (tag with `id` within the first 8
lines) and **sentinel** (legacy line-1 marker) shapes; `HEADER_SCAN_LINES = 8`. Files:
`src/shared/config/profile-metadata.ts` (+ test), `src/shared/config/file-ownership.ts` (+ new test).
Mirror for module shape and doc style: `src/shared/config/action-slots.ts`.
*Accepted when:* both shapes yield the same `{ id }` for the same profile, an id-less or malformed
stamp returns `null` (never a guess), a foreign `.cfg` (`docs/fixtures/dm.cfg`) returns `null`, and a
`[q2l id=…]` appearing *after* line 8 is not treated as ownership.

**D2 - The writer emits the banner.** `buildHeaderBlock` → four lines (rule / `//  <name>` trimmed /
rule / right-aligned `[q2l v=1 id=<profile.id>]`, falling back to `//  <tag>` when the tag alone
exceeds `BANNER_WIDTH - 3`); `renderProfileFile` drops the `sentinelLine` prefix;
`HAND_EDIT_SENTENCE` kept as an export but unreferenced by any render path. `renderLoaderFile`
byte-identical to today. Files: `src/shared/config/render.ts`, `src/main/modules/config/render.test.ts`.
*Accepted when:* the rendered file starts with exactly those four lines, contains the profile id
exactly once and only inside the tag, contains none of the words "hand-edited", "metadata",
"version", "generated", is pure ASCII in the frame, renders byte-identically twice in a row, and a
profile named `[q2l id=x]` renders `(q2l id=x` on the name line (`neutralizeProse`).

**D3 - Main-side ownership readers onto the module.** `ownedProfileId` in `writer.ts` delegates to
`readOwnershipStamp` (keeping its signature where callers pass a first line, plus a whole-text
entry point); `writer.ts:158` / `writer.ts:371` / `cleanup.ts:133` use `isLauncherOwnedFile`;
`canonical.ts` and `index.ts:1353` pass full content instead of `split('\n', 1)[0]`. Files:
`src/main/modules/config/{writer,cleanup,canonical,index}.ts` + `writer.test.ts`, `cleanup.test.ts`,
`canonical.test.ts`.
*Accepted when:* a new-shape profile file is recognised as owned by every one of these paths (no
backup-once on overwrite, skipped by cleanup, found by `findOwnCanonicalFile`, open-in-editor
allowed), a legacy-shape file still is, and a foreign `config.cfg` still is not.

**D4 - Rebuild recovers name and id from both shapes.** `rebuild.ts`: ownership/id via
`readOwnershipStamp`; `recoverProfileName` returns the line after the first `=` rule for the new
shape (nothing to strip) and keeps the legacy tag-strip + `HAND_EDIT_SENTENCE` guard. Files:
`src/main/modules/config/rebuild.ts`, `rebuild.test.ts`.
*Accepted when:* a new-shape file with no store record rebuilds a profile with the right name **and**
the id from the tag (so story 043's installation assignments survive), and a legacy-shape file does
exactly what it does today.

**D5 - The restore reader.** `profile-restore.ts`: a `v` line carrying `id` contributes
`{ id, file }` to `sentinels` and is consumed; `consumeHeaderDecoration` consumes the three lines
*before* it for the banner shape and keeps the forward legacy branch; `SENTINEL_TEXT` path unchanged
for the loader and legacy files. Files: `src/shared/config/profile-restore.ts`,
`profile-restore.test.ts`.
*Accepted when:* importing a new-shape file yields `sourceProfileId === profile.id` (→ `import.ts`'s
`ownWrittenFile`), none of the four header lines appears in `preserved`, a profile file plus its
loader still resolve to the profile's own id, and a hand-mangled header (one rule deleted) leaves the
remaining lines in `preserved` without crashing or inventing a section.

**D6 - Round trip and adversarial re-render (carry-over rule).** Re-run story 042's property over the
whole corpus and add fixtures/variants: legacy-shape file, tag line deleted, `id=` removed from the
tag, both rules deleted, name line hand-renamed, empty profile name, a profile named `[q2l id=…]`,
and a file where a *body* comment also carries `id=`. Every case goes through the real
render → write → `readImportableConfig` → `restoreProfileParts` → re-render path (`restoreFromText`),
never a diff read. Files: `src/shared/config/fixtures/profiles.ts`,
`src/main/modules/config/round-trip.test.ts`, `src/shared/config/render-invariants.test.ts`.
*Accepted when:* render → parse → restore → render is byte-identical for every fixture,
`expectEveryLineSurvivesRerender` holds for every adversarial variant, and a legacy-shape file
re-renders into the *new* shape while keeping its id and name.

**D7 - Docs, highlighting check, fixture note.** `docs/systems/profile-file-format.md`: a "Header
block" description (the four lines, the `id` key in the registry, the version rule, and the legacy
shape named as read-only), plus `docs/systems/config-module.md` wherever it describes the sentinel as
line 1. One regression test in `src/shared/config/config-syntax.test.ts` that the four header lines
tokenize as `comment`. A comment in `scripts/lib/fixture.mjs` recording that
`FIXTURE_RESTORE_CONFIG_CFG` is deliberately left in the legacy shape.
*Accepted when:* no doc in `docs/systems/` describes the sentinel as the profile file's first line as
if that were current, and the highlighting test passes.

## Model Hints

- D5 → `deliverable-hard` - `scanComments` is a 200-line pass with story 053's section heuristics
  woven through it, and the header block's consumption direction inverts; getting it wrong either
  lists header lines as unrecognised or steals a real section header.
- D6 → `deliverable-hard` - this is the story's regression gate against constructed hand-edits, and
  the sprint's carry-over rule names the adversarial re-render pass and the round-trip re-run for
  exactly this story.
- D1, D2, D3, D4, D7 → default (each is mechanical with its own local acceptance; D1 and D2 are
  fully specified above, D3/D4 are delegation to D1's module).
- Review: → `story-review-hard` - the failure mode is a profile that silently stops being recognised
  as launcher-owned (AC7: "no profile on a dev machine goes missing"), which a cheap review confirms
  away by reading the new tests instead of the paths that were *not* migrated.

## Test Plan (manual acceptance)

1. Config view → any profile → make a small change and **Save**. Open the profile's `.cfg` (Care →
   the installation's path, or the **Raw file** tab). Expected: the file starts with `// ====` rule,
   `//  <profile name>`, `// ====` rule, and a right-aligned `[q2l v=1 id=…]` line - four lines, the
   name the only prose, the id nowhere else in the file.
2. **Raw file** tab: the four header lines are highlighted as comments, exactly like the rest of the
   file's comments; nothing is rendered as an error or as an unrecognised line.
3. Care → **Sync** → **Compare** (write preview): the preview shows the same four lines; after a save
   with no edits the comparison reports no difference (deterministic render).
4. Rename the profile, save, re-open the file: only the name line changed; the tag line is
   byte-identical.
5. **Legacy compatibility.** Close the app. Take a copy of a profile `.cfg` from before this story
   (or hand-write the old five-line header with the same id and name over the current file's header).
   Start the launcher. Expected: the profile is listed as before, its installation assignment is
   intact, and Care does **not** report "changed outside the launcher" as an unknown/foreign file.
   Save the profile once → the file now carries the new four-line header, same id.
6. Hand-edit the file: delete the tag line entirely, then Care → **Sync** → **Reload**. Expected: the
   remaining header lines are listed as unrecognised (that is correct), no crash, no lost config line.
7. `npm run ui:verify` (P2 live smoke - it also seeds the deliberately legacy-shaped
   `q2l-restore-fixture/config.cfg`, so the old-shape read path is exercised in the real app), plus
   `npm test`, `npm run build`, `npm run typecheck`.

## Coverage gate

| Acceptance criterion | Deliverable |
| --- | --- |
| no id in prose, no doubled sentence | D2 |
| ≤ 4 lines, name dominant, player words only | D2 |
| ownership + version in exactly one compact `[q2l …]` tag | D1, D2 |
| ownership / rebuild / guards / external edit / import recognition keep working, proven through the real pipeline | D3, D4, D5, D6 |
| header lines never listed as unrecognised/preserved | D5, D6 |
| story 042's round-trip property still holds corpus-wide | D6 |
| a previous-shape file is still recognised and rewritten on next save | D1, D3, D4, D5, D6 |
| deterministic and latin-1 safe | D2, D6 |
| Raw file tab + write preview highlight intact; format doc describes the header block | D7 (+ Test Plan 2/3) |

## Done
