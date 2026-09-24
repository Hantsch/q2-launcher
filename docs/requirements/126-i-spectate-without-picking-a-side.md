---
id: 126
title: i spectate without picking a side
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Sometimes the point is to watch, not to play — a duel worth following, or checking who is actually
on a server before committing to it. The concept is deliberate that this is v1's entire answer to
"observing" (§14.1): a one-click spectator launch of the real game, not a picture rendered inside
the launcher. The in-launcher 2D observer (§14.2) is specified for a later stage and is explicitly
out of scope here.

Spectating is not a second feature next to [[125]]'s Join — it is Join with different launch
parameters. The concept's own framing (§10.2) is "the same launch, with the engine put into
spectator mode, and the spectator password asked for when `needpass` says one is needed. One action,
no new machinery." Everything [[125]] already does — active installation, [[107]]'s strict address
validation before the address reaches the argument vector, mod-mismatch handling, history recording
via [[113]] — applies to a spectate the same way it applies to a join; only the composition of launch
parameters differs, to put the engine into spectator mode instead of joining as a player.

What that composition actually is — the exact cvar or argument that tells r1q2 or Q2PRO "connect as
a spectator", and in particular how a spectator password is supplied without ending up as a
shell-visible process argument — is not established anywhere in the concept or its protocol
research. It is recorded as the concept's own open point #6, unresolved on purpose rather than
guessed at.

## Acceptance Criteria

- [ ] **AC1** — Spectating a server reuses [[125]]'s join flow — active installation, [[107]]'s
      address validation ahead of the argument vector, mod-mismatch warning, history recording via
      [[113]] — with a different launch-parameter composition (spectator mode) rather than a
      separate implementation path.
- [ ] **AC2** — When the server's `needpass` bit 1 (spectator password) is set, the launcher asks for
      that password before launching, the same way [[125]]'s AC4 asks for the join password.
- [ ] **AC3** — The spectator password never appears in a shell-visible process argument — this is a
      hard requirement on whatever implementation resolves the Open Question below, not an
      aspiration.

## Open Questions

- [ ] **Q1 — Spectator launch parameters per engine.** Quoting the concept's own open point #6: "the
      exact cvar/argument composition that puts r1q2 and Q2PRO into spectator mode on connect,
      including how the spectator password is passed without ending up in a shell-visible argument"
      is unresolved. No per-engine spectator flag is assumed by this story; the composition — and
      the mechanism that keeps the password out of a visible argument (an early `+set`, a config file
      write, stdin, or something else) — has to be established from the actual r1q2/Q2PRO source or
      documentation before `/refine` can turn this into a plan.

## Plan

<!-- Filled by `/refine 126`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 126`. -->

## Model Hints

<!-- Filled by `/refine 126`. -->

## Acceptance Tests

<!-- Filled by `/refine 126`. -->

## Done

<!-- Filled by `/build 126`. -->
