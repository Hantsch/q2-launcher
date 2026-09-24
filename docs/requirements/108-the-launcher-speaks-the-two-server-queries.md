---
id: 108
title: the launcher speaks the two server queries
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — A function builds the `info <protocol>` query datagram and a function builds the
      `status` query datagram, both prefixed with the four `FF FF FF FF` connectionless bytes per
      §6.1, and both are pure (no socket, return a `Buffer`/`Uint8Array`).
- [ ] **AC2** — A well-formed `info` reply (the short infostring shape in §6.1) parses into a typed
      result carrying hostname, map, current clients and maxclients.
- [ ] **AC3** — A well-formed `status` reply (the `print` + serverinfo line + player lines shape in
      §6.1) parses into a typed result carrying the full serverinfo key/value map and a player list,
      each player with score, ping and name only (§6.3).
- [ ] **AC4** — The serverinfo infostring splitter treats every key as optional: a reply missing
      `gamename`, `version`, or any other key from the §6.2 table produces a result with that field
      absent, not a thrown error and not a default value presented as if it were reported.
- [ ] **AC5** — A player line is parsed into score/ping/name with no assumption about name content —
      arbitrary bytes and high-bit "green" characters in a name survive the parse without throwing and
      without being interpreted as field separators.
- [ ] **AC6** — A truncated or malformed reply (cut short mid-line, missing the trailing player
      section, or otherwise not matching the expected shape) is surfaced as a distinguishable
      "no data this round" outcome, never coerced into a zero-player or empty-fields result that looks
      like a legitimate reply (§6.4, GB-N6's "never shown as zero players" applied at the parser level).
- [ ] **AC7** — Every codec in this story is a pure, unit-tested module with no `node:dgram` import
      and no socket creation in its tests (GB-A6); a test suite exercises AC2–AC6 against fixed byte
      fixtures, not a live server.

## Open Questions

- [ ] **Q1 — Display and watchlist-matching of non-ASCII/high-bit player names.** This story only
      guarantees the parser does not crash on such names and preserves their bytes (AC5). How they are
      *decoded for display* (the "green" character mapping) and how a watchlist entry's match mode
      (exact/substring/regex, §12) applies to them is concept open point #10, explicitly deferred to
      the watchlist sprint — it is a display/matching decision, not a parsing one, and does not block
      this story.

## Plan

<!-- Filled by `/refine 108`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 108`. -->

## Model Hints

<!-- Filled by `/refine 108`. -->

## Acceptance Tests

<!-- Filled by `/refine 108`. -->

## Done

<!-- Filled by `/build 108`. -->
