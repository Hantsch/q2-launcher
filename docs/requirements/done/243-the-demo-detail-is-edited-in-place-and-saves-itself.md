---
id: 243
title: the demo detail is edited in place and saves itself
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player, the demo detail is one view: I click a field and change it, add a tag by typing it, and
the change is saved on its own — there is no separate edit mode and no Save button to forget.

User feedback 2026-10-04: the detail view should be directly editable and not have two different
views, which only confuses users; tagging should work directly and save immediately.

Today the detail has a read mode (`DemoDetailPanel.tsx`) and an edit mode behind a pencil button
(`DemoDetailEditor.tsx`) with Cancel/Save, a draft store and a discard dialog. Only favourite and
rating are already "quick edits" that save at once through `quickEdit`.

Concept: [replays-module.md](../../systems/replays-module.md).

## Acceptance Criteria

- [x] **AC1** — The detail has a single view; there is no Edit button, no Cancel/Save and no discard
      dialog.
- [x] **AC2** — Name, description, date, map, mod, gamemode and sides are edited in place: a field
      looks like text until hovered/focused, and is an input when focused.
- [x] **AC3** — A text change is saved when the field loses focus or Enter is pressed (Escape reverts
      the field); a failed save shows a toast and the field keeps the user's text.
- [x] **AC4** — Tags are added by typing and Enter (with the existing suggestions) and removed with
      the chip's ×; each add/remove is saved at once.
- [x] **AC5** — A saved change is visible in the list row without a rescan.
- [x] **AC6** — An invalid value (e.g. a too-long name) is refused at the field with a visible reason
      and is not saved.
- [x] **AC7** — If the demo's existing sidecar is unreadable, the first edit still asks before
      replacing it, as today.
- [x] **AC8** — Zip entries show the same view read-only, with the reason as visible text.
- [x] **AC9** — Saves to one demo are queued so that quick successive edits never overwrite each
      other.

## Open Questions

- ~~**Q1** — Undo: is a short "Undo" in the save toast wanted? Recommendation: no for now — every
  field reverts with Escape before it is saved.~~ answered → Decisions (Sprint)
- ~~**Q2** — The "known players" chips from the sides editor: kept as-is inside the in-place sides
  field? Recommendation: yes; [[245]] may replace the sides display with a team table later.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Undo in save toast: no (Escape reverts before save).
- **(User)** Known-players chips: kept inside the in-place sides field.
- One write path: `demo-editor-store.ts` gets a single `edit(id, change)` whose `change` is a function
  applied to a **fresh** sidecar read inside the existing per-demo queue — that queue already exists
  (story 179), and applying ops to a fresh read is what makes AC9 hold.
- Text fields are always real inputs styled quiet (no border/background until hover/focus), not
  click-to-swap spans — AC2's look with keyboard reachability and no focus juggling.
- Description is multiline: Enter inserts a newline; it commits on blur or Ctrl+Enter — Enter-to-save
  would make line breaks impossible.
- Clearing a field removes the sidecar override and the demo's own value shows again as placeholder —
  story 178's existing semantics, unchanged.
- The inputs' `maxLength` attributes are dropped; lengths are checked against limits shared with the
  zod schema and refused with a visible reason — `maxLength` would truncate silently, which AC6 forbids.
- An invalid value on blur/Enter stays in the field with its reason and writes nothing; Escape reverts
  it — the only reading of AC3+AC6 that never loses or silently saves text.
- A failed write pushes a sticky error toast (`toastOutcomeError` with main's error key) and the field
  keeps the user's text; committing again retries — AC3.
- Sides: the resting display is whatever the detail shows for sides at build time (story 245's team
  list); activating it opens `SidesEditor` in place (with the known-player chips); the whole sides value
  commits when focus leaves the sides field, Escape reverts — per-click saves would persist half-made
  empty sides.
- Tags: `TagInput` is always shown; each add/remove is an op applied to the fresh read, never a whole
  array from the row — two quick tag clicks must not overwrite each other (AC9). A tag over 40
  characters is refused at the input with a visible reason (today `addTag` drops it silently; AC6).
- A dirty, valid field also commits when it unmounts (module switch, other demo selected) — this
  replaces the old "draft survives a module switch" guarantee with "nothing typed is lost".
- One `ReplaceSidecarDialog` in `ReplaysView` serves every demo; its Cancel drops the parked changes
  and the fields show the on-disk values again — AC7 "as today", without a second dialog in the panel.
- Zip entries render the same layout with every editable field as plain, non-focusable text and the
  existing `replays.archive.readOnly.edit` sentence — it already names the reason and no longer
  mentions an Edit button.
- No optimistic overlay for text fields: the field shows its own text until the row is patched; the
  favourite/rating overlay (`quickPending`) stays as it is — nothing visible would change.
- The e2e failure case deletes the demo file on disk before committing, which main refuses with the
  existing `demoMissing` key — a real refusal through the real surface, no fake.
- TD-018 (back-to-back quick edits drop a field) is covered by D2's race test; D2 deletes the row from
  `docs/TECH-DEBT.md` once that test passes.

## Plan

Replace the read/edit split with one detail view whose fields save themselves. Bottom-up, five Ds:

1. **Shared (D1):** limits shared by `sidecarFieldsSchema` and a new per-field validator; a
   `SidecarChange` type with ready-made changes (set field, add/remove tag, favourite/rating) that
   generalises `withQuickEdit`.
2. **Store (D2, hard):** `edit(id, change, onRowPatched)` on the existing per-demo queue — fresh read,
   apply, write, re-read, patch the row; `needsConfirmation` parks the composed changes behind one
   replace dialog. `quickEdit` becomes a thin wrapper. The old draft/edit-mode API stays until D4.
3. **Component (D3):** `InPlaceField` (quiet input / textarea; Enter or blur commits, Escape reverts,
   reason text, keeps text on failure, commits on unmount) and a refusal reason in `TagInput`.
4. **Panel (D4):** `DemoDetailPanel` becomes the single view — name in the header, date/map/mod/
   gamemode/description in place, tags always live, zip read-only. Deletes `DemoDetailEditor`,
   `DiscardDemoNotesDialog` and the store's draft/edit-mode/leave-guard API. Rewrites the
   `replays-edit-sidecar` flow, adjusts `replays-archive-readonly` and `scripts/lib/screens.mjs`;
   updates `docs/systems/replays-module.md` and `CHANGELOG.md`.
5. **Sides (D5):** the sides field in place around `SidesEditor`; rewrites `replays-edit-sides-tags`
   and adds the `replays-edit-unreadable-sidecar` flow (AC7).

Order D1 → D2 → D3 → D4 → D5. Between D4 and D5 sides are display-only; that is fine inside the story.

## Deliverables

- **D1 — Field validation and sidecar changes (shared).** In `src/shared/replays/sidecar.ts` export
  `SIDECAR_LIMITS` (name 200, description 4000, map/mod/gamemode 64, tag 40, tags 50, side team 64,
  result 32, player 64, players 64, sides 16) and make `sidecarSideSchema`/`sidecarFieldsSchema` use
  it, so the two cannot drift. In `src/shared/replays/sidecar-draft.ts` add
  `fieldPatchFromText(field: 'name'|'description'|'date'|'map'|'mod'|'gamemode', text)` →
  `{ ok: true; patch: Partial<SidecarFields> }` (trimmed empty text → the key set to `undefined`, i.e.
  remove the override; date goes through the existing `convertDate` logic) or
  `{ ok: false; error: { key, params? } }` with `DATE_ERROR_KEY` or a new
  `TOO_LONG_ERROR_KEY = 'replays.editor.error.tooLong'` and `{ max }`. Add
  `type SidecarChange = (values: Partial<SidecarFields>) => SidecarFields` plus builders
  `setFields(patch)`, `addTagChange(tag)`, `removeTagChange(tag)` (case-insensitive like
  `addTag`/`removeTag`), `quickChange(patch)` (the existing `withQuickEdit` semantics — reuse it, do
  not copy it), and `composeChanges(...changes)`. A change never normalises or drops fields it does not
  name. Add `validateTag(text)` returning the too-long reason (> `SIDECAR_LIMITS.tag`). Add the locale
  text `"tooLong": "Too long — at most {{max}} characters."` under `replays.editor.error` in
  `src/renderer/src/modules/replays/locale/en.json`. Tests in `src/shared/replays/sidecar-draft.test.ts`:
  "a too-long name is refused with its maximum", "an emptied field removes the override",
  "a change leaves fields it does not name untouched", "two composed tag adds keep both".
- **D2 — One queued write path for every detail edit (store).** File
  `src/renderer/src/modules/replays/demo-editor-store.ts` (+ `demo-editor-store.test.ts`), and
  `src/renderer/src/modules/replays/ReplaysView.tsx` for the dialog wiring. Add
  `edit(id, change: SidecarChange, onRowPatched): Promise<'saved' | 'failed' | 'cancelled'>` that runs
  on the existing `enqueue` tail: `sidecarRead(id)` fresh → `change(values)` → `sidecarWrite` →
  `sidecarRead` again → `onRowPatched(id, after)`. A failed read/write resolves `'failed'` and pushes a
  sticky toast through `toastOutcomeError(useLauncher.getState().pushToast, outcome)` (`lib/toast.ts`,
  `store/useLauncher` — the pattern `modules/servers/ServerRow.tsx` uses). On `needsConfirmation` park
  the change in the entry (`replace`, `fingerprint`, `pendingChange` composed with any change that
  arrives while the dialog is open — generalise today's `pendingQuickEdit`); the promise stays pending
  until `confirmEdit(id, onRowPatched)` writes the composed change with that fingerprint (→ `'saved'`)
  or `cancelEdit(id)` drops it (→ `'cancelled'`). Re-express `quickEdit` and `confirmQuickEdit` on
  `edit`/`confirmEdit` with `quickChange`, keeping `quickPending`/`effectiveQuickValues` and the
  two-macrotask overlay clearing exactly as they are. `findRowReplaceId` no longer excludes the
  editor's demo; `ReplaysView` renders its one `ReplaceSidecarDialog` for any demo with `replace` and
  calls `confirmEdit`/`cancelEdit`. Leave `drafts`' draft/baseline, `editingId`, `pendingLeave`,
  `startEdit`, `save`, … in place — D4 deletes them with their last user. Tests (fake `./client`):
  "quick successive edits to one demo never overwrite each other" (name commit + tag add + favourite
  fired back to back with a delayed fake write: final written object has all three),
  "an unreadable sidecar parks the edit until the replace is confirmed",
  "cancelling the replace writes nothing and resolves cancelled", "a failed write toasts and resolves
  failed". When the race test passes, delete row TD-018 from `docs/TECH-DEBT.md`.
- **D3 — `InPlaceField` and the tag refusal (component).** New
  `src/renderer/src/modules/replays/components/InPlaceField.tsx` (+ `InPlaceField.test.tsx`).
  Props: `value` (on-disk text), `display?` (resting text when not focused, e.g. a localised date),
  `placeholder`, `label` (accessible name), `multiline?`, `readOnly?`,
  `validate(text) → { key, params? } | null`, `onCommit(text) → Promise<'saved'|'failed'|'cancelled'>`,
  `testId`. Renders the UI kit's `Input`/`TextArea` (`components/ui/controls`) with quiet classes from
  the design tokens: transparent border and background at rest, `border-line-strong` on hover,
  the normal focus ring on focus — no hex, no raw palette classes. Behaviour: local text follows
  `value` while not dirty; Enter (single-line) or Ctrl+Enter (multiline) or blur commits a dirty text;
  an invalid text shows `t(key, params)` below the field (`aria-invalid` + `aria-describedby`) and is
  not committed; Escape restores `value` and clears the reason; `'failed'` keeps the typed text;
  `'cancelled'` restores `value`; a dirty valid text also commits on unmount. `readOnly` renders the
  display text as plain text, not an input. In `components/TagInput.tsx` add a `validate` prop: a
  refused tag stays in the input with its reason as visible text (use D1's `validateTag`). Tests:
  "Enter commits and Escape reverts", "blur commits a changed value", "an invalid value shows its
  reason and is not committed", "a failed commit keeps the typed text", "a dirty field commits on
  unmount", "looks like text at rest and an input on focus", plus in `TagInput.test.tsx` "a too-long tag is refused with its reason".
- **D4 — The detail is one view (panel).** Rewrite
  `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx` (+ `DemoDetailPanel.test.tsx`):
  no Edit button, no `DemoDetailEditor`, no `DiscardDemoNotesDialog`. The header title becomes an
  `InPlaceField` for the name (keep an `h2` naming the section, `sr-only` is fine); date, map, mod,
  gamemode (display via `describeGamemode`) and description use `InPlaceField` in the existing facts
  layout, with `editorPlaceholder` (move it here from `DemoDetailEditor.tsx`) as placeholder and
  `fieldPatchFromText` both as `validate` and to build the `setFields` change for
  `useDemoEditorStore.getState().edit(row.id, …, onRowPatched)`. File name, duration, POV stay plain
  facts. Tags: `TagInput` always rendered, `onAddTag`/`onRemoveTag` call `edit` with
  `addTagChange`/`removeTagChange`, suggestions from `suggestTags(otherDemosTags, text, row tags)`.
  Archive entries (`row.archiveEntry !== null`): every field `readOnly`, `TagInput` replaced by plain
  chips, favourite/rating disabled as today, and the `replays-archive-readonly-edit` sentence shown.
  Delete `components/DemoDetailEditor.tsx`, `DemoDetailEditor.test.tsx`,
  `components/DiscardDemoNotesDialog.tsx`, and the store's draft/edit-mode/leave-guard members
  (`editingId`, `pendingLeave`, `startEdit`, `cancelEdit`(draft one), `updateDraft`, `cancelDraft`,
  `discardDraft`, `keepEditing`, `discardAndLeave`, `save`, `draft`/`baseline`) with their tests; `select`/`close` switch directly.
  Remove now-unused locale keys (`replays.editor.discardDialog`, `saveFailed` if unused). Rewrite
  `scripts/flows/replays-edit-sidecar.mjs` for the in-place behaviour with the steps named in this
  story's AC1/AC2/AC3/AC5/AC6 test lines; unit test "renders a single view without edit controls";
  update `scripts/flows/replays-archive-readonly.mjs` (no Edit button: assert the name input is
  absent/read-only and the reason sentence visible) and the `replays-detail-edit`/`replays-editor`
  entries in `scripts/lib/screens.mjs` (show the in-place date error instead). Update
  `docs/systems/replays-module.md` (components list, "edited in place, saves per field") and add one
  `CHANGELOG.md` line under `## Unreleased` › `### Changed`: "Demo details are edited in place and
  save themselves — no Edit or Save button."
- **D5 — Sides in place and the replace flow.** In `DemoDetailPanel.tsx` wrap the sides display (the
  one the detail shows at build time — story 245's team list) in a field that, on click/Enter, shows
  `components/SidesEditor.tsx` in place with its known-player chips, bound to a local draft
  (`draftFromSidecar(row.sidecar.values)`); when focus leaves the field's container
  (`focusout` with `relatedTarget` outside) the sides value commits through `edit` with
  `setFields({ sides })` (normalised as `draftToFields` does), Escape reverts and closes it. Archive
  entries: no activation. Tests in `DemoDetailPanel.test.tsx`: "the sides field saves when focus
  leaves it", "Escape reverts the sides field". Rewrite `scripts/flows/replays-edit-sides-tags.mjs`
  with steps "the sides field opens in place" (activate, edit, Tab out → sidecar on disk), "a
  suggested tag is saved at once", "the chip's × removes the tag on disk", "back-to-back edits all
  land on disk" (name Enter, tag add, favourite click without waiting → sidecar holds all three).
  New `scripts/flows/replays-edit-unreadable-sidecar.mjs`
  (variant `replays-rows`, `setup()` writes an unparsable `.json` sidecar next to
  `REPLAYS_ROWS_MVD_DEMO`; mirror `replays-edit-sides-tags.mjs`'s setup) with the step "the first
  edit asks before replacing an unreadable sidecar" (name Enter → `replays-replace-sidecar-dialog`;
  `replays-replace-confirm` → sidecar holds the name; a second edit writes without the dialog).

## Model Hints

- D2 → deliverable-hard: the new path composes parked changes behind the replace dialog and keeps
  promises pending across it, inside the queue whose overlay-clearing timing (story 179) already
  regressed once; a subtle reorder there drops a field (TD-018) or clears the favourite overlay early.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "the detail is one view: no Edit, Save, Cancel
  or discard dialog" (asserts `replays-detail-edit`, `replays-editor-save`, `replays-editor-cancel`
  absent; selecting another demo after typing shows no `replays-discard-dialog`) + unit
  `DemoDetailPanel.test.tsx` › "the detail is one view: no Edit, Save, Cancel or discard dialog".
- AC2 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "every text field is an input in place" (name,
  description, date, map, mod, gamemode inputs present in the panel) + unit `InPlaceField.test.tsx` ›
  "looks like text at rest and an input on focus" (quiet classes at rest, focus class on focus);
  sides → AC2 e2e `scripts/flows/replays-edit-sides-tags.mjs` › "the sides field opens in place".
- AC3 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "Enter saves the name, blur saves the mod,
  Escape reverts" (sidecar on disk) and › "a failed save toasts and keeps the text" (demo file deleted,
  toast with the `demoMissing` text visible, input still holds the typed text) + unit
  `InPlaceField.test.tsx` › "Enter commits and Escape reverts", "a failed commit keeps the typed text".
- AC4 → e2e `scripts/flows/replays-edit-sides-tags.mjs` › "a suggested tag is saved at once" and
  › "the chip's × removes the tag on disk".
- AC5 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "the row shows the saved name without a rescan"
  (row found by the new name, no `replays-list-loading`, `replays-refresh` enabled).
- AC6 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "an impossible date and a too-long name are
  refused with their reason" (reason text visible, sidecar unchanged) + unit
  `sidecar-draft.test.ts` › "a too-long name is refused with its maximum", `TagInput.test.tsx` ›
  "a too-long tag is refused with its reason".
- AC7 → e2e `scripts/flows/replays-edit-unreadable-sidecar.mjs` › "the first edit asks before
  replacing an unreadable sidecar" (`replays-replace-sidecar-dialog` visible; Confirm → sidecar holds
  the name; a second edit writes without asking) + unit `demo-editor-store.test.ts` › "an unreadable
  sidecar parks the edit until the replace is confirmed", "cancelling the replace writes nothing and
  resolves cancelled".
- AC8 → e2e `scripts/flows/replays-archive-readonly.mjs` › "a zip entry shows the same view read-only
  with its reason" (no editable name input, `replays-archive-readonly-edit` text visible).
- AC9 → unit `demo-editor-store.test.ts` › "quick successive edits to one demo never overwrite each
  other" + e2e `scripts/flows/replays-edit-sides-tags.mjs` › "back-to-back edits all land on disk"
  (name Enter, tag add and favourite click without waiting; sidecar holds all three).

## Done

Story 243 replaced the read/edit split with one detail view: `InPlaceField` per text field, always-live
`TagInput`, `SidesField` for sides; every edit goes through one queued `edit(id, change)` in
`demo-editor-store.ts` (fresh read, apply, write, re-read). Draft/edit-mode/discard API and
`DemoDetailEditor` are gone; one replace dialog in `ReplaysView` serves every demo; TD-018 closed.

Commit message: `243: demo detail edited in place, every field saves itself (queued fresh-read edits, InPlaceField, SidesField)`

Verification (narrow gate): build, lint, typecheck green; `vitest --changed HEAD` green (1444 tests);
comments + architecture tests green. `ui:flows --affected` selected 45 flows and exceeded the 10-minute
call limit (stopped; 29 observed, all OK, incl. the four story flows). Instead run by name, all OK: the story's
flows (`replays-edit-sidecar`, `-edit-sides-tags`, `-edit-unreadable-sidecar`, `replays-archive-readonly`) plus
every other `replays-*` flow except `replays-play-mvd2` onward (not run). After review fixes
`replays-edit-sidecar` and `replays-edit-sides-tags` re-ran OK.
AC -> test: AC1-AC9 as mapped in Acceptance Tests, all ran and passed; the AC1 unit test is named
"the detail is one view: no Edit, Save, Cancel or discard dialog" (mapping aligned). No manual residue.
Review: default stage, PASS with findings; fixed sides refusal visible, InPlaceField revert/in-flight/unmount, stale comments, blur test.

Decisions:
- Editor's own replace dialog removed (would have duplicated the view's one dialog).
- Old draft `cancelEdit` renamed `cancelDraftEdit` in D2, deleted in D4 with the draft API.
- Name field is a large title-size `InPlaceField` (`size="title"`); `replays-demo-detail` flow now measures the name input.
- `DemoDetailPanel` keyed by demo id so field drafts never leak across demos.
- Sides block always renders for non-archive entries so sides can be added to a demo with none.
- A refused or failed sides save keeps the sides editor open with the reason.
- Unfixed (accepted): `addTagChange` silently ignores duplicates and tags beyond the 50-tag limit; SidesField also commits on window blur; `FieldError`/`FieldReason` types declared three times.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 9
