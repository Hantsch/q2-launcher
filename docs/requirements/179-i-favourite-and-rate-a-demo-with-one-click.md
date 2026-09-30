---
id: 179
title: I favourite and rate a demo with one click
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

Favourite and rating are the two things I set most often, and today in the detail panel they are a
checkbox and a free number field (1–10) buried in the notes form. They should be one click each,
right where I look:

- **Favourite** is a toggle button in the detail panel's header, next to the demo's name.
- **Rating** is a star selector in the detail panel, not a select or number field.

Both save immediately — like the list row's quick favourite/rating ([[155]] D6) — without the Edit
mode of [[178]].

The roadmap carries a known race: `demo-editor-store.ts`'s `quickEdit` is a fire-and-forget
read-merge-write, so a favourite toggle and a rating pick fired back-to-back on the same demo can
drop one of them ([S27 review](../sprints/done/S27/review.md)). With both controls side by side in
the header this becomes easy to hit, so this story closes it.

## Acceptance Criteria

- [ ] **AC1** — The detail panel's header shows a favourite toggle button next to the title; its
      pressed state is announced (`aria-pressed`) and visible without relying on colour alone.
- [ ] **AC2** — Pressing it saves the favourite to the sidecar at once; the list row's favourite
      star and the favourites-first order update without a rescan.
- [ ] **AC3** — The detail panel shows the rating as a row of stars reflecting the saved rating; no
      rating shows all stars empty.
- [ ] **AC4** — Clicking a star saves that rating at once; clicking the star of the current rating
      clears it. The list row's rating updates without a rescan.
- [ ] **AC5** — The star selector is keyboard-operable (arrow keys change, a key clears) and each
      star has an accessible name stating the value it sets.
- [ ] **AC6** — A favourite toggle and a rating pick fired back-to-back on the same demo both end
      up in the sidecar (no lost write).
- [ ] **AC7** — For an archive entry both controls stay visible, disabled, with the read-only reason
      as visible text ([[158]]).
- [ ] **AC8** — The favourite and rating inputs no longer appear in [[178]]'s edit mode.
- [ ] **AC9** — The "Minimum rating" filter's options are labelled in stars ("At least 1 star",
      "At least 7 stars", …) instead of bare numbers. *(Added in refine from the (User) decision
      below.)*

## Open Questions

- ~~Q1: The sidecar stores rating as an integer 1–10. Star scale: **5 stars with half steps**
  (recommended: the conventional look, lossless for 1–10), or 10 stars, or 5 whole stars (would
  force a data migration or lossy rounding)?~~ answered → Decisions (Sprint)
- ~~Q2: Does the list row's inline rating `<select>` (CLAUDE.md deviation row for story 155 D6) switch
  to the same star control, or stay a select in the dense row? Recommendation: stay out of scope,
  the row is dense.~~ answered → Decisions (Sprint)
- ~~Q3: The "Minimum rating" filter is a select over 1–10 today — does it follow the star scale in its
  labels? Recommendation: out of scope.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Star scale: 10 stars (one per stored value 1-10)
- **(User)** List row inline rating select: stays a select, out of scope
- **(User)** "Minimum rating" filter: labels DO follow the star scale (in scope)
- The filter decision becomes AC9, so it has a deliverable and a test like every other criterion.
- The race is fixed in the store, not in the controls: a per-demo serial queue runs every sidecar
  write (`quickEdit` and edit-mode `save`) for one demo one after another, so each read-merge-write
  reads what the previous one wrote — this also fixes the list row's quick controls for free.
- `quickEdit` no longer silently drops a click while a save is in flight (today's `saving` early
  return); it queues behind it, because a dropped click is the same lost write AC6 forbids.
- The store keeps an optimistic per-demo overlay (`quickPending`) that the detail panel's controls
  render from until that demo's queue drains, so a second click computes from what the user just
  saw (a double favourite click toggles twice, a star click right after a toggle does not revert it).
- The list row keeps reading its own row values (not the overlay) — it is out of scope ((User)
  decision on the row select) and still gains the queue's no-lost-write guarantee.
- While a replace-confirmation (`needsConfirmation`) is pending for a demo, further quick edits merge
  into `pendingQuickEdit` instead of writing, so the confirmed retry carries all of them.
- `favourite` and `rating` stay in `SidecarDraft` even though edit mode no longer shows them, so an
  edit-mode Save round-trips them instead of wiping them.
- A quick edit on a demo with an open draft patches only `favourite`/`rating` in both `draft` and
  `baseline` (today it replaces the whole draft), so unsaved edit-mode changes survive and the dirty
  check stays correct.
- Both header controls stay enabled during [[178]]'s edit mode — they save on their own and never
  enter the draft's dirty state.
- The star row sits directly under the header, above the facts, labelled "Rating" with the value as
  text ("7/10", reusing `replays.row.ratingValue`, or "Not rated") — the text makes the state
  readable without relying on colour or on counting ten stars.
- The star selector is a `radiogroup` of ten `radio` buttons with a roving tabindex: each star gets
  its own accessible name ("7 stars"), which AC5 requires and a `slider` would not give.
- Keyboard: Right/Up raise by one, Left/Down lower by one (not below 1), Home/End pick 1/10,
  Delete/Backspace clear; every change saves at once like a click (the queue absorbs key repeat).
- Pressed/filled state is shape, not colour: filled vs. outlined star glyph for both controls, plus
  `aria-pressed` on the favourite toggle and `aria-checked` on the stars.
- Archive entries: both controls are `disabled` and `aria-describedby` the panel's existing visible
  read-only reason (`replays.archive.readOnly.edit`, testid `replays-archive-readonly-edit`); one
  visible reason serves Edit, favourite and rating instead of three copies of the same sentence.
- The favourite toggle (28px, `size="sm"`) and the star buttons (sub-44px) get a CLAUDE.md
  deviation row, same reason as the dense Controls/Settings/DemoRow rows: desktop, mouse-and-keyboard
  app, no touch surface.
- Filter labels use i18next plurals (`ratingAtLeast_one`/`_other`, "At least {{count}} star(s)") —
  the repo already uses `_one`/`_other` keys.

## Plan

Build after [[177]] and [[178]] (same panel). Three layers of change, all renderer:

1. **Store (race fix)** — `demo-editor-store.ts`: per-demo serial queue around `quickEdit` and
   `save`; optimistic `quickPending` overlay; open-draft patch touches only favourite/rating;
   pending replace-confirmation merges further quick edits. Unit-tested with deferred IPC mocks.
2. **Header favourite toggle** — `DemoDetailPanel.tsx` header, next to the title, before Close.
3. **Star rating** — new `components/StarRating.tsx` (radiogroup), mounted under the header.
   Archive state for both controls; archive flow extended.
4. **Edit mode cleanup** — remove favourite/rating inputs from the edit mode 178 left behind
   (keep them in `SidecarDraft`); update the edit-sidecar flow.
5. **Filter labels** — `DemoListFilterBar.tsx` + `en.json` plurals.

New e2e flow `scripts/flows/replays-detail-quick-edit.mjs` (variant `replays-rows`, mirror
`replays-row-quick-rating.mjs`) grows over D2–D3. CLAUDE.md deviation row lands with D2/D3.
CHANGELOG entry under `### Changed` with D3.

## Deliverables

- **D1 — no lost quick edit: serialize a demo's sidecar writes (store).**
  - In `src/renderer/src/modules/replays/demo-editor-store.ts`:
    - Add a module-local per-demo queue (`Map<string, Promise<void>>` of tails) and a helper
      `enqueue(id, task)` that chains `task` after the demo's current tail and removes the tail
      when it is the last. Run the body of **both** `quickEdit` and `save` through it, so a
      read-merge-write for one demo always reads what the previous write left on disk.
    - Remove `quickEdit`'s `if (existing?.saving) return` — a quick edit during a save queues
      behind it instead of being dropped.
    - Add state `quickPending: Record<string, { favourite?: boolean; rating?: number | null }>`.
      `quickEdit` merges its patch into `quickPending[id]` **synchronously, before** enqueueing;
      when the demo's queue drains (success or failure), delete `quickPending[id]`. Export a
      selector/helper so a component can read "effective favourite/rating = overlay ?? row value".
    - If `drafts[id].replace` is set when a quick edit arrives (a replace-confirmation is open),
      merge the patch into `pendingQuickEdit` and do not write; the existing confirm path in
      `ReplaysView.tsx` (~L427, calls `quickEdit(id, pendingQuickEdit)`) then writes all of it.
    - After a successful quick write, when a draft is open for the demo, patch **only**
      `favourite` and `rating` in both `draft` and `baseline` (from the fresh `sidecarRead`
      values, via `draftFromSidecar`) — never replace the whole draft, so unsaved edit-mode changes
      survive. Clear `replace`/`fingerprint`/`pendingQuickEdit` as today.
    - Update the `quickEdit` doc comment (it currently promises the fire-and-forget behaviour).
  - Tests in `src/renderer/src/modules/replays/demo-editor-store.test.ts` (mirror its existing
    `quickEdit` test ~L144; mock `sidecarRead`/`sidecarWrite` with deferred promises so the
    interleaving is controlled, and a fake on-disk sidecar the write mock updates):
    - "a favourite toggle and a rating pick fired back-to-back both reach the sidecar"
    - "a quick edit during an edit-mode save waits for it and is not dropped"
    - "a quick edit keeps an open draft's unsaved changes and patches only favourite and rating"
    - "quick edits during a pending replace confirmation are merged into the retry"
    - "the optimistic overlay shows the patch at once and is cleared when the queue drains, also on failure"
  - Files: `demo-editor-store.ts`, `demo-editor-store.test.ts`.
  - Acceptance: `npx vitest run src/renderer/src/modules/replays` passes, `npm run typecheck` clean.

- **D2 — favourite toggle in the detail panel header.**
  - In `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`, in the sticky header,
    between the title `<h2>` (`replays-detail-title`) and the Close `IconButton`, add an
    `IconButton` `size="sm"`, `data-testid="replays-detail-favourite"`, `aria-pressed={favourite}`,
    label `t('replays.detail.favourite.ariaLabel', { name: title })` (new key, e.g.
    "Favourite {{name}}"). Mirror `DemoRow.tsx`'s quick favourite toggle (~L249–268): lucide `Star`,
    filled (`fill-flame-500 text-flame-500`) when on, outlined `text-ink-muted` when off — the fill
    is the non-colour cue. If story 178 already placed file-action icon buttons in the header, the
    favourite sits first after the title.
  - `favourite` = the store's `quickPending[row.id]?.favourite ?? row.sidecar.values.favourite ?? false`
    (D1's overlay helper). Click → `useDemoEditorStore.getState().quickEdit(row.id, { favourite: !favourite }, onRowPatched)`.
    It never touches the draft's dirty state and stays enabled in edit mode.
  - Archive entry (`row.archiveEntry !== null`): `disabled`, `aria-describedby` the id of the
    panel's visible read-only reason element (testid `replays-archive-readonly-edit`, text
    `replays.archive.readOnly.edit`). If the panel does not render that element outside edit mode
    after 178, render it once in the panel body for archive entries (give it a stable `id`).
  - Remove the `favourite` field from the facts list if 177 left it there (`fieldValueText` case).
  - Add to CLAUDE.md `## Deviations` a `/design-tokens` (44px touch-target floor) row for the
    detail panel's favourite toggle (28px) and star buttons (`DemoDetailPanel.tsx`,
    `StarRating.tsx`), reason: same as above — desktop, mouse-and-keyboard-only, no touch surface;
    story `docs/requirements/179-i-favourite-and-rate-a-demo-with-one-click.md`.
  - Tests:
    - `DemoDetailPanel.test.tsx` › "the header favourite toggle reports aria-pressed and calls quickEdit with the flipped value"
    - `DemoDetailPanel.test.tsx` › "an archive entry's favourite toggle is disabled and described by the visible read-only reason"
    - New flow `scripts/flows/replays-detail-quick-edit.mjs` (flow `replays-detail-quick-edit`,
      `export const variant = 'replays-rows'`; mirror `replays-row-quick-rating.mjs` incl. its
      `waitForDemosScanToFinish` and `replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO)` sidecar read):
      open the duel row's detail, click `replays-detail-favourite`, assert `aria-pressed="true"`,
      the sidecar on disk has `favourite: true` and its other fields unchanged, the row shows
      `replays-demo-favourite` and is first in the list — with `replays-refresh` never clicked.
  - Files: `DemoDetailPanel.tsx`, `DemoDetailPanel.test.tsx`, `src/renderer/src/i18n/locales/en.json`,
    `scripts/flows/replays-detail-quick-edit.mjs`, `CLAUDE.md`.

- **D3 — star rating in the detail panel.**
  - New `src/renderer/src/modules/replays/components/StarRating.tsx` (+ `StarRating.test.tsx`):
    props `{ value: number | null; onChange(value: number | null): void; disabled?: boolean;
    describedBy?: string; label: string }`. Renders a `role="radiogroup"` (`aria-label={label}`,
    `data-testid="replays-detail-rating"`) of ten `<button role="radio">` stars (values 1–10,
    `data-testid="replays-detail-rating-star-<n>"`, `aria-checked={n === value}`, accessible name
    `t('replays.detail.rating.star', { count: n })` → "1 star"/"7 stars" via `_one`/`_other`).
    Stars ≤ value are filled lucide `Star` (`fill-flame-500 text-flame-500`), the rest outlined;
    `value === null` → all outlined. Roving tabindex: the checked star (or star 1 when none) is
    `tabIndex=0`, the rest `-1`.
  - Behaviour: click star n → `onChange(n)`, or `onChange(null)` when n is the current value.
    Keys on the group: Right/Up → `min(value+1, 10)` (from none → 1), Left/Down → `max(value-1, 1)`,
    Home → 1, End → 10, Delete/Backspace → `null`; move focus to the new checked star. Disabled →
    every button `disabled`, `aria-describedby={describedBy}`, no handlers fire.
  - Beside the stars, visible text: `t('replays.row.ratingValue', { rating })` ("7/10") or
    `t('replays.detail.rating.none')` ("Not rated"), `data-testid="replays-detail-rating-value"`.
  - Mount it in `DemoDetailPanel.tsx` as the first block of the panel body (above the facts), label
    `t('replays.detail.rating.label')` ("Rating"). Value = `quickPending[row.id]?.rating` (overlay,
    `null` meaning cleared) `?? row.sidecar.values.rating ?? null`; `onChange` →
    `quickEdit(row.id, { rating: v }, onRowPatched)`. Archive entry → `disabled` +
    `describedBy` the same reason id D2 uses. Remove the `rating` field from the facts list if 177
    left it there.
  - Add a `### Changed` entry to `CHANGELOG.md` (current version section): favourite and a 10-star
    rating one click each in the demo detail; a quick favourite + rating no longer lose one another.
  - Tests:
    - `StarRating.test.tsx` › "shows the saved rating as filled stars and none as all empty"
    - `StarRating.test.tsx` › "clicking a star sets it and clicking the current star clears it"
    - `StarRating.test.tsx` › "arrow keys, Home/End and Delete change the rating; each star is named by its value"
    - `StarRating.test.tsx` › "a disabled selector fires nothing and is described by the reason"
    - Extend `scripts/flows/replays-detail-quick-edit.mjs`: click star 7 → sidecar `rating: 7`,
      `replays-detail-rating-value` reads "7/10", the row's `replays-demo-rating` reads "7/10";
      click star 7 again → `rating` gone from the sidecar and the row shows no rating; then click
      `replays-detail-favourite` and **immediately** (no wait) star 4, then poll the sidecar until it
      has both the toggled favourite and `rating: 4` (fail after the timeout); focus star 4, press
      ArrowRight → sidecar `rating: 5`, press Delete → `rating` gone. Never click `replays-refresh`.
    - Extend `scripts/flows/replays-archive-readonly.mjs` (in its "opening the pack.zip archive
      entry" step): `replays-detail-favourite` and every `replays-detail-rating-star-*` are
      disabled and `replays-archive-readonly-edit` is visible with its existing text.
  - Files: `StarRating.tsx`, `StarRating.test.tsx`, `DemoDetailPanel.tsx`, `en.json`,
    `CHANGELOG.md`, `scripts/flows/replays-detail-quick-edit.mjs`,
    `scripts/flows/replays-archive-readonly.mjs`.

- **D4 — edit mode no longer offers favourite and rating.**
  - In the edit mode story 178 built (today `src/renderer/src/modules/replays/components/DemoNotesEditor.tsx`:
    the `favourite` checkbox `replays-editor-favourite` ~L158 and the `rating` text field in the
    `TextFieldId` list ~L39/L48, `replays-editor-rating`), remove both inputs and their labels.
  - **Keep** `favourite` and `rating` in `SidecarDraft` / `draftFromSidecar` / `draftToFields`
    (`src/shared/replays/sidecar-draft.ts`) untouched, so an edit-mode Save writes back whatever
    favourite/rating is on the draft (kept current by D1) instead of wiping them. Remove only
    now-unused i18n keys (`replays.editor.field.favourite`, `replays.editor.field.rating`,
    `replays.editor.error.rating` only if nothing else references it).
  - Update `scripts/flows/replays-edit-sidecar.mjs`: drop its favourite/rating fill steps and the
    rating-0 refusal step; set the favourite via `replays-detail-favourite` before entering edit mode
    instead, and keep asserting the saved sidecar contains `favourite: true` after the edit-mode Save
    (proves Save round-trips it). Adjust its expected sidecar object accordingly.
  - Tests:
    - `DemoNotesEditor.test.tsx` (or the edit-mode test file 178 created) › "edit mode shows no favourite or rating input"
    - same file › "saving edit mode keeps the demo's favourite and rating"
    - flow `replays-edit-sidecar` as updated above.
  - Files: `DemoNotesEditor.tsx` (or 178's successor), its test, `en.json`,
    `scripts/flows/replays-edit-sidecar.mjs`.

- **D5 — the Minimum-rating filter speaks in stars.**
  - `src/renderer/src/modules/replays/DemoListFilterBar.tsx` ~L75: label options with
    `t('replays.filter.ratingAtLeast', { count: n })`. In `en.json` replace
    `replays.filter.ratingAtLeast` ("At least {{n}}") with `ratingAtLeast_one`
    "At least {{count}} star" and `ratingAtLeast_other` "At least {{count}} stars". Values and the
    "any" option stay unchanged.
  - Test: `DemoListFilterBar.test.tsx` › "the minimum-rating options are labelled in stars"
    (asserts "At least 1 star" and "At least 7 stars").
  - Files: `DemoListFilterBar.tsx`, `DemoListFilterBar.test.tsx`, `en.json`.

## Model Hints

- D1 → deliverable-hard. It changes the concurrency of the only two sidecar writers the renderer has
  (`quickEdit`, `save`) plus the replace-confirmation retry path in `ReplaysView.tsx`; a queue that
  leaks a tail, an overlay that is not cleared on failure, or an open-draft refresh that still
  replaces the whole draft silently loses a click or an unsaved edit-mode change.
- D2, D3, D4, D5: default.
- Review: → default. The plausible wrong implementations each have a named deterministic test: the
  back-to-back race (deferred mocks in D1), the whole-draft overwrite (D1), and "Save wipes the
  favourite because it left the draft" (D4 unit + the edit-sidecar flow asserting `favourite: true`
  after Save).

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-detail-quick-edit.mjs` › flow `replays-detail-quick-edit`
  (asserts `aria-pressed`). Plus unit `DemoDetailPanel.test.tsx` › "the header favourite toggle
  reports aria-pressed and calls quickEdit with the flipped value" (filled vs. outlined glyph).
- AC2 → e2e `scripts/flows/replays-detail-quick-edit.mjs` › flow `replays-detail-quick-edit`
  (sidecar `favourite: true`, row star, favourite row first, no `replays-refresh` click).
- AC3 → unit `src/renderer/src/modules/replays/components/StarRating.test.tsx` › "shows the saved
  rating as filled stars and none as all empty". Plus e2e flow `replays-detail-quick-edit`
  (`replays-detail-rating-value` reads "7/10").
- AC4 → e2e `scripts/flows/replays-detail-quick-edit.mjs` › flow `replays-detail-quick-edit` (star 7
  sets, star 7 again clears; sidecar and row checked). Plus unit `StarRating.test.tsx` › "clicking a
  star sets it and clicking the current star clears it".
- AC5 → e2e flow `replays-detail-quick-edit` (ArrowRight → 5, Delete clears). Plus unit
  `StarRating.test.tsx` › "arrow keys, Home/End and Delete change the rating; each star is named by
  its value".
- AC6 → unit `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "a favourite toggle and a
  rating pick fired back-to-back both reach the sidecar" and "a quick edit during an edit-mode save
  waits for it and is not dropped". Plus e2e flow `replays-detail-quick-edit` (favourite then star 4
  with no wait; sidecar holds both).
- AC7 → e2e `scripts/flows/replays-archive-readonly.mjs` › flow `replays-archive-readonly` (both
  controls disabled, `replays-archive-readonly-edit` visible). Plus unit `DemoDetailPanel.test.tsx`
  › "an archive entry's favourite toggle is disabled and described by the visible read-only reason"
  and `StarRating.test.tsx` › "a disabled selector fires nothing and is described by the reason".
- AC8 → e2e `scripts/flows/replays-edit-sidecar.mjs` › flow `replays-edit-sidecar` (no
  favourite/rating inputs; Save keeps `favourite: true`). Plus unit `DemoNotesEditor.test.tsx` ›
  "edit mode shows no favourite or rating input".
- AC9 → unit `src/renderer/src/modules/replays/DemoListFilterBar.test.tsx` › "the minimum-rating
  options are labelled in stars".

Coverage: AC1–2 → D2 (on D1) · AC3–5 → D3 · AC6 → D1 (+ D3 flow) · AC7 → D2+D3 · AC8 → D4 ·
AC9 → D5.

## Done
