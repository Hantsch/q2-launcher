# Sprint S02 — Manual Test Plan (Config module: keybinding editor, switch bind,
# Advanced tab, validator, cleanup)

Consolidated, self-contained acceptance walkthrough for stories 006–010
(`docs/requirements/006-keybinding-editor-alt-layers.md` through
`010-cleanup-redundant-config-copies.md`). Run the use cases below in order — several build on
state (profiles, layers, actions, files on disk) left behind by an earlier one in this same
document, the same way the sprint's own story order was 006 → 007 → 008 → 009 → 010.

This document assumes the config module's foundations from sprint S01 (profiles, per-installation
assignment, cvar editing, saving to disk, import) already work — see
[`docs/sprints/S01/testplan.md`](../S01/testplan.md) for that layer's own walkthrough. Only the
mechanics *new* in S02 are exercised here as their own use cases; S01 features are only used as
setup (e.g. "create a profile", "assign it to an installation") where a S02 feature needs them to
exist first.

**UI note carried over from S01, still true here:** assigning a profile to an installation is no
longer an always-visible inline panel. It is now a small **"N of M assigned"** button (with a
chain-link icon) in the profile detail view's header, next to the rename/delete icons — click it to
open a popover with the same checkbox list and **Set default** buttons S01 describes. This changed
some time between S01 and S02 but is not itself part of any S02 story; it is called out here only
so this document's own steps make sense.

## How to run this

Start the app with:

```
npm run dev
```

This launches `electron-vite dev` and opens the launcher's own window. Every step below is a
click/type in that window — there are no console or devtools shortcuts in this document, except
where a step explicitly says to look at a file on disk with a file manager/text editor, or to watch
the in-game console after a **Play**.

**Environment note:** this test plan was written by reading the built code, not by running it. The
sandbox this sprint was built in has no real Electron/GUI runtime available to it (`npm run dev`
crashes immediately trying to start Electron's main process), confirmed by each story's own "Done"
section. Running this document needs a real Windows or other desktop environment with a display.

## Prerequisites

- Two registered Quake II installations, same as S01's own prerequisites:
  - **"R1Q2 Client"** — client executable detected as R1Q2 (e.g. `r1q2.exe`).
  - **"Q2PRO Client"** — client executable detected as Q2PRO (e.g. `q2pro.exe`).
- A third installation, **"Vanilla Client"**, whose client executable is the original engine
  (`quake2.exe`) — needed for story 009's Use case 11. Add it the same way, via **Library → Add
  existing**.
- One config profile, created empty and named **"Testbed"**, assigned to **R1Q2 Client** (via the
  "N of M assigned" popover described above) — created once here and reused/extended by most of the
  use cases below. Where a use case needs a second profile or a second assignment, its own
  Preparation says so.

---

## Use case 1 — Bind, clear and rebind a key from the Overview tab

Covers story 006, AC1 and AC6.

**Preparation:** open **Testbed** (Config → click it in the profile list). Stay on the **Overview**
tab (the default tab a profile opens on).

**Steps:**
1. Click **Start editing** (top right of the keyboard board, pencil icon).
2. Click the `W` key. A **"Bind W"** dialog opens.
3. In the **Pick a command** list, type `forward` into the filter field, then click the **Forward**
   entry (`+forward`). This fills the **Command** field below with `+forward`.
4. Click **Assign**.
5. Click `W` again. Click **Clear**, then confirm the keycap goes back to its free/unbound look.
6. Click `W` a third time, pick **Forward** again the same way, and click **Assign** to rebind it.
7. Click **Stop editing**.

**Expected result:**
- Step 4: the dialog closes, and the `W` keycap immediately shows a small "Forward" label under
  its key name — no restart or tab switch needed (AC6, "reflected in the overview tab").
- Step 5: after **Clear**, `W`'s keycap goes back to its free/unbound styling; re-opening it shows
  "Not bound" instead of a current command.
- Step 6: `W` is bound to `+forward` again, same as step 4.
- This is the whole of AC1 ("any key… can be bound to a command, cleared, or rebound").

---

## Use case 2 — Create a hold layer and bind keys inside it independently

Covers story 006, AC2, AC3, AC4 (detection) and AC5.

**Preparation:** `Testbed`, Overview tab, `W` bound to `+forward` from Use case 1.

**Steps:**
1. Above the keyboard board, in the **Alt layers** panel, click **New layer**.
2. Name it `Drops`, leave **Mode** on **Hold**, set **Trigger key** to `ALT`, click **Create
   layer**.
3. In the layer selector row ("Editing on the board:"), click the **Drops** button (instead of
   **Base**).
4. Click **Start editing** if it isn't already active.
5. Click the `1` key on the board. In the bind dialog, type `drop rocket launcher` into the
   **Command** field directly (no catalog entry needed) and click **Assign**.
6. Click the `2` key, type `drop railgun`, click **Assign**.
7. Still with **Drops** selected, click `W` (the key bound to `+forward` on the base layer). Read
   the dialog before assigning anything.
8. Type `say testing` into the **Command** field and click **Assign** anyway.
9. Click the `ALT` key (the layer's own trigger). Read the dialog.
10. Back in the **Alt layers** panel, click **Show generated aliases** on the `Drops` row.
11. Switch the layer selector back to **Base**.

**Expected result:**
- Step 5–6: `1` and `2` show as bound *only* while **Drops** is selected on the board (the keycap
  gets the alt-layer highlight, not the normal "bound" one); their base-layer state (if any) is
  unaffected.
- Step 7: the dialog shows a warning box explaining that `W` carries `+forward` on the base layer —
  binding it inside a hold layer can leave movement "stuck" once the layer's own key is released
  (AC4). It is a warning, not a block: **Assign** stays enabled.
- Step 8: the assignment goes through despite the warning (AC4 says warning, not refusal).
- Step 9: `ALT` is the layer's own trigger key — the dialog shows an error message that this key
  can't be remapped inside its own layer (no way to get back out of it), and **Assign** stays
  disabled — this one *is* a hard refusal, unlike step 7's warning (decision 12 in the story file).
- Step 10: the expanded preview shows the exact alias lines that would be written to disk, e.g.
  `alias +drops "bind 1 "drop rocket launcher"; bind 2 "drop railgun""`-shaped content — read the
  actual text shown; the key point to check is that **no line contains a nested quote mark** (AC5),
  and a `-drops` half exists that restores `1`/`2` to whatever they were bound to before (or
  `unbind`s them if they were free).
- Step 11: back on **Base**, `1`/`2`/`W` show their base-layer state again, unaffected by anything
  done while `Drops` was selected.

---

## Use case 3 — Create a toggle layer and verify its generated alias preview

Covers story 006, AC2 and AC3.

**Preparation:** `Testbed`, Overview tab.

**Steps:**
1. In the **Alt layers** panel, click **New layer**. Name it `Zoom`, set **Mode** to **Toggle**,
   **Trigger key** to `V`, click **Create layer**.
2. Click **Show generated aliases** on the `Zoom` row (with no keys bound in it yet).
3. Select `Zoom` in the layer selector, bind `MOUSE1` to `+attack` from the pick list (filter
   "attack").
4. Re-open **Show generated aliases** on `Zoom`.

**Expected result:**
- Step 2: with no overrides yet, the panel shows "This layer has no generated aliases yet."
- Step 4: three aliases are visible — a `zoom_on`, a `zoom_off`, and a dispatch alias `zoom` that
  the trigger key binds to; `zoom_on`'s body ends by pointing the dispatch alias at `zoom_off` and
  vice versa (the self-rewriting toggle pair, AC2/AC3).

---

## Use case 4 — Alias name budget for a long layer name

Covers story 006, AC5.

**Preparation:** `Testbed`, Overview tab.

**Steps:**
1. Create one more layer: **New layer**, name it something well over 32 characters, e.g.
   `ThisLayerNameIsDefinitelyLongerThanThirtyTwoCharacters`, mode **Toggle**, trigger key `B`,
   **Create layer**.
2. Bind any key inside it (e.g. `N` to `say hi`).
3. Click **Show generated aliases** on this layer.

**Expected result:** every alias name shown (the dispatch alias and its two halves) is
truncated/slugged well under 32 characters, and they are still distinct from each other and from
`Drops`/`Zoom`'s own alias names from the earlier use cases — no visible collision. `MAX_ALIAS_NAME`
is never exceeded no matter how long the layer's display name is (AC5).

---

## Use case 5 — Layers and binds persist to disk and across a restart

Covers story 006, AC6 (write side).

**Preparation:** `Testbed` is assigned to **R1Q2 Client** and has the binds/layers from Use cases
1–4.

**Steps:**
1. Open the **Write targets** tab. Click **Preview…** on the R1Q2 Client row.
2. Close the preview. Close the launcher entirely and run `npm run dev` again.
3. Open **Config → Testbed → Overview**.

**Expected result:**
- Step 1: the preview's `q2l-profile-<id>.cfg` content shows, in order, the `set` (cvar) block,
  then an `alias` block containing every layer's generated aliases (`Drops`, `Zoom`, and the long-
  named one), then the `bind` block — including `bind W "+forward"`, `bind ALT "+drops"`, `bind V
  zoom`, and this layer's own trigger bind.
- Step 3: after the restart, `W` is still bound to `+forward` on the base layer, and all three
  layers (`Drops`, `Zoom`, the long-named one) are still listed in the **Alt layers** panel with
  their overrides intact.

---

## Use case 6 — In-session profile-switch bind

Covers story 007, AC1–AC5.

**Preparation:**
- Create a second profile, empty, named `CTF`.
- Assign both `Testbed` and `CTF` to **R1Q2 Client** (via each profile's "N of M assigned"
  popover). Make sure `Testbed` is the **default** for R1Q2 Client (it already is, being the first
  and so far only assignment from earlier use cases; if not, open its assignment popover and click
  **Set default** on the R1Q2 Client row).

**Steps:**
1. On the Config **list** screen (not inside a profile), find the **By installation** panel. The
   **R1Q2 Client** row now shows a **Switch key** control (it appears only once an installation has
   2 or more assigned profiles — AC5).
2. Click **Use F9** (the quick-suggest button shown while no key is set).
3. Open `Testbed` → **Write targets** → **Preview…** on R1Q2 Client.
4. Save the file to disk (edit any cvar on `Testbed` so a real write happens, or just note the
   preview content — see Expected result).
5. Launch **R1Q2 Client** (bottom action bar → **Play**). In-game, open the console and press
   **F9** once. Press it again. Press it a third time.
6. Quit the game. Back in the launcher, re-open the **By installation** panel: check R1Q2 Client's
   default assignment.
7. Launch **R1Q2 Client** again and watch which profile it comes up on.
8. Back in the launcher, on either profile's assignment popover, uncheck **R1Q2 Client** for `CTF`
   (leaving only `Testbed` assigned there).

**Expected result:**
- Step 2: the control now shows an `F9` badge and a **Clear** button instead of "Not set"/"Use F9"
  (AC1 — a user-assignable key, no fixed default beyond the suggestion).
- Step 3: `baseq2/autoexec.cfg`'s preview content contains the `exec` of the *default* profile
  (`Testbed`) followed by a `q2l_sw…`-style alias chain and a `bind F9 q2l_switch` line (AC4,
  written through the same pipeline as story 004's writes).
- Step 5: the first **F9** press echoes the *other* profile's name to the console (`CTF`, since the
  chain starts at the default's successor — decision 7), the second press echoes `Testbed` again,
  and a third keeps cycling with no dead press (AC2).
- Step 6: R1Q2 Client's default assignment is still `Testbed`, unchanged by any amount of pressing
  F9 in-game (AC3 — the switch is session-only).
- Step 7: the game launches on `Testbed` again (the still-unchanged default).
- Step 8: after unassigning `CTF`, R1Q2 Client now has fewer than 2 assigned profiles — the Switch
  key control disappears from the By-installation panel, and the next save/preview for `Testbed`
  shows a loader with no alias chain and no `bind F9` line at all (AC5, disk side).

---

## Use case 7 — Advanced tab: built-in and custom categories

Covers story 008, AC1.

**Preparation:** open `Testbed` → **Advanced** tab (re-assign `CTF` back to R1Q2 Client first if
you want Use case 6's control visible again; not required for this use case).

**Steps:**
1. Look at the category rail: **Movement**, **Weapons**, **Weapon dropping** are listed, each with
   a **Built-in** badge, and none of them shows a delete icon.
2. Click **New category**. Name it `Team messages`, set **Entry kind** to **Message**, click
   **Create category**.
3. Click **New category** again. Name it `Timings`, leave **Entry kind** on **Bind**, click
   **Create category**.

**Expected result:** both `Team messages` and `Timings` appear as chips next to the built-ins, each
carrying its entry-kind badge (**Message** / **Bind**) and, unlike the built-ins, a rename (pencil)
and delete (trash) icon (AC1 — built-ins plus user-defined custom categories).

---

## Use case 8 — Multi-command action, auto-split and key assignment

Covers story 008, AC1 (actions), AC4 and AC5.

**Preparation:** `Testbed`, Advanced tab, **Weapon dropping** category selected.

**Steps:**
1. Click **Add action**, name it `RL drop`, click **Create action**.
2. On the new `RL drop` row, click the **Edit commands…** icon.
3. In **Pick from the catalogue**, type `rocket` into the filter and click the **Rocket Launcher**
   entry.
4. In **Add a raw command**, type `say Dropped the RL!` and click **Add**.
5. Click **Press a key…**, then press `3` on your keyboard.
6. Click **Save**.
7. Go to the **Overview** tab and find the `3` key.
8. Back in Advanced, re-open `RL drop`'s editor. Repeatedly add a long raw command (e.g. a `say`
   followed by ~100 filler characters) via **Add a raw command** — eight to ten additions of that
   size is enough — watching the byte counter next to **Commands**.
9. Click **Save**, then check **Write targets → Preview…** for R1Q2 Client.

**Expected result:**
- Step 3: two commands appear in the list — `drop rocket launcher` and `drop rockets` (the
  Rocket Launcher's own ammo) — added together from one catalogue click.
- Step 4: a third command, `say Dropped the RL!`, appears below the first two, in order.
- Step 7: the `3` keycap now shows as bound, with a label derived from the drop commands (not a
  bare `q2l_a_…` alias name) — proving `resolveAliasChain` expands this story's own generated
  aliases (AC5).
- Step 8: once the running total crosses roughly 1000 bytes, a **"Splits into N parts"** badge
  appears next to the byte counter (AC4 — the auto-split, surfaced before saving).
- Step 9: the preview's `q2l-profile-<id>.cfg` contains one `alias q2l_a_…` per action plus, once
  split, `q2l_a..._p1`/`_p2` part aliases the parent calls in order — every emitted line stays well
  under 1024 bytes when inspected with a text editor that shows line length.

---

## Use case 9 — Message editor: macros, symbol picker, alternate charset

Covers story 008, AC2 and AC3.

**Preparation:** `Testbed`, Advanced tab, the `Team messages` category created in Use case 7.

**Steps:**
1. Select **Team messages**, click **Add action**, name it `Help call`, click **Create action**.
2. Click its **Edit commands…** icon — this opens the message editor (not the command editor),
   because the category's entry kind is **Message**.
3. Leave **Channel** on **Team (say_team)**. In the **Message text** field, type `[ HELP ] `.
4. Click **My location** under "Insert a location variable".
5. Click `%h` under "Insert a server macro".
6. Look at the **Preview** line below the text field.
7. Click into the text field after the inserted tokens and type `$loc_here` (a single dollar sign).
8. Select a few characters you typed earlier (click-drag with the mouse, or Shift+Arrow) and click
   **Alternate charset** under **Symbols**.
9. Click one of the symbol buttons under **Symbols** (e.g. the bullet-point one) to insert it at
   the cursor.
10. Click **Save**.
11. **Write targets → Preview…** for R1Q2 Client; open the previewed/written file with a
    byte-accurate text editor if you have one.

**Expected result:**
- Step 4–5: `$$loc_here` and `%h` are inserted into the text at the cursor.
- Step 6: the preview line renders `$$loc_here` and `%h` visually differently from the plain text
  around them, and differently from each other — the meta-variable and the server-substituted
  macro are two distinct visual styles (AC2).
- Step 7: a warning appears explaining that `$loc_here` (single dollar) expands an empty cvar and
  prints nothing, suggesting `$$loc_here` instead.
- Step 8: the selected run renders in a distinct (greenish) colour in the preview — the alternate
  Latin-1 charset toggle applied to a selection (AC3).
- Step 9: the inserted symbol shows up in both the input field and the preview.
- Step 11: the message line in the written file carries the high-bit alternate-charset bytes and
  the inserted glyph's byte value exactly as composed — not re-encoded as UTF-8 (AC3, "round-tripped
  byte-for-byte"). A hex/byte-accurate editor is the only way to actually confirm this — a normal
  text editor may silently reinterpret the high bytes when displaying them, which is not evidence
  of a bug, just of the wrong tool for looking.

---

## Use case 10 — Validator: single-engine findings and unsaved-edit reflection

Covers story 009, AC1 and AC4.

**Preparation:** `Testbed` assigned to **R1Q2 Client** only for now (unassign Q2PRO/Vanilla if you
assigned them earlier while exploring).

**Steps:**
1. Open `Testbed` → **Validation** tab.
2. Go to **Settings**, find **Render FPS cap** (`r_maxfps`), set it to `0`.
3. Immediately switch back to **Validation** — do not wait for the "Saving…"/"Saved" label in
   Settings to settle first.
4. Go to **Settings**, find **Player name**, type a value containing a double quote, e.g.
   `Fra"gger`.
5. Switch back to **Validation**.

**Expected result:**
- Step 1: one section named **R1Q2** is shown (the only engine reached through `Testbed`'s
  assignments), with an equally-weighted error/warning count badge (or "No findings").
- Step 3: an error-level finding already names `r_maxfps` and explains R1Q2's "clamps anything
  below 5 up to 5" behaviour — visible before the Settings tab's own debounced save has fired
  (AC4 — reflects the in-progress edit, not just what is saved on disk).
- Step 5: a second finding appears explaining that the value on that line contains a quotation
  mark of its own and that Quake II has no escape character inside a quoted value — again visible
  immediately, without saving first.

---

## Use case 11 — Validator: multiple engines, buffer-size discard, and "nothing to validate against"

Covers story 009, AC1–AC3.

**Preparation:** `Testbed` from Use case 10 (still has the `r_maxfps 0` and quoted-name edits).

**Steps:**
1. Assign `Testbed` to **Q2PRO Client** as well (via its assignment popover), keeping R1Q2 Client
   assigned too.
2. Open the **Validation** tab.
3. Assign `Testbed` to **Vanilla Client** too. In **Settings**, select **Player name** and replace
   its value with a very long string — paste roughly 8,500 characters (any repeated text is fine;
   the exact count only needs to clear vanilla's much smaller buffer, not R1Q2's or Q2PRO's).
4. Open **Validation** again.
5. Unassign `Testbed` from all three installations (R1Q2, Q2PRO, Vanilla).
6. Open **Validation**.

**Expected result:**
- Step 2: two equally-weighted sections are shown, **R1Q2** and **Q2PRO** side by side; the
  `r_maxfps 0` finding from Use case 10 appears only under R1Q2 (Q2PRO reads `0` as "unlimited") —
  neither section is presented as more authoritative than the other (AC1, no primary/portability
  tiering).
- Step 4: a third section, **Quake II (original)**, appears; it reports the rendered profile file
  as exceeding vanilla's ~8190-byte command-buffer size and being discarded *entirely*, while the
  R1Q2 and Q2PRO sections do not report the same file as over their own (much larger) limits.
- Step 6: instead of any engine section, the tab shows an explicit **"Nothing to validate
  against"** empty state naming that the profile isn't assigned to any installation — never a
  silent pass, and never R1Q2's numbers substituted in (AC3).

---

## Use case 12 — Validator: structural findings via a hand-typed alias (advanced/optional)

Covers story 009, AC2 (alias name length and duplicate-name detection). This use case is more
involved than the others and can be treated as optional if time is short — see the Known gaps
section below for why it is the only practical UI path to these two specific findings.

**Preparation:** `Testbed`, assigned to at least R1Q2 Client, Advanced tab, any bind-kind category
(e.g. **Weapon dropping**).

**Steps:**
1. Add an action, e.g. `AliasTest`. Open its **Edit commands…** editor.
2. In **Add a raw command**, type `alias averylongaliasnamewellovertheusuallimit echo hi` and click
   **Add**. Click **Save**.
3. Open **Validation**.

**Expected result:** a finding appears naming that alias (`averylongaliasnamewellovertheusuallimit`)
as too long for `MAX_ALIAS_NAME` (32), because the validator inspects the *rendered* profile text
for any `alias <name>` line regardless of where it came from — including one a user typed by hand
into a raw command, not just the ones story 006/008's own generators produce (which always stay
within the 32-character budget on their own).

---

## Use case 13 — Cleanup: scan, review, remove with backup, and undo

Covers story 010, AC1–AC4.

**Preparation:**
- On disk, in **R1Q2 Client**'s installation folder: put a file `baseq2/gl_settings.cfg` with some
  content, e.g. `set gl_shadows "1"`. Copy that exact file into a known mod folder, e.g.
  `rogue/gl_settings.cfg` (create the `rogue` folder if it doesn't exist — it's one of the
  launcher's recognized mod-directory names, same as `xatrix` in S01's prerequisites). Additionally
  create `rogue/config.cfg` with content that *differs* from whatever `baseq2/config.cfg` currently
  holds (or create both fresh with different content).
- If `Testbed` has ever been assigned to R1Q2 Client and played into `rogue` (per story 004), that
  folder may already contain an `autoexec.cfg` written by the launcher itself — leave it as is.

**Steps:**
1. On the Config **list** screen, scroll to the **Redundant config copies** panel.
2. Pick **R1Q2 Client** from the installation dropdown, click **Scan**.
3. Look at the findings list.
4. Check that `rogue/gl_settings.cfg` is pre-checked and `rogue/config.cfg` is present but
   unchecked.
5. Click **Remove selected**. In the confirmation dialog, note the file count, then click
   **Remove**.
6. Using a file manager, open the `rogue` folder.
7. Back in the launcher, click **Undo removal**.
8. Re-scan (click **Scan** again).
9. Launch **R1Q2 Client**. While it is running, repeat steps 2–5 (**Scan**, then **Remove
   selected** on whatever is found, then confirm).

**Expected result:**
- Step 3: `rogue/gl_settings.cfg` is listed. `rogue/config.cfg` is listed too, but flagged with a
  **Differs from baseq2** badge (decision 3 — only byte-identical copies are pre-selected).
  `rogue/autoexec.cfg` (if present, written by story 004's own pipeline) and any
  `q2l-profile-*.cfg` file are never listed — the scan excludes launcher-owned files (AC1, the
  exclusion).
- Step 5: the confirmation names the number of files about to be removed before anything happens
  (AC2 — reviewed before deletion) — for the setup above, that is 1 file (`gl_settings.cfg`), since
  `config.cfg` was never checked in step 4. The result panel afterward reports "1 file removed."
- Step 6: `rogue/gl_settings.cfg` is gone from disk; `rogue/gl_settings.cfg.q2l-backup` exists and
  holds the original content byte-for-byte; `rogue/config.cfg` is untouched; nothing in `baseq2` was
  touched (AC3, AC4 — only the mod folder, never the reference `baseq2` copy).
- Step 7: `rogue/gl_settings.cfg` is back on disk, byte-for-byte identical to before, and the
  `.q2l-backup` file is still there afterward (undo keeps the backup rather than consuming it) —
  AC3, "recoverable" exercised through the real UI, not a file-manager workaround.
- Step 8: the re-scan lists `rogue/gl_settings.cfg` again, since it is back and still redundant.
- Step 9: the panel reports the installation as currently running and removes nothing on disk —
  `scan` itself still worked (it is always allowed), only `apply` was refused.

---

## Known gaps

A few behaviors named in this sprint's stories have no direct, natural path through the real UI,
or only an indirect one. Reported here rather than as a fabricated or console-based UI step, per
this project's UI-acceptance policy:

- **Alias loop-depth and cycle findings (story 009 AC2) have no natural UI path at all.** Every
  alias generator shipped this sprint (layers in story 006, the switch-bind chain in story 007,
  actions in story 008) nests at most two or three aliases deep and never has one call back into an
  earlier one — well inside the engine's 16-level `ALIAS_LOOP_COUNT`. A user could, in principle,
  manufacture a real loop by typing two raw commands like `alias loopA loopB` and `alias loopB
  loopA` into two different actions' raw-command fields (the same mechanism Use case 12 uses for
  the alias-name-length finding), but this is contrived rather than a use case an actual player
  would hit, so it is not written up as a numbered use case above. The alias-name-length half of
  the same acceptance criterion *is* covered, in Use case 12, using exactly this "type a raw
  console command by hand" path.
- **Q2PRO's and R1Q2's own buffer-overflow findings (story 009 AC2, the ~64 KB thresholds) are
  impractical to trigger by hand.** Use case 11 only exercises vanilla's much smaller ~8190-byte
  limit, which a single long pasted cvar value can cross. Reaching R1Q2's 65534-byte or Q2PRO's
  65535-byte (compressed) thresholds through typing/pasting in the UI would need tens of thousands
  of characters of profile content — technically possible but not a reasonable manual test step.
  These two engines' overflow behavior is exercised by the automated test suite
  (`validate-structure.test.ts`) instead; this document only confirms the *pattern* (an
  over-budget file is reported per-engine, with that engine's own consequence) via vanilla's
  smaller number.
- **The "unresolved" validation/engine-scope state (a profile's assignment pointing at an
  installation that no longer exists) is not exercised here.** Reaching it needs removing an
  installation from the Library while a profile still references it, which is a Library-module
  action from an earlier sprint, not part of stories 006–010 themselves. If your Library supports
  removing a registered installation, assigning `Testbed` to it and then removing it from the
  Library should reproduce this state on both the Settings tab's engine-facts selector and the
  Validation tab; this document does not require it as a numbered step since it is not new S02
  behavior.
- **Byte-exactness of the Latin-1/alternate-charset message content (story 008 AC3, Use case 9's
  last step) can only really be confirmed with a hex-capable or byte-accurate editor.** A normal
  text editor may re-render or re-save high-byte (0x80–0xFF) characters through its own encoding
  assumptions, which would look like a bug but is a property of the tool, not the launcher. Use a
  hex viewer, or a text editor explicitly set to open the file as Latin-1/ISO-8859-1, to actually
  check this.
- **The layer trigger key cannot be changed after creation.** This is not a missing UI path so
  much as a deliberate scope line documented in story 006's own "Done" section: `LayersPanel`'s
  rename dialog only edits the name; changing which key triggers an existing layer requires
  deleting and re-creating it. Worth knowing so it isn't mistaken for something Use cases 2–4
  should have exposed but didn't.
