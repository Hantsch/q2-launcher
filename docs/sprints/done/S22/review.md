# Sprint S22 — Review

**Goal.** A "Servers" entry appears in the primary nav, routes to a view, and is a real registered
module — not a stub the shell knows about. Underneath it, the protocol and address groundwork every
later sprint in milestone 9 builds on (address validation, the `info`/`status` query codecs, the
master-source codecs), written as pure, unit-tested code with no live network anywhere.

**Branch:** `sprint/S22` (from `dev`) · **Milestone:** 9.1 — Servers module foundation & protocol core

## Overview

| Story | Status | Commit |
| --- | --- | --- |
| 106 — a servers module exists with its own nav entry | done | `2eeeac6` register the servers module (nav entry, settings slot, contract-first main/shared halves) |
| 107 — a server address is validated before it is trusted | done | `0a99dce` validate a server address before it is trusted |
| 108 — the launcher speaks the two server queries | done | `436b5db` speak the info and status server queries |
| 109 — master sources return an address set | done | `39fb777` master sources return an address set |

All four stories done, none blocked. Every acceptance criterion is proven by a named automated test
(see **Acceptance** below); no manual residue in the entire sprint.

## Implemented stories

**106 — a servers module exists with its own nav entry.** A `servers` module now exists end to end
along the 5-step registration checklist: a shared contract (`src/shared/modules/servers.ts`, one
`overview.read` handler with a zod schema), a `ModuleId`/`MODULE_MANIFESTS` row (`Globe` icon,
`/servers` route, primary nav order 20 between Library and Config, `status: 'planned'`), a main half
answering a zeroed overview through the registry, and a renderer half contributing only a settings
section — the route renders the shell's existing `PlannedModuleView` rather than a duplicate empty
screen, so 9.2 can swap in a real view without touching the manifest.

**107 — a server address is validated before it is trusted.** A pure `parseServerAddress`
(`src/shared/servers/address.ts`) returning a discriminated union with 13 distinct rejection reason
codes, plus `formatServerAddress`, `serverAddressRejectionKey` and a `serverAddressSchema` zod
primitive in `src/shared/schemas.ts`. This is CLAUDE.md's "never trust a renderer-supplied value"
rule applied to `+connect`'s late, re-tokenized command parser: an unvalidated address is a token
injection vector into the argument vector handed to the game.

**108 — the launcher speaks the two server queries.** Four pure `src/shared/servers/` modules — the
connectionless protocol envelope, a tolerant infostring splitter, the `info`-reply parser and the
`status`-reply parser — each table-driven against hand-built byte fixtures. Player names survive
arbitrary high-bit bytes byte-identically; a truncated status reply fails the whole reply rather than
returning a partial player list that a later sprint would read as "players left".

**109 — master sources return an address set.** The UDP master codec (header check, packed
IPv4+big-endian-port records, multi-datagram assembly with dedupe) and the HTTP list codecs
(`?raw=1` text, `?raw=2` binary), plus two injectable transport seams in
`src/main/modules/servers/` — a `MasterUdpImpl`+clock seam implementing the decided quiet-period
collector, and an HTTP seam reusing `FetchImpl` from `downloads/fetcher.ts`. No test touches a real
master or q2servers.com; the two loopback tests bind `127.0.0.1` only.

## Findings & decisions

**User decisions taken in the clarification round (binding, recorded in the story files):**

- **IPv6 is out of scope for v1** (107, concept open point #9). IPv4 literals and hostnames only,
  for this story and every consumer of it in this milestone (join, manual entry, address-book
  write); an IPv6 literal is rejected like any other malformed input. It keeps its own
  `ipv6-not-supported` reason code so the rejection can say *why*, which does not reopen the scope
  decision.
- **The UDP master reply stop condition is a quiet period** after the last received datagram (109,
  concept open point #2) — no expected-count check, no separate hard cap. Build settled it at 500 ms,
  with a separate 2000 ms *first*-reply timeout for the distinct "this master never answered at all"
  case (`no-reply`), which a quiet-period rule by construction cannot detect.

**Corrections found during build:**

- **The module registration checklist has an undocumented sixth step.** Story 106's refine claimed
  adding to `ModuleId` extends `moduleInvokeSchema` automatically. It does not — `moduleId` is a
  hardcoded `z.enum([...])` in `src/shared/ipc-schemas.ts`. The pre-existing convention test caught
  it under the narrow gate, which is the system working, but
  `docs/ARCHITECTURE.md#adding-a-module` should name that file explicitly so the next module author
  does not rediscover it. → follow-up.
- **A node-only purity self-check needs a `tsconfig.web.json` exclude.** Both 107 and 108 added a
  test that reads its own module's source via `node:fs` to prove it imports nothing from
  `node:*`/`electron`/IPC — a genuinely valuable guard, but it does not typecheck under the
  renderer project. Each was excluded individually, mirroring the existing
  `shell-home-ownership.test.ts` precedent. That is now three one-off entries for one recurring
  pattern; a shared helper or a glob would be cleaner. → follow-up.
- **Two non-blocking review observations were accepted as-is** in 109: `udp-master-source.ts`'s
  `onError` reports the generic `transport-error` rather than a more specific stored reason in one
  compound-failure edge case, and a test references a `const` declared later in the same file
  (correct under Vitest, stylistically fragile). Neither is a spec violation.

**Direction notes for milestone 9.2:**

- The `servers` route currently renders `PlannedModuleView`; 9.2 adds a real `View` to the existing
  renderer-module entry. The manifest does not need to change.
- The address vocabulary (`parseServerAddress`, the reason codes, `formatServerAddress`'s
  `normalized` form) is the deduplication and storage key for favourites, history and manual
  servers. It exists now; later stories should call it, not re-derive it.
- `servers.address.reject.*` and `servers.source.error.*` i18n keys exist with nothing rendering
  them yet. That is deliberate — the vocabulary is in place before the first surface needs it.

## Blocked / open

No blocked stories. One pre-existing defect surfaced by the gate, which does **not** block this
sprint's merge:

- **`ui:flows` cannot complete a full 55-flow run on this machine** — a harness teardown gap that
  predates the sprint. Detail under **Regression gate**. It is not S22's, and S22's own flow passes.

## Regression gate

Ran on `sprint/S22` HEAD `39fb777`.

| Command | Result |
| --- | --- |
| `npm run build` | green |
| `npm test` (full) | green — 260 files, 4300 passed, 8 skipped, 0 failed |
| `npm run ui:verify` (`e2e`) | green — 45/45 screens, 86 shots, 0 axe violations at any severity |
| `npm run ui:flows` (`e2e-all`) | **red — pre-existing harness defect, not a sprint regression** |

`ui:flows` gave 30/55, 3/55 and 18/55 passing across three consecutive runs on the same HEAD, with a
different failure set each time and always the same cause: `another instance is already running,
exiting` — the app's single-instance lock, hit before Playwright could attach.

**Verdict: pre-existing, not bisected, not fixed here.** Two independent lines of evidence:

- **Individually, the flows pass.** `home-route-roundtrip`, `downloads-tab`, `raw-inline-edit` and
  S22's own `servers-module-shell` all pass when run alone; the "another instance" signature never
  appears outside a full-suite run. (`news-feed`, `bootstrap-wizard` and `engine-update` also fail
  individually, each for its own unrelated pre-existing reason — an outbound-request assertion, an
  8s button timeout, a fixture ENOENT — none of them the cascade symptom.)
- **The cause is in the harness and predates the sprint.** `scripts/lib/harness.mjs`, `withApp()`'s
  `finally` block (~line 529), races `app.close()` against a 15s timeout with **no fallback
  `child.kill()`**. A main process that does not quit in time survives, keeps the single-instance
  lock on its fixture variant's userData dir, and every later flow reusing that variant dies
  instantly. Introduced in `d0315ec`, an ancestor of `c559ebd` — S22's own `git merge-base dev HEAD`.
  Four orphaned `electron.exe` processes from the repo's `node_modules/electron/dist/` were found
  and killed mid-investigation, matching this exactly.

The fix — a hard kill in `withApp()`'s teardown when the close race times out — is a follow-up, not
this sprint's work. Until it lands, `e2e-all` is not a trustworthy gate on this machine and
`ui:verify` plus per-flow runs are what actually prove the surface.

## Acceptance

Every criterion in this sprint is proven by an automated test. **No manual residue in any of the
four stories**, and nothing needs walking by hand.

**106 — a servers module exists with its own nav entry**

| AC | Proven by |
| --- | --- |
| AC1 module registered in `ModuleId`/`MODULE_MANIFESTS`, main + renderer halves | `src/shared/types/module.test.ts` › "servers is registered in ModuleId and MODULE_MANIFESTS…"; `src/main/modules/servers/index.test.ts`; `ServersSettingsSection.test.tsx` |
| AC2 nav entry routes to the view | **e2e** `scripts/flows/servers-module-shell.mjs` — clicks `nav-servers`, asserts the route renders |
| AC3 manifest declares its capabilities | `src/shared/types/module.test.ts` › "…exactly the network and game-lifecycle capabilities" |
| AC4 IPC namespace isolation | `src/shared/types/module.test.ts` › "every module's ipcNamespace is module: plus its id"; `registry.test.ts` › "a module's handlers are not reachable under another module's id" |
| AC5 settings section appears | **e2e** `servers-module-shell` (asserts `settings-section-servers` visible) + `ServersSettingsSection.test.tsx` |
| AC6 platform parity declared | `src/main/modules/servers/platform-parity.test.ts` |
| AC7 every handler has a zod schema | `src/shared/modules/servers.test.ts` |

**107 — a server address is validated before it is trusted** — all five ACs in
`src/shared/servers/address.test.ts`: AC1 "accepts a hostname and an IPv4 literal with a port";
AC2 "rejects each malformed address with its own reason"; AC3 "rejects a host outside the documented
character set"; AC4 `describe('purity')` "imports nothing from node, electron or the IPC layer";
AC5 "every rejection reason has its own i18n key".

**108 — the launcher speaks the two server queries** — AC1 `protocol.test.ts` › "builds both query
datagrams with the connectionless prefix"; AC2 `info-reply.test.ts` › "parses a well-formed info
reply…"; AC3 `status-reply.test.ts` › "parses a status reply into serverinfo and a player list…";
AC4 `infostring.test.ts` › "every serverinfo key is optional and nothing is defaulted" +
`info-reply.test.ts` › "a non-numeric maxclients leaves maxClients undefined…"; AC5
`status-reply.test.ts` › "a player name survives arbitrary and high-bit bytes byte-identically";
AC6 `status-reply.test.ts` › "a truncated or malformed reply is a failure, never zero players" +
`protocol.test.ts` › "a broken envelope is rejected with its own reason"; AC7 `protocol.test.ts` ›
"no codec in the servers folder imports node, electron or the IPC layer".

**109 — master sources return an address set** — AC1 `master-records.test.ts` › "unpacks a master
reply into packed IPv4 and big-endian port records"; AC2 same file › "assembles several datagrams
into one address set without duplicates" + `udp-master-source.test.ts` › "collection ends one quiet
period after the last datagram"; AC3/AC4 `http-list.test.ts` › the `raw=1` and `raw=2` cases;
AC5 `master-records.test.ts` › "a malformed or truncated payload is an explicit failure, never a
partial address" + `http-list.test.ts` › "a rejected line is skipped with its reason…";
AC6 `udp-master-source.test.ts` › "the UDP transport is driven entirely through its injectable seam"
+ `http-list-source.test.ts` › "the HTTP list is fetched through the injected FetchImpl against a
loopback server".

**Criteria covered below the real surface.** None in the conventional sense — 107, 108 and 109 have
no user-facing surface by design (pure codecs, no IPC channel, no UI), so their criteria belong at
the unit level and the `e2e` gate does not apply to them. 106 is the only story with a surface, and
its two user-facing criteria (AC2, AC5) are both proven through the real app by the
`servers-module-shell` flow, which passes.
