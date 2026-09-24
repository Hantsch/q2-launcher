---
id: 128
title: an unlock code proves what it unlocks
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

The watchlist ([[131]], [[132]]) ships hidden — the concept is explicit that it "ships behind a
signed unlock code" (`docs/concepts/game-browser.md` TL;DR, §13). This story is not really about
the game browser at all: it is the launcher-wide mechanism that makes an unfinished feature
non-discoverable until someone hands the user a code naming it, with the watchlist as its first
and, for now, only consumer (§13, opening line). [[129]] builds the Settings surface on top of
whatever this story exposes; [[130]] builds the "does not render, is not registered" enforcement
on top of whatever this story decides is valid.

The mechanism is a compact **signed token** (§13.2): Ed25519 via `node:crypto`, a public key
embedded in the app, verified **in main only** — the renderer never sees the private key and never
makes the accept/reject call itself. This is deliberately not a licence check (§13.5, "gatekeeping,
not security") — the app runs on the user's own machine, and someone determined can always patch
around it. What it has to resist is casual guessing, not a determined attacker: a real signature is
what turns "the maintainer decided to unlock this" into a fact main can check offline, with no
server round-trip.

The token's payload carries: the **feature names** it unlocks (so one code can unlock `watchlist`
and nothing else, or several features at once), the **installation id** it was issued for (device
binding, §13.3 — the answer to "can a code be forwarded" when there is no server to record a
redemption), an **issued-at** and a **redeem-by** timestamp (the activation window), an optional
**feature expiry**, and an optional **label** for the user's own benefit.

**Redemption window and feature expiry are two different clocks, and conflating them would be a
bug.** The window only gates *activation* — once a code has been redeemed inside it, the window
stops mattering entirely and the unlock lives as long as the feature expiry says (or forever, if
none was set). Without that distinction, a tester's unlock would silently die the moment the
original short window closed, which is not what §13.2 describes.

**Clock tampering is explicitly not defended against** (§13.4) — no monotonic high-water mark, no
network time check. This is documented as a known limit of offline gatekeeping, not something to
fix later; §13.4 and §13.5 are explicit that neither this nor the installation id being derived on
the same machine it protects is a bug.

The installation id itself (§13.3) is a salted hash of a stable per-machine value already available
without new plumbing — `MachineGuid` on Windows, `/etc/machine-id` on Linux — truncated to
something a human can paste into a chat message. The raw per-machine value is read once to compute
the hash and never kept, shown or sent anywhere; only the salted, truncated hash is.

## Acceptance Criteria

- [ ] **AC1** — A token that is validly signed, names a feature, whose installation id matches this
      machine's, and is redeemed inside its redemption window, is accepted for that feature.
- [ ] **AC2** — A token whose signature does not verify against the embedded public key is
      rejected.
- [ ] **AC3** — A token whose installation id does not match this machine's is rejected, and this
      failure is distinguishable from a bad signature (AC2) — not the same rejection reason.
- [ ] **AC4** — A token redeemed after its redeem-by time is rejected; a token redeemed inside its
      window stays valid afterward regardless of what the window later does — the window is never
      re-checked once redemption has succeeded.
- [ ] **AC5** — Verification re-runs on every app start, not only at the moment of redemption, so a
      feature expiry (AC7) takes effect on its own without any user action.
- [ ] **AC6** — The raw per-machine value the installation id is derived from is never stored,
      displayed or transmitted by the launcher — only the salted, truncated hash is.
- [ ] **AC7** — A token whose feature expiry has passed no longer unlocks that feature; this is
      checked at every re-verification (AC5) and is independent of the redemption window, which by
      then has already lapsed and is irrelevant per AC4.

## Open Questions

- [ ] **Q1 — Unlock-code distribution format.** The concrete format the user copies (length,
      grouping, prefix) is not decided, and neither is the equivalent format for the installation
      id shown back to them (concept open point #11).
- [ ] **Q2 — Redemption window length.** Placeholder: **10 minutes, not decided.** Long enough that
      a real person in a chat conversation can use it, short enough to matter (concept §13.2, open
      point #11).
- [ ] **Q3 — Where the private key lives, and what the maintainer runs to issue a code.** A script
      kept in this repository, or something kept outside it entirely — not decided (concept open
      point #11).
- [ ] **Q4 — Installation id churn.** The id changes on a fresh OS install, a hardware change and
      inside a VM. Whether the launcher softens that (a grace path, or deriving the id from
      something more stable) or whether re-issuing a code is simply the answer is not settled
      (concept open point #11).

## Plan

<!-- Filled by `/refine 128`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 128`. -->

## Model Hints

<!-- Filled by `/refine 128`. -->

## Acceptance Tests

<!-- Filled by `/refine 128`. -->

## Done

<!-- Filled by `/build 128`. -->
