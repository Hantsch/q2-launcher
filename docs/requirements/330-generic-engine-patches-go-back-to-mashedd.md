---
id: 330
title: Generic engine patches go back to MashedD
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-31
---

## Requirement

Our engine stays close to MashedD/q2pro. Fixes and web-target improvements that any Q2PRO web
build can use live in MashedD's repo; `engine/patches/` only carries what exists for the
launcher. MashedD has said contributions are welcome. Each upstream update then costs a small
rebase instead of a growing private fork.

Context:

- [concept §17 Q2](../concepts/integrated-demo-player.md) (revised base decision),
  [[281]] (base, pin, patch series), `spikes/281-engine-build/RESULT.md`.
- Proposed split of today's series (refine confirms per file):
  - Upstream: 0001–0004 (meson web build: no game library, opt level, OpenAL optional, software
    sound), 0006 (`SV_MvdMulticast` stub fix), the generic parts of 0007 (host-given msec in
    `common.c`) and 0008 (`snddma` web driver `src/unix/sound/web.c`), behind meson options where
    they change defaults.
  - Local: 0005 (launcher ES-module link flags), 0009, 0010 and every `q2l_*` export
    (`src/unix/q2l_step.c`).
- Push and pull requests to MashedD are done by the maintainer, not by an agent; the story
  prepares the branches and PR texts locally.
- Not in scope: new engine features; changing MashedD's defaults for other users.
- Expected manual residue: opening the PRs and waiting for MashedD's merge.

## Acceptance Criteria

- [ ] **AC1** — A local branch on MashedD's current HEAD carries each upstream patch as its own
      commit, builds with MashedD's `build-web.sh` and changes no default of a non-web build.
- [ ] **AC2** — A PR text per upstream commit exists (what, why, how tested).
- [ ] **AC3** — After MashedD merges, `engine/UPSTREAM` points at the merge commit and
      `engine/patches/` holds only launcher-specific patches.
- [ ] **AC4** — With the new pin, `npm run engine:verify` is green and the wasm still passes the
      integrated-player flows.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
