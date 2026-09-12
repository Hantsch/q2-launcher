---
sprint: S20
status: planned # planned | in-progress | done
branch: # set by /sprint
milestone: 4.1 — Install, bootstrap, update and repair
---

# Sprint S20 — Install closes out: update, rollback, repair, removal

## Goal

Phase 4 milestone 1 finishes: an installation can update its engine and roll back a bad
update, repair whatever the manifest can supply, and be removed from disk (locked for
store-managed installs) — all writes waiting for a running game to exit first, closing the
Phase 4 install module.

## Stories (in build order)

- [ ] 091 — Writes wait for a running game
- [ ] 092 — An engine updates and rolls back
- [ ] 093 — Repair fixes exactly what it can
- [ ] 094 — An installation can be removed from disk

## Notes

091 is deliberately first: 092/093/094 all write into an already-playable installation and
share its wait-then-continue guard rather than each inventing one. 091 also retrofits the
guard onto 090's retail-upgrade job, closing a gap the S19 review flagged
([[090]]/S19 review). 092's bleeding-edge opt-in (INST-U4) has an open probe-mechanism
question (concept §15.12) to resolve in the sprint's clarification round.
