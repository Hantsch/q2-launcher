---
id: 155
title: I describe a demo the way I remember it
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user selects a demo and sees everything the browser knows about it, each value with where it came
from — then corrects and adds what they remember: a name, a description, who played on which side
and how it ended, the mod and gamemode if the guess was wrong, tags, a favourite star, a rating and
a date if the file time is misleading (concept `docs/concepts/demo-browser.md` §10 "Detail / edit",
DEMO-11, DEMO-13).

This story is the detail view and its sidecar editor; storage is [[146]], broken sidecars are
[[147]], sources are [[148]]. File actions ([[156]], [[157]]) and Play ([[159]]) land in this view
in their own stories.

## Acceptance Criteria

- [ ] **AC1** — Selecting a demo opens a detail view showing every effective value with its source
      as visible text ([[148]] AC5).
- [ ] **AC2** — The editor edits every sidecar field: name, description, mod, gamemode, map, date
      override, tags, favourite and rating (1–10).
- [ ] **AC3** — Sides can be added and removed; each side has an optional team name, an optional
      final result and a list of players that can be added, removed and reordered.
- [ ] **AC4** — Players known from the demo content or the name can be taken into a side without
      retyping them.
- [ ] **AC5** — Invalid input (rating outside 1–10, unparsable date) is shown inline and blocks
      saving.
- [ ] **AC6** — Save writes the sidecar through [[146]]; cancel discards every change; leaving with
      unsaved changes asks first.
- [ ] **AC7** — After save, the row ([[150]]), sort ([[152]]) and filters ([[153]]) reflect the new
      values without a rescan.
- [ ] **AC8** — The detail and editor are `ui:verify` screens with zero axe violations and an
      e2e flow that edits and saves a sidecar against the fixture folder ([[141]] AC6).
- [ ] **AC9** — Favourite and rating can be set directly on the demo row ([[150]]) without opening
      the detail/editor, writing through the same sidecar path as AC6.
- [ ] **AC10** — The tag input autocompletes from tags already used on other demos.

## Open Questions

- [x] ~~**Q1 — Quick favourite/rating** — can favourite and rating also be set directly from the row,
      without opening the editor? Not in the concept.~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Tag suggestions** — does the tag input suggest tags already used on other demos?~~
      answered → Decisions (Sprint)
- [x] ~~**Q3 — Layout** — detail as a side panel next to the list (like the servers detail) or its own
      page?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Favourite and rating can be set directly from the demo row, not only through the
  editor — see new AC9.
- **(User)** The tag input autocompletes from tags already used across other demos — see new AC10.
- **(User)** The detail/editor is a side panel next to the list, matching the servers detail view's
  layout pattern, not a separate page.
- **No new IPC channel; the detail is built in the renderer from the list row.** A pure shared
  `buildDemoDetail(row, sidecar)` calls [[148]]'s `resolveEffectiveValues` — 148 decided its first
  consumers call it "with the index entry", and `sidecar.read`/`sidecar.write` already cover I/O.
- **The input is the row model [[150]] builds** (parsed header facts for its players/duration
  columns, plus each row's sidecar values and state that 150 AC3 and 153 AC1 need). A fact the row
  does not carry is left out of the detail, not added here — putting parsed facts into the index
  is 150's job, and building it twice would drift.
- **One panel, two sections:** "What the browser knows" (read-only effective values, each with its
  [[148]] `ValueSourceLabel`) above "Your notes" (the editor form, always there; Save/Cancel are
  enabled only when the form has changes) — no edit-mode toggle. The user sees the effective value
  and their own entry side by side.
- **The panel mirrors `ServersView`'s split** (`detailSplit`/`DETAIL_PANE`, a 32rem pane at
  `@4xl`, a sticky header with a close `IconButton`) — this is the (User) layout decision, turned
  into code.
- **Editor fields start with the sidecar's values only; lower-source values are placeholders**
  ("from the demo: q2dm1"). If they were prefilled, saving would copy guesses into the sidecar and
  mark them "set by you" — against [[146]]'s "only user-entered fields" and [[148]] AC6.
- **Date override is a text field `YYYY-MM-DD HH:MM[:SS]` in local time**, saved as ISO with the
  local offset of that date; an untouched field keeps the original ISO string byte for byte. AC5
  needs "unparsable" to be a state the user can reach, and no date component exists yet that 155
  could depend on ([[154]]'s range picker has a different job).
- **Rating is a numeric text input (empty = no rating), favourite is a toggle.** AC5 needs
  "outside 1–10" to be typeable and shown inline; a 1–10 select could not show that state.
- **Length and count bounds are prevented, not reported.** Inputs carry [[146]]'s `maxLength`s, and
  the add-tag/side/player controls disable at 50/16/64 — the schema rejects them anyway, and
  preventing the input is kinder than an error.
- **Players are reordered with move-up/move-down buttons, not drag.** The lists are short,
  buttons work from the keyboard, and an e2e flow can click them reliably.
- **Known players (AC4) are chips per side: "from the demo" and "from the file name"**, taken from
  the demo/name rungs whatever the sidecar says (the effective `sides` hides them once the sidecar
  has sides); a chip already in that side is disabled. This is 148's own rung set, shown as choices.
- **Tag suggestions (AC10) come from the loaded rows' sidecar tags** — every other demo's, matched
  case-insensitively by substring, without tags the draft already has, ranked by how often they are
  used and then alphabetically, at most 8, each spelling de-duplicated case-insensitively (the most
  used wins). The rows already hold the tags for [[153]]'s filter, so no scan of sidecars is needed.
- **The tag input is a module-local ARIA combobox** (`modules/replays/components/TagInput.tsx`),
  not a new shared atom — no shared combobox exists and this is its only user.
- **"Leaving" = selecting another row or closing the panel; it asks Discard / Keep editing.** When
  the user switches to another module, the draft stays in a module-level Zustand store and is
  still there when they come back, marked unsaved. The shell must not be edited (CLAUDE.md), so
  there is no route-leave hook — and keeping the draft loses nothing, which is what the prompt
  protects. App quit is not guarded, the same as the config module's drafts.
- **AC7 without a rescan:** after a `saved` result the store re-reads that demo's `sidecar.read(id)`
  and patches only that row's sidecar part in the list state. Sort and filters derive from the rows,
  so they update on their own. Calling `scan.start` or `index.read` for this is a defect, and a test
  checks it. 147 put the per-id handshake here because a cached sidecar goes stale.
- **A save over a broken sidecar shows [[147]]'s confirmation dialog**, naming the file and the
  issues; Confirm re-sends with `confirmReplace: fingerprint`. 147 left that dialog to 155.
- **A failed save shows its key + params as visible text inline in the editor**, which closes
  [[146]] AC7's named gap. A renderer test proves it with the `notWritable` outcome. A real
  read-only folder e2e is not portable: an NTFS folder's read-only flag does not block writes, and
  ACL denial needs setup the fixture does not own.
- **Archive entries:** the notes form and the row's quick controls stay visible but disabled. The
  editor shows the existing `replays.sidecar.error.archiveEntry` text as its visible reason; on the
  row, the archive marker ([[150]] AC4) is the reason, linked via `aria-describedby`. CLAUDE.md
  forbids silent omission. [[158]] owns the final wording and main's rejection.
- **Row quick favourite/rating (AC9) re-reads the sidecar right before writing** and merges with
  D2's `withQuickEdit` — `sidecar.write` replaces the whole file ([[146]]), so writing the stale
  row values or only `{ favourite }` would erase the user's other notes. A broken sidecar goes
  through the same confirmation dialog, and the quick edit never opens the panel.
- **Row quick rating is a compact select (—, 1–10); the star is a toggle `IconButton`.** On the row
  a value can only be picked, so there is no invalid state to show.
- **Sub-44px controls get CLAUDE.md deviation rows** (the sides editor's `size="sm"` move/remove
  buttons, and the row's quick controls if they are below 44px), with the desktop-only reason the
  file already uses.
- **CHANGELOG:** one `### Added` line for the detail + notes editor (D4) and one for quick
  favourite/rating (D6), because both are user-visible.

## Plan

Triage: clear — large, but every open point is decided above. No new IPC channel, no main-side
change: the story is a shared pure layer plus the renderer. Builds on [[150]]'s row model and
selection, [[152]]/[[153]]'s sort/filter, [[146]]/[[147]]'s `sidecar.read`/`sidecar.write`.

1. **D1 — detail model (shared, pure):** `buildDemoDetail(row, sidecar)` → ordered detail fields
   `{ id, value, source }` + known players (demo / name). Unit-tested.
2. **D2 — draft model (shared, pure):** sidecar ⇄ draft, validation (rating, date), dirty check
   after [[146]]'s normalisation, side/player/tag operations, `suggestTags`, `withQuickEdit`.
3. **D3 — detail panel:** Zustand store (selection), split layout in `ReplaysView`, read-only
   "What the browser knows" section with source labels and sidecar issues; `replays-detail` screen
   + `replays-demo-detail` flow.
4. **D4 — notes editor core (hard):** scalar fields, inline errors, Save/Cancel, leave guard,
   confirm-replace dialog, failed-save reason, row patch after save; `replays-editor` screen +
   `replays-edit-sidecar` flow; CHANGELOG.
5. **D5 — sides, players, tags:** `SidesEditor`, known-player chips, `TagInput` combobox; flow
   `replays-edit-sides-tags`; CLAUDE.md deviation row.
6. **D6 — row quick favourite/rating:** controls on [[150]]'s row via `withQuickEdit` + fresh
   re-read; flow `replays-row-quick-rating`; CHANGELOG.

Order: D1, D2 (independent) → D3 → D4 → D5, D6 (both need D4's store/dialog).

## Deliverables

- **D1 — demo detail model (shared, pure) + tests.** Files: new `src/shared/replays/demo-detail.ts`,
  new `src/shared/replays/demo-detail.test.ts`; mirror `src/shared/demos/effective-values.ts` (no
  `node:*`, DOM or electron). Input: the list row type [[150]] built (find it where
  `ReplaysView.tsx` gets its rows; it carries discovery facts, the parsed header facts 150 added and
  the row's sidecar values/state) plus the sidecar's valid values (`Partial<SidecarFields>` from
  `@shared/replays/sidecar`). Export `buildDemoDetail(row, sidecar): DemoDetail` with
  `fields: Array<{ id: DetailFieldId; value: string | number | boolean | SidecarSide[] | string[];
  source: ValueSource | null }>` in this fixed order, omitting unknown values: `name, map, mod,
  gamemode, sides, date, pov, host` (from `resolveEffectiveValues` in
  `@shared/demos/effective-values`, value + source as returned), then the pass-throughs with source
  `'sidecar'` when set: `description, tags, favourite (only when true), rating`, then the file facts
  with source `null`: `fileName, format, duration (if on the row), levelName (if on the row),
  source`. Also `knownPlayers: { demo: string[]; name: string[] }` — the header's player list and
  the name facts' `players`, whatever the sidecar has (not the effective `sides`), each trimmed,
  empties dropped, de-duplicated in order. Carry the row's sidecar state/issues through as
  `sidecarIssues` for D3. Tests › "the detail lists every effective value with its source" (a
  sidecar + header + name fixture row → each field's value/source; a field without a value is
  absent, not blank), › "known players come from the demo and the file name, not the sidecar"
  (sidecar sides present → `knownPlayers` still lists the header and name players).
  Acceptance: tests pass; `npm run typecheck` clean.

- **D2 — sidecar draft model (shared, pure) + tests.** Files: new
  `src/shared/replays/sidecar-draft.ts`, new `src/shared/replays/sidecar-draft.test.ts`. Uses
  `sidecarFieldsSchema`, `normalizeSidecarFields`, `SidecarFields`, `SidecarSide` from
  `@shared/replays/sidecar`. Exports: `type SidecarDraft` (all strings for text inputs: `name,
  description, mod, gamemode, map, date, rating`; `favourite: boolean`; `tags: string[]`; `sides:
  Array<{ team: string; result: string; players: string[] }>`; `originalDate: string | null`);
  `draftFromSidecar(values)`; `draftToFields(draft): { ok: true; fields: SidecarFields } | { ok:
  false; errors: Partial<Record<'rating' | 'date', DraftErrorKey>> }` — rating must be empty or an
  integer 1–10 (`replays.editor.error.rating`); date empty, or `YYYY-MM-DD HH:MM[:SS]` as a real local
  date-time → ISO with that date's local offset (`±HH:MM`) (`replays.editor.error.date`);
  an unchanged date text returns `originalDate` verbatim; the result passes `sidecarFieldsSchema`.
  `isDraftDirty(draft, baseline)` compares `normalizeSidecarFields` of both (whitespace-only edits
  are not dirty). Side ops (pure, return new drafts): `addSide`, `removeSide(i)`, `addPlayer(side,
  name)` (trimmed, ignores empty or a duplicate within that side), `removePlayer(side, i)`,
  `movePlayer(side, i, -1 | 1)` (no-op at the ends). Tag ops: `addTag` (trim, case-insensitive
  dedupe, ≤ 40 chars, ≤ 50 tags), `removeTag`. `suggestTags(otherDemosTags: string[][], input,
  current): string[]` — the ranking rule in Decisions (substring, case-insensitive, excludes
  `current`, usage count desc then alpha, most-used spelling, max 8; empty input → top 8).
  `withQuickEdit(values, patch: { favourite?: boolean; rating?: number | null }): SidecarFields`
  — every other field of `values` unchanged; `rating: null` removes it. Tests › "a draft
  round-trips every sidecar field", › "sides and players can be added, removed and reordered", ›
  "a known player is taken into a side once", › "rating outside 1–10 and an unparsable date are
  errors that block saving" (0, 11, 5.5, "abc", "2026-02-30 10:00", "2026-13-01" each → error; ok
  cases → ISO accepted by the schema), › "an untouched draft is not dirty" (incl. unchanged date
  text keeps the original ISO), › "a quick favourite or rating keeps every other field", › "tag
  suggestions come from other demos' tags". Acceptance: tests pass; typecheck clean.

- **D3 — detail side panel + store + screen + flow.** Files: new
  `src/renderer/src/modules/replays/demo-editor-store.ts` (Zustand; `selectedId`, `select(id)`,
  `close()` — module-level so it outlives the view; D4 adds drafts), new
  `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx` (+ `.test.tsx`), edit
  `ReplaysView.tsx` (split layout mirroring `servers/ServersView.tsx` `detailSplit` / `DETAIL_PANE`
  lines 83-93; wire [[150]]'s row selection to `select(id)`), edit `client.ts` (add `sidecarRead` /
  `sidecarWrite` wrappers over `module:invoke` if [[150]] did not), edit `en.json`
  (`replays.detail.*`: section titles, field labels per `DetailFieldId`, close), edit
  `scripts/lib/screens.mjs`, new `scripts/flows/replays-demo-detail.mjs`. Panel: sticky header
  (effective name + close `IconButton`, `data-testid="replays-detail-close"`) like
  `ServerDetailView.tsx:89-101`; section "What the browser knows" = `buildDemoDetail` fields as a
  `<dl>` (label, value as data text, `ValueSourceLabel` next to it); sides rendered "A vs B" with
  team names; the row's sidecar issues rendered with the existing `replays.sidecar.issue.*` keys;
  an empty slot `data-testid="replays-notes-slot"` for D4. Testids: `replays-detail`,
  `replays-detail-field-<id>`. Screen `replays-detail` (populated, `BOTH_VIEWPORTS`): nav-replays →
  click the row of the fixture demo that has `duel_q2dm1.dm2.json` → wait `replays-detail`. Flow
  `replays-demo-detail`: `setup` copies `docs/fixtures/demos/test.dm2` into install one's
  `baseq2/demos/` as `known-players.dm2` (mirror `replays-zip-entries.mjs`'s setup); the flow
  selects it → asserts `replays-detail-field-map` shows "from the demo", selects the sidecar demo →
  a field shows "set by you", and a file-time-only date shows "file time"; close empties the pane.
  RTL test › "the panel shows each value with its source as text". Acceptance: tests + flow pass;
  `npm run ui:verify` screen `replays-detail` has zero axe violations.

- **D4 — notes editor core: fields, validation, save/cancel, leave guard, confirmation.**
  Files: new `src/renderer/src/modules/replays/components/DemoNotesEditor.tsx` (+ `.test.tsx`), new
  `.../components/DiscardDemoNotesDialog.tsx` (mirror `modules/config/DiscardChangesDialog.tsx`'s
  `Modal size="sm"` shape: "Keep editing" ghost + "Discard changes" danger), new
  `.../components/ReplaceSidecarDialog.tsx` (names `fileName` + each issue via
  `replays.sidecar.issue.*`), edit `demo-editor-store.ts` (+ new `demo-editor-store.test.ts`),
  edit `DemoDetailPanel.tsx` (mount the editor in `replays-notes-slot`), edit `en.json`
  (`replays.editor.*`), edit `CHANGELOG.md` (`### Added`), edit `scripts/lib/screens.mjs`, new
  `scripts/flows/replays-edit-sidecar.mjs`. Use `Field`/inputs from `components/ui/controls.tsx`
  and `Button` from `components/ui/Button.tsx`. Store: `drafts: Record<demoId, { draft, baseline,
  fingerprint? }>`, built with D2's `draftFromSidecar`/`isDraftDirty`/`draftToFields`; the
  baseline is the `sidecar.read(id)` values when the panel opens. `select(id)`/`close()` with a
  dirty draft set `pendingLeave` and open the discard dialog instead (Keep → stay; Discard → drop
  the draft, then go on); switching module does not touch drafts. `save(id)`: `draftToFields` →
  errors block (no IPC call) → `sidecarWrite({ demoId, fields, confirmReplace? })`; `needsConfirmation`
  → `ReplaceSidecarDialog`, Confirm re-sends with its `fingerprint`; `saved` → `sidecarRead(id)` →
  new baseline, draft cleared, and the list row's sidecar part patched through the setter [[150]]'s
  list state uses. Never call `scanStart`/`indexRead` here. `ok: false` → show `t(key, params)`
  inline (`data-testid="replays-editor-save-error"`). Fields (all with `maxLength` from 146):
  name, description (textarea), mod, gamemode, map (placeholder = the lower-source effective value,
  e.g. "from the demo: q2dm1"), date (placeholder `YYYY-MM-DD HH:MM`), favourite toggle, rating;
  the error text sits under its field (`aria-invalid`, `aria-describedby`), and Save is disabled
  while errors exist or nothing changed. Cancel restores the baseline. Archive entry: all controls
  `disabled`, with `replays.sidecar.error.archiveEntry` as visible text above the form. Testids:
  `replays-editor-<field>`, `replays-editor-save`, `replays-editor-cancel`,
  `replays-editor-error-<field>`, `replays-discard-dialog`, `replays-replace-sidecar-dialog`.
  Tests (store, client mocked) › "a save patches the row from sidecar.read without a scan", › "a
  save over a broken sidecar asks before replacing it", › "leaving a dirty draft asks, a clean one
  does not"; (RTL) › "a failed save shows its reason" (`notWritable` → folder text visible).
  Screen `replays-editor`: the `replays-detail` path, then type `11` into rating so the inline
  error shows. Flow `replays-edit-sidecar`: select a sidecar-less loose demo; set name, description,
  mod, gamemode, map, date, favourite and rating 8; type rating `0` → error visible and Save disabled,
  then fix it; type date `2026-02-30 10:00` → error, then fix it; Save → read `<demo>.json` from the
  fixture folder and assert every field; the row shows the new name and is first (favourite,
  [[152]]); filter by the new mod through [[153]]'s mod filter → the row is still listed; there was
  no scan-progress indicator ([[151]]). Edit the name again → Cancel → the field shows the saved
  value; edit again → select another row → discard dialog → Keep editing → the draft is still there.
  Acceptance: tests + flow pass; screen `replays-editor` has zero axe violations.

- **D5 — sides, players and tag autocomplete.** Files: new
  `src/renderer/src/modules/replays/components/SidesEditor.tsx`, new `.../components/TagInput.tsx`
  (+ `TagInput.test.tsx`), edit `DemoNotesEditor.tsx` (mount both; pass `knownPlayers` from D1 and
  every other row's sidecar tags to D2's `suggestTags`), edit `en.json` (`replays.editor.sides.*`,
  `replays.editor.tags.*`), edit `CLAUDE.md` (Deviations: one row for the sides editor's
  `size="sm"` 28px move/remove `IconButton`s, the desktop-only reason, story 155), new
  `scripts/flows/replays-edit-sides-tags.mjs`. All edits go through D2's side/tag ops on the D4
  store draft. SidesEditor: "Add side", one card per side with team input (≤64), result input (≤32),
  remove side, an ordered player list (move up / move down / remove, each with an `aria-label`
  naming the player), an "add player" input (Enter adds), and chips "from the demo" / "from the file
  name" for `knownPlayers` (a click adds to that side; disabled when already there). TagInput:
  chips with remove, a text input with `role="combobox"`, `aria-expanded`, `aria-controls` → a
  `role="listbox"` of suggestions (ArrowUp/Down, Enter picks, Escape closes; Enter/comma with no
  highlighted option adds the typed text). Testids: `replays-sides-add`, `replays-side-<i>`,
  `replays-side-<i>-player-<j>`, `replays-known-player`, `replays-tag-input`,
  `replays-tag-option`. RTL › "the tag input suggests tags from other demos and adds one from the
  keyboard". Flow `replays-edit-sides-tags`: setup copies `test.dm2` as `known-players.dm2` and
  writes a valid sidecar `{ schemaVersion: 1, tags: ["grudge match"] }` next to another fixture
  demo; select `known-players.dm2`; add two sides with team names and results; take a known player
  into side 1 without typing, type two players into side 2, move the second up, remove one; remove
  side 2 and add it again; type `gru` → option "grudge match" → pick; Save → the `.json` has those
  sides in that order and the tag. Acceptance: tests + flow pass; ui:verify still zero axe violations.

- **D6 — quick favourite and rating on the row.** Files: edit [[150]]'s row component under
  `src/renderer/src/modules/replays/` (the one rendering the favourite/rating column), edit
  `demo-editor-store.ts` (`quickEdit(id, patch)`), edit `demo-editor-store.test.ts`, edit `en.json`
  (`replays.row.quick.*`), edit `CHANGELOG.md`, edit `CLAUDE.md` only if the controls are below
  44px (a Deviations row, same reason), new `scripts/flows/replays-row-quick-rating.mjs`. On the
  row: a favourite toggle `IconButton` (`aria-pressed`, label names the demo) and a compact select
  (—, 1–10); both `stopPropagation` so the panel does not open. `quickEdit`: `sidecarRead(id)` →
  D2 `withQuickEdit(values, patch)` → `sidecarWrite`; `needsConfirmation` → D4's
  `ReplaceSidecarDialog`; `saved` → the same row patch as D4; if that demo's panel holds a draft,
  apply the patch to the draft's baseline and favourite/rating too, so the panel does not later
  save the old values. Archive entries: disabled, `aria-describedby` → the row's archive marker.
  Testids: `replays-row-favourite`, `replays-row-rating`. Store test › "a quick edit re-reads and
  keeps the other notes". Flow `replays-row-quick-rating`: on the fixture demo with
  `duel_q2dm1.dm2.json`, note its sidecar content, toggle the star and pick rating 7 on the row →
  `replays-detail` never opened; the `.json` keeps every earlier field and gains `favourite: true`
  and `rating: 7`; the row is first ([[152]]). Acceptance: tests + flow pass.

## Model Hints

- D1 → default — a pure mapping over 148's resolver with two tests.
- D2 → default — pure functions, each rule pinned by its own test case (bounds, date, dirty, merge).
- D3 → default — a read-only panel mirroring an existing layout.
- D4 → deliverable-hard — the draft lives in a store that outlives the view, next to selection
  changes, the two-step confirm-replace contract and the post-save row patch. A wrong order either
  silently loses a draft, overwrites a broken sidecar without 147's confirmation, or falls back to
  a rescan.
- D5 → default — form widgets over D2's tested ops; the combobox follows the standard ARIA pattern.
- D6 → default — one store action over D2's `withQuickEdit` and D4's dialog.
- Review: → default — each plausible wrong version fails a named test: writing only `{ favourite }`
  from the row (flow + merge test), prefilling guesses into the sidecar (flow asserts the file),
  a rescan after save (store test), saving over a broken sidecar (store test).

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D3), with unit
  `src/shared/replays/demo-detail.test.ts` › "the detail lists every effective value with its
  source" (D1) and RTL `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` ›
  "the panel shows each value with its source as text" (D3). Closes [[148]] AC5's named gap.
- AC2 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (D4), with unit
  `src/shared/replays/sidecar-draft.test.ts` › "a draft round-trips every sidecar field" (D2).
- AC3 → e2e `scripts/flows/replays-edit-sides-tags.mjs` › "replays-edit-sides-tags" (D5), with unit
  `src/shared/replays/sidecar-draft.test.ts` › "sides and players can be added, removed and
  reordered" (D2).
- AC4 → e2e `scripts/flows/replays-edit-sides-tags.mjs` › "replays-edit-sides-tags" (D5), with unit
  `src/shared/replays/demo-detail.test.ts` › "known players come from the demo and the file name,
  not the sidecar" (D1) and `src/shared/replays/sidecar-draft.test.ts` › "a known player is taken
  into a side once" (D2).
- AC5 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (D4), with unit
  `src/shared/replays/sidecar-draft.test.ts` › "rating outside 1–10 and an unparsable date are
  errors that block saving" (D2).
- AC6 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (D4), with unit
  `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "leaving a dirty draft asks, a
  clean one does not" and › "a save over a broken sidecar asks before replacing it", RTL
  `src/renderer/src/modules/replays/components/DemoNotesEditor.test.tsx` › "a failed save shows its
  reason" (D4; closes [[146]] AC7's gap), and `src/shared/replays/sidecar-draft.test.ts` › "an
  untouched draft is not dirty" (D2).
- AC7 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (D4), with unit
  `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "a save patches the row from
  sidecar.read without a scan" (D4).
- AC8 → e2e `npm run ui:verify` screens `replays-detail` (D3) and `replays-editor` (D4) with zero
  axe violations, plus `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (D4).
- AC9 → e2e `scripts/flows/replays-row-quick-rating.mjs` › "replays-row-quick-rating" (D6), with
  unit `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "a quick edit re-reads and
  keeps the other notes" (D6) and `src/shared/replays/sidecar-draft.test.ts` › "a quick favourite or
  rating keeps every other field" (D2).
- AC10 → e2e `scripts/flows/replays-edit-sides-tags.mjs` › "replays-edit-sides-tags" (D5), with
  RTL `src/renderer/src/modules/replays/components/TagInput.test.tsx` › "the tag input suggests tags
  from other demos and adds one from the keyboard" (D5) and unit
  `src/shared/replays/sidecar-draft.test.ts` › "tag suggestions come from other demos' tags" (D2).

## Done

<!-- Filled by /build 155. -->
