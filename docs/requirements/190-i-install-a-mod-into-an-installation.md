---
id: 190
title: I install a mod into an installation
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I click **Install** on a catalog tile and the mod lands in my installation, with the
game library that fits my engine and platform. When no such build exists, the launcher still
installs what it can, so joining a server works. It then tells me plainly that the mod is not
playable locally with this engine. Example: OpenTDM ships only a 32-bit Windows DLL, and the
bundled Q2PRO is 64-bit.

The install is a job in the existing pipeline: progress, mirrors in order, size and SHA256
verification, archive cache, 7-Zip extraction. Its write phase runs inside the write guard, so it
waits while the game runs. The launcher keeps an install record of the files it wrote
(`Installation.moduleData['mods']`). Stories 191 (remove) and 194 (update) work from that record.

Concept: [mods.md](../concepts/mods.md) §6, §10; requirements MOD-5 to MOD-11.

## Acceptance Criteria

- [ ] **AC1** — Clicking Install on a catalog tile starts a job that shows progress in the
      Downloads surface and on the tile.
- [ ] **AC2** — When the job finishes, the mod's files are in `<installation root>/<gamedir>/`
      and the tile shows *installed*.
- [ ] **AC3** — With a matching variant, the installed game library is the one for the
      installation's platform and engine architecture (for example, r1q2 on Windows gets the
      32-bit `gamex86.dll`).
- [ ] **AC4** — Without a matching game library, the content is installed, and the tile and
      detail panel show the visible text "Not playable locally with <engine>: no matching build".
- [ ] **AC5** — A package whose size or SHA256 does not match is never extracted or written. The
      job fails with a visible reason, and the installation is unchanged.
- [ ] **AC6** — When the source URL fails, the package's mirrors are tried in order.
- [ ] **AC7** — While the game runs in that installation, the job waits before writing and says
      so. It writes once the game has exited.
- [ ] **AC8** — After the install, the action bar's gamedir picker offers the mod.
- [ ] **AC9** — The installation's state contains an install record listing every file the job
      wrote, with its size and hash, plus the catalog id, version and variant.
- [ ] **AC10** — Installing a catalog mod whose gamedir already exists as *installed manually*
      first shows a confirmation naming the folder. Cancelling writes nothing.

## Open Questions

- **Q1** (concept §14 item 1) — Where does the engine architecture come from: the engines-manifest
  entry the installation was built from, the executable's PE/ELF header, or a per-engine,
  per-platform table? Manually added installations have no manifest entry.
- **Q2** (concept §14 item 7) — When installing over a manual gamedir, what happens to an existing
  file with the same name: overwrite, keep, or ask?
- **Q3** (concept §14 item 9) — OpenTDM's Linux build is a `.tar.gz`. Does the vendored 7-Zip
  extract it in one step, or in two (gz, then tar), on both platforms?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
