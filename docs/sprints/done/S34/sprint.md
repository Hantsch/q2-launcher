---
sprint: S34
status: done # planned | in-progress | done
branch: sprint/S34
milestone: # roadmap milestone, set by /roadmap plan
---

# Sprint S34 — Codebase health closed, and the demo, install and server stories from user feedback

## Goal

The five open codebase-health drafts from the S32 review are closed (typed module handlers, a flow gate without
quarantine, release verification before a merge to main, shutdown/store/job edge cases, no known holes in the
layer and error-key rules). The demo browser, the add-installation flow and the server browser carry the
refinements from the latest user feedback.

## Stories (in build order)

- [x] 232 — every module's handlers are typed from a contract
- [x] 236 — the layer and error-key rules have no known holes
- [x] 235 — shutdown, state store and job edge cases are closed
- [x] 233 — the flow gate has no quarantined flows and catches cross-story breakage
- [x] 234 — release verification and CI rehearsals run before a merge to main
- [x] 245 — the demo detail lists players by team
- [x] 243 — the demo detail is edited in place and saves itself
- [x] 242 — I browse my demos in their folders
- [x] 238 — the demo list shows the selected installation's demos
- [x] 244 — I select several demos and delete, tag or move them
- [x] 241 — I comment a moment on the demo timeline
- [x] 237 — I set the demo volume with a slider
- [x] 239 — adding an installation is one flow wherever I start it
- [x] 240 — the install folder is created for me and shown before install
- [x] 249 — I pick mod and map when I start an installation
- [x] 246 — an installation with several engines lets me choose one
- [x] 247 — I filter servers by maximum ping
- [x] 250 — scan now refreshes only the servers my filter shows
- [x] 248 — I filter servers by several mods at once

## Notes

- Source: all open drafts except 102 (Linux Q2PRO build; its Q1–Q4 are still undecided).
- Build starts only after S32 and S33 are merged into `dev` (S33 builds on S32; 232–236 build on both).
- **Order.** The health stories come first so the typed handlers, the stricter layer rules and the unquarantined
  flow gate guard everything after them: 232 → 236 → 235 → 233, with 234 last of the group because it rehearses
  the release path on the finished tree. User stories follow by dependency: 245 before 243; 242 before 238 and
  244 (folder target); 239 before 240 (name field); 247 before 250 (the filter the scan follows).
- 19 stories is a large sprint (S33 had 16). Most user stories carry open questions (about 50 in total), so the
  clarification round will be long; 237, 241, 246, 248, 249 are independent and the first to cut if the sprint
  needs to shrink.

## Regression gate

Ran on `dc6fa0d` (all 19 stories' commits); the fixes were committed as `d73d2ff` and the confirmation run is on `d73d2ff`.

| Command                                        | Minutes | Result                                                                                                                               |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`                                | < 1     | green                                                                                                                                |
| `npm test`                                     | < 1     | 4 red: `check-docs`, `flow-helper-duplication`, `flow-select`, `tech-debt`                                                           |
| `npm run ui:verify`                            | 3.7     | red: 14 replays screens unreachable                                                                                                  |
| `npm run ui:flows` (first run)                 | 65      | red: 161/169, 8 flows red                                                                                                            |
| fixes, re-verified on the working tree         | ~30     | 4 unit files, typecheck, lint, comments + architecture, 21 helper/changed flows green; `ui:verify` exit 0 (116 shots, 0 unreachable) |
| `npm run ui:flows` (confirmation on `d73d2ff`) | 65.5    | green: 169/169                                                                                                                       |

Per failure (each judged against docs/UI-VERIFICATION.md#what-a-flow-may-assert; all fixes are in flows, tests, docs or
scripts, none in `src/`):

- `check-docs` and `tech-debt` tests — the sprint moved stories 232/233/235/236/237-250 and the S32/S33 sprint folders into
  `done/`, so links broke. **Fixed** with `check-docs --fix` paths.
- `flow-select` — `areas.json` rows over 12 flows (replays-playback, downloads-bootstrap). **Fixed** by splitting the rows.
- `flow-helper-duplication` — helpers copied into `replays-copy-in` and `servers-flow` (242, 238, 247). **Fixed** by moving
  them to `scripts/lib`.
- `ui:verify` replays screens — stories 238 (installation scope) and 242 (folder view) changed what the list shows first.
  **Fixed** in `screens.mjs` (all installations, flat filter view).
- `add-installation-one-flow` — story 240: the target step asks for a parent and proposes a subfolder. **Fixed** in the flow.
- `linux-user-journey`, `runner-choice-compact`, `steam-handoff`, `windows-build-on-linux` — story 239 removed the Library
  "Add existing" button. **Fixed**: the flows use `openLibraryAddEntry`.
- `replays-filter-search` — story 242 (folder view). `replays-mod-warning` — story 238 (scope reset drops the selection).
  `replays-play-q2pro` — story 237 (the extra `+set s_volume` token). **Fixed** in the flows. Stories 237, 241, 244 and 246
  had reported such reds as "pre-existing, not ours"; they were caused by earlier stories of the same sprint.
- Quarantine: `scripts/flows/quarantine.json` stays `[]`; no entry written, no unexpected pass.
- Unattributed / blockers: none.
- Story 234 rehearsal (after the gate, record `.rehearsal/20261006-073931`, PASSED): `verify:release` 1029 s, `ci:local` 270 s,
  `ci:local:flows` 1412 s; six shards 685/682/820/664/747/666 s (limit 900); six real runs, each red triaged and fixed or
  quarantined (20 Linux entries). The work changed about 100 format-only files, 4 flows and `quarantine.json` after the
  169/169 confirmation, which was not repeated: the final tree had narrow checks only (typecheck, lint, `prettier --check`,
  targeted vitest, the touched flows on Windows).
