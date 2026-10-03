---
id: 215
title: main-owned data is read through one query hook
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want every renderer panel that reads a list from main and applies its own
mutations to use one query hook and one mutation hook, so that cancellation, error mapping,
optimistic apply and subscription are implemented once, behave the same in every view, and have a
place to grow caching later. As a user I want the server list not to re-sort hundreds of rows on
every unrelated state change.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F19, F48, F61):
`let cancelled = false` appears 36 times in 26 non-test renderer files, always wrapping a
one-shot IPC read with `if (cancelled) return` and a cleanup. `useWatchlist` and
`useQuickFilters` are the same hook under two names; `ServersSettingsSection` and
`ReplaysSettingsSection` carry a near-verbatim 15-line `mutate` (transport Outcome → domain
ok/reason → i18n prefix → set list) that differs only in setter name and prefix — one disables
controls while busy, the other does not. A generic `useTileData` (loading/error/retry) exists
only under `modules/home/components/`. `ServersView` (558 lines, 13 `useState`, 0 `useMemo`)
recomputes `sortServerRows`/`filterServers` on every render while `ReplaysView` memoises the same
chain. The renderer has five Zustand stores and five contexts with no written rule for which to
use; docs/ARCHITECTURE.md says "one Zustand store".

Depends on story 206 (refusal shape) for the mutation hook's error mapping.

## Acceptance Criteria

- [x] **AC1** — `src/renderer/src/lib/useModuleQuery.ts` exports
      `useModuleQuery<T>(read, { subscribe?, deps? })` → `{ state, data, error, reload }` and
      `useModuleMutation<T, R>(apply, toKey)` → `{ run, busy, error }`; both are unit-tested for
      unmount-before-resolve, StrictMode double mount, a refused mutation and a transport failure.
- [x] **AC2** — First wave migrated: `useWatchlist`, `useQuickFilters`, both `*SettingsSection`
      list blocks, `NameTemplatesList`, and `useTileData` (which becomes a thin alias or is
      deleted); second wave: `ServersView`, `ModsView`, `DownloadsView`. The count of
      `let cancelled = false` in `src/renderer/src` (non-test) drops below 10, with the remaining
      sites listed in the story's Done section with a reason each.
- [x] **AC3** — `ServersView` memoises `sortedRows`/`visible`; `useServerScan()` and a shared
      `useListSort(get, set)` (used by servers and replays) are extracted with their own tests;
      `ServersView` is under 350 lines.
- [x] **AC4** — docs/ARCHITECTURE.md's renderer section gets a "State" paragraph: main-owned data
      → `useModuleQuery` or the mirrored store; cross-view renderer state → a module Zustand
      store; subtree handles → context; otherwise component state. The "one Zustand store"
      sentence is corrected.
- [x] **AC5** — Every servers, replays, mods and downloads flow stays green.

## Decisions (Sprint)

- **(User)** Q1: Cache-free hook for now.
- **Hook contract follows `/renderer-guidelines` §2**: `useModuleQuery(read: () => Promise<Outcome<T>>, { subscribe?, deps? })` and `useModuleMutation<I, R>(apply: (input: I) => Promise<Outcome<R>>, toKey?)` with `run(input): Promise<R | undefined>`, because the house skill already fixes that contract and the AC's names are a subset of it.
- **`error` is a `LocalizedMessage | null`** on both hooks (the `Outcome` failure, a refusal mapped by `toKey`, or the new key `ipc.error.unreachable` for a rejected promise), because CLAUDE.md requires i18n keys + params, never prose, and refusals carry `params` since story 206.
- **`toKey` is optional** and defaults to `{ key: refusal.reasonKey, params: refusal.params }`, because story 206 made every `reasonKey` a full i18n key, so the old per-site "i18n prefix" step no longer exists.
- **`useModuleQuery` also returns `setData(next)`**, because every list mutation returns main's full new list and applying it directly is the "optimistic apply" the requirement names, without a second IPC read.
- **A push beats a later-resolving read of the same cycle**: once `subscribe` has delivered a value, a read response of that cycle is dropped, because a push is always at least as fresh; a `reload()` whose response arrives after a newer `reload()` is dropped too (generation counter).
- **Multi-action sections pass the action as input** (`useModuleMutation((action: () => Promise<Outcome<R>>) => action())`), keeping one shared `busy`/`error` per section like today's single error line.
- **Both settings sections disable their controls while `busy`**, because the guideline says `busy` disables every mutation's control, not only where an author remembered (today only Servers does).
- **`useTileData` becomes a thin alias** over `useModuleQuery` (adapts its throwing `fetcher` and maps `reload` → `retry`), because its tile callers and `DashboardTileFrame` composition then stay untouched.
- **`useWatchlist` / `useQuickFilters` keep their public return shapes**, because only their internals are the duplication (F19) and changing the API would ripple into `ServersView`, `WatchlistPanel` and the dialogs for nothing.
- **`useListSort(get, set)` returns `{ sort, setSort(next) }` and the caller computes `next` with its own `nextSort`**, because story 217 (built later) unifies `nextSort` and the `null`/`undefined` sentinel; until then `ServersView` keeps one `?? undefined` at the `sortServerRows` call, which 217 AC3 deletes.
- **`useListSort` and `useModuleQuery` live in `src/renderer/src/lib/`**, because both are used by more than one module and modules already import `lib/` (e.g. `lib/toast.ts`).
- **AC2's "< 10" needs a third wave**: the named first and second waves remove ~17 of 36 sites, so D7/D8 also migrate the plain one-shot reads in shell/home/downloads/servers dialogs; left over (≤ 8, listed in Done by /build): the four config sites (`ConfigView`, `RawFileTab`, `ImportProfileDialog`, `InstallationProfilesPanel` — story 218/212 rewrite those reads), `EngineUpdateAction` (module-level first-check throttle), two `BootstrapWizard` sites (job-keyed failure lookup, summary), and at most one in `useServerScan`'s coalesced streaming read.
- **The budget is guarded by a test over a broader regex** (`let (cancelled|stale|ignore|disposed|alive|active|mounted|aborted) = (true|false)` in non-test `src/renderer/src`, threshold ≤ 9), because a rename to `stale` (already used by `ModsView`, `RemoveModDialog`, `ServerLocalContentSection`) would otherwise satisfy the literal count without migrating anything.
- **Health assertions go into one new node-level test file `src/renderer-health.test.ts`** (fs-reading, same style as `src/architecture.test.ts`), because the line cap, the flag budget and the ARCHITECTURE.md paragraph are repo-text checks and `architecture.test.ts` is being touched by concurrent stories.
- **`ServersView` reaches < 350 lines by extracting `useServerScan` (scan/mode/LAN/source-label state) and a `ServersToolbar` component**, because the file has grown to 721 lines since the review and the scan hook alone does not get it under the cap.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Is a tiny cache (same `read` key → shared in-flight promise) wanted now, or is the
      hook deliberately cache-free until a story needs it?

## Plan

Renderer-only story; no IPC, main or shared change (one new i18n key).

1. **D1** — the two hooks in `src/renderer/src/lib/useModuleQuery.ts` with their four required test
   scenarios. Everything else builds on it.
2. **First wave (D2, D3)** — servers: `useQuickFilters`, `useWatchlist`, `ServersSettingsSection`;
   replays/home: `ReplaysSettingsSection`, `NameTemplatesList`, `useTileData` (thin alias).
3. **D4** — `src/renderer/src/lib/useListSort.ts` over `useModuleQuery`; servers and replays use it;
   `ReplaysView`'s filter load moves onto `useModuleQuery`.
4. **D5** — `useServerScan()` + `ServersToolbar` extracted, `sortedRows`/`visible` memoised,
   `ServersView` < 350 lines (line-cap test in `src/renderer-health.test.ts`).
5. **D6** — second wave rest: `ModsView` (+ `RemoveModDialog`), `DownloadsView`.
6. **D7, D8** — third wave sweep of plain one-shot reads to get the flag budget ≤ 9; D8 adds the
   budget test.
7. **D9** — docs/ARCHITECTURE.md "State" paragraph + its test.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8 → D9 (D4 before D5: both edit `ServersView`).
Gate per D: its unit tests + its named flows (`npm run ui:flow -- <name>`).

## Deliverables

- [x] **D1 — `useModuleQuery` + `useModuleMutation`.** New `src/renderer/src/lib/useModuleQuery.ts`,
      test `src/renderer/src/lib/useModuleQuery.test.tsx`, one key in
      `src/renderer/src/i18n/locales/en.json` (`ipc.error.unreachable`: "The launcher could not
      complete this request."). Reuse `Outcome`/`LocalizedMessage`/`Refusal` from
      `src/shared/types/common.ts`; promote the shape of
      `src/renderer/src/modules/home/components/useTileData.ts` (read held in a ref, data kept across
      reload) — do not copy it, D3 turns that file into an alias of this one.
      - `useModuleQuery<T>(read: () => Promise<Outcome<T>>, options?: { subscribe?: (push: (value: T) => void) => () => void; deps?: unknown[] })`
        → `{ state: 'loading' | 'error' | 'success'; data: T | undefined; error: LocalizedMessage | null; reload: () => void; setData: (next: T) => void }`.
        `read`/`subscribe` identities are read from refs (inline arrows allowed); the effect re-runs on
        `deps` (default `[]`) and on `reload()`. Each run has a generation number: a response of an
        older generation, or arriving after unmount, is dropped. `subscribe` is called once per
        `deps` cycle and its unsubscribe runs on cleanup; a push sets `data`, `state: 'success'`,
        and makes a still-pending read of the same cycle be dropped. `Outcome` failure → `error =
        outcome.error`; rejected promise → `error = { key: 'ipc.error.unreachable' }`. `data`
        survives reload/error. `setData` applies main's returned value directly.
      - `useModuleMutation<I, R>(apply: (input: I) => Promise<Outcome<R>>, toKey?: (refusal: Extract<R, { ok: false }>) => LocalizedMessage)`
        → `{ run: (input: I) => Promise<R | undefined>; busy: boolean; error: LocalizedMessage | null; clearError: () => void }`.
        `run` clears `error`, sets `busy`, awaits; transport failure → `error = outcome.error`,
        resolves `undefined`; a value with `ok === false` is a refusal → `error = toKey(value)`
        (default `{ key: value.reasonKey, params: value.params }` when `params` present), resolves the
        value; rejected promise → `ipc.error.unreachable`, resolves `undefined`. No state update after
        unmount.
      - Tests (`renderHook` from `@testing-library/react`; StrictMode via `wrapper`): "query: unmount
        before resolve drops the result and unsubscribes", "query: StrictMode double mount reads,
        subscribes and settles once", "query: a transport failure becomes error and keeps data",
        "query: a push beats a later-resolving read", "query: a stale reload response is dropped",
        "mutation: a refused mutation sets the mapped error and resolves the refusal", "mutation: a
        transport failure sets the outcome error and resolves undefined", "mutation: busy is true while
        in flight", "mutation: unmount before resolve sets no state".
- [x] **D2 — servers first wave.** Rewrite on D1's hooks (`src/renderer/src/lib/useModuleQuery.ts`):
      `src/renderer/src/modules/servers/useQuickFilters.ts` (query `listQuickFilters`; mutations
      save/rename/remove via `useModuleMutation`, `setData(result.list)` on `ok`; public
      `UseQuickFiltersResult` unchanged, transport failure still returns `TRANSPORT_FAILED`),
      `src/renderer/src/modules/servers/watchlist/useWatchlist.ts` (query `readWatchlist` with
      `subscribe: onWatchlistChanged`; add/update/remove apply `snapshot` on success; public
      `UseWatchlistResult` unchanged), `src/renderer/src/modules/servers/ServersSettingsSection.tsx`
      (both reads → `useModuleQuery`; the 15-line `mutate` → one `useModuleMutation` whose input is
      the action thunk; `busy` keeps disabling the controls). Tests: existing
      `watchlist/useWatchlist.test.tsx` and `ServersSettingsSection.test.tsx` stay green unchanged;
      new `src/renderer/src/modules/servers/useQuickFilters.test.ts` › "a saved filter replaces the
      list and a refusal leaves it". Flows: `servers-quick-filters`, `servers-watchlist`,
      `servers-master-sources`, `servers-scan-settings`.
- [x] **D3 — replays + home first wave.** On D1's hooks:
      `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` (both list blocks: read →
      `useModuleQuery`, each `mutate` → `useModuleMutation` with the action thunk as input,
      `setData` on success, controls disabled while `busy` — the extra-folders block did not do this
      before), `src/renderer/src/modules/replays/NameTemplatesList.tsx` (read + its `mutate`),
      `src/renderer/src/modules/home/components/useTileData.ts` becomes a thin alias:
      `useModuleQuery(async () => ok(await fetcher()))` with `retry = reload`, same exported types,
      no own effect. Tests: existing `ReplaysSettingsSection.test.tsx`, `NameTemplatesList.test.tsx`,
      `useTileData.test.ts` stay green; add to `ReplaysSettingsSection.test.tsx` › "extra-folder
      controls are disabled while a mutation runs". Flows: `replays-extra-folders`,
      `replays-name-templates`, `home-tile-states` (`replays-mod-warning` is quarantined, run it but
      a red there is not this story's).
- [x] **D4 — `useListSort`.** New `src/renderer/src/lib/useListSort.ts` +
      `src/renderer/src/lib/useListSort.test.ts`:
      `useListSort<S>(get: () => Promise<Outcome<S | null>>, set: (next: S | null) => Promise<Outcome<S | null>>)`
      → `{ sort: S | null; setSort: (next: S | null) => void }`; built on `useModuleQuery(get)`
      (failed read → `null`); `setSort` applies `next` immediately, calls `set`, then applies main's
      echoed value (`null` on failure) — exactly today's behaviour in both views. Use it in
      `src/renderer/src/modules/servers/ServersView.tsx` (replaces the `getListSort` effect and
      `handleSort`'s body; keep `nextSort(sort ?? undefined, column) ?? null` and `sort ?? undefined`
      at the `sortServerRows`/`ServerListHeader` calls — story 217 removes that mapping) and
      `src/renderer/src/modules/replays/ReplaysView.tsx` (replaces its `getListSort` effect +
      `handleSort` body; also its `getListFilter` effect → `useModuleQuery`, `filterLoaded` =
      `state !== 'loading'`, filter state seeded once from `data`). Tests: `useListSort.test.ts` ›
      "a failed read yields null", "setSort applies at once then adopts main's echo", "a failed set
      falls back to null"; existing `ReplaysView.test.tsx`, `ServersView.test.tsx` green. Flows:
      `servers-sort-order`, `replays-sort-order`, `replays-filter-search`, `replays-date-filter`.
- [x] **D5 — `useServerScan` + slim `ServersView`.** New
      `src/renderer/src/modules/servers/useServerScan.ts` + `useServerScan.test.ts`, new
      `src/renderer/src/modules/servers/ServersToolbar.tsx`, edit
      `src/renderer/src/modules/servers/ServersView.tsx`, `ServersView.test.tsx`, new
      `src/renderer-health.test.ts` (node-level, reads files with `fs` like `src/architecture.test.ts`).
      Move into `useServerScan()` everything scan-related now at `ServersView.tsx` ~166–368:
      `scanState`, `entries`, `lan`, `mode` + `modeRef`/`scanModeRef`, the mount effect (order kept:
      `setMode('online')` → `setScanViewActive(true)` → first `readScan`; cleanup unsubscribes and
      `setScanViewActive(false)`), the round-end re-read, the coalesced `onScanServer` streaming read
      (at most one in flight + one trailing; only rows of the displayed mode), `sourceLabels`
      (via `useModuleQuery(listMasterSources, …)` + reload when an unknown source id fails),
      `changeMode`, `refresh/refreshFavourites/refreshServer(address)`, `rereadEntries()`. One-shot
      reads use D1's `useModuleQuery`; the coalesced streaming read may keep one local
      cancellation flag (it is listed in Done). Move the toolbar JSX (~484–563) into `ServersToolbar`
      (props: scan state, mode, lan, sort caption, handlers). Wrap `sortedRows = useMemo(() =>
      sortServerRows(entries, sort ?? undefined), [entries, sort])` and `visible = useMemo(() =>
      filterServers(sortedRows, filter), [sortedRows, filter])`. Shorten the 100-line doc comment
      above `ServersView` to the view's current responsibilities (history moves nowhere — it is in
      git). Tests: `useServerScan.test.ts` › "the mount resets to online before announcing the view
      open", "a burst of scan.server pushes queues at most one trailing read", "LAN rows never
      stream into the online list", "unmount unsubscribes and marks the view inactive";
      `ServersView.test.tsx` › "an unrelated re-render does not re-sort the rows" (spy on
      `sortServerRows` via `vi.mock` of its module, toggle the quick-filter dialog, call count
      unchanged); `src/renderer-health.test.ts` › "ServersView.tsx stays under 350 lines". Existing
      `ServersView*.test.tsx` green. Flows: `servers-list-states`, `servers-lan-mode`,
      `servers-lan-empty`, `servers-scoped-refresh`, `servers-no-scan-while-playing`,
      `servers-filter-search`, `servers-quoted-search`, `servers-detail`, `servers-actionbar-join`,
      `servers-module-shell`.
- [x] **D6 — mods + downloads second wave.** On D1's hooks:
      `src/renderer/src/modules/mods/ModsView.tsx` (catalog read → `useModuleQuery`, failure maps to
      `{ status: 'unavailable' }`; `listMods` → `useModuleQuery(…, { deps: [installationId] })`,
      every `setReloadKey(n+1)` → `reload()`; the "result for another installation counts as
      loading" rule stays), `src/renderer/src/modules/mods/components/RemoveModDialog.tsx`
      (`previewRemoval` read), `src/renderer/src/modules/downloads/DownloadsView.tsx` (cache status
      → query; failures → query with `deps: [jobs]`; dismiss/restore → `useModuleMutation` +
      `setData`). No `let stale`/`let cancelled` left in these three files. Tests: existing
      `DownloadsView.test.tsx`, `DownloadsView.failures.test.tsx` and mods tests green. Flows:
      `mods-catalog`, `mods-detail`, `mods-install`, `mods-remove`, `mod-update`, `downloads-tab`,
      `downloads-badge-count` (`mods-view` is quarantined, run it but a red there is not this
      story's).
- [x] **D7 — third wave: shell, home, downloads settings.** Replace the hand-rolled read effect with
      `useModuleQuery` (`src/renderer/src/lib/useModuleQuery.ts`) in:
      `src/renderer/src/views/LibraryView.tsx` (`deps: [installations]`),
      `src/renderer/src/components/unlock/UnlockCodePanel.tsx`,
      `src/renderer/src/components/about/AboutPanel.tsx`,
      `src/renderer/src/components/installations/RunnerSection.tsx` (two queries,
      `deps: [installation.id]`), `src/renderer/src/modules/home/HomeView.tsx` (`subscribe:
      onNewsChanged`), `src/renderer/src/modules/home/dashboard/Dashboard.tsx`,
      `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx`,
      `src/renderer/src/modules/downloads/retail/RetailUpgradeDialog.tsx`. Reads returning a raw
      value via `invoke` are wrapped `async () => ok(await invoke(…))`; a seeding side effect (first
      verified source, applied layout) runs in an effect on `data` guarded by "only once / only if
      the user has not chosen". Tests: existing tests of these files green. Flows:
      `home-tile-states`, `home-dashboard-arrange`, `home-hero-carousel`,
      `settings-downloads-section`.
- [x] **D8 — third wave: dialogs + flag budget.** Same replacement in
      `src/renderer/src/modules/downloads/repair/RepairDialog.tsx`,
      `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.tsx` (engine options, detected
      retail sources, target verdict with `deps: [targetPath]`; the job-keyed failure lookup and the
      summary stay), `src/renderer/src/modules/servers/ServerLocalContentSection.tsx` (all three:
      catalog, `listMods` with deps, map presence with its existing deps),
      `src/renderer/src/modules/servers/AddToAddressBookDialog.tsx`. Then add to
      `src/renderer-health.test.ts` › "hand-rolled cancellation flags stay within budget": counts
      `/let (cancelled|stale|ignore|disposed|alive|active|mounted|aborted)\s*=\s*(true|false)/g` over
      non-test `src/renderer/src/**/*.{ts,tsx}` and expects ≤ 9 (create the file if D5 has not).
      Flows: `servers-detail-local-content`, `servers-address-book`.
- [x] **D9 — docs.** `docs/ARCHITECTURE.md` § Renderer: replace "One Zustand store
      (`store/useLauncher.ts`) mirrors…" with the shell-store sentence (`useLauncher` is the shell
      store mirroring what main pushes for the shell) and add a `### State` paragraph: main-owned data
      → `useModuleQuery`/`useModuleMutation` (`lib/useModuleQuery.ts`) or the shell store's mirror;
      cross-view renderer state of one module → a module Zustand store; a handle a subtree shares →
      context; otherwise component state. Test in `src/renderer-health.test.ts` › "ARCHITECTURE.md
      states the four state kinds": the Renderer section contains `### State`, `useModuleQuery`,
      `Zustand store`, `context`, `component state`, and no longer contains "One Zustand store".

## Model Hints

- D5 → deliverable-hard: moving the scan effect into a hook must keep three ordering subtleties
  that only partly have flows — `setMode('online')` before `setScanViewActive(true)` (else the
  cadence broadcasts a LAN scan while the UI shows Online), the mode guard on streamed rows (LAN rows
  into the Online list), and the coalesced one-in-flight read — while also cutting the file in half.
- All other Ds: default tier.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/lib/useModuleQuery.test.tsx` › "query: unmount before resolve drops
  the result and unsubscribes", "query: StrictMode double mount reads, subscribes and settles
  once", "query: a transport failure becomes error and keeps data", "mutation: a refused mutation
  sets the mapped error and resolves the refusal", "mutation: a transport failure sets the outcome
  error and resolves undefined" (D1).
- AC2 → unit `src/renderer-health.test.ts` › "hand-rolled cancellation flags stay within budget"
  (D8); first-wave behaviour: `src/renderer/src/modules/servers/useQuickFilters.test.ts` › "a saved
  filter replaces the list and a refusal leaves it" (D2),
  `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` › "extra-folder controls are
  disabled while a mutation runs" (D3), plus the existing `useWatchlist.test.tsx`,
  `ServersSettingsSection.test.tsx`, `NameTemplatesList.test.tsx`, `useTileData.test.ts`,
  `DownloadsView*.test.tsx` unchanged. The remaining-sites list is a Done-section item for /build.
- AC3 → unit `src/renderer/src/modules/servers/ServersView.test.tsx` › "an unrelated re-render does
  not re-sort the rows" (D5); `src/renderer/src/modules/servers/useServerScan.test.ts` › "the mount
  resets to online before announcing the view open", "a burst of scan.server pushes queues at most
  one trailing read", "LAN rows never stream into the online list" (D5);
  `src/renderer/src/lib/useListSort.test.ts` › "setSort applies at once then adopts main's echo"
  (D4); `src/renderer-health.test.ts` › "ServersView.tsx stays under 350 lines" (D5).
- AC4 → unit `src/renderer-health.test.ts` › "ARCHITECTURE.md states the four state kinds" (D9).
- AC5 → e2e `npm run ui:flow -- <name>` for `servers-quick-filters`, `servers-watchlist`,
  `servers-master-sources`, `servers-scan-settings` (D2); `replays-extra-folders`,
  `replays-name-templates`, `home-tile-states` (D3); `servers-sort-order`, `replays-sort-order`,
  `replays-filter-search`, `replays-date-filter` (D4); `servers-list-states`, `servers-lan-mode`,
  `servers-lan-empty`, `servers-scoped-refresh`, `servers-no-scan-while-playing`,
  `servers-filter-search`, `servers-quoted-search`, `servers-detail`, `servers-actionbar-join`,
  `servers-module-shell` (D5); `mods-catalog`, `mods-detail`, `mods-install`, `mods-remove`,
  `mod-update`, `downloads-tab`, `downloads-badge-count` (D6); `home-dashboard-arrange`,
  `home-hero-carousel`, `settings-downloads-section` (D7); `servers-detail-local-content`,
  `servers-address-book` (D8). "Every servers, replays, mods and downloads flow" is closed by the
  sprint's `npm run ui:flows` gate; `mods-view` and `replays-mod-warning` are quarantined
  (pre-existing, stories 188/223).

## Done

Added `useModuleQuery`/`useModuleMutation` (`lib/useModuleQuery.ts`) and `useListSort`, migrated the three waves of one-shot reads, extracted `useServerScan` + `ServersToolbar` (ServersView 721 → 345 lines, memoised rows), and wrote the ARCHITECTURE.md "State" paragraph.

Commit message: `215: useModuleQuery/useModuleMutation hooks, three-wave migration, useListSort, useServerScan, State docs`

Verification (narrow gate): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` 124 files / 997 tests green; 32 story flows green one by one (`npm run ui:flow -- <name>`; downloads-tab needed a `ui:verify` reseed first). After the review fix: `npx vitest run src/renderer src/renderer-health.test.ts` 1444 green, typecheck/lint clean, 9 affected flows re-run green. Known red not ours: `settings-downloads-section` (4 vs 2 archives), `shell-layering` test. AC → test: AC1 `useModuleQuery.test.tsx`; AC2 `renderer-health.test.ts` flag budget (= 9) + `useQuickFilters.test.ts`, `ReplaysSettingsSection.test.tsx`; AC3 `ServersView.test.tsx`, `useServerScan.test.ts`, `useListSort.test.ts`, health line cap; AC4 health "four state kinds"; AC5 flows above. No manual residue.

Remaining hand-rolled flag sites (9, budget ≤ 9): `lib/useModuleQuery.ts:48` (the hook itself); config `ConfigView.tsx`, `ImportProfileDialog.tsx`, `InstallationProfilesPanel.tsx`, `RawFileTab.tsx` (stories 212/218 rewrite those reads); `BootstrapWizard.tsx` ×2 (job-keyed failure lookup, summary); `EngineUpdateAction.tsx` (module-level first-check throttle); `useServerScan.ts:106` (coalesced streaming read).

Decisions: no changelog entry (internal; only side effect is the replays extra-folder controls disabling while busy). Review 1 FAIL fixed: ModsView/RunnerSection stale-data gating, useListSort `set` ref, NameTemplatesList rejection, ReplaysView filterLoaded, `setData` beats pending read (own `applied` counter), tautological unmount tests made falsifiable, stale comments. Deliberately unfixed: `BootstrapWizard` one-render stale verdict after `targetPath` change; `useServerScan` `noteState` before generation check (both narrow, no observable effect). D6 agent returned PARTIAL only for a stale-fixture flow failure (not code); accepted after reseed re-run. D9 docs edit done by the orchestrator directly (tiny). StrictMode in tests runs effects once, so the StrictMode test asserts invariants. `useServerScan` now sets `scanState` from every read and shows snapshot rows only when their mode matches.

tiers: D 9 / hard 1 · review default · cycles 1 · agents 12
