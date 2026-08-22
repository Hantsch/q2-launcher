---
id: 040
title: The profile file is written structured, commented and human-readable
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Players love clean configs. Not merely functional ones — configs that are structured, commented,
aligned, and pleasant to read a year later. My own configs (`dm.cfg`, `dmalias.cfg`, `gfx.cfg`)
are built exactly that way: section banners, a comment behind almost every bind, keys grouped the
way they sit on the keyboard, columns aligned with tabs.

What the launcher writes today is a flat, sorted dump:

```
// q2-launcher profile b2dd1b5e-fd01-4353-81c9-3e6961d5ac72 - generated, do not edit
set cl_gun "1"
set cl_run "0"
...
alias q2l_a_ssg_sg_9a2f "use super shotgun; use shotgun"
...
bind q "q2l_a_ssg_sg_9a2f"
```

Functional, and nothing more. It tells me nothing: `bind q` is **SSG + SG** in the UI and sits in
the **weapons** category, and none of that is visible in the file. That information is also what a
re-import needs (stories 041/042), so the comments are not decoration — they are the file's own
record of what it means.

Decided with the user: **one file per profile, structured in sections.** Not the split
`dm.cfg` + `dmalias.cfg` + `gfx.cfg` layout my own configs use — one `<name>.cfg` keeps the write
pipeline, sync state (story 022), Raw File tab (023) and cleanup (010/025) at one target per
profile.

Target shape (sketch, exact wording is the story's own business):

```
// =============================================================================
//  Hantsch - Test
//  Q2 Launcher - do not hand-edit while the launcher has the profile open
// =============================================================================

// --- Player ------------------------------------------------------------------
set name         "Hantsch"

// --- Mouse -------------------------------------------------------------------
set sensitivity  "3"
set m_pitch      "0.022"

// --- Aliases: weapons --------------------------------------------------------
alias ssg_sg     "use super shotgun; use shotgun"     // SSG + SG

// --- Layer: Alt (hold, on ALT) -----------------------------------------------
alias +alt       "bind q drop_shotgun"
alias -alt       "bind q ssg_sg"

// --- Binds: main block -------------------------------------------------------
bind q           "ssg_sg"                             // SSG + SG
bind w           "+forward"                           // forward
```

## Acceptance Criteria

- [ ] The file opens with a header block: profile name, the ownership sentinel (still
      machine-detectable — `writer.ts`, `cleanup.ts` and `canonical.ts` all match on it), and a line
      saying what hand-editing means once story 043 lands.
- [ ] Content is grouped into commented sections rather than emitted as one sorted list: cvars by
      their `CvarDef.group` (`player`/`network`/`graphics`/…, already on the catalogue), aliases by
      the entry's category, one section per alt/modifier layer naming the layer and its trigger, and
      binds grouped the way a player reads a keyboard.
- [ ] Every generated bind and alias carries a trailing `//` comment with the entry's display name,
      so `bind q "ssg_sg"` reads as `SSG + SG` in the file too.
- [ ] Values are column-aligned within a section (spaces, not tabs — a tab-aligned file re-renders
      differently in every editor).
- [ ] Output stays **deterministic**: the same profile renders byte-identical every time. Section
      order, in-section order and the alignment column are all derived, never insertion-order- or
      clock-dependent. The existing render tests' determinism assertions must still hold.
- [ ] Latin-1 round-trip is unbroken: every comment and banner character survives the writer's
      latin1 encoding (no em dashes, no box-drawing glyphs — plain ASCII, the rule
      `sentinelLine` already documents).
- [ ] Every line stays inside the engine's line-length budget, comments included.
- [ ] Cvars/binds/aliases the launcher has no section for still get written, in an explicit
      "other" section — nothing is dropped to make the layout tidy.
- [ ] An empty section is omitted, not written as a banner with nothing under it.
- [ ] The Raw File tab and the write-preview dialog show the new layout with syntax highlighting
      intact (story 024's `ConfigCodeView`).

## Open Questions

- ~~Bind grouping: by keyboard region or by action category?~~ answered → Decisions (Sprint)
- ~~Are deliberately empty binds (`bind i ""`) kept as documentation of the keyboard layout, or
  dropped?~~ answered → Decisions (Sprint)
- ~~Does the file open with `unbindall`?~~ answered → Decisions (Sprint)
- ~~Should the header carry a written timestamp?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Bind grouping: by action category (movement/weapons/drops — matches the Controls tab),
  not by keyboard region. No need to move `keyboard-layout.ts`'s region tables into
  `src/shared/config/`.
- **(User)** Deliberately empty binds (`bind i ""`): dropped, not written. Scope note: this is a
  behaviour change from today's writer (which does emit them) — refine should confirm no other
  acceptance criteria (this story's or elsewhere) depend on empty binds surviving a write.
- **(User)** `unbindall` header line: becomes a **per-profile setting**, default **on**. This is new
  scope beyond the story's original sketch (a stored profile field + its UI surface, likely
  alongside where the profile's other write-affecting toggles live) — refine plans where that
  setting is exposed and stored.
- **(User)** Header timestamp: no. Preserves the byte-identical determinism this story already
  requires as an acceptance criterion.

Decided during refine (no user involvement):

- **Sentinel stays the literal first line, byte-identical.** `sentinelLine()` is unchanged and the
  decorative banner, profile name and hand-edit sentence follow it — `cleanup.ts:133`,
  `writer.ts:158/238/371` and `canonical.ts:90/190` all match on the first line (one of them
  exactly), so keeping it untouched removes the whole class of ownership-detection regressions for
  free.
- **Comment and banner labels come from plain ASCII English literals in the shared layer**
  (`action-catalog.ts` rows, `BUILT_IN_ACTION_CATEGORIES`, cvar groups), never from renderer i18n:
  `render.ts` is pure shared and also runs in main, where no `t()` exists, and a translated comment
  would break both latin-1 safety and byte-determinism the moment the UI locale changes.
- **Those literals are pinned to `en.json` by a test** rather than trusted to stay in sync, so the
  duplication cannot drift silently.
- **If story 039 already introduced a shared display-label source, D1 reuses it** instead of adding
  a second one — one name source, or an alias name and its own comment will drift apart.
- **Section order mirrors the app:** header → `unbindall` → cvars (player, network, graphics, sound,
  other) → aliases by category (movement, weapons, drops, then `profile.categories` array order,
  then other) → one section per layer in `profile.layers` order → binds in the same category order →
  other binds. The file then reads in the order the user meets things in Settings and Controls.
- **Within a cvar group: catalogue order (`ALL_CVARS` index)**, uncatalogued cvars alphabetical in
  the "other" section — makes a group read like the Settings tab, and both are pure functions of
  data so determinism holds.
- **Within a category section: the owning action's index in `profile.actions`**; the "other binds"
  section sorted by normalized key. Matches the user-controlled Controls ordering (019/020) and is
  derived from stored data, not from runtime map iteration.
- **A layer's trigger bind line moves into that layer's own section** and keeps today's unquoted
  form (`bind ALT +alt`), so a layer is one self-contained, readable block.
- **Alignment is computed per section** — value column = longest name in the section + 1 space,
  comment column = longest code part + 2, both capped — and a line that busts the cap falls back to
  a single space, so one pathological entry cannot push a whole section's columns off screen.
- **Line budget = the strictest `maxLineBytes` in `engine-limits.ts`** (render is engine-agnostic);
  when a line does not fit, the trailing comment is truncated and then dropped entirely — the
  command part is never truncated or wrapped, because the comment is decoration and the command is
  the contract.
- **Comment text is sanitized:** CR/LF/tab → single space, anything outside latin-1 dropped, comment
  always runs to end of line. A user-typed entry name must not be able to break the file or the
  latin-1 round-trip.
- **A comment is emitted even when it repeats the command text** (`bind w "+forward" // Forward`):
  AC3 says every generated bind and alias carries one, and 042 will read these back as the file's
  own record.
- **Comment bytes count toward Care's file-size budget; no suppression.**
  `validation-scope.ts` already renders the real file and Care already warns on the engine's
  exec-buffer budget — silently shrinking the file the user asked for would be worse than the
  warning. D3's acceptance names this explicitly so it is a seen consequence, not a surprise.
- **Dropping empty binds happens in `render` only**, `profile.binds` is untouched. Confirmed nothing
  depends on `bind x ""` surviving a write: no code path manufactures an empty bind value,
  `bind-collision.ts`'s `releaseKey` deletes the key outright, and no test asserts such a line.
- **`writeUnbindall?: boolean` on `ConfigProfile`**, `.catch(true)` in the persisted schema, **no**
  migration entry (this repo's convention for additive optional fields — `MIGRATIONS` is still
  empty), and a **new `setWriteUnbindall` module handler** mirroring `setPlayedMods`/`setSwitchBind`
  rather than overloading one of the whole-field replace setters.
- **The checkbox lives in the Raw File tab**, next to the played-mods block: that tab is the
  launcher's "this is the file" surface and shows the effect immediately; the setting is about file
  content, not about a cvar.
- **`renderLoaderFile` is out of scope** and stays as it is — two lines plus 007's switch chain,
  where banners would add noise and churn existing tests.
- **`ConfigCodeView`'s search keeps matching inside comments.** Searching `SSG` and landing on the
  bind that means it is the whole point of writing the comments.
- **The new layout is not versioned or gated.** The next write replaces the old layout in place —
  022's canonical file plus sync already rewrite on every write, and the versioned metadata format
  is 042's job.

## Plan

Rewrite `renderProfileFile` from a flat sorted dump into a section builder, and give the shared
layer the plain-English labels a comment needs. Build order:

1. **Labels + order into `src/shared/config/`** — a catalogue row and a built-in category currently
   only carry an i18n `labelKey`, resolvable in the renderer only (`ControlsTab.tsx:697`), and
   `GROUP_ORDER` for cvars lives in `renderer/.../lib/cvar-rows.ts:32`. Add plain ASCII English
   labels + the group order to the shared catalogues, one resolver `commentLabelFor(action)`, and
   have the renderer import the shared order instead of its local copy. A test pins every literal
   against `en.json`.
2. **Layout primitives + header + cvar sections** — a new `cfg-layout.ts` (banner, per-section
   column alignment, comment attach, budget-aware truncation, latin-1/control-char sanitizer) and
   the first consumer: header block (sentinel untouched as line 1) plus cvars grouped by
   `CvarDef.group` with an "other" section.
3. **Alias / layer / bind sections** — the risky half: aliases by category, one section per layer
   (its aliases plus its trigger bind), binds by the owning action's category, "other" sections for
   anything unowned, trailing `// <label>` on every generated bind and alias, empty binds dropped,
   empty sections omitted. Reverse index bind-value → action has to be built here (none exists).
4. **`writeUnbindall`** — profile field, persisted schema default, module handler + typed client,
   the `unbindall` line in render.
5. **Its UI** — checkbox in the Raw File tab + i18n keys, wired so toggling rewrites the canonical
   file and the shown content changes.
6. **Highlighting + views** — regression tests for banner lines and multi-space-aligned trailing
   comments in `config-syntax.test.ts`, round-trip over the new render output, and a `ui:verify` run
   over Raw File and the write-preview dialog.

Affected: `src/shared/config/{render,action-catalog,cvar-facts,cfg-layout}.ts`,
`src/shared/modules/config.ts`, `src/main/lib/schemas.ts`,
`src/main/modules/config/{index,profiles,schemas}.ts`,
`src/renderer/src/modules/config/{RawFileTab.tsx,client.ts,lib/cvar-rows.ts,SettingsTab.tsx}`,
`src/renderer/src/i18n/locales/en.json`, plus the render/writer/canonical/sync/config-syntax tests.
Not touched: `renderLoaderFile`, the ownership sentinel, `ConfigCodeView.tsx` itself.

## Deliverables

### D1 — Plain-English labels and section order in the shared layer

Give `src/shared/config/` everything a pure renderer needs to name a section and an entry, without
i18n.

- Files: `src/shared/config/action-catalog.ts` (plain `label` per row, ASCII), 
  `src/shared/modules/config.ts` (`label` on `BUILT_IN_ACTION_CATEGORIES`),
  `src/shared/config/cvar-facts.ts` (`CVAR_GROUP_ORDER` + a plain `label` per group), new
  `src/shared/config/comment-labels.ts` (`commentLabelFor(action, profile)`, `categoryLabelFor`),
  `src/renderer/src/modules/config/lib/cvar-rows.ts` + `SettingsTab.tsx` (import the shared order
  instead of the local `GROUP_ORDER`), new `src/shared/config/comment-labels.test.ts`.
- Reuse check first: if 039 landed a shared display-label helper, extend it, do not add a second.
- Acceptance: every catalogue row, every built-in category and every cvar group resolves to a
  non-empty ASCII English label from the shared layer; `commentLabelFor` returns the user's
  `action.name` for user-created entries and the catalogue label for materialized catalogue rows; a
  test asserts every shared literal equals the matching `en.json` value; the renderer's cvar group
  order comes from the shared constant and `SettingsTab` renders unchanged.

### D2 — Layout primitives, header block and cvar sections

- Files: new `src/shared/config/cfg-layout.ts`, `src/shared/config/render.ts`,
  `src/main/modules/config/render.test.ts`, new `src/shared/config/cfg-layout.test.ts`.
- Mirror for style/doc-comment density: the existing `src/shared/config/render.ts` and
  `alt-layers.ts`.
- `cfg-layout.ts` exports: `banner(title)` (ASCII `//` + `-`/`=` only), `section(...)` that omits
  itself when it has no lines, `alignRows(rows, caps)` (spaces only, per-section column), 
  `attachComment(code, comment, budget)` (truncate then drop), `sanitizeComment(text)`.
- Acceptance: `renderProfileFile` emits, in order, the unchanged `sentinelLine()` as line 1, a
  banner block with the profile name and the hand-edit sentence, then `set` lines grouped by
  `CvarDef.group` in the shared order with an "other" section for uncatalogued cvars; nothing is
  dropped; values are space-aligned per section; an empty group emits no banner; every line
  round-trips through latin-1 byte-identically; every line is within the strictest engine
  `maxLineBytes`; two calls on the same profile return identical strings (the existing determinism
  and latin-1 assertions in `render.test.ts` still pass, updated for the new layout).

### D3 — Alias, layer and bind sections with trailing comments

- Files: `src/shared/config/render.ts`, `src/main/modules/config/render.test.ts`, and whatever
  byte-equality expectations in `src/main/modules/config/{writer,canonical,sync,index}.test.ts`
  need re-baselining (they compare on-disk content to `renderProfileFile`, so most should hold).
- Acceptance:
  - Aliases are grouped by their entry's category (built-in order, then `profile.categories` order,
    then an "other" section); every generated alias line carries a trailing `// <label>`.
  - One section per layer in `profile.layers` order, the banner naming the layer, its mode
    (hold/toggle) and its trigger key; the layer's alias lines and its trigger bind line live in
    that section; today's skip rules (no aliases / no trigger key) are unchanged.
  - Binds are grouped by the owning action's category, ordered by the action's index in
    `profile.actions`, each with a trailing `// <label>`; binds with no owning action land in an
    "other binds" section sorted by key. A reverse index (bind value → action, via `bindValueFor` /
    `mirrorSlots`) is built inside render — there is no existing helper.
  - A bind whose command is empty is not written at all; `profile.binds` is not mutated.
  - No section is emitted with a banner and no content; nothing is silently dropped for tidiness.
  - Determinism, latin-1 round-trip and per-line budget hold for the whole file, comments included;
    a comment that would bust the budget is truncated and then dropped, never the command.
  - Named consequence, asserted or at least covered by a test comment: comment bytes count toward
    the size Care evaluates (`effectiveSize`), so a large profile can newly cross the engine
    exec-buffer warning — that is the intended surface, not a bug.

### D4 — `writeUnbindall` as a per-profile setting (data + handler)

- Files: `src/shared/modules/config.ts` (`ConfigProfile.writeUnbindall?`, `SetWriteUnbindallInput`,
  handler name in `CONFIG_HANDLERS`), `src/main/lib/schemas.ts` (`.catch(true)`),
  `src/main/modules/config/schemas.ts` (strict input schema),
  `src/main/modules/config/{profiles,index}.ts` (setter + handler registration),
  `src/renderer/src/modules/config/client.ts` (typed wrapper), `src/shared/config/render.ts`
  (emit the line).
- Mirror: `setPlayedMods` / `setSwitchBind` (`src/main/modules/config/index.ts:906-932`).
- Acceptance: a profile with no stored value behaves as `true`; the rendered file carries a single
  `unbindall` line directly after the header when on and no line at all when off; the setter
  persists and triggers the same canonical rewrite/sync the other write-affecting setters do; no
  migration entry is added; contract/coverage IPC tests stay green.

### D5 — The Raw File tab checkbox

- Files: `src/renderer/src/modules/config/RawFileTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: the played-mods `Checkbox` block at `RawFileTab.tsx:227-245`.
- Acceptance: the Raw File tab shows a "Start the file with `unbindall`" checkbox with a one-line
  hint, reflecting the profile's stored value; toggling it saves, the file shown below changes
  accordingly without a manual refresh; keyboard-reachable with a visible focus ring and a real
  label association (no new axe violation in `npm run ui:verify`).

### D6 — Highlighting and the two views still hold up

- Files: `src/shared/config/config-syntax.test.ts`, `docs/UI-VERIFICATION.md` only if a screen
  entry changes.
- Acceptance: new cases pin a `// --- Section ---` banner line as a single `comment` token and a
  multi-space-aligned trailing comment (`bind q "ssg_sg"   // SSG + SG`) as
  `command`/`space`/`key`/`string`/`space`/`comment`; the byte-identical
  `tokenizeConfigText(renderProfileFile(...))` round-trip still holds over the new layout; a
  `ui:verify` run shows the Raw File tab, `RawConfigPanel` and the write-preview dialog rendering
  the new layout with alignment intact and no new axe violations. No production change to
  `ConfigCodeView.tsx` is expected — the tokenizer already handles trailing comments and preserves
  whitespace runs; if the run proves otherwise, fix it here.

## Model Hints

- `D3 → deliverable-hard` — it rewrites the bind/alias/layer half of the writer on top of 038's and
  039's changes to the very same lines, has to invent a bind-value → action reverse index that no
  helper provides, and its regressions are silent on disk (a wrong reverse mapping mislabels or
  mis-sections a bind; a dropped bind is a lost keybinding) with byte-equality expectations in four
  other test files depending on its output.
- D1, D2, D4, D5, D6 → default tier.
- `Review: → story-review-hard` — the story replaces the single function every write, sync,
  canonical-file and cleanup path depends on, and the failure mode (an ownership sentinel that stops
  matching, or a bind that quietly stops being written) is invisible in a green test run.

## Test Plan (manual acceptance)

1. Start the app, open Config, pick the `Hantsch - Test` profile.
2. **Raw File tab** — the file now opens with the sentinel line, a banner with the profile name and
   the hand-edit sentence, an `unbindall` line, then commented sections. Check by eye: section
   banners are plain ASCII, values line up in columns, every `bind`/`alias` line ends in a readable
   `// <name>`, and highlighting still colours commands/keys/strings/comments.
3. Untick **"Start the file with `unbindall`"**. The shown file loses the `unbindall` line without a
   manual refresh; tick it again and it comes back in the same place.
4. **Controls tab** — rename a user-created entry, go back to Raw File: the trailing comment on its
   bind and alias lines follows the new name.
5. Create a new category with a name containing a non-ASCII-but-latin-1 character (e.g. `Nähkampf`)
   and one entry in it; Raw File shows that section banner intact, and the file still opens fine
   after a save (no mojibake, no broken line).
6. **Write preview** (Care / write action) — the preview dialog shows the same layout, aligned and
   highlighted, and writing produces exactly what the preview showed.
7. Save twice without changing anything and compare the written file bytes (Reveal in folder →
   check the file's modification/content stays identical) — determinism from the user's side.
8. Launch the installation once and confirm Quake II starts with the profile applied (the file the
   engine actually reads is the one with comments now).

## Coverage

| AC | Deliverable |
| --- | --- |
| Header block (name, sentinel, hand-edit line) | D2 |
| Grouped sections (cvars / aliases / layers / binds) | D2 (cvars, layout) + D3 (aliases, layers, binds), labels from D1 |
| Trailing `//` display-name comment per bind and alias | D3, labels from D1 |
| Column-aligned values, spaces not tabs | D2 (primitive) + D3 (applied per section) |
| Deterministic, byte-identical output | D2 + D3 (both keep/extend the determinism assertions) |
| Latin-1 round-trip unbroken | D2 (`sanitizeComment`, ASCII banners) + D3 |
| Every line inside the engine line-length budget | D2 (`attachComment` budget) + D3 |
| Unknown cvars/binds/aliases still written in an "other" section | D2 (cvars) + D3 (binds, aliases) |
| Empty section omitted, not an empty banner | D2 (`section()` primitive) + D3 |
| Raw File tab + write preview keep syntax highlighting | D6 |
| `unbindall` as a per-profile setting, default on (user decision, new scope) | D4 (data + render) + D5 (UI) |
| Empty binds dropped (user decision) | D3 |

## Done
