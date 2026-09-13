# Sprint S10 — manual acceptance test plan

Covers the two stories built in this sprint:

- **050** — The metadata tag carries only what the file cannot say itself (commit `7212f6a`)
- **045** — Toggle and press/release entries (commit `6739f9d`)

`ui-acceptance-required: true` is set for this project: every step below is something you click,
type or read in the running app. A terminal is used only to start the app and, once, to hand-write
a sample `.cfg` for the import test (case 9) — writing that file is test-content preparation, not a
launcher action. Opening the launcher's own rendered file in a text editor (cases 4, 5, 10) is how a
real player would hand-edit a config; the launcher has no built-in file editor to route that through
instead.

No prior knowledge of the codebase is assumed. Every field/button name below is quoted exactly as it
appears in the app.

## Preparation (once)

1. From a terminal in the repository root: `npm install` (first time only), then `npm run dev`. The
   Electron window opens.
2. You need at least one Quake II installation already registered in the launcher (**Library** in
   the left navigation → **+ Add installation** or similar — this is existing functionality from
   before this sprint, not part of it). Any installation works; note its detected engine (shown on
   its card), which is normally **r1q2**.
3. Open the **Config** module from the left navigation.
4. Click **New profile**. In the **Create config profile** dialog, leave **Start from** on
   **Empty profile**, type a **Name** of `S10 Test`, click **Create profile**. The app navigates into
   the new profile's detail screen, starting on its **Overview** tab.
5. Assign the profile to your installation (needed later for case 10, the Care report check): click
   the **"0 of 1 assigned"**-style button in the top-right of the profile header (link icon), tick
   your installation's checkbox in the popover, close the popover.
6. Click the **Controls** tab. You land on the **Movement** category by default.

Keep this profile and window open — cases 1 through 8 and 10 build on it in sequence. Case 9 creates
a second, separate profile.

---

## Story 050 — the tag shrinks, key slots move to file order

### Case 1 — Binding a catalogue entry writes the reduced tag

**Steps**
1. Still on **Controls → Movement**, find the **Forward** row.
2. Click its **Primary** cell (reads "Empty"). It switches to "Press a key…". Press `G`.
3. The top save bar now reads **"Unsaved changes"**. Click **Save**.
4. Click the **Raw file** tab. Under **"This profile's file"**, the code view shows the whole
   rendered `.cfg`. Use its search field (magnifying-glass icon) to find `+forward`.

**Expected result**
- A line reads `bind g "+forward"   // Forward [q2l cid=movement:forward]` (key may render lower-
  or upper-case, that's fine).
- The comment carries only `cid=`. There is no `e=`, no `k=`, and no `slot=` anywhere in the file —
  you can confirm this by also searching for `e=`, `k=` and `slot=` and finding no `[q2l …]` tag
  containing them.

### Case 2 — An entry with no catalogue link gets the bare `[q2l]` marker

**Steps**
1. Back on **Controls**, click **+ New category** in the category rail. Name it `S10 Test`, click
   **Create category**. It becomes the selected category.
2. Click **Add action**. Name `Ping`, **Entry kind** `Bind`, click **Create action**.
3. On the new **Ping** row, click the **Edit commands…** icon (slider icon).
4. In the **Add a raw command** field type `screenshot`, click **Add**. Click **Save** to close the
   editor.
5. Back in the grid, click **Ping**'s **Primary** cell, press `P`.
6. Click **Save** in the top bar.
7. **Raw file** tab → search for `Ping`.

**Expected result**
- A line reads `bind p "screenshot"   // Ping [q2l]` — the bare marker tag, no `cid=` at all (this
  entry has no catalogue link).

### Case 3 — A second, modified key writes an anchor line

**Steps**
1. Still on **Controls → S10 Test**, click **Ping**'s **Secondary** cell ("Press a key…").
2. Hold **Alt**, then press `R`, release both. The cell now reads `ALT` + `R`.
3. Click **Save** in the top bar.
4. **Raw file** tab → search for `Ping` again.

**Expected result**
- Ping's own command line is unchanged.
- A second, comment-only line appears in the `S10 Test` section (no matching `bind` line for that
  key — a modifier can't be written as a plain `bind`): `// Ping [q2l key=r mod=ALT]` (or
  `key=R`/`mod=ALT` in whatever case the app renders). No `slot=` field.

### Case 4 — A hand-added third key survives a reload (multi-slot from file order)

**Steps**
1. **Raw file** tab → under **"This profile's file"**, click the **Open in editor** icon (external-
   link icon) next to the path. Your OS's default text editor opens the file.
2. Find the line `bind g "+forward"` (from case 1). Directly below it, add a new line:
   `bind h "+forward"` — pick any key you haven't used yet in this walkthrough if `h` happens to be
   taken. Save the file and close the editor.
3. Back in the launcher, open the **Care** tab. Under its **Sync** section, the
   **"This profile's file"** row now reads **"Changed outside the launcher"**. Click **Reload**.
4. Check the **Care** tab's **Preserved lines** section (scroll down, above **Sync**).
5. **Raw file** tab → search for `+forward` again.

**Expected result**
- Step 3: after Reload, no error toast, and the **Sync** row for "This profile's file" now reads
  **"In sync"**.
- Step 4: the hand-added `bind h "+forward"` line is **not** listed as an unrecognised/preserved
  line — it was correctly folded into the Forward entry as its third key slot, recovered purely
  from file order (no `slot=` field involved).
- Step 5: both `bind` lines for `+forward` (`g` and `h`) are present, each still tagged
  `// Forward [q2l cid=movement:forward]`. The Controls grid itself still only shows one editable
  slot for Forward (its Primary, `G`) — the third key (`H`) is preserved and rendered, just not
  editable from this screen; that is expected, not a bug (see the note on known limitations below).

### Case 5 — Known, accepted drift: an inconsistently renamed anchor splits the entry

**Steps**
1. **Raw file** tab → **"This profile's file"** → **Open in editor**.
2. Find the comment-only anchor line from case 3: `// Ping [q2l key=r mod=ALT]`. Change **only this
   line's** display name from `Ping` to `Pong`, leaving Ping's own command line's comment untouched.
   Save, close the editor.
3. **Care** tab → **Sync** → the canonical row reads "Changed outside the launcher" again → click
   **Reload**.
4. **Controls** tab → **S10 Test** category.

**Expected result**
- Two separate rows now exist in this category: **Ping** (Primary = P only, no more Secondary) and
  a new row named **Pong** carrying the `Alt+R` key with no commands of its own.
- No crash, no lost line, no error toast — this is the documented accepted drift (the anchor lost
  its link to Ping because it no longer shares Ping's exact prose; see the "known limitations" note
  at the end of this document). Do not report this split as a bug.

---

## Story 045 — toggles, press/release pairs and `wait` chains

### Case 6 — Create and bind a toggle

**Steps**
1. **Controls** tab → **+ New category** → name `S10 Idioms` → **Create category**.
2. **+ Add action** → Name `Zoom`, **Entry kind** `Toggle` → **Create action**.
3. On the new **Zoom** row, click **Edit commands…**.
4. Under **State 1** (left): **Label** field → type `In`. **Add a raw command** field → type
   `echo zoom-in`, click **Add**.
5. Under **State 2** (right): **Label** → `Out`. Raw command → `echo zoom-out`, **Add**.
6. Under **Key** (bottom of the dialog): click **Press a key…**, press `V`.
7. Click **Save** to close the editor, then **Save** in the top bar.
8. **Raw file** tab → search for `zoom`.
9. **Overview** tab → find the `V` keycap on the board.

**Expected result**
- Step 8: three `alias` lines plus one `bind` line, e.g. (exact command text may wrap differently):
  `alias zoom_s1 "echo zoom-in; alias zoom zoom_s2"   // Zoom [q2l lbl=In]`
  `alias zoom_s2 "echo zoom-out; alias zoom zoom_s1"   // Zoom [q2l lbl=Out]`
  `alias zoom "zoom_s1"   // Zoom [q2l]`
  `bind v "zoom"`
  No `cid=` (no catalogue link for this entry), no `e=`, `k=` or `slot=` anywhere.
- Step 9: the `V` keycap's second line of text reads **"Zoom: In / Out"** — not `zoom_s1` and not
  just "Zoom" with no state information. This is AC2's "one thing with two states" requirement.

### Case 7 — Create, rename and delete a press/release entry

**Steps**
1. **Controls → S10 Idioms** → **+ Add action** → Name `slow`, **Entry kind** `Press/release` →
   **Create action**.
2. On the **slow** row, **Edit commands…**. Under **Press**: raw command `echo press`, **Add**.
   Under **Release**: raw command `echo release`, **Add**.
3. **Key** section → **Press a key…** → press `T`.
4. **Save** (dialog), then **Save** (top bar).
5. **Raw file** tab → search for `slow`.
6. Back in **Controls**, on the **slow** row click the **Rename…** icon (pencil). Change **Name** to
   `walk`, click **Save**. Then **Save** in the top bar.
7. **Raw file** tab → search for `walk`.
8. **Controls** → on the **walk** row, click **Remove…** (trash icon). Then **Save** in the top bar.
9. **Raw file** tab → search for `walk` and for `slow` again.

**Expected result**
- Step 5: `alias +slow "echo press"   // slow [q2l]`, `alias -slow "echo release"   // slow [q2l]`,
  and `bind t "+slow"` — exactly one entry rendered as an `+x`/`-x` pair, no `cid`/`e`/`k`/`slot`.
- Step 7: both alias lines and the bind now read `+walk` / `-walk` — renaming moved both halves at
  once, from one edit.
- Step 9: after Remove + Save, neither `+walk`/`-walk` alias lines nor the `bind t` line exist any
  more anywhere in the file — deleting removed both halves.

### Case 8 — Adding a `wait` without typing it

**Steps**
1. **Controls → S10 Idioms** → **+ Add action** → Name `Jump wait`, **Entry kind** `Bind` →
   **Create action**.
2. **Edit commands…** → under **Frames**, the field already shows `5`; click **Add wait**. A row
   appears reading **"Wait × 5"**.
3. **Key** section → **Press a key…** → press `J`.
4. **Save** (dialog), then **Save** (top bar).
5. **Raw file** tab → search for `Jump wait`.
6. Back in **Controls**, click **Edit commands…** on the **Jump wait** row again.

**Expected result**
- Step 5: `bind j "wait; wait; wait; wait; wait"   // Jump wait [q2l]` — five literal `wait`
  segments, never the word "wait" typed by you.
- Step 6: the command list still shows exactly **one** row, "Wait × 5" — not five separate rows.
  The round trip collapses a run of literal `wait`s back into one command.

### Case 9 — Importing a foreign config recognises all three idioms, and falls back where one is broken

This case creates its own, separate profile — it does not touch `S10 Test`.

**Preparation**
1. Locate the `baseq2` folder inside the Quake II installation you registered in step 2 of the
   overall preparation. **If that installation already has a `config.cfg` you care about, back it
   up first** — this step overwrites it.
2. Using any text editor, create/overwrite `baseq2/config.cfg` with exactly this content:
   ```
   alias zoomin  "echo zoom-in;alias zoom zoomout"
   alias zoomout "echo zoom-out;alias zoom zoomin"
   alias zoom    "zoomin"
   bind v "zoom"

   alias +slow "echo press"
   alias -slow "echo release"
   bind SHIFT "+slow"

   alias wait5 "wait;wait;wait;wait;wait"

   alias badstate1 "echo a;alias badtoggle badstate1"
   alias badstate2 "echo b;alias badtoggle badstate1"
   alias badtoggle "badstate1"
   ```
   The last three lines are a **deliberately broken** toggle: both states reassign the dispatch back
   to `badstate1` instead of forming a proper two-state cycle.
3. Save the file.

**Steps**
1. Config module → profile list → **New profile** → **Start from** → **Import from installation** →
   **Continue**.
2. **Installation** → pick the installation you just edited. **Game directory** → `baseq2` (should
   be pre-selected once it's the only/first candidate). Wait for the preview to load.
3. **Name** → type `S10 Import Test`. Click **Create profile**.
4. The app opens the new profile on its **Overview** tab — click **Controls**.
5. In the category rail, click the **Imported** chip (created automatically by the import, since
   none of these commands match the movement/weapons/drops guesses).

**Expected result**
- Exactly one row named **zoom** — not three separate `zoom`/`zoomin`/`zoomout` rows. Opening its
  **Edit commands…** shows the two-state **Toggle** editor (State 1/State 2), confirming it was
  recognised as a toggle, not left as a plain alias.
- Exactly one row named **slow** (its editor shows **Press**/**Release** sections), not two separate
  `+slow`/`-slow` rows.
- One row named **wait5** whose editor shows a single "Wait × 5" row, not a raw 5-`wait` command
  chain.
- Three **separate** rows: **badstate1**, **badstate2**, **badtoggle** — the broken trio was *not*
  merged into a toggle; each imports as its own plain alias entry, per AC4's "falls back rather than
  guessing".

---

## Care reports the broken shapes — on real, bound entries

### Case 10 — toggleCrossWired / pressWithoutRelease / releaseWithoutPress

Back on the **`S10 Test`** profile (not the import one), which is already assigned to your
installation (overall preparation, step 5) — this is required for the Care tab's validation report
to show anything at all (see the note at the end of this case).

**10a — a bound toggle, corrupted into a cross-wired pair**

1. **Raw file** tab → **"This profile's file"** → **Open in editor**.
2. Find `alias zoom_s1 "echo zoom-in; alias zoom zoom_s2"` (from case 6). Change its trailing target
   so it also reassigns to `zoom_s1` instead of `zoom_s2` (i.e. both states now point at
   `zoom_s1`). Save, close the editor.
3. **Care** tab → **Sync** → **Reload**.
4. Scroll to the top of the **Care** tab, just under the **Overview** summary strip — the engine
   panel (titled with your installation's engine, e.g. **r1q2**).

**Expected result**
- The engine panel lists a warning naming `zoom`/`zoom_s1`/`zoom_s2` (or your own state names),
  saying the two states are cross-wired and never loop between the two — the message says to
  recreate it as a toggle entry or fix the trailing `alias zoom …` line.
- **Controls → S10 Idioms** now shows the trio as three separate plain rows (`zoom`, `zoom_s1`,
  `zoom_s2`) instead of one Toggle row — `V` is still bound (to whichever alias `zoom` still
  resolves through), just no longer recognised as a first-class toggle.

**10b — a bound press half with no matching release (the realistic, bound case)**

1. **Controls → S10 Idioms** → **+ Add action** → Name `crouch`, **Entry kind** `Press/release` →
   **Create action**. **Edit commands…** → Press: `echo press`, Release: `echo release`. **Key** →
   press `K`. **Save**, then **Save** in the top bar.
2. **Raw file** tab → **Open in editor**. Delete the whole line
   `alias -crouch "echo release"   // crouch [q2l]`. Save, close the editor.
3. **Care** tab → **Sync** → **Reload**.
4. Check the engine panel again.

**Expected result**
- A warning names `+crouch` as a press command with no matching release alias — and this is a real,
  key-bound entry (`K` is still bound to `+crouch` on the Controls tab, now shown as a plain **Bind**
  row named `+crouch`, not an orphaned, unbound alias sitting unreferenced anywhere).

**10c — a release half with no matching press**

1. **Raw file** tab → **Open in editor**. Inside the `S10 Idioms` section (between its
   `// --- Entries: S10 Idioms ...` banner and the next section banner), add a new line:
   `alias -limp "echo release"   // limp [q2l]`. Save, close the editor.
2. **Care** tab → **Sync** → **Reload**.
3. Check the engine panel again.

**Expected result**
- A warning names `-limp` as a release command with no matching press alias.

**Note on why the profile must be assigned:** these three checks are part of the per-engine
validation report (the same panel that lists structural/cvar findings), which only runs against
engines the profile is actually assigned to. An unassigned profile's Care tab shows an empty
"nothing to validate against" state here instead — not a bug, just this panel's existing scope rule
from an earlier sprint.

---

## Known, out-of-scope edge cases (do not chase these as bugs)

- **050:** two entries in the same category whose *display names* both derive the same alias slug
  (e.g. an entry named `Fire` and one named `fire!` both derive the alias `fire`) can still lose one
  of them if you hand-edit the file to create that exact collision and then reload — a warning toast
  now fires when this happens, but the dropped entry is not recovered. This needs a hand-crafted
  name collision; it will not come up from normal use.
- **045:** three entries whose *full, never-truncated* display names form an exact prefix chain
  (e.g. "Creep" / "Creep along" / "Creep along slowly"), each on a long enough line, can still merge
  into one entry on reload under specific conditions. This also needs deliberately hand-crafted
  names; it is not reachable through ordinary use of the app or its own generated names.

## UI-path coverage

Every user-facing capability named in stories 050 and 045 was reachable and testable through the
real UI above — no console command, direct function call, or other workaround was needed for any of
it. No P1 gap to report.
