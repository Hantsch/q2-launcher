---
id: 104
title: steam launches the client i choose
status: done # draft -> ready -> in-progress -> done
created: 2026-09-23
---

## Requirement

Split out of [story 103](103-a-windows-build-runs-on-linux-through-a-runner-i-choose.md) on
2026-09-23: 103 covers the local runners (native / wine / umu-run) and the refusal gate, this story
covers the one runner that is not a wrapper but a handoff — Steam.

A user whose Quake II came from Steam already has a working way to run it: Steam itself, with
whatever Proton the user configured. The launcher should offer that as a runner alongside the local
ones, which means knowing the installation's appid and which of the app's clients to start.

The Steam app is not one game: appid 2320 ships the 2023 remaster *and* the original, and Steam
selects between them by launch-option index in the URL.

| URL | Runs |
| --- | --- |
| `steam://launch/2320/client/1` | Enhanced Quake II (the 2023 remaster) |
| `steam://launch/2320/client/2` | Quake II (Original) |
| `steam://launch/2320/client/3` | The Reckoning (Original) |
| `steam://launch/2320/client/4` | Ground Zero (Original) |

Invoked as `steam 'steam://launch/2320/client/2'`, verified working on the beta tester's machine
(2026-09-22).

Two consequences the design has to carry rather than paper over:

- **The appid is not known today.** Detection finds that folder by *name*
  (`steamapps/common/Quake 2`, `src/main/services/detection/providers.ts:77`), so nothing in the
  launcher knows it is 2320. `steamapps/appmanifest_<appid>.acf` sits one level above `common/` and
  carries `"appid"` and `"installdir"` — the same naive `"key" "value"` scraping
  `steamLibraryRoots()` already does on `libraryfolders.vdf` reads it. Hardcoding 2320 is not
  acceptable: the mission packs and the GOG and remaster entries have their own ids, and a
  folder-name match cannot tell them apart.
- **A `steam://` URL takes no arguments.** Handing off to Steam discards the whole launch plan —
  the generated `+set` arguments, the user's `launchArgs` and `activeGameDir` — and `steam` returns
  immediately, so there is no child process to observe. Note that `/client/3` and `/client/4` are
  Steam's own way of doing what `+set game xatrix|rogue` does, so the client choice partly
  *replaces* the launcher's game-dir selection instead of coexisting with it.

Depends on 103: the runner choice, the runner picker UI and the disabled-with-visible-reason
pattern all come from there. This story adds one more runner kind to an existing mechanism.

## Acceptance Criteria

- [x] **AC1** — A Steam-owned installation knows its Steam appid, read from the
      `appmanifest_<appid>.acf` whose `installdir` matches the installation's folder. An
      installation whose appid cannot be established can never select the Steam runner (it is
      shown disabled with its reason, per AC4) — no id is ever guessed or hardcoded.

- [x] **AC2** — For a Steam-owned installation the user chooses **which client** Steam should
      launch, from the app's own launch options (for 2320: Enhanced Quake II, Quake II Original,
      The Reckoning, Ground Zero; preselected: Quake II Original), and the launcher hands off with
      the corresponding `steam://launch/<appid>/client/<n>` URL. The client names come from the
      launcher's i18n catalogue; the appid/index pairing is data, not code.

- [x] **AC3** — The Steam handoff states what it gives up, as visible text at the point of choosing
      it — not in a changelog: the launcher's own launch arguments and active game directory are not
      applied, there is no process to observe, so no playtime is recorded, and the launcher cannot
      hold back its own writes (downloads, jobs) into the folder while the game runs. `launch:state`
      never claims a `running` game it cannot see; the handoff has its own honest terminal state.

- [x] **AC4** — The Steam runner is selectable only for a folder whose appid AC1 established *and*
      whose appid the shipped client table knows, on Windows and Linux alike. On a machine without
      Steam, for a folder Steam does not own, or for a Steam app the launcher has no client table
      for, it is shown disabled with its reason as visible text, exactly like 103's other
      unavailable runners.

## Open Questions

All resolved in the refine round of 2026-09-23. Kept as the record, because each bounds a
deliverable.

**Q1 — Where do the client entries come from? — RESOLVED: a shipped data table keyed by appid
(2320 → four named clients, default client 2); an appid the table does not know gets the Steam
runner *disabled with a reason*, not a plain unverified `steam://rungameid/<appid>`.** A new appid
is a one-row data change, the `ENGINE_DEFINITIONS` precedent. The only URL form that ships is the
one the tester verified.

**Q2 — What is `launch:state` for a handoff? — RESOLVED: (a), a new terminal phase `handed-off`,
and the write guard does not cover it — stated, not hidden.** `handed-off` is reached when the
`steam` process has spawned; the launcher neither waits for it (a cold `steam` *becomes* the Steam
client and never exits) nor records playtime. The guard only blocks `starting`/`running`
(`write-guard.ts:108-112`), so a handed-off installation is writable; AC3's caveat text says so.
Rejected: a grace-period guard (a guess dressed up as a guard) and process-table polling.

**Q3 — How is a handoff proven end to end? — RESOLVED: the automated line is "the launcher
spawned `steam` with exactly this URL and reported `handed-off`, never `running`".** On Linux
(ubuntu xvfb CI) a stub `steam` on `PATH` records its argv to a file, the way 103 stubs `wine`. On
Windows a harness-gated `Q2L_UI_STEAM_EXECUTABLE` (same gate as `Q2L_UI_PICK_FOLDER`,
`src/main/lib/ui-harness.ts`) points detection at a fixture file so availability is deterministic;
the Windows branch proves options, reasons and the previewed URL but never presses Play, because a
dev machine may have a real Steam. That Steam then starts the right game is `manual residue`.

**Decided in refine, beyond the three questions:**
- **Platforms: Windows and Linux.** The Runner section now renders on Windows too (Native + Steam),
  which supersedes the one clause of 103's AC8 that said "no Runner section on Windows". Nothing
  else about Windows changes: the Steam runner is never a default, so an installation launches
  exactly as before until the user picks Steam.
- **Ownership is judged from the manifest, not from `source`.** AC4 originally gated on
  `isStoreManaged()`, but a Steam folder added by hand carries `source: 'manual'`
  (`installations.ts:166`), and `isStoreManaged()` also covers GOG/Epic/Bethesda, which Steam can
  never launch. The appid lookup is path-derived — `<lib>/steamapps/common/<dir>` →
  `<lib>/steamapps/appmanifest_*.acf` — so it needs no registry or library scan and works on both
  platforms.
- **The Linux Flatpak Steam (`flatpak run com.valvesoftware.Steam`) is a non-goal.** Off Windows
  only `steam` on `PATH` counts; otherwise the runner is disabled with the "Steam not found" reason.

## Plan

Bottom up, one more runner kind on 103's mechanism. The Steam runner is **never a default**: until
a user picks it, every installation on every platform resolves and launches exactly as today.

1. **Data + discovery** (D1) — `src/shared/types/steam.ts` holds the client table and a pure URL
   builder; `src/main/services/steam.ts` reads the appid from the manifest beside the folder. The
   appid is digits-only by construction (`^\d+$` or nothing), because it is scraped from a file and
   ends up in a spawned argv.
2. **Domain** (D2) — `Installation.steamAppId?` (set by inspection, following `executableKind`'s
   path through inspector → installations service → persisted schema) and `steamClient?` (the
   user's choice, set via `installations:update`).
3. **Runner** (D3) — `RunnerKind` gains `'steam'`. `detectRunners()` finds `steam` (Windows:
   `<findSteamRoot()>/steam.exe`; Linux: `steam` on `PATH`; harness seam overrides both).
   `installations:listRunners` gives the Steam option one of three reasons when it cannot be
   chosen. `resolveRunner()` returns Steam only for a stored `'steam'` choice that is available;
   otherwise the 103 cascade runs unchanged.
4. **Handoff** (D4) — `plan()` builds `executablePath = <steam>`, `args = [url]`, `handoff: true`;
   `start()` takes a separate branch for it: detached spawn, `unref()`, `'spawn'` → `handed-off`,
   `'error'` → `failed`, no exit listener, no playtime. The write guard stays untouched, because
   `handed-off` is not in its blocking set.
5. **Surface** (D5) — the Runner section renders on Windows too; the Steam option carries its
   reason when disabled, its caveat text whenever it is shown, and a client picker when selected.
   The action bar gets a `handed-off` readout.
6. **Proof** (D6) — a new `steam-handoff` flow with Linux and Windows branches, plus the update to
   103's Windows branch that the now-visible Runner section needs.
7. **Docs** (D7) — changelog, and one paragraph in ARCHITECTURE.md's "Launching" section.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7.

**Non-goals:** Flatpak Steam, `steam://rungameid` for unknown apps, detecting the Steam-run game
process, a write guard for handed-off games, changing `source` for hand-added Steam folders,
auto-selecting Steam, and changing the Proton/wine/umu behaviour from 103.

## Deliverables

**D1 — Client table and appid discovery.** `src/shared/types/steam.ts`: `STEAM_APP_CLIENTS`
(appid string → readonly `{ index, labelKey }[]` plus the default index; 2320 → 1 Enhanced,
2 Original *(default)*, 3 The Reckoning, 4 Ground Zero) and `steamLaunchUrl(appid, index)`, which
returns `steam://launch/<appid>/client/<index>` and refuses a non-digit appid or an index the table
does not list. `src/main/services/steam.ts`: `readSteamAppId(installRoot): Promise<string |
undefined>` — if the parent folder is `common` and the grandparent is `steamapps`, scan
`steamapps/appmanifest_*.acf` and return the `"appid"` whose `"installdir"` equals the folder name
(case-insensitive on win32). Use naive `"key" "value"` scraping; never throw. Plus the tests
listed below.
*Files:* `src/shared/types/steam.ts`, `src/shared/types/steam.test.ts`, `src/main/services/steam.ts`,
`src/main/services/steam.test.ts`.
*Mirror:* `steamLibraryRoots()` scraping (`src/main/services/detection/providers.ts:62-75`) — do not
refactor it; `ENGINE_DEFINITIONS` (`src/shared/types/engine.ts:74`) as the data-table precedent;
temp-dir fixtures as in `providers.test.ts`.
*Accepted when:* a temp `steamapps/` holding `appmanifest_2320.acf` (`installdir` "Quake 2")
yields `'2320'` for `…/common/Quake 2`; a folder outside `steamapps/common`, a non-matching
installdir and a non-digit appid all yield `undefined`.

**D2 — The installation carries its appid and client choice.** `steamAppId?: string` and
`steamClient?: number` on `Installation` (`src/shared/types/installation.ts`), both
`.optional().catch(undefined)` in `src/main/lib/schemas.ts` (no migration step). The inspector
calls `readSteamAppId()` and puts the result on `ValidationResult`, persisted exactly the way
`executableKind` is. `installations:update`'s zod input accepts `steamClient` as a positive integer.
*Files:* `src/shared/types/installation.ts`, `src/main/lib/schemas.ts`,
`src/main/services/inspector.ts`, `src/main/services/inspector.test.ts`,
`src/main/services/installations.ts`, `src/shared/ipc-schemas.ts`.
*Mirror:* every `executableKind` touchpoint (grep it in `src/main`).
*Accepted when:* inspecting the D1 fixture sets `steamAppId: '2320'`, a record without the fields
still parses, and a mangled value degrades to `undefined`.

**D3 — The Steam runner: detection, availability, resolution.** `'steam'` in `RunnerKind`
(`src/shared/types/runner.ts:7`). `detectRunners()` (`src/main/services/runners.ts:21-30`) adds a
Steam entry: on win32 `join(findSteamRoot(), 'steam.exe')` (the native entry stays first and
unchanged, and still no `PATH` walk or Proton scan on win32); off win32 `steam` resolved off
`PATH`; when `isUiHarnessEnabled`, `Q2L_UI_STEAM_EXECUTABLE` (new constant in
`src/main/lib/ui-harness.ts`) overrides the path. The `installations:listRunners` handler judges
availability per installation in this order: `runner.unavailable.steam` (no binary),
`runner.unavailable.steamNotOwner` (no `steamAppId`), `runner.unavailable.steamUnknownApp` (appid
not in `STEAM_APP_CLIENTS`). `resolveRunner()` (`runners.ts:79-101`) gets one new first step: a
stored `'steam'` choice that is available for this installation wins; in every other case the 103
cascade runs byte for byte, so Steam is never a default. Plus i18n keys `runner.kind.steam` and
the three reasons.
*Files:* `src/shared/types/runner.ts`, `src/main/services/runners.ts`,
`src/main/services/runners.test.ts`, `src/main/lib/ui-harness.ts`, `src/main/ipc/installations.ts`,
`src/main/ipc/installations.test.ts`, `src/renderer/src/i18n/locales/en.json`.
*Mirror:* the wine/umu `PATH` resolution and `available: false` entries in `runners.ts`;
`UI_HARNESS_PICK_FOLDER_ENV` for the seam.
*Accepted when:* on stubbed win32 with no stored choice, `resolveRunner()` still returns native and
the detected list is native + steam only; a stored `'steam'` choice with Steam available resolves
to Steam; each of the three reasons is returned in its own case.

**D4 — The handoff launch and the `handed-off` phase.** `LaunchPhase` gains `'handed-off'`
(`src/shared/types/launch.ts:2`); `LaunchPlan` gains `handoff?: true`. In `plan()`
(`src/main/services/launch.ts:112-158`), a resolved Steam runner yields `executablePath = <steam
path>`, `args = [steamLaunchUrl(appid, steamClient ?? default)]`, the same `workingDirectory`, and
`handoff: true`; `buildLaunchArgs` is skipped and the preview follows from the pair. `start()`
(L161-236) branches on `handoff` before today's spawn: `spawn(path, args, { detached: true,
stdio: 'ignore' })` then `unref()`, `'spawn'` → `handed-off` (no pid), `'error'` → `failed` with
the existing process-error key; no `'exit'` listener, no `recordPlaySession`. The non-handoff path
stays untouched. `isRunning()` treats `handed-off` as not running.
*Files:* `src/shared/types/launch.ts`, `src/main/services/launch.ts`,
`src/main/services/launch.test.ts`, `src/main/services/write-guard.test.ts`.
*Accepted when:* the unit tests below pass and every existing `launch.test.ts` case passes
unchanged.

**D5 — Runner section and action bar.** `RunnerSection.tsx` drops its win32 early return (L54) and
renders on every platform. The Steam option shows its reason when disabled (103's pattern). It
always shows the caveat paragraph `runner.steam.caveat` as visible text (`installation-runner-steam-caveat`),
and when selected a client picker (`installation-runner-steam-client`, options from
`STEAM_APP_CLIENTS` via i18n `steam.client.*`) that writes `steamClient` through
`installations:update` and refreshes the preview. `ActionBar.tsx`'s `LaunchReadout` (L295-334) gets
a `handed-off` case, `actionbar.handedOff` ("Handed off to Steam — not tracked"); Play stays
enabled.
*Files:* `src/renderer/src/components/installations/RunnerSection.tsx`,
`src/renderer/src/components/installations/RunnerSection.test.tsx`,
`src/renderer/src/components/shell/ActionBar.tsx`,
`src/renderer/src/components/shell/ActionBar.test.tsx`, `src/renderer/src/i18n/locales/en.json`.
*Mirror:* `RunnerOptionRow`'s reason paragraph; the existing `Select` atom for the picker.
*Accepted when:* the component tests below pass and on win32 the section renders with Native checked.

**D6 — End-to-end proof.** New `scripts/flows/steam-handoff.mjs`, plus fixture builders in
`scripts/lib/fixture.mjs`: `writeSteamLibraryFixture({ appid })` (a
`steamapps/common/Quake 2` install root beside a matching `appmanifest_<appid>.acf`), and
`writeSteamStub()` (a `#!/bin/sh` that appends `"$@"` to a log file and exits 0).
- **Linux:** scrubbed `PATH` → Steam option disabled with "not found" reason; stub on `PATH` →
  unowned folder disabled with not-owner reason, `appid 9999` folder disabled with unknown-app
  reason, the 2320 folder enabled with the caveat visible; choose Steam + Ground Zero → the preview
  contains `steam://launch/2320/client/4`; the real Play click → stub log holds exactly that URL,
  `launch:state` reaches `handed-off`, and `running` is never broadcast.
- **Windows:** `Q2L_UI_STEAM_EXECUTABLE` set to a fixture file; the same enabled/unowned/unknown
  assertions and the previewed URL; Play is never pressed.
Update `scripts/flows/windows-build-on-linux.mjs`'s Windows branch: the Runner section now renders
with Native checked and the preview unwrapped (was "no Runner section"). Wire the new flow into the
ubuntu xvfb job in `.github/workflows/ci.yml`.
*Files:* `scripts/flows/steam-handoff.mjs`, `scripts/lib/fixture.mjs`,
`scripts/flows/windows-build-on-linux.mjs`, `.github/workflows/ci.yml`.
*Mirror:* `scripts/flows/windows-build-on-linux.mjs` (branching, `PATH` scrub, stub-on-`PATH` via
`app.evaluate`, launch-state listener, real Play click).
*Accepted when:* `npm run ui:flow -- steam-handoff` and `-- windows-build-on-linux` pass on
Windows, and the ubuntu job runs both Linux branches green.

**D7 — Changelog and architecture note.** `### Added` entry in `CHANGELOG.md` (house style per
`.claude/ai-scrum.md` Notes), and one paragraph in `docs/ARCHITECTURE.md` › "Launching" about the
handoff: no args, no process, `handed-off` phase, not under the write guard.
*Files:* `CHANGELOG.md`, `docs/ARCHITECTURE.md`.
*Accepted when:* a user reading the changelog knows they can hand a Steam copy to Steam and what it
gives up.

## Model Hints

- **D3 → `deliverable-hard`.** Windows regression risk: it removes 103's native-only win32
  short-circuit in `detectRunners()` and adds a step ahead of `resolveRunner()`'s cascade. A wrong
  branch here silently changes which runner every existing Windows installation launches with.
- **D4 → `deliverable-hard`.** Cross-module subtlety: `start()` gets a second, process-less path
  that must skip exit tracking, playtime and pid without disturbing the spawn path the write guard
  and playtime already rely on, and a non-detached `steam` child would tie the Steam client's
  lifetime to the launcher.
- D1, D2, D5, D6, D7 → default.
- **Review: → `story-review-hard`.** The story changes the Windows launch and detection path (runner
  detection, a now-visible Runner section) while promising Windows behaviour is unchanged unless
  Steam is chosen. A cheap diff review is worst at confirming a negative promise like that.

## Acceptance Tests

- AC1 → unit `src/main/services/steam.test.ts` › "reads the appid from the manifest whose installdir
  matches the folder" and "a folder with no matching manifest has no appid" (D1); unit
  `src/main/services/inspector.test.ts` › "a folder inside a steam library records its steam appid"
  (D2); e2e `scripts/flows/steam-handoff.mjs` › both branches, step "a folder Steam does not own
  offers Steam disabled, with its reason" (D6)
- AC2 → e2e `scripts/flows/steam-handoff.mjs` › Linux branch, step "choosing Steam and Ground Zero
  hands off steam://launch/2320/client/4": the stub's recorded argv after a real Play click (D6).
  Windows branch, step "choosing Steam previews the handoff URL" (D6). Unit
  `src/shared/types/steam.test.ts` › "2320 maps its four clients to their launch indices, original
  by default" (D1). Component `RunnerSection.test.tsx` › "choosing a client writes steamClient"
  (D5).
- AC3 → e2e `scripts/flows/steam-handoff.mjs` › Linux branch, steps "the handoff states what it
  gives up" (caveat as DOM text) and "a handoff reaches handed-off and never running" (D6). Unit
  `src/main/services/launch.test.ts` › "a steam handoff spawns detached with only the URL, reports
  handed-off and records no playtime" (D4). Unit `src/main/services/write-guard.test.ts` › "a
  handed-off installation is not write-blocked" (D4). Component `ActionBar.test.tsx` › "handed-off
  reads as not tracked and keeps Play enabled" (D5).
- AC4 → e2e `scripts/flows/steam-handoff.mjs` › Linux branch, steps "without steam on PATH the Steam
  runner is disabled and says why" and "an unknown Steam app is disabled and says why" (D6); both
  branches cover the not-owner reason (see AC1). Unit `src/main/services/runners.test.ts` › "steam is
  detected on PATH off windows and under the steam root on win32" and "a stored steam choice wins
  only when available; win32 still defaults to native" (D3). Unit
  `src/main/ipc/installations.test.ts` › "listRunners gives the steam option its reason per
  installation" (D3). Component `RunnerSection.test.tsx` › "an unavailable steam option renders its
  reason as visible text" (D5).

**manual residue:** Steam actually starting the chosen client (Enhanced / Original / Reckoning /
Ground Zero) from the launcher's handoff. *Reason: CI has no Steam client, no Steam account and no
licensed game data.* The automated line stops at "`steam` was spawned with exactly this URL". The
tester verified `steam 'steam://launch/2320/client/2'` by hand on 2026-09-22, and one walk-through
of the other three clients from the launcher closes it.

**No gap:** every user-action criterion maps to the profile's `e2e` command
(`npm run ui:verify` / `ui:flow`). The Linux branch's Play click runs only on the ubuntu xvfb job,
as in 103. The Windows branch deliberately stops before Play, because a dev machine may have a real
Steam.

## Done

**Summary.** A Steam-owned installation now knows its Steam appid (read from `appmanifest_*.acf`
beside the folder, never guessed) and can be launched through Steam itself as a new `'steam'`
runner alongside 103's native/wine/umu. The user picks which client (Enhanced / Original /
Reckoning / Ground Zero) from a shipped data table; the launcher hands off with the matching
`steam://launch/<appid>/client/<n>` URL, states what it gives up (own args, active game dir,
playtime, write-guard) as visible caveat text, and reaches a new `handed-off` terminal phase that
is never mistaken for `running`. The Runner section now renders on Windows too. Steam is never a
default: an installation with no stored Steam choice resolves and launches exactly as before this
story, on every platform.

**Commit message:** `104: steam launches the client i choose`

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `npm test` — 4180 passed, 8 skipped, 2 failed. Both failures
  (`UpdateCheckRow.test.tsx` and `NewsHero.test.tsx`, both asserting an English relative-time
  string) are pre-existing and unrelated: `src/renderer/src/lib/format.ts:62` calls
  `new Intl.RelativeTimeFormat(undefined, …)`, which resolves to this machine's OS/ICU default
  locale (German) instead of a fixed `'en'`. No file this story touched is involved; not fixed
  here as it is out of this story's scope.
- `npm run ui:verify` — 86/86 screenshots written, 0 axe violations (critical/serious/moderate/
  minor), full 45/45-screen run.
- `npm run ui:flow -- steam-handoff` and `npm run ui:flow -- windows-build-on-linux` — both pass
  on this Windows dev machine. Each flow's Windows branch runs for real (including, for
  steam-handoff, the disabled/enabled/caveat/live-preview steps); each flow's Linux branch
  (including steam-handoff's real Play click + stub-argv assertion) is CI-only, wired into the
  ubuntu xvfb job in `.github/workflows/ci.yml`, and was reviewed statically rather than executed
  here.
- Clean-agent review (`story-review-hard`, 3 rounds): round 1 FAIL (6 confirmed findings — AC1
  stale `steamAppId` surviving relocation, a missing digits-only guard on the scraped appid, a
  broken hybrid launch when a stored `steamClient` index is unlisted, the launch preview not
  refreshing on client change, "Native checked" not holding for a real unset-runner installation,
  and a client picker with no accessible name/non-standard sizing) — all fixed. Round 2 FAIL on
  one regression the round-1 fix introduced (the Native-default fix applied on every platform,
  wrongly defaulting Linux installations to "Native checked" against their actual wine/umu
  preview) — fixed by scoping the default to win32 only, with a new regression test. Round 3:
  **PASS**.

**AC → test mapping, as verified:**
- AC1 → `src/main/services/steam.test.ts` › "reads the appid from the manifest whose installdir
  matches the folder" / "a folder with no matching manifest has no appid" (+ digits-only and
  `__proto__` cases added during review-fix); `src/main/services/inspector.test.ts` › "a folder
  inside a steam library records its steam appid"; `src/main/services/installations.test.ts` ›
  "relocating a Steam install to a non-Steam folder clears its stale steamAppId" (added during
  review-fix, closes the round-1 finding); `scripts/flows/steam-handoff.mjs` both branches, "a
  folder Steam does not own offers Steam disabled, with its reason" — all passed.
- AC2 → `src/shared/types/steam.test.ts` › "2320 maps its four clients…"; `RunnerSection.test.tsx`
  › "choosing a client writes steamClient" (now also asserts the picker's accessible name and the
  live preview refresh); `scripts/flows/steam-handoff.mjs` Windows branch "choosing Steam previews
  the handoff URL" (executed here) and Linux branch "choosing Steam and Ground Zero hands off
  steam://launch/2320/client/4" (CI-only) — all passed.
- AC3 → `src/main/services/launch.test.ts` › "a steam handoff spawns detached with only the URL,
  reports handed-off and records no playtime" (+ "a stored steam choice with an unlisted client
  index falls back to the normal launch, never wrapping steam as a runner", added during
  review-fix); `src/main/services/write-guard.test.ts` › "a handed-off installation is not
  write-blocked"; `ActionBar.test.tsx` › "handed-off reads as not tracked and keeps Play enabled";
  `scripts/flows/steam-handoff.mjs` Linux branch "the handoff states what it gives up" / "a
  handoff reaches handed-off and never running" (CI-only) — all passed.
- AC4 → `src/main/services/runners.test.ts` › "steam is detected on PATH off windows and under the
  steam root on win32" / "a stored steam choice wins only when available; win32 still defaults to
  native"; `src/main/ipc/installations.test.ts` › "listRunners gives the steam option its reason
  per installation"; `RunnerSection.test.tsx` › "an unavailable steam option renders its reason as
  visible text" (+ "off win32, an installation with no stored runner checks nothing", added during
  review-fix to close the round-2 regression); `scripts/flows/steam-handoff.mjs` both
  disabled-reason steps — all passed.

**Manual residue (declared in the story, unchanged):** Steam actually starting the chosen client
from the launcher's handoff — no Steam client/account/licensed data in CI. The automated line
stops at "`steam` was spawned with exactly this URL and reported `handed-off`". Awaiting the
tester's one walk-through of the other three clients (Original was already verified by hand on
2026-09-22).

**Deferred, non-blocking (from review round 1, judged low severity, not fixed in this build):**
- The Steam-library path-shape check (`common`/`steamapps` folder names) is case-sensitive even on
  win32. Plausible edge case for a hand-renamed legacy library folder, not reproduced.
- `steamLaunchUrl()`/`STEAM_APP_CLIENTS` lookups don't independently re-validate a non-digit appid
  (main-process `steamUnavailableReason()` already guards this via `hasOwnProperty`; the persisted
  schema and fix #1's revalidation-on-relocate/startup limit real exposure to a hand-edited state
  file).
- No dedicated `schemas.test.ts` case for the new `steamAppId`/`steamClient` fields' `.optional().
  catch(undefined)` degrade behavior — the pattern itself is pre-existing and already exercised
  elsewhere in this codebase for `executableKind`.
