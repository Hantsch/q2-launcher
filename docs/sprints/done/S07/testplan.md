# Sprint S07 — Manual test plan

Covers the four finished stories of this sprint — **038** (no alias line for an action the engine
can bind directly), **039** (aliases get readable names, and must be unique), **040** (the profile
file is written structured, commented and human-readable), **041** (import understands aliases,
press/release pairs and `unbindall`).

Every step below is a real action in the running app: clicking, typing, opening a dialog. The only
place a console/terminal is used is to *start* the app (and, for story 041, to copy three fixture
files into a folder before starting it) — never as a substitute for a UI action.

## Preparation

1. `npm install` (first time only), then `npm run dev` to start the app.
2. You need at least one registered installation: **Library** → **Add existing** (a real Quake II
   folder) or **Create new** (an empty folder is fine for everything except story 041's import,
   which needs real config files — see step 4).
3. For stories 038/039/040, create one throwaway config profile you'll reuse across their use
   cases: **Config** → **New profile** → leave "Start from" on **Empty profile**, give it any name
   (e.g. `S07 test`) → **Create profile**. Nothing about this profile needs to pre-exist — every
   action, bind and cvar used below is created live through the UI.
4. For story 041's import use cases only: copy the three committed fixture files —
   `docs/fixtures/dm.cfg`, `docs/fixtures/dmalias.cfg`, `docs/fixtures/gfx.cfg` — into your
   installation's `baseq2` folder (File Explorer, not the launcher), and create a text file
   `baseq2/autoexec.cfg` in the same folder containing exactly these three lines:
   ```
   exec dm.cfg
   exec dmalias.cfg
   exec gfx.cfg
   ```
   This is the same real, ~20-year-old DM config the story's own acceptance criteria are written
   against — nothing about it is invented for this test plan.

---

## Story 038 — No alias line for an action the engine can bind directly

### 1. Binding a catalogue "continuous" action never gets a dead alias line

- Open **Config** → your test profile → tab **Controls** → category **Movement** (already
  selected by default).
- Find the **Crouch** row. Click its (empty) primary key slot, then press **C** on your keyboard.
- **Expected:** the slot now shows `C`, and a "Saving…" / "Saved" indicator appears near the
  Controls heading.
- Switch to tab **Raw file**. In the search box ("Find in file…"), type `movedown`.
- **Expected:** exactly one line is highlighted, `bind c "+movedown"` (or similar, depending on
  alignment) — and it is a `bind` line, not an `alias` line. There is no `alias …movedown…` line
  anywhere in the file. This is the exact bug story 038 fixes: an action the engine can bind
  directly (`+movedown`) no longer gets a pointless alias wrapped around it.

---

## Story 039 — Aliases get readable names I control, and must be unique

### 2. A multi-command action gets a short, readable, prefix-free alias name

- Still on **Controls**, switch category to **Weapons**.
- Click **Add action**. Name it `SSG + SG`, leave Entry kind on **Bind**, click **Create action**.
- The new row appears at the bottom of the Weapons list. Click its **Edit commands…** icon
  (the sliders icon).
- In **Add a raw command**, type `use super shotgun`, click **Add**; type `use shotgun`, click
  **Add** again. Click **Press a key…**, then press **Q**. Click **Save**.
- Switch to tab **Raw file**.
- **Expected:** the file contains `alias ssg_sg "use super shotgun; use shotgun"` and
  `bind q "ssg_sg"` — a short, lowercase, prefix-free name derived from the display name, with no
  `q2l_a_` fragment anywhere. (This also confirms story 038's AC2: this alias line *is* referenced
  by its own bind, so — unlike use case 1 — it is correctly kept, not dropped.)

### 3. The own alias-name field rejects bad input and accepts good input

- Back in **Controls** → **Weapons**, click the pencil **Rename…** icon on the `SSG + SG` row.
- The dialog shows a **Name** field (`SSG + SG`) and an **Alias name** field, empty, with
  placeholder `ssg_sg`.
- Type `SSG SG` into **Alias name**.
  - **Expected:** an error appears ("…can only use lowercase letters, numbers and underscores…")
    and **Save** is disabled.
- Clear it and type `weapnext`.
  - **Expected:** a different error ("…already a built-in command or cvar…"), **Save** disabled.
- Clear it and type 40 characters of `a`.
  - **Expected:** a "too long" error, **Save** disabled.
- Clear it and type `ssg_sg2`, then click **Save**.
- Switch to **Raw file**.
- **Expected:** the file now reads `alias ssg_sg2 "…"` and `bind q "ssg_sg2"` — nothing was
  silently slugged or truncated at any rejected step above; every rejection kept Save disabled.

### 4. Two entries that collide on the same alias name get a warning, not a silent rename

- **Controls** → **Weapons** → **Add action** → name it `SSG SG` (no `+`), kind **Bind** →
  **Create action**.
- Open its **Edit commands…**, add the raw command `use super shotgun`, capture key **E**, **Save**.
  Leave its alias name unset (so it also derives to `ssg_sg`, colliding with use case 2's original
  entry only if that one's own name is still unset — if you already completed use case 3, this row
  collides with nothing yet, so first reopen the `SSG + SG` row's rename dialog and clear its
  **Alias name** field back to empty, **Save**, to restore the collision).
- Switch to tab **Care**.
- **Expected:** the validation report shows a warning naming both `SSG + SG` and `SSG SG` and the
  colliding name `ssg_sg` — one such warning per entry, no counter-suffix anywhere.
- Switch to **Raw file**.
- **Expected:** both `alias ssg_sg "…"` lines are still written (last one wins at load, which is
  exactly what the warning describes) — nothing was auto-renamed to fix the collision.
- Fix it: reopen `SSG SG`'s rename dialog, set **Alias name** to `ssg_sg_alt`, **Save**.
- **Expected:** the Care warning is gone, and Raw file now shows two distinct alias names.

### 5. Renaming the display name of a referenced alias is refused, with an escape hatch

- Switch to tab **Overview**. Find a key that shows no command (e.g. **V**) and click it.
- In the **Command** field of the dialog that opens, type `ssg_sg2` (the alias name from use case
  3), then click **Assign**.
- **Expected:** the keycap now shows that it carries a command.
- Back in **Controls** → **Weapons**, open the rename dialog for the `SSG + SG` row again, and
  change its **Name** field to `SSG Super Shotgun` — leave **Alias name** empty.
- **Expected:** **Save** is disabled and an error names the reference: "…referenced by a hand-typed
  bind on "V"… Use the Alias name field above to rename the alias itself instead."
- Now also type a value into **Alias name** (e.g. `ssg_sg2`, repeating the current name to pin it),
  keeping the new display name. **Expected:** the refusal disappears and **Save** is enabled;
  saving succeeds.
- Switch to tab **Care**: if you typed a *different* alias name than `ssg_sg2` above, the hand-typed
  bind on `V` now shows an "undefined alias" finding — expected, since only the display-name-driven
  default would have been rewritten automatically, and it deliberately is not.

---

## Story 040 — The profile file is written structured, commented and human-readable

### 6. The Raw file tab shows a structured, commented, aligned layout

- On the same profile, switch to tab **Settings** and set **Player name** to `Hantsch`, and
  **Mouse sensitivity** to `3`.
- Switch to tab **Raw file**.
- **Expected**, reading top to bottom:
  - The first line is a plain ownership-sentinel comment (still starting with `//`), followed by a
    decorative `// ===…` banner block naming the profile and a line about hand-editing.
  - An `unbindall` line directly after that banner (see use case 7).
  - A `// --- Player ---` section containing `set name "Hantsch"` and `set sensitivity "3"` (and
    any other player cvars you've touched), with values lining up in a column.
  - A `// --- Weapons ---` (or similar, matching your categories) alias section containing the
    `ssg_sg`-family alias lines from story 039's use cases, each ending in a readable trailing
    comment, e.g. `alias ssg_sg2   "use super shotgun; use shotgun"   // SSG + SG`.
  - A binds section further down with `bind q "ssg_sg2"   // SSG + SG` and `bind c "+movedown"   //
    Crouch`, also column-aligned.
  - Search/highlighting still works and still colours commands, keys, strings and comments
    differently (use the search box to find `ssg_sg2` — it should still highlight inside the
    comment too).

### 7. The per-profile `unbindall` checkbox controls the header line live

- Still on **Raw file**, find the checkbox **"Start the file with `unbindall`"** just above the
  file view. It should be checked (the default).
- Untick it.
- **Expected:** the `unbindall` line disappears from the shown file immediately — no manual
  refresh needed.
- Tick it again.
- **Expected:** it reappears in the same place, directly after the header banner.

### 8. A non-ASCII (but Latin-1) category name survives the write intact

- **Controls** → click **New category** in the category rail, name it `Nähkampf`, create it.
- Select it, **Add action**, name it `Melee`, kind **Bind**, create it, open **Edit commands…**,
  add the raw command `weapon melee` (or any text), capture an unused key, **Save**.
- Switch to **Raw file**.
- **Expected:** a section banner containing `Nähkampf` renders with the `ä` intact (no mangled
  characters, no broken line), and the rest of the file still displays normally.

---

## Story 041 — Import understands aliases, press/release pairs and `unbindall`

### 9. The import preview understands `alias` lines instead of preserving them

- **Config** → **New profile** → set **Start from** to **Import from installation** → **Continue**.
- Pick your installation, then the `baseq2` game folder (from the Preparation step).
- **Expected**, once the preview loads: **Cvars**, **Key binds**, **Aliases** and **Messages**
  counts are all non-zero (roughly 95 aliases and a handful of messages), and scrolling down to
  **Preserved lines** shows only comments, `echo` banners, ASCII banner clutter and bare startup
  commands — no line starting with `alias ` anywhere in that list.

### 10. The ambiguous `cali` construct gets its own review row, not a silent guess

- Scroll further down in the same dialog.
- **Expected:** a section reading "1 alias needs a decision", showing the `cali` alias's source
  file:line and its body (a chain of `bind` commands), with two radio options — **Import as plain
  alias** (selected by default) and **Attempt as layer**. No other alias in the preview gets this
  treatment.
- Leave the default selected, type a profile **Name**, and click **Create profile**.

### 11. The Controls tab shows imported aliases as real entries, grouped and paired

- On the created profile's **Controls** tab, look at the category rail.
- **Expected:** besides Movement/Weapons/Weapon dropping, new categories **Messages**, **Sounds**
  and **Imported** are present (drops-flavoured aliases land under **Weapon dropping**).
- Open **Movement** or **Weapons** (wherever `+slow`/`-slow` landed by the category-guess rules) and
  look for the `slow` pair.
- **Expected:** `+slow` and `-slow` render as two adjacent rows under one shared pair label — not
  as two unrelated rows scattered in the list. The same holds for `dj`, `rj`, `kl`, `zoom`.
- Find `blaster_settings` (an empty-body hook alias in the real config).
- **Expected:** it is present as its own row with no commands, not dropped and not merged into
  anything else.

### 12. Care shows no false findings for the imported cross-references

- Switch to tab **Care**.
- **Expected:** no "undefined alias" finding for `drop_shotgun` (its `bind KP_END "drop_shotgun"`
  correctly resolves to the imported alias entry), and no "unreferenced alias" finding for `wait5`
  (referenced only from inside `wait20`'s body, which still counts).

### 13. The message editor recognises a colour cvar inside an imported message

- Back on **Controls**, open category **Messages**, find the `s_ok` row, click its **Edit
  commands…** icon (this opens the message editor for a message-kind entry).
- **Expected:** in the live preview, the `$g` reference renders as a coloured glyph run rather than
  plain text; hovering it shows a tooltip naming the cvar ("Colour cvar "g""). The rest of the text
  (`$loc_here`, `%h`, `%a`) is unchanged, still literal.

### 14. (Bonus, exercises the review step's other branch) Import `cali` as a layer instead

- Repeat use case 9-10 on a second new profile, but this time pick **Attempt as layer** for `cali`
  before creating the profile.
- On the new profile's **Overview** tab, open the layer switcher / layers panel.
- **Expected:** a layer named `cali` exists, carrying the fourteen keypad overrides from its body,
  with no trigger key assigned yet (nothing in the source config binds `cali` to a key).

---

## Coverage and gaps

Every finished story's acceptance criteria are exercised by a real UI action above, with one named
exception:

- **Story 038, AC5** ("saving my existing `Hantsch - Test` profile removes exactly those seven
  lines and changes nothing else") is written against the story author's own long-lived, personal
  profile and is explicitly left unticked in the story file pending that specific manual run — it
  is not reproducible generically, since this session has no access to that profile. The underlying
  mechanism it exercises (a directly-bindable action never gets a dead alias line; an alias that
  *is* referenced keeps its line) is fully covered above by use cases 1 and 2, built live through
  the UI. If you have your own long-lived profile carrying legacy `q2l_a_*` lines, opening it and
  saving once should show the same removal — that is an easy additional spot check, not a gap in
  what this plan verifies.

No story in this sprint has an acceptance criterion that requires live-desktop conditions (focus
handling, physical input timing, etc.) — that concern was specific to story 037 in the previous
sprint and does not recur here.
