# Sprint S05 review — A profile is a file, not a bookkeeping tab

## Overview

**Goal:** a config profile is a real `<name>.cfg` that exists the moment the profile does, kept in
sync automatically, readable with real Quake II syntax highlighting from one viewer used
everywhere a config's text is shown, and the maintenance side of a profile (validation, sync
state, tidy-up actions) lives in one Care tab instead of being split across Validation, Write
targets and a "Preserved lines" side tab.

| Story | Status | Commit |
| --- | --- | --- |
| 022 — A profile is a real `<name>.cfg` that exists before any assignment | done | `4254033` |
| 023 — Raw File absorbs Write targets | done | `6b32bbf` |
| 024 — Read the config with Quake 2 syntax highlighting | done | `ab625a6` |
| 025 — Validation becomes Care | done | `e28384f` |

All four stories done, in build order, no blocked story.

## Implemented stories

- **022** — Every profile now owns a canonical `<name>.cfg` in userData, written the moment the
  profile exists. Per-installation copies are name-based too (not id-based), with case-insensitive
  collision disambiguation and automatic migration/rename of old `q2l-profile-<id>.cfg` files plus
  their `autoexec.cfg` `exec` line. The write trigger moved out of a renderer component into main,
  firing on every mutating handler; a new read-only `syncState` channel plus a persisted
  `configWriteFailures` map back the Care tab's sync section (025) and expose per-row
  present/matches/error state with retry.
- **023** — The "Write targets" tab is gone. Raw File now always shows the profile's own canonical
  file (even unassigned) plus one row per assigned installation, each with open-in-editor,
  reveal-in-folder, present/matches status and a played-mods selector (the setting that tab used
  to own, moved here per this sprint's clarification round). The automatic write-on-change moved
  into a tab-independent hook, closing a latent bug where it effectively only fired while that tab
  happened to be mounted.
- **024** — A pure, lossless, positional Quake II config tokenizer in `src/shared`, plus a
  memoized, gutter'd `ConfigCodeView` with design-token colours and a container-scoped find-in-file
  control (added to this sprint's scope by the clarification round). It replaces the old plain
  `CodeBlock` in Raw File, the write-preview dialog and the import preview — one renderer, not
  three. The reference VS Code extension is GPL-3.0; nothing was read from or derived from it, the
  tokenizer is built from engine facts already in this repo.
- **025** — "Validation" is now "Care": the untouched story-009 multi-engine report, a sync section
  rendering story 022's per-file state with retry, a tidy-up section (bind conflicts, empty layers,
  unreferenced aliases, undefined-alias reports, preserved-line drop/re-classify) with per-item
  preview and a "fix all safe findings" batch action behind a warning modal, the folded-in
  Preserved-lines tab, and the installation-wide mod-copies cleanup relocated here from the profile
  list, scoped to the profile's assigned installations with a "scan any installation" widening
  control. A Care-level summary distinguishes "all clear" from "not checked yet".

## Findings & decisions

**From the clarification round (binding user decisions, now implemented):**
- Per-installation profile copies are name-based, not id-based; names must be unique, collisions
  disambiguated rather than overwritten.
- The canonical file lives in userData next to `state.json`, not a separate visible "profiles"
  folder.
- The played-mods selector moved into Raw File's per-installation rows; write errors/retry live
  only in the Care tab, not duplicated into Raw File.
- Syntax highlighting's scope grew to include find-in-file for this sprint.
- The mod-copies cleanup inside a profile's Care tab is scoped to that profile's assigned
  installations by default, with a widening control — not global by default.
- Tidy-up ships both individual apply and a "fix all safe findings" batch button with an explicit
  pre-apply warning.

**Bugs caught by review/live-smoke and fixed before landing (not left as debt):**
- 022: a rename that collided a profile into another profile's sanitised name could clobber that
  other profile's canonical file, because only the mutated profile was re-synced. Fixed with a
  cascading re-sync (every profile whose resolved name changed is re-synced, displaced files moved
  first) plus an independent guard in the writer that refuses to overwrite a destination still
  holding a different live profile's sentinel.
- 023: `setPlayedMods` carried the same double-`Outcome`-unwrap bug that was already known from
  `RawConfigPanel`'s `config-raw` crash (see below); a missing `assignmentKey` fetch dependency left
  Raw File's per-installation rows stale after assign/unassign.
- 024: a CSS grid track-sizing bug let the gutter column swallow nearly all width; `plusCommand`
  tokens were only classified at segment-start, missing `bind s +back`; `Ctrl+F` was unreachable
  unless focus was already inside the search box.
- 025: the de-duplicated tab badge (validator + tidy-up findings) broke for non-r1q2 profiles
  because `Finding.id` is engine-prefixed but the tidy-up analyzer always computed at a fixed
  `r1q2`; an unassigned profile's zero validation counts could read as "clean" instead of "not
  checked"; the whole Care summary vanished if the sync-state fetch failed; live-smoke caught a
  fresh axe **critical** (`select-name`) on the relocated cleanup panel's installation picker,
  fixed directly.

**Gap closed from S04:** the pre-existing `RawConfigPanel` `config-raw` crash (a double-unwrapped
`Outcome`, open since S04's story 026, resurfaced twice since) is fixed as a side effect of 022's
and 023's own bug-fixing — `npm run ui:verify` no longer exits non-zero on that route. See the
roadmap update below.

**Carried-over, deliberately out of scope (documented with reasons in the stories' own Done
sections, not silently dropped):**
- `setPlayedMods`/`setSwitchBind` (022) still write without a sync pass — a switch-bind chain can
  `exec` a not-yet-migrated file name until the next real sync; not listed under the story's own
  write-trigger decision, so left alone.
- A path-comparison inconsistency in `canonical.ts` (`!==` vs. the writer's `pathKey`) — harmless on
  Windows, noted for awareness.
- The write-preview dialog and import preview are not part of `ui:verify`'s automated screen
  registry (pre-existing harness scope, not a S05 regression) — their manual acceptance is on the
  test plan below rather than the automated gate.
- 025's main-side `removeShadowedBind` trusts the renderer analyzer's "loser" claim rather than
  re-deriving it server-side — unreachable today by design (main re-validates every op before
  applying), flagged for a future hardening pass if that assumption ever changes.

## Blocked / open

None — all four stories landed `done` in this sprint, no open user question remains unanswered.
