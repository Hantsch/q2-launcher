---
sprint: S08
status: in-progress # planned | in-progress | done
branch: sprint/S08
milestone: Config, round two
---

# Sprint S08 — The file becomes the config

## Goal

A profile file carries everything the launcher knows about it, so it survives being taken to
another machine and imported back; and the file — not `state.json` — becomes the profile's source
of truth, so a hand-edit in Notepad is picked up instead of clobbered. Plus the two guardrails the
repo still owes: no inline styles in the shipped CSP, and no authoring surface left unscreened.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 046 — The production CSP no longer allows inline styles
- [x] 047 — The message editor is covered by ui:verify like every other surface
- [x] 042 — A launcher-written profile file re-imports without losing anything
- [ ] 043 — The .cfg file is the source of truth, state.json becomes a cache

## Notes

Closes the "Config, round two" milestone's held-back chain. 042 → 043 is a hard dependency: a file
can only be authoritative for state it can carry. Both carry real open questions that the roadmap
deliberately parked pending a decision round — 042's metadata comment format (trailing per line vs.
own line vs. end block, and whether the parser is positional), 043's change detection, write cadence
under an authoritative file, conflict granularity, and what a deleted-outside-the-launcher file
means. Those get resolved in `/sprint`'s clarification round before refine, not guessed at.

046 and 047 go first deliberately: they are small, independent of the config rework, and they put the
UI-verification harness at full coverage *before* 042/043 start changing the write pipeline, Raw
File and Care — which is when a green report is worth the most. 042/043 are the largest pair cut into
one sprint so far; expect two acceptance passes rather than one.

Not in this sprint: 044 (alias manager) and 045 (toggles/press-release as first-class entries) —
both wanted out of S07's hands-on feedback, both unblocked, deliberately held so this sprint stays
the architectural one. 032 (downloads badge) stays blocked on the downloads module.

**Carry-over rule from S07, applies directly here:** any story touching
`src/shared/config/alias-references.ts` or the mirror/alias-render mechanism does not get to
self-report "done" — it needs an adversarial re-render pass against constructed edge-case profiles.
039 needed four build/review rounds because reading the diff was not enough. 042 renders and
re-parses that exact output.
