---
sprint: S15
status: done # planned | in-progress | done
branch: sprint/S15
milestone: Identity, icons and the first profile
---

# Sprint S15 — An installation says what it is, a profile starts where I do

## Goal

One word for one concept: the launcher calls a Quake II engine an *engine*, everywhere, and only
offers the two it actually supports. An installation is told apart by an icon the user picked, not
by two letters derived from its engine. The config profile header stops looking pasted together.
And creating a profile offers the three starting points people actually arrive with — empty, a
handed template, or their own config files.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 068 — The app says engine, not client
- [x] 067 — An installation carries an icon I choose
- [x] 069 — The profile header breathes in two lines
- [x] 066 — A new profile starts empty, from a handed template, or from my own config files

## Notes

**068 and 069 are still `draft`** — both come out of live UI feedback on S14's own result (the
Create-installation dialog's "CLIENT" dropdown, the one-row profile header) and need `/refine`
before build. 066 and 067 are already `ready` with plan + deliverables.

**068 goes first** because it settles two things the following stories build on: the vocabulary
(engine, not client) and the supported-engine set. 067 replaces the engine-derived two-letter tile
with a chosen icon and 069 sits next to 065's `EngineBadge` in the header — reworking either before
the wording is fixed would touch the same labels twice.

**068 is a label-rename story, so S14's standing rule applies directly to it**: an accessible name
used as a `getByRole` selector must be grepped across `scripts/flows/` and `scripts/lib/screens.mjs`,
not just the story's own flow. "Client" appears in dialog and library labels that existing flow
scripts select by name.

**068 narrows what is selectable, not what is detected.** Decided with the user: detection keeps
classifying all of `ENGINE_DEFINITIONS`, an installation on an unsupported engine keeps its own
badge and is marked unsupported in text. That leaves the roadmap follow-up "verify executable and
marker names for engines other than r1q2/Q2PRO" alive but demoted — it now only affects
classification accuracy, never what the launcher will launch.

**069 must re-measure, not assume, story 061's editor floor.** Its second header line costs height
against the 30-visible-line budget `scripts/flows/config-header-geometry.mjs` guards (061 AC4); the
current baseline is 32 lines, so the headroom is about two lines. If the guard goes red, the height
has to be funded inside the header, not by lowering the floor.

**066 goes last** — the largest story of the four, and the only one with two `deliverable-hard`
steps, one of them at the path-trust boundary (an id → path registry for renderer-supplied import
paths). It is also the only one in a different field (profile creation rather than installation
identity), so nothing else in the sprint waits on it.

**032 (Downloads running-count badge) is deliberately not in this sprint** — the `downloads` module
that would produce the count is still `status: planned`, and the story itself asks not to be
scheduled before it exists.
