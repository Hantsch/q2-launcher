---
id: 142
title: I add my own demo folders
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Not every demo sits inside an installation: some come as a download from a community site, some
live in an archive folder the user keeps. The user adds such folders in the demos settings, and
their demos appear in the same list, labelled with the folder (concept
`docs/concepts/demo-browser.md` §2, DEMO-1).

A new extra folder is one of the only two renderer-supplied paths in this module (§14): it comes from
a native folder dialog, is schema-validated and canonicalized in main. This story also introduces the
module's own `state.json` key — the `home`/`servers` precedent ([[110]]) — which later holds user
templates ([[140]]) and the remembered sort ([[152]]).

## Acceptance Criteria

- [ ] **AC1** — In the demos settings section the user adds a folder through the native folder
      dialog, sees it in a list and can remove it; the list persists across restarts.
- [ ] **AC2** — Demos in an extra folder appear in the list with the source "extra folder: `<path>`",
      with the same formats and exclusions as [[141]].
- [ ] **AC3** — The folder path is validated by a zod schema and canonicalized in main; a
      non-absolute path, a file, or a path main cannot resolve is rejected with its reason.
- [ ] **AC4** — Adding a folder that is already listed, or that is an installation's `demos/`
      folder, does not produce duplicate demos.
- [ ] **AC5** — Removing a folder removes its demos from the list; nothing on disk is touched.
- [ ] **AC6** — The module's settings live under a module-owned `state.json` key with its own zod
      schema; an invalid stored value falls back to defaults without breaking the app.

## Open Questions

- [ ] **Q1 — Recursion** — a downloads folder can be deep: scan subfolders, and if so, how deep?
      (Same question as [[141]] Q1, possibly a different answer.)
- [ ] **Q2 — Overlaps** — a folder that is a parent of an installation: scanned as extra folder,
      or skipped for the installation part?

## Plan

<!-- Filled by /refine 142, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 142. -->

## Model Hints

<!-- Filled by /refine 142. -->

## Acceptance Tests

<!-- Filled by /refine 142. -->

## Done

<!-- Filled by /build 142. -->
