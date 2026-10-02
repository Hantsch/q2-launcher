# Mods — Game Directories, Catalog and Install — Concept

Status: **Draft** (vision + requirements, stories cut). This document fixes what the launcher's
`mods` module becomes in v1: a tile catalog of curated multiplayer mods, installed from their
original sources into one installation, next to the game directories already on disk. The
server detail and the demo browser offer that install where a mod is missing. Everything here
comes from the source and licence research and the requirements interview of 2026-09-30/10-01.
Facts about the repo are marked as such. Nothing was inferred.

This document follows the architecture rules in [CLAUDE.md](../../CLAUDE.md): a feature is a module
(here: the already-declared `mods` module, `src/shared/types/module.ts`), the IPC contract is
written first, every renderer-supplied payload carries a zod schema, a feature that cannot work on
a platform stays visible with a visible reason, and no bundled image assets enter the UI. It builds
on the install module ([install-module.md](../systems/install-module.md)): curated manifest,
download pipeline, verification, archive cache, write guard. It also builds on the game browser
([game-browser.md](game-browser.md), GB-D5) and the demo browser's mod-missing warning (story 182).

---

## TL;DR

- **Vision:** a mod a server or a demo needs should be one click away. Today that means hunting
  down a ZIP and unpacking it by hand.
- **Multiplayer first.** v1 curates the mods people actually play online: **Action Quake**
  (AQtion content + AQ2-TNG game library), **OpenTDM** and **CTF**. Singleplayer mods, mission
  packs and Zaero come later.
- **Downloads come only from the original source** (GitHub releases, the id point release on
  Yamagi/tastyspleen). **Mirroring is prepared, not done:** the manifest's `mirrors[]` field is
  read now but empty for mods. Each entry also carries its licence and source, and the UI shows
  them. If we mirror later, that is one manifest commit.
- **A mod installs the full package for the installation's engine and platform**, game library
  included. If no matching build exists, for example OpenTDM for 64-bit Q2PRO on Windows, the
  launcher installs the content only. It then says visibly that the mod is not playable locally
  with that engine. Joining a server still works.
- **The target is one installation.** Removing a mod removes **only the files the launcher put
  there**, following an install record in `Installation.moduleData['mods']`. User files stay put.
- **Game directories not installed by the launcher** appear as _installed manually_. The launcher
  shows them but never updates or removes them.
- **Updates:** the manifest pins a version. The launcher offers a newer one and the user decides.
- **UI:** a **tile catalog** with a **detail panel**. The tiles have no Play button: starting the
  game stays in the action bar.
- **GB-D5 lands here:** the server detail says whether the server's mod and map exist locally and
  offers the install. The demo browser's mod-missing dialog offers it too.
- **Biggest open points:** where engine bitness comes from (§14 item 1), how deep "the map exists
  locally" looks (item 3), and whether the new tile pattern needs a layout prototype first (item 4).

---

## 1. Vision

Quake II mods are game directories next to `baseq2`. Today, getting one means finding a ZIP on a
forum, a GitHub page or ModDB, guessing which DLL fits your client, and unpacking it by hand. The
launcher already knows the installation, its engine and its platform, so it can do the guessing.
When the server browser shows an Action Quake server, or a demo was recorded on OpenTDM, the mod
it needs is one click away, and the launcher says honestly when that click only gets you halfway.

There is no Quake II mod repository with an API (Quaddicted exists for Quake 1 only, ModDB has no
API and its download links expire). The catalog is therefore **curated by us**, in the same
content repository that already carries the engines and the free game data.

## 2. Scope

### In scope (v1)

- A `mods` module with its own view, replacing today's planned-module placeholder.
- **Discovery:** every game directory of every installation (the inspector's existing
  `gameDirs`) is shown, with its origin: _from the catalog_ or _installed manually_.
- **Catalog:** a `mods/manifest.json` in `Hantsch/q2_community_content`, fetched, validated and
  cached the same way as the engines and game-data manifests.
- **Catalog v1 entries:** Action Quake (`action`), OpenTDM (`opentdm`), CTF (`ctf`).
- **Install** into one chosen installation, as a job with progress, verification and the write
  guard, picking the variant that fits the installation's platform and engine.
- **Content-only fallback** with a visible "not playable locally" reason when no matching game
  library exists.
- **Remove** a catalog-installed mod: only the files the launcher installed are removed.
- **Update offer** when the manifest pins a newer version than the installed one.
- **Licence and source** shown per catalog entry.
- **GB-D5:** the server detail states whether mod and map exist locally and offers the install.
  The demo mod-missing dialog offers the install too.

### Deliberately not in v1

- **Singleplayer mods** (ModDB classics, Quaddicted's idgames2 mirror).
  > Rationale: the launcher's audience plays online. Server browser and demo browser need MP mods.
- **Mission packs (`rogue`, `xatrix`) and Zaero:** their data is commercial and could only be
  copied from a Steam/GOG/Epic installation. Discovery still shows them when they are already
  there.
  > Rationale: user decision. It comes later, reusing the install module's retail-copy mechanics.
- **Jump (`jump`):** it has no prebuilt releases and no content package, and its maps come from
  the servers.
  > Rationale: user decision. It comes once a download source exists, or once we mirror and build
  > it ourselves.
- **Mirroring** mod files in our own content repository.
  > Rationale: user decision. v1 downloads from the original sources only. The manifest is shaped
  > so that mirroring later costs a commit, not a release (§8).
- **A "redistributable" flag per manifest entry.** It was offered and not chosen.
- **Per-mod config profiles.**
  > Rationale: user decision. The config module already writes its loader into played mod folders
  > (`writer.ts`, repo fact), and that is enough for now.
- **Installing into several installations at once.**
- **Updating or removing a manually installed mod.**

### Non-goals (permanent)

- **Quake II Remaster (KEX) mods** such as most of Nexus Mods and many recent ModDB uploads. They
  do not run on r1q2/Q2PRO, and the launcher does not target the Remaster.
- **Scraping ModDB.** Its mirror links rotate within hours to days and there is no API. A ModDB
  item can at most be a link that opens in the browser.
- **Bundling id's game data from anywhere other than id's own distributed package or the user's
  own retail copy.** That is the licence boundary found in the research (§7).

## 3. Design decisions taken (from the requirements interview)

| Topic                              | Decision                                                                                                                                  | Rationale                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Focus of v1                        | Multiplayer mods first                                                                                                                    | Matches the server browser and demo browser. Online play is what users do.     |
| What an install contains           | The full package including the game library, per engine and platform                                                                      | Local games and demos work too, not just joining                               |
| No matching build                  | Install the content only and show a visible reason ("Not playable locally with Q2PRO 64-bit: no matching build"). Joining stays possible. | Joining does not need the game library. The reason is honest.                  |
| Retail mods (mission packs, Zaero) | Later                                                                                                                                     | Commercial data. Copying from a store installation is its own step.            |
| GB-D5                              | In v1, with an install button. The demo mod-missing dialog gets the same offer.                                                           | A missing mod should be one click away where you notice it                     |
| Install target                     | One installation at a time                                                                                                                | Fits `activeGameDir` and the installation model                                |
| Removing                           | Only files the launcher installed, from an install record. The folder stays if it is not empty.                                           | Mod folders hold user demos, configs and screenshots                           |
| Foreign game directories           | Shown as _installed manually_. The launcher does not update or remove them. Installing a catalog mod over one asks first.                 | Never touch what the launcher did not put there                                |
| Catalog v1                         | Action Quake, OpenTDM, CTF                                                                                                                | The mods with a real download source and active servers. Jump has no source.   |
| Jump                               | Out of v1                                                                                                                                 | No releases, no content package                                                |
| Updates                            | Manifest pins a version, the launcher offers it, the user decides                                                                         | Same model as engines: reproducible, never silent                              |
| Mirror preparation                 | Licence and source shown in the UI; `mirrors[]` read now, empty for mods                                                                  | Mirroring later is a manifest commit. The GPL source note is already in place. |
| Download source v1                 | Original sources only, no mirroring                                                                                                       | User decision after the licence check                                          |
| View                               | Tile catalog with a detail panel                                                                                                          | User decision                                                                  |
| Per-mod config                     | Later                                                                                                                                     | The config loader in played mods is enough for now                             |
| Play button on a tile              | None. Starting stays in the action bar.                                                                                                   | User decision                                                                  |

## 4. Tech decisions

None beyond the stack in CLAUDE.md. The module reuses the install module's pipeline: 7-Zip
extraction, size and SHA256 verification, the archive cache, `JobsService` and the write guard.

## 5. Core terms & model

- **Game directory (gamedir):** a folder next to `baseq2` that the engine loads with
  `+set game <dir>`. The inspector already recognises one by its paks or game library
  (`inspector.ts`, repo fact).
- **Catalog entry:** one mod in `mods/manifest.json`. It has a gamedir name, a display name, a
  description, a licence, links to the project and its source, a pinned version and one or more
  **variants**.
- **Variant:** what to download for one _(platform, engine architecture)_ pair. It is one or more
  packages with URL, mirrors, size, SHA256 and a `contents` mapping into the gamedir. A variant
  without a game library is **content-only**.
- **Install record:** per installation and mod, in `Installation.moduleData['mods']`. It holds the
  catalog id, the version, the variant and the list of installed files with their sizes and
  hashes. Removing a mod and detecting user changes both work from this record.
- **Origin:** _catalog_ (an install record exists) or _manual_ (a gamedir exists without a record).

```
 content repo                launcher (main)                        installation root
 mods/manifest.json ──fetch/validate/cache──► catalog
                                              │ pick variant (platform, engine arch)
                                              ▼
                                 download ► verify ► extract ► write-guard ► <root>/<gamedir>/…
                                                                  │
                                                                  └► moduleData['mods'] install record
                                                                       ► revalidate ► gameDirs
```

## 6. The v1 catalog (research, 2026-10-01)

| Entry        | gamedir   | Sources                                                                                                                                                                                                                                          | Variants found                                                                                                                                                                                          |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action Quake | `action`  | AQtion `content-only.zip` ([actionquake/distrib](https://github.com/actionquake/distrib/releases), latest stable v1.3.8, v1.4.0-rc1 is a pre-release) + game library from [actionquake/aq2-tng](https://github.com/actionquake/aq2-tng/releases) | TNG: `win-32`, `win-64`, `lin-x86_64` (also arm64/darwin) → full for r1q2 and Q2PRO on Windows and Linux                                                                                                |
| OpenTDM      | `opentdm` | [packetflinger/opentdm](https://github.com/packetflinger/opentdm/releases) (r388, 2026-08)                                                                                                                                                       | `win32.zip`, `linux-x86_64.tar.gz` → full for r1q2 on Windows and for Linux Q2PRO. **For Q2PRO 64-bit on Windows it is content-only**: OpenTDM has no client content, so this creates only the gamedir. |
| CTF          | `ctf`     | The `ctf/` payload of the id 3.20 point release, **already in `gamedata/manifest.json`** as `q2-320-x86-full-ctf` (Yamagi + tastyspleen)                                                                                                         | Win32 `gamex86.dll` + `pak0.pak` → full for r1q2, **content-only for Q2PRO 64-bit and Linux**                                                                                                           |

Repo facts that make this possible or constrain it:

- The bundled Q2PRO is a 64-bit Windows build and the bundled r1q2 a 32-bit one (engines manifest).
  A game library only ever fits one of them, which is why variants exist.
- `EngineDefinition` has **no bitness field** today (§14 item 1).
- The point-release package's `ctf/` payload is deliberately excluded from the bootstrap today
  (`assemble.ts`, story 074 AC8). The mods module is the first to use it.
- The manifest's `contents[].to` currently allows only `'root' | 'baseq2'`. Mods need a gamedir
  target.

## 7. Licences (research, 2026-10-01)

| Entry   | Code                                                                   | Data                                                                                                                                 | Consequence                                                                   |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| AQtion  | GPL-2.0                                                                | Free of licensed content by its own statement. The id player models are redistributed under AQtion's own permission from id/ZeniMax. | Download from source: fine. Mirroring: needs clarification first.             |
| AQ2-TNG | No LICENSE file. Derived from id's GPL source, and AQtion names GPLv2. | —                                                                                                                                    | Download: fine. Mirroring: ask the maintainers for an explicit licence first. |
| OpenTDM | GPL-2.0                                                                | —                                                                                                                                    | Download and mirror both fine, with a link to the source                      |
| CTF     | GPL-2.0 (yquake2/ctf, id source)                                       | `ctf/pak0.pak` is id data from the freely distributed 3.20 point release, not GPL                                                    | Only taken from the complete 3.20 package, never shipped separately           |

The detail panel shows each entry's licence (SPDX id), project page and source link. For GPL
entries this is the source note the licence asks for if we ever mirror the binaries.

## 8. Mirror readiness

- Every package keeps the existing `url` + `mirrors[]` shape (`downloads/schemas.ts`, repo fact),
  and the mods module reads `mirrors[]` the same way the install module does.
- In v1, `url` is the original source and `mirrors[]` is empty for every mod package.
- Mirroring later means: put the file into our hosting, add its URL to `mirrors[]` (or swap it into
  `url`), keep size and SHA256. No launcher change.

## 9. Discovery and the catalog view

- The view is a **tile catalog**. Each tile shows the mod name, a short description, its status
  for the selected installation and **one main action** (Install / Update / Installed). Status is
  one of _not installed_, _installed_, _installed — content only_, _update available_ or
  _installed manually_.
- Manually installed gamedirs that match no catalog entry get their own tiles, marked
  _installed manually_.
- Clicking a tile opens a **detail panel**: description, licence, project and source links, status
  per installation, version installed and pinned, and all actions (install, update, remove, reveal
  folder). It also shows the content-only reason when it applies.
- There is no Play button. The action bar's existing gamedir picker (`ActionBar.tsx`, repo fact)
  remains the place to start a mod.
- The installation the tiles speak for is chosen in the view (open point §14 item 6).

## 10. Install, update and remove

- **Install:** one job per mod and installation, using the existing download pipeline (mirrors,
  retries, `.part` files, size and SHA256 verification, archive cache, 7-Zip extraction). The
  write phase runs inside `app.writeGuard.runWrite`, so it waits while the game runs (repo fact).
  Afterwards the installation is revalidated, so `gameDirs` and the action bar picker include the
  mod.
- **Variant choice:** by the installation's platform and engine architecture. If no variant has a
  game library for that pair, the content-only variant is installed and its reason is shown on the
  tile and in the detail panel. Linux follows the same rule.
- **Over a manual gamedir:** installing asks first, naming the folder. It never deletes foreign
  files, but it does overwrite files with the same name (open point §14 item 7).
- **Update:** offered when the manifest's pinned version differs from the installed record. The
  user starts it, and it runs as an install of the new version that replaces the recorded files.
- **Remove:** deletes only the files in the install record. The folder is removed only if it is
  then empty. The record is dropped, and the installation is revalidated. Runs inside the write
  guard.

## 11. GB-D5 and the demo mod warning

- **Server detail:** says whether the server's mod (`gamedir`) exists in the active installation
  and whether its map exists locally. If the mod is missing and the catalog has it, an **Install**
  button starts the install into the active installation. A catalog entry is matched by gamedir
  name, case-insensitively.
- **Demo mod-missing dialog (story 182):** when the catalog has the missing mod, the dialog also
  offers **Install**, next to the existing _Play anyway_.
- The roadmap follow-up "Play anyway on a mod without a game dir fails with ENOENT" is not fixed by
  this, but becomes much rarer. It stays a follow-up.

## 12. Integration with existing systems (architecture notes)

- **Module:** `src/main/modules/mods/` and `src/renderer/src/modules/mods/`. Register them in both
  registries (repo fact: `mods` is parked in `src/main/modules/index.ts`, and the renderer stub is
  commented out). The manifest already declares the capabilities `mutates-installation`,
  `long-running-jobs`, `network` and `game-lifecycle`.
- **Contract:** a new `src/shared/modules/mods.ts` with handlers and zod payload schemas. Every
  installation id and catalog id is validated in main. A gamedir name from the manifest or from a
  server passes the same safe-token rule as `launch-plan.ts` before it becomes a path.
- **Manifest:** `content/q2_community_content/mods/manifest.json` with its own zod schema
  (`schemaVersion: 1`), parsed defensively: a bad row is dropped, a bad envelope refused (the
  precedent of `manifest-parse.ts`). Transport, cache and the offline "as of …" behaviour are the
  install module's.
- **State:** install records in `Installation.moduleData['mods']`, parsed defensively like
  `downloads/engine/installation-state.ts`.
- **Cross-module calls:** the servers and replays modules ask the mods module "is this gamedir in
  the catalog / installed?" and "install it". How a module exposes that to another module without
  editing the shell is open (§14 item 5).
- **Config module:** `configPlayedMods` must not point at a mod that was removed (repo fact:
  `writer.ts` already filters against `gameDirs`).
- **i18n:** labels, statuses and reasons are i18n keys. Catalog names and descriptions are foreign
  content from the manifest, like news entries (open point §14 item 8).

## 13. Requirements

### Catalog and discovery

- **MOD-1** The Mods view lists every catalog entry and every game directory found in the selected
  installation, each as a tile.
- **MOD-2** A game directory without an install record is labelled _installed manually_.
- **MOD-3** The catalog is read from `mods/manifest.json` in the content repository, validated in
  main, cached, and shown from the cache with an "as of" note when offline.
- **MOD-4** The detail panel shows the licence, project page and source link of a catalog entry.

### Install

- **MOD-5** Installing a mod into an installation runs as a job with progress and lands the mod in
  `<root>/<gamedir>/`.
- **MOD-6** The variant matches the installation's platform and engine architecture.
- **MOD-7** Without a matching game library, the content is installed and the tile and detail show
  the visible reason "Not playable locally with <engine>: no matching build".
- **MOD-8** Every package is verified by size and SHA256 before anything is written. Mirrors are
  tried in order when the source fails.
- **MOD-9** The write phase waits while the game runs in that installation.
- **MOD-10** After an install, the action bar's gamedir picker offers the mod.
- **MOD-11** Installing over a manual game directory asks first.

### Update and remove

- **MOD-12** When the manifest pins a different version than the installed one, the tile shows
  _Update available_ and the update starts only on the user's click.
- **MOD-13** Removing a catalog mod deletes exactly the files in its install record. Other files
  and a non-empty folder stay.
- **MOD-14** A manual game directory offers no update and no remove.

### GB-D5 and demos

- **MOD-15** The server detail states whether the server's mod exists in the active installation.
- **MOD-16** The server detail states whether the server's map exists locally.
- **MOD-17** If the mod is missing and in the catalog, the server detail offers Install.
- **MOD-18** The demo mod-missing dialog offers Install when the catalog has the mod.

## 14. Open points

1. **Engine architecture source.** `EngineDefinition` has no bitness. Should it come from the
   engines manifest entry the installation was built from, from the executable's PE/ELF header, or
   from a per-engine-per-platform table? Manually added installations have no manifest entry.
2. **Pinned versions.** Does the manifest pin the latest stable release only (AQtion v1.3.8, not
   v1.4.0-rc1)? Which TNG build goes with which AQtion content version?
3. **"Map exists locally" depth.** Is it a loose `maps/<map>.bsp` in the gamedir or `baseq2` only,
   or does it also look inside `.pak` and `.pkz` files?
4. **Tile layout.** Tiles with a detail panel are a new pattern in this app. Is a layout prototype
   (`docs/prototypes/mods/`) needed before the view story?
5. **Cross-module seam.** How do `servers` and `replays` ask `mods` for catalog/installed status
   and start an install? Options: a shared pure helper plus the renderer calling the mods channels
   directly, or a main-side service on `AppContext`.
6. **Which installation the view speaks for.** Is it the globally selected installation, or a
   picker in the Mods view?
7. **Same-name files.** When installing over a manual gamedir or updating, what happens to a file
   the user changed since install (hash differs from the record): overwrite, keep, or ask?
8. **Catalog text language.** Do descriptions live in the manifest as English text, like news, or
   as per-locale fields?
9. **Archive formats.** OpenTDM's Linux build is a `.tar.gz`. Does the vendored 7-Zip extract it
   in one step on both platforms, or in two (gz, then tar)?

## Sources (research, 2026-09-30 / 2026-10-01)

- AQtion distribution and licence: https://github.com/actionquake/distrib
- AQ2-TNG releases: https://github.com/actionquake/aq2-tng/releases
- OpenTDM releases and licence: https://github.com/packetflinger/opentdm
- CTF (yquake2): https://github.com/yquake2/ctf
- Zaero licence (id Limited Program Source License): https://github.com/yquake2/zaero
- Lithium II (GPL since v1.30): https://github.com/mattayres/li2mod
- ModDB link rotation: https://github.com/lutris/lutris/discussions/3872
- Quaddicted idgames2 mirror: https://www.quaddicted.com/files/idgames2/planetquake/
- R1Q2 HTTP-download quirks: https://forums.aq2world.com/viewtopic.php?t=5
- Server population by mod: https://www.quakeservers.net/quake2/servers/
