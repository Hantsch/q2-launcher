---
sprint: S23
status: in-progress # planned | in-progress | done
branch: sprint/S23
milestone: 9.2 — Discovery & persistence
---

# Sprint S23 — The browser remembers what it's told

## Goal

Everything the `servers` module needs to remember between restarts — master sources, favourites,
manually added servers and connection history — lives in its own `state.json` key with a defensive
parse, and can be created, edited and read back through IPC handlers backed by zod schemas. No scan
engine and no server list exist yet; this sprint proves the data survives a restart, not that it is
ever shown.

## Stories (in build order)

- [x] 110 — the browser's data lives in its own state key
- [x] 111 — master sources are a list i edit
- [x] 112 — favourites are always there
- [x] 113 — a server i add by hand, and where i've been

## Notes

This is sprint 2 of 7 (9.1–9.7, stories 106–132) building the game-browser milestone described in
full in `docs/concepts/game-browser.md`. It depends on sprint 9.1 (S22, stories 106–109) already
being built: 110 lands inside the `servers` module [[106]] registered, 111 and 113 validate
addresses through the validator [[107]] built, and 111 stores sources in the shape [[109]]'s codecs
will later read.

110 goes first because 111, 112 and 113 all write into the state key it defines — building any of
the three before it would mean inventing the shape twice. 111–113 have no dependency on each other
and could build in any order after 110; the listed order follows the concept's own §17 grouping
(sources before persistence-scoped favourites/manual/history).

Two scope boundaries carried over from the story files, worth restating here: the *scan-time*
behaviour of favourites (always queried, pinned to the top) and of history (whether it feeds the
scan's address set) both belong to sprint 9.3's scan engine ([[114]]) and sprint 9.4's list sorting
([[119]]), not to this sprint — 112 and 113 build storage and read APIs only. Likewise, 111 defers
the master rate-limit-etiquette open point (concept open point #15) to the scan engine rather than
deciding it here.
