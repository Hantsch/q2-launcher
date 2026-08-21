---
id: 030
title: Titlebar and wordmark scale up
status: draft
created: 2026-08-21
---

## Requirement

The title bar is the first thing a user sees and the primary way to switch modules, but
today it is a thin 44px strip (`--titlebar-h` in
[src/renderer/src/styles/index.css](../../src/renderer/src/styles/index.css)) with a small
text-only wordmark. It should read as a proper header: comfortably taller, easy to read and to
click, with the wordmark ("Q2 LAUNCHER" + tagline in
[TitleBar.tsx](../../src/renderer/src/components/shell/TitleBar.tsx)) at least twice its
current size.

## Acceptance Criteria

- [ ] The title bar is noticeably taller than the current 44px (target roughly 64-72px) —
      value change lives in the `--titlebar-h` CSS variable, nothing hardcoded per component.
- [ ] The wordmark (title + tagline block) renders at least twice its current font size and
      stays vertically centred in the taller bar.
- [ ] Nav items, the Settings icon and the window control buttons (minimize/maximize/close)
      scale up proportionally so nothing looks stranded in the extra height — no leftover
      44px-tall element floating in a 64-72px bar.
- [ ] The window drag region still covers the full bar height; double-click-to-maximize and
      window controls keep working exactly as before.
- [ ] `npm run ui:verify` screenshots show the new proportions on every screen (titlebar is
      part of every screenshot).

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
