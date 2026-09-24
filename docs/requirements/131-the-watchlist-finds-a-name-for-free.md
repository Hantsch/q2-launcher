---
id: 131
title: the watchlist finds a name for free
status: draft # draft -> ready -> in-progress -> done
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
of one the user selected in the list.

Accuracy here is honest, not perfect (GB-W5b): `offline` means "no fetched server matched", which
also covers the case of a player sitting on a server nobody's stage-2 fetch has reached yet — not a
claim that the player is not playing. The matcher exposes when its data is from, so whatever renders
it ([[132]]) can say so rather than let `offline` read as a fact about the world.

A user-supplied regex is still user input running over a few thousand names per scan; a pathological
pattern must not be able to hang or meaningfully slow that scan, whatever the concrete guard turns
out to be. Because the guard's shape is unresolved (see Open Questions), an invalid pattern is
rejected up front, at entry-creation time, with a clear reason — never accepted and left to fail
silently later.

This is a pure module: the matcher, and the entry store it works from, take data in and produce data
out, with no `node:dgram` or IPC dependency of their own — the same seam discipline `downloads`'s
`FetchImpl` already established, restated here as GB-A6.

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
- [ ] **AC7** — An invalid regex pattern is rejected at entry-creation time with a clear reason; it
      is never accepted and left to fail during a later scan.
- [ ] **AC8** — A pathological regex pattern cannot hang a scan or meaningfully slow it down — the
      concrete guard is unresolved (see Open Questions), but this outcome itself is not optional.

## Open Questions

- [ ] **Q1 — Regex safeguards.** The concrete limits are not decided: pattern length limit,
      compile-time validation, a per-match or per-scan time budget, and what the UI says when a
      pattern is refused (concept open point #5, §12).
- [ ] **Q2 — What happens to stored watchlist entries when the unlocking code expires.** The feature
      disappears from the UI ([[130]]); whether the entries themselves are kept in `state.json` for
      a later code, or discarded, is genuinely undecided (concept open point #12).

## Plan

<!-- Filled by `/refine 131`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 131`. -->

## Model Hints

<!-- Filled by `/refine 131`. -->

## Acceptance Tests

<!-- Filled by `/refine 131`. -->

## Done

<!-- Filled by `/build 131`. -->
