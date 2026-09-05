---
id: 057
title: Raw file is an editor first, and I can edit inline
status: draft
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
- [ ] Per-installation copies are one line each - name, status, reveal/open, the played-mods choice
      behind a small control - and there is no second code view inside the tab (Care's Compare covers
      the diff).
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

1. **What text is edited?** (a) the on-disk file, editable only while the profile has no structured
   unsaved changes (otherwise "Save or discard first"); (b) the rendered draft - every keystroke is
   parsed back into the profile model at once and the text shown is always render(draft).
   Recommendation: (a) - predictable, no reformatting under my fingers, and save/adopt/conflict
   already exist for exactly this path.
2. **Where do the per-installation copies go?** Compact lines here, or Care's Sync section (which
   already lists the same files with the same states) so the Raw file tab is the editor only.
   Recommendation: Care (story 058 consolidates them); Raw file keeps the canonical file and its
   options.
3. **Editor technique:** hand-rolled (a transparent textarea over the existing tokenised `<pre>`,
   our own tokenizer keeps highlighting) versus CodeMirror 6. Recommendation: hand-rolled -
   CodeMirror injects `<style>` elements at runtime, which the production CSP forbids, and the
   feature set needed is small.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
