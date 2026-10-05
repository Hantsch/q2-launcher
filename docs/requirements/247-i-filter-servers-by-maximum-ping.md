---
id: 247
title: I filter servers by maximum ping
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player who only wants to play where my connection is good, I can hide every server whose ping
is above a limit I choose, e.g. "< 100 ms".

User feedback 2026-10-04: filter by max ping, e.g. < 200; larger makes no sense — "I only want to play
on servers where I have a good ping".

Today ping is measured per server on every scan (`rttMs`) and the list can be sorted by ping, but
`ServerListFilter` has no ping field.

Concept: [game-browser.md](../systems/game-browser.md), [servers-module.md](../systems/servers-module.md).

## Acceptance Criteria

- [ ] **AC1** — The filter bar has a "Max ping" select with Any, < 50, < 100, < 150 and < 200 ms;
      Any is the default.
- [ ] **AC2** — With a limit set, only servers whose last measured ping is below the limit are shown.
- [ ] **AC3** — Servers without a measured ping (no answer, stale) are hidden while a limit is set.
- [ ] **AC4** — The filter count ("showing N of M") and Clear include the ping limit.
- [ ] **AC5** — The ping limit is part of a saved quick filter, and a quick filter saved before this
      story still loads and applies (as "Any").
- [ ] **AC6** — The limit works the same in Online and LAN mode.

## Open Questions

- ~~**Q1** — Are the steps right, or does the user want a free number? Recommendation: fixed steps,
  matching "> 200 makes no sense".~~ answered → Decisions (Sprint)
- ~~**Q2** — Should a server that drops above the limit during an auto-refresh vanish immediately, or
  stay until the next manual action? Recommendation: vanish — the list is live everywhere else.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Ping limit steps: fixed steps.
- **(User)** Server rising above the limit during auto-refresh: vanishes immediately.
- The field is `maxPingMs: 50 | 100 | 150 | 200 | null` on `ServerListFilter` (`null` = Any), with
  the steps exported once as `MAX_PING_STEPS`. Reason: every other select uses `null` for "not
  applied", and one exported list keeps the select, the schema and the tests from drifting apart.
- "Below the limit" is strict (`rttMs < limit`). Reason: the labels say "< 100 ms", so a server at
  exactly 100 ms does not match.
- A row matches only when `status === 'online'` and it has an `rttMs`. Stale rows keep their last
  `rttMs`, and pending rows have none. Reason: AC3 hides servers that did not answer this round,
  and a stale row's old ping would otherwise pass the limit.
- In the persisted quick-filter schema, `maxPingMs` is optional and defaults to `null`. A value that
  is not one of the steps fails that entry, which is then dropped like any other damaged entry
  (story 197). Reason: AC5 requires old entries to load as Any, and silently mapping an invalid
  value onto a step would apply a filter the user never saved.
- A ping limit counts as a criterion. A ping-only quick filter can be saved, the chip's pressed
  state compares it, and the "save needs criteria" hint names it. Reason: AC5 makes the limit part
  of a saved filter, so it must behave like the other selects.
- The select sits in the selects group after Map, labelled "Max ping", with options "Any",
  "< 50 ms" … "< 200 ms". Reason: it is a select like mod/gamemode/map, and the rail already
  groups selects together.
- "Vanishes immediately" needs no new code. The list filters every `entries` update through
  `filterServers`, so a rescan that measures a higher ping removes the row. The e2e flow shows this
  with a manual refresh, which runs the same update path as auto-refresh. Reason: the user decision
  is met by the existing live data flow.
- Online/LAN parity comes from the shared predicate, and an extra step in the existing LAN flow
  proves it. Reason: both modes run the same `filterServers`.

## Plan

1. **Shared engine (D1).** Add `MAX_PING_STEPS`, `MaxPingMs` and `maxPingMs` to
   `src/shared/servers/list-filter.ts`. That covers `EMPTY_SERVER_LIST_FILTER`, `isFilterActive`
   and `matchesFilter`, which checks online + `rttMs < limit`. In
   `src/shared/servers/quick-filters.ts`, extend `criteriaOf`, `hasCriteria` and `sameCriteria`.
   In `src/shared/modules/servers.ts`, add the field to `quickFilterCriteriaSchema`, optional and
   defaulting to `null`. Update the systems docs.
2. **Renderer (D2).** Add a "Max ping" `<Select>` to `ServerListFilterBar.tsx`, with locale keys
   and an updated i18n bundle snapshot, the component test and a CHANGELOG line. Clear and the
   count need no new code, because `isFilterActive` and `EMPTY_SERVER_LIST_FILTER` already include
   the new field.
3. **E2E (D3).** Add a new flow, `servers-ping-filter`, with loopback responders: a fast one, one
   delayed by 100 ms, and one that answers once and is then closed (stale). Seed a legacy quick
   filter without `maxPingMs`, and add one LAN step to `servers-lan-mode`.

Order: D1 → D2 → D3. Story 250 (built next) follows `filterServers`, so it inherits the limit
without changes here.

## Deliverables

- **D1 — ping limit in the shared filter engine and the quick-filter schema.** Files:
  `src/shared/servers/list-filter.ts`, `src/shared/servers/quick-filters.ts`,
  `src/shared/modules/servers.ts`, `docs/systems/game-browser.md`, `docs/systems/servers-module.md`,
  plus tests in `src/shared/servers/list-filter.test.ts`, `src/shared/servers/quick-filters.test.ts`
  and `src/main/modules/servers/persisted.test.ts`.
  - `list-filter.ts`: `export const MAX_PING_STEPS = [50, 100, 150, 200] as const`,
    `export type MaxPingMs = (typeof MAX_PING_STEPS)[number]`, and a new field
    `maxPingMs: MaxPingMs | null` on `ServerListFilter` (doc comment: strict "below", only online
    rows with a measured ping match). Set it to `null` in `EMPTY_SERVER_LIST_FILTER` and treat
    `!== null` as active in `isFilterActive`. In `matchesFilter`, a row passes only if
    `row.status === 'online' && row.rttMs !== undefined && row.rttMs < f.maxPingMs`, so stale and
    pending rows fail while a limit is set.
  - `quick-filters.ts`: add `maxPingMs` to `criteriaOf`, `hasCriteria` (`!== null`) and
    `sameCriteria` (`===`).
  - `servers.ts` `quickFilterCriteriaSchema` (still `.strict()`): add
    `maxPingMs: z.union(MAX_PING_STEPS.map(z.literal)) /* or z.literal per step */ .nullable().default(null)`.
    Mirror the `serverGamemodeSchema` pattern (a fixed list typed with `satisfies`). The output
    type must stay `QuickFilterCriteria`. `persisted.ts` stays unchanged, since `parseKeyedRows`
    already drops an entry that fails the schema.
  - Fix every `ServerListFilter`/`QuickFilterCriteria` literal that `npm run typecheck` flags
    (tests, fixtures) by adding `maxPingMs: null`.
  - Docs: in `game-browser.md`, add max ping to the filter list (§ "Filters and search", ~l.419)
    and to GB-L5 (~l.762). In `servers-module.md`, note under `quickFilters` (~l.65) that the
    criteria include the ping limit and that old entries load as Any.
  - Tests:
    - `list-filter.test.ts`, `describe('ping limit (story 247)')`:
      - "a limit shows only online rows below it": 30 and 99 pass `< 100`, while 100 and 140
        fail.
      - "stale and unmeasured rows are hidden while a limit is set": a stale row with `rttMs: 10`
        and a pending row with no `rttMs` both fail.
      - "no limit keeps every row": with `maxPingMs: null`, stale and pending rows pass.
      - "a ping limit makes the filter active".
    - `quick-filters.test.ts`, "the ping limit is a criterion": `criteriaOf` carries it,
      `hasCriteria` is true for a ping-only filter, and `sameCriteria` differs on it.
    - `persisted.test.ts`, "a quick filter saved before story 247 loads with no ping limit": an
      entry without `maxPingMs` parses to `maxPingMs: null`. Also "a quick filter with an unknown
      ping step is dropped": `maxPingMs: 75` drops that entry and keeps its siblings.
- **D2 — "Max ping" select in the filter rail.** Files:
  `src/renderer/src/modules/servers/ServerListFilterBar.tsx`,
  `src/renderer/src/modules/servers/locale/en.json`,
  `src/renderer/src/i18n/__snapshots__/en.bundle.json` (regenerate through its snapshot test),
  `src/renderer/src/modules/servers/ServerListFilterBar.test.tsx` and `CHANGELOG.md`.
  - Add a `<Field label={t('servers.filter.maxPing')}>` with a `<Select>` and
    `data-testid="servers-filter-max-ping"` after the Map field. Mirror the gamemode select: the
    options are `{ value: '', label: t('common.label.any') }` followed by `MAX_PING_STEPS`, each
    mapped to `{ value: String(ms), label: t('servers.filter.pingBelow', { ms }) }`. `onChange`
    writes `maxPingMs: value === '' ? null : (Number(value) as MaxPingMs)`.
  - Locale (`servers.filter`): `"maxPing": "Max ping"`, `"pingBelow": "< {{ms}} ms"`. Change
    `servers.quickFilter.saveNeedsCriteria` to "Set a mod, gamemode, map, ping limit or quick
    toggle first." (it must keep the prefix "Set a mod", which the `servers-quick-filters` flow
    asserts).
  - `CHANGELOG.md` under `## Unreleased` › `### Added`: one line, e.g. "Servers: hide servers above
    a maximum ping (< 50 to < 200 ms)."
  - Tests in `ServerListFilterBar.test.tsx`:
    - "the max ping select lists Any and the four steps, Any by default".
    - "choosing a step writes maxPingMs and Any writes null".
    - "a ping limit alone enables Clear and the count, and Clear resets it".
- **D3 — e2e proof on the real Servers surface.** Files: a new flow
  `scripts/flows/servers-ping-filter.mjs` and `scripts/flows/servers-lan-mode.mjs`.
  - Mirror the setup of `servers-filter-search.mjs`, including the manual servers, the disabled
    sources, `writePopulatedFixture` and `scan.timeoutMs: 500`. Bind the responders with
    `bindResponder(0, onQuery)` from `scripts/lib/servers-stub.mjs`, where `onQuery` sends the reply
    itself through `responder.socket.send` after `responder.delayMs` (default 0) and returns
    `undefined`. Use three responders:
    - **Fast A**, at loopback speed.
    - **Slow B**, delayed by 100 ms (its measured ping is always ≥ 100 ms).
    - **C**, which answers the first scan and is then closed (`closeResponder`) before a second
      refresh, so it goes stale while keeping its old low `rttMs`.
  - Seed `quickFilters` with a legacy entry that has no `maxPingMs`:
    `{ id: 'seed-legacy', name: 'Legacy waiting', criteria: { mod: null, gamemode: null, map: null, empty: false, hideBotsOnly: false, waitingForOpponent: true } }`.
  - Steps (the step names are the AC lines in Acceptance Tests):
    - **AC1:** the select shows options Any, < 50, < 100, < 150, < 200 ms, with value `''`.
    - **AC2:** `< 50` shows {A}, while `< 150` shows {A, B}. Then set A's delay to 100 ms and
      refresh: under `< 50`, A vanishes ("vanishes immediately").
    - **AC3:** close C and refresh. With no limit, C is still listed; under `< 200`, C is hidden.
    - **AC4:** with only the ping limit set, `servers-filter-count` reads "Showing n of m", and
      Clear resets the select to `''` and hides the count.
    - **AC5:** save `< 100` as "Fast only". `state.json` then holds `criteria.maxPingMs: 100`
      (`waitForStateJson`), and clicking the chip after Clear restores `100`. The legacy chip
      exists, applies (waiting on), and leaves the select at `''`.
  - In `servers-lan-mode.mjs`, append the step "the ping limit applies to the LAN list". In LAN
    mode, `< 50` keeps the LAN row. Then call `responders.setDelayMs(100)` and refresh, and the
    LAN row is hidden under `< 50` and back under `< 150`. Reset the select to Any and the delay to
    0 at the end.

## Model Hints

All Ds use the default tier. This is a single flat predicate plus one schema field with a default,
and every risk (stale rows passing, legacy entries dropped) has its own named test.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-ping-filter.mjs` › step "AC1: the Max ping select offers Any,
  < 50, < 100, < 150, < 200 ms and starts on Any" (+ unit
  `src/renderer/src/modules/servers/ServerListFilterBar.test.tsx` › "the max ping select lists Any
  and the four steps, Any by default")
- AC2 → e2e `scripts/flows/servers-ping-filter.mjs` › step "AC2: a limit shows only servers whose
  ping is below it, and a server that slows down vanishes on the next refresh" (+ unit
  `src/shared/servers/list-filter.test.ts` › "a limit shows only online rows below it")
- AC3 → e2e `scripts/flows/servers-ping-filter.mjs` › step "AC3: a stale server is hidden while a
  limit is set" (+ unit `src/shared/servers/list-filter.test.ts` › "stale and unmeasured rows are
  hidden while a limit is set")
- AC4 → e2e `scripts/flows/servers-ping-filter.mjs` › step "AC4: the count and Clear include the ping
  limit" (+ unit `ServerListFilterBar.test.tsx` › "a ping limit alone enables Clear and the count,
  and Clear resets it")
- AC5 → e2e `scripts/flows/servers-ping-filter.mjs` › step "AC5: the ping limit is saved in a quick
  filter, and a quick filter saved before it loads as Any" (+ unit
  `src/main/modules/servers/persisted.test.ts` › "a quick filter saved before story 247 loads with no
  ping limit", `src/shared/servers/quick-filters.test.ts` › "the ping limit is a criterion")
- AC6 → e2e `scripts/flows/servers-lan-mode.mjs` › step "the ping limit applies to the LAN list";
  the Online mode is proven by `servers-ping-filter`. Run targets: `npm run ui:flow -- servers-ping-filter`
  and `npm run ui:flow -- servers-lan-mode`.

## Done
