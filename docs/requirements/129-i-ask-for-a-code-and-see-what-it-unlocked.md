---
id: 129
title: i ask for a code and see what it unlocked
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[128]] can decide whether a token is valid; this story is where a user actually meets that
mechanism. Settings carries an unobtrusive code entry field and, next to it, the installation id
with a copy action — and that copy action *is* how a user asks for a code in the first place, since
the maintainer cannot sign anything without knowing which installation to bind it to (concept
§13.6). Nothing about this is a wizard or a flow with steps; it is one field and one id, sitting
quietly in Settings the way a build number does.

A rejected code has to say **which** of the four checks failed — bad signature, wrong installation,
redemption window elapsed, or feature already expired — because, in the concept's own words,
"'invalid' alone produces a support conversation that never ends" (§13.6). Each of [[128]]'s AC2,
AC3, AC4 and AC7 rejection paths needs to reach the user as a distinct, readable reason, not a
single generic failure.

An accepted code shows what it actually did: the list of feature names it unlocked, and its expiry
if it has one. Wherever an unlocked feature then appears in the rest of the UI — the watchlist tab
[[132]] is the concrete case today — it carries a visible "experimental" marking, so nobody mistakes
a feature that shipped behind a code for a finished part of the launcher (GB-X5). That marking is
this story's concern; whether the feature renders at all when locked is [[130]]'s mechanism, applied
by [[132]] as its first consumer.

Finally: a code can stop being valid between two runs of the app, purely because its feature expiry
passed while the launcher was closed. When that happens, the feature has to disappear at the next
start (enforced by [[130]]'s mechanism, triggered by [[128]]'s AC5/AC7 re-verification) — but
Settings has to say *why*, explicitly, the next time it is opened. A feature that silently stops
being where it used to be reads as a bug report waiting to happen; a sentence in Settings that says
the code expired does not.

## Acceptance Criteria

- [ ] **AC1** — Settings shows the installation id (from [[128]]) and a working copy action next to
      it.
- [ ] **AC2** — Submitting a code shows exactly one of four specific rejection reasons — bad
      signature, wrong installation, redemption window elapsed, feature already expired — and never
      a generic "invalid code" message.
- [ ] **AC3** — An accepted code's unlocked feature list and its expiry (if any) are shown to the
      user immediately after submission.
- [ ] **AC4** — Anywhere an unlocked feature appears in the rest of the UI, it is visibly marked as
      experimental.
- [ ] **AC5** — When a previously-valid code's feature expiry passes, the feature is gone at the
      next app start, and Settings states that the code expired rather than the feature simply not
      being there.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 129`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 129`. -->

## Model Hints

<!-- Filled by `/refine 129`. -->

## Acceptance Tests

<!-- Filled by `/refine 129`. -->

## Done

<!-- Filled by `/build 129`. -->
