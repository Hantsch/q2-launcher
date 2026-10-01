# Sprint S31 — review

## Overview

Goal: the Mods view, a curated catalog, install, remove and update, the mod/map answer in the server
detail and the demo mod warning, plus exact search, Online/LAN and quick filters in the server browser.
All ten stories are done on `sprint/S31`. **Do not merge before reading the Regression gate section:**
four flows are red, all pre-existing (none caused by this sprint).

| Story | Status | Commit |
| --- | --- | --- |
| 188 mods view | done | 70d16c4 mods module — view, tile catalog, detail, reveal |
| 189 catalog | done | c83022b manifest, parser, service, catalog tiles, detail |
| 190 install | done | ad68d4d engine target, stager, install job + record, decision dialog |
| 191 remove | done | 303dee2 recorded-files-only removal, job, dialog |
| 192 server detail | done | d3121fe mod/map presence, pak reader, install offer (+ b971230 gate fix) |
| 193 mod-missing warning | done | 236da3d Install action in the dialog |
| 194 update | done | da174d3 update status/plan, job with backup/restore, dialog |
| 195 quoted search | done | 65ba234 |
| 196 Online/LAN | done | d0a10da |
| 197 quick filters | done | 88464b4 |

## Implemented stories

- **188–191:** the Mods view lists the installation's game dirs with origin; the catalog (Action Quake
  with selectable versions, OpenTDM, CTF) comes from the content repository; install picks the build
  by engine architecture (manifest, else PE/ELF header) or goes content-only with a visible reason;
  removal deletes only recorded files and asks about changed ones.
- **192–194:** the server detail says whether mod and map exist locally (loose and in pak/pkz) and
  offers the install; the demo mod warning offers it too; a differing catalog version is offered and
  updated with backup and restore.
- **195–197:** `"quoted"` search is exact; the server list switches Online/LAN (per-interface
  broadcast, port 27910); up to 8 named quick filters, structured criteria only.

## Findings & decisions

- **User decisions:** layout decided in the story, no prototype (188); the view follows the globally
  selected installation and says so (188); the catalog lets the user pick a version (189); changed
  files are asked per operation for install/remove/update (190/191/194); all other questions took the
  recommended answer.
- **OpenTDM on 64-bit Q2PRO is refused** with `mods.error.noVariant`: its manifest `contentOnly.packages`
  is empty. The demo dialog (193) cannot resolve it — the player can only Play anyway or Cancel.
  Decide whether OpenTDM needs a content-only variant or a 64-bit build.
- **AQtion paks are `.pkz`; r1q2 reads only `.pak`.** Records carry `pkzUnsupported` and the UI says so.
- **OpenTDM's library has a suffixed name**; the install renames it to `gamex86.dll`/`.so`.
- **`.tar.gz` needs two extraction passes** with the vendored 7-Zip (tested).
- `ModsView` is the only host of 190's decision dialog besides the server detail and Demos view, which
  mount it too; a decision event arriving while no host is mounted is lost.
- 189's `--check` of the manifest downloads about 1 GB (AQtion zips ~497 MB each).
- Unfixed minor points from the builds: update job's keep/cancel paths untested; a watchlist recheck
  started in LAN mode stays pending; concurrent catalog fetches fetch twice; the changed-files radios in
  the remove dialog are ~20px high with no CLAUDE.md deviation row.
- Flaky: `replays-mod-warning` step "resetting remembered mods asks again" failed in 1–2 of ~6 runs.
- Process: 195's build agent reported `servers-filter-search` red at HEAD; confirmed pre-existing.
  The 194 build agent was denied editing the layering test allowlist and correctly left it — the gate
  fixed the cause instead of the test.

## Blocked / open

Nothing blocked. Open: the four pre-existing red flows (below), the OpenTDM refusal above.

## Regression gate

From `sprint.md`: build, `npm test`, `ui:verify` green after the fix; `ui:flows` 132/136.

- `layering.test.ts` — bisected by git to story 192 (`d3121fe`); **fixed** in `b971230`.
- `replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order` —
  **pre-existing**, red on the merge-base too (merge-base comparison, not a bisect). Not fixed.

## Acceptance

Every story's AC1–ACn was proven by named unit tests and `ui:flow` flows, listed in each story's
`## Done` (docs/requirements/done/188–197-*.md). **Manual residue: none declared.** Level notes:
- 192 AC5 (statement flips after install) has no extra code; it follows the store's `gameDirs`.
- 195 AC5 is unit-level only (the live UDP fixture always fetches the roster).
- 196 uses a harness-only target hook (`Q2L_UI_LAN_TARGETS`); loopback broadcast is unreliable on
  Windows, so real multi-interface broadcast is not exercised end to end.
- 189's catalog flows use fixture servers; the shipped manifest's hashes are checked by
  `manifest-hashes.mjs --check`.

## Tier record

| Story | Ds | hard Ds | review | cycles | agents | build min |
| --- | --- | --- | --- | --- | --- | --- |
| 188 | 3 | 0 | default | 1 | 6 | 16 |
| 189 | 5 | 1 | default | 1 | 9 | 35 |
| 190 | 8 | 1 | default+hard | 2 | 14 | 56 |
| 191 | 3 | 1 | default | 0 | 6 | 16 |
| 192 | 4 | 1 | default | 0 | 8 | 22 |
| 193 | 2 | 0 | default | 1 | 5 | 16 |
| 194 | 5 | 1 | default | 1 | 8 | 27 |
| 195 | 2 | 0 | default | 1 | 5 | 7 |
| 196 | 5 | 1 | default | 1 | 8 | 27 |
| 197 | 4 | 0 | default | 1 | 6 | 14 |
| **Total** | **41** | **6** | 1 hard review of 10 | 9 | 75 | 236 |

The one hard review (190) fixed 3 findings the default review had not raised. Refine took 9 min; gate
took ~3 min (short suites) + 49 min (flows) + ~10 min (attribution and fix).
