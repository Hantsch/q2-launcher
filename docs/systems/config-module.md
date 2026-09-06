# Config module

Status: **Implemented.** Full q2-config-manager feature parity (CFG-1–CFG-12 below) shipped
across [S01](../sprints/done/S01/sprint.md) (foundation: profile CRUD, assignment, cvar editor,
write pipeline, import) and [S02](../sprints/done/S02/sprint.md) (keybinding editor with
alternate layers, in-session profile-switch bind, Controls tab, multi-engine validator,
per-mod config cleanup), both accepted on a real desktop. This document now describes the
system as built, not a plan. Follow-on enhancements beyond this original scope (e.g. alt-layer
trigger-by-binding, raw config view, dual-bind editor) are tracked as their own stories, not
edits to this document.

This document follows the architecture rules in [CLAUDE.md](../../CLAUDE.md) and the module
pattern in [ARCHITECTURE.md](../ARCHITECTURE.md#adding-a-module). It supersedes the informal
"Config" notes in [ROADMAP.md](../ROADMAP.md#config--r1q2-settings-and-cvars), which stay as
engine-fact background. `config` is a registered, implemented module
(`src/shared/types/module.ts`, route `/config`).

---

## TL;DR

- q2-config-manager is discontinued as a standalone app; its functionality becomes the
  launcher's `config` module, fully redesigned in the launcher's own design system (no CSS/
  component reuse).
- Full feature parity, cut into stories: profile setup/import, keyboard/keybinding editor with
  alt layers, categories & messages, settings/cvars, validator, cleanup.
- Only r1q2 (primary), Q2PRO and vanilla `quake2.exe` 3.20 are supported — the launcher's other
  engines (Yamagi, KMQuake II, vkQuake2, Q2RTX, remaster) are explicitly out of scope, no
  source-cited facts exist for them.
- **Data model change from the original tool:** profiles are managed centrally, independent of
  any installation, and *assigned* to installations (many-to-many). Editing a profile re-writes
  it to every assigned, non-running installation immediately on save.
- An installation can have several assigned profiles; one is the default (used at launch). A
  bindable key cycles through the assigned profiles in-session (console echo of the new name),
  session-only, not persisted as a new default.
- The validator checks every engine that the profile is actually assigned to (via its
  installations) as an equally-weighted error surface — no more "primary vs. portability"
  two-tier severity from the original tool.
- Central profiles are a new top-level entity in `state.json`, not `Installation.moduleData` —
  because they are explicitly not owned by a single installation.
- Open: exact on-disk file layout for the profile-switch alias chain; direct numbered profile
  selection (deferred past the weapon-key 1–9 conflict).

---

## 1. Vision

Players who maintain a hand-rolled `alias`/`bind` config for Quake 2 get real tooling for it,
inside the same launcher they already manage installations with — instead of a second,
unrelated app. The launcher already knows engines and installations; the config module reuses
that knowledge (engine detection, install paths) so the user never re-enters facts the launcher
already has. What used to be a fully separate app (q2-config-manager) becomes just another
surface of the launcher, styled and behaving like the rest of it.

## 2. Goals & non-goals

**Goals**

- Full feature parity with q2-config-manager: profile setup & import, keyboard overview with
  test mode, categories/messages/macros, alternate binding layers, settings/cvars with
  per-engine defaults and clamps, the validator, and cleanup of redundant per-mod config
  copies.
- Profiles are first-class, centrally managed entities that can be assigned to any number of
  installations — manage a profile once, not once per installation.
- Multiple profiles per installation with a designated default and a live, in-session switch
  bind.
- UI fully rebuilt in the launcher's design system (tokens, primitives, layout language) — not
  a ported or reused UI.

### Non-goals (deliberately out)

- Engines beyond r1q2, Q2PRO and vanilla `quake2.exe` 3.20 (Yamagi, KMQuake II, vkQuake2,
  Q2RTX, 2023 remaster) — no source-cited engine facts exist for these; adding them is a
  separate future effort.
- Mod-directory discovery/installation itself (that is the `mods` module) — this module only
  needs to know which mod folders of an installation are marked "played" for the
  autoexec-per-mod copy.
- Direct numbered profile selection via keybind (`1`–`9`) — conflicts with default weapon-select
  binds; see [Open points](#n3-open-points).
- Persisting an in-session profile switch as the new default — the game process cannot write
  back into the launcher's state, so this is architecturally out, not just deferred.

## 3. Design decisions taken (from the requirements interview)

| Topic | Decision |
| --- | --- |
| Scope | Full q2-config-manager feature parity, cut into stories in one sprint (not a phased subset). |
| Engine support | Only r1q2, Q2PRO, vanilla `quake2.exe` 3.20 — matching the source-cited facts already researched. |
| Data ownership | Profiles are centrally managed, independent of any installation; not `Installation.moduleData`. |
| Assignment | Many-to-many: a profile can be assigned to several installations; an installation can have several assigned profiles. |
| Default profile | Each installation with assigned profiles designates one as default, used at launch. |
| Apply trigger | Saving a profile immediately re-writes it to every assigned installation that is not currently running; running installations are skipped and marked pending. |
| Gamedir scope | Profile content is written to `baseq2` (search-path makes it reachable from mods); `autoexec.cfg` is additionally copied into every mod folder of the installation the user has marked as "played" — because `FS_ExecAutoexec` never consults the search path. |
| Cleanup | Stays in scope, per installation, independent of the central-profile model. |
| Import | Stays in scope — importing an existing `config.cfg`/`autoexec.cfg` from disk into a new profile, resolving `exec` references. |
| In-session switching | A bindable key (user-assignable, no fixed default beyond suggesting F9) cycles through an installation's assigned profiles and echoes the newly active profile's name to the console. |
| Switch persistence | Session-only. Next launch always loads the installation's designated default profile. |
| Validator scope | Checks every engine actually reached through the profile's assigned installations as an equally-weighted error surface — no primary/portability two-tier severity. |
| Design | Full re-implementation in the launcher's design system — no reuse of q2-config-manager's CSS or React components. |

## 4. Core terms & model

```
Profile (central, in state.json)
  id, name, engine-agnostic content model (bindings, alt layers, categories/
  messages, cvars) — see "Settings" & "Controls" below
  ── assignments: Installation.id[] (many-to-many)

Installation (existing, src/shared/types/installation.ts)
  ── assignedProfiles: { profileId, isDefault }[]
  ── playedMods: string[]  (gamedir names getting the autoexec.cfg copy)

Write flow (per assigned, non-running installation):
  Profile save
    → resolve target Installation
    → write profile content to <install>/baseq2/<profile file(s)>
    → write/refresh the exec chain so the designated default loads at launch
    → copy autoexec.cfg into <install>/<mod>/ for every mod in playedMods
    → back up any pre-existing file before first overwrite (diff, not blind rewrite)
```

Profile-switch bind (per installation with >1 assigned profile): an alias bound to a key the
user picks, that on each press `exec`s the next assigned profile's file and echoes its name —
the same self-rewriting alias-pair mechanism the alt-layer editor already uses for toggle
layers.

## 5. Feature areas (carried over from q2-config-manager, redesigned)

Functional behaviour and the engine facts behind each area are unchanged from
q2-config-manager (README, cited against engine source: `id-Software/Quake-2` 3.20,
`tastyspleen/r1q2-archive`, `q2pro/q2pro`). Only the surrounding data model (profiles are
central, assigned to installations) and the UI (launcher design system) change.

- **Setup & profiles** — create from standard template, empty, as a copy of another profile,
  or import an existing config; assign to installations; mark one default per installation.
- **Overview / keyboard** — bound/free/doubly-bound key view; test mode captures real key
  presses and shows the fully resolved alias chain that would execute.
- **Controls** — a single capped-width (~1120px) column grid (`ControlsGrid`/`ControlsRow`/
  `BindSlot`/`ControlsOptionsCell`) replaces the old per-category panel idioms: sticky headers
  (Action · reset · Primary · Secondary · Options), 40px zebra-striped rows grouped by the
  action catalogue's own groups (an ungrouped run for custom categories with no catalogue
  group), and always-visible bind-slot cells — "Empty" when unbound, a bound row's primary slot
  the strongest visual element in the row, and a small modifier cap (`ALT R`) for keys bound
  into an alternate layer. A profile-wide conflict scan (`lib/bind-conflicts.ts`) feeds a
  header badge and marks the conflicting slots and rows. A name/command filter narrows rows
  live, with a "n rows · m bound" footer count. Categories (Movement, Weapons, Weapon dropping,
  custom) live in a horizontally scrollable rail; each still carries its own team messages,
  item timings and multi-command actions. Message editor with `$$loc_here`-style meta-variable
  vs. server-substituted (`%l`, `%h`, `%a`) macro distinction; symbol/colour picker for the
  latin-1 high-ASCII character set (round-tripped byte-for-byte, never UTF-8). A whole-profile
  "Restore defaults" (`lib/restore-defaults.ts`) writes every catalogue row's suggested key back
  and clears entries with no catalogue default, behind a confirm dialog.
- **Alternate binding layers** — since Quake 2 has no native modifiers, the editor generates
  both alias halves (`+layer`/`-layer` for hold, self-rewriting pair for toggle) and warns
  when a layer remaps a key carrying a `+command`, which would leave movement stuck on
  release.
- **Settings** — player/graphics cvars with per-engine defaults, clamps and special-value
  warnings (e.g. `r_maxfps 0` meaning "5 FPS" on R1Q2 vs. "uncapped" on Q2PRO); cvars the
  engine doesn't have are named, not silently hidden.
- **Validator** — per the table in [§3](#3-design-decisions-taken-from-the-requirements-interview):
  every engine an assigned installation actually uses is checked as an error surface. Hard
  limits carried over verbatim: `MAX_ALIAS_NAME` 32, `ALIAS_LOOP_COUNT` 16, no in-quote
  escaping, per-engine command-buffer sizes (8192 / 65536 / 65536 with EFBIG-on-overflow for
  Q2PRO), the 1024-byte per-line `Cbuf_Execute` limit that the auto-split and alt-layer part
  aliases exist to avoid.
- **Cleanup** — scans an installation's tree for config copies made redundant by the search
  path (mod-folder copies other than `autoexec.cfg`) and removes them.

## 6. Integration with existing systems (architecture notes)

- **Module wiring** follows [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module)
  exactly: `src/shared/modules/config.ts` contract, `src/main/modules/config/index.ts`
  `MainModule`, renderer view + typed client in `src/renderer/src/modules/config/`, i18n keys.
  Manifest already exists (`MODULE_MANIFESTS.config`); only `status` moves off `'planned'` once
  the renderer view is registered.
- **Persistence**: central profiles are a new top-level array in `state.json` (alongside
  `installations`), written through the existing `JsonStore` atomic-write pattern
  (`src/main/lib/json-store.ts`) and covered by the existing migration framework
  (`src/main/services/migrations.ts`) — not `Installation.moduleData`, since a profile is not
  owned by one installation. `Installation` gains `assignedProfiles` (profile id + `isDefault`)
  and `playedMods`.
- **`state.json` is a cache, the `.cfg` is the source of truth** (story 043). Two startup steps in
  `src/main/modules/config/rebuild.ts`, run in this fixed order by `configModule.setup()`:
  1. **One-time format migration** (AC8), gated by the new top-level state key
     `configFileSourceMigratedAt` (an ISO timestamp; a *new key*, not a `STATE_SCHEMA_VERSION`
     bump — `MIGRATIONS` stays empty, same precedent as `configPlayedMods`). On the first start
     after the update, every profile record already in `state.json` has its canonical `.cfg`
     rewritten from cached state into the current 040/042 format through the normal write path
     (`writeCanonicalProfileFile`), and its `fileHash` seeded from what was written — so the first
     read of that file reports `unchanged`, not a false `changedOnDisk`. The guard is only set once
     the whole set succeeded; a partial run leaves it unset and the next start retries (rewriting an
     already-correct file is a diff-skipped no-op). The guard is write-once in `StateStore`, so
     nothing can reset it and re-run the migration over files that are, by then, authoritative.
  2. **Rebuild-on-missing-record**, every start: every launcher-owned `.cfg` in the canonical
     directory whose ownership id has no record in `state.json` gets a record rebuilt from that
     file, **keeping that file's own id**. Since story 051, a profile file's ownership id is read
     through `src/shared/config/file-ownership.ts`'s `readOwnershipStamp`, which recognises both the
     current header-block shape (the id lives in the header's `[q2l v=1 id=…]` tag,
     `docs/systems/profile-file-format.md#header-block`) and a pre-051 file's legacy sentinel line —
     the id is always on the *file*, never derived from `state.json`. That is the deliberate opposite
     of story 042's import rule (an import of a foreign file always mints a *new* id): the file's own
     id *is* the profile's identity, so reusing it is what keeps every installation assignment
     pointing at that profile valid. A `.cfg` with no recognised ownership marker — a hand-written
     config, or another tool's file — is never adopted. Only installation assignments and played mods
     are lost by a rebuild (they are launcher bookkeeping, not file content); name, cvars, binds,
     entries, categories, layers, the `unbindall` setting and the section-header style all come back
     off the file.

  Neither step deletes anything, and neither adds backup logic: `writeTargetFile`'s existing
  diff-skip / backup-once / atomic-write contract and `state.json.bak` are untouched.
- **Write cadence: explicit save** (story 043 D4), the deliberate inversion of story 022's
  "every mutation writes immediately". Content mutations (`setCvars`, `setBinds`, `setLayers`,
  `setActions`, `rename`, `setWriteUnbindall`, `setSectionHeaderStyle`) still persist into
  `state.json` at once — a crash must not lose an edit — but touch no file; they mark the profile
  `dirty`. `CONFIG_HANDLERS.save` is the only writer of profile content: it re-reads the canonical
  file (found by its ownership id — the header block's `id` tag field, or a pre-051 file's legacy
  sentinel line, both read through `file-ownership.ts` — not by the name the profile currently
  resolves to, so a renamed-but-unsaved profile is still checked against the file it actually has), refuses with a
  whole-file conflict when the file changed underneath or cannot be read, and otherwise writes it
  and runs the unchanged installation cascade. Every other sync trigger (`assign`, `unassign`,
  `setDefault`, `write`, `create`, `tidyUp.apply`, the startup retry sweep) still syncs immediately,
  but under one rule enforced centrally in `syncAndPersist`: **a `dirty` profile's canonical file is
  never written by anything but `save`, and its per-installation copies are written from that file's
  own bytes** — so unsaved edits cannot reach an installation through another operation's sync run
  (AC6). The same rule decides what `syncState`/`rawFiles` judge an installation copy against, so
  the writer's and the readers' reports of one file cannot disagree.
- **Never overwrite bytes nobody has read** (story 043 D10, AC5's other half). `dirty` says the
  cache is *ahead* of the file; it says nothing about the file having moved *underneath* the
  launcher, so the same central rule in `syncAndPersist` also refuses a canonical write whenever the
  file's current bytes hash to something other than that profile's cached `fileHash` — unless there
  is no file, no baseline yet (a pre-migration profile), the bytes already equal what would be
  written, or the user explicitly chose "overwrite with my version" (`save({ force: true })`). This
  closes the paths a save's own re-read cannot cover: an `assign`/`setDefault`, a rename cascade,
  and above all the **startup retry sweep**, which runs before the renderer exists and therefore
  before any focus re-read could have adopted an edit made while the launcher was closed. A refused
  write is not a failure: nothing is recorded in `configWriteFailures`, and the canonical row simply
  reports `outOfSync`, which is what invites Reload/Compare.
- **Named limitation**: an entry with **no key** whose command is exactly its catalogue default has
  no representation in the rendered file at all (no alias line, no bind line, no anchor line), so
  adopting an externally edited file — or rebuilding from one — cannot bring it back. Nothing about
  the profile's behaviour in the engine is lost with it (it was bound to no key), only a
  half-configured Controls row. Pinned in `file-source-pipeline.test.ts`; fixing it means adding an
  anchor line to story 042's on-disk format.
- **Filesystem writes**: go through the same path-trust rules as the rest of main — profile
  writes only ever target `<installation.path>/baseq2` and `<installation.path>/<mod>` for
  mods already known to the installation, never an arbitrary renderer-supplied path
  (`src/main/lib/schemas.ts`).
- **Game-lifecycle**: applying a profile to a running installation must be skipped and queued,
  per the `game-lifecycle` dependency already called out for the `mods` module in
  [ROADMAP.md](../ROADMAP.md#mods--game-directories) — this module needs the same guard.
- **Design system**: rebuilt on the existing primitives — `Panel`, `SectionLabel`, `Badge`,
  `Button`/`IconButton`, `controls.tsx` (`Field`, `Input`, `Select`, `Switch`, `Checkbox`),
  `Modal`, `ProgressBar` (`src/renderer/src/components/ui/`) — with the `flame` accent, Oswald
  display headings and the sharp, near-flat geometry (`radius-xs`–`xl`, 1–6px) from
  `styles/index.css`. Bespoke visuals (keyboard layout, alt-layer diagram, symbol/colour
  picker) are new components built against the same tokens, not ports of the old CSS.
  `LibraryView.tsx` is the closest existing reference for page layout conventions.
- **Engine data**: `src/core/engines.ts` / `src/core/settings.ts` from q2-config-manager (cvar
  defaults, clamps, buffer sizes, all source-cited) are the factual basis to port into this
  module's core logic — the citations, not the original file structure, are what must survive.

## 7. Requirements

- CFG-1 Profiles can be created empty, from the standard template, as a copy of another
  profile, or by importing an existing `config.cfg`/`autoexec.cfg` from an installation.
- CFG-2 A profile can be assigned to any number of installations; an installation can have any
  number of assigned profiles, with exactly one marked default.
- CFG-3 Saving a profile writes it to every assigned installation that is not currently
  running; running installations are skipped and shown as pending.
- CFG-4 Writing a profile always backs up a pre-existing file before first overwrite and diffs
  rather than blindly rewriting.
- CFG-5 `autoexec.cfg` is copied into every mod folder the user has marked "played" for that
  installation, in addition to the `baseq2` write.
- CFG-6 An installation with more than one assigned profile exposes a user-bindable key that
  cycles to the next assigned profile in-session and echoes its name to the console; this does
  not change the installation's default.
- CFG-7 The keyboard/overview view shows bound, free and doubly-bound keys, with a test mode
  that resolves and displays the full alias chain a captured keypress would trigger.
- CFG-8 The alt-layer editor generates both alias halves for hold and toggle layers and warns
  when a layer remaps a key that carries a `+command`.
- CFG-9 The settings view shows, per cvar, the current value, the engine's default, its clamp
  range, and a warning when the value is one the engine treats specially; cvars the engine
  lacks are named, not hidden.
- CFG-10 The validator checks a profile against every engine reached through its assigned
  installations, each as an equally-weighted error surface, with the existing hard-limit and
  per-engine-cvar-meaning findings from q2-config-manager.
- CFG-11 Cleanup, per installation, finds and removes config copies made redundant by the
  Quake 2 search path.
- CFG-12 All UI in this module is built from the launcher's existing design-system tokens and
  component primitives; no CSS or component is ported from q2-config-manager.

## 8. Open points

1. Exact on-disk file layout for the profile-switch alias chain (one file per profile execed
   directly vs. a thin loader indirection, given the existing auto-split-for-size mechanism) —
   to be nailed down during `/refine` of the relevant story.
2. Direct numbered profile selection (bind `1`–`9` to jump straight to a profile) is deferred:
   conflicts with default weapon-select binds. Revisit once the cycle-and-echo mechanic (F9
   suggested, user-bindable) is in use and real friction is known.
3. Whether `playedMods` (which mod folders get the `autoexec.cfg` copy) is user-maintained in
   this module or later derived from the `mods` module once it exists — for now, user-maintained
   here.
4. No decision yet on how `state.json`'s new `configProfiles` array interacts with installation
   deletion (`installations:remove`) — orphaned assignments need a migration/cleanup rule,
   to be resolved during refine.
