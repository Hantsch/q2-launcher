---
sprint: S31
status: planned # planned | in-progress | done
branch: # set by /sprint
milestone: 5.1 — Mods v1 (catalog, install, remove, GB-D5)
---

# Sprint S31 — Mods, part 1 — the mod a server needs is one click away

## Goal

The Mods view shows the game directories an installation already has, plus a curated catalog
(Action Quake, OpenTDM, CTF) from the content repository with licence and source. A catalog mod
installs into one installation with the build that fits its engine and platform, or as content
only with a visible reason. It is removed again file by file without touching user files. The
server detail says whether its mod and map exist locally and offers the install, and so does the
demo mod-missing dialog.

## Stories (in build order)

- [ ] 188 — the mods view shows the mods I have
- [ ] 189 — the mod catalog comes from the content repository
- [ ] 190 — I install a mod into an installation
- [ ] 191 — I remove a mod the launcher installed
- [ ] 192 — the server detail says whether I have its mod and map
- [ ] 193 — the mod-missing warning offers the install

## Notes

- Concept: [mods.md](../../concepts/mods.md), from the interview of 2026-09-30/10-01.
- Downloads come only from the original sources. Mirroring is prepared (licence and source in the
  UI, `mirrors[]` read but empty) and deliberately not done.
- Deliberately out of this sprint: mod updates (story 194, milestone 5.2), Jump, mission
  packs/Zaero, singleplayer mods, per-mod config profiles, a Play button on tiles.
- Build order is a dependency chain: 188 creates the module, 189 the catalog, and 190 the install
  record that 191 removes from. 192 and 193 reuse 190's install. 192 and 193 also need one answer
  to the cross-module seam (192 Q2).
- **One question spans three stories:** what happens to a launcher-installed file the user has
  changed (190 Q2, 191 Q1, 194 Q2). Answer it once in the clarification round.
- 188 Q1 decides whether a layout prototype comes first. If yes, it runs before 188 is refined.
- 190 Q1 (engine architecture) is the riskiest technical decision. `EngineDefinition` has no
  bitness today, and manually added installations have no manifest entry.
- 189 AC1 needs network access to hash the real release files. If the sprint environment has
  none, that is a blocker to surface, not to fake.
