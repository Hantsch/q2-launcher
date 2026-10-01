---
id: 196
title: I switch the browser between online and LAN
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player at a LAN party I can switch the server browser from **Online** to **LAN** and see
only the Quake II servers on my local network; switched back to Online, I see only the servers
from the master sources, favourites and manual entries as today. The two views are never mixed:
on a LAN I search the LAN, otherwise I search online.

LAN is an option, not the default: the browser opens on Online, and nothing is broadcast on the
network unless the user chose LAN.

Idea taken from a review of ozy24/q2connect (LAN discovery by UDP broadcast).
Concept: [game-browser.md](../concepts/game-browser.md) §7 (discovery and scanning).

## Acceptance Criteria

- [ ] **AC1** — The server list header carries an Online / LAN toggle. Online is selected when
      the launcher starts.
- [ ] **AC2** — A scan in Online mode contacts the master sources and sends no LAN broadcast; a
      scan in LAN mode sends the broadcast and contacts no master source.
- [ ] **AC3** — In LAN mode the list shows only servers that answered the broadcast: no
      favourites, manual servers, history entries or master results appear in it unless they
      answered it. Online mode never shows a server that only the LAN scan found.
- [ ] **AC4** — A server that answers the broadcast more than once, or from several interfaces,
      appears once per `address:port`.
- [ ] **AC5** — LAN rows stream in as they answer, with the same columns, markers, detail view and
      Join action as online rows, and a measured ping.
- [ ] **AC6** — When no server answers within the scan window, the LAN list shows an explicit
      empty state naming the local network ("no server answered on the local network"), not an
      error and not the online empty state.
- [ ] **AC7** — The hard rule holds in both modes: no LAN scan runs while a game is running; an
      automatic one is skipped and a manual one is refused, each with a visible reason.
- [ ] **AC8** — Switching mode shows that mode's last result at once and does not discard the
      other mode's result; filter and sort apply to whichever list is shown.
- [ ] **AC9** — If the broadcast cannot be sent at all (no usable network interface, socket
      refused), the LAN toggle stays visible and says so as visible text from an i18n key; it is
      never silently removed.

## Open Questions

- **Q1** — Is the toggle always visible, or does LAN first have to be switched on in the servers
  settings section? "An option, not the default" fits both. Recommendation: always visible,
  Online preselected - a toggle nobody can find is not an option.
- **Q2** — Is the chosen mode remembered across launches, or does every start open on Online
  (AC1 currently says the latter)?
- **Q3** — Which broadcast? q2connect sends `status` to `255.255.255.255:27910`, which leaves
  through the default route only. A multi-homed machine (Ethernet plus Wi-Fi, VPN adapters) would
  miss servers on the other interface. Per-interface directed broadcast is more reliable and is a
  small step more work; the refine has to decide.
- **Q4** — One broadcast `status` gives players and ping in a single round, but a very full server
  may exceed an MTU (concept §6.4). Does LAN reuse the two-stage scan (`info` broadcast, then
  `status` per answer) so it behaves exactly like online, or is one stage enough on a LAN?
- **Q5** — Favourites and manual servers in LAN mode: AC3 says they stay out. A user who keeps a
  LAN server as a favourite might expect it there; if so, that is a separate story, not a quiet
  mix-in.
- **Q6** — Which ports are probed? q2connect uses only 27910. Servers on other ports are
  invisible to a broadcast.
- **Q7** — The watchlist (gated) matches against stage-2 data: does it see LAN results, or only
  online ones? Recommendation: whichever list was scanned most recently feeds it, and the
  watchlist says which.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
