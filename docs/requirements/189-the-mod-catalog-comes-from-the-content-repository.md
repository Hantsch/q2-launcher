---
id: 189
title: the mod catalog comes from the content repository
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I see the mods the launcher can install (Action Quake, OpenTDM, CTF) as tiles next
to the ones I already have. Each tile has a short description, and its detail panel shows the
licence and where the mod comes from. The catalog lives in `Hantsch/q2_community_content` as
`mods/manifest.json`, curated like the engines and game data. A dead link costs a commit there,
not a launcher release.

The manifest is shaped for mirroring later but does not mirror now. Every package's `url` is the
original source (GitHub releases, or the id 3.20 point release already in
`gamedata/manifest.json` for CTF), and `mirrors[]` exists and is read but stays empty for mods.
Each entry carries its gamedir, version, licence (SPDX), project page, source link and its
variants per *(platform, engine architecture)*.

Concept: [mods.md](../concepts/mods.md) §6–§8; requirements MOD-3, MOD-4.

## Acceptance Criteria

- [ ] **AC1** — `content/q2_community_content/mods/manifest.json` exists with entries for `action`,
      `opentdm` and `ctf`. Every package has a real size and SHA256 that match the file at its
      `url`.
- [ ] **AC2** — Every catalog entry appears as a tile in the Mods view, with its display name and
      short description.
- [ ] **AC3** — A catalog entry whose gamedir already exists in the installation shows on one tile,
      not as a catalog tile plus a manual tile.
- [ ] **AC4** — The detail panel of a catalog entry shows its licence and links to its project
      page and its source.
- [ ] **AC5** — A manifest row that fails validation is dropped with a logged warning, and the
      other entries still appear. A manifest whose envelope fails validation shows no catalog
      tiles and a visible "catalog unavailable" note, and the local mods still show.
- [ ] **AC6** — Offline, the last good catalog copy is shown with an "as of <date>" note.
- [ ] **AC7** — Nothing from the manifest reaches the renderer unvalidated, and a gamedir name that
      is not a safe single path token (the `launch-plan.ts` rule) is refused at parse time.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — (concept §14 item 2) — Does the manifest pin the latest *stable* release only (AQtion
  v1.3.8, not the v1.4.0-rc1 pre-release)? Which AQ2-TNG build goes with that AQtion content?
- ~~**Q2**~~ answered → Decisions (Sprint) — (concept §14 item 8) — Are the catalog name and description English text in the manifest
  (foreign content, like news entries), or per-locale fields?
- ~~**Q3**~~ answered → Decisions (Sprint) — Is CTF's variant a reference to the existing
  `q2-320-x86-full-ctf` gamedata package, reusing its cached archive and taking only its `ctf/`
  payload, or does it get its own package row with the same URL and hash?

## Decisions (Sprint)

- **(User)** Stable only?: the user can select the version in the UI (stable AQtion v1.3.8 is the default/pinned latest; other listed versions, e.g. the v1.4.0-rc1 pre-release, are selectable and marked as such); refine picks the matching AQ2-TNG build per version
- **(User)** Catalog text language: English text in the manifest (foreign content, like news)
- **Q3 — CTF gets its own package row** with the same URL, size and SHA256 as `q2-320-x86-full-ctf`
  (`mirrors: []`): the mods manifest stays self-contained (no cross-manifest resolution, one
  validation rule for every package), and the archive cache can still reuse the file by hash.
- **AQ2-TNG pairing:** both AQtion versions (v1.3.8 pinned, v1.4.0-rc1 pre-release) pair with TNG
  release `282af79` (2024-04-09) — it is the only current published TNG release (`releases/latest`,
  checked 2026-10-01), which AQtion's own release workflow pulled as `releases/latest/download`.
- **Manifest shape:** `{ schemaVersion: 1, entries: [...] }`; an entry carries `id`, `gamedir`,
  `name`, `description`, `license` (SPDX), `projectUrl`, `sourceUrl`, `pinned` (a version string)
  and `versions[]`; a version carries `version`, `prerelease`, `variants[]` (`platform` in
  `process.platform` spelling, `arch` `x86`/`x64`/`arm64`, `packages[]`) and `contentOnly.packages[]`
  (the fallback for every pair without a variant; may be empty — OpenTDM on Windows x64 then creates
  only the gamedir, concept §6). Reason: the user-selectable versions need a version level, and an
  explicit content-only fallback makes MOD-7 a manifest fact instead of a launcher guess.
- **Package shape** reuses the existing `id`/`url`/`mirrors[]`/`sizeBytes`/`sha256`/`contents[]`
  fields (concept §8); `contents[].to` is the literal `'gamedir'` and `contents[].from` must be a
  safe relative archive path (no `..`, no leading `/` or drive): story 190 extracts from it.
- **Row = catalog entry:** any invalid part of an entry (a bad version, variant, package, a `pinned`
  naming no listed version, a duplicate `id` or case-insensitive duplicate `gamedir`) drops the whole
  entry with one `log.warn`; a half-valid mod is not installable and must not appear.
- **Gamedir rule:** `^[A-Za-z0-9_.-]{1,64}$` (the rule ARCHITECTURE.md, `ipc-schemas.ts` and
  `config/writer.ts` already use, and which passes `launch-plan.ts`'s `isSafeEarlyToken` by
  construction), plus `.`, `..` and `baseq2` refused (case-insensitive) — the regex alone lets `..`
  through. It lives as one pure helper in `src/shared/mods/gamedir.ts`, since servers (192) and
  replays (193) must apply the same rule.
- **Refused envelope behaves like a failed fetch:** serve the last good cached catalog with "as of",
  and only with no cache show "catalog unavailable" (AC5's case). Reason: concept §12 says transport,
  cache and offline behaviour are the install module's, and `ManifestService` treats a refusal
  exactly so; AC5 is tested in the no-cache state.
- **Separate cache file** `userData/cache/mods/catalog-cache.json`, same freshness (15 min) and
  cache semantics as `ManifestService`, re-parsed through the same parser on load. Reason: the mods
  catalog must not make the downloads manifest snapshot fail, nor vice versa.
- **Source resolution** reuses `resolveDownloadSource()` (`downloads/harness.ts`): one gate, one
  loopback override, https-only in production; `projectUrl`/`sourceUrl` are https-only too, since the
  renderer opens them through `app:openExternal`.
- **What crosses IPC** is a projection: id, gamedir, name, description, license, projectUrl,
  sourceUrl, pinned and `versions[{ version, prerelease }]`, plus `fetchedAt`/`fromCache`/`ageMs`, or
  an unavailable state. Variants and packages stay in main (190 resolves them there).
- **Versions in the UI (this story):** the detail panel lists the entry's versions, the pinned one
  marked *default*, pre-releases marked *pre-release*. The control that picks the version to install
  belongs to the Install action (story 190), which has no button to attach it to here.
- **Merge rule (AC3):** a catalog entry and a local gamedir are the same tile when the names match
  case-insensitively (concept §11). Until 190 writes install records, such a tile carries the catalog
  name and the *installed manually* label from 188.
- **Text limits:** `name` ≤ 64, `description` ≤ 280 characters, rendered as plain text (no markup).
  Reason: the tile holds a short description; foreign content never becomes HTML.
- **Content mapping:** everything the game needs for `+set game <gamedir>` lands in `<gamedir>/`
  (for AQtion that includes the `baseaq/` paks). D1 authors the mappings from real archive listings.

## Plan

Builds on story 188 (the `mods` module, its view, tiles and detail panel). Order D1 → D5.

1. **Manifest (D1):** write `content/q2_community_content/mods/manifest.json` from the real
   releases (AQtion v1.3.8 + v1.4.0-rc1 with TNG `282af79`; OpenTDM r388; CTF from the 3.20 exe),
   `mirrors: []` everywhere; extend `scripts/manifest-hashes.mjs` to walk this shape and pass
   `--check`.
2. **Trust boundary (D2):** zod schemas + defensive parser in `src/main/modules/mods/`, the gamedir
   helper in `src/shared/mods/gamedir.ts`, the wire types in `src/shared/modules/mods.ts`, and a
   shipped-manifest test that parses D1's file with zero drops.
3. **Catalog service + handler (D3):** fetch via `fetchContentJson('mods/manifest.json')`, cache,
   offline fallback, `catalog.get` module handler returning the projection.
4. **Tiles (D4):** catalog tiles merged with 188's local tiles, description, "catalog unavailable"
   and "as of <date>" notes; fixture server + flow `mods-catalog`.
5. **Detail (D5):** licence, project/source links (via `app:openExternal`), versions list; flow
   `mods-catalog-detail`.

Affected layers: content + scripts (D1), main + shared (D2, D3), renderer + flows (D4, D5).

## Deliverables

- **D1 — the real mods manifest.** Files: `content/q2_community_content/mods/manifest.json` (new),
  `scripts/manifest-hashes.mjs` (mirror its existing loop). Shape (`schemaVersion: 1`,
  `entries[]`): entry `{ id, gamedir, name, description (≤280, English), license (SPDX), projectUrl,
  sourceUrl (https), pinned, versions[] }`; version `{ version, prerelease, variants[{ platform
  ('win32'|'linux'), arch ('x86'|'x64'|'arm64'), packages[] }], contentOnly: { packages[] } }`;
  package `{ id, version, url, mirrors: [], sizeBytes, sha256 (lowercase hex), contents[{ from, to:
  'gamedir' }] }`. Entries: `action` (AQtion; pinned `v1.3.8`, plus `v1.4.0-rc1` with
  `prerelease: true`; content = `aqtion-<v>-content-only.zip` from
  github.com/actionquake/distrib releases; game library = TNG release `282af79` from
  github.com/actionquake/aq2-tng: `tng-win-32.zip` → win32/x86, `tng-win-64.zip` → win32/x64,
  `tng-lin-x86_64.zip` → linux/x64, `tng-lin-arm64.zip` → linux/arm64; GPL-2.0), `opentdm`
  (r388 from github.com/packetflinger/opentdm: `opentdm-r388-win32.zip` → win32/x86,
  `opentdm-r388-linux-x86_64.tar.gz` → linux/x64, `contentOnly.packages: []`; GPL-2.0), `ctf`
  (3.20 `https://deponie.yamagi.org/quake2/idstuff/q2-3.20-x86-full-ctf.exe`, own package row,
  size 19267584 / sha256 `f82197c8…488baa` as in `gamedata/manifest.json`; win32/x86 variant maps
  the whole `ctf/` payload, `contentOnly` maps it without the game library; GPL-2.0; projectUrl
  github.com/yquake2/ctf). Author every `contents` mapping from the real archive listing (`7za l`):
  everything `+set game <gamedir>` needs lands in `<gamedir>/` — AQtion's `baseaq/` paks included,
  no installer cruft, no client executables. Extend `manifest-hashes.mjs` to read this file's
  `entries[].versions[].{variants[].packages, contentOnly.packages}` (deduplicate by url) and run
  `node scripts/manifest-hashes.mjs --check` until it exits 0. Acceptance: `--check` green; the
  file parses as JSON.
- **D2 — schema, parser and gamedir rule.** Files: `src/shared/mods/gamedir.ts` +
  `gamedir.test.ts` (new: `isSafeGameDirName(name)` = `^[A-Za-z0-9_.-]{1,64}$` and not `.`, `..`,
  `baseq2`, case-insensitive), `src/shared/modules/mods.ts` (add the wire types `ModCatalogEntry
  { id, gamedir, name, description, license, projectUrl, sourceUrl, pinned, versions: { version,
  prerelease }[] }` and `ModCatalogState = { status: 'ok'; entries; fetchedAt; fromCache; ageMs } |
  { status: 'unavailable' }`), `src/main/modules/mods/catalog-schema.ts` +
  `catalog-parse.ts` + `catalog-parse.test.ts` (new; mirror `downloads/schemas.ts` and
  `downloads/manifest-parse.ts`, reuse their exported `sha256Schema`, `httpsUrlSchema`,
  `harnessLoopbackUrlSchema`), `src/main/modules/mods/shipped-manifest.test.ts` (mirror
  `downloads/shipped-manifest.test.ts`). Rules: envelope `{ schemaVersion: 1, entries: unknown[] }`
  else refused (`malformed-envelope` / `unsupported-schema-version`); each entry parsed alone, any
  invalid nested part, a `pinned` naming no listed version, a duplicate `id` or case-insensitive
  duplicate `gamedir` drops the whole entry with one `log.warn` naming the entry index/id and
  reason; `contents[].from` refused if it contains a `..` segment, a backslash-escaped traversal,
  or is absolute; unknown fields are stripped (zod default `.strip()`, asserted). Exports
  `parseModCatalog(raw, log, { httpsOnly })` and `toCatalogEntryDto(entry)` (the projection).
  Acceptance: the tests below green; shipped manifest parses with all three entries and zero drops.
- **D3 — catalog service and `catalog.get`.** Files: `src/main/modules/mods/catalog-service.ts` +
  `catalog-service.test.ts` (new; mirror `downloads/manifest-service.ts` and its test: in-memory
  15-minute freshness, cache at `userData/cache/mods/catalog-cache.json` via `JsonStore`, cache
  re-parsed through `parseModCatalog` on load, refused envelope = failed fetch, no cache + failure
  → `{ status: 'unavailable' }`, never an empty `ok`), `src/main/modules/mods/index.ts` (register
  handler `catalog.get` with a `z.object({ refresh: z.boolean().optional() }).strict()` payload
  schema, returning only `toCatalogEntryDto` projections; source via `resolveDownloadSource()` from
  `downloads/harness.ts`, resolved once at registration), `src/shared/modules/mods.ts` (handler
  name). Acceptance: service and handler tests green; `npm run typecheck` green.
- **D4 — catalog tiles in the Mods view.** Files: 188's Mods view and tile component under
  `src/renderer/src/modules/mods/` (extend, don't fork), its typed client (add `getCatalog`), a pure
  `mergeModTiles(catalogEntries, gameDirs)` + test in `src/renderer/src/modules/mods/` (one tile per
  case-insensitive gamedir; catalog tile carries name + description; matched local dir keeps 188's
  *installed manually* label; local-only dirs unchanged), `src/renderer/src/i18n/locales/en/*`
  (keys `mods.catalog.unavailable`, `mods.catalog.asOf` with a `{{date}}` formatted in the UI
  locale), `CHANGELOG.md` (one line under Unreleased: "Mods: Action Quake, OpenTDM and CTF appear as
  catalog tiles."), `scripts/lib/fixture.mjs` (add `startModsCatalogFixtureServer({ mode })` serving
  `/mods/manifest.json` from a small inline fixture with modes `ok`, `bad-row` (one invalid entry +
  two good), `bad-envelope`, `down` (500); mirror `startNoEngineForPlatformFixtureServer`),
  `scripts/flows/mods-catalog.mjs` (new; mirror `scripts/flows/news-feed.mjs`'s setup/teardown and
  `Q2L_UI_CONTENT_REPO_BASE`; for AC6 seed `cache/mods/catalog-cache.json` in the fixture userData
  before launch with `mode: 'down'`; one app launch per mode — the base URL is fixed per session and
the 15-minute freshness window would mask a mid-session switch). Description and name render as plain text. The notes are
  visible text, not tooltips. Acceptance: merge test and flow green.
- **D5 — catalog detail panel.** Files: 188's detail panel component under
  `src/renderer/src/modules/mods/`, `src/renderer/src/i18n/locales/en/*` (keys
  `mods.detail.license`, `mods.detail.projectPage`, `mods.detail.source`, `mods.detail.versions`,
  `mods.detail.defaultVersion`, `mods.detail.prerelease`), `scripts/flows/mods-catalog-detail.mjs`
  (new; reuses D4's `startModsCatalogFixtureServer({ mode: 'ok' })`). For a catalog entry the panel
  shows the SPDX licence as text, *Project page* and *Source* links that open via the existing
  `app:openExternal` channel, and the versions list (pinned marked *default*, pre-releases marked
  *pre-release*). Acceptance: flow green.

## Model Hints

- D1 → deliverable-hard — the `contents` mappings are authored from real archive listings
  (AQtion's `baseaq/` + `action/` split, the `ctf/` payload inside the 3.20 self-extractor, the
  TNG/OpenTDM library paths), and no test before story 190's install can catch a wrong mapping.
- Review: → default

## Acceptance Tests

- AC1 → script `scripts/manifest-hashes.mjs --check` (network, run by D1's build; not in `npm test`)
  plus unit `src/main/modules/mods/shipped-manifest.test.ts` › "parses mods/manifest.json with
  action, opentdm and ctf and drops nothing"
- AC2 → e2e `scripts/flows/mods-catalog.mjs` › flow `mods-catalog` (step "every catalog entry is a
  tile with its name and description")
- AC3 → e2e `scripts/flows/mods-catalog.mjs` › flow `mods-catalog` (step "a catalog gamedir already
  on disk is one tile") plus unit `src/renderer/src/modules/mods/merge-mod-tiles.test.ts` › "a
  catalog entry and a local gamedir with the same name, any case, are one tile"
- AC4 → e2e `scripts/flows/mods-catalog-detail.mjs` › flow `mods-catalog-detail`
- AC5 → unit `src/main/modules/mods/catalog-parse.test.ts` › "an invalid entry is dropped with a
  warning and the others survive" and › "a malformed envelope is refused"; unit
  `src/main/modules/mods/catalog-service.test.ts` › "a refused envelope with no cache is
  unavailable"; e2e `scripts/flows/mods-catalog.mjs` › flow `mods-catalog` (steps "bad row: the
  other entries still show" and "bad envelope: catalog unavailable note, local mods still show")
- AC6 → unit `src/main/modules/mods/catalog-service.test.ts` › "a failed fetch serves the last good
  cache with its age"; e2e `scripts/flows/mods-catalog.mjs` › flow `mods-catalog` (step "offline:
  cached catalog with an as-of note")
- AC7 → unit `src/shared/mods/gamedir.test.ts` › "refuses traversal, separators, dot names, baseq2
  and non-ASCII"; unit `src/main/modules/mods/catalog-parse.test.ts` › "an entry with an unsafe
  gamedir is refused at parse time", › "an unsafe contents path is refused" and › "unknown fields
  never reach the projection"

## Done
