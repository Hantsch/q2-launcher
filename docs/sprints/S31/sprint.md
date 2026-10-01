---
sprint: S31
status: in-progress # planned | in-progress | done
branch: sprint/S31
milestone: 5.1 — Mods v1 (catalog, install, remove, GB-D5)
---

# Sprint S31 — Mods, part 1 — the mod a server needs is one click away (plus three browser stories)

## Goal

The Mods view shows the game directories an installation already has, plus a curated catalog
(Action Quake, OpenTDM, CTF) from the content repository with licence and source. A catalog mod
installs into one installation with the build that fits its engine and platform, or as content
only with a visible reason. It is removed again file by file without touching user files. The
server detail says whether its mod and map exist locally and offers the install, and so does the
demo mod-missing dialog. A newer catalog version is offered and updated on one click. The server
browser gains an exact (quoted) search, an Online/LAN switch and saved quick filters.

## Stories (in build order)

- [x] 188 — the mods view shows the mods I have
- [x] 189 — the mod catalog comes from the content repository
- [x] 190 — I install a mod into an installation
- [x] 191 — I remove a mod the launcher installed
- [x] 192 — the server detail says whether I have its mod and map
- [x] 193 — the mod-missing warning offers the install
- [ ] 194 — a newer mod version is offered
- [ ] 195 — a quoted search matches exactly
- [ ] 196 — I switch the browser between online and LAN
- [ ] 197 — I save my filter as a quick filter

## Notes

- Concept: [mods.md](../../concepts/mods.md), from the interview of 2026-09-30/10-01.
- Downloads come only from the original sources. Mirroring is prepared (licence and source in the
  UI, `mirrors[]` read but empty) and deliberately not done.
- Deliberately out of this sprint: Jump, mission packs/Zaero, singleplayer mods, per-mod config
  profiles, a Play button on tiles, and the X11 stage story (198, see below).
- 194 (mod updates) was pulled in from milestone 5.2 at the user's request. It builds on 190's
  install record and 191's removal, so it stays after them.
- 195–197 are server-browser stories, independent of the mods chain. They come last so a problem
  there cannot block the mods stories. 197 follows 196 (Q5: quick filters apply in both modes) and
  195 (Q1: a quoted search is not part of a saved filter, unless refine decides otherwise).
- **Not in this sprint: 198 — the staged game stays on top on X11.** It was numbered 188 like the
  mods-view story and is renumbered to 198. It cannot be verified here: its AC1–AC4 need a real
  X11 window manager and Q2PRO window (Q5), and this sprint runs on Windows. Plan it when an X11
  test setup exists.
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
