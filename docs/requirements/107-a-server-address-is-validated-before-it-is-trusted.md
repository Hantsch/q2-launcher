---
id: 107
title: a server address is validated before it is trusted
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Before any server address — whether it came from a master source, an HTTP list, or something the
user typed by hand — is allowed to influence what the launcher launches or stores, it has to be
proven to actually be an address: a host or IPv4 literal plus a port, and nothing else riding along
with it.

The concept is explicit about why this cannot be an afterthought (§10.1): r1q2's `+connect` argument
is handled by a *late* command parser that is re-tokenized normally — unlike `+set`, it honours
quotes and spaces. An address string that reaches `buildLaunchArgs` unvalidated is not just a wrong
hostname risk, it is a way for foreign data (a master's reply, a pasted string) to inject additional
tokens into the argument vector the launcher hands to the game. This is CLAUDE.md's "paths from the
renderer are never trusted" rule applied to a different kind of untrusted value.

This story delivers one thing: a pure, reusable address validator with no IO. It has no UI and no
IPC channel of its own — it exists so three later stories can each call the same strict check
instead of writing three slightly different ones: the join flow (GB-J2), manual server entry
(GB-S4), and the address-book write. [[107]] is referenced by name from each of those when they are
written, so this story's Requirement is written to stand on its own, ahead of any of them existing
yet.

The concept records IPv6 as an open point (#9): the classic UDP master record format is IPv4-only,
and whether a manually entered server may be IPv6 was never decided. This story recommends a
decision rather than silently picking one: **validate IPv4 literals and hostnames only for v1**,
matching what a master can actually return and what `+connect` has ever needed to carry in this
ecosystem; IPv6 is deferred as a genuinely open question below rather than folded into either
answer without discussion.

## Acceptance Criteria

- [ ] **AC1** — A pure function accepts a `host:port` or IPv4-literal `a.b.c.d:port` string and
      returns a typed success result with the parsed host and port when the input is well-formed.
- [ ] **AC2** — The same function rejects, with a distinct reason per case, at minimum: extra
      whitespace-separated tokens after the address, shell/argument metacharacters (quotes,
      backslashes, semicolons, `+`-prefixed tokens), a missing port, a non-numeric port, and a port
      outside 1–65535.
- [ ] **AC3** — A hostname component is validated against a defined, documented character set (no
      spaces, no control characters, no bytes above 126 — consistent with `buildLaunchArgs`'s existing
      finding in `docs/ARCHITECTURE.md` that r1q2 treats any byte above 126 as a separator); anything
      outside it is rejected rather than silently truncated.
- [ ] **AC4** — The validator is a standalone module with no `node:*`, `electron`, or IPC import —
      callable from a unit test with no process boundary crossed — and ships with unit tests covering
      every accept/reject case in AC1–AC3.
- [ ] **AC5** — The validator's rejection result carries a reason distinguishable per failure class
      (not a single generic "invalid address" string), so a future caller (join warning, manual-entry
      form error, address-book dialog) can show a specific i18n-keyed message rather than one catch-all.

## Open Questions

- [ ] **Q1 — Is IPv6 in scope for the address validator, or explicitly out for v1?** The concept
      leaves this unresolved (open point #9). Recommendation: IPv4 literals and hostnames only for
      this story and for everything that consumes it in this milestone (join, manual entry,
      address-book write); an IPv6 literal is rejected the same as any other malformed input, not
      silently accepted or silently mistaken for a hostname. Confirm before `/refine`, since it
      changes AC2's rejection list either way.

## Plan

<!-- Filled by `/refine 107`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 107`. -->

## Model Hints

<!-- Filled by `/refine 107`. -->

## Acceptance Tests

<!-- Filled by `/refine 107`. -->

## Done

<!-- Filled by `/build 107`. -->
