---
id: 019
title: Controls — type the entry, not the category, and let me order entries
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

Today a category carries the type (`ConfigActionCategory.entryKind`), so a category is either
binds *or* messages *or* aliases. That is the wrong axis: a category is just a drawer I named,
and what is typed is the individual entry.

An entry is one of three kinds:

- **binding** — I give it a name and say what happens; what happens is either a **command** or a
  **message**. It is assignable to a key like every other entry.
- **message** — a named chat message (say / say_team); also assignable to a key.
- **alias** — defines a command or wraps several commands. An alias is **not** bindable; it exists
  to be referenced by bindings.

Because an alias has to be *defined before it is used*, I need to control the order of entries
inside a category, e.g.:

```
| + test  {command}
| - test  {command}
| Test binding (+test)   [ empty ]
```

This story is the data model and the mechanics; the visual redesign of the tab is story 020.

## Acceptance Criteria

- [ ] `entryKind` is gone from categories (built-in and custom); creating/renaming a category no
      longer asks for a type.
- [ ] Every entry carries its own kind (`bind` | `message` | `alias`) chosen when it is created,
      and shows it as a badge in the list.
- [ ] A binding entry's payload is either a command or a message, editable in place; a message
      entry edits its channel + text; an alias entry edits one or more commands.
- [ ] An alias entry has no key slot at all, and binding a key to an alias entry is impossible
      through the UI rather than merely discouraged.
- [ ] A binding can reference an alias by name (e.g. `+test`), with the profile's own aliases
      offered while typing.
- [ ] Entries inside a category can be reordered by hand, the order persists, and the rendered
      config emits them in that order — an alias always before the binding that uses it.
- [ ] Existing profiles keep working: an entry's kind is derived from its old category's
      `entryKind` on load, no profile is dropped or reset, and no saved profile has to be
      re-created by hand.
- [ ] A binding that references an undefined alias, and an alias never referenced by anything,
      are both reported (Care tab, story 025) rather than written out silently broken.

## Open Questions

- **binding vs. message overlap:** a binding whose payload is a message and a keyed message entry
  are the same thing to the engine. Keep both kinds (message = a binding preset for chat) or
  collapse "message" into a binding's payload type and drop the third kind?
- Persisted-schema change: derive the entry kind on read (forgiving, no version bump) or migrate
  once in `state.json` with a `STATE_SCHEMA_VERSION` bump?
- Ordering: an explicit `order` number per entry, or array position as the order (and then the
  IPC contract must guarantee order preservation)?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
