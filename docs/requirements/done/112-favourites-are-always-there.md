---
id: 112
title: favourites are always there
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A server a user cares about should not depend on a master source still listing it, or on the user
remembering its address. Marking it a favourite fixes that: a favourite is always queried in a
scan whether or not any source currently returns it, and it is always pinned to the top of the
list (GB-S5) — pinning and always-querying are the *scan's* behaviour and belong to the scan engine
and list sorting, sprint 9.3/9.4 ([[114]], [[119]]); this story does not implement either.

This story's scope is deliberately narrower: the persistence and IPC layer that lets something be
marked and unmarked as a favourite, and lets that state survive a restart. There is no server list
to mark a favourite from yet — [[118]] is where that UI lands — so this story proves the favourites
CRUD through its IPC handlers directly (and their tests), not through a list row. Review should not
expect a finished favourite-marking UI; only the storage and the handlers it will be wired to.

Favourites are global to the launcher, not per installation (GB-P1) — the same reasoning as
[[110]]'s state key as a whole, which is where this data lives. A favourite is identified by the
server's address, because that is the only stable thing a scan result carries; nothing here keys
off an ephemeral per-scan result id, which would not survive the next scan.

## Acceptance Criteria

- [x] **AC1** — A handler exists to mark a server address as a favourite, and a handler exists to
      unmark one; both are backed by a zod payload schema before their implementation (CLAUDE.md's
      IPC contract-first rule).
- [x] **AC2** — A marked favourite is present in a subsequent read of the favourites list; an
      unmarked one is absent — both without restarting the app.
- [x] **AC3** — Favourite state persists across an app restart, read back from [[110]]'s state key
      unchanged.
- [x] **AC4** — A favourite is keyed by server address (`ip:port`), not by any scan-result id —
      marking the same address favourite twice does not create a duplicate entry, and unmarking by
      address removes exactly that entry regardless of when or whether a scan ever produced it.
- [x] **AC5** — Marking an address that is not, and has never been, a live or scanned server is
      still accepted — a favourite can be created ahead of any scan finding it, consistent with
      GB-S5's "always queried, whether or not any source lists it".

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **D-A — The favourites collection is [[110]]'s, not this story's.** [[110]] lands first in S23 and
  defines the `servers` state key including its `favourites` array plus the row-level defensive
  drop; 112 only reads and writes that collection, because inventing the shape twice is exactly what
  the sprint's build order exists to prevent.
- **D-B — A favourite entry is `{ address, addedAt }`.** Address is the normalised `ip:port` (AC4's
  key), `addedAt` an ISO timestamp, so the list has a deterministic order to assert against and
  [[118]] gets a sort key for free; no label, note or origin field — none of that is in the ACs.
- **D-C — The address is normalised through [[107]]'s `parseServerAddress` before it is stored**
  (`src/shared/servers/address.ts`, already wired into `serverAddressSchema`), because AC4's
  "twice does not create a duplicate" is only true if `1.2.3.4:27910` and a differently-spelled form
  of the same address collapse to one key.
- **D-D — Three handlers: `favourites.list`, `favourites.add`, `favourites.remove`** — the concept's
  "favourites CRUD" (§16) minus an update, which has nothing to update while an entry is just an
  address.
- **D-E — `add` and `remove` return the full favourites list.** Mirrors `home`'s
  `setLayout`/`resetLayout` returning the persisted value, so a caller never needs a second read to
  know the result.
- **D-F — Both are idempotent, neither is an error.** Adding an existing address keeps the original
  `addedAt` and returns the unchanged list; removing an address that is not a favourite succeeds as a
  no-op — a favourite toggle that can fail on a double click is a UI problem [[118]] should not have
  to solve.
- **D-G — No liveness check on `add` (AC5).** The handler never touches the network; GB-S5 means an
  address is a favourite before any scan has ever seen it, so "unknown address" is a normal input,
  not a rejection.
- **D-H — No new top-level IPC channel.** The handlers ride the existing `module:invoke` seam under
  the `servers` namespace with module-local zod schemas, per ARCHITECTURE.md's module rule and the
  concept §16 — so `src/shared/ipc.ts` and the preload allowlist are untouched.
- **D-I — No renderer client, no i18n, no UI in this story.** [[118]] owns the surface; a typed
  renderer client with no caller would be dead code this sprint.
- **D-J — Scan-time behaviour stays out.** Favourites being always queried and pinned to the top is
  [[114]]/[[119]] (sprints 9.3/9.4); nothing here reads the collection at scan time.

## Plan

1. **Contract first** (`src/shared/modules/servers.ts`): add the favourite entry type + zod schema
   (address via `serverAddressSchema`, `addedAt` ISO), the three `SERVERS_HANDLERS` ids and their
   payload schemas, and register all three in `SERVERS_HANDLER_SCHEMAS`. `src/shared/modules/
   servers.test.ts` already iterates that map, so a handler without a schema fails the build.
2. **Pure collection logic** (`src/main/modules/servers/favourites.ts`): `listFavourites`,
   `addFavourite`, `removeFavourite` over a plain `ServerFavourite[]`, normalising the address
   through `parseServerAddress` and keeping the collection sorted by `addedAt`. No Electron, no
   state store — pure functions, so the AC2/AC4/AC5 tests need no fixture.
3. **Wire the handlers** (`src/main/modules/servers/index.ts`): three `handle(...)` calls reading
   `app.state`'s `servers` getter and writing back through its setter ([[110]] AC4), exactly the
   shape `src/main/modules/home/index.ts:41-50` uses for `homeLayout`.
4. **Prove the restart** with a real `JsonStore` over a temp dir: run the handlers' effect, build a
   second `StateStore` from the same file, read the favourites back unchanged (AC3).

Order is 1 → 2 → 3/4. Nothing outside `src/shared/modules/servers.ts`, `src/main/modules/servers/`
and their tests is touched; `src/shared/ipc.ts`, the preload allowlist and the renderer stay closed.
Depends on [[110]] being built first (the state key, its getter/setter and its `favourites` field).

## Deliverables

- [x] **D1 — the favourites contract.** `src/shared/modules/servers.ts`: `ServerFavourite`
  (`{ address: string; addedAt: string }`), `serverFavouriteSchema`, handler ids
  `favouritesList: 'favourites.list'`, `favouritesAdd: 'favourites.add'`,
  `favouritesRemove: 'favourites.remove'`, their payload schemas (`serversNoInputSchema` for the
  read, `serverAddressSchema` from `src/shared/schemas.ts` for add/remove) and the three new
  `SERVERS_HANDLER_SCHEMAS` entries. Mirror: `src/shared/modules/home.ts` (`HOME_HANDLERS` +
  `HOME_HANDLER_SCHEMAS`). Plus its test in `src/shared/modules/servers.test.ts` — every handler id
  has a schema, and the add/remove schema rejects a malformed address and accepts `ip:port`.
  *Acceptance:* AC1 — the schemas exist in the shared contract before any handler does.
- [x] **D2 — favourites CRUD as pure functions.** New `src/main/modules/servers/favourites.ts`:
  `listFavourites(state)`, `addFavourite(state, address)`, `removeFavourite(state, address)` over
  [[110]]'s collection, normalising via `parseServerAddress` (`src/shared/servers/address.ts`),
  idempotent in both directions (D-F), never touching the network (D-G). Plus its test in
  `src/main/modules/servers/favourites.test.ts`.
  *Acceptance:* AC2, AC4, AC5.
- [x] **D3 — handlers on the module + the restart proof.** `src/main/modules/servers/index.ts`:
  register the three handlers against `app.state`'s [[110]] getter/setter (mirror
  `src/main/modules/home/index.ts:41-50`). Plus its test in
  `src/main/modules/servers/index.test.ts` (mirror `src/main/modules/home/index.test.ts`) covering
  the handlers through the module's own `setup()`, and a restart round-trip against a real
  `JsonStore`/`StateStore` over a temp dir (mirror `src/main/services/state.test.ts`).
  *Acceptance:* AC1 (handlers exist and are reachable), AC3.

## Model Hints

- D1 → default. A contract file addition following an existing map-plus-schema pattern.
- D2 → default. Pure functions over an array, no cross-module behaviour.
- D3 → default. Three `handle(...)` calls copied from the `home` precedent plus a store round-trip.
- Review: → default. One module, no shell edit, no new IPC channel, no renderer surface — there is
  no regression path outside the files this story creates.

## Acceptance Tests

- AC1 → unit `src/shared/modules/servers.test.ts` › "every servers handler has a payload schema"
  (extended by D1 to cover the three favourites ids) and unit
  `src/main/modules/servers/index.test.ts` › "registers the favourites handlers"
- AC2 → unit `src/main/modules/servers/favourites.test.ts` › "a marked address appears in the list
  and an unmarked one is gone"
- AC3 → unit `src/main/modules/servers/index.test.ts` › "favourites survive a restart of the state
  store"
- AC4 → unit `src/main/modules/servers/favourites.test.ts` › "the same address marked twice stays
  one entry, and unmarking removes exactly it"
- AC5 → unit `src/main/modules/servers/favourites.test.ts` › "an address no scan has ever seen can
  be marked"

No e2e line and no manual residue: every criterion here is an IPC/persistence criterion with no user
surface to drive — the favourite-marking UI is [[118]] in a later sprint, and `ui-acceptance-required`
applies to criteria describing something the *user does*. Named gap for the sprint review: the
handlers are proven through `setup()` and a real `StateStore`, not through a rendered list; [[118]]
carries the e2e flow that closes it.

## Done

**Summary.** The favourites CRUD/persistence layer is built as planned: D1 adds the
`favourites.list`/`favourites.add`/`favourites.remove` handler ids and zod payload schemas to
the shared contract, reusing story 110's `FavouriteServerEntry`/`favouriteServerEntrySchema`
rather than inventing a parallel type; D2 adds pure `listFavourites`/`addFavourite`/
`removeFavourite` functions normalising addresses through `parseServerAddress`, idempotent in
both directions, no network; D3 wires the three handlers onto `app.state`'s
`serversState()`/`setServersState()` getter/setter, mirroring `home`'s
`getLayout`/`setLayout` shape, and proves the restart round-trip against a real `StateStore`
over a temp file. No IPC channel, preload allowlist entry, renderer client or UI was added
(story 118's scope).

**Commit message:**
```
112: favourites CRUD and persistence
```

**Verification — narrow gate:**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `test-story` (`npx vitest run --changed HEAD`) — 900/900 passed across 22 files.
- No `e2e-story` run: the story defines no e2e line and no manual residue — every criterion is
  IPC/persistence with no user-facing surface (`ui-acceptance-required` only applies to
  criteria describing something the user does; the favourite-marking UI is story 118).

**AC → test mapping, as verified:**
- AC1 → `src/shared/modules/servers.test.ts` › "every servers handler has a zod schema" (+ new
  `favourites (story 112 D1)` describe block) and
  `src/main/modules/servers/index.test.ts` › "AC1: registers favourites.list/add/remove,
  reachable through setup() and behaving correctly" — both passed.
- AC2 → `src/main/modules/servers/favourites.test.ts` › "a marked address appears in the list
  and an unmarked one is gone" — passed.
- AC3 → `src/main/modules/servers/index.test.ts` › "AC3: favourites survive a restart of the
  state store" (real `StateStore` over a temp file, reloaded via a second, independent
  `StateStore` instance) — passed.
- AC4 → `src/main/modules/servers/favourites.test.ts` › "the same address marked twice stays
  one entry, and unmarking removes exactly it" (incl. two differently-spelled forms of the same
  address collapsing to one entry) — passed.
- AC5 → `src/main/modules/servers/favourites.test.ts` › "an address no scan has ever seen can
  be marked" — passed.

**Review:** clean-agent review (default tier, per Model Hints) returned PASS outright — all
five ACs individually verified PASS with file:line evidence, all named tests judged to
genuinely exercise their criterion (not tautologies), Decisions D-C through D-G confirmed
against the actual code (not just green tests), no scope creep, no weakened/deleted tests, no
CLAUDE.md guardrail violations. No findings, no fix cycle needed.

**Decisions made during implementation (not already in the story's own Decisions section):**
- D1 reused the already-landed `FavouriteServerEntry`/`favouriteServerEntrySchema` (story 110)
  instead of inventing the D1 deliverable text's literal `ServerFavourite`/
  `serverFavouriteSchema` names — the story's own D-A explicitly says the collection's shape is
  110's, not 112's, and a second, differently-named type for the same shape would contradict
  that. The three `favourites.*` handler ids and their payload schemas are new; the entry type
  is not.
- The `favourites.add`/`favourites.remove` payload is the bare address string
  (`serverAddressSchema` used directly as the payload schema), not a wrapper object — the only
  thing either mutation needs is the address, and this matches `serversNoInputSchema`'s
  precedent of using the schema type itself as the payload contract rather than an
  always-one-field object.
- **Process note:** the D3 implementation agent's first pass rewrote
  `src/main/modules/servers/index.test.ts` wholesale, silently deleting the pre-existing
  `overview.read` and `sources.*` handler tests (story 106/111) instead of extending the file.
  Caught before the code review (not by it) by inspecting `git diff --stat` after D3 returned;
  the orchestrator manually restored the deleted tests and merged them with D3's new
  `favourites.*` describe block in the same file, re-ran the full narrow gate, and only then
  sent the merged diff to review. The reviewer's own pass (item (b), deleted/weakened tests)
  confirmed the restoration was complete. No test was weakened to go green at any point.

**Open points / blockers:** none. Named gap carried forward per the story's own text: the
handlers are proven through `setup()` and a real `StateStore`, not through a rendered favourites
list — story 118 carries the e2e flow that closes that gap once the UI exists.

**Changelog:** no entry — nothing here is user-facing yet (no UI, no renderer client); the
story's own text is explicit that review should not expect a finished favourite-marking UI.
