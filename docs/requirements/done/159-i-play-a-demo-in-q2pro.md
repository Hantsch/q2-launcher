---
id: 159
title: I play a demo in Q2PRO
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user clicks **Play** on a demo and it starts in the real engine — no console, no remembering the
file name, no dialog on every play (concept `docs/concepts/demo-browser.md` §11, DEMO-21, DEMO-22).

The launcher picks the engine itself: a **Q2PRO** installation that has the demo's game dir, the
**active** installation preferred; the user can override the choice for this play. If no
installation has the game dir, Play is disabled with "Mod `<gamedir>` missing". The launch is
`+set game <gamedir>` + `+demo <relative path>` through the existing `buildLaunchArgs` `extraArgs`
path — **never `demomap`** on Q2PRO, because `demomap` executes stufftext from the demo and a file
from a stranger could run commands (§4). Demos never change the game dir themselves, so the launcher
has to pass it.

This story plays demos that already sit inside the chosen installation's `<gamedir>/demos/`;
everything that needs a temporary copy is [[160]], r1q2 is [[161]], MVD2 specifics are [[162]], the
timeline is [[165]].

## Acceptance Criteria

- [x] **AC1** — Play on a demo starts the **active** installation when it is a Q2PRO that has the
      demo's game dir; there is no tie-break and no other installation is ever picked automatically
      (Decisions (Sprint), User).
- [x] **AC2** — ~~The user can pick a different qualifying installation for this play; the choice
      does not change the active installation.~~ Superseded by the (User) decision: when the active
      installation is not a Q2PRO, Play is disabled with the visible text that the selected
      installation is not Q2PRO and demo playback needs Q2PRO; the user selects a Q2PRO in the left
      rail (which makes it active) and Play becomes available. There is no per-play picker.
- [x] **AC3** — With no installation that has the demo's game dir — or an active Q2PRO that lacks
      it — Play is disabled with the visible text "Mod `<gamedir>` missing".
- [x] **AC4** — The launch arguments are exactly `+set game <gamedir>` and `+demo <path relative to
      the game dir's demos>`; a unit test asserts `demomap` never appears for Q2PRO.
- [x] **AC5** — The play handler takes the demo's id and the chosen installation's id only; main
      resolves and validates the path, and a demo outside that installation's file system is not
      launched in place.
- [x] **AC6** — While the demo plays, the launcher treats it as a running game (game-lifecycle), the
      same as a normal launch.
- [x] **AC7** — On Linux with no Q2PRO installation, Play is disabled with its reason as visible text
      (concept §13, `linux-support-analysis.md` B1).
- [x] **AC8** — An e2e flow plays a fixture demo against a stubbed engine process; no test starts a
      real engine.

## Open Questions

- [ ] ~~**Q1 — Tie-break** — several qualifying installations and none active: most recently played,~~ answered → Decisions (Sprint)
      alphabetical, or ask once?
- [ ] ~~**Q2 — Where Play lives** — detail view only, or also on the row?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Tie-break: No tie-break. The active installation is the one that plays; if it is not a Q2PRO, show a notice that the selected installation is not Q2PRO and demo playback needs Q2PRO, and the user picks a Q2PRO installation in the left rail, then plays. (Play stays disabled with that reason as visible text until then.)
- **Q2 — Where Play lives:** detail panel only, next to the file actions. Concept §10 lists Play
  under "Detail / edit". A disabled Play also needs room for its visible reason, and the dense 56px
  row, which already carries two touch-target deviations, does not have that room.
- **AC1/AC2 rewritten to the (User) decision:** the rail selection *is*
  `settings.activeInstallationId`. It is one concept: `InstallationRail.tsx` calls
  `setActiveInstallation`. So "pick in the left rail" changes the active installation, and the old
  AC2 per-play picker is withdrawn.
- **Reason precedence:** the first match wins and one visible reason shows, so the most actionable
  reason, and the one least dependent on which installation is selected, comes first:
  1. On Linux with no Q2PRO installation at all: `linuxNoQ2pro`, "Not available on Linux: demo
     playback needs a Q2PRO installation".
  2. No installation of any kind has the game dir: `modMissing`.
  3. No active installation, or the active one is not Q2PRO: `notQ2pro`. This is the (User)
     notice. [[161]] reuses this key for its main-side refusal.
  4. The active Q2PRO lacks the game dir: `modMissing`.
  5. The active installation runs through Steam: `needsDirectLaunch`. A `steam://` URL carries no
     `extraArgs`. This mirrors `launch.error.connectNeedsDirectLaunch`.
  6. A game is already running: `gameRunning`.
  7. The demo is not in place: `notInInstallation`.
  8. The file name is unsafe: `unsafeName`.
- **The demo's game dir** is the header `gameDir`, with null or empty meaning `baseq2`. When the
  header is unreadable, it falls back to the folder the demo sits in (`source.gameDir`). The header
  records the mod the demo was recorded in; the folder only says where the file lies.
- **"In place"** means all of the following:
  - source kind `installation`, with the same installation id as the active one;
  - not an archive entry;
  - `source.gameDir` equals the demo's game dir or `baseq2`, case-insensitive. These are the two
    folders Q2's file system searches after `+set game`.
  Anything else is disabled with `notInInstallation` in this story and becomes [[160]]'s copy-in.
- **The launch game dir** is the demo's game dir. For `baseq2` the existing `buildLaunchArgs`
  omission of `+set game baseq2` is kept, because it is the engine default and the builder is shared
  by every launch. So AC4's "exactly" is asserted on a mod demo, and "no foreign `+set game`" is
  asserted on a baseq2 demo.
- **The `+demo` argument** is the file name. Discovery is non-recursive, so the path relative to
  `demos/` *is* the file name. It includes the extension, and `.gz` is passed as-is per [[160]] AC3.
  The name must match `^[A-Za-z0-9_.-]+$`. Anything else (space, `;`, `+`, `$`, quote, non-ASCII)
  gives `unsafeName` with a hint to rename, because `;`, `+` and `$` would inject commands into
  Q2PRO's command buffer, and the existing rename action is the remedy.
- **Formats:** there is no format gate here, because Q2PRO plays `.dm2`, `.dm2.gz` and `.mvd2`
  through `+demo` ([[162]] AC1). MVD2 seek and POV stay with [[162]].
- **Lifecycle:** main calls `app.launch.start` itself instead of the renderer calling
  `launch:start`, so `launch:state` and `isRunning()` behave exactly as for a normal launch.
  `PlaybackSessions.begin(demoId)` runs after a successful start, and `end` runs when the launch
  leaves `starting`/`running`. Its existing consumer (rename is refused while playing) then works
  as intended.
- **Linux e2e gap:** flows run on Windows only. AC7 is proven by the pure eligibility unit test and
  by a renderer component test with `platform: 'linux'`. The gap is named here and for the sprint
  review.

## Plan

Build order is D1, then D2, then D3. No shell edits, and no change to `buildLaunchArgs` or
`LaunchService`.

1. **Shared rule (D1).** One pure function decides eligibility, the reason (with its params) and
   the launch pieces (`gameDir`, `['+demo', <file>]`). The renderer uses it to show the reason, and
   main runs it again on main-owned data before launching. The precedence and rules are in
   Decisions (Sprint).
2. **Main handler (D2).** `demo.play` takes `{demoId, installationId}`. It resolves the demo via
   the scan index, checks eligibility again with main's installations, and requires the file's real
   path to sit in that installation's `<gameDir>/demos`. Then it calls `app.launch.start` and wires
   `PlaybackSessions` to the launch state.
3. **Renderer and e2e (D3).** This adds:
   - a Play action in the detail panel, enabled or disabled with a visible reason;
   - a typed client call and the i18n keys;
   - a fixture variant with an active stand-in Q2PRO that holds demos;
   - the `replays-play-q2pro` flow;
   - a changelog entry.

## Deliverables

### D1 — pure play-eligibility rule and its unit tests

- **Files:** new `src/shared/replays/demo-play.ts` and `demo-play.test.ts`. Mirror the style of
  `src/shared/replays/demo-rename.ts`.
- **`demoGameDir(demo)`:** returns the header `gameDir`. Null or `''` becomes `baseq2`. When the
  header is unreadable, it returns `source.gameDir`.
- **`demoPlayEligibility({ demo, installations, activeInstallationId, platform, gameRunning })`**
  returns either:
  - `{ ok: true, installationId, gameDir, extraArgs: ['+demo', fileName] }`, where `gameDir` is the
    demo's game dir; or
  - `{ ok: false, reason: { key, params? } }`.
- **Input shapes:**
  - `demo` is the shared `DiscoveredDemo`/`DemoRow` shape from `src/shared/modules/replays.ts`. It
    has a `source` union (`installation{installationId, gameDir}` or `extraFolder`),
    `archiveEntry`, `fileName` and the header `gameDir`.
  - Installations use `engineKind` (`'q2pro'`), `gameDirs: string[]` and the Steam-runner field.
    For that field, see `src/main/services/launch.ts` around lines 178–199.
- **Reason keys**, all under `replays.play.unavailable`. They are checked in this order and the
  first match wins:
  1. `.linuxNoQ2pro`: platform is `linux` and no installation has `engineKind === 'q2pro'`.
  2. `.modMissing {gameDir}`: no installation's `gameDirs` contains the demo's game dir
     (case-insensitive). `baseq2` always counts as present.
  3. `.notQ2pro`: there is no active installation, or the active one has
     `engineKind !== 'q2pro'`.
  4. `.modMissing {gameDir}`: the active installation lacks the game dir.
  5. `.needsDirectLaunch`: the active installation launches through Steam.
  6. `.gameRunning`: a game is already running.
  7. `.notInInstallation`: the source is not `installation`, or it is another installation's id, or
     it is an archive entry, or `source.gameDir` is neither the demo's game dir nor `baseq2`.
  8. `.unsafeName`: the file name does not match `^[A-Za-z0-9_.-]+$`.
- **Tests**, named after the ACs:
  - "the active Q2PRO with the game dir plays" (AC1)
  - "a non-Q2PRO active installation is refused with notQ2pro even when another Q2PRO qualifies"
    (AC2)
  - "no installation with the game dir gives modMissing with the dir" (AC3)
  - "extraArgs is exactly +demo and the file name, never demomap" (AC4)
  - "a demo of another installation / extra folder / archive entry is notInInstallation" (AC5)
  - "linux without any Q2PRO gives linuxNoQ2pro" (AC7)
  - one test for each remaining reason;
  - names containing `;`, a space or `+` give `unsafeName`.

### D2 — main `demo.play` handler and its tests

- **Contract:** add `demo.play` to `REPLAYS_HANDLERS` in `src/shared/modules/replays.ts`. It takes
  a strict schema `{ demoId: replaysDemoIdSchema, installationId: string }`, mirroring
  `replaysDemoFileActionSchema`. The response is `Outcome<void>`.
- **Files:** new `src/main/modules/replays/demo-play.ts` and `demo-play.test.ts`, mirroring the
  resolve-then-act shape of `src/main/modules/replays/file-actions.ts`. Register the handler in
  `src/main/modules/replays/index.ts` next to `demos.reveal`.
- **Steps:**
  1. Look the demo row up in the scan snapshot and call `scanService.resolveFile(demoId)`. An
     unknown demo fails with `replays.play.error.notFound`.
  2. Run D1's `demoPlayEligibility` with **main's** installations and `app.launch.isRunning()`.
     The payload's `installationId` must equal the eligible (active) installation, otherwise fail.
  3. Get the `realpath` of the file and of the installation's `<rootPath>/<source.gameDir>/demos`
     folder. Find that folder case-insensitively, as discovery does.
  4. Require the file's parent to *be* that folder. Use no string-prefix check, because a sibling
     `Quake2-other` root must fail. Refuse archive entries.
  5. Require the file to still exist, otherwise fail with `replays.play.error.fileMissing`.
  6. Call `app.launch.start({ installationId, gameDir, extraArgs })` and return its failure as-is.
  7. On success, call `playbackSessions.begin(demoId)`. Subscribe to `app.launch.onStateChange`,
     call `end(demoId)` once the phase is no longer `starting`/`running`, then unsubscribe.
- **Tests:**
  - A fake launch service asserts the exact `LaunchInput`.
  - One test runs the real `buildLaunchArgs` (`src/main/services/launch-plan.ts`) on a q2pro
    installation (AC4). It asserts `+set game ctf +demo x.dm2` for a `ctf` demo, no `+set game` for
    a baseq2 demo, and that `demomap` is absent.
  - Each of these cases is refused with no `start` call (AC5): a file outside the installation,
    another installation's id, a sibling-prefix root, an archive entry, an r1q2 id sent directly,
    and a running game.
  - Playback sessions begin and end around a simulated state sequence (AC6).

### D3 — Play in the detail panel, fixture and e2e flow

- **Component:** new `src/renderer/src/modules/replays/components/DemoPlayAction.tsx` and
  `.test.tsx`, mirroring `DemoFileActions.tsx`. Mount it in `DemoDetailPanel.tsx` beside the file
  actions.
  - It computes D1's `demoPlayEligibility` from the store: `installations`,
    `settings.activeInstallationId`, `appInfo.platform` and the `launch` phase.
  - It renders a primary Play button (`data-testid` `replays-demo-play`).
  - When disabled, the button stays visible and disabled, and the reason shows as visible text
    (`replays-demo-play-reason`). The reason is linked via `aria-describedby`, as `RunnerSection.tsx`
    does.
  - A click calls a new `playDemo({ demoId, installationId })` in
    `src/renderer/src/modules/replays/client.ts`. A failure outcome shows an inline alert with its
    key.
- **i18n**, in `src/renderer/src/i18n/locales/en.json` under `replays.play`:
  - `action`: "Play"
  - `unavailable.notQ2pro`: "The selected installation is not Q2PRO — demo playback needs Q2PRO.
    Pick a Q2PRO installation in the left rail."
  - `unavailable.modMissing`: "Mod `{{gameDir}}` missing"
  - `unavailable.linuxNoQ2pro`: "Not available on Linux: demo playback needs a Q2PRO installation"
  - `unavailable.needsDirectLaunch`, `unavailable.gameRunning`, `unavailable.notInInstallation`
  - `unavailable.unsafeName`, with a hint to rename the file
  - `error.notFound`, `error.fileMissing`
- **Component test** (faked store): each reason renders as visible text, including with
  `platform: 'linux'` (AC7).
- **Fixture:** new variant `replays-play` in `scripts/lib/fixture.mjs`. It contains:
  - an active installation with `engineKind: 'q2pro'` and the stand-in `q2pro.exe` (see
    `fixture.mjs` around lines 3440–3480), holding `baseq2/demos/play-base.dm2` and
    `ctf/demos/play-ctf.dm2`. Use real bytes from `docs/fixtures/demos/test.dm2`. Pick demos whose
    header game dir matches their folder, or use a copy whose header game dir is `ctf`;
  - a second installation, running r1q2;
  - a demo whose header mod no installation has.
- **Flow:** `scripts/flows/replays-play-q2pro.mjs` with `export const variant = 'replays-play'`.
  Mirror how `servers-join.mjs` captures the main.log "launching" line and the `launch:state`
  phases. The flow checks:
  - Playing the ctf demo produces a launching line that ends with `+set game ctf +demo
    play-ctf.dm2` and contains no `demomap`. The phases reach `running` and then go back.
  - After selecting the r1q2 installation in the rail, Play is disabled and the notQ2pro text is
    visible.
  - For the missing-mod demo, "Mod `…` missing" is visible.
- **Changelog:** add a `### Added` line to `CHANGELOG.md`.

## Model Hints

- D2 → deliverable-hard. It is the only path where a demo id sent by the renderer turns into a
  spawned process, with three risks:
  - Containment must use the real path and parent equality. A `startsWith` check passes the fixture
    but lets a sibling root through.
  - Eligibility must run again on main's data rather than trusting the renderer.
  - The launch-state subscription must end the playback session exactly once without leaking
    listeners.
- D1, D3 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/shared/replays/demo-play.test.ts` › "the active Q2PRO with the game dir plays";
  e2e `scripts/flows/replays-play-q2pro.mjs` › `replays-play-q2pro`
- AC2 → unit `src/shared/replays/demo-play.test.ts` › "a non-Q2PRO active installation is refused
  with notQ2pro even when another Q2PRO qualifies"; e2e `scripts/flows/replays-play-q2pro.mjs` ›
  `replays-play-q2pro` (select the r1q2 installation in the rail; the notQ2pro text is visible)
- AC3 → unit `src/shared/replays/demo-play.test.ts` › "no installation with the game dir gives
  modMissing with the dir"; e2e `scripts/flows/replays-play-q2pro.mjs` › `replays-play-q2pro`
- AC4 → unit `src/main/modules/replays/demo-play.test.ts` › "a q2pro launch is exactly +set game
  and +demo, never demomap"; unit `src/shared/replays/demo-play.test.ts` › "extraArgs is exactly
  +demo and the file name, never demomap"
- AC5 → unit `src/main/modules/replays/demo-play.test.ts` › "a demo outside the installation's
  demos folder is not launched" (covers a sibling-prefix root, another installation, an archive
  entry and an r1q2 id)
- AC6 → unit `src/main/modules/replays/demo-play.test.ts` › "a playback session begins on start and
  ends when the game exits"; e2e `scripts/flows/replays-play-q2pro.mjs` › `replays-play-q2pro`
  (`launch:state` reaches running)
- AC7 → unit `src/shared/replays/demo-play.test.ts` › "linux without any Q2PRO gives
  linuxNoQ2pro"; renderer `src/renderer/src/modules/replays/components/DemoPlayAction.test.tsx` ›
  "linux without a Q2PRO shows the reason as visible text". Gap: flows run on Windows only (see
  Decisions (Sprint)).
- AC8 → e2e `scripts/flows/replays-play-q2pro.mjs` › `replays-play-q2pro` (stand-in `q2pro.exe`,
  no real engine)

## Done

Play in the demo detail panel starts the active Q2PRO installation through main's `demo.play`
(`app.launch.start`, `+set game <dir> +demo <file>`, never `demomap`). One shared pure rule
(`demoPlayEligibility`) drives the visible reason in the renderer and re-runs in main on main's data;
containment is realpath + parent equality. Playback sessions begin on start and end once when the launch leaves starting/running.

Commit message: `159: play demos in Q2PRO — active installation, eligibility rule, main demo.play, detail-panel Play`

Verification: narrow gate. `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (127 files, 1775 tests) and `npm run ui:flow -- replays-play-q2pro` all green. Full gate is the sprint's.
AC map (all passed): AC1/2/3/5/7 shared `demo-play.test.ts`; AC4/5/6 main `demo-play.test.ts`; AC7 `DemoPlayAction.test.tsx`; AC1/2/3/6/8 flow `replays-play-q2pro`. No manual residue. Gap: Linux is proven by unit + component test only (flows run on Windows).
Review: clean sonnet agent, PASS, no findings needing fixes.

Decisions:
- Payload installationId differing from the eligible (active) one returns `replays.play.unavailable.notInInstallation` (plan named no key).
- Unreadable header on an extra-folder source: `demoGameDir` falls back to `baseq2` (plan only specified installations).
- Linux Q2PRO write-dir demos (`~/.q2pro/<gameDir>/demos`) are refused (spec allows only `<rootPath>`); a follow-up story if wanted.
- Play button uses the default size (not `sm`), so no design-token deviation row was needed.
- Unfixed review notes: main "another installation's id" test asserts only refusal not key; no symlink containment test; flow picks the r1q2 tile via `.nth(1)` and returns early if 7za.exe is not vendored (as servers-join does). eslint could not be run (config-format error, pre-existing).
- Play button size change (sm removed) was made after the verify run; typecheck-neutral, not re-run.

tiers: D 3 / hard 1 · review default · cycles 0 · agents 6
