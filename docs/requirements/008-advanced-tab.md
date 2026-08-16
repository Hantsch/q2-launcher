---
id: 008
title: Advanced tab — categories, messages, macros, symbol picker
status: in-progress
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

- [x] Commands/binds can be grouped into categories: the built-ins (Movement, Weapons, Weapon
      dropping) plus user-defined custom categories.
- [x] A message editor composes a message mixing literal text, `$$loc_here`-style
      meta-variables and server-substituted macros (`%l`, `%h`, `%a`), visually distinguishing
      the two kinds.
- [x] A symbol/colour picker inserts latin-1 high-ASCII characters into message text,
      round-tripped byte-for-byte — never re-encoded as UTF-8.
- [x] Multi-command actions (several console commands under one bind) can be composed and are
      auto-split across lines when they would exceed the engine's 1024-byte per-line
      `Cbuf_Execute` limit.
- [x] Edits are saved on the profile and reflected in the overview tab and the write pipeline.

## Open Questions

_None — the category/message data shape was decided during refine against the upstream
q2-config-manager source (available locally, same precedent as story 003), the concept doc and
this story's acceptance criteria. See `## Decisions (Sprint)`._

## Decisions (Sprint)

1. **Facts are ported from `C:\dev\Hantsch\q2-config-manager`, not re-derived** —
   `src/core/{macros,encoding,catalog,engines,altlayers}.ts` hold exactly this feature area
   already, with the engine citations; re-deriving source-cited numbers is how they silently rot
   (same decision story 003 took for the cvar catalogue).
2. **Pure fact modules live in `src/shared/config/`**, next to `cvar-catalog.ts` /
   `key-names.ts` — they are pure data with no node/DOM/electron dependency and both halves need
   them (renderer for the editor, main for rendering, story 009 for validation).
3. **Prose becomes i18n keys on the way in** (`labelKey`/`descriptionKey`, English text into
   `en.json`), because the upstream tables carry user-visible prose and main must never send
   prose across IPC (CLAUDE.md).
4. **Built-in categories are exactly the three the AC names** — `movement`, `weapons`, `drops`
   ("Weapon dropping"), matching upstream's `group: 'main'` set; upstream's `comms`/`misc`
   catalogue groups feed the command picker but are not categories, and "Team messages"/"Timings"
   are seeded as *custom* categories (upstream marks them `builtin: false` too).
5. **Built-in categories are a shared constant, not persisted rows**
   (`BUILT_IN_ACTION_CATEGORIES`) — a profile persists only its custom categories, so their
   labels stay translatable and no migration is needed when the list changes.
6. **A category carries an `entryKind` (`'bind' | 'message' | 'alias'`)** — it decides which
   editor the tab opens, exactly as upstream's `CategoryEntryKind` did. Upstream's fourth kind
   `'timing'` is cut: no AC asks for a countdown mechanic, and an item timing is a message —
   `ITEM_RESPAWN_SECONDS` ships as message suggestions instead.
7. **An action is `{ id, categoryId, name, commands: ConfigCommand[], key? }`** — one shape for
   all three entry kinds, because a message and a multi-command bind are the same thing to the
   engine (an alias body) and two parallel entities would need two renderers and two validators.
8. **`ConfigCommand` is a discriminated union, not a raw string**:
   `{ kind: 'raw', text } | { kind: 'message', channel: 'say' | 'say_team', text }`. Upstream
   re-parsed `say_team …` back out of a raw string with a regex on every keystroke
   (`AdvancedTab.tsx:400`); storing the message body separately makes the round-trip exact and
   gives story 009 a field to point a finding at.
9. **Message text is a plain latin-1 string with the macro tokens inline, not a segment array** —
   that string *is* what the engine receives; the editor derives its highlighting from a pure
   `tokenizeMessage()`, so there is only ever one source of truth to keep in sync.
10. **Latin-1 is enforced at the schema boundary**: every action/message string is restricted to
    code points U+0000–U+00FF by zod. JSON persistence and the writer's `latin1` encoding then
    both round-trip byte-for-byte, and a paste of a UTF-8 em dash is rejected at the door rather
    than truncated by `Buffer.from(str, 'latin1')` later (the trap `render.ts` already documents).
11. **Colour is the high-bit alternate charset (`| 0x80`), not `^1`-style markup** — Quake 2 has
    no colour markup; the conchars font's upper half *is* the green set. The picker therefore
    offers "alternate charset" on the selection plus the curated `Q2_GLYPHS` byte list.
12. **Double quotes are rejected in action/command/message text** — Quake has no in-quote
    escaping (concept §5), so a `"` cannot be represented at all; rejecting it in the schema and
    filtering it in the editor beats emitting a config that breaks at the quote.
13. **Single-dollar `$loc_here` is flagged as a warning in the editor** (upstream's
    `findSingleDollarLocMistakes`) — it expands a non-existent cvar to an empty string with no
    engine error, which is exactly the silent failure this tab exists to prevent.
14. **Every action renders as an alias; the key binds to the alias name** — an alias body is one
    command line to `Cbuf_Execute`, which is what makes the 1024-byte split possible at all, and
    it keeps a long chain out of the `bind` line.
15. **Generated alias names are `q2l_a_<slug(name,14)>_<id[0:4]>`** — id-suffixed so two actions
    named alike never collide, and ≤ 25 chars so the `_p<n>` part suffix still fits inside
    `MAX_ALIAS_NAME` (32, i.e. 31 usable).
16. **The auto-split is upstream's `chunkCommands`, ported and generalised to user-authored
    actions** — 16 bytes of headroom under `maxLineBytes`, parts named `<alias>_p<n>`, the parent
    body becoming `p1; p2; …`. Upstream only auto-split *generated* alt-layer aliases and left
    user aliases to a validator error; AC 4 asks for the split, so it moves into the renderer.
17. **`profile.binds` stays the single source of truth for key → command**: on every save the
    handler drops every bind whose value starts with `q2l_a_` and re-adds one per action with a
    key. So the overview tab (CFG-7) and the story-004 writer need no second bind path, and
    AC 5 holds by construction. Keys go through `normalizeBindKey` (`shared/config/key-names.ts`).
18. **`resolveAliasChain()` in `lib/keyboard-layout.ts` learns to expand `q2l_a_` aliases** from
    the profile's actions — otherwise the overview would show the bare alias name for exactly the
    binds this story creates, which AC 5 ("reflected in the overview tab") would not survive.
19. **One new handler, `setActions`, replacing categories+actions wholesale** — mirrors
    `setCvars` (full-map replace, debounced from the tab) and therefore also bumps `updatedAt`,
    which is what makes `WriteTargets` write the change out through story 004's pipeline. No new
    IPC channel; module traffic rides `module:invoke`.
20. **The alias emitter is its own module (`alias-render.ts`), called from `render.ts`** — stories
    006 (alt layers) and 007 (switch bind) need the same chunker; if 006/007 already landed a
    shared alias helper by build time, this D uses it instead of adding a second one.
21. **No conchars preview.** Upstream's doc comment promises a glyph preview rendered from the
    user's own pak; no such code ever existed there. Glyphs are shown with their ASCII stand-in
    and their byte value — no image assets, per CLAUDE.md.

## Plan

Port the upstream Advanced feature area into the launcher's own shapes: pure fact modules in
`src/shared/config/`, an actions/categories slice on `ConfigProfile`, an alias emitter with the
1024-byte split in the existing write pipeline, and a new Advanced tab in the config view.

1. **Message facts** — `src/shared/config/chat-macros.ts` (the 7-token `CHAT_MACROS` table with
   client/mod scope, `tokenizeMessage()`, `findSingleDollarLocMistakes()`) and `q2-charset.ts`
   (`Q2_GLYPHS`, `toAltCharset`/`fromAltCharset`, `toDisplaySegments`, `isLatin1Text`), both with
   tests. Mirror: `cvar-facts.ts`.
2. **Action facts** — `src/shared/config/action-catalog.ts` (movement/weapon/droppable actions,
   `MESSAGE_SUGGESTIONS`, `ITEM_RESPAWN_SECONDS`) and `engine-limits.ts`
   (`CBUF_LINE_BYTES` 1024, `MAX_ALIAS_NAME` 32, `ALIAS_LOOP_COUNT` 16, citations verbatim).
3. **Contract + persistence** — `src/shared/modules/config.ts` (`ConfigActionCategory`,
   `ConfigAction`, `ConfigCommand`, `BUILT_IN_ACTION_CATEGORIES`, `setActions` +
   `SetProfileActionsInput`), forgiving `.catch()` parse in `src/main/lib/schemas.ts`, strict
   payload schema incl. the latin-1/no-quote refinements in `main/modules/config/schemas.ts`.
4. **Store + handler** — `profiles.ts#setActions` (replace both lists, rebuild the `q2l_a_` bind
   mirror), registered in `index.ts`.
5. **Rendering** — `main/modules/config/alias-render.ts`: action → alias line(s), name budgeting,
   `chunkCommands` split; `render.ts` emits the alias block between cvars and binds.
6. **UI** — `AdvancedTab.tsx` (category rail + action list + custom-category CRUD), an
   `ActionEditor` (command list, catalogue picker, key capture) and a `MessageEditor` with the
   macro bar and symbol/colour picker; new tab in `ConfigView.tsx`, `client.ts` call, `en.json`
   keys, `resolveAliasChain` extension in `lib/keyboard-layout.ts`.

Order: 1, 2 → 3 → 4 → 5 → 6. Steps 1–5 are pure/main-only and unit-testable; step 6 attaches to
the existing detail-view tab strip. Story 006 may land a shared alias helper first — reuse it
rather than duplicating (decision 20).

## Deliverables

- **D1 — Message facts (shared, pure).** `src/shared/config/chat-macros.ts`, `q2-charset.ts`,
  `chat-macros.test.ts`, `q2-charset.test.ts`. Ported from upstream `core/macros.ts` +
  `core/encoding.ts`, prose replaced by i18n keys (decision 3). Adds `tokenizeMessage(text):
  { kind: 'text' | 'meta' | 'macro'; value; index }[]` which upstream did not have.
  *Mirror:* `src/shared/config/cvar-facts.ts` (+ its test for style).
  *Accepted when:* tests cover all 7 tokens, a `$` that is not a macro staying literal text, a
  single-dollar `$loc_here` being flagged, `toAltCharset` leaving spaces and existing high bytes
  alone, and a 0x80–0xFF string surviving `toAltCharset`/`fromAltCharset` unchanged.
  **Covers AC 2 (macro vocabulary + distinction), AC 3 (charset side).**
- **D2 — Action catalogue + engine limits (shared, pure).**
  `src/shared/config/action-catalog.ts`, `engine-limits.ts`, `action-catalog.test.ts`.
  Movement/weapon/droppable actions and the `MESSAGE_SUGGESTIONS`/`ITEM_RESPAWN_SECONDS` presets
  from upstream `core/catalog.ts` + `core/macros.ts`; limits with their engine citations copied
  verbatim from upstream `core/engines.ts`. *Accepted when:* every droppable with ammo yields a
  weapon+ammo command pair, ids are unique, and the limit constants carry their source comments.
  **Covers AC 1 (built-in category contents), AC 4 (limit constants).**
- **D3 — Contract, persisted shape and payload validation.** `src/shared/modules/config.ts`
  (types above + `CONFIG_HANDLERS.setActions`), `src/main/lib/schemas.ts` (`categories`/`actions`
  on `configProfileSchema`, each `.catch(() => [])`), `src/main/modules/config/schemas.ts`
  (`setProfileActionsInputSchema`, latin-1 code-point + no-`"` refinements).
  *Mirror:* the `cvars` field and `setProfileCvarsInputSchema` added by story 003.
  *Accepted when:* a profile without the keys loads with empty lists (no
  `STATE_SCHEMA_VERSION` bump), a malformed row is dropped alone, a string containing U+2014 or
  `"` is rejected, and a string of U+00A0–U+00FF is accepted.
  **Covers AC 1 (shape), AC 3 (byte-exactness at the boundary).**
- **D4 — `setActions` handler and the bind mirror.** `src/main/modules/config/profiles.ts`,
  `index.ts`, `profiles.test.ts`. Replaces `categories` + `actions` wholesale, bumps `updatedAt`,
  and rebuilds `binds`: every entry whose value starts with `q2l_a_` is dropped, then one
  `binds[normalizeBindKey(action.key)] = <alias name>` per keyed action. *Mirror:* `setCvars`.
  *Accepted when:* tests prove a user's hand-written bind survives a save, a removed action's
  bind disappears, two actions on the same key resolve deterministically (last wins, by action
  order), and the list round-trips through `StateStore`.
  **Covers AC 1 (persistence), AC 5 (overview + write trigger, main side).**
- **D5 — Alias rendering with the 1024-byte auto-split.**
  `src/main/modules/config/alias-render.ts` + `alias-render.test.ts`, `render.ts` (+ existing
  `render.test.ts` stays green). `aliasNameFor(action)` per decision 15; body = commands joined
  `'; '` with a message rendering as `say_team <text>`; over `CBUF_LINE_BYTES - 16` the body is
  chunked into `<alias>_p<n>` parts whose names the parent calls in order (upstream
  `altlayers.ts:67-115`). `renderProfileFile` emits the alias block between the cvar and bind
  blocks, deterministically ordered. *Accepted when:* tests cover a short action (single line),
  an action long enough to need 3 parts (every emitted line < 1024 bytes, every alias name
  ≤ 31 chars, executing the parent runs the commands in the original order), a high-ASCII message
  round-tripping byte-for-byte through `Buffer.from(text, 'latin1')`, and a profile with no
  actions rendering byte-identically to today's output.
  **Covers AC 4 (the split), AC 3 (byte-exact on disk), AC 5 (write pipeline).**
- **D6 — Advanced tab: categories and action list.**
  `src/renderer/src/modules/config/AdvancedTab.tsx`, `ConfigView.tsx` (tab union + strip + body),
  `client.ts` (`updateProfileActions`), `src/renderer/src/i18n/locales/en.json`
  (`config.tabs.advanced`, `config.advanced.*`). Category rail: the three built-ins plus custom
  categories with create/rename/delete (delete cascades its actions, built-ins can only be
  emptied); selected category lists its actions with add/remove and a save debounced like
  `SettingsTab`. Design-system primitives only. *Mirror:* `SettingsTab.tsx` (debounced save,
  props shape), `ConfigView.tsx:233-260` (tab strip).
  **Covers AC 1 (UI), AC 5 (save trigger).**
- **D7 — Action editor: multi-command composer and key assignment.**
  `src/renderer/src/modules/config/components/ActionEditor.tsx`, `AdvancedTab.tsx`, `en.json`,
  `lib/keyboard-layout.ts` (`resolveAliasChain` expands `q2l_a_` aliases, decision 18). Ordered
  command list with add/remove/reorder, a picker fed by D2's catalogue, a free-text command row,
  and press-to-capture key assignment via `resolveQuakeKeyName`. Shows the rendered byte length
  with a marker when the split will kick in. *Mirror:* `SwitchBindControl` (story 007) for key
  capture, `CvarRow.tsx` for row layout.
  **Covers AC 4 (composition UI), AC 5 (overview reflection).**
- **D8 — Message editor with symbol and colour picker.**
  `src/renderer/src/modules/config/components/MessageEditor.tsx`, `SymbolPicker.tsx`,
  `AdvancedTab.tsx`, `en.json`. Channel selector (`say`/`say_team`), text field whose preview
  highlights meta-variables and mod macros differently (D1's tokenizer) and renders alternate-
  charset runs in green (`toDisplaySegments`), a macro bar inserting tokens at the caret with the
  mod-scope caveat, the single-dollar warning, `MESSAGE_SUGGESTIONS` as presets, and a picker
  inserting `Q2_GLYPHS` bytes plus an "alternate charset" toggle on the selection. No image
  assets — glyphs render as their ASCII stand-in plus byte value.
  **Covers AC 2 (editor + visual distinction), AC 3 (picker).**

**Coverage gate (AC → D):** AC 1 → D2 + D3 + D4 + D6 · AC 2 → D1 + D8 · AC 3 → D1 + D3 + D5 + D8 ·
AC 4 → D2 + D5 + D7 · AC 5 → D4 + D5 + D6 + D7.

## Model Hints

- `D5 → deliverable-hard` — it is the one deliverable that changes what lands in a user's game
  folder: a wrong headroom or part-order in the chunker produces a config that looks right on
  disk and silently drops a whole command line in-game, and it must not regress the byte-exact
  output stories 004/007 already write through the same `render.ts`.
- D1, D2, D3, D4, D6, D7, D8 → default tier.
- `Review: → default` — the irreversible parts of the pipeline (backup-once, diff-skip, atomic
  write, path trust) are untouched, only generated text and one additive profile field change,
  and D5's risk is already carried by the hard tier.

## Test Plan (manual acceptance)

`npm run dev`, everything through the real UI.

1. Config → open a profile → the detail view now has an **Advanced** tab.
2. The category rail shows **Movement**, **Weapons** and **Weapon dropping**; none of them offers
   a delete action. Create a custom category "Team messages" → it appears and *is* deletable.
3. In **Weapon dropping**, add an action from the catalogue for the Rocket Launcher → it comes
   pre-filled with `drop rocket launcher` + `drop rockets`. Add a third command by hand, assign
   it to a key by pressing that key. Open the **Overview** tab → that keycap is now bound and
   shows the drop commands, not a bare alias name.
4. In "Team messages", add a message action: pick `say_team`, type `[ HELP ]`, insert
   `$$loc_here` from the macro bar and `%h` from the mod-macro group → the preview shows the two
   token kinds visibly differently. Type `$loc_here` (single dollar) → a warning appears.
5. Open the symbol picker, insert a bullet glyph, select part of the text and apply the alternate
   charset → that run renders green in the preview.
6. Open **Write targets → Preview**: `q2l-profile-<id>.cfg` contains an `alias q2l_a_…` line per
   action and a `bind` line pointing at it; the message line carries the glyph and high-bit bytes
   exactly as typed. Check the file on disk with a byte-accurate editor — the high bytes match.
7. Add commands to one action until the composer says the line will be split → save, preview
   again: the alias body is now `…_p1; …_p2` and every line stays under 1024 bytes.
8. Restart the app → categories, actions, messages and key assignments are all still there.
9. Launch the installation and press the two bound keys: the drop chain drops weapon *and* ammo;
   the message key posts the team message with the location filled in.

## Done

**Summary.** Ported the Advanced feature area (categories, message composer, symbol/colour
picker, multi-command actions with the 1024-byte auto-split) from `q2-config-manager` into the
launcher's own shapes, end to end: pure fact modules, the persisted profile shape, the alias
emitter, the `setActions` handler and bind mirror, and a new Advanced tab in the config view.

- D1 — `src/shared/config/chat-macros.ts` + `q2-charset.ts` (+ tests): the 7-token `CHAT_MACROS`
  table, `MESSAGE_SUGGESTIONS`/`ITEM_RESPAWN_SECONDS`, `tokenizeMessage()` (new),
  `findSingleDollarLocMistakes()`, the alternate-charset helpers (`toAltCharset`/`fromAltCharset`/
  `hasAltCharset`/`toDisplaySegments`), `Q2_GLYPHS`, `isLatin1Text()` (new).
- D2 — `src/shared/config/action-catalog.ts` + `engine-limits.ts` (+ test): movement/weapon/
  droppable action data, `DROP_ACTIONS` (derived weapon+ammo command pairs), the citation-bearing
  `CBUF_LINE_BYTES`/`MAX_ALIAS_NAME`/`ALIAS_LOOP_COUNT` constants.
- D3 — `src/shared/modules/config.ts` (`ConfigActionCategory`, `ConfigAction`, `ConfigCommand`,
  `BUILT_IN_ACTION_CATEGORIES`, `SetProfileActionsInput`, `CONFIG_HANDLERS.setActions`),
  `main/lib/schemas.ts` (persisted shape with **row-level-drop** parsing for `categories`/
  `actions`, not the whole-array `.catch()` `layers` uses), `main/modules/config/schemas.ts`
  (`setProfileActionsInputSchema`, the shared `actionTextSchema` latin-1/no-quote refinement).
- D4 — `profiles.ts#setActions` (replaces categories+actions wholesale, rebuilds the `q2l_a_*`
  bind mirror, last-key-wins on collision), `index.ts` registration.
- D5 (deliverable-hard) — `alias-render.ts` (`aliasNameFor`, `renderActionAlias` with the
  1024-byte auto-split reusing `alt-layers.ts`'s own constants/headroom, `commandLineFor`),
  `render.ts`'s new action-alias block between the layer-alias and bind blocks.
- D6 — `AdvancedTab.tsx`: category rail (built-ins + custom CRUD, delete cascades its actions,
  built-ins can only be emptied) and a bare action list (add/rename/remove), `ConfigView.tsx` tab
  wiring, `client.ts#updateProfileActions`.
- D7 — `ActionEditor.tsx` (ordered command list, catalogue picker, free-text row, press-to-capture
  key assignment, a real byte-length/split-marker preview backed by `renderActionAlias`),
  `keyboard-layout.ts#resolveAliasChain` expanding `q2l_a_...` aliases from the profile's actions,
  `OverviewKeyboardPanel.tsx`'s three call sites updated.
- D8 — `MessageEditor.tsx` (channel selector, token-highlighting preview via `tokenizeMessage()` +
  `toDisplaySegments()`, macro bar with the mod-scope caveat, single-dollar warning,
  `MESSAGE_SUGGESTIONS` presets), `SymbolPicker.tsx` (`Q2_GLYPHS` insertion, alternate-charset
  toggle on the selection). `AdvancedTab.tsx` branches between `ActionEditor`/`MessageEditor` by
  the selected category's `entryKind`.

**Decisions made during implementation** (beyond the story file's own numbered decisions):

- **D5 was built before D4**, reversing the Plan's stated order: D4's bind-mirror needs
  `aliasNameFor(action)`, which the Plan itself places in D5's `alias-render.ts` — building D5
  first avoids a duplicate naming formula that could drift from the real one.
- **`MESSAGE_SUGGESTIONS`/`ITEM_RESPAWN_SECONDS` landed in `chat-macros.ts` (D1), not
  `action-catalog.ts` (D2)** — despite D2's file-list text mentioning them, they are message/
  chat-editor presets (matching upstream's actual file, `core/macros.ts`) that D2's own
  accepted-when criteria never reference, while D1's do.
- **`alias-render.ts` was relocated from `src/main/modules/config/` to `src/shared/config/`
  mid-story (during D7)** — D7's byte-length/split preview and `resolveAliasChain`'s alias
  expansion both need the *exact* alias-naming/chunking function the writer uses, not a second
  reimplementation that could drift from what lands on disk. This is the identical reasoning
  `alt-layers.ts`'s own doc comment gives for why layer-alias generation lives in `src/shared`
  ("one generator, so preview and disk can never disagree"). The file had zero main-only
  dependencies, so the move was mechanical; its `renderProfileFile`-integration tests moved to
  `main/modules/config/render.test.ts` instead, since `render.ts` itself stays main-only and the
  moved shared test file must stay importable from the renderer's own `tsconfig.web.json` (no
  `@main` alias, no Node types there).
- **No auto-seeding of "Team messages"/"Timings" as pre-populated custom categories** — decision
  4's "seeded as custom categories" is read as "modeled as", not "pre-created on every new
  profile": the story's own manual test plan has the user create "Team messages" through the
  create-category dialog, which would be redundant if it already existed.
- **`ActionEditor`/`MessageEditor` hand the updated action back to `AdvancedTab` via an `onSave`
  callback rather than calling the config client themselves** — keeps `AdvancedTab` the single
  owner of `localActions`/`localCategories` and its one save path, avoiding a second independent
  save racing a category edit made just before the modal opened (this exact class of race is what
  the review below caught elsewhere).
- **D7's initial sub-agent run appeared to stall** (relocated `alias-render.ts` but produced no
  further files for an extended period); the orchestrator implemented the rest of D7 directly
  rather than continuing to wait. The sub-agent later reported back that it had in fact completed
  independently in parallel (an environment-specific delay, not a dead task) — both efforts landed
  the same shapes with no conflicts, confirmed by a clean `git status`/typecheck/test pass
  afterward. D8 was likewise implemented directly rather than delegated, given the demonstrated
  fragility of background delegation in this session.

**Review findings, fixed** (clean-agent review, split into two scoped passes — shared/main
layer D1-D5, and renderer/UI layer D6-D8 — per the diff-size guidance, plus one focused
fix-verification pass):

1. **[confirmed, high] Stale-closure data-loss race in `AdvancedTab.tsx`.** A debounced
   action-list save closed over `localCategories` at *schedule* time; an immediate category
   CRUD save completing inside that ~500ms window could be silently overwritten once the stale
   debounce fired (worst case: a just-deleted category and its actions reappearing). Fixed by
   cancelling the pending debounce at the top of `persistCategoriesAndActions` — its own
   arguments already carry everything the debounce would have sent, since `scheduleActionsSave`
   updates local state synchronously and only delays the network call.
2. **[confirmed, low] Escape-key/`Modal` conflict** in `ActionEditor.tsx`/`MessageEditor.tsx`:
   capturing Escape as a bindable key both set it as the draft key and (via propagation) closed
   the whole modal through `Modal.tsx`'s own Escape handler before the capture was saved. Fixed
   with `event.stopPropagation()` in both capture-phase listeners.
3. **[confirmed, medium] Editor preview/save mismatch for quotes** (decision 12): a typed `"`
   looked fine in `ActionEditor`'s row preview (which renders the *sanitized* form) while the
   raw, unsanitized text was what got saved and would be silently rejected by the schema. Fixed:
   `addRawCommand` now sanitizes via `sanitizeCommand` before appending;
   `MessageEditor`'s text field strips `"` live (not full sanitization, to avoid collapsing a
   message's intentional whitespace while typing). A follow-up from the fix-verification pass
   (the Add button's disabled state didn't account for a quote-only input sanitizing to empty)
   was fixed too.
4. **[confirmed, low] Untested key-collision and whitespace-padded-key edge cases** in
   `profiles.ts#setActions`: a padded key (`"  F9  "`) was trimmed for the emptiness check but
   indexed with the untrimmed string. Fixed (`const key = action.key?.trim()`), and two tests
   added (padded key, and the pre-existing but untested "action's key wins over a user's
   hand-written bind" behavior, which is correct/intentional, not a bug).
5. **Not fixed, accepted as intentional:** `engine-limits.ts`'s constants are unused by
   production code — `alias-render.ts` reuses `alt-layers.ts`'s own `MAX_LINE_BYTES`/
   `MAX_ALIAS_NAME` for byte-identical arithmetic with the established layer chunker, exactly as
   `alias-render.ts`'s own doc comment anticipates. `engine-limits.ts` remains the citation
   reference the story's Plan asked for.
6. **Not fixed, accepted as existing precedent:** a rejected save (e.g. a schema violation)
   silently resets the Advanced tab's status to idle with no error surfaced to the user. This
   matches `SettingsTab.tsx`'s own existing behavior on a failed `updateProfileCvars` call — not
   a regression introduced by this story, and inventing a new error-surfacing mechanism this
   codebase has no precedent for anywhere else was judged out of scope for this story's plan.

**Verification:**
- `npm run build` — green (main/preload/renderer all build).
- `npm test` — 323/323 tests green across 19 files (was 273 after D1/D2, climbing through each
  deliverable; +2 net after the review-fix cycle's new `profiles.test.ts` cases). One flaky,
  unrelated test (`src/main/modules/config/core/import-reader.test.ts`'s 512-file exec fan-out
  guard) intermittently times out under CPU contention when many suites run in parallel; it is
  unmodified by this story and passes cleanly in isolation every time it was checked.
- `npm run typecheck` (`typecheck:node` + `typecheck:web`) — clean.
- Code review (default tier per Model Hints, two scoped clean-agent passes covering the whole
  diff): six findings total, four confirmed and fixed (above), two accepted as intentional/
  pre-existing with reasoning recorded; a third, narrow fix-verification pass confirmed all four
  fixes are genuinely in place with no new correctness bugs, plus one trivial UX follow-up which
  was also fixed. Final re-verification after every fix: build/test/typecheck all green.
- **Live smoke NOT performed.** This session's sandbox cannot run `npm run dev` (Electron's GUI
  crashes with "Cannot read properties of undefined (reading 'isPackaged')" — no real display/
  runtime available here), so the manual test plan above (create categories, compose a drop
  action and a team message, split a long action, preview the write, restart, launch and press
  the bound keys) has not been driven through the real app. Per this sprint's live-smoke-required
  policy, status stays `in-progress` pending that manual pass.

**Commit message (prepared, not committed by this session):**
```
008: advanced tab — categories, messages, macros, symbol picker

Ports q2-config-manager's Advanced feature area (action categories, a
message composer with meta/mod-macro distinction and a latin-1 symbol/
colour picker, multi-command actions with the 1024-byte auto-split) into
the launcher's own shapes, wired through the existing write pipeline.
```
