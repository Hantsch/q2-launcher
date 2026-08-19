---
id: 013
title: Compact the empty alt-layers state and move the layer switcher next to the keyboard overview
status: done
created: 2026-08-18
---

## Requirement

As a user with no alt layers yet, I want the "no alt layers" state to take up little vertical
space instead of dominating the screen. And since flipping between the base layer and a
specific alt layer is something I do constantly while working on the keyboard overview, I want
that switcher positioned right next to the keyboard overview itself, not above it in a separate
panel — so switching and looking at the board happen in the same glance.

## Acceptance Criteria

- [x] With zero alt layers on a profile, the alt-layers panel renders as a compact hint rather
      than a large, tall empty-state block.
- [x] The base/layer switcher (pick which layer's state is currently shown/edited on the board)
      sits next to the keyboard overview's own header, not inside the layers management panel.
- [x] Layer CRUD (create, rename, delete, generated-alias preview) keeps working from wherever it
      now lives; moving the switcher does not remove or hide any existing layer-management
      capability.
- [x] The keyboard overview subtitle/legend ("Bound in an alt layer" etc.) is unaffected by this
      layout change — this story only relocates/compacts, it does not change what the legend
      means (see the follow-up story on trigger visibility for that).

## Open Questions

_None._

## Decisions (Sprint)

- **Switcher becomes its own component** `modules/config/components/LayerSwitcher.tsx` instead of
  being inlined a second time in `OverviewKeyboardPanel` — 014 needs the board to drive layer
  selection too, so one owner of "pick the shown layer" keeps both panels small.
- **Switcher is placed in the keyboard overview's own header row**, right of the
  `SectionLabel`/subtitle block and left of the edit/test-mode buttons, above the legend — AC2 asks
  for "next to the keyboard overview's own header", and the legend row must stay untouched (AC4).
- **`OverviewKeyboardPanel` gains only `onSelectLayer`**; the layer list is derived from the
  `profile.layers` it already receives and the active id from the `activeLayer` it already
  receives — minimum prop churn, no new state owner.
- **Selected-layer state stays local in `ConfigView`** (`activeLayerId`), not moved to Zustand — it
  is per-view ephemeral UI state, and the store holds no config state today.
- **`LayersPanel` keeps `activeLayerId` + `onSelectLayer`** even after losing the switcher row —
  deleting the currently shown layer must still reset the board to Base.
- **Zero layers renders one hint line, no `EmptyState`** — the tall centred block (icon + h3 +
  body, `py-12`) is exactly the "dominating" state AC1 rejects; a single `text-xs text-ink-muted`
  paragraph is the compact form and matches how other secondary hints read in this panel.
- **One new i18n key `config.layersPanel.empty.compact` replaces `empty.title` + `empty.body`** (both
  removed) — the compact line must still say "no alt layers yet" plus the one-sentence why, and
  leaving dead keys behind violates the i18n-hygiene rule.
- **Overview tab order is swapped: board first, layers panel below** — the requirement's complaint
  is that layer management pushes the board down the screen; a one-line reorder in `ConfigView`
  serves that intent and the board is the primary work surface.
- **The switcher is hidden while a profile has zero layers** (today's behaviour, kept) — with only a
  base layer there is nothing to switch between, and the compact hint already explains the state.
- **Switcher gets `role="group"` + `aria-label` and `aria-pressed` on its buttons** — it is a
  segmented single-choice control; extracting it is the cheap moment to make that semantic.
- **No component/render tests** — the renderer has no `@testing-library/react` setup and adding one
  is out of this story's scope; acceptance is `npm run build` + `npm test` green plus the live UI
  smoke (P2) in the test plan below.
- **Nothing trigger-related is touched** (create dialog, `trigger: {{key}}` line, alias preview) —
  011 lands first in this sprint and owns that rendering; 013 only relocates and compacts.

## Plan

Renderer-only layout change inside `src/renderer/src/modules/config`. No IPC, no main, no schema,
no state-shape change. Two steps, in order:

1. **Compact the zero-layer state** in `LayersPanel.tsx`: replace the `EmptyState` branch with a
   single hint paragraph using a new `config.layersPanel.empty.compact` key; when layers exist the
   existing `config.layersPanel.hint` paragraph stays as-is. Drop the now-unused `EmptyState` and
   `Layers` icon imports and the `empty.title` / `empty.body` keys.
2. **Relocate the switcher**: extract the inline switcher row (currently `LayersPanel.tsx` ~161-184)
   into `components/LayerSwitcher.tsx`, delete it from `LayersPanel`, render it in
   `OverviewKeyboardPanel`'s header row, and pass `onSelectLayer` down from `ConfigView` (which
   already owns `activeLayerId`). Swap the two panels in the overview tab so the board comes first.

Affected files:

- `src/renderer/src/modules/config/components/LayerSwitcher.tsx` (new)
- `src/renderer/src/modules/config/LayersPanel.tsx`
- `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`
- `src/renderer/src/modules/config/ConfigView.tsx`
- `src/renderer/src/i18n/locales/en.json`

Guardrails: semantic tokens only (`text-ink-muted`, `border-line`, existing `Button` variants) — no
hex, no raw palette class, no image asset. Strings via `t(...)` only. Note that 011 lands before
this story and also edits `LayersPanel.tsx` (trigger handling) — target sections by role, not by
line number, and leave every trigger-related render path alone.

## Deliverables

### D1 — Compact zero-layer state in the layers panel

Replace the tall `EmptyState` block with a one-line hint. When `(profile.layers ?? []).length === 0`,
render a single `<p className="text-xs text-ink-muted">{t('config.layersPanel.empty.compact')}</p>`
instead of both the standing `config.layersPanel.hint` paragraph and the `EmptyState`; when layers
exist, output is unchanged. Remove the `EmptyState` / `Layers` imports if they become unused.

- Files: `src/renderer/src/modules/config/LayersPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json`
- i18n: add `config.layersPanel.empty.compact` = "No alt layers yet — create one to bind keys
  independently while a trigger key is held or toggled on."; remove `config.layersPanel.empty.title`
  and `config.layersPanel.empty.body` (verify no other reference remains).
- Accepted when: a profile with zero layers shows the section label, the "New layer" button and one
  short hint line and nothing taller; a profile with layers looks exactly as before; build + tests
  green; no unused import left.

### D2 — Extract the layer switcher and move it into the keyboard overview header

Move the base/alt switcher out of the management panel and into the board's header.

- New `src/renderer/src/modules/config/components/LayerSwitcher.tsx` — props
  `{ layers: readonly AltLayer[]; activeLayerId: string | null; onSelect: (layerId: string | null) => void; className?: string }`.
  Body is the existing markup lifted verbatim (label `config.layersPanel.selector.label`, a
  `primary`/`neutral` `Button` per entry starting with `config.layersPanel.selector.base`), plus
  `role="group"`, `aria-label` from the label key and `aria-pressed` per button. Returns `null` when
  `layers.length === 0`. Mirror the file style of
  `src/renderer/src/modules/config/components/KeyBindDialog.tsx` (same folder, same import order).
- `LayersPanel.tsx` — delete the inline switcher block; keep the `activeLayerId` / `onSelectLayer`
  props and the delete-clears-active-selection behaviour.
- `OverviewKeyboardPanel.tsx` — add `onSelectLayer: (layerId: string | null) => void` to the props;
  render `<LayerSwitcher layers={profile.layers ?? []} activeLayerId={activeLayer?.id ?? null} onSelect={onSelectLayer} />`
  inside the existing header flex row, between the label/subtitle block and the edit/test-mode
  buttons. Do not touch the legend row, the keycap renderers or the zoom logic.
- `ConfigView.tsx` — pass `onSelectLayer={setActiveLayerId}` to `OverviewKeyboardPanel`, and swap
  the overview tab's children so `OverviewKeyboardPanel` renders above `LayersPanel`.
- Files: the four above (one new, three edited).
- Accepted when: the switcher appears once, in the board header; Base + every layer are selectable
  and the active one is highlighted with `aria-pressed="true"`; keycap override styling and the
  dimmed "Bound in an alt layer" badge still react to the selection; layer create/rename/delete and
  the alias preview still work from the panel below the board; deleting the shown layer returns the
  board to Base; the legend row is byte-identical; build + tests green.

## Model Hints

- D1 → default
- D2 → default
- Review: → default — renderer-only relocation of existing markup: no IPC, main-process, schema or
  persistence surface is touched and no logic changes, so the regression surface is one tab's layout.

## Test Plan (manual acceptance)

Live UI smoke (P2), `npm run dev`:

1. Config → pick a profile that has **no** alt layers → Overview tab. Expect: keyboard board at the
   top; below it "Alt layers", the "New layer" button and a single short hint line — no large
   centred empty block, no layer switcher.
2. Create a layer ("Test") from that panel. Expect: the switcher appears in the **keyboard
   overview's header** (next to "Keyboard overview" / "n of m keys bound"), showing `Base` and
   `Test`, with `Base` active. No switcher inside the layers panel.
3. Click `Test`. Expect: the board switches to the layer view (overridden keycaps styled, the
   "Bound in an alt layer" badge no longer dimmed) and `Test` is the highlighted button. Click
   `Base` → back.
4. Tab through the header with the keyboard. Expect: switcher buttons are reachable and focus-visible.
5. From the layers panel: rename the layer, expand its alias preview, then delete it. Expect: rename
   and preview work as before; after deleting the layer that was being shown, the board falls back
   to Base and the switcher disappears again.
6. Confirm the legend row still reads Free / Bound / Bound in an alt layer, unchanged.

## Done

**Summary.** D1 collapsed the zero-alt-layers state in `LayersPanel.tsx` to a single
`text-xs text-ink-muted` hint line (`config.layersPanel.empty.compact`), replacing the old
`EmptyState` block and its two removed i18n keys (`empty.title`/`empty.body`). D2 extracted the
inline base/layer switcher into `modules/config/components/LayerSwitcher.tsx` (`role="group"`,
`aria-label`, `aria-pressed` per button), removed it from `LayersPanel`, and rendered it in
`OverviewKeyboardPanel`'s header row via a new `onSelectLayer` prop; `ConfigView.tsx` now renders
the board before the layers panel and wires `onSelectLayer={setActiveLayerId}`. No IPC, main,
schema or persistence surface touched; the legend row and all layer-CRUD/alias-preview logic are
unchanged.

**Decisions** (implementation-detail calls made without a user to ask, verified against plan +
acceptance criteria):
- Kept `LayerSwitcher`'s outer wrapper as `<div className={cn('flex flex-wrap items-center gap-2', className)}>` with the `config.layersPanel.selector.label` caption inside it (same visual shape as the original inline block), and put `role="group"`/`aria-label` on the inner button-row `div` rather than the outer wrapper, since that inner div is the actual segmented control — the caption text sits outside the group.
- `OverviewKeyboardPanel` passes `className="flex flex-wrap items-center gap-2"` explicitly to `<LayerSwitcher>` even though it matches `LayerSwitcher`'s own default — left as-is after review flagged it as a harmless redundant literal (no visual/behavioral difference); not worth a follow-up edit.
- Header layout: `LayerSwitcher` sits as a third flex child between the label/subtitle block and the edit/test-mode buttons inside the existing `flex flex-wrap items-center justify-between gap-3` row, per the plan's placement instruction; no extra wrapper div was needed since the row already wraps.

**Commit message:**
```
013: compact empty alt-layers state, move layer switcher into keyboard overview header
```

**Verification:**
- `npx tsc -p tsconfig.web.json --noEmit` — clean.
- `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npm run build` — green (main/preload/renderer all built).
- `npm test` — 25 files / 435 tests, all passed; no test weakened, skipped or deleted.
- Clean-agent code review — overall **PASS**. All four acceptance criteria PASS with file:line
  evidence; no scope creep beyond the five deliverable-mapped files; i18n hygiene confirmed (no
  dangling `empty.title`/`empty.body` references); legend row confirmed byte-identical; no
  trigger-related code touched. One cosmetic note (redundant `className` literal, see Decisions)
  — no fix required, no re-review cycle needed.
- **Live UI smoke (P2): not performed.** This environment has no way to interactively drive the
  Electron window — no Playwright installed in this project, no `ui-verify` harness scaffolded
  yet, and the available Playwright MCP tools only drive a browser page, not an Electron app.
  Per this project's P2 policy this is an expected limitation, not a failure: the story is
  **built, live acceptance pending**. The 6-step manual test plan above is ready for a human (or
  a future `ui-verify`-equipped session) to run via `npm run dev`.
