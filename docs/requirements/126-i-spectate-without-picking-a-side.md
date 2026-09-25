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

What that composition is (concept open point #6), as far as vanilla Quake II 3.20 shows it
(checked 2026-09-25 against id-Software/Quake-2): the client registers `spectator` as a userinfo
cvar (`cl_main.c`: `Cvar_Get ("spectator", "0", CVAR_USERINFO)`), and the game DLL's
`ClientConnect` (`game/p_client.c`) treats any value other than `0` as a spectator request and
compares that value with the server's `spectator_password` ("Spectator password required or
incorrect."). So spectating means `spectator` set to `1`, or to the spectator password when
`needpass` bit 1 says one is needed. That check lives in the game DLL, so a mod can do it
differently; r1q2 and Q2PRO inherit the client side from 3.20. `/refine` confirms both engines
against their source instead of re-deriving this. The password never goes on the command line: it
travels through the mechanism [[125]] builds for the join password (its AC6).

## Acceptance Criteria

- [ ] **AC1** — Spectating a server reuses [[125]]'s join flow — active installation, [[107]]'s
      address validation ahead of the argument vector, mod-mismatch warning, history recording via
      [[113]] — with a different launch-parameter composition (spectator mode) rather than a
      separate implementation path.
- [ ] **AC2** — When the server's `needpass` bit 1 (spectator password) is set, the launcher asks for
      that password before launching, the same way [[125]]'s AC4 asks for the join password.
- [ ] **AC3** — The spectator password never appears in the spawned game process's argument vector —
      it reaches the game through the same mechanism as [[125]]'s AC6.

## Open Questions

- [x] ~~**Q1 — Spectator launch parameters per engine.** (concept open point #6)~~ resolved from the
      3.20 source, see Requirement. What is left (confirming r1q2/Q2PRO) is research for
      `/refine`, not a user question.

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
