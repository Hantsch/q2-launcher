---
id: 125
title: i join a server from the browser
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user has found a server worth playing on — in the list ([[118]]) or its detail view ([[122]]) —
and wants to actually play there, without leaving the launcher to paste an address into a shortcut
or a console command.

The launch path already exists and already expects this: `launch-plan.ts`'s `buildLaunchArgs` takes
a `connect` input and, when present, appends `+connect <host>:<port>` as the last argument — a late
command that r1q2's tokenizer re-joins and re-tokenizes, honouring quotes and spaces unlike `+set`.
That is exactly why the address behind it can never be handed over as-is: it may have come from a
master's reply or from something the user typed, both foreign to this process, and the concept's
own security note (§10.1) is explicit that an unvalidated address is a way to inject extra tokens
into the argument vector the launcher hands to the game. This story is the first caller of [[107]]'s
validator for that reason — the check runs before the address is ever part of `LaunchInput.connect`,
with no path that skips it.

Joining is not just "start the process": the server may be running a mod the active installation
does not have, and may require a password. Both are things the game itself would otherwise fail on
mid-connect, silently or with a cryptic console message — the launcher already knows both facts from
the scan that produced the list, so it can say so first. A mod mismatch is a warning the user can
still override (the server might be fine, or the user may be about to install the mod separately);
a password is not optional to skip, since the connect attempt cannot succeed without it.

Every successful join is also the moment [[113]]'s history store gets its one and only writer: the
launcher composed the `+connect` itself, so it is the one place that genuinely knows a join
happened, as opposed to a server merely being looked at in the list or detail view.

This story uses the **active installation** — the one the rest of the launcher already treats as
"the" installation to act on — the same way `launch:start` does everywhere else it is called.

## Acceptance Criteria

- [ ] **AC1** — Joining a server from the list ([[118]]) or the detail view ([[122]]) calls
      `launch:start` against the active installation with a `connect` value that reaches
      `buildLaunchArgs` and produces a trailing `+connect <host>:<port>` argument, matching the
      existing behaviour of `launch-plan.ts`.
- [ ] **AC2** — The address is passed through [[107]]'s validator before it is placed into
      `LaunchInput.connect`; an address that fails that validation is refused with a reason and the
      join never reaches `launch:start` — there is no code path where an unvalidated address reaches
      the argument vector.
- [ ] **AC3** — When the server's reported mod (`gamename`/`gamedir`/`game`) differs from the active
      installation's mod, the launcher shows a warning naming the mismatch before launching, and the
      user can choose to launch anyway; no mismatch launches silently.
- [ ] **AC4** — When the server's `needpass` bit 0 is set, the launcher asks for a password before
      launching; the password prompt happens before `launch:start` is ever called, never as a retry
      after a failed connect.
- [ ] **AC5** — A successful join is recorded into [[113]]'s history store, and only a successful
      join is — a join that was refused at address validation (AC2) or abandoned at the password
      prompt is not recorded.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 125`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 125`. -->

## Model Hints

<!-- Filled by `/refine 125`. -->

## Acceptance Tests

<!-- Filled by `/refine 125`. -->

## Done

<!-- Filled by `/build 125`. -->
