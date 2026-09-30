# Demo Browser — Library, Metadata and Remote-Controlled Playback — Concept

Status: **Draft** (vision + requirements; v1 cut into stories 133–167 under
`docs/requirements/`, no sprint yet). This document fixes what the launcher's
demo browser becomes: a new top-level module that finds Quake II demo files across every
installation, every game directory and any extra folders the user adds, derives what it can from the
file name and the demo content, lets the user annotate each demo with a **sidecar file next to it**,
and plays a demo in the real engine while the launcher drives it with a timeline. It also fixes the
staging beyond v1 (a 2D analyser next, a 3D viewer left open). Everything here comes from the
requirements interview of 2026-09-26 plus the format/engine research recorded in §6 and §9; nothing
was inferred. The user has no local sample demo yet — every parser statement below is from source
code, not from a file we have opened.

This document follows the architecture rules in [CLAUDE.md](../../CLAUDE.md): a feature is a module
(here: `replays`), every renderer-supplied payload carries a zod schema and no renderer path is
trusted, no bundled image assets enter the UI, and platform gaps are visible and explained. It builds
on the existing launch path ([launch-plan.ts](../../src/main/services/launch-plan.ts)'s
`buildLaunchArgs`, whose `extraArgs` already carry arbitrary `+` commands), the installation model
and game-dir discovery ([inspector.ts](../../src/main/services/inspector.ts)), the `config` module
([config-module.md](../systems/config-module.md)) for the in-game demo key binds, the game
browser's shared filter engine ([list-filter.ts](../../src/shared/servers/list-filter.ts)) and its
concept ([game-browser.md](game-browser.md)), whose planned 2D live observer shares parser code with
this module's 2D analyser.

---

## TL;DR

- **Vision:** every demo you have — your own, auto-recorded by servers, downloaded — in one
  searchable place, annotated the way you remember it ("final vs X, the rail at 4:10"), and played
  with player-like controls instead of console commands.
- **Own module, primary nav.** UI says **"Demos"**, the code says **`replays`** — "demo" already
  means the shareware installation and the UI fixture data in this repo.
- **Sources:** all installations × all game dirs (`<gamedir>/demos/`), user-added extra folders,
  `.dm2`, `.mvd2`, `.dm2.gz`/`.mvd2.gz` and `.zip` archives (each entry a row, read-only).
- **Index freshness:** incremental scan when the module opens, plus a manual refresh. No watcher.
- **The filesystem is the master.** User metadata lives in `<file>.dm2.json` **next to the demo**:
  name, description, mod, gamemode, map, sides/teams with players, tags, favourite, rating 1–10,
  date override. Parsed data is a disposable cache in app data; untouched demos get no sidecar.
- **Precedence:** sidecar > demo content > file name > file time.
- **File-name patterns:** shipped patterns (r1q2 autorecord, OpenTDM, AQ2-TNG) **plus user-defined
  templates** in Settings. The parser is expected to improve over time.
- **Search and filters:** full-text over name, description, tags, players, map and file name;
  filters for mod, gamemode, map, date (presets + custom range), favourite, rating ≥ n, tags.
  Default order: **favourites on top, then newest**.
- **Playback v1:** the real **Q2PRO**, started with `+demo`, **driven from a launcher timeline**
  (play/pause, ±jump, click-to-seek, speed, position/duration, free console commands). By default the
  demo plays on a **stage** in the Demos view — a borderless Q2PRO window the launcher places over it
  (spike [[169]]) — the **preview**. Two larger modes are a deliberate choice: **cinema mode**, the
  demo over the whole display with the launcher's own controls laid over it like a video player
  (spike [[186]], story [[187]]), and **fullscreen**, steered there by in-game key binds that live in
  the **config profile**.
- **Windows remote channel is unproven** → first story is a spike; if it fails, a **native helper**
  is built. Linux uses stdin (verified in source).
- **r1q2-only users** get a visible fallback without seeking. Linux has no r1q2 at all.
- **Next stage:** a **2D analyser** (top-down radar, scoreboard, frag feed, real timeline). A **3D
  viewer** stays open — not a non-goal.
- Biggest open points: the Windows channel spike result, the pattern template syntax, date presets,
  duration cost at scan time, sidecar writes into read-only folders, and what happens to demo binds
  in r1q2 profiles.

---

## 1. Vision

Demos pile up. Some servers record every match automatically, some players record their own, some
arrive as a zip from a community site. Today they sit in `demos/` folders scattered across
installations and mod directories, named by whatever pattern the server used, and the only way to
watch one is to remember its file name and type it into the console.

The demo browser turns that pile into a library:

- **Find it.** Every demo from every installation and mod in one list, filtered the way the server
  browser filters servers — by mod, gamemode, map — plus by who played and when ("last 30 days").
- **Remember it.** A name and a description you wrote, the players and who played against whom,
  tags, a favourite star and a rating — stored as a small file **next to the demo**, so the
  knowledge travels with the file and is never locked inside the launcher.
- **Watch it** like a video: a timeline to jump around in, pause, play, faster, slower, fullscreen —
  not `demo foo.dm2` and a prayer.

The server-side naming patterns are messy and unknown in advance; the browser is expected to get
better at taking them apart over time, and the user can teach it patterns it does not know yet.

## 2. Scope

### In scope (v1)

- A new module `replays` (UI label "Demos") with a **primary nav entry**, its own route and a
  settings section.
- **Discovery** in `<root>/<gamedir>/demos/` (and the write directory where set) for every
  installation and every detected game dir, plus **user-added extra folders**.
- **Formats:** `.dm2`, `.mvd2`, gzip-compressed `.dm2.gz` / `.mvd2.gz`, and `.zip` archives whose
  demo entries appear as individual, read-only rows.
- **Incremental index** on module open plus manual refresh; parsed data in a disposable app-data
  cache.
- **Header parsing** of the demo content: map, game dir, player names, recording player (POV),
  duration (§6).
- **File-name parsing** with shipped patterns and **user-defined templates** (§7).
- **Sidecar metadata** `<file>.dm2.json`: create, edit, validate; precedence sidecar > content >
  name > file time (§8).
- **List, search, filters, sorting** (§10).
- **File actions:** reveal in file manager, copy path, **rename** (demo and sidecar together).
- **Playback** in native Q2PRO with automatic installation choice, temporary copies for demos
  outside the playing installation's file system, and an r1q2 fallback without seeking (§11).
- **Launcher timeline** remote-controlling the running engine, plus in-game binds from the config
  profile for fullscreen (§12).
- The **Windows channel spike** and, if it fails, the native helper (§12.3).

### Deliberately not in v1

- **2D analyser** (top-down radar, scoreboard, frag feed, in-launcher timeline without the engine).
  > Rationale: the next stage by decision. It needs a full `svc_*` parser with entity/playerstate
  > delta state and BSP geometry — the same work the game browser's 2D live observer needs, so the
  > two should share it rather than one blocking the other.
- **3D in-launcher viewer** (three.js renderer from the user's own paks, BSP + MD2).
  > Rationale: left open by decision — "3D später offen". Researched effort is 2–3+ months (§9.3).
- **A browser (WASM) engine as an optional, experimental playback mode.**
  > Rationale: deferred by decision (2026-09-30) — native Q2PRO works well and is good enough for
  > the start. Kept as a polish feature for deeper integration and better Linux/Wayland support
  > (§9.2).
- **Recording** (autorecord toggles, record buttons).
  > Rationale: decided in the interview — the module is browser + viewer; recording stays with the
  > game, the server and, where it is a cvar, the config profile.
- **Dashboard tile.**
  > Rationale: decided in the interview, same reasoning as the game browser — a tile once someone
  > misses it.
- **Delete, move and copy-to-installation** as file actions; **link from a demo to the server
  detail view**.
  > Rationale: offered in the interview and not selected (2026-09-26). Revisit on demand.
- **Sidecars and rename for zip entries.**
  > Rationale: decided in the interview — archives are read-only; the actions stay visible and
  > disabled with the reason.
- **Choosing the followed player in an MVD2** beyond what Q2PRO's own playback offers.
  > Rationale: not discussed; see open point §17.9.

### Non-goals (permanent)

- **Embedding the engine window inside the launcher** (`SetParent` / X11 reparenting).
  > Fragile on Windows (focus, DPI, exclusive fullscreen, input capture) and impossible on Wayland.
  > Same finding as the game browser's §14.3.
  > The stage (§12.4) is not embedding: the game stays its own top-level window, the launcher only
  > sets its position, size and topmost flag through console cvars.
- **A launcher-owned database as the source of truth for demo metadata.**
  > The filesystem is the master by decision. The app-data cache holds only what can be rebuilt
  > from the files.
- **No image assets in the UI.** Map thumbnails or player images are not fetched and not bundled.
  > CLAUDE.md's rule; neither recorded deviation covers this.

## 3. Design decisions taken (from the requirements interview)

| Topic | Decision | Rationale (user's) |
| --- | --- | --- |
| Placement | Own module, **primary** nav entry | Same level as Library, Config, Servers |
| Naming | UI **"Demos"**, code/module id **`replays`** | The Q2 community says "demo"; the code already uses "demo" for the shareware installation and fixture data |
| Sources | All installations × all game dirs, **extra folders**, **`.mvd2`**, **`.gz` / `.zip`** | "demos von allen installationen und allen gamemods" plus downloaded and server-side demos |
| Index freshness | **Scan on open (incremental) + manual refresh**, no watcher | No new dependency, no platform-dependent watcher behaviour |
| Sidecar name/format | **`<file>.dm2.json`** (full file name + `.json`) | Unambiguous when `x.dm2` and `x.mvd2` sit side by side; zod-validatable, versionable |
| Filesystem as master | Sidecar holds **only user-entered data**; parsed data lives in a **disposable app-data cache**; untouched demos get **no sidecar** | "das filesystem der master ist und das nicht irgendwo anders ist" — without writing thousands of files uninvited |
| Players in the sidecar | **Sides/teams with players** (optional team name and final result) | Covers duel, TDM and CTF — "wer gegen wen gespielt hat" |
| Extra sidecar fields | **Tags**, **favourite** and **rating 1–10**, **date override** | Favourite *and* a finer rating; date override for copied/downloaded files |
| Name patterns | **Shipped patterns + user-defined templates in Settings** | Covers servers we do not know yet |
| Precedence | **Sidecar > demo content > file name > file time** | What the user entered always wins; the content is reliable for map/gamedir/players |
| Gamemode | **File-name pattern + mod heuristic + sidecar**, heuristic marked as "guessed" | The demo content carries no `deathmatch`/`dmflags` |
| File actions | **Reveal in file manager / copy path**, **rename** (demo + sidecar together) | Delete and move were not selected |
| Filters | **Mod, gamemode, map, date (presets + custom range), favourite, rating ≥ n, tags**, plus full-text search | "ähnlich wie beim server"; "last 30 days, oder custom date range"; player-name search |
| Default sort | **Favourites on top, then newest** | Same pinning as server favourites |
| Playback v1 | **Native Q2PRO + launcher timeline already in v1** | The "like YouTube" experience is the point |
| Windows risk | **Spike first; if cfg-polling fails, build a native helper** | Windows is ~80% of users; the timeline must not be Linux-only |
| Fullscreen | **Three modes: preview (windowed stage) by default; cinema mode (whole display + launcher overlay) and fullscreen (in-game keys only) by choice**, fullscreen with a bindable way back (revised 2026-09-29 after live use, spike [[169]]; cinema mode added 2026-09-30) | Fullscreen covers the launcher, so the timeline was unusable; cinema mode keeps the "like YouTube" control over the full picture |
| Demo key binds | **Maintained in the config profile** (Controls tab), bound by the user | Visible and permanent instead of a launcher silently rebinding keys |
| Timeline controls | Play/pause, ±jump, click-to-seek, **speed**, **position/duration**, **free console commands** | All picked |
| Engine choice | **Auto:** a Q2PRO installation with the demo's game dir (active preferred), overridable; missing game dir → "mod X missing" | No dialog on every play |
| r1q2-only | **r1q2 fallback with a visible hint** ("seeking needs Q2PRO"); `.gz`/MVD2 disabled with reason | Platform-parity rule applied to engines |
| Demos outside the playing installation | **Temporary copy** into its `<gamedir>/demos/`, removed after the game exits | Original stays untouched |
| Zip archives | **Each entry a row, archive read-only**; sidecar/rename disabled with reason | Keeps sidecar naming simple |
| Viewer staging | **2D analyser next; 3D left open** | 2D shares work with the game browser's observer |
| Recording | **Not part of the module** | Browser + viewer only |
| Dashboard tile | **None in v1** | — |

## 4. Tech decisions

| Area | Choice | Rationale |
| --- | --- | --- |
| Demo parsing | A pure TypeScript header parser in the shared/main layer (no native code), gzip via `node:zlib`, zip via a main-side reader | Demos are protocol 34 on disk (§6.1), so the parser needs neither r1q2's `svc_zpacket` nor Q2PRO's stream opcodes; pure code is unit-testable |
| Reference code | **packetflinger/libq2** (Go, Apache-2.0) as the porting reference; aq2replay (MIT) for MVD2/BSP; demoscope has no licence → reference only | License-compatible sources; nothing GPL copied |
| Playback engine | **Q2PRO** `+demo` (never `demomap`) | `demomap` executes stufftext from the demo — a file from a stranger could run commands |
| Remote channel | Linux: `+set sys_console 1` + stdin/stdout; Windows: cfg-polling spike, fallback native helper | §12.3 |
| Persistence | Module settings (extra folders, user patterns, remembered sort) in a module-owned `state.json` key; parse cache in its own app-data file | `home`/`servers` precedent for module keys; the cache can be large and is disposable |
| Tests | Parser, name-pattern engine, precedence resolver, sidecar schema and filter engine are pure modules with unit tests; the fixture serves sample demos from a local folder | Acceptance lives in pure code; no test touches a real installation |

## 5. Core terms & model

- **Demo** — a recorded file: `.dm2` (client-side, one POV) or `.mvd2` (Q2PRO server-side, all
  players), optionally gzip-compressed, optionally inside a zip.
- **Source** — where demos are found: an installation's game-dir `demos/` folder, or an extra folder.
- **Parsed facts** — what the demo content says (map, game dir, players, POV, duration).
- **Name facts** — what a file-name pattern extracts (date, map, players, teams, host…).
- **Sidecar** — `<file>.json` next to the demo, holding only user-entered data.
- **Effective value** — per field, the first of sidecar → parsed → name → file time that has one.
- **Playback session** — one engine process playing one demo, with its remote channel and, if
  needed, a temporary copy.

```
 sources                               main process (replays module)                  renderer
 ┌───────────────────────────┐        ┌──────────────────────────────────────┐       ┌──────────────┐
 │ inst A /baseq2/demos      │  scan  │  walk sources (on open / refresh)    │       │ DemosView    │
 │ inst A /opentdm/demos     │───────►│    │ size+mtime unchanged? → cache   │       │  search      │
 │ inst B /ctf/demos         │        │    ▼                                 │ event │  filters     │
 │ extra: D:\downloads\q2    │        │  header parser ─► parsed facts ──┐   │──────►│  list        │
 │   *.dm2 *.mvd2 *.gz *.zip │        │  name patterns ─► name facts ────┤   │       │  detail+edit │
 │   *.dm2.json  (sidecars)  │◄──────►│  sidecar read/write ─────────────┤   │       │  timeline    │
 └───────────────────────────┘        │  precedence resolver ◄───────────┘   │◄──────│              │
                                       │         │           app-data cache   │invoke └──────────────┘
                                       │  play ──┴─► pick Q2PRO install        │
                                       │            temp copy if needed        │
                                       │            spawn +set game +demo      │
                                       │            remote channel ◄──────────►│ seek/pause/speed/cmd
                                       └────────────┬─────────────────────────┘
                                                    ▼
                                              Q2PRO (native window, in-game binds from config profile)
```

## 6. What a demo file actually tells us

Research of 2026-09-26 against the Q2PRO (`q2pro/q2pro` mirror, commit 601a8df) and r1q2
(`tastyspleen/r1q2-archive`) sources. **[V]** = verified in source/docs, **[I]** = inferred,
untested.

### 6.1 Structure and protocol

- A `.dm2` is a sequence of `[int32 LE length][payload]` blocks, terminated by length `0xFFFFFFFF`.
  Payloads are raw server→client `svc_*` messages. The first block starts with `svc_serverdata`
  (protocol, servercount, attractloop, **gamedir**, **playernum**, level name), then
  `svc_configstring`s, baselines, then frames. [V]
- **Demos on disk are almost always protocol 34.** r1q2 writes `PROTOCOL_ORIGINAL` even over
  protocol 35; Q2PRO writes `min(serverProtocol, 34)`. Exceptions: Q2PRO writes 3434–3436
  ("extended limits", different configstring layout) against extended/rerelease servers, and
  `record -e` / `cl_demomsglen` produce oversized packets that vanilla-limit clients may not play. [V]
- **Consequence:** a demo recorded in r1q2 plays in Q2PRO and vice versa, and the parser only needs
  the protocol-34 opcode set (plus the 343x configstring layout as a known variant).
- `record -z` writes `.dm2.gz`; Q2PRO plays it directly. r1q2 almost certainly cannot. [V]/[I]

### 6.2 Cheap metadata (header only)

| Fact | Source | |
| --- | --- | --- |
| Map | configstring `CS_MODELS+1` (`maps/xxx.bsp`; `CS_MODELS` = 32 in protocol 34) | [V] |
| Level name | `CS_NAME` (0) | [V] |
| POV (recording player) | `CS_PLAYERSKINS + playernum`, up to the first `\` (`CS_PLAYERSKINS` = 1312) | [V] |
| All player names | every `CS_PLAYERSKINS` slot | [V] |
| Game dir | `svc_serverdata` | [V] |

### 6.3 Not in the header — and what follows

- **Date:** not stored. File name if a pattern has it, else file time (creation ≈ start,
  modification ≈ end). [I] → the precedence rule's last rung.
- **Hostname:** not in configstrings; only in some file-name patterns (OpenTDM) or mod print text.
- **Gamemode:** no `deathmatch`/`dmflags` in the demo → pattern + mod heuristic + sidecar (§8.3).
- **Duration — resolved (§17.4):** exact, not estimated. Q2PRO/r1q2 servers tick at a fixed 10 Hz,
  so `durationMs = frames × 100`; the frame count itself comes from decoding every message in every
  block up to (not into) the one `svc_frame`/`mvd_frame` it carries — see §17.4 for the method,
  cost and fixture numbers.
- **Scores:** the POV's frags are `STAT_FRAGS` (index 14); others only via mod-specific `svc_layout`
  or obituary prints. [V]/[I] → not parsed in v1; the sidecar's side result covers it.

### 6.4 MVD2

`MVD2` magic, then `[uint16 LE length][data]` blocks, 0 = end; header `mvd_serverdata` (protocol
37, version 2009–2012, gamedir), then configstrings. Only Q2PRO plays it; it is auto-detected by
`demo`, and seeking uses `seek` (not `mvdseek`; spike 133). [V]

## 7. Where demos come from and how they are named

- **Location:** `<basedir>/<gamedir>/demos/` for both engines [V]. Q2PRO's `homedir` defaults to
  `~/.q2pro` in system-wide Linux builds (distro/Flatpak packages) and to the basedir otherwise [V]
  — the module must scan the installation's effective write directory, not only the root.
- **Shipped patterns** (v1 set, refined by releases):

  | Origin | Pattern | Example | Template | |
  | --- | --- | --- | --- | --- |
  | r1q2 `cl_autorecord 1` | `%Y-%m-%d-%H%M-<map>.dm2` | `2026-09-26-2130-q2dm1.dm2` | `{year}-{month}-{day}-{hour}{min}-{map}.dm2` | [V] |
  | Q2PRO `cl_beginmapcmd` recipe (below) | `<map>_%Y-%m-%d_%H-%M-%S.dm2` | `q2dm1_2026-09-26_21-30-00.dm2` | `{map}_{date}_{time}.dm2` | [V] |
  | OpenTDM (`g_force_record` / `autorecord`) | `<player>-<teamA>-<teamB>-<hostname>-<map>_YYYY-MM-DD_HH-MM-SS`, unsafe characters → `_` | — | `{pov}-{teamA}-{teamB}-{host}-{map}_{date}_{time}` | [V] |
  | AQ2-TNG with `use_mvd2` | `YYYYMMDD-HHMMSS-<map>.mvd2` | `20260926-213000-urban.mvd2` | `{year}{month}{day}-{hour}{min}{sec}-{map}.mvd2` | [V] |
  | Q2PRO `sv_mvd_autorecord` | follows the mod's `record` name, `.mvd2` | — | — | [V] |
  | TastySpleen, Q2Admin | unknown | — | — | [I] → §17.3 |

- Q2PRO has **no autorecord cvar**, but its `cl_beginmapcmd` trigger does the job — a recipe
  circulating among players (2026-09-27) and verified in source [V]:

  ```
  set cl_beginmapcmd "record ${cl_mapname}_${com_date}_${com_time}"
  set com_date_format %Y-%m-%d
  set com_time_format %H-%M-%S
  ```

  - The trigger runs on every map entry, **not during demo playback** (`entities.c`,
    `if (!cls.demo.playback)`); "Changing map" stops the running recording first, so the next
    map's `record` never hits "Already recording" (`main.c` `CL_Changing_f`).
  - The quotes matter: macros are not expanded inside quotes (`cmd.c`
    `Cmd_MacroExpandString`), so the cvar keeps the macros and they expand at map entry.
    `${name}` syntax is supported; `cl_mapname`, `com_date` and `com_time` are registered macros.
  - `com_date_format` already defaults to `%Y-%m-%d`. `com_time_format` defaults to `%H.%M`
    (Windows) / `%H:%M` (else) — minute resolution, and a colon is illegal in Windows file names,
    hence `%H-%M-%S`. It also drives the console clock and the player's own `$com_time` uses.
  - r1q2's `cl_autorecord` names to the minute and opens with `"wb"`: rejoining the same map within
    a minute overwrites the earlier demo. [V]
  - Offering either as a profile setting is story 168.
- Mods can additionally request a client recording through the userinfo `uf` flag. [V]
- **User-defined templates** live in the module settings: a template of named tokens (e.g.
  `{date}_{map}_{p1}_vs_{p2}`) matched against the file name. Token vocabulary, date formats and
  ordering against shipped patterns are §17.2.
- The ambiguity is real: OpenTDM splits on `-`, and team, host and map names can contain `-`
  themselves. A pattern that cannot parse a name unambiguously yields no name facts rather than
  wrong ones.

## 8. Metadata: sidecar, cache and precedence

### 8.1 The sidecar

- File: the demo's full name plus `.json` — `final.dm2` → `final.dm2.json`,
  `20260926-213000-urban.mvd2.gz` → `…mvd2.gz.json`.
- Created **only when the user edits** a demo's metadata. Contains only user-entered fields plus a
  `schemaVersion`.
- Fields: `name`, `description`, `mod`, `gamemode`, `map`, `sides` (each: optional team name,
  optional final result, list of player names), `tags`, `favourite`, `rating` (1–10),
  `date` (override).
- Read defensively: an unknown `schemaVersion` or an invalid field is shown as a sidecar error on the
  demo — never silently dropped, never overwritten without the user saving.
- Moves with the demo on **rename** (both renamed together; a failure on either side leaves both as
  they were).
- **Zip entries have no sidecar** (the action is visible, disabled, with the reason).

### 8.2 The cache

- Parsed facts and name facts per file, keyed by path + size + modification time, in app data.
- Deleting it loses nothing: the next scan rebuilds it.

### 8.3 Precedence and gamemode

- Per field: **sidecar → parsed content → file name → file time** (date only).
- Gamemode additionally takes a **mod heuristic** (e.g. game dir `ctf` → CTF, OpenTDM pattern →
  TDM, two players → duel) after the pattern and before "unknown". A heuristic value is shown as
  **guessed**, distinct from a sidecar or pattern value. The heuristic table itself is §17.5.
- The detail view shows the effective values only, not where each came from — provenance was
  noise to the user (story 177); the precedence above is unchanged.

## 9. Playback research — options weighed

### 9.1 Native engine plus remote control — chosen for v1

- Neither client has client-side rcon; during `.dm2` playback there is no local server to rcon, and
  the client ignores remote `cmd` packets. [V]
- **Q2PRO** controls: `seek [+-]<time|%>` forward and backward (backward via in-memory snapshots
  every `cl_demosnaps` seconds, default 10), `pause`, `timescale` (allowed during playback),
  `scr_demobar`, `cl_demopos`. Demos never change the game dir, so the launcher passes
  `+set game <gamedir>`. `demo` only loads from the Quake file system. [V]
- **r1q2:** `+demomap name.dm2`, **no seek**; `timescale` and `paused` allowed during playback. [V]
- Channels: Linux stdin with `sys_console 1` [V]; Windows console input only via a native
  `AttachConsole`/`WriteConsoleInput` helper [I, fragile]; cfg polling via a self-rescheduling alias
  plus `logfile` for reading position back [V, spike 133] — §12.3.
- Prior art: Quake2.Demoplay (C#, GPL-3.0) and packetflinger/dm2player drive playback through
  generated cfg binds. [V]

### 9.2 WASM engine — deferred, future polish feature (§2)

Researched 2026-09-30. Originally rejected, now **deferred, not rejected**: the reason that killed
Yamagi-based ports no longer holds.

- **Qwasm2** ([GMH-Code/Qwasm2](https://github.com/GMH-Code/Qwasm2), Yamagi, GPLv2) plays
  protocol-34 demos but has no seek, no MVD2, no `.dm2.gz`, and mods need WASM builds. Still ruled
  out.
- **Q2PRO as WASM** — branch `feature-rtx` of
  [MashedD/q2pro](https://github.com/MashedD/q2pro/tree/feature-rtx) (GPLv2, active; last commit
  seen 2026-09-24) has a real Emscripten target: `build-web.sh`, `cross-web.txt`, the `web` branch of
  `meson.build` and `src/unix/video/emscripten.c` (WebGL 2 canvas, fullscreen, pointer lock, DPI).
  The client is Q2PRO's own, so `seek`/`cl_demosnaps` and MVD client playback are in the build [I:
  read from source, never built or run]. The maintainer offered to compile in the common mods (TDM,
  CTF, …).
- **State today:** no published build; `-O0`, `-sASSERTIONS=2`, 512 MB initial heap, Arch-specific
  paths in the script; `baseq2` is preloaded at build time; no README mention; Vulkan renderer off on
  web; no live multiplayer (no UDP) — irrelevant for demos.
- **Possible shape (not decided):** an engine picker next to "Native Q2PRO" — "Browser
  (experimental)", native stays the default. The canvas replaces the placed stage window
  ([[170]]/[[171]]), so Wayland needs no workaround and the Windows cfg-polling loop is not needed;
  the timeline reuses the existing `playback.send` seam through a second channel implementation.
- **To check first:** a `.dm2` plays client-side (no local server, so no game DLL) and MVD2 uses the
  engine's built-in dummy game [I] — if true, demo playback needs **no compiled mods**, only the
  mods' assets. Test an OpenTDM demo in the web build without `gamewasm32.so`.
- **Real work:** feeding the user's PAKs to the engine (renderer is sandboxed, so main would serve
  them, e.g. over a custom protocol; 2 GB heap cap), an optimized pinned build, CSP
  `wasm-unsafe-eval`, and a licence decision on bundling GPL WASM in the app.
- **Ask the maintainer for:** published pinned optimized builds; a small JS API (console command,
  cvar read, runtime file mount); confirmation that seek/`.gz`/MVD2 work without a game library;
  whether the fork tracks upstream Q2PRO.
- **Staging:** spike → asset mounting → embedded stage → engine picker. Not scheduled; see
  [ROADMAP](../ROADMAP.md) "Open / unprioritised".

### 9.3 Custom viewers — staged

- **2D analyser:** full parser with delta state + BSP geometry for the top-down map; estimated parser
  1–2 weeks, UI 2–4 weeks [I]. Next stage.
- **3D viewer (three.js):** BSP v38 + PCX/WAL textures + lightmaps + MD2 + lerping + temp entities;
  aq2replay proves it for AQ2 MVDs; estimated 2–3+ months [I]. Left open. Seeking comes for free
  because it simulates from snapshots; canvas video export would follow naturally.
- Note on the game browser's permanent non-goal "3D view of the game inside the launcher": its
  reasons (WASM ports cannot open UDP, native embedding) are about **live** servers. A renderer fed
  from a local file is not affected by them, which is why 3D stays open here.

### 9.4 Demo to video

Neither engine exports video [V]. Screen capture (`desktopCapturer`/ffmpeg) or a future 3D viewer's
canvas are the only routes. Not in scope.

## 10. The demo list

- **Row:** effective name (sidecar name, else file name), map, mod, gamemode (with "guessed"
  marker), players / sides ("A vs B"), date, duration, format, source (installation + game dir or
  extra folder), favourite, rating, markers for "has sidecar", "sidecar error", "archive entry".
  Final column set is a refine question.
- **Default order:** favourites on top, then newest by effective date. Every column is sortable; the
  choice is remembered.
- **Search:** full-text over sidecar name, description, tags, **player names from every source**
  (sidecar sides, parsed configstrings, name facts), map and file name.
- **Filters:** mod, gamemode, map (dropdowns from existing values, like the server browser's
  `filterOptions`), date (presets + custom from–to), favourite, rating ≥ n, tags. Date presets
  beyond "last 30 days" are §17.6.
- **States:** loading (scan in progress with counts), empty ("no demos found" with a link to the
  source settings), per-source error (folder missing, unreadable).
- **Detail / edit:** the effective values, edited in place (one set of fields, no separate form),
  favourite and star rating one click each, file actions (reveal, copy path, rename). Playing a
  demo is the action bar's primary action on the Demos tab ("View"), not a button in the panel.

## 11. Playback

### 11.1 Choosing the engine

1. Q2PRO installations that have the demo's game dir; the **active** installation is preferred.
2. The user can override the choice for this play.
3. No installation has the game dir → Play is disabled with "Mod `<gamedir>` missing".
4. Only r1q2 installations → **r1q2 fallback**: `+demomap`, timeline shows play/pause/speed only,
   with the visible text "Seeking needs Q2PRO". `.gz`, MVD2, protocol 343x and oversized demos are
   disabled on r1q2 with their reason.

### 11.2 Getting the file into the engine's file system

- A demo already inside the chosen installation's `<gamedir>/demos/` plays in place.
- Anything else — extra folder, other installation, gzip for r1q2, zip entry — is **copied or
  extracted** to `<gamedir>/demos/_launcher/` of the playing installation and **removed after the
  game exits**. The original is never touched.
- Leftovers from a crashed session are cleaned up at the next start (§17.8 for the exact rule).

### 11.3 The launch

`+set game <gamedir>` + the remote-channel setup + `+demo <relative path>`, through the existing
`buildLaunchArgs` `extraArgs` path. **Never `demomap`** on Q2PRO. The demo path is resolved and
validated in main; the renderer only names a demo by its index id.

## 12. The timeline (remote control)

### 12.1 Controls

Play/pause, jump back/forward (step sizes §17.7), click-to-seek on the timeline, speed (timescale),
current position and total duration, and a **free console-command field** that sends a line to the
running engine.

### 12.2 In-game binds

The same actions exist as bindable commands in the **config profile's Controls tab**, so they work in
fullscreen where the launcher is hidden. The user binds them there; the launcher does not rebind keys
on its own. Q2PRO's `scr_demobar` shows the position in-game. What a demo bind means in an r1q2
profile is §17.10.

On Windows the control loop (§12.3) starves every command appended to the engine's command buffer
— typed console lines, key binds, menu actions — for as long as it runs (spike [[169]]). Binds and
`quit` therefore only work while the loop is stopped, i.e. in fullscreen (§12.4). Linux (stdin, no
loop) is not affected.

### 12.4 Preview, cinema mode and fullscreen

- **Preview = the stage (default):** Q2PRO starts with `vid_fullscreen 0`, `win_noborder 1`, `win_notitle 1`,
  `win_alwaysontop 1`, `vid_geometry WxH+X+Y` over an area of the Demos view; live `vid_geometry`
  / `win_alwaysontop` keep it in step with the launcher window. [V, spike 169] Stories [[170]], [[171]].
- **Cinema mode (by choice):** the stage stretched over the whole display the launcher is on
  (still `vid_fullscreen 0`, so the loop keeps running and the launcher keeps control), plus a
  transparent, frameless, always-on-top launcher window over it that takes all mouse and keyboard
  input and shows the controls on mouse movement. Leaving returns to the preview. Unverified —
  spike [[186]], story [[187]]. In-game keys do not reach the game on Windows here, as on the stage.
- **Fullscreen (by choice):** a timeline button sends `vid_fullscreen 1` and stops the loop, so
  binds and the console work; a bindable "back to window" action sends `vid_fullscreen 0` and re-arms
  the loop. [V, spike 169] Story [[172]].
- **Stop:** the timeline ends the demo itself ([[173]]); on the Windows stage the game's own console
  does not reach the game and the launcher says so.

### 12.3 The channel

- **Linux:** `+set sys_console 1`; commands go to stdin, position comes back on stdout. [V]
- **Windows:** **go** — cfg polling works, verified by the [[133]] spike against a pinned Q2PRO
  build (`r3834~601a8df8`); see its recorded result,
  [`spikes/133-q2pro-control/RESULT.md`](../../spikes/133-q2pro-control/RESULT.md), and harness in
  [`spikes/133-q2pro-control/`](../../spikes/133-q2pro-control/). [V, spike 133]
  Mechanism, as verified: a self-rescheduling alias re-`exec`s a launcher-written control file every
  few frames; exactly-once delivery needs an engine-side guard
  (`if $seq != N then "<command>; set seq N; echo ACK N"`); position comes back via
  `echo POS $cl_demopos` into `logfile` (`<gamedir>/logs/`, every line timestamp-prefixed). The
  native helper (`AttachConsole` + `WriteConsoleInput`) is not needed; [[134]] is withdrawn.
- The free command field sends the user's own line to the user's own local game; main still
  validates it as a single printable line with a length cap before it reaches a file or a pipe.

## 13. Platform parity

| Capability | Windows | Linux |
| --- | --- | --- |
| Browse, parse, sidecars, filters | yes | yes |
| Reveal in file manager | `shell.showItemInFolder` | same |
| Q2PRO playback | yes | only where a Q2PRO exists — see [linux-support-analysis.md](../linux-support-analysis.md) B1; otherwise Play disabled with the reason |
| r1q2 fallback | yes | **not available** — no r1q2 on Linux; shown as "Not available on Linux: r1q2 is not supported" where the engine choice would appear |
| Remote timeline | cfg polling (verified by spike 133; native helper not needed) | stdin (verified) |
| Stage (placed borderless window) | yes (verified by spike 169) | X11 expected, unverified; Wayland cannot position windows — reason shown, normal window ([[170]] Q3) |
| Cinema mode (overlay over the game) | spike [[186]] | X11 per spike [[186]]; Wayland — no stage, so the control is disabled with its reason |
| Q2PRO `homedir` = `~/.q2pro` | n/a | scanned as the write directory for distro/Flatpak builds |

Every "no" is visible, disabled and carries its reason as text, per CLAUDE.md.

## 14. Integration with existing systems (architecture notes)

- **Module registration** per [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module):
  `ModuleId` `replays` in `src/shared/types/module.ts` **and** the hardcoded `moduleId` z.enum in
  `src/shared/ipc-schemas.ts`; a manifest with route, `nav: { section: 'primary', order: … }` and the
  `game-lifecycle` capability; main half under `src/main/modules/replays/`, renderer half registered
  in `src/renderer/src/modules/index.ts`, a `settingsSection` for extra folders and user patterns.
- **IPC** through `module:invoke` / `module:event` with module-local zod schemas. Handlers: scan
  start/refresh, list, detail, sidecar read/write, rename, reveal, copy path, extra-folder CRUD,
  pattern CRUD, play, timeline command, stop. Scan progress and playback position are pushed events.
- **Paths:** the renderer never sends a path to open or play; it sends an index id main resolved
  itself. The only renderer-supplied paths are new extra folders (from a native folder dialog) and a
  rename target **name** (not a path), both schema-validated and canonicalized in main.
- **Installations:** read through the installations service; `gameDirs` from `inspector.ts` define
  which `demos/` folders exist. `Installation.moduleData` is not needed.
- **Launch:** `launch:start` with `gameDir` and `extraArgs`; a playback session needs the process's
  stdin/stdout on Linux, which today's `LaunchService` spawns with `stdio: 'ignore'` — a deliberate
  change to the launch service, to be decided in refine.
- **Config:** the demo actions become known bindable commands in the config module's Controls tab.
- **Shared filter engine:** mirror or generalise `src/shared/servers/list-filter.ts`; no date picker
  exists in the renderer yet, so the custom range needs a new component.
- **i18n:** a new top-level `replays` block; demo-provided text (player names, map, level name) and
  sidecar text are data, not prose.
- **Design tokens:** the timeline and dense rows will likely need a deviation row in CLAUDE.md with
  the desktop-only rationale, as with the other dense grids.
- **UI verification:** list states, detail/editor, filters, playback timeline (with a stubbed engine
  process) become `ui:verify` screens and `ui:flow` scripts. The fixture serves demos from a local
  folder; no run launches a real engine.

## 15. Requirements

**Discovery & index**
- DEMO-1 The module lists demos from every installation's game-dir `demos/` folders (and write
  directory), and from every user-added extra folder.
- DEMO-2 `.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz` are recognised; each demo entry inside a `.zip`
  appears as its own read-only row.
- DEMO-3 The index refreshes incrementally when the module opens and on a manual refresh; unchanged
  files (path, size, modification time) are not re-parsed.
- DEMO-4 The parse cache lives in app data and can be deleted without losing any user data.

**Parsing**
- DEMO-5 The header parser extracts map, level name, game dir, POV and all player names from
  protocol-34 `.dm2` (and the 343x variant) and from MVD2, including gzip-compressed files.
- DEMO-6 Duration is shown for every parsable demo (method per §17.4).
- DEMO-7 A file that cannot be parsed still appears, marked as such, with name facts and file time.
- DEMO-8 Shipped name patterns cover r1q2 autorecord, the Q2PRO `cl_beginmapcmd` autorecord
  recipe, OpenTDM and AQ2-TNG; an ambiguous name yields
  no name facts instead of wrong ones.
- DEMO-9 The user can add, edit and remove name templates in the module settings; they apply on the
  next scan.

**Sidecar & precedence**
- DEMO-10 Editing a demo's metadata creates or updates `<file>.json` next to it, containing only
  user-entered fields and a schema version; untouched demos get no sidecar.
- DEMO-11 Sidecar fields: name, description, mod, gamemode, map, sides (team name, result, players),
  tags, favourite, rating 1–10, date override.
- DEMO-12 An invalid or unknown-version sidecar is reported on the demo and never overwritten
  without an explicit save.
- DEMO-13 Effective values follow sidecar > content > name > file time; the detail view shows the
  effective value without its source (story 177).
- DEMO-14 Rename renames demo and sidecar together, atomically from the user's point of view.
- DEMO-15 Sidecar editing and rename are visible but disabled, with the reason, for zip entries.

**List, search, filters**
- DEMO-16 Default order: favourites first, then newest effective date; column sorting is remembered.
- DEMO-17 Full-text search matches sidecar name, description, tags, player names from every source,
  map and file name.
- DEMO-18 Filters: mod, gamemode, map, date (presets incl. last 30 days, custom from–to), favourite,
  rating ≥ n, tags.
- DEMO-19 Loading, empty and per-source error states are explicit.
- DEMO-20 Reveal in file manager and copy path work for every demo.

**Playback**
- DEMO-21 Play picks a Q2PRO installation with the demo's game dir (active preferred); the user can
  override; a missing game dir disables Play with its reason.
- DEMO-22 Playback uses `+set game` and `+demo`, never `demomap`, on Q2PRO.
- DEMO-23 A demo outside the playing installation's file system is copied/extracted to
  `<gamedir>/demos/_launcher/` and removed after the game exits; the original is never modified.
- DEMO-24 With only r1q2 available, playback falls back to `+demomap` with the visible note "Seeking
  needs Q2PRO"; formats r1q2 cannot play are disabled with their reason.
- DEMO-25 On Linux the r1q2 fallback is shown as not available, with its reason.

**Timeline**
- DEMO-26 While a demo plays, the launcher shows play/pause, ±jump, click-to-seek, speed,
  position/duration and a console-command field that act on the running engine.
- DEMO-27 The Windows channel is proven by a spike before any timeline story; if cfg polling fails, a
  native helper provides it.
- DEMO-28 The demo actions are bindable in the config profile's Controls tab and work in fullscreen.
- DEMO-29 Console-command input is validated in main as one printable line with a length cap.
- DEMO-30 By default a demo plays on a stage in the Demos view, with the timeline usable beneath it.
- DEMO-31 Fullscreen is a deliberate choice; in fullscreen binds and the console work, and a bindable
  action returns to the stage.
- DEMO-32 The timeline can end the demo.
- DEMO-33 The launcher's control plumbing does not flood the game console.
- DEMO-34 Cinema mode is a deliberate choice: the demo fills the display and the launcher's own
  controls lie over it, appear on mouse movement and fade out; leaving returns to the preview.

## 16. Sources (research, 2026-09-26)

- Q2PRO source mirror: https://github.com/q2pro/q2pro (commit 601a8df); maintained fork
  https://github.com/MashedD/q2pro — `src/client/demo.c`, `doc/client.asciidoc`, `src/unix/tty.c`,
  `src/server/mvd.c`, `inc/common/protocol.h`
- r1q2: https://github.com/tastyspleen/r1q2-archive — `client/cl_main.c`
- OpenTDM: https://github.com/q2pro/opentdm-sk — `g_tdm_core.c` `TDM_MakeDemoName`
- AQ2-TNG: https://github.com/actionquake/aq2-tng
- Parsers/viewers: https://github.com/packetflinger/libq2 (Apache-2.0),
  https://github.com/vrolse/aq2replay (MIT), https://github.com/programmer1o1/demoscope (no licence),
  https://github.com/neveride84/Quake2.Demoplay (GPL-3.0), https://github.com/GMH-Code/Qwasm2

## 17. Open points

1. **Windows remote channel** — **resolved, go** (spike 133,
   [`spikes/133-q2pro-control/RESULT.md`](../../spikes/133-q2pro-control/RESULT.md)): every AC1
   command took effect with 0 duplicates; position updates every ~85–90 ms and stays correct across
   pause, forward seek and backward seek; no visible disturbance of binds, console typing or FPS.
   Misses against the go bar, accepted for now and carried into [[164]] to tune: p95 latency
   587–701 ms vs. the 300 ms target; CPU cost of the loop was not measured; the loop keeps running
   past the demo's end instead of stopping with it; behaviour across a map change inside a demo is
   untested. The native helper ([[134]]) is withdrawn.
2. **Name-template syntax** — **resolved** (story [[139]], `src/shared/replays/name-template.ts` +
   `name-patterns.ts`):
   - **Token vocabulary.** Text tokens match any non-empty run of characters: `{map}`, `{pov}`,
     `{p1}`, `{p2}`, `{p3}`, `{p4}`, `{p5}`, `{p6}`, `{p7}`, `{p8}`, `{p9}`, `{teamA}`, `{teamB}`,
     `{host}`, and `{skip}` (matches but contributes no fact). Digit tokens are fixed-width: `{year}`
     (4 digits), `{month}`, `{day}`, `{hour}`, `{min}`, `{sec}` (2 digits each). Two shorthands
     expand before validation: `{date}` ≡ `{year}-{month}-{day}`, `{time}` ≡ `{hour}-{min}-{sec}`.
   - **No date-format sub-language.** There is no `%Y`/`strftime`-style syntax to parse — dates are
     spelled out with the fixed-width digit tokens above and literal separators, and the separator is
     always `-`, never `:` (illegal in Windows file names).
   - **Separators are plain literals**, matched ASCII-case-insensitively. Ambiguity — a name that can
     be split more than one valid way along the template — yields no facts rather than a guess; this
     is exactly what happens when a `-` inside an OpenTDM team, host or map name lines up with the
     template's own `-` separators.
   - **Ordering.** Shipped and user-defined templates are one ordered list to the matching engine —
     there is no built-in shipped-vs-user precedence. `parseDemoName` (`name-patterns.ts`) walks the
     list top to bottom and returns the **first pattern that matches uniquely**. An **ambiguous**
     match stops the walk immediately: later, looser patterns are never tried, so an ambiguous
     OpenTDM split can never fall through and be mis-reported under the looser Q2PRO
     `{map}_{date}_{time}` shape. The shipped set (§7) is itself ordered most-specific first —
     OpenTDM, AQ2-TNG, r1q2, Q2PRO recipe — for the same reason; a user template placed above it in
     the list is tried, and can win, before any shipped pattern.
   - **Validity rules** (checked in this order by `compileNameTemplate`, first failure wins): the
     template is not empty; every `{` is closed and every `}` is opened (`unclosedBrace`/
     `strayBrace`); every token name is known (`unknownToken`); an extension (`.dm2`/`.mvd2`) may
     only appear at the very end (`misplacedExtension`); no token is used twice (`duplicateToken`);
     two text tokens never sit directly adjacent with no literal between them
     (`adjacentTextTokens`, since there would be no way to tell where one ends and the other begins);
     the template captures at least one fact (`capturesNothing`); a date is either absent or complete
     — `{year}`/`{month}`/`{day}` all present or none of them (`incompleteDate`); and a time part
     (`{hour}`/`{min}`/`{sec}`) never appears without a complete date, nor `{hour}` without `{min}`
     (`timeWithoutDate`).
3. **Unknown server patterns** — TastySpleen, Q2Admin and the community servers the user plays on;
   to be collected from real sample demos (the user is looking for one). Sample demos as test
   fixtures need a licence/permission check.
4. **Duration cost** — **resolved, exact** (story [[138]]): counted, not estimated. A `.dm2` block
   carries **at most one** `svc_frame`, an `.mvd2` block **at most one** `mvd_frame` — confirmed
   against q2pro `master` (`src/client/demo.c`'s `CL_EmitDemoFrame`, `src/client/parse.c`'s
   `CL_ParseFrame`/`cls.demo.frames_read`, and `src/server/mvd.c`'s `emit_frame`, which is called
   once per server frame and always opens with `mvd_frame`; see `src/shared/demos/dm2-frames.ts`'s
   and `mvd2-frames.ts`'s doc comments for the full per-opcode citation trail). The counter walks
   each block's messages from the start until it meets the frame message (count it, next block) or
   one that cannot precede a frame in that block; every other message is sized and skipped, so a
   mis-sized field fails loudly (`undecodable`) instead of silently drifting the count. At 10 Hz,
   `durationMs = frames × 100`.

   A block-count estimate was considered (skip decoding entirely, one block ≈ one frame) but
   rejected: not because it was measurably inaccurate — on both real fixtures below it lands
   exactly on the true count — but because story [[165]]'s seek bar needs frame-accurate seeking,
   not an approximation that happens to usually be right. The scan budget (32 MiB read cap, 64 KiB
   stream chunks, ≤1000 ms wall time, ~30 ms/MiB target) comfortably covers full decode: a
   prototype measured ~0.2 ms/MiB of decode work, so I/O dominates the budget, not parsing.

   Fixture numbers (`docs/fixtures/demos/`): `test.dm2` → 410 frames, 41.0 s; the PFAU
   `.mvd2` → 6201 frames, 10:20. Implementation: `src/main/lib/demo-bytes.ts`'s `readDemoDuration`
   (streams the file, gzip-transparent, same sniffing as the header readers), backed by
   `src/shared/demos/{dm2,mvd2}-frames.ts` and `frame-count.ts`.
5. **Gamemode heuristic table** — **resolved** (story [[149]], `src/shared/demos/gamemode.ts`):
   `resolveGamemode` tries, in order, a non-blank sidecar value, a non-blank name-fact value, then
   the ordered `GAMEMODE_HEURISTICS` table (first match wins, all three rules yield
   `source: 'guessed'`), else unknown. The table: (1) `gameDir` is `ctf` (case-insensitively) →
   `ctf`; (2) exactly two known players → `duel`, checked before OpenTDM so a two-player OpenTDM
   match still guesses `duel`; (3) the matched name pattern is the shipped OpenTDM pattern
   (`OPENTDM_PATTERN_ID`, re-exported from `name-patterns.ts`) or `gameDir` is `opentdm` → `tdm`. A
   sidecar/name value equal to a known id case-insensitively is normalised to that id; any other
   value passes through as free text. `describeGamemode` turns the result into a label key (known
   id or `unknown`) or literal text, plus a `guessedKey` marker present only for `source: 'guessed'`
   — so a guessed value is visibly distinct from a reported one, per this story's title.
   `gamemodeFilterMatches`/`gamemodeFilterOptions` give the demo browser's gamemode filter an
   `excludeGuessed` toggle that drops guessed rows even under "any".
6. **Date presets** — beyond "last 30 days" (today / 7 / 90 days / year?) and which date the filter
   uses when only file time is known.
7. **Jump step sizes and speed steps** — placeholders (±10 s / ±60 s, 0.25×–4×) until decided.
8. **Temporary copy cleanup** — exact rule after a crash (sweep `_launcher/` at startup? only files
   the launcher recorded?), and behaviour when the target is not writable.
9. **MVD2 playback** — **resolved** (story [[162]], `src/shared/replays/demo-control.ts`): the
   launcher does not pick the followed player and offers no POV choice; Q2PRO's own in-game
   controls (`cmd invnext` / `cmd invprev` / `cmd chase`) switch it. The timeline sends `seek` for
   both formats (`mvdseek` is not used; spike 133).
10. **Demo binds in r1q2 profiles** — seek does not exist in r1q2; hide those actions in r1q2
    profiles, or show them disabled with the reason?
11. **Sidecar writes into read-only locations** (e.g. `Program Files` installations) — error only, or
    an alternative location? The "filesystem is master" rule argues against a fallback store.
12. **Scanning while the game runs** — allowed (the game may be writing a demo right now), deferred,
    or skipping files still being written?
13. **Rename while that demo is playing** — block with reason, or allow?
14. **Launch service stdio** — `LaunchService` spawns with `stdio: 'ignore'`; how a playback session
    gets its pipe without changing normal launches.
15. **Hostname / server facts** — only from OpenTDM names today; whether the sidecar should carry a
    server field later (offered, not selected in v1).
16. **Module label and nav order** — "Demos" is decided as the label; icon and nav position are not.
