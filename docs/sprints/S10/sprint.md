---
sprint: S10
status: in-progress # planned | in-progress | done
branch: sprint/S10
milestone: Config, round two
---

# Sprint S10 — The tag shrinks, three more idioms become real entries

## Goal

Closes the "Config, round two" milestone. A generated config's `[q2l …]` comment carries only what
the file cannot already say (050), and toggle/press-release/`wait`-chain idioms — already common in
hand-written configs and already import-safe since story 041 — become first-class entries the
launcher understands and can render, not opaque alias rows (045).

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 050 — The metadata tag carries only what the file cannot say
- [x] 045 — Toggles, press/release pairs and wait chains as first-class entries

## Notes

050 goes first deliberately: it shrinks and re-versions the trailing `[q2l …]` tag format that
every generated line carries. 045 adds two new entry kinds that also render through that same tag
mechanism — building it on top of the already-reduced format avoids touching the tag shape twice in
one sprint.

**Carry-over rule from S07/S08/S09, applies to both stories:** both touch
`src/shared/config/alias-references.ts`-adjacent render/parse/mirror code (050 the tag reader/writer,
045 the alias-reassignment and `+x`/`-x` idioms). Do not trust a "done" self-report on this path from
a diff read — budget an adversarial re-render pass against constructed edge-case profiles, and
re-run story 042's round-trip fixed-point property after each story changes what a rendered file
contains.

Both stories carry open questions the roadmap deliberately parked pending a decision round: 050's
anchor identity without the `e` field, what happens past two key slots, and whether the format change
bumps `META_FORMAT_VERSION`; 045's toggle-as-own-kind-vs-flag, whether press/release replaces or sits
next to the existing hold-layer mechanism, and whether `wait` is an editor helper or a real command
kind. Resolved in `/sprint`'s clarification round before refine, not guessed at.

032 (downloads badge) stays blocked on the downloads module — not in scope here.
