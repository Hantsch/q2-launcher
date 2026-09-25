---
id: 126
title: i spectate without picking a side
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — Spectating a server reuses [[125]]'s join flow — active installation, [[107]]'s
      address validation ahead of the argument vector, mod-mismatch warning, history recording via
      [[113]] — with a different launch-parameter composition (spectator mode) rather than a
      separate implementation path.
- [x] **AC2** — When the server's `needpass` bit 1 (spectator password) is set, the launcher asks for
      that password before launching, the same way [[125]]'s AC4 asks for the join password.
- [x] **AC3** — The spectator password never appears in the spawned game process's argument vector —
      it reaches the game through the same mechanism as [[125]]'s AC6.

## Open Questions

- [x] ~~**Q1 — Spectator launch parameters per engine.** (concept open point #6)~~ resolved from the
      3.20 source, see Requirement. What is left (confirming r1q2/Q2PRO) is research for
      `/refine`, not a user question.

## Decisions (Sprint)

- **(User)** Q1 — spectating means the `spectator` userinfo cvar set to `1`, or to the spectator
  password when `needpass` bit 1 is set (3.20 source, see Requirement); binding (2026-09-25, planning).
- **Engines confirmed (refine research, 2026-09-25):** r1q2 (`tastyspleen/r1q2-archive`
  `client/cl_main.c` `CL_InitLocal`) and Q2PRO (`q2pro/q2pro` `src/client/main.c` `CL_InitLocal`)
  both register `password` and `spectator` as `CVAR_USERINFO`, unchanged from 3.20, and send the
  current userinfo with the connect packet — so one composition serves both engines; no per-engine
  branch.
- **`spectator` always travels through [[125]]'s out-of-argv channel, even when it is only `1`.**
  One path for the value means there is no branch where a password could fall back to `+set`.
- **Spectate never sets `password`, and prompts only on `needpass` bit 1.** 3.20's `ClientConnect`
  checks `spectator_password` instead of `password` when a spectator is requested, so bit 0 is
  irrelevant to a spectate and prompting for it would be asking for a secret the game ignores.
- **The spectator bit is a new field, `ServerListEntry.spectatorPass`, and `needpass` is left as it
  is.** Today `scan-service.ts` maps only `'1'`/`'0'` and drops `'2'`/`'3'`. [[125]] owns bit 0
  (`needpass`, the row's password marker from [[118]]), so this story adds bit 1 next to it
  instead of changing a field another story owns.
- **Spectate is recorded in [[113]]'s history exactly like a join.** AC1 lists history recording
  as part of the reused flow, and the user did connect to that server.
- **The Spectate action sits next to Join** in the list row ([[118]]) and the detail view's
  Actions section ([[122]], concept §9 item 7). It is a sibling trigger into the same flow, not a
  second flow.
- **The spectator password prompt reuses [[125]]'s prompt component** and uses its own i18n keys
  ("Spectator password"), so a user can tell which of the two passwords is being asked for.

## Plan

Spectate is [[125]]'s join flow with a `mode: 'spectate'`. Nothing else is forked. Build order
125 → 126, so every [[125]] piece named here exists when this is built. The D texts name the role
(join flow, prompt, out-of-argv carrier) and tell the implementer to use the name 125 actually
gave it.

1. [x] **Data (D1)** — read `needpass` as an integer bitfield in `scan-service.ts`
   `readServerInfoFields` and expose bit 1 as `ServerListEntry.spectatorPass?: boolean`, falling
   back to the existing value like the other fields.
2. [x] **Composition (D2, main)** — the launch input 125 extended for the join password gains a
   spectate flag (`spectate?: true`, zod in `ipc-schemas.ts`). When it is set, main's composition
   puts `spectator = <spectatorPassword> ?? '1'` into [[125]]'s out-of-argv userinfo carrier and
   sets no `password`. `+connect` stays last and unchanged. The composition is a pure, unit-tested
   function next to 125's.
3. [x] **Trigger (D3, renderer + e2e)** — a Spectate action beside Join (row + detail). It calls
   125's join flow with `mode: 'spectate'`: the same address validation ([[107]]), mod-mismatch
   warning, `launch:start` and history write ([[113]]). The only differences are that the prompt
   is keyed on `spectatorPass` with the spectator i18n keys, and `spectate: true` is sent. There is
   one e2e flow for it.

Files: `src/main/modules/servers/scan-service.ts`, `src/shared/modules/servers.ts`,
`src/shared/types/launch.ts`, `src/shared/ipc-schemas.ts`, 125's composition module (under
`src/main/services/`), 125's join-flow hook/component and prompt in
`src/renderer/src/modules/servers/`, the servers row + detail view, `i18n/locales/en`, and
`scripts/flows/servers-spectate.mjs`.

## Deliverables

- **D1 — the spectator-password bit reaches the list entry.** In
  `src/main/modules/servers/scan-service.ts` `readServerInfoFields` (~line 137), parse
  `serverinfo.needpass` as a base-10 integer. When it is a finite integer ≥ 0, set
  `spectatorPass = (n & 2) !== 0`. Otherwise `undefined`, which falls back to
  `existing?.spectatorPass` like the other fields. Add `spectatorPass?: boolean` to
  `ServerListEntry` in `src/shared/modules/servers.ts` (~line 512) with a one-line doc comment:
  "`needpass` bit 1: the server requires a spectator password". Do **not** change how `needpass`
  (bit 0) is derived; story 125 owns that field. Tests go in
  `src/main/modules/servers/scan-service.test.ts` (mirror the existing serverinfo-field tests):
  `'2'`/`'3'` → `true`, `'0'`/`'1'` → `false`, garbage/absent keeps the previous value.
- **D2 — spectate composition, password out of argv.** Story 125 built (a) a launch-input field
  carrying the join password to main and (b) a main-side mechanism that hands userinfo cvars to
  the game outside the argument vector, before the trailing `+connect` (find both via
  `src/shared/types/launch.ts` `LaunchInput`, `src/shared/ipc-schemas.ts` `launchInputSchema`,
  and 125's composition code under `src/main/services/`, e.g. next to `launch-plan.ts`). Extend
  them:
  - `LaunchInput` gets `spectate?: true`, and the zod schema gets `spectate: z.literal(true).optional()`.
  - The password field 125 added carries the spectator password when `spectate` is set (reuse
    it, no second secret field).
  - The composition: with `spectate`, emit userinfo `spectator` = the password if one was given,
    else `'1'`, through **125's carrier** (never `+set` in argv, not even for `'1'`), and emit no
    `password` cvar. Without `spectate`, behaviour is byte-for-byte 125's.
  - `+connect <host>:<port>` stays the last argument, from `buildLaunchArgs`.

  Tests go in 125's composition test file (or `src/main/services/launch-plan.test.ts` if 125 put
  it there):
  - spectate with a password: the argv contains neither the password nor `spectator`, and the
    carrier holds `spectator` = the password.
  - spectate without a password: the carrier holds `spectator` = `'1'`.
  - spectate never emits `password`.
  - join without `spectate` is unchanged.
- **D3 — Spectate action, same flow.** Add a **Spectate** action next to 125's Join, in the server
  list row (`src/renderer/src/modules/servers/`, wherever 125 put Join) and in the detail view's
  Actions section. It calls **125's join-flow function/hook with `mode: 'spectate'`**. Add the
  mode parameter there rather than copying the flow. In spectate mode the flow:
  - runs the same [[107]] address validation, mod-mismatch warning, `launch:start` call and
    history write as join;
  - prompts for a password only when `entry.spectatorPass === true`, ignoring `needpass`, using
    125's prompt component with new keys `servers.spectate.passwordTitle`/`passwordLabel`;
  - sends `spectate: true` (plus the password in 125's field when one was entered);
  - records nothing if the prompt is cancelled or validation refuses.

  Add `servers.spectate.action` ("Spectate") and the prompt keys to
  `src/renderer/src/i18n/locales/en/`. Put the unit test in 125's join-flow test file:
  "spectate goes through the join flow" (mode branch: `spectatorPass` prompt, `spectate: true`
  sent, mod warning shown). Add the e2e flow `scripts/flows/servers-spectate.mjs`, mirroring
  125's join flow (its argv-logging game stub and loopback UDP responder, cf.
  `scripts/flows/servers-scoped-refresh.mjs` `bindResponder`, with `\needpass\2` in the info
  line). The flow:
  - clicks Spectate on the row;
  - asserts that the spectator prompt appears before any spawn, and enters `s3cret`;
  - asserts the stub's argv ends `+connect 127.0.0.1:<port>` and contains no `s3cret` token
    anywhere;
  - asserts 125's carrier holds `spectator` `s3cret`;
  - asserts a history entry exists for the address.

## Model Hints

- D1, D2, D3 → default. The risky mechanism (keeping the password out of argv) is [[125]]'s and
  is already built and tested when this story is built. This story only adds one value to it.
- Review: → default. The wrong implementations that look plausible are a duplicated spectate
  flow, the password on `+set`, and prompting on bit 0. The e2e argv assertion, the "spectate
  goes through the join flow" unit test and D1's bit tests catch these, and so does a
  diff-reading default review.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-spectate.mjs` › "servers-spectate" (Spectate from the row
  launches the active installation with a trailing `+connect`, history entry written) + unit in
  125's join-flow test file › "spectate goes through the join flow" (same validation, mod-mismatch
  warning and `launch:start` path, mode only changes prompt + `spectate` flag) — D3; composition
  unit › "join without spectate is unchanged" — D2.
- AC2 → unit `src/main/modules/servers/scan-service.test.ts` › "needpass bit 1 sets
  spectatorPass" — D1; e2e `scripts/flows/servers-spectate.mjs` › "servers-spectate" (spectator
  prompt appears before any spawn on a `needpass 2` server) — D3.
- AC3 → unit in 125's composition test file › "spectate password never reaches argv" — D2; e2e
  `scripts/flows/servers-spectate.mjs` › "servers-spectate" (stub argv contains no `s3cret`, the
  carrier does) — D3.

## Done

Spectate reuses 125's join flow with `mode: 'spectate'`: same address validation (107), mod-mismatch
warning and history recording (113), only the launch-parameter composition and password gating
differ. `ServerListEntry.spectatorPass` (needpass bit 1) is derived in `scan-service.ts` next to
bit 0; `LaunchInput.spectate?: true` makes `resolveEffectiveUserinfo` in `launch-plan.ts` route the
password (or `'1'`) into `spectator` via 125's cfg-file carrier, never `password`, never argv. The
renderer's `JoinServerButton` gained a `mode` prop instead of a fork; Spectate sits next to Join in
the list toolbar and the detail header.

**Commit message:**
```
126: i spectate without picking a side
```

**Verification (narrow gate):**
- `npm run build`, `npm run typecheck` — green (also re-run after the review-fix, still green).
- `npx vitest run --changed HEAD` — 2338 tests, all story-relevant ones passed; 2 unrelated
  pre-existing flaky timeouts (`ServersSettingsSection.test.tsx`, `downloads/bootstrap/job.test.ts`),
  confirmed unrelated by re-running the four AC-relevant files in isolation (74/74 passed).
- `npm run ui:flow -- servers-spectate` — green: spectator prompt before spawn, argv ends
  `+exec q2launcher-connect.cfg +connect …` with no password anywhere, cfg carries `spectator` not
  `password`, history entry recorded.
- AC → test mapping, all verified passing: AC1 → e2e `servers-spectate` + `JoinServerButton.test.tsx`
  "spectate goes through the join flow" + `launch-plan.test.ts` "join without spectate is unchanged".
  AC2 → `scan-service.test.ts` "needpass bit 1 sets spectatorPass" + e2e (prompt before spawn on a
  `needpass 2` server). AC3 → `launch-plan.test.ts`/`launch.test.ts` "spectate password never reaches
  argv" + e2e (no password in argv/log, carrier holds it). No `manual residue`.
- Review: default (Sonnet, stage 1 only per Model Hints) — PASS, no forked flow found, bit 0 untouched,
  password never in argv/log. One non-blocking nit: `useLauncher.ts`'s `play()` options type hadn't
  been widened with `spectate?: true` (worked at runtime via spread, just a stale type) — fixed
  directly and re-typechecked green; no second review cycle needed.

**Decisions:**
- Mismatch dialog copy ("Join anyway"/cancel) stays shared between join and spectate modes, per the
  D3 text only requiring the *password*-prompt keys to differ — flagged by review as worth a look but
  out of scope for this story.
- `scripts/lib/fixture.mjs`'s `writeJoinFixture` gained an optional `variant` param (default preserves
  125's existing caller) so `servers-spectate.mjs` reuses it instead of duplicating fixture setup.

tiers: D 3 / hard 0 · review default · cycles 0 (1 direct nit-fix, no re-review) · agents 5