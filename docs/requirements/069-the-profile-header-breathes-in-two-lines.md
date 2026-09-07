---
id: 069
title: the profile header breathes in two lines
status: draft
created: 2026-09-07
---

## Requirement

Story 061 folded the config profile header into one row to buy editor height, and it now reads as
one dense strip of unrelated facts glued to the tab strip below it. What I actually look at first is
**which profile** I am editing and **whether it is saved**; created/updated are context I only read
when I go looking for them.

So the centred identity zone should be two lines: the profile name plus the saved/unsaved state on
the first line (the focus), and `CREATED <when>` / `UPDATED <when>` on the second, a little smaller
and quieter. That also puts real air between the header and the tab strip, so the whole block stops
looking pasted together.

The height this costs must not break the editor-line floor story 061 established.

## Acceptance Criteria

- [ ] **AC1** — The config profile header's identity zone renders two lines: line 1 = profile name +
      unsaved/saved indicator, line 2 = created and updated.
- [ ] **AC2** — Line 2 is visually subordinate to line 1 (smaller type, dimmer), and line 1's name
      stays the most prominent text in the header.
- [ ] **AC3** — Back button (left) and action cluster (right) stay on the header's outer edges and
      keep their vertical centring against the now-taller identity zone; the header is still one
      header on all seven tabs, with no second identity block below it.
- [ ] **AC4** — The Raw file tab still shows at least 30 visible editor lines at the shell's minimum
      viewport (`scripts/flows/config-header-geometry.mjs` stays green).
- [ ] **AC5** — At the app's minimum width (940px) nothing clips or overflows; the identity zone
      wraps rather than pushing the action cluster off the row.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests
