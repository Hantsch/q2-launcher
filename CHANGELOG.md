# Changelog

All notable changes to Q2 Launcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

New changes go under `## Unreleased` as you make them — the release workflow
refuses to run while that section is empty, and promotes it into a dated
version section when a release actually ships.

## Unreleased

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
