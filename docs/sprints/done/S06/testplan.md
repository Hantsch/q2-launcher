# Sprint S06 — Manual test plan

Covers the six finished stories of this sprint — **031** (rename Install→Downloads, move nav entry
next to Settings), **030** (titlebar/wordmark scale-up), **033** (planned-module screens get
plain-language copy), **029** (drop-row message as checkbox + inline row), **035**
(production renderer loads over `q2launcher://` with an enforced CSP), **036** (`handle()` now
requires an IPC payload schema) — plus one closing check for story **037** (`ui:verify` covers
every surface and is green), which is still in-progress pending a human focus-steal confirmation.

Every step below is a real action in the running app. The one console command used anywhere in
this plan is `npm run ui:verify` itself, in use case 8 — it is *starting* a harness run, not a
substitute for clicking something in the launcher, and its own acceptance criterion is precisely
that a human watches it from outside the app.

## Preparation

1. `npm install` (first time only), then `npm run dev` to start the app. Some steps below ask for
   a production-mode build instead (`npm run build`, then `npm start`, or `npm run ui:verify`
   itself) — each step says which one it needs and why.
2. You need at least one registered installation: Library → **Add existing** (pick a real Quake II
   folder) or **Create new** (an empty folder is fine for everything in this plan except where
   noted). No other seeded fixture data is required — every profile/action below is created live
   through the UI.
3. Most steps start from the title bar, since four of this sprint's six stories touch it directly.

---

## Story 031 — Downloads rename + nav move

### 1. "Install"/"Downloads" is gone from the primary nav, and lives as an icon button next to Settings

- Look at the title bar's left-hand primary nav row.
- **Expected:** it shows only Home, Library, Config, Mods, Assets — no "Install" and no
  "Downloads" text entry there.
- Look at the right cluster, just left of the gear icon.
- **Expected:** a download-arrow icon button sits directly left of Settings, no text label, the
  same size as the Settings button. Hover it — the tooltip reads "Downloads".

### 2. Clicking it navigates, and the active state follows the route

- Click the Downloads icon button.
- **Expected:** the page that opens shows a "Planned" badge and reads as the Downloads module (see
  story 033's use case below for what the copy says); the Downloads button now shows the same
  highlighted look the gear shows while Settings is open.
- Click **Library**, then click the Downloads icon again.
- **Expected:** the highlight moves with the active route each time — off Downloads while on
  Library, back on when you return.

### 3. Repair links still land on Downloads

- In **Library**, if an installation shows a "needs repair"/"Repair" action, click it.
- **Expected:** it opens the same Downloads page as the icon button does (this exercises the
  renamed `setRoute` repair links, not just the nav button).

---

## Story 030 — Titlebar and wordmark scale-up

### 4. The bar reads as a header, and nothing is stranded at the old size

- Look at the title bar as a whole.
- **Expected:** it is clearly taller than a thin strip — "QUAKE II" / "LAUNCHER" is legible at
  arm's length and the text block is vertically centred in the bar. Nav items, the Downloads and
  Settings icon buttons, and the three window buttons (minimize/maximize/close) all look sized to
  fill the taller bar — nothing looks like a small button floating in extra empty space.

### 5. Dragging, double-click-maximize and window controls all still work

- Click-and-drag an empty part of the bar (not a button) — **Expected:** the window moves.
- Click a nav item, the Downloads button, or the Settings button — **Expected:** it navigates and
  does **not** move the window.
- Double-click an empty part of the bar — **Expected:** the window maximizes; double-click again —
  **Expected:** it restores.
- Click minimize, then restore from the taskbar, then click maximize/restore and close —
  **Expected:** each control works exactly as before.

### 6. Keyboard focus is visible and unclipped, even at the minimum window size

- Press `Tab` repeatedly starting from the wordmark.
- **Expected:** every nav item and every chrome button (Downloads, Settings, window controls)
  shows the app's amber focus ring in turn, with Enter activating the focused one.
- Resize the window down to its smallest size (drag a corner until it stops shrinking).
- **Expected:** nothing in the bar is clipped or overlapping, and the content below the bar is
  still fully usable.

---

## Story 033 — Planned-module screens explain the feature, not the engineering

### 7. Mods, Assets and Downloads read as plain product copy, not an engineering ticket

- Requires a **production build**: `npm run build`, then `npm start` (a `npm run dev` session
  shows an extra developer-only debug line — see the note below — so use the production build for
  the "no debug line" check).
- Open **Mods**, **Assets** and **Downloads** from the nav/title-bar in turn.
- **Expected**, on each: a "Planned" badge and a heading/body that clearly say this is coming in a
  later release, in plain language; a "What's coming" section with a short intro paragraph and a
  short bullet list of things you'll be able to do — phrased as user-facing outcomes, not
  engineering terms (no "write files inside an installation", no "long-running jobs", no
  "capability", no "IPC", no raw `id: … · route: … · ipc: …` line anywhere on the screen).
- Open **Home** and read the Mods/Assets/Downloads tiles there.
- **Expected:** their one-line descriptions also read as plain descriptions, not technical jargon.

### 8. The dev-only debug line is gated, not deleted

- Switch to `npm run dev` (a developer build) and revisit any one of the three planned screens.
- **Expected:** the `id: … · route: … · ipc: …` line is now visible at the bottom of the panel —
  confirming the line only disappears in a production build, it was not removed outright.

---

## Story 029 — Drop-row message as checkbox + inline row

### 9. Weapon-drop rows show two plain checkboxes, no message icon button

- Open **Config**, pick a profile (create one if none exist: **New profile** → **Empty profile**),
  go to the **Controls** tab, and scroll to the **Weapons** drop group (weapon-drop rows also carry
  an ammo item).
- **Expected:** the row's Options column shows two stacked checkboxes — "With ammo" and "With
  message" — and there is **no** message icon button anywhere in that column.

### 10. Checking "With message" reveals an inline row; Edit opens the rich message editor

- Check **With message** on that row.
- **Expected:** a full-width row appears directly underneath the catalogue row, showing placeholder
  text and an **Edit** button; the surrounding rows' heights and zebra striping are unchanged.
- Click **Edit**.
- **Expected:** the full message editor opens — channel select, macro buttons, symbol picker, live
  preview — and there is **no** key-capture control in it (drop-row messages don't carry their own
  key; the row's existing key slots are unaffected).
- Type a message and save.
- **Expected:** the inline row now shows that text, and the checkbox stays checked. Leave the
  profile and come back to it (or switch tabs and back) — the checkbox is still checked and the
  text is still there.

### 11. Unchecking removes the message immediately

- Uncheck **With message** on that row.
- **Expected:** the inline row disappears. Leave the tab and come back — it stays gone (confirming
  the message was actually cleared, not just hidden).

### 12. No regression to ammo, key binding or conflict display

- On the same row: toggle **With ammo** on/off — unaffected by the message checkbox.
- Capture a primary and secondary key on that row, then bind a key that's already used by another
  action.
- **Expected:** the existing Cancel/Replace collision prompt still appears under the row, and any
  "also: <owner>" layer/conflict text in the Options column is still shown, unclipped by the new
  checkbox layout.

---

## Story 035 — Production renderer loads over `q2launcher://` with an enforced CSP

### 13. Dev mode is unaffected

- `npm run dev` — the launcher opens normally. Edit any visible string in a renderer view and save
  it.
- **Expected:** the change appears live without a manual reload (hot reload still works), and no
  DevTools console error about a blocked script/style/connection appears.

### 14. The production build serves the app from the new origin, and it just works

- `npm run build`, then `npm start`.
- **Expected:** the app renders normally — no blank window, styling and fonts intact — and
  navigating between Home, Library, Config, Settings and the planned modules all work exactly as
  in dev mode. There is no UI control that surfaces the CSP/origin directly; this is a
  security-plumbing change, so "the app works exactly as before, from a production build" **is**
  the user-observable acceptance here.
- **Gap (named, not worked around):** verifying that the document's origin is literally
  `q2launcher://app` and that its CSP header is present is an internal, non-UI check — there is no
  UI surface that displays either value. This is covered by the automated harness assertion
  (`npm run ui:verify`, which fails loudly if the origin or header is wrong) and by the packaged
  build's startup log line, not by a manual UI step.

---

## Story 036 — `handle()` requires a payload schema

This story is a pure backend/IPC-validation refactor: it added no new UI of its own. Its real
acceptance is the automated IPC coverage test (`src/main/ipc/index.test.ts`) plus these spot
checks confirming that normal use of features whose IPC handlers were touched still behaves
exactly as before — a wrong or missing schema would show up as a broken feature, not as a UI
element to inspect.

### 15. Installations still add, edit and launch normally

- Library → add or create an installation, rename it, toggle its favourite star, drag to reorder
  the rail, then launch it.
- **Expected:** every action succeeds exactly as before, with no new error toast and no console
  error.

### 16. Config profile edits, assignment and Care actions still work

- Config → create a profile, edit a cvar (Settings tab) and a bind (Controls tab), assign it to an
  installation and make it the default, then open **Care** and run a Sync and a Tidy-up scan.
- **Expected:** all of these behave exactly as documented in stories 022–025's own test plan
  (`docs/sprints/done/S05/testplan.md`) — no behavioural change, no new error.

### 17. Settings persist across a restart

- Settings → toggle "minimize on launch" (or any other toggle) and change the locale if more than
  one is available.
- Restart the app.
- **Expected:** the change is still there.

---

## Story 037 — `ui:verify` covers every surface and is green (closing story 027's last check)

Story 037 is code-complete but not yet `done`: every acceptance criterion is met except one, which
needs a human at a real desktop, not a session running commands in the background. This is that
check.

### 18. The focus-steal check (closes story 027)

- Open an editor or terminal in a **different** window from any terminal you use to run this
  command, and position it so you can type into it.
- Run `npm run ui:verify` (the full run — no `--screens=` flag) from a terminal, then immediately
  switch to the other window and keep typing continuously for the whole run (it takes roughly half
  a minute).
- **Expected:** no keystroke lands in the launcher, no app window ever comes to the foreground or
  takes input focus, and your typing in the other window is never interrupted. The run itself
  should finish with a summary reading `run: full (17/17 screens)` and exit code `0`.
- **If confirmed:** this closes story 027's remaining acceptance criterion — move
  `docs/requirements/027-quiet-ui-verification.md` to `docs/requirements/done/`, add its Done note
  and its `INDEX.md` line, then flip story 037's own status to `done`, per both stories' own
  Done-section instructions.
- **If not confirmed** (a window did take focus, or typing was interrupted): note exactly when and
  which window in story 037's Done section — this is a real regression, not a formality.

---

## Coverage and gaps

Every finished story's acceptance criteria are exercised by a real UI action above, with two named
exceptions, both already documented as gaps rather than as console workarounds:

- **Story 035 (use case 14):** confirming the document's origin is `q2launcher://app` and that the
  CSP header is present has no UI surface to check by hand — it is provable only via the automated
  harness assertion (`npm run ui:verify`) or the packaged build's startup log line.
- **Story 037 (use case 18):** the focus-steal confirmation can only be produced by a human typing
  in another window during a live `npm run ui:verify` run; it cannot be produced or verified by an
  agent running the command from a blocking tool call.

Story 036 has no dedicated UI flow of its own by design — see the note above its use cases — its
real acceptance is the automated IPC coverage test plus the spot checks in use cases 15–17.
