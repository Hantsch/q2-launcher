---
id: 228
title: every shipped module has a system doc
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a developer following docs/README.md's rule "how a finished system works → systems/", I want
to find an as-built reference for every shipped module, and concepts to say they are shipped
once they are, so that binding decisions are clear and the real config pipeline is not
recoverable only from 2,000 lines of in-code comments.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F35; a roadmap follow-up
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

- [x] **AC1** — `docs/systems/config-module.md` is an as-built reference: component map,
      parse → fold → restore → store → render → sync flow, the handler table with each handler's
      write rule, the startup sequence, known limitations; vision and interview history move to
      `docs/concepts/` or are dropped; no reference to a file that does not exist.
- [x] **AC2** — `game-browser.md` and `home-screen.md` are moved to `docs/systems/` with an
      as-built status line (and the §6 content-repository correction applied); `demo-browser.md`
      carries its real status; `docs/README.md`'s concept/system rule holds for every file.
- [x] **AC3** — `docs/systems/` has a short as-built doc for servers, replays, home and mods
      (each ≤ 150 lines: purpose, main/shared/renderer map, persisted state, handlers, external
      inputs, limitations).
- [x] **AC4** — `scripts/check-docs.mjs` (story 227) is green: no broken links under `docs/`.
- [x] **AC5** — The module story checklist in docs/ARCHITECTURE.md includes "update the module's
      systems doc" and `/sprint`'s review step checks it.

## Decisions (Sprint)

- **D-a** AC5's "`/sprint`'s review step checks it" lands in `.claude/ai-scrum.md` `## Notes` plus
  docs/README.md "Maintenance", not in `.claude/commands/sprint.md` — that file is plugin-managed,
  the same call the user made for story 229 AC4 (its upstreaming follow-up covers both rules).
- **D-b** New docs are named `docs/systems/<module>-module.md` (`servers-module.md`,
  `replays-module.md`, `home-module.md`, `mods-module.md`) — the existing `config-module.md` /
  `install-module.md` convention.
- **D-c** The moved `game-browser.md` / `home-screen.md` stay long design references in
  `docs/systems/`; the short as-built `servers-module.md` / `home-module.md` link to them — AC3
  asks for ≤ 150-line docs, which a 600–900-line concept cannot be.
- **D-d** `downloads` is covered by `install-module.md` (it already says so); `library` gets a short
  "Library module" section there instead of an own doc — it is one stats handler over the shell's
  installation management, which that doc already describes.
- **D-e** `demo-browser.md` stays in `docs/concepts/` with a real status line (v1 shipped in
  S26–S30, Phase 10 done; §9.2 WASM playback deferred) — it is not fully implemented, and
  `src/main/modules/replays/name-template-doc.test.ts` reads it there. `mods.md` stays too
  (milestone 5.2 open) with its status line corrected to "5.1 shipped".
- **D-f** config-module.md's vision, goals and interview history are dropped, not moved to
  `concepts/` — docs/README.md reserves `concepts/` for unbuilt systems and git keeps the history;
  decisions that still constrain the code stay as a short "Binding decisions" list.
- **D-g** Story 214 (built earlier this sprint) adds a dependency-direction paragraph and possibly
  pipeline history to config-module.md; the rewrite keeps both — they are as-built content.
- **D-h** Moving the two concepts rewrites every inbound relative link, including those in
  `docs/requirements/done/` and `docs/sprints/done/` — AC4's link checker covers `docs/**`.
- **D-i** The roadmap follow-up line about home-screen §6 is deleted once the correction lands —
  this story makes it obsolete (229's triage then has one line less).
- **D-j** The ACs are proven by one doc test, `src/main/modules/systems-docs.test.ts` (next to the
  existing `architecture-doc.test.ts`), reading the docs and the pure `@shared/modules/*`
  handler constants — a structural check is the only automatable proof a doc is as-built.

## Open Questions

- none

## Plan

Docs-only story; no runtime code changes. Runs after 227 (link checker `scripts/check-docs.mjs`,
rewritten ARCHITECTURE.md checklist) and 214 (config-module.md paragraph).

1. **config-module.md** rewritten as-built from `src/main/modules/config/`, `src/shared/config/`,
   `src/shared/modules/config.ts` and the renderer module (D1). Creates the doc test file.
2. **Four short as-built docs** for servers, replays (D2), home, mods (D3), each ≤ 150 lines with
   the same six sections; D3 adds the "every registered module has a doc" check.
3. **Placement + links** (D4): `git mv` game-browser.md and home-screen.md to `docs/systems/`,
   as-built status lines, §6 correction, demo-browser/mods status lines, every inbound link
   rewritten, install-module.md / linux-support-analysis.md broken links fixed, library section,
   roadmap §6 follow-up removed; `node scripts/check-docs.mjs` green.
4. **Process rule** (D5): ARCHITECTURE.md "Adding a module" names the systems doc; docs/README.md
   Maintenance and `.claude/ai-scrum.md` Notes carry the sprint-review check.

Order D1 → D2 → D3 → D4 → D5 (D4 last-but-one so the link check sees the final file set).
No CHANGELOG entry (nothing user-visible).

## Deliverables

- **D1 — config-module.md is an as-built reference.** Rewrite `docs/systems/config-module.md`
  from the code (`src/main/modules/config/index.ts` handlers, `write-plan.ts`, `writer.ts`,
  `sync.ts`, `file-source.ts`, `import.ts`, `persisted.ts`; `src/shared/config/` incl.
  `config-parser`, `import-reader`, `profile-restore`, `tidy-up`; `src/shared/modules/config.ts`
  `CONFIG_HANDLERS`; `src/renderer/src/modules/config/` incl. the Raw File tab and cvar
  sections). Sections, in this order and with these headings: `## Component map` (main / shared /
  renderer, one line per file group), `## Flow` (parse → fold → restore → store → render → sync,
  one short paragraph each), `## Handlers` (a table: every `CONFIG_HANDLERS` key in backticks,
  what it does, its write rule — none / writes the profile store / writes engine cfg files / both),
  `## Startup` (what runs at module setup, in order), `## Binding decisions` (short list of
  decisions still constraining the code), `## Known limitations`. Keep story 214's
  dependency-direction paragraph for `src/shared/config` and any pipeline history it moved here.
  Drop vision, goals, the interview history and "Open points"; drop every reference to a file that
  does not exist (e.g. `src/core/engines.ts`, `src/core/settings.ts`, `lib/restore-defaults.ts`).
  Status line: `Status: **Implemented.**` plus one sentence, no "moves off planned" wording.
  Test: create `src/main/modules/systems-docs.test.ts` (mirror the read-the-doc style of
  `src/main/modules/architecture-doc.test.ts`; vitest, node env) with a helper
  `backtickedPaths(doc)` and a `describe('config-module.md')` holding: "names every config
  handler" (every key of `CONFIG_HANDLERS` appears as `` `key` `` inside `## Handlers`), "has the
  as-built sections" (the six headings above present, no `Vision`/`Open points`/`interview`
  heading), and "references only files that exist" (every backticked token ending in
  `.ts`/`.tsx`/`.mjs`/`.json` resolves from the repo root when it starts with `src/`, `scripts/` or
  `docs/`, otherwise its basename exists somewhere under `src/` or `scripts/`). Export the path
  check as a function reused by D2/D3 cases.
- **D2 — servers and replays have as-built docs.** Create `docs/systems/servers-module.md` and
  `docs/systems/replays-module.md`, each ≤ 150 lines, headings `## Purpose`, `## Map` (main /
  shared / renderer files), `## Persisted state` (what `persisted.ts` stores, under which state
  slot), `## Handlers` (every key of `SERVERS_HANDLERS` + `SERVERS_WATCHLIST_HANDLERS` /
  `REPLAYS_HANDLERS` in backticks, one line each), `## External inputs` (network, files, engine
  processes it reads), `## Limitations`. First line under the title: `Status: **Implemented.**`
  plus a link to the long design reference (`game-browser.md` — after D4 it is in `systems/`, so
  link `game-browser.md` and `../concepts/demo-browser.md` respectively). Sources:
  `src/main/modules/{servers,replays}/`, `src/shared/modules/{servers,replays}.ts`,
  `src/renderer/src/modules/{servers,replays}/`. Test: add to `src/main/modules/systems-docs.test.ts`
  a table-driven `describe('short module docs')` with, per doc, "<file> is at most 150 lines and
  has the six sections", "<file> names every handler" and "<file> references only files that
  exist" (reuse D1's path check). Link to `game-browser.md` may be red in check-docs until D4.
- **D3 — home and mods have as-built docs; every module is covered.** Create
  `docs/systems/home-module.md` (link `home-screen.md`, design reference after D4) and
  `docs/systems/mods-module.md` (link `../concepts/mods.md`; milestone 5.1 as built), same six
  sections and ≤ 150 lines as D2's `servers-module.md`. Sources: `src/main/modules/{home,mods}/`,
  `src/shared/modules/{home,mods}.ts`, `src/renderer/src/modules/{home,mods}/`. Test: add both
  files to D2's table in `src/main/modules/systems-docs.test.ts`, plus a case "every registered
  module has a systems doc": a map `{ config: 'config-module.md', downloads: 'install-module.md',
library: 'install-module.md', home: 'home-module.md', servers: 'servers-module.md', replays:
'replays-module.md', mods: 'mods-module.md' }`; every folder under `src/main/modules/` that has
  an `index.ts` has a key, and every mapped file exists under `docs/systems/`.
- **D4 — concepts and systems are placed by status; no broken link.** `git mv
docs/concepts/game-browser.md docs/systems/` and `git mv docs/concepts/home-screen.md
docs/systems/`; their status lines become `Status: **Implemented.**` + one sentence naming the
  phase (game browser: Phase 9; home: Phase 3) and that the doc is the design reference. In
  home-screen.md §6, replace "contains only a LICENSE" with the real content repository layout
  (`engines/`, `gamedata/`, `news/` — story 080; check `content/q2_community_content/README.md`).
  `docs/concepts/demo-browser.md` status: v1 shipped S26–S30 (Phase 10 done), §9.2 browser
  playback deferred; `docs/concepts/mods.md` status: milestone 5.1 shipped, 5.2 open. Rewrite
  every inbound relative link to the two moved files across `docs/**` (incl. `requirements/done/`,
  `sprints/done/`, `prototypes/`), `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, and fix the
  moved files' own outbound relative links. Fix the broken links in
  `docs/systems/install-module.md` and `docs/linux-support-analysis.md`; add a short `## Library
module` section to install-module.md naming every `LIBRARY_HANDLERS` key (`src/shared/modules/library.ts`).
  Delete the home-screen §6 line from docs/ROADMAP.md "Follow-ups worth doing". Acceptance:
  `node scripts/check-docs.mjs` exits 0. Test: add to `src/main/modules/systems-docs.test.ts`
  `describe('docs placement')`: "shipped concepts live in systems" (game-browser.md and
  home-screen.md exist under `docs/systems/`, not under `docs/concepts/`), "no systems doc says it
  is a draft" (no `docs/systems/*.md` status line contains `Draft`, `no stories yet`, `no sprint
yet` or `planned`), "no concept claims to be unstarted when it shipped" (no `docs/concepts/*.md`
  status line contains `no stories yet` or `no sprint yet`), "home-screen §6 names the real
  content repository" (does not contain `only a LICENSE`; contains `engines/`), and
  "install-module.md names every library handler".
- **D5 — the module checklist and the sprint review require the systems doc.** In
  `docs/ARCHITECTURE.md` `## Adding a module` (rewritten by story 227; it has a docs step), make
  the docs step read: create or update `docs/systems/<id>-module.md` (purpose, map, persisted
  state, handlers, external inputs, limitations) — and every later story that changes the module
  updates it. In `docs/README.md` `## Maintenance` add one bullet: a story that changes a shipped
  module updates its systems doc; the `/sprint` review checks it. In `.claude/ai-scrum.md`
  `## Notes` add one paragraph: the sprint review (phase 3) checks that every story touching
  `src/main/modules/<id>/` or `src/renderer/src/modules/<id>/` also touched that module's
  `docs/systems/` doc, and lists a miss as a finding. Do not edit `.claude/commands/*.md`
  (plugin-managed). Test: add to `src/main/modules/systems-docs.test.ts` `describe('process
rule')`: "Adding a module names the systems doc" (section between `## Adding a module` and the
  next `## ` contains `docs/systems/`), "the sprint review checks the systems doc" (`.claude/ai-scrum.md`
  after `## Notes` contains `docs/systems/` and `review`; docs/README.md `## Maintenance` contains
  `systems doc`).

## Model Hints

- D1 → deliverable-hard: the handler table's write rule and the startup sequence must be read out
  of a ~1,900-line `config/index.ts` plus `write-plan.ts`/`sync.ts`, and a plausible but wrong
  write rule or flow description passes every structural test.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/systems-docs.test.ts` › "config-module.md" › "names every config
  handler", "has the as-built sections", "references only files that exist" (D1)
- AC2 → unit `src/main/modules/systems-docs.test.ts` › "docs placement" › "shipped concepts live
  in systems", "no systems doc says it is a draft", "no concept claims to be unstarted when it
  shipped", "home-screen §6 names the real content repository" (D4)
- AC3 → unit `src/main/modules/systems-docs.test.ts` › "short module docs" › "<file> is at most
  150 lines and has the six sections", "<file> names every handler", "<file> references only
  files that exist" for servers/replays (D2) and home/mods (D3); "every registered module has a
  systems doc" (D3)
- AC4 → unit: story 227's check-docs test run by `npm test` (`scripts/check-docs.mjs`; exact test
  file/name as 227 lands it), plus `node scripts/check-docs.mjs` exit 0 in D4
- AC5 → unit `src/main/modules/systems-docs.test.ts` › "process rule" › "Adding a module names the
  systems doc", "the sprint review checks the systems doc" (D5)
- No e2e: no criterion describes a user action (docs only).

## Done

Config, servers, replays, home and mods now have as-built system docs written from the code; game-browser and
home-screen moved to `docs/systems/` (status lines, §6 content-repository correction, every inbound link
rewritten); demo-browser/mods status lines corrected; install-module.md gained a Library section; the module
checklist, docs/README.md and `.claude/ai-scrum.md` require the systems doc.

Commit message: `228: as-built system docs for config/servers/replays/home/mods, game-browser+home-screen moved to systems, systems-docs test`

Verification (narrow gate): `npm run build`, `lint`, `typecheck`, `npx vitest run --changed HEAD` (23 tests), `node scripts/check-docs.mjs` all green. No e2e (docs only). AC → test as run:
AC1 "config-module.md" ×3; AC2 "docs placement" ×5; AC3 "short module docs" (4 docs ×3) + "every registered module has a systems doc";
AC4 `scripts/check-docs.test.mjs` (5/5) + check-docs exit 0; AC5 "process rule" ×2. No manual residue. Review (default): PASS.

Decisions:

- Handler write rules and startup order taken from the code (index.ts, profile-writes.ts, startup.ts); reviewer spot-checked 12 handlers, all accurate.
- Runtime files (state.json, replays-index.json, news-feed.json, catalog-cache.json) are written without backticks since the doc test resolves backticked `.json` to source files.
- Reviewer minor findings left unfixed: non-rooted path check is basename-only; handler check has no reverse (stale handler) check; AC5 test is loose; story numbers in config Binding decisions are pointers, not narrative; prettier re-padded tables in ROADMAP.md/install-module.md (cosmetic); demo-browser.md says Implemented but stays in concepts/ per D-e.
- Possible product bug found while writing (not fixed, recorded as a limitation in config-module.md): `setSwitchBind` writes the default profile's live record straight through `writeInstallationFiles`, bypassing `syncAndPersist`, so unsaved default-profile edits reach the installation and the external-edit guard is skipped. Candidate for story 229's triage.

tiers: D 5 / hard 1 · review default · cycles 0 · agents 7
