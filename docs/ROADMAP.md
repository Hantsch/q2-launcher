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

**In progress: `docs/sprints/S04` — authoring surfaces + UI verification harness (planned
2026-08-20).** Cuts the first two of the three clusters below into one sprint: 026 (a committed
Playwright/`_electron` harness — screenshots per screen plus an axe report, so a sprint can accept
its own UI work), then 017/018 (Overview: edit-by-default, honest test mode) and 019/020
(Controls: entry types + ordering, then the column-grid redesign) and 021 (Settings dense rows).
The profile-as-a-file cluster (022–025) is deliberately held back as the likely S05, because it is
an on-disk/schema rework with migration questions and does not mix with five UI redesigns in one
acceptance pass.

**Filed, not yet sprinted (2026-08-19, `37cef54`):** nine further polish/redesign drafts,
017–025 in `docs/requirements/`, from a second round of hands-on use plus two prototype sets
(`docs/prototypes/bindings/`, `docs/prototypes/settings/`). Three clusters: the keyboard Overview
(017 edit-by-default, 018 test-mode layers/key feedback), the authoring tabs (019 entry types +
ordering, 020 Advanced→Controls as the column-grid prototype, 021 Settings as the dense-rows
prototype), and the profile-as-a-file rework (022 `<name>.cfg` exists standalone, 023 Raw File
absorbs Write targets, 024 Quake 2 syntax highlighting, 025 Validation→Care). Dependency order
inside the clusters: 019 → 020, and 022 → 023 → 025.

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
- **No committed UI-driving harness exists yet**, so an autonomous sprint cannot itself perform
  the live acceptance pass this module's stories need (`live-smoke-required: true` in
  `.claude/ai-scrum.md`). This is the same gap the Tooling section below already names
  ("A committed Playwright driver for the app would make UI changes verifiable") — **now cut as
  story 026, first story of S04**, so from S04 on a sprint can close its own acceptance gap
  instead of deferring it to the user.

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
- A committed Playwright driver for the app would make UI changes verifiable — **scheduled:
  story 026 in `docs/sprints/S04`**. One gotcha to carry over: this repo is often developed from inside an Electron host
  that exports `ELECTRON_RUN_AS_NODE=1`; inherited, it makes `electron.exe` run as
  plain Node and the main process dies on its first `require('electron')`. Delete
  the variable from the child environment before launching.

**UX:**

- Per-installation launch profiles (arbitrary cvar overrides, safe mode, connect
  to a server) — the launch layer is already a plan builder, so this is additive.
- Crash detection: a non-zero exit shortly after start is worth surfacing.
- The news carousel in the hero is wired but empty.
- Only `en` ships. Adding a locale is a JSON file plus one entry in
  `src/renderer/src/i18n/index.ts`.
