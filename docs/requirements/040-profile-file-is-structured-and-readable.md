---
id: 040
title: The profile file is written structured, commented and human-readable
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Players love clean configs. Not merely functional ones — configs that are structured, commented,
aligned, and pleasant to read a year later. My own configs (`dm.cfg`, `dmalias.cfg`, `gfx.cfg`)
are built exactly that way: section banners, a comment behind almost every bind, keys grouped the
way they sit on the keyboard, columns aligned with tabs.

What the launcher writes today is a flat, sorted dump:

```
// q2-launcher profile b2dd1b5e-fd01-4353-81c9-3e6961d5ac72 - generated, do not edit
set cl_gun "1"
set cl_run "0"
...
alias q2l_a_ssg_sg_9a2f "use super shotgun; use shotgun"
...
bind q "q2l_a_ssg_sg_9a2f"
```

Functional, and nothing more. It tells me nothing: `bind q` is **SSG + SG** in the UI and sits in
the **weapons** category, and none of that is visible in the file. That information is also what a
re-import needs (stories 041/042), so the comments are not decoration — they are the file's own
record of what it means.

Decided with the user: **one file per profile, structured in sections.** Not the split
`dm.cfg` + `dmalias.cfg` + `gfx.cfg` layout my own configs use — one `<name>.cfg` keeps the write
pipeline, sync state (story 022), Raw File tab (023) and cleanup (010/025) at one target per
profile.

Target shape (sketch, exact wording is the story's own business):

```
// =============================================================================
//  Hantsch - Test
//  Q2 Launcher - do not hand-edit while the launcher has the profile open
// =============================================================================

// --- Player ------------------------------------------------------------------
set name         "Hantsch"

// --- Mouse -------------------------------------------------------------------
set sensitivity  "3"
set m_pitch      "0.022"

// --- Aliases: weapons --------------------------------------------------------
alias ssg_sg     "use super shotgun; use shotgun"     // SSG + SG

// --- Layer: Alt (hold, on ALT) -----------------------------------------------
alias +alt       "bind q drop_shotgun"
alias -alt       "bind q ssg_sg"

// --- Binds: main block -------------------------------------------------------
bind q           "ssg_sg"                             // SSG + SG
bind w           "+forward"                           // forward
```

## Acceptance Criteria

- [ ] The file opens with a header block: profile name, the ownership sentinel (still
      machine-detectable — `writer.ts`, `cleanup.ts` and `canonical.ts` all match on it), and a line
      saying what hand-editing means once story 043 lands.
- [ ] Content is grouped into commented sections rather than emitted as one sorted list: cvars by
      their `CvarDef.group` (`player`/`network`/`graphics`/…, already on the catalogue), aliases by
      the entry's category, one section per alt/modifier layer naming the layer and its trigger, and
      binds grouped the way a player reads a keyboard.
- [ ] Every generated bind and alias carries a trailing `//` comment with the entry's display name,
      so `bind q "ssg_sg"` reads as `SSG + SG` in the file too.
- [ ] Values are column-aligned within a section (spaces, not tabs — a tab-aligned file re-renders
      differently in every editor).
- [ ] Output stays **deterministic**: the same profile renders byte-identical every time. Section
      order, in-section order and the alignment column are all derived, never insertion-order- or
      clock-dependent. The existing render tests' determinism assertions must still hold.
- [ ] Latin-1 round-trip is unbroken: every comment and banner character survives the writer's
      latin1 encoding (no em dashes, no box-drawing glyphs — plain ASCII, the rule
      `sentinelLine` already documents).
- [ ] Every line stays inside the engine's line-length budget, comments included.
- [ ] Cvars/binds/aliases the launcher has no section for still get written, in an explicit
      "other" section — nothing is dropped to make the layout tidy.
- [ ] An empty section is omitted, not written as a banner with nothing under it.
- [ ] The Raw File tab and the write-preview dialog show the new layout with syntax highlighting
      intact (story 024's `ConfigCodeView`).

## Open Questions

- Bind grouping: by keyboard region (function row / main block / arrows / keypad / mouse — what real
  configs do and what `keyboard-layout.ts` already models) or by action category
  (movement/weapons/drops — what the Controls tab shows)? Region reads better in the file; category
  matches the UI. Region also means moving `KEYBOARD_ROWS`/`ARROW_CLUSTER`/`MOUSE_ROWS`/keypad out
  of `src/renderer/src/modules/config/lib/keyboard-layout.ts` into `src/shared/config/`, since
  `render.ts` may not import from the renderer.
- Are deliberately empty binds (`bind i ""`) kept as documentation of the keyboard layout, the way
  my configs do it, or dropped? They are written today.
- Does the file open with `unbindall`? Every real config does, and it makes the profile
  self-contained rather than layered on top of whatever `config.cfg` left behind — but it would also
  wipe binds the launcher does not manage.
- Should the header carry a written timestamp? It reads well and it breaks byte-identical
  re-render / "has this file changed" comparisons.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
