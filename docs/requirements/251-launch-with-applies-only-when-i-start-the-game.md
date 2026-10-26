---
id: 251
title: Launch with applies only when I start the game
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the footer's "Launch with" (mod) choice only appears where I start the game myself, not
where a server or a demo already decides mod and map.

User feedback 2026-10-26: "Launch with" should only apply to starting the game, not to joining a server
or playing a demo, and should not be shown on Servers and Demos.

Today `GameDirSelect` sits in the shell footer (`ActionBar.tsx`) and shows on every route. Demo playback
already ignores it (it passes the demo's own game dir), but a server join silently launches with the saved
`activeGameDir` (`+set game`) and shows a mod-mismatch confirmation (`join-flow.ts` `modMismatch`).

## Acceptance Criteria

- [ ] **AC1** — On the Servers view the footer shows no "Launch with" select.
- [ ] **AC2** — On the Demos view the footer shows no "Launch with" select.
- [ ] **AC3** — On Home and Library the "Launch with" select is shown as today (when the installation has mods).
- [ ] **AC4** — Joining a server launches without `+set game`, whatever "Launch with" is set to.
- [ ] **AC5** — Joining a server whose mod differs from the "Launch with" choice shows no confirmation and joins directly.
- [ ] **AC6** — Demo playback keeps launching with the demo's own mod (unchanged).
- [ ] **AC7** — Plain Play keeps launching with the saved "Launch with" mod (unchanged).

## Open Questions

## Decisions (Sprint)

- **(User)** The footer's mod and map choice belong to starting the game only; Servers and Demos do not
  show them — there the server or the demo decides mod and map.
- **(User)** A join passes no mod: the game switches to the server's mod on connect (and downloads it if
  allowed), so the launcher adds nothing.
- **(User)** The "mod mismatch — join anyway?" confirmation goes away completely.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
