---
id: 189
title: the mod catalog comes from the content repository
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I see the mods the launcher can install (Action Quake, OpenTDM, CTF) as tiles next
to the ones I already have. Each tile has a short description, and its detail panel shows the
licence and where the mod comes from. The catalog lives in `Hantsch/q2_community_content` as
`mods/manifest.json`, curated like the engines and game data. A dead link costs a commit there,
not a launcher release.

The manifest is shaped for mirroring later but does not mirror now. Every package's `url` is the
original source (GitHub releases, or the id 3.20 point release already in
`gamedata/manifest.json` for CTF), and `mirrors[]` exists and is read but stays empty for mods.
Each entry carries its gamedir, version, licence (SPDX), project page, source link and its
variants per *(platform, engine architecture)*.

Concept: [mods.md](../concepts/mods.md) §6–§8; requirements MOD-3, MOD-4.

## Acceptance Criteria

- [ ] **AC1** — `content/q2_community_content/mods/manifest.json` exists with entries for `action`,
      `opentdm` and `ctf`. Every package has a real size and SHA256 that match the file at its
      `url`.
- [ ] **AC2** — Every catalog entry appears as a tile in the Mods view, with its display name and
      short description.
- [ ] **AC3** — A catalog entry whose gamedir already exists in the installation shows on one tile,
      not as a catalog tile plus a manual tile.
- [ ] **AC4** — The detail panel of a catalog entry shows its licence and links to its project
      page and its source.
- [ ] **AC5** — A manifest row that fails validation is dropped with a logged warning, and the
      other entries still appear. A manifest whose envelope fails validation shows no catalog
      tiles and a visible "catalog unavailable" note, and the local mods still show.
- [ ] **AC6** — Offline, the last good catalog copy is shown with an "as of <date>" note.
- [ ] **AC7** — Nothing from the manifest reaches the renderer unvalidated, and a gamedir name that
      is not a safe single path token (the `launch-plan.ts` rule) is refused at parse time.

## Open Questions

- **Q1** (concept §14 item 2) — Does the manifest pin the latest *stable* release only (AQtion
  v1.3.8, not the v1.4.0-rc1 pre-release)? Which AQ2-TNG build goes with that AQtion content?
- **Q2** (concept §14 item 8) — Are the catalog name and description English text in the manifest
  (foreign content, like news entries), or per-locale fields?
- **Q3** — Is CTF's variant a reference to the existing `q2-320-x86-full-ctf` gamedata package,
  reusing its cached archive and taking only its `ctf/` payload, or does it get its own package
  row with the same URL and hash?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
