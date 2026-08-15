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

- [x] Saving a profile writes its content into `<installation>/baseq2/` for every non-running
      installation it is assigned to.
- [x] `autoexec.cfg` is additionally copied into every mod folder the user has marked "played"
      for that installation.
- [x] A pre-existing file is backed up before its first overwrite; later saves diff rather than
      blindly rewriting.
- [x] An installation that is currently running is skipped, shown as "pending" in the UI, and
      picked up on the next save (or an explicit retry) once it's no longer running.
- [x] I can verify on disk (or via a launcher preview) that the written file's content matches
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

**Summary.** Implemented the full write pipeline: a pure `render.ts` (D1) turning a profile into
deterministic latin1 `.cfg`/loader text; `writer.ts` (D2) doing backup-once/diff-skip/atomic
writes plus played-mod loader copies inside a temp-dir test suite; `write`/`preview`/`writeState`/
`setPlayedMods` handlers with the running-installation guard and persisted pending state (D3); a
`WriteTargets` panel with per-installation status badges, Retry and a played-mods checklist (D4);
and a `PreviewProfileDialog` showing the exact rendered bytes per target file (D5). This session
picked up from `afe3966` (WIP, interrupted by a session limit), which had already produced D1–D5
in full — this run's own work was verification, a hard-tier clean-agent review, and fixing the two
medium-severity findings that review raised.

**Decisions (this session):**
- **F1 fixed — default profile's own file is now guaranteed to exist.** The loader always execs
  the installation's *default* profile's file (Decision 3), which can differ from the profile
  being saved (an installation can have several assigned profiles). The original implementation
  only wrote the saved profile's own file, so saving a non-default profile whose installation's
  default was never itself saved left the loader exec-ing a file that did not exist — the engine
  would silently apply nothing, defeating AC1's purpose. Fixed in
  `writeProfileToAssignedInstallations` (`src/main/modules/config/index.ts`): when
  `defaultProfile.id !== profile.id`, both files are now written (default's file first, so the
  exec target exists before the loader is written), with `anyChanged` aggregated across both so
  the existing `written`/`unchanged` status semantics are preserved. `previewProfileFiles` mirrors
  the same branch so a preview never shows fewer files than an actual write produces. Two new tests
  in `index.test.ts` cover the two-profile scenario and the `unchanged`-on-repeat-save case; a
  second clean-agent review ran the real writer against a temp installation and confirmed no
  double-write, no backup clobber, and correct status aggregation.
- **F3 fixed — write no longer fires on mere profile selection.** `WriteTargets`'s effect was
  keyed on `[profile.id, profile.updatedAt]`, which also fires the first time a given `profile.id`
  is mounted — i.e. simply selecting an existing profile in the sidebar wrote to every assigned
  installation's real game folder, contradicting Decision 11 ("no auto-retry listener... a listener
  would write into a game folder without the user asking") and the manual test plan's ordering
  (assign → mark played mods → *then* save). Fixed with a `lastSeenUpdatedAt` ref
  (`Map<profileId, updatedAt>`): the write now only fires when a profile id already seen in this
  component's lifetime gets a new `updatedAt`. Verified (by a second clean-agent review, since this
  is a `.tsx` file the project's node-only vitest setup cannot unit-test) against switching between
  already-edited profiles, a genuine `SettingsTab` autosave while mounted, and React StrictMode's
  double-invoke — all resolve correctly, and `assign`/`unassign`/`setDefault` still correctly cause
  no write (they don't stamp `updatedAt`, confirmed in `assignments.ts`/`ProfilesStore`).
- **Not fixed, documented as accepted:** the first review's other findings (F2, F4–F9) were judged
  lower severity or pre-existing accepted scope limits, and left as-is rather than expanding this
  build further:
  - **F2** (played-mods checkbox state is session-only, per Decision 13's deliberate choice not to
    add a getter to the contract) — already flagged in-code by the original implementer as a
    "Known gap"; reversing Decision 13 is a refine-level call, not a build-time one.
  - **F4** (the pending-write map holds one profile id per installation, so two different profiles
    both pending on the same installation can only track the more recent one) — a real but narrow
    edge case (needs two saves to the same installation while it's running); fixing it cleanly
    needs a `WriteState` shape change (`Record<installationId, profileId>` →
    `Record<installationId, profileId[]>`), which is a contract change beyond this review-fix
    cycle's scope.
  - **F5** (preview omits the per-mod loader copies, showing only the two `baseq2` files) — the
    omitted content is byte-identical to the `baseq2` loader that *is* shown, so nothing is
    misrepresented, only not enumerated per-folder.
  - **F6** (`LICENSE` CRLF→LF and story 005's refine text landed in the same prior commit) — both
    predate this session (already on the branch from before this run) and are unrelated to story
    004's own diff.
  - **F7** (`writeFileAtomic`'s `mkdir(..., { recursive: true })` will recreate a `baseq2` tree
    under an installation whose `rootPath` no longer exists, e.g. an unmounted drive) and **F8**
    (`configPendingWrites`/`configPlayedMods` aren't pruned when an installation is removed, unlike
    `configProfiles`) are both low-severity, narrow edge cases outside this story's acceptance
    criteria; worth a follow-up story if they surface.
  - **F9** (four new files fail `prettier --check`) — the project's `lint`/`typecheck` verify steps
    are both `none` per `.claude/ai-scrum.md`, and 26 files already failed `format:check` before
    this story; not a new gate this build introduced.
  - The second review's own two minor findings (a hand-wrapped ternary Prettier would reflow; the
    residual UX point that a freshly-*assigned* installation has no explicit "write now" affordance
    until the next cvar edit, which is spec-conformant per Decision 11) are both non-blocking and
    left as-is; the third (an `unchanged`-repeat-save test was missing) was cheap and added.

**Files changed (this session; D1–D5's original implementation was already on the branch from the
interrupted prior session, commit `afe3966`):**
- `src/main/modules/config/index.ts` — F1 fix (default-profile-file guarantee in both
  `writeProfileToAssignedInstallations` and `previewProfileFiles`).
- `src/main/modules/config/index.test.ts` — three new tests covering F1's scenario, its
  `unchanged`-on-repeat-save aggregation, and updating one existing preview test for the new file
  count.
- `src/renderer/src/modules/config/WriteTargets.tsx` — F3 fix (`lastSeenUpdatedAt` ref) and updated
  doc comments.
- `docs/requirements/004-profile-write-pipeline.md` — this Done section, Acceptance Criteria ticked.

**Verification:**
- `npm run build` — green (main/preload/renderer all build).
- `npm test` — green, 89/89 tests across 8 files (86 pre-existing from the interrupted session +
  3 new from the F1 fix).
- Code review #1 (clean agent, `story-review-hard` per Model Hints): **PASS with findings** — all 5
  acceptance criteria individually verdicted PASS with file:line evidence; writer.ts's
  backup/diff/path-trust logic (the irreversible step) specifically scrutinized and found correct
  (TOCTOU-safe backup via `COPYFILE_EXCL`, double-gated mod-name validation, case-insensitive
  dedupe, no fallthrough on non-ENOENT read errors); no weakened/deleted/skipped tests; guardrails
  (path trust, module isolation, no new IPC channel, no image assets) all confirmed clean. Findings
  F1–F9 listed above.
- F1 and F3 fixed; code review #2 (clean agent, same tier) re-verified both fixes by running the
  real writer against a temp installation and re-checking the React lifecycle reasoning: **PASS**,
  no regressions, `npm run build`/`npm test` re-confirmed clean.
- **Live smoke NOT run.** `npm run dev` was started and the main/preload/renderer build steps all
  completed, but the Electron launch itself fails in this sandbox:
  `.../node_modules/electron/dist/electron.exe: 3: Syntax error: Unterminated quoted string` — this
  is a Windows `.exe` under WSL with no X server/Electron driver set up in this environment, and no
  project skill exists yet to drive it headlessly (no `playwright-core`, no `xvfb-run` installed).
  Built, acceptance pending: the 7-step manual test plan above is ready to execute but not yet
  performed. Per project policy (P2, `live-smoke-required: true`), status stays `in-progress`
  rather than `done` until a real UI pass confirms it — consistent with how stories 001–003 were
  also left `in-progress` for the same reason.

**Open points:** none blocking beyond the live smoke gate above. F2/F4/F5/F7/F8/F9 are documented,
non-blocking, accepted limitations (see Decisions); none of them affect the story's 5 acceptance
criteria as written.
