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
- A **Servers** nav entry now exists (planned status) with its own Settings section, ahead of
  the module's server-browsing features landing.
- **Servers** — the master and list sources the scanner pulls candidates from are no longer
  fixed: add your own, remove or reorder the shipped three, flip one off without losing its
  address, and it all survives a restart. A bad address gets refused on the spot, not silently
  swallowed.
- **Servers** — how hard the scanner works is now yours to dial: auto-scan on open, an
  auto-refresh interval, concurrent queries, per-query timeout, retries and the minimum time
  between two automatic scans all live in Settings, with a real measured pass behind every shipped
  default instead of a guess. A manual scan button always works, whatever you've set the automatic
  knobs to.
- **Servers** — the scanner now stands down the moment you're actually playing: no auto-refresh
  fires in the background, and hitting the manual scan button just tells you why it won't. A
  server that goes quiet for one round keeps showing what it last said, clearly marked stale, never
  wiped back to empty. The moment you're back at the menu, scanning picks up again on its own.
- **Servers** — a refresh no longer has to mean "reload everything": "Refresh favourites" re-checks
  just your favourites, and selecting a server and hitting "Refresh this server" re-checks only
  that one, both leaving the rest of the list exactly as it was. All three refresh buttons now show
  when they can't run (already scanning, or the game is running) instead of silently no-opping.
- **Linux** — a Windows Quake II build (Steam, GOG, a folder carried over from another machine)
  now plays on Linux too: the launcher offers wine or umu-run as a runner and launches through it
  when you pick one.
- **Steam** — a Steam-owned installation can hand off to Steam itself instead of the launcher's
  own runners: pick the 2023 remaster (Enhanced), the original release, The Reckoning or Ground
  Zero, and Steam takes it from there. The tradeoff: no playtime tracking, the launcher's own
  launch arguments and active game directory don't apply, and the launcher won't hold back its
  own writes into that folder while Steam runs the game.

### Fixed
- **Linux** — the installation's Runner section is now a compact, wrapping row of chips instead
  of a stack of full-width buttons, and the Steam caveat only shows up once Steam is actually the
  chosen runner, not merely because it's in the list.


## 0.3.0 — 2026-09-22

### Added
- **Linux** — the launcher runs on Linux from source: it finds your Steam installations
  (native and Flatpak), recognises engines by their real binaries instead of a Windows file
  extension, and extracts archives with a vendored Linux 7-Zip. If your platform has no
  installable engine yet, the bootstrap wizard says so plainly instead of showing you an empty
  shelf.
- **Linux** — there is now a Linux download. Every release publishes an x86_64 AppImage
  alongside the Windows installer, from the same run, and it updates itself just like the
  Windows build does.

### Fixed
- **Linux** — launching a Windows executable with no runner available used to report "exited
  cleanly" after doing nothing at all. The launcher now recognises a Windows binary on sight,
  warns about it plainly, and refuses to launch instead of pretending it worked.


## 0.2.0 — 2026-09-13
### Added
- **Your library** — find installations automatically (Steam, GOG, Epic, the classic
  paths, or an optional deep scan of your drives), add a folder yourself, or start a
  fresh one from scratch; rename, reorder, favourite, relocate and remove entries.
- **Your library** — every installation is checked for a real `baseq2`, the correct
  `pak0.pak`, a client executable and a writable folder, and every failed check comes
  with the action that fixes it.
- **Your library** — launch with a correctly composed command line, live process
  tracking and recorded play time.
- **Config profiles** — create one from a template, empty, as a copy, or from an
  imported `config.cfg`/`autoexec.cfg`; assign a profile to as many installations as
  you like.
- **Config profiles** — every profile is a real file that syncs automatically to
  every assigned installation; one that's currently running is skipped and marked
  pending, never overwritten mid-game.
- **Config profiles** — a bindable key cycles an installation's assigned profiles on
  the fly and echoes the switch to the console.
- **Controls** — a keyboard overview showing what's bound, what's free and what's
  double-bound, with a key-capture test mode that reveals the alias chain that would
  actually fire.
- **Controls** — one dense bind grid, primary and secondary per action, grouped by
  category, filterable, with a profile-wide conflict scan.
- **Controls** — alternate binding layers (hold and toggle) for a game with no
  modifier keys — the editor writes the alias machinery for you and warns before a
  layer could leave your movement stuck.
- **Settings** — player and graphics cvars with per-engine defaults, clamps and
  cross-engine warnings (`r_maxfps 0` is 5 FPS on R1Q2, uncapped on Q2PRO); cvars
  your engine doesn't have are named, not hidden.
- **Messages and macros** — a team-message editor that keeps client-side meta
  variables and server-substituted macros (`%l`, `%h`, `%a`) apart, plus a
  symbol/colour picker for the high-ASCII set, round-tripped byte-for-byte.
- **Raw file view** — the real config text with Quake II syntax highlighting, search
  and reveal-in-folder.
- **Care** — one maintenance screen: validation report, sync state, tidy-up actions,
  and cleanup of the redundant per-mod config copies the engine's search path makes
  pointless.
- **Home screen** — a news feed and an arrangeable dashboard, with playtime and
  config-profile tiles you place where you like.
- **Install management** — a write-guard, engine update and rollback, repair, and
  removing an installation from disk entirely.
- **Launcher updates** — a titlebar button appears only when a new version is out, names it,
  links to what changed, and downloads on your say-so; the launcher stays fully usable while it
  downloads and only restarts once you confirm a second time. It won't do that over a running
  game or an in-flight download, and dismissing it just makes it quiet for the rest of the
  session — it doesn't go away.
- **About** — Settings' About tab now tells you what you actually got: this version's own
  release notes, an available update's notes marked "not yet installed" next to the same
  download action the titlebar offers, when the launcher last checked for updates, and a
  check-now button — plus links out to the project and the full changelog.
