# Sprint S09 — Manual acceptance test plan

Covers the three stories built this sprint: **048** (every setting is written to the profile's
file, and nothing resets to a default any more), **049** (an unsaved change is reviewable and
discardable), **044** (one surface — the Aliases tab — to manage every alias in a profile).

General setup, once, before any of the three use cases:

- This repo has no built-in fixture seeding for a hand-run `npm run dev` session (that only exists
  for the `ui:verify` harness). None of the three use cases below need a registered installation —
  a config profile's canonical `.cfg` is written and gets a saved baseline the instant the profile
  is created (story 043), independent of whether it is assigned anywhere — so "Config → New
  profile → Empty profile" is enough preparation on its own. An installation is only needed if you
  additionally want to see a profile's file appear under a real game folder, which none of these
  three use cases require.
- `npm run dev` starts the app (Vite dev server + Electron, hot reload). `npm run build && npm
  start` runs the production build if you'd rather test that instead — nothing in this sprint's
  three stories is dev/production-mode sensitive.
- The app has no custom menu bar (`autoHideMenuBar: true`, frameless window); **F12** or
  **Ctrl+Shift+I** opens Chromium DevTools in any run mode if you want to watch the console.
- Only `en` ships; every label quoted below is the literal English UI text.

---

## Use case 1 — 048: every setting is written, and nothing resets to a default any more

### Preparation

`npm run dev`. **Config** → **"New profile"** → leave the source as **"Empty profile"**, name it
`S09 Reset Test`, create it, then open it.

### Steps and expected results

1. Open the **Settings** tab. Scroll through a few rows (e.g. under **Player**/**Graphics**).
   **Expected:** each row shows a label, its control, and a value cell with the current value plus
   a second line reading `= default` (or the default value and its range, once you've edited the
   row) — but **no icon or button anywhere on the row** to reset it. The row grid has exactly three
   columns (label, control, value); there is no fourth "reset" column.
2. Look at the tab's header bar (the strip above the grouped sections, next to the filter field).
   **Expected:** it reads `N cvars · 0 unsaved` (or similar counts) — there is no "Reset all"
   button anywhere in the header.
3. Change a cvar's value (e.g. toggle **"Auto-switch weapon"** or type a new **Sensitivity**
   number). **Expected:** nothing resembling a "reset all" confirmation dialog ever appears
   anywhere in the app, now or later — that control (and the per-row `RotateCcw` icon) no longer
   exist.
4. Open the **Controls** tab. Look at the tab's own header/toolbar area (next to "New category" /
   the filter field) and open a bind row's key-capture dialog. **Expected:** no **"Restore
   defaults"** button anywhere on the tab or inside the bind dialog, and no confirmation dialog for
   it exists to find.
5. Back on **Settings**, hover/inspect a row you have not touched. **Expected:** the default value
   is still printed as plain text in the value cell (e.g. `= default`) — that reference text is the
   only thing left of the old reset affordance; it is not a link, not a button, and clicking it does
   nothing.
6. **Raw File** tab: read the profile's own file in the code viewer. **Expected:** it lists a `set`
   line for every cvar the Settings tab shows (grouped under Player/Network/Graphics/Sound headers),
   not only the one you changed in step 3 — confirming the file states the whole configuration, not
   just your deviations.

---

## Use case 2 — 049: an unsaved change is reviewable and discardable

### Preparation

Use the `S09 Reset Test` profile from use case 1 (already has a saved baseline from the moment it
was created), or create a fresh empty profile the same way. `npm run dev`.

### Steps and expected results

1. Open the profile. At the top of the detail screen, the save bar reads **"Saved"** (a green
   checkmark badge) and there is no expandable disclosure next to it — nothing is pending yet.
2. **Settings** tab: change one cvar's value (e.g. **Sensitivity**). **Expected:** exactly that
   row's left border turns orange/flame-coloured **and** a small pencil-shaped glyph with the label
   "Unsaved change" appears next to its name (the row indicator is not colour-only). A row whose
   value merely differs from the printed default, but which you never touched, stays unmarked. The
   header count and the group's own count both go up by exactly one, and the save bar at the top now
   reads **"Unsaved changes"** with a **"N unsaved change(s)"** disclosure button next to it and an
   enabled **Save** button.
3. Turn on the **"Unsaved only"** switch in the Settings header. **Expected:** the list narrows to
   exactly the row(s) you edited — not to "everything that differs from a default".
4. Click the **"N unsaved change(s)"** disclosure button in the save bar. **Expected:** it expands
   into a before/after list, grouped under headings like **Cvars** (and **Binds**/**Actions**/
   **Layers**/**Settings** if you have pending changes there too) — sections with nothing pending
   simply don't appear. Your cvar shows as `<old value> → <new value>`. The **Save** button is still
   clickable while this panel is open. Click the disclosure again to collapse it.
5. Go to the **Controls** tab and rebind one key, or the **Overview** tab and rename an alt layer
   (create one first via **"New layer"** if none exist). **Expected:** the edited Controls row (or
   the layer's row in the **Overview** tab's "Alt layers" panel) is now marked the same way — orange
   border plus the labelled glyph — and the save bar's pending count goes up.
6. **Raw File** tab: with the pending edits from steps 2–5 still unsaved, look at the top section
   ("This profile's file"). **Expected:** a sentence appears stating that your pending changes are
   not in this file yet (e.g. "N unsaved changes are not in this file yet.") — there is no per-row
   border here, since this tab shows the actual on-disk file.
7. Click **Save** in the save bar. **Expected:** the badge switches to **"Saved"**, every orange
   border and glyph you saw in steps 2–5 disappears, the disclosure button and the Discard button
   both disappear (nothing left to review or discard), and the Raw File tab's notice sentence is
   gone.
8. Make a fresh edit (e.g. change a different cvar), then click the **"Discard…"** button that
   reappears next to Save. **Expected:** a dialog titled **"Discard unsaved changes?"** asks for
   confirmation, explaining this returns the profile to its last saved state without touching the
   file on disk. Click **"Discard changes"**. **Expected:** the edit is gone, the row's marker and
   the save bar's badge both clear, and re-opening the **Raw File** tab shows the file is unchanged
   from before your edit (its content/timestamp did not move — nothing was ever written for a
   discarded edit).
9. **External-edit / conflict path (AC9 — the baseline stays correct after an external
   change).** With the profile still open, click the Raw File tab's canonical row's **"Open in
   editor"** button — the `.cfg` opens in Notepad. Edit a cvar's value there and save, then click
   back into the launcher window. **Expected:** a toast reads "This profile's file changed on disk
   and was reloaded," the Settings tab shows the Notepad-edited value, and nothing is marked
   unsaved — the baseline moved to match the file exactly, so nothing you didn't type looks pending.
   Now make an edit in the launcher's Settings tab *without* saving, switch back to Notepad, edit
   the same file differently, save it there, then click **Save** in the launcher. **Expected:** the
   **"The file changed on disk"** dialog opens with **"On disk"** / **"Your unsaved changes"**
   panes; pick either **"Take the file"** or **"Overwrite with my version"** — either way, once the
   dialog closes, nothing is left marked as unsaved, and making one more edit afterward marks
   exactly that one row again (not a stale set left over from before the conflict).

### Gap: AC7's "no saved state to return to" path has no reachable UI route

Story 049's AC7 says Discard must be unavailable, with a stated reason, "when there is no saved
state to return to — e.g. a profile whose file does not exist yet." In the app as actually built,
this is not reachable through the UI: per story 043's `create` handler, a profile's canonical file
is written and its baseline seeded in the very same call that creates it, so every profile that
exists in the running app already has a baseline the instant it appears in the profile list — there
is no click-path that produces a profile with unsaved edits and no baseline. The story's own `Done`
notes confirm this: the only case that actually exercises the disabled-Discard/"no saved state"
message is a `state.json` record left over from *before* story 049 shipped, which cannot be
produced by any sequence of clicks in the current app either. This mechanism is unit-tested
(main-process level) but the manual test plan above cannot exercise it — it is a real gap, not an
oversight in this document.

---

## Use case 3 — 044: one surface to manage every alias in a profile

### Preparation

`npm run dev`. **Config** → **"New profile"** → **"Empty profile"**, name it `S09 Alias Test`,
create it, open it, and go to the **Aliases** tab.

### Steps and expected results

1. The tab opens on an empty list with the message **"No aliases to show"** (this profile has no
   user-defined aliases yet). Click **"New alias"**, type the name `helper`, click **"Create
   alias"**. **Expected:** the create dialog closes and an editor modal opens automatically for the
   new alias's body.
2. In the editor, type `say hello` into the raw-command field and press Enter (or click **"Add
   command"**), then click **Save**. **Expected:** the editor closes and the Aliases tab now lists
   one row, `helper`, badged **"User"**, with the byte length shown against the engine budget.
3. Click **"New alias"** again, name it `caller`, create it — the editor opens. In the raw-command
   field, start typing `helper`; a suggestion for the alias you just created appears in the
   dropdown (native browser autocomplete) — pick it (or just finish typing `helper` and press
   Enter). Click **Save**. **Expected:** the tab now lists two rows: `helper` and `caller`.
4. Expand `helper`'s row (click its name/chevron to expand the body). **Expected:** under
   **"Referenced by"** it now reads `entry "caller"` — not "Nothing references this alias" any
   more. Expand `caller`'s row: its own **"Referenced by"** line reads **"Nothing references this
   alias"**, shown as its own explicit, italicised state rather than a blank line.
5. Turn on the **"Unreferenced only"** switch. **Expected:** the list narrows to `caller` alone
   (the alias nothing calls); `helper` drops out of view since something references it. Turn the
   switch off again, type `help` into the **"Filter by name…"** field. **Expected:** the list
   narrows to `helper` only. Clear the filter, then click the A–Z/Z–A sort icon. **Expected:** the
   two rows swap order.
6. Turn on **"Show generated and layer aliases"**. If you have no keyed bind/message entries or alt
   layers in this profile yet, first go to **Controls**, add a category and one action with a key
   bound, or **Overview** → create an alt layer with a trigger key — then come back to Aliases with
   the toggle on. **Expected:** a read-only row appears for each, badged **"Generated"** or
   **"Layer"**, each naming its owner via a clickable **"Owner: …"** link — clicking it jumps to
   that entry on **Controls**, or to that layer's own row in **Overview**'s "Alt layers" panel.
   These rows show no edit/rename/delete icons at all.
7. Try to rename `helper` (click its pencil "Rename…" icon) while `caller` still references it, and
   submit a plain display-name change. **Expected:** the rename dialog refuses, naming `caller` as
   the referrer, and leaves `helper`'s alias name untouched. Set an **own alias name** field instead
   (if offered) rather than the display name, and submit — **Expected:** this time it goes through.
8. Click the trash-can **"Delete"** icon on `caller` (the unreferenced one). **Expected:** it
   deletes immediately, no confirmation dialog. Now try to delete `helper` (still referenced by
   nothing now that `caller` is gone — if `caller` still existed, deleting `helper` would instead
   open a confirmation dialog naming `caller`; recreate `caller` and re-add its `helper` call to see
   that path, then delete `helper`). **Expected when referenced:** a dialog titled `Delete
   "helper"?` names the referencing entry and requires clicking **"Delete alias"** to confirm;
   Cancel leaves both rows untouched.
9. Duplicate-name check: create a plain bind action on **Controls** whose own alias name (set via
   that entry's rename dialog) collides with an existing alias's name from the Aliases tab.
   **Expected:** back on the Aliases tab (with "Show generated and layer aliases" on, since the
   colliding entry is `origin: generated` or `user` depending on how it was made), both rows carry
   an inline **"Duplicate"** badge and a "Duplicate name — also used by: …" note — no name gets a
   silent suffix.
10. Go to the **Care** tab. If it lists an alias finding (e.g. **"Unreferenced aliases"** or
    **"Undefined alias references"**), click its **"Show in Aliases"** action. **Expected:** the
    Aliases tab opens with the named row scrolled into view and focused (or, for an undefined-alias
    finding that has no matching row, the tab's name filter is pre-filled with the searched name and
    shows "No matching aliases").
11. Paste a body with a dozen semicolon-worthy commands into one alias (add many raw commands via
    the **"Add command"** field, one per click) until the byte count shown on its row exceeds the
    printed budget. **Expected:** the length indicator turns into a warning (either "splits into N
    parts" or "over the line limit"), visible before you even save.

---

## Coverage note

| Story | Use case |
| --- | --- |
| 048 | 1 |
| 049 | 2 (gap noted: AC7's "no saved state" Discard-disabled path is not reachable through the UI in the current app) |
| 044 | 3 |
