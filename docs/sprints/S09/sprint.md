---
sprint: S09
status: in-progress # planned | in-progress | done
branch: sprint/S09
milestone: Config, round two
---

# Sprint S09 — The file states the whole configuration, and I can see what I changed

## Goal

A profile's `.cfg` states the entire intended configuration rather than only my deviations, so
executing it lands the same game state no matter what `config.cfg`, an `autoexec.cfg` or another
profile set before it — and the "reset to default" idea that no longer means anything is gone
everywhere. On top of that, the unsaved-changes state story 043 introduced becomes legible: the
orange row marker means "I edited this", the bar can be expanded into a before/after of what a
Save would write, and I can throw my edits away without touching the file. Plus one surface for
the alias name space that a real ninety-alias config needs.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 048 — Every setting is written to the file, and nothing resets to default any more
- [x] 049 — I can see what an unsaved change is, review it, and throw it away
- [ ] 044 — One surface to manage every alias in a profile

## Notes

**048 → 049 is a hard dependency in both directions of meaning.** They were filed as one story
(the original 048) and split when this sprint was cut, because the always-write and the
reset-removal have to land together while the unsaved-changes work is separately acceptable.
Order matters: removing the reset affordances before every setting is written leaves the Settings
tab with no way back to a default, and 049's row indicator can only be defined once 048 has
decided where the always-write lives (materialised into `profile.cvars` on save vs. filled in at
render time). Expect 049's "what is the baseline for unsaved" answer to fall out of that same
decision.

**Both carry parked decisions, like 042/043 did.** 048: which default gets written for an
untouched cvar when one file is synced to installations running different engines
(`effectiveDefaultFor` per engine vs. the engine-neutral `def.default`), what happens to a cvar
the scoped engine does not have, where the always-write happens, and what "changed only" and the
counters mean afterwards. 049: the unsaved baseline, text diff vs. structured change list, whether
discard is bar-only, and whether the indicator extends past cvar rows. 044: where the surface
lives (fifth tab vs. panel vs. dialog), whether Controls keeps showing alias rows, whether the
body editor is new or reuses the action drawer, and whether generated aliases show by default.
These go to the user in `/sprint`'s clarification round before refine — not guessed at.

**Carry-over rule from S07/S08 applies to all three.** 048 changes `render.ts` and 044 builds on
the alias reference graph, which is exactly the `src/shared/config/alias-references.ts`-adjacent
mirror/render code where story 039 took four review rounds and 042 took eight. Do not trust a
"done" self-report on this path from a diff read: budget an adversarial re-render pass against
constructed edge-case profiles, and re-run 042's round-trip fixed-point property after 048
changes what a rendered file contains.

**044 goes last deliberately.** It is a new screen and independent of 048/049's state work, so it
is the story that can be cut back if the sprint runs long — the milestone's two remaining
user-facing complaints ("my config doesn't state what I mean" and "I can't see what I changed")
are both answered by 048/049 alone.

Not in this sprint: **045** (toggles, press/release pairs and `wait` chains as first-class
entries), which closes the milestone in S10. It adds two entry kinds plus import plus Care
plus round-trip on top of 044's name space, and putting it in a fourth slot behind three large
stories would repeat exactly what S04 avoided by holding 022–025 back. 032 (the downloads badge)
stays blocked on the downloads module.
