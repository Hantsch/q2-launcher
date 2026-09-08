# Install — Bootstrap, Update and Repair — Concept

Status: **Draft** (vision + requirements, no stories yet). This document fixes what the `downloads`
module becomes: a wizard that turns nothing into a playable Quake II installation, an engine
manager that installs, updates and rolls back r1q2 and Q2PRO, and the repair path that finally
redeems the `install-game-files` fix reserved in the installation model. It also fixes the
**curated manifest** in the public `Hantsch/q2_community_content` repository that supplies every
download URL, size and hash — because the research behind this concept found that r1q2's official
distribution no longer exists and Q2PRO's has moved. Everything here comes from the requirements
interview of 2026-09-08 plus URL-level research done the same day; nothing was inferred.

This document follows the architecture rules in [CLAUDE.md](../../CLAUDE.md): a feature is a module
(here: the already-declared `downloads` module), the IPC contract is written first, every
renderer-supplied payload carries a zod schema, no renderer path is trusted, and no bundled image
assets enter the UI. Two rules needed an explicit decision rather than a silent bend — see §12. It
builds on the shell's existing, unused job pipeline
([jobs.ts](../../src/shared/types/jobs.ts), [JobsService](../../src/main/services/jobs.ts),
`JobReadout` in [ActionBar.tsx](../../src/renderer/src/components/shell/ActionBar.tsx)), the
inspector ([inspector.ts](../../src/main/services/inspector.ts)), the store detection service
([detection/](../../src/main/services/detection/)), the engine table
([engine.ts](../../src/shared/types/engine.ts)) and the content repository whose layout and
transport the [home-screen concept](home-screen.md) already fixed.

---

## TL;DR

- **Vision:** the launcher's answer to "I have nothing installed" is one wizard, not a forum
  thread. Pick an engine, pick where the game data comes from, watch a progress bar, press Play.
- **v1's core is bootstrap — from nothing to playable.** Engine management (update, rollback) and
  repair ride on the same job machinery and ship with it.
- **All URLs live in a curated manifest** in `Hantsch/q2_community_content`, fetched over
  `raw.githubusercontent` on `main` like the news feed, cached in userData, offline-capable. It
  describes **engines and free game-data packages**: version, URL, mirrors, size, SHA256.
- **Why a manifest and not hardcoded URLs:** verified on 2026-09-08 — `r1ch.net/stuff/r1q2/` is
  **404**, the r1q2 updater has no server, and `skuller.net/q2pro/nightly/` redirects to a parked
  domain. Q2PRO's live home is now the rolling `nightly` release of `github.com/q2pro/q2pro`. A
  dead mirror must cost one commit, not a launcher release.
- **Game data:** the launcher downloads only the freely mirrored parts (3.14 demo, 3.20 point
  release). Retail `pak0`/`pak1` are **copied** out of a detected Steam/GOG/Epic installation.
- **A demo-data installation is a first-class, visibly labelled state** ("Demo" badge everywhere)
  with an upgrade path to retail.
- **Verification is absolute:** hash mismatch → delete, next mirror, and if all fail the job fails.
  There is no "install anyway".
- **Archives are extracted with a bundled 7-Zip binary** — the free game data ships as Windows
  self-extractors, and one tool covers those plus every engine ZIP.
- **Jobs:** parallel with a user-configurable limit, pause/resume with HTTP range resume across
  restarts, cancel cleans up. Downloading while the game runs is a user setting; **writing** into a
  running installation always waits.
- **Three settings**, and the Settings view learns to render **module-contributed sections** to
  hold them: concurrency limit, archive-cache budget (with current size and a clear button that
  says what it will delete), and download-while-playing.
- **Engine update replaces and keeps a backup** with a rollback button. Versions are pinned by the
  manifest; per installation, an optional "bleeding edge" follows upstream instead.
- **Removal from disk becomes possible** with confirmation — except for store-managed
  installations (`source` is Steam/GOG/Epic), which are locked.
- **v1 fills `baseq2` only.** ctf/xatrix/rogue are not part of the bootstrap.
- Biggest open points: which r1q2 build we pin and from where, how to pin an immutable copy of a
  rolling `nightly` asset, whether a 2023 re-release store install even yields 3.20-compatible
  paks, and the placeholder numbers (concurrency default, cache budget).

---

## 1. Vision

Getting Quake II running for multiplayer in 2026 is a scavenger hunt. You need a game you may own
on a store that ships a different edition, a point release from 1998, an engine whose website is
gone, and the knowledge that any of this is required. The community's answer so far is a
third-party installer (Quake II Starter) and a wiki page.

The install module is the launcher's answer: **from nothing to playable, in one guided flow.** The
user picks an engine and says where the game data should come from — download the free parts, or
copy from the Steam/GOG installation the launcher already found. Everything after that is a
progress bar and a Play button that lights up when the installation actually validates.

Around that first flow, the same machinery keeps installations alive: engines update to a version
we pinned and tested, a bad build rolls back, and a broken installation gets repaired with exactly
the pieces the manifest can supply. What the launcher cannot supply honestly — retail game data —
it never pretends to: it copies what the user already owns, or it says so.

The module is deliberately not a content store. It installs the engine and the base game. Mods,
asset packs and config templates belong to their own modules.

## 2. Scope

### In scope (v1)

- A **bootstrap wizard**, started from the Library: engine → data source → target folder → run.
- A **curated manifest** in `Hantsch/q2_community_content` covering engine builds and free
  game-data packages, with mirrors, sizes and SHA256; fetched by main, validated with zod, cached.
- **Downloading** with progress, pause/resume (HTTP range, surviving app restarts), cancel with
  cleanup, and parallelism up to a user-set limit.
- **Verification** of every downloaded file against the manifest's size and SHA256, with mirror
  fallback and hard failure.
- **Extraction** via a bundled 7-Zip binary: Windows self-extractors (`q2-314-demo-x86.exe`,
  `q2-3.20-x86-full-ctf.exe`) and engine ZIPs.
- **Retail import**: copying `pak0.pak`/`pak1.pak` (and `baseq2/video`) out of a detected store
  installation into the new installation.
- **Demo state**: an installation built from demo data is marked as such, visibly, with an upgrade
  action to retail import.
- **Engine update** (replace + backup) and **rollback**, per installation, against the pinned
  manifest version; an optional per-installation **bleeding-edge** mode that follows upstream.
- **Repair**: everything the manifest can supply (engine, executable, `pak2.pak`) plus the offer to
  copy missing retail paks from a store installation.
- **Removal from disk**, with confirmation, locked for store-managed installations.
- **The Downloads tab** as the module's surface: running jobs plus a failure log, and the archive
  cache.
- **Three settings** in a module-contributed Settings section.
- Redeeming the shell's existing job pipeline — this module is its first real producer, which also
  unblocks the parked [downloads badge story 032](../requirements/032-downloads-badge-active-count.md).

### Deliberately not in v1

- **First-start onboarding.** The wizard is reachable from the Library; the "you just installed the
  launcher and own nothing" flow is bigger than this module.
  > Rationale: the user's own framing — onboarding also has to cover profiles, mods and assets, so
  > it is its own concept, not a corner of this one.
- **Addons (ctf, xatrix, rogue).** `KNOWN_GAME_DIRS` already lists all four directories, and the
  free 3.20 package even contains ctf, but the bootstrap fills `baseq2` only.
  > Rationale: keeps the boundary to the Mods module clean and the wizard short.
- **Mods, asset packs, config templates as downloads.** Other modules, other manifest sections.
  > Rationale: the manifest's shape is fixed here so those can be added without a redesign.
- **Engine versions side by side** in one installation folder.
  > Rationale: replace-with-backup covers the real need (a bad nightly) at a fraction of the risk;
  > Quake II engines expect files in the installation root.
- **Non-Windows packaging of the extractor.** The design keeps the extractor behind one interface,
  but only the Windows binary ships in v1.
  > Rationale: the launcher is Windows-first; nothing here is Windows-only by design.

### Non-goals (permanent)

- **The launcher never distributes retail id Software game data.** It downloads only what is
  publicly and freely mirrored (demo, point release) and otherwise copies from what the user owns.
  This is why "we host pre-extracted paks ourselves" was rejected during the interview.
- **No "install anyway" past a failed hash.** We execute foreign binaries from the internet; a
  checksum that can be clicked away is decoration.
- **No silent upstream updates.** What the launcher installs by default is a version we pinned. A
  user who wants the newest nightly asks for it, per installation.
- **The launcher never deletes a store-managed game folder.** Steam/GOG/Epic own those paths.
- **No mirror-of-last-resort scraping.** If the manifest's mirrors are all dead, the job fails with
  a readable reason; the launcher does not go hunting.

## 3. Design decisions taken (from the requirements interview)

| Topic | Decision | Rationale (user's) |
| --- | --- | --- |
| Core of v1 | Bootstrap: from nothing to playable — free data + engine in one flow | The strongest moment the module can deliver; engine management and repair come with the same machinery |
| r1q2 has no live official source | A **curated manifest** in `Hantsch/q2_community_content` carries URL + size + SHA256 per engine and version; no URLs in launcher code | A dead mirror must cost a repo commit, not a launcher release; consistent with the home-screen concept's content repo |
| Retail game data | The launcher downloads only the free parts and **copies** retail paks out of a detected Steam/GOG/Epic installation | Same model as Quake II Starter; detection for those stores already exists |
| Retail paks: copy or link | **Copy** (~190 MB per installation) | Each installation stands on its own; a store update or uninstall must not break it |
| Archive extraction | A **7-Zip binary bundled with the app**, invoked as a child process | The free data ships as Windows self-extractors; one tool covers those and every engine ZIP, and it is the path Quake II Starter itself takes |
| Manifest scope | **Engines and free game-data packages**, each with URL, mirrors, size, SHA256 | All URLs out of the code; a dead mirror is one commit |
| Update detection | The **manifest is the truth** (pinned version per engine), **plus** an optional per-installation "bleeding edge" that follows upstream | Reproducible by default, current on request — both needs served |
| Hash mismatch | **Hard abort**: delete the file, try the next mirror, fail the job if all fail. No override | We execute foreign code from the network |
| Install target | The user picks any folder; a target under `Program Files` produces a **hard warning** that can be acknowledged | Freedom, but the damage is named before it happens |
| Non-empty target folder | Always warn, listing what is in there, with "continue anyway" | The user decides |
| Job parallelism | **Parallel with a limit the user sets in the settings** | Different machines and connections want different answers |
| Pause / resume / cancel | Resume (HTTP range, across app restarts), an explicit pause control, and cancel that removes partial files and the half-built installation | Full control over a long-running operation |
| Downloaded archives | **Kept in a cache with a budget**, configurable in the settings, which also shows the current cache size and offers a clear action that states what it will delete | A second installation and every repair should not re-download |
| Downloading while the game runs | A **user setting** | The user knows their bandwidth situation |
| Writing while the game runs | Always deferred: the download may run, extraction and copying wait for the process to exit | Never mutate the files of a running game |
| Where the settings live | The **Settings view learns to render module-contributed sections**; the module owns its values | Rule-conform (a feature is a module) and reusable by mods/assets later |
| Wizard entry point | An own **wizard, launched from the Library**; first-start onboarding is a separate concept | Onboarding has to cover profiles, mods and assets too |
| "Playable" during a job | The existing `inspectInstallation` verdict decides: as soon as the status is no longer `invalid`/`missing`, the installation is playable | Use the truth source that exists instead of inventing a second rule |
| Repair scope | Everything the manifest can supply (engine, executable, `pak2.pak`); missing retail paks turn into the offer to copy them from a store installation | Redeems the reserved `install-game-files` fix |
| Engine update | Replace the files, move the previous ones into a backup inside the installation, offer rollback | One rollback step, little complexity |
| Demo installations | A **visible state of the installation** — a "Demo" badge on tile, library card and action bar — plus a hint how to move to retail | Honest about what the user has |
| Addons in v1 | `baseq2` only | Clean boundary to the Mods module |
| Removal from disk | Allowed for any installation **with confirmation and the path shown** | The entry-only removal of today is not enough once the launcher creates folders itself |
| Removal safety | **Locked where `source` is Steam/GOG/Epic** — those offer entry removal only, with a note that the store uninstalls | Raised as an objection during the interview and accepted: the launcher must not dismantle a Steam library |
| Manifest transport | `raw.githubusercontent` on `main` of `Hantsch/q2_community_content`, last good copy cached in userData; offline shows the cache with an "as of …" note and works from the archive cache | Same transport as the news feed |
| Downloads tab content | Running jobs plus a **failure log** that persists until dismissed; successes fade | Only what one actually goes back to read |

## 4. Tech decisions

| Area | Choice | Rationale |
| --- | --- | --- |
| HTTP | Main-process only, Node/Electron built-in `fetch` with range requests; no new HTTP dependency unless resume forces one | The repo has no network code and only three runtime dependencies; the production CSP is `connect-src 'self'` and stays that way |
| Archive extraction | A bundled 7-Zip CLI binary behind one `Extractor` interface in main, invoked with a fixed absolute path and a fixed argument shape | Self-extracting `.exe` installers cannot be read by a JS ZIP library; the interface keeps the door open for other platforms |
| Hashing | `node:crypto` SHA256, streamed while writing the download | Already used in the config module; no dependency |
| Manifest format | JSON with `schemaVersion`, validated with zod in main; unvalidated data never reaches the renderer | The repo's validation convention |
| Job state | The existing `JobsService` and `Job`/`JobProgress` types; the module is their first producer | Built for exactly this, unused so far |
| Module state | A new top-level key in `state.json` with its own zod schema and defensive parse (the `configProfiles` precedent) for the module's settings, the failure log and resumable-download bookkeeping | `LauncherSettings` is a closed shape |
| Installation-scoped data | `Installation.moduleData['downloads']` for what belongs to one installation (pinned engine version, bleeding-edge flag, backup pointer) | The slot the model reserves for exactly this, with a worked migration example in `migrations.ts` |
| Cache location | `userData/cache/downloads/` for archives, partial files as `<name>.part` plus a sidecar with URL, size, hash and offset | Not in `state.json`; a cache is files |

## 5. Core terms & model

- **Manifest** — the curated JSON in the content repository: which engine versions and which free
  game-data packages exist, where they come from, how big they are and what they hash to.
- **Package** — one downloadable unit from the manifest (an engine build, the demo installer, the
  point release). Verified as a whole before it is used.
- **Source** — where an installation's game data comes from: `free-download` (demo + point
  release), `store-copy` (Steam/GOG/Epic), or `own-folder` (the user points at existing data).
- **Bootstrap job** — the composite job behind the wizard: fetch → verify → extract → assemble →
  validate.
- **Playable** — `inspectInstallation` no longer reports `invalid` or `missing`. This drives the
  `PLAYABLE` marker and the Play button, mid-job.
- **Pinned version** — the engine version the manifest names as current. The default for every
  installation.
- **Bleeding edge** — a per-installation opt-in to follow upstream instead of the pinned version.
- **Backup** — the previous engine files, kept inside the installation, restorable in one step.

```
  Wizard                     Job (main)                          Installation
  ------                     ----------                          ------------
  engine   --------+
  data source -----+--> resolve manifest --> download --> verify (size + SHA256)
  target folder ---+         |                  |              | mismatch
                             |                  |              v
                             |                  |         next mirror --> fail
                             v                  v
                       (offline: cache)   extract (7-Zip)
                                                 |
                             store-copy ---> copy paks --+
                                                         v
                                                   assemble baseq2 --> inspectInstallation
                                                                              |
                                                                    ok/warning +--> PLAYABLE
                                                                       invalid +--> job fails
```

## 6. The download landscape (research, 2026-09-08)

Everything in this section was verified at URL level on 2026-09-08. It is the reason the manifest
exists, and it is the state a story has to re-check before pinning anything.

**Engines**

| Engine | State | Source |
| --- | --- | --- |
| **Q2PRO** | Live. Rolling `nightly` release with `q2pro-client_win32_x86.zip`, `q2pro-client_win64_x64.zip`, server variants and a `version.txt`; last publish 2025-12-11 | [github.com/q2pro/q2pro/releases/tag/nightly](https://github.com/q2pro/q2pro/releases/tag/nightly) |
| Q2PRO (old official) | **Dead.** `skuller.net/q2pro/nightly/…` answers 302 to a parked domain; `skullernet/q2pro` no longer exists (the org `q2pro` does, and `skullernet/q2pro-ng` is a separate experimental line) | — |
| **r1q2** | **No live official distribution.** `r1ch.net/stuff/r1q2/` is 404; r1ch.net itself is alive but no longer lists r1q2. The updater every guide points at has no server | — |
| r1q2 (reachable prebuilt) | `r1q2-7387.exe`, 758 272 bytes, last modified **2008-03-21**, in tastyspleen's archive; and the Quake II Starter r1q2 package `q2starter-1.3.2-setup.zip`, 2 940 750 bytes, 2015-11-14 | [tastyspleen clients/r1q2/old/](http://tastyspleen.net/quake/downloads/clients/r1q2/old/), [q2s.tastyspleen.net](http://q2s.tastyspleen.net/) |
| r1q2 (source) | Full release archive and maintained forks | [tastyspleen/r1q2-archive](https://github.com/tastyspleen/r1q2-archive), [Slipyx/r1q2](https://github.com/Slipyx/r1q2) |
| Other engines | Not supported (`supported: false` in `ENGINE_DEFINITIONS`) and out of scope, but they do have live sources — yquake2 at `deponie.yamagi.org`, Q2RTX as GitHub releases (v1.8.1, 2025-12-11), q2repro nightlies | — |

**Free game data** — both mirrored twice and both answering 200:

| File | Size | Purpose | Mirrors |
| --- | --- | --- | --- |
| `q2-314-demo-x86.exe` | 39 015 499 B | Demo `pak0.pak` + `players/`; must **not** be patched | [yamagi](https://deponie.yamagi.org/quake2/idstuff/q2-314-demo-x86.exe), [tastyspleen](http://tastyspleen.net/quake/downloads/q2-314-demo-x86.exe) |
| `q2-3.20-x86-full-ctf.exe` | 19 267 584 B, MD5 `490557d4a90ff346a175d865a2bade87` | The point release: `pak2.pak`, required for every full version; also carries ctf | [yamagi](https://deponie.yamagi.org/quake2/idstuff/q2-3.20-x86-full-ctf.exe), [tastyspleen](http://tastyspleen.net/quake/downloads/q2-3.20-x86-full-ctf.exe) |
| `q2-3.20-x86-full.exe` | — | The same point release without ctf | [tastyspleen](http://tastyspleen.net/quake/downloads/q2-3.20-x86-full.exe) |

**Retail data** stays with the user: `pak0.pak` (183 997 730 B) and `pak1.pak` (12 992 754 B) come
from a retail CD, Steam or GOG — the sizes already in `RETAIL_PAK_SIZES`. The yquake2
documentation additionally publishes MD5 sums for every pak of every edition, which is a candidate
source for the hash-later half of validation.

**Precedent.** Quake II Starter (v2.2.4 for Q2PRO, v1.3.2 for r1q2) does exactly what this module
does: it ships no licensed content and downloads the 3.14 demo and the 3.20 point release on the
user's behalf, optionally taking a retail `pak0.pak` the user places next to the installer. Its
site currently carries the note that the skuller Q2PRO download is offline and links the new
`q2pro/q2pro` nightly — the same breakage this concept designs around.

## 7. The manifest

One curated JSON file per content type in `Hantsch/q2_community_content`, fetched over
`raw.githubusercontent` on `main` — the transport the [home-screen concept](home-screen.md)
already fixed for `news/`. The install module adds `engines/` and `gamedata/` next to the
`packs/`, `mods/` and `config_templates/` directories that concept reserved.

Each manifest carries a `schemaVersion` and a list of **packages**. A package fixes:

- an id and a human version string,
- the engine kind it belongs to (for engine packages) or the role it fills (for data packages),
- a primary URL and an ordered list of mirrors,
- expected size in bytes and a SHA256,
- what it contains and where those contents belong inside an installation.

Per engine, the manifest also names which version is **pinned** — the default every installation
gets. Adding a version, retiring a dead mirror or moving an engine to a new host is a commit; the
launcher needs no release.

What the launcher does with it:

- Fetch on demand (wizard open, update check, repair) and cache the last good copy in userData.
- Validate with zod in main. A package that does not validate is dropped with a log line; the rest
  of the manifest stays usable.
- Offline: use the cache, tell the user its age, and satisfy what the archive cache can satisfy.
- A higher `schemaVersion` than the launcher knows is handled per §15 (open).

## 8. The bootstrap wizard

Launched from the Library. Four steps, then a job:

1. **Engine.** The supported engines from `ENGINE_DEFINITIONS` (r1q2, Q2PRO today), each with the
   version the manifest pins.
2. **Game data.** Three ways: download the free parts, copy from a detected store installation
   (the detection service already finds Steam/GOG/Epic), or point at a folder that already has
   data. The free path produces a **demo installation** unless retail paks are supplied.
3. **Target folder.** Free choice. Under `Program Files` the wizard shows a hard warning that
   names the consequence — Quake II writes into its own directory — and offers the existing
   `set-write-dir` remedy; the user can acknowledge and continue. A non-empty folder produces a
   warning listing what is in there, with "continue anyway".
4. **Confirm.** What will be downloaded, how large it is, where it goes.

Then one job runs the pipeline of §5. The Play button lights up the moment `inspectInstallation`
stops saying `invalid`/`missing`, even while the job continues.

## 9. Jobs, queue and settings

- Jobs are the shell's `Job` objects, produced by this module for the first time. `JobProgress`
  already carries bytes, speed, ETA, files remaining and `playableAtRatio`.
- **Parallelism** up to the user's limit; the rest queue. The count of active jobs is what
  [story 032](../requirements/032-downloads-badge-active-count.md)'s titlebar badge shows.
- **Pause** puts a job into the existing `paused` status. **Resume** continues from the byte offset
  recorded next to the partial file, using an HTTP range request, and survives an app restart.
- **Cancel** removes partial files and, for a bootstrap job, the half-built installation.
- **A running game** never blocks downloading (subject to the user's setting) but always blocks
  writing: extraction and copying into that installation wait for the process to exit and then
  continue on their own, with the reason visible in the UI.
- **The Downloads tab** shows running jobs, a failure log that persists until dismissed, and the
  archive cache with its size.

Three settings, in a Settings section the module contributes:

| Setting | Effect |
| --- | --- |
| Concurrent jobs | Upper bound on simultaneously running jobs |
| Archive cache budget | Maximum cache size; oldest archives are evicted first. Shows the current size and offers a clear action that first states what it will delete |
| Download while playing | Whether downloads may run while Quake II is running (writing always waits) |

## 10. Update and rollback

- The pinned manifest version is compared against the installation's recorded engine version. A
  difference is an offered update, never an automatic one.
- An update downloads and verifies the package, then replaces the engine files, moving the previous
  ones into a backup inside the installation. **Rollback** restores that backup in one step.
- **Bleeding edge** is a per-installation opt-in: instead of the pinned version, the launcher asks
  upstream what the newest build is. The exact probe and its trust model are open (§15).
- The installation's recorded engine version is a natural candidate to finally populate
  `detectedVersion`, which is defined in the model but never written today.

## 11. Repair

Repair answers the checks `inspectInstallation` already produces:

| Finding | Repair in v1 |
| --- | --- |
| Engine executable missing or unusable | Re-install the pinned engine package |
| `pak2.pak` missing | Download and extract the 3.20 point release |
| `pak0.pak` is demo data, retail wanted | Offer to copy retail paks from a detected store installation |
| Retail `pak0`/`pak1` missing | Same offer; if no store installation exists, say so plainly |
| Not writable (e.g. under `Program Files`) | The existing `set-write-dir` fix, unchanged |

This is the redemption of `ValidationFix`'s `install-game-files`, which the model reserved for
"the install/update module" from the start, and it makes the `Repair` state of the action bar —
which today only navigates to the Downloads tab — do something.

## 12. Rule conflicts and how they are resolved

1. **"A feature is a module — never edit the shell" vs. two settings the user wants under
   Settings.** Resolved by making the shell's Settings view able to render sections that modules
   contribute, once. The module keeps ownership of its values; `LauncherSettings` stays closed.
   Every later module (mods, assets) uses the same mechanism. This is a shell change with a
   documented reason, not a bend.
2. **"Paths from the renderer are never trusted" vs. a wizard that sends a target path.** The
   target path arrives as a zod-validated payload and is then checked in main: absolute, not a
   device path, not inside the app's own installation, existence and writability probed, and the
   `Program Files` verdict computed in main. The extractor is invoked with a fixed binary path and
   a fixed argument shape; no renderer value ever becomes an argument or a flag.
3. **A bundled 7-Zip binary is a child process with a lot of power.** It is spawned with an
   absolute path to the packaged resource, never from `PATH`, with arguments assembled in main from
   validated values only, and its working directory is the download cache. Licensing and which
   binary variant ships is open (§15).
4. **"No image assets in the UI"** is untouched: the wizard is CSS/inline SVG like every other
   surface. Installation icons remain the recorded exception.

## 13. Integration with existing systems (architecture notes)

- **Module registration** follows [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module):
  the `downloads` manifest entry exists already and flips from `planned`; a shared contract under
  `src/shared/modules/downloads.ts` comes first; the main half lands in
  `src/main/modules/downloads/` and is registered in `src/main/modules/index.ts`; the renderer half
  replaces the `PlannedModuleView` fallback via the commented-out placeholder in
  `src/renderer/src/modules/index.ts`. All request traffic rides the single `module:invoke` channel.
- **Jobs** use `JobsService` and the `jobs:changed` broadcast unchanged. The dev-only
  `dev:simulateJob` channel keeps working and stays the fixture path for UI verification.
- **Persistence:** module settings, the failure log and resume bookkeeping become a new top-level
  key in `state.json` with its own schema and defensive parse; per-installation data goes into
  `Installation.moduleData['downloads']`. Anything that changes the `Installation` shape (the demo
  state) needs a `MIGRATIONS` step — `migrations.ts` carries a worked example for exactly this.
- **Inspector:** the single source of truth for health stays `inspectInstallation`. The module
  calls it, it does not re-implement validation. Its `pak0NotRetail` warning is what the demo state
  builds on.
- **Detection:** the store providers already parse Steam's `libraryfolders.vdf`, GOG's registry
  entries and Epic's manifests; the retail-copy step reuses that result rather than scanning again.
- **CSP** stays `connect-src 'self'`; all network access is in main.
- **Design tokens:** wizard, progress and cache UI use the semantic token layer. Dense controls
  follow the deviations already recorded in `CLAUDE.md`.
- **UI verification:** the wizard's steps, the warning states, a running job, the failure log and
  the cache section become entries in the `ui:verify` screen registry, with a `ui:flow` script for
  the wizard walk-through. A verification run must never touch the network — the manifest and the
  packages are fixtures.
- **Tests:** manifest validation, mirror fallback, hash verification, resume-offset arithmetic,
  queue admission under the limit, the path-safety verdicts and the assemble step are pure modules
  with unit tests; that is where the acceptance criteria are proven.

## 14. Requirements

**Manifest (INST-M)**

- **INST-M1** — The launcher contains no download URL for an engine or game-data package; every
  URL comes from the manifest.
- **INST-M2** — The manifest carries `schemaVersion` and, per package, id, version, role/engine
  kind, primary URL, ordered mirrors, size in bytes, SHA256, and the mapping of its contents into
  an installation.
- **INST-M3** — Per engine, the manifest names the pinned version; that version is the default for
  every new installation and every update check.
- **INST-M4** — The manifest is fetched by main over `raw.githubusercontent` on `main`, validated
  with zod, and the last good copy is cached in userData.
- **INST-M5** — A package that fails validation is dropped with a log line; the remaining manifest
  stays usable.
- **INST-M6** — Offline, the wizard and the update check work from the cached manifest and state
  its age; downloads are satisfied from the archive cache where possible and otherwise fail with a
  readable reason.
- **INST-M7** — The content repository's README documents the manifest format and how to add a
  version or retire a mirror.

**Verification (INST-V)**

- **INST-V1** — Every downloaded file is checked against the manifest's size and SHA256 before it
  is used.
- **INST-V2** — On mismatch the file is deleted and the next mirror is tried; when all mirrors
  fail, the job fails with the reason. There is no user-facing override.
- **INST-V3** — Extraction never runs on an unverified file.
- **INST-V4** — After assembly, `inspectInstallation` decides whether the installation is healthy;
  the job's success is that verdict, not the absence of transfer errors.

**Bootstrap wizard (INST-W)**

- **INST-W1** — The wizard is reachable from the Library and offers only engines whose
  `EngineDefinition.supported` is true.
- **INST-W2** — The wizard offers three data sources: free download, copy from a detected store
  installation, and an existing folder.
- **INST-W3** — A target under `Program Files` produces a warning that names the write-access
  consequence and offers the `set-write-dir` remedy; the user may acknowledge and continue.
- **INST-W4** — A non-empty target folder produces a warning that lists what is in there; the user
  may continue.
- **INST-W5** — Before the job starts, the wizard states what will be downloaded, its total size
  and the target path.
- **INST-W6** — The wizard produces a registered installation whose status comes from
  `inspectInstallation`, never a hand-set status.
- **INST-W7** — v1 fills `baseq2` only; no ctf, xatrix or rogue directory is created by the
  bootstrap.

**Retail import and demo state (INST-D)**

- **INST-D1** — Retail `pak0.pak`/`pak1.pak` are copied, not linked or referenced.
- **INST-D2** — The copy source is a store installation found by the existing detection service.
- **INST-D3** — An installation whose base data is demo data carries a visible demo marker on the
  installation tile, the library card and the action bar.
- **INST-D4** — A demo installation offers an action to import retail data from a store
  installation, which turns it into a normal installation.
- **INST-D5** — The launcher never downloads retail game data.

**Jobs and queue (INST-J)**

- **INST-J1** — The module produces `Job` objects through `JobsService`; no parallel progress
  mechanism is introduced.
- **INST-J2** — At most as many jobs run simultaneously as the concurrency setting allows; the rest
  are `queued`.
- **INST-J3** — A job can be paused and resumed; resume continues at the recorded byte offset via
  an HTTP range request.
- **INST-J4** — A resumable download survives an app restart.
- **INST-J5** — Cancelling removes partial files and, for a bootstrap job, the half-built
  installation.
- **INST-J6** — `playableAtRatio` is set from the point at which `inspectInstallation` first stops
  reporting `invalid`/`missing`.
- **INST-J7** — While Quake II is running, no job writes into that installation's files; the job
  reports why it is waiting and continues by itself after the process exits.
- **INST-J8** — Whether downloading is allowed while the game runs follows the corresponding
  setting.
- **INST-J9** — A failed job's reason is readable in the Downloads tab and persists until
  dismissed.

**Settings and cache (INST-S)**

- **INST-S1** — The Settings view renders sections contributed by modules; the module owns its
  values, and `LauncherSettings` gains no fields.
- **INST-S2** — The settings offer concurrent-job count, archive-cache budget and
  download-while-playing.
- **INST-S3** — The cache section shows the current cache size.
- **INST-S4** — Clearing the cache states what will be deleted before it happens.
- **INST-S5** — When the budget is exceeded, the oldest archives are evicted; an archive belonging
  to a running job is never evicted.

**Update and rollback (INST-U)**

- **INST-U1** — An update is offered when the pinned manifest version differs from the
  installation's recorded engine version; it is never applied automatically.
- **INST-U2** — An update replaces the engine files and keeps the previous ones as a backup inside
  the installation.
- **INST-U3** — Rollback restores that backup in one step.
- **INST-U4** — Bleeding edge is a per-installation opt-in; without it, only pinned versions are
  installed.

**Repair (INST-R)**

- **INST-R1** — Repair offers exactly the fixes the manifest can supply, plus the retail-copy offer
  for missing retail paks.
- **INST-R2** — Repair is driven by `inspectInstallation`'s checks; the module does not invent its
  own diagnosis.
- **INST-R3** — When nothing can be repaired, the UI says so instead of offering an action that
  does nothing.

**Removal (INST-X)**

- **INST-X1** — Removing an installation from disk is possible with a confirmation that shows the
  path.
- **INST-X2** — Installations whose `source` is Steam, GOG or Epic cannot be removed from disk;
  they offer entry removal with a note that the store uninstalls the game.
- **INST-X3** — Removal from disk never touches anything outside the installation's own folder.

**Safety and architecture (INST-A)**

- **INST-A1** — All network access, hashing, extraction and filesystem writing happen in main.
- **INST-A2** — Every renderer-supplied path is zod-validated and then checked in main for
  absoluteness, plausibility and writability before use.
- **INST-A3** — The extractor is invoked with a fixed absolute binary path and a fixed argument
  shape; no renderer value becomes an argument.
- **INST-A4** — The production CSP is unchanged.
- **INST-A5** — A UI verification run works without network access.

## 15. Open points

1. **Which r1q2 build we pin, and from where.** The only reachable prebuilt binaries are
   `r1q2-7387.exe` (2008) and the Quake II Starter r1q2 package (2015); the newest public sources
   are in `tastyspleen/r1q2-archive`. Whether we pin the archive installer, extract the binaries
   out of the Starter package, mirror them into our own repository, or build from source and
   publish a release under `Hantsch` is undecided — and it decides whether we become a distributor
   of someone else's client.
2. **Whether r1q2 needs the anticheat component** to be useful on the servers people actually play
   on, and whether that is downloadable at all today (`antiche.at` is up; its distribution was not
   examined).
3. **Pinning a rolling tag.** Q2PRO's `nightly` release is a moving target: the asset URL stays the
   same while its content changes, so a pinned SHA256 will start failing the moment upstream
   publishes. Either we mirror each pinned asset into our own release (immutable, but we host
   binaries) or "pinned" means "URL plus hash, and the pin breaks loudly when upstream rotates".
   This is the single biggest unresolved mechanic.
4. **How we obtain and record hashes** — computed by hand once per pinned version, or by a script
   in the content repository, and whether the manifest also carries the upstream-published MD5s
   (which exist for the game data) as a second signal.
5. **Store editions.** Whether a Steam or GOG install of the 2023 re-release yields
   3.20-compatible `pak0`/`pak1` matching `RETAIL_PAK_SIZES` at all, or whether only the classic
   editions do. `NON_GAME_DIRS` already skips `rerelease`, which suggests the layout differs.
   Needs verification on real installations before the retail-copy step can promise anything.
6. **Which 3.20 package** the manifest points at — `q2-3.20-x86-full-ctf.exe` (mirrored twice) or
   `q2-3.20-x86-full.exe` (tastyspleen only) — given that v1 fills `baseq2` only and would discard
   the ctf directory.
7. **What else the demo and point release contribute besides paks** — `baseq2/video/` and
   `players/` are part of a complete installation; whether the bootstrap copies them is not fixed.
8. **The 7-Zip binary**: which variant (`7zr.exe`, `7za.exe`, full `7z.exe`), its licensing
   implications for our distribution, how it is packaged by electron-builder and resolved in dev
   vs. production, and whether it needs to be covered by the code-signing decision the roadmap
   already lists as a follow-up.
9. **Placeholder numbers**: default and allowed range for concurrent jobs, default archive-cache
   budget, and the default for download-while-playing. None of these were decided.
10. **Timeouts, retries and proxies** — per-request timeout, retry budget before falling to the
    next mirror, and whether the system proxy is honoured.
11. **Manifest schema evolution** — how a launcher reacts to a `schemaVersion` higher than it
    knows (ignore-with-note vs. refuse the manifest), and how a new package role is introduced.
12. **The bleeding-edge probe** — GitHub release API vs. `version.txt`, its rate limits, and what
    verification is even possible when no hash is known in advance.
13. **How the demo state is modelled** — a dedicated field on `Installation`, a value of an
    existing enum, or derived from the `pak0NotRetail` check at read time; plus the migration.
14. **Extraction progress** — bytes are natural for downloads, but 7-Zip's progress needs either
    output parsing or a coarser per-step model.
15. **Disk-space precheck** before a job starts, and what the wizard does when space is short.
16. **Naming and identity of a bootstrapped installation** — default name, whether an icon is
    assigned, and where it lands in the rail's sort order.
17. **Where the wizard's entry point sits in the Library** — a button next to the existing "create
    installation", or a replacement of it, and what happens to the current
    `CreateInstallationDialog` and its bare-folder `installations:create` path.
18. **First-start onboarding** — deliberately out of scope; it is expected to reuse this wizard as
    one of its steps, together with profiles, mods and assets.
19. **i18n of failure reasons** — every job failure needs a key, not prose, across IPC; the set of
    reasons is not enumerated yet.
20. **Whether the failure log is per installation or global**, and how long a dismissed failure
    stays recoverable.
