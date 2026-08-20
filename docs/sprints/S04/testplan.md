# Sprint S04 — manual test plan

Covers the six stories built and merged in S04: 026 (UI verification harness), 017 (Overview
edit-by-default), 018 (test mode layers/key feedback), 019 (Controls entry types/ordering), 020
(Controls column-grid redesign), 021 (Settings dense-rows redesign).

Every step below goes through the real UI. A terminal is only used to start the app or (for 026)
to run the harness command — never to poke internal state or call an IPC channel directly.

## Preparation (do this once)

1. Open a terminal in the repo root and run:
   ```
   npm run dev
   ```
   This starts the Vite dev server and the Electron app together with hot reload. Wait for the
   app window to open.
2. In the app, go to the **Config** module (left-hand nav rail).
3. If the profile list is empty, click **New profile**, choose to create it **from the standard
   template** (not empty) — the template ships default binds, categories and cvars, which every
   scenario below needs. Give it any name, e.g. "S04 Test".
4. Open that profile (click its row). You land on the **Overview** tab by default.
5. Some scenarios need a second alt layer with a trigger key (a "hold" layer) and one with a
   toggle trigger. If the template profile does not already have one:
   - Go to the **Overview** tab → find the **Layers** panel/switcher area. Create a layer, assign
     it a trigger key (e.g. `-` for a hold layer, `` ` `` for a toggle layer). See story 011/016
     flows already in the app — this is existing functionality, not part of S04.
   - Alternatively, follow step 10 of the 018 section below, which creates a layer indirectly via
     the Controls tab's modifier-capture flow (Alt+key), which is simpler and itself tests an S04
     surface.
6. Leave the app running for all sections below; each section says when to restart it.

---

## 1. Overview — editing is the default (story 017)

**Preparation:** profile open on the **Overview** tab, not in test mode.

**Steps and expected results:**

1. Look at the tab header, to the right of the layer switcher.
   **Expected:** only a **"Start test mode"** button is present. There is no "Start editing" /
   pencil toggle anywhere.
2. Look directly under the Overview subtitle.
   **Expected:** a small hint line reads "Click a key to edit its bind".
3. Click keycap **`1`** on the on-screen keyboard.
   **Expected:** the `KeyBindDialog` opens immediately — no prior "start editing" step was needed.
   Assign any command (e.g. `+attack`) and save. The keycap now shows that command.
4. If an alt layer exists with a trigger key (e.g. `-`), select that layer in the **Layer
   switcher**, then click any key.
   **Expected:** the dialog opens scoped to that layer's override (not the base bind) — the
   dialog title/content should reflect the selected layer.
5. With that layer still selected, click the **trigger keycap itself** (e.g. `-`).
   **Expected:** the bind dialog opens for that key (editing its own bind) and the board does
   **not** switch layers. Repeat while Base is selected — same result (dialog opens, no layer
   switch).
6. Hover over a free (unbound) key, a bound key, an overridden key, and the trigger key in turn.
   **Expected:** every one of them shows a pointer cursor and a hover border — none look inert.
   The trigger keycap's inline label shows just the layer name (no arrow "→"), and its tooltip
   reads "Layer trigger: <layer name>".
7. Click **Start test mode**.
   **Expected:** the "Click a key to edit its bind" hint disappears. Click any keycap.
   **Expected:** nothing opens a dialog — only the readout area updates (see section 2 below).
8. Click **Stop test mode**.
   **Expected:** click a keycap again — the bind dialog opens immediately, no extra step.
9. Start test mode again, then switch to a different profile in the sidebar/profile list and come
   back into this profile.
   **Expected:** test mode is off, no dialog is open, and clicking a keycap opens the edit dialog
   again (test mode did not persist across the profile switch).

---

## 2. Test mode — trigger keys, key highlighting, persistent readout (story 018)

**Preparation:** same profile, on **Overview**. You need: a hold-trigger alt layer (e.g. trigger
`-`), ideally a toggle-trigger alt layer (e.g. trigger `` ` ``), an override on some key (e.g.
`R`) inside the hold layer, and a base bind on that same key. If you don't have these, create them
via the Layers panel and by editing binds per section 1 above before continuing.

**Steps and expected results:**

1. Before starting test mode, look at the **legend row** (the row of badges near the keyboard).
   **Expected:** a readout strip sits on the right-hand side of that row, under/next to the
   "Start test mode" button, showing an inactive hint like "Start test mode to see what a key
   does". Note the keyboard's vertical position on screen.
2. Click **Start test mode**.
   **Expected:** the keyboard has not moved up or down. The readout now shows a "press a key"
   placeholder instead of the inactive hint.
3. Physically hold down **A** and **S** on your real keyboard at the same time.
   **Expected:** both the `A` and `S` keycaps show a highlighted ring simultaneously. Release
   `A` — only `S` stays highlighted. Release `S` — nothing stays highlighted.
4. Press and hold the **hold layer's trigger key** (e.g. `-`).
   **Expected:** the readout names that layer, says "hold", and shows the generated alias — it
   must never say "Not bound" / "unbound". The on-screen board switches to show that layer's
   overrides.
5. While still holding the trigger, press the key that has an override in that layer (e.g. `R`).
   **Expected:** the readout shows that override's command, tagged as coming from the layer (not
   the base bind).
6. Release the trigger key.
   **Expected:** the board switches back to Base. Press the same key (`R`) again.
   **Expected:** the readout now shows the **base** bind, tagged as coming from Base.
7. If a toggle-trigger layer exists (e.g. `` ` ``), press it once.
   **Expected:** the readout names that layer, says "toggle", shows its alias, and the board
   switches to it. Press the same key again.
   **Expected:** the board switches back to Base.
8. Hold the **left mouse button** down over empty space in the panel (not on a keycap).
   **Expected:** the `MOUSE1` keycap lights up. Release — the highlight clears.
9. Click directly on a keycap (e.g. `2`) while in test mode.
   **Expected:** the readout reports that key's bind, not `MOUSE1`, even though the mouse button
   itself is momentarily down.
10. While holding the hold-layer trigger and a key together, click on a different application
    window to move focus away from the app, then click back into the app.
    **Expected:** after refocusing, no keycap is stuck highlighted and the board is back on Base.
11. Click **Stop test mode**.
    **Expected:** the readout returns to the inactive hint, the layer displayed reverts to
    whichever one was selected before you started test mode, and the keyboard has not shifted
    position at any point during this whole sequence.
12. Start test mode once more, then switch to a different profile.
    **Expected:** test mode turns off automatically, nothing stays highlighted, and the readout
    resets.
13. (016 interaction check) Go to the **Controls** tab (see section 3/4 below), assign an action
    by clicking a bind slot and holding **Alt** while pressing **R**.
    **Expected:** this auto-creates an "Alt" layer. Return to **Overview**, start test mode, press
    and hold **Alt** — the readout names the Alt layer as a hold trigger with its alias. While
    still holding Alt, press **R** — the readout reports the modifier override, not "unbound".

---

## 3. Controls — entry kinds, ordering, aliases (story 019)

**Preparation:** profile open, click the **Controls** tab (previously called "Advanced" — if you
see a tab labelled "Advanced" instead, story 020's rename did not land; note this as a gap).

**Steps and expected results:**

1. Find the category rail/strip at the top of the tab and click to create a new category.
   **Expected:** the dialog asks only for a **name** — there is no "type" or "entry kind"
   selector for the category itself.
2. Inside the new category, create three entries:
   - one of kind **alias** named `+test` (its command/body can be anything, e.g. `+moveup`)
   - one of kind **alias** named `-test` (e.g. `-moveup`)
   - one of kind **binding** named "Test binding"
   **Expected:** the "create entry" dialog asks you to choose a kind (bind / message / alias) at
   creation time.
3. Open the "Test binding" entry's editor and type `+t` into its command field.
   **Expected:** the two aliases you just created (`+test` etc.) appear as suggestions. Pick
   `+test` and save.
4. Open the `+test` alias entry's editor.
   **Expected:** there is no key/bind slot and no "capture key" button anywhere in that dialog —
   an alias cannot be bound to a key at all through the UI.
5. Use the up/down reorder controls on the two alias rows to move both above "Test binding".
   Switch to another tab (e.g. Settings) and back to Controls.
   **Expected:** the new order persisted.
6. Open the **Raw File** / preview tab for the profile.
   **Expected:** `alias +test …` and `alias -test …` lines appear before the alias line that
   "Test binding" generates, and there is no `bind` line for either alias entry.
7. Delete the `+test` alias entry (leave `-test` in place, still unreferenced).
   **Expected:** open the **Validation** tab — it reports the "Test binding" entry referencing an
   undefined alias, and separately reports `-test` as an alias that is never referenced by
   anything.
8. Restart the app (`Ctrl+C` in the terminal running `npm run dev`, then `npm run dev` again) and
   reopen the same profile's Controls tab.
   **Expected:** every entry created above still exists with the correct kind badge on its row —
   nothing had to be recreated by hand. (This exercises the "existing profiles keep working"
   migration path only if the profile pre-dates 019; on a template-created profile this step
   mainly re-confirms nothing was lost on reload.)

---

## 4. Controls — column-grid redesign (story 020)

**Preparation:** same profile, **Controls** tab.

**Steps and expected results:**

1. Confirm the tab label in the tab strip reads **"Controls"**, not "Advanced".
2. Maximize/widen the app window as far as your screen allows.
   **Expected:** the grid's content stops growing at roughly 1120px wide and stays centered — it
   does not stretch edge-to-edge on a wide window.
3. Scroll down through the list of entries.
   **Expected:** the column header row (Action · (reset) · Primary · Secondary · Options) stays
   pinned/visible while the rows scroll underneath it. Built-in groups such as "Use weapon" or
   "Cycling" show a rule line, a group label and a row count.
4. Hover your mouse over any row.
   **Expected:** the row highlights and a reset icon appears only while hovered (it is hidden the
   rest of the time). The row shows the action's name plus its underlying command rendered in a
   monospace font as a secondary line.
5. Look at every row's Primary and Secondary cells.
   **Expected:** every cell is a visibly filled box — an unbound one reads "Empty" rather than
   being blank, and a bound one shows its key. On a row that has a Primary bind, that Primary cell
   is visually the strongest/most prominent element in the row.
6. Click an empty **Primary** slot.
   **Expected:** it shows "Press a key…" text with a dashed, pulsing border. Press **Esc**.
   **Expected:** nothing is bound, capture cancels. Click the same slot again, then press
   **Delete**.
   **Expected:** the slot is (or stays) cleared — the footer/legend states that DEL clears the
   slot. Click the slot again and press a real key, e.g. `1`.
   **Expected:** the slot now shows `1`.
7. Click a **Secondary** slot and press **Alt+R** on your keyboard.
   **Expected:** the slot shows a small "ALT" cap next to "R", and the row's Options column names
   the layer this modifier bind went into (e.g. "Alt"). Open the Layers panel (Overview tab) to
   confirm that layer now exists.
8. Bind a key to one row's Primary slot that is already used by another row (e.g. bind `1` again
   on a different action).
   **Expected:** the slot is marked as conflicting, the Options column reads "also: <other row's
   name>", a Cancel/Replace prompt appears as a sub-row directly under the conflicting row, and
   the header shows a conflict count badge. Click **Cancel** in that prompt.
   **Expected:** nothing changed — the original bind is untouched.
9. Type part of an action's name into the filter box, then clear it and type part of a command
   instead.
   **Expected:** in both cases the row list narrows to matches, and the footer text ("n rows · m
   bound") updates to match what's visible. Clearing the filter shows everything again.
10. Create two new custom categories via the category rail, then rename one of them to a long
    name.
    **Expected:** the rail scrolls horizontally instead of wrapping to a second line, and
    whichever category tab is currently selected stays scrolled into view.
11. Click the per-row reset icon (visible on hover) for a row that has at least one bind.
    **Expected:** only that row's binds clear; other rows are unaffected.
12. Click **Restore defaults** in the header.
    **Expected:** a confirmation dialog appears before anything changes. Click cancel first to
    verify nothing changed, then click it again and confirm.
    **Expected:** built-in catalogue rows return to their suggested keys (where the catalogue
    defines one — some categories like Weapons/Weapon-dropping have no suggested key data and are
    simply cleared, per the story's own documented decision), and custom entries are cleared.
    Restart the app and reopen this profile's Controls tab — the reset state persisted.

---

## 5. Settings — dense-rows redesign (story 021)

**Preparation:** same profile, click the **Settings** tab.

**Steps and expected results:**

1. Widen the app window.
   **Expected:** the settings list stays capped at roughly 1000px wide and does not stretch; every
   row's four columns (label · control · value · reset) line up vertically across all rows.
2. Scroll through the list.
   **Expected:** group headers — Player, Network, Graphics, Sound — stick to the top while
   scrolling, each showing "n cvars · m changed" (or similar wording). The old two hard-coded
   panels from before this story are gone.
3. Hover over a row whose description is truncated to one line.
   **Expected:** the description expands to show its full text while hovered.
4. Find one cvar row of each control kind (a text field, a dropdown/select, a toggle switch, and a
   slider-with-number) and change its value.
   **Expected:** the control matches its kind; after the change, the value column updates to show
   the new effective value, a colored left-edge accent bar appears on that row, and the second
   line under the value switches from "= default" to something like "default · min–max".
5. Click that row's **reset** control.
   **Expected:** the value returns to default, the accent bar disappears, and the reset control
   becomes disabled (since the value already equals the default).
6. Type text into the header's filter box, then toggle **"changed only"** on.
   **Expected:** rows narrow to matches / to only-changed rows, and the header counts follow.
   If a filter match is inside a collapsed "Advanced" section for a group, that section
   auto-expands to reveal it. Switch to a different tab and back to Settings.
   **Expected:** the filter text and "changed only" toggle have both reset (session-local, not
   persisted).
7. Click **Reset all** in the header.
   **Expected:** a confirmation dialog names how many cvars would change. Click cancel — nothing
   changes. Click it again and confirm.
   **Expected:** every catalogue cvar returns to its default. Open the **Raw File** tab.
   **Expected:** a cvar that exists in the raw file but isn't part of the catalogue (an imported
   value) is still present, untouched by "Reset all".
8. Assign this profile to a real installation (use the profile's assignment control — an existing
   feature, not part of S04) whose engine is r1q2.
   **Expected:** rows that have an engine caveat (a mod-dependent value, a value above the
   engine's allowed range, or a note) now show an inline flag row directly inside that row's area,
   naming the caveat. A cvar the assigned engine doesn't support at all appears dimmed with its
   control and reset disabled.
9. Unassign the profile from every installation.
   **Expected:** the existing "no engine in scope" note reappears above the list (this predates
   S04 — story 009), rows stay editable, and no row's value/range/note is attributed to any
   specific engine.
10. Edit one cvar, then switch to the Validation tab and immediately back to Settings.
    **Expected:** the edit you made is still there, and the save indicator goes through its usual
    idle → saving → saved sequence (autosave behavior is unchanged by this redesign).

---

## 6. UI verification harness (story 026)

This story's own acceptance is largely about a scripted tool the developer runs from a terminal,
not an interactive UI flow — the "UI-facing" part is that it produces screenshots/reports you can
open and look at. The terminal command itself only starts/drives a throwaway copy of the app; it
never substitutes for exercising the UI features above.

**Preparation:** a terminal in the repo root. This does not require the `npm run dev` session
from the other sections; it builds and launches its own instance.

**Steps and expected results:**

1. Run:
   ```
   npm run ui:verify
   ```
   **Expected:** it builds the app if needed, seeds a throwaway fixture, screenshots every screen,
   runs an accessibility scan, and prints one summary block at the end. Exit code should be `0`
   (clean) or `2` (only accessibility findings) — not `1` (harness/app failure), **with one known,
   already-documented exception**: `config-raw` is expected to still fail today because of a
   pre-existing bug in `RawConfigPanel.tsx` unrelated to S04's stories (see 026's own Done notes);
   that single failure alone causing exit code `1` is not a regression to chase down here.
2. Open the folder `.ui-verify/screenshots/` in a file browser.
   **Expected:** you see PNG files for each screen at two window sizes, including
   `config-overview`, `config-settings`, `config-controls` (renamed from `config-advanced` per
   story 020), `config-writeTargets`, `config-validation`, and (if the fixture profile has
   unrecognized lines) `config-preserved`. None of these screenshots show your own real
   installations or profiles — only the seeded fixture data.
3. Open `.ui-verify/a11y.md`.
   **Expected:** a readable report grouped by impact (critical/serious/moderate/minor), each entry
   naming the screen and the rule that fired.
4. If you have a real Q2 Launcher `state.json` (check `%APPDATA%\Q2 Launcher\state.json` if it
   exists), compare its modification time/hash before and after running the harness.
   **Expected:** unchanged — the harness never touches your real data.
5. Run:
   ```
   npm run ui:flow -- open-keycap-dialog
   ```
   **Expected:** exits `0` and leaves an additional screenshot under
   `.ui-verify/screenshots/flows/` showing the keycap bind dialog open — the worked example flow
   from story 026's own deliverable.

---

## Known gaps / things this plan cannot exercise through the UI

- Story 019's AC "an alias entry has no key slot at all... impossible through the UI" and the
  "duplicate alias name" validation case are exercised above only for the undefined-reference and
  unreferenced-alias findings; deliberately creating two aliases with the same name to see the
  duplicate-name finding was not included as a separate step since it is mechanically identical to
  steps in section 3 — repeat step 2 with the same alias name twice and check the Validation tab
  if you want to confirm it directly.
- Story 020's "Restore defaults" only has real suggested-key data for movement actions today
  (per that story's own recorded decision) — expect Weapons/Weapon-dropping/custom binds to be
  cleared rather than restored to a specific key when testing step 12 of section 4. This is a
  documented, intentional content gap, not a UI defect.
- Story 026's `config-raw` screenshot/audit is expected to fail due to a pre-existing,
  out-of-scope bug in `RawConfigPanel.tsx` — this is not something to "fix" while testing this
  sprint's stories.
