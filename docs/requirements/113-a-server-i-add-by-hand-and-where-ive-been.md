---
id: 113
title: a server i add by hand, and where i've been
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Two more pieces of the browser's own data, both global to the launcher and both living in [[110]]'s
state key: servers the user adds by hand, and a record of servers the launcher has actually
connected to.

**Manual servers** (GB-S4) exist for anything no master lists — a private or LAN server that will
never appear in a scan's discovered set. The user enters an `ip:port` directly; it is validated
through the same strict address validator [[107]] built for every other address this app puts into
an argument vector, so a manual entry can never smuggle something unsafe past that check. A manual
server is stored in a way that distinguishes it from a master-discovered one, so the list (once it
exists, [[118]]) can show the difference rather than presenting both identically.

**History** (GB-P3) records servers the launcher itself connected to. The actual moment a join gets
recorded is [[125]]'s job (sprint 9.6, the join flow) — this story does not add that trigger. What
this story builds is the store itself: a bounded, ordered history with a read API and the eviction
behaviour that keeps it bounded. The concept leaves the exact cap open (§11 "bounded in length");
this story fixes it at **200 entries**, evicted oldest-first once a new entry would exceed it — the
same order of magnitude as `downloadFailures`' 50-entry-plus-7-day-retention cap
(`src/main/modules/downloads/failure-log.ts`), scaled up because a join is a much lighter, much
more frequent event than a download failure.

Concept open point #4 ("are history entries queried during a scan?") is a scan-engine decision, not
a persistence one — this story stores history and reads it back; whether the scan address set
folds history in is sprint 9.3's call ([[114]]), and is left to that story rather than answered
here.

## Acceptance Criteria

- [ ] **AC1** — A manually entered `ip:port` is validated through the same address validator
      [[107]] built; a value that fails that validator is refused with a reason and never persisted.
- [ ] **AC2** — A stored manual server carries a flag (or equivalent shape) marking it as
      hand-added, distinguishable from a master-discovered server entry — nothing about a manual
      server's stored shape is indistinguishable from a discovered one.
- [ ] **AC3** — The history store is capped at 200 entries; adding a 201st entry evicts the oldest
      one first, and the store never exceeds the cap.
- [ ] **AC4** — A read API returns history entries in most-recent-first order.
- [ ] **AC5** — Manual servers and history both persist across an app restart, read back from
      [[110]]'s state key unchanged.
- [ ] **AC6** — A manual server can be removed; removing it does not affect history or any other
      manual entry.

## Open Questions

None — all detail questions were decided during refine, see `## Decisions (Sprint)`.

## Decisions (Sprint)

- **D-A — A manual entry is stored as `{ address, origin: 'manual', addedAt }`, in its own
  `manualServers` collection in [[110]]'s key.** The collection alone would satisfy AC2 today, but
  [[114]] will fold several collections into one address set where the collection boundary is lost,
  so the entry stays self-describing.
- **D-B — The stored address is the validator's normalized `host:port`** (`formatServerAddress` on
  `parseServerAddress`'s result), and adding an already-stored address is idempotent (no duplicate).
  Same "keyed by address, no duplicates" rule [[112]] AC4 fixes for favourites; one normalization
  rule for the whole module.
- **D-C — A rejected address comes back as a result union `{ ok: false, reasonKey }`, not a thrown
  IPC error**, with `reasonKey` from `serverAddressRejectionKey()`. Mirrors `parseServerAddress`'s
  own discriminated union and keeps CLAUDE.md's "main sends i18n keys, never prose" rule; the
  `servers.address.reject.*` entries already exist in `en.json`, so no locale work is needed.
- **D-D — A history entry is `{ address, connectedAt }`, nothing more.** [[125]] composes the
  `+connect` and therefore knows exactly these two things; a server name or ping would be a guess
  about a consumer that does not exist yet.
- **D-E — History is deduped by address: a repeat join moves the entry to the front and updates
  `connectedAt`** rather than appending a second row. "Where I've been" is a set of places; without
  dedupe one busy server would fill the 200-entry cap on its own.
- **D-F — History is stored newest-first, so the cap is a `slice(0, 200)` and the read API is a
  plain read.** Exactly `failure-log.ts`'s `[fresh, ...rest].slice(0, CAP)` shape, which this story's
  Requirement already names as its precedent.
- **D-G — The cap is also enforced on parse, not only on append.** A hand-edited or foreign
  `state.json` with 500 rows must not reintroduce an unbounded list; the bound is a store invariant
  (GB-P3), not an append-path detail.
- **D-H — `history.read` is the only history channel; there is no `history.record` over IPC.** A join
  is recorded by the main process ([[125]]), so the renderer never needs write access — the smaller
  surface is the safer one.
- **D-I — Removing a manual server is idempotent**: removing an address that is not stored succeeds
  as a no-op instead of erroring. A remove has no meaningful failure mode for the caller to handle.
- **D-J — No e2e flow in this story; every AC is proven by unit tests.** The sprint deliberately
  ships no servers UI (server list is [[118]], sprint 9.4), so there is no real surface to drive —
  this is an IPC/core story in the sense of `ui-acceptance-required`, not a suppressed user action.
  The e2e coverage for manual servers and history lands with [[118]]/[[125]].
- **D-K — If [[110]] already landed entry-level schemas for `manualServers`/`history`, this story
  reuses them and only extends them where an AC needs it** — the two stories share one key and the
  shape must not be invented twice.

## Plan

1. **Shared contract first** (CLAUDE.md's contract-first rule): extend
   `src/shared/modules/servers.ts` with the manual-server and history entry types + zod schemas,
   `SERVER_HISTORY_CAP = 200`, and four new `SERVERS_HANDLERS` entries
   (`manual.list`, `manual.add`, `manual.remove`, `history.read`) with their payload schemas in
   `SERVERS_HANDLER_SCHEMAS`. Reuse whatever [[110]] already put there (D-K).
2. **Pure reducers next**, mirroring `src/main/modules/downloads/failure-log.ts`:
   `src/main/modules/servers/manual-servers.ts` (validate → normalize → dedupe add, idempotent
   remove) and `src/main/modules/servers/history-log.ts` (newest-first append with dedupe + cap,
   `capHistory` for the parse path). No electron, no state access — reducers over plain arrays.
3. **Wire last**: handlers in `src/main/modules/servers/index.ts` reading/writing [[110]]'s state key
   through `app.state`, the same way `src/main/modules/home/index.ts` uses
   `homeLayout()`/`setHomeLayout()`; apply the cap in `src/main/lib/schemas.ts`' servers parse.
4. Tests are written inside the deliverable that implements the behaviour, never as a trailing D.

Not in scope: any renderer surface, any join trigger ([[125]]), any scan-engine use of these
collections ([[114]]).

## Deliverables

- **D1 — Contract.** `src/shared/modules/servers.ts`: `ManualServer` / `ServerHistoryEntry` types +
  zod schemas, `SERVER_HISTORY_CAP`, the four handler channels and their payload schemas; the
  add-result union from D-C. Mirror: `src/shared/modules/home.ts` (HANDLERS + HANDLER_SCHEMAS pair).
  Acceptance: `src/shared/modules/servers.test.ts`'s existing exhaustiveness check covers the new
  channels and passes; `npm run typecheck` green.
- **D2 — Manual-server store.** `src/main/modules/servers/manual-servers.ts` + its test
  `manual-servers.test.ts`: `addManualServer(list, input)` (validates via
  `parseServerAddress`, normalizes, dedupes, stamps `origin: 'manual'` + `addedAt`, returns the
  D-C union), `removeManualServer(list, address)` (idempotent). Mirror:
  `src/main/modules/downloads/failure-log.ts`. Covers AC1, AC2, AC6 (its manual-entry half).
- **D3 — History store.** `src/main/modules/servers/history-log.ts` + its test `history-log.test.ts`:
  `recordServerVisit(log, entry)` (newest-first, dedupe by address, `slice(0, SERVER_HISTORY_CAP)`),
  `readServerHistory(log)` (most-recent-first), `capServerHistory(log)` for the parse path. Mirror:
  `failure-log.ts`'s `appendFailure`. Covers AC3, AC4.
- **D4 — Wiring + persistence.** Handlers in `src/main/modules/servers/index.ts` (manual list/add/
  remove, history read) over [[110]]'s state getter/setter; cap applied in the servers parse in
  `src/main/lib/schemas.ts`; tests in `src/main/modules/servers/index.test.ts` (handlers registered,
  add→list→remove round-trip, history untouched by a manual remove) and in
  `src/main/services/state.test.ts` (reload round-trip). Mirror: `src/main/modules/home/index.ts`.
  Covers AC5, AC6 (its cross-collection half), D-G.

## Model Hints

- D1, D2, D3 → default tier.
- D4 → `deliverable-hard` — it is the only D that crosses layers (shared key → `state.ts` getter →
  `schemas.ts` parse → module handlers) and it integrates with [[110]]'s state key landed earlier in
  the same sprint; a mistake in the shared parse degrades other modules' keys, not just this one.
- Review: → default — storage plus four handlers, no UI, and every AC has a unit test.

## Acceptance Tests

- AC1 → unit `src/main/modules/servers/manual-servers.test.ts` › "an address the validator rejects is
  refused with its reason key and never stored"
- AC2 → unit `src/main/modules/servers/manual-servers.test.ts` › "a stored manual server is marked
  hand-added"
- AC3 → unit `src/main/modules/servers/history-log.test.ts` › "a 201st entry evicts the oldest and the
  log never exceeds the cap"
- AC4 → unit `src/main/modules/servers/history-log.test.ts` › "history reads back most-recent-first"
- AC5 → unit `src/main/services/state.test.ts` › "manual servers and history survive a state store
  reload"
- AC6 → unit `src/main/modules/servers/index.test.ts` › "removing one manual server leaves the other
  manual entries and the history untouched"

Gap (see D-J): no e2e flow, because this sprint ships no servers UI to drive — the user-facing
acceptance for manual servers and history belongs to [[118]] (list surface) and [[125]] (join
trigger). No `manual residue`: every criterion here is automatable at the level it lives at.

## Done

<!-- Filled by `/build 113`. -->
