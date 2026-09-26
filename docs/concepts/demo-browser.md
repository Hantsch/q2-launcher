# Demo Browser — Library, Metadata and Remote-Controlled Playback — Concept

Status: **Draft** (vision + requirements, no stories yet). This document fixes what the launcher's
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
  (play/pause, ±jump, click-to-seek, speed, position/duration, free console commands). In-game key
  binds cover fullscreen; those binds live in the **config profile**, not in a launcher overlay.
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
- **A WebAssembly Quake II engine inside the launcher.**
  > Researched (§9.2): Qwasm2/Yamagi has no seek, mods would have to be compiled to WASM, and it
  > bundles GPL code into the app. It solves nothing the native Q2PRO does not solve better.
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
| Fullscreen | **Both:** launcher timeline **and** in-game key binds | Fullscreen covers the launcher |
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
- **Duration:** Q2PRO emits 10 Hz demo frames, so duration ≈ `svc_frame` count × 100 ms. An exact
  count needs decoding every message (they carry no own length), but not entity state. A cheap
  estimate is about one block per frame. [V]/[I] → open point §17.4.
- **Scores:** the POV's frags are `STAT_FRAGS` (index 14); others only via mod-specific `svc_layout`
  or obituary prints. [V]/[I] → not parsed in v1; the sidecar's side result covers it.

### 6.4 MVD2

`MVD2` magic, then `[uint16 LE length][data]` blocks, 0 = end; header `mvd_serverdata` (protocol
37, version 2009–2012, gamedir), then configstrings. Only Q2PRO plays it; it is auto-detected by
`demo`, and seeking uses `mvdseek`. [V]

## 7. Where demos come from and how they are named

- **Location:** `<basedir>/<gamedir>/demos/` for both engines [V]. Q2PRO's `homedir` defaults to
  `~/.q2pro` in system-wide Linux builds (distro/Flatpak packages) and to the basedir otherwise [V]
  — the module must scan the installation's effective write directory, not only the root.
- **Shipped patterns** (v1 set, refined by releases):

  | Origin | Pattern | Example | |
  | --- | --- | --- | --- |
  | r1q2 `cl_autorecord 1` | `%Y-%m-%d-%H%M-<map>.dm2` | `2026-09-26-2130-q2dm1.dm2` | [V] |
  | OpenTDM (`g_force_record` / `autorecord`) | `<player>-<teamA>-<teamB>-<hostname>-<map>_YYYY-MM-DD_HH-MM-SS`, unsafe characters → `_` | — | [V] |
  | AQ2-TNG with `use_mvd2` | `YYYYMMDD-HHMMSS-<map>.mvd2` | `20260926-213000-urban.mvd2` | [V] |
  | Q2PRO `sv_mvd_autorecord` | follows the mod's `record` name, `.mvd2` | — | [V] |
  | TastySpleen, Q2Admin | unknown | — | [I] → §17.3 |

- Q2PRO itself has **no client-side autorecord**; mods request it through the userinfo `uf` flag. [V]
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
- The detail view shows where each effective value came from (sidecar / demo / name / file / guessed).

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
  plus `logfile` for reading position back [I, untested] — §12.3.
- Prior art: Quake2.Demoplay (C#, GPL-3.0) and packetflinger/dm2player drive playback through
  generated cfg binds. [V]

### 9.2 WASM engine — rejected (§2 non-goal)

Qwasm2 (Yamagi, GPLv2) plays protocol-34 demos but has no seek; mods need WASM builds; bundling GPL
code raises licensing questions.

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
- **Detail / edit:** all effective values with their source, the sidecar editor, file actions
  (reveal, copy path, rename), Play.

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

### 12.3 The channel

- **Linux:** `+set sys_console 1`; commands go to stdin, position comes back on stdout. [V]
- **Windows:** **first story is a spike** of cfg polling — an alias that re-execs a launcher-written
  control file every few frames, position read back through `logfile`. If the spike fails, a
  **native helper** (`AttachConsole` + `WriteConsoleInput`) is built. [I]
- The free command field sends the user's own line to the user's own local game; main still
  validates it as a single printable line with a length cap before it reaches a file or a pipe.

## 13. Platform parity

| Capability | Windows | Linux |
| --- | --- | --- |
| Browse, parse, sidecars, filters | yes | yes |
| Reveal in file manager | `shell.showItemInFolder` | same |
| Q2PRO playback | yes | only where a Q2PRO exists — see [linux-support-analysis.md](../linux-support-analysis.md) B1; otherwise Play disabled with the reason |
| r1q2 fallback | yes | **not available** — no r1q2 on Linux; shown as "Not available on Linux: r1q2 is not supported" where the engine choice would appear |
| Remote timeline | cfg polling (spike) or native helper | stdin (verified) |
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
- DEMO-8 Shipped name patterns cover r1q2 autorecord, OpenTDM and AQ2-TNG; an ambiguous name yields
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
- DEMO-13 Effective values follow sidecar > content > name > file time; the detail view shows each
  value's source; heuristic gamemodes are marked "guessed".
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

1. **Windows remote channel** — result of the cfg-polling spike (commands in, position out via
   `logfile`); if it fails, the native helper's build, packaging and signing per architecture.
2. **Name-template syntax** — token vocabulary (`{date}`, `{time}`, `{map}`, `{p1}`, `{teamA}`,
   `{host}`, `{pov}`…), date formats, separators that also occur inside values, and whether user
   templates are tried before or after shipped ones.
3. **Unknown server patterns** — TastySpleen, Q2Admin and the community servers the user plays on;
   to be collected from real sample demos (the user is looking for one). Sample demos as test
   fixtures need a licence/permission check.
4. **Duration cost** — exact frame count (full message decode, no entity state) at scan time vs. the
   block-count estimate; measure on real demos before deciding.
5. **Gamemode heuristic table** — which game dirs, pattern hits and player counts map to which mode.
6. **Date presets** — beyond "last 30 days" (today / 7 / 90 days / year?) and which date the filter
   uses when only file time is known.
7. **Jump step sizes and speed steps** — placeholders (±10 s / ±60 s, 0.25×–4×) until decided.
8. **Temporary copy cleanup** — exact rule after a crash (sweep `_launcher/` at startup? only files
   the launcher recorded?), and behaviour when the target is not writable.
9. **MVD2 playback** — which player Q2PRO follows by default, whether the launcher offers a POV
   choice, and `mvdseek` vs. `seek` on the timeline.
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
