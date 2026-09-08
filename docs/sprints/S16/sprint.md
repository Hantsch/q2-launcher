---
sprint: S16
status: in-progress # planned | in-progress | done
branch: sprint/S16
milestone: Install — bootstrap, update and repair
---

# Sprint S16 — From nothing to a playable Q2PRO demo installation

## Goal

A user with no Quake II installed opens a wizard from the Library, picks Q2PRO, and gets a
working, playable demo installation — engine and free game data downloaded from a curated
manifest, verified, extracted, and assembled automatically. This is the first slice of the
[Install concept](../../concepts/install-module.md): it stands up the manifest, the
verified-download job pipeline, a module-contributed Settings section, and the Downloads tab,
then wires all of it into one guided flow.

## Scope decisions taken at the cut

- **Engine: Q2PRO only.** It has a live, reachable source (`github.com/q2pro/q2pro` nightly);
  r1q2 does not (no official distribution survives), and which prebuilt binary to redistribute
  is a real product decision left for a later sprint once it's been made deliberately rather
  than as a side effect of cutting this one.
- **Data source: free download only.** Store-copy (Steam/GOG/Epic retail import), pointing at an
  existing folder, and the demo-to-retail upgrade action are real concept scope, deferred to the
  milestone's next sprint.
- **Resume: in-session only.** Pause/cancel works; HTTP-range resume surviving an app restart is
  real concept scope (INST-J3/J4), deferred — see [[071]]'s Open Questions.

## Deliberately not in this sprint (concept scope, later sprints of this milestone)

- r1q2 engine support.
- Store-copy and own-folder data sources; retail import; demo→retail upgrade.
- Cross-restart resumable downloads.
- Engine update, rollback, and bleeding-edge mode.
- Repair (the `install-game-files` `ValidationFix`).
- Removal from disk.
- ctf/xatrix/rogue directories.
- Disk-space precheck before a job starts.

## Stories (in build order)

- [x] 070 — The launcher reads a curated manifest instead of hardcoded download URLs
- [x] 071 — A download is a verified job, never a trusted file
- [x] 072 — Settings learn to host a module's own section, starting with Downloads
- [ ] 073 — The Downloads tab shows what is running, what failed, and what is cached
- [ ] 074 — The Library turns nothing into a playable Q2PRO demo installation
- [ ] 032 — Downloads icon shows a running-count badge

## Notes

Derived from [concepts/install-module.md](../../concepts/install-module.md) (drafted
2026-09-08, 20 open points). This sprint deliberately resolves only the two blocking scope
questions (engine, sprint depth) needed to cut it; the remaining open points are carried as
per-story Open Questions for `/sprint`'s clarification round.
