# Sprint S08 — Manual acceptance test plan

Covers the four stories built this sprint: **046** (no `unsafe-inline` in the production CSP),
**047** (the message editor and two dialogs join `ui:verify`'s screen registry), **042** (a
launcher-written profile file round-trips losslessly through `[q2l …]` metadata tags), **043** (the
`.cfg` file becomes the source of truth, `state.json` becomes a cache).

General setup, once, before any of the four use cases:

- This repo has no built-in fixture seeding for a hand-run `npm run dev` session (that only exists
  for the `ui:verify` harness). At least one Quake II installation must already be registered in the
  launcher (Library tab → "Add an installation") before use cases 3 and 4, since both need a real
  installation to sync a profile's file to disk.
- The app has no custom menu bar (`autoHideMenuBar: true`, frameless window) and no code in this repo
  disables Electron's default DevTools shortcut, so **F12** or **Ctrl+Shift+I** opens Chromium
  DevTools in any run mode.
- Only `en` ships; every label quoted below is the literal English UI text.

---

## Use case 1 — 046: the production build has no CSP violation on style-heavy screens

### Preparation

1. `npm run build` (production renderer output — 046 changed the **production** `style-src`, dev
   mode intentionally still allows inline styles for Fast Refresh).
2. `npm start` (runs `electron-vite preview`, i.e. the built app under the production CSP).

### Steps

1. Press **F12** (or **Ctrl+Shift+I**) to open DevTools, switch to the **Console** tab, and clear it.
2. With the console open and visible, exercise the surfaces that compute inline styles at runtime:
   - **Downloads / progress**: trigger anything that shows a progress bar (its width is a dynamic
     inline style) and watch it fill.
   - **Config → a profile → Controls tab → Overview**: hover/interact with the keyboard overview
     panel — it scales/zooms an element via inline style.
   - **Any popover**: open the profile detail screen's "N of M assigned" button (the link icon next
     to Rename/Delete) — its panel is positioned at the pointer via inline `left`/`top`.
   - **Shell chrome**: resize the window, open the titlebar/installation-rail menus, trigger a toast.
3. Keep watching the Console the entire time.

### Expected result

- No `Refused to apply inline style because it violates the following Content Security Policy
  directive: "style-src 'self'"` message (or any CSP violation) appears in the Console at any point.
- Every surface above still looks and moves exactly as before: the progress bar fills smoothly, the
  keyboard overview zooms, popovers open anchored at the pointer (not snapped to the top-left
  corner), and the titlebar/rail/toasts keep their normal size and position.

---

## Use case 2 — 047: the message editor renders correctly (structural/visual check)

This story's acceptance is mostly automated (`ui:verify`'s axe pass over two new screen-registry
entries: the drop-row message editor and the Team-messages editor). There is nothing a manual
run *sees differently* from before — the point of this check is simply to confirm the surface a
human would look at during a real edit is well-formed and behaves, since that is what the automated
pass now also covers.

### Preparation

`npm run dev`. Open **Config**, open or create a profile, go to its **Controls** tab.

### Steps — drop-row message editor (story 029's surface, the one 047 newly covers)

1. Click the **"Weapon dropping"** category chip in the category rail.
2. Find any drop row (e.g. a weapon) and tick its **"With message"** checkbox.
3. An inline row appears below it with a placeholder ("No message set yet") and an **"Edit
   message"** button — click that button.

### Expected result

- A modal titled `Edit message "<row's label>"` opens, with:
  - A **Channel** field (select: "Everyone (say)" / "Team (say_team)").
  - A **Message text** field with a visible label — clicking the label text focuses the input (this
    is exactly the label/`useId()` association 047 fixed).
  - A **Preview** area below it.
  - "Insert a location variable" and "Insert a server macro" macro-button rows, a "Suggested
    messages" row, and a symbol picker.
  - **No** key-capture section (drop rows own their key through the grid's bind slots, not this
    modal) — confirms `showKeyCapture={false}` for this entry point.
- Click **Save** in the footer — the modal closes and the placeholder text is replaced by the typed
  message.

### Steps — Team-messages editor (the other invocation, key capture shown)

4. Find a "Team messages"-style action of kind Message elsewhere in Controls (its row has an
   **"Edit commands…"** icon, or whatever the entry's own edit trigger is) and open it.

### Expected result

- The same modal opens, but this time **with** a key-capture section at the bottom ("Key", "Press a
  key…" / a bound key badge, "Clear"), since this invocation path passes `showKeyCapture={true}`.

---

## Use case 3 — 042: a profile file round-trips losslessly through its metadata tags

### Preparation

`npm run dev`. At least one installation registered (see General setup).

### Steps

1. **Config** → "New profile" → create an empty profile, e.g. named `Round-trip test`.
2. In the new profile's detail screen, click the **"N of M assigned"** button (link icon, top
   right) and tick the registered installation, so this profile has somewhere to sync to.
3. **Controls tab**: click **"New category"** in the category rail, name it `My Extras`. Its chip
   appears in the rail.
4. Select the `My Extras` chip, click **"Add action"**, name it `Test Bind` — a plain bind row
   appears.
5. Click the row's **pencil ("Rename…")** icon and rename it to `Test Bind Renamed`.
6. Click the row's **Primary** bind slot and press a key (e.g. `G`) to bind it; click the
   **Secondary** slot, hold a modifier (Alt/Ctrl/Shift) and press a different key, so the entry
   carries two slots with two different modifiers.
7. Go to the **Overview** tab. Under **"Alt layers"**, click **"New layer"**, name it `Alt Layer`,
   mode **Hold**, submit.
8. On the keyboard overview above it, click an unused key, then in the dialog's **"Layer trigger"**
   section pick `Alt Layer` under "Layer to trigger" and click **"Assign trigger"**.
9. **Settings tab**: change any one cvar's value.
10. Back at the detail screen's top, the **Save** bar shows an **"Unsaved changes"** badge with an
    enabled **Save** button — click **Save**. The badge switches to **"Saved"**.
11. **Raw File tab**: read the rendered file in the code viewer.
12. Switch **"Section header style"** through **Dashes** → **Brackets** → **Plain** — the panel
    re-renders each time with no manual refresh.
13. Create a second profile: "New profile" → **"Import from installation"** → pick the same
    installation and the same game folder the profile was assigned to.
14. On the preview step, look for the restore banner; fill in a name and click **"Create profile"**.
15. On the newly created profile, check Controls and Settings against the original.
16. **Foreign-import regression**: outside the launcher, copy `docs/fixtures/dm.cfg` into the
    installation's `baseq2` folder as `autoexec.cfg`, and copy `docs/fixtures/dmalias.cfg` and
    `docs/fixtures/gfx.cfg` alongside it unchanged. In the launcher, "New profile" → "Import from
    installation" → the same installation → game folder `baseq2`.

### Expected result

- Step 11: every `bind`/`alias` line in the code viewer ends in a trailing comment of the form
  `// <display name> [q2l …]`; the category section banner for `My Extras` and the layer section
  banner for `Alt Layer` each carry a `[q2l cat=…]` / `[q2l layer=… mode=… trigger=…]` tag; the very
  top of the file carries a version marker (`[q2l v=…]`) — and the header text no longer says
  "generated, do not edit" (043's wording change, visible here too).
- Step 12: the banner decoration changes (dashes / `[ … ]` brackets / bare title) each time, but the
  `[q2l …]` tags and the alignment of values stay identical.
- Step 14: because this file was written by the launcher itself, the preview reads as **restoring**
  a launcher profile (names `Round-trip test`) and says a **new** profile is created — not that the
  original is overwritten or merged into. There is **no** "alias needs a decision" review step (that
  only applies to foreign, best-effort imports).
- Step 15: the new profile's Controls tab shows the `My Extras` category with `Test Bind Renamed`
  bound to the same two key slots and the same two modifiers; the `Alt Layer` layer exists with
  **Hold** mode and the same trigger key; Settings shows the same changed cvar value. Both profiles
  (`Round-trip test` and the imported one) exist side by side in the profile list — the original was
  not touched.
- Step 16: this file carries no `[q2l …]` metadata at all, so the preview reads as an ordinary
  best-effort import (cvar/bind/alias/message counts, no restore banner), and — because `dm.cfg`
  binds `RIGHTARROW` to `exec dmalias.cfg` — an "alias needs a decision" review step appears for that
  ambiguous alias, exactly as it did before this sprint's stories touched the import path.

---

## Use case 4 — 043: the `.cfg` file is the source of truth

### Preparation

Use the `Round-trip test` profile from use case 3 (already assigned to an installation and saved
once, so its file exists on disk) — or any other saved, assigned profile. `npm run dev`.

### Steps and expected results

1. **Unsaved-changes lifecycle.** Settings tab → change a cvar value. The Save bar immediately shows
   the **"Unsaved changes"** badge (pencil icon) with **Save** enabled; the wording notes the file on
   disk has not been updated yet. Click **Save** — the badge switches to **"Saved"** (check icon)
   and the button disables again.
2. **Survives a restart.** Change another cvar, do **not** press Save, close the app entirely, run
   `npm run dev` again, reopen the same profile. The edited value and the **"Unsaved changes"** badge
   are both still there (the edit lived in the cache, not lost by quitting).
3. **External edit is detected, not silently overwritten.** With the launcher open on this profile,
   go to **Raw File tab**, click the canonical row's **"Open in editor"** button — its `.cfg` opens
   in Notepad. Change a cvar's value and edit a trailing comment, save in Notepad, then click back
   into the launcher window (or switch Config tabs). A toast reading "This profile's file changed on
   disk and was reloaded." appears, and Settings/Controls now show the Notepad-edited value.
4. **Conflict — take the file.** In the launcher, change a cvar in Settings but do **not** save.
   Switch to Notepad, edit the same file's value differently, save it there. Back in the launcher,
   press **Save**. A dialog titled **"The file changed on disk"** opens with two side-by-side panes,
   **"On disk"** and **"Your unsaved changes"**. Click **"Take the file"** — the dialog closes and
   the UI now shows the Notepad version; nothing was written from the launcher's side.
5. **Conflict — overwrite with my version.** Repeat step 4's setup (UI edit unsaved, then a
   different Notepad edit saved), press Save, and this time click **"Overwrite with my version"** —
   the dialog closes and the file on disk (reopen it in Notepad, or use "Reveal in folder") now shows
   the launcher's value, not the Notepad one.
6. **Unparseable file.** Open the file in Notepad, delete a closing quote in the middle of a line,
   save, click back into the launcher. A persistent (non-toast) banner appears naming the file and
   line the parse failed on; the profile's tabs remain fully usable, showing the last good cached
   state.
7. **Missing file.** Delete the profile's `.cfg` outside the launcher (File Explorer), click back
   into the launcher. A banner reading **"This profile's file is missing"** appears with
   **"Rewrite from cache"** and **"Remove profile…"** buttons. Click **"Rewrite from cache"** — the
   file reappears on disk and the banner clears. Delete the file again and click
   **"Remove profile…"** — confirm in the delete dialog — the profile disappears from the list.
8. **Care tab.** On a profile whose canonical file was changed externally (repeat step 3's edit but
   don't click back into the launcher until you're on the Care tab), the sync row for "This profile's
   file" reads **"Changed outside the launcher"** with **Reload** and **Compare** buttons — Compare
   opens the same two-pane dialog as step 4/5. On a profile with unsaved UI edits instead, that same
   row reads **"Unsaved changes"** with no action button (Save lives on the tabs above, not here).
   Separately, hand-edit one of the **installation** copies (not the canonical file, e.g. via "Open
   in editor" on an installation row lower in Raw File tab) — its Care row still reports
   **"Out of sync"** with a working **Retry**, unchanged from before this story.

---

## Coverage note

| Story | Use case |
| --- | --- |
| 046 | 1 |
| 047 | 2 |
| 042 | 3 |
| 043 | 4 |
