---
sprint: S22
status: in-progress # planned | in-progress | done
branch: sprint/S22
milestone: 9.1 — Servers module foundation & protocol core
---

# Sprint S22 — A servers module exists, and it already speaks the protocol

## Goal

A "Servers" entry appears in the primary nav, routes to an empty view, and is a real registered
module — not a stub the shell knows about. Underneath it, the protocol and address groundwork every
later sprint in this milestone builds on (address validation, the `info`/`status` query codecs, the
master-source codecs) is written as pure, unit-tested code with no live network involved anywhere.

## Stories (in build order)

- [x] 106 — a servers module exists with its own nav entry
- [x] 107 — a server address is validated before it is trusted
- [x] 108 — the launcher speaks the two server queries
- [x] 109 — master sources return an address set

## Notes

This is the first of 7 sprints (9.1–9.7, stories 106–132) building the game-browser milestone
described in full in `docs/concepts/game-browser.md`. 106 goes first because 107–109 need the module
shell (main/renderer halves, IPC namespace) to land their code into, even though none of the three
protocol/validation stories depend on 106's *content* — they are pure modules that could in principle
be built standalone. 107 goes before 108/109 because both later stories' "reject malformed input"
acceptance criteria are easier to reason about once the shared validation vocabulary exists, and
because [[107]] is written to be referenced by name from join/manual-entry/address-book stories in
later sprints.

Three stories in this sprint (107, 108, 109) each carry a genuine Open Question the concept itself
left unresolved: IPv6 scope in the address validator (concept open point #9), and the UDP master
reply's multi-datagram stop condition (open point #2). These need an answer during `/refine`, not a
silent default baked into the pure code — get them settled before build starts on the affected
story.

No story in this sprint touches a real UDP master, a real game server, or q2servers.com — every
codec is exercised against fixtures/stubs, per GB-A5.
