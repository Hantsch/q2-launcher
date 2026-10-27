---
id: 263
title: I see where a server is and filter by region or country
status: done # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, I see the country and region of every server in the list, and I can filter the list by
whole regions (e.g. Europe) or by single countries in them, so I find servers close to me without
reading hostnames.

User request 2026-10-26: assign country and region to each server; show them in the server list as their
own column left of Mod; filter by region and country in one dropdown where a region can be chosen as a
whole or its countries one by one (e.g. "Europe", or the countries listed under Europe); multi-select
with a text filter.

Today the master servers and q2servers.com lists deliver only `ip:port`, and Q2 servers do not report a
location in `serverinfo` — the launcher knows nothing about where a server is.

## Acceptance Criteria

- [x] **AC1** — Every server row shows its location in a column left of Mod; the column header is
      sortable like the other columns.
- [x] **AC2** — The location is resolved from the server's IP through a GeoIP country database shipped
      with the launcher; a server added by hostname uses the IP it resolves to.
- [x] **AC3** — A server on a private/LAN address shows "LAN"; a public address the database does not know
      shows "Unknown" — never an empty cell.
- [x] **AC4** — The server detail pane shows the country and region in full.
- [x] **AC5** — The filter bar has a location filter: a multi-select listing regions, each with its
      countries indented below it; only regions and countries present in the current list are offered.
- [x] **AC6** — Checking a region selects the whole region; checking a single country selects only that
      country. A server is shown if its country is selected or lies in a selected region (OR within the
      filter, AND with the other filters as today). Nothing selected = "Any".
- [x] **AC7** — The open dropdown has a text field that narrows regions and countries as I type; a
      region stays visible while one of its countries matches.
- [x] **AC8** — The dropdown is keyboard-operable like the mod filter (open, move, toggle with Space,
      close with Escape, type to filter) and announces the selected count.
- [x] **AC9** — Saved quick filters store the location selection; quick filters saved before this story
      load with location "Any".
- [x] **AC10** — No server address leaves the machine for the lookup: no network request is made for
      geolocation, only country level is resolved, and the user's own IP is never looked up.
- [x] **AC11** — The GeoIP database's licence attribution is shown in Settings > About.
- [x] **AC12** — Works the same on Windows and Linux, in Online and LAN mode.

## Open Questions

## Decisions (Sprint)

- **(User)** Country and region are both shown per server, in their own column left of Mod.
- **(User)** One multi-select dropdown, regions with their countries below; a whole region or single
  countries can be chosen; it has a text filter.
- **(User)** Local GeoIP database only — no online geolocation service, country level, no lookup of the
  user's own IP (privacy discussed 2026-10-26: the database maps IP ranges to countries, not people).
- **Database** — DB-IP "IP to Country Lite" (`.mmdb`, CC-BY 4.0, no account or licence key, may be
  redistributed with attribution), bundled under `resources/` and refreshed per release; MaxMind
  GeoLite2 is out because its EULA restricts redistribution and needs a key. Proposal — the user can veto
  before `/sprint`.
- **Region** — the continent from the database (Africa, Asia, Europe, North America, Oceania, South
  America; Antarctica dropped). Region names are i18n keys; country names come from
  `Intl.DisplayNames` with the UI locale, so 250 country names are not hand-translated.
- **Column text** — region short code and country name, e.g. "EU · Germany", truncated with the full text
  as tooltip; no flags — Windows renders flag emoji as two letters and bitmaps are not allowed in the UI.
  Proposal — the user can veto before `/sprint`.
- **Region semantics** — a checked region stores the region, not a snapshot of its countries, so a server
  from a country that appears later still matches.
- **Lookup lives in main** — the `.mmdb` read is node-only; the scan attaches `country`/`continent` to
  each row, the renderer only displays and filters.
- **Database file is committed** — `resources/geoip/dbip-country-lite.mmdb` lives in git (refreshed by
  `scripts/update-geoip.mjs` when a release wants newer data), because unit tests, flows and dev runs
  need the same file offline, unlike the 7za binary which only packaging needs.
- **Reader** — `mmdb-lib` (MIT, pure JS, zero deps), the file read once lazily in main; pure JS behaves
  identically on Windows and Linux (AC12) and needs no native build.
- **Hostname servers** — the IP is the source address of the server's UDP reply, so no extra DNS request
  is made for the lookup; a hostname server that never answered shows "Unknown".
- **LAN** — loopback, RFC 1918, link-local (169.254/16) and CGNAT (100.64/10) IPv4 count as LAN and are
  never looked up, because those ranges have no country.
- **Antarctica** — a database answer with continent `AN` (or none) is "Unknown", following the dropped
  region above.
- **Location is computed, not stored** — attached to each row in `scan-service`'s `read()` as an optional
  `location` on `ServerListEntry`, so no persisted state changes and ~20 existing row fixtures stay valid;
  main always sets it, the renderer renders a missing one as "Unknown".
- **Filter tokens** — the selection is one `location: string[]` of tokens `region:EU`, `country:DE`,
  `lan`, `unknown`, mirroring story 248's mod/map sets and keeping the quick-filter schema flat.
- **LAN and Unknown are filter entries** — two top-level entries after the regions when rows carry them,
  because otherwise LAN mode offers an empty filter and those rows could never be isolated.
- **Countries under a checked region** — shown checked and disabled, toggling them does nothing; to pick
  single countries the user unchecks the region — keeps the region-not-snapshot rule without a tri-state.
- **Selected but absent** — a selected region/country no row carries any more stays listed and checked so
  it can be unchecked, the same rule as story 248's `MultiSelect`.
- **Text filter** — case-insensitive substring on the label; a region stays visible when its name or any
  of its countries matches, a matching region shows all its countries; the text resets on close.
- **Typing while the list has focus** — printable keys go into the text field and Backspace edits it, so
  Space keeps toggling like the mod filter (AC8); the field is also clickable, ArrowDown leaves it into
  the list.
- **One listbox in the app** — the location dropdown is the existing `MultiSelect` extended (option
  objects with level and implied-by-parent, `filterable`), not a second component, so keyboard and ARIA
  behaviour stay one implementation.
- **Sort** — the Location column sorts by region code, then English country name; LAN and Unknown count
  as unknown values and sort last like a missing mod.
- **Detail pane text** — "Germany, Europe"; LAN → "LAN", unknown → "Unknown".
- **Attribution** — a "Third-party data" section in Settings > About: "IP geolocation by DB-IP" linking
  db-ip.com plus a CC BY 4.0 licence link, which is what the licence requires.
- **e2e seam** — harness variable `Q2L_UI_GEO_ADDRESSES` (`127.0.0.1:<port>=<public IPv4>` pairs, harness
  gate required) substitutes the lookup IP for loopback stub servers, because flow servers can only
  listen on loopback; it changes the lookup input only, never the address queried.

## Plan

1. **D1** — the database ships: committed `.mmdb` + licence note, update script, packaging entry, and the
   shared resource-path helper extracted from its two existing copies.
2. **D2** — shared location model (`ServerLocation`, private-range classifier, country names) and the
   main lookup over the `.mmdb`, with a static no-network test.
3. **D3** — scan rows carry `location` (literal IP, reply source IP for hostnames, LAN rows) + the
   harness seam.
4. **D4** — shared filter/sort/quick-filter model gains `location` (tokens; OR inside, AND across; legacy
   quick filters load `[]`) and the region/country options builder.
5. **D5** — `MultiSelect` extended: grouped/indented options, implied-checked children, text filter.
6. **D6** — renderer: Location column + header sort and the detail-pane fact.
7. **D7** — renderer: location filter in the bar and the DB-IP attribution in Settings > About.
8. **D8** — real-surface flow `servers-location-filter`, systems doc, changelog.

Order: D1 → D2 → D3; D4 after D2; D5 independent; D6 after D3+D4; D7 after D4+D5; D8 last.

Affected: `package.json`, `electron-builder.yml`, `resources/geoip/*`, `scripts/update-geoip.mjs`,
`src/main/lib/{resource-path,ui-harness}.ts`, `src/main/lib/geoip/`, `src/main/lib/archive/7za-path.ts`,
`src/main/modules/downloads/bootstrap/r1q2-setup.ts`, `src/main/modules/servers/{server-query,scan-service,index}.ts`,
`src/shared/servers/{location,list-filter,list-sort,quick-filters}.ts`, `src/shared/modules/servers.ts`,
`src/renderer/src/components/ui/MultiSelect.tsx`, `src/renderer/src/components/about/AboutPanel.tsx`,
servers renderer module files + locale, `scripts/flows/servers-location-filter.mjs`,
`docs/systems/servers-module.md`, `CHANGELOG.md`.

## Deliverables

- [x] **D1 — the GeoIP database ships with the launcher.** Add `mmdb-lib` (MIT) to `package.json`
      `dependencies`. New `scripts/update-geoip.mjs`: downloads the DB-IP "IP to Country Lite" mmdb
      (`https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz`, current month, falling back
      to the previous month on 404), gunzips it to `resources/geoip/dbip-country-lite.mmdb` and writes
      `resources/geoip/source.json` (`{ "month": "YYYY-MM", "sha256": "…" }`). Run it once; the files are
      committed (not gitignored). Add `resources/geoip/LICENSE.txt`: "IP Geolocation by DB-IP
      (https://db-ip.com), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
      Unmodified." In `electron-builder.yml` add a top-level `extraResources` entry `resources/geoip` →
      `geoip` (platform-neutral, next to the `resources/licenses/r1q2` entry). The packaged-vs-dev
      resource path convention exists twice (`resolveExtractorPath` in
      `src/main/lib/archive/7za-path.ts`, `resolveR1q2LicensePath` in
      `src/main/modules/downloads/bootstrap/r1q2-setup.ts`): extract it to new
      `src/main/lib/resource-path.ts` — `resolveResourcePath({ isPackaged, resourcesPath, repoRoot }, ...segments)`
      → `join(resourcesPath, ...segments)` packaged, `join(repoRoot, 'resources', ...segments)` in dev,
      reusing the existing `findRepoRoot` — and make both callers use it with no behaviour change (their
      existing tests stay green; adjust only if a caller's dev layout differs, and then keep its path).
      Test `src/main/lib/resource-path.test.ts` › "packaged and dev resolve the same resource under
      resourcesPath and repo resources".

- [x] **D2 — location model and the local lookup.** New pure `src/shared/servers/location.ts`
      (+ `location.test.ts`), no `node:*` import: `CONTINENTS = ['AF','AS','EU','NA','OC','SA'] as const`,
      `type Continent`, `type ServerLocation = { kind: 'lan' } | { kind: 'unknown' } | { kind: 'country'; country: string; continent: Continent }`
      (`country` = ISO 3166-1 alpha-2 upper case; no city or coordinates field — country level only),
      `isPrivateIPv4(ip)` (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10; a non-IPv4 string
      is `false`), `countryName(code, locale)` via `Intl.DisplayNames([locale], { type: 'region' })`
      falling back to the code. New `src/main/lib/geoip/country-lookup.ts` (+ `country-lookup.test.ts`):
      `createCountryLookup(dbPath)` → `{ locate(ip: string): ServerLocation }`. `locate`: private → `lan`
      without touching the DB; otherwise reads the file once (`readFileSync` on first public lookup,
      `new Reader(buffer)` from `mmdb-lib`), caches per IP in a `Map`, maps `country.iso_code` +
      `continent.code`; continent `AN`/missing, no record, non-IPv4 input or a missing/unreadable DB file
      → `unknown` (logged once, never thrown). Imports only `node:fs` and `mmdb-lib`. Tests read the
      committed `resources/geoip/dbip-country-lite.mmdb` (resolved from the repo root): "8.8.8.8 resolves
      to a country in North America", "a private address is LAN without opening the database", "an
      address the database does not know is Unknown", "a missing database file makes every public
      address Unknown", and the static "imports no network module" (reads the source of
      `country-lookup.ts`, asserts no import of `node:net`/`node:http`/`node:https`/`node:dns`/`node:dgram`
      and no `fetch(`). `location.test.ts`: "isPrivateIPv4 covers loopback, RFC 1918, link-local and
      CGNAT", "countryName returns the English name and falls back to the code".

- [x] **D3 — every server row carries its location.** Files: `src/shared/modules/servers.ts`
      (`ServerListEntry` gains optional `location?: ServerLocation` imported from `../servers/location`;
      doc: computed in main at read time, never persisted); `src/main/modules/servers/server-query.ts`
      (`ServerUdpHandlers.onMessage(data, fromAddress: string)` — `dgramServerUdp` passes `rinfo.address`;
      the ok query result gains `fromAddress: string`; update the fake `udpImpl`s in
      `server-query.test.ts` and any other test fake grep finds); `src/main/modules/servers/scan-service.ts`
      (a per-mode `Map<address, ip>` filled from `result.fromAddress` where replies are merged; `read()`
      maps every row — answered, stale and placeholder — through one `withLocation`: lookup IP = the
      harness override for this address if any, else the host when it is an IPv4 literal, else the
      remembered reply IP, else `{ kind: 'unknown' }`; `ScanServiceDeps` gains
      `locate?: (ip: string) => ServerLocation` and `geoOverrides?: ReadonlyMap<string, string>`);
      `src/main/modules/servers/index.ts` (wires `createCountryLookup(...)` from
      `src/main/lib/geoip/country-lookup.ts` with `resolveResourcePath(..., 'geoip', 'dbip-country-lite.mmdb')`
      from `src/main/lib/resource-path.ts`, plus the override map); `src/main/lib/ui-harness.ts` (new
      `'Q2L_UI_GEO_ADDRESSES'` in `UiHarnessVar` and `uiHarnessGeoAddresses(harness): Map<string,string>`,
      mirroring `uiHarnessLanTargets`: comma list of `127.0.0.1:<port>=<IPv4>`, any other entry dropped,
      gate closed or unset → empty map). `locate` is only ever called with a server's IP, never the
      user's own. Tests: `scan-service.test.ts` › "every row read carries a location and a hostname
      server uses the IP its reply came from", › "a placeholder favourite on a public IPv4 is located
      before it answers", › "locate is only called with server addresses";
      `scan-service.lan-mode.test.ts` › "LAN-mode rows are located as LAN"; the test file that covers
      `uiHarnessLanTargets` › "geo address overrides accept only loopback keys and IPv4 values".

- [x] **D4 — the filter, sort and quick-filter model know the location.** Files:
      `src/shared/servers/location.ts` (token helpers), `src/shared/servers/list-filter.ts`
      (+ `list-filter.test.ts`), `src/shared/servers/list-sort.ts` (+ `list-sort.test.ts`),
      `src/shared/servers/quick-filters.ts` (+ `quick-filters.test.ts`), `src/shared/modules/servers.ts`
      (schema), `src/main/modules/servers/persisted.test.ts`. `ServerListFilter.location: string[]`
      (`EMPTY_SERVER_LIST_FILTER` → `[]`) holding tokens `region:<Continent>`, `country:<ISO2>`, `lan`,
      `unknown` (helpers `locationTokenOf`/`parseLocationToken` in `location.ts`).
      `isFilterActive`/`hasCriteria`: active when non-empty. `matchesFilter`: non-empty → the row passes
      if any token matches — `region:X` matches a `country` location whose continent is X, `country:C`
      that country, `lan`/`unknown` those kinds; a missing `location` counts as `unknown`; AND with all
      other fields unchanged. New `locationOptions(rows, selected)` in `list-filter.ts`: present regions in
      `CONTINENTS` order, each followed by its present countries sorted by `countryName(code, 'en')`, then
      `lan`, then `unknown` when present; a selected token that is not present is kept (a country under
      its region when listed, otherwise at the end). Sort: add `'location'` to `SERVER_SORT_COLUMNS`
      directly before `'mod'` (the persisted `listSort` enum derives from it), natural `asc`, `isUnknown`
      for missing/`lan`/`unknown`, known compare = continent code, then `countryName(code, 'en')`. Quick
      filters: `criteriaOf`/`applyCriteria` copy the array, `sameCriteria` compares it as a set; in
      `quickFilterCriteriaSchema` add `location: z.array(z.string()).default([])` (`.strict()` stays) so
      rows saved before this story load with `[]`. Leave every other field untouched. Tests: "a server
      passes when its country or its region is selected", "region and country tokens OR together and AND
      with mod", "an empty location set does not restrict the list", "a server without location matches
      only unknown", "locationOptions lists present regions with their countries and keeps a selected
      absent country", "location sorts by region then country with LAN and Unknown last", "sameCriteria
      compares location as a set", persisted › "a quick filter saved before story 263 loads with
      location Any".

- [x] **D5 — `MultiSelect` supports grouped options and a text filter.** File
      `src/renderer/src/components/ui/MultiSelect.tsx` (+ `MultiSelect.test.tsx`). With plain `string[]`
      options the behaviour stays exactly as today (mod/map filters; the existing tests pass unchanged).
      Additions: `options: readonly (string | MultiSelectOption)[]`, `MultiSelectOption = { value: string; label: string; level?: 0 | 1; impliedBy?: string }`;
      a string option is `{ value: s, label: s, level: 0 }`; `value` matching stays case-insensitive;
      rows and the closed summary show labels. `level: 1` rows are indented (`pl-8`). A row whose
      `impliedBy` value is checked renders checked with `aria-disabled="true"`, a visible check and muted
      text; click/Space/Enter on it does nothing. New optional `filterable?: boolean` and
      `filterLabel?: string`: the open panel shows a text `input` above the listbox
      (`aria-label={filterLabel}`, `data-testid` `${testid}-filter`, ≥ 28px high, semantic tokens,
      focus-visible ring) that narrows rows by case-insensitive substring of the label; a level-0 row
      stays visible while its own label or any following level-1 row (up to the next level-0 row)
      matches, and a matching level-0 row keeps all its level-1 rows; `active` indexes the visible rows
      and clamps. Focus on open stays on the listbox; while it has focus a printable key (length-1 key,
      no Ctrl/Alt/Meta, not Space) appends to the filter text and Backspace removes the last character;
      ArrowDown/Enter in the input moves focus to the listbox; Escape from either closes and refocuses
      the trigger; clicking the input must not close the panel (focusout stays inside the root); the
      text resets on close. The live region keeps announcing `common.label.selectedCount`. Tests: "a
      grouped option is indented and shows its label", "children of a checked parent show checked and
      cannot be toggled", "typing narrows options and keeps the parent of a matching child", "typing on
      the focused list feeds the filter and Space still toggles", "Escape from the filter field closes
      and refocuses the trigger".

- [x] **D6 — the list and the detail pane show the location.** Files under
      `src/renderer/src/modules/servers/`: new `location-label.ts` (+ `location-label.test.ts`) —
      `shortLocation(loc, t, locale)` → `"EU · Germany"` (continent code · `countryName` from
      `src/shared/servers/location.ts` with `i18n.language`), `t('servers.location.lan')` "LAN",
      `t('servers.location.unknown')` "Unknown"; `fullLocation` → `"Germany, Europe"` with region names
      from `servers.location.region.<code>` (Africa, Asia, Europe, North America, Oceania, South America);
      a missing location is Unknown. `list-grid.ts`: a `9rem` track after the copy column, before mod
      (update its doc comment). `ServerListHeader.tsx`: renders the new `location` entry of
      `SERVER_SORT_COLUMNS` (`servers.list.column.location` "Location", testid `servers-sort-location`).
      `ServerRow.tsx`: cell before Mod, `truncate`, `title` = `fullLocation`, testid
      `servers-row-location`. `ServerDetailHeader.tsx`: a `StatCell` "Location" after Protocol, testid
      `servers-detail-field-location`, value `fullLocation`. Keys in `locale/en.json`; refresh
      `src/renderer/src/i18n/__snapshots__/en.bundle.json`. Tests: `location-label.test.ts` › "short and
      full labels for country, LAN, Unknown and missing"; `ServerRow.test.tsx` › "the location cell sits
      left of Mod and is never empty"; `ServerDetailView.test.tsx` › "the detail pane shows country and
      region in full".

- [x] **D7 — the location filter and the About attribution.** Files:
      `src/renderer/src/modules/servers/ServerListFilterBar.tsx` (+ `ServerListFilterBar.test.tsx`): a
      `Field` "Location" with `<MultiSelect filterable>` from `src/renderer/src/components/ui/MultiSelect.tsx`
      (testid `servers-filter-location`, `filterLabel` `servers.filter.locationSearch` "Search regions and
      countries", `summaryCount` `servers.filter.locationsCount` with `_one`/`_other` "{{count}}
      location(s)"), options from `locationOptions(rows, filter.location)` in `src/shared/servers/list-filter.ts`
      mapped to `MultiSelectOption`s — region tokens level 0 labelled with `servers.location.region.<code>`,
      country tokens level 1 labelled with `countryName(code, i18n.language)` and `impliedBy` their region
      token, `lan`/`unknown` level 0 labelled `servers.location.lan`/`.unknown`; `onChange` writes
      `filter.location`; "Clear filters" and quick-filter chips work through the shared helpers.
      `src/renderer/src/components/about/AboutPanel.tsx` (+ its test file): a "Third-party data" section
      — "IP geolocation by DB-IP" linking `https://db-ip.com` and "CC BY 4.0" linking
      `https://creativecommons.org/licenses/by/4.0/` through the panel's existing open-external invoke,
      testid `about-geoip-attribution`. Keys in `src/renderer/src/modules/servers/locale/en.json` and
      `src/renderer/src/i18n/locales/en.shell.json` (`settings.about.*`); refresh the `en.bundle.json`
      snapshot. Tests: `ServerListFilterBar.test.tsx` › "the location filter lists regions with their
      countries indented"; AboutPanel test › "About shows the DB-IP attribution and licence link".

- [x] **D8 — real-surface proof and docs.** New `scripts/flows/servers-location-filter.mjs` (variant
      `servers-location-filter`): copy the responder setup of `scripts/flows/servers-multi-filter.mjs`
      (`makeResponderBinder` from `scripts/lib/servers-stub.mjs`) and use `setMultiFilter` /
      `readMultiFilter` from `scripts/lib/servers-flow.mjs` (extend `setMultiFilter` with an optional
      filter-text argument only if a step needs it). Four responders; launch env `Q2L_UI_GEO_ADDRESSES`
      maps three of them to public IPv4s the committed DB resolves to Germany, France and the US — check
      the IPs with `createCountryLookup` from `src/main/lib/geoip/country-lookup.ts` before writing the
      flow; the fourth stays loopback (LAN). Seed one legacy quick filter without `location`. Do not add
      it to `scripts/flows/areas.json` while both servers rows are at their 12-flow cap (story 248's
      note). Then `docs/systems/servers-module.md` (rows carry a computed location from the bundled
      DB-IP database; the location filter tokens; `Q2L_UI_GEO_ADDRESSES`) and `CHANGELOG.md` under
      `## Unreleased` › `### Added`, one line, e.g. "**Servers** — See each server's country and region
      and filter by them." Step names as in Acceptance Tests.

## Model Hints

- D5 → deliverable-hard — it changes the keyboard and focus model of the shipped `MultiSelect` behind
  the mod/map filters (printable keys feed a filter, implied-disabled rows, an `active` index over a
  visible subset, an input inside the focusout boundary), so a subtle regression in the existing listbox
  is the likely failure.

Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/servers/ServerRow.test.tsx` › "the location cell sits left of Mod and is never empty"; unit `src/shared/servers/list-sort.test.ts` › "location sorts by region then country with LAN and Unknown last"; e2e `scripts/flows/servers-location-filter.mjs` › "AC1: the Location column shows EU · Germany left of Mod and sorts by its header"
- AC2 → unit `src/main/lib/geoip/country-lookup.test.ts` › "resolves 8.8.8.8 to a country in North America"; unit `src/main/modules/servers/scan-service.test.ts` › "every row read carries a location and a hostname server uses the IP its reply came from"; unit `src/main/lib/resource-path.test.ts` › "packaged and dev resolve the same resource under resourcesPath and repo resources"
- AC3 → unit `src/main/lib/geoip/country-lookup.test.ts` › "treats a private address as LAN without opening the database" and › "an address the database does not know is Unknown"; unit `src/renderer/src/modules/servers/location-label.test.ts` › "short and full labels for country, LAN, Unknown and missing"; e2e `scripts/flows/servers-location-filter.mjs` › "AC3: the loopback server shows LAN"
- AC4 → unit `src/renderer/src/modules/servers/ServerDetailHeader.test.tsx` › "the detail pane shows country and region in full"; e2e `scripts/flows/servers-location-filter.mjs` › "AC4: the detail pane shows Germany, Europe"
- AC5 → unit `src/shared/servers/list-filter.test.ts` › "locationOptions lists present regions with their countries and keeps a selected absent country"; unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "a grouped option is indented and shows its label"; e2e `scripts/flows/servers-location-filter.mjs` › "AC5: the location filter offers Europe with France and Germany, North America with the US, and LAN"
- AC6 → unit `src/shared/servers/list-filter.test.ts` › "a server passes when its country or its region is selected", › "region and country tokens OR together and AND with mod", › "an empty location set does not restrict the list"; unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "children of a checked parent show checked and cannot be toggled"; e2e `scripts/flows/servers-location-filter.mjs` › "AC6: Europe shows both European servers, Germany alone shows one, clearing shows all"
- AC7 → unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "typing narrows options and keeps the parent of a matching child"; e2e `scripts/flows/servers-location-filter.mjs` › "AC7: typing ger leaves Europe and Germany in the open dropdown"
- AC8 → unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "typing on the focused list feeds the filter and Space still toggles" and › "Escape from the filter field closes and refocuses the trigger" (the existing keyboard and live-region tests stay); e2e `scripts/flows/servers-location-filter.mjs` › "AC8: the location filter is operated by keyboard alone and announces the count"
- AC9 → unit `src/shared/servers/quick-filters.test.ts` › "sameCriteria compares location as a set"; unit `src/main/modules/servers/persisted.test.ts` › "a quick filter saved before story 263 loads with location Any"; e2e `scripts/flows/servers-location-filter.mjs` › "AC9: a quick filter saves the location selection and the legacy chip applies with location Any"
- AC10 → unit `src/main/lib/geoip/country-lookup.test.ts` › "imports no network module"; unit `src/main/modules/servers/scan-service.test.ts` › "locate is only called with server addresses"; country level only is structural in D2's `ServerLocation` (no city/coordinates field)
- AC11 → unit `src/renderer/src/components/about/AboutPanel.test.tsx` › "About shows the DB-IP attribution and licence link"; e2e `scripts/flows/servers-location-filter.mjs` › "AC11: Settings > About names DB-IP and CC BY 4.0"
- AC12 → unit `src/main/modules/servers/scan-service.lan-mode.test.ts` › "LAN-mode rows are located as LAN"; the unit suite (pure-JS reader, committed DB) runs on `ubuntu-latest` and `windows-latest` in `.github/workflows/ci.yml`; e2e `scripts/flows/servers-location-filter.mjs` covers Online mode on the build machine

## Done

**Summary.** Every server row now carries a computed, country-level location from the bundled DB-IP "IP to Country Lite" database (real file, 2026-10, `resources/geoip/`, read by `mmdb-lib` in main, no network). The list has a sortable Location column left of Mod, the detail pane shows "Germany, Europe", and a grouped, filterable `MultiSelect` filters by region/country/LAN/Unknown; quick filters store `location` (legacy rows load `[]`); Settings > About credits DB-IP.

**Commit message:** `263: servers show country/region from bundled DB-IP GeoIP db — Location column, grouped region/country filter, quick-filter location, About attribution, flow servers-location-filter`

**Verification (narrow gate).** `npm run build`, `typecheck`, `lint` green. `npx vitest run --changed HEAD` and `e2e-story` (`ui:flows -- --affected scripts/flows/servers-location-filter.mjs --parallel=4 --shard=1/2` and `2/2`, 41+40 flows) green; after the review fix, typecheck/lint/`--changed HEAD` and `ui:flows -- servers-location-filter servers-multi-filter servers-quick-filters` green. Full regression gate not run (sprint's). Review: one default-tier stage, PASS, 1 fix cycle.
AC to test (all passed): AC1 ServerRow/list-sort tests + flow AC1; AC2 country-lookup, scan-service, resource-path tests; AC3 country-lookup (private, unknown, Antarctica), location-label tests + flow AC3; AC4 ServerDetailHeader test + flow AC4; AC5 list-filter, MultiSelect + flow AC5; AC6 list-filter x3, MultiSelect + flow AC6; AC7 MultiSelect + flow AC7; AC8 MultiSelect x2 + flow AC8; AC9 quick-filters, persisted + flow AC9; AC10 country-lookup static no-network test, scan-service "locate is only called with server addresses"; AC11 AboutPanel test + flow AC11; AC12 scan-service.lan-mode test. No manual residue.
Still red in the tree, not from this story: architecture purity/tsconfig (dm2-stats), comments.test (258/252), systems-docs, flow-select (game-dir-fs, original-backup, ping-samples, map-list, 12-flow cap on shell-window/config-profiles), repo-hygiene CRLF, check-docs/tech-debt links, renderer-health (ServersView 350 lines, cancellation flags), flow-helper-duplication `fail`; scan-ping-accuracy "within 5 ms under load" is a timing flake (passes alone).

**Decisions.**
- `geoOverrides` dep is a getter (flows set `Q2L_UI_GEO_ADDRESSES` after boot); `fromAddress` is optional on the shared `ScanQueryResult` (LAN discovery/fixtures omit it); no `locate` dep means rows stay unchanged.
- "Unknown" and "Location" reuse `common.label.unknown` / `common.label.location` (keys.test.ts forbids duplicate values); the downloads wizard's `locationLabel` key was folded into the common one; `servers.location.region.*` is a registered dynamic key prefix.
- Detail-pane test lives in `ServerDetailHeader.test.tsx` (ServerDetailView.test.tsx stubs the header with a throwing component); mapping updated.
- `findRepoRoot` moved to `src/main/lib/resource-path.ts` (7za-path would otherwise import it circularly); `extractor.test.ts` import follows.
- Location filter bar takes an optional `rows` prop; a selected absent country is listed at level 0 without `impliedBy`. Sort: continent code, then English country name.
- `scripts/flows/areas.json`: the new flow went into the `servers-lists` row (7 flows, cap untouched) with `location-label.ts` and `src/main/lib/geoip/**`; `src/main/lib/resource-path.ts` into the `archives` row, so flow-select's "reached by a testid or an area row" holds for this story's files.
- Left unfixed (low): `chipNamed`/`clearFilters` copies remain in older flows (servers-multi-filter, servers-ping-filter); a stored `country:XX` under a checked region still counts in the summary; `update-geoip.mjs` does not parse-check the download or time out `fetch`; persisted test title quotes the story's own wording.

tiers: D 8 / hard 1 · review default · cycles 1 · agents 12
