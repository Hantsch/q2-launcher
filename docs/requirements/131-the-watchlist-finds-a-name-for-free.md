---
id: 131
title: the watchlist finds a name for free
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

"Where is *this* person?" (concept §1) is the second of the two questions the whole browser exists
for. A user keeps a handful of names; the launcher has to say, for each one, which server it is on
right now, or that it is not found — without that costing the scan anything extra, because the
concept's strongest guarantee about this feature is that "turning the watchlist on does not change
the scan cost. Nothing about the browser gets slower because the watchlist exists" (§12, GB-N7).

An entry is a name plus a **match mode** — exact, substring or regex, all case-insensitive, chosen
per entry when it is created and changeable later. Matching runs in **main**, against [[114]]'s
stage-2 (`status`) results, as they arrive during whatever scan is already running for an ordinary
reason. It is a byproduct of scanning, never a driver of it: the watchlist must never widen the
address set a scan queries, never trigger a scan on its own, and never make an already-running scan
slower than it would be without a single watchlist entry defined.

No match in the current data shows `offline`; a match shows the server, the player's score and
ping; and because a name is not an identity, a name that matches on more than one server shows
**every** match, not the first one found (§12, GB-W3).

Re-checking one found entry means re-querying only the single server it was last seen on — one
`status` query, not a scan (GB-W5a). This is the same targeted, single-server query [[117]] already
builds for "refresh this server" from the detail view, aimed at a server the watchlist chose instead
of one the user selected in the list. A re-check only answers "is this person still on the server
they were last seen on". If they have moved, the entry says so and stops there: finding them again
takes a full scan from the server browser, and the watchlist never starts that scan itself.

Accuracy here is honest, not perfect (GB-W5b): `offline` means "no fetched server matched", which
also covers the case of a player sitting on a server nobody's stage-2 fetch has reached yet — not a
claim that the player is not playing. The matcher exposes when its data is from, so whatever renders
it ([[132]]) can say so rather than let `offline` read as a fact about the world.

A user-supplied regex is still user input running over a few thousand names per scan; a pathological
pattern must not be able to hang or meaningfully slow that scan. Length caps alone cannot guarantee
that: names in a `status` reply can be up to 31 characters, and `(a+)+$` against 31 × `a` is ~2³¹
backtracking steps. So regex matching runs in a `worker_thread` with a time budget (see Decisions).
A pattern that exceeds the budget gets its worker terminated, is marked "too slow" on its entry and
skipped from then on, and the scan carries on. An invalid pattern is rejected up front, at
entry-creation time, with a clear reason — never accepted and left to fail silently later.

This is a pure module: the matcher, and the entry store it works from, take data in and produce data
out, with no `node:dgram` or IPC dependency of their own — the same seam discipline `downloads`'s
`FetchImpl` already established, restated here as GB-A6. The worker is a thin host around that
pure matcher, not a second implementation of it.

## Acceptance Criteria

- [ ] **AC1** — A watchlist entry stores a name and exactly one of three match modes (exact,
      substring, regex), all matching case-insensitively.
- [ ] **AC2** — An entry with no match in the latest stage-2 data shows `offline`.
- [ ] **AC3** — A matched entry shows the server it was found on, the player's score and the ping.
- [ ] **AC4** — A name that matches on more than one server shows every match, not only the first
      one found.
- [ ] **AC5** — Adding or using the watchlist never causes an extra query beyond what a normal scan
      already issues — the same scan, run with the watchlist populated and run with it empty, issues
      the identical number of queries.
- [ ] **AC6** — Re-checking one entry issues exactly one `status` query, addressed to the server
      that entry was last seen on.
- [ ] **AC7** — A regex pattern that does not compile, or is longer than 64 characters, is rejected
      at entry-creation time with a clear reason; it is never accepted and left to fail during a
      later scan.
- [ ] **AC8** — A pathological pattern (`(a+)+$` matched against a 31-character `aaa…a!` name)
      cannot hang or meaningfully slow a scan. The regex runs in a worker with a time budget; past
      the budget the worker is terminated, the entry is marked "too slow" and skipped, and the
      scan's own results arrive as they would without that entry. The test pins the budget.
- [ ] **AC9** — When a re-check (AC6) finds the entry's name no longer on its last-seen server, the
      entry says the player has left that server and that a full scan from the server browser is
      needed to find them again. No further query or scan is started.
- [ ] **AC10** — Stored watchlist entries survive their code expiring. They stay in `state.json`
      while the feature is locked and are back unchanged once a new code unlocks `watchlist`.

## Open Questions

- [x] ~~**Q1 — Regex safeguards.** (concept open point #5)~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — What happens to stored watchlist entries when the unlocking code expires.** (concept
      open point #12)~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Regex safeguards: **length cap + worker with a time budget**. Patterns are capped at
  64 characters and compile-checked at creation; matching runs in a `worker_thread` that is
  terminated past its budget, and the offending entry is marked "too slow" and skipped. This
  replaces an earlier caps-only proposal, which does not hold against 31-character names
  (2026-09-25, planning).
- **(User)** Entries on code expiry: **kept** in `state.json`, invisible while locked (AC10).
- **(User)** Re-check semantics: it only checks the last-seen server. If the player has moved, a
  full scan from the server browser is needed, and the watchlist never starts one (AC9).
- **D-A, entries live in `ServersState.watchlist`.** A new `watchlist: WatchlistEntry[]` field on the
  existing `servers` state key, parsed row by row like `manualServers` — the concept's
  architecture "Persistence" bullet puts the watchlist in the module's own key, and every existing servers mutator already
  spreads `...current`, so no other write can clip it.
- **D-B, AC10 falls out of "locked = not registered".** Nothing in the lock path deletes or rewrites
  `watchlist`; `parseServersState` keeps the rows whatever the lock state — deleting on lock would
  contradict the (User) decision and a parse that depends on the gate would couple persistence to 130.
- **D-C, the 64-character cap and a non-empty trimmed name apply to all three modes**, not only
  regex — one rule is simpler to state and test, and a 64-char exact/substring name can never match a
  31-char Q2 name anyway.
- **D-D, validation compiles, never runs.** Creation/edit calls `new RegExp(pattern, 'i')` inside a
  try/catch and never `.test()`s anything on main's thread — compilation is cheap and safe, matching
  is the ReDoS risk.
- **D-E, match against the name exactly as the `status` parser delivers it** (the same string the list
  shows), lower-cased for exact/substring, `'i'` flag for regex — concept open point #10 (name
  decoding) is not settled, and matching the displayed string keeps 131 and 132 consistent.
- **D-F, the worker runs from an eval'd source string built from one self-contained pure function**
  (`matchRegexNames.toString()` inside a tiny `worker_threads` host, `new Worker(src, { eval: true })`)
  — it works identically in vitest and in the CJS main bundle with no second electron-vite entry, and
  the matcher is still one implementation, not two.
- **D-G, budget = `WATCHLIST_REGEX_BUDGET_MS = 100` per job, one job = one regex entry × one server's
  roster**, jobs serialised on one long-lived worker — per-entry jobs make the culprit unambiguous when
  the worker is terminated, and 100 ms is ~4 orders of magnitude above a benign 32-name match.
- **D-H, "too slow" is persisted (`tooSlow: true`) and cleared only by editing that entry's name or
  mode** — "skipped from then on" must survive a restart, and an edit is the only thing that changes
  the verdict.
- **D-I, the scan never waits for the watchlist.** The scan service gets an optional synchronous
  observer for stage-2 rows; the watchlist enqueues and returns, errors are swallowed — that is what
  makes AC5/AC8 ("not slower") structural rather than timing luck.
- **D-J, a re-check reuses 117's `{ kind: 'server', address }` scope via `scanService.start()`**, so
  the game-running guard, single-flight and "one `status`, no `info`" come for free; its refusal comes
  back as the same `{ ok: false, reasonKey }` value.
- **D-K, an entry matched on several servers re-checks the most recently seen one** (tie → first in
  roster order) — AC6 says exactly one query, and the freshest sighting is the likeliest to still hold.
- **D-L, a re-check whose server does not answer is `no-reply`, not `left`** — GB-W5b: silence is not
  evidence the player moved; the previous match is kept.
- **D-M, adding or editing an entry re-matches it against the rosters already held in memory** (the
  scan service's last-known entries) — shows a known name immediately, costs zero queries (AC5).
- **D-N, "shows" in AC2–AC4/AC9 means the `WatchlistSnapshot` over IPC.** 131 has no surface of its
  own (132 renders it), so those ACs are proven at the main/IPC level; there is no e2e flow in 131.
- **D-O, no CHANGELOG entry in 131** — nothing is visible until 132, which owns the entry.
- **D-P, gating consumes [[130]] as built.** At refine time 130 had no plan yet; its ACs fix the shape
  this story relies on: the unlock decision is a main-side query keyed by feature name, and a locked
  feature's handlers are not registered at all. 131 declares its handlers as gated under feature
  `watchlist` through 130's declaration and attaches its scan observer only when that query says
  unlocked — no watchlist-specific gate code.

## Plan

Build after [[130]] (gate) — read 130's `## Done` for the exact gate-declaration and
`isUnlocked(feature)` names before D4/D5. All work is main + shared; nothing in the renderer.

**Output shape [[132]] renders** (fixed here, in `src/shared/modules/servers.ts`):

```ts
type WatchlistMatchMode = 'exact' | 'substring' | 'regex'
interface WatchlistEntry { id: string; name: string; mode: WatchlistMatchMode; tooSlow: boolean }
interface WatchlistMatch { address: string; serverName?: string; playerName: string;
                           score: number; ping: number; seenAt: string /* ISO, roster time */ }
type WatchlistEntryStatus =
  | { entry: WatchlistEntry; state: 'offline' }
  | { entry: WatchlistEntry; state: 'found'; matches: WatchlistMatch[] } // ≥1, seenAt desc
  | { entry: WatchlistEntry; state: 'left'; address: string; checkedAt: string;
      reasonKey: 'servers.watchlist.left.needsFullScan' }
  | { entry: WatchlistEntry; state: 'too-slow' }
// plus on every variant: recheck: 'pending' | 'no-reply' | null
interface WatchlistSnapshot { asOf: string | null /* last stage-2 row processed */;
                              entries: WatchlistEntryStatus[] }
```

Handlers (`SERVERS_WATCHLIST_HANDLERS`, own map, gated under `watchlist`): `watchlist.read` →
snapshot; `watchlist.add {name, mode}` / `watchlist.update {id, name, mode}` →
`{ ok: true, snapshot } | { ok: false, reasonKey }`; `watchlist.remove {id}` → snapshot;
`watchlist.recheck {id}` → `ScanStartResult`. Event `watchlist.changed` carries the snapshot.

Steps:
1. D1 contract + persistence (types above, schemas, `ServersState.watchlist`, row parse).
2. D2 pure entry ops (validation, AC7) + pure matcher (sync exact/substring, self-contained
   `matchRegexNames`, snapshot builder) + reason-key strings.
3. D3 regex worker host (eval worker, queue, 100 ms budget, terminate/respawn, too-slow report).
4. D4 watchlist service: scan-service stage-2 observer hook, match store, rematch-on-edit,
   re-check state machine (found / left / no-reply), too-slow persistence, `watchlist.changed`.
5. D5 servers module wiring: gated handler registration via 130, observer only when unlocked,
   AC10 lock/unlock round trip.

## Deliverables

- **D1 — Contract + persisted entries.** In `src/shared/modules/servers.ts` add the types from the
  plan (`WatchlistMatchMode`, `WatchlistEntry`, `WatchlistMatch`, `WatchlistEntryStatus`,
  `WatchlistSnapshot`), `WATCHLIST_NAME_MAX = 64`, `WATCHLIST_REGEX_BUDGET_MS = 100`,
  `watchlistEntrySchema` (`mode: z.enum(['exact','substring','regex'])`, `tooSlow: z.boolean()`),
  `watchlist: WatchlistEntry[]` on `ServersState`/`serversStateSchema`, `watchlist: []` in
  `DEFAULT_SERVERS_STATE`, a separate `SERVERS_WATCHLIST_HANDLERS` map (`watchlist.read/add/update/
  remove/recheck`) with its own `SERVERS_WATCHLIST_HANDLER_SCHEMAS` (add: `{name: string, mode}`;
  update: `{id, name, mode}`; remove/recheck: `{id}`; read: void; all `.strict()`), and
  `SERVERS_EVENTS.watchlistChanged = 'watchlist.changed'`. Keep it out of `SERVERS_HANDLERS` so 130's
  completeness check can excuse it as gated. In `src/main/lib/schemas.ts` extend `parseServersState`
  with a row-by-row `parseWatchlistEntryRow` (drop bad rows, dedupe by `id`, missing key → `[]`),
  mirroring `parseManualServerRow`. Tests in `src/main/services/state.test.ts`: round trip of
  entries in all three modes, a row with an unknown mode is dropped, a file without `watchlist`
  parses to `[]`. Update any existing test asserting the exact `ServersState` key set.
- **D2 — Pure entry ops + matcher.** New `src/main/modules/servers/watchlist-entries.ts` (mirror
  `manual-servers.ts` + `master-sources.ts`'s injectable `mintId = randomUUID`): `addWatchlistEntry(
  list, {name, mode}, mintId)`, `updateWatchlistEntry(list, {id, name, mode})` (clears `tooSlow`),
  `removeWatchlistEntry(list, id)` (unknown id = no-op). Validation, in this order, returning
  `{ ok: false, reasonKey }`: trimmed name empty → `servers.watchlist.error.empty`; longer than
  `WATCHLIST_NAME_MAX` → `servers.watchlist.error.tooLong`; mode `regex` and `new RegExp(name, 'i')`
  throws → `servers.watchlist.error.invalidRegex`; unknown id on update → `servers.watchlist.error.
  notFound`. Compile only — never `.test()` on main's thread. New `src/main/modules/servers/
  watchlist-matcher.ts`: `matchPlainEntry(entry, players)` for exact (lower-cased equality) and
  substring (lower-cased `includes`) returning every matching player; `matchRegexNames(pattern:
  string, names: string[]): boolean[]` — **fully self-contained** (no imports, no outer references;
  it is serialised with `.toString()` by D3) using `new RegExp(pattern, 'i')`; and
  `buildWatchlistSnapshot(entries, matchesByEntry, leftByEntry, recheckByEntry, asOf)` producing
  `WatchlistSnapshot` (no match → `offline`, `tooSlow` → `too-slow`, matches sorted `seenAt` desc,
  **all** matches kept). Add the five `servers.watchlist.*` keys to
  `src/renderer/src/i18n/locales/en.json`. Tests in `watchlist-entries.test.ts` and
  `watchlist-matcher.test.ts`.
- **D3 — Regex worker host with a time budget.** New `src/main/modules/servers/watchlist-regex-host.ts`:
  `createRegexHost({ budgetMs = WATCHLIST_REGEX_BUDGET_MS, createWorker? })` → `{ match(entryId,
  pattern, names): Promise<{ ok: true; hits: boolean[] } | { ok: false; reason: 'too-slow' |
  'worker-error' }>, dispose() }`. The worker is `new Worker(src, { eval: true })` where `src` is a
  small CommonJS string: `require('node:worker_threads').parentPort` + `const matchRegexNames =
  ${matchRegexNames.toString()}` from D2 — no second implementation, no new electron-vite entry.
  One long-lived worker, jobs serialised FIFO (one job = one regex entry × one roster); each job
  arms a `budgetMs` timer; on expiry `worker.terminate()`, resolve that job `too-slow`, respawn
  lazily for the next queued job (queued jobs are not lost). `dispose()` terminates and resolves
  pending jobs `worker-error`. Tests in `watchlist-regex-host.test.ts` with a **real** worker thread:
  benign pattern hits; `(a+)+$` vs `'a'.repeat(30) + '!'` resolves `too-slow` within
  `budgetMs + 400 ms` slack; a benign job queued behind it still resolves `ok` afterwards;
  `budgetMs` asserted to equal 100.
- **D4 — Watchlist service fed by the scan.** In `src/main/modules/servers/scan-service.ts` add an
  optional `onStage2Row?: (row: ScanServerPush) => void` to `CreateScanServiceOptions`, called
  synchronously from `onServer` for `stage === 'stage2'` rows **after** the existing entry merge and
  emit, wrapped in try/catch, never awaited. New `src/main/modules/servers/watchlist-service.ts`:
  `createWatchlistService({ getEntries, setEntries, getKnownServers /* scanService.read().entries */,
  scanService, regexHost, emit, now? })` → `{ onStage2Row, read, add, update, remove, recheck,
  dispose }`. On an ok `status` row: replace that address's matches (plain entries sync, regex entries
  via `regexHost.match`, skipping `tooSlow`); a `too-slow` result persists `tooSlow: true` via
  `setEntries`; `asOf` = row time; emit `watchlist.changed`. `add`/`update` validate via D2, persist,
  then re-match that entry against `getKnownServers()` rosters (D-M, regex through the host, never
  sync). `recheck(id)`: pick the most recent match's address (D-K), mark `recheck: 'pending'`, call
  `scanService.start({ scope: { kind: 'server', address } })` and return its result; the next
  stage-2 row for that address resolves it — still matched → `found` with fresh score/ping; ok
  roster without the name → `left` (AC9); failed reply → keep previous state, `recheck: 'no-reply'`.
  Entry not found / not currently `found` → `{ ok: false, reasonKey:
  'servers.watchlist.error.notFound' }`. Tests in `watchlist-service.test.ts` and a new case in
  `scan-service.test.ts`, using the existing `QueryServerFn` fakes (mirror `scan-service.test.ts`).
- **D5 — Gated wiring in the servers module.** In `src/main/modules/servers/index.ts`, only when 130's
  main-side query says `watchlist` is unlocked: create the regex host and watchlist service, pass
  `onStage2Row` to `createScanService`, and register the five `SERVERS_WATCHLIST_HANDLERS` through
  130's gated declaration (`setEntries` = read/replace only `watchlist`, carrying every other
  `ServersState` key over, like `favouritesAdd`). Locked: none of it exists — no handlers, no
  observer, no worker; `state.json`'s `watchlist` untouched. `dispose()` disposes service + host.
  Declare feature `watchlist` → `SERVERS_WATCHLIST_HANDLERS` wherever 130's declaration lives.
  Tests in `src/main/modules/servers/index.test.ts` (mirror its existing setup harness).

## Model Hints

- D3 → deliverable-hard — the one new execution path in this story: a `worker_threads` eval worker
  whose termination, respawn and FIFO hand-over must neither lose a queued job nor blame the wrong
  entry, and whose serialised `matchRegexNames` breaks silently if it ever gains an outer reference.
- Review: → story-review-hard — the plausible wrong implementation is a regex `.test()` against player
  names on main's thread somewhere outside D3 (a "fast path" in D2's matcher, D4's rematch-on-add, or
  a validation that tries the pattern on a sample): every benign-pattern test passes and a default
  review of each D in isolation will not see it, yet it reopens exactly the ReDoS hang AC8 closes;
  the hard pass also checks D-I (the scan never awaits the watchlist).

## Acceptance Tests

131 has no user-facing surface (D-N: it stays invisible until [[132]] renders it), so every AC is
proven at unit/main level; `ui-acceptance-required` applies to 132.

- AC1 → unit `src/main/modules/servers/watchlist-matcher.test.ts` › "exact, substring and regex all
  match case-insensitively" + `src/main/services/state.test.ts` › "a watchlist entry round-trips with
  exactly one of the three match modes"
- AC2 → unit `src/main/modules/servers/watchlist-matcher.test.ts` › "an entry with no match in the
  stage-2 data is offline"
- AC3 → unit `src/main/modules/servers/watchlist-service.test.ts` › "a matched entry carries server,
  player score and ping from the status row"
- AC4 → unit `src/main/modules/servers/watchlist-service.test.ts` › "a name on two servers shows both
  matches"
- AC5 → unit `src/main/modules/servers/watchlist-service.test.ts` › "a scan issues the identical
  queries with the watchlist populated and empty" (same `QueryServerFn` fake, calls and addresses
  compared; includes an add/edit re-match that issues none)
- AC6 → unit `src/main/modules/servers/watchlist-service.test.ts` › "re-checking one entry issues
  exactly one status query to its last-seen server"
- AC7 → unit `src/main/modules/servers/watchlist-entries.test.ts` › "an uncompilable or over-64-
  character pattern is refused at creation with a reason"
- AC8 → unit `src/main/modules/servers/watchlist-regex-host.test.ts` › "a pathological pattern is
  terminated past the 100 ms budget and later jobs still run" + `src/main/modules/servers/
  watchlist-service.test.ts` › "a too-slow regex entry is marked and skipped while the scan's own
  results arrive unchanged" (scan finishes before the budget expires; `scan.server` events identical
  to the run without the entry; entry persisted `tooSlow` and not sent to the host again)
- AC9 → unit `src/main/modules/servers/watchlist-service.test.ts` › "a re-check that no longer finds
  the name marks the entry left and starts nothing further"
- AC10 → unit `src/main/modules/servers/index.test.ts` › "watchlist entries survive a locked start
  and come back unchanged when unlocked" (plus › "a locked servers module registers no watchlist
  handler and attaches no scan observer")

## Done

<!-- Filled by `/build 131`. -->
