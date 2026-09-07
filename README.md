# Q2 Launcher

**One place for every copy of Quake II you own — and for the config you actually
play with.**

Point Q2 Launcher at your Quake II installations and it finds them, checks that
they are complete, tells you which engine each one runs, and launches them. Then
it lets you build your binds and settings as reusable profiles instead of
hand-editing `.cfg` files and copying them around.

Built around the [r1q2](https://www.r1ch.net/projects/r1q2) client, with Q2PRO
and vanilla 3.20 as first-class citizens. Ships no game content — you bring your
own Quake II.

> **Status: pre-release (0.1.0).** Your library, launching and the config editor
> work. Downloading the game, mods and asset packs appear in the app as planned
> and are not implemented yet.

## Why

Quake II has aged into a dozen engines, four storefronts and a config format
from 1997. A typical setup is three installations in three places, one of them
the 2023 remaster, each with its own `baseq2` and its own half-remembered
`autoexec.cfg`. Q2 Launcher is the layer that keeps track of that for you:
which copies exist, whether they are intact, which engine they are, and which
config belongs to which.

## Compatibility

| Platform              | Status                          |
| --------------------- | ------------------------------- |
| Windows 10 / 11 (x64) | **Supported** — the only target |
| macOS                 | Not supported, not planned      |
| Linux                 | Not supported, not planned      |

Nothing in the code is deliberately Windows-only, but nothing outside Windows is
tested, packaged or on the roadmap.

**Engines recognised on disk:** R1Q2, Q2PRO, Yamagi Quake II, KMQuake II,
vkQuake2, Quake II RTX, the original 3.20 client and the 2023 remaster. Any
Quake II copy can be added and launched; the config editor validates against
R1Q2, Q2PRO and vanilla 3.20.

## What works today

### Your library

- Add a folder you already have, or let the launcher **search your PC** — Steam,
  GOG, Epic and the classic install paths, plus an optional deep scan of your
  drives.
- Create a fresh installation folder from scratch.
- Rename, reorder, favourite, relocate and remove entries.
- **Every installation is checked**: does `baseq2` exist, is `pak0.pak` there and
  the right retail size, is there a client executable, is the folder writable.
  Every failed check offers the action that fixes it.
- **Launch** with a correctly composed command line, live process tracking and
  recorded play time.

### Your config

- **Profiles** — create one from a template, empty, as a copy, or by importing an
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
- **Care** — one maintenance screen: validation report, sync state, tidy-up
  actions, and cleanup of the redundant per-mod config copies the engine's search
  path makes pointless.
- **Switch while playing** — a bindable key cycles through an installation's
  assigned profiles and echoes the new one to the console.

## Planned

| Feature         | What it is                                                                                                                                                                | Status               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Downloads**   | Get, update, verify and repair game files — job queue, resumable downloads, archive extraction, hash verification. What the action bar's progress readout is waiting for. | In the UI, not built |
| **Mods**        | Discover, install and enable/disable game directories with their own config. The `+set game` half already exists.                                                         | In the UI, not built |
| **Asset packs** | Texture, model and sound packs, with conflict detection between packs touching the same files and a record of what a pack changed so it can be undone.                    | In the UI, not built |
| **Auto-update** | The launcher updating itself, plus a decision on code signing — unsigned builds trigger a SmartScreen warning today.                                                      | Not started          |

Deliberately **not** planned: a server browser, a news feed, and deleting
anything from your disk — removing an installation removes it from the library,
never from the drive.

Full picture and current state: [docs/ROADMAP.md](docs/ROADMAP.md).

## Install

No release build is published yet. Until then, build it from source —
see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE). Quake II is a trademark of id Software; this
project ships no game content.
