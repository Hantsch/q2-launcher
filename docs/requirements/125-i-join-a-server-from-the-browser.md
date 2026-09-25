---
id: 125
title: i join a server from the browser
status: ready # draft -> ready -> in-progress -> done
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

The password reaches the game as the `password` userinfo cvar (vanilla 3.20 `cl_main.c` registers
it with `CVAR_USERINFO`; the game DLL's `ClientConnect` compares it with the server's `password`).
It must never be a shell-visible process argument — `+set password <pw>` on the command line is
exactly that. The mechanism this story builds to hand it over is the one [[126]] reuses for the
spectator password.

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
- [ ] **AC6** — The join password never appears in the spawned game process's argument vector; it
      still reaches the game as the `password` userinfo cvar before the `+connect` runs.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **(User)** Does the "never a shell-visible argument" rule from [[126]] also apply to the join
  password: **yes, for both** — this story builds the mechanism (AC6), [[126]] reuses it
  (2026-09-25, planning).
- **The password goes through a one-shot cfg file that the game execs, not through argv.** The
  launcher writes `baseq2/q2launcher-connect.cfg` (`set password "<pw>"`) and emits
  `+exec q2launcher-connect.cfg` right before `+connect`. Late commands run in order and an exec'd
  file's text is inserted ahead of the rest of the buffer, so the userinfo cvar is set before the
  connect. r1q2 and Q2PRO have no stdin or environment channel, so a file is the only route left.
- **The mechanism is launch-level and generic: `LaunchInput.userinfo?: { password?; spectator? }`.**
  It rides on the existing `launch:start` channel, so there is no new IPC channel. [[126]] sets
  `spectator` (to `1` or the spectator password) through the same field and the same file.
  Pure parts live in `src/shared/launch/userinfo.ts`; the file write and cleanup live in
  `LaunchService.start()`, because only the launch service spawns.
- **A userinfo value is printable ASCII 0x20–0x7e, 1–63 characters, with no `"`, `\` or `;`.** The
  cfg is executed as console commands, so a quote, `;` or newline would inject commands. On top of
  that, `Info_SetValueForKey` refuses `\`, `"` and `;` and values of 64 characters or more. The rule
  is enforced by the zod schema at the IPC boundary and again when the file is rendered.
- **The file lives in `<rootPath>/baseq2/`, is written with mode 0600, and is removed on process
  `exit`/`error`/spawn failure.** `baseq2` is on the search path whatever mod is active. Removing
  the file right after spawn would race the game's own startup exec. When closeAfterLaunch quits
  the launcher, nobody is left to delete it, so every `start()` of that installation first removes
  a leftover file.
- **The address is validated in main at the `launch:start` boundary, and once more in
  `buildLaunchArgs`.** `launchInputSchema.connect` becomes `serverAddressSchema` (107), so no
  renderer caller can skip it. `buildLaunchArgs` re-parses with `parseServerAddress` and drops a
  failing value (`invalid-address`), so no in-process caller can skip it either (concept "validation
  happens in main"). The renderer also pre-checks, so a refusal shows its reason and never calls
  `launch:start` (AC2).
- **`extraArgs` stays out of scope.** It is an existing renderer-supplied array that has nothing to
  do with the join address. AC2 is about the join's `connect` value.
- **The renderer passes the active installation, and `useLauncher.play()` is extended to carry
  `{ connect, userinfo }`.** That is how `launch:start` already resolves "the" installation, and it
  keeps the existing failure toasts and the closeAfterLaunch/minimize behaviour on one path.
- **A "successful join" means the game process was spawned (`phase: 'running'`) for a validated
  `connect`.** The launcher cannot observe the in-game connect. `LaunchState` gains
  `connect?: string`, and the servers module records history from `app.launch.onStateChange`
  (already used by the scan guard). A refused, failed-to-spawn or abandoned join never reaches
  `running` (AC5).
- **Steam handoff plus `connect` is refused with `launch.error.connectNeedsDirectLaunch`.** The
  `steam://` URL cannot carry `+connect`/`+exec`, and launching silently without the connect would be
  a lie. The refusal is stated, not hidden.
- **Mod mismatch rule:** the server mod is `entry.mod` (trimmed, lowercased) and the installation
  mod is `activeGameDir` (empty means `baseq2`). They mismatch when they differ. An unknown server
  mod gives no warning, because there is nothing to name. The warning dialog names both mods and
  offers "Join anyway" or "Cancel". The launch keeps the installation's own mod (the server tells
  the client its gamedir on connect).
- **The password prompt has no empty option and nothing is stored.** Cancel abandons the join. The
  password lives only in the dialog's local state and the one `launch:start` payload. It is never
  put into a store, `state.json` or a log line.
- **Without an active installation, Join stays visible and disabled, with visible reason text**
  (`servers.join.noInstallation`), following the CLAUDE.md "never silently omitted" pattern.
- **Join sits in two places: the list's selected-row toolbar (next to "refresh selected") and
  [[122]]'s detail header.** Both use one `JoinServerButton`, so the flow cannot drift between them.
- **Platform parity:** a file write and an argv are the same on Windows and Linux, so there is no
  "Not available on …" text. On Linux the wine/umu runner path passes the same cwd, and `+exec`
  resolves relative to the game.

## Plan

Contract first, then main, then renderer. Built after [[122]] (detail view exists) and [[118]].

1. **Shared (D1):** `src/shared/launch/userinfo.ts` holds the value rule, the cfg renderer and
   `CONNECT_CFG_NAME`. `LaunchInput.userinfo` and `LaunchState.connect` are added.
   `launchInputSchema` validates `connect` with `serverAddressSchema` and `userinfo` with the new
   primitive. Locale keys are added.
2. **Launch service (D2, hard):** `buildLaunchArgs` re-validates `connect` and emits `+exec` before
   `+connect` when userinfo is present. `plan()` refuses handoff plus connect. `start()` removes a
   leftover cfg, writes the new cfg (0600), spawns, carries `connect` in state, and removes the cfg
   on exit/error/spawn failure.
3. **History (D3):** the servers module listens to `app.launch.onStateChange` and records a visit
   once per `running` state that carries `connect`.
4. **Join flow (D4):** a pure `join-flow.ts` (mod mismatch, needs password), a
   `JoinServerButton` plus dialogs (mismatch confirm, password prompt), and `useLauncher.play`
   carrying `{connect, userinfo}`. The button goes into the list's selected-row toolbar.
5. **Detail placement plus e2e (D5):** the button goes into 122's header, and one flow
   `servers-join` against loopback responders and a spawnable stand-in game proves AC1–AC6 on the
   real surface.

For [[126]]: reuse `LaunchInput.userinfo.spectator` (already in the D1 contract), `renderConnectCfg`
and D2's write/cleanup unchanged. 126 only adds the value and its prompt, with no new channel.

Out of scope: spectate ([[126]]), address book ([[127]]), `extraArgs` hardening, choosing another
installation that has the server's mod.

## Deliverables

- **D1 — contract and pure userinfo rule (shared).**
  - Create `src/shared/launch/userinfo.ts` with a colocated `userinfo.test.ts`:
    - `export type LaunchUserinfo = { password?: string; spectator?: string }`.
    - `export const CONNECT_CFG_NAME = 'q2launcher-connect.cfg'`.
    - `parseUserinfoValue(value): { ok: true } | { ok: false; reason: 'empty' | 'too-long' | 'forbidden-character' }`.
      The rule: 1–63 characters, each 0x20–0x7e, none of `"` `\` `;`. No trimming; the value is
      used verbatim.
    - `userinfoRejectionKey(reason)` returns `launch.userinfo.reject.<reason>`.
    - `renderConnectCfg(userinfo): string` returns a header comment line
      (`// written by Q2 Launcher for one launch, removed when the game exits`), then
      `set password "<v>"` and `set spectator "<v>"` in that fixed order, only for present keys,
      each ending in `\n`. It throws if any value fails `parseUserinfoValue` (defence in depth).
  - `src/shared/types/launch.ts`: add `LaunchInput.userinfo?: LaunchUserinfo` (doc: "set via a
    one-shot exec'd cfg, never argv; story 125, reused by 126") and `LaunchState.connect?: string`.
    Update `connect`'s doc comment.
  - `src/shared/schemas.ts`: add `launchUserinfoValueSchema`, a `z.string().superRefine` over
    `parseUserinfoValue` with the reason as the message. Mirror `serverAddressSchema` in the same
    file.
  - `src/shared/ipc-schemas.ts`: in `launchInputSchema`, `connect: serverAddressSchema.optional()`
    and `userinfo: z.object({ password: launchUserinfoValueSchema.optional(), spectator: launchUserinfoValueSchema.optional() }).strict().optional()`.
  - `src/renderer/src/i18n/locales/en.json`: add `launch.userinfo.reject.{empty,too-long,forbidden-character}`
    and `launch.error.connectNeedsDirectLaunch`
    ("This installation launches through Steam, which cannot join a server directly.").
  - Tests:
    - `userinfo.test.ts` › "a userinfo value is printable ASCII without quote, backslash or
      semicolon". This covers accept `hunter2 x`, and reject `""`, 64 characters, `a"b`, `a;b`,
      `a\b`, `a\nb` and `é`, each with its reason.
    - `userinfo.test.ts` › "the connect cfg sets only the present keys, quoted, in fixed order".
    - `userinfo.test.ts` › "every userinfo rejection has an i18n key" (reads `en.json`, mirroring
      `address.test.ts`). If it reads `en.json` via `node:fs`, exclude it from `tsconfig.web.json`
      the way `address.test.ts` is.
    - `src/shared/ipc-schemas.test.ts` › "launch:start refuses an unvalidated connect or userinfo
      value". This covers `1.2.3.4:27910 +quit`, `evil;quit:27910` and a password `x";quit;"`,
      each refused, and checks that a valid address normalises.
  - Acceptance: `npx vitest run src/shared` passes and `npm run typecheck` is clean.

- **D2 — the launch service hands userinfo over without argv (main).**
  - `src/main/services/launch-plan.ts`, `buildLaunchArgs` (the input `Pick` also takes
    `userinfo`):
    - When `connect` is present, re-parse it with `parseServerAddress`. On failure, push
      `{ reason: 'invalid-address', value }` to `dropped` (widen the union) and emit neither
      `+exec` nor `+connect`. On success, use `normalized`.
    - When the address is valid and `userinfo` has any key, push `'+exec', CONNECT_CFG_NAME`
      immediately before `'+connect', address`.
    - Userinfo without `connect` emits nothing.
    - Extend the file's doc comment.
  - `src/main/services/launch.ts`:
    - `plan()`: if the Steam handoff branch would be taken and `input.connect` is set, return
      `fail('launch.error.connectNeedsDirectLaunch')`.
    - `start()`: after the guards and before `plan()`, remove
      `join(installation.rootPath, BASE_GAME_DIR, CONNECT_CFG_NAME)` best-effort (`rm` with
      `force`) to clear a leftover. After a successful plan with userinfo, write
      `renderConnectCfg(input.userinfo)` there with `{ mode: 0o600 }`. On a write error, log it
      without the content and return `fail('launch.error.spawnFailed', …)`.
    - Remove the file (best-effort, idempotent) in the spawn-`catch`, in `'error'` and in `'exit'`.
      Never remove it synchronously after `spawn` returns.
    - Put `connect` (the normalised address) on the `starting` and `running` states.
    - Neither the `launching …` log line nor any other log call may contain a userinfo value.
      That holds by construction, since the args never carry it, and a test asserts it.
  - Files: `launch-plan.ts`, `launch-plan.test.ts`, `launch.ts`, `launch.test.ts` (all
    `src/main/services/`), plus `src/main/lib/fs-utils` only if a helper is needed there.
  - Mirror: the existing `launch.test.ts` mocked-`spawn`/`fakeChild()` tests, and
    `launch-plan.test.ts`'s `dropped` cases.
  - Tests:
    - `launch-plan.test.ts` › "a join puts +exec of the connect cfg right before +connect and no
      password anywhere in argv".
    - `launch-plan.test.ts` › "an address that fails validation is dropped, never emitted".
    - `launch.test.ts` › "a join with a password writes the connect cfg before spawn and the spawned
      argv never contains it". This asserts the file content when `spawn` is called, that no
      `spawn` arg and no logger call contains the password, and that `state.connect` is set.
    - `launch.test.ts` › "the connect cfg outlives spawn and is removed on exit, on error and on
      spawn failure".
    - `launch.test.ts` › "a leftover connect cfg is removed before the next launch".
    - `launch.test.ts` › "a Steam handoff refuses a connect".
  - Acceptance: `npx vitest run src/main/services` passes.

- **D3 — a spawned join is recorded in history (servers module, main).**
  - In `src/main/modules/servers/index.ts` `setup()`, subscribe to `app.launch.onStateChange`.
    On `phase === 'running'` with `state.connect`, persist
    `recordServerVisit(history, { address: state.connect, connectedAt: new Date().toISOString() })`
    through `app.state.setServersState`. Use the same read-one-snapshot, mutate-one-slice pattern
    as the `favourites.*` handlers. Unsubscribe in the module's teardown if it has one. Update the
    "only main ever appends" comment.
  - Files: `src/main/modules/servers/index.ts`, `src/main/modules/servers/index.test.ts`.
  - Mirror: `scan-service.ts`'s `launch.onStateChange` subscription, and the favourites persist
    handlers in the same `index.ts`.
  - Tests:
    - `index.test.ts` › "a running launch with a connect records one history visit". Drive fake
      state changes `starting` → `running` → `exited` and expect exactly one entry.
    - `index.test.ts` › "a launch without connect, a failed launch or a refused join records
      nothing". This covers `failed`, `handed-off`, and `running` without `connect`.
  - Acceptance: `npx vitest run src/main/modules/servers` passes.

- **D4 — the join flow in the list (renderer).**
  - Create `src/renderer/src/modules/servers/join/join-flow.ts` (pure) with `join-flow.test.ts`:
    - `modMismatch(entry, installation): { server: string; installation: string } | null`,
      following the rule under Decisions.
    - `needsJoinPassword(entry)`, which is `entry.needpass === true`.
  - Create `src/renderer/src/modules/servers/join/JoinServerButton.tsx` with
    `JoinServerButton.test.tsx`. It takes a `ServerListRow` and runs these steps in order:
    1. `parseServerAddress(row.address)`. On failure, show the `servers.address.reject.*` text
       inline (`servers-join-refused`) and stop.
    2. Mismatch `Modal` (`servers-join-mismatch`, names both mods, buttons
       `servers-join-mismatch-confirm` and `-cancel`).
    3. Password `Modal` (`servers-join-password`, `<input type="password">` with a live
       `parseUserinfoValue` reason via `userinfoRejectionKey`, submit disabled until valid, cancel
       abandons).
    4. `useLauncher.getState().play(undefined, { connect: normalized, userinfo: pw ? { password: pw } : undefined })`.

    With no active installation, the button is disabled and shows `servers.join.noInstallation`
    as visible text. The password stays in component state only and is cleared on close.
  - `src/renderer/src/store/useLauncher.ts`: `play(installationId?, options?: { connect?: string; userinfo?: LaunchUserinfo })`
    spreads `options` into the `launch:start` payload. The existing call sites are unchanged.
  - In `ServersView.tsx`, render `<JoinServerButton>` for the selected row in the toolbar next to
    `servers-refresh-selected` (testid `servers-join`).
  - `en.json`: add `servers.join.*` (button, mismatch title/body/confirm/cancel, password
    title/label/submit/cancel, noInstallation).
  - Files: `join-flow.ts`, `join-flow.test.ts`, `JoinServerButton.tsx`, `JoinServerButton.test.tsx`,
    `useLauncher.ts`, `ServersView.tsx`, `en.json`.
  - Mirror: `src/renderer/src/components/installations/RenameInstallationDialog.tsx` (a `Modal`
    with a validated text input) and `MasterSourceRow.tsx` (module i18n and testids).
  - Test in `join-flow.test.ts`: "mod mismatch compares the server mod with the active game dir,
    baseq2 for empty". It covers `ctf` vs `''` → mismatch, `BaseQ2` vs `''` → none, and an
    unknown mod → none.
  - Tests (in `JoinServerButton.test.tsx`, with `invoke` mocked):
    - "join calls launch:start with the active installation and the normalised address".
    - "an address that fails validation shows its reason and never calls launch:start".
    - "a mod mismatch warns naming both mods, and join anyway launches". Also: "no mismatch launches
      without a warning", and "an unknown server mod does not warn".
    - "a password server asks before launch:start, and cancel never calls it".
    - "the password goes into userinfo, never into connect or extraArgs".
    - "without an active installation join is disabled with a visible reason".
  - Acceptance: `npx vitest run src/renderer/src/modules/servers src/renderer/src/store` passes.

- **D5 — Join in the detail view, and the e2e proof.**
  - Put `<JoinServerButton>` into [[122]]'s detail header or actions area (the component 122
    created under `src/renderer/src/modules/servers/`), with testid `servers-detail-join`. Update
    that component's test so the button renders.
  - Create `scripts/flows/servers-join.mjs` (flow name `servers-join`):
    - Fixture:
      - No master sources, scan autos off.
      - One active installation whose root is a spawnable stand-in, created by a new
        `writeJoinInstallRoot()` in `scripts/lib/fixture.mjs` mirroring
        `writeLinuxJourneyInstallRoot()`: `baseq2/pak0.pak` plus the vendored 7za.exe on Windows,
        or the `sleep` script on Linux. `activeGameDir` is `''`.
      - Two loopback `dgram` responders run as manual servers: B (`gamename baseq2`, no password)
        and A (`gamename ctf`, `needpass 1`).
    - Steps:
      1. Refresh. Select B, Join. No dialog opens. Wait for the launch state to reach
         `running`/`exited`. `main.log` (the path from `app:getInfo().logPath`) has a
         `launching … +connect 127.0.0.1:<portB>` line. `history.read` (via `module:invoke`)
         lists B first (AC1, AC3 no-mismatch, AC5).
      2. Select A, Join. The mismatch dialog names `ctf` and `baseq2` (AC3). Confirm, and the
         password dialog opens before any new launch-state change (AC4). Cancel. No new
         `launching` line, and history is unchanged (AC4, AC5).
      3. Join A again, confirm, and enter `hunter2 x`. The log's new `launching` line ends in
         `+exec q2launcher-connect.cfg +connect 127.0.0.1:<portA>`. The whole `main.log` does not
         contain `hunter2`. After exit, `<root>/baseq2/q2launcher-connect.cfg` does not exist, and
         history lists A first (AC6, AC5).
    - Take screenshots of the mismatch and password dialogs and of the detail-view Join button.
  - Files: 122's detail component and its test, `scripts/flows/servers-join.mjs`,
    `scripts/lib/fixture.mjs`.
  - Mirror: `scripts/flows/servers-row-markers.mjs` / `servers-scoped-refresh.mjs` (responders,
    seeding, copied not imported) and `scripts/flows/bootstrap-retail-import.mjs` (a flow that
    spawns the stand-in).
  - Acceptance: `npm run ui:flow -- servers-join` passes with its screenshots.

## Model Hints

- D1, D3, D4, D5 → default tier.
- D2 → `deliverable-hard`: it is the new write-before-spawn path in `LaunchService.start()`. There
  the cfg's lifetime is subtle: it must outlive spawn until the game has exec'd it, and it must still
  go away on exit, error and spawn failure. A leftover-sweep is needed as well. The password must
  also stay out of argv and out of every log line across `plan()`, `start()` and the handoff branch.
- Review: → story-review-hard. The plausible wrong implementation is removing the cfg right after
  `spawn()` returns. The mocked-spawn unit tests and the fast-exiting e2e stand-in both pass, yet a
  real r1q2 would never read the password. A second variant is a cleanup that misses the
  spawn-`catch`/`'error'` branches and leaves the password on disk. Neither shows up in a
  spec-plus-diff default pass without reasoning about process timing.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-join.mjs` › flow "servers-join" (joining B produces a
  `launching … +connect 127.0.0.1:<port>` line for the active installation). Also unit
  `src/renderer/src/modules/servers/join/JoinServerButton.test.tsx` › "join calls launch:start with
  the active installation and the normalised address" (D4), and
  `src/main/services/launch-plan.test.ts` › "a join puts +exec of the connect cfg right before
  +connect and no password anywhere in argv" (D2).
- AC2 → unit `JoinServerButton.test.tsx` › "an address that fails validation shows its reason and
  never calls launch:start" (D4). Also `src/shared/ipc-schemas.test.ts` › "launch:start refuses an
  unvalidated connect or userinfo value" (D1), and `launch-plan.test.ts` › "an address that fails
  validation is dropped, never emitted" (D2). There is no e2e line: every list/manual address is
  already validated upstream (107/113), so the real surface cannot produce an invalid one. The three
  layers are proven at unit level.
- AC3 → e2e `scripts/flows/servers-join.mjs` › flow "servers-join" (A warns naming `ctf`/`baseq2`,
  B launches with no dialog). Also unit `JoinServerButton.test.tsx` › "a mod mismatch warns naming
  both mods, and join anyway launches" (D4), and `src/renderer/src/modules/servers/join/join-flow.test.ts`
  › "mod mismatch compares the server mod with the active game dir, baseq2 for empty" (D4).
- AC4 → e2e `scripts/flows/servers-join.mjs` › flow "servers-join" (the password prompt opens with
  no new launch, and cancel launches nothing). Also unit `JoinServerButton.test.tsx` › "a password
  server asks before launch:start, and cancel never calls it" (D4).
- AC5 → e2e `scripts/flows/servers-join.mjs` › flow "servers-join" (history lists B, then A, and
  is unchanged after a cancelled prompt). Also unit `src/main/modules/servers/index.test.ts` › "a
  running launch with a connect records one history visit" and › "a launch without connect, a
  failed launch or a refused join records nothing" (D3).
- AC6 → e2e `scripts/flows/servers-join.mjs` › flow "servers-join" (the `+exec … +connect` line,
  no `hunter2` in `main.log`, and the cfg gone after exit). Also unit `src/main/services/launch.test.ts`
  › "a join with a password writes the connect cfg before spawn and the spawned argv never contains
  it" and › "the connect cfg outlives spawn and is removed on exit, on error and on spawn failure"
  (D2), `src/shared/launch/userinfo.test.ts` › "a userinfo value is printable ASCII without quote,
  backslash or semicolon" and › "the connect cfg sets only the present keys, quoted, in fixed order"
  (D1), and `JoinServerButton.test.tsx` › "the password goes into userinfo, never into connect or
  extraArgs" (D4).

No `manual residue`. Whether a real r1q2 connects with the password is the in-game half. It is
not automatable offline, and it is covered by the D2 lifetime tests plus the hard review, not by a
manual step.

## Done

<!-- Filled by `/build 125`. -->
