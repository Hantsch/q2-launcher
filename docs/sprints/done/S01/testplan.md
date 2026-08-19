# Sprint S01 — Manual Test Plan (Config module foundation)

Consolidated, self-contained acceptance walkthrough for stories 001–005
(`docs/requirements/done/001-config-module-scaffold.md` through
`done/005-import-existing-config.md`). Run the use cases below in order — each one builds on state
(profiles, assignments, files on disk) left behind by the previous one, the same way the
sprint's own story order was 001 → 002 → 003 → 004 → 005.

## How to run this

Start the app with:

```
npm run dev
```

This launches `electron-vite dev` and opens the launcher's own window. Every step below is a
click/type in that window — there are no console or devtools shortcuts in this document.

**Environment note:** this test plan was written by reading the built code, not by running it.
The sandbox this sprint was built in is a headless WSL container with no display server, so
`electron.exe` (a Windows-native binary) cannot launch there — `npm run dev` starts the Vite
dev server correctly, but the window itself never opens. Running this document therefore needs
a real Windows or other desktop environment with a display.

## Prerequisites

- The launcher's Library already has **two registered Quake II installations** with different
  engines, so story 003's per-engine editor and story 005's import have something real to work
  against:
  - **"R1Q2 Client"** — an installation whose client executable is detected as R1Q2 (e.g.
    `r1q2.exe`). Add it via **Library → Add existing**, pointing at the folder that contains
    `baseq2`.
  - **"Q2PRO Client"** — a second installation, client executable detected as Q2PRO (e.g.
    `q2pro.exe`), added the same way.
- Inside **"R1Q2 Client"**'s installation folder (next to `baseq2`), create an empty
  subfolder named `xatrix`. `xatrix` is one of the launcher's known mod-directory names, so it
  is picked up as a "mod" without needing real mission-pack files in it. If the Library doesn't
  already show it under the installation's game directories, select the installation and use
  its **"Check again"** action to re-scan.
- Optional, only needed for one step in Use case 5: a **third installation on an engine the
  launcher has no cvar facts for**, e.g. one running Yamagi Quake II (`yquake2.exe`). If you
  don't have one available, skip that one verification step — it is called out explicitly
  below.

---

## Use case 1 — Open the Config module

Covers story 001, AC1.

**Preparation:** none beyond the prerequisites above.

**Steps:**
1. In the left navigation, click **Config**.

**Expected result:** a real Config view opens — a page titled "Config" with a "New profile"
button and an empty-state panel ("No config profiles yet…"). It is not the grey "planned
module" placeholder with a capability list that other unbuilt modules show.

---

## Use case 2 — Create profiles (empty and from the standard template)

Covers story 001, AC2.

**Preparation:** none.

**Steps:**
1. Click **New profile**.
2. In the "Start from" dropdown, leave it on **Empty profile**. In the **Name** field, type
   `Competitive`.
3. Click **Create profile**.
4. Click **New profile** again. Set "Start from" to **Standard template**. Name it `Classic`.
5. Click **Create profile**.

**Expected result:** after step 3, `Competitive` appears in the profile list on the left and is
selected. After step 5, both `Competitive` and `Classic` are listed; `Classic` is now selected.
Both profiles keep these names for the rest of this document.

---

## Use case 3 — Rename a profile, delete a profile, and confirm persistence

Covers story 001, AC3 and AC4.

**Preparation:** the two profiles from Use case 2 (`Competitive`, `Classic`) exist.

**Steps:**
1. Click **New profile** → **Empty profile**, name it `Scratch (delete me)`, click **Create
   profile**.
2. With `Scratch (delete me)` selected, click the pencil (**Rename…**) icon next to its name in
   the detail pane. Change the name to `Scratch renamed` and click **Save**.
3. Click the trash (**Delete…**) icon. In the confirmation dialog, click **Cancel**.
4. Click **Delete…** again. This time click **Delete profile** to confirm.
5. Close the launcher window completely, then run `npm run dev` again and open **Config**.

**Expected result:** after step 2, the list entry and the detail-pane heading both show
`Scratch renamed`. After step 3 (Cancel), the profile is still there. After step 4, `Scratch
renamed` disappears from the list and the selection moves to one of the two remaining profiles.
After the restart in step 5, exactly `Competitive` and `Classic` are listed, with their names
intact — nothing else in the launcher (installations, active selection) is disturbed by the
restart.

---

## Use case 4 — Assign profiles to installations and set a default

Covers story 002, AC1–AC6.

**Preparation:** `Competitive` and `Classic` exist; "R1Q2 Client" and "Q2PRO Client" are
registered (see Prerequisites).

**Steps:**
1. Select `Competitive`. In the **Assigned installations** panel, check the box for
   **R1Q2 Client**, then check the box for **Q2PRO Client**.
2. Still on `Competitive`, look at the row for **R1Q2 Client**.
3. Select `Classic`. Check the box for **R1Q2 Client** only (leave Q2PRO Client unchecked).
4. On `Classic`'s **R1Q2 Client** row, click **Set default**.
5. Scroll down to the **By installation** panel at the bottom of the page.
6. Close the launcher completely and run `npm run dev` again; open **Config**.
7. Select `Classic` and uncheck **R1Q2 Client** in its Assigned installations panel (unassign
   it).
8. Select `Competitive` and delete it (pencil/trash icons as in Use case 3), confirming the
   delete dialog. Afterwards, re-create it: **New profile → Empty profile**, name it
   `Competitive` again, and re-assign it to both **R1Q2 Client** and **Q2PRO Client** (repeat
   step 1) so the rest of this document has a profile named `Competitive` assigned to both
   installations again.

**Expected result:**
- Step 1: both installations show as checked under `Competitive`, and because R1Q2 Client was
  checked first, its row shows a **Default** badge for `Competitive`; Q2PRO Client's row shows
  a **Set default** button instead (not yet default there).
- Step 3–4: after step 3, R1Q2 Client now carries two assigned profiles. After step 4, `Classic`
  shows **Default** on R1Q2 Client, and switching back to `Competitive` shows R1Q2 Client no
  longer marked default for it (but Q2PRO Client is unaffected — set its own default first if
  you want to check that independently; it does not clear on Q2PRO Client).
- Step 5: the "By installation" panel lists **R1Q2 Client** with both `Competitive` and
  `Classic`, the **Default** badge on `Classic`; **Q2PRO Client** lists only `Competitive`, with
  the badge on it (its only, and therefore default, assignment).
- Step 6: after the restart, the same assignments and default badges from step 5 are shown
  unchanged (AC4).
- Step 7 (unassign the default): `Competitive` becomes default for R1Q2 Client again — the only
  remaining assignment there is promoted automatically (AC3's promotion rule).
- Step 8 (delete a profile that has assignments): after deleting the original `Competitive`,
  the By-installation panel no longer shows it anywhere for R1Q2 Client or Q2PRO Client — no
  leftover/orphaned reference (AC6).

---

## Use case 5 — Edit cvars with per-engine defaults, clamps and warnings

Covers story 003, AC1–AC5.

**Preparation:** `Competitive` is assigned to both **R1Q2 Client** and **Q2PRO Client** (Use
case 4).

**Steps:**
1. Select `Competitive`. Scroll to the **Settings** section. Above the Player/Graphics panels,
   the **Engine facts shown for** selector should already read **R1Q2** (it defaults to R1Q2
   when the profile is assigned there).
2. In the **Player** panel, find the **Field of view (FOV)** row.
3. In the **Graphics** panel, find the **Render FPS cap** row (`r_maxfps`). Set its value to
   `0` (type it into the number field).
4. In the **Player** panel, find the **Crosshair size** row (`ch_scale`).
5. Change the **Engine facts shown for** selector to **Q2PRO**.
6. With the selector still on **Q2PRO**, look again at the **Render FPS cap** row (still set to
   `0` from step 3) and at **Crosshair size**.
7. *(Optional — only if you have a third installation on an out-of-scope engine, see
   Prerequisites)* Assign `Competitive` to that installation too (Assigned installations panel),
   then look at the Engine facts selector and the row list again.
8. Change **FOV** to `110`. Wait about a second.
9. Close the launcher completely, run `npm run dev` again, open **Config**, select
   `Competitive`.

**Expected result:**
- Step 2: the FOV row shows the current value, **Engine default: 90**, and **Range: 60–140**
  (R1Q2's clamp).
- Step 3: a warning badge appears on the Render FPS cap row explaining that R1Q2 treats `0` as
  effectively 5 FPS, not "unlimited" (the special-value warning, AC2).
- Step 4: the row is visibly present, named "Crosshair size", but shown disabled/greyed with a
  **Not on this engine** badge — R1Q2 doesn't register `ch_scale` (AC3: named, not silently
  omitted).
- Step 5–6: after switching to Q2PRO, the Render FPS cap warning from step 3 is gone (Q2PRO
  reads `0` as "unlimited" and Range now reads `10–1000` instead of R1Q2's `5–1000`); the
  Crosshair size row becomes enabled with its own Q2PRO default and range (AC4: switching the
  selector visibly changes defaults/ranges/warnings). The Render FPS cap row also shows a
  small "Differs on R1Q2" badge, since the two engines disagree about what `0` means.
- Step 7 (if performed): the Engine facts selector still only offers R1Q2 and Q2PRO to pick
  from; the third, out-of-scope engine is called out separately as "Also assigned to
  <engine>, which the launcher has no engine facts for" rather than silently appearing with
  R1Q2 or Q2PRO's numbers.
- Step 8–9: after the restart, the FOV row still shows `110` as the current value (AC5 — cvar
  edits survive a restart).

---

## Use case 6 — Save a profile and write it to disk

Covers story 004, AC1–AC5.

**Preparation:**
- `Competitive` is assigned to and default for **R1Q2 Client** (Use case 4/5's end state; if
  you changed the default away from `Competitive` on R1Q2 Client in Use case 4, set it back:
  select `Competitive`, click **Set default** on the R1Q2 Client row).
- Before touching the launcher, use a text editor to create
  `<R1Q2 Client folder>/baseq2/autoexec.cfg` by hand with one recognisable line in it, e.g.:
  ```
  // my own settings, do not lose this
  set mynote "hello"
  ```
- Do not navigate away from the **Config** view (e.g. to Library) at any point during this use
  case, and do not switch profiles away from `Competitive` — leaving and re-entering the Config
  view resets which edit is treated as "new" for the write trigger, which would make the next
  edit silently not fire a write until a second one. Launching the game in steps 7–8 is done
  from the bottom action bar instead, precisely so you never have to leave Config.
- Make sure **R1Q2 Client** is the launcher's *active* installation (the one named in the
  bottom action bar) before starting — if it isn't, switch to **Library** once beforehand,
  select **R1Q2 Client** there, then go back to **Config** and re-select `Competitive`. Do this
  before step 1, not in the middle of the sequence.

**Steps:**
1. Select `Competitive`. Scroll to **Write targets**. Under the **R1Q2 Client** row, in
   **Played mods**, check **xatrix**.
2. Scroll to **Settings** and change **Mouse sensitivity** to `5`. Wait for the "Saving…" /
   "Saved" indicator above the Settings panels to settle.
3. Scroll back to **Write targets**.
4. Click **Preview…** on the R1Q2 Client row.
5. Close the preview dialog. Using a file manager, open `<R1Q2 Client folder>/baseq2/`.
6. Change **Mouse sensitivity** back to `5` again (re-type the same value so it fires another
   save even though nothing actually changes).
7. Without leaving the Config view, click **Play** in the bottom action bar (it shows
   **R1Q2 Client**, per Preparation) to start the game.
8. Once the action bar shows it as running, stay on `Competitive` in Config and change **Mouse
   sensitivity** to `6`.
9. Quit the running game itself (close its window — the launcher has no in-app stop control,
   only a disabled "Running" indicator). Back in the Write targets panel for `Competitive`,
   click **Retry** on the R1Q2 Client row.

**Expected result:**
- Step 1–2: shortly after the sensitivity edit settles, the R1Q2 Client row in Write targets
  shows **Writing…** and then flips to **Written**.
- Step 4: the Preview dialog lists two files — `.../baseq2/q2l-profile-<id>.cfg` (containing a
  line `set sensitivity "5"` among the profile's other cvars/binds) and
  `.../baseq2/autoexec.cfg` (containing an `exec q2l-profile-<id>.cfg` line). Content is shown
  verbatim, byte for byte.
- Step 5 (file manager check): `baseq2` now additionally contains
  `autoexec.cfg.q2l-backup`, whose content is exactly your original hand-written
  `// my own settings…` / `set mynote "hello"` lines from Preparation — untouched by the
  launcher's own write. The `xatrix` folder now has its own `autoexec.cfg` with the same
  `exec q2l-profile-<id>.cfg` loader content as `baseq2`'s.
- Step 6: because the rendered content is identical to what's already on disk, the R1Q2 Client
  row's badge shows **Unchanged** instead of **Written** this time — no new backup is taken and
  `autoexec.cfg.q2l-backup` still holds your original content from step 5, not a rewrite of it.
- Step 8 (edit while running): the R1Q2 Client row shows a **Pending** badge instead of
  Writing/Written — the installation is skipped because it's currently running.
- Step 9: after quitting the game and clicking **Retry**, the row flips from **Pending** to
  **Written**, and the on-disk `q2l-profile-<id>.cfg` now contains `set sensitivity "6"`
  (confirm via **Preview…** again, or the file manager).

---

## Use case 7 — Import an existing config as a new profile

Covers story 005, AC1–AC5.

**Preparation:**
- **Q2PRO Client** has not yet been written to by the config module (only R1Q2 Client was, in
  Use case 6), so its `baseq2` is a clean place to hand-place an "existing config" to import.
  Using a text editor, create these three files inside `<Q2PRO Client folder>/baseq2/`:

  `config.cfg`:
  ```
  set name "Ranger"
  set skin "male/grunt"
  bind w "+forward"
  exec extra.cfg
  alias +quad "say Quad damage!"
  ```

  `extra.cfg` (same folder):
  ```
  bind e "+use"
  ```

  `autoexec.cfg`:
  ```
  set name "RangerAX"
  ```

**Steps:**
1. In **Config**, click **New profile**.
2. Set "Start from" to **Import from installation**, then click **Continue**.
3. In the **Installation** dropdown, choose **Q2PRO Client**.
4. Leave **Game folder** on `baseq2` (it should be the only/default option).
5. Look at the preview: the **Cvars** and **Key binds** counts, and the preserved-lines list
   below them.
6. Leave the **Name** field on its prefilled value (`Q2PRO Client (imported)`), or change it.
   Click **Create profile**.
7. With the new profile selected, scroll to the **Preserved lines** panel.
8. Scroll to **Settings**, and find the **Player name** row (`name`).
9. Rename this profile (pencil icon) to `Imported Q2PRO`.
10. In **Assigned installations**, check **R1Q2 Client** as well (in addition to being usable
    standalone — it is not required to be assigned anywhere for this use case, but doing so
    proves it behaves like an ordinary profile).
11. Change the **Mouse sensitivity** cvar on `Imported Q2PRO` to any new value, and wait for it
    to save.
12. Close the launcher completely, run `npm run dev` again, open **Config**, and select
    `Imported Q2PRO`.

**Expected result:**
- Step 5: the preview shows **Cvars: 2** (`name`, `skin` — each counted once despite `name`
  being set in both `config.cfg` and `autoexec.cfg`) and **Key binds: 2** (`w` from
  `config.cfg`, `e` pulled in from `extra.cfg` via the `exec` line — proving `exec` resolution,
  AC2). Below that, **1 preserved line** is listed, showing the `alias +quad …` line together
  with its source file and line number — not silently dropped (AC4).
- Step 6: the dialog closes and the new profile is selected in the list.
- Step 7: the Preserved lines panel still shows the same `alias +quad …` line, unchanged, now
  living permanently on the profile rather than only in the import dialog's preview (AC4).
- Step 8: the **Player name** row's current value is **`RangerAX`**, not `Ranger` — proving
  load order: `config.cfg` is read first, then `autoexec.cfg`, and the later file's value wins
  (AC2).
- Steps 9–11: renaming, assigning to an installation, and editing a cvar all work exactly as
  they did for `Competitive`/`Classic` earlier in this document — nothing about this profile
  behaves differently for having been imported (AC5).
- Step 12: after the restart, `Imported Q2PRO` is still in the list with its new name, its
  assignment to R1Q2 Client, its edited sensitivity value, and the same preserved `alias` line
  all intact.

---

## Known gaps

A few behaviors described in the sprint's stories have no direct path through the real UI, or
only a partial one. These are reported here rather than as fabricated UI steps above, per this
project's UI-acceptance policy:

- **Backup file content has no in-app viewer.** Story 004 AC3 requires that a pre-existing file
  is backed up before its first overwrite. The launcher's Preview dialog only shows the two
  files it would write (the profile's own `.cfg` and the `autoexec.cfg` loader) — it does not
  show or link to the resulting `<file>.q2l-backup`. Confirming a backup was taken, and that
  its content is the user's original rather than something the launcher wrote, can only be done
  by opening the file directly in a file manager/text editor (Use case 6, step 5), outside the
  launcher's own UI.
- **No dedicated key-bindings view or editor on a profile.** Story 005 AC3 states that
  recognized key bindings populate the profile's "keybinding state," and story 001's standard
  template also seeds a small set of default binds. Both are genuinely stored and correctly
  written to disk (visible as `bind <key> "<value>"` lines in the Write Targets → Preview
  dialog, once the profile is assigned to an installation), but unlike cvars — which have a
  full Settings tab — there is no panel anywhere in the Config view that lists or lets you edit
  individual key binds by name. The only in-app signal for bind content before a write exists is
  the numeric "Key binds" count shown in the import dialog's preview step.
- **"Played mods" checkbox state does not survive an app restart or profile reselection.** This
  is a deliberate, documented scope limit (the config module's contract has a `setPlayedMods`
  write but no matching getter), not a missing UI path — the checkboxes in Write Targets simply
  reset to unchecked on a fresh session even though a previously played mod's `autoexec.cfg`
  loader copy is still correctly on disk from the earlier write. Worth knowing when running Use
  case 6 so an empty checkbox after a restart isn't mistaken for a regression.
