# Changelog

All notable changes to Q2 Launcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

New changes go under `## Unreleased` as you make them — the release workflow
refuses to run while that section is empty, and promotes it into a dated
version section when a release actually ships.

## Unreleased

<!-- Add your changes here as '- ...' items, grouped under '### Added' / '### Changed' / '### Fixed' / '### Removed' / '### Security' headings. -->

### Fixed
- **Demos** — the play button no longer flickers between play and pause while a demo plays on Windows.
- **Servers** — an address you add from the server browser now actually lands in the game's address book, right away, without leaving the profile marked as unsaved.

### Changed
- **Demos** — while a demo plays on the stage, its details stay visible to the right of the picture, and the playback controls are larger, with the seek bar spanning the full width above them.
- **Demos** — the game no longer captures the mouse while a demo plays in the launcher, so the controls are reachable without pressing Escape first.
- **Demos** — the launcher's plumbing no longer scrolls over the demo, and chat shows in the game's chat HUD.
- **Demos** — the console field only shows while a demo is playing, instead of sitting there disabled.
- **Demos** — the demo detail now reads at a glance: the name is the big title, then file name, length and recorded time, a gap, then map, mod, gamemode, players and point of view. The "where did this value come from" labels, the duplicate name, source and format rows are gone, and a guessed gamemode in the list no longer says "(guessed)".
- **Demos** — you edit a demo's details where you read them: Edit turns the facts into inputs in place, the name into the title field, and there is no separate "Your notes" form below any more.
- **Demos** — favourite and a 10-star rating are one click each in the demo detail, no Edit button and no ceremony; and a quick favourite followed by a quick rating no longer lose one another.

### Added
- **Demos** — a Stop button on the timeline (and in the action bar) ends the demo and the game with one click. On Windows the stage now tells you why the game's own console stays quiet while it steers the demo.
- **Demos** — a fullscreen button on the timeline: the demo goes fullscreen, you steer it with your keys and "Back to window" brings it home.
- **Demos** — a demo now plays on the launcher's stage: the game window sits right over a 4:3 area of the Demos view, with the timeline and console field beneath it. On Wayland it plays in its own window and tells you why.
- **Config** — a "record every map automatically" switch in Settings: turn it on and every map you play is recorded as a demo, on r1q2 and Q2PRO.
- **Config** — a "Demo playback" category in the Controls tab: bind pause, jump and speed up/down to any key and steer a demo in fullscreen. Nothing is bound for you.
- **Demos** — a console field next to the timeline: type `fov 110` or `cl_demosnaps` and it goes straight to the running demo.
- **Demos** — a timeline under the demo list while it plays: pause, jump 10 s, click to seek, speed from 0.25× to 4×. Watch it like a video.
- **Demos** — a demo from another installation, your own folders or even a `.zip` now plays too: the
  launcher slips a temporary copy into your Q2PRO and tidies it away when the game ends.
- **Demos** — a Play button on every demo that can be played: it starts your Q2PRO with the right mod
  and `+demo`, or tells you in plain words why it can't. No more typing console commands from memory.
- **Demos** — server-side `.mvd2` demos (and `.mvd2.gz`) play like any other, with a note on who the camera follows.
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

### Changed
- **Demos** — the demo stage now moves, hides and steps aside with the launcher: drag or resize the window and the game follows, leave the view and it parks, open a dialog or menu and it gets out of the way.

### Removed
- **Demos** — the "Sorted by …" line above the list is gone; the column header already shows the sort.

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
