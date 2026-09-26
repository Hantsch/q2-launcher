# Game Browser — Server List, Detail, Watchlist and Observing — Concept

Status: **Draft** (vision + requirements, no stories yet). This document fixes what the launcher's
game browser becomes: a new top-level module that discovers Quake II servers from configurable
master sources, queries them over UDP, lists them by activity, and shows what is going on inside one
server. It also fixes three things that reach beyond the browser itself — a launcher-wide
**experimental-features mechanism gated by signed unlock codes**, the **address-book write** into a
config profile, and the **platform-parity rule** for features that cannot exist on Linux. Everything
here comes from the requirements interview of 2026-09-22 plus the protocol research recorded in §6;
nothing was inferred.

This document follows the architecture rules in [CLAUDE.md](../../CLAUDE.md): a feature is a module
(here: `servers`), the IPC contract is written in `src/shared/ipc.ts` / the module contract first,
every renderer-supplied payload carries a zod schema, and no bundled image assets enter the UI. It
builds on the existing launch path
([launch-plan.ts](../../src/main/services/launch-plan.ts)'s `buildLaunchArgs`, which already carries
a `connect` input earmarked for exactly this feature), the `config` module
([config-module.md](../systems/config-module.md)), the `home` module's settings-section and
event-push precedents, and the module seam described in
[ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module).

---

## TL;DR

- **Vision:** "where is something going on right now, and who is playing where" — a window you open
  to find *people*, not to browse infrastructure.
- **Discovery is configurable.** A user-editable list of master sources (UDP masters and the
  q2servers.com HTTP list) with shipped defaults, plus manually added servers and favourites.
- **Scanning is two-stage and streaming:** a cheap `info` sweep fills the list within a second, a
  full `status` query fetches players. Results appear as they arrive; nothing waits for the slowest
  server.
- **Default order: favourites pinned on top, then occupancy** (busy servers first), with gamemode as
  a second dimension. No server is hidden by default.
- **"Who is waiting for an opponent" is a first-class signal** — a server with exactly one player is
  marked, because that is one of the two reasons the browser exists.
- **The detail view shows everything the server tells us:** players with score and ping, the full
  serverinfo rule table (known keys formatted, mod-specific keys raw), `dmflags` decoded, a ping
  history, and whether the map and mod exist locally.
- **Joining** uses the active installation with `+connect`, warns before a mod mismatch, and asks
  for a password up front. A server can also be **written into a config profile's address book**
  (`adr0`–`adr8`) through a dialog that names the profile and the slot.
- **The watchlist** is its own list: per entry a name and a match mode (exact / substring / regex);
  it shows `offline` or the server, score and ping, with a Join action. **Spectator vs. player is
  not shown** — the protocol does not carry it (§6.4). It costs the scan **nothing**: it matches
  against the details a normal scan already fetched, and re-checks an entry by querying only the one
  server that player was last seen on.
- **Refreshes are scoped** — all servers, favourites only, or a single server — so nothing reloads
  that does not need to. Whether that is even necessary is a question for the first measurement, not
  for the concept.
- **The watchlist ships hidden.** A launcher-wide experimental-features mechanism gates it behind a
  **signed unlock code** that names the features it unlocks, is **bound to one installation**, and
  must be redeemed inside a **short window**. Without a valid code the feature does not exist in the
  UI at all. One-time use is impossible offline — device binding is the answer instead, and the
  clock-tampering hole is documented rather than papered over.
- **Observing:** v1 is a one-click **spectator launch** of the real game. A **2D in-launcher
  observer** (live scoreboard, chat, top-down radar, deliberate self-identification) is fully
  specified here as the **next stage**, not built in v1. A 3D picture inside the launcher is a
  permanent non-goal — §14.3 says why.
- **Platform parity becomes a general rule** in CLAUDE.md: a feature that cannot work on Linux stays
  visible, disabled, with its reason as visible text. The game browser itself has no known platform
  delta — `node:dgram` is platform-neutral.
- Biggest open points: the concrete scan budget defaults, the master-reply multi-datagram stop
  condition, regex-matching safeguards, and the final module id/label.

---

## 1. Vision

The launcher can install Quake II, configure it and start it. What it cannot do is answer the only
question a player actually has before playing: **is anyone out there, and where?**

The game browser answers it in two directions:

- **"Where is something going on?"** — open it, and the busy servers are at the top. Not an
  alphabetical directory of mostly-empty infrastructure, but an activity view: who has players, what
  are they playing, and — the specific case that matters in a small community — **where is one
  person sitting alone on a duel server waiting for an opponent**.
- **"Where is *this* person?"** — the watchlist. You keep a handful of names, and the browser tells
  you which server each of them is on, or that they are offline. That is the moment the feature
  exists for: you see the name light up, and you either go watch them or go play them.

Everything else the browser does — favourites, history, filters, the rule table, the address-book
write — exists to serve those two questions without making you leave the launcher and open a
website.

The browser is not a management tool. Curating favourites and bookkeeping are things it supports,
not things it asks of you. The default state is: open it, look at it, join something.

## 2. Scope

### In scope (v1)

- A new module `servers` (main + renderer halves) with a **primary nav entry** and its own route.
- **Discovery** from a user-configurable list of master sources, with shipped defaults, a UDP master
  client and the q2servers.com HTTP list as source types.
- **Manually added servers** (`ip:port`) for anything not on a master.
- **Favourites**, always queried and always pinned to the top of the list.
- **History** of servers the launcher itself connected to.
- A **two-stage, streaming scan**: `info` sweep → `status` fetch, with visible progress.
- **Scan settings** (auto-scan on open, auto-refresh interval, concurrency, timeouts) in the
  module's settings section, with shipped defaults the user can change.
- **No scanning while the game is running**, in any mode.
- The **server list**: name, mod, players/slots, map, measured ping, password and gamemode markers,
  a "waiting for an opponent" marker, sorting, filters and search.
- The **server detail view**: player list (name, score, ping), the full serverinfo rule table,
  decoded `dmflags`, ping history for the session, and map/mod availability locally.
- **Join** with the active installation, mod-mismatch warning, password prompt.
- **Spectator launch** — join the real game as a spectator in one action.
- **Write to address book** — a dialog that writes the server into a chosen config profile's chosen
  `adr0`–`adr8` slot.
- A launcher-wide **experimental-features mechanism**: device-bound signed unlock codes with a
  redemption window, an installation id and a code entry field in Settings, main-side verification,
  and the rule that a locked feature is invisible.
- The **watchlist**, behind that gate: entries with a match mode (exact / substring / regex), a
  found/offline list, and per-entry actions including Join.
- The **platform-parity rule** in CLAUDE.md, and the shared UI treatment it prescribes.

### Deliberately not in v1

- **The 2D in-launcher observer** (§14.2) — specified here in full, built later.
  > Rationale: it is a Quake II client implementation (challenge/connect handshake, netchan,
  > `svc_*` parsing, delta entities). It is bigger than the whole rest of this milestone and it can
  > be added without changing anything the browser already does. Shipping the browser first means
  > the observer starts from a working server list instead of blocking it.
- **Notifications when a watched player appears.**
  > Rationale: a notification needs background scanning and a before/after state; the interview
  > deliberately chose a list you look at over a thing that interrupts you. Revisit once the
  > watchlist has been used in practice.
- **A dashboard tile** ("who is online", "favourites").
  > Rationale: the home concept explicitly keeps planned modules off the dashboard; the browser
  > earns a tile once it exists and someone misses it.
- **Spectator/player distinction in the list and the watchlist.**
  > Rationale: the `status` response does not carry it (§6.4). It arrives with the 2D observer,
  > which reads the server's real scoreboard layout — not before, and not as a guess.
- **Server-side statistics, rankings, uptime history across sessions.**
  > Rationale: that is a tracker, not a browser; sites like GameTracker already do it and it would
  > mean persisting a time series.
- **Mod/map download from the detail view.**
  > Rationale: the detail view can say "you do not have this mod"; installing it belongs to the
  > `mods` and `assets` modules, which do not exist yet.

### Non-goals (permanent)

- **A 3D view of the game inside the launcher.**
  > It means shipping an engine inside an Electron app. The browser-based ports (Qwasm2,
  > WebQuake2) cannot open UDP sockets and need a WebSocket proxy, so they cannot reach a real
  > server at all; embedding a native engine window (`SetParent` / X11 reparenting) is fragile,
  > needs native code and is impossible on Wayland. Observing in the launcher means observing
  > *data*.
- **The launcher never pretends to be a human player.** An observer connection identifies itself as
  a launcher observer; it does not take a player-looking name to blend in, and it never sends
  movement, chat or commands to a server.
  > A tool that connects to other people's servers has to be recognisable from the server's side.
  > Anything else makes the launcher indistinguishable from a scraping bot and gets it banned —
  > correctly.
- **No scanning while a game is running.**
  > Explicitly decided in the interview. The launcher must not compete with the game for the
  > network path or the CPU while someone is playing.
- **No image assets in the UI.** Map thumbnails, mod logos and server banners are not fetched and
  not bundled; the browser is CSS/inline SVG like the rest of the app.
  > CLAUDE.md's rule. The two recorded deviations (installation icons, feed images) are specific and
  > this is not one of them.

## 3. Design decisions taken (from the requirements interview)

| Topic | Decision | Rationale (user's) |
| --- | --- | --- |
| Purpose | "Wo ist gerade was los" + "wer spielt wo" over the watchlist | The two questions the browser exists for |
| Placement | Own module, **primary** nav entry | Same level as Library and Config |
| Master sources | **User-configurable list** with shipped defaults | "falls ein master stirbt" — not dependent on one website |
| Scan trigger | Auto on open **and** auto-refresh on an interval, **both configurable in settings**, manual always available | The user decides how aggressive it is |
| Scan shape | **Two-stage** (header query first, details after) and **asynchronous/streaming** | "damit es schnell und performant ist" |
| Scanning while playing | **Never**, in any mode | "kein autoscan während das spiel läuft auf jeden fall" |
| Scan budget (concurrency, timeouts, minimum refresh spacing) | Settings with shipped defaults | "das soll der user selber entscheiden" |
| Default sort | **Favourites pinned on top, then occupancy**, with gamemode as a second dimension | "server mit auslastung … favouriten immer on top" |
| Default filter | **None** — every server is shown | Chosen over hiding empty servers |
| List row | Name, mod, players/slots, map, measured ping | The four asked for, plus map and ping which cost nothing |
| "Waiting for an opponent" | A first-class marker on servers with exactly one player | "wo wartet wer auf einen gegner" |
| Detail content | Players; **full serverinfo rule table**; **decoded dmflags**; **ping history**; **map/mod availability locally** | All four picked |
| Join | Active installation + `+connect`, **warning on mod mismatch**, password asked up front | Fails loudly instead of silently |
| Address book | Dialog with **profile choice and slot choice** (`adr0`–`adr8`, occupied slots show their value) | Full control over nine slots |
| v1 extras | Favourites, manual `ip:port`, history, filters & search, address-book write | All five picked |
| Watchlist shape | **Its own list UI**: per entry either `offline` or the server, with score and ping, and an action menu with Join | "watchlist ist eine eigene liste wo der name steht" |
| Watchlist matching | **Per entry selectable**: exact, substring, **or regex** | Per-entry control, regex for the hard cases |
| Watchlist scan cost | **None** — the watchlist matches against the details a normal scan produces; a re-check queries only the server an entry was last seen on | "die watchlist muss nicht hard sein … man muss keinen neuen scan machen" |
| Refresh granularity | Scoped refreshes (all / favourites / one server) instead of always reloading everything | "damit man nicht immer alles neu laden muss" |
| Performance tuning | **Measure before optimising** — build it, load ~100 servers with details, then decide whether any of this needs solving | "wenn das nämlich ca 300ms sind dann braucht man darüber nicht diskutieren" |
| Spectator vs. player | **Not shown** — only what the protocol actually carries | Accepted after the protocol limitation was raised |
| Favourites / history / watchlist scope | **Global to the launcher**, not per installation | It is about finding people, not managing setups |
| Watchlist in release | **Hidden behind an experimental-features gate** | Should not roll out yet, but be there optionally |
| Gate mechanism | **Signed unlock code that names the features it unlocks**, optional expiry, issued by the maintainer | Different codes for different testers |
| Code reuse | **Device-bound**: the token names the installation it was issued for and is refused anywhere else | One-time use is impossible offline; binding beats it for the actual goal — a forwarded code simply does not work |
| Code activation | A **short redemption window** (issued-at + redeem-by); after redemption the window no longer matters | "um die chance zu verringern damit ein code weitergegeben wird" |
| Clock tampering | **Not defended against**, documented as a known limit | Consistent with the whole mechanism being gatekeeping, not security |
| Locked feature visibility | **Invisible** — no tab, no hint, only an unobtrusive code field in Settings | "niemand fragt nach etwas, das er nicht sieht" |
| Observing in v1 | **Spectator launch** of the real game | Cheap, works everywhere |
| Observing, next stage | **2D in-launcher observer**: live scoreboard, chat/server messages, top-down radar, controllable self-identification | All four picked; specified here, built later |
| Platform support | **Windows and Linux**, Windows first (~80% of users) | Standing rule from now on |
| Unavailable-on-Linux features | **Visible, disabled, with the reason as visible text** — never silently dropped | "nicht einfach stillschweigend weggelassen" |

## 4. Tech decisions

| Area | Choice | Rationale |
| --- | --- | --- |
| Server queries | `node:dgram` in **main**, first UDP use in this repo | The renderer has no network path; the production CSP stays `connect-src 'self'` |
| HTTP master source | The same main-side fetch approach the news feed uses | One network layer, already proven |
| Scan orchestration | A module-owned scheduler with an explicit concurrency limit and per-request timeout, results pushed as they arrive | No generic retry/concurrency helper exists in the repo yet; this one is module-local until a second consumer needs it |
| Result transport | `module:event` push (the `jobs:changed` pattern), not polling from the renderer | Main owns the state, the store applies what main pushes |
| Unlock code format | A compact signed token (payload + detached signature, Ed25519 via `node:crypto`), public key embedded in the app, verified **in main only**, re-verified on every start | Offline verification, expiry works without a server, the renderer never decides what is unlocked |
| Persistence | A new top-level `state.json` key owned by the module (favourites, history, custom servers, watchlist, scan settings); the unlock token gets its own launcher-level key | `LauncherSettings` is a closed shape; the `home` layout set the precedent for module-owned keys |
| `dmflags` decoding | A table in the launcher, marked as "vanilla meaning; mods may reuse bits" | The bits are not standardised across mods |
| Tests | The protocol codecs (query build, response parse, infostring split, player-line parse, master record unpack), the sort/filter engine, the matcher and the token verifier are pure, unit-tested modules; the UDP socket is behind an injectable seam like `FetchImpl` in `downloads/fetcher.ts` | The acceptance criteria live in pure code, not in a live network |

## 5. Core terms & model

- **Master source** — something that returns a list of server addresses. Two types: a UDP master
  (`master.q2servers.com`, `master.quakeservers.net`) and an HTTP list (q2servers.com `?raw=1`).
- **Server entry** — one address plus its origin (master / favourite / manual / history) and its last
  known state.
- **Header query** (`info`) — the cheap stage-1 query: enough for a list row.
- **Status query** (`status`) — the full stage-2 query: serverinfo plus the player list.
- **Scan** — one pass: resolve the sources, stage-1 sweep, stage-2 fetch, streaming into the list.
- **Serverinfo** — the backslash-delimited key/value string a server reports. Open-ended.
- **Occupancy** — current players against `maxclients`; the default sort key.
- **Watchlist entry** — a name plus a match mode. Not a person; the protocol has no identity.
- **Experimental feature** — a named capability that exists in the build but is invisible without a
  valid unlock code naming it.
- **Observer** — v1: the real game started in spectator mode. Stage B: a launcher-side protocol
  client that renders data, never a 3D picture.

```
  master sources (configurable)                Q2 Launcher
  ┌──────────────────────────────┐            ┌──────────────────── main process ───────────────┐
  │ udp master.q2servers.com     │  UDP 27900 │  servers module                                 │
  │ udp master.quakeservers.net  │───────────►│   resolve sources → address set                 │
  │ http q2servers.com?raw=1     │  HTTPS     │            │                                    │
  └──────────────────────────────┘            │            ▼  stage 1: info  (concurrency-capped)│
                                              │      ┌─────────────────┐                        │
  game servers                                │      │  scan scheduler │  stage 2: status       │
  ┌──────────────────────────────┐   UDP      │      └────────┬────────┘                        │
  │  FF FF FF FF info <ver>      │◄───────────│               │ parse + validate                │
  │  FF FF FF FF status          │───────────►│               ▼                                 │
  │  FF FF FF FF print\n\k\v…    │            │      favourites · history · custom · watchlist   │
  └──────────────────────────────┘            └───────────────┬─────────────────────────────────┘
                                                              │ module:event (streamed results)
                                              ┌───────────────▼─────────────── renderer ────────┐
                                              │  ServersView                                    │
                                              │  ┌── list ──────────────────────────────────┐   │
                                              │  │ ★ fav · busy first · duel-waiting marker │   │
                                              │  └──────────────────────────────────────────┘   │
                                              │  ┌── detail ────────────────────────────────┐   │
                                              │  │ players · rules · dmflags · ping · local │   │
                                              │  └──────────────────────────────────────────┘   │
                                              │  ┌── watchlist (gated, invisible by default)┐   │
                                              │  └──────────────────────────────────────────┘   │
                                              └───────────────┬─────────────────────────────────┘
                                                              │ launch:start { connect }   state.json
                                                              ▼                            (module key)
                                                        r1q2 / Q2PRO
```

## 6. What a Quake II server actually tells us

This section is research, not decision. It is written down because every display decision above
depends on it, and because "the protocol does not carry that" settled a question in the interview.

### 6.1 The two server queries

Both are connectionless UDP datagrams beginning with the four bytes `FF FF FF FF`:

| Query | Sent | Reply | Use |
| --- | --- | --- | --- |
| `status\n` | to the game port | `print\n` + one serverinfo line + one line per player | Stage 2 — the only query that carries player names |
| `info <protocol>` | to the game port | `info\n` + a short infostring (hostname, map, clients, maxclients) | Stage 1 — small, fast, enough for a list row |
| `ping` | to the game port | `ack` | Pure reachability / round-trip measurement |

The `status` reply's shape:

```
\xFF\xFF\xFF\xFFprint\n
\hostname\My Server\mapname\q2dm1\maxclients\16\...\n
12 45 "PlayerOne"
3 88 "[clan]PlayerTwo"
```

### 6.2 Serverinfo keys

The key set is **open-ended**: a cvar appears here only if it carries the `CVAR_SERVERINFO` flag, so
every mod contributes its own. Keys seen in practice:

| Key | Meaning | Used by us for |
| --- | --- | --- |
| `hostname` | Server name | List row |
| `mapname` | Current map | List row, local-availability check |
| `gamename` / `gamedir` / `game` | Mod directory | List row (mod), mod-mismatch warning |
| `maxclients` | Slot count | Occupancy |
| `protocol` | 34 vanilla, 35 r1q2, 36 Q2PRO | Engine hint, query compatibility |
| `version` | Engine build string | Detail |
| `port` | UDP port | Detail |
| `needpass` | Bit 0 = password, bit 1 = spectator password | Password marker, join flow |
| `deathmatch`, `coop`, `ctf`, `teamplay` | Gamemode flags | Derived gamemode |
| `dmflags` | Bitfield of rule switches | Decoded rule list |
| `fraglimit`, `timelimit`, `capturelimit` | Match limits | Detail |
| `cheats` | Cheats enabled | Detail |
| `maptime`, `uptime` | How long the map / server has run | Detail |
| `gamedate` | Mod build date | Detail |
| anything else | Mod-specific (`actionversion`, `matchmode`, `roundlimit`, …) | Shown raw in the rule table |

**Every key is optional.** `gamename` is frequently absent on plain baseq2 servers, `version` is not
guaranteed. The parser treats the whole set as optional and degrades per field.

### 6.3 Player lines

Exactly three values per player: **score (frags), ping, name**. Nothing else. No team, no client id,
no skin, no model, no connection time, no spectator flag.

Names may contain the high-bit "green" character set, arbitrary punctuation and clan tags; they are
not unique and not an identity. A bot typically reports ping `0`, but so can a listen-server host.

### 6.4 What is *not* available — and what follows from it

- **Spectator vs. player is not derivable.** Some mods list spectators with score 0, some omit them
  entirely, and neither case is distinguishable from a player who has not scored yet. Decided: the
  launcher shows score and ping and says nothing about spectating until the 2D observer (§14.2) can
  read the server's real scoreboard layout.
- **Teams are not derivable** on a plain `status` query — same reason, same resolution.
- **The watchlist is bounded by what stage 2 fetched.** Player names exist only in the `status`
  reply, so the watchlist can only know about servers whose details were actually fetched. It is
  therefore **best-effort, not exhaustive**: it matches against the detail data a normal scan
  produced, and it re-checks a found player by re-querying *that one server*, not by sweeping the
  whole list again. A watched player who moves to a server nobody fetched details for shows as
  `offline` until the next scan reaches that server — and that is accepted (§12).
- **Response size.** A `status` reply from a well-populated 32-slot server can approach or exceed a
  typical MTU. A truncated or dropped reply is treated as "no player data this round", never as
  "zero players".

### 6.5 Master sources

- **UDP master**, port 27900: send `\xFF\xFF\xFF\xFFquery\0`, receive `\xFF\xFF\xFF\xFFservers `
  followed by packed records of 4 bytes IPv4 + 2 bytes big-endian port. The reply **may arrive as
  several datagrams with no explicit terminator** — the stop condition is an open point (§18.2).
- **HTTP list**, q2servers.com: `?raw=1` (text) or `?raw=2` (binary), optionally scoped to a game.
  No socket handling, no fragmentation, but a single website as a dependency — which is exactly why
  the source list is user-configurable.

Sources for this section are listed at the end of the document.

## 7. Discovery and scanning

### 7.1 Sources

The module ships with a default source list and the user edits it in the module's settings section:
add, remove, reorder, enable/disable, per entry a type (`udp-master` / `http-list`) and an address.
A source that fails is reported in the scan result, does not abort the scan, and the rest of the
sources still contribute.

The address set for a scan is the union of: every enabled source's result, every favourite, every
manually added server, and (as a decision to make in §18.4) the history.

### 7.2 The two stages

1. **Stage 1 — `info` sweep.** Every address in the set, concurrency-capped. Each reply produces a
   list row immediately: name, map, players/maxclients, and the measured round-trip time. The list
   is usable while the sweep is still running.
2. **Stage 2 — `status` fetch.** Full player data. Fetched for: the selected server, and every
   server stage 1 did not positively report as empty (so the occupancy sort, the duel marker and the
   watchlist all work off the same data). A *known* zero-player reply is not asked twice; a reply
   whose player count could not be read at all (e.g. a very long hostname truncating the classic
   `info` summary line) is treated as worth checking rather than assumed empty, since `status`'s
   uncapped infostring can recover what `info` could not.

Both stages stream: every result is pushed to the renderer as it arrives (`module:event`), and the
view shows how far the scan has got. No stage waits for a slow or dead server; a timeout marks that
server unreachable for this round and keeps its previous known state visible, flagged as stale.

**The watchlist does not change any of this.** It matches against whatever stage 2 produced; it
never forces a wider or a second sweep (§12).

### 7.2.1 Scoped refreshes

Not every update is a full scan. The view offers narrower refreshes so nothing reloads that does not
need to:

- **Refresh servers** — the full pass described above.
- **Refresh favourites** — stage 1 + stage 2 for the favourites only.
- **Refresh this server** — a single `status` query, from the detail view.
- **Re-check the watchlist** — a `status` query against exactly the servers where watched players
  were last seen. Cheap and bounded by the number of entries, not by the size of the list.

Whether the last one is worth its own control, or whether the other three cover it in practice, is
decided from measurement (§18.16) — not now.

### 7.3 Cadence and budget

Everything here is a **setting with a shipped default**, not a constant:

- Scan automatically when the view opens (on/off).
- Auto-refresh while the view is open, with an interval (off/on + value).
- Maximum concurrent in-flight queries.
- Per-query timeout and the number of retries.
- Minimum spacing between two automatic scans.

The shipped default values are **not fixed by this concept** (§18.1) — they are measured against a
real master list during implementation and then written down as the defaults.

**Hard rule, not a setting: no scan runs while a game is running.** The launcher already knows the
launch state; an auto-refresh due during a session is skipped, not queued, and the view says why.
A manual scan is refused with the same reason.

## 8. The server list

- **Row:** name, mod, players/slots, map, measured ping, plus markers for password
  (`needpass`), gamemode (derived from `deathmatch`/`coop`/`ctf`/`teamplay`), favourite, stale
  (last scan did not answer), and **"waiting for an opponent"** — exactly one player connected.
- **Default order:** favourites first, then occupancy descending. Gamemode is the second dimension;
  whether that means grouping or only a tie-break is §18.3.
- **No default filter.** Empty servers are in the list; the sort puts them where they belong.
- **Filters and search:** mod, gamemode, empty, waiting-for-opponent, map, and a text search across
  server name, address, and **player names** (player names only where stage 2 has run).
- **Sorting** is user-changeable on every column, and the choice is remembered.
- **States:** the list has an explicit loading state (scan in progress, with counts), an empty state
  ("no source returned a server" — with a link to the source settings), and an error state per
  source.

## 9. The server detail view

Opened from a row. Contents:

1. **Header** — name, address, mod, map, gamemode, occupancy, measured ping, password marker, engine
   and protocol.
2. **Players** — name, score, ping, sortable. Empty state when the server reports none. No claim
   about who is spectating (§6.4).
3. **Rules** — the complete serverinfo key set. Known keys get a readable label and formatting;
   unknown (mod-specific) keys are listed raw underneath, so nothing is lost.
4. **`dmflags` decoded** — the bitfield resolved into a readable rule list, labelled as the vanilla
   meaning with the note that mods may reuse bits.
5. **Ping / reachability** — the response times measured this session and whether the last scan got
   an answer.
6. **Local context** — does this mod exist in the active installation, and does this map exist
   locally. A yes/no statement only; installing it is the `mods`/`assets` modules' job.
7. **Actions** — Join, Spectate, Favourite, Add to address book, Copy address.

## 10. Joining, spectating and the address book

### 10.1 Join

Uses the existing launch path: `launch:start` with `{ installationId, connect: '<host>:<port>' }`,
which `buildLaunchArgs` already turns into a trailing `+connect` argument.

- The **active installation** is used.
- If the server reports a mod the active installation does not have, the launcher **warns before
  launching** and lets the user continue anyway.
- If `needpass` indicates a password, the launcher asks for it before launching rather than letting
  the game fail at the connect.
- The join is recorded in the history.

**Security note, and it is not theoretical:** `+connect` is a *late* command in r1q2's argument
handling and is re-tokenized normally, i.e. it honours quotes and spaces — unlike `+set`. The
address reaching `LaunchInput.connect` comes from foreign data (a master list) or from user input.
It is therefore validated strictly as host/IPv4 plus port before it is ever put into an argument
vector; anything else is refused. This is the CLAUDE.md "paths from the renderer are never trusted"
rule applied to an address.

### 10.2 Spectate (v1 observing)

The same launch, with the engine put into spectator mode, and the spectator password asked for when
`needpass` says one is needed. One action, no new machinery — it is the Join flow with a different
set of launch parameters. The exact parameter composition per engine is §18.6.

### 10.3 Write to the address book

Quake II's multiplayer menu reads nine cvars, `adr0`–`adr8`. In this app they are ordinary
(non-catalogue) cvars the config module already round-trips — they land in the "Other" group today.

The action opens a dialog that shows:

- which **config profile** to write into (all profiles, active preselected),
- the **nine slots** with their current values, so an overwrite is a choice and not an accident.

Writing goes through the config module's existing write path, so the profile's sync and care state
behave exactly as they do for any other cvar change.

## 11. Favourites, history and manual servers

All three are **global to the launcher**, stored in the module's own `state.json` key.

- **Favourites** — user-marked. Always queried, even when no source lists them; always pinned to the
  top of the list. Keyed by address.
- **Manual servers** — `ip:port` entered by hand for servers on no master (private, LAN). Same
  address validation as §10.1. Distinguishable in the UI from master-discovered ones.
- **History** — servers the launcher connected to, recorded at join time (the launcher composed the
  `+connect`, so it knows). Bounded in length; whether history entries are also queried during a
  scan is §18.4.

## 12. The watchlist (gated)

A separate surface inside the module, invisible without an unlock code naming the `watchlist`
feature (§13).

- **An entry** is a name plus a **match mode**: `exact`, `substring` or `regex`. All three are
  case-insensitive. The mode is chosen per entry when it is created and can be changed later.
- **The list** shows one row per entry. When no scan has found the name: **`offline`**. When found:
  the server, the player's **score** and **ping**, and — if the same name matches on more than one
  server — every match, because the name is not an identity.
- **Actions** per row (context menu / action menu): Join that server, Spectate, open the server
  detail, edit the entry, remove it.
- **No spectator/player distinction** (§6.4).
- **Matching runs in main**, against the stage-2 player lists, as they arrive during a scan. It is a
  **by-product of scanning, not a driver of it** — the watchlist never widens a scan, never triggers
  one, and never makes a scan slower than it would be without it.
- **Re-checking a found player** means re-querying the one server they were last seen on. That is a
  single `status` query per entry, not a scan.
- **Accuracy is honest, not perfect.** The list reflects the last detail data the launcher holds. An
  entry shows `offline` when no fetched server had a match — which also covers "on a server nobody
  has fetched yet". The UI says *when* the information is from, so `offline` is never read as a
  fact about the world.
- **Regex needs a guard.** A user-supplied pattern is still user input that runs over a few thousand
  names per scan; a pathological pattern can hang the scan. The concrete safeguard (pattern length
  limit, compile-time validation with a clear error, per-match time budget) is §18.5.
- Turning the watchlist on **does not change the scan cost**. Nothing about the browser gets slower
  because the watchlist exists.

## 13. Experimental features and unlock codes (launcher-wide)

This is not part of the game browser; the watchlist is only its first consumer. It is specified here
because the milestone cannot ship the watchlist without it.

### 13.1 What it is

A named capability that exists in every build but is **invisible** unless the launcher holds a valid
unlock code that names it.

### 13.2 The code

A compact **signed token**. Its payload carries:

- the **feature names** it unlocks (so one code can unlock `watchlist` and nothing else),
- the **installation id** it was issued for (§13.3),
- an **issued-at** timestamp and a **redeem-by** timestamp — the short window during which the code
  can still be activated,
- an optional **feature expiry** — how long the unlock lasts once redeemed,
- optionally a label identifying who it was issued to, for the user's own benefit.

The signature is verified **in main**, against a public key embedded in the app, using `node:crypto`.
No network access is involved: a code works offline, and the maintainer hands codes out however they
like. The token is stored verbatim; it is **re-verified on every app start**, so a feature expiry
takes effect by itself.

**Redemption window and feature expiry are two different clocks.** The window only governs
*activation*: once a code has been redeemed inside it, the window is irrelevant and the unlock lives
as long as the feature expiry (or forever, if none was set).

**Revocation is only possible through the feature expiry or a new launcher build** — accepted in the
interview as the price for offline verification.

### 13.3 Device binding

A code is issued **for one installation**, so passing it on does nothing:

1. Settings shows the user a short **installation id** — a salted hash of a stable per-machine value
   (`MachineGuid` on Windows, `/etc/machine-id` on Linux), truncated to something a human can copy
   into a chat message. It is a fingerprint, not an account, and it never leaves the machine unless
   the user sends it.
2. The user sends it to the maintainer; the maintainer signs a token containing it.
3. On redemption, main compares the token's installation id against the machine's own. A mismatch is
   refused with a distinct reason ("this code was issued for a different installation").

This is the answer to "can a code be used only once": **offline it cannot** — one-time use needs a
server that records the redemption. Device binding solves the actual problem better, because a
forwarded code does not work for the recipient at all, however often they try.

Consequence to live with: the installation id changes on a fresh OS install, on a hardware change
and inside a VM. Then a new code has to be issued. That is accepted.

### 13.4 Known limits — stated, not worked around

- **The system clock belongs to the user.** The redemption window is checked against it. Someone who
  sets the clock back defeats the window. The launcher does **not** try to detect this — no monotonic
  high-water mark, no network time. It is documented as a limit, consistent with §13.5: this is
  gatekeeping, not security.
- **The installation id is derived on the same machine it protects.** A determined user can patch
  what the launcher reads.
- Neither of these is a bug to be fixed later. They are the shape of offline verification.

### 13.5 What it is not

This is **gatekeeping, not security.** The app runs on the user's machine; someone determined can
patch the asar or edit the stored state. The mechanism makes an unfinished feature non-discoverable
and ties it to something only the maintainer issues. It is not a licence check and it is not
described to anyone as one. This is written down so nobody later builds on it as if it were.

### 13.6 UI

- Settings carries an unobtrusive **code entry field** and, next to it, the **installation id** with
  a copy action — that is how a user asks for a code in the first place.
- A valid code is accepted with the list of features it unlocked and, if present, its expiry. A
  rejected code says **which** of the four checks failed — bad signature, wrong installation,
  redemption window elapsed, or feature already expired — because "invalid" alone produces a support
  conversation that never ends.
- A **locked feature renders nothing at all** — no tab, no placeholder, no greyed-out entry, no hint
  in any menu.
- An unlocked feature is marked as experimental where it appears, so nobody mistakes it for a
  finished part of the launcher.
- When a code expires while installed, the feature disappears at the next start and Settings says
  the code expired — silently vanishing UI would be a bug report.

### 13.7 Contract discipline

The gate is enforced in **main**: the module's handlers for a locked feature are not registered, in
the same spirit as `DEV_ONLY_CHANNELS` / `registerDevIpc()`. The renderer hiding the UI is
presentation, not the boundary — the renderer is never the thing that decides what is unlocked.

## 14. Observing

### 14.1 v1 — spectator launch

Covered in §10.2. It starts the real game. It is honest, cheap, and works on both platforms.

### 14.2 Stage B — the 2D in-launcher observer (specified, not built)

The thing the interview actually wants: watching without starting the game. Technically this means
the launcher speaks the Quake II **client** protocol: `getchallenge` → `connect <protocol> <qport>
<challenge> "<userinfo>"` → netchan (sequencing, reliable acks) → parsing the `svc_*` stream
(`serverdata`, `configstring`, `baseline`, `frame`, delta entities, `layout`, `print`,
`centerprint`). Node's `dgram` can carry all of it; there is no turnkey library, and the protocol
version must match the server (34 / 35 / 36).

What it renders — all four picked in the interview:

1. **Live scoreboard** — from the server's own `layout`/scoreboard data, which is where team
   membership and spectator status actually live. This is what closes the §6.4 gap.
2. **Chat and server messages** — `print`/`centerprint` as a readable text stream: frags, chat, map
   changes.
3. **Top-down radar** — player positions from the delta-entity stream drawn as a 2D map. The most
   expensive piece: it needs entity decoding and some notion of the map's extents.
4. **Deliberate self-identification** — the name the launcher appears under on the server is
   visible and controllable, and it identifies the connection as a launcher observer. Per the
   non-goal in §2, it never disguises itself as a player.

Consequences that have to be in the UI before anyone uses it:

- The observer **occupies a real client slot** on someone else's server.
- `needpass` (password or spectator password) can refuse it; anticheat or server rules may too.
- It must be **trivially stoppable**, and it disconnects cleanly rather than timing out.

### 14.3 Why not a 3D picture

See the permanent non-goal in §2. Short version: the WASM engine ports cannot open UDP sockets and
need a proxy, so they cannot reach a real server; embedding a native engine window needs native code
per platform and is impossible on Wayland. Q2PRO's MVD/GTV relay would be the clean way to watch a
server without loading it — but it requires `sv_mvd_enable` on the target server, which almost
nobody runs, and it is a Q2PRO feature while the launcher also serves r1q2. It is recorded here so
the option is not re-researched from scratch later.

## 15. Platform parity

From now on the app supports **Windows and Linux**, with Windows first (roughly 80% of users). This
milestone turns that into a standing rule in CLAUDE.md:

> A feature that cannot work on the current platform is never silently omitted. The control stays
> visible, is disabled, and carries the reason as **visible text** ("Not available on Linux: …") —
> not only a tooltip. The reason is an i18n key like every other label.

For the game browser itself, **no platform delta is known**: `node:dgram` is platform-neutral, the
HTTP source is the same path the news feed already uses, and the spectator launch goes through the
existing launch service. The rule matters here because the *milestone* introduces it, and because
the 2D observer (stage B) will be the first place to re-check the assumption.

Remaining, and not a browser problem: Linux installations depend on engine binaries being available
for Linux at all — see [linux-support-analysis.md](../linux-support-analysis.md).

## 16. Integration with existing systems (architecture notes)

- **Module registration** follows
  [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module): a new `ModuleId`, a
  manifest in `MODULE_MANIFESTS` with a route and `nav: { section: 'primary', order: … }`, the
  `network` capability and — because of the no-scan-while-playing rule — `game-lifecycle`; a main
  half under `src/main/modules/<id>/`, a renderer half registered in
  `src/renderer/src/modules/index.ts`, plus a `settingsSection` for the source list and the scan
  budget (the `downloads` precedent). The shell is not edited.
- **IPC** goes through the existing module seam (`module:invoke` / `module:event`) with the
  module's `ipcNamespace`; every handler carries a module-local zod schema. Handlers needed: scan
  start/stop, read list, read detail, favourites CRUD, manual server CRUD, history read, source
  settings read/write, address-book write, watchlist CRUD (gated), unlock-code submit/read
  (launcher-level, not module-level).
- **Events:** scan progress and per-server results are pushed with `module:event`, following the
  `jobs:changed` pattern where main owns the state and the Zustand store only applies what arrives.
  Whether a scan is also modelled as a `Job` is §18.7 — today `JobsService` is scoped to
  installation-mutating work, and a read-only network sweep is not that.
- **Persistence:** one new top-level `state.json` key owned by the module (favourites, manual
  servers, history, watchlist, sources, scan settings), with its own zod schema and defensive parse,
  following the `home` layout precedent. `LauncherSettings` is not extended. The unlock token is
  launcher-level state, not module state, and gets its own key.
- **Launch:** `launch:start` with `connect`, unchanged except that a caller now exists. Address
  validation happens in main before the argument vector is built (§10.1).
- **Config:** the address-book write goes through the config module's existing cvar write path; the
  game browser does not touch profile files itself.
- **CSP:** unchanged. UDP and HTTP both live in main; the renderer opens no socket and requests no
  remote origin.
- **i18n:** every label is a key in a new top-level block in `en.json`, following the
  `library`/`config`/`downloads` precedent. Server-provided text (hostname, map name, player names,
  unknown rule keys and values) is **data**, not prose, and crosses IPC as content — the same
  reading the home concept applied to feed text.
- **Design tokens:** the semantic token layer only. Dense rows in the server list will likely land
  below the 44px floor; if so, that is one more row in CLAUDE.md's deviation table with the same
  desktop-only rationale — as a recorded decision, not a quiet bend.
- **UI verification:** the server list (loading, empty, error, populated), the detail view, the
  address-book dialog, the join warning and the unlocked watchlist become entries in the
  `ui:verify` screen registry, with a `ui:flow` script for scan → select → join-dialog. **The
  fixture must serve the scan from a local stub** — no verification run and no test may touch a real
  master or a real server.
- **Tests:** codecs, matcher, sorter/filter and token verifier are pure modules with unit tests; the
  UDP socket sits behind an injectable seam so a test can drive a local `node:dgram` responder, the
  way `downloads/fetcher.ts` points a `FetchImpl` at a local HTTP server.

## 17. Requirements

**Discovery and sources (GB-S)**

- **GB-S1** — Master sources are a user-editable list (type, address, enabled) with shipped
  defaults, edited in the module's settings section.
- **GB-S2** — Two source types are supported: a UDP master (`query` → packed address records) and an
  HTTP list.
- **GB-S3** — A failing source is reported, does not abort the scan, and the other sources still
  contribute.
- **GB-S4** — A server can be added manually as `ip:port` and is distinguishable from a
  master-discovered one.
- **GB-S5** — Favourites are queried in every scan, whether or not any source lists them.

**Scanning (GB-N)**

- **GB-N1** — A scan runs in two stages: an `info` sweep that produces list rows, then a `status`
  fetch that produces player data.
- **GB-N2** — Results are pushed to the renderer as they arrive; the list is usable while the scan
  runs, and scan progress is visible.
- **GB-N3** — Auto-scan on open and auto-refresh interval are settings; a manual scan is always
  available.
- **GB-N4** — Concurrency limit, per-query timeout, retry count and minimum spacing between
  automatic scans are settings with shipped defaults.
- **GB-N5** — No scan runs while a game is running: a due auto-refresh is skipped (not queued) and a
  manual scan is refused, each with a visible reason.
- **GB-N6** — A server that does not answer keeps its last known state, marked stale; it is never
  shown as "zero players".
- **GB-N7** — The watchlist never widens, triggers or slows a scan; it matches against the stage-2
  data a scan produces anyway.
- **GB-N8** — A multi-datagram master reply is assembled into one address set.
- **GB-N9** — Scoped refreshes exist: all servers, favourites only, and a single server from its
  detail view.
- **GB-N10** — Stage 2 runs for the selected server and for every server stage 1 did not positively
  report as empty (a reply with no readable player count is checked, not assumed empty); a *known*
  zero-player server is not queried twice.

**Server list (GB-L)**

- **GB-L1** — A row shows name, mod, players/slots, map and measured ping.
- **GB-L2** — Markers exist for password, gamemode, favourite, stale and "exactly one player —
  waiting for an opponent".
- **GB-L3** — Default order is favourites first, then occupancy descending, with gamemode as the
  second dimension.
- **GB-L4** — No filter is applied by default; every discovered server is listed.
- **GB-L5** — Filters exist for mod, gamemode, empty, waiting-for-opponent and map; search covers
  server name, address, and, where stage 2 has run, player names.
- **GB-L6** — Sorting is user-changeable and remembered.
- **GB-L7** — The list has explicit loading, empty and per-source error states.

**Server detail (GB-D)**

- **GB-D1** — The player list shows name, score and ping, and makes no statement about spectating.
- **GB-D2** — Every reported serverinfo key is shown: known keys labelled and formatted, unknown
  keys listed raw.
- **GB-D3** — `dmflags` is decoded into a readable rule list, labelled as the vanilla meaning.
- **GB-D4** — The response times measured this session are shown, and whether the last scan
  answered.
- **GB-D5** — The view states whether the server's mod and map exist locally, without offering to
  install them. *Deferred 2026-09-25 to the mods/assets modules (open point 14); not in v1.*
- **GB-D6** — A missing or malformed key never breaks the view; each field degrades on its own.

**Join, spectate, address book (GB-J)**

- **GB-J1** — Join starts the active installation with `+connect <host>:<port>`.
- **GB-J2** — An address is validated strictly as host/IPv4 plus port in main before it enters an
  argument vector; anything else is refused.
- **GB-J3** — A mod the active installation does not have produces a warning before launching, which
  the user can override.
- **GB-J4** — When `needpass` indicates a password, it is asked for before launching.
- **GB-J5** — Spectate launches the game in spectator mode, asking for the spectator password when
  one is required.
- **GB-J6** — A join is recorded in the history.
- **GB-J7** — "Add to address book" opens a dialog that lets the user pick the config profile and
  one of `adr0`–`adr8`, showing each slot's current value.
- **GB-J8** — The write goes through the config module's existing cvar write path; the game browser
  does not write profile files itself.

**Persistence (GB-P)**

- **GB-P1** — Favourites, manual servers, history, watchlist, sources and scan settings are global
  to the launcher, not per installation.
- **GB-P2** — They live in one module-owned top-level `state.json` key with a zod schema and a
  defensive parse; `LauncherSettings` is not extended.
- **GB-P3** — History is bounded in length.

**Watchlist (GB-W, gated)**

- **GB-W1** — A watchlist entry is a name plus a match mode: exact, substring or regex, all
  case-insensitive, chosen per entry and changeable.
- **GB-W2** — An entry with no match shows `offline`; a matched entry shows the server, the score
  and the ping.
- **GB-W3** — A name matching on several servers shows every match.
- **GB-W4** — Each row offers Join, Spectate, open detail, edit and remove.
- **GB-W5** — Matching runs in main against stage-2 results as they arrive; the watchlist issues no
  scan of its own.
- **GB-W5a** — Re-checking a found entry queries only the server that entry was last seen on.
- **GB-W5b** — The watchlist states how current its information is; `offline` means "no fetched
  server matched", not "this player is not playing".
- **GB-W6** — An invalid regex is rejected at entry time with a clear reason, and a pattern can
  never hang a scan.
- **GB-W7** — Without a valid unlock code naming `watchlist`, the feature renders nothing anywhere
  in the UI, and its handlers are not registered in main.

**Experimental features (GB-X)**

- **GB-X1** — An unlock code is a signed token naming the features it unlocks, the installation it
  was issued for, its redeem-by time, and optionally a feature expiry.
- **GB-X2** — Verification happens in main against an embedded public key, offline, and is repeated
  on every app start.
- **GB-X3** — A rejected code names which check failed: signature, installation mismatch, redemption
  window elapsed, or feature expired.
- **GB-X3a** — A code whose installation id does not match the machine is refused, whatever else it
  contains.
- **GB-X3b** — A code redeemed after its redeem-by time is refused; a code redeemed inside the
  window stays valid afterwards, independently of that window.
- **GB-X3c** — Settings shows the installation id with a copy action.
- **GB-X3d** — The installation id is a salted, truncated hash of a per-machine value; the raw value
  is never displayed, stored or transmitted.
- **GB-X4** — A locked feature renders nothing: no tab, no placeholder, no menu entry, no hint.
- **GB-X5** — An unlocked feature is marked as experimental where it appears.
- **GB-X6** — A code expiring between sessions makes the feature disappear, and Settings states that
  the code expired.
- **GB-X7** — The renderer never decides what is unlocked; handlers for a locked feature are not
  registered.

**Platform (GB-T)**

- **GB-T1** — CLAUDE.md carries the rule: a feature unavailable on the current platform stays
  visible, is disabled, and shows its reason as visible text, as an i18n key.
- **GB-T2** — The game browser declares no platform-specific behaviour; anything discovered during
  implementation is surfaced per GB-T1 rather than dropped.

**Module and verification (GB-A)**

- **GB-A1** — A registered `servers` module owns the route, the list, the detail view, the watchlist
  and its settings section; the shell is not edited.
- **GB-A2** — Every module handler exists in the module contract with a zod schema before its
  implementation.
- **GB-A3** — All UI labels are i18n keys; only server-provided content crosses IPC as prose.
- **GB-A4** — The list (loading, empty, error, populated), the detail view, the address-book dialog,
  the join warning and the unlocked watchlist are in the `ui:verify` registry, and a full run stays
  at zero axe violations.
- **GB-A5** — No test and no `ui:verify` run touches a real master or a real game server.
- **GB-A6** — The protocol codecs, the sort/filter engine, the matcher and the token verifier are
  pure, unit-tested modules, and the UDP socket sits behind an injectable seam.

## 18. Open points

1. **Scan budget defaults** — concurrency, per-query timeout, retries, minimum spacing between
   automatic scans, and the auto-refresh default interval. Deliberately not invented. **The first
   thing the implementation does is measure**: how long a full pass over a real master list
   (~100–300 servers) takes including details. Only the numbers decide whether any of this needs
   tuning at all — if a full detail pass is a few hundred milliseconds, most of this open point
   answers itself and the scoped refreshes of §7.2.1 are convenience, not necessity.
2. **Master reply stop condition** — a UDP master's answer can span several datagrams with no
   terminator. How the scan decides the list is complete (quiet period, expected count, cap) is
   unresolved.
3. **Gamemode as the second sort dimension** — the interview said "occupancy and gamemodes"; whether
   that means the list is *grouped* by gamemode or only tie-broken by it is not settled.
4. **Are history entries queried during a scan**, or only shown when a source also returns them?
5. **Regex safeguards** — the concrete limits (pattern length, compile-time validation, per-scan
   time budget, and what the UI says when a pattern is refused).
6. **Spectator launch parameters per engine** — the exact cvar/argument composition that puts r1q2
   and Q2PRO into spectator mode on connect, including how the spectator password is passed without
   ending up in a shell-visible argument.
7. **Is a scan a `Job`?** — `JobsService` today covers installation-mutating work; reusing it for a
   read-only network sweep would be a deliberate decision, and the progress UI would come for free.
8. **Module id and label** — `servers` is used throughout this document; the home concept calls the
   planned module "Gamebrowser". The final id, route, nav order and user-facing title are not fixed.
9. **IPv6** — the classic master record format is IPv4-only. Whether manually added servers may be
   IPv6, and what the address validator accepts, is unresolved.
10. **Non-ASCII and high-bit player names** — Quake II's "green" character set and arbitrary bytes in
    names. How they are decoded, displayed and matched against a watchlist entry is not settled.
11. **Unlock-code distribution** — the concrete format the user copies (length, grouping, prefix),
    the same for the installation id, where the private key lives, and what the maintainer actually
    runs to issue a code (a script in this repo, or something kept outside it).
    - **Redemption window length** — placeholder 10 minutes, not decided. Long enough that a real
      person in a chat conversation can use it, short enough to matter.
    - **Installation id churn** — the id changes on a fresh OS install, a hardware change and inside
      a VM. Whether the launcher softens that (a grace path, or deriving from something more stable)
      or whether re-issuing a code is simply the answer is not settled.
12. **What happens to watchlist data when a code expires** — the feature disappears; whether the
    stored entries are kept for a later code or discarded is undecided.
13. **A dashboard tile** for the browser (favourites / who is online) — out of v1 by decision, but
    the obvious follow-up once the home grid and this module both exist.
14. **Mod/map "available locally" detection** (*deferred 2026-09-25: moves to the mods/assets
    modules, story 124 ships without it*) — the check is stated in GB-D5, but what counts as
    "the mod is there" before the `mods` module exists needs defining.
15. **Rate-limit etiquette toward masters** — whether the launcher should also bound how often it
    re-fetches a master source, distinct from how often it queries game servers.
16. **Does a dedicated "re-check watchlist" control exist?** — the targeted re-query is cheap and
    specified (§7.2.1), but if a full scan turns out to cost a few hundred milliseconds, "refresh
    servers" covers it and a second button is clutter. Decided from the measurement in open point 1,
    not before.

---

## Sources (protocol research, 2026-09-22)

- [q2_server_query (Ruby reference implementation of the `status` query)](https://github.com/rojosinalma/q2_server_query)
- [QStat / quakestat manual — `q2s` / `q2m` query types, `-dump`, `-pkt`](https://manpages.ubuntu.com/manpages/bionic/man1/quakestat.1.html)
- [Wireshark display-filter reference: Quake II network protocol](https://wireshark.marwan.ma/docs/dfref/q/quake2.html)
- [q2servers.com — server list and the `?raw=1` / `?raw=2` endpoint](https://q2servers.com/)
- [QuakeServers.net — Quake 2 master servers](https://www.quakeservers.net//quake2/master_servers/)
- [packetflinger/q2master — a Quake 2 master server in Go, with an HTTP API](https://github.com/packetflinger/q2master)
- [The q2servers FAQ — `public 1`, `setmaster`, port 27900](https://www.bluesnews.com/faqs/q2s-faq.html)
- [Q2PRO server manual — MVD/GTV server and client mode, `sv_mvd_*` / `mvd_*`](https://skuller.net/q2pro/nightly/server.html)
- [q2pro doc/server.txt — MVD broadcasting](https://github.com/Bad-ptr/q2pro/blob/master/doc/server.txt)
- [Qwasm2 — Quake 2 in the browser (WebGL2/software, needs a WebSocket proxy for online play)](https://qwasm2.m-h.org.uk/)
- [turol/webquake2 — R1Q2 via Emscripten, WebSocket networking, LAN only](https://github.com/turol/webquake2)
- [netquake — full Quake connection handshake (getchallenge → connect → configstrings → baselines) over a data channel](https://github.com/jay23606/netquake)
