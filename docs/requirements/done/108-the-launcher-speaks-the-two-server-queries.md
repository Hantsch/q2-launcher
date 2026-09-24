---
id: 108
title: the launcher speaks the two server queries
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Once the launcher knows a server's address, it has to be able to ask that server two things: a
cheap "what are you" ([[107]] validates the address that makes this safe to do at all) and a full
"who is playing". The concept calls these the `info` and `status` queries (§6.1) and treats them as
the two building blocks every later part of the game browser is built from — the list's stage-1
sweep, the detail view's player list and rule table, and the watchlist's matching all read the
output of these two codecs, not the network directly.

This story delivers the protocol layer only: building the two query datagrams, and parsing their
replies into typed results. It does not scan anything, does not talk to a real socket in its tests,
and has no UI — it is the pure core the scan scheduler (a later sprint) drives. Per the concept's
tech decisions (§4 "Tests") and integration notes (§16 "Tests"), the codecs are unit-tested pure
modules with no live network involved.

The protocol is unforgiving about missing data: every serverinfo key is optional (§6.2), a `status`
reply can be truncated by MTU limits on a busy server (§6.4), and player names can carry arbitrary
bytes including Quake II's high-bit "green" character set (§6.3). This story's parser has to survive
all three without throwing, because everything built on top of it — GB-D6's "a missing or malformed
key never breaks the view" — depends on the parser degrading per field instead of failing the whole
reply.

## Acceptance Criteria

- [x] **AC1** — A function builds the `info <protocol>` query datagram and a function builds the
      `status` query datagram, both prefixed with the four `FF FF FF FF` connectionless bytes per
      §6.1, and both are pure (no socket, return a `Buffer`/`Uint8Array`).
- [x] **AC2** — A well-formed `info` reply (the short infostring shape in §6.1) parses into a typed
      result carrying hostname, map, current clients and maxclients.
- [x] **AC3** — A well-formed `status` reply (the `print` + serverinfo line + player lines shape in
      §6.1) parses into a typed result carrying the full serverinfo key/value map and a player list,
      each player with score, ping and name only (§6.3).
- [x] **AC4** — The serverinfo infostring splitter treats every key as optional: a reply missing
      `gamename`, `version`, or any other key from the §6.2 table produces a result with that field
      absent, not a thrown error and not a default value presented as if it were reported.
- [x] **AC5** — A player line is parsed into score/ping/name with no assumption about name content —
      arbitrary bytes and high-bit "green" characters in a name survive the parse without throwing and
      without being interpreted as field separators.
- [x] **AC6** — A truncated or malformed reply (cut short mid-line, missing the trailing player
      section, or otherwise not matching the expected shape) is surfaced as a distinguishable
      "no data this round" outcome, never coerced into a zero-player or empty-fields result that looks
      like a legitimate reply (§6.4, GB-N6's "never shown as zero players" applied at the parser level).
- [x] **AC7** — Every codec in this story is a pure, unit-tested module with no `node:dgram` import
      and no socket creation in its tests (GB-A6); a test suite exercises AC2–AC6 against fixed byte
      fixtures, not a live server.

## Open Questions

- [x] ~~**Q1 — Display and watchlist-matching of non-ASCII/high-bit player names.** This story only
      guarantees the parser does not crash on such names and preserves their bytes (AC5). How they are
      *decoded for display* (the "green" character mapping) and how a watchlist entry's match mode
      (exact/substring/regex, §12) applies to them is concept open point #10, explicitly deferred to
      the watchlist sprint — it is a display/matching decision, not a parsing one, and does not block
      this story.~~ settled by the story text itself → out of scope here, see Decisions (Sprint).

## Decisions (Sprint)

- **Q1 stays out of scope** — the story text already defers display/watchlist decoding of high-bit
  names to the watchlist sprint (concept open point #10); this story only owes AC5's "does not
  throw, does not split on those bytes, preserves them losslessly".
- **Home is `src/shared/servers/` (`protocol.ts`, `infostring.ts`, `info-reply.ts`,
  `status-reply.ts`), beside [[107]]'s `address.ts`** — same folder for the same reason 107 chose it
  (pure cross-process logic lives next to, not inside, the module's IPC contract), and
  `src/shared`'s standing "no `node:*`, no DOM, no electron" rule (docs/ARCHITECTURE.md) makes AC7's
  "no `node:dgram` import" structurally true instead of a promise one test has to police alone.
- **Bytes are `Uint8Array`, never `Buffer`** — AC1 allows either, but `Buffer` is a `node:` type
  `src/shared` forbids (the rule `q2-charset.ts` and `alt-layers.ts` already state in their file
  docs), and the main-side socket seam can still pass a `Buffer` straight in, since it *is* a
  `Uint8Array`.
- **A local lossless latin-1 pair (`decodeLatin1`/`encodeLatin1`) does all byte↔string work** — byte
  value equals code unit, so every byte including the high-bit "green" range round-trips exactly
  (AC5), where `TextDecoder('utf-8')` would destroy them as replacement characters and
  `windows-1252` would silently remap `0x80`–`0x9F`; `src/shared/config/q2-charset.ts` deliberately
  left this pair out of scope, so this story supplies it.
- **One shared failure vocabulary, `ServerReplyFailure`, with six reason codes** (`too-short`,
  `not-connectionless`, `unexpected-command`, `truncated`, `malformed-infostring`,
  `malformed-player-line`), returned as `{ ok: false, reason }` against `{ ok: true, … }` — the same
  discriminated-union-with-a-reason-code shape [[107]] fixed for addresses, so both codecs in the
  `servers` folder speak one result vocabulary and AC6's "distinguishable outcome" is a value, not a
  thrown error.
- **No i18n keys for reply failures in this story** (unlike 107's `servers.address.reject.*`) — an
  address rejection is something a user typed and can fix, whereas a reply failure is a per-round
  network diagnostic with no surface yet; 9.2's list state ("stale", GB-N6) decides what, if
  anything, is ever shown.
- **Both queries are `FF FF FF FF` + ASCII command + `\n`** — §6.1 writes `status\n`, and sending
  `info <protocol>` the same way matches how every engine's connectionless tokenizer terminates the
  command line; the prefix lives in one exported constant both builders use.
- **`buildInfoQuery(protocol)` throws a `RangeError` on a non-integer or out-of-1–255 protocol** —
  that argument is our own code's, not foreign data, so failing loudly beats emitting a datagram no
  server answers; only *inbound* bytes get the never-throw treatment.
- **The infostring splitter is tolerant and reports only what was sent** — leading/trailing
  backslashes ignored, an empty value kept as `''`, a dangling final key dropped, a duplicate key
  won by its last occurrence; the result is a plain `Record<string, string>` holding exactly the
  reported keys, so AC4's "absent, not defaulted" is the data shape rather than a rule to remember.
- **Typed accessors never invent a value** — `hostname`/`map`/`clients`/`maxClients` on the `info`
  result are optional, and a numeric key whose value is not a decimal integer is reported as
  *absent* while its raw string stays in the serverinfo record, because a coerced `0` is exactly the
  "default presented as if it were reported" AC4 forbids.
- **A status reply's player section is all-or-nothing: truncation anywhere fails the whole reply
  with `truncated`** — a partially parsed player list is indistinguishable downstream from a
  complete one and would make the watchlist report a present player as gone, which is GB-N6's
  failure mode; stage 1's `info` already carries the list row, so nothing of value is lost.
- **Truncation is detected structurally, not by requiring a trailing newline** — an opening quote
  with no closing quote on the last line, a line with fewer than three fields, or a serverinfo line
  ending in a dangling key with no following newline are the truncation signals; many healthy
  servers omit the final newline, so demanding one would mark most real replies broken.
- **A player line is `score ping <rest-of-line>`: two leading whitespace-separated integer fields,
  then the name taken verbatim** — if the rest starts with `"` and ends with `"`, exactly those two
  outer quotes are stripped (the last quote wins), otherwise the rest is taken as-is, so an embedded
  quote, a space, a backslash or a high-bit byte inside a name is never treated as a separator
  (AC5); a non-integer score or ping is `malformed-player-line`, not a silent `0`.
- **An empty player section is a legitimate `players: []`** — only a *failed* parse means "no data
  this round", so the distinction AC6 asks for is precisely `{ ok: true, players: [] }` versus
  `{ ok: false, reason: 'truncated' }`.
- **Fixtures are byte literals in `src/shared/servers/reply-fixtures.ts`** — shared by the `info`
  and `status` suites, following `src/shared/config/profile-fixtures.ts`; no fixture is captured
  from a live server (GB-A5).
- **No IPC channel, no zod schema, no main or renderer code** — this story's output is consumed
  in-process by 9.2's scheduler, so `src/shared/ipc.ts`, `src/shared/modules/servers.ts` and the
  preload allowlist stay untouched; contract-first bites when a handler appears, not before.
- **No e2e flow** — every criterion is pure core behaviour with no user action and no surface, so
  `ui-acceptance-required` does not bite and the unit suite is the acceptance gate (same reasoning
  as [[107]]).
- **No platform delta to declare** — a byte parser behaves identically on Windows and Linux, so
  there is no control to disable and no "Not available on …" text to write.

## Plan

1. **D1 — the protocol floor.** New `src/shared/servers/protocol.ts`: `OOB_PREFIX`
   (`FF FF FF FF`), `decodeLatin1`/`encodeLatin1`, the `ServerReplyFailure` reason union and the
   result helper types, `readConnectionlessReply(bytes, expectedCommand)` (prefix check, command
   token, body split), `buildInfoQuery(protocol)` and `buildStatusQuery()`. Test `protocol.test.ts`,
   including the AC7 purity sweep over every `.ts` in `src/shared/servers/`.
2. **D2 — the infostring splitter.** New `src/shared/servers/infostring.ts`:
   `splitInfostring(line) -> Record<string, string>` with the tolerance rules above, plus
   `readIntKey(info, key)` as the never-invent numeric accessor. Table-driven test
   `infostring.test.ts` (mirror `config/command-tokenizer.test.ts`).
3. **D3 — the `info` reply parser.** New `src/shared/servers/info-reply.ts`: `parseInfoReply(bytes)`
   → `{ ok: true, serverinfo, hostname?, map?, clients?, maxClients? }` or a failure reason. Creates
   `src/shared/servers/reply-fixtures.ts`. Test `info-reply.test.ts`.
4. **D4 — the `status` reply parser.** New `src/shared/servers/status-reply.ts`:
   `parseStatusReply(bytes)` → `{ ok: true, serverinfo, players }` with
   `ServerPlayer { score, ping, name }`, or a failure reason; carries the truncation detection and
   the verbatim-name rule. Extends `reply-fixtures.ts`. Test `status-reply.test.ts`.

Affected files (all new, except the fixture file D4 extends): `src/shared/servers/protocol.ts`,
`infostring.ts`, `info-reply.ts`, `status-reply.ts`, `reply-fixtures.ts` and their four `.test.ts`
siblings. No main, preload or renderer code, no IPC channel, no shell edit, no `en.json` entry.

## Deliverables

- **D1 — the connectionless envelope, the latin-1 pair and the two query builders.**
  Files: `src/shared/servers/protocol.ts` (new), `src/shared/servers/protocol.test.ts` (new).
  Mirror: `src/shared/config/q2-charset.ts` (pure byte-level shared module with the explicit "no
  `Buffer`" file doc) and [[107]]'s `src/shared/servers/address.ts` (ok/reason discriminated union).
  Acceptance: `buildStatusQuery()` and `buildInfoQuery(34)` return `Uint8Array`s starting
  `FF FF FF FF`, ending `\n`, with the expected ASCII command between; `buildInfoQuery` throws
  `RangeError` for `0`, `256` and `34.5`; `decodeLatin1`/`encodeLatin1` round-trip all 256 byte
  values; `readConnectionlessReply` returns `too-short`, `not-connectionless` and
  `unexpected-command` for the three broken envelopes and the body for a good one; the test asserts
  no file in `src/shared/servers/` imports `node:*`, `electron` or the IPC layer.
- **D2 — the tolerant serverinfo splitter.**
  Files: `src/shared/servers/infostring.ts` (new), `src/shared/servers/infostring.test.ts` (new).
  Mirror: `src/shared/config/command-tokenizer.ts` and its table-driven test.
  Acceptance: `splitInfostring` handles leading/trailing backslash, empty value, dangling final key,
  duplicate key (last wins) and an empty line; the returned record holds exactly the reported keys —
  a `gamename`-less, `version`-less reply yields a record without those properties — and
  `readIntKey` returns `undefined`, never `0`, for a missing or non-integer value.
- **D3 — the `info` reply parser, with the shared fixtures.**
  Files: `src/shared/servers/info-reply.ts` (new), `src/shared/servers/reply-fixtures.ts` (new),
  `src/shared/servers/info-reply.test.ts` (new).
  Mirror: `src/shared/config/profile-fixtures.ts` (fixture module beside the code it feeds).
  Acceptance: a well-formed `info` reply fixture parses to hostname, map, clients and maxClients
  plus the raw serverinfo record; an empty or unparseable infostring returns `malformed-infostring`;
  a reply whose command is `status` returns `unexpected-command`; a non-numeric `maxclients` leaves
  `maxClients` undefined while its raw string stays in `serverinfo`.
- **D4 — the `status` reply parser: serverinfo plus the player list.**
  Files: `src/shared/servers/status-reply.ts` (new), `src/shared/servers/status-reply.test.ts`
  (new), `src/shared/servers/reply-fixtures.ts` (extend).
  Mirror: D3's parser shape and D1's result union.
  Acceptance: the §6.1 sample reply parses to the full serverinfo record and two players carrying
  score, ping and name and no other field; a name with high-bit bytes, a space, an embedded quote
  and a backslash survives byte-identically (`encodeLatin1(name)` equals the fixture slice); a reply
  with no player lines yields `{ ok: true, players: [] }`; a reply cut mid-player-line, one with an
  unterminated quoted name and one cut mid-serverinfo each return `truncated`; a player line with a
  non-numeric ping returns `malformed-player-line`.

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- D4 → **deliverable-hard** — the truncation rules decide whether a busy server ever shows up as
  "zero players" (GB-N6's named failure mode) and have to coexist with a verbatim, byte-lossless
  name rule that must never be mistaken for a field separator; either half subtly wrong yields a
  parser that passes naive tests and lies in production.
- Review: → default — four new pure files in a new folder, no existing behaviour touched, no process
  boundary and no UI, so there is nothing here for a review to regress against.

## Acceptance Tests

- AC1 → D1, unit `src/shared/servers/protocol.test.ts` › "builds both query datagrams with the
  connectionless prefix"
- AC2 → D3, unit `src/shared/servers/info-reply.test.ts` › "parses a well-formed info reply into
  hostname, map, clients and maxclients"
- AC3 → D4, unit `src/shared/servers/status-reply.test.ts` › "parses a status reply into serverinfo
  and a player list of score, ping and name"
- AC4 → D2 + D3, unit `src/shared/servers/infostring.test.ts` › "every serverinfo key is optional and
  nothing is defaulted", plus unit `src/shared/servers/info-reply.test.ts` › "a non-numeric numeric
  key is absent, not zero"
- AC5 → D4, unit `src/shared/servers/status-reply.test.ts` › "a player name survives arbitrary and
  high-bit bytes byte-identically"
- AC6 → D1 + D3 + D4, unit `src/shared/servers/status-reply.test.ts` › "a truncated or malformed
  reply is a failure, never zero players", plus unit `src/shared/servers/protocol.test.ts` › "a
  broken envelope is rejected with its own reason"
- AC7 → D1, unit `src/shared/servers/protocol.test.ts` › "no codec in the servers folder imports
  node, electron or the IPC layer" — together with the fixture-driven suites named above, none of
  which creates a socket.

No criterion in this story describes a user action — the story has no surface and no IPC channel of
its own — so nothing maps to the `e2e` gate and there is no manual residue.

## Done

Implemented the two Quake II connectionless query builders and their reply parsers as four pure
`src/shared/servers/` modules (protocol envelope, infostring splitter, `info`-reply parser,
`status`-reply parser), each with a table-driven unit suite against hand-built byte fixtures — no
socket, no `node:dgram`, no live server, per D1–D4 of the Plan.

**Commit message:** `108: speak the info and status server queries`

**Changed/created files:**
- `src/shared/servers/protocol.ts`, `protocol.test.ts` (new)
- `src/shared/servers/infostring.ts`, `infostring.test.ts` (new)
- `src/shared/servers/info-reply.ts`, `info-reply.test.ts` (new)
- `src/shared/servers/status-reply.ts`, `status-reply.test.ts` (new)
- `src/shared/servers/reply-fixtures.ts` (new, created by D3, extended by D4)
- `tsconfig.web.json` (excluded `protocol.test.ts`, mirroring the existing `address.test.ts`
  entry — the purity-sweep test needs `node:fs`/`node:path`/`node:url` types, typechecked instead
  under `tsconfig.node.json`)
- `docs/requirements/108-the-launcher-speaks-the-two-server-queries.md` (this file — status,
  AC checkboxes, Done)

**Verification — narrow gate:**
- `npm run build` → green.
- `npm run typecheck` → green (both `tsconfig.node.json` and `tsconfig.web.json`).
- `test-story` (`npx vitest run --changed HEAD`) → 4 files, 18 tests passed (the four new suites
  this story added; `address.test.ts` from story 107 is unchanged and correctly excluded by the
  changed-files filter). A full sweep of the folder (`npx vitest run src/shared/servers/`) also
  passed: 5 files, 42 tests, confirming story 107's `address.test.ts` was not disturbed.
- `e2e-story` — skipped. The story's own Plan/Decisions confirm no user-facing surface exists
  (pure core module, no IPC, no UI); re-confirmed true at build time.
- Clean-agent review (default tier, per `Review: → default`): verdict **PASS**, no findings.

**AC → test mapping, as verified:**
- AC1 → `protocol.test.ts` › "builds both query datagrams with the connectionless prefix" — passed.
- AC2 → `info-reply.test.ts` › "parses a well-formed info reply into hostname, map, clients and
  maxclients" — passed.
- AC3 → `status-reply.test.ts` › "parses a status reply into serverinfo and a player list of
  score, ping and name" — passed.
- AC4 → `infostring.test.ts` › "every serverinfo key is optional and nothing is defaulted", plus
  `info-reply.test.ts` › "a non-numeric maxclients leaves maxClients undefined while the raw
  string survives" — both passed.
- AC5 → `status-reply.test.ts` › "a player name survives arbitrary and high-bit bytes
  byte-identically" — passed.
- AC6 → `status-reply.test.ts` › "a truncated or malformed reply is a failure, never zero
  players", plus `protocol.test.ts` › "a broken envelope is rejected with its own reason" —
  both passed.
- AC7 → `protocol.test.ts` › "no codec in the servers folder imports node, electron or the IPC
  layer" (a live `readdirSync` sweep over the folder, so it stays correct as files were added by
  D2–D4), together with the fixture-driven suites above, none of which creates a socket — passed.
- No `manual residue`: every criterion is pure core behaviour with an automated test.

**Decisions (Build):**
- A late-discovered gap in D4's own delegation brief mapped "cut mid-serverinfo" to
  `malformed-infostring`, but the story's Decisions section and D4's own acceptance text both call
  for `truncated` there (a serverinfo line ending in a dangling key with no following newline is a
  truncation signal, distinct from "nothing arrived at all"). Fixed directly in
  `status-reply.ts` (added a `hasDanglingKey` check ahead of the malformed-infostring check) and in
  `status-reply.test.ts` (split the one mixed test case into two: a genuine dangling-key fixture
  now asserts `truncated`, and a fully-empty-first-line fixture asserts `malformed-infostring`).
  Re-verified with the full `src/shared/servers/` suite (42/42 green) and the clean review, which
  independently traced both branches against their fixtures and confirmed they land on genuinely
  different code paths.
- No other deviations from the Plan/Deliverables.

**Gate note:** Narrow gate only (`npm run build`, `npm run typecheck`,
`npx vitest run --changed HEAD`). The full regression gate (`npm test`, `npm run ui:verify`,
`npm run ui:flows`) has not run in this story — it runs once for the whole sprint.
