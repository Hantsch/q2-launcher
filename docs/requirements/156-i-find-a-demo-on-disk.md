---
id: 156
title: I find a demo on disk
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user wants to send a demo to a friend, upload it, or open its folder. From any demo they can
reveal it in the system file manager or copy its path (concept `docs/concepts/demo-browser.md` §3,
§13, DEMO-20). Both work on Windows and Linux through `shell.showItemInFolder` and the clipboard.

## Acceptance Criteria

- [ ] **AC1** — "Reveal in file manager" opens the system file manager with the demo file selected,
      on Windows and Linux.
- [ ] **AC2** — "Copy path" puts the demo's absolute path on the clipboard and confirms it visibly.
- [ ] **AC3** — For an archive entry ([[143]]), both actions act on the archive as decided in Q1.
- [ ] **AC4** — Both handlers take the demo's id, never a path; main resolves the path from its
      index.
- [ ] **AC5** — A demo whose file vanished since the last scan reports that visibly instead of
      revealing nothing.

## Open Questions

- [ ] **Q1 — Archive entries** — reveal the archive; copy the archive path, or `archive.zip!entry`?

## Plan

<!-- Filled by /refine 156, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 156. -->

## Model Hints

<!-- Filled by /refine 156. -->

## Acceptance Tests

<!-- Filled by /refine 156. -->

## Done

<!-- Filled by /build 156. -->
