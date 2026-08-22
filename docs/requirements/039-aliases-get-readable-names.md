---
id: 039
title: Aliases get readable names I control, and must be unique
status: ready # draft -> ready -> in-progress -> done
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

- ~~Renaming the display name of a referenced alias: rewrite every reference automatically, or
  refuse and tell the user which entries reference it?~~ answered → Decisions (Sprint)
- ~~What is the reserved-name list an own alias name is checked against?~~ answered → Decisions
  (Sprint)
- ~~Derived-name collisions between a built-in catalogue row and a user entry (both slugging to
  `railgun`) will be common. Warning only, or does a catalogue row get precedence?~~ answered →
  Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Renaming the display name of a referenced alias: refuse and name the referencing
  entries. Never silently rewrite references — the only option that cannot change a bind the user
  did not open.
- **(User)** Reserved-name list for an own alias name: `action-catalog.ts` + `cvar-catalog.ts` +
  the profile's own alias names is enough. A clash with an unknown engine command (not in that set)
  is accepted as a warning-only case, since no full engine command catalogue exists in this repo.
- **(User)** Derived-name collision between a catalogue row and a user entry: warning only for
  both, symmetric — no catalogue precedence. Consistent with the story's existing "never silently
  disambiguate" decision.
- Mirror ownership is **not** re-established with a new persisted ledger field but with the
  key-scoped `previousActions` rule story 034 already introduced, plus `q2l_a_` demoted to a
  *legacy-format* marker that the strip passes keep honouring forever — the only case the ledger
  would have covered beyond that is a `q2l_a_*` orphan written by an older version, which the
  legacy marker covers exactly, without adding a field to `ConfigProfile`, its two Zod schemas and
  every tidy-up/IPC path that carries a profile.
- The refactor is sequenced so the prefix stops being an *identity* test **before** the name
  generator flips (D3–D6 keep `q2l_a_` as the emitted name and stay green), rather than flipping
  name and ownership in one deliverable — a single flip-everything D would touch ~11 files and
  leave no reviewable intermediate state.
- The read-path migration (D6) lands **before** the name flip (D7), so a legacy profile is never
  read with new names and old references in between; the migration keys off `legacyAliasNameFor`,
  which is stable across the flip.
- Input-time rejection (AC 6) gates only the own-name field, while the Care collision warning
  (AC 5) reports every collision that exists in the state regardless of origin — a dialog can
  prevent what the user types, not what a display-name rename, an import or legacy data produced.
- `stripAliasActionBinds`/`stripAliasActionOverrides` become **legacy-only** (matching
  `legacyAliasNameFor`, not the current name): post-flip an alias entry's "synthetic bind-era name"
  equals its real alias name, so the current-name form would delete a legitimate
  `bind KP_END "drop_shotgun"` reference — exactly what story 041 is about to create.
- The existing `aliasDuplicate` rule is generalised to all entry kinds and downgraded from `error`
  to `warning` instead of adding a second rule, because the story's decision makes every collision
  symmetric and last-definition-wins, and a level split between "two alias entries" and "an alias
  entry vs a bind entry" would be arbitrary.
- A derived name that shadows a known engine command or cvar (`weapnext` from an entry named
  "Weapnext") gets its own Care warning rather than a silent suffix, because after the flip the
  writer would otherwise emit the dead, self-referential `alias weapnext weapnext`.
- The sign carry-over (`+slow`) applies to `kind: 'alias'` entries and to explicit own names only;
  a `kind: 'bind'`/`'message'` entry's derived name is slugged sign-free, or an adopted `+forward`
  catalogue row would derive the alias name `+forward` and shadow the engine command it runs.
- `isMirroredValue` gains an optional key parameter and its three callers pass it, because a
  prefix-free name makes "is this value one of ours" ambiguous against a hand-typed reference to
  the same alias — the fifth-place fix AC 7 asks for, in the same shape `bind-adoption.ts`'s
  `mirrorsSlot` already uses.
- The own-alias-name input goes into the existing `RenameActionDialog` rather than `ActionEditor`,
  so display name, derived alias name, the rejection reason and the "pin a name, then rename"
  escape hatch are all in one dialog.
- Out of scope, noted for its own story: `alias-suggestions.ts` still offers only `kind: 'alias'`
  entries for autocomplete, and story 041's importer should write a parsed alias name into the new
  `aliasName` field rather than relying on re-derivation.

## Plan

Depends on **038** landing first (it owns the alias-reference-detection function this story reuses
and the "no alias line for a directly bindable action" writer rule).

Two mechanisms change, in this order:

1. **Ownership** — `q2l_a_` stops being "a mirror wrote this" and becomes "an *older version* wrote
   this". Current-format ownership is the key-scoped rule story 034 already added: an entry is ours
   iff its value equals `bindValueFor(previousAction)` **on a key that previous action held**. All
   five prefix sites are converted while the emitted name is still prefixed, so every existing test
   stays green and the conversion is reviewable on its own.
2. **Naming** — `aliasNameFor` collapses to one rule for every kind: optional own `aliasName`
   verbatim, else sign-aware slug of the display name, no prefix, no id suffix. Budget 26 chars
   (31 usable − 4 `_p<n>` reserve − 1 sign).

Order and files:

- D1 `src/shared/modules/config.ts`, `src/shared/config/alias-render.ts`, both Zod schemas —
  `aliasName?` field, resolver honours it, `LEGACY_ACTION_ALIAS_PREFIX`/`legacyAliasNameFor` split
  out. Additive: no emitted name changes.
- D2 new `src/shared/config/alias-names.ts` — legal-character/length/reserved validation.
- D3 `action-mirror.ts` + `modifier-layers.ts` — strip passes use the legacy marker only.
- D4 `action-mirror.ts` (`isMirroredValue` key-scoped) + its three callers.
- D5 `bind-adoption.ts` + `keyboard-layout.ts` — skip/expand by alias name, not by prefix.
- D6 `src/main/lib/schemas.ts` — read-path migration of legacy references + legacy-only strip.
- D7 `alias-render.ts` — flip the derived default; update tests/fixtures + `profiles.ts` contract.
- D8 `validate-actions.ts` + `en.json` — collision warning, shadowed-command warning.
- D9 `ControlsTab.tsx` (`RenameActionDialog`) + `en.json` — own-name field, rename refusal.

Non-goals: no counter suffix anywhere, no new persisted profile field, no writer/render-format
change (that is 040), no importer change (041).

## Deliverables

### D1 — `aliasName` field and one name resolver (additive)

- `ConfigAction` gains `aliasName?: string` in `src/shared/modules/config.ts`, in
  `src/main/modules/config/schemas.ts` (`configActionSchema`, strict) and in
  `src/main/lib/schemas.ts` (`configActionPersistedSchema`, forgiving) — mirror the existing
  optional `catalogId` field in all three.
- `src/shared/config/alias-render.ts`: `aliasNameFor` returns `aliasName` verbatim (sign kept) when
  set; the derived path is **unchanged** for now (still `q2l_a_<slug>_<id4>`). Export
  `derivedAliasName(action)` for the UI's placeholder. Split the legacy pieces out under their own
  names: `LEGACY_ACTION_ALIAS_PREFIX` (same `'q2l_a_'` string) and `legacyAliasNameFor(action)`
  reproducing today's exact format; `ACTION_ALIAS_PREFIX` is re-exported from them so nothing
  breaks yet.
- `slugAliasName` (`alt-layers.ts`) gains an optional fallback argument (default `'layer'`) so an
  action whose name slugs to nothing becomes `entry`, not `layer`.
- Acceptance: `aliasNameFor({ aliasName: '+slow' })` → `+slow`; an action without `aliasName`
  renders exactly the same name as before this deliverable (existing `alias-render.test.ts`
  assertions unchanged); full suite green.

### D2 — Alias-name validation and the reserved-name set

- New `src/shared/config/alias-names.ts` (pure, `src/shared`): `validateAliasName(name, context)`
  → `{ ok: true } | { ok: false, reason, params }` with reasons `empty`, `illegalCharacters`,
  `tooLong`, `reserved`, `duplicate`. Rules: optional leading `+`/`-`, then `[a-z0-9_]+`; ≤ the
  budget from `MAX_ALIAS_NAME` (never a literal); reserved = first command token (raw and
  sign-stripped) of every `action-catalog.ts` row plus every `cvar-catalog.ts` `ALL_CVARS` name;
  duplicate = case-insensitive match against the other entries' resolved alias names, passed in as
  `context`.
- Export `reservedAliasNames()` so D8 can reuse the same set.
- Acceptance: unit tests per reason, including `weapnext` → `reserved`, `SSG` →
  `illegalCharacters`, `+slow` → ok, a 30-char name → `tooLong`.

### D3 — Mirror strip passes stop using the prefix as identity

- `src/shared/config/action-mirror.ts` and `src/shared/config/modifier-layers.ts`: the
  `startsWith(ACTION_ALIAS_PREFIX)` half of both strip rules becomes
  `startsWith(LEGACY_ACTION_ALIAS_PREFIX)`, documented as "an older version wrote this" — not "a
  mirror wrote this". Rewrite both doc comments so the current-format rule (key-scoped
  `bindValueFor(previousAction)` match) is stated as *the* ownership rule.
- New tests in `action-mirror.test.ts` and `modifier-layers.test.ts` built with prefix-free names
  (`aliasName: 'ssg_sg'`, available since D1) — they must fail if the strip ever falls back to a
  prefix test: a hand-typed `bind r "+attack"` and `bind x "some_alias"` survive a save; clearing a
  Controls slot clears its bind/override; a slot that gains a modifier loses its base bind; a
  deleted action leaves nothing behind.
- Acceptance: existing prefix-based tests still pass unchanged (the legacy marker is the same
  string), new prefix-free tests pass, suite green.

### D4 — `isMirroredValue` becomes key-scoped

- `src/shared/config/action-mirror.ts`: `isMirroredValue(value, actions, key?)` — with a key, only
  actions that actually hold that key (normalized, either slot) can own the value; without one, the
  old behaviour. Same shape as `bind-adoption.ts`'s `mirrorsSlot`; document why (a prefix-free name
  is indistinguishable from a hand-typed reference to the same alias).
- Callers pass their key: `src/renderer/src/modules/config/lib/bind-conflicts.ts:158`,
  `src/shared/config/tidy-up.ts:364`,
  `src/renderer/src/modules/config/lib/bind-slot-collision.ts:324`.
- Acceptance: a hand-typed override whose value equals another entry's alias name is reported as
  hand-made (not swallowed as a mirror); existing conflict/tidy-up tests green.

### D5 — Adoption and chain resolution without the prefix

- `src/shared/config/bind-adoption.ts`: drop the `startsWith(ACTION_ALIAS_PREFIX)` early return;
  instead skip a value that equals some action's `aliasNameFor` (an alias reference is not an
  adoptable command) in addition to the existing `mirrorsSlot` check. This is what keeps a
  single-token catalogue command used as an alias name (`weapnext`) from being re-adopted as that
  catalogue row.
- `src/renderer/src/modules/config/lib/keyboard-layout.ts`: `resolveAliasChain` drops the prefix
  gate and looks the value up in `actions` by `aliasNameFor` directly.
- Acceptance: `bind q "ssg_sg"` expands to the entry's command lines in the Overview; a bind whose
  value is an unknown token still falls through to the plain `;` split; an entry named `weapnext`
  is not re-adopted; `bind-adoption.test.ts` gains the prefix-free equivalents of its existing
  cases.

### D6 — Read-path migration of legacy names

- `src/main/lib/schemas.ts`, `normalizeConfigProfile`: a new pass, **before**
  `stripAliasActionBinds`/`adoptRawBinds`, that walks `binds` and every `layers[].overrides` and
  rewrites any value equal to `legacyAliasNameFor(action)` for an action in the profile to
  `bindValueFor(action)`; a `q2l_a_*` value matching no action is dropped (today's orphan
  behaviour). One pass, so nothing is unbound in between.
- `stripAliasActionBinds`/`stripAliasActionOverrides` (`modifier-layers.ts`) match
  `legacyAliasNameFor` instead of `aliasNameFor({ ...action, kind: 'bind' })`, with the reason in
  the doc comment (post-flip the current-name form would delete a legitimate
  `bind KP_END "drop_shotgun"` reference).
- Acceptance: `schemas.test.ts` — a persisted profile with `binds: { q: 'q2l_a_ssg_sg_9a2f' }` and
  the matching action reads back with `binds: { q: 'ssg_sg' }` (once D7 lands; before it, with the
  action's then-current value) and produces no findings; an orphan `q2l_a_gone_1234` is dropped; a
  hand-typed `bind x "some_alias"` is untouched; the read is idempotent.

### D7 — Flip the derived name to the readable one

- `src/shared/config/alias-render.ts`: the derived path becomes sign-aware slug of the display name
  with no prefix and no id suffix; the sign is carried only for `kind: 'alias'`. `SLUG_LENGTH`/
  `ID_SUFFIX_LENGTH` go away in favour of one budget derived from `MAX_ALIAS_NAME` minus the sign
  and the `_p<n>` reserve. `ownAliasName` and the generated path collapse into one function.
- Update the expected strings in `alias-render.test.ts`, `action-mirror.test.ts`,
  `modifier-layers.test.ts`, `bind-adoption.test.ts`, `bind-collision.test.ts`,
  `validate-structure.test.ts`, `schemas.test.ts`, `src/main/modules/config/render.test.ts`,
  `profiles.test.ts` (expected-value churn only — no logic in the tests changes).
- Rewrite the `setActions`/`setLayers` contract doc comments in
  `src/main/modules/config/profiles.ts` (the fifth prefix site): they must describe the key-scoped
  ownership rule and the legacy marker, never "binds whose value starts with `ACTION_ALIAS_PREFIX`".
- Do **not** reintroduce a prefix test anywhere; `ACTION_ALIAS_PREFIX` is removed as an export and
  only `LEGACY_ACTION_ALIAS_PREFIX`/`legacyAliasNameFor` remain.
- Acceptance: a rendered profile contains `alias ssg_sg "use super shotgun; use shotgun"` and
  `bind q "ssg_sg"`, no `q2l_a_` anywhere in the output; a `kind: 'alias'` entry named `+slow`
  still renders `+slow`; a split action's parts still fit `MAX_ALIAS_NAME`; suite green.

### D8 — Care warns about collisions and shadowed commands

- `src/shared/config/validate-actions.ts`: `aliasDuplicate` is generalised from
  `kind: 'alias'`-only to every action that has an alias name, level `warning`, params
  `{ name, entry, other }` (`other` = the other colliding entries' display names, joined) — mirror
  `undefinedAlias`'s two-entity param shape. No suffix is ever appended and nothing is renamed.
- New rule `aliasShadowsCommand` (warning, params `{ entry, name }`) when a resolved alias name is
  in `reservedAliasNames()` (D2).
- `src/renderer/src/i18n/locales/en.json` under `config.validation.actions`: update
  `aliasDuplicate`'s message to name both entries, add `aliasShadowsCommand`.
- Acceptance: two entries resolving to `railgun` (one catalogue row, one user entry) produce two
  warnings, each naming both entries and `railgun`, and the profile still renders both alias lines;
  an entry whose derived name is `weapnext` produces `aliasShadowsCommand`; no `error`-level finding
  for either case.

### D9 — UI: own alias name, and a rename that refuses instead of dangling

- `src/renderer/src/modules/config/ControlsTab.tsx` (`RenameActionDialog`, ~line 1395): a second,
  optional "Alias name" field whose placeholder is `derivedAliasName(action)`. Live validation via
  `validateAliasName` (D2) rendered through `Field`'s existing `error` prop
  (`src/renderer/src/components/ui/controls.tsx:37-67`); submit stays disabled while invalid.
  Clearing the field returns the entry to the derived name.
- Display-name rename refusal: when the entry's current alias name is referenced by anything other
  than the entry's own two mirror slots, the dialog refuses the display-name change and names the
  referencing entries, pointing at the own-alias-name field as the way to rename anyway. Reuse the
  reference-detection function story **038** introduces (extend it with an "ignore this action's own
  mirror" option) — do not build a second reference graph.
- `src/renderer/src/i18n/locales/en.json`: label, hint, one message per rejection reason, the
  refusal message. i18n keys only, never prose in main.
- Acceptance: setting `ssg_sg2` persists through `setActions` and shows up in the rendered file;
  `SSG SG`, `weapnext` and a 40-character name are each rejected with their own reason; renaming
  the display name of an entry referenced by a hand-typed `bind x "ssg_sg"` is refused with that
  reference named; renaming an unreferenced entry works.

## Model Hints

- D3 → `deliverable-hard` — this is the bind-eating deliverable: if the strip rule is drawn one
  step too wide a save silently deletes hand-typed binds and layer overrides, and if it is drawn
  too narrow a cleared Controls slot keeps firing; both are cross-file (base mirror + layer mirror
  must agree) and neither turns a test red on its own unless the new prefix-free cases are exactly
  right.
- D6 → `deliverable-hard` — a migration that runs on every read of every existing profile: getting
  the pass order or the legacy-vs-current name distinction wrong leaves a real profile unbound, or
  deletes the `bind KP_END "drop_shotgun"` reference story 041 depends on, on first launch and
  before anyone can look.
- All other deliverables → default tier. D7 is wide but mechanical (expected-string churn that
  fails loudly), D9 is ordinary renderer work against an existing dialog.
- Review: → `story-review-hard` — the story reworks a five-place ownership mechanism plus a data
  migration whose failure mode is silent bind loss in an existing profile; a cheap review reading
  only the diff would accept a plausible-looking strip rule.

## Test Plan (manual acceptance)

Run against the existing `Hantsch - Test` profile (it carries pre-039 `q2l_a_*` state, which is the
migration case).

1. **Migration on read.** Start the launcher, open Config → Controls for `Hantsch - Test`. Every
   entry still shows the keys it had before; the Care tab shows no new errors.
2. **Readable names in the file.** Config → Raw File: the rendered file contains
   `alias ssg_sg "use super shotgun; use shotgun"` and `bind q "ssg_sg"`, and no `q2l_a_` anywhere.
3. **Own name, accepted.** Controls → the "SSG + SG" entry → rename dialog: the Alias name field is
   empty with placeholder `ssg_sg`. Type `ssg_sg2`, save. Raw File now shows
   `alias ssg_sg2 …` / `bind q "ssg_sg2"`.
4. **Own name, rejected.** Same dialog: `SSG SG` → rejected ("only a-z, 0-9, _"); `weapnext` →
   rejected (reserved command); a 40-character name → rejected (too long). Save stays disabled in
   each case, and nothing is silently slugged.
5. **Press/release sign.** Create a `kind: 'alias'` entry named `+slow`; Raw File contains
   `alias +slow …` with the sign intact.
6. **Collision warning.** Add a second entry whose display name also slugs to `ssg_sg` (e.g.
   "SSG SG") with no own name. The Care tab shows a warning per entry naming *both* entries and
   `ssg_sg`; no counter suffix appears anywhere; the file still contains both alias lines.
7. **Rename refusal.** On the Overview keyboard, bind an unused key by hand to `ssg_sg2`. Then open
   the entry's rename dialog and change the display name: refused, with the referencing bind named
   and the Alias name field offered as the way through. Change the alias name instead → accepted.
8. **Hand-typed binds survive.** With `bind r "+attack"` and `bind x "some_alias"` hand-entered on
   the Overview keyboard, change something in Controls and save. Both binds are still there in Raw
   File. Clear a Controls slot and save: that key's bind is gone.

## Done
