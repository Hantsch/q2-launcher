---
id: 020
title: Controls — rename Advanced and rebuild it as the column grid prototype
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

The tab called "Advanced" is where I bind things, so it should be called **Controls**. Its
current layout feels empty and unreadable: rows stretch across the whole window, an unbound slot
is invisible, and nothing tells me which column is what.

It should look and work like the prototype
[docs/prototypes/bindings/a-column-grid.html](../prototypes/bindings/a-column-grid.html) —
a dense, capped-width table with always-visible bind cells, the way a game's control settings
look.

Purely the tab's presentation and interaction; the entry-type/ordering model is story 019 and
should land first.

## Acceptance Criteria

- [ ] The tab is labelled "Controls" everywhere (tab strip, i18n key, any cross-references).
- [ ] Content width is capped (~1120px) instead of filling an ultrawide window.
- [ ] Sticky column headers: Action · (reset) · Primary · Secondary · Options.
- [ ] Rows are 40px, zebra-striped, with a hover highlight and a per-row reset action that only
      appears on hover.
- [ ] An action row shows its name plus its command in mono as a secondary label.
- [ ] Every bind slot is an always-visible filled cell — an unbound slot reads "Empty" rather
      than being blank; a bound slot shows the key; the primary slot of a bound row is visually
      the strongest element in the row.
- [ ] Clicking a slot enters capture ("Press a key…", dashed pulsing border); ESC cancels, DEL
      clears, and the footer states exactly that.
- [ ] A modifier-captured key renders its modifier as a small cap inside the slot (`ALT R`) and
      the Options column names the layer it went into.
- [ ] A conflicting bind is marked on the slot and the Options column names what else uses that
      key; the header shows a conflict count.
- [ ] Entries are visually grouped inside a category (group rule + label + count), matching the
      prototype's "Use weapon" / "Cycling" grouping.
- [ ] A filter box narrows rows by action name and command; the footer shows "n rows · m bound".
- [ ] "Restore defaults" is reachable from the header and asks before it discards binds.
- [ ] Colours, radii and spacing come from the design tokens — the prototype's hex values are
      reference, not implementation, and no raw hex or palette class ends up in the code.

## Open Questions

- ~~The prototype shows category tabs (Movement / Weapons / Weapon dropping / + New category).
  With 019's untyped categories and free reordering, does the tab strip scale to many custom
  categories, or should it become a scrollable rail?~~ answered → Decisions (Sprint)
- ~~"Restore defaults": per category or for the whole profile? And what is "default" for a
  custom category with no catalogue rows?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Category tab strip is a horizontally scrollable rail — scales to an unbounded
  number of custom categories instead of wrapping or shrinking tabs.
- **(User)** "Restore defaults" acts on the whole profile, not per category. A custom category
  with no catalogue default is simply cleared (there is no default to restore to).
- Tab id *and* i18n namespace rename: `'advanced'` → `'controls'` and `config.advanced.*` →
  `config.controls.*` (105 call sites) — AC 1 says "everywhere", and a tab labelled Controls
  whose keys still say advanced is the next reader's trap.
- One grid for every category: `DualBindPanel`, `DropBindPanel` and the generic action list
  collapse into a single `ControlsGrid` — three row idioms in one tab is exactly the
  unreadability this story exists to remove.
- Group rules (label + count) come from the action catalogue's own groups; a category without
  catalogue groups (every custom one) renders its entries as one ungrouped run — grouping is a
  catalogue property, not something the user authors in this story.
- Grid styling lives in a composed stylesheet next to `surfaces.css`, not in utility classes:
  sticky headers, zebra striping, the two-stop slot gradients and the capture pulse are what
  that layer exists for — every value reads a `@theme` token, no hex.
- Row 40px / slot 30px / reset 26px are kept exactly as the prototype specifies and recorded in
  `CLAUDE.md` as a deviation from the design-tokens skill's 44px touch floor, because this is a
  mouse-and-keyboard desktop Electron app with no touch surface.
- While capturing, `Delete` clears the slot instead of binding the physical Delete key; the
  footer legend states it and the Overview keycap path (story 017) still reaches that key —
  AC 7 asks for DEL to clear and a slot cannot mean both.
- A blocked capture (collision prompt with Cancel/Replace) renders as an expanded full-width
  sub-row under its row, not inside the slot — a 190px column cannot hold a sentence plus two
  buttons without breaking the column alignment the redesign is about.
- The header conflict count is profile-wide, not per category — a key bound twice is a conflict
  no matter which drawer you happen to be looking at.
- A conflict is marked by border tone **plus** a warning glyph in the slot **plus** the Options
  text; never colour alone (accessibility floor).
- "Restore defaults" writes each catalogue row's `suggestedKeys[0]` into its primary slot and
  clears the secondary; entries with no catalogue row are cleared — that is the only definition
  of "default" this repo actually has.
- Alias entries (019) render their Primary/Secondary cells as inert placeholders, not slots —
  019's AC says binding an alias must be impossible through the UI, not merely discouraged.
- The filter matches action name and command, case-insensitively, within the active category
  only; the footer's "n rows · m bound" follows the filter, so the numbers explain what is on
  screen.
- The grid is CSS grid over divs carrying `role="table"/"row"/"columnheader"/"cell"` — the
  layout needs the div structure, the column headers still have to be announced.
- Drops rows keep their ammo toggle inline in Options; the per-row team message moves behind an
  icon button that opens the existing editor in a `Modal` — a free-text field does not fit 150px.

## Plan

Sequence: rename first (mechanical, touches everything), then the style layer, then the grid
top-down (shell → row → slot → options), then the header/footer features, then docs.

1. **Rename** `advanced` → `controls`: `DetailTab` union, tab entry and dispatch in
   `ConfigView.tsx`; `AdvancedTab.tsx` → `ControlsTab.tsx`; the `config.advanced.*` i18n
   namespace → `config.controls.*` in `en.json` and all 105 call sites; `labelKey`s in
   `src/shared/modules/config.ts`; wording in `docs/systems/config-module.md`.
2. **Style layer** `src/renderer/src/styles/controls-grid.css` (imported from `index.css`):
   `.ctrl-colhead`, `.ctrl-row`, `.ctrl-group`, `.ctrl-slot` + `is-bound` / `is-primary-bound` /
   `is-capturing` / `is-conflict`, capture pulse behind `prefers-reduced-motion`. Token values
   only. Plus the 40px-row deviation note in `CLAUDE.md`.
3. **Grid shell** `components/ControlsGrid.tsx`: 1120px cap, sticky colhead
   (Action · reset · Primary · Secondary · Options), group rule + label + count, footer legend
   (`ESC` cancel · `DEL` clear · `ALT`+key → layer) and "n rows · m bound".
4. **Row** `components/ControlsRow.tsx`: 40px, name + mono command, hover-only reset.
5. **Slot** rewrite `components/BindSlot.tsx` into the always-visible cell — click captures,
   ESC cancels, DEL clears, `ALT R` cap, conflict marker. Capture/collision/modifier logic
   (`useKeyCapture`, `modifier-capture.ts`, `bind-slot-collision.ts`) is reused unchanged; only
   the surface and the blocked-capture placement change.
6. **Options cell** `components/ControlsOptionsCell.tsx`: layer badge, "also: X", drops' ammo
   toggle + message button.
7. **Conflict scan** `lib/bind-conflicts.ts` (+ test) feeding the header badge.
8. **Filter** in `ControlsTab.tsx`, wired to the footer counts.
9. **Category rail**: horizontally scrollable strip, CRUD kept, no entryKind badge (019).
10. **Restore defaults**: `lib/restore-defaults.ts` (+ test), header button, confirm `Modal`.
11. **Docs + audit**: `docs/systems/config-module.md`, hex/palette grep, harness screenshot.

Depends on 019 landing first: a row reads the entry's own kind (`bind` | `message` | `alias`)
and renders in array order; nothing here may reintroduce `ConfigActionCategory.entryKind`.

## Deliverables

- **D1 — Advanced is Controls, everywhere.**
  Files: `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/modules/config/AdvancedTab.tsx` → `ControlsTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`, `src/shared/modules/config.ts`,
  `docs/systems/config-module.md`, plus the `config.advanced.*` call sites in
  `components/{BindSlot,DualBindPanel,DropBindPanel,ActionEditor,MessageEditor,SymbolPicker}.tsx`,
  `LayersPanel.tsx` and `lib/catalog-binds.ts`.
  Accept: the tab id is `'controls'`, the tab reads "Controls", a grep for `config.advanced`
  over `src/` is empty, build + typecheck + tests green. → AC 1

- **D2 — The grid's style layer, in tokens.**
  Files: new `src/renderer/src/styles/controls-grid.css`, `src/renderer/src/styles/index.css`
  (import), `CLAUDE.md` (deviation note). Mirror: `src/renderer/src/styles/surfaces.css`.
  Accept: every class the prototype needs exists and resolves to `@theme` tokens; no hex, no
  palette class; pulse and hover transitions disabled under `prefers-reduced-motion`; the
  40px-row deviation from `/design-tokens` is written down with its reason. → AC 4, 12

- **D3 — Grid shell: cap, sticky headers, groups, footer.**
  Files: new `components/ControlsGrid.tsx`, `ControlsTab.tsx` (renders it).
  Mirror: `components/DualBindPanel.tsx` for the group/catalogue-row wiring,
  `OverviewKeyboardPanel.tsx` for the dense-grid idiom.
  Accept: content stops at 1120px on a 2560px-wide window and stays centred; the header row
  sticks while scrolling and reads Action · (reset) · Primary · Secondary · Options; each
  catalogue group shows rule + label + count; the footer shows the ESC/DEL/ALT legend and
  "n rows · m bound". → AC 2, 3, 7 (footer), 9, 10 (counts)

- **D4 — The row.**
  Files: new `components/ControlsRow.tsx`, `components/ControlsGrid.tsx`.
  Accept: 40px height, zebra striping, hover highlight; name plus its command in mono as a
  secondary label; a reset button invisible until the row is hovered or keyboard-focused, with an
  `aria-label`, that resets that row's binds. → AC 4, 5

- **D5 — The slot is a cell.**
  Files: `components/BindSlot.tsx` (rewritten surface), `components/ControlsRow.tsx`.
  Reuses unchanged: `lib/useKeyCapture.ts`, `lib/modifier-capture.ts`,
  `lib/bind-slot-collision.ts`.
  Accept: every slot is a filled cell — unbound reads "Empty", bound shows the key, a bound
  row's primary slot is the strongest element in the row; clicking enters capture with
  "Press a key…" and a dashed pulsing border; ESC cancels, DEL clears; a modifier capture
  renders `ALT R` with the modifier as a small cap; a blocked capture opens its Cancel/Replace
  prompt as a full-width sub-row; an alias entry has inert placeholder cells; the existing
  collision and modifier-layer tests stay green. → AC 6, 7, 8 (slot marker)

- **D6 — The Options column.**
  Files: new `components/ControlsOptionsCell.tsx`, `components/ControlsRow.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  Accept: a modifier-bound row names its layer; a conflicting row reads "also: <owner>" with a
  danger tone and a glyph; an ordinary row reads "—"; a drops row still reaches its ammo toggle
  and its team message. → AC 8 (Options text)

- **D7 — Profile-wide conflict count.**
  Files: new `lib/bind-conflicts.ts` + `lib/bind-conflicts.test.ts`, `ControlsTab.tsx`.
  Mirror: `src/shared/config/bind-collision.ts`.
  Accept: a key held by two owners is reported once with both owners; the header shows the count
  as a warning badge with an icon and an accessible name; zero conflicts shows no badge; unit
  tests cover base binds, action slots and modifier-layer overrides. → AC 8 (header count)

- **D8 — Filter.**
  Files: `ControlsTab.tsx`, `components/ControlsGrid.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  Accept: typing narrows rows by action name *and* command, case-insensitively; group headers
  with no surviving row disappear; the footer counts follow the filter; clearing the box restores
  everything. → AC 10

- **D9 — The category rail.**
  Files: `ControlsTab.tsx`, `src/renderer/src/styles/controls-grid.css`.
  Accept: the strip scrolls horizontally instead of wrapping, keeps create / rename / delete and
  "+ New category", shows no entryKind badge, and the selected tab is scrolled into view when it
  is off-screen. → (User) decision on the rail

- **D10 — Restore defaults.**
  Files: new `lib/restore-defaults.ts` + `lib/restore-defaults.test.ts`, `ControlsTab.tsx`.
  Mirror: `components/CvarRow.tsx` for the reset idiom, `Modal` for the confirm.
  Accept: the header button asks before discarding; confirming restores every catalogue row's
  `suggestedKeys[0]` as primary, clears secondaries and clears entries with no catalogue row,
  across the whole profile; cancelling changes nothing; a unit test pins both branches. → AC 11

- **D11 — Docs and the token audit.**
  Files: `docs/systems/config-module.md`.
  Accept: the doc describes the Controls tab as it now is; a grep for hex literals and raw
  palette classes over the files this story touched is empty; a harness screenshot of the
  Controls tab exists (story 026) or the manual pass below is recorded. → AC 12

## Model Hints

- D5 → `deliverable-hard` — it rewrites the surface of the one component that owns key capture,
  modifier classification and collision resolution (stories 015/016), where a regression is
  silent: a slot that still looks right but writes the wrong `keyModifier`, or stops releasing a
  previous owner, corrupts profiles instead of throwing.
- D1–D4, D6–D11 → default tier (mechanical rename, CSS layer, presentational components, two
  small pure-logic helpers with their own tests).
- Review: → `story-review-hard` — the diff touches every bind interaction path in the module
  plus a 105-site i18n rename, so the review has to check behaviour preservation across
  015/016/019 territory, not just the new layout.

## Test Plan (manual acceptance)

`npm run dev`, then:

1. Config → a profile → the tab strip reads **Controls** (not Advanced). Open it.
2. Widen the window to ultrawide: the table stops growing at ~1120px and stays centred.
3. Scroll the list: the Action · Primary · Secondary · Options header stays put. Groups
   ("Use weapon", "Cycling") show a rule, a label and a row count.
4. Hover a row: it highlights and the reset button appears. Every row shows its name plus its
   command in mono.
5. Every slot is a filled cell; unbound ones read "Empty".
6. Click an empty Primary slot: it reads "Press a key…" with a dashed pulsing border. Press
   `ESC` — nothing changes. Click again, press `DEL` — the slot stays empty. Click again, press
   `1` — the slot shows `1` and is the strongest element in the row.
7. Click a Secondary slot and press `Alt`+`R`: the slot shows a small `ALT` cap next to `R` and
   Options names the layer. Check the Layers panel — the ALT layer exists.
8. Bind a key another row already holds: the slot marks the conflict, Options reads
   "also: <that row>", the Cancel/Replace prompt appears under the row, and the header shows a
   conflict count. Cancel — nothing changed.
9. Type part of an action name, then part of a command, into the filter: rows narrow both times
   and the footer's "n rows · m bound" follows.
10. Create two custom categories and rename one to something long: the rail scrolls horizontally
    instead of wrapping, and the selected tab stays visible.
11. Press the per-row reset on a bound row: only that row clears.
12. "Restore defaults" in the header: a confirm appears. Cancel — nothing changed. Confirm —
    catalogue rows return to their suggested keys, custom entries are empty. Restart the app:
    it persisted.

## Done
