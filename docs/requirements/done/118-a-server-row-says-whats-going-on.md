---
id: 118
title: a server row says what's going on
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view (from [[106]]) and, for every server the scan ([[114]]) has found,
sees at a glance what is happening on it — without opening the detail view. That is the whole point
of a *list*: the busy server, the password-protected one, the favourite, the one whose last scan
went unanswered, and — the specific case the browser exists for — the duel server where one person
is sitting alone waiting for an opponent, all have to be readable from the row itself.

This story is the row and its markers only: what a row shows and when each marker lights up. It does
not decide the order servers appear in ([[119]]) or how the list is narrowed down ([[120]]); both of
those stories build on the row this one defines. It also does not decide the scan's own timing or
what data is available at which stage — that is [[114]]'s concern. This story only has to render
whatever data is present at any given moment, correctly, including the moment nothing has arrived
yet.

## Acceptance Criteria

- [x] **AC1** — A server row shows all five listed fields when known: name, mod, players/slots, map,
      and measured ping (GB-L1).
- [x] **AC2** — A password marker is shown on a row exactly when that server's `needpass` flag
      indicates a password is required, and is absent otherwise.
- [x] **AC3** — A gamemode marker is shown on a row, correctly derived from the server's
      `deathmatch`/`coop`/`ctf`/`teamplay` flags, once that data has been fetched for the server.
- [x] **AC4** — A favourite marker is shown on a row exactly when the server is marked as a
      favourite, regardless of what the scan has or has not fetched for it.
- [x] **AC5** — A stale marker is shown on a row exactly when the last scan attempt for that server
      timed out without an answer; the row keeps showing the server's previously known field values
      rather than blanking them.
- [x] **AC6** — A "waiting for an opponent" marker is shown on a row exactly when that server's known
      player count is exactly one, and is absent for zero, two or more players, or when the player
      count is not yet known.
- [x] **AC7** — A server for which no field has been fetched yet (freshly discovered, nothing scanned
      for it so far) renders a sane placeholder row — it does not appear blank, malformed or throw a
      render error.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **The derivations are pure and shared.** Gamemode, known player count and "waiting for an
  opponent" live in `src/shared/servers/row-markers.ts`, because [[119]] (gamemode tie-break), [[120]]
  (gamemode/waiting filters) and [[122]] (detail header) need exactly the same answers, and one
  function cannot drift from itself.
- **Gamemode is derived in main and stored on the entry.** `ServerListEntry` gains
  `gamemode?: ServerGamemode`, read from the serverinfo keys like `name`/`map` are, and kept from the
  previous reply when a reply lacks the flags. `info` replies usually carry no mode flags and only
  `status` does, so the previous value must survive an `info`-only refresh.
- **Gamemode rule:** if none of `deathmatch`/`coop`/`ctf`/`teamplay` parses as an integer, the mode
  is unknown and no marker shows. Otherwise a missing key counts as 0, and precedence is
  `ctf`≠0 → `ctf`; `deathmatch`≠0 and `teamplay`≠0 → `team`; `deathmatch`≠0 → `deathmatch`;
  `coop`≠0 → `coop`; else `single`. This mirrors the engine: deathmatch overrides coop, and CTF and
  teamplay are deathmatch variants.
- **`needpass` means bit 0.** Today's parser only accepts `'1'`/`'0'`. It becomes
  `(readIntKey(…,'needpass') & 1) === 1`, so `3` (password plus spectator password) shows the marker
  and `2` (spectator password only) does not. The concept §6.2 defines the field as a bitfield, and
  AC2 says "indicates a password is required".
- **Favourite is read live, not from `origins`.** `scan.read` decorates every row with
  `favourite: boolean`, computed from the current `favourites` list at read time. `origins` is only
  updated when a server replies, so it would still say "favourite" after a user un-favourites a server.
  That breaks AC4's "exactly when".
- **Placeholder rows exist only for addresses the user owns.** A favourite or manual server with no
  entry yet is synthesised in `scan.read` as `status: 'pending'`, with no fields and
  `lastSeenAt: null`. A master-only address still gets no row until it answers. 112 promises
  favourites are always there and 113 promises the same for manual servers. Listing every silent
  master address is a scan decision ([[114]]), not a row decision.
- **A user-owned server that never answered goes stale with no data.** `mergeStaleRound` creates a
  field-less `stale` entry (`lastSeenAt: null`) for a favourite/manual target with no previous entry
  and no reply. That way AC5's "last attempt timed out" is also true for a server we have never heard
  from, and a master-only target still gets no row.
- **Status union becomes `'online' | 'stale' | 'pending'` and `lastSeenAt` becomes `string | null`.**
  A placeholder has never been seen, and inventing a timestamp or reusing `online` would be a lie.
- **Unknown renders as "—", never as 0 or a guess.** A missing `gamename` shows "—", not `baseq2`,
  and an unknown player count shows "—/16", never "0/16". This follows GB-N6 ("never shown as zero
  players") and the parsers' own "never invent a value" rule.
- **The waiting marker follows the known count, stale or not.** AC6 says "known player count is
  exactly one". A stale row that last reported one player keeps the marker, next to the stale marker
  that says the data is old.
- **Markers are icon plus visible text, not colour alone.** Each marker is a `Badge` with a lucide
  icon and an i18n label (`servers.row.*`, gamemode labels under `servers.gamemode.*`), following the
  design-tokens rule that status is never colour-only. The design-tokens rule also rules out image
  assets.
- **The row keeps the 44px floor.** It stays one full-width selectable button (`min-h-11`), so no new
  CLAUDE.md deviation row is needed. Density can be revisited when the list grows columns.
- **Rows still refresh at round end.** Per-row streaming updates and the loading/empty/error states
  are [[121]]'s job. This story only renders what `scan.read` holds.
- **Testids stay stable.** `servers-row-<address>` and `servers-row-stale-<address>` keep their names,
  because the flows from 116/117 depend on them. Each new marker gets
  `servers-row-<marker>-<address>`.
- **No `ui:verify` registry entry here.** The list's registry screens (loading/empty/error/populated)
  are [[121]]'s acceptance criteria.

## Plan

Builds on [[114]]'s `ScanService`/`ServerListEntry` and 116/117's view. Order: shared → main → renderer.

1. **Shared (D1):** add `row-markers.ts` (pure): `deriveGamemode(serverinfo)`,
   `knownPlayerCount(entry)`, `isWaitingForOpponent(entry)`. Update the contract: `ServerGamemode`,
   `ServerListEntry.gamemode?`, status `'pending'`, `lastSeenAt: string | null`,
   `ServerListRow = ServerListEntry & { favourite: boolean }`, `ScanSnapshot.entries: ServerListRow[]`.
2. **Main (D2):** `readServerInfoFields` reads gamemode and uses the bit-0 `needpass` rule.
   `mergeStaleRound` creates a field-less stale entry for favourite/manual targets. `read()`
   decorates `favourite` from live state and appends `pending` placeholders for favourites/manual
   servers that have no entry.
3. **Renderer (D3):** a `ServerRow.tsx` component that renders the five fields plus five markers and
   the placeholder. `ServersView.tsx` maps rows through it, `en.json` gets the keys, and a component
   test plus one e2e flow against loopback responders prove it on the real surface.

Out of scope: order ([[119]]), filters ([[120]]), list states and streaming ([[121]]), detail
([[122]]), a favourite toggle in the list.

## Deliverables

- [x] **D1 — row derivations and the contract (shared).**
  - Create `src/shared/servers/row-markers.ts` with a colocated `row-markers.test.ts`.
    - `export type ServerGamemode = 'ctf' | 'team' | 'deathmatch' | 'coop' | 'single'`.
    - `deriveGamemode(serverinfo: Record<string,string>): ServerGamemode | undefined`. Read each of
      `deathmatch`/`coop`/`ctf`/`teamplay` with `readIntKey` (`src/shared/servers/infostring.ts`).
      If none parses, return `undefined`. Otherwise a missing key is 0, and precedence is: `ctf`≠0 →
      `'ctf'`; `deathmatch`≠0 and `teamplay`≠0 → `'team'`; `deathmatch`≠0 → `'deathmatch'`;
      `coop`≠0 → `'coop'`; else `'single'`.
    - `knownPlayerCount(entry: Pick<ServerListEntry,'players'>): number | undefined`. Use the
      array's `length` if `players` is an array, the number if it is a number, else `undefined`.
    - `isWaitingForOpponent(entry)` is `knownPlayerCount(entry) === 1`.
  - In `src/shared/modules/servers.ts`:
    - Re-export `ServerGamemode`.
    - Add `gamemode?: ServerGamemode` to `ServerListEntry`.
    - Widen `status` to `'online' | 'stale' | 'pending'` and `lastSeenAt` to `string | null`, and
      update its doc comment.
    - Add `export type ServerListRow = ServerListEntry & { favourite: boolean }` and make
      `ScanSnapshot.entries: ServerListRow[]`.
  - Files: `src/shared/servers/row-markers.ts` (+ test), `src/shared/modules/servers.ts`.
  - Mirror: `src/shared/servers/infostring.ts` for the pure-helper-plus-colocated-test shape.
  - Tests (`row-markers.test.ts`):
    - "derives each gamemode from its flags" covers each precedence case, including dm+teamplay →
      team and ctf winning over deathmatch.
    - "no mode flag at all means unknown" covers `{}` and non-integer values → `undefined`.
    - "waiting for an opponent is exactly one known player" covers 0, 1, 2, a one-element roster, a
      count of 1, and `players` undefined → false.
  - Acceptance: `npx vitest run src/shared/servers/row-markers.test.ts` passes and
    `npm run typecheck` is clean. Fix the typing fallout of the widened `lastSeenAt`/`status` in
    existing tests.

- [x] **D2 — main fills what the row needs.**
  - In `src/main/modules/servers/scan-service.ts`:
    - `readServerInfoFields` also returns `gamemode: deriveGamemode(serverinfo) ?? existing?.gamemode`.
    - `needpass` becomes `const n = readIntKey(serverinfo,'needpass')`, then
      `n === undefined ? existing?.needpass : (n & 1) === 1`. This way `3` → true, `2` → false, and
      an absent key keeps the previous value.
    - `read()` returns `entries` mapped to
      `{ ...entry, favourite: favourites.some(f => f.address === entry.address) }`, using
      `getServersState()` at read time. It then appends, for every favourite or manual address with
      no entry, a placeholder
      `{ address, origins: [...'favourite' if fav, ...'manual' if manual], status: 'pending', lastSeenAt: null, favourite }`.
      Deduplicate an address that is both favourite and manual.
  - In `src/main/modules/servers/scan-merge.ts`, `mergeStaleRound` handles a target with no
    previous entry and no reply this round. If its `origins` include `'favourite'` or `'manual'`, it
    gets `{ address, origins, status: 'stale', lastSeenAt: null }`. A source-only target still gets
    no row. Update the file's doc comment.
  - Files: `scan-service.ts`, `scan-service.test.ts`, `scan-merge.ts`, `scan-merge.test.ts` (all
    under `src/main/modules/servers/`).
  - Mirror: the existing `scan-service.test.ts` fake-`queryServer` tests.
  - Tests:
    - `scan-service.test.ts` › "needpass bit 0 decides the password flag" covers `1`/`3` → true and
      `0`/`2` → false.
    - `scan-service.test.ts` › "a status reply's mode flags become the entry's gamemode and survive
      an info-only reply".
    - `scan-service.test.ts` › "read marks favourite from the live favourites list" removes a
      favourite from the state and checks that the next `read()` says `false`.
    - `scan-service.test.ts` › "read lists a never-answered favourite or manual server as a pending
      placeholder, and no master-only address".
    - `scan-merge.test.ts` › "a silent favourite/manual target with no entry becomes a field-less
      stale row; a silent source-only target gets none".
  - Acceptance: `npx vitest run src/main/modules/servers` passes.

- [x] **D3 — the row, on the real surface.**
  - Create `src/renderer/src/modules/servers/ServerRow.tsx`, taking a `ServerListRow` plus
    `selected`/`onSelect`. It renders a full-width `<button aria-pressed>` with `min-h-11` and
    semantic tokens only.
    - Fields: name (the address in muted text under it; the address alone as the name when `name` is
      unknown), mod, players/slots as `${knownPlayerCount ?? '—'}/${maxclients ?? '—'}`, map, and
      ping as `${rttMs} ms`. Every unknown value is `—`.
    - Markers: each is a `Badge` (`components/ui/primitives.tsx`) with a lucide icon plus visible
      i18n text, and a testid of the form `servers-row-<marker>-<address>`:
      - password `lock`, when `needpass === true`
      - gamemode, when `gamemode !== undefined`, with label `servers.gamemode.<mode>`
      - favourite `star`, when `row.favourite`
      - stale, keeping the existing testid `servers-row-stale-<address>` and key `servers.row.stale`,
        when `status === 'stale'`
      - waiting `user` with label `servers.row.waiting` ("Waiting for an opponent"), via
        `isWaitingForOpponent`
      - pending, label `servers.row.pending` ("Not scanned yet"), when `status === 'pending'`
  - In `ServersView.tsx`, replace the inline row markup with `<ServerRow>` and keep the
    `servers-row-<address>` testid and the selection toggle.
  - In `src/renderer/src/i18n/locales/en.json`, add the new keys to the top-level `servers` block
    (`row.*`, `gamemode.*`).
  - Tests:
    - `ServerRow.test.tsx`: one test per AC1/AC2/AC3/AC4/AC5/AC6/AC7 case, listed under
      Acceptance Tests.
    - Update `ServersView.test.tsx` for the new row.
    - `scripts/flows/servers-row-markers.mjs` (flow name `servers-row-markers`):
      - Fixture: every master source disabled (`SERVERS_DISABLED_SOURCES`) and the scan autos off.
        Four loopback `dgram` responders run as manual servers:
        - A: a favourite with `needpass 1`, `deathmatch 1 ctf 1` and 1 player.
        - B: `deathmatch 1`, no password, 2 players.
        - C: 0 players.
        - D: answers in round 1 and is closed before round 2.
      - A fifth manual address has no responder.
      - Before any scan: the fifth row renders with the pending marker and dashes, and so does A
        (favourite marker present) (AC4, AC7).
      - After "Refresh servers": check the five fields on B (AC1), password on A only (AC2), ctf on
        A and deathmatch on B (AC3), favourite on A only (AC4), waiting on A only (AC6).
      - Close D and refresh again: D shows stale and still shows its hostname/map (AC5). The fifth
        address shows stale with dashes.
      - Take screenshots per phase.
  - Files: `ServerRow.tsx`, `ServerRow.test.tsx`, `ServersView.tsx`, `ServersView.test.tsx`,
    `en.json`, `scripts/flows/servers-row-markers.mjs`.
  - Mirror: `MasterSourceRow.tsx` (a row component, i18n and testids) and
    `scripts/flows/servers-scoped-refresh.mjs` (`bindResponder`, fixture seeding and the
    `waitForFinishedAtChange` pattern, copied, not imported).
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes and
    `npm run ui:flow -- servers-row-markers` passes with its screenshots.

## Model Hints

- D1, D2, D3 → default tier. D1 is a pure helper plus type widening. D2 is three bounded edits, each
  pinned by a named unit test. D3 is one component and one flow on the 117 pattern.
- Review: → default. The plausible wrong implementation is deriving `favourite` from `origins`.
  D2's named "live favourites list" test catches it, so a second hard pass buys nothing here.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (server B's row
  shows name, mod, players/slots, map and ping). Also unit
  `src/renderer/src/modules/servers/ServerRow.test.tsx` › "shows name, mod, players/slots, map and
  ping when known" (D3).
- AC2 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (the password
  marker is on A only). Also unit `src/main/modules/servers/scan-service.test.ts` › "needpass bit 0
  decides the password flag" (D2), and `ServerRow.test.tsx` › "password marker exactly when
  needpass is true" (D3).
- AC3 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (ctf on A,
  deathmatch on B). Also unit `src/shared/servers/row-markers.test.ts` › "derives each gamemode from
  its flags" and › "no mode flag at all means unknown" (D1), plus `scan-service.test.ts` › "a status
  reply's mode flags become the entry's gamemode and survive an info-only reply" (D2).
- AC4 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (the favourite
  marker is on A both before any scan and after, and on no other row). Also unit
  `scan-service.test.ts` › "read marks favourite from the live favourites list" (D2), and
  `ServerRow.test.tsx` › "favourite marker on a placeholder row" (D3).
- AC5 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (D goes stale after
  its responder closes and keeps hostname/map). Also unit `scan-merge.test.ts` › "a silent
  favourite/manual target with no entry becomes a field-less stale row; a silent source-only target
  gets none" (D2), and `ServerRow.test.tsx` › "stale row keeps its last known values" (D3).
- AC6 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (the waiting marker
  is on A (1 player) only, not on B (2) or C (0)). Also unit `row-markers.test.ts` › "waiting for an
  opponent is exactly one known player" (D1), which covers the unknown-count case.
- AC7 → e2e `scripts/flows/servers-row-markers.mjs` › flow "servers-row-markers" (the fifth,
  never-answering manual address renders a pending row with dashes before the scan, and a stale row
  with dashes after it, with no render error). Also unit `ServerRow.test.tsx` › "a field-less
  pending row renders the address, dashes and the pending marker" (D3), and `scan-service.test.ts` ›
  "read lists a never-answered favourite or manual server as a pending placeholder, and no
  master-only address" (D2).

No `manual residue`.

## Done

Implemented the shared gamemode/waiting derivations, the main-process favourite/pending/stale
row-building, and the renderer `ServerRow` component with its markers, i18n keys and an e2e flow.
All three deliverables landed as planned, no deviations from the Decisions.

Commit message: `118: a server row says what's going on`

Verification — narrow gate: `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (92 files / 1518 tests), `npm run ui:flow -- servers-row-markers`
green (3 screenshots, no render errors). AC → test mapping verified: AC1–AC7 each confirmed via
their named e2e assertions in `servers-row-markers` plus their unit tests in
`row-markers.test.ts`, `scan-service.test.ts`, `scan-merge.test.ts` and `ServerRow.test.tsx` — all
present and passing, none missing from the run. No `manual residue`. Review: default-tier clean
agent, verdict PASS, no findings — no fix cycle needed.

tiers: D 3 / hard 0 · review default · cycles 0 · agents 5

## Decisions (Sprint continued)

- No deviations from plan during build.
