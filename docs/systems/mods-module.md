# Mods module

Status: **Implemented** (milestone 5.1). Lists an installation's game directories, offers a
catalog of mods, and installs, updates and removes them as tracked jobs. The long design reference
is [mods.md](../concepts/mods.md).

This document describes the module as built. `mods` is a registered module; its contract is
`src/shared/modules/mods.ts`.

## Purpose

- List an installation's game directories (minus `baseq2`), each tagged `catalog` when the
  launcher installed it or `manual` otherwise, with its version and update status.
- Serve the mod catalog (cached, with its real age) and install one catalog mod into one
  installation, asking the user before touching a folder the launcher did not create.
- Update a catalog mod to its pinned version and remove a launcher-installed mod, deleting only
  the files the launcher recorded.
- Tell the server browser whether an installation has a server's map.

## Map

**Main** (`src/main/modules/mods/`)

- `index.ts` — the module: registers every handler, tracks running installs and their pending
  decisions, pushes the event.
- `catalog-service.ts` / `catalog-parse.ts` / `catalog-schema.ts` — fetch, validate and cache
  the catalog; the wire projection strips variants and packages.
- `engine-target.ts` — picks the variant matching the installation's platform and architecture.
- `install-job.ts` — pre-flight, staging, plan, decision, guarded write with backups, record,
  revalidation.
- `update-job.ts` / `update-plan.ts` / `update-status.ts` — update to the pinned version;
  changed-file policy; whether an update is available.
- `remove-job.ts` / `remove.ts` — removal from the install record alone.
- `install-records.ts` — the one parser of an installation's `mods` record data.
- `map-presence.ts` — looks for a map loose, in a pak or in a pkz.
- `schemas.ts` — payload schemas for every handler.

**Shared** (`src/shared/`, pure)

- `modules/mods.ts` — handler map, event, DTOs and the closed set of error keys.
- `mods/gamedir.ts`, `mods/server-local-content.ts` — game directory and server-supplied name
  checks.

**Renderer** (`src/renderer/src/modules/mods/`)

- `ModsView.tsx`, `client.ts`, `useModUpdate.tsx`, `merge-mod-tiles.ts`, `engine-name.ts`,
  `locale/en.json`.
- `components/` — `ModTile.tsx`, `ModDetailPanel.tsx`, `ModInstallState.tsx`,
  `InstallDecisionDialog.tsx`, `UpdateModDialog.tsx`, `RemoveModDialog.tsx`.

## Persisted state

- The `mods` key of an installation's module data in state.json — one record per installed
  catalog mod: catalog id, game directory, version, variant, engine kind, arch, platform,
  content-only flag, install time and the files written (path, size, sha256). Read
  defensively: a bad envelope is an empty set, a bad row or an unsafe recorded path is dropped.
- catalog-cache.json under the user data cache folder — the last good catalog; fresh for 15
  minutes, served stale when a fetch fails.

## Handlers

`MODS_HANDLERS`:

- `list` — game directories of an installation plus its running installs; no disk scan.
- `reveal` — opens a listed game directory in the file manager; takes a name, never a path.
- `catalogGet` — the catalog, or `unavailable` when nothing is cached and the fetch failed.
- `install` — starts an install job and returns its job id.
- `resolveInstall` — answers a pending overwrite, keep or cancel decision.
- `removalPreview` — names and changed files for the confirm dialog; deletes nothing.
- `remove` — starts removing a mod the launcher installed.
- `mapPresence` — whether `maps/<map>.bsp` exists in the installation.
- `updatePreview` — names, versions and changed files for the confirm dialog; writes nothing.
- `update` — starts updating a catalog mod; refused when no install record exists.

Events: `MODS_EVENTS` pushes `installDecision` when an install meets a folder it did not create.

## External inputs

- Network: HTTPS GET of the catalog (mods/manifest.json of the content repo) and download of
  the packages a variant names, through the shared download pipeline.
- Files: the installation's game directories (read, and written only inside the write guard),
  state.json and the catalog cache.
- Game servers supply map and game directory names; they are re-checked and never joined onto a
  path.
- Engine processes: none.

## Limitations

- Only catalog mods are tracked; a manual game directory can be listed and revealed, not
  updated or removed.
- A variant must match the engine's platform and architecture; otherwise the install is refused.
- An r1q2-family engine cannot read a `.pkz`; such an install is flagged, not blocked.
- Removal deletes only recorded files; files a mod wrote after install are left alone.
- `.pk3` archives are not searched for maps.
