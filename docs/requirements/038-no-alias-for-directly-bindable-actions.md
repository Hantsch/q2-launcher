---
id: 038
title: No alias line for an action the engine can bind directly
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

My profile's `.cfg` is full of alias lines nothing ever calls:

```
alias q2l_a_attack_3137 +attack
alias q2l_a_moveup_8b20 +moveup
alias q2l_a_moveleft_f466 +moveleft
alias q2l_a_movedown_4a6a +movedown
alias q2l_a_moveright_911f +moveright
alias q2l_a_back_ecc0 +back
alias q2l_a_forward_867b +forward
```

`+attack` and `+moveup` should not be aliases in the first place — and they are not: the bind
mirror already writes `bind MOUSE1 "+attack"` directly. The alias is emitted anyway and then
referenced by nobody. Seven dead lines in a nine-bind profile.

Care does not catch it and cannot: `validate-actions.ts`' `aliasUnreferenced` rule only looks at
`kind: 'alias'` entries, and even if it saw these, "removing" them would be pointless — they are
regenerated on the next write. This is a writer bug, not a tidy-up gap. A generated file must not
contain a line that does nothing, the same rule `renderActionAlias` already applies to an action
with no usable commands.

Root cause: story 034 made a continuous catalogue row mirror as its own command text
(`bindValueFor` in `src/shared/config/action-mirror.ts`), while
`renderActionAliasLines` in `src/shared/config/alias-render.ts` kept emitting one alias per
action unconditionally.

## Acceptance Criteria

- [ ] An action whose mirrored bind value is its own command (`bindValueFor(action) !==
      aliasNameFor(action)`) and whose alias name is referenced by nothing in the profile emits no
      alias line.
- [ ] An action whose alias name *is* referenced — from a base bind, a layer override, another
      action's command, or a layer's generated alias body — keeps its alias line. `q2l_a_ssg_sg_9a2f`
      (`bind q`) and `q2l_a_drop_shotgun_b623` (layer "Alt") in my profile must survive.
- [ ] Reference detection is one function shared with whatever else asks "does anything call this
      alias", not a second copy of the reference graph.
- [ ] A rendered profile file never contains an `alias <name>` line whose name appears nowhere else
      in the same file — asserted as a property test over the fixture profiles, not only over one
      hand-built case.
- [ ] Saving my existing `Hantsch - Test` profile removes exactly those seven lines and changes
      nothing else in the file.
- [ ] No behaviour change for `kind: 'alias'` entries (they exist to be called by name and may
      legitimately be unreferenced — that is Care's `aliasUnreferenced` warning, not the writer's
      business).

## Open Questions

- Should the writer also drop the alias of a *keyless, unreferenced* `kind: 'bind'` action (an
  action the user made but never bound and never called)? It is equally dead in the file, but
  unlike the catalogue case it is content the user authored and may be about to bind.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
