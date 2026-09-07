---
id: 066
title: A new profile starts empty, from a handed template, or from my own config files
status: draft
created: 2026-09-07
---

## Requirement

Creating a profile is the first thing a user does in the config module, and the "Start from"
choice it offers today does not match what people actually arrive with
([CreateProfileDialog.tsx:88-99](../../src/renderer/src/modules/config/CreateProfileDialog.tsx#L88-L99)).
Three choices should be on offer, and two of them need work:

**Empty** — correct as it is, nothing to change.

**Template** — today there is one nameless "standard template"
([config.ts:498-605](../../src/shared/modules/config.ts#L498-L605)). There should be two: one for
right-handers and one for left-handers, because handedness is the one decision that changes a
whole keyboard layout rather than a single bind. The two layouts themselves come later; this story
is about the choice existing and being carried into the created profile.

**Import** — today import is addressed by `{ installationId, gameDir }` and reads exactly the
engine's own entry files, `config.cfg` and `autoexec.cfg`, plus whatever they `exec`
([import-reader.ts:10-22](../../src/main/modules/config/core/import-reader.ts#L10-L22)). That
misses the normal case: a player's config lives in files the engine only loads on demand. The
three real fixture configs are exactly that shape —
[docs/fixtures/dm.cfg](../fixtures/dm.cfg) (100 binds, 93 `set` lines),
[docs/fixtures/dmalias.cfg](../fixtures/dmalias.cfg) (96 aliases) and
[docs/fixtures/gfx.cfg](../fixtures/gfx.cfg) (46 `set` lines) — and nothing links them by `exec`
except one bind, `bind RIGHTARROW "exec dmalias.cfg"`
([dm.cfg:133](../fixtures/dm.cfg#L133)). Point today's importer at that installation and 96 of
those aliases never get read.

So: the user picks N config files themselves, from anywhere on disk, and the launcher reads and
analyses all of them into one profile with every function intact. `docs/fixtures/{dm,dmalias,gfx}.cfg`
is the reference case — the author's own config — and the existing fixture-corpus test
([import-fixtures.test.ts:17-29](../../src/main/modules/config/core/import-fixtures.test.ts#L17-L29))
already pins what the parser gets out of those files when it does see them.

Two existing constraints stay in force: paths from the renderer are never trusted (CLAUDE.md), so
the picked paths have to be owned by main the way `installations:pickFolder` already owns its
result ([installations.ts:68-88](../../src/main/ipc/installations.ts#L68-L88)); and nothing is
written before Create, with commit re-reading from disk instead of trusting a previewed result
(story 005 decisions 3 + 14).

## Acceptance Criteria

- [ ] **AC1** — The create dialog's "Start from" offers four options: Empty, Template
      (right-handed), Template (left-handed), Import from files.
- [ ] **AC2** — Empty produces exactly the profile it produces today; no behaviour change.
- [ ] **AC3** — Both template options create a profile and the created profile records which
      handedness it was seeded from, so the later layout story fills in content rather than
      re-touching the picker. Until that content exists the dialog does not pretend the two differ.
- [ ] **AC4** — Import from files opens a native multi-select file picker filtered to `.cfg`, and
      the picked files are listed in the dialog. The renderer never sends a path it composed
      itself — main owns the picked paths from picker to commit.
- [ ] **AC5** — The listed order is the load order: files are folded left to right, a later
      assignment wins over an earlier one, and the user can remove a file or change its position
      before importing.
- [ ] **AC6** — The picked files are analysed by the same reader/parser the installation import
      uses: cvars, binds, aliases (plain, press/release, message), categories and sub-categories,
      cvar sections, layers and preserved lines all come out as they do today.
- [ ] **AC7** — Reference case: importing `docs/fixtures/dm.cfg`, `dmalias.cfg` and `gfx.cfg`
      yields one profile containing every bind and every alias the fixture-corpus test already
      pins for those files, plus the last-set value of every cvar assignment across all three, with
      `bind RIGHTARROW "exec dmalias.cfg"` preserved as a working entry. Anything that could not
      become a structured entry is named in the import review step, not silently dropped.
- [ ] **AC8** — An `exec` inside a picked file resolves relative to that file's own folder and
      cannot escape it; an unresolvable or refused `exec` is kept as a preserved line with a
      warning and never aborts the import — the guarantee today's reader already gives.
- [ ] **AC9** — Importing from files needs no installation: the flow completes with no installation
      selected, and on a launcher with no installation registered at all.
- [ ] **AC10** — Nothing is written until Create is pressed, and the commit re-reads the picked
      files from disk rather than trusting anything the preview returned.
- [ ] **AC11** — No image assets; the file list and its controls are CSS/inline SVG per the repo
      rule.

## Open Questions

- [ ] Do both template options ship now, seeded identically from today's `STANDARD_TEMPLATE` and
      only labelled by handedness (filed that way — AC3), or should the picker keep one template
      entry until the two real layouts exist? Filed as "ship both" because the seed marker is what
      the later story needs; say so if you want the choice hidden until it means something.
- [ ] Does file import **replace** the installation/gamedir import
      (`import.scan`/`import.preview`/`import.commit`, and the installation → gamedir steps in
      [ImportProfileDialog.tsx](../../src/renderer/src/modules/config/ImportProfileDialog.tsx)), or
      live next to it as a second import mode? Replacing is less surface to keep green; keeping both
      preserves the "just read my baseq2" one-click case.
- [ ] Are the picked files read once at import time (recommended — the profile is standalone after
      that, per story 022), or should the profile remember where it was imported from for a later
      re-import?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
