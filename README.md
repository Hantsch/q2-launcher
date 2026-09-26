# Q2 Launcher

**One place for every copy of Quake II you own — the config you actually play
with, and the servers worth joining.**

Point Q2 Launcher at your Quake II installations — or let it build one for you —
and it finds them, checks that they are complete, tells you which engine each
one runs, keeps them updated and launches them. It lets you build your binds and
settings as reusable profiles instead of hand-editing `.cfg` files and copying
them around, and it finds you a server to play on.

Built around the [r1q2](https://www.r1ch.net/projects/r1q2) client, with Q2PRO
and vanilla 3.20 as first-class citizens. Ships no game content — you bring your
own Quake II, or start from the freely downloadable demo.

> **Status: pre-release (0.3.0).** Library, installs, launching, the config
> editor, the home screen and self-updates work on Windows and Linux. The game
> browser and the Linux runners (wine, umu-run, Steam) are built and ship with
> the next release. Mods and asset packs are not started.

## Why

Quake II has aged into a dozen engines, four storefronts and a config format
from 1997. A typical setup is three installations in three places, one of them
the 2023 remaster, each with its own `baseq2` and its own half-remembered
`autoexec.cfg`. Q2 Launcher is the layer that keeps track of that for you:
which copies exist, whether they are intact, which engine they are, which config
belongs to which — and where the game is actually being played tonight.

## Compatibility

| Platform              | Status                                          |
| --------------------- | ----------------------------------------------- |
| Windows 10 / 11 (x64) | **Supported** — the primary target              |
| Linux (x86_64)        | **Supported** — AppImage, see the caveats below |
| macOS                 | Not supported, not planned                      |

On Linux the launcher finds native and Flatpak Steam installations and runs
native engine builds directly. A Windows build (the Steam copy, a GOG folder, a
folder carried over from a Windows machine) plays through a runner you pick —
wine, umu-run, or a handoff to Steam itself. What Linux does not have yet is a
downloadable engine: the bootstrap wizard says so plainly instead of offering an
empty choice. A feature that cannot work on a platform stays visible, disabled,
with the reason next to it.

**Engines recognised on disk:** R1Q2, Q2PRO, Yamagi Quake II, KMQuake II,
vkQuake2, Quake II RTX, the original 3.20 client and the 2023 remaster. Any
Quake II copy can be added and launched; the config editor validates against
R1Q2, Q2PRO and vanilla 3.20; the installer downloads R1Q2 and Q2PRO (Windows).

## What works today

### Home

- **News** — a carousel of what is going on in Quake II, fetched from the
  community content repository. A failed fetch quietly shows the last feed you
  had, with its age — never a dialog.
- **Dashboard** — a grid you arrange yourself, with playtime and config-profile
  tiles placed and sized where you want them.

### Your library

- Add a folder you already have, or let the launcher **search your PC** — Steam,
  GOG, Epic and the classic install paths, plus an optional deep scan of your
  drives.
- Rename, reorder, favourite, relocate, give an installation its own icon, and
  remove it — from the library only, or from disk entirely (never for a
  store-managed folder; the store uninstalls those).
- **Every installation is checked**: does `baseq2` exist, is `pak0.pak` there and
  the right retail size, is there a client executable, is the folder writable.
  Every failed check offers the action that fixes it.
- **Launch** with a correctly composed command line, live process tracking and
  recorded play time.

### Installs and downloads

- **From nothing to playable** — a wizard creates a new installation with R1Q2
  or Q2PRO, fed either by the free demo data or by copying the retail paks from
  a Steam, GOG or Epic copy you own.
- **Demo to retail** — a demo installation upgrades in place once a retail copy
  is detected, without re-running the wizard.
- **Engine updates and rollback** — a newer pinned engine is offered, never
  forced; the previous files are backed up inside the installation and restored
  in one step. Opt into "bleeding edge" per installation.
- **Repair** fixes exactly what the checks found — engine executable,
  `pak2.pak`, missing or demo retail paks, write access — and nothing else.
- **Verified jobs** — every download is hash-verified and runs in a queue on the
  Downloads tab. A failure says its cause, not a log dump, and a failed install
  stays in your library to retry.
- **Nothing is written under a running game** — installs, updates, repairs and
  config syncs wait for the game to exit, or say why they won't.

### Your config

- **Profiles** — create one empty, from a template, as a copy, or by importing an
  existing `config.cfg`/`autoexec.cfg`. Assign a profile to as many
  installations as you like; each installation picks one default.
- **Every profile is a real file.** A canonical `<name>.cfg` lives in the
  launcher's data folder and syncs automatically to every assigned installation.
  An installation that is currently running is skipped and marked pending.
- **Keyboard overview** — see what is bound, what is free and what is bound
  twice. Test mode captures real key presses and shows the alias chain that would
  actually execute.
- **Controls** — one dense grid with a primary and a secondary bind per action,
  grouped by category, with a live filter and a profile-wide conflict scan that
  marks every clashing bind.
- **Alternate binding layers** — Quake II has no modifier keys, so the editor
  writes the alias machinery for hold- and toggle-style layers for you, and warns
  you when a layer would leave your movement stuck.
- **Settings** — player and graphics cvars with per-engine defaults, clamps, and
  warnings where the same value means different things on different engines
  (`r_maxfps 0` is 5 FPS on R1Q2, uncapped on Q2PRO). Cvars your engine does not
  have are named, not hidden.
- **Messages and macros** — a team-message editor that separates client-side meta
  variables from server-substituted macros (`%l`, `%h`, `%a`), plus a
  symbol/colour picker for the high-ASCII character set, round-tripped
  byte-for-byte.
- **Raw file view** — the real config text with Quake II syntax highlighting,
  search and reveal-in-folder.
- **Care** — one maintenance screen: validation report, sync state and drift,
  tidy-up actions, and cleanup of the redundant per-mod config copies the
  engine's search path makes pointless.
- **Switch while playing** — a bindable key cycles through an installation's
  assigned profiles and echoes the new one to the console.

### Servers (next release)

- **Server list** — pulled from master and list sources you can add, remove,
  reorder and switch off. Rows stream in live during a scan and show name, mod,
  players, map, ping, and badges for passwords, gamemode, favourites, stale data
  and the duel server with one player waiting for an opponent.
- **Sort, filter, search** — by name, address or player; by mod, gamemode or
  map; has-players, not-full, no-password, waiting-for-an-opponent.
- **Detail view** — players, every server rule with `dmflags` decoded into plain
  English, and how the server has actually answered this session.
- **Join or spectate** in one click, with a warning when the server's mod does
  not match your installation. Passwords are asked for up front and never appear
  on the command line or in a log.
- **Address book** — write a server into one of Quake II's own `adr0`–`adr8`
  slots in a profile you pick, seeing every slot before you overwrite one.
- **Favourites, servers added by hand and your join history** are always there,
  and a refresh can be scoped to favourites or a single server.
- **The scanner stands down while you play** — no background traffic during a
  match. How hard it works (concurrency, timeouts, retries, auto-refresh) is a
  setting.
- **Watchlist** (experimental, behind an unlock code) — track named players and
  jump to whichever server they are on.

### Launcher updates

A titlebar button appears only when a new version is out, names it and links to
what changed. It downloads on your say-so and restarts only after a second
confirmation — never over a running game or an in-flight download. Settings'
About tab shows the release notes of what you have and what is available.

## Planned

| Feature          | What it is                                                                                                                                             | Status      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| **Mods**         | Discover, install and enable/disable game directories with their own config. The `+set game` half already exists.                                      | Not started |
| **Asset packs**  | Texture, model and sound packs, with conflict detection between packs touching the same files and a record of what a pack changed so it can be undone. | Not started |
| **Linux engine** | A self-built, mirrored Linux Q2PRO so the bootstrap wizard can install a native engine on Linux too.                                                   | Open        |

Full picture and current state: [docs/ROADMAP.md](docs/ROADMAP.md). What changed
per version: [CHANGELOG.md](CHANGELOG.md).

## Install

Grab a build from the
[GitHub Releases page](https://github.com/Hantsch/q2-launcher/releases):

- **Windows** — the NSIS installer (`.exe`) or the portable zip. Builds are
  unsigned, so Windows SmartScreen will warn — "Windows protected your PC" →
  "More info" → "Run anyway".
- **Linux** — the AppImage (x86_64). Make it executable (`chmod +x`) and run it;
  it updates itself the same way the Windows build does.

Prefer to build it yourself? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE). Quake II is a trademark of id Software; this
project ships no game content.
