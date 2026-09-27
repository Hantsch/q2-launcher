---
id: 166
title: I send a console command to the running demo
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Anything the timeline does not cover — `cl_demosnaps`, `scr_demobar 2`, `fov 110`, a screenshot — a
user types into a command field next to the timeline, and it goes to the running engine (concept
`docs/concepts/demo-browser.md` §12.1, DEMO-26, DEMO-29). It is the user's own line to the user's own
local game, but it still ends up in a pipe or a control file, so main validates it as **one printable
line with a length cap** before it goes anywhere (§12.3).

## Acceptance Criteria

- [ ] **AC1** — While a demo plays, a command field next to the timeline sends the entered line to
      the engine through [[164]]'s channel.
- [ ] **AC2** — Main validates the line with a zod schema: exactly one line, printable characters
      only, no control characters, length ≤ the cap decided in Q1.
- [ ] **AC3** — A rejected line is not sent, and the user sees the reason next to the field.
- [ ] **AC4** — On the Windows cfg-polling route, a line cannot break out of the control file's
      structure (e.g. terminate the polling alias); a unit test pins it.
- [ ] **AC5** — Without a running session the field is disabled with its reason as visible text.
- [ ] **AC6** — The field is keyboard operable (Enter sends) with visible focus.

## Open Questions

- [ ] **Q1 — Length cap** — Quake's console line limit, or smaller?
- [ ] **Q2 — History** — does the field keep a command history (Up/Down)? Not in the concept.
- [ ] **Q3 — Output** — does the user see the engine's reply, or only send?

## Plan

<!-- Filled by /refine 166, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 166. -->

## Model Hints

<!-- Filled by /refine 166. -->

## Acceptance Tests

<!-- Filled by /refine 166. -->

## Done

<!-- Filled by /build 166. -->
