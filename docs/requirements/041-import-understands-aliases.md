---
id: 041
title: Import understands aliases, press/release pairs and unbindall
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

`config-parser.ts` recognises `set*`, `bind`, `unbind`, `unbindall` and `exec`. Everything else —
"`alias`, `+`-prefixed commands, comment-only lines" — is preserved verbatim as an unclassified
line. That was an explicit S01 deferral ("`alias`/`+cmd`/alt-layer content is preserved verbatim
but not parsed — explicitly deferred to the follow-up sprint"), and it never happened.

The consequence, measured against my own real config: `dmalias.cfg` is **~90 alias definitions and
nothing else**. Importing it today produces a profile with zero entries and ninety preserved lines
— a Care tab full of rows the user has to hand-copy into the Controls tab one at a time. `dm.cfg`'s
`bind KP_END "drop_shotgun"` becomes a bind pointing at an alias the launcher has no record of,
which Care then reports as an undefined alias reference. The launcher cannot honestly claim to
import real configs while the single most common construct in them is unclassified text.

The alias idioms real configs actually use, all present in my files:

- Plain command aliases: `alias s_ok "say_team $g [ OK / COMING ] ... $loc_here $g"`
- Press/release pairs: `alias +slow "..."` / `alias -slow "..."`, bound as `bind SHIFT +slow`
- Alias calling alias: `alias lol "lol1;lol2;lol3"`, `alias blaster "use blaster; ...;
  blaster_settings"`, `alias dall "…"`
- Empty aliases used as user-editable hooks: `alias blaster_settings ""`
- Aliases that rebind keys: `alias cali "bind KP_END fuck; bind KP_DOWNARROW hure; …"` — the same
  construct the launcher's own hold layers generate
- Self-rewriting toggles: `alias zoom zoomin` / `alias zoomin "…; alias zoom zoomout"`
- `wait` chains: `alias wait5 "wait; wait; wait; wait; wait"`
- Colour cvars used as text variables: `set r ""` then `$r` inside a `say_team`

## Acceptance Criteria

- [ ] `alias <name> <body>` and `alias <name> "<body>"` are parsed into a real entry, not a preserved
      line: a `kind: 'alias'` action with the parsed name and its body split into commands on
      top-level `;`, using the same quote/`;`/`//` rules the tokenizer already implements.
- [ ] A `+x`/`-x` pair is recognised as a press/release pair and imported as such (two entries that
      the UI shows as belonging together, or one entry with both halves — the story decides).
- [ ] A bind whose command is a bare token matching an imported alias name becomes a reference to
      that entry, so Care reports neither an undefined alias nor an unreferenced one.
- [ ] A bind whose command is a raw `+command` (`bind e "+forward"`) is adopted as a bind entry
      without inventing an alias for it — the same rule story 038 establishes for the writer.
- [ ] An alias body that is a `say`/`say_team` command is imported as a message entry with its
      channel and text, and its chat macros (`$$loc_here`, `%l`, `%h`, `%a`, …) survive verbatim.
- [ ] An alias body containing `bind` commands is imported without being mangled, even where the
      launcher cannot model it as a layer.
- [ ] `unbindall` is honoured in file order: binds before it are discarded, binds after it win.
- [ ] `exec <file>` chains are followed as they already are, and an alias defined in an exec'd file
      resolves for a bind in the file that exec'd it.
- [ ] Alias-to-alias references resolve across the whole import, in any definition order (`lol`
      defined before `lol1` still resolves).
- [ ] A duplicate alias name across the imported set is reported (last-definition-wins, the engine's
      behaviour), not silently merged.
- [ ] Anything genuinely unparseable is still preserved verbatim — the story removes preserved lines
      by understanding them, never by dropping them.
- [ ] Importing `dmalias.cfg` + `dm.cfg` + `gfx.cfg` from `docs/fixtures/` (committed as a fixture)
      produces a profile whose Controls tab shows the aliases as entries, and the number of preserved
      lines is at most the comment/banner lines and the constructs named in Open Questions.

## Open Questions

- ~~Self-rewriting toggles and `wait` chains: plain alias entries, or a first-class toggle entry
  kind?~~ answered → Decisions (Sprint)
- ~~An imported alias needs a `categoryId`. Which one?~~ answered → Decisions (Sprint)
- ~~`alias cali "bind KP_END fuck; …"` is functionally a toggle layer. Recognise as an alt layer, or
  import as a plain alias entry?~~ answered → Decisions (Sprint)
- ~~Colour cvars used as `$r` text variables: keep as ordinary cvars, or does the message editor
  need to know they are colour codes?~~ answered → Decisions (Sprint)
- ~~Real configs carry mod-side macros this repo's `CHAT_MACROS` does not list. Extend the
  catalogue, or pass unknown `%x` through unvalidated?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Self-rewriting toggles / `wait` chains: import as plain alias entries with raw bodies.
  Backlog note (not this story): a dedicated alias-management menu is needed for these to become
  first-class UI entries — file as a follow-up roadmap item, out of scope here.
- **(User)** Imported alias `categoryId`: guessed from the body (`drop …` → drops, `use …` →
  weapons). Record the guess as overridable — moving an entry to a different category later is
  explicitly a candidate for a later story, not something this story needs to build UI for beyond
  the existing category field.
- **(User)** `alias cali "bind KP_END fuck; …"`-style constructs (alias that rebinds keys, no clean
  layer match): do not silently decide. The import flow surfaces the ambiguous construct and asks
  the launcher's user how to treat it (plain alias vs. attempt-as-layer) rather than guessing —
  refine plans the minimal interaction surface for this (e.g. an import-review step), scoped to
  just this construct.
- **(User)** Colour cvars (`set r ""` used as `$r` in messages): the message editor learns to
  recognise and render them as colour codes, not just opaque cvar references. Scope note: this is
  larger than the "keep as ordinary cvar" default — refine scopes the message-editor change
  narrowly to recognizing known colour-cvar patterns already produced by this import, not a general
  colour-code editor feature.
- **(User)** Unknown mod-side chat macros (`%N`, `%T`, `%L`, …): pass through unvalidated and
  verbatim. No catalogue extension in this story.

### Decided in refine

- **Tokenizer is extracted, not copied.** `stripLineComment`/`splitTopLevelSemicolons`/`tokenize`
  move from `config-parser.ts` into `src/shared/config/command-tokenizer.ts`, because AC1 demands
  the alias-body splitter use *the same* rules and the splitter lives in shared code.
- **Bare top-level commands stay preserved.** `echo`, `norm_fov`, `m_filter 1`, `wait`,
  `vid_restart`, `clear`, `skin "…"` and the fixtures' ASCII banners are not entries and get no
  parser branch — they are startup commands, and inventing entries for them would lose their
  position in the file.
- **AC12's "at most" is made measurable.** The fixture test asserts an *explicit expected list* of
  preserved lines, each classified (comment / `echo` banner / banner junk / bare command), plus
  "no line starting with `alias ` remains preserved" — a bare count is not falsifiable.
- **Alias body → `ConfigCommand[]`.** Each top-level `;` segment becomes a command; a `say`/
  `say_team` segment becomes `{ kind: 'message', channel, text }` with the rest of the segment
  verbatim, everything else `{ kind: 'raw' }`. The entry is `kind: 'message'` only when the body is
  exactly one message command and nothing else (`s_ok`), otherwise `kind: 'alias'` (`drop_shotgun`,
  whose body mixes drops, a `say_team` and a `wave`) — that keeps mixed bodies out of the message
  editor while still modelling their chat part.
- **Empty-body aliases are entries.** `alias blaster_settings ""` imports as `kind: 'alias'` with
  `commands: []` and must still render as `alias blaster_settings ""`; the writer's "no usable
  commands → no alias line" rule stays scoped to *generated* action aliases (story 038 AC6), because
  swallowing a user-authored hook alias on the first save would be silent data loss.
- **A nested `alias` inside a body is a raw command, never a definition.** `alias zoomin
  "…;alias zoom zoomout"` must not register `zoom` a second time, or the User-decided
  "self-rewriting toggles import as plain aliases" would come back out as a duplicate report.
- **Imported names are kept verbatim.** `ConfigAction.name` and story 039's own-alias-name field
  both get the source name (`drop_rail`, `+slow`) unchanged, so the first write-back reproduces the
  player's own file instead of renaming ninety aliases.
- **Category guess table (first match wins):** body contains `drop ` → `drops`; contains `use ` →
  `weapons`; only `say`/`say_team` (± `play`) → new `messages` category; only `play` → new `sounds`
  category; movement commands/cvars (`+move*`, `+forward`, `+back`, `cl_*speed`) → `movement`;
  otherwise a new `imported` category. Five rules plus a fallback covers the fixture without
  pretending the launcher understands mod semantics.
- **Press/release pairing is derived, not stored.** A shared `pressReleasePairs(actions)` helper
  pairs `+x`/`-x` alias entries by name; no new field on `ConfigAction`, so story 045 can introduce
  a real press/release entry kind later without a state migration.
- **Binds that call an alias stay raw binds.** `bind KP_END "drop_shotgun"` remains a
  `profile.binds` entry pointing at the alias entry by name; this story adds no second
  bind→entry conversion path, which would collide head-on with 038/039's mirror-ownership work.
- **`bind <key> ""` imports as nothing** — no entry, no preserved line, an explicit unbind.
  Consistent with story 040's decision that deliberately empty binds are not written.
- **Duplicate aliases are reported in the import preview**, mirroring the existing `duplicateBinds`
  list, not as a new Care rule: after the engine's last-definition-wins fold the profile holds one
  entry, so Care would have nothing left to compare.
- **The review step triggers only on `bind`-in-body.** An alias with ≥1 top-level `bind` segment is
  reported as ambiguous; every other construct imports without asking. Two options per row, default
  "import as plain alias"; the answers travel as `layerAliases: string[]` on `ImportCommitInput`.
- **"Attempt as layer" means:** a toggle `AltLayer` named after the alias, the body's `bind` pairs
  as `overrides`, `triggerKey: null` when nothing binds the alias (nothing binds `cali` in
  `dm.cfg`) — `AltLayer.triggerKey` is already nullable for exactly this "not reachable yet" state.
- **Colour-cvar recognition is value-driven and narrow.** A `$name` whose profile cvar value
  consists *entirely* of high-bit/alt-charset bytes is a colour token; it renders through the
  existing `q2-charset.toDisplaySegments` plus a chip naming the cvar. `tokenizeMessage`'s contract
  is left alone — the recognition lives in its own `src/shared/config/color-cvars.ts`.
- **`$loc_here` (single `$`) is imported verbatim.** The existing `findSingleDollarLocMistakes` Care
  rule already names it; an importer that silently rewrites the player's text is worse than a
  warning.
- **The fixture test builds its own entry file.** None of the three fixtures is an engine entry
  file (`dm.cfg` only reaches `dmalias.cfg` through a *bind value*), so the test writes a temp
  gamedir with `autoexec.cfg` = `exec dm.cfg` / `exec dmalias.cfg` / `exec gfx.cfg` and reads the
  committed fixtures latin-1, read-only.
- **No new backlog story is filed** for the User's alias-management note: story 044 (alias manager)
  and 045 (toggles/press-release/wait as first-class entries) already exist and cover it.

## Plan

Six layers, bottom-up; nothing here touches the write path 038-040 are changing.

1. **Tokenizer becomes shared** — lift `stripLineComment` / `splitTopLevelSemicolons` / `tokenize`
   out of `src/main/modules/config/core/config-parser.ts` into
   `src/shared/config/command-tokenizer.ts` (no node, no DOM), and teach `classifySegment` an
   `alias` branch producing `ParsedAlias { name, body, line }` on a new
   `ParseConfigResult.aliases`. Alias lines stop landing in `preserved`.
2. **`import-reader.ts` folds aliases** into its document-ordered stream next to cvars/binds:
   last definition wins across files and `exec` depth, earlier ones recorded in a new
   `duplicateAliases` list. `unbindall` handling is untouched (it already works) but gets the
   fixture as a witness.
3. **New shared conversion** `src/shared/config/alias-import.ts`: alias map + bind map →
   `{ actions, categories, layers, ambiguous }`. Body splitting, message detection, category
   guessing, order-independent alias→alias resolution and the ambiguous-`bind`-body report all
   live here, pure and unit-testable — mirror `src/shared/config/bind-adoption.ts`'s shape.
4. **Reference graph** in `src/shared/config/validate-actions.ts` learns that a raw `binds` value
   and another entry's command text are references, so `drop_shotgun` is neither undefined nor
   unreferenced. Plus derived press/release pairing (`src/shared/config/press-release.ts`) and its
   adjacent rendering in `ControlsTab.tsx`.
5. **Contract + main** — extend `ImportPreviewResult` (alias/message counts, `duplicateAliases`,
   `ambiguousRebindAliases`) and `ImportCommitInput` (`layerAliases`) in
   `src/shared/modules/config.ts` first (contract-first), then `import.ts`, the commit payload
   schema in `src/main/lib/schemas.ts`, and `ProfilesStore.createFromImport`.
6. **Renderer** — `ImportProfileDialog.tsx` gains the review step between preview and name;
   `MessageEditor.tsx` gains colour-cvar rendering. Then the fixture-based end-to-end test.

Order: D1 → D2 → D3 → (D4, D5 parallel) → D6 → (D7, D8 parallel) → D9.

## Deliverables

### D1 — Shared command tokenizer + `alias` parsing

- **Files:** new `src/shared/config/command-tokenizer.ts`, new
  `src/shared/config/command-tokenizer.test.ts`,
  `src/main/modules/config/core/config-parser.ts`,
  `src/main/modules/config/core/config-parser.test.ts`.
- **Acceptance:** the three helpers are exported from shared and `config-parser.ts` has no local
  copy; `ParsedAlias { name, body, line }` + `ParseConfigResult.aliases` exist;
  `alias n "a;b"` keeps `a;b` as one body, `alias zoom zoomin` and `alias +foo bind 1 use blaster`
  join their tokens with single spaces (`Cmd_Alias_f`), `alias n ""` yields an empty body (not
  unrecognized), `alias` with fewer than 2 tokens is unrecognized, and no `alias` line appears in
  `preserved` any more. Existing parser tests stay green after the "preserves an alias line
  verbatim" case is replaced.

### D2 — `import-reader` folds aliases across files and `exec`

- **Files:** `src/main/modules/config/core/import-reader.ts`,
  `src/main/modules/config/core/import-reader.test.ts`, `src/shared/modules/config.ts`
  (`DuplicateAliasLine`, mirroring `DuplicateBindLine`).
- **Acceptance:** `ImportResult.aliases: ImportedAlias[]` in document order with `{ name, body,
  file, line }`, last definition winning across files and `exec` depth; `duplicateAliases` names
  the earlier definition's site and the later one that took effect; an alias defined in an exec'd
  file is present for the parent file's binds; `unbindall` still clears binds accumulated so far
  and lets the stream continue (regression test with an alias before and after it); the guards
  (`ALIAS_LOOP_COUNT`, cycle chain, `MAX_EXEC_EXPANSIONS`) are unchanged.
- **Mirror:** the existing `applyBind` / `duplicateBinds` handling in the same file.

### D3 — Alias → entry conversion (shared, pure)

- **Files:** new `src/shared/config/alias-import.ts`, new
  `src/shared/config/alias-import.test.ts`.
- **Mirror:** `src/shared/config/bind-adoption.ts` (same "plain data in, actions out, injected
  `newId`" shape).
- **Acceptance:** `buildImportedActions({ aliases, binds, layerAliases, newId })` returns
  `{ actions, categories, layers, ambiguous }` and satisfies, as unit tests:
  bodies split via D1's splitter; `say`/`say_team` segments become `message` commands with macros
  (`%l`, `%N`, `%T`, `$loc_here`, `$g`) byte-identical; body of exactly one message command →
  `kind: 'message'`, otherwise `kind: 'alias'`; empty body → `commands: []`, entry kept; nested
  `alias` in a body stays a raw command and registers no name; `name` and the own-alias-name field
  are the source name verbatim including `+`/`-`; the category guess table above; alias→alias
  references resolve regardless of definition order (`lol` before `lol1`); an alias with a
  top-level `bind` segment appears in `ambiguous` and is converted per `layerAliases` (plain alias,
  or a toggle `AltLayer` with `triggerKey: null` and the bind pairs as `overrides`); a raw
  `+command` bind (`bind e "+forward"`, `bind ALT "+x2"`) produces **no** alias entry.

### D4 — The reference graph counts raw binds and alias bodies

- **Files:** `src/shared/config/validate-actions.ts`,
  `src/shared/config/validate-actions.test.ts`.
- **Acceptance:** for an imported profile, `undefinedAlias` does not fire for
  `bind KP_END "drop_shotgun"` when a `drop_shotgun` alias entry exists, and `aliasUnreferenced`
  does not fire for an alias referenced only from a raw bind value, only from another alias' body
  (`wait5` ← `wait20`), or from a `;`-list bind (`bind w "shotgun;super_shotgun"`). Reference
  detection is **one** function (story 038 AC3's rule), not a second copy of the graph. Existing
  `aliasDuplicate` behaviour unchanged.

### D5 — Press/release pairs read as pairs

- **Files:** new `src/shared/config/press-release.ts` + `press-release.test.ts`,
  `src/renderer/src/modules/config/ControlsTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- **Acceptance:** `pressReleasePairs(actions)` pairs `+x`/`-x` alias entries by base name and is
  the only place that knows the convention; the Controls tab renders a pair as two adjacent rows
  under one shared pair label; a `+x` with no `-x` (and a `-x` with no `+x`) renders as an ordinary
  row and is not paired. No new field on `ConfigAction`. Tokens only, no image assets, keyboard
  reachable (`/design-tokens`, `/frontend-guidelines`).

### D6 — Contract + main: preview reports aliases, commit takes the answers

- **Files:** `src/shared/modules/config.ts`, `src/main/modules/config/import.ts`,
  `src/main/modules/config/profiles.ts`, `src/main/lib/schemas.ts`,
  `src/main/modules/config/import.test.ts`, `src/main/modules/config/profiles.test.ts`.
- **Acceptance:** contract changed **first** (`/typed-ipc`): `ImportPreviewResult` gains
  `aliasCount`, `messageCount`, `duplicateAliases`, `ambiguousRebindAliases[{ name, body, file,
  line }]`; `ImportCommitInput` gains `layerAliases: string[]`, validated by a strict schema
  (never trust the renderer — an unknown alias name is rejected, not ignored);
  `previewImport`/`commitImport` call `buildImportedActions` and `createFromImport` stores
  `actions`/`categories`/`layers` alongside `cvars`/`binds`/`unrecognized`; the existing
  `adoptProfileBinds` pass still runs and does not touch the new alias entries.

### D7 — Import dialog: alias counts + the review step

- **Files:** `src/renderer/src/modules/config/ImportProfileDialog.tsx`,
  `src/renderer/src/modules/config/client.ts`,
  `src/renderer/src/i18n/locales/en.json`, `scripts/lib/screens.mjs`.
- **Acceptance:** the preview step shows alias and message counts and the duplicate-alias list
  next to the existing duplicate-binds list; when `ambiguousRebindAliases` is non-empty a review
  step appears between preview and name, one row per construct (name, source `file:line`, body via
  `ConfigCodeView`) with a two-option choice defaulting to "import as plain alias"; the choices are
  sent to `import.commit`; the step is skipped entirely when the list is empty; a `ui:verify`
  screen covers it and is axe-clean (`docs/UI-VERIFICATION.md`). Strings are i18n keys, no prose
  over IPC.

### D8 — Message editor recognises colour cvars

- **Files:** new `src/shared/config/color-cvars.ts` + `color-cvars.test.ts`,
  `src/renderer/src/modules/config/components/MessageEditor.tsx`,
  `src/renderer/src/modules/config/ControlsTab.tsx` (pass the profile's cvars in),
  `src/renderer/src/i18n/locales/en.json`.
- **Acceptance:** `isColorCvar(name, value)` / `colorCvarTokens(cvars)` recognise a cvar whose
  value is entirely high-bit/alt-charset bytes (`set g "<high-bit bytes>"`); in the editor a `$g`
  reference to
  such a cvar renders as the glyph run via the existing `q2-charset.toDisplaySegments` styling plus
  a chip naming the cvar; a `$name` that is not such a cvar stays literal text; `tokenizeMessage`
  and the existing macro/alt-charset preview behaviour are unchanged. Narrow by construction — no
  general colour-code editor.

### D9 — Fixture import test (`dm.cfg` + `dmalias.cfg` + `gfx.cfg`)

- **Files:** new `src/main/modules/config/core/import-fixtures.test.ts`; reads
  `docs/fixtures/{dm,dmalias,gfx}.cfg` read-only.
- **Mirror:** `import-reader.test.ts`'s temp-dir `writeFixture` helper.
- **Acceptance:** the test builds a temp gamedir with the three fixtures plus a generated
  `autoexec.cfg` (`exec dm.cfg` / `exec dmalias.cfg` / `exec gfx.cfg`), runs preview + commit, and
  asserts: every `alias` in `dmalias.cfg` is an entry (count assertion, no `alias ` line left in
  `unrecognized`); `drop_shotgun`, `dall`, `s_ok`, `zoom`, `blaster` resolve for their `dm.cfg`
  binds; `wait5`→`wait20`→`wait50` resolves; `+slow/-slow`, `+dj/-dj`, `+rj/-rj`, `+kl/-kl`,
  `+zoom/-zoom` come out as five pairs; `blaster_settings` and its nine siblings survive as
  empty-body aliases; `cali` is the **only** entry in `ambiguousRebindAliases`; `unbindall` at
  `dm.cfg:1` is honoured (the pre-`unbindall` state is empty anyway, so the assertion is that the
  later binds all survive); `s_ok`'s `$g` and `%h`/`%a` are byte-identical to the source; and the
  preserved-line list equals an explicit expected list in which every entry is a comment, an
  `echo` banner, ASCII banner junk or a bare command.

### Coverage (every acceptance criterion has a deliverable)

| AC | Delivered by |
| --- | --- |
| 1 `alias` becomes a real entry | D1 (parse) + D3 (entry) |
| 2 `+x`/`-x` recognised as a pair | D3 (entries) + D5 (pairing + UI) |
| 3 bare-token bind resolves to the alias entry | D4 (+ D3 for the entry) |
| 4 raw `+command` bind, no invented alias | D3 (explicitly produces none), asserted in D9 |
| 5 `say`/`say_team` alias → message entry, macros verbatim | D3, asserted in D9 |
| 6 `bind`-containing alias body not mangled | D3 + D7 (review step) |
| 7 `unbindall` honoured in file order | D2, asserted in D9 |
| 8 `exec` chains + cross-file alias resolution | D2 + D3 |
| 9 order-independent alias→alias resolution | D3 |
| 10 duplicate alias name reported | D2 (detect) + D6/D7 (surface in preview) |
| 11 unparseable content still preserved verbatim | D1 (only `alias` lines leave `preserved`) + D9 (explicit expected list) |
| 12 fixture import produces entries, few preserved lines | D9 (+ D7 for the Controls-tab surface, manual step 4) |

## Model Hints

- `D3 → deliverable-hard` — the conversion is the story's whole risk surface: order-independent
  alias→alias resolution, message-vs-alias kind selection, nested-`alias` suppression and the
  ambiguous-`bind`-body branch all interact in one pass, and a wrong split silently corrupts
  ninety of the user's aliases.
- `D4 → deliverable-hard` — `validate-actions.ts` is being changed by stories 038 and 039 in the
  same sprint, so widening its reference graph risks regressing their `aliasUnreferenced` /
  mirror-ownership behaviour rather than just adding a case.
- All other Ds → default tier.
- `Review: → story-review-hard` — nine deliverables across parser, shared, main and renderer, and
  a mis-parsed alias body is data loss the user only discovers in-game, not in a test run.

## Test Plan (manual acceptance)

Prerequisite: a registered Quake II installation. Copy `docs/fixtures/dm.cfg`, `dmalias.cfg`,
`gfx.cfg` into its `baseq2/`, and add a `baseq2/autoexec.cfg` containing
`exec dm.cfg` / `exec dmalias.cfg` / `exec gfx.cfg` (three lines).

1. Start the app (`npm run dev`), go to **Config** → create profile → source **import**.
2. Pick the installation, then the `baseq2` gamedir. **Preview** must show ~95 aliases and a
   non-trivial message count, and the preserved-lines list must contain no `alias …` line — only
   comments, `echo` banners, the `<<--- … --->>` banner junk and bare commands.
3. Continue. The **review step** must appear and list exactly one construct, `cali`, with its body
   and two options; leave the default ("import as plain alias") and continue.
4. Name the profile, create it. On the **Controls** tab: the aliases appear as rows in categories
   (`drops`, `weapons`, `messages`, `sounds`, `imported`), `+slow` and `-slow` sit adjacent as one
   pair, and `blaster_settings` is present with an empty body.
5. On the **Care** tab: no "undefined alias" finding for `drop_shotgun` and no "unreferenced alias"
   finding for `wait5`. Preserved lines match what step 2 showed.
6. Open the `s_ok` row's message editor: the `$g` reference renders as a colour token (glyph run +
   a chip naming the cvar), and `$loc_here` / `%h` / `%a` are unchanged in the text field.
7. Repeat step 3 choosing **attempt as layer** for `cali`: the created profile has an alt layer
   named `cali` with the fourteen keypad overrides and no trigger key assigned.

## Done
