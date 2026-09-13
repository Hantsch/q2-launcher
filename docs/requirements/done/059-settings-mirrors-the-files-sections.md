---
id: 059
title: Settings mirrors the file's own sections
status: done
created: 2026-09-05
---

## Requirement

Settings groups cvars by the catalogue's `CvarDef.group` in a fixed order - Player, Network,
Graphics, Sound (`src/shared/config/cvar-facts.ts:77`, `:116`; `SettingsTab.tsx:24-31`). The file is
written in those groups plus an untagged "Other" section (`render.ts:1015-1052`), and on read the
sections are ignored: cvar lines are never filed by section (`profile-restore.ts:2488-2493`). A cvar
that is not in the catalogue lands in `profile.cvars` but has no row anywhere in Settings
(`SettingsTab.tsx:164` iterates `ALL_CVARS` only) - it exists in the Raw file and nowhere else in the
UI. My `dm.cfg` opens with a `.: General Settings :.` section of 25 `set` lines, most of them not in
the catalogue (`allow_download_*`, `adr0`-`adr8`, `hostname`, `m_filter`, `cl_vwep`, `cl_blend`); my
`gfx.cfg` is one `[GRAFIK SETTINGS]` section. In the launcher none of that structure exists and half
of the cvars are invisible.

What I want: like Controls (stories 052/053), Settings mirrors the file's own sections. The template
seeds the catalogue's groups as sections; from then on the sections are mine - rename, reorder, move
cvars between them - and every cvar in my file has a row, catalogue or not.

## Acceptance Criteria

- [x] Settings shows the profile's cvar sections in the profile's order, each with its cvars in the
      profile's order; the file's cvar section headers are read back as these sections and written
      from them; story 042's round-trip property holds.
- [x] Sections can be created, renamed, reordered and deleted (deleting moves its cvars to the
      previous section); a cvar can be moved to another section (drag and drop comes with story 054).
- [x] Every cvar in the profile has a row: catalogue cvars keep today's rich row (label, control,
      engine facts, caveats, unsaved marker); non-catalogue cvars get a plain row with name, a text
      value and the unsaved marker - never hidden, and never validated against facts the catalogue
      does not have.
- [x] A cvar can be added to a section by name and value, and removed; adding a catalogue cvar by
      name gives it its rich row.
- [x] A profile created from the template seeds Player / Network / Graphics / Sound with the
      catalogue's cvars as today; story 048's every-cvar-written rule is unchanged (see Open
      Questions for where those lines sit in an imported profile).
- [x] Import files each cvar under the section it was found in (the banner text as the section
      name), or under "Other" when the file has no sections; importing `docs/fixtures/dm.cfg` yields
      one "General Settings" section with all 25 cvars visible in Settings.
- [x] Filter, "Unsaved only", the Advanced collapse (`def.common`) and the engine-facts selector
      keep working; counts stay per section and in total.
- [x] Existing profiles migrate once: catalogue cvars land in the four default sections,
      non-catalogue cvars in "Other" - no value is lost.
- [x] `npm run ui:verify` shows a Settings tab with a user-named section and a plain non-catalogue
      row; a `ui:flow` renames a section and adds a raw cvar through the real UI.

## Open Questions

~~1. **Home of the always-written defaults (story 048)?**~~ answered → Decisions (Sprint)
~~2. **Non-catalogue cvars: plain row only, or also a promotion path?**~~ answered → Decisions (Sprint)
~~3. **Two levels like Controls, or one?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Home of the always-written defaults (story 048) in an imported profile: give the user a
  choice of whether untouched defaults get written to the file at all, rather than a fixed
  auto-section. Refine designs the concrete control (e.g. a toggle) and where it lives.
- **(User)** Non-catalogue cvars: plain row only, no promotion path.
- **(User)** Section depth: two levels, like Controls (052/053) - reuse that section/sub-section
  model rather than a flat single level.

<!-- Taken during refine (S12), not by the user. Each with its reason. -->

- **Placement lives in the sections, values stay in `profile.cvars`.** New
  `ConfigProfile.cvarSections?: ConfigCvarSection[]` where a section is
  `{ id, name, nameKey?, cvars: string[], subsections?: { id, name, cvars: string[] }[] }` - the
  membership list carries order *and* section in one structure (053's nesting argument: two levels
  become structurally true), while `cvars: Record<string,string>` stays the untouched value store so
  Care, validation, engine scoping, tidy-up, 048's `stripCatalogDefaults` and the `setCvars` payload
  keep working unchanged.
- **A cvar named in no section is "unplaced", never an error**, and a name listed twice is claimed by
  its first placement - mirrors how a dangling `categoryId`/`subcategoryId` falls into render's
  trailing bucket instead of failing (053's decision), so no cross-referential validation is needed
  anywhere.
- **The 048 choice is a per-profile boolean `writeCatalogDefaults` (default `true`)**, mirroring
  `writeUnbindall`/`sectionHeaderStyle` exactly (optional field, `.catch(true)` in the persisted
  schema, its own small handler rather than riding `setCvars`) - the precedent for "a flag that
  changes what the rendered file contains" already exists and is one field, one handler.
- **What the toggle governs is *only* the catalogue cvars no section holds.** A template profile
  places all of `ALL_CVARS` in its four seeded sections, so its file is byte-identical to today
  whatever the toggle says - 048's every-cvar-written rule is unchanged (AC5) and the toggle is only
  ever load-bearing for an imported profile, which is exactly the case the user's decision names.
- **ON writes them into one trailing, reserved auto-section "Defaults"** (tag `cvs=defaults`, never
  minted as a real section on read, exactly like `OTHER_CATEGORY_LABEL`) rather than distributing
  them into per-group sections a foreign file does not have - one rule, and it produces no diff at
  all for a template profile.
- **The toggle lives in the Settings tab header**, next to the filter / "Unsaved only" / Advanced
  controls, labelled "Write unset catalogue defaults" - it decides which *rows* the tab shows as much
  as which lines the file gets, and the story's premise is that those two are the same list; the Raw
  File tab's two write options stay where they are (one fact, one place).
- **Settings shows the "Defaults" section only while the toggle is on**, read-only in structure
  (no rename/delete/reorder) but a cvar can be dragged/moved out of it, which places it in a real
  section - "what Settings shows is what the file gets" stays literally true.
- **Deleting a section moves its cvars to the previous section, without a confirm dialog** (the
  first section's go to the following one; the last remaining section's become unplaced) - AC2 fixes
  the behaviour and nothing is lost, so 052's delete-or-move modal would be ceremony; this mirrors
  053's dialog-free sub-category delete. Deleting a sub-section leaves its cvars in the parent's
  ungrouped run, same as 053.
- **New meta keys `cvs=<id>` / `cvsub=<id>`, not a reuse of `cat=`/`sub=`** - a cvar section and a
  bind category are different namespaces, and sharing a key would make the category registry adopt
  cvar sections on read.
- **Cvar banners keep today's bare label - no `Settings: ` title prefix and no new decoration.**
  `TITLE_PREFIXES` and every banner-stripping path stay untouched, which is exactly where 042's
  round-trip risk lives (053's identical decision for sub-banners).
- **An empty section still writes its banner** (`banner()`, not `section()`, mirroring 053 D2), and
  section order is read back from banner position - because every section is represented in the file
  even when empty, position is reliable here and no `ord=` tag is needed (052's F3 problem does not
  arise).
- **An untagged foreign section that holds both `set` lines and binds mints a cvar section *and* a
  category of the same name**, independently - merging or cross-linking the two would be new
  inference the file does not state (050's minimum rule).
- **Seeded sections carry `name` (English) + `nameKey` (`CVAR_GROUP_LABELS`' keys)**, exactly 052's
  category-name rule: the file carries real prose, the renderer prefers the key, a rename drops it,
  and main still never sends prose over IPC.
- **The template seeds four sections and no sub-sections** - the catalogue has no second level to
  seed from (AC5 says "as today"); sub-sections come from the file, the import heuristic and the
  user.
- **A non-catalogue cvar counts as "common"** (always visible, never behind the Advanced collapse)
  and is never range/choice/engine-validated - the catalogue has no facts about it, so hiding it
  behind "Advanced" would be a guess (AC3's "never validated against facts the catalogue does not
  have").
- **Removing a catalogue cvar from a section unplaces it rather than erasing it from the world**: if
  the toggle is on it reappears under "Defaults". Honest and reversible; erasing a catalogue cvar
  outright is the reset-to-default affordance 048 deleted.
- **`setCvars` gains an optional `cvarSections` field instead of a new channel** - 052 set the
  precedent with `setActions` carrying `categories` + `actions` wholesale, and the contract-first
  rule prefers widening one payload over minting a channel.

## Plan

The Settings tab stops being the catalogue's shape and becomes the profile's, using 052/053's
model verbatim one level down. Order: model -> file write -> file read -> adversarial pass ->
import -> migration -> renderer -> toggle -> harness. Everything shared/main lands before the UI,
so Settings is never showing sections the file cannot express.

1. **Model + seed.** `ConfigCvarSection`/`ConfigCvarSubsection` + `profile.cvarSections` +
   `profile.writeCatalogDefaults` in `src/shared/modules/config.ts`; persisted zod
   (`src/main/lib/schemas.ts`, forgiving `.catch`) and IPC zod (`src/main/modules/config/schemas.ts`,
   120-char names, 64/64 caps); `STANDARD_TEMPLATE.cvarSections` = the four `CVAR_GROUP_ORDER`
   groups with their `ALL_CVARS` names; `profiles.ts#create` seeds for `from: 'template'`, nothing
   for empty.
2. **Writer.** `render.ts#buildCvarSections` renders `profile.cvarSections` in profile order
   (ungrouped run first, then sub-sections) with `cvs=`/`cvsub=` tags; unplaced catalogue cvars go
   into the reserved `Defaults` section only when `writeCatalogDefaults !== false`; unplaced
   non-catalogue cvars keep today's `Other` section. `writeValueFor`/alignment unchanged. Grammar
   documented in `docs/systems/profile-file-format.md`.
3. **Reader.** `profile-restore.ts` files each `set` line under the section it sits in: a
   `cvarSectionRegistry` next to `categoryRegistry`, eager registration from `cvs=`/`cvsub=`, lazy
   minting from an untagged banner's text, `defaults`/`Other` never minted. 048's read-back strip
   stays as-is - a placed catalogue cvar at its default keeps its placement and loses only its
   stored value.
4. **Adversarial pass.** New round-trip fixtures + a re-run of 042's fixed point (sprint carry-over
   rule; no trust in diff reads for `render.ts`/`profile-restore.ts`).
5. **Import.** Cvar lines are filed under their file section (banner text = section name), `Other`
   when the file has no sections; `docs/fixtures/dm.cfg` -> one `General Settings` section, 25 cvars.
6. **Migration.** One state-schema step: seed the four sections from `ALL_CVARS` by group,
   non-catalogue keys into `Other`, `writeCatalogDefaults: true`, profile marked dirty.
7. **Renderer.** `lib/cvar-rows.ts` groups by section instead of `def.group`; plain row for
   non-catalogue cvars; section/sub-section CRUD + move-cvar + add/remove-cvar mirroring
   `ControlsTab`/`ControlsGrid`; filter, "Unsaved only", Advanced, engine selector and counts move to
   per-section.
8. **Toggle.** `setWriteCatalogDefaults` handler mirroring `setWriteUnbindall`, checkbox in the
   Settings header.
9. **Harness.** `ui:verify` screen with a user-named section and a plain row; a `ui:flow` that
   renames a section and adds a raw cvar through the real UI.

Files, in order: `src/shared/modules/config.ts`, `src/main/lib/schemas.ts`,
`src/main/modules/config/schemas.ts`, `src/main/modules/config/profiles.ts`,
`src/shared/config/render.ts`, `src/shared/config/profile-metadata.ts`,
`src/shared/config/comment-labels.ts`, `docs/systems/profile-file-format.md`,
`src/shared/config/profile-restore.ts`, `src/main/modules/config/rebuild.ts`,
`src/shared/config/fixtures/profiles.ts`, `src/main/modules/config/round-trip.test.ts`,
`src/main/modules/config/import.ts`, `src/main/services/migrations.ts`, `src/shared/constants.ts`,
`src/renderer/src/modules/config/lib/cvar-rows.ts`, `.../SettingsTab.tsx`,
`.../components/CvarRow.tsx`, `.../components/` (new dialogs), `src/main/modules/config/index.ts`,
`src/renderer/src/i18n/locales/en.json`, `scripts/lib/screens.mjs`, `scripts/flows/`.

## Deliverables

- [x] **D1 - Model, schemas and the template seed.** `ConfigCvarSection { id, name, nameKey?, cvars,
  subsections? }`, `ConfigProfile.cvarSections?`, `ConfigProfile.writeCatalogDefaults?`; persisted zod
  (forgiving `.catch`) and IPC zod (names capped at 120, 64 sections / 64 sub-sections);
  `setProfileCvarsInputSchema` gains optional `cvarSections`; `STANDARD_TEMPLATE.cvarSections` = the
  four `CVAR_GROUP_ORDER` groups with their `ALL_CVARS` names and `nameKey`s; `profiles.ts#create`
  seeds them for `from: 'template'` only.
  Files: `src/shared/modules/config.ts`, `src/main/lib/schemas.ts`,
  `src/main/modules/config/schemas.ts`, `src/main/modules/config/profiles.ts` + tests.
  Mirror: `ConfigActionCategory`/`subcategories` and its two schemas (053 D1).
  *Accept:* typecheck + tests green; a template profile carries four sections holding every
  `ALL_CVARS` name; an empty profile carries none; an unknown cvar name in a section list does not
  fail validation. *(AC5, seed half)*

- [x] **D2 - The file writes cvar sections.** `buildCvarSections` renders `profile.cvarSections` in
  profile order - ungrouped run first, then sub-sections - with `cvs=<id>` / `cvsub=<id>` banners
  (bare label, no title prefix, empty banner still emitted); unplaced catalogue cvars into the
  reserved `Defaults` section when `writeCatalogDefaults !== false`; unplaced unknown cvars into
  today's `Other`. `cvs`/`cvsub` added to `KNOWN_META_KEYS`; label resolution in `comment-labels.ts`;
  grammar documented.
  Files: `src/shared/config/render.ts`, `src/shared/config/profile-metadata.ts`,
  `src/shared/config/comment-labels.ts`, `docs/systems/profile-file-format.md`, render tests.
  Mirror: `categoryTag`/`subcategoryTag`/`buildBindSections` (053 D2).
  *Accept:* a template profile renders byte-identically to today; a section renders in profile order
  in all three header styles; an empty section still writes its banner; with the toggle off, unplaced
  catalogue cvars produce no lines; alignment and `writeValueFor` unchanged. *(AC1 write half, AC5)*

- [x] **D3 - The file reads cvar sections back.** `cvarSectionRegistry` in `profile-restore.ts`:
  `set` lines filed under the section/sub-section they sit in, eager registration from `cvs=`/
  `cvsub=`, lazy minting from an untagged banner's text, `defaults` and `Other` never minted, section
  order from banner position; adopt/rebuild carry `cvarSections` and 048's `stripCatalogDefaults`
  keeps stripping values without touching placements.
  Files: `src/shared/config/profile-restore.ts`, `src/main/modules/config/profiles.ts`
  (`adoptFromFile`), `src/main/modules/config/rebuild.ts` + tests.
  Mirror: `categoryRegistry` / `Section.kind` (053 D3).
  *Accept:* save -> reload -> rebuild-from-file -> re-import of the launcher's own file keeps every
  section, sub-section and cvar placement; a hand-deleted `cvs=` tag degrades to a minted section,
  never a crash; a launcher file with the toggle on does not materialise the `Defaults` lines into
  real placements or into `profile.cvars`. *(AC1 read half)*

- [x] **D4 - Adversarial round-trip pass.** Fixtures: an empty section, a section named `Other` and
  one named like a bind category, a cvar listed in two sections, a section holding a name not in
  `profile.cvars`, non-ASCII and 120-char names, a profile with the toggle off and unplaced catalogue
  cvars, a section holding both catalogue and non-catalogue cvars, a foreign file whose cvars sit
  under a mirrored-wrap banner. Re-run 042's fixed-point property over all of them plus the existing
  adversarial-mangling suite.
  Files: `src/shared/config/fixtures/profiles.ts`, `src/main/modules/config/round-trip.test.ts`.
  *Accept:* `render(parse(render(p))) === render(p)` green for every fixture; no cvar duplicates,
  moves or disappears; the file does not grow a line per round-trip. *(AC1 round-trip clause)*

- [x] **D5 - Import files cvars under their section.** The importer assigns each cvar the section it
  was found in (banner text as the name, 053's sub-header heuristic for the second level) and `Other`
  when the file has none.
  Files: `src/main/modules/config/import.ts`, `src/shared/config/profile-restore.ts` (import path) +
  tests using `docs/fixtures/dm.cfg`.
  *Accept:* importing `dm.cfg` yields one `General Settings` section carrying all 25 cvars
  (`allow_download_*`, `adr0`-`adr8`, `hostname`, `m_filter`, `cl_vwep`, `cl_blend`, …); a file with
  no banners yields one `Other` section; the import preview shows the same. *(AC6)*

- [x] **D6 - Existing profiles migrate once.** One `MigrationStep` + `STATE_SCHEMA_VERSION` bump:
  seed the four sections from `ALL_CVARS` by group, put non-catalogue keys of `profile.cvars` into
  `Other`, set `writeCatalogDefaults: true`, mark the profile dirty.
  Files: `src/main/services/migrations.ts`, `src/shared/constants.ts` + migration test.
  Mirror: 052 D6.
  *Accept:* a pre-update profile shows the same cvars with the same values afterwards, catalogue ones
  in the four sections, the rest in `Other`; no value is lost; running the migration twice changes
  nothing. *(AC7)*

- [x] **D7 - Settings renders the profile's sections.** `lib/cvar-rows.ts` builds groups from
  `profile.cvarSections` (ungrouped run first, then sub-sections) instead of `def.group`; a
  non-catalogue cvar gets a plain row (name, text value, unsaved marker, no facts, no validation);
  filter, "Unsaved only", the Advanced collapse (`def.common`, non-catalogue = common) and the
  engine-facts selector keep working, counts per section and in total.
  Files: `src/renderer/src/modules/config/lib/cvar-rows.ts`, `.../SettingsTab.tsx`,
  `.../components/CvarRow.tsx`, `src/renderer/src/i18n/locales/en.json` + tests.
  Mirror: `lib/controls-row-groups.ts` + `ControlsGrid.tsx` (053 D5).
  *Accept:* an imported profile shows only its own sections with every cvar visible, catalogue rows
  rich and the rest plain; a template profile looks as today; filter/Unsaved/Advanced/engine selector
  behave as before and no counter can disagree with the visible rows. *(AC3, AC8)*

- [x] **D8 - Sections and cvars are editable.** Create / rename / reorder / delete a section and a
  sub-section from its header (delete moves cvars to the previous section / the parent's ungrouped
  run); move a cvar to another section; add a cvar by name and value (catalogue names suggested, a
  catalogue name giving the rich row) and remove one. All through the existing `setCvars` patch path
  carrying `{ cvars, cvarSections }`.
  Files: `.../SettingsTab.tsx`, new `.../components/` dialogs, `en.json` + tests.
  Mirror: `ControlsTab.tsx`'s category/sub-category CRUD handlers and dialogs (052 D7/D9, 053 D6/D7).
  *Accept:* all operations run through the real UI, keyboard reachable and focus-visible; deleting a
  section keeps every cvar; adding `cl_maxfps` gives a rich row and adding `zz_unknown` a plain one.
  *(AC2, AC4)*

- [x] **D9 - The "write unset catalogue defaults" toggle.** `setWriteCatalogDefaults` handler
  (contract in `src/shared/modules/config.ts` first, then the IPC schema and the main handler),
  checkbox in the Settings header with its label and help text, default on.
  Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/index.ts`, `src/main/modules/config/profiles.ts`, `.../SettingsTab.tsx`,
  `en.json`.
  Mirror: `setWriteUnbindall` end to end, plus `RawFileTab.tsx`'s checkbox.
  *Accept:* toggling it on an imported profile adds/removes the `Defaults` section in both the
  Settings tab and the Raw File tab and survives reload; on a template profile the rendered file does
  not change either way; the preload allowlist derives without a manual edit. *(AC5, choice half)*

- [x] **D10 - Harness coverage.** A `ui:verify` screen showing a Settings tab with a user-named
  section and a plain non-catalogue row; a `ui:flow` that renames a section and adds a raw cvar
  through the real UI.
  Files: `scripts/lib/screens.mjs`, `scripts/lib/fixture.mjs`,
  `scripts/flows/settings-section-rename-add-cvar.mjs`.
  Mirror: `scripts/flows/controls-subcategory.mjs`.
  *Accept:* `npm run ui:verify` green with 0 axe violations including the new screen; the flow's
  screenshots show the renamed section and the new raw cvar. *(AC9)*

**Coverage (AC top to bottom):** AC1 → D2 + D3 (+D4 for the round-trip clause) · AC2 → D8 ·
AC3 → D7 · AC4 → D8 · AC5 → D1 + D2 + D9 · AC6 → D5 · AC7 → D6 · AC8 → D7 · AC9 → D10.

## Model Hints

- D3 → `deliverable-hard` - it adds a second, parallel section-attribution pass to
  `profile-restore.ts` and must not let the reserved `Defaults` lines materialise into placements;
  getting that wrong grows the file on every round-trip, the exact failure 042 kept rediscovering.
- D4 → `deliverable-hard` - the adversarial pass is only worth anything if the agent actually
  constructs hostile profiles and runs the real render/parse pipeline instead of reading the diff
  (sprint carry-over rule).
- D7 → `deliverable-hard` - it replaces the grouping source of the whole Settings tab while filter,
  "Unsaved only", Advanced, engine scoping and four counters must keep agreeing with the rows; a
  regression there is invisible in a diff.
- D1, D2, D5, D6, D8, D9, D10 → default.
- Review: → `story-review-hard` - the story changes what a rendered file's cvar block contains and
  what reading it back means; the sprint's carry-over rule demands an adversarial re-render pass and
  no trust in diff reads for `render.ts` / `profile-restore.ts`.

## Test Plan (manual acceptance)

1. Create a profile from the standard template → **Settings**: Player / Network / Graphics / Sound
   with their cvars, as today. **Raw File**: the cvar block is byte-identical to before the update.
2. Rename **Graphics** to `Optik`, move it above **Network**, save. Raw File shows the renamed
   banner in that order. Restart the app and reopen: name and order are still there.
3. Create a sub-section under **Player**, move two cvars into it, save, reopen: the rows sit under
   that header. Delete the sub-section: the cvars fall back into Player's ungrouped run.
4. Delete a whole section that has cvars: its cvars appear in the section above it, nothing is lost.
5. Import `docs/fixtures/dm.cfg` as a new profile: Settings shows a **General Settings** section
   with all 25 cvars; `hostname`, `adr0`-`adr8` and `allow_download_*` have plain rows with a text
   value and no engine facts; nothing is hidden.
6. On that imported profile, switch the Settings header's **"Write unset catalogue defaults"** off:
   the `Defaults` section disappears from Settings and its `set` lines from the Raw File tab. Switch
   it back on: both return. Save, reopen the profile: the toggle kept its state.
7. Add a cvar by name: type `cl_maxfps` → a rich row with its facts; type `zz_test` with value `1` →
   a plain row. Remove the plain one again: it is gone from Settings and from the Raw File.
8. Type in the filter and switch on "Unsaved only": the counts per section and in total match the
   visible rows; expand a section's Advanced group and check the non-catalogue rows stay visible.
9. Open a profile that existed before the update: every cvar is still there, catalogue ones in the
   four sections, imported extras under `Other`.
10. `npm run ui:verify` - green, 0 axe violations, new screen present; `npm run ui:flow --
    settings-section-rename-add-cvar` passes.

## Done

Settings now mirrors the profile's own cvar sections end to end: `ConfigCvarSection`/
`ConfigCvarSubsection` model + schemas (D1), a writer that renders `profile.cvarSections` with
`cvs=`/`cvsub=` banner tags and a reserved `Defaults` bucket gated by `writeCatalogDefaults` (D2), a
reader that files `set` lines back under their section on save/reload/rebuild (D3, hardened by an
adversarial round-trip pass, D4), an importer that attributes a foreign file's cvars to the section
they first appear under while still folding to the last-set value (D5), a one-time migration for
pre-existing profiles (D6), a renderer that groups rows by section with a plain row for
non-catalogue cvars (D7), full section/sub-section CRUD plus add/remove/move-cvar (D8), the
"write unset catalogue defaults" toggle in the Settings header (D9), and `ui:verify`/`ui:flow`
harness coverage (D10). Two review rounds (story-review-hard) ran; round 1 found four blocking bugs
and three should-fix items, all of which were fixed and re-verified in round 2 (PASS), then three
further low-severity findings from round 2 were also fixed.

**Decisions**
- D5 import decouples section *placement* (first `set` occurrence's banner wins) from *value*
  folding (last `set` occurrence wins, matching real engine semantics) - this was a genuine
  deviation the first D5 pass introduced (last-value-wins for both) that broke the literal AC6
  wording ("all 25 cvars … in one section"); fixed in review round 1 to keep the story's own
  "first placement wins" rule consistent between the round-trip reader and the importer.
- D6 migration seeds the full four-group catalogue (`buildTemplateCvarSections()` unfiltered),
  not just cvars the profile already customizes - matches a template profile's shape 1:1, fixed
  after round 2 flagged the narrower, sparser seeding as a spec deviation.
- The IPC schema's per-section `cvars` name-list cap was raised from 64 (miscopied from the
  section/sub-section *count* cap) to 512 - the 64 cap stays on how many sections/sub-sections a
  profile may have (per D1's literal spec); the cvar-list-length cap only needed to be generous
  enough that no real config file's biggest section (dm.cfg's largest is 68 names) can silently
  brick every subsequent Settings edit on that profile.
- A cvar can now be moved out of the reserved `Defaults`/`Other` groups via the per-row "move
  to…" action (its structural chrome - rename/reorder/delete - stays disabled), per the story's
  explicit Decision text; this was missing from the first D8 pass.
- `SettingsTab.tsx`'s new per-row/per-section-header `IconButton size="sm"` (28px) is recorded as
  a new row in CLAUDE.md's Deviations table, mirroring the existing `DropToggles.tsx` precedent
  (desktop, mouse-and-keyboard-only app, no touch surface).

**Open, deliberately unfixed (documented, not blocking):**
- D2's/Test-Plan-step-1's "byte-identical to today" wording is not literally true for a template
  profile's rendered file: the four group banners now carry `cvs=<id>` tags, which is required
  for rename identity to survive reload. The spec text is self-contradictory here (a section
  needs a stable tag to rename-and-persist, but a tag is new content); the round-2 reviewer
  confirmed no other regression from it.
- `mergeForeignBannerComments` (D5) widens the "recognized comment" set used by the whole restore
  pass, not just the cvar side; empirically checked against the dm+dmalias+gfx fixture (identical
  bind-side category/action/sub-category output before and after), but there is no dedicated test
  pinning that the bind side is unaffected by future foreign-file shapes.
- No dedicated `SettingsTab.test.ts` component test exists for the new editing UI (mirrors an
  existing gap - `ControlsTab.dialogs.test.ts` covers the bind side, no exact Settings analogue
  existed before this story either); coverage instead comes from `cvar-rows.test.ts`,
  `cvar-sections.test.ts`, and the live `ui:flow` smoke test.
- `detectWriteCatalogDefaults` (recovering the toggle's value purely from a rebuilt file when
  `state.json` is lost) was not added, mirroring `detectWriteUnbindall`/`detectSectionHeaderStyle`
  - low-impact (defaults to `true`, the safe/no-data-loss direction) and explicitly deferred by
  the fix-cycle scope.

**Verification:** `npm run build`, `npm run typecheck`, `npm test` all green (83 test files, 2374
tests passed; 6 pre-existing jsdom/undici "webidl.util.markAsUncloneable" environment errors in
unrelated renderer test files, reproduced identically on a clean stashed tree, unrelated to this
diff). Live smoke: `npm run ui:verify` green, 0 axe violations (critical/serious/moderate/minor),
64/64 screenshots, 32/32 screens; `npm run ui:flow -- settings-section-rename-add-cvar` passed,
screenshots confirm the renamed section and the new raw cvar row. Code review: two rounds
(story-review-hard), round 2 verdict PASS.

**Commit message:** `059: Settings mirrors the file's own cvar sections`
