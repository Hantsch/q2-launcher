---
id: 008
title: Advanced tab — categories, messages, macros, symbol picker
status: draft
created: 2026-08-16
---

## Requirement

As a user, I want an Advanced tab where I can organize commands into categories, build team
messages that mix free text with meta-variables and server macros, pick latin-1 symbols/colours
for message text, and compose multi-command binds, so I can build the kind of rich message and
action binds `q2-config-manager` supported without memorizing escape codes or byte limits by
hand.

See [docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)
("Advanced").

## Acceptance Criteria

- [ ] Commands/binds can be grouped into categories: the built-ins (Movement, Weapons, Weapon
      dropping) plus user-defined custom categories.
- [ ] A message editor composes a message mixing literal text, `$$loc_here`-style
      meta-variables and server-substituted macros (`%l`, `%h`, `%a`), visually distinguishing
      the two kinds.
- [ ] A symbol/colour picker inserts latin-1 high-ASCII characters into message text,
      round-tripped byte-for-byte — never re-encoded as UTF-8.
- [ ] Multi-command actions (several console commands under one bind) can be composed and are
      auto-split across lines when they would exceed the engine's 1024-byte per-line
      `Cbuf_Execute` limit.
- [ ] Edits are saved on the profile and reflected in the overview tab and the write pipeline.

## Open Questions

_None yet — flesh out category/message data shape during refine._

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
