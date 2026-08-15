---
id: 004
title: Write profile to assigned installations on save
status: in-progress
created: 2026-08-14
---

## Requirement

As a user, when I save a profile, I want it written to every installation it's assigned to
(except installations currently running), so the settings I configured actually take effect
in the game — not just inside the launcher's own state.

Per [docs/concepts/config-module.md](../concepts/config-module.md#4-core-terms--model): writes
target `<installation>/baseq2`, and `autoexec.cfg` is additionally copied into every mod folder
marked "played" for that installation (`FS_ExecAutoexec` never consults the search path, unlike
everything else). Depends on stories 001–003 (profile content and assignment must exist).
Filesystem writes stay inside the existing path-trust rules — only `baseq2` and known mod
folders of an already-registered installation, never an arbitrary path.

## Acceptance Criteria

- [ ] Saving a profile writes its content into `<installation>/baseq2/` for every non-running
      installation it is assigned to.
- [ ] `autoexec.cfg` is additionally copied into every mod folder the user has marked "played"
      for that installation.
- [ ] A pre-existing file is backed up before its first overwrite; later saves diff rather than
      blindly rewriting.
- [ ] An installation that is currently running is skipped, shown as "pending" in the UI, and
      picked up on the next save (or an explicit retry) once it's no longer running.
- [ ] I can verify on disk (or via a launcher preview) that the written file's content matches
      what I configured in the profile.

## Open Questions

- ~~Detecting "currently running" needs the `game-lifecycle` guard called out for the `mods`
  module in [ROADMAP.md](../ROADMAP.md#mods--game-directories).~~ **Resolved during refine** —
  see Decision 1 below. No open questions remain.

## Decisions (Sprint)

1. **Lifecycle guard already exists — nothing new is built here.** `LaunchService`
   (`src/main/services/launch.ts`) already owns the game process and exposes
   `getState(): LaunchState` with `phase` (`idle|starting|running|exited|failed`) and
   `installationId`, plus the `launch:state` broadcast; it also refuses a second launch
   (`isRunning()`), so at most one installation is running at a time. The config module reads
   `app.launch.getState()` through its `ModuleSetup` and treats
   `phase === 'starting' | 'running' && installationId === target` as "running" — reason: the
   guard is reusable as-is, and reading a shell service beats editing the shell
   (CLAUDE.md: a feature is a module, never a shell edit).
2. **Limitation accepted, not worked around:** a game started outside the launcher is not
   detected (no PID/process scanning) — reason: r1q2 has no lock file, process scanning is
   platform-specific guesswork, and the backup + diff rules keep a stray write recoverable.
3. **File layout on disk** (the concept's open point 1, explicitly deferred to this refine):
   per profile one generated file `<install>/baseq2/q2l-profile-<profileId>.cfg`, plus a thin
   `autoexec.cfg` that only `exec`s the installation's default profile file — reason: `exec`
   *does* use the search path, so the per-mod `autoexec.cfg` copies stay one-liners pointing at
   the single baseq2 profile file, and the later profile-switch bind (CFG-6) becomes an edit to
   one loader file instead of N config copies.
4. **`config.cfg` is never overwritten.** It is engine-written (ROADMAP: archived cvars are
   flushed by the game itself), so anything we put there is lost on the next quit; profile
   content lands in the `autoexec.cfg` chain, which the engine execs after `config.cfg` and
   which therefore wins. `config.cfg` is only ever *read* (story 005 import).
5. **Ownership marker:** every generated file starts with a sentinel comment line
   (`// q2-launcher profile <id> — generated, do not edit`) — reason: it distinguishes our file
   from a user's hand-written `autoexec.cfg`, so a backup is taken exactly once, for the user's
   original, and never for our own previous output.
6. **Backup + diff rules:** before the first overwrite of a non-owned file, copy it to
   `<file>.q2l-backup` (only if that backup does not exist yet); if rendered content equals the
   on-disk bytes, skip the write entirely — reason: this is literally CFG-4 / ROADMAP's "back
   up and diff rather than rewrite", and skipping no-op writes keeps mtimes stable.
7. **Encoding/newlines:** files are written `latin1`, byte-for-byte, with `\n` line endings —
   reason: the concept requires latin-1 high-ASCII round-tripping and forbids UTF-8; the Quake
   parser is newline-agnostic.
8. **Writes are atomic** via a `writeFileAtomic` helper added to `src/main/lib/fs-utils.ts`
   (tmp file + `rename`, mirroring `src/main/lib/json-store.ts`) — reason: a crash mid-write
   must never leave a truncated config in a user's game folder.
9. **Path trust:** the renderer sends `profileId` only; main resolves every target path from the
   registered installation (`rootPath` + `baseq2` + mod names checked against
   `installation.gameDirs` and the existing single-ASCII-token rule) — reason: CLAUDE.md's
   "paths from the renderer are never trusted".
10. **`playedMods` lives in the config module's own store slice** (per-installation record next
    to the profiles introduced by story 001), not on the shared `Installation` type — reason:
    story 002 is concurrently changing `Installation`, and the concept's open point 3 keeps
    `playedMods` user-maintained inside this module for now.
11. **Pending state is persisted** per installation in that same slice and re-tried both on the
    next profile save and via an explicit "Retry" button; no auto-retry listener on
    `launch:state` — reason: AC wording asks for exactly these two triggers, and a listener
    would write into a game folder without the user asking.
12. **Preview instead of "go look on disk"** for AC5: a `preview` handler returns the exact
    rendered text per target file, shown in a modal — reason: `ui-acceptance-required: true`,
    so the verification path must exist in the UI.
13. **Contract naming** follows `src/shared/modules/library.ts`: `CONFIG_HANDLERS` with
    `write`, `preview`, `writeState`, `setPlayedMods` — reason: mirror the reference module
    rather than invent a second convention.

## Plan

Deliver the write pipeline as a module-local core (render → write) behind the existing
`module:invoke` seam, then the UI that triggers and reports it.

1. **Render** — `src/main/modules/config/render.ts`: profile (cvars from story 003, name/id from
   story 001) → deterministic `.cfg` text for the profile file, plus the one-line loader text
   for `autoexec.cfg`. Pure, latin-1, sentinel header. Unit-tested.
2. **Write** — `src/main/modules/config/writer.ts`: resolve targets from the *registered*
   installation, backup-once, diff-skip, atomic write, copy the loader `autoexec.cfg` into each
   `playedMods` folder. Adds `writeFileAtomic` to `src/main/lib/fs-utils.ts`. Unit-tested
   against a temp dir.
3. **Wire** — `src/shared/modules/config.ts` (contract) + `src/main/modules/config/index.ts`
   (handlers): fan out over the profile's assigned installations (story 002), skip running ones
   via `app.launch.getState()`, persist pending ids, return a per-installation result list.
4. **Surface** — renderer client + a "Write targets" panel on the profile view from story 001:
   save triggers the write, each assigned installation shows written / unchanged / pending
   (running) / error, with a Retry action and a played-mods picker fed by `installation.gameDirs`.
5. **Preview** — modal showing the rendered text per target file, so the result is verifiable
   without leaving the app.

Order matters: 1 → 2 → 3 → 4 → 5. Steps 1–3 are main-only and testable without stories 001–003
being finished (they take the profile shape as a parameter); steps 4–5 attach to 001's view.

## Deliverables

- **D1 — Renderer for profile → cfg text.** `src/main/modules/config/render.ts` +
  `render.test.ts`. Deterministic ordering, sentinel header, latin-1-safe output, loader
  (`exec q2l-profile-<id>.cfg`) text. *Accepted when:* tests cover a profile with cvars, an
  empty profile and a high-ASCII value round-tripping byte-for-byte. Mirror: none (new pure
  module), test style per `src/main/services/launch-plan.test.ts`.
- **D2 — Backup/diff/atomic write of one installation.** `src/main/modules/config/writer.ts` +
  `writer.test.ts`, `writeFileAtomic` in `src/main/lib/fs-utils.ts` (mirror the tmp+rename in
  `src/main/lib/json-store.ts`). Writes `baseq2/q2l-profile-<id>.cfg` + `baseq2/autoexec.cfg`,
  copies the loader into each validated `playedMods` folder, backs a pre-existing non-owned file
  up to `<file>.q2l-backup` once, skips identical content. *Accepted when:* tests in a temp dir
  prove backup-once, no-op skip, mod copies, and rejection of a mod name not in `gameDirs`.
  **Covers AC 1 (disk side), AC 2, AC 3.**
- **D3 — Contract + module handlers with the running guard.** `src/shared/modules/config.ts`
  (extend 001's contract with `write`/`preview`/`writeState`/`setPlayedMods` and their types),
  `src/main/modules/config/index.ts`. Fans out over assigned installations, skips a running one
  via `app.launch.getState()`, persists pending ids in the config store slice, returns
  `{ installationId, status: 'written'|'unchanged'|'pending'|'error', messageKey? }[]`.
  Mirror: `src/main/modules/library/index.ts`. *Accepted when:* a save writes all non-running
  targets and a faked running state yields `pending` that a later `write` picks up.
  **Covers AC 1 (fan-out), AC 4 (main side).**
- **D4 — Write-targets panel in the config view.** `src/renderer/src/modules/config/client.ts`,
  a `WriteTargets` panel used by 001's profile view, i18n keys in
  `src/renderer/src/i18n/locales/en.json`. Save triggers the write; per-installation status
  badge; Retry action for pending; played-mods checkbox list from `installation.gameDirs`.
  Design-system primitives only (`Panel`, `SectionLabel`, `Badge`, `Button`, `Checkbox`).
  Mirror: `src/renderer/src/modules/library/client.ts`. **Covers AC 4 (UI side), AC 1 trigger.**
- **D5 — Preview modal.** `preview` handler use in the renderer + a `Modal` showing the rendered
  text per target file for the selected installation. *Accepted when:* the previewed text is
  identical to what D2 wrote for the same profile. **Covers AC 5.**

## Model Hints

- `D2 → deliverable-hard` — it is the only irreversible step: a wrong backup-once condition or a
  mis-validated mod path silently destroys a user's hand-written `autoexec.cfg` in their game
  folder, and the atomic-write helper is shared with the rest of main.
- D1, D3, D4, D5 → default tier.
- `Review: → story-review-hard` — the review has to re-check data-loss behaviour (backup before
  first overwrite, no write to a running installation, no path outside `baseq2`/known mods)
  against the spec, which is exactly the class of bug tests can pass over.

## Test Plan (manual acceptance)

1. `npm run dev`, Config → create/select a profile with at least one changed cvar, assign it to
   an installation (story 002).
2. Mark one mod folder of that installation as "played" in the write-targets panel.
3. Put a hand-written `autoexec.cfg` with a recognisable line into `<install>/baseq2/` first.
4. Save the profile. Expect: the panel shows the installation as *written*; on disk
   `baseq2/q2l-profile-<id>.cfg` and `baseq2/autoexec.cfg` exist, `baseq2/autoexec.cfg.q2l-backup`
   holds the original line, and the mod folder has a copy of the loader `autoexec.cfg`.
5. Open Preview — the shown text matches the file on disk.
6. Save again without changes: no backup file is added or overwritten (the `.q2l-backup` still
   holds the *original* hand-written line).
7. Launch that installation, and while the game runs save the profile again: the panel shows
   *pending*. Quit the game, press Retry — it flips to *written*.

## Done
