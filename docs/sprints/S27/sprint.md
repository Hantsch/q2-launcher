---
sprint: S27
status: planned # planned | in-progress | done
branch:
milestone: 9.6 — Join, spectate, address book
---

# Sprint S27 — I join, I spectate, I write a server into my address book

## Goal

From the server list or detail view, a user can launch the active installation straight into a
server with a validated `+connect`, spectate the same server instead of playing it, and write a
server's address into a chosen config profile's `adr0`–`adr8` slot through a dialog that shows what
it is about to overwrite.

## Stories (in build order)

- [ ] 125 — i join a server from the browser
- [ ] 126 — i spectate without picking a side
- [ ] 127 — a server goes into my address book

## Notes

This is sprint 6 of 7 (9.1–9.7, stories 106–132) building the game-browser milestone described in
full in `docs/concepts/game-browser.md`. It depends on S22–S26 already being built: the module shell
and address validator ([[106]], [[107]]), the protocol codecs ([[108]]), master sources ([[109]]),
persistence including manual servers and the history store ([[110]], [[113]]), the scan engine
([[114]], [[115]]), the list UI ([[118]]) and the detail view ([[122]]) — this sprint has nothing to
launch a server *from* without those.

125 goes first because 126 is explicitly not a separate implementation — it is 125's join flow with a
different launch-parameter composition — and 127 is independent of both but shares no ordering
constraint that would move it earlier. 126 carries a genuine, unresolved Open Question inherited
directly from the concept (open point #6: the per-engine spectator launch-parameter composition,
including how a spectator password avoids ending up in a shell-visible argument) — this needs an
answer from the real r1q2/Q2PRO source or documentation during `/refine`, not a guess baked into the
story.
