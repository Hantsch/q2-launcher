---
id: 326
title: Platform decisions in playback stay behind the seam
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-005 and TD-023: platform decisions in the playback channel leak outside its seam,
and the X11 stage keeper drops fire-and-forget X errors, supports only the Local/Wild auth families,
reports park geometry as placed and has a cinema ABOVE ordering edge. Linux is an additional target
(story 276): this story makes the code honest; Linux results stay advisory.

## Acceptance Criteria

- [x] **AC1** — No file outside the playback channel's platform seam branches on `process.platform`
      for playback; a check enforces it (TD-005).
- [x] **AC2** — An X error from a fire-and-forget request is logged with its request (TD-023).
- [x] **AC3** — The stage keeper reports a parked window as parked, not placed (TD-023).
- [x] **AC4** — An unsupported X auth family is refused with a named reason instead of failing
      silently (TD-023).
- [x] **AC5** — Rows TD-005 and TD-023 are removed from `docs/TECH-DEBT.md`; what only a real X11
      session can show is manual residue for the local Linux run.
- [x] **AC6** — Cinema entered before the X11 keeper has found the game window still shows its
      overlay above the game once the keeper sets the game's ABOVE (TD-023; user decision "fix it").

## Open Questions

~~Cinema ABOVE ordering: fix it, or keep it as a documented limitation?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** cinema ABOVE ordering: fix it
- AC6 is added for the user's "fix it" decision, so the fix has a criterion and a test like every
  other TD-023 part.
- The seam is `src/main/modules/replays/playback-channel/`: one `playbackChannelPlan(platform,
engine)` there decides channel kind, early start and pipe use, because those three are the playback
  branches that today live in `playback-control.ts` and `demo-play.ts`.
- The AC1 check is a rule in `src/architecture.test.ts` (CLAUDE.md: layering is enforced there) with
  an allowlist naming stories: `stage.ts` (window system, story 170) and `discovery.ts` (Q2PRO write
  dir, story 160) are stage/discovery decisions, not playback-channel ones.
- `index.ts` keeps its annotated `process.platform` reads: injecting the host platform is not a
  branch, and the existing `platform-read:` guard in `scripts/platform-assertions.test.mjs` covers it.
- Fire-and-forget X errors are logged and do not end the keeper, because a BadWindow on a late
  request when the game closes is benign; the request is named from the error packet's major opcode
  (already decoded by `readPacket`), so no sequence bookkeeping is added.
- An unsupported auth family is refused, not supported: the AC asks for the refusal, and
  FamilyInternet matching would need host-to-address resolution no current user path needs (Linux is
  advisory, story 276).
- The refusal applies only when no Local/Wild cookie matches but an MIT cookie for the display number
  exists in another family; with no candidate at all the connect stays unauthenticated as today, so
  servers that accept without auth keep working.
- Failure causes stay log-only (`stage keeper gave up: <key> <params>`); the UI keeps the one
  `replays.stage.notOnTop.x11` notice as story 198 decided, so no new i18n key is needed.
- Parked vs placed: the follower reports a park through a new `windowState.parked(geometry)`; the
  keeper still re-places an adopted window at the last reported geometry either way, because story 198
  Q3 kept the park unchanged and inventing new stacking behaviour is out of scope.
- The ABOVE ordering fix raises the cinema overlay after every ABOVE add the keeper writes
  (`app.cinemaWindow.raise()` is already a no-op when the overlay is closed) — story 198's Q4 rule
  "raise the overlay after the game's pin" applied to the late adopt.
- No D is marked `deliverable-hard` and the review stays default: the one subtle point (raise after,
  not before, the ABOVE add) is pinned by an explicit order assertion in D3's test.

## Plan

1. **D1 — playback seam + guard.** New `playback-channel/plan.ts` decides channel kind, early start
   and pipe use per platform/engine; `playback-control.ts` and `demo-play.ts` consume it and lose
   their platform literals; `src/architecture.test.ts` forbids platform branches in
   `src/main/modules/replays/` outside the seam (allowlist: `stage.ts`, `discovery.ts`).
2. **D2 — X11 connection honesty.** Errors for requests sent without a reply go to a new
   `onStrayError` option with the request's name; a display whose only matching cookie is in an
   unsupported Xauthority family is refused with `x11.authFamilyUnsupported`. `index.ts` logs both.
3. **D3 — keeper: parked + ABOVE order.** The follower reports `parked(geometry)` vs
   `placed(geometry)`; the keeper calls `onAboveApplied` after each ABOVE add; `index.ts` wires it to
   `app.cinemaWindow.raise()`.
4. **D4 — docs.** `docs/systems/replays-module.md` and removal of the TD-005 / TD-023 rows.

Order: D1, then D2, then D3 (D2 and D3 both touch `index.ts` and `stage-window.ts`), D4 last.
Real-X effects stay manual residue for the local Linux run (story 198 Q5: no Xvfb harness).

## Deliverables

- **D1 — Playback platform decisions live in the playback-channel seam.**
  Files: new `src/main/modules/replays/playback-channel/plan.ts` + `plan.test.ts`;
  `src/main/modules/replays/playback-control.ts`; `src/main/modules/replays/demo-play.ts`;
  `src/architecture.test.ts`.
  - `plan.ts` exports `playbackChannelPlan(platform: string, engine: DemoPlayEngine)` →
    `{ kind: 'engine-less' | 'windows' | 'pipes'; startsEarly: boolean; usesPipes: boolean }`:
    r1q2 → engine-less, no early start, no pipes; q2pro on `win32` → windows, starts early, no pipes;
    q2pro elsewhere → pipes (the Linux channel), no early start, uses pipes. These are exactly today's
    branches at `playback-control.ts:245-257` and `demo-play.ts:310`; behaviour must not change.
  - `playback-control.ts` `prepare` builds its channel from `plan.kind` and sets `startedEarly` from
    `plan.startsEarly` (keep the `deps.platform ?? process.platform` default and its `platform-read:`
    comment). `demo-play.ts` sets `pipes` from `plan.usesPipes`; `deps.platform` stays for
    `demoPlayEligibility`, which only passes it on.
  - `src/architecture.test.ts`: new `it('playback platform decisions branch only inside the playback
channel seam')` — every non-test file under `src/main/modules/replays/` (via `listSourceFiles`,
    `isTestFile`, `readRepoFile` from `src/test-support/source-tree.ts`; ignore comments with that
    file's lexer if it exposes one) that contains a `'win32'`, `'linux'` or `'darwin'` literal or calls
    `isWindows(` / `isLinux(` must lie under `src/main/modules/replays/playback-channel/` or be on an
    allowlist whose entries carry a story number: `src/main/modules/replays/stage.ts` (story 170) and
    `src/main/modules/replays/discovery.ts` (story 160). Shape the allowlist like the file's existing
    allowlists so their generic "names an existing story" / "still matches" checks apply where they
    are generic.
  - Test: `plan.test.ts` › "r1q2 plays engine-less, q2pro on win32 starts early over the Windows
    channel, q2pro elsewhere talks over the pipes". Existing `playback-control.test.ts` and
    `demo-play.test.ts` stay green unchanged.

- **D2 — The X11 connection names stray errors and refuses an unsupported auth family.**
  Files: `src/main/modules/replays/x11/connection.ts` + `connection.test.ts`;
  `src/main/modules/replays/x11/xauth.ts` + `xauth.test.ts`; `src/main/modules/replays/x11/wire.ts`
  (+ `wire.test.ts` for the name helper); `src/main/modules/replays/x11/stage-window.ts` (failure
  params only); `src/main/modules/replays/index.ts` (wiring in `beginKeptSession`).
  - Stray errors: `readPacket` already yields `majorOpcode` for an error packet. Add to `wire.ts`
    `requestName(majorOpcode: number): string` for the core opcodes this client encodes
    (ConfigureWindow 12, InternAtom 16, ChangeProperty 18, GetProperty 20, SendEvent 25,
    QueryExtension 98), otherwise `opcode <n>` (the X-Resource extension opcode is dynamic). In
    `connection.ts` `drain`, an error whose sequence has no pending entry calls a new optional
    `ConnectX11Options.onStrayError?: (e: { request: string; code: number; sequence: number;
badValue: number }) => void` and does not fail the connection. Rewrite the `request` doc comment
    ("dropped" → reported through `onStrayError`).
  - Auth family: `xauth.ts` gets a pure helper (or a richer `pickCookie` result) that, when no
    FamilyLocal/FamilyWild MIT-MAGIC-COOKIE-1 entry matches but one with the same display number (or
    an empty number) exists in another family, reports that family. `connectX11` then returns
    `fail('x11.authFamilyUnsupported', { family })` without creating the socket. No matching entry at
    all keeps today's unauthenticated connect; an unreadable file stays "no auth".
  - `stage-window.ts`: `onFailure(cause, params?)` also passes the failing outcome's params.
  - `index.ts` `beginKeptSession`: pass `onStrayError` to `connectX11`, logging
    `x11 error <code> on <request> (seq <n>)` with `log.warn`; the existing
    `stage keeper gave up: <cause>` log line appends the params when present.
  - Tests: `connection.test.ts` › "an X error for a request sent without a reply is reported with
    that request's name" (the fake socket answers an `expectsReply: false` request with an error packet
    of major opcode 18; the callback gets `request: 'ChangeProperty'`, and a later request still works)
    and › "a display whose only matching cookie has an unsupported family is refused with that family"
    (Xauthority fixture with a FamilyInternet entry for display 0 only; outcome
    `x11.authFamilyUnsupported` with `{ family: 0 }`, no socket created); `xauth.test.ts` covers the
    helper's Local/Wild/other/none cases.

- **D3 — The keeper is told parked vs placed, and the cinema overlay stays above the ABOVE game.**
  Files: `src/main/modules/replays/stage-follow.ts` + `stage-follow.test.ts`;
  `src/main/modules/replays/stage-follow-session.ts` (only if it restates the `windowState` type);
  `src/main/modules/replays/x11/stage-window.ts` + `stage-window.test.ts`;
  `src/main/modules/replays/index.ts` (wiring in `beginKeptSession`).
  - `StageFollowerDeps.windowState` gains `parked(geometry: string): void`. In `flush`, a sent
    geometry with `sentIsPark` true calls `parked(sentGeo)`, otherwise `placed(sentGeo)`; the launch
    geometry stays `placed`. Update the interface doc (today: "every geometry … through `placed`").
  - `X11StageWindow` implements `parked(geometry)`: it records the geometry as `placed` does, so a
    window adopted while parked is re-placed at the park geometry — no new stacking logic.
  - New option `X11StageWindowOptions.onAboveApplied?: () => void`, called after the ABOVE **add**
    SendEvent was written successfully (in `applyTop`, after `await send(...)` returned non-null with
    the applied value 1), including the first add on adopt; never for a remove, never once stopped.
  - `index.ts` `beginKeptSession`: `onAboveApplied: () => app.cinemaWindow.raise()` (raise is a no-op
    while the overlay is closed — `src/main/cinema-window.test.ts` already proves that).
  - Tests: `stage-follow.test.ts` › "a park is reported to the window keeper as parked and a placement
    as placed"; `stage-window.test.ts` › "a window found while parked is re-placed at the park
    geometry" and › "the ABOVE add is written before the overlay is raised, and a remove raises
    nothing" (record the fake connection's SendEvent and the hook call in one ordered log).

- **D4 — Docs follow the code.** Files: `docs/systems/replays-module.md`, `docs/TECH-DEBT.md`.
  - Systems doc: the playback-channel seam owns every playback platform decision (`plan.ts`) and the
    `src/architecture.test.ts` rule guards it; the X11 keeper logs stray errors by request, refuses an
    unsupported auth family by name, is told parked vs placed, and re-raises the cinema overlay after
    each ABOVE add. Drop any limitation line these fixes make untrue.
  - Remove rows TD-005 and TD-023 from `docs/TECH-DEBT.md`; touch no other row.

## Model Hints

- D1–D4 → default tier (no `deliverable-hard`).
- Review: → default

## Acceptance Tests

- AC1 → unit `src/architecture.test.ts` › "playback platform decisions branch only inside the
  playback channel seam"; unit `src/main/modules/replays/playback-channel/plan.test.ts` › "r1q2 plays
  engine-less, q2pro on win32 starts early over the Windows channel, q2pro elsewhere talks over the
  pipes" (D1)
- AC2 → unit `src/main/modules/replays/x11/connection.test.ts` › "an X error for a request sent
  without a reply is reported with that request's name" (D2); manual residue: the log line from a real
  X server error — needs a real X11 session, no Xvfb harness (story 198 Q5).
- AC3 → unit `src/main/modules/replays/stage-follow.test.ts` › "a park is reported to the window
  keeper as parked and a placement as placed"; unit `src/main/modules/replays/x11/stage-window.test.ts`
  › "a window found while parked is re-placed at the park geometry" (D3); manual residue: whether a
  real WM clamps the parked window on-screen — needs a real X11 WM (story 198 Q3/Q5).
- AC4 → unit `src/main/modules/replays/x11/connection.test.ts` › "a display whose only matching cookie
  has an unsupported family is refused with that family" (D2)
- AC5 → doc check by D4: `grep -n "TD-005\|TD-023" docs/TECH-DEBT.md` finds nothing (recorded in
  Done); the manual residues on AC2, AC3 and AC6 are the local Linux run's list.
- AC6 → unit `src/main/modules/replays/x11/stage-window.test.ts` › "the ABOVE add is written before
  the overlay is raised, and a remove raises nothing" (D3); manual residue: the overlay visibly above
  the ABOVE game on a real X11 WM (story 198 Q5).

## Done

Playback platform decisions now live in `playback-channel/plan.ts`, guarded by an architecture rule. The X11 keeper logs stray
X errors by request name, refuses an unsupported Xauthority family by name, is told parked vs placed, and re-raises the cinema
overlay after each ABOVE add. TD-005 and TD-023 rows removed; replays-module.md updated within its 150-line cap.

Commit message: `326: playback platform decisions behind plan.ts + architecture guard, X11 keeper stray-error log, auth-family refusal, parked vs placed, cinema raise after ABOVE, TD-005/TD-023 closed`

Decisions:

- Architecture allowlist (stage.ts story 170, discovery.ts story 160) is local to the new `it`, checking the story file exists and the branch still matches.
- `onFailure` now passes outcome params; one existing stage-window assertion tightened to `('x11.requestFailed', { code: 5 })`.
- Fixed TD-059's stale link (requirements/321 -> requirements/done/321) because it broke `check:docs`; no other TD row touched.
- Changelog: no user-facing change, no entry.

Verification (narrow gate): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` 23 files / 369 tests green; `npm run check:docs` green after the TD-059 link fix; `grep TD-005|TD-023 docs/TECH-DEBT.md` empty. No e2e-story mapped (no UI surface). Full gate pending (sprint). Review 1 (default): PASS, no blocking findings.
AC -> test: AC1 architecture.test.ts + plan.test.ts; AC2/AC4 connection.test.ts; AC3 stage-follow.test.ts + stage-window.test.ts; AC5 grep; AC6 stage-window.test.ts ABOVE order — all passed.
Manual residue (local Linux run, real X11, story 198 Q5): X error log line from a real server (AC2); real WM clamping the parked window (AC3); overlay visibly above the ABOVE game (AC6).
Unfixed minor: docs/ARCHITECTURE.md:660-666 keeper description lacks the new behaviours (plan named only replays-module.md).

tiers: D 4 / hard 0 · review default · cycles 1 · agents 6
