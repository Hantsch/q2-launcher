---
id: 039
title: Aliases get readable names I control, and must be unique
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

`bind q "q2l_a_ssg_sg_9a2f"` is a machine name. In the UI that entry is called **SSG + SG**; in
the file there is no trace of it. Players keep their configs for years, share them, read them and
edit them by hand — a name with a uuid fragment in it says "a program owns this file", which is
exactly the opposite of what I want the launcher to produce. Compare a real config:

```
alias drop_rail  "drop railgun; drop slugs; say_team ... [ Rail Gun ] ...; wave 1"
alias s_support  "say_team $r [ ENEMYS ] ... $loc_there $r"
alias zoom_fov   "fov 60"
```

Short, lowercase, speaking, no prefix, no id. That is what an alias name should look like.

Decided with the user:

- The default name is **derived from the entry's display name** (`SSG + SG` → `ssg_sg`), readable
  and prefix-free.
- The user can **override** it with an own name, validated against the engine's alias-name rules.
- Alias names must be **unique** within a profile. A collision is reported as a **warning** — the
  launcher never silently disambiguates with a counter suffix, because a counter suffix is how
  `q2l_a_..._9a2f` happened in the first place and it hides the fact that two entries are fighting
  over one name.

The risk this carries, and why it is not a rename: `ACTION_ALIAS_PREFIX` (`q2l_a_`) is currently
used as an *identity test* — "a bind value starting with this prefix was written by a mirror pass,
so I may strip it". Five places rely on it: `src/shared/config/action-mirror.ts`,
`src/shared/config/modifier-layers.ts`, `src/shared/config/bind-adoption.ts`,
`src/renderer/src/modules/config/lib/keyboard-layout.ts` and the contracts documented in
`src/main/modules/config/profiles.ts`. Once an alias is called `ssg_sg`, that test is gone and
mirror ownership has to be established some other way, or a save will start eating hand-typed
binds. This story is only done when that is solved, not worked around.

## Acceptance Criteria

- [ ] Every action's alias renders under a readable name derived from its display name — lowercase,
      `[a-z0-9_]`, no `q2l_a_` prefix, no id fragment, within the engine's alias-name budget.
- [ ] A press/release entry keeps its sign (`+slow`/`-slow`), the rule `ownAliasName` already
      applies to `kind: 'alias'` entries today.
- [ ] Each entry has an optional own alias name. Set, it is used verbatim (after validation); unset,
      the derived name is used and follows the display name when that is renamed.
- [ ] Editing the display name of an entry whose alias is referenced elsewhere either updates the
      references or refuses — it never leaves a dangling reference behind. Which of the two is an
      open question below.
- [ ] Two entries resolving to the same alias name produce a Care **warning** naming both entries
      and the colliding name. No counter suffix is ever appended, and the file is still written (the
      engine's last-definition-wins behaviour is what the warning describes).
- [ ] An own name that is not a legal alias name, collides with a reserved/engine command, or
      exceeds the length budget is rejected at input time with a reason, not silently slugged.
- [ ] Mirror ownership no longer depends on a name prefix: a save on a profile with hand-typed binds
      (`bind r "+attack"`, `bind x "some_alias"`) leaves them untouched, and clearing a Controls slot
      still really clears its bind. Covered by tests in all five places listed above.
- [ ] Existing profiles migrate on read: every action gets its derived name, no `q2l_a_*` name
      survives a save, and `binds`/`layers[].overrides` referencing the old names are rewritten in
      the same pass so nothing is unbound in between.
- [ ] A profile whose file still contains old `q2l_a_*` names on disk is not treated as foreign or
      broken — the next write replaces them.

## Open Questions

- Renaming the display name of a referenced alias: rewrite every reference automatically, or refuse
  and tell the user which entries reference it? Automatic rewrite is friendlier; refusing is the
  only option that cannot silently change a bind the user did not open.
- What is the reserved-name list an own alias name is checked against? There is no full engine
  command catalogue in this repo (`validate-actions.ts` says so explicitly) — is
  `action-catalog.ts` + `cvar-catalog.ts` + the profile's own alias names enough, and is a clash
  with an unknown engine command accepted as a warning-only case?
- Derived-name collisions between a built-in catalogue row and a user entry (both slugging to
  `railgun`) will be common. Warning only, or does a catalogue row get precedence and the user entry
  the warning?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
