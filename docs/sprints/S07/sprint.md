---
sprint: S07
status: in-progress # planned | in-progress | done
branch: sprint/S07
milestone: Config, round two
---

# Sprint S07 — The written file stops looking machine-generated

## Goal

A saved profile no longer carries dead alias lines or uuid-fragment names, is grouped into
readable, commented sections instead of a flat sorted dump, and importing a real hand-written
config (aliases, press/release pairs, `unbindall`) turns into real Controls entries instead of
~90 preserved lines.

## Stories (in build order)

- [x] 038 — No alias line for an action the engine can bind directly
- [x] 039 — Aliases get readable names I control, and must be unique
- [x] 040 — The profile file is written structured, commented and human-readable
- [ ] 041 — Import understands aliases, press/release pairs and unbindall

## Notes

Suggested order and scope per `docs/ROADMAP.md`'s "Config, round two" section. 038 is a small,
standalone writer bugfix; 039 changes the alias-naming scheme underneath it (real risk: the
`q2l_a_` prefix is used as an identity test in five places — see 039's own requirement) and must
land before 040 can render the new names; 040 restructures the write output; 041 is independent
of 038–040's write-side changes but is grouped in the same sprint because it closes the other
half of "my config looks machine-generated / import loses everything". 042 (round-trip losslessly)
and 043 (.cfg becomes source of truth) are deliberately held back — the roadmap notes they need a
decision round before refine, and 043 depends on 042. 044/045 are lower priority and unblocked by
this sprint, not required by it.
