---
id: 192
title: the server detail says whether I have its mod and map
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player looking at a server in the browser, I can see at once whether my active installation
has the server's mod and its current map. If the mod is missing and the launcher's catalog has
it, I can install it right there instead of hunting for it. This redeems GB-D5, which was cut from
story 124 and is owned by the Mods module ([game-browser.md](../concepts/game-browser.md) GB-D5),
extended with an install offer.

Concept: [mods.md](../concepts/mods.md) §11; requirements MOD-15 to MOD-17.

## Acceptance Criteria

- [x] **AC1** — The server detail shows a visible statement of whether the server's mod exists in
      the active installation (_mod installed_ / _mod missing_). A server on the base game shows
      no mod statement.
- [x] **AC2** — The server detail shows a visible statement of whether the server's current map
      exists locally (_map available_ / _map missing — the server will send it_).
- [x] **AC3** — With the mod missing and a catalog entry of the same gamedir name (matched
      case-insensitively), the detail offers _Install_. Clicking it starts story 190's install
      into the active installation.
- [x] **AC4** — With the mod missing and no catalog entry, no Install button appears, and the
      statement stays.
- [x] **AC5** — When the install finishes, the statement changes to _mod installed_ without
      reopening the detail.
- [x] **AC6** — A gamedir string from a server that is not a safe single path token is shown as
      text but never used to build a path or start an install.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — (concept §14 item 3) — Is "the map exists locally" a check for a loose `maps/<map>.bsp`
  only (in the mod's gamedir and `baseq2`), or does it also look inside `.pak`/`.pkz` files?
- ~~**Q2**~~ answered → Decisions (Sprint) — (concept §14 item 5) — How does the servers module ask the mods module for catalog and
  installed status and start an install, without editing the shell? Options: a shared pure helper
  plus the renderer calling the mods channels, or a main-side service on `AppContext`.
- ~~**Q3**~~ answered → Decisions (Sprint) — — Is the statement shown in the detail only, or also as a marker in the server list rows?

## Decisions (Sprint)

- **(User)** Map exists locally: loose maps/<map>.bsp and inside .pak/.pkz
- **(User)** Cross-module seam: shared pure helper plus renderer calling the mods channels; no main-side service, shell untouched
- **(User)** Where shown: server detail only, no list-row marker
- The server's mod string is the one the header already shows (`row.mod ?? serverinfo.gamedir ?? serverinfo.game`), so the statement never disagrees with the Mod cell next to it.
- Empty/absent mod or `baseq2` (case-insensitive) counts as the base game: no mod statement, map looked up in `baseq2` only — Q2 servers omit `gamedir` on the base game.
- "Mod installed" means the gamedir is in the active installation's `gameDirs` (case-insensitive, catalog _or_ manual origin) — the concept's §11 says "exists in the active installation", not "installed by the launcher".
- Gamedir and map names are trusted only if they are a safe name (`^[A-Za-z0-9_.-]+$`, 1–64 chars, not `.`/`..`), the same rule as `modWarningTrustModInputSchema` and ARCHITECTURE.md — one rule, enforced both in the pure helper and in the main-side zod schema.
- An unsafe gamedir still gets a statement (_mod missing_, never installed — it is compared as a string only), no Install, and the map lookup is sent without it (baseq2 only) — AC6 wants it shown, never used for a path.
- An empty or unsafe map name gets no map statement — it cannot be checked, and claiming _missing_ would be untrue.
- Map lookup scans every `*.pak` and `*.pkz` in `<root>/<gameDir>/` and `<root>/baseq2/` plus loose `maps/<map>.bsp`, case-insensitively — presence, not engine load order, is the question (User decision: loose + pak/pkz; `.pk3` deliberately not added).
- A corrupt/unreadable pak or pkz (or a missing 7-Zip for pkz) is skipped, never an error — a broken archive must not hide the statement for the rest.
- No cache for the map lookup: it reads only pak headers/directories and 7-Zip listings, per detail open; re-queried when the selected server, its map, or the installation's `gameDirs` change.
- The map statement is not shown until the lookup answers (and not at all on failure) — no flicker of a wrong state.
- No active installation: the section shows one line "No active installation" instead of statements, mirroring `JoinServerButton`'s visible reason.
- The section lives in the servers module (`ServerLocalContentSection.tsx`), fed by the mods module's renderer client — the precedent is servers importing `../config/client`; the shell stays untouched (User seam decision).
- The map-lookup handler is a mods-module handler (`mods/mapPresence` over `module:invoke`) — GB-D5 is owned by Mods (concept §2), and the user's seam decision is "renderer calls the mods channels".
- Install is offered for any catalog entry whose gamedir matches, including content-only variants — story 190 picks the variant and shows the content-only reason; 192 only starts it.
- Catalog unavailable (offline, no cache) behaves like "no catalog entry" (AC4) — no Install, statement stays.
- While an install job for that mod and installation is active, the Install button stays visible but disabled with an "Installing…" label — a second click must not start a second job.
- Platform parity: works the same on Windows and Linux, so no "not available on" reason is needed.

## Plan

Builds after 188–191 (mods module, catalog, install with revalidation exist). Three layers, one D each,
plus the install wiring as its own D:

1. **Shared pure helper** `src/shared/mods/server-local-content.ts`: `isSafeGameName()` and
   `serverModStatus({ serverMod, gameDirs, catalog })` → `base | installed | missing(+catalogId|null,
safe)`; `mapLookupTarget()` → `{ gameDir?, map } | null`. Unit-tested.
2. **Main**: `src/main/lib/pak-directory.ts` (bounded id PACK directory reader) and
   `src/main/modules/mods/map-presence.ts` (loose `maps/<map>.bsp`, `*.pak`, `*.pkz` via
   `listZipEntries`, case-insensitive, gamedir then baseq2). Handler `mapPresence` added to
   `src/shared/modules/mods.ts` (handler name + zod payload) and registered in the mods main module.
3. **Renderer statements**: `mapPresence` in `src/renderer/src/modules/mods/client.ts`;
   `ServerLocalContentSection.tsx` under the stat grid in `ServerDetailHeader.tsx`; i18n keys;
   component test; new flow `scripts/flows/servers-detail-local-content.mjs` (AC1/2/4/6).
4. **Renderer install**: Install button in the section using 189's catalog read and 190's install
   call; disabled while that job runs; statement flips via the store's revalidated `gameDirs`;
   extends the same flow with an install phase on 190's catalog/package fixture (AC3/5);
   CHANGELOG line.

Order D1 → D2 → D3 → D4. No shell file, no new top-level IPC channel (module handler only).

## Deliverables

- **D1 — shared helper for the mod statement and the safe-name gate.**
  New `src/shared/mods/server-local-content.ts` (pure: no `node:*`, no DOM, no electron) plus
  `src/shared/mods/server-local-content.test.ts`. Exports:
  - `isSafeGameName(value: string): boolean` — `^[A-Za-z0-9_.-]+$`, length 1–64, not `.`/`..`
    (same rule as `modWarningTrustModInputSchema` in `src/shared/modules/replays.ts:546`). If the
    mods contract (`src/shared/modules/mods.ts`, stories 188–190) already exports an equivalent
    safe-gamedir check, re-export/reuse that one instead of a second regex.
  - `serverModStatus({ serverMod: string | undefined, gameDirs: readonly string[], catalog:
readonly { id: string; gameDir: string }[] | null })` →
    `{ kind: 'base' }` (mod empty/whitespace/absent or `baseq2`, case-insensitive) |
    `{ kind: 'installed', gameDir }` (case-insensitive hit in `gameDirs`; ASCII lowercasing like
    `src/shared/replays/demo-play.ts:57`) | `{ kind: 'missing', gameDir, safe: boolean,
catalogId: string | null }` — `catalogId` is set only when `safe` and a catalog entry's gamedir
    matches case-insensitively; `catalog: null` (unavailable) → `catalogId: null`. An unsafe mod is
    never `installed`.
  - `mapLookupTarget(status, map: string | undefined)` → `null` when the map is empty or not
    `isSafeGameName`; else `{ map, gameDir? }` with `gameDir` only for `installed` (or `missing`
    and safe — harmless, main will just not find the folder); never for unsafe or `base`.
    Tests (names below in Acceptance Tests) cover every branch incl. `../x`, `my mod`, `.`, `..`,
    mixed case, `null` catalog.

- **D2 — main-side map presence lookup as a mods handler.**
  Files: new `src/main/lib/pak-directory.ts` (+ `.test.ts`), new
  `src/main/modules/mods/map-presence.ts` (+ `.test.ts`), `src/shared/modules/mods.ts` (add
  handler name `mapPresence` to the mods handler map and `modsMapPresenceInputSchema`),
  `src/main/modules/mods/index.ts` (register it). Mirror: zip listing from
  `src/main/lib/zip-entries.ts` (`listZipEntries`, used by `src/main/modules/replays/zip-demos.ts:99`);
  handler registration as the other mods handlers (188–190).
  - `readPakDirectory(path)`: reads the 12-byte header (`PACK`, dirofs, dirlen LE int32), refuses
    bad magic, `dirlen % 64 !== 0`, dirofs+dirlen beyond file size, or more than 65 536 entries;
    reads only the directory (never file data); returns entry names (56-byte NUL-terminated
    latin1). Never throws — `{ ok: false }` on any error.
  - `mapPresence({ rootPath, gameDir?, map })` → `{ available: boolean }`: for each dir in
    `[gameDir, 'baseq2']` (dedupe, case-insensitive directory lookup via `readdir`, never
    `join(root, rawName)` with an unverified name): loose `maps/<map>.bsp` (case-insensitive on
    both path parts), then every `*.pak` (`readPakDirectory`) and `*.pkz` (`listZipEntries`,
    `\` normalised to `/`) for an entry `maps/<map>.bsp` (case-insensitive). Unreadable archive →
    skipped. First hit wins.
  - Payload schema: `{ installationId: string (min 1), gameDir?: safe name, map: safe name }`,
    `.strict()`, safe name = D1's `isSafeGameName` via `.refine`. Handler resolves the
    installation by id from `app` (unknown id → fail with an i18n key, e.g.
    `mods.error.installationNotFound` if 188–190 have one, else add `mods.error.unknownInstallation`);
    the root path comes from the installation record, never from the payload.
    Tests: pak reader (valid fixture pak written in-test, bad magic, oversize dirlen, truncated);
    map-presence (loose in gamedir, loose in baseq2, inside pak, inside pkz, case-insensitive names,
    corrupt pak skipped, absent → false); schema refuses `../x`, `a/b`, `my mod`, `.`, absolute paths,
    extra keys.

- **D3 — the detail shows the mod and map statements.**
  Files: `src/renderer/src/modules/mods/client.ts` (add `getMapPresence(input)` over
  `callModule('mods', MODS_HANDLERS.mapPresence, …)`, mirror `src/renderer/src/modules/servers/client.ts:27`),
  new `src/renderer/src/modules/servers/ServerLocalContentSection.tsx` (+ `.test.tsx`),
  `src/renderer/src/modules/servers/ServerDetailHeader.tsx` (render the section below the stat
  grid, pass the same `mod` value it computes at line 106 and `row.map`), `src/renderer/src/i18n/locales/en.json`,
  new flow `scripts/flows/servers-detail-local-content.mjs` (mirror `scripts/flows/servers-detail.mjs`
  for loopback responders + `writePopulatedFixture`; use `installationRootFilePath` from
  `scripts/lib/fixture.mjs` to put real files on disk and set the fixture installation's `gameDirs`
  to match).
  - Section `data-testid="servers-detail-local-content"`; statements
    `servers-detail-mod-status` (`data-state="installed|missing"`, text _Mod installed_ /
    _Mod missing_) and `servers-detail-map-status` (`data-state="available|missing"`, text _Map
    available_ / _Map missing — the server will send it_). Base game → no mod statement element.
    Map statement absent while the lookup is pending, on failure, or when `mapLookupTarget` is null.
    No active installation (`useActiveInstallation()` null) → only
    `servers-detail-local-content-no-installation` text.
  - Status icons + text (never colour only), semantic tokens only, no new image assets.
  - Lookup is re-run on `[installation.id, gameDirs.join('\n'), status.gameDir, row.map]`
    change; stale responses for a previous server are dropped.
  - i18n keys under `servers.detail.localContent.*` (modInstalled, modMissing, mapAvailable,
    mapMissing, noInstallation).
  - Flow fixture: installation root with `baseq2/maps/q2dm1.bsp` (loose), `opentdm/pak0.pak`
    holding `maps/tdm1.bsp` (a minimal valid PACK written by the flow), gameDirs
    `['baseq2','opentdm']`; responders: A base game `q2dm1`, B `gamedir opentdm` map `tdm1`,
    C `gamedir zzunknown` map `nomap`, D `gamedir ../evil` map `q2dm1`.
    Component test covers the states with a mocked client; flow steps as in Acceptance Tests.

- **D4 — Install from the detail.**
  Files: `src/renderer/src/modules/servers/ServerLocalContentSection.tsx` (+ its test),
  `src/renderer/src/i18n/locales/en.json`, `scripts/flows/servers-detail-local-content.mjs` (extend),
  `CHANGELOG.md`.
  - Read the catalog with story 189's renderer client function (the one the Mods view uses);
    unavailable/failed read → `catalog: null`. Feed it to D1's `serverModStatus`.
  - `kind === 'missing' && catalogId !== null` → button `servers-detail-mod-install` (_Install_),
    calling story 190's renderer install function with `{ installationId: activeInstallation.id,
catalogId }` — the exact call the catalog tile's Install uses; no other install path.
    Otherwise no button (statement stays).
  - While a job for that catalog id + installation is active (the same jobs-store lookup 190's tile
    uses for its progress), the button stays visible, disabled, labelled _Installing…_.
  - No extra refresh logic for AC5: the statement is derived from the store's active installation
    `gameDirs`, which 190's post-install revalidation updates; D3's lookup re-runs on that change.
  - Flow: extend D3's flow with an install phase, reusing story 190's catalog + package fixture
    helpers (its local catalog/package source). Add responder E with a gamedir that is in that
    fixture catalog but not in the installation's `gameDirs` (e.g. `ctf` or whatever entry 190's
    fixture ships). With the catalog now loaded, the AC4 step (responder C, `zzunknown`) and the AC6
    step (responder D, `../evil`) must still show no `servers-detail-mod-install`.
  - CHANGELOG `## Unreleased` › `### Added`: one line, e.g. "Server detail shows whether you have
    its mod and map, and installs a missing mod."

## Model Hints

- D2 → deliverable-hard — it is the only code that turns server-supplied strings into filesystem
  reads in main and parses untrusted binary pak directories: a path built from the raw name, an
  unbounded `dirlen` read, or a case-sensitive lookup that silently says _missing_ on Linux would
  all pass a happy-path test.
- Review: → default — AC6's negative behaviour is pinned by the schema refusal tests (D2) and a
  flow step (D3), so no plausible wrong implementation slips past tests plus a default review.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-detail-local-content.mjs` › "server B on opentdm says mod
  installed, server C on an unknown mod says mod missing, base-game server A shows no mod statement";
  plus unit `src/shared/mods/server-local-content.test.ts` › "baseq2 and an empty mod are the base
  game" and "a gamedir in gameDirs is installed, case-insensitively".
- AC2 → e2e `scripts/flows/servers-detail-local-content.mjs` › "a loose baseq2 map and a map inside
  the mod's pak read map available, an absent map reads map missing — the server will send it";
  plus unit `src/main/modules/mods/map-presence.test.ts` › "finds a map loose, in a pak and in a pkz,
  case-insensitively" and `src/main/lib/pak-directory.test.ts` › "refuses a bad magic, an oversized
  directory and a truncated file".
- AC3 → e2e `scripts/flows/servers-detail-local-content.mjs` › "a missing catalog mod offers
  Install and clicking it starts the install job into the active installation"; plus unit
  `src/renderer/src/modules/servers/ServerLocalContentSection.test.tsx` › "Install calls the mods
  install with the active installation and the matched catalog id".
- AC4 → e2e `scripts/flows/servers-detail-local-content.mjs` › "a missing mod with no catalog entry
  shows no Install button and keeps the statement"; plus unit
  `src/shared/mods/server-local-content.test.ts` › "no catalog entry or an unavailable catalog gives
  no catalogId".
- AC5 → e2e `scripts/flows/servers-detail-local-content.mjs` › "after the install job finishes the
  statement reads mod installed without reopening the detail".
- AC6 → e2e `scripts/flows/servers-detail-local-content.mjs` › "an unsafe gamedir is shown as text,
  says mod missing and offers no Install"; plus unit `src/shared/mods/server-local-content.test.ts` ›
  "an unsafe gamedir is never installed, never installable and never a lookup target" and
  `src/main/modules/mods/map-presence.test.ts` › "the mapPresence schema refuses traversal,
  separators, spaces, dot names and extra keys".

Coverage: AC1 D1+D3 · AC2 D2+D3 · AC3 D4 · AC4 D1+D4 (statement from D3, no-button step with a loaded catalog in D4) · AC5 D4 ·
AC6 D1+D2+D3. Every AC has a D and a named test; no manual residue.

## Done

Server detail now says whether the active installation has the server's mod and its current map (`ServerLocalContentSection`, under the stat grid): mod installed/missing, map available/missing (loose + pak + pkz lookup in main via handler `mods/map.presence`), and an Install button for a missing mod with a catalog entry that reuses 190's `installMod`; the statement flips from the store's revalidated `gameDirs`. Unsafe gamedirs are text only.

Commit message: `192: server detail shows mod and map presence — shared status helper, mapPresence handler + pak reader, section, install offer, flow`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (118 files / 927 tests), `ui:flow` servers-detail-local-content and servers-detail (each after `ui:seed`): all green. Full gate not run (sprint's). AC -> test: AC1-AC6 all mapped unit + flow tests ran and passed as listed; no manual residue. Review: stage 1 PASS, no blocking findings, no fix cycle. Unfixed minor: pkz test branch returns early when 7za is missing; `lookupKey` omits `gameDirs` (stale map answer shown briefly after install); a decision event arriving while the section is unmounted is lost (same as ModsView).

Decisions:

- Server mod comes from `gamename` in serverinfo (the header's `row.mod ?? gamedir ?? game`); flow responders send `\gamename\...` and select + `servers-refresh-selected` for the stage-2 query.
- Unknown installation reuses `mods.error.installationNotFound`; handler `MODS_HANDLERS.mapPresence = 'map.presence'`, schema `mapPresenceInputSchema` (strict, `isSafeGameName` refine); main re-checks names and only joins `readdir` results.
- `InstallDecisionDialog` is also mounted in the section (it lived only in ModsView; install waits on a decision event); never both views live.
- `writeModsInstallFixture` takes `{variant, stateOverrides}` (backward compatible); the flow runs on 190's catalog/package fixture throughout, so C/D prove AC4/AC6 with a loaded catalog.
- Beyond spec: a folder named `x.bsp` is not a map; `.pk3` ignored.

Names story 193 must reuse: `findCatalogEntryByGameDir` / `serverModStatus` / `mapLookupTarget` / `isSafeGameName` (`src/shared/mods/server-local-content.ts`), `isSafeGameDirName` (`src/shared/mods/gamedir.ts`), renderer `getMapPresence` (`modules/mods/client.ts`), `ServerLocalContentSection` testids `servers-detail-local-content`, `servers-detail-mod-status`, `servers-detail-map-status`, `servers-detail-mod-install`.

tiers: D 4 / hard 1 · review default · cycles 0 · agents 8

- Gate fix: regression from the sprint gate — `layering.test.ts` red because mods/index.ts imported the 7za path; now reuses downloads/stage-package `resolveVendoredExtractor`.
