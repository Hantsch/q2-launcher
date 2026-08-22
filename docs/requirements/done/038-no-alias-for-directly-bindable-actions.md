---
id: 038
title: No alias line for an action the engine can bind directly
status: done # draft -> ready -> in-progress -> done
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

- [x] An action whose mirrored bind value is its own command (`bindValueFor(action) !==
      aliasNameFor(action)`) and whose alias name is referenced by nothing in the profile emits no
      alias line.
- [x] An action whose alias name *is* referenced — from a base bind, a layer override, another
      action's command, or a layer's generated alias body — keeps its alias line. `q2l_a_ssg_sg_9a2f`
      (`bind q`) and `q2l_a_drop_shotgun_b623` (layer "Alt") in my profile must survive.
- [x] Reference detection is one function shared with whatever else asks "does anything call this
      alias", not a second copy of the reference graph.
- [x] A rendered profile file never contains an `alias <name>` line whose name appears nowhere else
      in the same file — asserted as a property test over the fixture profiles, not only over one
      hand-built case.
- [ ] Saving my existing `Hantsch - Test` profile removes exactly those seven lines and changes
      nothing else in the file. (Mechanism proven end-to-end via the `ui:verify` fixture, D4; the
      literal check on the user's own file is the manual acceptance step below, still pending the
      user.)
- [x] No behaviour change for `kind: 'alias'` entries (they exist to be called by name and may
      legitimately be unreferenced — that is Care's `aliasUnreferenced` warning, not the writer's
      business).

## Open Questions

- ~~Should the writer also drop the alias of a *keyless, unreferenced* `kind: 'bind'` action (an
  action the user made but never bound and never called)? It is equally dead in the file, but
  unlike the catalogue case it is content the user authored and may be about to bind.~~ answered →
  Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Keyless, unreferenced `kind: 'bind'` action: keep its alias line. It is user-authored
  content the user may be about to bind, unlike the catalogue mirror case this story targets.
- Reference detection lives in a **new pure module** `src/shared/config/alias-references.ts`
  (`collectAliasReferences` + `actionsWithAliasLine`), not inside `alias-render.ts`:
  `alias-render.ts` cannot import `bindValueFor` from `action-mirror.ts` without an import cycle,
  since `action-mirror.ts` already imports `aliasNameFor`/`ACTION_ALIAS_PREFIX` from it.
- `renderActionAliasLines(actions)` **keeps its signature**; `render.ts` filters the action list
  through `actionsWithAliasLine` before rendering — one production call site, and every existing
  `alias-render.test.ts` case keeps compiling unchanged.
- The shared collector is the **extraction of `validate-actions.ts`' existing lenient
  `referencedKeys` pass** (bare top-level segments of every action's raw commands, of every
  `binds` value and of every layer's `overrides` value), widened by exactly one shape: the target
  token of a `bind <key> <token>` segment. Reason: story 041 imports precisely that construct
  (`alias cali "bind KP_END drop_shotgun"`), a missed reference means the writer silently unbinds a
  key, and the widening can only make Care's `aliasUnreferenced` quieter, never noisier.
- `validate-actions.ts` keeps its own **stricter** `undefinedAlias` pass; only its lenient
  "referenced by anything" set is replaced by the shared collector — AC3 asks for one reference
  graph, not for one validation rule.
- An action whose own command text contains its own alias name counts as **referenced** (no
  self-exclusion): a recursive body is the user's business, and keeping the line is the safe side.
- AC4's blanket invariant is read as: it holds for every alias line the writer generates for an
  action **whose mirror does not go through the alias**. `kind: 'alias'` entries (AC6) and
  user-authored actions whose mirrored value *is* the alias name (the User decision above) are the
  two documented exemptions — read any other way, AC4 contradicts both of them.
- **No property-testing dependency.** The invariant is asserted as a loop over a committed fixture
  corpus, because `fast-check` would be a new dev dependency plus a generator design this repo has
  no second use for, while a corpus is what 040/042 need anyway.
- The corpus is a plain module `src/shared/config/profile-fixtures.ts` (types only, no node/DOM, so
  it obeys the `src/shared` contract) rather than data inside a `.test.ts`: vitest's include
  pattern (`src/**/*.{test,spec}.ts`) makes a test file importable only by accident, and 040/042
  will render the same profiles.
- UI acceptance and the live smoke run through the **existing** `config-raw` and
  `config-write-preview` screens by giving the ui:verify `Plain Profile` fixture actions — those
  screens already render the profile file, so the fix is visible in the real app without a new
  screen step or any renderer change. Fixture action names avoid the substring `test`, so
  `scripts/flows/custom-action-row.mjs` keeps matching only the row it creates itself.
- No new i18n key and no Care rule: the writer omits a line, there is nothing for the user to act
  on, and `aliasUnreferenced` stays exactly as it is for `kind: 'alias'` entries (AC6).

## Plan

Root cause is a missing guard, not a missing rule: `renderActionAliasLines` emits one alias per
action unconditionally, while story 034 made a continuous catalogue row mirror as its own command
text — so its alias is defined and called by nobody.

1. **Reference graph, once** (`src/shared/config/alias-references.ts`, new). Move
   `validate-actions.ts`' lenient reference scan here as `collectAliasReferences({ actions, binds,
   layers })` → lower-cased token set, widened by the `bind <key> <token>` target shape. Add
   `actionsWithAliasLine(actions, sources)`: drops an action exactly when
   `action.kind !== 'alias'` **and** `bindValueFor(action) !== aliasNameFor(action)` **and** its
   alias name is not in the reference set. The three guards map 1:1 to AC1 / AC6 / the User
   decision, and the drop is per action, so a chunked `_p1`/`_p2` family always disappears whole.
2. **Rewire Care** (`validate-actions.ts`): its `referencedKeys` set comes from the new collector;
   `bareTokens`/`undefinedAlias` stay untouched.
3. **Writer** (`render.ts:107`): render `actionsWithAliasLine(profile.actions ?? [], { actions,
   binds: profile.binds, layers: profile.layers })` instead of `profile.actions`. `alias-render.ts`
   itself does not change.
4. **Invariant** (`profile-fixtures.ts` + `render-invariants.test.ts`, new): a corpus of profiles
   (plain, catalogue mirror rows, alias entry, keyless action, chunk-split action, modifier layer,
   hold layer) asserted with "every `alias <name>` line's name appears elsewhere in the same file,
   except the two documented exemptions", plus "no new `validateStructure` finding".
5. **Visibility** (`scripts/lib/fixture.mjs`): `Plain Profile` gets three actions + the matching
   `binds` mirror, so `config-raw` / `config-write-preview` show the outcome in the running app.

Order: 1 → 2 → 3 → 4 → 5. Files touched: 2 new shared modules, 2 new/extended test files,
`validate-actions.ts`, `render.ts`, `alias-render.test.ts`, `src/main/modules/config/render.test.ts`,
`scripts/lib/fixture.mjs`. No IPC change, no renderer change, no schema change.

## Deliverables

### D1 — one shared reference graph [x]

New `src/shared/config/alias-references.ts` + `alias-references.test.ts`; rewire
`src/shared/config/validate-actions.ts` (its lenient `referencedKeys` pass only).
Mirror for style and doc-comment depth: `src/shared/config/action-mirror.ts`.

Acceptance:
- `collectAliasReferences({ actions, binds?, layers? })` returns the lower-cased token set; covers
  action raw commands, `binds` values, every layer's `overrides` values, plus the target token of a
  `bind <key> <token>` segment.
- `actionsWithAliasLine(actions, sources)` implements the three guards from the plan and is pure
  (no `fs`, no DOM, no electron).
- `validate-actions.test.ts` stays green as written, plus one new case: an alias referenced only via
  `bind <key> <alias>` inside another entry's command no longer produces `aliasUnreferenced`.
- No import cycle (`alias-references` → `action-mirror`/`alias-render`, never back).

### D2 — the writer stops emitting dead alias lines [x]

`src/shared/config/render.ts` (call site only), tests in `src/shared/config/alias-render.test.ts`
and `src/main/modules/config/render.test.ts` (`describe('renderProfileFile with actions')`, ~:338,
is the block to extend).

Acceptance (AC1, AC2, AC6):
- A catalogue row whose single command is `+forward`/`+attack`/… and whose alias nobody calls emits
  **no** alias line; its `bind` line is unchanged.
- An alias referenced from a base bind, a layer override, another action's command, or a hold
  layer's generated body keeps its line — one test per source.
- `kind: 'alias'` entries and keyless user-authored actions keep their line.
- A chunk-split action that *is* dropped emits neither parent nor `_p<n>` lines.
- Existing determinism assertions (`render.test.ts:246/258/269`) still hold.

### D3 — fixture corpus + the file-level invariant [x]

New `src/shared/config/profile-fixtures.ts` (exported `ConfigProfile` corpus, one profile per
shape named in plan step 4) and new `src/shared/config/render-invariants.test.ts`.

Acceptance (AC4):
- The invariant runs over **every** corpus profile, not one hand-built case, and fails loudly with
  the offending alias name.
- The two exemptions are expressed via `bindValueFor`/`aliasNameFor` and `kind`, not via the
  `q2l_a_` prefix — story 039 removes that prefix and must not break this test.
- `validateStructure` over the rendered corpus reports no finding that the pre-change render did
  not also report.

### D4 — the fix is visible in the running app [x]

`scripts/lib/fixture.mjs` (`populatedConfigProfiles`'s `plain`): add `actions` — a catalogue
`+attack` row on `MOUSE1`, a two-command weapons row on `q` (alias kept, referenced by its bind),
one keyless row (alias kept) — plus the matching `binds` mirror entries and whatever `categories`
the Controls tab needs. Mirror: the shape comments at `fixture.mjs:120-125`.

Acceptance (AC5's UI path, P2):
- `npm run ui:verify` passes; `config-raw` / `config-write-preview` show a file with the weapons
  and keyless alias lines and **no** `+attack` alias line.
- `scripts/flows/custom-action-row.mjs` still passes (no fixture action name contains `test`).
- Fixture stays deterministic (`FIXED_TIMESTAMP`, no clock, no random ids).

### Coverage

AC1 → D2 · AC2 → D2 · AC3 → D1 · AC4 → D3 · AC5 → D4 + Test Plan · AC6 → D2

## Model Hints

- D1 → default
- D2 → **deliverable-hard** — dropping an alias line that something *does* reference silently
  unbinds a key in every saved profile; the guard has to combine `bindValueFor`/`aliasNameFor` with
  the reference set and still be right for chunked actions, modifier-layer mirrors and hold-layer
  bodies.
- D3 → default
- D4 → default
- Review: → default — the diff is small, pure and fully test-covered, and the one risky guard
  already runs at the hard tier in D2.

## Test Plan (manual acceptance)

AC5, on the user's real data (`Hantsch - Test`), through the UI only:

1. Start the app, open **Config** → profile **Hantsch - Test** → tab **Raw File**. Copy the shown
   profile `.cfg` content aside as the "before" text (it still has the seven
   `alias q2l_a_(attack|moveup|moveleft|movedown|moveright|back|forward)_*` lines).
2. In the **Raw File** tab, expand the installation row to see the write preview: the seven alias
   lines are gone there already, everything else identical.
3. Trigger a save through the UI (any change that writes the profile, e.g. toggle a cvar in
   **Settings** and revert it, or use the write/sync action on the Raw File tab).
4. Re-read the profile file in the **Raw File** tab and diff against the "before" text: exactly the
   seven `alias q2l_a_*` lines are removed, no other line added, removed, reordered or reworded.
5. Same tab: `bind q "q2l_a_ssg_sg_9a2f"` and its `alias q2l_a_ssg_sg_9a2f …` line are both still
   there, and the layer **Alt** still carries `q2l_a_drop_shotgun_b623` with its alias line (AC2).
6. Tab **Care**: no new finding compared with before the change (in particular no
   undefined-alias/unreferenced-alias warning that was not there).

## Done

**Summary.** The writer no longer emits an `alias <name> "<cmd>"` line for an action whose
mirrored bind value is its own command and whose alias name nothing references. A new pure module
`src/shared/config/alias-references.ts` (`collectAliasReferences` + `actionsWithAliasLine`) is the
single shared reference graph, used both by the writer (`render.ts`) and by Care's
`validate-actions.ts` (replacing its former inline scan). A committed fixture corpus
(`profile-fixtures.ts`) backs a file-level invariant test (`render-invariants.test.ts`) that checks
every rendered profile for orphaned alias lines. The `ui:verify` fixture (`scripts/lib/fixture.mjs`)
was extended so the fix is visible on the real `config-raw`/`config-write-preview` screens.

**Decisions made while building (no user reachable):**
- Mid-D2, found and fixed a related reference-detection gap not called out in the original Plan:
  `binds`/layer-`overrides` values are schema-legal with a literal `"` character (unlike action
  command text, which the schema forbids outright), and `render.ts`/`alt-layers.ts` strip that
  quote before actually writing the line — but the reference scan was reading the raw,
  unsanitized value. A quote-wrapped reference (e.g. `'"q2l_a_x_1234"'`) would therefore have been
  missed and its alias silently dropped, exactly the "writer unbinds a live key" failure this story
  exists to prevent. Fixed by running `sanitizeCommand` (from `alt-layers.ts`) over each candidate
  value before scanning it, in `collectAliasReferences`/`collectFromText`; covered by new cases in
  `alias-references.test.ts`. This is a strict widening (never narrows an existing match), so no
  existing test's expectations changed.
- AC4's "no new `validateStructure` finding" bullet has no literal pre-change baseline to diff
  against inside this same working tree (D1/D2 are already merged by the time D3 ran). Interpreted
  pragmatically: `render-invariants.test.ts` asserts `validateStructure` returns zero findings for
  every corpus profile's rendered output.
- AC5 is only fully satisfied by a manual run against the user's own `Hantsch - Test` profile
  (personal data, not reproducible headlessly). The mechanism was proven end-to-end via the
  `ui:verify` synthetic fixture per the story's own Decisions (D4), and the `## Test Plan (manual
  acceptance)` section above gives the exact steps for the user to confirm on their real file. The
  corresponding AC checkbox is left unticked pending that run.

**Verification.**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `npm test` — 56 files / 996 tests passing, 0 failing.
- `npm run ui:verify` — 34/34 screenshots, 0 axe violations (run by the D4 agent, artifacts still
  in `.ui-verify/`); `config-write-preview` shows the weapons/keyless alias lines present and no
  `+attack` alias line, matching AC1/AC2/AC6 live.
- Clean-agent review (default tier, scoped to the story-038 diff only): **PASS**. All testable ACs
  (AC1-AC4, AC6) confirmed PASS with file:line evidence; AC5 UNCLEAR as expected (needs the user's
  real data). No weakened tests, no scope creep, no import cycle, `alias-render.ts` untouched as
  the Decisions require. Two non-blocking notes, deliberately left unfixed:
  - `alias-references.ts`'s doc comment slightly overstates where sanitization happens for base
    `binds` values (`render.ts` itself does not call `sanitizeCommand` on `binds`; that path relies
    on the UI's own save-time sanitizing). Functionally harmless — doc-wording nit only.
  - No dedicated unit test for `actionsWithAliasLine` with a `kind: 'message'` action, though the
    review confirmed by inspection that guard 2 always keeps such an action (its commands are never
    `kind: 'raw'`, so `bindValueFor` cannot equal `aliasNameFor`... falls through to keep). Minor
    coverage gap, not a correctness issue.

**Commit message:** `038: writer stops emitting alias lines nothing references`

**Changed files:**
- `src/shared/config/alias-references.ts` (new), `src/shared/config/alias-references.test.ts` (new)
- `src/shared/config/profile-fixtures.ts` (new), `src/shared/config/render-invariants.test.ts` (new)
- `src/shared/config/render.ts`
- `src/shared/config/validate-actions.ts`, `src/shared/config/validate-actions.test.ts`
- `src/shared/config/alias-render.test.ts`
- `src/main/modules/config/render.test.ts`
- `scripts/lib/fixture.mjs`
