# Replays module

Status: **Implemented.** The demo browser: finds Quake II demos on disk, indexes and describes
them, and plays them in the engine with a launcher-controlled stage and timeline. The long design
reference is [demo-browser.md](../concepts/demo-browser.md).

This document describes the module as built. `replays` is a registered module; its contract is
`src/shared/modules/replays.ts`.

## Purpose

- Discover demos (also inside zip archives) across installations and user-added folders, and
  index their header facts in a disposable cache.
- Let the user sort, filter, rename and annotate demos (tags, rating, favourite, sides) in a
  sidecar file next to the demo.
- Play a demo in Q2PRO and steer it (pause, seek, speed, console line, stop), either on the
  launcher's stage or in cinema mode.

## Map

**Main** (`src/main/modules/replays/`)

- `index.ts` — the module: registers every handler and pushes the events.
- `discovery.ts` / `zip-demos.ts` / `extra-folders.ts` — where demos are found.
- `scan-service.ts` / `incremental-scan.ts` / `index-cache.ts` / `demo-rows.ts` — the background
  scan and the replays-index.json cache under userData.
- `sidecar-store.ts` / `sidecar-read.ts` — the demo's JSON sidecar, atomic writes.
- `name-templates.ts` / `demo-rename.ts` / `file-actions.ts` — rename templates, rename, reveal
  and copy path.
- `demo-play.ts` / `demo-staging.ts` — eligibility, launch and the temporary copy under
  `<gamedir>/demos/_launcher/`.
- `playback-sessions.ts` / `playback-control.ts` / `playback-timeline.ts` /
  `playback-console.ts` / `playback-stop.ts` / `session-cvar-restore.ts` — the live session.
- `playback-channel/windows-channel.ts`, `playback-channel/linux-channel.ts`,
  `playback-channel/protocol.ts` — how the launcher talks to the running engine.
- `stage.ts` / `stage-follow.ts` / `stage-follow-session.ts` / `geometry.ts` /
  `x11/stage-window.ts` — placing the game window over the stage; `cinema.ts` /
  `cinema-controller.ts` — cinema mode.
- `persisted.ts` — the forgiving parse of the module's state section.

**Shared** (`src/shared/`, pure)

- `modules/replays.ts` — handler map, events, schemas and the typed `ReplaysContract`.
- `replays/` — `sidecar.ts`, `list-sort.ts`, `list-filter.ts`, `name-template.ts`,
  `name-templates.ts`, `demo-rename.ts`, `demo-play.ts`, `demo-control.ts`, `timeline.ts`,
  `console-line.ts`, `cinema.ts`; `demos/` — header, frame and readability readers.

**Renderer** (`src/renderer/src/modules/replays/`)

- `ReplaysView.tsx`, `components/VirtualDemoList.tsx`, `components/DemoRow.tsx`,
  `DemoListFilterBar.tsx`, `ReplaysListStatus.tsx` — the list.
- `components/DemoDetailPanel.tsx`, `components/InPlaceField.tsx`, `components/TagInput.tsx`,
  `components/SidesField.tsx`, `components/SidesEditor.tsx`, `RenameDemoDialog.tsx` — the detail is one view, edited in place:
  every text fact is an `InPlaceField` and saves per field (Enter or leaving it; Escape reverts)
  through the editor store's single `edit` write path; the roster opens `SidesEditor` on click and saves when focus leaves it (Escape reverts); an archive entry shows it read-only.
- `components/DemoPlayersPanel.tsx` — the detail's players panel: players grouped by side, POV marked, spectators in a closed disclosure.
- `components/DemoStage.tsx`, `components/DemoTimeline.tsx`, `cinema/CinemaOverlay.tsx`,
  `playback-store.ts`, `useDemoPlay.ts` — playback.
- `ReplaysSettingsSection.tsx`, `NameTemplatesList.tsx`, `client.ts`, `locale/en.json`.

**Parser and index facts**

- Each index row carries `roster`: `{ teams: { name, players }[], spectators }`, or `null` when
  unknown. It is collected by `shared/demos/dm2-roster.ts` in the one existing frame-count pass
  (`readDemoFullPass` for a loose file, `zip-demos.ts` for an archive entry), never a second read.
- OpenTDM: a player's team comes from the slot string `name (team)` while it still names the slot's
  current player; the last scoreboard layout's `Spectators` section overrides it.
- CTF: when no slot string assigns a team, the `ctf_r` / `ctf_b` skins give Red and Blue.
- A change to the cached row shape bumps `REPLAYS_INDEX_CACHE_VERSION` (now 3): old caches are
  discarded and re-read.

## Persisted state

`persisted.ts` stores the `replays` slot of state.json; every part is parsed forgivingly.

- `nameTemplates` — stored entries (shipped overrides and user templates) and removed shipped ids.
- `extraFolders` — user-added demo folders, unique by normalised path.
- `listSort` — the chosen sort, `null` for the default favourites-first order.
- `listFilter` — the demo list filter; the empty filter means none applied.
- `modWarning` — whether the missing-mod warning is asked and the lower-cased game dirs trusted.

Elsewhere on disk: the index cache replays-index.json (regenerable) and one sidecar per demo.

## Handlers

`REPLAYS_HANDLERS`:

- `overviewRead` — the overview, cache-first.
- `nameTemplatesList` — the current template view.
- `nameTemplatesAdd` — appends a user template.
- `nameTemplatesUpdate` — edits a user template or a shipped override.
- `nameTemplatesRemove` — removes a template (shipped ones are tombstoned).
- `nameTemplatesReorder` — applies the full ordered id list.
- `nameTemplatesReset` — clears a shipped override.
- `nameTemplatesRestore` — clears every tombstone.
- `extraFoldersList` — the extra demo folders.
- `extraFoldersAdd` — adds a folder; refuses invalid or duplicate paths.
- `extraFoldersRemove` — removes a folder by id.
- `scanStart` — starts a background scan.
- `indexRead` — the cached or last scanned index rows.
- `foldersRead` — every folder of every demo source, empty and zip ones included.
- `sidecarRead` — a demo's sidecar by id, or none.
- `sidecarWrite` — full-replacement save of a sidecar.
- `listGetSort` — the persisted sort or `null`.
- `listSetSort` — persists a sort, or clears it.
- `listGetFilter` — the persisted filter.
- `listSetFilter` — persists a filter.
- `modWarningRead` — the missing-mod warning state.
- `modWarningSetEnabled` — turns the warning on or off.
- `modWarningTrustMod` — trusts a game dir.
- `modWarningResetTrusted` — clears trusted dirs.
- `demosReveal` — reveals the demo file in the file manager.
- `demosCopyPath` — copies the resolved path.
- `demoRename` — renames a demo and its sidecar.
- `demoMove` — moves a loose demo and its sidecar into another folder of a demo source; the target is a folder ref resolved against the last scan, its real path must lie inside the source root's; refuses archive entries, archive folders, a playing demo, a running scan and a name clash.
- `folderCreate` — creates a folder inside a folder of a demo source (non-recursive `mkdir`) and adds it to the folder list without a rescan; returns the new folder ref. Refuses an invalid or existing name, archive folders, a folder whose real path leaves the source root and a running scan.
- `folderRename` — renames a folder of a demo source in one directory rename (demos and sidecars move with it), then re-keys every row, id and folder below it in place, without re-parsing; returns the `{ from, to }` id pairs. Refuses a source root, an invalid or clashing name (a case-only rename is allowed), archive folders, a folder outside the source root, a playing demo below it and a running scan. Folder refs resolve against each root's directory, which discovery records main-side and the index cache persists.
- `demoPlay` — plays a demo in Q2PRO.
- `playbackTimeline` — pause, jump, seek or speed on the running demo.
- `playbackConsoleSend` — sends one validated console line.
- `playbackStage` — re-places the game window over the stage rect.
- `playbackStop` — ends the running demo (quit, then terminate on timeout).
- `playbackCinema` — enters or leaves cinema mode.
- `playbackDisplayRead` — the current playback display state.

Events: `REPLAYS_EVENTS` pushes `scanProgress`, `playbackPosition` (every 250 ms), `playbackState`
and `playbackDisplay`.

## External inputs

- Files: demo files (optionally gz) in installation game dirs, the Linux Q2PRO write dir and extra
  folders, found at any depth below each `demos` folder; zip archives read through a bounded reader,
  never recursed; demo sidecars; replays-index.json; state.json.
- Folder walk: a directory whose real path was already visited is never entered (loops end; a nested
  root is walked as its own root); the launcher's `_launcher` staging folder is skipped.
- Engine processes: Q2PRO started with `+demo`. Windows: commands via `q2l_ctl.cfg` in the game
  dir and answers tailed from a dedicated logfile. Linux: console over the game's stdin/stdout.
- Window system: window placement on Windows; X11 (via the X-Resource PID) for the stage on Linux.
- Network: none.

## Limitations

- Playback needs Q2PRO; other clients are not eligible.
- A demo outside the Quake filesystem is played from a temporary copy; a `.gz` is not
  decompressed by the launcher.
- Stage placement depends on the platform's window system.
- Nested archives are not expanded.
- An `.mvd2` demo has no roster.
- An OpenTDM 1v1 demo cut off before the match ends has no teams.
