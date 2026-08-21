# Sprint S05 — Manual test plan

Covers the four stories shipped in this sprint: **022** (a profile is a real `<name>.cfg` file),
**023** (Raw File absorbs Write targets), **024** (Quake II config syntax highlighting) and **025**
(Validation becomes Care). Every step below is a real action in the running app — a text editor or
Windows Explorer is used only to prepare disk content (a hand-written `.cfg`, a file rename, a
read-only flag), exactly the way the stories' own acceptance sections use it, never as a substitute
for clicking something in the launcher.

## Preparation

1. `npm install` (first time only), then `npm run dev` to start the app.
2. You need at least one registered installation:
   - **Preferred, if you have a real Quake II install** (an r1q2/Q2PRO/etc. folder with `baseq2`,
     `pak0.pak` and a client executable): Library → **Add existing** → pick the folder that
     *contains* `baseq2` (not `baseq2` itself). A real, launchable installation is also required
     for use case 6 below (the "pending" sync state).
   - **Otherwise**: Library → **Create new** → Browse to any empty folder → give it a name → leave
     **Client** on its default → **Create installation**. This registers an empty installation
     (it will show "game files missing", which is expected and does not block anything below — the
     Config module never checks for `pak0.pak`). Everything except use case 6 works with this.
3. Click **Config** in the top navigation bar. This is where every other step happens.

No seeded fixture data is used — every profile, bind, layer and cvar below is created live through
the UI. The only outside-the-app step, used a few times, is hand-writing a small `.cfg` file or
renaming/flagging one in Windows Explorer, to put realistic disk content in place before importing
or observing it through the UI.

---

## Story 022 — a profile is a real file

### 1. A new profile has a file immediately, unassigned

- Config → **New profile** → leave "Start from" on **Empty profile**, name it `My Config` →
  **Create profile**. The app navigates straight into it, on the **Overview** tab.
- Open the **Raw file** tab.
- **Expected:** "This profile's file" shows a path ending in `My-Config.cfg`, a green **On disk**
  badge, and the file's content below it (at least the generated header comment) — with no
  installation assigned at all. Click **Reveal in folder** to confirm the file really exists on
  disk.

### 2. Renaming a profile renames its file; colliding names don't overwrite each other

- On `My Config`'s detail screen, click the pencil icon (**Rename…**) → type `Frag Setup` →
  **Save**.
- Raw file tab → **Expected:** the path now ends in `Frag-Setup.cfg`.
- Config → back to the profile list → **New profile** → name it `frag/setup` (a name that
  sanitises to the same base as `Frag Setup`) → **Create profile**.
- **Expected:** its Raw file tab shows a path such as `frag-setup-2.cfg` — a different file from
  `Frag-Setup.cfg`. Open both in an editor (**Open in editor**) and confirm their contents are
  independent (e.g. their names/binds differ).

### 3. Assigning + editing writes to the installation automatically

- On `Frag Setup`, click the **"0 of N assigned"** button next to the back arrow → tick your
  installation → close the popover (click elsewhere).
- Go to **Settings**, change any cvar (e.g. type a new value into **Mouse sensitivity**), wait
  for the header to read **Saved**.
- Go to **Raw file** (or **Care** → **Sync**).
- **Expected:** a row now exists for that installation, with an **In sync** badge and a path
  under `<install>/baseq2/Frag-Setup.cfg`. **Reveal in folder** on that row shows the file next to
  `autoexec.cfg`; open `autoexec.cfg` in a text editor and confirm it contains `exec Frag-Setup.cfg`.

### 4. Old id-based files migrate instead of being left behind

- On the installation row from step 3, expand the row's content or open the file in an editor and
  read its **first line** — it reads `// q2-launcher profile <id> - generated, do not edit`. Note
  that `<id>`.
- In Windows Explorer, rename that installation's `Frag-Setup.cfg` to
  `q2l-profile-<id>.cfg` (the id you just read).
- Back in the app, go to **Settings** and change the cvar again (any value) to trigger a write.
- Return to **Raw file**.
- **Expected:** `Frag-Setup.cfg` exists again (not `q2l-profile-<id>.cfg` — check with **Reveal in
  folder**, only one file is there) and `autoexec.cfg` still points at `Frag-Setup.cfg`.

### 5. A write failure surfaces as an error and can be retried

- In Windows Explorer, right-click the installation's `baseq2` folder → **Properties** → tick
  **Read-only** → **OK** (apply to all contents if prompted).
- In the app, change the cvar again in **Settings**.
- Go to **Care** tab → **Sync** section.
- **Expected:** the installation's row shows a red **Failed** badge with a reason line underneath,
  and a **Retry** button.
- In Explorer, remove the **Read-only** flag from `baseq2` again.
- Click **Retry** on that row.
- **Expected:** the row turns to a green **In sync** badge.

### 6. A running installation defers instead of failing (requires a real, launchable installation)

- Only possible with the "real Quake II install" option from Preparation step 2 — an empty
  "Create new" installation has no executable to launch.
- In **Library**, click **Play** on that installation and leave the game running.
- In the app, change a cvar on a profile assigned to it, in **Settings**.
- Go to **Care** → **Sync**.
- **Expected:** that row shows a neutral **Pending** badge (not **Failed**) while the game is
  running. Close the game, click **Retry** → the row turns **In sync**.
- **Gap:** if no real, launchable Quake II installation is available in your test environment,
  this specific "pending" state cannot be produced through the UI at all — it is covered instead by
  the automated test suite (`sync.test.ts`).

---

## Story 023 — Raw File absorbs Write targets

### 7. The "Write targets" tab is gone

- Open any profile's detail screen.
- **Expected:** the tab bar reads **Overview / Settings / Controls / Raw file / Care** — no
  "Write targets" tab and no separate "Assignments" tab (assignment now lives behind the
  "N of M assigned" button next to the back arrow, used in use case 3).

### 8. Open in editor / Reveal in folder, disabled with a reason when absent

- On a profile's **Raw file** tab, with the profile's own file present, click **Open in editor**
  next to "This profile's file" — **Expected:** your OS's default editor for `.cfg` opens that
  file. Click **Reveal in folder** — **Expected:** its folder opens with the file selected.
- Pick a profile that is **not** assigned anywhere (or unassign one) and reopen its Raw file tab.
- **Expected:** the profile's own file section still renders (path + content), even with zero
  installation rows below it — "no installation" is not treated as "nothing to show".

### 9. Per-installation rows: present, absent, differs

- On an assigned profile's Raw file tab, **Reveal in folder** on the installation row, then delete
  that `.cfg` file in Explorer.
- Switch to another tab and back to Raw file (this re-reads).
- **Expected:** the row reads **"Not on disk"**, with a "not written to this installation yet" note,
  and both **Open in editor** and **Reveal in folder** are visibly disabled.
- Go to **Settings**, touch a cvar to trigger a rewrite → the row goes back to **In sync**.
- Now open that file in a text editor (outside the app) and add a line, save, then switch tabs and
  back.
- **Expected:** the row now reads **"Differs from this profile"**.

### 10. Played mods selection survives leaving the tab

- On an installation row that has at least one non-`baseq2` folder (create one manually in
  Explorer inside that installation's root if needed, e.g. `ctf`), tick one of the **Played mods**
  checkboxes.
- Leave the profile (back to the list) and come back into it, Raw file tab.
- **Expected:** the checkbox is still ticked.

### 11. Expanding a row shows the rendered files read-only

- On any installation row, click the chevron to expand it.
- **Expected:** the rendered config files for that installation appear read-only below the row
  (this is the same viewer used in story 024's use cases below).

---

## Story 024 — Quake II config syntax highlighting

### 12. Highlighted rendering with line numbers

- Open any profile's **Raw file** tab.
- **Expected:** line numbers down the left; the first line (the generated `// q2-launcher
  profile...` header) renders dim and in italics; `set`/`bind` lines render their command word in a
  different, semibold weight, with the key/cvar name, the quoted value and any `+`-prefixed command
  each in their own colour.

### 13. Selecting and copying yields byte-identical text

- In that same view, click into the text, select the whole block (Ctrl+A inside it, or click-drag),
  copy (Ctrl+C).
- Paste into a plain text editor.
- **Expected:** exactly the file's text — no line numbers, nothing reformatted or trimmed.

### 14. High-ASCII glyphs render unchanged

- Controls tab → pick a category → **Add action** → name it `Taunt`, Entry kind **Message** →
  **Create action**.
- Click its **Edit commands…** icon → in **Message text**, use the **Symbols** picker (or toggle
  **Alternate charset**) to insert a special glyph → **Press a key…** to bind it to a free key →
  save/close.
- Go to **Raw file** and find that bind's line.
- **Expected:** the glyph renders as-is (not mangled or replaced), and the rest of the line still
  highlights normally.

### 15. A garbled/unrecognised line degrades to plain text without breaking neighbours

- In Explorer, hand-write a small file at `<installation>/baseq2/config.cfg`, e.g.:
  ```
  set sensitivity "5"
  frobnicate this is not a real directive $$$
  bind w +forward
  ```
- Config → **New profile** → "Start from" **Import from installation** → **Continue** → pick that
  installation, then that gamedir → **Create profile**.
- Open the new profile's **Raw file** tab.
- **Expected:** the `set`/`bind` lines highlight normally, and the `frobnicate...` line renders as
  plain, uncoloured text — the lines around it are unaffected.

### 16. Find-in-file

- On any Raw file view with a few lines, type part of a key name (e.g. a letter you know is bound)
  into the search box in the viewer's header.
- **Expected:** a match count reads "n of m", matches are marked, and the current one is visually
  distinct and scrolled into view. Press **Enter**/**Shift+Enter** to step forward/back, wrapping
  at the ends. Type something that doesn't exist — count reads **0**, nothing marked, no crash.
  Press **Escape** — the query and marks clear. Copy the block again — still byte-identical.

### 17. Large file: no stutter, no wrap

- (Optional, more setup) In a text editor, build a `.cfg` with a few hundred `bind` lines (copy a
  line and paste-multiply it, or use any real large personal Quake II config if you have one),
  import it as in use case 15, and open its Raw file tab.
- **Expected:** scrolling is smooth, the line-number gutter stays aligned with the text, and a
  deliberately long line scrolls horizontally instead of wrapping.

### 18. One highlighted renderer in every surface that shows config text

- On the import dialog from use case 15, before clicking **Create profile**, look at the
  **Preserved lines** list in the preview — **Expected:** each entry is shown through the same
  highlighted single-line renderer (not plain text).
- Expand an installation row on **Raw file** (use case 11) — **Expected:** the same highlighted,
  gutter'd viewer, not a plain grey block.

---

## Story 025 — Validation becomes Care

### 19. The tab is "Care", the report is unchanged and stays live against unsaved edits

- Open a profile assigned to an installation → its tab bar shows **Care** (not "Validation"), and
  there is no separate "Preserved lines" tab.
- Inside Care, note the current validation report (top section, per-engine).
- Go to **Settings**, set **Render FPS cap** (`r_maxfps`) to `0`, then immediately go back to
  **Care** (before waiting for "Saved").
- **Expected:** the report already reflects the new value's warning/caution note — it updates
  against the live edit, not only after a save completes.

### 20. Sync section: five states with retry

- Reuses use cases 3 (in sync), 5 (failed + retry) and 6 (pending) above — all rendered in **Care**
  → **Sync**, not a separate tab. Additionally: unassign every installation from a profile and
  confirm its own row still shows there with a status, per the profile-file-first ordering (own file
  row, then one per assignment).

### 21. Tidy-up: a shadowed bind, detected, previewed and fixed

- Controls tab → click **New category** → name it `Test`, **Create category** → make sure `Test`
  is the selected chip. **Add action** → name `Claim A`, Entry kind **Bind** → **Create action**.
  Click its **Edit commands…** icon → **Press a key…** → press, say, `F6` → save/close.
- **Add action** again → name `Claim B`, Entry kind **Bind** → **Create action** → **Edit
  commands…** → **Press a key…** → press `F6` again (the same key) → save/close.
- Go to **Care** → **Tidy-up**.
- **Expected:** a **Shadowed binds** group lists an item for `F6`, tagged **Auto**. Expand it — the
  preview shows a "Before"/"After" for the losing claim. Click **Apply**.
- **Expected:** only the shadowed claim is removed; back in Controls, one of `Claim A`/`Claim B` no
  longer shows that key bound.

### 22. Tidy-up: an empty layer (auto) and an unreferenced alias (review)

- Overview tab → Layers panel → **New layer** → name it `Unused`, leave the mode as-is →
  **Create layer**. Do not bind anything on its board.
- Controls tab → on the `Test` category from use case 21 (or any other), **Add action** → name
  `Ghost Alias`, Entry kind **Alias** → **Create action** → give it any command via **Edit
  commands…**'s **Add a raw command** field (e.g. `echo hi` → **Add**) → save. Never reference
  `Ghost Alias` from anywhere else.
- Go to **Care** → **Tidy-up**.
- **Expected:** an **Empty layers** entry for `Unused`, tagged **Auto**; an **Unreferenced
  aliases** entry for `Ghost Alias`, tagged **Review** (not Auto).

### 23. Tidy-up: a binding to a nonexistent alias is report-only

- Controls tab → on the `Test` category, **Add action** → name `Broken Ref`, Entry kind **Bind** →
  **Create action** → **Edit commands…** → in the **Add a raw command** field type
  `+nosuchalias` → **Add** → **Press a key…** → bind it to a free key → save.
- Go to **Care** → **Tidy-up**.
- **Expected:** an **Undefined alias references** entry names `Broken Ref` and `+nosuchalias`,
  with no Apply button of any kind — its message is the whole explanation.

### 24. Tidy-up: preserved lines offer Drop and Re-classify

- Reuse the profile imported in use case 15 (with the `frobnicate...` and the `set
  sensitivity "5"`-style unrecognised line, or write a fresh file with a line like
  `seta cl_oddcvar "1"` to also see a re-classify-as-cvar suggestion).
- Care tab → the **Preserved lines** section (folded into Care, no longer its own tab) lists each
  line with a preview.
- **Expected:** each offers **Drop** and, where the launcher can guess a cvar/bind reading,
  **Re-classify** — each with its own before/after preview before you click either.

### 25. Fix all safe findings — explicit warning before anything changes

- On the profile from use case 22 (its **Unused** empty layer is still there, unapplied, tagged
  **Auto**), repeat use case 21's two-actions-same-key trick with a fresh key (e.g. `F7`, on two new
  Bind actions) to add a second **Auto** finding, without applying it individually this time.
- Go to **Care** → **Tidy-up** — **Expected:** the header button now reads
  **Fix all safe findings (2)**. Click it.
- **Expected:** a modal lists every operation it is about to run, grouped by kind, above a warning
  sentence stating this applies in one step. Click **Cancel** — nothing changes.
- Click **Fix all safe findings (2)** again → **Apply all**.
- **Expected:** both are cleared in one step; the button's count drops to 0 and it becomes disabled
  with a "nothing classified safe" note.

### 26. Cleanup moved into Care, scoped to the profile

- Still in **Care**, scroll to the **Redundant config copies** section (previously on the profile
  list screen — confirm it is *not* there any more).
- **Expected:** the installation picker only offers this profile's assigned installations, with a
  hint pointing at the **Scan any installation** checkbox to widen it.
- Pick an installation, click **Scan**. If there are no redundant copies to demonstrate apply/undo,
  create one first: in Explorer, copy that installation's `baseq2/<profile>.cfg` byte-for-byte into
  a mod folder under the same installation (e.g. `ctf/<profile>.cfg`), then Scan again.
- **Expected:** the copy is listed, pre-selected (identical content). Click **Remove selected** →
  confirm **Remove** in the dialog → **Expected:** a "removed" count and an **Undo removal**
  button. Click it → **Expected:** a "Restored." badge and the file is back, byte-for-byte.

### 27. "All clear" vs. "not checked yet" are visibly different

- Create a fresh profile (Config → **New profile** → **Empty profile**, e.g. `Clean Profile`) and
  leave its cvars/binds untouched — no shadowed binds, empty layers, unreferenced/undefined aliases
  or preserved lines are possible on a profile nobody has edited. Assign it to your installation
  (use case 3's assignment step) so its sync section has something to report other than "missing".
- Go to its **Care** tab and run the cleanup **Scan** on that installation once (use case 26's
  **Scan** button — it is fine if it finds nothing to remove).
- **Expected:** the summary panel at the top of Care reads an explicit **"All clear — nothing to
  report and nothing to clean."**
- Quit and restart the app (`npm run dev` again), reopen that same profile's Care tab without
  scanning cleanup again.
- **Expected:** the summary no longer says "All clear" — the **Cleanup** line reads **"Not checked
  yet"**, and the overall line reads its explicit "not all clear yet" wording instead of silently
  looking the same as before.

---

## Coverage and gaps

All 27 use cases above exercise every acceptance criterion of stories 022–025 through real UI
actions, except one named gap:

- **Story 022, use case 6 (the "pending" sync state while an installation is running):** this can
  only be produced by actually launching a real, playable Quake II installation via the app's own
  **Play** button. If your test environment has no installation with real game files and a working
  executable, this specific state is not reachable through the UI at all and is covered only by the
  automated suite (`src/main/modules/config/sync.test.ts`). Every other state (in sync, out of
  sync, missing, failed + retry) is fully UI-testable and covered above.
