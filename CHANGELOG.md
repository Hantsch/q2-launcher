# Changelog

All notable changes to Q2 Launcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

New changes go under `## Unreleased` as you make them — the release workflow
refuses to run while that section is empty, and promotes it into a dated
version section when a release actually ships.

## Unreleased

<!-- Add your changes here as '- ...' items, grouped under '### Added' / '### Changed' / '### Fixed' / '### Removed' / '### Security' headings. -->

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
