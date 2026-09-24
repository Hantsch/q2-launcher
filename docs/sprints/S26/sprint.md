---
sprint: S26
status: planned # planned | in-progress | done
branch:
milestone: 9.5 — Server detail view
---

# Sprint S26 — Opening a server tells you everything it told us

## Goal

Clicking a server row in the list opens a detail view that renders everything the two protocol
queries actually carry: a header and a sortable player list (no claim about who is spectating), the
server's complete serverinfo rule table with `dmflags` decoded, and this session's ping history plus
a plain yes/no on whether the active installation already has the server's mod and current map.

## Stories (in build order)

- [ ] 122 — a server's detail opens
- [ ] 123 — the rules a server plays by, in full
- [ ] 124 — how this server has answered, and whether i have what it needs

## Notes

Sprint 5 of 7 for the game-browser milestone (9.1–9.7, stories 106–132), full concept at
`docs/concepts/game-browser.md`. Depends on S22–S25 (106–121: module scaffold, protocol/codecs,
persistence, scan engine, server list UI) being built first — this sprint renders data those stories
produce and opens from the list row S25 ships.

122 goes first because it is the view's container and entry point (header + players panel); 123 and
124 both render into that same view and carry no dependency on each other, but are ordered after 122
since there is nothing to open them from otherwise.

124 carries a genuine Open Question (concept open point #14: what counts as "the mod is there" and
"the map is there" before the `mods`/`assets` modules exist) — get it resolved during `/refine 124`
before build starts on that story; it decides what AC3/AC4 actually check, not just how the result
is displayed.

None of the three stories scope the view's actions row (Join/Spectate/Favourite/Add-to-address-book/
Copy-address, concept §9 item 7) — that is sprint 9.6 (stories 125–127).
