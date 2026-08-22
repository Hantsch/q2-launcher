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
- **027 (done)** — the UI verification harness now starts the app twice per full run
  instead of 56 times, and suppresses window focus-stealing during a run
  (`Q2L_UI_HARNESS=1` gates `focusable:false`/`showInactive()`). Every acceptance criterion was
  code-verified in the story itself; the one experiential check (typing in another window while a
  run goes, staying uninterrupted) was confirmed by the user at S06 acceptance on 2026-08-22,
  which closed the story together with 037.

`docs/sprints/done/S05` **accepted (2026-08-21)** — the
profile-as-a-file rework: 022 `<name>.cfg` exists standalone, 023 Raw File absorbs Write targets,
024 Quake 2 syntax highlighting, 025 Validation→Care, in that build order. Filed 2026-08-19
(`37cef54`); cut into a sprint 2026-08-21, built same day. **All four stories done**, see
`docs/sprints/done/S05/review.md` and `docs/sprints/done/S05/testplan.md` for the manual acceptance pass.
Every profile now has a canonical `<name>.cfg` in userData with automatic sync to every assigned
installation and a retry-capable sync/error state (022); the "Write targets" tab is gone, folded
into Raw File (023); config text everywhere in the launcher is now syntax-highlighted and
searchable through one shared viewer (024); "Validation" is now "Care", the single maintenance
surface combining the validation report, sync state, tidy-up actions (with a "fix all safe
findings" batch action) and the relocated mod-copies cleanup (025).

**Filed, not yet sprinted:**

- **032** (2026-08-21) — a running-count badge on the Downloads icon. Blocked by design: the
  downloads module that would produce the jobs to count does not exist yet. Depends on 031.

## Polish + hardening — the post-S05 backlog

The UI-polish batch from continued hands-on use plus the three guardrails the repo claims to have
and does not: this is not a feature milestone, it is the pass that makes the chrome speak to users
and the security/verification claims true.

`docs/sprints/done/S06` **accepted (2026-08-22)** — cut from the backlog that
accumulated during and after S04/S05, seven stories in two clusters. What the user sees, all
**done**: 031 rename Install→Downloads and relocate it to the right-hand utility group, 030
titlebar/wordmark scale-up, 033 planned-module screens (Mods/Assets/Downloads) in plain language
instead of architecture capability lists, 029 the Controls drop-row message as a "With message"
checkbox + inline row mirroring "With ammo". What the user has to trust: 035 the CSP now applies in
the shipped build (the renderer loads over a privileged `q2launcher://` scheme, the CSP travels with
every protocol response) — **done**; 036 `handle()` now requires a zod payload schema at every one
of ~60 call sites so validation cannot be forgotten on a new channel — **done**; 037 `ui:verify` now
reaches the write-preview and import dialogs and a full run is 17/17 screens with zero
critical/serious/moderate/minor violations — **done**, its last acceptance criterion (the human
desktop check that a full run never steals window focus, which also closed 027) was confirmed at
the acceptance pass. **All seven stories done.** See `docs/sprints/done/S06/review.md` and
`docs/sprints/done/S06/testplan.md`. Deliberately excluded: 032, the downloads module itself, and
the config-module gaps below. Carried out of the sprint: `CLAUDE.md`'s pointer to
`src/main/lib/schemas.ts` is now only half true after 036 split IPC-payload schemas into
`src/shared/ipc-schemas.ts`/`src/shared/schemas.ts` — a doc decision still open.

#### Gaps/notes (from S05)

- `setPlayedMods`/`setSwitchBind` (022) still write without going through the sync engine — a
  switch-bind chain can `exec` a not-yet-migrated file name until the next real sync touches that
  profile. Deliberately out of scope for 022 (not listed under its write-trigger decision); worth
  folding in if it ever causes a real report.
- ~~`npm run ui:verify`'s automated screen registry does not cover the write-preview dialog or the
  import preview~~ (024's `ConfigCodeView` swap-in there was only manually acceptance-tested, see
  `docs/sprints/done/S05/testplan.md`) — **closed by story 037** in `docs/sprints/done/S06`: both are now
  screen registry entries, screenshotted and axe-audited on every full run.
- 025's main-side `removeShadowedBind` handler trusts the renderer analyzer's "loser" claim rather
  than re-deriving the render-order winner itself — unreachable today because main re-validates
  every operation before applying, flagged for hardening if that invariant ever changes.
- The sync section's `pending` state (installation currently running) has no path through the UI
  in a test environment without a real, launchable Quake II install — covered only by
  `sync.test.ts`, named as a gap in `docs/sprints/done/S05/testplan.md` rather than faked with a
  console workaround.

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
  (`npm run ui:verify`), see the Tooling section above and `docs/sprints/done/S04/review.md`.

#### Gaps/notes (from S04)

- ~~The harness itself surfaced a **pre-existing, unrelated bug**: `RawConfigPanel.tsx` crashes on
  the `config-raw` route (a double-unwrapped `Outcome`)~~ — **resolved incidentally during S05**:
  022 fixed `getProfileSyncState`'s double-wrap, 023 fixed the same pattern in `setPlayedMods` and
  `previewConfigProfile` while rebuilding Raw File around `RawConfigPanel`. `npm run ui:verify`
  no longer exits non-zero on the `config-raw`/`config-care` routes as of S05.
- **Story 027 — done**, see the ad-hoc section above: the harness went from 56 app starts per
  full run to 2, and window focus-stealing is suppressed during a run; the manual focus check
  closed at S06 acceptance.
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

## Config, round two — the file becomes the config

Filed 2026-08-22 out of hands-on feedback on a real profile plus a read of the user's own
long-lived configs (`dm.cfg`, `dmalias.cfg`, `gfx.cfg` — a 2001-era DM config, ~90 aliases,
section banners, a comment behind almost every bind). The theme: what the launcher writes is
functional and nothing more, and it does not survive being read, shared or re-imported.

`docs/sprints/S07` **planned** — the first four stories in build order: 038 (writer stops
emitting dead alias lines), 039 (readable, user-controlled alias names), 040 (structured,
commented, human-readable file), 041 (import understands aliases/press-release/`unbindall`).
042/043 held back for a decision round before refine; 044/045 unscheduled.

Eight stories, **all `draft`, none refined**:

- **038** — no alias line for an action the engine can bind directly. Story 034 made continuous
  catalogue rows mirror as their own command (`bind MOUSE1 "+attack"`) but the writer kept emitting
  one alias per action, so a nine-bind profile carries seven dead `alias q2l_a_*` lines. A writer
  bug, not a Care gap: Care's `aliasUnreferenced` only looks at `kind: 'alias'` entries, and a
  "fix" would be regenerated on the next write. Standalone, smallest of the batch.
- **039** — aliases get readable names the user controls. `q2l_a_ssg_sg_9a2f` → `ssg_sg`, derived
  from the display name, overridable, unique per profile; a collision is a **warning**, never an
  auto-appended counter suffix (**user decision**). Real risk: `ACTION_ALIAS_PREFIX` is currently
  used as an *identity test* for "a mirror pass wrote this bind" in five places
  (`action-mirror.ts`, `modifier-layers.ts`, `bind-adoption.ts`, the renderer's
  `keyboard-layout.ts`, and the contract documented in `main/modules/config/profiles.ts`) — once
  an alias is called `ssg_sg` that test is gone and a save could start eating hand-typed binds.
- **040** — the profile file is written structured, commented and aligned: section banners, cvars
  by `CvarDef.group`, one section per layer, binds grouped the way a player reads a keyboard, a
  trailing `// <display name>` per generated line. **One file per profile in sections** (**user
  decision**) — deliberately *not* the split `dm.cfg`/`dmalias.cfg`/`gfx.cfg` shape, which would
  take the write pipeline, sync (022), Raw File (023) and cleanup (010/025) from one target per
  profile to n.
- **041** — import understands aliases. S01 deferred `alias`/`+cmd` parsing to "the follow-up
  sprint" and it never happened, so `config-parser.ts` still preserves every alias line verbatim:
  importing `dmalias.cfg` today yields **zero entries and ~90 preserved lines**. Covers plain
  aliases, `+x`/`-x` pairs, alias-to-alias chains, empty hook aliases, `unbindall` ordering and
  cross-`exec` resolution.
- **042** — a launcher-written file re-imports without losing anything. Display name, category,
  entry kind, own alias name, `catalogId`, two-slot pairing, modifiers, layer membership — all of
  it carried in a defined, versioned comment format, with `render(parse(render(p))) === render(p)`
  as a property test. Prerequisite for 043.
- **043** — **the `.cfg` becomes the source of truth, `state.json` becomes a cache** (**user
  decision**). The architectural inversion: external edits are detected and adopted, a UI edit
  racing a disk edit is a surfaced conflict rather than a timestamp race, the profile list can
  rebuild from files alone, and "generated, do not edit" comes off the header because it stops
  being true. Largest item in the batch; only makes sense on top of 042.
- **044** — one surface to manage every alias: name space (authored + generated + layer aliases),
  who references what, unreferenced state, line-budget headroom, rename-with-references, duplicate
  warnings. Care's alias rows link here; one reference graph shared with Care, not a second copy.
- **045** — toggles (`alias zoom zoomin`/`zoomout` reassignment), press/release pairs (`+slow`/
  `-slow`) and `wait` chains as first-class entries rather than opaque raw text. Lowest priority of
  the eight; 041 already imports them without mangling them.

Suggested order: 038 alone, then 039 → 040 → 041 → 042 → 043 as one chain, with 044 after 039 and
045 after 041. 038–040 are shippable on their own and already answer most of the "my config looks
machine-generated" complaint; 042/043 are the ones that need a decision round before refine.

Open, named in the stories rather than guessed at: the metadata comment format (042), bind grouping
by keyboard region vs. category (040 — region means moving `KEYBOARD_ROWS`/`ARROW_CLUSTER`/
`MOUSE_ROWS` out of the renderer into `src/shared/config/`), whether a referenced alias rename
rewrites or refuses (039), change detection and write cadence under an authoritative file (043),
and whether `alias cali "bind KP_END ...; ..."`-style key-block aliases are recognised as layers
(041).

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

- ~~Serve the production renderer from a privileged `app://` scheme instead of
  `file://`~~ (Electron security checklist item 18) — **done, story 035** in `docs/sprints/done/S06`: the
  production renderer now loads over `q2launcher://`, and the CSP travels with every protocol
  response. A Windows-specific path-traversal bypass (`%5C`-encoded backslash segments escaping
  `root`) was found and fixed during the story's own review, with a regression test.
- ~~Make the zod schema a **required** parameter of the typed `handle()` wrapper~~ — **done, story
  036** in `docs/sprints/done/S06`. All ~60 `handle()` call sites across `src/main/ipc/` and
  `src/main/modules/` now carry a real payload schema; one channel (`module:invoke`'s `payload`) is
  the one documented, deliberate `z.unknown()`. New IPC contract/coverage test added. **Note for the
  user:** `CLAUDE.md`'s pointer to `src/main/lib/schemas.ts` for renderer-payload validation is now
  only half true — IPC-payload schemas moved to `src/shared/ipc-schemas.ts`/`src/shared/schemas.ts`,
  persisted-state schemas stayed put. Left unedited pending sign-off; needs either a `CLAUDE.md`
  update or an explicit "leave as-is".
- Auto-update via `electron-updater`, and a decision on code signing — unsigned
  builds give users a SmartScreen warning.
- Drop `'unsafe-inline'` from the production CSP's `style-src` — deferred by story 035, which
  moved the production renderer onto the real `q2launcher://` origin and left the directive as
  AC6's one intentionally-unresolved item. Tailwind's emitted stylesheet is already requested as
  a real `./assets/*.css` file (not inlined), so this is a ready follow-up, not blocked on
  anything further.

**Tooling:**

- ESLint is deliberately absent. `typescript-eslint@8` caps TypeScript at
  `<6.1.0`, and this project is on TypeScript 7, so the two cannot be installed
  together. Revisit when typescript-eslint supports TS 7; `tsc -b` plus Prettier
  covers the gap until then.
- Vite is pinned to 7.x: `electron-vite@5` peers `vite ^5||^6||^7`, and
  `@vitejs/plugin-react@6` peers `vite ^8` exclusively. Revisit when
  `electron-vite@6` is stable.
- ~~A committed Playwright driver for the app would make UI changes verifiable~~ — **done**:
  story 026 in `docs/sprints/done/S04`, `npm run ui:verify` (see `docs/UI-VERIFICATION.md`). One
  gotcha it had to handle: this repo is often developed from inside an Electron host that
  exports `ELECTRON_RUN_AS_NODE=1`; inherited, it makes `electron.exe` run as plain Node and the
  main process dies on its first `require('electron')`. The harness deletes the variable from
  the child environment before launching. **Follow-ups from using it:** story 027 (56 app
  starts per full run, every window stealing focus) is **done** — see the
  ad-hoc section above; story 037 in `docs/sprints/done/S06` put the write-preview and import
  dialogs into the screen registry and took the full run to zero critical/serious/moderate/minor
  axe violations (`page-has-heading-one` deliberately disabled for this single-window desktop app,
  documented in the report). Both are **done** as of S06's acceptance (2026-08-22), when the
  shared human desktop check — a full run never steals window focus — was confirmed. Remaining
  known blind spot: `MessageEditor.tsx` is not in the screen registry and carries the same
  unwired-label defect 037 fixed elsewhere (`docs/UI-VERIFICATION.md`).

**UX:**

- Per-installation launch profiles (arbitrary cvar overrides, safe mode, connect
  to a server) — the launch layer is already a plan builder, so this is additive.
- Crash detection: a non-zero exit shortly after start is worth surfacing.
- The news carousel in the hero is wired but empty.
- Only `en` ships. Adding a locale is a JSON file plus one entry in
  `src/renderer/src/i18n/index.ts`.
