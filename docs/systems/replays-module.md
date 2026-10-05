# Replays module

Status: **Implemented.** The demo browser: finds Quake II demos on disk, indexes and describes
them, and plays them in the engine with a launcher-controlled stage and timeline. The long design
reference is [demo-browser.md](../concepts/demo-browser.md).

`replays` is a registered module; its contract is `src/shared/modules/replays.ts`.

## Purpose

- Discover demos (also inside zip archives) across installations and user-added folders, and
  index their header facts in a disposable cache.
- Let the user sort, filter, rename and annotate demos (tags, rating, favourite, sides) in a
  sidecar file next to the demo.
- Play a demo in Q2PRO and steer it, on the launcher's stage or in cinema mode.

### Scope

The scan is global; the list is scoped in the view. `scopeDemoRows` (`src/shared/replays/list-scope.ts`)
keeps a row when it comes from an extra folder or when `reachedBy` (absent = its own installation)
holds the rail's installation, so a folder shared by two installations lists in both. An
"All installations" toggle (view state, off by default) lifts the scope. Filter options, tag
suggestions and counts follow the scoped rows; the filter value survives an installation switch.

An empty list says why (`deriveReplaysListState`): no installation registered, none selected, or the
selected one has no demos - that line names the folders it looks in (`demoFolders.read`) as plain
text, not a warning. The source-error strip shows only in-scope sources (`scopeSourceErrors`)
unless the toggle is on.

## Map

**Main** (`src/main/modules/replays/`)

- `index.ts` — the module: registers every handler and pushes the events.
- `discovery.ts` / `zip-demos.ts` / `extra-folders.ts` — where demos are found.
- `scan-service.ts` / `incremental-scan.ts` / `index-cache.ts` / `demo-rows.ts` — the background
  scan and the replays-index.json cache under userData.
- `sidecar-store.ts` / `sidecar-read.ts` — the demo's JSON sidecar, atomic writes.
- `name-templates.ts` / `demo-rename.ts` / `file-actions.ts` — rename templates, rename, reveal
  and copy path; `demo-play.ts` / `demo-staging.ts` — eligibility, launch and the temporary copy
  under `<gamedir>/demos/_launcher/`.
- `playback-sessions.ts` / `playback-control.ts` / `playback-timeline.ts` /
  `playback-console.ts` / `playback-stop.ts` / `session-cvar-restore.ts` — the live session.
- `playback-channel/windows-channel.ts`, `playback-channel/linux-channel.ts`,
  `playback-channel/protocol.ts` — how the launcher talks to the running engine.
- `stage.ts` / `stage-follow.ts` / `stage-follow-session.ts` / `geometry.ts` /
  `x11/stage-window.ts` — placing the game window over the stage; `cinema.ts` /
  `cinema-controller.ts` — cinema mode; `persisted.ts` — the forgiving state parse.

**Shared** (`src/shared/`, pure)

- `modules/replays.ts` — handler map, events, schemas and the typed `ReplaysContract`.
- `replays/` — `sidecar.ts`, `list-sort.ts`, `list-filter.ts`, `name-template.ts`,
  `name-templates.ts`, `demo-rename.ts`, `demo-play.ts`, `demo-control.ts`, `timeline.ts`,
  `console-line.ts`, `cinema.ts`; `demos/` — header, frame and readability readers.

**Renderer** (`src/renderer/src/modules/replays/`)

- `ReplaysView.tsx`, `components/VirtualDemoList.tsx`, `components/DemoRow.tsx`,
  `DemoListFilterBar.tsx`, `ReplaysListStatus.tsx` — the list.
- `components/DemoDetailPanel.tsx`, `components/InPlaceField.tsx`, `components/TagInput.tsx`,
  `components/SidesField.tsx`, `components/SidesEditor.tsx`, `RenameDemoDialog.tsx` — the detail is
  one view, edited in place: every text fact is an `InPlaceField` saving per field (Enter or leaving
  it; Escape reverts) through the editor store's single `edit` write path; the roster opens
  `SidesEditor` and saves when focus leaves it; an archive entry is read-only.
- `components/DemoPlayersPanel.tsx` — players grouped by side, POV marked, spectators closed.
- `components/DemoStage.tsx`, `components/DemoTimeline.tsx`, `cinema/CinemaOverlay.tsx`,
  `playback-store.ts`, `useDemoPlay.ts` — playback.
- `ReplaysSettingsSection.tsx`, `NameTemplatesList.tsx`, `client.ts`, `locale/en.json`.

**Parser and index facts**

- Each index row carries `roster`: `{ teams: { name, players }[], spectators }`, or `null` when
  unknown. It is collected by `shared/demos/dm2-roster.ts` in the one existing frame-count pass
  (`readDemoFullPass` for a loose file, `zip-demos.ts` for an archive entry), never a second read.
- Teams: OpenTDM takes a player's team from the slot string `name (team)` while it still names the
  slot's current player (the last scoreboard's `Spectators` section overrides); CTF falls back to
  the `ctf_r` / `ctf_b` skins.
- A change to the cached row shape bumps `REPLAYS_INDEX_CACHE_VERSION` (in `index-cache.ts`): old caches are
  discarded and re-read.

## Persisted state

`persisted.ts` stores the `replays` slot of state.json; every part is parsed forgivingly.

- `nameTemplates` — stored entries (shipped overrides and user templates) and removed shipped ids;
  `extraFolders` — user-added demo folders, unique by normalised path.
- `listSort` — the chosen sort, `null` for the default favourites-first order; `listFilter` — the
  list filter, empty meaning none.
- `modWarning` — whether the missing-mod warning is asked and the lower-cased game dirs trusted.

Elsewhere on disk: the index cache replays-index.json (regenerable) and one sidecar per demo.

## Handlers

`REPLAYS_HANDLERS`:

- `overviewRead` — the overview, cache-first; `indexRead` — the cached or last scanned rows.
- `nameTemplatesList`, `nameTemplatesAdd`, `nameTemplatesUpdate`, `nameTemplatesRemove`,
  `nameTemplatesReorder`, `nameTemplatesReset`, `nameTemplatesRestore` — list, append, edit, remove
  (shipped ones tombstoned), reorder by the full id list, clear an override, clear every tombstone.
- `extraFoldersList` / `extraFoldersAdd` / `extraFoldersRemove` — the extra folders; add refuses
  invalid or duplicate paths.
- `scanStart` — starts a background scan; `foldersRead` — every folder of every demo source, empty and zip ones included.
- `sidecarRead` / `sidecarWrite` — a demo's sidecar by id (or none); full-replacement save.
- `listGetSort` / `listSetSort` / `listGetFilter` / `listSetFilter` — the persisted sort (or `null`)
  and filter.
- `modWarningRead`, `modWarningSetEnabled`, `modWarningTrustMod`, `modWarningResetTrusted` — read,
  switch, trust a game dir, clear the trusted dirs.
- `demosReveal` / `demosCopyPath` / `demoRename` — reveal the file, copy its resolved path, rename a
  demo and its sidecar.
- `demoMove` — moves a loose demo and its sidecar into another folder of a source; the target ref
  resolves against the last scan and its real path must lie inside the root. Refuses archive
  entries and folders, a playing demo, a running scan and a name clash.
- `folderCreate` — creates a folder inside a source folder (non-recursive `mkdir`), listed without a
  rescan; returns the folder ref. Refuses an invalid or existing name, archive folders, a folder
  whose real path leaves the source root and a running scan.
- `folderRename` — renames a source folder in one directory rename, then re-keys every row, id and
  folder below it without re-parsing; returns the `{ from, to }` id pairs. Refuses a source root, an
  invalid or clashing name (case-only is allowed), archive folders, a folder outside the root, a
  playing demo below it and a running scan. Refs resolve against each root's directory, recorded by
  discovery and persisted by the index cache.
- `demoFoldersRead` — an installation's absolute `demos` folders (game dirs, plus the Linux Q2PRO
  write dir's), display only; `demoPlay` — plays a demo in Q2PRO.
- `playbackTimeline` / `playbackConsoleSend` / `playbackStage` / `playbackStop` / `playbackCinema` /
  `playbackDisplayRead` — pause, jump, seek or speed the running demo, send one validated console
  line, re-place the window over the stage, end it (quit, then terminate), enter or leave cinema
  mode, read the display state.

Events: `scanProgress`, `playbackPosition` (every 250 ms), `playbackState`, `playbackDisplay`.

## External inputs

- Files: demo files (optionally gz) in installation game dirs, the Linux Q2PRO write dir and extra
  folders, at any depth below each `demos` folder; zip archives via a bounded reader, never
  recursed; sidecars; replays-index.json; state.json.
- Folder walk: a directory whose real path was already visited is never entered; the `_launcher`
  staging folder is skipped.
- Engine processes: Q2PRO started with `+demo`. Windows: commands via `q2l_ctl.cfg` in the game
  dir and answers tailed from a dedicated logfile. Linux: console over the game's stdin/stdout.
- Window system: window placement on Windows; X11 (X-Resource PID) for the stage on Linux. Network: none.

## Limitations

- Playback needs Q2PRO; other clients are not eligible.
- A demo outside the Quake filesystem is played from a temporary copy; a `.gz` is not
  decompressed by the launcher.
- Stage placement depends on the platform's window system; nested archives are not expanded.
- An `.mvd2` demo has no roster.
- An OpenTDM 1v1 demo cut off before the match ends has no teams.
