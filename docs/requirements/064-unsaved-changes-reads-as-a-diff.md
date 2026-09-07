---
id: 064
title: Unsaved changes read as a real diff
status: draft
created: 2026-09-07
---

## Requirement

The Unsaved tab tells the user *that* something is pending but not *what* changed. Story
[[049-unsaved-changes-reviewable-and-discardable]] built a structured change list
([ProfileChangeList.tsx](../../src/renderer/src/modules/config/components/ProfileChangeList.tsx))
over a change set whose model already carries `before`/`after` per change
([profile-diff.ts:90-97](../../src/shared/config/profile-diff.ts#L90-L97)) — but on screen the user
cannot read off what a Save would actually write. Reported verbatim: "Unsaved changes are no clean
diff, I don't know what changed."

Wanted: every pending change states the concrete old value and the concrete new value, side by
side, for the thing it names — a cvar's value, a key's bind, an entry's command body, a layer's
trigger — so the tab answers "what will this Save do?" without going to the Raw File tab and
comparing by eye.

The screenshot that came with the report is not in the repo, so which section reads worst is not
established. Refine must first check, per section (`cvars`, `binds`, `actions`, `layers`,
`settings`, `unrecognized`), whether the change set even *produces* a usable `before`/`after` today
or whether some sections emit prose/counts — a rendering fix cannot show a value the diff never
computed.

The existing decision from story 049 (a structured list, **not** a text diff of the rendered file)
stays: the goal is a readable per-item before → after, not a patch view.

## Acceptance Criteria

- [ ] **AC1** — Every pending change in the Unsaved tab shows the value before and the value after,
      both concrete, for the item it names.
- [ ] **AC2** — Added and removed items are distinguishable from modified ones (an added item has no
      "before", a removed one no "after") without relying on colour alone.
- [ ] **AC3** — No section reports a change as a bare count or as prose without naming the affected
      item.
- [ ] **AC4** — The change set behind the tab is unchanged in scope: the same changes are listed as
      before, only more legibly — the count in the header badge still matches the list.
- [ ] **AC5** — A long value (a multi-command entry body) stays readable and does not blow up the
      row height or overflow the panel.

## Open Questions

- [ ] Screenshot: which section(s) did the report look at? (Report referenced an image that did not
      reach the repo.)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
