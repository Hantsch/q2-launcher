# Sprint S13 — manual acceptance test plan

Covers the two stories built in this sprint ("Order by hand, Care gets out of the way"):

- **054** — Order everything by drag and drop
- **058** — Care says only what needs doing

`ui-acceptance-required: true` is set for this project: every step below is something you click,
drag, type or read in the running app. A terminal is used only to start the app; a text editor/
file manager outside the app is used only to prepare test-content files (copying a fixture `.cfg`
into an installation's folder, or — in two disclosed cases — to genuinely hand-edit/hand-copy a
file the way something outside the launcher would, never as a substitute for a UI action).

No prior knowledge of the codebase is assumed. Every field/button/tooltip name below is quoted
exactly as it appears in the app (`src/renderer/src/i18n/locales/en.json`).

## Preparation (once)

1. From a terminal in the repository root: `npm install` (first time only, requires Node 22+),
   then `npm run dev`. The Electron window opens.
2. You need at least one Quake II installation already registered in the launcher (**Library** in
   the left navigation → add one if you don't have one — existing functionality, not part of this
   sprint). Note its `baseq2` folder's path on disk; two cases below copy a fixture file into it.
3. Click **Config** in the title bar's module row. You land on the profile list.

Keep this window open throughout; each case creates its own profile so cases don't interfere.

---

## Story 054 — Order everything by drag and drop

### Case 1 — Every row shows a grip, and the row can be dragged to a new position

**Steps**
1. Click **New profile** → **Name** → `S13 Controls` → **Start from** → **Standard template** →
   **Create profile**.
2. Click the **Controls** tab. Three category chips are visible: **Movement**, **Weapons**,
   **Weapon dropping**.
3. Hover any row in the grid.

**Expected result**
- A drag grip (a small vertical-dots handle) appears at the left edge of the row on hover/focus;
  the row is still the same height as before hovering (no layout jump) and the zebra striping is
  unchanged.

**Steps (continued)**
4. Press and hold the grip on a row that is at least two rows from the top of its sub-category,
   drag it upward past one other row, and release.

**Expected result**
- The row is now at its new position. The save bar at the top of the profile shows an unsaved
  change. Click **Discard** — the row returns to its original position and the save bar goes
  quiet again.

### Case 2 — Drag a row into a different sub-category, then reopen the profile

**Steps**
1. Still on **S13 Controls → Controls**, find a category that has more than one sub-category
   group (their names appear as small headers above each run of rows inside a category — try
   **Movement**, which the standard template splits into more than one group).
2. Drag a row from one sub-category's run and drop it among the rows of the other sub-category
   in the same category.
3. Click **Save** in the save bar.
4. Click **Back to profiles**, then reopen **S13 Controls** → **Controls**.

**Expected result**
- The row is still under the sub-category you dropped it into — the move persisted through save
  and reload.

### Case 3 — Drag a row onto another category's chip

**Steps**
1. On **S13 Controls → Controls**, with **Movement** selected, drag any row's grip up to the
   **Weapons** chip in the rail above the grid and release directly on the chip (not in the grid
   area).

**Expected result**
- The row disappears from **Movement**'s grid.
2. Click the **Weapons** chip.

**Expected result**
- The row you dragged is now the last row in **Weapons**.

### Case 4 — Spring-loaded switch: drag, hover a foreign chip, drop at an exact position there

**Steps**
1. On **Movement**, press and hold a row's grip and start dragging it toward the **Weapon
   dropping** chip in the rail.
2. Keep hovering the chip (without releasing the mouse button) for about a second.

**Expected result**
- The grid underneath switches to show **Weapon dropping**'s rows while you are still dragging.
3. Move the row (still held) to a position between two of **Weapon dropping**'s rows and release.

**Expected result**
- The row lands at that exact position inside **Weapon dropping**, not merely appended at the end.
- Click the **Movement** chip again — the row is no longer there.

### Case 5 — Escape mid-drag cancels cleanly

**Steps**
1. On any category, press and hold a row's grip and start dragging it.
2. While still dragging (button held or, for a mouse drag, immediately after picking it up),
   press **Escape**.

**Expected result**
- The row returns to its original position. The save bar shows no unsaved change.

### Case 6 — Sub-category headers and category chips reorder by drag; Raw file follows

**Steps**
1. On a category with two or more sub-category groups (e.g. **Movement**), drag the second
   sub-category's header up above the first one's.
2. In the rail, drag the **Weapons** chip to the front, ahead of **Movement**.
3. Click **Save**, then click the **Raw file** tab.

**Expected result**
- The sub-category's new order and the category order are both reflected in the order the file's
  section banners/lines appear in the code view.

### Case 7 — Keyboard path: grip + Space/arrows, and the row's kebab menu

**Steps**
1. On **Controls**, click into empty space to clear focus, then press **Tab** repeatedly until a
   row's grip is focused (a focus ring appears on it).
2. Press **Space** to pick the row up, press the **Up arrow** twice, then press **Space** again to
   drop it.

**Expected result**
- The row moved up two positions, the same as a mouse drag would have.
3. Tab to that row's ordering menu (the "⋮" kebab button in the row's action cluster;
   its tooltip/accessible name reads "Ordering options for "<row's name>""). Press **Enter**
   or **Space** to open it.

**Expected result**
- A menu opens with **Move up**, **Move down** and **Move to…**.
4. Choose **Move to…**, pick a different category in the dialog's **Move to** dropdown, and click
   **Move**.

**Expected result**
- The row is now in the category you picked (check by clicking that category's chip).

### Case 8 — Filtering disables the grip, but the kebab menu keeps working

**Steps**
1. On **Controls**, type a few characters into the **"Filter actions…"** box so it narrows the
   list to fewer rows.
2. Hover a visible row's grip.

**Expected result**
- The grip is greyed out; hovering it shows the tooltip **"Clear the filter to reorder by
  dragging"**.
3. Open that row's kebab menu and choose **Move up** (or **Move down**, whichever is enabled).

**Expected result**
- The row moves — the menu's ordering commands still work while the grip is disabled.

### Case 9 — Category chips keep their move-up/move-down buttons as a keyboard path

**Steps**
1. Clear the filter box. In the rail, look at a category chip's icon buttons.

**Expected result**
- Each chip (besides its grip) still carries its own up/down arrow icon buttons ("Move category
  up"/"Move category down") next to **Rename…**/**Delete…**, unchanged from before this sprint.
2. Click one chip's move-left-in-order arrow button.

**Expected result**
- The chip's position in the rail changes without needing to drag.

### Case 10 — Settings: drag a cvar into another section, drag a section, drag a sub-section

**Steps**
1. Click **Back to profiles**, open **S13 Controls** (or any saved profile) → **Settings**. Four
   section headers are visible: **Player**, **Network**, **Graphics**, **Sound**.
2. Hover a cvar row in **Player** — a grip appears at its left edge, and each section/sub-section
   header shows its own grip too.
3. Drag a cvar row from **Player** and drop it among **Network**'s rows.
4. Drag the **Graphics** section header up above **Network**.
5. On **Player**, click the folder-plus **"New sub-section"** icon, name it `Custom`, confirm —
   then drag one of **Player**'s remaining rows onto the new **Custom** sub-header's row run.
6. Click **Save**, then click **Raw file**.

**Expected result**
- All three moves (the cvar into Network, the section reorder, the cvar into Custom) are reflected
  in the order and grouping of the rendered file's section banners and `set` lines.

### Case 11 — Settings drag is disabled while filtered, "Unsaved only" is on, or Advanced is collapsed

**Steps**
1. On **Settings**, type text into the filter box, or switch on **"Unsaved only"**.
2. Hover any visible cvar row's grip.

**Expected result**
- The grip is disabled with the tooltip **"Clear the filter, turn off Unsaved only, and expand
  Advanced to reorder by dragging"**.
3. Clear the filter and switch **"Unsaved only"** back off. If a section shows a **"Show N more…"**
   (Advanced) toggle, leave it collapsed and hover a row that is currently hidden behind it — you
   cannot, since it is not rendered; instead hover a visible row in that same section.

**Expected result**
- That section's own rows also show the disabled grip with the same tooltip, until you click
  **"Show N more…"** to expand Advanced — after which the grip becomes draggable for that
  section's rows.
4. Existing keyboard paths are unaffected: use the **"Move to…"**/**"Move "<cvar>"…"** icon next to
   a row, or a section's/sub-section's own move-up/move-down icon buttons, to reorder without
   dragging at any point in this case.

---

## Story 058 — Care says only what needs doing

### Case 12 — A healthy, assigned, in-sync profile shows one calm block

**Steps**
1. Click **New profile** → **Name** → `S13 Care Healthy` → **Start from** → **Standard template**
   → **Create profile**.
2. On **Overview**, under **"Assigned installations"**, tick your registered installation so the
   profile is assigned to it.
3. Click **Save** in the save bar (writes the file so the Files check has something in sync to
   report).
4. Click the **Care** tab.

**Expected result**
- Exactly one panel is shown, headed by a check icon and reading **"All clear — nothing to do on
  this profile."**, followed by one line per checked thing: something like "Validated against
  <engine>.", "1 file in sync.", "Nothing to tidy up." There is no other section header, no
  illustration, no disabled button anywhere on the tab.

### Case 13 — A key-bind conflict becomes a one-row Tidy-up item; fixing it returns to All clear

**Steps**
1. On **S13 Care Healthy → Controls**, open **Movement** (or any category), and bind the same key
   (e.g. `W`) on two different rows — click a bind slot, press `W`, confirm taking it if a
   conflict prompt appears while binding the second row.
2. Click **Save**, then click **Care**.

**Expected result**
- The All clear block is gone. A single **"Config health"** or the finding may instead appear
  under **"Tidy-up"** as one row reading roughly **"“W” is claimed more than once"**, with a
  one-sentence consequence ("...the others are written to the config file and do nothing.") and an
  **Apply** action. No other group is shown besides this one row (and, if present, a "Config
  health" validation line for the same engines as before).
3. Click **Apply** on that row.

**Expected result**
- The row disappears and the **All clear** block from Case 12 reappears (its "files in sync" and
  engine lines may differ slightly since you saved again, but the block itself returns).

### Case 14 — "Show in Controls" jumps to the winning row

**Steps**
1. Repeat step 1 of Case 13 on a fresh profile (or undo the Apply from Case 13 by re-creating the
   conflict): bind the same key on two rows, save, open **Care**.
2. On the shadowed-bind row, click **"Show in Controls"**.

**Expected result**
- The app switches to the **Controls** tab with the winning row focused/highlighted.

### Case 15 — Preserved lines appear exactly once, with Drop and Re-classify

**Preparation**
1. Copy `docs/fixtures/dmalias.cfg` from the repository into your installation's `baseq2` folder,
   naming the copy `config.cfg` (back up any existing `config.cfg` you care about first).

**Steps**
1. Profile list → **New profile** → **Start from** → **Import from installation** → **Installation**
   → yours, **Game directory** → `baseq2` (wait for the preview) → **Name** → `S13 Care Import` →
   **Create profile**.
2. Click **Care**.

**Expected result**
- Under **Tidy-up**, one row per line the importer could not classify (the file's `echo "..."`
  banner lines at its top are a good example) — each row's text includes that line's own content
  (e.g. part of `echo "------------------- DM Alias -------------------"`), and each such row
  offers both **Drop** and **Re-classify**. That text does not appear a second time anywhere else
  in the tab (no separate "preserved lines" panel exists any more).
3. Click **Drop** on exactly one such row.

**Expected result**
- Only that row disappears; the others (and the rest of the profile) are unaffected.

### Case 16 — "Fix all safe findings" only appears when something is safe to fix

**Steps**
1. Still on **S13 Care Import → Care**, look for a **"Fix all safe findings (N)"** button near the
   **Tidy-up** heading.

**Expected result**
- It is present (this profile has at least one safe/auto-fixable finding, e.g. the unreferenced
  or duplicate aliases the file's own alias block seeds).
2. Go back to **S13 Care Healthy**'s **Care** tab (its All clear state from Case 12, or after
   re-applying Case 13's fix).

**Expected result**
- No **"Fix all safe findings"** control is present at all on a clean profile — not shown
  disabled, simply absent.

### Case 17 — Files: only files that need attention are listed

**Steps**
1. On **S13 Care Healthy** (assigned + saved, from Case 12), close the launcher.
2. Outside the app, delete that installation's copy of the profile's `.cfg` file from its `baseq2`
   folder (the same file you saved in Case 12 step 3).
3. Start the launcher again (`npm run dev`), open **Config** → **S13 Care Healthy** → **Care**.

**Expected result**
- A **Files** group appears with exactly one row for that installation, reading something like
  "<installation name>: Missing", with **Open** and **Reveal** actions. If you have more than one
  installation assigned and in sync, they are not listed as rows — they are folded into the
  **All clear**-style count instead (which will no longer show since this profile is not fully
  clear any more).
4. Click **Reveal** on the row.

**Expected result**
- Your OS file explorer opens at the installation's `baseq2` folder.

### Case 18 — An unassigned profile explicitly says so, and never claims "All clear"

**Steps**
1. Click **New profile** → **Name** → `S13 Care Unassigned` → **Start from** → **Standard
   template** → **Create profile**. Do not tick any installation under **"Assigned
   installations"**.
2. Click **Care**.

**Expected result**
- Under **"Config health"**, a line explicitly states there is nothing to validate against (an
  unassigned-profile message) — the tab does **not** show the "All clear" block, even though there
  are no findings.

### Case 19 — The redundant-copies cleanup is an action on the installation in Library, not in Care

**Preparation**
1. In your installation's folder, create a subfolder that Quake II would treat as a mod directory
   (e.g. `xatrix` or any folder name that is not `baseq2`), and copy the exact same `config.cfg`
   your `baseq2` folder has into that new mod folder too (a byte-for-byte duplicate).

**Steps**
1. Click **Library** in the left navigation. Find your installation's row.

**Expected result**
- The row has an icon button whose tooltip reads **"Clean up redundant config copies…"**, next to
  **Rename…**.
2. Click it.

**Expected result**
- A dialog opens, titled to name the cleanup and mentioning your installation's name, with a
  **Scan** button — no installation picker, no "scan any installation" control (the row you opened
  it from is already the scope).
3. Click **Scan**.

**Expected result**
- The duplicate file you created shows up as a finding, pre-checked (it is byte-identical to the
  `baseq2` copy).
4. Click **Remove selected**, confirm on the **"Remove redundant copies"** dialog by clicking
   **Remove**.

**Expected result**
- A result line reports the file removed, with an **"Undo removal"** button.
5. Click **Undo removal**.

**Expected result**
- A **"Restored."** badge appears; check on disk (or re-scan) that the duplicate file is back,
  byte-for-byte.
6. Close the dialog. Open any profile assigned to this installation → **Care**.

**Expected result**
- Nothing on the Care tab mentions a cleanup scan, a "not checked yet" status, or any cleanup
  control at all — the whole flow lives only in Library now.

---

## Known, accepted residuals (do not chase these as bugs)

- **054**: a cross-category move by drag has no keyboard-only equivalent that mirrors the
  spring-load gesture exactly — the kebab menu's **"Move to…"** (Case 7) is the deliberate keyboard
  substitute, not a like-for-like keyboard drag.
- **054**: dropping a cvar onto a reserved **Defaults**/**Other** bucket in Settings is a silent
  no-op (no "not allowed" feedback) — documented behaviour, not a bug.
- **058**: `care-fix-item`'s own scripted flow (dev-only, not part of this plan) notes that Plain
  Profile carries other pre-existing findings that this plan's fresh profiles do not — not
  something a manual tester following this document needs to worry about.

## UI-path coverage / gaps found while writing this plan

- **054's CSP/no-injected-`<style>` acceptance criterion** (that dnd-kit's runtime styling stays
  within the existing `style-src 'self'` policy) is a build/runtime property checked by
  `npm run build` and the renderer-source test suite, not something a user can observe by clicking
  through the app — there is no UI path for it, so it is out of scope for this plan rather than
  worked around with a console call standing in for a UI step.
- **054's "grip keeps the dragged row's 40px height, no layout jump" and "auto-scroll near grid
  edges"** are visual properties confirmed by eye in Cases 1–4 above; no numeric measurement tool
  is exposed in the UI, so "no layout jump" is judged by looking, same as the rest of this plan's
  visual checks.
- **058's Files "canonical, dirty" case** — a canonical file marked out-of-sync while the profile
  itself has unsaved structured changes offers no **Reload** action (reloading would discard those
  edits) — this is reachable by making an unsaved Settings/Controls change, then deleting the
  canonical file's sibling install copy, but is not written up as its own numbered case since
  Case 17 already exercises the same row shape without the extra unsaved-edit precondition.
- Every other acceptance criterion in 054 and 058 was reachable and testable through the real
  running UI above — no console command, direct IPC/`module:invoke` call, or other workaround was
  needed. The only outside-the-app steps are file-system preparation (copying a fixture file,
  deleting/duplicating a file on disk) exactly as accepted in prior sprints' plans (e.g. S12's
  Cases 3 and 17), never a substitute for a UI action itself.
