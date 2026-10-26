---
id: 263
title: I see where a server is and filter by region or country
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — Every server row shows its location in a column left of Mod; the column header is
      sortable like the other columns.
- [ ] **AC2** — The location is resolved from the server's IP through a GeoIP country database shipped
      with the launcher; a server added by hostname uses the IP it resolves to.
- [ ] **AC3** — A server on a private/LAN address shows "LAN"; a public address the database does not know
      shows "Unknown" — never an empty cell.
- [ ] **AC4** — The server detail pane shows the country and region in full.
- [ ] **AC5** — The filter bar has a location filter: a multi-select listing regions, each with its
      countries indented below it; only regions and countries present in the current list are offered.
- [ ] **AC6** — Checking a region selects the whole region; checking a single country selects only that
      country. A server is shown if its country is selected or lies in a selected region (OR within the
      filter, AND with the other filters as today). Nothing selected = "Any".
- [ ] **AC7** — The open dropdown has a text field that narrows regions and countries as I type; a
      region stays visible while one of its countries matches.
- [ ] **AC8** — The dropdown is keyboard-operable like the mod filter (open, move, toggle with Space,
      close with Escape, type to filter) and announces the selected count.
- [ ] **AC9** — Saved quick filters store the location selection; quick filters saved before this story
      load with location "Any".
- [ ] **AC10** — No server address leaves the machine for the lookup: no network request is made for
      geolocation, only country level is resolved, and the user's own IP is never looked up.
- [ ] **AC11** — The GeoIP database's licence attribution is shown in Settings > About.
- [ ] **AC12** — Works the same on Windows and Linux, in Online and LAN mode.

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

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
