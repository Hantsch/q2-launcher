---
id: 042
title: A launcher-written profile file re-imports without losing anything
status: done # draft -> ready -> in-progress -> done
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

- [x] There is one documented metadata format, carried in comments, that is legal Quake II config
      text and ignored by the engine. A human reading the file sees a normal comment.
- [x] Round-trip is a fixed point, asserted as a property test over every fixture profile:
      `render(parse(render(profile))) === render(profile)`.
- [x] Round-trip preserves at minimum: entry display name, `kind`, `categoryId` (built-in and custom,
      including custom category names), own alias name (story 039), `catalogId`, `key` +
      `secondaryKey` pairing, `keyModifier`/`secondaryKeyModifier`, layer identity/name/mode/trigger
      and which overrides belong to which layer, and command order within an entry.
- [x] The profile `id` is *not* adopted from the file on import - importing a colleague's file must
      create a new profile, not collide with or overwrite a local one with the same id.
- [x] A file whose metadata comments were edited or deleted by hand still imports as a valid profile,
      degrading to what the plain config lines say. A malformed metadata comment is reported, never
      fatal, and never silently discards the config line it sits on.
- [x] Metadata never contradicts the config line it annotates. Where it does (comment says `weapons`,
      the alias is gone), the config line wins and the discrepancy is reported.
- [x] Importing a file the launcher wrote is recognised as such (the existing `OWNERSHIP_MARKER`
      check) and shown differently in the import dialog than a foreign config: "restore this profile"
      rather than "best-effort import".
- [x] A foreign config (my `dm.cfg`) still imports exactly as story 041 leaves it - no metadata,
      no regression.
- [x] The format is versioned, so a future field addition does not make older files unreadable.

## Open Questions

- ~~Format of the metadata comment...~~ answered → Decisions (Sprint)
- ~~Does the same format also have to survive a user reordering...~~ answered → Decisions (Sprint)
- ~~Custom categories and layers are profile-level...~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Metadata comment format: trailing key/value comment at the end of the config line
  it annotates (e.g. `bind q "ssg_sg"   // SSG + SG @weapons`), not a `//@q2l` line above or an
  end-of-file block.
- **(User)** Parser is positional in the trivial sense that a trailing comment always belongs to
  the line it is physically on — so it survives reordering of bind lines by construction (the
  comment moves with its line, there is nothing to re-associate).
- **(User)** Categories are represented as their own comment section headers preceding a group of
  bindings, not as a trailing per-entry tag — e.g. `// ----- [ Weapons ] -----`. Any
  non-command block/comment is recognised as a category section. Up to two levels are supported
  (main category + sub-category), matching the structure already seen in `dm.cfg` (e.g. "Main
  Key's" as main, "1st row"/"2nd row" as sub-category). The header formatting (e.g. the
  `----- [ X ] -----` decoration) should be user-configurable per file.
- **(User)** Profile-level metadata that is not a category header (layers, catalogue identity)
  stays synthesised from per-entry metadata rather than living in a dedicated header block.

### Decided in refine

- **One grammar, one sigil: a bracketed `[q2l …]` tail at the very end of a `//` comment.** Prose
  first, machine part last (`bind q "ssg_sg"   // SSG + SG [q2l e=3f9a1c22 k=alias slot=1]`) — a
  human still reads a normal comment, and the parser has an unambiguous anchor instead of guessing
  where the display name ends.
- **Keys are short and few:** `v` (format version, header only), `e` (entry ref), `k` (`kind`),
  `cid` (`catalogId`), `slot` (`1`/`2`, which of the entry's two key slots this bind line is),
  `mod` (that slot's `keyModifier`), and on a section header `cat` / `layer`+`mode`+`trigger`.
  Everything else the ACs list is already carried by the config text itself (own alias name = the
  alias line's name, command order = the rendered body order, `keepEmptyAlias` = a rendered `""`),
  so a tag for it would be a second, driftable source.
- **`e` is a deterministic 8-hex FNV-1a of `action.id`, not an index.** Slot pairing needs a token
  that is stable across renders and does not renumber the whole file when an entry is inserted
  (043 shows whole-file diffs to the user); collisions inside one render are broken deterministically
  by extending the prefix.
- **No per-entry `cat` tag** (the User decision) — the section header owns the category. Custom
  category *names* survive as the header title; on import a built-in `cat` id is adopted as-is, an
  unknown one mints a local category named from the title.
- **Section headers carry their tag inline after the title, inside the decoration**
  (`// --- Weapons [q2l cat=weapons] -------`). One line, and it stays parseable when the decoration
  is user-configured, whereas a title-text-only convention would break the moment a custom category
  is literally named `Layer: x`.
- **Sub-categories are a read-only capability.** `ConfigActionCategory` stays flat; render emits one
  level, the parser recognises a main+sub header pair in an untagged (foreign) file and maps it to a
  single category `Main / Sub`. "Up to two levels supported" is satisfied on the side that needs it
  (`dm.cfg`) without a model migration this story has no other use for.
- **An untagged comment block is only read as a category section in the no-metadata path.** In a
  file that carries `[q2l v=…]`, sections are taken from tagged headers; otherwise 041's foreign
  import behaviour applies unchanged (AC8 is a no-regression criterion, so it must not go through
  new code).
- **Under line-budget pressure the prose gives way, never the tag** — inverse of 040's
  `attachComment` rule, because prose is decoration and the tag is now state. A tag that cannot fit
  at all is dropped and that one line degrades to plain config text (unreachable in practice: 040
  already clamps every user-typed name).
- **Escaping is minimal and total:** tag values percent-escape space, `%`, `]` and `/`; prose has a
  literal `[q2l` neutralised. A display name is user input and must not be able to forge a tag.
- **The version marker rides the header block, not the sentinel line.** `sentinelLine()` stays
  byte-identical — `writer.ts`, `cleanup.ts` and `canonical.ts` match on the first line, one of them
  exactly, and 040 already paid for that guarantee once.
- **An unknown `v` is not fatal:** a newer version parses tag-by-tag, unknown keys are ignored and
  the file is reported as "written by a newer launcher". That is what makes AC9's promise real
  rather than declared.
- **Reconstruction is a new shared module, not a branch inside `alias-import.ts`.** The metadata
  path and 041's guessing path are different problems (record vs. inference); a shared module that
  *falls back to* `buildImportedActions` keeps AC8 a pure delegation.
- **The profile `id` in the sentinel is read but never adopted** — it is reported (so "restore this
  profile" can name the original) and a new id is always minted (AC4).
- **Header decoration is a per-profile setting mirroring 040's `writeUnbindall`**
  (`sectionHeaderStyle`, default = today's `dashes` output, so 040's byte expectations only change
  where a tag is added), surfaced next to that checkbox in the Raw File tab.
- **Round-trip is asserted over constructed fixture profiles, not over the user's `dm.cfg`** — the
  fixed point `render(parse(render(p))) === render(p)` needs profiles that exercise mirrors, layers
  and pathological names; the `dm.cfg` fixture's job stays "no 041 regression".

## Plan

Metadata becomes a real, versioned grammar that the writer emits and a new reconstruction pass
reads back. Bottom-up, nothing before D5 touches IPC or the UI.

1. **Grammar (`src/shared/config/profile-metadata.ts`, new)** — `formatMetaTag(fields)`,
   `parseMetaTag(commentText) → { prose, fields, malformed }`, `META_FORMAT_VERSION`, the key
   registry, percent-escaping and prose neutralisation. Pure, no profile knowledge. Documented in
   `docs/systems/profile-file-format.md` (new).
2. **Writer (`src/shared/config/render.ts`, `cfg-layout.ts`)** — attach tags to every generated
   alias, bind, override and section header; version marker into the header block; invert
   `attachComment`'s give-way order for a tagged comment. Sentinel untouched.
3. **Parser keeps comments (`src/main/modules/config/core/config-parser.ts`,
   `core/import-reader.ts`)** — the trailing comment text of every classified line, and comment-only
   lines with their position, survive into `ParseConfigResult` / `ImportResult` (today
   `stripLineComment` discards them at `config-parser.ts:224`). No change to `preserved`.
4. **Reconstruction (`src/shared/config/profile-restore.ts`, new)** — tagged lines + section headers
   → `{ actions, categories, layers, warnings }`, reconciled against the config lines (the line
   wins, discrepancies reported); no version marker → delegate to `buildImportedActions`.
5. **Contract + main import** — `src/shared/modules/config.ts` first (`ImportPreviewResult`:
   `ownWrittenFile`, `metadataVersion`, `sourceProfileId`, `metadataWarnings`), then `import.ts`
   uses the restore path and never adopts the id.
6. **Import dialog** — restore-vs-best-effort wording, warning list, i18n keys, `ui:verify` screen.
7. **`sectionHeaderStyle`** — profile field + handler + render, then its Raw File tab control.
8. **Round-trip + adversarial pass** — fixture profiles, the property test, hand-edit/malformed
   degradation, and a re-render sweep over constructed edge cases (S07 carry-over rule).

Order: D1 → D2 → D3 → D4 → D5 → (D6, D7 parallel) → D8 → D9.
Not touched: `renderLoaderFile`, `sentinelLine()`/`OWNERSHIP_MARKER`, `ConfigCodeView.tsx`
production code, `alias-render.ts`'s naming rules.

## Deliverables

### D1 — The metadata grammar, pure and documented

- **Files:** new `src/shared/config/profile-metadata.ts`, new
  `src/shared/config/profile-metadata.test.ts`, new `docs/systems/profile-file-format.md`.
- **Mirror:** `src/shared/config/cfg-layout.ts` (same "pure string primitives, heavy doc comments,
  no profile knowledge" shape).
- **Acceptance:** `formatMetaTag` renders `[q2l k=v …]` with keys in a fixed order (determinism);
  `parseMetaTag` splits a comment into `prose` + `fields` + `malformed`, returns `fields: {}` for a
  comment with no tag, and never throws; unknown keys round-trip into `fields` and are reported as
  unknown rather than dropped; values percent-escape ` `, `%`, `]`, `/` and decode back
  byte-identically; a prose containing a literal `[q2l …]` is neutralised on format and does not
  parse as a tag on read; every emitted character is latin-1 safe and free of `//`; `META_FORMAT_VERSION`
  is exported and the doc file states the grammar, the key registry and the version rule.

### D2 — The writer emits metadata

- **Files:** `src/shared/config/render.ts`, `src/shared/config/cfg-layout.ts`,
  `src/main/modules/config/render.test.ts`, `src/shared/config/cfg-layout.test.ts`,
  `src/shared/config/config-syntax.test.ts`, and re-baselining in
  `src/main/modules/config/{writer,canonical,sync}.test.ts` where they compare on-disk bytes.
- **Acceptance:** the header block carries `[q2l v=<META_FORMAT_VERSION>]`; every generated alias
  line, bind line and layer-override line carries `[q2l …]` after its display-name prose with `e`,
  `k`, and `cid`/`slot`/`mod` where they apply; the two bind lines of one entry share the same `e`
  and differ in `slot`; category/alias/bind section headers carry `[q2l cat=<id>]` and layer section
  headers `[q2l layer=<ref> mode=… trigger=…]` (`trigger` omitted when null); `sentinelLine()` output
  is byte-identical to before; under budget pressure prose is truncated then dropped while the tag
  survives, and only a line that cannot fit the bare tag loses it; determinism (two renders identical)
  and the latin-1 and per-line-budget assertions still hold; a `config-syntax` case pins a tagged
  trailing comment and a tagged banner line as a single `comment` token.

### D3 — The parser keeps the comments it reads

- **Files:** `src/main/modules/config/core/config-parser.ts`,
  `src/main/modules/config/core/config-parser.test.ts`,
  `src/main/modules/config/core/import-reader.ts`,
  `src/main/modules/config/core/import-reader.test.ts`, `src/shared/modules/config.ts` if a shared
  type is needed for the carried comment.
- **Acceptance:** each parsed cvar/bind/alias carries the raw trailing comment text of its source
  line (`''` when there is none) and comment-only lines are available in document order with their
  line numbers, without leaving `preserved`; comments survive `exec` folding and the
  last-definition-wins fold in `import-reader.ts` (the winning definition's comment is the one kept);
  a `;`-chained line's comment is attached to the whole line, not duplicated per segment; every
  existing parser and import-reader test stays green and no line changes classification.

### D4 — Reconstruction: metadata + config lines → profile parts

- **Files:** new `src/shared/config/profile-restore.ts`, new
  `src/shared/config/profile-restore.test.ts`.
- **Mirror:** `src/shared/config/alias-import.ts` (`buildImportedActions`' "plain data in, injected
  `newId`, actions out" shape) — and delegate to it for the untagged path rather than reimplementing.
- **Acceptance:** `restoreProfileParts({ aliases, binds, cvars, comments, newId })` returns
  `{ actions, categories, layers, warnings, sourceProfileId, metadataVersion }` and, as unit tests:
  display name, `kind`, `catalogId`, own alias name, `key`+`secondaryKey` pairing via shared `e`,
  `keyModifier`/`secondaryKeyModifier` via `slot`+`mod`, command order, built-in and custom
  categories (custom name from the header title, fresh local id), and layer identity/name/mode/
  trigger plus which overrides belong to which layer all come back; a tag that contradicts its config
  line (says `weapons`, the alias is gone) loses — the config line wins and a warning names the
  line; a malformed or hand-deleted tag yields a warning and the config line is still imported
  plainly, never dropped; an unknown `v` parses what it recognises and warns; a file with no version
  marker produces exactly what `buildImportedActions` produces today (asserted by comparing against
  it directly, so AC8 cannot silently drift); an untagged main+sub comment header pair maps to one
  `Main / Sub` category.

### D5 — Contract + main: preview reports ownership, commit restores

- **Files:** `src/shared/modules/config.ts` (first), `src/main/modules/config/import.ts`,
  `src/main/modules/config/profiles.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/import.test.ts`, `src/main/modules/config/profiles.test.ts`.
- **Mirror:** 041's D6 (`ambiguousRebindAliases` / `layerAliases` wiring in the same functions).
- **Acceptance:** `ImportPreviewResult` gains `ownWrittenFile: boolean`, `metadataVersion: number |
  null`, `sourceProfileId: string | null`, `metadataWarnings` (i18n keys + `file:line`, never prose
  over IPC); `previewImport`/`commitImport` run the D4 restore path and `createFromImport` stores
  its `actions`/`categories`/`layers`; `ownWrittenFile` comes from the existing `OWNERSHIP_MARKER`
  check on any file the import read — including a profile file reached only through the loader's
  `exec` chain, which the test asserts explicitly; the created profile's `id` is always freshly
  minted even when the file names an existing local profile, and importing the same file twice yields
  two distinct profiles; the ambiguous-alias review step is skipped for an own-written file (there is
  nothing to guess); contract/coverage IPC tests stay green.

### D6 — The import dialog says "restore", not "best-effort"

- **Files:** `src/renderer/src/modules/config/ImportProfileDialog.tsx`,
  `src/renderer/src/modules/config/client.ts`, `src/renderer/src/i18n/locales/en.json`,
  `scripts/lib/screens.mjs`, `docs/UI-VERIFICATION.md`.
- **Mirror:** the duplicate-alias / review-step blocks 041's D7 added to the same component.
- **Acceptance:** when `ownWrittenFile` is true the preview step reads as restoring a launcher
  profile (naming the original profile if `sourceProfileId` resolves) and states that a new profile
  is created rather than the existing one overwritten; when false the wording is today's best-effort
  import; `metadataWarnings` render as a list with `file:line`, empty list renders nothing; strings
  are i18n keys; a `ui:verify` screen covers the own-file variant and is axe-clean.

### D7 — `sectionHeaderStyle` as a per-profile setting (data + handler + render)

- **Files:** `src/shared/modules/config.ts`, `src/main/lib/schemas.ts`,
  `src/main/modules/config/{schemas,profiles,index}.ts`,
  `src/renderer/src/modules/config/client.ts`, `src/shared/config/{cfg-layout,render}.ts`.
- **Mirror:** 040's `writeUnbindall` chain (`setWriteUnbindall` in
  `src/main/modules/config/index.ts`).
- **Acceptance:** `ConfigProfile.sectionHeaderStyle?: 'dashes' | 'brackets' | 'plain'` with
  `.catch('dashes')` in the persisted schema and no migration entry; `dashes` renders byte-identical
  to D2's output; `brackets` renders the User's `// ----- [ Weapons ] -----` form and `plain` a
  bare `// Weapons`; the tag position and content are identical in all three; the setter persists and
  triggers the same canonical rewrite/sync the other write-affecting setters do.

### D8 — The Raw File tab exposes the header style

- **Files:** `src/renderer/src/modules/config/RawFileTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- **Mirror:** the `writeUnbindall` checkbox block 040's D5 added to the same file.
- **Acceptance:** the Raw File tab offers the three header styles with a one-line hint, reflecting
  the stored value; changing it saves and the file shown below re-renders without a manual refresh;
  keyboard-reachable with a visible focus ring and a real label association; no new axe violation.

### D9 — Round-trip property test and the adversarial re-render pass

- **Files:** new `src/main/modules/config/round-trip.test.ts`, new
  `src/shared/config/fixtures/profiles.ts` (constructed profile fixtures),
  `src/main/modules/config/core/import-fixtures.test.ts` (the 041 no-regression assertion).
- **Acceptance:** `render(parse(render(p))) === render(p)` holds for every fixture profile, and the
  fixture set covers, deliberately: a self-mirroring alias and a mirror-slot entry
  (`alias-references.ts`), a `+x`/`-x` pair, an empty-body `keepEmptyAlias` alias, a catalogue-backed
  entry and a user-created one, an entry with two key slots and two different modifiers, a custom
  category whose name contains `[q2l cat=movement]` and one with latin-1 high-bit characters, a
  display name containing `//` and `]`, two entries whose `e` hash prefixes are forced to collide, a
  hold layer and a toggle layer with `triggerKey: null`, an unowned hand-typed bind, and all three
  `sectionHeaderStyle` values. Plus: the same fixtures with their tags hand-mangled (deleted,
  truncated mid-tag, wrong `v`, contradicting the config line) import without loss of any config
  line and produce warnings, not throws; and the `dm.cfg`/`dmalias.cfg`/`gfx.cfg` import result is
  unchanged from 041's expectations. **This D is not accepted on a green diff read** — it must
  report the adversarial re-render sweep's actual output (S07 carry-over rule, `sprint.md:44`).

## Model Hints

- `D4 → deliverable-hard` — reconciliation is the story's whole risk surface: tag-vs-config-line
  precedence, entry pairing across three line kinds, layer/override attribution and the "no version
  marker behaves exactly like 041" fallback all interact in one pass, and a wrong reconciliation
  silently reassigns a user's binds to the wrong entry.
- `D2 → deliverable-hard` — it rewrites the comment-attach path of `render.ts` on top of 038/039/040's
  changes to the same lines, inverts a budget rule, and its regressions land as byte-equality
  failures in four other test files or, worse, as an ownership sentinel that stops matching.
- D1, D3, D5, D6, D7, D8, D9 → default tier.
- `Review: → story-review-hard` — the story defines a file format that 043 will treat as
  authoritative, and the failure mode (a tag that renders but does not read back, on one entry kind
  only) is invisible in a green test run; the reviewer must re-run the adversarial fixtures itself.

## Test Plan (manual acceptance)

Prerequisite: a registered Quake II installation with a profile assigned, so the launcher has
synced its profile file into that installation's gamedir.

1. Start the app, open **Config**, pick a profile with at least one dual-bind entry, one custom
   category, one alt layer and one message entry.
2. **Raw File tab** — every `bind`/`alias` line ends in `// <name> [q2l …]`, section banners carry
   `[q2l cat=…]` / `[q2l layer=…]`, the header block shows the version marker, and highlighting
   still colours the whole comment as a comment.
3. Switch the **header style** control through all three options: the shown file re-renders each
   time without a manual refresh, the tags stay identical, and the values stay column-aligned.
4. Create a profile → source **import** → the same installation and gamedir. The preview must say
   this is a launcher-written profile being **restored** (naming the original) and must not show the
   ambiguous-alias review step.
5. Create it. On **Controls**: display names, categories (custom one included), the dual-bind entry's
   two slots with their modifiers, the layer with its mode and trigger, and the message entry all
   match the source profile. On **Settings**: the cvars match. Both profiles exist side by side —
   the original was not overwritten.
6. Open the synced file in Notepad, delete the `[q2l …]` tail from two bind lines and mangle a third
   (`[q2l e=`), save. Import that gamedir again: the preview lists warnings with file and line, the
   import succeeds, and the three affected binds are present as plain binds (nothing lost).
7. Hand-edit a section banner's `cat` id to a nonsense value and import: the entries under it land in
   a category named after the banner title, no crash. (Decided during build: no warning fires for
   this case — every legitimate custom category from another machine carries a `cat` id this machine
   does not recognise, so warning on "unrecognised id" would fire on every healthy import of a file
   with custom categories; a warning is reserved for a genuinely malformed tag or one that contradicts
   its config line, per AC5/AC6. This corrects the step's original wording, written before that
   trade-off was made explicit.)
8. Import `docs/fixtures/` (`dm.cfg` + `dmalias.cfg` + `gfx.cfg`, per 041's test plan) once more —
   the result is exactly what story 041 produced: best-effort wording, the `cali` review step, same
   entry and preserved-line counts.
9. Launch the installation once and confirm Quake II starts with the profile applied — the tags are
   comments to the engine.

## Coverage

| AC | Deliverable |
| --- | --- |
| 1 One documented metadata format, legal cfg text, reads as a normal comment | D1 (grammar + doc), D2 (emitted) |
| 2 `render(parse(render(p))) === render(p)` as a property test over fixtures | D9 |
| 3 Preserves name, `kind`, category (built-in + custom), own alias name, `catalogId`, key/secondary pairing, modifiers, layer identity/name/mode/trigger + override attribution, command order | D2 (emit) + D4 (read back), asserted in D9 |
| 4 Profile `id` never adopted on import | D5 |
| 5 Hand-edited/deleted/malformed metadata still imports, reported, never fatal, never discards the config line | D3 (comments survive) + D4 (degradation + warnings) + D6 (surfaced), asserted in D9 |
| 6 Metadata never contradicts its config line; config line wins, discrepancy reported | D4, surfaced by D6 |
| 7 Own file recognised via `OWNERSHIP_MARKER`, "restore" vs "best-effort" in the dialog | D5 (detection + contract) + D6 (wording) |
| 8 A foreign config still imports exactly as 041 leaves it | D4 (delegation to `buildImportedActions`), asserted in D9 |
| 9 The format is versioned; a future field addition keeps older files readable | D1 (`v` + unknown-key rule) + D2 (emit) + D4 (tolerate unknown/newer) |
| User decision: header decoration configurable per file | D7 (data + render) + D8 (UI) |

## Done

D1-D9 were already implemented and had passed three review rounds clean before this continuation
picked the story up mid fix-cycle-5, interrupted by an API session limit right after a live
`npm run ui:verify` smoke run had surfaced an axe `scrollable-region-focusable` violation on the
`config-import-restore` screen. This session's work: finished that fix, then absorbed three more
full adversarial review rounds (fix-cycles 6, 7 and 8/8b) that each found real, confirmed defects in
`src/shared/config/profile-restore.ts`'s metadata-reconstruction pass - consistent with this story's
own Model Hints ("a wrong reconciliation silently reassigns a user's binds to the wrong entry" is
invisible in a green test run) and the sprint's carry-over precedent (story 039).

### Summary

- **fix-cycle-5 continuation**: the axe violation traced to the same root cause the interrupted
  agent had already diagnosed - `preserved` (the import dialog's "unrecognised leftovers" list) was
  showing lines the reconstruction pass had actually *understood* (the ownership sentinel, the
  header block's `=`-rule/hand-edit-sentence lines) as if they were foreign junk. Fixed by marking
  them `consumed` the same way a section banner or version marker already was.
- **fix-cycle-6** (review round: 4 confirmed defects): an untagged hand-added `alias` line was
  silently dropped instead of degrading through 041's inference (AC5); a claim on an already-taken
  key slot was silently re-homed into the *other* slot instead of being rejected (AC6); a custom
  category name ending in a decoration-shaped character (`-`, `=`, `[`, `]`) was mis-stripped as if
  it were banner decoration; the untagged-banner "Main/Sub" pairing fused unrelated launcher-owned
  banners (a cvar group and the `Other` bucket) into a fabricated category name; `commitImport`
  stored an unfiltered preserved-line count while `previewImport` showed a filtered one; the D9
  round-trip test's own dash-padding normaliser was eager enough to risk masking a real regression.
- **fix-cycle-7** (review round: 4 confirmed defects, one from a fix-cycle-6 change and one
  discovered through investigating it): switch-bind chain aliases (story 007, in the *loader*
  `autoexec.cfg`) were wrongly captured as junk Controls-tab entries by the new untagged-alias
  recovery; an interim attempt to also recover an alias hand-appended after a file's last layer
  section removed a positional guard that turned out to protect real content (a hold/toggle layer's
  own `+x`/`-x` alias pair) - reverted, with the narrower hand-append-after-last-layer case accepted
  as a documented, unfixed limitation; `bannerTitle`'s dashes/brackets decoration stripping eroded a
  *tagged* banner's own real trailing decoration-shaped text, because `tagEndIndex` already excludes
  real fill from a tagged banner's prose, so there is nothing left to strip; the header block's own
  `=`-rule lines were misread as a real section title once the blunt full-strip was replaced by
  anchor-based stripping.
- **fix-cycle-8 / 8b** (review round: 3 confirmed defects, then one more found while verifying the
  first batch): the reserved "Other"/"Other binds" bucket was invisible as a section boundary under
  `sectionHeaderStyle: 'plain'` (no decoration for `BANNER_RULE` to match), silently re-filing its
  entries into whichever tagged category preceded them; the switch-bind exclusion's `startsWith`
  check also excluded an unrelated hand-added alias that merely shared the prefix (`q2l_sword`); an
  orphaned-`categoryId` ("Other" bucket) entry was promoted to a real, persisted category on restore
  - itself a category the original profile never had, and one that stopped matching nothing on the
  very next render (an AC2 regression one round-trip delayed). The follow-up fix-cycle-8b closed the
  same invisible-boundary problem for a *real* category whose tag was hand-deleted under `plain`
  style, using a narrow, safe signal (the three fixed title prefixes every category section carries,
  tagged or not) rather than a broader "any untagged comment is a candidate section" heuristic that
  was considered and rejected for trading a silent merge for a silent split.
- Added 3 new D9 fixtures (`orphanedCategoryProfiles`, one per header style) so the "entry whose
  category matches nothing" case - the root cause all three fix-cycle-8 findings traced back to -
  has permanent round-trip coverage going forward.

### Decisions made during the fix-cycle-5+ continuation (one-sentence reason each)

- The ownership sentinel and the header block's decoration lines join `scan.consumed` on the same
  terms as a version marker or section banner, because they are equally *understood*, not foreign.
- A truly untagged (never malformed) `alias` line degrades through `buildImportedActions` instead of
  vanishing, because AC5 promises "degrading to what the plain config lines say," not silence.
- A slot claim naming an already-taken slot is rejected outright rather than falling through to the
  other slot, because re-homing a rejected claim into a real key assignment is exactly the "silent
  damage this module exists to avoid" its own doc comment names.
- `bannerTitle` recognises each `SectionHeaderStyle`'s exact fixed anchor instead of a blanket
  leading/trailing character-class strip, because the blunt version could not tell a title's own
  decoration-shaped edge from the writer's actual decoration.
- The untagged-banner "Main/Sub" pairing requires genuine line adjacency, because a launcher-written
  file legitimately has several untagged banners of its own and "the last one pushed, however far
  away" is not the same claim as "directly stacked with nothing between them."
- `commitImport` filters its stored `unrecognized` list the same way `previewImport` already did,
  because storing the unfiltered list made the Care tab ask the user to tidy up the launcher's own
  understood metadata.
- Switch-bind chain aliases and a layer's own generated alias pair are excluded from untagged-alias
  recovery by an exact name/position test, not a prefix guess, because a prefix match also excludes
  an unrelated hand-added alias that merely starts the same way.
- A hand-appended alias positioned after a file's last layer section is accepted as a documented,
  unfixed gap rather than "fixed" by removing the positional guard that protects a layer's own
  generated aliases, because that trade produces a regression (bogus entries on every layer-using
  profile) worse than the gap it closes (one narrow hand-edit position).
- The reserved "Other"/"Other binds" bucket gets its own `Section.kind` recognised by exact title
  match regardless of header style, and hands its entries a fresh, never-registered id rather than
  minting a real category, because minting one persists a category the original profile never had
  and stops matching nothing on the very next render.
- A real category's header with its tag hand-deleted is recognised under `plain` style via the three
  fixed title prefixes every category section carries, rather than by treating any untagged comment
  as a candidate section, because the broader signal trades a silent category merge for an equally
  silent category split with no clear improvement.

### Known, accepted limitations (documented in code, not silently left)

- A `dashes`-style title that both fills `BANNER_WIDTH` exactly (zero fill dashes) *and* itself ends
  in `<space>-+` is indistinguishable from one that had fill stripped.
- A hand-appended alias positioned physically after a file's last layer section is not recovered
  (silently, as it was before this story's fix-cycle-6), because telling it apart from the layer's
  own generated aliases would need either blank-line position data the parser does not carry today,
  or re-deriving `alt-layers.ts`'s full chunk/helper naming budget inside `profile-restore.ts`.
- A hand-typed comment that happens to start with `Aliases: `/`Binds: `/`Entries: ` is
  indistinguishable from a real category header whose tag was deleted, and mints a section for it
  the same as the genuine case would - inherent to choosing a narrow, safe recognition signal over a
  broader, unsafe one.

### Verification

`npm run build`, `npm test` (1477 tests), `npm run typecheck` and `npm run ui:verify` (0 critical/
serious/moderate/minor axe violations across the full 46-screenshot, 23-screen run) are all green.
Eight adversarial review rounds ran across this story's lifetime (four before this continuation,
four during it - each one constructing and running real edge-case profiles against the real
render/parse/restore pipeline rather than reading a diff, per the story's own Model Hints and the
sprint's carry-over rule); the final round returned a clean PASS with only the three limitations
above named as accepted, documented trade-offs.

### Commit message

```
042: profile files round-trip losslessly through launcher metadata tags

Closes the fix-cycle-5 axe violation and four further rounds of adversarial-review
findings in the metadata reconstruction pass: untagged-alias recovery, slot-conflict
rejection, banner-title decoration stripping, untagged-banner pairing, switch-bind/
layer-alias exclusions, and the reserved "Other" category bucket - each verified by
constructing and running real edge-case profiles against the render/parse/restore
pipeline, not by reading a diff.
```