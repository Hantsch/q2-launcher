---
id: 182
title: A missing-mod warning is asked once
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

When a demo's mod is not fully installed in the active installation, the detail panel today shows a
permanent paragraph ("Mod `opentdm` is not fully installed in this installation — the demo may not
play correctly.") plus an "I know the consequences — play anyway" button, every time I look at such
a demo. For a player who knows the mod's demos play fine this is permanent noise.

Instead the warning is **asked once** — in the confirmation [[180]] opens when I press View on such
a demo — and my answer can be **remembered**, so the next time it does not ask again. Settings also offers a global switch
to never warn about a missing mod when playing a demo.

## Acceptance Criteria

- [ ] **AC1** — Selecting a demo whose mod is not installed shows no permanent warning paragraph and
      no "play anyway" button in the detail panel.
- [ ] **AC2** — [[180]]'s confirmation names the mod and the risk and offers a "Don't ask again"
      choice next to "Play anyway" and "Cancel".
- [ ] **AC3** — "Cancel" with "Don't ask again" ticked remembers nothing.
- [ ] **AC4** — After "Play anyway" with "Don't ask again" ticked, pressing View on a demo with the
      same missing mod plays it without asking; the choice survives a launcher restart.
- [ ] **AC5** — Settings has a switch "Warn when a demo's mod is not installed" (default on); turned
      off, no demo asks; turned back on, the per-mod remembered answers from AC4 still apply.
- [ ] **AC6** — The remembered answers can be reset in Settings, after which the warning asks again.
- [ ] **AC7** — Main still re-checks eligibility before launching: a play request for a demo with a
      missing mod is only accepted when it carries the acknowledgement, whether from the dialog, a
      remembered answer or the global switch.

## Open Questions

- Q1: Scope of "remembered" — per mod name (recommended: "opentdm is fine for me"), per mod *and*
  installation, or per demo?
- Q2: Does the Servers join's mod-mismatch warning ([[125]]) share the same global switch and
  remembering, or stay a separate question? Recommendation: separate — joining a server without its
  mod fails harder than playing a demo.
- Q3: Where in Settings — the Demos settings section (`ReplaysSettingsSection.tsx`, recommended) or
  a general section?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
