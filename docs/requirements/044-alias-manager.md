---
id: 044
title: One surface to manage every alias in a profile
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Aliases are the backbone of a real Quake II config. My own `dmalias.cfg` is roughly ninety of them,
and they are structured deliberately: status messages (`s_ok`, `s_neg`, `s_support`), weapon
switches that each call a per-weapon settings hook (`blaster` -> `blaster_settings`), drop
commands that also announce themselves in team chat, helper chains (`wait5`, `wait20`, `wait50`),
and a `dall` that calls a dozen drops in one go.

The launcher has no place to see that. An alias is a row inside a category on the Controls tab,
next to binds and messages, and the things that actually matter about an alias are the things that
view cannot show:

- **What is the name space?** Which names are taken - by my entries, by generated entry aliases, by
  the launcher's own layer aliases (`+alt`/`-alt`). Uniqueness is a hard rule after story 039, so
  the user needs to see it.
- **Who calls this?** An alias exists to be referenced. `blaster_settings` is called from
  `blaster`; `wait5` from `wait20`; `ssg_sg` from `bind q`. Without that, deleting one is a guess.
- **What does nothing call?** Care warns about it, but the fix belongs where the aliases live.
- **How long is it?** An alias body has a hard engine line budget (`alias-render.ts` splits into
  `_p1`/`_p2` chunks when it overflows) and a user writing a `dall`-sized chain needs to see that
  before it silently becomes three lines.

## Acceptance Criteria

- [ ] One surface lists every alias name that exists in the profile in one table: user-authored
      `kind: 'alias'` entries, the aliases generated for keyed entries, and the layer aliases the
      launcher emits - each labelled with which of the three it is.
- [ ] Generated and layer aliases are shown read-only, with a link to the entry or layer that owns
      them. They are in the list because they occupy names, not because they are editable here.
- [ ] Each row shows: name, body (or a truncated body with the full text on demand), what
      references it, and the rendered line length against the engine budget.
- [ ] References are shown per alias and are complete: base binds, layer overrides, other aliases'
      bodies, and other entries' commands. "Nothing references this" is a distinct, explicit state,
      not an empty list the user has to interpret.
- [ ] Creating, renaming, editing and deleting a user alias is possible from here, including the own
      alias name from story 039.
- [ ] A rename either updates every reference or refuses with the list of referencing entries -
      whichever story 039 decided. It never leaves a dangling reference.
- [ ] Deleting an alias that is still referenced requires an explicit confirmation naming the
      referencing entries.
- [ ] A duplicate name is flagged inline on both rows (story 039's warning), with no auto-suffixing.
- [ ] Care's `unreferencedAlias` / `undefinedAlias` / `duplicateAlias` rows link here, and this
      surface and Care never disagree about what is referenced - one reference graph, one function.
- [ ] Sorting/filtering at least by name and by "unreferenced only".
- [ ] The surface is in `ui:verify`'s screen registry, screenshotted and axe-clean, per
      `docs/UI-VERIFICATION.md`.
- [ ] `/frontend-guidelines` and `/design-tokens` hold - no image assets, tokens only, keyboard
      reachable.

## Open Questions

- Where does it live: a new tab next to Controls/Settings/Care, a panel inside Controls, or a
  full-screen dialog opened from Controls and from Care? A fifth tab is the clearest but the tab bar
  is already busy.
- Does the Controls tab keep showing alias rows inside categories, or do aliases move here entirely?
  Story 019 deliberately put them next to the binding that references them.
- Does this surface get an editor for the body, or does it reuse the existing action editor drawer?
- Are read-only generated aliases shown by default or behind a toggle? Showing them makes the name
  space complete; hiding them keeps the list about what the user actually wrote.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
