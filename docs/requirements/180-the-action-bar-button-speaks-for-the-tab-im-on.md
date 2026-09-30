---
id: 180
title: The action bar button speaks for the tab I'm on
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The big button in the action bar, right of the active installation, is the launcher's main control —
but today it only ever says "Play" (start the game) or, during a demo, "Stop demo" ([[173]]). The
Demos tab meanwhile has its own smaller Play button inside the detail panel, plus a second
"I know the consequences — play anyway" button beneath it. Two play buttons for one screen.

The action bar button becomes **the** primary action for what I am looking at:

- Default (every tab without its own action): **Play** — starts the game, as today.
- **Demos** tab: **View** — plays the selected demo; disabled while no demo is selected.
- While a demo plays: **Stop** — as today ([[173]]).

Its label, enabled state and effect come from the tab that is open. The Demos detail panel loses its
own Play button; the demo-specific play eligibility ([[159]]: Q2PRO required, Wayland, game already
running, …) now decides the action bar button.

This needs a seam the shell does not have yet: a module contributes the primary action for its own
view. The shell keeps deciding the installation-level states (no installation, locate, repair,
installing, write-locked, running) — a module's action only applies when the installation itself
would allow Play. [[181]] uses the same seam for Servers.

## Acceptance Criteria

- [ ] **AC1** — On a tab without its own action (e.g. Home, Library), the action bar button reads
      "Play" and starts the game, exactly as today.
- [ ] **AC2** — On the Demos tab with no demo selected, the button reads "View" and is disabled.
- [ ] **AC3** — On the Demos tab with a demo selected that can play, the button reads "View" and is
      enabled; pressing it plays that demo on the stage exactly as the detail panel's Play did
      ([[170]]).
- [ ] **AC4** — On the Demos tab with a selected demo that cannot play, the button is disabled and
      the reason ([[159]]'s eligibility reason) is shown as visible text in the action bar, not only
      as a tooltip.
- [ ] **AC5** — While a demo plays, the button reads "Stop demo" and stops it, as today ([[173]]).
- [ ] **AC6** — The installation-level states win over a tab's action: with the installation
      missing, broken, installing or write-locked, the button shows Locate / Repair / Install /
      write-locked as today, on the Demos tab too.
- [ ] **AC7** — The Demos detail panel shows no Play button and no "play anyway" button.
- [ ] **AC8** — Switching tabs updates the button's label and state immediately (Demos → Home turns
      "View" back into "Play").
- [ ] **AC9** — Pressing View on a selected demo whose mod is not installed asks for confirmation
      naming the mod (Play anyway / Cancel) before playing; Cancel plays nothing.

## Open Questions

- Q1: Shell edit. CLAUDE.md says a feature never edits the shell; a module-contributed primary
  action is a new shell seam (a contribution point, same spirit as settings sections). Recorded as a
  sprint decision with this story as its reason, or a CLAUDE.md deviation row?
- Q2: Where does the not-playable reason (AC4) sit — in the action bar's middle readout column
  (recommended: it is empty space when nothing downloads), or under the button?
- Q3: Label "View" vs. "Watch" for playing a demo — the user said "View". Keep it.
- Q4: The mod-missing warning ([[159]]'s acknowledgeable reason) loses its "play anyway" button
  (AC7). Proposed split: this story makes View on such a demo open a plain confirmation (Play
  anyway / Cancel), so nothing regresses; [[182]] removes the permanent paragraph and adds
  "don't ask again" plus the Settings switch. Confirm.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
