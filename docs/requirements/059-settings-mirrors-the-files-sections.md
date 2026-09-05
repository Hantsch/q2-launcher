---
id: 059
title: Settings mirrors the file's own sections
status: draft
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

- [ ] Settings shows the profile's cvar sections in the profile's order, each with its cvars in the
      profile's order; the file's cvar section headers are read back as these sections and written
      from them; story 042's round-trip property holds.
- [ ] Sections can be created, renamed, reordered and deleted (deleting moves its cvars to the
      previous section); a cvar can be moved to another section (drag and drop comes with story 054).
- [ ] Every cvar in the profile has a row: catalogue cvars keep today's rich row (label, control,
      engine facts, caveats, unsaved marker); non-catalogue cvars get a plain row with name, a text
      value and the unsaved marker - never hidden, and never validated against facts the catalogue
      does not have.
- [ ] A cvar can be added to a section by name and value, and removed; adding a catalogue cvar by
      name gives it its rich row.
- [ ] A profile created from the template seeds Player / Network / Graphics / Sound with the
      catalogue's cvars as today; story 048's every-cvar-written rule is unchanged (see Open
      Questions for where those lines sit in an imported profile).
- [ ] Import files each cvar under the section it was found in (the banner text as the section
      name), or under "Other" when the file has no sections; importing `docs/fixtures/dm.cfg` yields
      one "General Settings" section with all 25 cvars visible in Settings.
- [ ] Filter, "Unsaved only", the Advanced collapse (`def.common`) and the engine-facts selector
      keep working; counts stay per section and in total.
- [ ] Existing profiles migrate once: catalogue cvars land in the four default sections,
      non-catalogue cvars in "Other" - no value is lost.
- [ ] `npm run ui:verify` shows a Settings tab with a user-named section and a plain non-catalogue
      row; a `ui:flow` renames a section and adds a raw cvar through the real UI.

## Open Questions

1. **Home of the always-written defaults (story 048)** in an imported profile that never mentioned
   them: (a) an automatic "Defaults" section at the end; (b) each in its catalogue group, created on
   demand; (c) stop writing untouched defaults for imported profiles. Recommendation: (a) - the file
   states everything (048), and the section name says why those lines are there.
2. **Non-catalogue cvars:** plain text row only, or also a "make this a known setting" path?
   Recommendation: plain row only - the catalogue is source-cited engine knowledge, not a user list.
3. **Two levels like Controls, or one?** Recommendation: one - no reference config nests cvar
   sections.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
