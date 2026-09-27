---
id: 157
title: I rename a demo and its notes move with it
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

`2026-09-26-2130-q2dm1.dm2` tells nobody anything; `final-vs-tom.dm2` does. A user renames a demo
from the launcher, and its sidecar ([[146]]) is renamed with it, so the notes never get separated
from the file (concept `docs/concepts/demo-browser.md` §3, §8.1, DEMO-14). From the user's point of
view it is one step: either both are renamed, or neither is.

The rename target is the second renderer-supplied value that touches the filesystem (§14): a
**name**, not a path — schema-validated and resolved inside the demo's own folder by main.

## Acceptance Criteria

- [ ] **AC1** — The user renames a demo from its detail view; the demo file and, if present, its
      sidecar (`<new name>.json`) are both renamed.
- [ ] **AC2** — If either rename fails, both files end up with their original names, and the user
      sees the reason.
- [ ] **AC3** — The new name is validated in main: no path separators, no `..`, no characters or
      reserved names invalid on Windows, a length cap; the demo's extension (incl. `.gz`) is kept.
- [ ] **AC4** — A name that already exists in the folder (for the demo or its sidecar) is rejected
      with its reason; nothing is overwritten.
- [ ] **AC5** — After a rename the list shows the demo under its new name without losing its parsed
      facts or selection.
- [ ] **AC6** — Renaming the demo that is currently playing follows the rule decided in Q1.

## Open Questions

- [ ] **Q1 — Rename while playing** (§17.13): blocked with the reason, or allowed?
- [ ] **Q2 — Name facts after rename** — a renamed file no longer matches its autorecord pattern;
      should the old name facts (date, players) be kept, e.g. by writing them into the sidecar?

## Plan

<!-- Filled by /refine 157, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 157. -->

## Model Hints

<!-- Filled by /refine 157. -->

## Acceptance Tests

<!-- Filled by /refine 157. -->

## Done

<!-- Filled by /build 157. -->
