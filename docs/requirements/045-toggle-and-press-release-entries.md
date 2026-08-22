---
id: 045
title: Toggles, press/release pairs and wait chains as first-class entries
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Three constructs appear in essentially every serious Quake II config, mine included, and the
launcher can only hold them as opaque raw text. Story 041 imports them without mangling them, which
is the floor - this story is about the launcher actually understanding them, so the UI can show what
a key does instead of a wall of `;`-joined commands.

**Toggle by alias reassignment.** The engine has no toggle command, so configs build one by having
an alias rewrite the alias a key is bound to:

```
alias zoomin  "zoom_fov;zoom_sens;alias zoom zoomout"
alias zoomout "norm_fov;norm_sens;alias zoom zoomin"
alias zoom    "zoomin"
bind v "zoom"
```

Three aliases and a bind for one two-state switch. In the launcher that is three unrelated alias
rows and a bind pointing at one of them; nothing says "v toggles zoom".

**Press/release pairs.** `+x`/`-x` is the engine's own idiom for hold behaviour:

```
alias +slow "cl_forwardspeed 110; cl_sidespeed 110"
alias -slow "cl_forwardspeed 200; cl_sidespeed 200"
bind SHIFT "+slow"
```

The launcher already generates exactly this shape for hold layers (`+alt`/`-alt`) but cannot
represent a hand-written one as a pair - it is two independent alias rows that only convention ties
together, and renaming one silently breaks the other.

**`wait` chains.** `alias wait5 "wait; wait; wait; wait; wait"` and `wait20`/`wait50` built on top of
it. A frame-count helper, used by every rocket-jump and double-jump script. There is no reason for a
user to type five `wait`s.

## Acceptance Criteria

- [ ] A **toggle** entry kind: one entry, two states, each with its own command list and its own
      label. Rendered as the three-alias reassignment idiom above, with the generated names following
      story 039's naming rules.
- [ ] A toggle entry can be bound to a key like any other entry, and the keyboard overview shows it
      as one thing with two states rather than as whichever alias the key currently points at.
- [ ] A **press/release** entry kind: one entry with a press command list and a release command list,
      rendered as an `+x`/`-x` pair under one name. Renaming or deleting it moves both halves.
- [ ] Story 041's import recognises both idioms in a foreign config and produces the corresponding
      entry, not two or three loose aliases - and where the shape does not match exactly, it falls
      back to plain alias entries rather than guessing.
- [ ] A `wait` helper is available without typing `wait` n times: entering a frame count produces the
      chain, and an imported `waitN` alias family is recognised as one.
- [ ] Round-trip (story 042) holds for all three: render -> parse -> render is a fixed point and the
      entry kind survives.
- [ ] Care understands them: a toggle whose two states are cross-wired, a `+x` with no matching `-x`,
      and a release-only alias are each reported.
- [ ] The `alias` that rebinds a block of keys (`alias cali "bind KP_END fuck; bind ... "` in my
      config) is explicitly out of scope here - that is a layer-shaped construct and story 041's
      open question owns it.

## Open Questions

- Is a toggle its own `ActionEntryKind`, or a flag on a bind entry? A new kind touches every
  switch over `ActionEntryKind`; a flag makes the shape of `commands` conditional.
- The toggle idiom mutates an alias at runtime, so the file's static text no longer tells you which
  state a key is in. Does the launcher need to say anything about "state after `exec`", or is
  "starts in state 1" enough?
- Does a press/release entry replace the existing hold-layer mechanism for simple cases, or sit next
  to it? A hold layer rebinds keys, a press/release alias runs commands - related but not the same,
  and two overlapping ways to express "while I hold this" would be worse than one plus a clear
  boundary.
- Is `wait` a helper in the command editor, or a real command kind (`{ kind: 'wait'; frames: n }`)
  alongside `raw`/`message`? The latter round-trips cleanly but adds a third command shape.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
