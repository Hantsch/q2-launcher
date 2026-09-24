---
sprint: S22
status: done # planned | in-progress | done
branch: sprint/S22
milestone: 9.1 — Servers module foundation & protocol core
---

# Sprint S22 — A servers module exists, and it already speaks the protocol

## Goal

A "Servers" entry appears in the primary nav, routes to an empty view, and is a real registered
module — not a stub the shell knows about. Underneath it, the protocol and address groundwork every
later sprint in this milestone builds on (address validation, the `info`/`status` query codecs, the
master-source codecs) is written as pure, unit-tested code with no live network involved anywhere.

## Stories (in build order)

- [x] 106 — a servers module exists with its own nav entry
- [x] 107 — a server address is validated before it is trusted
- [x] 108 — the launcher speaks the two server queries
- [x] 109 — master sources return an address set

## Notes

This is the first of 7 sprints (9.1–9.7, stories 106–132) building the game-browser milestone
described in full in `docs/concepts/game-browser.md`. 106 goes first because 107–109 need the module
shell (main/renderer halves, IPC namespace) to land their code into, even though none of the three
protocol/validation stories depend on 106's *content* — they are pure modules that could in principle
be built standalone. 107 goes before 108/109 because both later stories' "reject malformed input"
acceptance criteria are easier to reason about once the shared validation vocabulary exists, and
because [[107]] is written to be referenced by name from join/manual-entry/address-book stories in
later sprints.

Three stories in this sprint (107, 108, 109) each carry a genuine Open Question the concept itself
left unresolved: IPv6 scope in the address validator (concept open point #9), and the UDP master
reply's multi-datagram stop condition (open point #2). These need an answer during `/refine`, not a
silent default baked into the pure code — get them settled before build starts on the affected
story.

No story in this sprint touches a real UDP master, a real game server, or q2servers.com — every
codec is exercised against fixtures/stubs, per GB-A5.

## Regression gate

Ran on `sprint/S22` HEAD `39fb777` (109, the sprint's last story).

| Command | Result |
| --- | --- |
| `npm run build` | green |
| `npm test` (full) | green — 260 files, 4300 passed, 8 skipped, 0 failed |
| `npm run ui:verify` (`e2e`) | green — 45/45 screens, 86 shots, 0 axe violations at any severity |
| `npm run ui:flows` (`e2e-all`) | **red** — non-deterministic, see below |

### `ui:flows` — verdict: pre-existing harness defect, not a sprint regression

Three consecutive runs on the same HEAD gave 30/55, 3/55 and 18/55 passing, with a different
failure set each time. Every failure printed the same cause: `another instance is already
running, exiting` — the app's single-instance lock, hit before Playwright could attach.

Attribution (no source file changed):

- **Run individually, the flows pass.** `home-route-roundtrip`, `downloads-tab`,
  `raw-inline-edit` and S22's own `servers-module-shell` all pass on their own; the
  "another instance" signature does not appear once when flows run one at a time.
  (`news-feed`, `bootstrap-wizard` and `engine-update` fail individually too, each for its own
  unrelated pre-existing reason — an outbound-request assertion, an 8s button timeout, and a
  fixture ENOENT respectively. None is the cascade symptom.)
- **Root cause is in the harness, and it predates the sprint.** `scripts/lib/harness.mjs`,
  `withApp()`'s `finally` block (~line 529), races `app.close()` against a 15s timeout with no
  fallback `child.kill()`. A main process that does not quit in time survives, keeps the
  single-instance lock on its fixture variant's userData dir, and every later flow reusing that
  variant dies instantly. Introduced in `d0315ec`, an ancestor of `c559ebd` — S22's own
  `git merge-base dev HEAD`. Four orphaned `electron.exe` processes from the repo's
  `node_modules/electron/dist/` were found and killed mid-investigation, matching this exactly.
- **Not bisected** — per the sprint rules, a failure that is red at the sprint's start commit for
  reasons the sprint did not introduce is reported as pre-existing, not bisected and not fixed here.

**Outcome:** pre-existing; no fix commit on this branch. It does not block the merge of S22, whose
own flow passes. Closing it is a follow-up: a hard kill in `withApp()`'s teardown.
