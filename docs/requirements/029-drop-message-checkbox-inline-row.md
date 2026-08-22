---
id: 029
title: Drop-row team message as checkbox + inline row (mirrors "With ammo")
status: ready
created: 2026-08-20
---

## Requirement

In Config → Controls, every row in the "drops" category (weapon drops, ammo drops, misc drops)
currently exposes its team message via an icon button in the Options cell
(`ControlsTab.tsx`'s `renderCatalogOptionsCell`, `MessageSquare`/`MessageSquareText`): clicking it
jumps straight into the full `MessageEditor` modal, and whether a message is set is only
distinguishable by the icon's filled vs. outline state.

Weapon-drop rows that also have a matching ammo item already show a different pattern right next
to that icon: a plain "With ammo" checkbox (`config.controls.dropBind.withAmmo`,
`applyAmmo`/`deriveRowState`'s `withAmmo`). The message option should work the same way instead of
the icon button: a checkbox (e.g. "With message" — the exact wording is a small thing, not worth
a design detour) sitting in the Options cell like "With ammo" does. Checking it reveals a message
row directly below that catalogue row in the grid, showing the current message text and a button
that opens the existing rich `MessageEditor` modal (channel choice, macro bar, symbol picker, live
preview — unchanged) for full editing. Unchecking it hides that row again.

This is a presentation change only — the underlying data model (`ConfigCommand` of kind
`'message'` on the action) and the `MessageEditor` modal's own editing capabilities are not
expected to change. What changes is how the message option is reached and shown at a glance,
consistent with how the ammo option already works.

How the inline message row fits into the Controls grid's layout — today built on a fixed 40px row
height (`controls-grid.css`, see the `/design-tokens` deviation entry in `CLAUDE.md`) — is left to
`/refine` to work out; this story only states the desired behaviour, not the grid mechanics.

## Acceptance Criteria

- [ ] Each drop row (weapon, ammo, misc) in Config → Controls shows a "With message"-style
  checkbox in its Options cell, replacing today's message icon button.
- [ ] For a weapon-drop row that also has an ammo item, the "With message" checkbox sits alongside
  the existing "With ammo" checkbox with the same visual weight (no icon-button leftover).
- [ ] Checking "With message" reveals a message row directly below that catalogue row, showing the
  action's current message text (or an empty/placeholder state if none is set yet) plus a button
  to edit it.
- [ ] That button opens the existing `MessageEditor` modal unchanged (channel choice, macro bar,
  symbol picker, live preview, key capture).
- [ ] Unchecking "With message" hides the message row again.
- [ ] The checkbox's checked state reflects whether the action currently carries a `message`
  command, the same way "With ammo" reflects `ammoCommand` inclusion today.
- [ ] No regression to the existing ammo toggle, key binding slots, or the Options cell's
  layer/conflict text.

## Open Questions

None — resolved in `## Decisions (Sprint)`.

## Decisions (Sprint)

- **The editor a drop row opens is `components/MessageEditor.tsx`; the local `DropMessageDialog`
  in `ControlsTab.tsx` is deleted** — the AC names the rich editor's capabilities (channel, macro
  bar, symbol picker, preview) explicitly, while today's drop rows open a plain text-only `Modal`,
  so the swap is part of this story, not extra scope.
- **`MessageEditor` hands back a `{ channel, text, key? }` draft instead of a whole
  `ConfigAction`** — its current `save` replaces `action.commands` wholesale, which would wipe a
  drop action's `drop weapon`/ammo raw commands; letting each call site merge keeps the editor free
  of drop-specific knowledge.
- **Key capture is hidden for drop rows (`showKeyCapture={false}`, default `true`)** — a catalogue
  row's key is owned by the grid's `BindSlot`s with their collision/replace flow, so a second,
  collision-blind key editor on the same field would regress AC 7's "no regression to key binding
  slots"; the Requirement's own capability list omits key capture.
- **A drop message may now carry `channel: 'say'` as well as `say_team`** — the editor's channel
  `Select` is part of the AC, so `deriveRowState`/`applyMessage`/`isEmptyAction` stop hardcoding
  `say_team` rather than shipping a control whose value is silently discarded.
- **Checkbox state = "action carries a message" OR "user just checked it"**, held in a local
  `Set` of revealed `catalogId`s — an empty message is never persisted (`applyMessage('')` prunes
  it), so without the local set the box could not stay checked while the user is still on the way
  to typing the first message.
- **Unchecking clears the message immediately, no confirm dialog** — AC 6 makes the box a mirror of
  the stored command, so a hidden-but-still-saved message would contradict it; this is exactly how
  the "With ammo" checkbox already mutates on toggle.
- **The inline row is a new explicit `subRow` prop on `ControlsRow`, not the existing
  `BindPromptHostContext` portal host** — two independent consumers portalling into the one host
  would fight over it; a second sibling `role="row"`/`role="cell"` pair reuses the proven
  `.ctrl-subrow` styling and, like the prompt host, carries no zebra class, so `odd` parity stays
  intact.
- **The inline row sits after the prompt host** — the prompt is transient and must stay glued to
  the row it blocks; that host collapses via `:empty` in the normal case, so the message row still
  renders directly under the catalogue row.
- **No new React component test file; verification is the pure-lib unit tests plus the live smoke
  run** — there is no component test setup for `ControlsTab`/`ControlsRow` today and inventing one
  is a separate story (`live-smoke-required: true` covers the surface).

## Plan

Renderer-only, four steps, bottom-up (pure lib → editor contract → row shell → tab wiring):

1. **`lib/catalog-binds.ts` (pure)** — make the drop message channel-aware: `RowState` gains
   `messageChannel?: 'say' | 'say_team'`; `deriveRowState`'s `lastMessage`, `lastMessageCommand`
   and `isEmptyAction` drop their `channel === 'say_team'` filter;
   `applyMessage(actions, row, text, channel = 'say_team')`. Extend `lib/catalog-binds.test.ts`
   accordingly — existing callers keep working through the default.
2. **`components/MessageEditor.tsx`** — `onSave(draft: { channel, text, key?: string })` instead of
   `onSave(next: ConfigAction)`; new optional `showKeyCapture` (default `true`) and `titleName`
   (default `action.name`). Everything else — channel `Select`, macro bar, `SymbolPicker`, preview,
   single-`$` warning, quote filtering — untouched. The existing `kind === 'message'` call site in
   `ControlsTab.tsx` does the `{ ...action, commands: [message], key }` merge itself.
3. **`components/ControlsRow.tsx` + `styles/controls-grid.css`** — optional `subRow?: ReactNode`,
   rendered as a second sibling `role="row"` > `role="cell"` pair below the prompt host, nothing
   rendered when the prop is absent. New `.ctrl-msgrow` rules reusing `.ctrl-subrow`'s padding and
   `--color-raised`/`--color-line`, label indented to the Action column, text truncating; tokens
   only, no hex.
4. **`ControlsTab.tsx` + `i18n/locales/en.json`** — in `renderCatalogOptionsCell` replace the
   `IconButton` with a `Checkbox` (`config.controls.dropBind.withMessage`) next to the ammo one;
   add `revealedMessageRows` state (`Set<string>` of `catalogId`); `renderCatalogRow` passes
   `subRow` when `row.categoryId === 'drops'` and the row is revealed (current text or
   `messagePlaceholder`, plus an "Edit" `Button` that sets `messageEditorRow`); the drop-row
   `MessageEditor` instance saves through `applyMessage(..., text, channel)`. Delete
   `DropMessageDialog`, any now-unused imports (`MessageSquare`, `MessageSquareText`, `IconButton`)
   and the keys that fall out of use (`messageDialogTitle`, `editMessageSet`).

Order: 1 and 2 are independent; 4 depends on 1, 2 and 3.

## Deliverables

- **D1 — channel-aware drop message in the pure lib.**
  Files: `src/renderer/src/modules/config/lib/catalog-binds.ts`,
  `src/renderer/src/modules/config/lib/catalog-binds.test.ts`.
  Acceptance: `deriveRowState` reports a `say` message too and returns its channel; `applyMessage`
  writes the passed channel (default `say_team`, today's callers unchanged); an action whose only
  content is a `say` message is not pruned; `npm test` green.
- **D2 — `MessageEditor` returns a draft and can hide key capture.**
  Files: `src/renderer/src/modules/config/components/MessageEditor.tsx`,
  `src/renderer/src/modules/config/ControlsTab.tsx` (existing `kind === 'message'` call site only).
  Acceptance: editing a Team-messages action still saves channel + text + key exactly as before
  (merge now in `ControlsTab`); `showKeyCapture={false}` renders the modal without the key block;
  typecheck + build green.
- **D3 — `ControlsRow` sub-row slot + inline-row styling.**
  Files: `src/renderer/src/modules/config/components/ControlsRow.tsx`,
  `src/renderer/src/styles/controls-grid.css`. Mirror: the existing `.ctrl-subrow-host-row` /
  `.ctrl-subrow` block in the same CSS file.
  Acceptance: with no `subRow` the grid renders exactly as today (zebra parity, row heights); with
  a `subRow` a full-width row appears under the catalogue row with valid `role` nesting, using
  `--color-*` tokens only.
- **D4 — "With message" checkbox + inline message row wired in the Controls tab.**
  Files: `src/renderer/src/modules/config/ControlsTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`. Mirror: the `withAmmo` `Checkbox` a few lines above.
  Acceptance: all seven ACs hold in the running app; message icon button and `DropMessageDialog`
  are gone; ammo toggle, bind slots and the layer/conflict text unchanged; no unused i18n key and
  no unused import left behind.

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- D4 → `deliverable-hard` — it rewires the 150px Options cell that already juggles ammo, layer and
  conflict content, adds a reveal-state set that must stay consistent with the derived
  "message set" flag, and swaps the modal a drop row opens, where a wrong merge silently drops a
  drop action's raw commands.
- Review: → default — renderer-local presentation change plus one pure lib whose behaviour is
  pinned by D1's unit tests.

## Test Plan (manual acceptance)

1. `npm run dev` (or `npm run ui:verify` for the screenshot/a11y pass), open **Config → Controls**,
   pick a profile and scroll to the **Weapons / Ammunition / Misc** drop groups.
2. A weapon-drop row with ammo shows **two plain checkboxes** — "With ammo" and "With message" —
   and no message icon button anywhere in the Options column.
3. Check "With message" on that row: a full-width row appears directly underneath with placeholder
   text and an **Edit** button; heights and zebra striping of the surrounding rows are unchanged.
4. Click **Edit**: the full message editor opens with channel select, macro buttons, symbol picker
   and live preview — and **no** key-capture block. Type a message, Save.
5. The inline row now shows that text and the checkbox stays checked. Save the profile, reopen the
   tab: checkbox still checked, text still there.
6. Uncheck "With message": the inline row disappears and the message is gone (reopen the tab to
   confirm it was not silently kept).
7. Regression sweep on the same row: toggle "With ammo"; capture a primary and a secondary key;
   force a collision (bind a key already used elsewhere) and confirm the Cancel/Replace prompt
   still renders under the row; confirm the Options cell's layer / "also: &lt;owner&gt;" text is
   unchanged.

## Done
