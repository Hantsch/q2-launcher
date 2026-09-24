---
id: 110
title: the browser's data lives in its own state key
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Everything the `servers` module ([[106]]) remembers between restarts — favourites, manually added
servers, connection history, master sources and scan settings — needs one place to live before any
of the stories that write into it ([[111]], [[112]], [[113]]) can exist. This story builds only
that place: a new top-level `state.json` key the module owns outright, with its own zod schema and
a parse that never lets a broken or foreign value take the app down.

This is pure plumbing. It adds no CRUD, no UI, no IPC handler beyond what is needed to prove the
key round-trips — the operations that actually populate it are [[111]] (sources), [[112]]
(favourites) and [[113]] (manual servers, history).

The concept fixes two things this story has to honour rather than decide: the shape is **global to
the launcher, not per installation** — GB-P1, "it is about finding people, not managing setups",
unlike everything the `config`/`downloads` modules scope to an installation — and it follows the
precedent the `home` module already set for a module-owned key: a new top-level field in
`LauncherStateDocument` (`src/main/services/state.ts`), no `STATE_SCHEMA_VERSION` bump, no
migration entry, because the key is purely additive — a `state.json` written before this story
simply lacks it and loads as a safe default. `homeLayout` (story 086 D1) is exactly that
precedent: `parseHomeLayout` (`src/main/lib/schemas.ts`) falls back to `DEFAULT_HOME_LAYOUT` when
the stored value does not even parse as the right envelope, and drops a malformed row on its own
rather than discarding the whole layout. This story's schema and parse function follow the same
two-level defensiveness — envelope-level fallback to a safe empty default, row-level drop for
collection entries — for the same reason: a hand-edited or foreign `state.json` must never crash
the app, per `LauncherStateDocument`'s standing rule (`configProfiles`, `downloadFailures`, etc. all
already behave this way).

## Acceptance Criteria

- [x] **AC1** — A new top-level `state.json` key exists, owned by the `servers` module, holding
      favourites, manual servers, history, sources and scan settings — no existing key
      (`LauncherSettings` or any other module's key) is extended or repurposed for this data (GB-P2).
- [x] **AC2** — The key's shape has a zod schema in the shared layer (`src/shared/modules/servers.ts`,
      alongside [[106]]'s contract file), the same "one file per module describes what crosses the
      IPC boundary" convention `home.ts`/`downloads.ts` already follow.
- [x] **AC3** — A parse function in `src/main/lib/schemas.ts` reads the raw stored value
      defensively: a value that does not parse as the key's envelope at all falls back to a named,
      documented safe empty default (mirroring `parseHomeLayout`'s fallback to `DEFAULT_HOME_LAYOUT`
      when the envelope itself fails); a malformed entry inside an otherwise-valid collection
      (e.g. one bad favourite, one bad source) is dropped on its own rather than discarding the
      whole key (mirroring `parseConfigProfiles`'/`parseHomeLayout`'s row-level drop).
- [x] **AC4** — `StateStore` (`src/main/services/state.ts`) exposes a getter and a setter for the
      new key, wired through `JsonStore` the same way `homeLayout()`/`setHomeLayout()` are, and the
      key is included in `defaults()` with its safe empty default.
- [x] **AC5** — Loading a `state.json` that lacks the key entirely (a file written before this
      story) does not crash the app and produces the same safe empty default as a freshly parsed
      missing value — no `STATE_SCHEMA_VERSION` bump and no migration entry is added for this key.
- [x] **AC6** — Nothing in the schema, the parse function or `StateStore`'s access to this key
      accepts or stores an installation id, confirming the shape is global per GB-P1 — there is no
      per-installation scoping anywhere in it, unlike `configPlayedMods`/`configSwitchBinds`.
- [x] **AC7** — A unit test (mirroring `state.test.ts`'s existing coverage for other keys) proves
      AC3 and AC5: a corrupt/foreign value for this key degrades to the safe default without
      throwing, and a single malformed row inside a populated collection is dropped without
      discarding its siblings.

## Open Questions

<!-- None. Every detail decision below was resolvable from the concept, the sibling stories and the
guardrails — see `## Decisions (Sprint)`. -->

## Decisions (Sprint)

- **The key is named `servers`** — every module-owned top-level key in `LauncherStateDocument` so far
  is named after its owner (`downloads`, `homeLayout` for `home`), and a plain module-named key is
  what GB-P2's "one module-owned top-level key" reads as.
- **Envelope shape `{ sources, favourites, manualServers, history, scan }`** — exactly AC1's five
  buckets, each a separately parsed collection, so [[111]]/[[112]]/[[113]] each write into one of
  them without touching the others.
- **No `watchlist` field** — the concept lists it in the same key (§17), but it is a gated, later-
  milestone feature and AC1's enumeration is the binding list; the key is additive, so it costs
  nothing to add then.
- **Entry shapes are minimal and address-keyed**: source `{ id, type: 'udp-master' | 'http-list',
  address, enabled }`, favourite/manual `{ address, addedAt }`, history `{ address,
  lastConnectedAt }` — the smallest shape the concept (§11, §17) and 111–113's own criteria name,
  nothing invented beyond it.
- **`DEFAULT_SERVERS_STATE` ships empty collections, not the three shipped master sources** — AC3/AC5
  ask for a "safe empty default"; seeding the defaults is [[111]] AC1's own job and it changes this
  one constant when it lands.
- **`scan` carries GB-N4's four budget knobs (`concurrency`, `timeoutMs`, `retries`,
  `minSpacingMs`) with provisional defaults** — AC1 requires scan settings to live in the key, the
  concept names exactly these four, and the concept's open point #1 (the actual numbers) belongs to
  [[115]], which turns them into a setting; a provisional default is reversible, an absent field is
  a second schema change.
- **Stored addresses are re-validated on parse with [[107]]'s `parseServerAddress`, and a row whose
  address no longer validates is dropped** — a hand-edited `state.json` is exactly the untrusted
  input 107 exists for, and dropping the row is already AC3's required row-level behaviour.
- **Collections are deduped on parse (sources by `id`, the three address collections by normalised
  address, first wins)** — mirrors `parseHomeLayout`'s dedupe-by-`moduleId` pass, and keeps every
  later reader from having to defend against a duplicated hand-edited row.
- **Getter/setter are `serversState()` / `setServersState()`** — `servers()` on `StateStore` would
  read like "the server list"; the pair still follows the `homeLayout()`/`setHomeLayout()` wiring
  through `JsonStore` that AC4 names.
- **No e2e flow for this story** — the profile's `ui-acceptance-required` binds criteria describing
  something the *user does*; this story has no surface at all, so every criterion is core-level and
  covered by `test`.
- **No CHANGELOG entry** — nothing about this story is visible to a user; the repo's changelog rule
  is for user-facing changes only.

## Plan

Three thin layers, bottom-up, mirroring how `homeLayout` (story 086 D1) was added. No
`STATE_SCHEMA_VERSION` bump, no migration entry, no IPC, no renderer file.

1. **Shared contract** — `src/shared/modules/servers.ts` gains the persisted shape next to the
   existing IPC contract: `ServerSourceEntry` / `FavouriteServerEntry` / `ManualServerEntry` /
   `ServerHistoryEntry` / `ServersScanSettings` / `ServersState` types, their zod schemas, and
   `DEFAULT_SERVERS_STATE` (empty collections + provisional scan budget). Mirrors
   `src/shared/modules/home.ts`'s `HomeLayout` + `DEFAULT_HOME_LAYOUT`.
2. **Defensive parse** — `parseServersState(raw: unknown): ServersState` in
   `src/main/lib/schemas.ts`, next to `parseHomeLayout` (schemas.ts:1128) and built the same way:
   envelope `safeParse` → whole-key fallback to a clone of `DEFAULT_SERVERS_STATE`; per collection
   `z.array(z.unknown()).catch([])` → per-row parse returning `null` → `.filter` drop → dedupe pass
   (`parseConfigProfiles`, schemas.ts:947, is the row-drop precedent); `scan` field-wise `.catch`
   per knob like `parseDownloadsSettings`. Addresses go through `parseServerAddress`
   (`src/shared/servers/address.ts`) and are stored normalised via `formatServerAddress`.
3. **StateStore wiring** — `src/main/services/state.ts`: `servers: ServersState` on
   `LauncherStateDocument` (with the same "purely additive, no schema bump" doc comment the
   `homeLayout` field carries, state.ts:93-99), a deep-cloned entry in `defaults()` (state.ts:119),
   `servers: parseServersState(doc['servers'])` in the `JsonStore` `parse:` callback (state.ts:151),
   and `serversState()` / `setServersState()` beside `homeLayout()`/`setHomeLayout()`
   (state.ts:272-278).

## Deliverables

- **D1 — the persisted shape in the shared contract.**
  Files: `src/shared/modules/servers.ts` (extend; mirror `src/shared/modules/home.ts`'s
  `HomeLayout`/`DEFAULT_HOME_LAYOUT` block), `src/shared/modules/servers.test.ts` (extend).
  Adds the five entry/settings types, their zod schemas, `serversStateSchema` and
  `DEFAULT_SERVERS_STATE`. No installation id anywhere in any of them.
  Acceptance: `DEFAULT_SERVERS_STATE` parses clean through `serversStateSchema`; the schema's key
  set is exactly the five buckets; a value carrying `installationId` at any level does not survive
  the parse. Tests in `src/shared/modules/servers.test.ts`.

- **D2 — `parseServersState`, defensive at both levels.**
  Files: `src/main/lib/schemas.ts` (extend; mirror `parseHomeLayout` at schemas.ts:1128 and
  `parseConfigProfiles` at schemas.ts:947), `src/main/lib/schemas.test.ts` (extend; mirror the
  `describe('parseHomeLayout (story 086 D1)')` block at schemas.test.ts:939).
  Acceptance: a non-object / foreign / `undefined` value yields a fresh clone of
  `DEFAULT_SERVERS_STATE` without throwing; one malformed favourite and one malformed source are
  dropped while their siblings survive; an address that fails `parseServerAddress` is dropped; a
  garbage `scan.concurrency` falls back to its default leaving the other knobs intact; duplicates
  collapse to the first occurrence.

- **D3 — the key on `StateStore`.**
  Files: `src/main/services/state.ts` (extend; mirror the `homeLayout` field/defaults/parse/getter/
  setter quartet), `src/main/services/state.test.ts` (extend; mirror
  `describe('StateStore homeLayout (story 086 D1)')` at state.test.ts:87).
  Acceptance: `serversState()` starts at the safe empty default; `setServersState()` round-trips
  through `state.json` and touches no other key; a `state.json` written without the key loads to the
  same default; a corrupt `servers` value degrades without taking siblings down;
  `STATE_SCHEMA_VERSION` and the migration list are unchanged; `LauncherSettings` gained no field.

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- Review: → default — three additive files, no existing behaviour rewritten, no cross-module or
  regression surface; the whole story is one new top-level key following a precedent that already
  exists twice in the same files.

## Acceptance Tests

- AC1 → unit `src/main/services/state.test.ts` › "the servers key is its own top-level state key and
  LauncherSettings is untouched" (D3)
- AC2 → unit `src/shared/modules/servers.test.ts` › "the persisted servers state has a zod schema in
  the module's shared contract" (D1)
- AC3 → unit `src/main/lib/schemas.test.ts` › "a foreign servers value falls back to the safe empty
  default" and › "a malformed favourite and a malformed source are dropped, their siblings survive"
  (D2)
- AC4 → unit `src/main/services/state.test.ts` › "servers state round-trips through state.json and
  touches no other setting" (D3)
- AC5 → unit `src/main/services/state.test.ts` › "a state.json written without the servers key loads
  as the safe empty default, with no schema bump" (D3)
- AC6 → unit `src/shared/modules/servers.test.ts` › "no part of the persisted servers state accepts
  an installation id" (D1)
- AC7 → unit `src/main/lib/schemas.test.ts` › "a foreign servers value falls back to the safe empty
  default" + › "a malformed favourite and a malformed source are dropped, their siblings survive",
  and `src/main/services/state.test.ts` › "a state.json written without the servers key loads as the
  safe empty default, with no schema bump" (D2, D3)

No e2e line: this story adds no user-facing surface — see `## Decisions (Sprint)`. No manual residue.

## Done

A new module-owned, global (no `installationId` anywhere) top-level `servers` key was added to
`state.json` in three additive layers, mirroring the `homeLayout` (story 086 D1) precedent
throughout: (D1) `src/shared/modules/servers.ts` gained the persisted-shape types
(`ServerSourceEntry`/`FavouriteServerEntry`/`ManualServerEntry`/`ServerHistoryEntry`/
`ServersScanSettings`/`ServersState`), the `serversStateSchema` zod envelope and
`DEFAULT_SERVERS_STATE` (empty collections, provisional scan-budget defaults); (D2)
`parseServersState` in `src/main/lib/schemas.ts` gives it two-level defensiveness — an
envelope-level fallback to a fresh clone of `DEFAULT_SERVERS_STATE` when the raw value doesn't
parse at all, and a row-level drop (with address re-validation via `parseServerAddress`/
`formatServerAddress` and first-wins dedupe) for a malformed entry inside an otherwise-valid
collection; (D3) `src/main/services/state.ts` wires the key into `LauncherStateDocument`,
`defaults()`, the `JsonStore` parse callback and a `serversState()`/`setServersState()`
getter/setter pair, with no `STATE_SCHEMA_VERSION` bump, no migration entry and no
`LauncherSettings` change.

**Commit message:**
```
110: give the servers module its own state.json key
```

**Verification — narrow gate:**
- `npm run build` — clean.
- `npm run typecheck` (`typecheck:node` + `typecheck:web`) — clean.
- `npx vitest run --changed HEAD` (test-story) — 15 files, 834 tests, all passed; this includes
  `src/shared/modules/servers.test.ts`, `src/main/lib/schemas.test.ts` and
  `src/main/services/state.test.ts`.
- No e2e run: the story adds no user-facing surface (`## Decisions (Sprint)`), so `e2e-story`
  does not apply — every criterion is core-level and covered by `test`.
- Code review (clean agent, default tier per `## Model Hints`): **PASS**, no findings. Verified
  each AC individually, checked the named tests for tautology/mocking (none found — the
  row-drop test genuinely omits required fields, the corrupt-value test genuinely writes a
  broken `state.json` and checks sibling-key survival), checked for scope creep (none — diff
  confined to the six planned files) and CLAUDE.md guardrails (GB-P1/GB-P2 honoured, no
  installation id anywhere).

**AC → test mapping, as verified:**
- AC1 → `state.test.ts` › "the servers key is its own top-level state key and LauncherSettings is
  untouched" — passed.
- AC2 → `servers.test.ts` › "the persisted servers state has a zod schema in the module's shared
  contract" — passed.
- AC3 → `schemas.test.ts` › "a foreign servers value falls back to the safe empty default" and ›
  "a malformed favourite and a malformed source are dropped, their siblings survive" — passed.
- AC4 → `state.test.ts` › "servers state round-trips through state.json and touches no other
  setting" — passed.
- AC5 → `state.test.ts` › "a state.json written without the servers key loads as the safe empty
  default, with no schema bump" — passed.
- AC6 → `servers.test.ts` › "no part of the persisted servers state accepts an installation id" —
  passed.
- AC7 → the two AC3 tests plus the AC5 test above — passed.
- No manual residue.

**Decisions (build-time, within plan/AC bounds):**
- Provisional `scan` defaults picked as `concurrency: 8, timeoutMs: 2000, retries: 1,
  minSpacingMs: 50` — the story explicitly defers the real numbers to story 115; these are
  placeholders only, consistent with `DEFAULT_SERVERS_STATE` otherwise shipping empty
  collections.
- D2 re-validates addresses via `parseServerAddress` for all four address-bearing collections
  (sources included), a superset of the plan's explicit "the three address collections" wording
  — reviewed and accepted as a reasonable, non-defective extension of the same mechanism.
- Deliverables were implemented and reviewed sequentially by fresh agents (D1 → D2 → D3 → clean
  review), each reading only the files named in its own deliverable plus the precedent files
  the plan pointed at (`home.ts`, `parseHomeLayout`, `parseConfigProfiles`, `homeLayout()`/
  `setHomeLayout()`), per the plan's own bottom-up ordering.

Narrow gate only. The full regression gate (`npm test`, `npm run ui:verify`, `npm run
ui:flows`) has not run — run it before commit/merge, or use `/build 110 --full`. (This line is
carried for completeness; per this session's instructions the full gate is the sprint's
responsibility and runs once after the last story.)

**Post-hoc regression note (sprint/S23 regression gate):** `npm run ui:flow -- news-feed` was
reported failing deterministically on this branch and bisected to this story's commit
(`4f7135a`). Investigation (stack-trace instrumentation on `ManifestService.getManifest()`)
found the actual caller is `EngineUpdateAction.tsx`'s automatic, un-delayed
`engineUpdateStatus` fetch on mount (story 092 D7) — nothing this story touches. That fetch
reaches `engines/manifest.json`/`gamedata/manifest.json` on whatever host the UI harness's
shared `Q2L_UI_CONTENT_REPO_BASE` env var points at, which `news-feed.mjs`'s own fixture server
also uses; when the shared `populated` fixture `userData` directory already has an active
installation (left behind by an earlier flow such as `engine-update.mjs`, which sorts before
`news-feed` alphabetically in `npm run ui:flows`), the belated request lands after
`news-feed`'s phase-2 fixture server has been reset, and is misread as an unexpected request.
Reproduced identically on the merge-base commit (`38181e7`) given the same polluted fixture
directory, and conversely this story's own commit passes cleanly with a clean fixture directory
— so the bisect's attribution to `4f7135a` was a false positive from accumulated `.ui-verify`
fixture state, not a real regression in this story's diff. Fixed anyway, in source, on the
startup-scheduling side: `EngineUpdateAction.tsx` now holds its first automatic check back by a
3s startup grace window (mirroring `scheduleStartupCheck()`'s own precedent in
`src/main/index.ts`), so it can no longer race a short-lived flow's fixture teardown; later
checks (installation switch, job completion) remain immediate. `npm run ui:flow -- news-feed`
now passes both from a clean fixture directory and when the pollution scenario above is
deliberately reproduced.
