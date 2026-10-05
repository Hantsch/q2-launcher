# Replays module

Status: **Implemented.** The demo browser: finds Quake II demos on disk, indexes and describes them,
and plays them in the engine with a launcher-controlled stage and timeline. Design reference:
[demo-browser.md](../concepts/demo-browser.md). Contract: `src/shared/modules/replays.ts`.

## Purpose

- Discover demos (also in zip archives) across installations and user-added folders; index header
  facts in a disposable cache.
- Let the user sort, filter, rename and annotate demos (tags, rating, favourite, sides) in a
  sidecar next to the demo; it also carries time-anchored comments (`comments`: demo time in ms
  plus text, at most 200 of 500 characters, sorted by time).
- Play a demo in Q2PRO and steer it, on the launcher's stage or in cinema mode.

### Scope

The scan is global; the list is scoped in the view. `scopeDemoRows` (`src/shared/replays/list-scope.ts`)
keeps a row from an extra folder or when `reachedBy` (absent = its own installation) holds the rail's
installation, so a folder shared by two installations lists in both. An "All installations" toggle
(view state, off by default) lifts the scope. Filter options, tag suggestions and counts follow the
scoped rows; the filter value survives an installation switch. An empty list says why
(`deriveReplaysListState`): no installation registered or selected, or the selected one has no demos
(naming its folders, `demoFolders.read`). The source-error strip shows only in-scope sources
(`scopeSourceErrors`) unless the toggle is on.

## Map

**Main** (`src/main/modules/replays/`)

- `index.ts` — the module: registers every handler and pushes the events.
- `discovery.ts` / `zip-demos.ts` / `extra-folders.ts` — where demos are found.
- `scan-service.ts` / `incremental-scan.ts` / `index-cache.ts` / `demo-rows.ts` — the background
  scan and the replays-index.json cache under userData.
- `sidecar-store.ts` / `sidecar-read.ts` — the demo's JSON sidecar, atomic writes.
- `name-templates.ts` / `demo-rename.ts` / `file-actions.ts` — rename templates, rename, reveal and
  copy path; `demo-play.ts` / `demo-staging.ts` — eligibility, launch, temp copy in `<gamedir>/demos/_launcher/`.
- `playback-sessions.ts` / `playback-control.ts` / `playback-timeline.ts` / `playback-console.ts` /
  `playback-stop.ts` / `session-cvar-restore.ts` — the live session; `playback-channel/` — the
  link to the running engine.
- `stage.ts` / `stage-follow.ts` / `stage-follow-session.ts` / `geometry.ts` / `x11/stage-window.ts`
  — placing the game window over the stage; `cinema.ts` / `cinema-controller.ts` — cinema mode;
  `persisted.ts` — the forgiving state parse.

**Shared** (`src/shared/`, pure)

- `modules/replays.ts` — handler map, events, schemas and the typed `ReplaysContract`.
- `replays/` — `sidecar.ts`, `list-sort.ts`, `list-filter.ts`, `name-template.ts`,
  `name-templates.ts`, `demo-comments.ts`, `demo-rename.ts`, `demo-play.ts`, `demo-control.ts`,
  `timeline.ts`, `console-line.ts`, `cinema.ts`; `demos/` — header, frame and readability readers.

**Renderer** (`src/renderer/src/modules/replays/`)

- `ReplaysView.tsx`, `components/VirtualDemoList.tsx`, `components/DemoRow.tsx`,
  `DemoListFilterBar.tsx`, `ReplaysListStatus.tsx` — the list.
- `components/DemoDetailPanel.tsx`, `components/InPlaceField.tsx`, `components/TagInput.tsx`,
  `components/SidesField.tsx`, `components/SidesEditor.tsx`, `RenameDemoDialog.tsx` — the detail is
  one view, edited in place: every text fact is an `InPlaceField` saving per field (Enter or leaving
  it; Escape reverts) through the editor store's single `edit` write path; the roster opens
  `SidesEditor`, saved when focus leaves it; an archive entry is read-only.
- `components/DemoCommentsList.tsx` — the detail's time-sorted comment list (edit in place, delete;
  read-only for an archive entry). Changes go through the editor store's `commentEdit`, which applies
  the op to the freshly read sidecar in the per-demo write queue (the timeline reuses it).
- `components/TimelineComments.tsx` — the strip's comment marks and Add-comment field. Marks sit in a
  layer beside the `role="slider"` element (a mark's click is not also a bar seek) and seek to
  `floor(atMs / 1000)`. Add comment pins the shown position, then pauses; field and hover bubble stay
  inside the strip (the native game window covers the stage above it). No comment controls in
  fullscreen or the cinema overlay. "Play from here" seeks a session on that demo, else plays it.
- Start position: `beginSession(..., { id, archived, startAtS })` keeps `pendingSeekS`; the first
  position sample sends one `seekTo` and clears it (the engine takes no commands earlier).
- `components/DemoPlayersPanel.tsx` — players by side; `components/DemoStage.tsx`,
  `components/DemoTimeline.tsx` (takes the session's `demo` and `onRowPatched` for comments),
  `cinema/CinemaOverlay.tsx`, `playback-store.ts`, `useDemoPlay.ts` — playback.
- `ReplaysSettingsSection.tsx`, `NameTemplatesList.tsx`, `client.ts`, `locale/en.json`.

**Parser and index facts**

- Each index row carries `roster`: `{ teams: { name, players }[], spectators }`, or `null` when
  unknown, collected by `shared/demos/dm2-roster.ts` in the one existing frame-count pass
  (`readDemoFullPass` for a loose file, `zip-demos.ts` for an archive entry), never a second read.
- Teams: OpenTDM takes a team from the slot string `name (team)` while it names the slot's current
  player (the last scoreboard's `Spectators` section overrides); CTF uses `ctf_r` / `ctf_b` skins.
- A change to the cached row shape bumps `REPLAYS_INDEX_CACHE_VERSION` (`index-cache.ts`).

## Persisted state

`persisted.ts` stores the `replays` slot of state.json, every part parsed forgivingly. Elsewhere: the index
cache replays-index.json (regenerable), one sidecar per demo.

- `nameTemplates` — stored entries (shipped overrides, user templates) and removed shipped ids;
  `extraFolders` — user-added demo folders, unique by normalised path.
- `listSort` — the chosen sort (`null` = favourites-first); `listFilter` — empty meaning none.
- `modWarning` — whether the missing-mod warning is asked and the lower-cased game dirs trusted.

## Handlers

`REPLAYS_HANDLERS`:

- `overviewRead` — the overview, cache-first; `indexRead` — the cached or last scanned rows.
- `nameTemplatesList`, `nameTemplatesAdd`, `nameTemplatesUpdate`, `nameTemplatesRemove`,
  `nameTemplatesReorder`, `nameTemplatesReset`, `nameTemplatesRestore` — list, append, edit, remove
  (shipped ones tombstoned), reorder by id list, clear an override, clear every tombstone.
- `extraFoldersList` / `extraFoldersAdd` / `extraFoldersRemove` — the extra folders; add refuses invalid or duplicate paths.
- `scanStart` — starts a background scan; `foldersRead` — every folder of every demo source, empty and
  zip ones included; `sidecarRead` / `sidecarWrite` — a demo's sidecar by id (or none), full-replace save.
- `listGetSort` / `listSetSort` / `listGetFilter` / `listSetFilter` — the persisted sort and filter.
- `modWarningRead`, `modWarningSetEnabled`, `modWarningTrustMod`, `modWarningResetTrusted` — read, switch,
  trust a game dir, clear them.
- `demosReveal` / `demosCopyPath` / `demoRename` — reveal, copy the resolved path, rename demo+sidecar.
- `demoMove` — moves a loose demo and its sidecar into another folder of a source (target real path
  inside the root). Refuses archive entries and folders, a playing demo, a running scan, a clash.
- `folderCreate` — creates a folder in a source folder, listed without a rescan; returns the ref.
  Refuses an invalid or existing name, archive folders, an outside folder, a running scan.
- `folderRename` — renames a source folder in one directory rename, re-keys every row below it
  without re-parsing; returns the `{ from, to }` id pairs. Refuses a source root, an invalid or
  clashing name (case-only is allowed), archive folders, an outside folder, a playing demo below it
  and a running scan. Refs resolve against each root's recorded directory.
- `demosDelete` / `demosMove` / `demosTag` / `demoFolderDelete` — bulk file actions
  (`demo-file-ops.ts`, `demo-bulk-tags.ts`, `demo-folder-delete.ts`), id- or ref-addressed, never a
  path; one outcome per demo (done, failed or skipped, with an i18n reason). Delete goes to the OS
  trash only, never retried as a permanent removal; `demoFolderDelete` never deletes a source root.
  Move never replaces a file in the target and puts the demo back when its sidecar cannot follow;
  the target is a tree folder (inside a scanned root) or `{ kind: 'pick' }` (a folder dialog, any
  directory, `{ cancelled: true }` on dismiss) - a demo moved outside every root leaves the index.
  Tag never overwrites a sidecar that does not parse. Skipped: archive entries, a playing demo, a
  demo already in the target. All four refuse while a scan runs.
- `demoFoldersRead` — an installation's absolute `demos` folders (display only); `demoPlay` — plays a demo.
- `playbackTimeline` / `playbackConsoleSend` / `playbackStage` / `playbackStop` / `playbackCinema` /
  `playbackDisplayRead` — pause, jump, seek or speed the running demo, send one validated console
  line, re-place the window over the stage, end it (quit, then terminate), enter or leave cinema
  mode, read the display state.

Events: `scanProgress`, `playbackPosition` (every 250 ms), `playbackState`, `playbackDisplay`.

## External inputs

- Files: demo files (optionally gz) in installation game dirs, the Linux Q2PRO write dir and extra
  folders, at any depth below each `demos` folder; zip archives via a bounded reader, never recursed;
  sidecars; replays-index.json; state.json. Folder walk: an already visited real path is never
  entered; the `_launcher` staging folder is skipped.
- Engine: Q2PRO started with `+demo`. Windows: commands via `q2l_ctl.cfg` in the game dir, answers
  tailed from a dedicated logfile; Linux: console over stdin/stdout.
- Window system: placement on Windows; X11 (X-Resource PID) on Linux. Network: none.

## Limitations

- Playback needs Q2PRO; other clients are not eligible. A demo outside the Quake filesystem is played
  from a temporary copy; a `.gz` is not decompressed by the launcher.
- Stage placement depends on the platform's window system; nested archives are not expanded. An `.mvd2`
  demo has no roster; an OpenTDM 1v1 demo cut off before the match ends has no teams.
