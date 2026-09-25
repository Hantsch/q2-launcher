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
- Enter an unlock code in Settings to see what it unlocked, alongside every code you've already
  redeemed and when it expires.
- **Servers** — an "Add to address book" button next to Join/Spectate writes a server's address
  into one of Quake II's own nine `adr0`–`adr8` slots, in a config profile you pick, with every
  slot's current value shown before you overwrite anything.
- **Servers** — a Spectate button sits next to Join in the list and the detail pane, for when you
  just want to watch: same address check and mod-mismatch warning, but it asks for a spectator
  password instead of a join one when the server wants it, and that password never shows up
  anywhere a shoulder-surfer (or a log file) could read it.
- **Servers** — a server's detail pane now lists every rule it plays by, dmflags decoded into
  plain English (with a caveat that mods may reuse those bits for their own purposes).
- **Servers** — the detail pane now shows how a server has actually been answering this session: a
  plain statement of whether the last scan round got a reply at all (and when it last did, if not),
  plus a running list of every response time measured, newest first, so one bad ping doesn't read
  as "reliable" or "dead" on its own.
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
- **Servers** — a server row now tells you what's going on without opening it: name, mod,
  players/slots, map and ping when known, plus badges for password-protected, the gamemode, your
  favourites, stale data and the one case the browser exists for — a duel server with exactly one
  player waiting for an opponent. A server nobody has scanned yet shows a clean placeholder instead
  of a blank or broken row.
- **Servers** — a refresh no longer has to mean "reload everything": "Refresh favourites" re-checks
  just your favourites, and selecting a server and hitting "Refresh this server" re-checks only
  that one, both leaving the rest of the list exactly as it was. All three refresh buttons now show
  when they can't run (already scanning, or the game is running) instead of silently no-opping.
- **Servers** — the list is sortable: click Name, Mod, Players, Map or Ping to sort by it, click
  again to reverse, click a third time to go back to the default (favourites first, then busiest).
  Your choice sticks across restarts.
- **Servers** — the list can now be filtered and searched: free-text search across name, address
  and player names, plus mod/gamemode/map dropdowns and has-players/not-full/no-password/waiting-
  for-an-opponent toggles, all combinable. A "Showing X of Y" count appears while a filter is
  active, one click clears every field, and a filter that matches nothing says so instead of
  showing a blank list. Filters and search reset each time you open the list — nothing stays
  hidden by default.
- **Servers** — the list now says what it's doing: a live "N servers found, M still being queried"
  readout (then a players-fetched count) while a scan runs, a clear empty state with a link
  straight to source settings when nothing came back, an idle state before the first scan ever
  runs, and any source that failed named by its address with its actual reason, shown alongside
  whatever the other sources did return. Rows now stream in live as a scan progresses instead of
  only updating once it finishes.
- **Servers** — click a server to see what's going on there: a detail pane opens beside the list
  with the address, mod, map, gamemode, players, ping, password and the engine/protocol it's
  running, and refreshes itself the moment a scan round finishes.
- **Linux** — a Windows Quake II build (Steam, GOG, a folder carried over from another machine)
  now plays on Linux too: the launcher offers wine or umu-run as a runner and launches through it
  when you pick one.
- **Steam** — a Steam-owned installation can hand off to Steam itself instead of the launcher's
  own runners: pick the 2023 remaster (Enhanced), the original release, The Reckoning or Ground
  Zero, and Steam takes it from there. The tradeoff: no playtime tracking, the launcher's own
  launch arguments and active game directory don't apply, and the launcher won't hold back its
  own writes into that folder while Steam runs the game.
- **Servers** — a Join button now sits in the list's toolbar and the detail pane's header: pick a
  server and go, no more copying an address into a shortcut. A mod that doesn't match your active
  installation gets a warning first (you can still launch anyway), a password-protected server asks
  for the password before it even tries, and every join lands in your server history. The password
  never touches the command line the game sees.

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
