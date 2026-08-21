# Roadmap

## Step 1 — the shell (done)

- Frameless window with custom chrome, persisted geometry, single-instance lock
- Typed IPC contract with a preload allowlist and startup completeness check
- Atomic, self-healing `state.json` with a migration framework
- Installation management: add existing, search this PC (Steam/GOG/Epic/classic
  paths + optional deep scan), create new, rename, reorder, favourite, relocate,
  remove
- Validation with an actionable fix behind every failed check
- Engine detection for r1q2, Q2PRO, Yamagi, KMQuake II, vkQuake2, Q2RTX, the
  original client and the 2023 remaster
- Launch: pure, unit-tested command-line builder; process tracking; play time
- Module seam proven end to end by the `library` module
- Job registry and the action-bar download readout the install module will drive
- Design system, i18n scaffolding, generated app icon

### Explicit non-goals for step 1

- No downloading, patching or verifying of game files
- No deleting anything from disk — `installations:remove` rejects
  `deleteFromDisk: true` outright
- No auto-update of the launcher itself
- No server browser, no news feed (the hero carousel dots are a placeholder)
- No mod or asset-pack handling

## Modules

Each has a manifest, a route and a page in the app already; none has a
main-process half yet. `docs/ARCHITECTURE.md#adding-a-module` has the checklist.

### Install — download, update, repair

Where the action bar's progress readout finally gets real data.

- Needs: a job queue, resumable HTTP downloads with progress, archive extraction,
  hashing for verification.
- Validation should become **size-first, hash-later**: `RETAIL_PAK_SIZES` in
  `src/shared/constants.ts` already distinguishes the retail paks from the
  shareware demo without hashing 180 MB. Real hashes belong to this module.
- Because r1q2 writes into its own install tree, this module must refuse to create
  installations under `Program Files` (or warn loudly). The `write-access` check
  already flags it.

### Config — r1q2 settings and cvars (implemented, see docs/systems/config-module.md)

Full q2-config-manager feature parity is implemented and accepted. Scope, data model and
mechanics now live in [docs/systems/config-module.md](systems/config-module.md) (moved from
`concepts/` once implementation completed — folding the discontinued `q2-config-manager` in as
this module, redesigned in the launcher's own design system).

Status: `docs/sprints/done/S01` **accepted (2026-08-16)** — profile CRUD, installation
assignment, cvar editor, write pipeline, import (stories 001–005). `docs/sprints/done/S02`
**accepted (2026-08-19)** — keybinding editor with alternate layers, the in-session
profile-switch bind, the Advanced tab categories/messages/macros/symbol picker, the
multi-engine validator, and cleanup of redundant per-mod config copies (stories 006–010); ran
through `docs/sprints/done/S02/testplan.md` on a real desktop. The keyboard/overview tab
(CFG-7) was additionally built ad-hoc during S01 post-sprint polishing (`9b04099`, `54ca35f`,
`9259a24` on `dev`), outside the formal story flow — read-only bound/free/doubly-bound view
plus test-mode key-chain capture, see `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`.

`docs/sprints/done/S03` **accepted (2026-08-20)** — six follow-on UI/UX stories filed after
S02's acceptance pass (011–016), not part of the original concept's scope but real friction found
while running `docs/sprints/done/S02/testplan.md`. **All six landed**:
alt-layer trigger reassignment via binding (011), a more compact alt-layers panel with the layer
switcher moved next to the keyboard overview (013), trigger-key visibility and click-to-switch on
the keycap itself (014), a raw config view with reveal-in-folder (012), a dual-bind editor for
Movement/Weapons/Weapon dropping (015), and modifier-layer auto-creation on bind capture (016 —
unblocked by a re-plan after the sprint review, see Gaps/notes below). All six passed
build/typecheck/test and clean-agent review; the build session could not live-smoke-test them, so
the manual pass in `docs/sprints/done/S03/testplan.md` (plus 016's own test plan) was run on a
real desktop afterwards. The engine findings below stay as factual background for the system
doc.

`docs/sprints/done/S04` **built (2026-08-20/21), acceptance pass not yet confirmed by the user**
— authoring surfaces + UI verification harness. Cut the first two of the three clusters below
into one sprint: 026 (a committed Playwright/`_electron` harness — screenshots per screen plus
an axe report, so a sprint can accept its own UI work), then 017/018 (Overview: edit-by-default,
honest test mode) and 019/020 (Controls: entry types + ordering, then the column-grid redesign)
and 021 (Settings dense rows). **All six stories done**, see `docs/sprints/done/S04/review.md`
and `docs/sprints/done/S04/testplan.md` for the manual acceptance pass. The profile-as-a-file
cluster (022–025) is deliberately held back as the likely next milestone, because it is an
on-disk/schema rework with migration questions and does not mix with five UI redesigns in one
acceptance pass.

**Ad-hoc bug fixes landed outside sprint flow after S04 (2026-08-20/21):** filed and closed
without a formal sprint cut, spanning the move from a WSL dev session to a native Windows one
(see [[native-windows-session-screenshots]] — screenshots are trustworthy evidence again):

- **028 (done)** — app-wide missing icons (nav bar, the "+" install button, Controls CRUD icons)
  plus a genuine Controls-tab layout collision. Root cause: `scrollbar-gutter: stable` on the
  global `*` rule reserved scrollbar width inside every `overflow:hidden` box, including `<svg>`
  roots, blanking every icon ≤15px; fixed by scoping the rule to the five view scrollers instead.
  Also surfaced three backlog items, **none yet filed as stories**: the pre-existing
  `RawConfigPanel` crash on the `config-raw` route, two axe criticals (`select-name`, `label`),
  and the CSP never actually applying in production builds (`onHeadersReceived` never fires for
  `file://` loads).
- **034 (done)** — Controls and the keyboard Overview now share one source of truth. `actions`
  was one of two disjoint storages (`binds`/`layers[].overrides` the other, mirrored one-way);
  `adoptRawBinds` reconciles a raw bind into `actions` on every read and write, so a hand-made or
  imported bind is never invisible to Controls again.
- **027 (in-progress)** — the UI verification harness now starts the app twice per full run
  instead of 56 times, and suppresses window focus-stealing during a run
  (`Q2L_UI_HARNESS=1` gates `focusable:false`/`showInactive()`). Every acceptance criterion is
  code-verified except the one experiential check (typing in another window while a run goes,
  staying uninterrupted) — needs a human on the real desktop, feasible now that the session is
  native Windows. Status stays `in-progress` until confirmed.

`docs/sprints/S05` **planned (2026-08-21)** — the profile-as-a-file rework: 022 `<name>.cfg`
exists standalone, 023 Raw File absorbs Write targets, 024 Quake 2 syntax highlighting, 025
Validation→Care, in that build order. Filed 2026-08-19 (`37cef54`); cut into a sprint 2026-08-21
without changing scope. Not yet built.

**Filed, not yet sprinted:**

- **029** (2026-08-20) — Controls drop rows: replace the message icon-button with a "With
  message" checkbox + inline row, mirroring the existing "With ammo" pattern.
- **030–033** (2026-08-21) — a UI-polish batch from continued hands-on use: 030 titlebar/wordmark
  scale-up, 031 rename Install→Downloads and relocate it next to Settings, 032 a running-count
  badge on the Downloads icon (explicitly blocked on the Downloads module existing), 033 rewrite
  the planned-module screens (Mods/Assets) in user-facing language instead of engineering
  capability lists. Dependency: 031 → 032.

#### Gaps/notes (from S03)

- ~~**016 is blocked on a schema-shape gap**~~ — **resolved after the sprint review** (`00b77f6`,
  closed with S03 in `0cc934f`). The fix was not the schema change the review proposed: a modifier
  binding now lives on the `ConfigAction` itself (`keyModifier`/`secondaryKeyModifier`) and a
  layer's `overrides` map became a **generated mirror** of the actions array
  (`applyActionLayerMirror`, applied by `setActions`/`setLayers` in main). Row identity is
  therefore `action.id` via `aliasNameFor` and never command text, so the colliding-command-text
  problem cannot arise; the renderer's whole reverse-parse machinery was deleted rather than
  patched. **Carry-over rule for any future layer feature: never re-derive row identity from
  rendered command text — `overrides` is derived state, the action is the source of truth.**
- ~~**No committed UI-driving harness exists yet**~~ — **closed by S04's story 026**
  (`npm run ui:verify`), see the Tooling section above and `docs/sprints/S04/review.md`.

#### Gaps/notes (from S04)

- The harness itself surfaced a **pre-existing, unrelated bug**: `RawConfigPanel.tsx` crashes on
  the `config-raw` route (a double-unwrapped `Outcome`), which makes a full `npm run ui:verify`
  exit `1` even on an otherwise clean build. Not fixed in S04 (out of scope for the stories that
  found it), and **still not filed as a story** despite resurfacing twice more since — once in
  027's own live smoke, once in 028's design-consistency pass. Needs its own story before
  `ui:verify`'s exit code can be trusted as a clean pass/fail gate; a good next-sprint candidate.
- **Story 027 — done** (in-progress on one manual item), see the ad-hoc section above: the
  harness went from 56 app starts per full run to 2, and window focus-stealing is suppressed
  during a run.
- **017 changed 013/014's click semantics**: outside test mode, a layer's trigger keycap no
  longer switches the displayed board on click — it opens the bind dialog like every other
  keycap. Layer-switching-by-interaction now lives entirely in 018's test-mode mechanics
  (trigger key press, not click). Any future Overview feature must not reintroduce a
  click-to-switch-layer path outside test mode.
- **`entryKind` is gone from `ConfigActionCategory`** (019): a category is untyped, every
  `ConfigAction` carries its own `kind` (`bind` | `message` | `alias`). Order is array position,
  not a stored field — the IPC contract for `setActions`/`list` must keep preserving it
  round-trip. Alias entries are excluded from `binds` and from `applyActionLayerMirror` at the
  single derive site (carries forward S03's "`overrides` is derived state" rule).
- **021 deviates from the design-tokens skill's 44px touch-target floor** (kept the prototypes'
  40px row / 30px slot / 26px reset sizes in 020, similar sizing in 021) — recorded in
  `CLAUDE.md` with its reason: this is a desktop mouse-and-keyboard app, not a touch surface.
  Same deviation carries into 021's Settings controls.

#### Gaps/notes (from S02)

- **Alias generation, the profile serializer, the switch-bind generator and engine numeric
  limits now live centrally in `src/shared/config/`** (`alt-layers.ts`, `alias-render.ts`,
  `render.ts`, `switch-bind.ts`, `engine-limits.ts`) — any future feature that needs to emit a
  bind/alias or cite an engine limit should extend these rather than re-derive them.
- **Backup-once is a shared, reusable contract** (`src/main/modules/config/backup.ts`) used by
  both the write pipeline (story 004) and the cleanup delete/restore path (story 010) — reuse it
  for any future feature that mutates a user's game folder.
- **9 non-blocking findings from story 010's delayed code review** are worth a follow-up story:
  see `docs/sprints/done/S02/review.md` for the full list (case-sensitivity/case-folding
  inconsistencies in the redundancy scan and duplicate-entry guard, a mid-loop I/O error that
  can drop files from the undo list, the restore primitive being wider than cleanup's own scope,
  and locally-redeclared contract types that should import from `@shared/modules/config`).
- ~~**Layer trigger keys (story 006) cannot be reassigned after a layer is created**~~ — fixed by
  S03 story 011: a trigger is now assigned/moved/cleared like any other bind, from the keyboard
  overview's key dialog.

#### Gaps/notes (from S01)

- **File layout locked in for the writer:** one file per profile
  (`baseq2/q2l-profile-<id>.cfg`) plus a thin per-installation `autoexec.cfg` loader that
  `exec`s the *default* assigned profile's file — keep this shape when building the
  profile-switch bind (CFG-6) in the follow-up sprint.
- **Import recognizes only `set*`/`bind*` this sprint**; `alias`/`+cmd`/alt-layer content is
  preserved verbatim but not parsed — explicitly deferred to the follow-up sprint per the
  concept.
- **Known narrow gaps from story 004's review**, worth a follow-up story if they bite: the
  played-mods checkbox selection doesn't persist across app restarts, and two saves to the
  same *running* installation before the first pending write resolves can only track the more
  recently pending profile.

The findings that shape this module, from reading the r1q2 source:

- **There is no `r1q2.cfg`.** The files are `default.cfg` (inside `pak0`),
  `config.cfg` (engine-written, archived cvars and key bindings), `autoexec.cfg`
  (user) and `postinit.cfg` — an r1q2 addition that runs after video/sound/input
  init, which is the right place for anything needing the renderer up.
- **Config is per-game-directory.** `config.cfg` is written to
  `<install>/<gamedir>/`, so the base game and each mod have their own.
- **r1q2 has no user directory at all** — no `homedir` cvar, no `-portable`, no
  Documents redirection. Q2PRO and Yamagi do; that difference is already modelled
  as `writeDirStrategy` on `EngineDefinition`.
- `cddir` was removed from r1q2, so read-only-source + writable-target layouts are
  not achievable that way.
- Editing must back up the user's existing `.cfg` before writing, and the module
  should diff rather than rewrite.

### Mods — game directories

- `+set game <dir>` is already built and validated (single ASCII token). The rest
  is discovery, install, enable/disable and per-mod config.
- Needs `game-lifecycle` so it knows not to mutate files while the game is running.

### Assets — texture, model and sound packs

- Needs conflict detection between packs that touch the same files, plus a record
  of what a pack changed so it can be removed again. `Installation.moduleData` is
  the per-installation slot for that.

## Follow-ups worth doing

**Verify while implementing.** These were researched but not confirmed on a real
machine, and each is a one-line fix in a data table:

- `-nopathcheck` is passed to r1q2 by default (`EngineDefinition.defaultArgs`).
  r1q2's only dash arguments are `-nopathcheck`, `-nocwdcheck`, `-hideconsole` and
  `-oldconsole` — notably there is **no `-safe`**, so a safe mode has to be a
  launcher-composed bundle of `+set` overrides.
- Executable and marker names for engines other than r1q2/Q2PRO
  (`ENGINE_DEFINITIONS` in `src/shared/types/engine.ts`), especially the 2023
  remaster's exe names.
- `detectedVersion` is never populated. Reading the Windows version resource from
  the exe, or parsing the r1q2 console banner, would fill it.

**Hardening:**

- Serve the production renderer from a privileged `app://` scheme instead of
  `file://` (Electron security checklist item 18).
- Make the zod schema a **required** parameter of the typed `handle()` wrapper, so
  validation cannot be forgotten on a new channel.
- Auto-update via `electron-updater`, and a decision on code signing — unsigned
  builds give users a SmartScreen warning.

**Tooling:**

- ESLint is deliberately absent. `typescript-eslint@8` caps TypeScript at
  `<6.1.0`, and this project is on TypeScript 7, so the two cannot be installed
  together. Revisit when typescript-eslint supports TS 7; `tsc -b` plus Prettier
  covers the gap until then.
- Vite is pinned to 7.x: `electron-vite@5` peers `vite ^5||^6||^7`, and
  `@vitejs/plugin-react@6` peers `vite ^8` exclusively. Revisit when
  `electron-vite@6` is stable.
- ~~A committed Playwright driver for the app would make UI changes verifiable~~ — **done**:
  story 026 in `docs/sprints/S04`, `npm run ui:verify` (see `docs/UI-VERIFICATION.md`). One
  gotcha it had to handle: this repo is often developed from inside an Electron host that
  exports `ELECTRON_RUN_AS_NODE=1`; inherited, it makes `electron.exe` run as plain Node and the
  main process dies on its first `require('electron')`. The harness deletes the variable from
  the child environment before launching. **New follow-up filed from using it:** the harness
  currently starts the app 56 times per full run and each window steals focus — see story 027
  (`docs/requirements/027-quiet-ui-verification.md`), not yet sprinted.

**UX:**

- Per-installation launch profiles (arbitrary cvar overrides, safe mode, connect
  to a server) — the launch layer is already a plan builder, so this is additive.
- Crash detection: a non-zero exit shortly after start is worth surfacing.
- The news carousel in the hero is wired but empty.
- Only `en` ships. Adding a locale is a JSON file plus one entry in
  `src/renderer/src/i18n/index.ts`.
