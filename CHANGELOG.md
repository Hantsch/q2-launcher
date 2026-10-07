# Changelog

All notable changes to Q2 Launcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

New changes go under `## Unreleased` as you make them — the release workflow
refuses to run while that section is empty, and promotes it into a dated
version section when a release actually ships.

## Unreleased

<!-- Add your changes here as '- ...' items, grouped under '### Added' / '### Changed' / '### Fixed' / '### Removed' / '### Security' headings. -->


## 0.7.0 — 2026-10-07

### Added
- **Servers** — Scan now refreshes only the servers your filter shows; Scan all is one click away.
- **Servers** — Hide servers above a maximum ping (< 50 to < 200 ms).
- **Library** — A folder with several engines lists them all; choose which one Play starts.
- **Downloads** — New installs go into their own folder; the path is shown before anything is written.
- **Replays** — Demo timeline: volume slider and mute button for the game's sound.
- **Servers** — Put a search term in quotes to match it exactly.
- **Servers** — Switch between Online and LAN to find servers on your local network.
- **Servers** — Save your server filter as a named quick filter and reapply it with one click.
- **Demos** — Demo detail lists players by team, spectators tucked away.
- **Demos** — The demo list shows the selected installation's demos; a toggle shows all.
- **Demos** — Browse your demo subfolders — breadcrumb, new/rename folder, drag a demo to move it.
- **Demos** — Select several demos to delete, tag or move them at once; right-click for a menu.
- **Demos** — Comment a moment of a demo on its timeline; comments show as marks and in the detail.

### Changed
- **Servers** — Filter by several mods or maps at once.
- New installation… in the rail and Library is one wizard that ends with a playable, named installation.
- **Downloads** — Settings now say which options are not available yet.
- **Demos** — Quote a search term to match it exactly; a third click resets a sort.
- **Demos** — Demo details are edited in place and save themselves — no Edit or Save button.

### Fixed
- **Demos** — On Linux X11 the staged demo stays on top of the launcher, borderless.
- An unexpected launcher error now shows a translated message instead of raw system text.
- **Downloads** — A retry that broke while starting now shows its failure and can be retried.
- Bleeding-edge engine downloads now time out, retry and refuse oversized files.
- Your last change before quitting is saved, and a failed settings write now tells you.
- **Config** — A refused profile save now shows its reason on every tab; a new alias lands in your first category.
- Name dialogs submit once on Enter; tabs work with the arrow keys.
- **Servers** — A stalled or oversized server-list source no longer hangs a scan.
- **Settings** — Unlock codes name their features instead of showing an internal id.

### Security
- Updated Electron to 43.7.7 for upstream security fixes.


## 0.6.0 — 2026-09-30
### Added

- **Demos** — new Demos view: browse every demo from your installations, folders and `.zip` archives; search, filter, sort, rename, rate and favourite them.
- **Demos** — play a demo inside the launcher, in cinema mode over the whole screen, or fullscreen, with a timeline (pause, seek, speed) and a console field. Cinema mode is not available on Wayland.
- **Config** — "Record every map automatically" switch in Settings and a "Demo playback" key category in Controls.
- **Servers** — join the selected server from the big button.

### Fixed

- **Servers** — an address you add from the server browser lands in the game's address book right away.

## 0.5.0 — 2026-09-26
### Added

- **Servers** — a full server browser: scan, filter and sort the list, see live status and
  full server rules, join or spectate in one click, keep a watchlist of players across servers,
  and manage your own favourites and address sources.
- Enter an unlock code in Settings to see what it unlocks.

### Fixed

- **Linux** — the Runner picker is now a tidy row of chips instead of a wall of buttons.

## 0.4.0 — 2026-09-23
### Added

- **Linux** — Quake II now runs on Linux via Wine or umu-run, and Steam-owned installs can hand
  off straight to Steam instead.

## 0.3.0 — 2026-09-22
### Added

- **Linux** — native support from source: auto-detects Steam and Flatpak installs, and ships its
  own AppImage build with self-updates.

### Fixed

- **Linux** — launching an unsupported Windows binary now fails loudly instead of silently doing
  nothing.

## 0.2.0 — 2026-09-13
### Added

- **Library** — auto-detects installations (Steam, GOG, Epic, deep scan), health-checks each one,
  and launches with tracked playtime.
- **Config profiles** — build one from a template, blank, or an import; every profile stays
  synced to whatever installations use it, and a keybind hot-swaps between them mid-game.
- **Controls** — one bind grid with conflict detection, a keyboard overview, and alternate
  hold/toggle layers for a game with no modifier keys.
- **Settings** — per-engine cvars with sane defaults, clamps and cross-engine warnings.
- **Messages & raw config** — a macro-aware team-message editor and a syntax-highlighted raw
  config view.
- **Home & care** — an arrangeable dashboard plus a maintenance screen for validation, sync and
  cleanup.
- **Install management** — repair, rollback, update and remove installations.
- **Updates** — the launcher checks, downloads and installs its own updates, with full release
  notes under Settings → About.
