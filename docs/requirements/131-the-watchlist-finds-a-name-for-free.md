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
