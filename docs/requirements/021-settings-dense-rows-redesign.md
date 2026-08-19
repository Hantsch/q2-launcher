---
id: 021
title: Settings — rebuild as the dense-rows prototype
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

The Settings tab has the right content and the wrong shape: one cvar row spans the whole window,
groups are two hard-coded panels rather than the real groups, and engine facts, current value and
default are not readable at a glance.

It should look and work like
[docs/prototypes/settings/a-dense-rows.html](../prototypes/settings/a-dense-rows.html): a capped,
dense list where every row is label + description, one control, the value against its default, and
a reset — with the noisy engine caveats inline only where there actually is one.

## Acceptance Criteria

- [ ] Content width is capped (~1000px); a row is a fixed grid (label · control · value · reset),
      not a stretched flex row.
- [ ] Rows are grouped by the cvar's real `group` (Player / Network / Graphics / Sound) with a
      sticky group header showing "n · m changed", replacing the two current panels.
- [ ] A row shows its label, the cvar name in mono, and its description on one truncated line
      that expands on hover.
- [ ] The control matches the cvar kind: text input, select, toggle switch, or slider plus a
      numeric field.
- [ ] The value column shows the effective value and underneath either the engine default plus
      range, or "= default".
- [ ] A row whose value differs from the default is marked with a left accent bar, and the legend
      explains that marker.
- [ ] Per-row reset is always reachable and disabled when the value already is the default.
- [ ] Header shows "n cvars · m changed", a filter box and a "changed only" toggle; "Reset all"
      asks before discarding.
- [ ] When the profile is assigned nowhere (or only to engines with no facts), the existing
      explicit "no engine in scope" note appears above the list and no engine's numbers are
      claimed — the current honesty rule from story 009 stays intact.
- [ ] Engine caveats (mod-dependent value, above the assigned engine's clamp, cvar not present on
      the assigned engine) render as an inline flag row inside the affected row, naming the other
      assigned engines' numbers; a cvar the engine does not have is dimmed and disabled.
- [ ] Autosave behaviour and the shared draft (story 009) are unchanged — this is layout, not a
      new save path.
- [ ] Colours/spacing from design tokens; the prototype's hex values are reference only.

## Open Questions

- Filter and "changed only": session-local, or remembered per profile?
- The prototype shows ~30 cvars. Does the catalogue's full set need an "advanced cvars" collapse,
  or is the group + filter enough?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
