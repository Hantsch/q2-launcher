---
id: 178
title: I edit a demo's details where I read them
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The detail panel shows every field twice: once as the read-only facts list at the top and once as
the "Your notes" form below it (name, description, mod, game mode, map, date, rating, tags, sides).
That doubles the panel's height and makes me compare two places to know what the demo "is".

Instead, the facts I read are the facts I edit: the panel has **one** set of fields. By default they
read as text ([[177]]'s layout); an **Edit** action turns them into inputs in place, and **Save** /
**Cancel** end the edit. The separate notes form goes away. What the sidecar editor can do today
([[155]]) stays possible — only its place changes.

## Acceptance Criteria

- [ ] **AC1** — The panel no longer shows a separate "Your notes" form below the facts.
- [ ] **AC2** — The panel offers an Edit action; after pressing it, the name (in the header), map,
      mod, gamemode, players/sides and recorded date become editable in place, and a description
      and tags field appear.
- [ ] **AC3** — Save writes the changes to the demo's sidecar, the panel returns to reading mode
      showing the saved values, and the list row reflects them without a rescan.
- [ ] **AC4** — Cancel returns to reading mode with the values from before the edit; nothing is
      written.
- [ ] **AC5** — Save is disabled while nothing changed or while an entered date is invalid, as the
      current form does; the reason for an invalid date is visible text.
- [ ] **AC6** — Leaving a demo (selecting another row, closing the panel, switching module) with
      unsaved edits still asks to keep editing or discard, as today ([[155]]).
- [ ] **AC7** — An archive entry offers no Edit action as an enabled control: it stays visible,
      disabled, with the existing read-only reason as visible text ([[158]]).
- [ ] **AC8** — A saved description and tags are shown in reading mode (below the facts) when set,
      and omitted when empty.

## Open Questions

- ~~Q1: Edit granularity — one Edit for the whole panel (recommended: one draft, one Save, matches
  today's store) or per-field inline editing (click a value, edit, Enter saves)?~~ answered → Decisions (Sprint)
- ~~Q2: An empty field in edit mode shows the lower-source value as its placeholder today (e.g. "from
  the demo: q2rdm2"). Keep that cue in edit mode even though reading mode no longer shows provenance
  ([[177]])? Recommendation: keep the placeholder value, drop the "from the demo:" prefix.~~ answered → Decisions (Sprint)
- ~~Q3: Where do the file actions (Reveal, Copy path, Rename) sit once the form is gone — directly
  under the facts, or in the header next to Favourite as icon buttons?~~ answered → Decisions (Sprint)
- ~~Q4: File name, Length and Point of view are not sidecar fields — they stay read-only in edit mode.
  Confirm.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Edit granularity: one Edit for the whole panel (one draft, one Save)
- **(User)** Edit-mode placeholder: keep the lower-source value as placeholder, drop the "from the demo:" prefix
- **(User)** File actions: Reveal/Copy path/Rename become header icon buttons next to Favourite
- **(User)** Read-only fields: file name, Length and Point of view stay read-only in edit mode
- Edit state lives in `demo-editor-store.ts` as `editingId: string | null`, next to `selectedId` —
  one panel, one draft, one Save, and a module switch must not lose it (the store survives unmount).
- Switching module keeps the edit (draft and edit mode) and returns to it; it does not ask — this is
  "as today" in AC6: [[155]] D4 decided there is no route-leave hook and keeping the draft loses
  nothing, and adding one would edit the shell. Row select and panel close ask when dirty.
- Leaving a demo in edit mode with **no** changes just leaves and ends edit mode — nothing to lose,
  so no dialog (the dialog is for unsaved edits only, as today).
- Favourite and rating inputs stay in edit mode (below tags) until [[179]] replaces them (its AC8) —
  "what the sidecar editor can do today stays possible" must hold between the two stories.
- The placeholder is the field's effective value when its source is not the sidecar (name, map,
  mod, gamemode, date as `YYYY-MM-DD HH:MM`), otherwise the field's generic hint — the row only
  carries the winning value, and rebuilding the fallback chain in the renderer would duplicate main's
  precedence.
- In edit mode every editable field is shown even when empty (a user must be able to add a mod);
  the read-only facts keep [[177]]'s omit-when-empty rule.
- The Edit action is a `size="sm"` icon button (Pencil, label "Edit") in the header with the file
  action icons (Reveal `FolderOpen`, Copy path `Copy`, Rename `FilePen`), before Close; this needs a
  CLAUDE.md `/design-tokens` deviation row, like every other 28px header/row icon button.
- While editing, the header shows the name input and Close only — file actions and Edit are hidden
  (Rename would re-key the demo under an open draft; Reveal/Copy are one Cancel away).
- Save / Cancel sit in a footer row directly below the last edit field — keeps the header to one
  row next to the name input and mirrors today's form footer; Enter in a text input submits.
- The two visible read-only reasons (`replays-archive-readonly-edit`, `-rename`) move to one line
  block directly under the header, keeping their testids and i18n keys ([[158]]).
- Description and tags in reading mode render from `row.sidecar.values` below the facts (after a
  gap), description as wrapped text, tags as chips — independent of whatever [[177]] leaves in
  `buildDemoDetail`.
- The quick-edit replace dialog for the **selected** row must stay reachable outside edit mode:
  `ReplaysView`'s `rowReplaceId` excludes the selected id only while that id is being edited —
  today the always-mounted notes form rendered it, the edit-mode editor no longer is always mounted.
- A new ui:verify screen `replays-detail-edit` (edit mode open) gets the axe check — the old notes
  form was covered by `replays-detail`, which now shows reading mode only.

## Plan

Builds after [[177]] (facts list shape, larger header title) and before [[179]] (favourite toggle +
stars in the header). Renderer only — no IPC, no schema change; the sidecar write path is [[155]]'s.

1. **Store (D1):** `demo-editor-store.ts` gains `editingId` + `startEdit(id, values)` (opens a fresh
   draft, sets `editingId`), `cancelEdit(id)` (drops the draft, clears `editingId`), and `save`
   clears `editingId` on a successful write. `leave()` asks only when `editingId === selectedId` and
   the draft is dirty; otherwise it clears `editingId` and leaves. `discardAndLeave` clears it too.
   The eager `openDraft` on panel mount goes away (the draft opens on Edit).
2. **Header (D2):** `DemoFileActions` renders icon buttons for the header; `DemoDetailPanel`'s
   header gets them plus the Edit icon button (disabled for archive entries, reason visible under
   the header). CLAUDE.md deviation row.
3. **In-place edit (D3):** `DemoNotesEditor.tsx` becomes `DemoDetailEditor.tsx` — same draft binding,
   validation, replace/discard dialogs, but laid out as the facts list with inputs in place and the
   name input in the header slot. `DemoDetailPanel` renders reading mode or the editor by
   `editingId === row.id`; the "Your notes" section heading and form disappear. `ReplaysView`'s
   quick-edit replace dialog condition adjusts. Flows `replays-edit-sidecar` / `-sides-tags` updated.
4. **Reading mode extras (D4):** description + tags below the facts when set; ui:verify screen
   `replays-detail-edit`.

Order: D1 → D2 → D3 → D4. CHANGELOG `### Changed` entry lands with D3.

## Deliverables

- **D1 — store: edit mode and the leave guard.** Files: `src/renderer/src/modules/replays/demo-editor-store.ts`,
  `demo-editor-store.test.ts` (same folder). Add `editingId: string | null` (initial `null`),
  `startEdit(id, values: Partial<SidecarFields>)` → creates `{ draft, baseline }` from
  `draftFromSidecar(values)` (replacing any non-dirty, non-saving entry, as `openDraft` does) and
  sets `editingId = id`; `cancelEdit(id)` → deletes the entry (unless `saving`) and sets
  `editingId = null` when it was `id`. `save` success path additionally sets `editingId = null` when
  it equals `id`. `leave(request)`: if `selectedId !== null && editingId === selectedId` and the
  entry is dirty → park `pendingLeave` (unchanged); otherwise set `selectedId = targetId`,
  `editingId = null`, drop the non-dirty entry of the demo being left. `discardAndLeave` also clears
  `editingId`. `quickEdit` is unchanged (it refreshes an open entry's baseline/draft). Keep
  `openDraft` exported only if still used; nothing else may call it on panel mount any more.
  Unit tests (describe "edit mode"): "startEdit opens a draft and sets editingId"; "cancelEdit
  drops the draft and writes nothing" (no `sidecarWrite` call); "a successful save ends edit mode";
  "leaving a dirty edit parks pendingLeave"; "leaving a clean edit leaves and ends edit mode";
  "discardAndLeave ends edit mode"; "editingId survives a simulated remount" (state read again from
  the store, nothing cleared).

- **D2 — header: file actions as icon buttons and the Edit action.** Files:
  `src/renderer/src/modules/replays/components/DemoFileActions.tsx` (+ `DemoFileActions.test.tsx`),
  `components/DemoDetailPanel.tsx` (+ `DemoDetailPanel.test.tsx`),
  `src/renderer/src/i18n/locales/en.json`, `CLAUDE.md` (Deviations table),
  `scripts/flows/replays-archive-readonly.mjs`. `DemoFileActions` renders three `IconButton
  size="sm"` (from `components/ui/Button`) — Reveal (`FolderOpen`), Copy path (`Copy`), Rename
  (`FilePen`), lucide icons with `aria-hidden`, labels = the existing
  `replays.fileActions.reveal`/`.copyPath`/`replays.rename.title` keys; testids unchanged
  (`replays-demo-reveal`, `replays-demo-copy-path`, `demo-rename`); the error alert, the toast and the
  rename dialog behave exactly as now. The panel header (mirror the existing Close `IconButton`)
  shows, after the title: the file actions, an Edit `IconButton size="sm"` (`Pencil`, label
  `replays.detail.edit` = "Edit", testid `replays-detail-edit`) that calls
  `useDemoEditorStore.getState().startEdit(row.id, row.sidecar.values)`, then Close. For an archive
  entry (`row.archiveEntry !== null`) Edit and Rename are `disabled` with `aria-describedby` to the
  reasons, and a block directly under the header shows `replays.archive.readOnly.edit` (testid
  `replays-archive-readonly-edit`) and `replays.archive.readOnly.rename` (testid
  `replays-archive-readonly-rename`) as visible text — remove both paragraphs from their old places.
  While `editingId === row.id` the header hides file actions and Edit (Close stays). Add a CLAUDE.md
  Deviations row: `/design-tokens` (44px) — demo detail header icon buttons (Reveal, Copy path,
  Rename, Edit; `DemoDetailPanel.tsx`/`DemoFileActions.tsx`) use `size="sm"` (28px); reason "same as
  above — desktop, mouse-and-keyboard-only; story `docs/requirements/178-i-edit-a-demos-details-where-i-read-them.md`".
  Tests: component "the header offers Edit, Reveal, Copy path and Rename as icon buttons"; "an
  archive entry shows Edit disabled with the read-only reason as visible text"; flow
  `replays-archive-readonly` asserts `replays-detail-edit` visible + disabled and
  `replays-archive-readonly-edit` text visible (replace its old notes-form assertions).

- **D3 — the facts become the form: in-place edit mode.** Files: `git mv
  components/DemoNotesEditor.tsx → components/DemoDetailEditor.tsx` and its test likewise,
  `components/DemoDetailPanel.tsx` (+ test), `src/renderer/src/modules/replays/ReplaysView.tsx`,
  `en.json`, `scripts/flows/replays-edit-sidecar.mjs`, `scripts/flows/replays-edit-sides-tags.mjs`,
  `CHANGELOG.md`. `DemoDetailPanel` renders reading mode (the facts list as [[177]] left it) when
  `editingId !== row.id`, else `DemoDetailEditor` in the same place; no "Your notes" heading
  (`replays.editor.section`, testid `replays-notes-slot` removed), no always-mounted form, no
  `openDraft` on mount. `DemoDetailEditor` keeps the draft binding, `draftToFields` validation,
  `canSave = converted.ok && isDraftDirty(...) && !saving`, the save-error alert and the
  `ReplaceSidecarDialog`, laid out as the facts list rows (label left, control right): the **name**
  `Input` sits in the header's title slot (testid `replays-editor-name`); File name and Length stay
  read-only text; Recorded → `date` input; visible gap; Map, Mod, Gamemode inputs; Players →
  `SidesEditor`; Point of view read-only; then Description textarea, Tags `TagInput`, then the
  existing Favourite checkbox and Rating input (until [[179]]); then a footer with Cancel
  (`cancelEdit`) and Save. Every editable field shows even when empty. Existing testids
  `replays-editor-<field>`, `-error-<field>`, `-save`, `-cancel`, `-save-error` are kept. Placeholder
  for name/map/mod/gamemode/date: the effective value (`row.effective.<field>` / the detail field)
  when its source is not `'sidecar'`, **without** a source prefix (date formatted via
  `isoToDraftText`, exported from `src/shared/replays/sidecar-draft.ts`, or the same
  `YYYY-MM-DD HH:MM` shape from the ms value); otherwise the generic `replays.editor.placeholder.*`
  hint. Drop the now-unused `mapFromSource` key. The invalid-date reason stays visible text under
  the date input. `DiscardDemoNotesDialog` is rendered by `DemoDetailPanel` (always mounted while a
  demo is selected) on `pendingLeave`. `ReplaysView`: `rowReplaceId` finds any id with a pending
  `replace` except the one currently in edit mode (`editingId`), so a row-star quick edit on the
  selected demo that needs confirmation still shows its dialog outside edit mode. CHANGELOG
  `### Changed`: one line — the demo detail edits in place. Tests: component "Edit turns the facts
  into inputs in place, name in the header"; "no separate notes form is rendered"; "Save is
  disabled until something changes and while the date is invalid, with the reason as text";
  "Cancel restores the values and writes nothing"; "an empty field shows the lower-source value as
  placeholder without a source prefix"; "a selected row's quick-edit confirmation shows outside edit
  mode". Flow `replays-edit-sidecar` rewritten to: select the MVD row → press `replays-detail-edit`
  → edit name/mod/date → invalid date disables Save with the reason visible → valid → Save → sidecar
  on disk has the values, panel back in reading mode showing them (`replays-detail-title`), row
  patched without a rescan → Edit + change + Cancel → reading mode shows the saved values, sidecar
  unchanged → Edit + change → click another row → discard dialog → Keep → `nav-home` → `nav-replays`
  → still in edit mode with the draft → Close → dialog → Discard → sidecar unchanged. Flow
  `replays-edit-sides-tags` presses `replays-detail-edit` before its existing steps.

- **D4 — reading mode shows description and tags; edit-mode ui:verify screen.** Files:
  `components/DemoDetailPanel.tsx` (+ test), `scripts/lib/screens.mjs`,
  `scripts/flows/replays-edit-sides-tags.mjs`. Below the facts (after a visible gap), reading mode
  shows the sidecar description as wrapped text (testid `replays-detail-description`) and tags as
  chips (testid `replays-detail-tags`, mirror `TagInput.tsx`'s chip styling without remove buttons),
  each only when non-empty (`row.sidecar.values.description?.trim()`, `tags?.length`). New screen in
  `screens.mjs` after `replays-detail` (mirror it): id `replays-detail-edit`, variant `replays-rows`,
  same row click then `replays-detail-edit` click, wait for `replays-editor-save`. Tests: component
  "reading mode shows description and tags when set"; "reading mode omits empty description and
  tags"; flow `replays-edit-sides-tags` asserts, after its save, `replays-detail-description` /
  `replays-detail-tags` show the saved values.

## Model Hints

- D1, D2, D4 → default tier.
- D3 → deliverable-hard: the editor stops being always mounted, which silently moves three
  responsibilities (discard dialog on leave, the selected row's quick-edit replace dialog in
  `ReplaysView.tsx`, draft opening) across `DemoDetailPanel`/`ReplaysView`/the store — a miss drops a
  confirmation dialog or leaves a stale draft, and the rewritten flow is the only e2e guard.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (no notes form
  before Edit) · unit `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` › "no
  separate notes form is rendered"
- AC2 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (Edit → inputs in
  place) · e2e `scripts/flows/replays-edit-sides-tags.mjs` › "replays-edit-sides-tags" (sides, tags,
  description) · unit `components/DemoDetailEditor.test.tsx` › "Edit turns the facts into inputs in
  place, name in the header"
- AC3 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (sidecar on disk,
  reading mode shows saved values, row patched without rescan) · unit
  `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "a successful save ends edit mode"
- AC4 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (Cancel) · unit
  `demo-editor-store.test.ts` › "cancelEdit drops the draft and writes nothing" · unit
  `components/DemoDetailEditor.test.tsx` › "Cancel restores the values and writes nothing"
- AC5 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (invalid date) · unit
  `components/DemoDetailEditor.test.tsx` › "Save is disabled until something changes and while the
  date is invalid, with the reason as text"
- AC6 → e2e `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar" (row select + close
  ask; module switch keeps the edit) · unit `demo-editor-store.test.ts` › "leaving a dirty edit
  parks pendingLeave", "editingId survives a simulated remount"
- AC7 → e2e `scripts/flows/replays-archive-readonly.mjs` › "replays-archive-readonly" · unit
  `components/DemoDetailPanel.test.tsx` › "an archive entry shows Edit disabled with the read-only
  reason as visible text"
- AC8 → e2e `scripts/flows/replays-edit-sides-tags.mjs` › "replays-edit-sides-tags" (description +
  tags after save) · unit `components/DemoDetailPanel.test.tsx` › "reading mode shows description
  and tags when set", "reading mode omits empty description and tags"

Coverage gate: AC1 D3 · AC2 D2+D3 · AC3 D1+D3 · AC4 D1+D3 · AC5 D3 · AC6 D1+D3 · AC7 D2 · AC8 D4.
Axe coverage of edit mode: ui:verify screen `replays-detail-edit` (D4).

## Done
