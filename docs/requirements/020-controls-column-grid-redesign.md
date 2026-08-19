---
id: 020
title: Controls — rename Advanced and rebuild it as the column grid prototype
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

The tab called "Advanced" is where I bind things, so it should be called **Controls**. Its
current layout feels empty and unreadable: rows stretch across the whole window, an unbound slot
is invisible, and nothing tells me which column is what.

It should look and work like the prototype
[docs/prototypes/bindings/a-column-grid.html](../prototypes/bindings/a-column-grid.html) —
a dense, capped-width table with always-visible bind cells, the way a game's control settings
look.

Purely the tab's presentation and interaction; the entry-type/ordering model is story 019 and
should land first.

## Acceptance Criteria

- [ ] The tab is labelled "Controls" everywhere (tab strip, i18n key, any cross-references).
- [ ] Content width is capped (~1120px) instead of filling an ultrawide window.
- [ ] Sticky column headers: Action · (reset) · Primary · Secondary · Options.
- [ ] Rows are 40px, zebra-striped, with a hover highlight and a per-row reset action that only
      appears on hover.
- [ ] An action row shows its name plus its command in mono as a secondary label.
- [ ] Every bind slot is an always-visible filled cell — an unbound slot reads "Empty" rather
      than being blank; a bound slot shows the key; the primary slot of a bound row is visually
      the strongest element in the row.
- [ ] Clicking a slot enters capture ("Press a key…", dashed pulsing border); ESC cancels, DEL
      clears, and the footer states exactly that.
- [ ] A modifier-captured key renders its modifier as a small cap inside the slot (`ALT R`) and
      the Options column names the layer it went into.
- [ ] A conflicting bind is marked on the slot and the Options column names what else uses that
      key; the header shows a conflict count.
- [ ] Entries are visually grouped inside a category (group rule + label + count), matching the
      prototype's "Use weapon" / "Cycling" grouping.
- [ ] A filter box narrows rows by action name and command; the footer shows "n rows · m bound".
- [ ] "Restore defaults" is reachable from the header and asks before it discards binds.
- [ ] Colours, radii and spacing come from the design tokens — the prototype's hex values are
      reference, not implementation, and no raw hex or palette class ends up in the code.

## Open Questions

- The prototype shows category tabs (Movement / Weapons / Weapon dropping / + New category). With
  019's untyped categories and free reordering, does the tab strip scale to many custom
  categories, or should it become a scrollable rail?
- "Restore defaults": per category or for the whole profile? And what is "default" for a custom
  category with no catalogue rows?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
