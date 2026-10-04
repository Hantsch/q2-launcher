---
id: 239
title: adding an installation is one flow wherever I start it
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a new user, "add a new installation" does the same thing whether I start it from the rail's "+"
or from the Library, and it ends with a game I can play.

User feedback 2026-10-04: installing from the sidebar does something completely different from
"Download & install" in the Library; the two processes belong together.

Today:

- The rail "+" offers Add existing, Search this PC and **Create new installation**. Create new
  (`CreateInstallationDialog.tsx`) only makes `<folder>/baseq2` and registers an empty entry with an
  engine label — nothing is downloaded, and the installation then reports "game files missing". Its
  text still says downloading is "not built yet".
- The Library additionally offers **Download & install**, the bootstrap wizard
  (`BootstrapWizard.tsx`: engine → game data → target → confirm → running), which ends with a
  playable installation but has no name field.

Users pick "Create new" from the rail, expect an install, and get an empty folder.

## Acceptance Criteria

- [ ] **AC1** — The rail "+" and the Library offer the same set of entries, with the same labels, in
      the same order.
- [ ] **AC2** — "New installation" from either place opens the same wizard, which downloads or copies
      engine and game data and ends with a playable installation.
- [ ] **AC3** — The wizard lets the user name the installation; the default is the current
      automatic name.
- [ ] **AC4** — No entry point can produce an empty installation without game files unless the user
      explicitly chose that (see Q1), and the UI text describes what each entry does.
- [ ] **AC5** — No user-visible text claims downloading is not built.

## Open Questions

- **Q1** — Does "Create empty installation" survive at all? It is the only way to start from an
  empty folder the user fills by hand. Recommendation: remove it as a separate entry; the wizard's
  "existing folder" game-data option covers the expert case.
- **Q2** — Is the merged entry called "New installation…" or "Download & install…"? Recommendation:
  "New installation…", with the wizard's first step explaining download vs. own copy.
- **Q3** — Related: [[240]] (the target folder is created and shown) changes the wizard's target
  step; build them in one sprint, 239 first.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
