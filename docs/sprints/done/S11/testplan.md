# Sprint S11 — manual acceptance test plan

Covers the four stories built in this sprint:

- **052** — Controls shows my categories, the template only seeds them
- **053** — Sub-categories come from the file, and Controls shows them
- **056** — Extra keys group under the primary row
- **055** — A `drop_` alias is a drop, with two toggles instead of two checkboxes

`ui-acceptance-required: true` is set for this project: every step below is something you click,
type or read in the running app. A terminal/text editor is used only to start the app and to
prepare two fixture files (cases 9 and the 055 import case) — writing/copying those files is
test-content preparation, not a launcher action. Opening the launcher's own rendered file in a
text editor (the Raw file checks) is how a real player would hand-edit a config; the launcher has
no built-in file editor to route that through instead.

No prior knowledge of the codebase is assumed. Every field/button name below is quoted exactly as
it appears in the app.

## Preparation (once)

1. From a terminal in the repository root: `npm install` (first time only), then `npm run dev`.
   The Electron window opens.
2. You need at least one Quake II installation already registered in the launcher (**Library** in
   the left navigation → **+ Add installation** or similar — existing functionality, not part of
   this sprint). Any installation works; note its `baseq2` folder's path on disk, used later for
   the two import cases.
3. Click the **Config** entry in the title bar's module row (wrench/sliders icon, labelled
   **Config**). You land on the profile list.

Keep this window open throughout; each story below creates its own profile(s) so the cases don't
interfere with each other.

---

## Story 052 — Controls shows my categories, the template only seeds them

### Case 1 — A profile from the standard template seeds exactly the three categories

**Steps**
1. Click **New profile**. In the **Create config profile** dialog: **Name** → `S11 Template`,
   **Start from** → **Standard template**, click **Create profile**.
2. The profile opens on **Overview**. Click the **Controls** tab.

**Expected result**
- The category rail shows exactly three chips, in this order: **Movement**, **Weapons**,
  **Weapon dropping**. No other category is present.
- Each chip carries its own **Move category up**, **Move category down**, **Rename…** and
  **Delete…** icon buttons — the same controls on every chip, none of them special.
- Movement's rows are unbound ("Empty" in the Key column) except the template's own handful of
  pre-bound rows.

### Case 2 — An empty profile seeds nothing, and offers the template

**Steps**
1. Back at the profile list (**Back to profiles**), click **New profile** → **Name** →
   `S11 Empty` → **Start from** → **Empty profile** → **Create profile**.
2. Click **Controls**.

**Expected result**
- The tab shows an empty state titled **"No categories yet"** with body text ending "...Add the
  standard template to start from Movement, Weapons and Weapon dropping, or create a blank one."
  and a button **"Add the standard template"**.
3. Click **"Add the standard template"**.

**Expected result (after click)**
- The same three categories (**Movement** / **Weapons** / **Weapon dropping**) appear, exactly as
  in Case 1.

### Case 3 — Rename, reorder, save, and the file follows

**Steps**
1. On **S11 Template → Controls**, click **Weapon dropping**'s **Rename…** icon. In the dialog,
   change **Name** to `Drops`, save.
2. Click **Drops**'s **Move category up** icon once (it moves above **Weapons**).
3. Click **Save** in the top bar.
4. Click the **Raw file** tab.

**Expected result**
- The category order in the rail is now **Movement**, **Drops**, **Weapons**.
- The raw file's section headers appear in that same order, and the section that used to read
  "Weapon dropping" now reads "Drops".

### Case 4 — The renamed, reordered structure survives a reload

**Steps**
1. Still on **S11 Template**, open the **Care** tab, find the **Sync** section, and use its
   rebuild-from-file / reload action for "This profile's file" (or simply close and reopen the
   profile from the profile list — either exercises a fresh read of the saved file).
2. Click **Controls**.

**Expected result**
- The rail still reads **Movement**, **Drops**, **Weapons**, and every row (including the still-
  unbound seeded ones) is still there.

### Case 5 — Deleting a category with entries offers move-or-delete, defaulting to move

**Steps**
1. On **S11 Template → Controls → Weapons**, click **Weapons**'s **Delete…** icon.

**Expected result**
- A dialog titled `Delete "Weapons"?` opens with two choices: **"Move its entries to another
  category"** (pre-selected/default) and **"Delete its entries with it"**, plus a **"Move entries
  to"** target picker when the move choice is active, and body text naming how many entries will
  move.
2. Leave the default (move) selected, pick **Movement** as the target, confirm with
   **"Delete category"**.

**Expected result (after confirm)**
- **Weapons** is gone from the rail. Its rows now appear inside **Movement**.

### Case 6 — Importing a single-section foreign config creates only that category

**Preparation**
1. Locate the `baseq2` folder of your registered installation. **Back up any existing
   `config.cfg` you care about** — this overwrites it.
2. Create/overwrite `baseq2/config.cfg` with:
   ```
   bind x "say hello"
   ```
3. Save the file.

**Steps**
1. Profile list → **New profile** → **Start from** → **Import from installation** → **Continue**.
2. **Installation** → your installation. **Game directory** → `baseq2` (pre-selected). Wait for
   the preview.
3. **Name** → `S11 Import Plain` → **Create profile**.
4. Click **Controls**.

**Expected result**
- Exactly one category is present (the importer's own "Imported"/guessed category name) — no
  **Movement**, **Weapons** or **Weapon dropping** anywhere.

---

## Story 053 — Sub-categories come from the file, and Controls shows them

### Case 7 — The template seeds real sub-categories

**Steps**
1. On **S11 Template → Controls**, click **Weapons**. (If you completed Case 5's move, its rows
   are now grouped under **Movement** instead — either way, look at whichever category holds the
   former Weapons rows.)

**Expected result**
- The rows are grouped under two headers, **Use weapon** and **Cycling**, each showing its rows
  beneath it, in that order.
2. Click **Drops** (or **Weapon dropping** if you skipped Case 3's rename).

**Expected result**
- Rows are grouped under three headers: **Weapons**, **Ammunition**, **Misc**.

### Case 8 — Create a sub-category, move a row into it, reorder, delete

**Steps**
1. On **S11 Template → Controls → Movement**, click **"New sub-category"**. Name it `Custom moves`,
   click **Create sub-category**.
2. Pick any ungrouped row in Movement, click its **Edit commands…** icon to open the action
   editor. Find the **"Sub-category"** field, change it from **"No sub-category"** to
   **`Custom moves`**, click **Save**.
3. Click **Save** in the top bar.

**Expected result**
- The row now appears under a **Custom moves** header instead of in the ungrouped run at the top.
4. On the **Custom moves** header, click **"Move sub-category up"** — it moves above another
   sub-category if one exists (skip if Movement has none yet from the template).
5. Reopen the row's action editor, set **Sub-category** back to **"No sub-category"**, save.

**Expected result**
- The row returns to the ungrouped run at the top of Movement.
6. On the **Custom moves** header, click **"Delete sub-category"**.

**Expected result**
- **Custom moves** disappears from the grid; any entries still filed under it (there should be
  none left after step 5) would reappear as ungrouped rows in the parent category, not be deleted.

### Case 9 — The structure survives Save and reload

**Steps**
1. Repeat Case 3's rename/reorder on a sub-category header instead of a category (rename e.g.
   **Ammunition** to `Ammo`, move it above **Weapons` in **Drops**), **Save**.
2. Reload the profile as in Case 4.

**Expected result**
- The renamed, reordered sub-category headers are still there after reload.

### Case 10 — Importing a two-level foreign file produces real sub-categories

**Preparation**
1. Copy `docs/fixtures/dm.cfg` from the repository to your installation's `baseq2` folder as
   `config.cfg` (backing up any existing one first, as in Case 6).

**Steps**
1. Profile list → **New profile** → **Start from** → **Import from installation** → **Continue**.
2. **Installation** → your installation, **Game directory** → `baseq2`, wait for preview.
3. **Name** → `S11 Import DM` → **Create profile**.
4. Click **Controls** and look through the category rail for the section that came from the
   file's `.: Upper Row :.`-style header (its category name will read close to "Upper Row").

**Expected result**
- That category shows sub-category headers matching the file's `##### 1st Block #####`-style
  markers (something like "1st Block", "2nd Block", …) with their bind rows beneath — not a single
  category literally named "Upper Row / 1st Block".

---

## Story 056 — Extra keys group under the primary row

### Case 11 — Grid has one Key column

**Steps**
1. On any profile's **Controls** tab, look at the grid header row.

**Expected result**
- The header reads **Action / Key / Options** — no "Primary" and no "Secondary" anywhere on
  screen.

### Case 12 — Add a second key: no chevron yet

**Steps**
1. Pick any row with a key (e.g. Movement's **Forward**, bound to a key). In its Key cell, click
   the small **`+`** affordance.
2. Press a free key, e.g. `Y`.

**Expected result**
- The new key appears as one indented line directly beneath the row — no chevron, no "+n" badge
  (exactly one extra key is always shown).

### Case 13 — A third key folds behind a chevron

**Steps**
1. On the same row's last sub-row, click its **`+`** affordance, press another free key, e.g. `U`.

**Expected result**
- The sub-rows collapse behind a chevron on the main row reading **"+2"**, collapsed by default
  (its accessible name reads "Show 2 more keys for…").
2. Click the chevron.

**Expected result**
- Both extra-key sub-rows expand, each with its own key cap, a clear button, and — on the last one
  — the `+` add affordance. The chevron's accessible name now reads "Hide 2 more keys for…".
3. Switch to another category tab and back to this one.

**Expected result**
- The group is still expanded (fold state is kept for the session).

### Case 14 — Clearing the primary key promotes the next one

**Steps**
1. With the group still expanded from Case 13, click the primary key's clear button (the `Y`
   slot).

**Expected result**
- The Key column now shows `Y`'s successor (`U`) as the primary key, promoted from the extra
  slots. Only whatever key was third remains as a single extra (no chevron, since only one extra
  is left).
2. Clear the remaining sub-row's key.

**Expected result**
- Only the primary key remains; no sub-rows, no chevron.

### Case 15 — Collision, modifier and Options-cell checks generalise to every slot

**Steps**
1. Bind the same key to two different rows so a collision is triggered on a sub-row (e.g. add key
   `U` again on a second row's `+` while `U` is already used elsewhere) — the Cancel/Replace
   prompt should appear under the row.
2. On a sub-row, hold **Alt** while capturing a key.

**Expected result**
- The Cancel/Replace prompt behaves as it did for the old Primary/Secondary columns.
- The Alt-held key shows its modifier cap on that sub-row, and the layer name it triggers appears
  in the row's **Options** cell — not only for slot 1.
3. Check the grid's footer.

**Expected result**
- The footer's "n rows · m bound" count includes a row whose only bound key is an extra (third)
  slot.

---

## Story 055 — A `drop_` alias is a drop, with two toggles

### Case 16 — The template's own drop rows show the toggles

**Steps**
1. On **S11 Template → Controls → Drops** (or **Weapon dropping**), find any row under the
   **Weapons** sub-header, e.g. Railgun.

**Expected result**
- Its **Options** cell shows two small icon buttons (a package icon and a speech-bubble icon), not
  two text checkboxes. Hovering each shows a tooltip: "Drop ammo too" / "Announce to team".
2. Click the ammo icon.

**Expected result**
- It shows a pressed (filled/bordered) state, `aria-pressed="true"` — verify via a screen reader
  or the browser/devtools accessibility panel if available; visually the icon gets a filled
  background and border, not just a colour change.
3. Click the message icon.

**Expected result**
- An inline message row appears beneath, with an **"Edit message"** link/button (story 029's
  existing editor). Click it, type some text, save — the toggle stays on and shows the message.
4. Tab to both icons with the keyboard, press Space/Enter on each.

**Expected result**
- Both toggle via keyboard, with a visible focus ring throughout.

### Case 17 — Ammo toggle is disabled with an explaining tooltip when the item has no ammo

**Steps**
1. On the template's **Drops → Misc** group, find the row for the Tech item (renders as
   `drop_tech`'s display name).

**Expected result**
- Its ammo icon is visibly dimmed and its tooltip explains the item has no ammo of its own to
  drop; clicking it does nothing, but it stays focusable (Tab still reaches it) and still shows
  the tooltip on hover/focus.

### Case 18 — Raw file shows the `drop_` alias name

**Steps**
1. On **S11 Template**, save any pending changes, click **Raw file**, search for `drop_`.

**Expected result**
- The touched drop row's alias line reads `alias drop_<something> "..."`.

### Case 19 — Importing sixteen drops recognises all of them, and leaves `dall` a plain alias

**Preparation**
1. Copy `docs/fixtures/dmalias.cfg` from the repository to your installation's `baseq2` folder as
   `config.cfg` (back up any existing one first).

**Steps**
1. Profile list → **New profile** → **Start from** → **Import from installation** → **Continue**.
2. **Installation** → your installation, **Game directory** → `baseq2`, wait for preview.
3. **Name** → `S11 Import Drops` → **Create profile**.
4. Click **Controls** and look through whatever category the importer filed the aliases into.

**Expected result**
- All sixteen `drop_*` entries (`drop_shotgun`, `drop_sshotgun`, `drop_machine`, `drop_chain`,
  `drop_grenadel`, `drop_rocketl`, `drop_hyperb`, `drop_rail`, `drop_powers`, `drop_tech`,
  `drop_shells`, `drop_bullets`, `drop_grens`, `drop_rocks`, `drop_cells`, `drop_slugs`) show the
  two icon toggles in their Options cell, wherever the importer's guess put them.
- The `dall` entry shows no toggles — it stays a plain alias row (its name does not start with
  `drop_`).
5. On `drop_shotgun`, click the ammo toggle off, then on. Save. **Raw file** tab → search
  `drop_shotgun`.

**Expected result**
- The `wave 1` and `say_team` parts of `drop_shotgun`'s body are still present, untouched by the
  toggle round-trip.
6. Click the **Aliases** tab, find `drop_shotgun`'s row.

**Expected result**
- The same two toggles appear in its action cluster there, and toggling from Aliases changes the
  same rendered body as toggling from Controls.

---

## Known, accepted residuals (do not chase these as bugs)

- **052**: a category you create and save without ever adding anything to it will not survive a
  rebuild-from-file/re-import (disclosed in the story's own Done section, F6) — the file has no
  marker for a category with zero entries. Add at least one action before relying on a category
  surviving a full reload.
- **053**: an empty sub-category's banner is currently written into every block section a category
  could have (cosmetic-only extra lines in the raw file), and two sub-categories sharing the same
  id (unreachable via the UI) would write their rows twice — neither is data loss.
- **056**: `ActionEditor`/`MessageEditor` briefly read a row's raw slot 0 rather than the compacted
  view Controls shows if the row carries a leftover raw blank from a Replace-release elsewhere; it
  self-heals on the next Controls-side edit. Not reachable through an ordinary sequence of clicks.
- **055**: the Aliases tab has no persistent "Edit message" affordance for revising a drop's
  message text without first clearing it — only Controls (or the Raw file tab) offers that.

## UI-path coverage / gaps found while writing this plan

- **052 migration criterion** ("a profile that existed before this update keeps showing its three
  built-in categories after the update") could not be exercised as a fresh manual step: it needs a
  config profile that was created and saved *before* this sprint's schema change, which a tester
  starting the app for the first time on this build does not have. This is not a UI-acceptance
  workaround gap — there is no console-based substitute offered instead — it is a precondition gap:
  anyone who already has an S10-or-earlier profile in their launcher's saved state can verify it by
  simply opening that profile's Controls tab after upgrading and confirming nothing disappeared;
  a fresh install has nothing to migrate.
- Every other acceptance criterion in 052, 053, 056 and 055 was reachable and testable through the
  real running UI above — no console command, direct IPC call, or other workaround was needed.
