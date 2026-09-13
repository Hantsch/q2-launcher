# Sprint S12 — manual acceptance test plan

Covers the three stories built in this sprint ("The file is the hero"):

- **051** — The file header is a small banner, not a technical block
- **059** — Settings mirrors the file's own cvar sections
- **057** — Raw file is an editor first, and I can edit inline

`ui-acceptance-required: true` is set for this project: every step below is something you click,
type or read in the running app. A terminal is used only to start the app; a text editor/file
manager outside the app is used only to prepare test-content files (copying `docs/fixtures/dm.cfg`
into an installation's folder) or, in one 057 case, to genuinely hand-edit the file the way an
external tool would — never as a substitute for a UI action.

No prior knowledge of the codebase is assumed. Every field/button name below is quoted exactly as
it appears in the app.

## Preparation (once)

1. From a terminal in the repository root: `npm install` (first time only, requires Node 22+), then
   `npm run dev`. The Electron window opens.
2. You need at least one Quake II installation already registered in the launcher (**Library** in
   the left navigation → add one if you don't have one — existing functionality, not part of this
   sprint). Note its `baseq2` folder's path on disk; it is used for the 059 import case.
3. Click the **Config** entry in the title bar's module row. You land on the profile list.

Keep this window open throughout; each case below creates its own profile so the cases don't
interfere with each other.

---

## Story 051 — The file header is a small banner, not a technical block

### Case 1 — A saved profile's file starts with a 4-line name-card banner

**Steps**
1. Click **New profile**. **Name** → `S12 Header`, **Start from** → **Standard template**,
   **Create profile**.
2. The profile opens on **Overview**. Click **Save** in the save bar (even with no edits, this
   guarantees the file is on disk).
3. Click the **Raw file** tab.

**Expected result**
- The very first lines of the code view read, in order:
  - a full-width line of `=` characters (a `//` comment rule),
  - `//  S12 Header` (the profile's own name, the only prose in the block),
  - another full-width `=` rule,
  - one more comment line, right-aligned, reading `[q2l v=1 id=<some id>]`.
- Nowhere else in the file does that id (the long value after `id=`) appear again, and nothing in
  the header reads "hand-edited", "metadata", "version" or "generated" — the name is the only
  sentence.
- All four of those lines render in the same comment colour/style as every other `//` comment in
  the file (open the file's syntax highlighting by eye — no line looks like an error or an
  unrecognised/orange-flagged line).

### Case 2 — Renaming only changes the name line

**Steps**
1. On **S12 Header**, click the pencil **Rename…** icon next to the profile name, change it to
   `S12 Header Renamed`, save the rename.
2. Click **Save** in the save bar, then look at the **Raw file** tab again.

**Expected result**
- Only the second header line changed, to `//  S12 Header Renamed`. The two `=` rules and the
  `[q2l v=1 id=…]` line are pixel-for-pixel/character-for-character the same as in Case 1 — same
  id.

### Case 3 — A legacy-shaped header is still recognised and gets rewritten

This is the one case in this plan where you edit a file outside the app on purpose, the way a
pre-update install's file would already look on a real user's disk — there is no UI affordance to
create a legacy-shaped file from inside the launcher, so this is a genuine gap noted below rather
than a workaround.

**Preparation**
1. Close the launcher (or leave it running — the file watcher/guard is what's being tested either
   way, so leaving it running is closer to a real scenario).
2. Open **S12 Header Renamed**'s `.cfg` file (path shown in the Raw file tab's path row from
   Case 2) in a plain text editor. Replace its first four lines with the OLD five-line shape:
   ```
   // q2-launcher profile <the id from Case 1/2> - hand-edited changes are read back
   // =============================================================================
   //  S12 Header Renamed [q2l v=1]
   //  Q2 Launcher - hand-edited changes to this file are read back
   // =============================================================================
   ```
   (Use the exact id from Case 1/2 so the file still identifies as the same profile.) Save the
   file in the text editor.
3. If the launcher was left running, switch back to it; otherwise start it again with `npm run
   dev` and open **Config**.

**Expected result**
- **S12 Header Renamed** is still listed, still assigned to the same installation(s) as before —
  it is not treated as a foreign/unrecognised file.
- Open it and go to **Raw file**: the on-disk badge and content show the legacy 5-line block you
  just wrote (the tab always shows exactly what's on disk).
4. Click **Save** in the save bar (or make and save a trivial edit if Save is disabled with nothing
   dirty — e.g. toggle **"Start the file with `unbindall`"** off then on again, saving each time).

**Expected result**
- The file now starts with the new 4-line banner shape again (Case 1's shape), carrying the same
  id and name.

---

## Story 059 — Settings mirrors the file's own cvar sections

### Case 4 — A template profile seeds four named sections

**Steps**
1. Click **New profile** → **Name** → `S12 Settings` → **Start from** → **Standard template** →
   **Create profile**.
2. Click the **Settings** tab.

**Expected result**
- Four section headers are visible, in order: **Player**, **Network**, **Graphics**, **Sound**,
  each with its own cvar rows and its own "N cvars, M unsaved"-style count.
- Each section header carries icon buttons: **Add cvar**, **New sub-category**/sub-section, move
  up, move down, **Rename…**, **Delete…**.

### Case 5 — Rename a section, reorder it, and it survives a reload

**Steps**
1. Click **Graphics**'s **Rename…** icon (pencil), change the name to `Optik`, confirm.
2. Click **Optik**'s "move up" icon once — it moves above **Network**.
3. Click **Save** in the save bar.
4. Go back to the profile list (**Back to profiles**) and reopen **S12 Settings** → **Settings**.

**Expected result**
- The order now reads **Player**, **Optik**, **Network**, **Sound**, and it is still in that order
  after the reload — name and order both persisted.

### Case 6 — A sub-section groups cvars, and deleting it un-groups them

**Steps**
1. On the **Player** section header, click the folder-plus **"New sub-section"** icon, name it
   `Custom`, confirm.
2. On one of Player's rows, use its **"Move to…"** icon (the arrows icon next to each row) and
   pick **Custom** as the target.
3. Click **Save**.

**Expected result**
- The row now sits under a **Custom** sub-header inside **Player**, instead of in Player's
  top-level run.
4. On the **Custom** sub-header, click its **Delete…**/trash icon.

**Expected result**
- **Custom** disappears; the row that was inside it is now back in Player's ungrouped run — its
  value is unchanged, nothing was lost.

### Case 7 — Deleting a whole section keeps its cvars

**Steps**
1. On **S12 Settings → Settings**, click **Sound**'s trash **Delete…** icon.

**Expected result**
- **Sound** disappears from the section list. Every cvar it held now shows up under the section
  above it (**Network**, given Case 5's reorder) — none of them vanished, only their placement
  moved.

### Case 8 — Import `dm.cfg` and every one of its 25 cvars gets a row

**Preparation**
1. Locate your registered installation's `baseq2` folder. Back up any existing `config.cfg` you
   care about.
2. Copy `docs/fixtures/dm.cfg` from the repository into that `baseq2` folder, renaming the copy to
   `config.cfg`.

**Steps**
1. Profile list → **New profile** → **Start from** → **Import from installation** → continue
   through the dialog: **Installation** → yours, **Game directory** → `baseq2` (wait for the
   preview), **Name** → `S12 Import DM`, **Create profile**.
2. Click **Settings**.

**Expected result**
- One section is present named close to **"General Settings"** (the file's own `.: General
  Settings :.` banner text), holding all 25 of the file's `set` lines: `name`, `skin`, `crosshair`,
  `hand`, `cl_blend`, `cl_vwep`, `freelook`, `in_mouse`, `in_joystick`, `m_pitch`,
  `allow_download_maps`, `allow_download_sounds`, `allow_download_models`,
  `allow_download_players`, `allow_download`, `sky`, `adr0`–`adr8`, `hostname`, `m_filter`.
- Catalogue cvars among them (e.g. `crosshair`, `hand`, `cl_vwep`, `m_pitch`, `sky`, `freelook`)
  show the normal rich row (a real control, not a bare text box).
- Non-catalogue cvars (e.g. `hostname`, the `adr0`–`adr8` block, the `allow_download_*` names,
  `m_filter`) each show a plain row: their name, a plain text value box, and no engine facts/no
  control widget — but every one of them has a row; none is hidden.

### Case 9 — "Write unset catalogue defaults" toggle shows/hides the Defaults bucket

**Steps**
1. Still on **S12 Import DM → Settings**, look at the header row's rightmost switch: **"Write
   unset catalogue defaults"**.
2. Note whether a **Defaults** section is currently showing (it appears only when the switch is
   on) — an imported profile with `writeCatalogDefaults` defaulted on should show one, holding
   catalogue cvars the file itself never set.
3. Click the switch to turn it off.

**Expected result**
- The **Defaults** section disappears from Settings.
4. Click the **Raw file** tab, and look for a section banner named `Defaults` in the code.

**Expected result**
- No `Defaults` banner/lines are present in the raw file either.
5. Go back to **Settings**, switch **"Write unset catalogue defaults"** back on.

**Expected result**
- **Defaults** reappears in Settings and (after a **Save**) in the Raw file tab. Reload the profile
  (back to the list and back in): the switch kept the state you last set it to.

### Case 10 — Add a cvar by name (catalogue vs. non-catalogue), then remove it

**Steps**
1. On any section (e.g. **Network**), click its **Add cvar** (+) icon.
2. In the dialog, type `cl_maxfps` in the name field (a suggestion list should appear as you type;
   you can click the suggestion or just finish typing the exact name), type any number as the
   value, click **Add cvar**.

**Expected result**
- A new row for `cl_maxfps` appears in that section with the normal rich control (a real
  slider/number-style row, not a plain text box).
3. Click **Add cvar** again, this time type `zz_test_cvar`, value `1`, confirm.

**Expected result**
- A new plain row for `zz_test_cvar` appears (name + plain text value, no facts).
4. On the `zz_test_cvar` row, click its trash **Remove** icon.

**Expected result**
- The row is gone from Settings. Click **Save**, then **Raw file**, search for `zz_test_cvar` — it
  is not in the file at all.

### Case 11 — Filter and "Unsaved only" keep the counts honest

**Steps**
1. On **S12 Import DM → Settings**, type `adr` into the filter box in the header row.
2. Switch on **"Unsaved only"**.

**Expected result**
- The header count and each visible section's own count read something like "N cvars, M unsaved ·
  K shown", and "K shown" always matches the number of rows actually visible under that filter —
  never a number the rows on screen disagree with.
3. Clear the filter, switch **"Unsaved only"** back off, and expand a section's **"Show N more"**
   (Advanced) toggle if one is present.

**Expected result**
- Non-catalogue (plain) rows stay visible whether or not Advanced is expanded — they are never
  hidden behind it.

---

## Story 057 — Raw file is an editor first, and I can edit inline

### Case 12 — The code view fills the tab

**Steps**
1. Resize the launcher window to 1280×800 (or as close as your OS lets you get, and check by eye
   if you can't set it exactly). Open **S12 Header Renamed** (or any saved profile) → **Raw file**.
2. Count the visible lines of code without scrolling the page itself (only the code area's own
   scrollbar, if any, may be present).

**Expected result**
- At least 30 lines of code are visible. The page around the code view does not scroll; only the
  code view itself would, if the file were longer than the visible area.
- The chrome above the code is compact: one line with the file's path, an **On disk** badge, an
  **Open in editor** icon and a **Reveal in folder** icon; one more line with the **"Start the file
  with `unbindall`"** checkbox and the **Section header style** dropdown. Hover each — the
  explanation appears as a tooltip, not as a paragraph of text. Nowhere in the tab is there a list
  of per-installation cards or a "Played mods" block.

### Case 13 — Typing in the code view, indenting, undo/redo

**Steps**
1. Still on **Raw file**, click inside the code, place the cursor on a `set` line and change its
   value (e.g. change a number).
2. Select a couple of lines and press **Tab**, then **Shift+Tab**.
3. Press **Ctrl+Z** a few times, then **Ctrl+Y** (or **Ctrl+Shift+Z**).

**Expected result**
- Highlighting (colours) follow your typing live; line numbers stay aligned with the text the whole
  time.
- Tab indents the selected lines, Shift+Tab un-indents them.
- Undo/redo step back and forward through your typing and the indent changes.

### Case 14 — An edit shows as "file text edited", Ctrl+S saves it, and the read-back is shown

**Steps**
1. With your edit from Case 13 still in the editor (undo back to having exactly one small, valid
   change — e.g. one `set` value changed), look at the save bar at the top of the profile screen.

**Expected result**
- The save bar reads **"file text edited"** as its one changed item (not the usual per-field change
  list).
2. Press **Ctrl+S** while focus is inside the code editor.

**Expected result**
- The file saves. Underneath the toolbar row, a panel appears naming how many lines "aren't
  modeled by the launcher and were kept as-is" (0, if your edit was a plain `set` value change) and
  any dropped-alias warning (none expected here).
3. Click **Open in editor** to open the file in your OS's default text editor and confirm the value
   you typed is exactly what's on disk (byte for byte, including your indentation choices).

### Case 15 — Discard throws the edit away

**Steps**
1. Back in the launcher, on **Raw file**, type another change into the code (e.g. change the same
   value again).
2. Click **Discard** in the save bar (not Save).

**Expected result**
- The edit disappears immediately (no confirmation dialog for a raw discard) and the code view
  shows the previously-saved text again. Open the file in the OS editor again to confirm the file
  on disk is unchanged from Case 14's save.

### Case 16 — Mutual exclusion: raw edit blocks the structured tabs, and vice versa

**Steps**
1. On **Raw file**, type an unsaved change into the code (don't save or discard yet).
2. Click the **Settings** tab (or **Controls**, or **Aliases**).

**Expected result**
- The tab's content is not clickable/operable, and a one-line message explains that the file text
  has unsaved edits and must be saved or discarded on the Raw file tab first. The **"Start the file
  with `unbindall`"** checkbox, the section-header-style dropdown, and the profile's **Rename…**
  button on this same screen also show the same explanation (as a tooltip) and are disabled while
  the draft is open.
3. Go back to **Raw file** and either **Save** or **Discard** the pending edit.
4. Go to **Settings**, change any cvar's value (a structured, non-raw edit) — do not save it.
5. Go to **Raw file**.

**Expected result**
- The code view is read-only (you cannot type into it) and a one-line hint explains that the
  profile's unsaved changes must be saved or discarded first.
6. Go back to **Settings**, **Save** (or **Discard**) that pending value change.
7. Return to **Raw file** — it is editable again.

### Case 17 — A save conflict opens the two-pane dialog, and Overwrite writes your typed text

**Steps**
1. On **Raw file**, type an edit into the code (don't save yet).
2. Without saving in the launcher, open the same `.cfg` file in an OS text editor and change a
   different line there, then save it from that external editor.
3. Back in the launcher, with your unsaved edit still in the code view, press **Ctrl+S** (or click
   **Save**).

**Expected result**
- A dialog titled **"Config file changed"** (or similar) opens, showing two panes side by side:
  **"On disk"** (the external editor's version) and **"Your edits"** (what you typed).
4. Click **"Overwrite with my version"**.

**Expected result**
- The dialog closes; the file on disk now contains exactly what you had typed in the launcher (the
  external editor's change is gone). Re-open the file externally to confirm.

---

## Known, accepted residuals (do not chase these as bugs)

- **051**: a hand-edit that deletes just the tag line (leaving the two `=` rules and the name) is
  read back with those remaining lines listed as unrecognised/preserved rather than being repaired
  — documented behaviour, not a bug, and not exercised as a numbered case above since it only
  matters after a hand-edit, same category as Case 3.
- **059**: no drag-and-drop for moving a cvar between sections in this build (the story explicitly
  defers that to a later story); the **"Move to…"** dialog used in Case 6 is today's only
  mechanism.
- **059**: removing a *catalogue* cvar from a section only unplaces it (it can resurface under
  **Defaults** if the toggle is on) — only a non-catalogue cvar's "Remove" deletes its value
  outright, as exercised in Case 10.
- **057**: navigating back to the profile list (or deleting the profile) while a raw draft is open
  silently discards it with no confirmation — not covered by any case above since it is a
  documented, deliberately out-of-scope gap from the story's own Done notes.
- **057**: the raw editor's find bar (Ctrl+F) reuses the existing search UI and was not given its
  own numbered case here — it is unchanged from the read-only code view's existing search, already
  covered by earlier sprints' plans.

## UI-path coverage / gaps found while writing this plan

- **059 migration criterion** ("a pre-existing profile migrates once: catalogue cvars into the four
  default sections, the rest into Other, no value lost") could not be exercised as a fresh manual
  step: it requires a profile that was created and saved *before* this sprint's schema change, which
  a tester starting on this build from scratch does not have. This is a precondition gap, not a
  UI-acceptance workaround — there is no console-based substitute offered instead. Anyone with an
  S11-or-earlier profile already in their launcher's saved state can verify it directly by opening
  that profile's Settings tab after upgrading and confirming every cvar still has a value and a
  row, catalogue ones in the four named sections and the rest under **Other**.
- **051 old-shape compatibility** (Case 3) required a genuine outside-the-app file edit because
  there is no UI affordance that produces a legacy-shaped header — noted inline above rather than
  substituted with any console/IPC call.
- **057 external-edit conflict** (Case 17) required a genuine outside-the-app file edit for the same
  reason — the launcher has no built-in way to simulate "someone else changed this file," so a real
  external editor is the only honest way to trigger the conflict guard, exactly as the story's own
  manual test plan does.
- Every other acceptance criterion in 051, 059 and 057 was reachable and testable through the real
  running UI above — no console command, direct IPC call, or other workaround was needed.
