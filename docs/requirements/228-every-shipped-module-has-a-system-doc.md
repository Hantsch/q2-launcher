---
id: 228
title: every shipped module has a system doc
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a developer following docs/README.md's rule "how a finished system works → systems/", I want
to find an as-built reference for every shipped module, and concepts to say they are shipped
once they are, so that binding decisions are clear and the real config pipeline is not
recoverable only from 2,000 lines of in-code comments.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F35; a roadmap follow-up
since S18): `docs/systems/config-module.md` was last touched 2026-09-10 while the module gained
stories up to 175; it says the status "moves off planned once the renderer view is registered",
lists four resolved "open points", references `src/core/engines.ts`/`src/core/settings.ts` and
`lib/restore-defaults.ts` (none exist), and never mentions `import-reader`, `config-parser`,
`profile-restore`, `file-source`, `tidy-up`, cvar sections, the Raw File tab or the 35 handlers
(`profile-file-format.md`, by contrast, matches the code). `game-browser.md` says "Draft, no
stories yet" with Phase 9 7/7 done; `home-screen.md` the same (done 2026-09-11); `demo-browser.md`
"no sprint yet" after S26–S30; there is no systems doc for servers, replays, home or mods;
`install-module.md` and `linux-support-analysis.md` have three broken links each; the
home-screen §6 correction has been a follow-up since 2026-09-11.

Depends on story 227 (link checker, placement of the as-built architecture sections).

## Acceptance Criteria

- [ ] **AC1** — `docs/systems/config-module.md` is an as-built reference: component map,
      parse → fold → restore → store → render → sync flow, the handler table with each handler's
      write rule, the startup sequence, known limitations; vision and interview history move to
      `docs/concepts/` or are dropped; no reference to a file that does not exist.
- [ ] **AC2** — `game-browser.md` and `home-screen.md` are moved to `docs/systems/` with an
      as-built status line (and the §6 content-repository correction applied); `demo-browser.md`
      carries its real status; `docs/README.md`'s concept/system rule holds for every file.
- [ ] **AC3** — `docs/systems/` has a short as-built doc for servers, replays, home and mods
      (each ≤ 150 lines: purpose, main/shared/renderer map, persisted state, handlers, external
      inputs, limitations).
- [ ] **AC4** — `scripts/check-docs.mjs` (story 227) is green: no broken links under `docs/`.
- [ ] **AC5** — The module story checklist in docs/ARCHITECTURE.md includes "update the module's
      systems doc" and `/sprint`'s review step checks it.

## Open Questions

- none

## Plan

<!-- Filled by /refine 228. -->

## Deliverables

<!-- Filled by /refine 228. -->

## Model Hints

<!-- Filled by /refine 228. -->

## Acceptance Tests

<!-- Filled by /refine 228. -->

## Done

<!-- Filled by /build 228. -->
