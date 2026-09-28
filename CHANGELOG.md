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
- **Demos** now has its own home in the nav — not much to see yet, but it's there.
- **Demos** — teach the demo browser your own file-naming patterns in Settings, alongside the
  built-in ones.
- The Demos view now lists demos found across every installation and game dir.
- Add your own demo folders in Demos settings — their demos show up in the list too.
- A `.zip` of demos no longer hides them — every demo inside gets its own row in the list,
  marked as coming from an archive.
- The Demos list now shows what it already knows the instant you open it, then quietly rescans
  for anything new — no more staring at "Looking for demos…" every single time. A Refresh button
  is there when you want to ask again yourself.
- Each demo row now tells you what it actually is at a glance — map, mod, who played, when, how
  long, and whether it's a favourite — with clear badges for sidecar notes, archive entries and
  anything unreadable. Click a row to open its details.
- The Demos list now shows live scan progress while it reads, an empty state with a link straight
  into Settings, and calls out any demo folder or archive it couldn't read instead of quietly
  skipping it.
- The Demos list remembers favourites-first-then-newest by default, and you can now click any
  column header to sort by it instead — your choice is remembered next time you open Demos.
- Demos now has a search and filter rail — find a demo by name, player, map, tag or description,
  or narrow the list by mod, gamemode, map, favourites and rating. Your filter is remembered next
  time you open Demos.
- Filter demos by date — pick Today/Last 7 days/Last 30 days, or set your own from/to range,
  combined with every other Demos filter.
- Make a demo yours — give it a name, a description, mod, game mode, map, date, a rating and
  a favourite star, right in its details panel. Saved next to the demo, no rescan needed.
- You can now star/rate a demo right from the list, no need to open it.
- Reveal a demo in the file manager or copy its path straight from the detail panel.
- Rename a demo from its detail panel — its notes file moves right along with it, and if the old
  name was giving away a date or the players, that's kept safe in the notes so renaming never
  loses it.
- A demo inside a `.zip` now shows you plainly why you can't rename it or add notes to it, right
  there in its detail panel — reveal and copy path still work fine.

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
