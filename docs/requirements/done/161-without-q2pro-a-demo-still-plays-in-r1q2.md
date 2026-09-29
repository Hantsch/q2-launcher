---
id: 161
title: without Q2PRO a demo still plays in r1q2
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user who only has r1q2 installations can still watch their demos — with less control, and told so
(concept `docs/concepts/demo-browser.md` §11.1, DEMO-24, DEMO-25). r1q2 plays protocol-34 demos with
`+demomap name.dm2`; it has **no seek**, but `timescale` and `paused` work during playback (§9.1).
The timeline ([[165]]) then offers play/pause and speed only, with the visible note **"Seeking needs
Q2PRO"**.

Formats r1q2 cannot play are disabled with their reason: MVD2, protocol 343x and oversized-packet
demos ([[136]] records protocol and size facts). `.gz` is decompressed into the temporary copy
([[160]]) rather than disabled — refine confirms (Q2).

On Linux there is no r1q2 at all. Where the engine choice would appear, the fallback is shown as not
available with the reason "Not available on Linux: r1q2 is not supported" (§13, CLAUDE.md
platform-parity rule).

## Acceptance Criteria

> **Scope cut (Sprint S28, user decision below):** the launcher plays demos through Q2PRO only; the
> r1q2 fallback described above is **out of scope** and stays in the concept (DEMO-24, DEMO-25) as
> future work. The original AC1–AC7 (r1q2 `+demomap` launch, "Seeking needs Q2PRO", MVD2/343x/
> oversized/`.gz` on r1q2, Linux r1q2 note, stufftext risk) are withdrawn. The visible reason for a
> non-Q2PRO active installation is owned by [[159]]. What remains is the main-side guarantee that
> the cut holds even when the renderer is bypassed.

- [x] **AC1** — The demo-play IPC handler refuses an installation whose `engineKind` is not
      `q2pro` (r1q2 and every other kind): it returns a typed failure carrying an i18n key, and no
      process is spawned — even when the renderer sends that installation's id directly.
- [x] **AC2** — The demo launch arguments never contain `demomap`, for any engine kind the builder
      is called with.

## Open Questions

- [ ] ~~**Q1 — `demomap` and stufftext.** The concept rejects `demomap` on Q2PRO because it executes~~ answered → Decisions (Sprint)
      stufftext from the demo (§4) — r1q2's only route is `+demomap`. Accept the risk silently, warn
      before playing a demo from an extra folder/archive, or restrict the fallback to the user's own
      demos?
- [ ] ~~**Q2 — `.gz` on r1q2** — decompress into the copy (as AC5 assumes) or disable with reason?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** demomap/stufftext and r1q2 fallback: For now the launcher plays demos through Q2PRO only. No r1q2 playback support: the r1q2 fallback of this story is out of scope. Where Play is unavailable for a non-Q2PRO installation, 159 owns the visible reason. Refine must reduce/cut this story accordingly and record what remains, if anything.

- **Q2 (`.gz` on r1q2):** moot — no r1q2 playback exists after the user's cut, so there is nothing to decompress for; `.gz` handling on Q2PRO stays with [[160]].
- **What remains:** a main-side guard + regression tests only (no UI), because CLAUDE.md says renderer input is never trusted — a disabled Play button in [[159]] does not stop an r1q2 id arriving over IPC, and `demomap` is the stufftext risk the concept (§4) rejects.
- **Not dropped:** kept as a minimal scope-cut rather than dropped, because the guard is a real, testable negative behaviour that no other S28 story names ([[159]] AC4 pins `demomap` for Q2PRO only; AC5 validates the path, not the engine kind).
- **Linux (old AC6):** withdrawn — with no r1q2 engine choice anywhere there is no place to show "Not available on Linux: r1q2 is not supported"; [[159]] AC7 covers Linux without Q2PRO.
- **Timeline ([[165]]):** needs no r1q2 / no-seek mode; "Seeking needs Q2PRO" is not implemented this sprint.
- **Failure key:** reuse [[159]]'s "demo playback needs Q2PRO" i18n key for the refusal rather than adding a second one, so the renderer shows one reason for one condition.

## Plan

Builds on [[159]] (built first): 159 adds the demo-play IPC channel, its main handler and the
Q2PRO demo-args builder (`+set game` / `+demo`) under `src/main/modules/replays/`.

1. In 159's main play handler, after resolving the installation by id, refuse unless
   `installation.engineKind === 'q2pro'` — before any path resolution, copy ([[160]]) or spawn.
   Return 159's typed failure shape with 159's "needs Q2PRO" i18n key.
2. Tests next to the handler / args builder: every non-`q2pro` `engineKindSchema` value is refused
   with no spawn; the args builder output never contains `demomap` for any engine kind.

No renderer, IPC-contract, or locale change (159 owns the channel, the key and the visible reason).

## Deliverables

- **D1 — main refuses non-Q2PRO demo playback, and `demomap` never appears.** Prerequisite: story
  159 is built. Find its demo-play handler and demo-args builder (grep `src/main/modules/replays/`
  for `'+demo'` and for the play channel's handler registration). In the handler, after the
  installation is looked up by id and before any path resolution, temp copy or `LaunchService`
  call, return 159's existing typed failure with its existing "demo playback needs Q2PRO" i18n key
  when `installation.engineKind !== 'q2pro'` (if 159 already does exactly this, add only the
  tests). Do not add an IPC channel, a schema, or a locale key. Tests, in the handler's and the
  builder's existing `*.test.ts` files (mirror their fakes/fixtures):
  - "a non-Q2PRO installation never gets a demo launch" — iterate every value of
    `engineKindSchema.options` (`src/shared/schemas.ts`) except `q2pro`; each returns the failure
    with the needs-Q2PRO key and the fake launcher/spawn is never called.
  - "demo launch args never contain demomap" — call the builder with an installation of each
    `engineKindSchema` value (and a gz/archived demo path if the builder accepts one); assert no
    arg equals or contains `demomap` (case-insensitive).
  Files: 159's play handler `.ts` + its `.test.ts`, 159's args-builder `.test.ts` (≤4 files).

## Model Hints

- D1 → default.
- Review: → default.

## Acceptance Tests

- AC1 → unit, 159's demo-play handler test file under `src/main/modules/replays/` › "a non-Q2PRO
  installation never gets a demo launch"
- AC2 → unit, 159's demo-args builder test file under `src/main/modules/replays/` › "demo launch
  args never contain demomap"
- No e2e: neither criterion is a user action — the user-facing disabled Play with visible reason is
  [[159]]'s e2e flow, and a bypassed renderer cannot be driven through the real surface.

## Done

Main-side guard for the Q2PRO-only cut is pinned by tests. The guard already existed from 159 (`demoPlayEligibility`,
`src/shared/replays/demo-play.ts`, called in `src/main/modules/replays/demo-play.ts` before containment, staging and launch),
so no production code changed. New regression tests only.

Commit: `161: pin main-side Q2PRO-only guard — non-q2pro demo.play refused, demomap never in launch args`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` 33/33 green. No e2e (neither AC is a user action).
- AC1 -> `src/main/modules/replays/demo-play.test.ts` "a non-Q2PRO installation never gets a demo launch" (every non-q2pro engine kind, in-place and staged demo; no start, no `_launcher` dir, no session) passed.
- AC2 -> same file "demo launch args never contain demomap" plus "the real builder never emits demomap for any engine kind, plain or gz demo" (real `buildLaunchArgs` per engine kind); shared test in `src/shared/replays/demo-play.test.ts` passed.
- Review 1 (default): PASS; one finding (builder never called with non-q2pro kinds) fixed with the extra builder test.
- No changelog entry (no user-facing change).

Decisions:
- Guard already existed in 159, so D1 added tests only, per D1's own allowance. Guard runs after the id-based demo lookup (no fs access) and before path resolution/copy/spawn.

tiers: D 1 / hard 0 · review default · cycles 1 · agents 5
