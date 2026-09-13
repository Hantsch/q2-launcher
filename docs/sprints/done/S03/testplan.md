# Sprint S03 — Manual Acceptance Test Plan

Covers the 5 stories built and reviewed in this sprint: **011** (alt layer trigger via binding),
**013** (compact layers panel / relocated switcher), **014** (trigger key visibility and
click-to-switch), **012** (raw config view with reveal-in-folder), **015** (dual-bind editor for
Movement / Weapons / Weapon dropping).

Story **016** (modifier-layer auto-creation on capture) is **blocked** and out of scope for this
plan. Its partial, unreviewed work is already present in the code shared with story 015 (see the
note at the start of section 3) — do not test modifier-key (Alt/Ctrl/Shift) capture behavior; it
is not part of what was accepted this sprint.

This test plan **is** the live acceptance pass for these 5 stories. Every deliverable's own build
verification (`npm run build`, `npm test`, clean-agent review) already passed during the build
session, but nobody drove the actual Electron window — no Playwright/`_electron` harness is
scaffolded in this repo yet. Per this project's P2 policy, all 5 stories are handed over as
**built, live acceptance pending**; running the steps below and confirming the expected results is
what turns that into full acceptance.

Per this project's P1 policy (`ui-acceptance-required: true`), every step below is a real action
through the running app's UI — clicking, typing, pressing keys. Nothing here is a console command
or an internal call standing in for a user action. Where an acceptance criterion could not be
fully exercised this way, it is called out explicitly as a **Gap** instead of being worked around.

## Preparation

1. Install and start the app:
   ```
   npm install
   npm run dev
   ```
   This launches the Vite dev server plus the Electron window (per `README.md` / `CLAUDE.md`
   conventions — `electron-vite dev`).
2. In the launcher, make sure at least one **installation** is registered (any valid Quake II
   folder works — installation management is out of this sprint's scope, it should already exist
   from earlier testing).
3. Go to the **Config** module and prepare one test profile:
   - Create a new profile from the **standard template** (`New profile` → `Start from: Standard
     template`) so it already carries a handful of base key binds — you'll need at least one
     already-bound key (e.g. whatever the template binds to movement) for the trigger-conflict and
     collision steps below.
   - **Assign it to an installation** (`Assignments` menu on the profile's detail screen) — needed
     for section 2 (raw config view). Assigning it as the **default** for that installation is not
     required, just assigned.
   - From the **Overview** tab, create one alt layer up front named e.g. `Prep` (mode Hold) — not
     used directly below, but keeps at least one "existing alt layer" around in case you want to
     re-run individual steps out of order without recreating state.
4. Keep this profile selected for sections 1 and 3. Section 2 works with any profile that has an
   installation assignment (the same one is fine).

---

## 1. Alt layer trigger: create, bind, reassign, visualize (stories 011 + 013 + 014)

These three stories build directly on each other (013 relocates the switcher, 014 renders the
trigger on the board using 013's layout, 011 is what lets a trigger be assigned at all) — walk
through them together in this order.

1. Open the test profile → **Overview** tab.
   **Expected:** the keyboard board renders first, full width; below it the "Alt layers" panel
   with a "New layer" button. If the profile has no layers yet, the panel shows one short line —
   *"No alt layers yet — create one to bind keys independently while a trigger key is held or
   toggled on."* — not a large empty-state block, and there is no layer switcher next to the
   board's header yet.

2. Click **New layer**. **Expected:** the dialog asks only for **Name** and **Mode** (Hold /
   Toggle) — there is no trigger picker. Enter `Test`, leave Mode on `Hold`, click **Create
   layer**.
   **Expected:** dialog closes; the new layer's row appears with a **"No trigger"** badge (not a
   key), and the keyboard overview's header now shows a switcher labelled *"Editing on the
   board:"* with two buttons, `Base` (active) and `Test`.

3. On the layer's row, click **Show generated aliases**.
   **Expected:** the preview reads *"Not reachable from the keyboard yet — assign a trigger key
   from the keyboard overview."* — no `bind` line for this layer.

4. In the switcher, click `Test`. **Expected:** the board switches to the layer view (its button
   is now highlighted/active). Click **Start editing**, then click key `1`. The bind dialog opens
   with *"Editing layer: Test"*. Pick **use blaster** from the command list (or type `use blaster`
   in the Command field), click **Assign**. Click **Stop editing**.
   **Expected:** key `1` on the `Test` layer view now shows amber "bound in an alt layer" styling
   with `use blaster`.

5. Switch back to `Base` in the switcher. Click **Start editing**, then click a currently
   **unbound** key (e.g. `-`). In the dialog, scroll to the **Layer trigger** section at the
   bottom: it reads *"This key does not trigger a layer."*, with a layer picker (only `Test`/`Prep`
   to choose from) and an **Assign trigger** button.
   Pick `Test`, click **Assign trigger**.
   **Expected:** dialog stays open with `Test` now showing *"Currently triggers: Test"*; close it.
   The `Test` layer's row now shows **"Trigger: -"** instead of "No trigger". Expand its preview —
   it now shows a line like *"Trigger bind: bind - +test..."* (aliased command) above the alias
   block.

6. Still in edit mode, on `Base`, click the key that already carries a base bind (from the
   template used in Preparation, e.g. whichever movement key). In the **Layer trigger** section,
   pick `Test` again, and note the warning line: *"`<key>` already has a base bind
   (`<command>`); the layer's trigger binding will take priority."* Click **Assign trigger** anyway.
   **Expected:** the assignment goes through; the `Test` layer's row now shows **"Trigger:
   `<that key>`"**, and `-` is free again (011 decision: one key triggers at most one layer, so
   assigning a new one *moves* it). The layer's override on `1` (`use blaster`) is still present —
   expand the preview to confirm.

7. Still in edit mode, click key `1` (the key `Test` already overrides) and try to make `Test`
   trigger *that* key. **Expected:** the dialog shows a blocking message — *"This layer remaps its
   own trigger key (1) — you would have no way to switch it off."* — and **Assign trigger** is
   disabled; the assignment is refused.

8. Click **Stop editing**. On the `Base` view, locate the key that is `Test`'s current trigger
   (from step 6). **Expected (story 014):** that key renders in a **distinct green ("layer
   trigger") color**, different from the orange "bound" keys and the amber "alt layer" keys, and
   its second label line reads **`→ Test`**. Hover it — the tooltip names the trigger role and
   target layer. Below the board, the legend now shows **4 badges**: Free, Bound, "Bound in an alt
   layer", and **"Layer trigger"**.

9. With **neither** test mode nor edit mode active, click that trigger key directly on the board.
   **Expected:** the board switches to the `Test` layer view (same as using the switcher); the
   switcher's `Test` button is now active.

10. On the `Test` layer view, the same key still renders in the trigger's green color, but its
    label now reads **`→ Base`**. Click it again. **Expected:** back to the `Base` view, switcher
    back on `Base`.

11. Regression check — **Start test mode**, click the trigger key: the capture readout at the
    bottom shows the key and its resolved command chain; the layer is **not** switched. **Stop
    test mode**, **Start editing**, click the trigger key: the bind dialog opens (base-bind
    editing), the layer is **not** switched. Stop editing.

12. Open the **Layer trigger** dialog for that key once more (Base, edit mode) and click **Clear
    trigger**. **Expected:** `Test`'s row reverts to **"No trigger"**; its override on `1`
    (`use blaster`) is still present; expanding the preview shows the "not reachable" note again,
    with no `bind` line.

13. Restart the app (`npm run dev` again, or reload the window) and reopen the same profile.
    **Expected:** the `Test` layer, its override on `1`, and its current trigger state (whatever
    you left it in) all persisted correctly.

---

## 2. Raw config view with reveal-in-folder (story 012)

1. Open the assigned test profile from Preparation → open the **Raw file** tab (it sits between
   "Write targets" and "Validation" in the tab row).
   **Expected:** the rendered `.cfg` text appears as plain text, with the absolute target path
   shown above it, and a badge saying whether the file is **"On disk"** or **"Not on disk"**.

2. Go to **Write targets** tab → click **Preview…** for the same installation.
   **Expected:** the content shown there is identical to what the Raw file tab showed.

3. Back on the **Raw file** tab, if the badge reads "On disk", click the folder icon (**Reveal in
   folder**) next to the file path.
   **Expected:** the OS file explorer opens with that `.cfg` file selected. If the badge instead
   reads "Not on disk", the reveal button is disabled and a line under the path reads *"Not
   written to this installation yet"* — clicking does nothing and no error appears.

4. Create a second, fresh profile, assign it to an installation, but do **not** write it yet (no
   "Write" action performed). Open its **Raw file** tab.
   **Expected:** the rendered text still appears (it is generated on the fly), every file is
   marked **"Not on disk"**, and every reveal button is disabled.

5. Unassign that profile from every installation (Assignments menu → remove all assignments), then
   reopen the **Raw file** tab.
   **Expected:** instead of content, it shows an empty-state message — *"Not assigned to an
   installation"* / *"Assign this profile to an installation to see the rendered config file it
   would write."* — no broken request, no blank flash.

6. If you have (or create) a profile assigned to **two or more** installations, open its Raw file
   tab: an **Installation** selector appears above the content. Switch it.
   **Expected:** the displayed content changes to match the newly selected installation.

---

## 3. Advanced tab — dual-bind editor for Movement, Weapons, Weapon dropping (story 015)

> **Scope note:** the underlying components (`BindSlot`, `DualBindPanel`, `DropBindPanel`) already
> contain unreviewed, blocked story-016 code for modifier-key (Alt/Ctrl/Shift) capture, because
> 016 builds on top of 015's slots and its partial work was committed as WIP. **Do not hold
> Alt/Ctrl/Shift while capturing a key below** — that path is not part of what shipped this
> sprint and is not covered by this test plan. Every step below uses a **plain key press only**.

1. Open the test profile → **Advanced** tab. The three built-in category chips (Movement,
   Weapons, Weapon dropping) show **no "Built-in" badge** (custom categories, if any, still show
   one).
   Select **Movement**. **Expected:** one row per movement action (Forward, Back, Left, Right,
   Jump, Crouch, etc.), each with a **Primary** and **Secondary** slot — no name field, no "Add
   action" button anywhere on this category.

2. On the "Forward" row, click the **Primary** slot's **"Press a key…"** button, then press `W`
   (a plain key, no modifier held). **Expected:** the slot immediately shows `W`. Click
   **Secondary**'s capture button, press `UPARROW`. **Expected:** both slots now show their keys.
   Click **Clear** on the Secondary slot. **Expected:** it reverts to **"Not bound"**.

3. Collision check: on a *different* movement row (e.g. "Back"), click its Primary slot's capture
   button and press `W` again (the key Forward's Primary already holds).
   **Expected:** the key is **not** applied immediately — an inline red banner appears reading
   *"W is already used by "+forward". Take the key from it?"* with **Cancel** and **Replace**
   buttons.
   Click **Cancel**. **Expected:** both rows are unchanged — Forward still has `W`, Back is still
   unbound.
   Repeat the capture and click **Replace** instead. **Expected:** the Back row now shows `W`, and
   Forward's Primary slot is now **"Not bound"**.

4. Select **Weapons**. **Expected:** two groups are visible — "Use weapon" (one row per weapon,
   including Blaster) and "Cycling" (`weapnext`/`weapprev`/`weaplast`). Assign `1` to Blaster's
   Primary slot and `MWHEELUP` to the cycling row (via plain-key capture as above).
   **Expected:** no ammo checkbox and no team-message field appear anywhere in this category.

5. Select **Weapon dropping**. **Expected:** three group headings — **Weapons**, **Ammunition**,
   **Misc** — with the Blaster **absent** from the Weapons group (it cannot be dropped).
   On the "Rocket Launcher" row: capture a Primary key (plain key press), leave the **"With
   ammo"** checkbox checked (its default), and type a short message into the **Team message**
   field, e.g. `firing rockets`.
   **Expected:** the checkbox and message field are both visible and usable on this row. On a Misc
   row (e.g. a powerup like Quad Damage), **Expected:** there is **no** "With ammo" checkbox at
   all (only rows with a matching ammo type get one).

6. Create one **custom** category (`New category`, pick entry kind "Bind"). **Expected:** the
   entry-kind badge (Bind/Message/Alias) is shown next to it, "Add action" is available, and
   creating/renaming/editing/removing an action still opens the original catalogue-picker editor
   (`ActionEditor`) exactly as before this sprint's changes — this generic path is untouched.

7. Go to the **Overview** tab. **Expected:** the keycaps for `W`/`UPARROW` (or whichever keys you
   ended up with after step 3), `1`, `MWHEELUP`, and the Rocket Launcher's assigned key all show
   the correct command label, and the "n of m keys bound" counter reflects them.

8. Open the **Raw file** tab (story 012) for this profile's assigned installation. **Expected:**
   the rocket-launcher alias's rendered body reads `drop rocket launcher; drop rockets; say_team
   firing rockets` (or your own message text), and each key assigned to it (if you gave it a
   Secondary too) has its own `bind` line pointing at that alias.

9. Restart the app and reopen the profile. **Expected:** every key assignment, the ammo choice,
   and the team message from steps 2–5 all survived.

---

## Gaps

No acceptance criterion across these 5 stories required a console command or an internal call to
exercise — every check above goes through a real UI action (click, keypress, typed text, window
reload). No gap is being reported against the P1 policy.

---

## Closing note

All 5 stories in this sprint — **011, 013, 014, 012, 015** — are **built, live acceptance
pending**. Each already passed its own code-level verification (`npm run build`, `npm test`,
clean-agent `story-review-hard`/default review) during the build session, but no session had a way
to drive the actual Electron window (no Playwright/`_electron` harness is scaffolded in this repo
yet). This document *is* that live acceptance pass — once you have run sections 1–3 above and
confirmed the expected results, these 5 stories can be marked `done` in
`docs/sprints/S03/sprint.md` and their individual story files. Story **016** stays blocked and
untouched by this plan; see `docs/sprints/S03/review.md` for its open question.
