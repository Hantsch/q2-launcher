---
id: 109
title: master sources return an address set
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Before the launcher can ask any server anything (the two queries [[108]] speaks), it needs to know
which servers exist. The concept describes two source types for that (§6.5, GB-S2): a UDP master
that answers `query` with packed address records, and an HTTP list (q2servers.com's `?raw=1`/`?raw=2`
endpoints) that returns the same information as text or a binary blob over HTTPS. Both are, for the
purposes of this story, just codecs: given bytes back from a source, produce the set of addresses it
reported.

This story delivers those two codecs only — no scheduling, no scan orchestration, no settings UI for
editing the source list (that is GB-S1/GB-S3, later). It matters as its own foundation story because
both codecs are pure and unit-testable the same way [[108]]'s query codecs are, and because the HTTP
side reuses the same main-side fetch approach the news feed already uses in this codebase (concept
§4 "HTTP master source" row) rather than inventing a second network layer — the `FetchImpl` seam in
`src/main/modules/downloads/fetcher.ts` is the precedent to follow: an injectable transport function
so a test can point the codec at a local stub instead of a real host.

The UDP master reply has a genuine unresolved shape, called out by the concept itself (§6.5, open
point #2): the reply can arrive as several datagrams, and there is no explicit terminator — a client
has to decide for itself when the reply is "done" (a quiet period, an expected count, or a hard cap).
That decision is left open below rather than guessed at, because guessing it here would silently
become the de facto answer for the scan scheduler that depends on it later.

## Acceptance Criteria

- [x] **AC1** — A function unpacks a UDP master reply payload (the `\xFF\xFF\xFF\xFFservers ` header
      followed by packed 4-byte-IPv4 + 2-byte-big-endian-port records, per §6.5) into a list of
      addresses, and is pure (accepts a `Buffer`, returns data — no socket).
- [x] **AC2** — A function assembles multiple UDP reply datagrams belonging to the same query into
      one combined address set, with no duplicate addresses in the result even if a record repeats
      across datagrams.
- [x] **AC3** — A function parses the HTTP list's `?raw=1` (text) shape into an address list.
- [x] **AC4** — A function parses the HTTP list's `?raw=2` (binary) shape into an address list.
- [x] **AC5** — A genuinely malformed or truncated UDP or HTTP payload (cut mid-record, wrong header,
      empty body) does not throw uncaught and does not produce a spurious address — it is surfaced as
      an explicit parse failure the caller can report as a failing source per GB-S3, without aborting
      anything else.
- [x] **AC6** — Both the UDP transport and the HTTP transport sit behind an injectable seam (mirroring
      `FetchImpl` in `src/main/modules/downloads/fetcher.ts`), so a unit test drives each codec with a
      local stub — no test in this story opens a socket to or makes a request against a real master or
      real q2servers.com (GB-A5, GB-A6).

## Open Questions

- [x] ~~**Q1 — UDP master reply stop condition.** The concept records this as unresolved (open point
      #2): a quiet period after the last received datagram, an expected-count check (if the server
      count is knowable up front), or a hard cap on datagrams/time, in some combination. This story's
      AC2 (assembling multiple datagrams into one set) needs a concrete stop rule to implement against
      — confirm which approach (or combination) before `/refine`, since it is the one piece of this
      story's scope the concept explicitly did not decide.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** UDP master reply stop condition: a quiet period after the last received datagram
  (no expected-count check, no separate hard cap).
- **Layering: codecs shared, transports main.** The four pure codecs live in `src/shared/servers/`
  (where [[108]]'s purity sweep already forbids `node:*`/`electron`/IPC imports) and the two
  transport seams live in `src/main/modules/servers/`, because a seam that has to reach `node:dgram`
  or `net.fetch` cannot exist in a layer that must stay importable from the renderer.
- **The address set reuses [[107]]'s vocabulary.** Every address a codec produces is run through
  `parseServerAddress`/`formatServerAddress`, and the deduplication key is the `normalized` string,
  so a master-supplied address is validated by exactly the rule a hand-typed one is.
- **A per-record/per-line rejection is not a source failure.** A single unparsable line, or a record
  whose port is `0`, is dropped into a `skipped: { value, reason }[]` list while the source still
  succeeds (GB-S3 reports the source, not the line); only a whole-body defect (wrong header, body
  length not a multiple of 6, empty body) is `{ ok: false }`, because one bad row must not lose the
  other 200 servers.
- **The UDP header check is byte-level, not text.** The reply is matched against the literal bytes
  `FF FF FF FF` + `servers ` and records are read from the byte right after it, rather than through
  [[108]]'s `readConnectionlessReply`, because that helper decodes latin-1 and splits on whitespace —
  and a packed record legitimately contains `0x20` and `0x0A` bytes.
- **No tolerance for undocumented padding.** Nothing but whole 6-byte records may follow the header;
  a remainder of 1–5 bytes is `truncated`. Guessing a newline separator would silently corrupt the
  first record of every reply that does not carry one.
- **`?raw=2` is bare packed records.** The binary HTTP shape reuses the same record reader as the UDP
  payload with no OOB header, so AC1 and AC4 are proven against one implementation.
- **Quiet period = 500 ms, plus a separate first-reply timeout of 2000 ms.** The quiet period is the
  decided stop condition; the first-reply timeout is not a cap on the reply but the "this master
  never answered at all" case (failure `no-reply`), which the stop condition by construction cannot
  detect.
- **The collector's clock is injected.** The UDP seam takes a `setTimeout`/`clearTimeout` pair so the
  quiet-period rule is unit-tested deterministically, with a loopback `dgram` test as the second,
  real-socket-but-not-real-master proof (GB-A5 forbids a real master, not `127.0.0.1` — the
  `fetcher.test.ts` precedent does exactly this over HTTP).
- **Failure reasons get i18n keys now, no UI.** `masterSourceFailureKey(reason)` plus
  `servers.source.error.*` entries in `en.json`, mirroring [[107]]'s D3, so GB-S3's "a failing source
  is reported" finds the vocabulary already there instead of inventing prose later.
- **No IPC channel, no orchestration, no CHANGELOG entry.** Nothing in this story is reachable by a
  user yet, so `src/shared/ipc.ts`, the preload allowlist and the renderer stay untouched.

## Plan

1. **D1 — the packed-record codec.** New `src/shared/servers/master-records.ts`:
   `MASTER_REPLY_HEADER` (`FF FF FF FF` + `servers `), the `MasterSourceFailure` reason union
   (`too-short`, `bad-header`, `truncated`, `empty-body`, `no-reply`, `transport-error`,
   `http-status`), `readPackedRecords(bytes, offset)`, `unpackMasterReply(bytes)` and
   `assembleMasterAddresses(payloads)` (union + dedupe by `normalized`, first-seen order).
   Test `master-records.test.ts`.
2. **D2 — the HTTP list codecs.** New `src/shared/servers/http-list.ts`: `parseHttpListText(text)`
   (`?raw=1`) and `parseHttpListBinary(bytes)` (`?raw=2`, reusing D1's record reader), both returning
   `{ ok: true, addresses, skipped }` or a failure reason. Test `http-list.test.ts`.
3. **D3 — the UDP seam and the quiet-period collector.** New
   `src/main/modules/servers/udp-master-source.ts`: the `MasterUdpImpl` seam (send one datagram,
   stream replies, close), a `node:dgram` default, and `resolveUdpMasterSource(address, opts)`
   implementing the decided stop rule on top of D1. Test `udp-master-source.test.ts` (stub seam +
   fake timers, plus one loopback case).
4. **D4 — the HTTP seam.** New `src/main/modules/servers/http-list-source.ts`: `FetchImpl` reused
   from `downloads/fetcher.ts`, `resolveHttpListSource(url, { raw, fetchImpl })` selecting D2's text
   or binary codec by shape. Test `http-list-source.test.ts` (loopback `node:http`, mirroring
   `fetcher.test.ts`).
5. **D5 — the message keys.** `masterSourceFailureKey()` beside the reason union plus
   `servers.source.error.*` in `en.json`, with a test iterating the union.

Affected files (all new except `en.json`): `src/shared/servers/master-records.ts`, `http-list.ts`,
`src/main/modules/servers/udp-master-source.ts`, `http-list-source.ts`, their four `.test.ts`
siblings, `src/renderer/src/i18n/locales/en.json`. No IPC channel, no preload change, no renderer
component, no shell edit.

## Deliverables

- **D1 — the UDP master payload codec and the multi-datagram assembler, with its tests.**
  Files: `src/shared/servers/master-records.ts` (new), `src/shared/servers/master-records.test.ts`
  (new). Mirror: [[108]]'s `src/shared/servers/protocol.ts` (byte-level shared module, ok/reason
  discriminated union) and [[107]]'s `src/shared/servers/address.ts`.
  Acceptance: a payload of header + three records unpacks to three addresses with the ports read
  big-endian; `assembleMasterAddresses` over two payloads that share a record yields the union once,
  in first-seen order; a payload shorter than the header, one with a wrong header, one with an empty
  body and one cut mid-record return `too-short`, `bad-header`, `empty-body` and `truncated` and
  never a partial address; a record with port `0` lands in `skipped`, not in `addresses`; the module
  imports nothing from `node:*`, `electron` or the IPC layer.
- **D2 — the `?raw=1` and `?raw=2` list codecs, with their tests.**
  Files: `src/shared/servers/http-list.ts` (new), `src/shared/servers/http-list.test.ts` (new).
  Mirror: D1's result shape; `src/shared/config/command-tokenizer.ts` for the table-driven test.
  Acceptance: a text body of `a.b.c.d:port` lines (LF and CRLF, blank lines, a trailing newline, a
  `#` comment line) parses to exactly the valid addresses; a line [[107]] rejects appears in
  `skipped` with its reason while the rest still parse; a binary body of packed records parses to the
  same address list as the equivalent UDP payload; an empty body is `empty-body` and a binary body
  whose length is not a multiple of 6 is `truncated`.
- **D3 — the UDP transport seam and the quiet-period stop rule.**
  Files: `src/main/modules/servers/udp-master-source.ts` (new),
  `src/main/modules/servers/udp-master-source.test.ts` (new). Mirror:
  `src/main/modules/downloads/fetcher.ts` (`FetchImpl`-style seam with a lazily imported default) and
  its `fetcher.test.ts` loopback setup.
  Acceptance: driven by a stub seam and fake timers, three datagrams arriving 100 ms apart resolve to
  one assembled address set 500 ms after the last one and not before; a datagram arriving after the
  quiet period has elapsed does not change the returned result; no datagram at all fails with
  `no-reply` after the first-reply timeout instead of hanging; a seam that throws yields
  `transport-error`; an aborted signal closes the socket and resolves without throwing; one test
  drives the real `node:dgram` default against a loopback responder on `127.0.0.1` and gets the same
  address set. No test addresses a real master.
- **D4 — the HTTP transport seam.**
  Files: `src/main/modules/servers/http-list-source.ts` (new),
  `src/main/modules/servers/http-list-source.test.ts` (new). Mirror:
  `src/main/modules/downloads/fetcher.ts` / `fetcher.test.ts` (same `FetchImpl` type, imported, not
  re-declared).
  Acceptance: against a `node:http` server on `127.0.0.1`, a `?raw=1` body resolves to its addresses
  and a `?raw=2` body to the same set; a non-2xx response yields `http-status` carrying the code and
  no addresses; a body the codec rejects yields the codec's own reason; the resolver runs under plain
  Vitest with a plain `fetch` injected, with no Electron runtime. No test requests q2servers.com.
- **D5 — every source failure has a message key.**
  Files: `src/shared/servers/master-records.ts` (extend: `masterSourceFailureKey`),
  `src/renderer/src/i18n/locales/en.json`, `src/shared/servers/master-records.test.ts` (extend).
  Mirror: [[107]]'s D3 and `src/shared/config/comment-labels.test.ts`.
  Acceptance: every `MasterSourceFailure` code resolves to a `servers.source.error.*` key present in
  `en.json`, proven by a test iterating the union; no existing key is renamed.

## Model Hints

- D1 → default
- D2 → default
- D3 → **deliverable-hard** — a timer-driven collector over a live socket is the one place in this
  sprint where a subtly wrong rule (quiet period restarted on the wrong event, timer not cleared on
  abort, socket left open) yields a green test suite and either a hung scan or a silently short
  server list in production.
- D4 → default
- D5 → default
- Review: → default — four new files in two existing folders plus one additive `en.json` block, no
  existing behaviour touched, no IPC channel and no UI, so there is nothing here for a review to
  regress against.

## Acceptance Tests

- AC1 → D1, unit `src/shared/servers/master-records.test.ts` › "unpacks a master reply into packed
  IPv4 and big-endian port records"
- AC2 → D1 + D3, unit `src/shared/servers/master-records.test.ts` › "assembles several datagrams into
  one address set without duplicates", plus unit
  `src/main/modules/servers/udp-master-source.test.ts` › "collection ends one quiet period after the
  last datagram"
- AC3 → D2, unit `src/shared/servers/http-list.test.ts` › "parses the raw=1 text list into addresses"
- AC4 → D2, unit `src/shared/servers/http-list.test.ts` › "parses the raw=2 binary list into the same
  addresses"
- AC5 → D1 + D2, unit `src/shared/servers/master-records.test.ts` › "a malformed or truncated payload
  is an explicit failure, never a partial address", plus unit
  `src/shared/servers/http-list.test.ts` › "a rejected line is skipped with its reason and the list
  still parses"
- AC6 → D3 + D4, unit `src/main/modules/servers/udp-master-source.test.ts` › "the UDP transport is
  driven entirely through its injectable seam", plus unit
  `src/main/modules/servers/http-list-source.test.ts` › "the HTTP list is fetched through the
  injected FetchImpl against a loopback server"

No criterion in this story describes a user action — the story has no surface and no IPC channel of
its own — so nothing maps to the `e2e` gate and there is no manual residue. The two loopback tests
(D3, D4) bind only `127.0.0.1`; no test reaches a real master or q2servers.com (GB-A5).

## Done

**Summary.** Delivered the two master-source codecs and their two transport seams, all pure/unit-
tested, no IPC or UI surface. `src/shared/servers/master-records.ts` unpacks a UDP master reply
(header check, packed 4-byte-IPv4 + 2-byte-big-endian-port records) and assembles multiple datagrams
into one deduplicated address set; `src/shared/servers/http-list.ts` parses the `?raw=1` text and
`?raw=2` binary list shapes, reusing D1's record reader for the binary case. `src/main/modules/
servers/udp-master-source.ts` implements the decided quiet-period (500 ms) / first-reply-timeout
(2000 ms) collector behind an injectable `MasterUdpImpl` + clock seam, with a `node:dgram` default
implementation lazily imported. `src/main/modules/servers/http-list-source.ts` fetches a list URL
through the `FetchImpl` seam reused from `downloads/fetcher.ts`. Every `MasterSourceFailure` reason
now resolves to a `servers.source.error.*` i18n key (`masterSourceFailureKey`), additively extending
`en.json`.

**Commit message.**
```
109: master sources return an address set
```

**Verification — narrow gate (this was the sprint's last story; the full regression gate is run
once by the orchestrator after all stories, per the sprint deviation for this run).**
- `npm run build` — green.
- `npm run typecheck` — green (`tsconfig.node.json` and `tsconfig.web.json` both clean).
- `npx vitest run --changed HEAD` (test-story) — 68 files / 518 tests, all passed, including all
  four new test files plus the extended `master-records.test.ts`.
- `npm run ui:verify` / `ui:flow` — not run. The story's own `## Acceptance Tests` section confirms
  no criterion maps to the `e2e` gate (no user-facing surface, no IPC channel this story), so e2e was
  correctly skipped rather than substituted.
- Code review (clean agent, default tier per Model Hints): **PASS**, no blocking findings. Two
  non-blocking observations noted by the reviewer: (1) `udp-master-source.ts`'s `onError` path
  reports the generic `transport-error` reason rather than a more specific stored payload-failure
  reason in one compound-failure edge case (socket errors after an unusable-only reply) — not a
  spec violation, left as-is; (2) `master-records.test.ts` references a `const` (`RECORD_LENGTH_FOR_TEST`)
  declared later in the same file inside an `it()` body — works correctly (Vitest runs test bodies
  after module evaluation) but is stylistically fragile; left as-is since it is not a live bug and
  fixing it purely for style was judged not worth another review cycle. No review-fix cycle was
  needed.

**AC → test mapping, as verified:**
- AC1 → `src/shared/servers/master-records.test.ts` › "unpacks a master reply into packed IPv4 and
  big-endian port records" — passed.
- AC2 → `master-records.test.ts` › "assembles several datagrams into one address set without
  duplicates" + `src/main/modules/servers/udp-master-source.test.ts` › "collection ends one quiet
  period after the last datagram" — both passed.
- AC3 → `src/shared/servers/http-list.test.ts` › "parses the raw=1 text list into addresses" —
  passed.
- AC4 → `http-list.test.ts` › "parses the raw=2 binary list into the same addresses" — passed.
- AC5 → `master-records.test.ts` › "a malformed or truncated payload is an explicit failure, never a
  partial address" + `http-list.test.ts` › "a rejected line is skipped with its reason and the list
  still parses" — both passed.
- AC6 → `udp-master-source.test.ts` › "the UDP transport is driven entirely through its injectable
  seam" (plus a loopback `node:dgram` test bound to `127.0.0.1`) + `src/main/modules/servers/
  http-list-source.test.ts` › "the HTTP list is fetched through the injected FetchImpl against a
  loopback server" — both passed. No test in this story addresses a real master or q2servers.com.
- No `manual residue` — the story has no user-facing criterion.

**Decisions made during build (beyond the story's own Decisions (Sprint)):**
- D3's UDP seam shape: `MasterUdpImpl = (target, handlers) => Promise<MasterUdpSocket>` with
  `MasterUdpSocket = { send(datagram), close() }` and `handlers = { onMessage(data), onError(error) }`
  supplied at open time (no post-open registration window a datagram could be missed in), mirroring
  `FetchImpl`'s minimalism; `node:dgram` is imported lazily inside the default implementation, exactly
  like `electron` in `fetcher.ts`.
- D3's outbound query datagram is `\xFF\xFF\xFF\xFFquery\0` (OOB prefix + latin-1 `"query"` +
  trailing NUL), matching the concept's §6.5 wire description, rather than a bare `"query"` without
  the terminator.
- D3: a UDP datagram with a valid header but an unusable body (e.g. `truncated`) counts toward both
  the quiet-period and first-reply clocks but contributes no addresses; if nothing usable arrived at
  all, that payload's own failure reason is returned instead of a phantom `{ ok: true, addresses: [] }`.
  Abort with nothing received resolves `{ ok: false, reason: 'no-reply' }` (the `MasterSourceFailure`
  union has no dedicated `aborted` member); a pre-aborted signal never opens a socket.
- D4: `fetchImpl` is a required parameter with no lazy Electron default (unlike D3's `node:dgram`
  case), per the acceptance bullet that the HTTP resolver must run under plain Vitest with no
  Electron runtime at all; `HttpListSourceResult`'s failure variant carries an extra optional
  `status` field locally in `http-list-source.ts` rather than widening `MasterSourceFailure`, to avoid
  touching D1's file from a D4 change.
- D2: an empty `?raw=2` binary body is explicitly checked and reported as `empty-body` before
  delegating to D1's record reader (which alone would treat a zero-length remainder as vacuously
  valid, since 0 is a multiple of 6) — needed because raw=2 has no header for `unpackMasterReply` to
  reject on beforehand.

No pre-existing failures encountered; nothing in this story required touching `src/shared/ipc.ts`,
the preload allowlist, or the renderer, matching the Decisions (Sprint) scope.
