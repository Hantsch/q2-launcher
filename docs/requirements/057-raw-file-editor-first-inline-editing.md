---
id: 057
title: Raw file is an editor first, and I can edit inline
status: ready
created: 2026-09-05
---

## Requirement

The Raw file tab is where I read my config, and lately where I want to change one line quickly.
Today the actual file gets a fixed box of 16rem (about 256px, some fourteen lines -
`src/renderer/src/styles/config-syntax.css:70`, `.cfg-code { max-height: 16rem }`), while the
section label, the path row, the "not written" and "unsaved" notices, the `unbindall` checkbox with
its help paragraph, the section-header-style select with its help paragraph, and one card per
installation with its own path, badge, "Played mods" block and an expandable second code view take
the rest (`RawFileTab.tsx:155-305`). The interesting thing has the least space; everything else is
admin I rarely touch. The code view is strictly read-only (`components/ConfigCodeView.tsx:20`), the
only way to edit is the OS editor (`openFile`, `main/modules/config/index.ts:1315-1360`), and no
IPC channel accepts config text (`src/shared/modules/config.ts:18-51`).

What I want: the editor is the tab. The file fills the height; the options become a small toolbar;
the installation copies are one compact line each - or leave the tab (see Open Questions). And I
can type in it: for small quick changes, when I know what I am doing, I edit right there and Save.

## Acceptance Criteria

- [ ] The code view fills the tab's available height (no fixed cap, its own scroll) at full width;
      in a 1280x800 window at least 30 lines are visible without scrolling the page.
- [ ] `unbindall` and the section header style live in one compact "File options" control (toolbar
      or popover) with tooltips instead of help paragraphs; path, on-disk badge, Open in editor and
      Reveal in folder are one line.
- [ ] Per-installation copies leave the tab entirely (they move to Care's Sync, story 058, per the
      binding sprint decision): no per-installation cards, no played-mods block and no second code
      view inside the tab (Care's Compare covers the diff).
- [ ] The code view is editable in place: typing, selection, Tab/Shift+Tab indenting, undo/redo,
      syntax highlighting while typing, line numbers, find; Ctrl+S saves.
- [ ] A raw edit is an unsaved change like any other: the save bar shows it ("file text edited"),
      Save writes exactly my text to the canonical file under the same conflict guard as today and
      then reads it back into the profile through the existing adopt path (with its warnings -
      dropped aliases, unrecognised lines); Discard throws the edit away.
- [ ] Text the launcher cannot read back cleanly is never silently mangled: after Save the read-back
      result (lines kept as preserved, warnings) is shown, and the file on disk is exactly what I
      typed.
- [ ] Raw editing and the structured tabs never hold two unsaved truths at once (see Open
      Questions) - whichever is active, the other side is read-only with a one-line hint.
- [ ] The production CSP stays `style-src 'self'` (story 046) with the editing technique used;
      `npm run ui:verify` stays at zero axe findings across `config-raw`, `config-write-preview`,
      `config-save-expanded`, `config-discard-confirm` and `config-conflict-dialog` (all of which
      drive this tab today, `scripts/lib/screens.mjs`); a `ui:flow` performs one inline edit through
      Save and reads the result back.

## Open Questions

~~1. **What text is edited?**~~ answered → Decisions (Sprint)
~~2. **Where do the per-installation copies go?**~~ answered → Decisions (Sprint)
~~3. **Editor technique?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** What text is edited: the on-disk file, editable only while the profile has no
  structured unsaved changes (otherwise "Save or discard first").
- **(User)** Per-installation copies move to Care's Sync section (story 058 consolidates them); the
  Raw file tab keeps only the canonical file and its options.
- **(User)** Editor technique: hand-rolled transparent textarea over the existing tokenised `<pre>` -
  keeps the production CSP (`style-src 'self'`) intact.
- CSP check (refine): the technique is compatible. Production CSP is `style-src 'self'` in
  `PRODUCTION_CSP` (`src/main/lib/renderer-source.ts:36-37`), served as a header by the
  `q2launcher://` handler (`:178`), never a `<meta>` tag (`src/renderer/index.html:8`). The plan
  introduces **no** runtime `<style>` element, no `style="..."` attribute string and no
  `dangerouslySetInnerHTML`; all editor styling is class-based in `config-syntax.css`, and the one
  dynamic value (gutter width / line height) is a CSS custom property set through a React
  `style={{}}` prop, which React applies via CSSOM (`node.style.setProperty`) and `style-src` does
  not govern - the same mechanism story 046 already cleared repo-wide.
- Textarea overlay is sized by the `<pre>` (absolutely positioned `inset: 0` inside the existing
  `.cfg-code` scroll grid, textarea `overflow: hidden`), so the grid stays the only scroller and
  gutter/highlight/caret stay aligned with zero scroll-sync JS.
- Programmatic edits (Tab / Shift+Tab indent) go through `document.execCommand('insertText')` so the
  textarea's native undo/redo stack survives - no hand-written history to maintain.
- Highlighting re-tokenises on every keystroke with the existing shared `tokenizeConfigText`, no
  debounce, because the `<pre>` also defines the textarea's box and a stale `<pre>` would misalign.
- Find reuses `ConfigCodeView`'s existing search bar and match spans, but opens on Ctrl+F instead of
  sitting permanently above the code - the row is needed for the 30-visible-lines floor.
- File options live inline in one compact toolbar row (checkbox + select with `HoverCard` tooltips
  replacing the help paragraphs) rather than a popover: no new UI primitive, and the existing
  ui:verify drivers that click those two controls keep working with only locator tweaks.
- Full height is a per-tab `fillsHeight` flag in `ConfigView` (raw tab only: outer becomes a flex
  column, page scroll off, editor owns its scroll) - the least invasive way to give one tab the
  viewport without changing the other tabs' scrolling page.
- The raw draft lives in a new renderer context `lib/raw-draft.tsx` next to `ProfileChangesProvider`,
  not inside the shared `ProfileChangeSet`: the diff is a server-truth structure and a renderer-local
  text draft has no business in it.
- Mutual exclusion is enforced in one place: while a raw draft exists the tab-content container gets
  `inert` plus a one-line hint; while `profile.dirty` the textarea gets `readOnly` plus a one-line
  hint. Cheaper and more honest than threading a `disabled` prop through every control in five tabs.
- New sub-channel `CONFIG_HANDLERS.saveRawText` on the existing `module:invoke` transport with its
  own zod schema in `src/main/modules/config/schemas.ts` - the established config pattern; no
  `src/shared/ipc.ts` or preload change is needed because config traffic already rides that channel.
- A raw save is rejected pre-flight when the text no longer carries the profile's ownership tag, or
  contains characters outside latin-1: ownership is what every guard (write, delete, open-in-editor,
  external-edit) keys on, and the file encoding is latin-1 - writing either would orphan or corrupt
  the profile.
- After the raw write the file-state record (hash/mtime) is updated from the bytes actually written
  and the profile is never re-rendered over the file, so "exactly what I typed" holds and the next
  conflict guard does not report a phantom external edit.
- The read-back result is an inline panel under the toolbar (preserved-line count, dropped aliases),
  not only a toast, because the acceptance criterion asks for it to be *shown*.
- Editing is offered only while the canonical file is on disk; otherwise the view stays read-only
  with today's "not written yet" hint - there is no text to edit and no baseline for the guard.
- The `config-write-preview` ui:verify screen is retired in this story (the raw tab's expander was
  `RawConfigPanel`'s only mount); `RawConfigPanel.tsx` stays in the tree, unmounted, with a header
  note pointing at story 058, which remounts it in Care's Sync and restores the screen.

## Plan

Goal: the Raw file tab becomes an editor. Chrome shrinks to two rows, the code view fills the
viewport, and it is typable with a real Save path.

1. **Code view gets an edit mode** (`components/ConfigCodeView.tsx`, `styles/config-syntax.css`).
   Drop the `max-height: 16rem` cap behind a `fill` variant; add an `editable` mode: a
   `position: relative` wrapper around the existing `<pre>` (which keeps size, gutter and
   `.cfg-tok-*` highlighting, `aria-hidden` in edit mode), with a transparent-text
   `<textarea>` at `inset: 0`, `caret-color` from the token palette, `spellcheck=false`,
   `wrap=off`, `resize=none`, `overflow: hidden`. Indent/dedent logic goes into a pure helper
   `lib/textarea-indent.ts` (unit-tested); it is applied through `execCommand('insertText')`.
   Find bar becomes Ctrl+F-toggled; "next match" selects the range in the textarea.
2. **Layout** (`ConfigView.tsx`): `fillsHeight` for `activeTab === 'raw'` - outer
   `h-full overflow-hidden flex flex-col`, inner container and `Panel` `flex-1 min-h-0 flex flex-col`
   with reduced padding, editor `flex-1 min-h-0`. Other tabs keep today's scrolling page.
3. **Tab compaction** (`RawFileTab.tsx`): one path/badge/open/reveal line, one file-options toolbar
   row (unbindall checkbox + section-header-style select, `HoverCard` tooltips, no help paragraphs),
   then the editor. Delete the per-installation `<ul>`, the played-mods block and the
   `RawConfigPanel` mount (L218-310) plus the now-dead local state.
4. **Main: `saveRawText`** (`shared/modules/config.ts`, `main/modules/config/{schemas,index}.ts`,
   renderer `client.ts`): conflict guard via the existing `readFileState` (same `conflict` /
   `unreadable` result shapes as `save`, same `force` bypass), ownership + latin-1 pre-flight, exact
   bytes written to the canonical path, file-state record refreshed, then `profiles.adoptFromFile`
   read-back returning `{ profile, droppedAliases, preservedLines }`.
5. **Renderer wiring** (`lib/raw-draft.tsx`, `ProfileSaveBar.tsx`, `ConfigConflictDialog.tsx`,
   `ConfigView.tsx`): draft context; save bar shows "file text edited" as its single change row when
   a draft exists; Save calls `saveRawText`, Discard drops the draft; the conflict dialog gets an
   optional `onOverwrite` so the raw path force-saves its own text. Ctrl+S in the editor triggers the
   same Save. Mutual exclusion via `inert` + hints.
6. **Read-back panel** under the toolbar after a raw save (preserved-line count, dropped aliases).
7. **Verification** (`scripts/lib/screens.mjs`, `scripts/flows/raw-inline-edit.mjs`): retarget the
   drivers of `config-save-expanded` / `config-conflict-dialog` to the compacted controls, retire
   `config-write-preview`, add a `config-raw-editing` screen, commit the inline-edit flow.

## Deliverables

**D1 - Editable code view + full-height variant**
Files: `src/renderer/src/modules/config/components/ConfigCodeView.tsx`,
`src/renderer/src/styles/config-syntax.css`, new `src/renderer/src/modules/config/lib/textarea-indent.ts`
(+ `textarea-indent.test.ts`). Mirror: `ConfigCodeView.tsx`'s existing `searchable` branch.
Acceptance: `<ConfigCodeView editable fill onChange>` renders the transparent textarea over the
tokenised `<pre>`; typing re-highlights, line numbers stay aligned, Tab/Shift+Tab indent the
selection, native undo/redo works, Ctrl+F opens find; read-only usage is byte-identical to today;
no `<style>` element, no `style` attribute string, no new CSP directive - `npm run typecheck`,
`npm test` green.

**D2 - Raw tab fills the viewport**
Files: `src/renderer/src/modules/config/ConfigView.tsx`.
Acceptance: on the raw tab the page itself no longer scrolls, the code view owns its scroll, and at
1280x800 at least 30 code lines are visible without scrolling; every other tab renders exactly as
before.

**D3 - Compact chrome, per-installation copies gone**
Files: `src/renderer/src/modules/config/RawFileTab.tsx`, `src/renderer/src/i18n/locales/en.json`,
`src/renderer/src/modules/config/RawConfigPanel.tsx` (header note only).
Acceptance: one path line (path, on-disk badge, Open in editor, Reveal) and one file-options row
with tooltips; no help paragraphs, no per-installation cards, no played-mods block, exactly one
`.cfg-code` in the tab; unbindall and section-header-style still write through their existing IPC
calls.

**D4 - `config: saveRawText` main handler** *(hard)*
Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
`src/main/modules/config/index.ts`, `src/renderer/src/modules/config/client.ts`, + main tests.
Mirror: the `CONFIG_HANDLERS.save` handler (`index.ts:889-982`) and `refreshFromFiles`
(`index.ts:995-1163`).
Acceptance: the channel takes `{ profileId, text, force? }`, validates length/latin-1/ownership tag,
returns the same `conflict` / `unreadable` shapes as `save`, writes exactly the given bytes,
refreshes the file-state record and returns the adopted profile plus `droppedAliases` /
`preservedLines`; tests cover: byte-exact write, conflict when the file changed on disk, `force`
overwrite, rejected disowned text, rejected non-latin-1 text, and no phantom external-edit on the
next guard run.

**D5 - Raw draft is an unsaved change** *(hard)*
Files: new `src/renderer/src/modules/config/lib/raw-draft.tsx`,
`components/ProfileSaveBar.tsx`, `components/ProfileChangeList.tsx`, `ConfigConflictDialog.tsx`,
`ConfigView.tsx`, `RawFileTab.tsx`, `en.json`. Mirror: `lib/profile-changes.tsx`.
Acceptance: typing in the editor makes the save bar show "file text edited"; Save writes and adopts,
Discard drops the edit; Ctrl+S in the editor saves; a save conflict opens the existing dialog and
"Overwrite" force-saves *the typed text*; while a draft exists the other tabs are `inert` with a
one-line hint, and while `profile.dirty` the editor is `readOnly` with a one-line hint - the two
never coexist.

**D6 - Read-back result is shown**
Files: `src/renderer/src/modules/config/RawFileTab.tsx` (+ small local panel), `en.json`.
Acceptance: after a raw save an inline panel names the preserved-line count and any dropped-alias
warnings and stays until the next edit; nothing about the result is toast-only.

**D7 - Verification**
Files: `scripts/lib/screens.mjs`, new `scripts/flows/raw-inline-edit.mjs`,
`docs/UI-VERIFICATION.md` (screen list only).
Acceptance: `npm run ui:verify` is exit 0 with zero axe serious/critical and zero CSP violations
across `config-raw`, `config-raw-editing` (new: dirty raw draft), `config-save-expanded`,
`config-discard-confirm`, `config-conflict-dialog`; `config-write-preview` is retired with a comment
naming story 058; `npm run ui:flow -- raw-inline-edit` types a line, saves, and asserts the read-back
panel and the changed file content.

**Coverage:** AC1 → D1+D2 · AC2 → D3 · AC3 → D3 · AC4 → D1 (+Ctrl+S in D5) · AC5 → D4+D5 ·
AC6 → D4+D6 · AC7 → D5 · AC8 → D1 (CSP) + D7.

## Model Hints

- D4 → `deliverable-hard` - a new write path onto the canonical file that must stay byte-exact,
  share the external-edit conflict guard and refresh the file-state record, or every later save
  reports a phantom "changed outside the launcher".
- D5 → `deliverable-hard` - it rewires the save bar's meaning across the whole detail screen (two
  mutually exclusive dirty sources, conflict dialog reuse, discard), where a mistake silently loses
  a user's edit.
- D1, D2, D3, D6, D7 → default.
- Review: → `story-review-hard` - the story adds an IPC channel that accepts renderer text and writes
  it to a real file on disk; a review that misses a guard here costs a user's config.

## Test Plan (manual acceptance)

1. Start the app, open Config → a profile that has been written → **Raw file** tab. At 1280x800,
   count the visible code lines: at least 30, and the page itself does not scroll.
2. Check the chrome: one path row (path, badge, Open in editor, Reveal) and one options row; hover
   the unbindall checkbox and the section-header-style select - the explanation is a tooltip, not a
   paragraph. There are no per-installation cards anywhere in the tab.
3. Click into the code, change a `set` value, press Tab and Shift+Tab on a selected block, press
   Ctrl+Z / Ctrl+Y - highlighting follows, line numbers stay aligned.
4. The save bar now says "file text edited". Switch to Settings: the controls are not operable and a
   one-line hint says why. Back on Raw file, press Ctrl+S.
5. After the save: the inline panel names the preserved lines / dropped aliases; open the file in the
   OS editor (Open in editor) and confirm it is byte-for-byte what you typed.
6. Repeat step 3, then press Discard - the edit is gone and the file on disk is unchanged.
7. Make a structured change in Settings first (do not save), go to Raw file: the editor is read-only
   with a one-line hint. Save or discard, and it becomes editable again.
8. With an edit pending, change the file in an external editor and press Save: the conflict dialog
   appears; "Overwrite" writes your typed text.

## Done
