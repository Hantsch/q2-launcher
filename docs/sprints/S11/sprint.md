---
sprint: S11
status: in-progress # planned | in-progress | done
branch: sprint/S11
milestone: Config, round three
---

# Sprint S11 — Controls reflects the file's structure

## Goal

Controls becomes an editor of *my* config rather than a catalogue with my config laid over it: the
categories and sub-categories on screen are the ones my file has (the built-in three become a
template that only seeds a new profile), every row and category can be renamed, moved and deleted,
extra keys group under the primary row instead of filling a Secondary column, and a `drop_` alias
is a drop wherever it lives — with two icon toggles instead of two checkboxes.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 052 — Controls shows my categories, the template only seeds them
- [x] 053 — Sub-categories come from the file, and Controls shows them
- [ ] 056 — Extra keys group under the primary row
- [ ] 055 — A `drop_` alias is a drop, with two toggles instead of two checkboxes

## Notes

**Order.** 052 changes what a category *is* (persisted, ordered, no built-in special case) and what
an unbound row leaves in the file; 053 adds the second level on top of that model; 056 reshapes the
grid columns (Primary/Secondary → one Key column plus sub-rows) and lands before story 054's drag
and drop in S13 so DnD is built once against the final row structure; 055 is independent of the
grid shape and goes last so the sprint can shed it if 052/053 run long.

**Carry-over rule (S07–S10) applies to 052, 053 and 055.** All three change what a rendered file
contains (placeholder or commented-out lines for unbound entries, two-level section headers, `drop_`
alias naming) and therefore touch `src/shared/config/render.ts` / `profile-restore.ts` /
`alias-render.ts`-adjacent code. Do not trust a "done" self-report from a diff read: budget an
adversarial re-render pass against constructed edge-case profiles and re-run story 042's round-trip
fixed-point property after each of them. Expect the 3-cycle review-fix budget to be used.

**Open questions are real decisions, not gaps.** 052's "how does an unbound row live in the file"
matters because the file has been the source of truth since 043 — a template row that exists only
in `state.json` vanishes on the first reload. 055's "what qualifies as a drop body" changes the
on-disk alias names. Both go to the user in `/sprint`'s clarification round before refine.

The `Imported` / `Messages` / `Sounds` categories `alias-import.ts` mints today stay as they are;
052 only stops adding categories the file does not have.

032 (downloads badge) stays blocked on the downloads module.
