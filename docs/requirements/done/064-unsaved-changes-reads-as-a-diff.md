---
id: 064
title: Unsaved changes read as a real diff
status: done
created: 2026-09-07
---

## Requirement

The Unsaved tab tells the user *that* something is pending but not *what* changed. Story
[[049-unsaved-changes-reviewable-and-discardable]] built a structured change list
([ProfileChangeList.tsx](../../src/renderer/src/modules/config/components/ProfileChangeList.tsx))
over a change set whose model already carries `before`/`after` per change
([profile-diff.ts:90-97](../../src/shared/config/profile-diff.ts#L90-L97)) — but on screen the user
cannot read off what a Save would actually write. Reported verbatim: "Unsaved changes are no clean
diff, I don't know what changed."

Wanted: every pending change states the concrete old value and the concrete new value, side by
side, for the thing it names — a cvar's value, a key's bind, an entry's command body, a layer's
trigger — so the tab answers "what will this Save do?" without going to the Raw File tab and
comparing by eye.

The screenshot that came with the report is not in the repo, so which section reads worst is not
established. Refine must first check, per section (`cvars`, `binds`, `actions`, `layers`,
`settings`, `unrecognized`), whether the change set even *produces* a usable `before`/`after` today
or whether some sections emit prose/counts — a rendering fix cannot show a value the diff never
computed.

The existing decision from story 049 (a structured list, **not** a text diff of the rendered file)
stays: the goal is a readable per-item before → after, not a patch view.

## Acceptance Criteria

- [x] **AC1** — Every pending change in the Unsaved tab shows the value before and the value after,
      both concrete, for the item it names.
- [x] **AC2** — Added and removed items are distinguishable from modified ones (an added item has no
      "before", a removed one no "after") without relying on colour alone.
- [x] **AC3** — No section reports a change as a bare count or as prose without naming the affected
      item.
- [x] **AC4** — The change set behind the tab is unchanged in scope: the same changes are listed as
      before, only more legibly — the count in the header badge still matches the list.
- [x] **AC5** — A long value (a multi-command entry body) stays readable and does not blow up the
      row height or overflow the panel.

## Open Questions

- [x] ~~Screenshot: which section(s) did the report look at? (Report referenced an image that did not
      reach the repo.)~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** No specific section identified from the report — refine checks all sections
  (`cvars`, `binds`, `actions`, `layers`, `settings`, `unrecognized`) systematically, as the
  Requirement already directs, and fixes whichever ones emit bare counts or prose instead of a
  concrete before/after.
- **Per-section audit result (refine).** No section emits a bare *count* — the change set is
  per-item everywhere. Four sections already carry a usable before/after and only need better
  rendering: `cvars` (resolved values, `profile-diff.ts:245-283`), `binds` (verbatim command,
  `:316-328`), `unrecognized` (`file:line` label + verbatim text, `:553-566`), `settings`
  (`:469-506`). Two need **diff-engine** work: `actions` and `layers` both report one
  whole-entry summary line per side (`describeAction` `:368-376`, `describeLayer` `:380-388`)
  — so a one-command edit shows two long, near-identical strings the user has to compare by
  eye, which is exactly the report — plus a reachable fallback that prints raw
  `canonical()` JSON when the two summaries read alike (`:418-425`, hit by a
  `catalogId`/`keepEmptyAlias`-only change).
- **The fix keeps one row per changed entry and adds a `details` array to `ProfileChange`**
  (`{ field, before?, after? }`), rather than emitting one change per changed field. AC4 fixes
  the count: `count = changes.length` feeds the tab badge, the per-row indicators and `keys`, so
  splitting an action into five field changes would inflate all three. `before`/`after` stay as
  the summary; the detail list is what makes the change readable.
- **Details are derived from the union of both rows' top-level keys**, compared with the
  existing `canonical()`, with a per-field formatter — not from a hand-written field list.
  `profile-diff.ts`'s own doc comment names a second field list as the drift hazard; the key
  union keeps completeness structural (a field added to `ConfigAction` later shows up
  automatically, worst case via the canonical fallback). `id` is excluded — it is the pairing
  identity, equal by construction.
- **The `canonical()` JSON fallback on the change itself is dropped.** A canonical difference
  implies some top-level key differs, so the detail list can never be empty where the change
  exists; the unreadable case disappears instead of being formatted.
- **AC5 is solved with a bounded, scrollable value block** (`max-h`, `overflow-y-auto`,
  `whitespace-pre-line break-words`), not with `line-clamp` + `title`: a multi-command body is
  the case that matters and a clamp would hide the very command that changed, while a `title`
  is unreachable by keyboard. Multi-command bodies render one command per line.
- **AC2 is a text marker, not a colour**: each row carries an `added`/`removed`/`changed`
  `Badge` with translated text, next to the existing "unset"/"unbound" placeholder for the
  missing side — `/design-tokens`' no-colour-alone rule, same as story 049's row glyph.
- **`settings` rows get translated labels, values stay verbatim.** `profile-diff.ts:468` already
  states the intent ("`key` is the field name, which is what a renderer translates on") but the
  renderer never did it, so the tab prints `writeUnbindall true → false`. Labels move to
  i18n keys; the values themselves stay the literal strings a save writes, because that is what
  AC1 asks the row to state.
- **Scope stays renderer + shared.** No IPC change, no main change: the change set already
  reaches the renderer through `ProfileChangesContext` (story 049).
- **Dependency:** story 061 (same sprint, earlier in build order) reshapes the profile detail
  *header* in `ConfigView.tsx`. This story touches neither `ConfigView.tsx` nor the header, so
  the only overlap is the e2e flow's path into the Unsaved tab — the flow selects
  `config-tab-unsaved` by testid, which 061 keeps.

## Plan

1. **Shared diff (`src/shared/config/profile-diff.ts`)** — add
   `ProfileChangeDetail { field: string; before?: string; after?: string }` and an optional
   `details` on `ProfileChange`. In `diffById`'s `changed` branch, build the details from the
   union of both rows' top-level keys (`id` excluded), comparing with `canonical()`; format
   per field:
   - `commands` → `describeCommand` per command, newline-joined
   - `parts` → per part, `label`/`aliasName` prefix + its commands
   - `keys` → `describeSlot` list, comma-joined
   - `overrides` (layers) → `key=command`, key-sorted, one per line
   - scalars (`name`, `kind`, `mode`, `triggerKey`, `categoryId`, `subcategoryId`, `catalogId`,
     `aliasName`, `keepEmptyAlias`) → `String(value)`, absent side → `undefined`
   - anything unmodelled → `canonical(value)` (safety net, not the normal path)
   Drop the `legible ? … : canonical(row)` fallback on `before`/`after` — always the summary.
   `count`, `sections`, `keys` and the set of reported changes stay bit-for-bit as they are.
2. **Row rendering (`ProfileChangeList.tsx`)** — `ChangeRow` becomes two parts: a header line
   (label + kind `Badge` + the summary before → after) and, when `change.details` is present,
   a nested list of `field: before → after`. Values render in a bounded block
   (`max-h-24 overflow-y-auto whitespace-pre-line break-words min-w-0`), mirroring
   `CareBatchFixDialog.tsx:126-137`'s before/after pair for the inline shape.
   `settings` labels resolve through an i18n map keyed by `change.key`.
3. **i18n (`src/renderer/src/i18n/locales/en.json`, under `config.save.changes`)** — new
   `kind.{added,removed,changed}`, `field.<name>`, `settingsLabel.{name,writeUnbindall,
   sectionHeaderStyle}`, and `before`/`after` column labels (sr-only where the arrow already
   says it). Main process sends no prose — all of this is renderer-side, per CLAUDE.md.
4. **Tests** — unit next to the diff, a new jsdom component test for the list, and one
   `ui:flow` acceptance flow that dirties several sections and reads the tab back.

Order: 1 → 2/3 (same file pair) → 4's flow last, since it asserts on the finished rows.

## Deliverables

- [x] **D1 — field-level details in the change model.**
  `src/shared/config/profile-diff.ts`: `ProfileChangeDetail`, `ProfileChange.details`, details
  for `actions` and `layers` from the top-level-key union + per-field formatters, JSON fallback
  on `before`/`after` removed. Plus its tests in `src/shared/config/profile-diff.test.ts`
  (mirror that file's existing per-section `describe` blocks).
  *Acceptance:* an action whose one command changed reports **one** change with a `commands`
  detail naming the old and new command; a `catalogId`-only change reports a `catalogId`
  detail instead of JSON; `count` and the set of reported changes are unchanged for every
  existing case in the suite.
- [x] **D2 — the row reads as a diff.**
  `src/renderer/src/modules/config/components/ProfileChangeList.tsx`,
  `src/renderer/src/i18n/locales/en.json`. Kind badge (text, not colour), summary
  before → after, nested per-field detail rows, bounded/scrollable value blocks, translated
  `settings` labels. Mirror `CareBatchFixDialog.tsx:126-137` (before → after pair) and
  `ControlsOptionsCell.tsx:47-48` (`min-w-0` overflow discipline); `Badge` from
  `components/ui/primitives`. Plus a new jsdom component test
  `src/renderer/src/modules/config/components/ProfileChangeList.test.tsx` (mirror
  `ControlsGrid.dnd.test.tsx`'s `// @vitest-environment jsdom` + i18n setup).
  *Acceptance:* every row shows a concrete before and after; added/removed are marked in text;
  a 40-command body neither grows the row past the bounded block nor overflows horizontally.
- [x] **D3 — acceptance flow through the real surface.**
  `scripts/flows/unsaved-diff.mjs` (new), mirroring `scripts/flows/raw-inline-edit.mjs`
  (structure, `shot`/`step`, real testids, real assertions). Dirties three sections on the
  populated fixture — the Raw tab's "Section header style" select (`settings`, the idempotent
  setter `screens.mjs:409-424` already relies on), one Settings-tab cvar (`cvars`), one
  Controls-row key (`actions`/`binds`) — then opens `config-tab-unsaved` and asserts on
  `config-save-changes`: every row has a label and both sides, the kind marker text, row count
  equals the tab badge's count, and no value block overflows.
  *Acceptance:* `npm run ui:flow unsaved-diff` passes on a freshly seeded fixture
  (`npm run ui:seed` first — see `raw-inline-edit.mjs`'s precondition note), and
  `npm run ui:verify` stays green including axe on `config-save-expanded`.

## Model Hints

- `D1 → deliverable-hard` — the change model is what the tab badge, the per-row unsaved
  indicators and Discard all read through one `count`/`keys`; adding details must not shift the
  count or the reported entry set (AC4), and the module carries a seven-block regression suite
  whose expectations must all still hold.
- D2 → default.
- D3 → default.
- `Review: → default` — the risky logic is confined to D1 and is fully unit-covered; D2/D3 are
  renderer markup and a new harness flow with no cross-module reach.

## Acceptance Tests

- AC1 → unit `src/shared/config/profile-diff.test.ts` › "an action change names each changed
  field with its own before and after" · component
  `src/renderer/src/modules/config/components/ProfileChangeList.test.tsx` › "every change row
  shows a concrete before and a concrete after" · e2e `npm run ui:flow unsaved-diff`
  (`scripts/flows/unsaved-diff.mjs`) › step "the unsaved tab reads as a diff" (asserts label +
  both sides on every row across cvars, binds/actions and settings)
- AC2 → component `…/ProfileChangeList.test.tsx` › "an added change has no before and says
  'added' in text" (and its removed counterpart) · e2e
  `scripts/flows/unsaved-diff.mjs` › step "added and removed rows are marked in text"
- AC3 → unit `src/shared/config/profile-diff.test.ts` › "a structurally different entry never
  falls back to canonical JSON" · component `…/ProfileChangeList.test.tsx` › "no row renders a
  bare count or an unlabelled sentence"
- AC4 → unit `src/shared/config/profile-diff.test.ts` › "details do not change the change count
  or which entries are reported" · e2e `scripts/flows/unsaved-diff.mjs` › step "the badge count
  equals the number of rows"
- AC5 → component `…/ProfileChangeList.test.tsx` › "a 40-command body stays inside the bounded
  value block" (asserts the block's own clamp class/height, not a pixel snapshot) · e2e
  `scripts/flows/unsaved-diff.mjs` › step "a long command body does not overflow the panel"
  (`scrollWidth <= clientWidth` on the list, row height under the bound)
- No manual residue.

## Done

**Summary.** The Unsaved tab now reads as a real diff. `src/shared/config/profile-diff.ts` gained
`ProfileChangeDetail` and a `details` array on `ProfileChange`, built from the union of both rows'
top-level keys (`id` excluded) with a per-field formatter (`commands`, `parts`, `keys`, `overrides`,
scalars, and a `canonical()` safety net for anything unmodelled); the old `canonical()` JSON
fallback on the change's own `before`/`after` is gone. `ProfileChangeList.tsx` renders a header line
(label + text `added`/`removed`/`changed` `Badge` + summary before → after) plus, when present, a
nested per-field detail list, with values in a bounded/scrollable block
(`max-h-24 overflow-y-auto whitespace-pre-line break-words min-w-0`) and `settings` rows now
resolving their labels through i18n instead of printing raw field keys. New i18n keys live under
`config.save.changes.{before,after,kind.*,field.*,settingsLabel.*}` in `en.json`. A new acceptance
flow `scripts/flows/unsaved-diff.mjs` dirties `settings`/`cvars`/`actions`/`binds` sections on the
real, built app and asserts every row's label/both sides/kind text, the badge-count-equals-row-count
invariant, and that no value block overflows.

**Decisions taken during build** (none required a re-decision against the plan; recorded per the
sprint rule since they weren't spelled out verbatim in Decisions (Sprint)):
- Detail order follows `DETAIL_FORMATTERS`' declaration order, unmodelled fields last — object key
  insertion order would be unstable across the suite's own "rebuilt in another key order" case.
- `triggerKey: null` renders as an absent side (not the string `"null"`), matching `describeLayer`'s
  existing null-handling convention.
- `details` is only populated for `changed` entries — added/removed rows have no per-field story,
  consistent with the existing shape of those two kinds.
- A `parts` entry with neither `label` nor `aliasName` falls back to its 1-based position as the
  prefix.
- D3's flow drives `fixture-action-attack` (a catalogue-backed action with no `ActionEditor`
  affordance) via the Controls grid's key-capture/`Delete`, mirroring `controls-extra-keys.mjs`'s own
  technique, rather than via `ActionEditor` (used for the plain `fixture-action-keyless` instead).

**Verification.**
- `npm run build` — clean.
- `npm test` — 2625/2625 passed (103 files), including the rewritten/extended
  `src/shared/config/profile-diff.test.ts` (46 cases) and the new
  `src/renderer/src/modules/config/components/ProfileChangeList.test.tsx` (5 cases).
- `npm run typecheck` — clean (node + web).
- `npm run ui:verify` (after `npm run ui:seed` and a fresh `npm run build`) — 68/68 screenshots,
  0 axe violations across all severities, including `config-save-expanded`.
- `npm run ui:flow unsaved-diff` — passes.
- Clean-agent review (default tier): **PASS**, no findings. AC4 (the highest-risk criterion, D1
  tier-marked "hard") was independently re-verified by the reviewer: `DETAIL_FORMATTERS` covers
  every field of both `ConfigAction` and `AltLayer`, and the count/`section`+`key`
  list/`sections`↔`keys` agreement all hold under a 5-action-field + 3-layer-field simultaneous
  change. The reviewer also confirmed the one rewritten pre-existing test (the canonical-JSON
  fallback case) is a legitimate strengthening reflecting the story's explicit decision to drop
  that fallback, not a weakening.
- **AC → test mapping, confirmed as actually written:**
  - AC1 → unit `profile-diff.test.ts` › "an action change names each changed field with its own
    before and after" · component `ProfileChangeList.test.tsx` › "every change row shows a
    concrete before and a concrete after" · e2e `unsaved-diff.mjs` › "the unsaved tab reads as a
    diff" — all pass.
  - AC2 → component `ProfileChangeList.test.tsx` › "an added change has no before and says
    'added' in text" (+ removed counterpart) · e2e `unsaved-diff.mjs` › "added and removed rows
    are marked in text" — all pass.
  - AC3 → unit `profile-diff.test.ts` › "a structurally different entry never falls back to
    canonical JSON" · component `ProfileChangeList.test.tsx` › "no row renders a bare count or an
    unlabelled sentence" — all pass.
  - AC4 → unit `profile-diff.test.ts` › "details do not change the change count or which entries
    are reported" · e2e `unsaved-diff.mjs` › "the badge count equals the number of rows" — all
    pass.
  - AC5 → component `ProfileChangeList.test.tsx` › "a 40-command body stays inside the bounded
    value block" · e2e `unsaved-diff.mjs` › "a long command body does not overflow the panel" —
    all pass.
- No manual residue.
