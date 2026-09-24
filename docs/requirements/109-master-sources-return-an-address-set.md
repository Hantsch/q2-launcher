---
id: 109
title: master sources return an address set
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — A function unpacks a UDP master reply payload (the `\xFF\xFF\xFF\xFFservers ` header
      followed by packed 4-byte-IPv4 + 2-byte-big-endian-port records, per §6.5) into a list of
      addresses, and is pure (accepts a `Buffer`, returns data — no socket).
- [ ] **AC2** — A function assembles multiple UDP reply datagrams belonging to the same query into
      one combined address set, with no duplicate addresses in the result even if a record repeats
      across datagrams.
- [ ] **AC3** — A function parses the HTTP list's `?raw=1` (text) shape into an address list.
- [ ] **AC4** — A function parses the HTTP list's `?raw=2` (binary) shape into an address list.
- [ ] **AC5** — A genuinely malformed or truncated UDP or HTTP payload (cut mid-record, wrong header,
      empty body) does not throw uncaught and does not produce a spurious address — it is surfaced as
      an explicit parse failure the caller can report as a failing source per GB-S3, without aborting
      anything else.
- [ ] **AC6** — Both the UDP transport and the HTTP transport sit behind an injectable seam (mirroring
      `FetchImpl` in `src/main/modules/downloads/fetcher.ts`), so a unit test drives each codec with a
      local stub — no test in this story opens a socket to or makes a request against a real master or
      real q2servers.com (GB-A5, GB-A6).

## Open Questions

- [ ] **Q1 — UDP master reply stop condition.** The concept records this as unresolved (open point
      #2): a quiet period after the last received datagram, an expected-count check (if the server
      count is knowable up front), or a hard cap on datagrams/time, in some combination. This story's
      AC2 (assembling multiple datagrams into one set) needs a concrete stop rule to implement against
      — confirm which approach (or combination) before `/refine`, since it is the one piece of this
      story's scope the concept explicitly did not decide.

## Plan

<!-- Filled by `/refine 109`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 109`. -->

## Model Hints

<!-- Filled by `/refine 109`. -->

## Acceptance Tests

<!-- Filled by `/refine 109`. -->

## Done

<!-- Filled by `/build 109`. -->
