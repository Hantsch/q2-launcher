# Sprint S01 Review — Config module foundation

## Overview

Goal: prove the central-profile model end to end — create a profile, assign it to real
installations with a default, edit its cvars, save, and see the correct `config.cfg`/
`autoexec.cfg` land on disk (with backup) for every non-running assigned installation, or
import an existing config as the starting point instead of building one from scratch.

All 5 planned stories were built. All are code-complete, tested and code-reviewed; none has
had a live UI smoke test (see [Blocked / open](#blocked--open)).

| Story | Status | Commit |
| --- | --- | --- |
| 001 — Config module scaffold and central profile store | built, reviewed, live acceptance pending | `84bf320` history (pre-sprint-01 session) |
| 002 — Profile-installation assignment and default profile | built, reviewed, live acceptance pending | `400e38d` |
| 003 — Settings/cvar editor with per-engine defaults and clamps | built, reviewed, live acceptance pending | `366e2ce` |
| 004 — Write profile to assigned installations on save | built, reviewed, live acceptance pending | `1ea6cc4` (resumed after session-limit interruption, `afe3966`) |
| 005 — Import an existing config into a new profile | built, reviewed, live acceptance pending | `1671554` |

Branch: `sprint/01`, cut from `dev`. `npm run build` and `npm test` green after every story
(148 tests at sprint end across all 5 stories' suites, no regressions introduced by later
stories on earlier ones).

## Implemented stories

**001 — Config module scaffold.** Wired the `config` module in along the standard 5-step
checklist: a persisted `configProfiles` array in `state.json`, a main-process CRUD module
(`list`/`create`/`rename`/`remove`) over the existing `module:invoke` envelope, and a
master/detail renderer view (create from empty or a small vanilla standard template, rename,
delete) built entirely from existing design-system primitives. No new IPC channel, no
`STATE_SCHEMA_VERSION` bump.

**002 — Profile-installation assignment.** Many-to-many assignment between profiles and
registered installations, with the invariant "at most one default per installation" enforced
by pure, unit-tested logic (auto-default on first assignment, promotion on unassign). A
reconcile sweep drops assignments to installations that no longer exist. Both a
profile-side assignment panel and a read-only installation-side overview were added to the
config view.

**003 — Settings/cvar editor.** Ported the source-cited r1q2/Q2PRO/vanilla cvar fact catalog
(30 cvars — defaults, clamp ranges, special-value notes, `source:` citations) from the sibling
`q2-config-manager` project into `src/shared/config/`, verbatim, with all prose replaced by
i18n keys. A `SettingsTab` groups the catalog into Player/Graphics panels with debounced
autosave; an engine-scope selector derives the profile's assigned engines and flags per-cvar
cross-engine disagreement (e.g. `r_maxfps 0` behaving differently on r1q2 vs. Q2PRO).

**004 — Write profile to assigned installations on save.** A deterministic renderer turns a
profile into latin-1 `.cfg` text; a writer does backup-once/diff-skip/atomic writes into each
assigned, non-running installation (`baseq2/q2l-profile-<id>.cfg` + a thin `autoexec.cfg`
loader, copied into played-mod folders), with a preview modal showing the exact bytes that
would be written. A running installation is skipped and the write goes into a retried
`pending` state instead. Two review findings were fixed post-implementation: the loader could
point at a default-profile file that was never itself written, and the write briefly fired on
mere profile *selection* rather than only on save.

**005 — Import an existing config into a new profile.** A pure Quake II config tokenizer plus
a filesystem reader that resolves `exec` inline against the gamedir → `baseq2` search path
(load-order merge, cycle/depth/total-fan-out guards), surfaced as a fourth "Import from
installation" option in the create-profile flow. Recognized `set`/`seta`/`setu`/`sets` and
`bind`/`unbind`/`unbindall` lines populate the new profile's cvars/binds; everything else
(`alias`, `+cmd`, unparsable lines) is preserved verbatim and stays visible in a permanent
"Preserved lines" panel on the profile. Import is read-only — the first disk write happens on
the next normal save (story 004). One review finding was fixed post-implementation: an
unbounded `exec` fan-out (up to 2^16 files under a legal, non-cyclic branching config) is now
capped at 512 total file opens.

## Findings & decisions

Aggregated from each story's `## Decisions (Sprint)` / Done sections — relevant for planning
the next sprint:

- **File layout decision (004):** one generated file per profile
  (`baseq2/q2l-profile-<id>.cfg`) plus a thin per-installation `autoexec.cfg` loader that only
  `exec`s the *default* profile's file. This is what makes the later profile-switch bind
  (CFG-6, next sprint) a one-file edit instead of N per-mod config rewrites — keep this shape
  in mind when planning that story.
- **`config.cfg` is never written by the launcher**, only read (import). It is engine-owned
  and gets flushed by the game itself; all launcher content lives in the `autoexec.cfg` chain,
  which the engine execs after `config.cfg` and therefore wins.
- **Backup-once/diff-skip is the standing write contract** (`<file>.q2l-backup`, ownership
  sentinel comment, atomic tmp+rename) — any future writer touching a user's game folder
  should reuse `writeFileAtomic`/the existing backup helper rather than re-inventing it.
- **`playedMods` and pending-write state are session-local to the config module**, not on the
  shared `Installation` type — deliberate, to avoid colliding with story 002's concurrent
  `Installation` changes. Two accepted, narrow gaps from 004's review are worth a follow-up if
  they surface in practice: the played-mods checkbox state doesn't persist across app restarts
  (no getter was added to the contract), and a second save to the same *running* installation
  before the first pending write resolves can only track the more recent pending profile.
- **Import recognizes a deliberately narrow set this sprint** (`set*`/`bind*` family only).
  `alias`/`+cmd` handling and the alternate-binding-layer concept are explicitly deferred to a
  later sprint per the concept doc — everything unrecognized is preserved, never dropped.
- **Engine fact catalog only covers r1q2/Q2PRO/vanilla** (`hasEngineFacts()`), matching the
  concept's explicit scope; other engine kinds show an explicit "no engine facts" state rather
  than silently reusing r1q2's numbers.
- **Recurring environment constraint:** this sandbox cannot launch Electron under WSL
  (`electron.exe` is the Windows-native binary; no X server/driver, no headless fallback
  installed). Every story's live-UI-smoke step was therefore skipped by design, not by
  oversight — see below.
- **Two housekeeping fixes landed alongside 004's resume**, unrelated to any single story: a
  stray CRLF-only diff on `LICENSE` was committed to get a clean working tree, and story 005's
  already-completed refine output (left uncommitted by the interrupted prior session) was
  committed at sprint start.

## Blocked / open

No story is blocked in the sense of an unresolved spec question — all 5 are functionally
complete, reviewed, and green on `npm run build` / `npm test`.

**All 5 stories are "built, reviewed, live acceptance pending" (P2 exemption used
throughout):** `ui-acceptance-required: true` and `live-smoke-required: true` apply to this
project, but every build session in this sprint ran in a headless WSL sandbox where
`node_modules/electron`'s Windows-native binary cannot execute
(`electron.exe: 3: Syntax error: Unterminated quoted string`) and no display server or
`xvfb`/`playwright-core` fallback is installed. `npm run dev` starts the Vite dev server
cleanly every time; only the actual Electron window never opens. This is an environment
limitation, not a code defect — each story's manual `## Test Plan (manual acceptance)` section
is written and ready, but none of them has been walked through the real UI yet.

**Decision the user needs to make:** run `docs/sprints/S01/testplan.md` against a real
Windows/Electron environment (or set up a working Linux display/Electron path in this sandbox)
before treating any of 001–005 as truly done. Until then, none of the milestone's stories
should be marked "accepted" in the roadmap.
