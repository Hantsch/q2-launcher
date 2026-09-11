---
sprint: S18
status: in-progress # planned | in-progress | done
branch: sprint/18
milestone: Phase 3 M1 (news hero) + M2 (dashboard); Phase 4 M1 (install — r1q2)
---

# Sprint S18 — R1Q2 installs, and the home screen becomes a real screen

## Goal

At the end of this sprint two things are demonstrable. First: the bootstrap wizard offers R1Q2 as
a second engine and produces a client that launches and loads a map. Second: the home screen is a
`home` module showing a live community news hero over a dashboard the user arranges themselves,
with two real tiles in it — the launcher stops advertising what it will do and starts showing
what is going on.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 080 — Install R1Q2 from the community package
- [x] 081 — The home screen belongs to a home module
- [x] 082 — The launcher fetches the community news feed
- [x] 085 — The content repository carries the news contract
- [x] 083 — The hero is the news carousel
- [x] 084 — Slide images come from the launcher's own cache
- [x] 086 — The dashboard is a grid I arrange myself
- [x] 087 — Two tiles worth having — playtime and config profiles

## Notes

**Scope decision (User, 2026-09-10).** The whole home-screen milestone goes in, next to 080 —
eight stories against the workflow's 3–6 guideline and against S16's six. The order above is the
cut line: 080 is independent and lands first, 081–085 close the news half (Phase 3 M1), 086–087
the dashboard half (Phase 3 M2). If the sprint runs long, 086 and 087 are the pair to defer —
everything before them is a complete, shippable increment on its own.

**Deliberate omissions.**

- No fixed right-hand friend-list column. Raised on 2026-09-07 after the prototype and postponed
  by the user; it would be a third fixed zone narrowing both hero and dashboard, and it
  contradicts the decision that the friend list becomes a dashboard module
  ([concepts/home-screen.md](../../concepts/home-screen.md) open point 1).
- No `packs/`, `mods/` or `config_templates/` content — the directories exist, nothing reads them.
- No in-app markdown detail view, no typed in-launcher slide actions, no multiple or
  per-installation layouts, no periodic background refresh.
- Install: retail import, update/rollback, repair and removal from disk stay out; 080 is the
  engine-coverage slice only.

**Dependencies.** 082–087 all sit on 081's module move. 083 needs 082's feed, 084 needs 083's
templates, 087 needs 086's grid. 085 is only loosely coupled — it is scheduled after 082 so the
contract it documents is the one the launcher actually validates.

**Content repository (User, 2026-09-10).** Story 085 writes files into the existing local
checkout `C:\development\Hantsch\q2_community_content` — no commit, no push, no release.
Publishing is the user's decision; the launcher's tests use the checked-in fixture copy.

**In flight next to this sprint.** Story 079 (config: a save reaches every installation, and Care
sees drift) is being finished on `dev` outside a sprint. It touches the config module only and
does not overlap this sprint's files.
