---
sprint: S28
status: planned # planned | in-progress | done
branch:
milestone: 9.7 — Experimental-features gate & watchlist
---

# Sprint S28 — Experimental-features gate & watchlist

## Goal

The launcher-wide experimental-features mechanism ships generic and locked by default: a signed,
device-bound unlock code, a Settings surface to redeem one, and a main-side gate that makes a
locked feature render nothing and register no handlers. Its first and only consumer, the watchlist,
ships fully built on top of it — matching, actions and all — but stays completely invisible until a
code names `watchlist`.

## Stories (in build order)

- [ ] 128 — An unlock code proves what it unlocks
- [ ] 129 — I ask for a code and see what it unlocked
- [ ] 130 — A locked feature does not exist
- [ ] 131 — The watchlist finds a name for free
- [ ] 132 — The watchlist tells me where someone is

## Notes

The order is deliberate, not incidental: 128, 129 and 130 are the gate mechanism, and none of it is
really about the game browser — the watchlist is only its first consumer (concept §13's opening
line). 128 builds the signed-token verification 129's Settings UI and 130's enforcement both read
from; 130 cannot be meaningfully built (or tested as "actually locks something") until 131 exists to
lock. 131 and 132 are the watchlist itself, built last, as the concrete proof that 130's mechanism
holds up for a real feature rather than only in the abstract.

This is sprint 7 of 7 (9.1–9.7, stories 106–132) and the **last** sprint of the game-browser
milestone. It depends on S22–S27 (stories 106–127) being built first — in particular [[114]]'s scan
engine, whose stage-2 results the watchlist matches against, and [[125]]/[[126]]'s join/spectate
flows, which the watchlist's row actions reuse rather than reimplement.

Once this sprint is done, v1 of the game browser — per `docs/concepts/game-browser.md`'s "In scope
(v1)" list — is complete, except for what that same concept deliberately deferred: the 2D
in-launcher observer, notifications when a watched player appears, a home dashboard tile, server-side
statistics/rankings, and mod/map download from the detail view. All five are explicitly out of v1 in
the concept's own "Deliberately not in v1" section, with their own rationale recorded there — none of
them are missing from this sprint by oversight.

Concept: `docs/concepts/game-browser.md`.
