---
id: 160
title: a demo from elsewhere is copied in and cleaned up
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Q2PRO's `demo` command only loads from the Quake file system (concept
`docs/concepts/demo-browser.md` §9.1). A demo in an extra folder, in another installation, inside a
zip — or a `.gz` for an engine that cannot read it — has to be put where the playing installation
can see it. The launcher does that with a **temporary copy** in `<gamedir>/demos/_launcher/` of the
playing installation and removes it after the game exits; **the original is never touched** (§11.2,
DEMO-23).

[[141]] already keeps `_launcher/` out of the list. How leftovers from a crashed session are cleaned
up is concept open point §17.8.

## Acceptance Criteria

- [ ] **AC1** — Playing a demo that is not inside the chosen installation's `<gamedir>/demos/`
      copies it to `<gamedir>/demos/_launcher/` and plays the copy.
- [ ] **AC2** — Playing a zip entry extracts just that entry to the same place and plays it.
- [ ] **AC3** — A `.gz` is decompressed into the copy only when the chosen engine cannot play it
      (r1q2, [[161]]); Q2PRO gets the `.gz` as-is.
- [ ] **AC4** — The copy is removed after the game exits.
- [ ] **AC5** — The original file (and archive) is unchanged afterwards — content and modification
      time, asserted by a test.
- [ ] **AC6** — Leftovers from a session that did not end cleanly are removed at the next launcher
      start by the rule decided in Q1.
- [ ] **AC7** — If `_launcher/` cannot be created or written, Play fails with a visible, specific
      reason and nothing is launched.
- [ ] **AC8** — Two copies with the same file name from different sources never overwrite each other
      while one is playing.

## Open Questions

- [ ] **Q1 — Crash cleanup** (§17.8): sweep all of `_launcher/` at startup, or only files the
      launcher recorded as its own?
- [ ] **Q2 — Not writable** — is there any fallback when the installation folder is read-only, or
      is failing with the reason (AC7) the whole answer?

## Plan

<!-- Filled by /refine 160, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 160. -->

## Model Hints

<!-- Filled by /refine 160. -->

## Acceptance Tests

<!-- Filled by /refine 160. -->

## Done

<!-- Filled by /build 160. -->
