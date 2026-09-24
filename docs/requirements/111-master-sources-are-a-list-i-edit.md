---
id: 111
title: master sources are a list i edit
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the `servers` module's ([[106]]) settings section and finds the list of master
sources a scan will query — not fixed to one website, but a list they can add to, remove from,
reorder, and switch on or off entry by entry (GB-S1). The launcher ships with a sensible default
list so a fresh install already works, but nothing about the source list is hard-coded once the
user wants to change it — "falls ein master stirbt", per the concept's own rationale (§3).

Each source has a type — a UDP master (`udp-master`) or an HTTP list (`http-list`) — and an
address; [[109]]'s codecs are what actually speaks either protocol during a scan, this story only
stores and validates the configuration they will later be pointed at (GB-S2). The list persists in
the module-owned state key [[110]] built.

Shipped defaults, per the concept (§6.5/§7.1): the UDP masters `master.q2servers.com` and
`master.quakeservers.net`, and the HTTP list `q2servers.com` with `?raw=1`.

Renderer-supplied source entries are never trusted as-is (CLAUDE.md's standing rule): every add or
edit is validated against a zod schema before it reaches main, the same discipline every other
renderer-facing IPC payload in this repo already carries.

## Acceptance Criteria

- [ ] **AC1** — A fresh install's source list contains exactly the three shipped defaults —
      `master.q2servers.com` and `master.quakeservers.net` as `udp-master`, `q2servers.com?raw=1`
      as `http-list` — each correctly typed.
- [ ] **AC2** — The settings section lets a user add a new source (type + address), remove an
      existing one, reorder the list, and toggle a source enabled/disabled, each action persisting
      immediately through [[110]]'s state key.
- [ ] **AC3** — Each source's type (`udp-master` / `http-list`) and address round-trip through a
      restart unchanged — persistence does not collapse or default either field.
- [ ] **AC4** — Every source entry submitted from the renderer (add or edit) is validated by a zod
      payload schema in main before it is written to state; a malformed entry (unknown type,
      empty/invalid address) is refused with a reason, never silently dropped or silently accepted.
- [ ] **AC5** — Disabling a source keeps it in the list (address and type intact) rather than
      removing it — re-enabling it requires no re-entry.

## Open Questions

- [x] **Q1 (resolved by deferral, see `## Decisions (Sprint)`) — Master rate-limit etiquette (concept open point #15).** The concept raises whether the
      launcher should also bound how often it re-fetches a given master source, distinct from how
      often it queries individual game servers. This story's scope is the source list's CRUD and
      shape, not scan timing — bounding re-fetch cadence belongs with the scan engine and its
      settings (sprint 9.3, [[114]]/[[115]]), where the other scan-budget settings (concurrency,
      timeout, minimum spacing between automatic scans) are already being defined. Deferred there,
      not decided here.

## Decisions (Sprint)

- **Q1 stays deferred.** Master rate-limit etiquette is not implemented here — the story text itself
  defers it to the scan engine and its settings ([[114]]/[[115]], sprint 9.3), where the other
  scan-budget settings live; nothing in a CRUD list of sources decides re-fetch cadence.
- **Entry shape is `{ id, type, address, enabled }`.** The concept (§7.1) names exactly type,
  address and enabled; an opaque `id` is added because remove/toggle/reorder need a stable handle
  that survives an address edit.
- **Ids are minted in main, never taken from the renderer.** A renderer-supplied id is only ever
  *looked up* against the stored list; an unknown id is a refusal — CLAUDE.md's "renderer input is
  never trusted" applied to identifiers, not just paths.
- **The three shipped defaults carry fixed, documented ids** (e.g. `default-q2servers-udp`), so the
  seeded list is deterministic and a test can assert it without depending on a random uuid.
- **Defaults are the `sources` field's zod default, not a re-seed on read.** Absent key / absent
  field → the three defaults; an explicitly stored `[]` stays empty. Re-seeding on empty would make
  "remove the last source" impossible, which AC2 promises is possible.
- **`udp-master` addresses are stored normalized as `host:port`, defaulting to port 27900 when the
  user omits it** — the concept's UDP master port (§6.5), and [[109]]'s UDP resolver needs a port;
  the shipped defaults are therefore stored as `master.q2servers.com:27900` /
  `master.quakeservers.net:27900`.
- **`udp-master` address validation reuses [[107]]'s `parseServerAddress`** (after defaulting the
  port) rather than a second, slightly different check — that is exactly why 107 built one validator.
- **`http-list` addresses are validated as absolute `http`/`https` URLs** (no credentials, no
  control characters, length-capped) and stored whole, query string included:
  `https://q2servers.com/?raw=1`. `parseServerAddress` is a `host:port` validator and cannot judge a
  URL. AC1's shorthand `q2servers.com?raw=1` names the endpoint; the stored value is the fetchable
  form `resolveHttpListSource(url, …)` takes.
- **`raw=1` vs `raw=2` is not a stored field.** It rides in the URL the user edits; the scan derives
  the decoder from the query at scan time ([[114]]). Keeps the entry at the concept's three fields.
- **Rejections are reason *codes* mapped to i18n keys** (`servers.sources.reject.<reason>`),
  mirroring `serverAddressRejectionKey()` — main never sends prose across IPC.
- **Handlers report a domain refusal as a returned result union**, not a thrown error: the module
  registry turns a throw into the generic `modules.error.handlerFailed`, which would lose AC4's
  "refused with a reason".
- **CRUD rides the existing `module:invoke` channel** as new `SERVERS_HANDLERS` entries with zod
  schemas — the `servers` module never touches `src/shared/ipc.ts` or `ipcMain` directly.
- **Every mutating handler resolves to the full new list**, so the section renders from main's truth
  instead of maintaining an optimistic copy of an ordered list.
- **Reorder is a full permutation (`{ ids: string[] }`)**, refused unless it is exactly the stored
  set — cheaper to verify and impossible to half-apply, unlike index-based moves.
- **No platform-parity caveat.** Both source types work on Windows and Linux; nothing here is
  disabled on either platform.

## Plan

1. **Shared contract first** (`src/shared/modules/servers.ts`): `MasterSourceType`
   (`'udp-master' | 'http-list'`), `MasterSource`, `masterSourceSchema`, `DEFAULT_MASTER_SOURCES`,
   five new `SERVERS_HANDLERS` entries (`sources.list/add/remove/update/reorder`) with their payload
   schemas in `SERVERS_HANDLER_SCHEMAS`, and the `MasterSourcesResult` union.
2. **Address rules of their own** (`src/shared/servers/master-source-address.ts`): pure
   `validateMasterSourceAddress(type, address)` → `{ ok, normalized } | { ok: false, reason }`,
   delegating `udp-master` to [[107]]'s `parseServerAddress` (port defaulted to 27900) and judging
   `http-list` as an absolute http(s) URL, plus `masterSourceAddressRejectionKey()`.
3. **Defaults into [[110]]'s key**: the `sources` field of the servers state schema gets
   `.default(DEFAULT_MASTER_SOURCES)`; check 110's landed shape first (`src/shared/modules/servers.ts`,
   `src/main/lib/schemas.ts`, `src/main/services/state.ts`) and only replace its empty-array literal —
   do not redesign the key.
4. **Main-side operations** (`src/main/modules/servers/master-sources.ts`): pure list ops
   add/remove/update/reorder over a `MasterSource[]`, each returning the new list or a reason code;
   `index.ts` wires them to `app.state`'s getter/setter (persist immediately) and registers the five
   handlers.
5. **Renderer**: typed client functions in `modules/servers/client.ts`; `ServersSettingsSection.tsx`
   replaces its placeholder with the real list — add form (type select + address input), per-row
   enable switch, edit, remove, drag reorder via the existing `components/dnd/SortableList.tsx`,
   refusal reason rendered inline; keys under `module.servers.settings.*` / `servers.sources.*` in
   `en.json`.
6. **Prove it on the real surface**: one flow `scripts/flows/servers-master-sources.mjs` covering
   defaults → add/remove/reorder/toggle → invalid add refused → restart round-trip (second `withApp`
   over the carried-over `state.json`, mirroring `scripts/flows/news-feed.mjs`'s phase-2 restart).

## Deliverables

- **D1 — the source shape, its defaults and its address rules (shared, pure).**
  `src/shared/modules/servers.ts` (types, `masterSourceSchema`, `DEFAULT_MASTER_SOURCES`, the five
  handler names + payload schemas + `SERVERS_HANDLER_SCHEMAS` entries, result union) and new
  `src/shared/servers/master-source-address.ts`. Mirror: `src/shared/servers/address.ts` (reason
  codes → i18n key). Tests: new `src/shared/servers/master-source-address.test.ts` (valid/invalid per
  type, port defaulting, normalization) and extend `src/shared/modules/servers.test.ts` (every
  handler has a schema; the three defaults are exactly the concept's, correctly typed).
  *Accepted when:* the constant and the validator exist, are pure, and their tests pass.

- **D2 — the shipped defaults live in [[110]]'s state key.** Verify 110's landed shape, then give
  the `sources` field `.default(DEFAULT_MASTER_SOURCES)`; touch `src/main/lib/schemas.ts`
  (parse/default), `src/main/services/state.ts` only if its default object names the field
  literally. Mirror: `parseHomeLayout`/`DEFAULT_HOME_LAYOUT`. Test in `src/main/lib/schemas.test.ts`:
  a `state.json` without the key, and one with the key but no `sources`, both yield the three
  defaults; a stored `[]` stays empty; one malformed source row is dropped, siblings survive.
  *Accepted when:* a fresh profile has the three defaults and no existing 110 test regresses.

- **D3 — main-side CRUD and its handlers.** New `src/main/modules/servers/master-sources.ts` (pure
  `addSource`/`removeSource`/`updateSource`/`reorderSources` returning new-list-or-reason) and
  `src/main/modules/servers/index.ts` registering the five handlers against `app.state`, persisting
  on every mutation. Mirror: `src/main/modules/servers/index.ts`'s existing `handle(...)` call.
  Tests: new `src/main/modules/servers/master-sources.test.ts` (each op, unknown id, malformed
  address, non-permutation reorder, disable keeps type+address) and `index.test.ts` (a handler
  round-trips through a fake `StateStore`).
  *Accepted when:* every op persists, and every refusal carries a reason code.

- **D4 — the settings section a user actually edits.**
  `src/renderer/src/modules/servers/client.ts`, `ServersSettingsSection.tsx` (+ a row component if
  it grows past ~150 lines), `src/renderer/src/i18n/locales/en.json`. Mirror:
  `modules/downloads/DownloadsSettingsSection.tsx` for the section shape and
  `components/dnd/SortableList.tsx` (as used in `modules/home/dashboard/Dashboard.tsx`) for reorder.
  Stable testids: `servers-sources-list`, `servers-source-row-<id>`, `servers-source-add-type`,
  `servers-source-add-address`, `servers-source-add-submit`, `servers-source-toggle`,
  `servers-source-remove`, `servers-source-error`.
  *Accepted when:* all four actions work against the real handlers and a refusal shows its reason.

- **D5 — the flow that proves it end to end.** New `scripts/flows/servers-master-sources.mjs`
  (mirror: `scripts/flows/settings-downloads-section.mjs` for navigation, `news-feed.mjs` for the
  restart phase) plus a `CHANGELOG.md` entry under the current version's `### Added`.
  *Accepted when:* `npm run ui:flow -- servers-master-sources` passes and the flow's steps are named
  after the ACs they prove.

## Model Hints

- D3 → `deliverable-hard` — it is the one deliverable that writes into the state key story 110 lands
  in the same sprint: a wrong setter call or a non-defensive mutation regresses 110's parse defaults
  and silently loses a user's source list on the next start.
- D1, D2, D4, D5 → default tier (pure constants/validator, a one-field default, a section that
  mirrors an existing one, a flow that mirrors two existing ones).
- Review: → default — bounded CRUD over one list with heavy precedent in the repo; no security
  surface beyond the zod schemas the module registry already enforces.

## Acceptance Tests

- AC1 → unit `src/main/lib/schemas.test.ts` › "a state.json without the servers key yields the three
  shipped master sources" (D2), plus e2e `scripts/flows/servers-master-sources.mjs` step "a fresh
  profile shows the three shipped sources, correctly typed (AC1)" — run as
  `npm run ui:flow -- servers-master-sources`.
- AC2 → e2e `scripts/flows/servers-master-sources.mjs` steps "add, remove, reorder and toggle each
  persist immediately (AC2)" (D4/D5), backed by unit
  `src/main/modules/servers/master-sources.test.ts` › "every operation returns the new persisted
  list" (D3).
- AC3 → e2e `scripts/flows/servers-master-sources.mjs` step "the edited list survives a restart with
  type and address intact (AC3)" (D5), backed by unit `src/main/lib/schemas.test.ts` › "a stored
  source round-trips its type and address unchanged" (D2).
- AC4 → unit `src/shared/servers/master-source-address.test.ts` › "an unknown type or an invalid
  address is rejected with its reason code" (D1) and
  `src/main/modules/servers/master-sources.test.ts` › "a malformed entry is refused with a reason
  and never written to state" (D3), plus e2e step "an invalid address is refused with a visible
  reason (AC4)" (D5).
- AC5 → unit `src/main/modules/servers/master-sources.test.ts` › "disabling a source keeps its type
  and address" (D3), plus e2e step "a disabled source stays in the list and re-enables without
  re-entry (AC5)" (D5).

## Done

<!-- Filled by `/build 111`. -->
