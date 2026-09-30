---
id: 181
title: I join the selected server from the action bar
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

On the Servers tab the action bar button should do what the tab is about: **Join** the selected
server. With no server selected it is disabled. It runs the same join flow the server detail's Join
button runs today ([[125]]): address check, mod-mismatch warning with "join anyway", password
prompt, then launch with `+connect`.

Uses the seam from [[180]].

## Acceptance Criteria

- [ ] **AC1** — On the Servers tab with no server selected, the action bar button reads "Join" and
      is disabled.
- [ ] **AC2** — With a server selected, the button reads "Join" and is enabled; pressing it launches
      the game connected to that server.
- [ ] **AC3** — Joining from the action bar runs the full join flow: a mod mismatch shows the same
      warning with "join anyway", a password-protected server asks for the password first.
- [ ] **AC4** — The installation-level states still win (missing, broken, installing, write-locked,
      running), as in [[180]] AC6.
- [ ] **AC5** — Leaving the Servers tab turns the button back into "Play".

## Open Questions

- Q1: The server detail pane has its own prominent Join (`JoinServerButton prominent`). Remove it
  now that the action bar joins (recommended: one primary join, same reasoning as [[180]] AC7), or
  keep both? The watchlist's dense per-row Join buttons stay either way.
- Q2: Spectate — does the action bar offer it (split button / secondary), or does spectating stay
  in the detail pane only? Recommendation: stay in the detail pane.
- Q3: With a server selected but no active installation, the reason `servers.join.noInstallation`
  shows where — the same readout slot as [[180]]'s Q2?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
