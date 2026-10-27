---
id: 251
title: Launch with applies only when I start the game
status: done # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the footer's "Launch with" (mod) choice only appears where I start the game myself, not
where a server or a demo already decides mod and map.

User feedback 2026-10-26: "Launch with" should only apply to starting the game, not to joining a server
or playing a demo, and should not be shown on Servers and Demos.

Today `GameDirSelect` sits in the shell footer (`ActionBar.tsx`) and shows on every route. Demo playback
already ignores it (it passes the demo's own game dir), but a server join silently launches with the saved
`activeGameDir` (`+set game`) and shows a mod-mismatch confirmation (`join-flow.ts` `modMismatch`).

## Acceptance Criteria

- [x] **AC1** — On the Servers view the footer shows no "Launch with" select.
- [x] **AC2** — On the Demos view the footer shows no "Launch with" select.
- [x] **AC3** — On Home and Library the "Launch with" select is shown as today (when the installation has mods).
- [x] **AC4** — Joining a server launches without `+set game`, whatever "Launch with" is set to.
- [x] **AC5** — Joining a server whose mod differs from the "Launch with" choice shows no confirmation and joins directly.
- [x] **AC6** — Demo playback keeps launching with the demo's own mod (unchanged).
- [x] **AC7** — Plain Play keeps launching with the saved "Launch with" mod (unchanged).

## Open Questions

## Decisions (Sprint)

- **(User)** The footer's mod and map choice belong to starting the game only; Servers and Demos do not
  show them — there the server or the demo decides mod and map.
- **(User)** A join passes no mod: the game switches to the server's mod on connect (and downloads it if
  allowed), so the launcher adds nothing.
- **(User)** The "mod mismatch — join anyway?" confirmation goes away completely.
- On Servers and Demos the select is not rendered at all, not disabled with a reason — the
  platform-parity "disabled + visible reason" rule is about platforms, and the (User) decision says
  these views do not show it.
- Every other route (Home, Library, Config, Downloads, Mods, Settings) keeps the select as today — the
  (User) decision names only Servers and Demos.
- Which routes hide it is a manifest flag (`launchDecidedByContent: true` on `servers` and `replays`
  in `src/shared/types/module.ts`), not a route list in `ActionBar.tsx` — the shell must not know
  module ids, and story 252's Map select reuses the same flag.
- "A join passes no mod" is enforced in main (`buildLaunchArgs`: with `connect` set the saved
  `activeGameDir` is not applied; an explicit `gameDir` still wins) — main owns the command line, so
  no current or future join caller can reintroduce `+set game`.
- `modMismatch`, its dialog, its test ids and the `servers.join.mismatch.*` i18n keys are deleted, not
  left dormant — the (User) decision removes the confirmation entirely and dead code is not kept.
- Demo playback (AC6) needs no code change — `demo-play` always passes the demo's own `gameDir`
  explicitly; it gets a regression unit test with a differing saved mod.
- One changelog line under `### Changed` covers the whole story — CLAUDE.md: one entry per feature.

## Plan

1. **Footer scope (D1).** `ModuleManifest` gets an optional `launchDecidedByContent?: true`, set on
   `servers` and `replays`. `ActionBar.tsx` looks up the manifest for the current `route` in
   `MODULE_MANIFESTS` and does not render `GameDirSelect` when the flag is set. New flow
   `launch-with-scope.mjs` walks Home/Library (select shown, Play → `+set game ctf`) and
   Servers/Demos (select absent). Changelog line.
2. **No mismatch confirmation (D2).** Delete `modMismatch`/`ModMismatch` from `join-flow.ts`, the
   mismatch state and dialog from `useJoinFlow.tsx`, the `servers.join.mismatch.*` keys; adjust the
   unit tests and the two join flows that clicked through the dialog.
3. **Join passes no mod (D3).** `buildLaunchArgs`:
   `(input.gameDir ?? (input.connect ? '' : installation.activeGameDir)).trim()`. Unit tests plus a
   demo regression test. `servers-join.mjs` seeds the install with saved mod `ctf` and asserts both
   join launching lines carry no `+set game`. Systems docs updated.

Order: D1 → D2 → D3 (D3's flow edit assumes D2 already removed the dialog steps).

## Deliverables

- **D1 — The footer hides "Launch with" on Servers and Demos.** Files:
  `src/shared/types/module.ts` (`ModuleManifest` gains `launchDecidedByContent?: true`, doc comment:
  the module's content — a server, a demo — decides mod and map, so the footer offers no launch
  choice; set it on the `servers` and `replays` entries only),
  `src/renderer/src/components/shell/ActionBar.tsx` (from the existing `route` selector derive
  `MODULE_MANIFESTS.find((m) => m.route === route)?.launchDecidedByContent === true`; render
  `<GameDirSelect>` only when that is false — not rendered at all, no disabled state),
  `src/renderer/src/components/shell/ActionBar.test.tsx` (tests below), `docs/ARCHITECTURE.md`
  (Adding-a-module step 2's manifest field list: add `launchDecidedByContent`), `CHANGELOG.md` (under
  `## Unreleased` → `### Changed`, one line: "Launch with now applies only to Play — servers and demos
  bring their own mod; no mod-mismatch prompt."), new e2e flow `scripts/flows/launch-with-scope.mjs`:
  `setup()` calls `writePlayWithFixture({ variant: 'launch-with-scope' })` from
  `scripts/lib/fixture.mjs` (r1q2, game dirs baseq2 + ctf, spawnable stand-in client; skip loudly when
  not spawnable, as `scripts/flows/play-with.mjs` does); locate the select as
  `page.locator('footer').getByLabel('Launch with')` (as `scripts/flows/mods-install.mjs:96`); read
  launching lines from `(await invoke(page, 'app:getInfo')).logPath` with `readLog`
  (`scripts/lib/flow-common.mjs`), mirroring `play-with.mjs`'s `launchLines`/`nextLaunchLine`. Steps,
  named exactly: "AC3: Home and Library show Launch with" (navigate to each, select visible); "AC7:
  Play launches with the saved mod" (on Home pick `ctf`, press the footer Play button, the newest
  launching line contains `+set game ctf`); "AC1: Servers shows no Launch with" and "AC2: Demos shows
  no Launch with" (navigate via the nav; the footer is visible and the select locator count is 0).
  Unit tests in `ActionBar.test.tsx` › "the Launch with select is not rendered on the servers and
  replays routes", "the Launch with select is rendered on home and library when the installation has
  mods".
- **D2 — Joining never asks about a mod mismatch.** Files:
  `src/renderer/src/modules/servers/join/join-flow.ts` (delete `ModMismatch`, `installationMod`,
  `modMismatch`; keep `needsJoinPassword`; fix the file doc comment),
  `src/renderer/src/modules/servers/join/useJoinFlow.tsx` (delete the `mismatch` state,
  `closeMismatch`, `confirmMismatch`, the `ConfirmDialog` and its import, and `useActiveInstallation`
  if it becomes unused; `start()` goes address check → password prompt or launch directly; fix the
  hook's doc comment), `src/renderer/src/modules/servers/locale/en.json` (delete
  `servers.join.mismatch`; then regenerate `src/renderer/src/i18n/__snapshots__/en.bundle.json` with
  vitest's `-u` on the test that owns it), `src/renderer/src/modules/servers/join/join-flow.test.ts`
  (drop the `modMismatch` cases), `useJoinFlow.test.tsx` and `JoinServerButton.test.tsx` (replace the
  mismatch cases with the test below), `scripts/flows/servers-join.mjs` and
  `scripts/flows/servers-actionbar-join.mjs` (remove every `servers-join-mismatch*` wait, click and
  shot; server A — `gamename ctf`, active install baseq2 — now goes straight to the password prompt;
  update header comments and step names that mention the mismatch). Tests:
  `src/renderer/src/modules/servers/join/useJoinFlow.test.tsx` › "a server with a different mod joins
  without a confirmation"; e2e `scripts/flows/servers-join.mjs` step "server A with a different mod
  goes straight to the password prompt" (password prompt visible, `servers-join-mismatch` count 0).
- **D3 — A server join launches without the saved mod.** Files: `src/main/services/launch-plan.ts`
  (in `buildLaunchArgs`: `const gameDir = (input.gameDir ?? (input.connect ? '' :
  installation.activeGameDir)).trim()`, trailing comment: a join takes the server's mod, the game
  switches on connect `(story 251)`; an explicit `input.gameDir` still wins),
  `src/main/services/launch-plan.test.ts`, `src/main/modules/replays/demo-play.test.ts`,
  `scripts/lib/fixture/installations.mjs` (`writeJoinFixture` gains optional `activeGameDir = ''` and
  `gameDirs = ['baseq2']`, passed to `seedJoinStyleFixture`, which writes `activeGameDir` instead of
  the hard-coded `''` and creates `<root>/<dir>/` for each non-baseq2 game dir so revalidation keeps
  it; defaults leave every other caller byte-identical; update `scripts/lib/fixture.d.mts` if it types
  the function), `scripts/flows/servers-join.mjs` (seed `activeGameDir: 'ctf'`,
  `gameDirs: ['baseq2', 'ctf']`; assert server B's and server A's launching lines carry no
  `+set game`; fix the header comment that says the active dir is `''`),
  `docs/systems/servers-module.md` (Engine processes line: a join passes `+connect` only, never the
  saved mod; the game switches mod on connect), `docs/systems/game-browser.md` (~lines 40, 108, 181,
  296: drop the mod-mismatch warning, say a join passes no mod). Tests: `launch-plan.test.ts` › "a
  join does not apply the saved mod", "an explicit game dir still applies on a join", "plain play
  applies the saved mod"; `demo-play.test.ts` › "a demo launches with its own mod when the saved mod
  differs" (installation `activeGameDir: 'ctf'`, demo game dir `opentdm` → launch input
  `gameDir: 'opentdm'`); e2e `scripts/flows/servers-join.mjs` step "joins launch without the saved
  mod".

## Model Hints

All Ds default tier — each is a small, local change with direct tests.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/launch-with-scope.mjs` › step "AC1: Servers shows no Launch with"; unit
  `src/renderer/src/components/shell/ActionBar.test.tsx` › "the Launch with select is not rendered on
  the servers and replays routes"
- AC2 → e2e `scripts/flows/launch-with-scope.mjs` › step "AC2: Demos shows no Launch with"; unit
  `ActionBar.test.tsx` › "the Launch with select is not rendered on the servers and replays routes"
- AC3 → e2e `scripts/flows/launch-with-scope.mjs` › step "AC3: Home and Library show Launch with";
  unit `ActionBar.test.tsx` › "the Launch with select is rendered on home and library when the
  installation has mods"
- AC4 → e2e `scripts/flows/servers-join.mjs` › step "joins launch without the saved mod"; unit
  `src/main/services/launch-plan.test.ts` › "a join does not apply the saved mod"
- AC5 → e2e `scripts/flows/servers-join.mjs` › step "server A with a different mod goes straight to
  the password prompt"; unit `src/renderer/src/modules/servers/join/useJoinFlow.test.tsx` › "a server
  with a different mod joins without a confirmation"
- AC6 → unit `src/main/modules/replays/demo-play.test.ts` › "a demo launches with its own mod when
  the saved mod differs"; e2e `scripts/flows/replays-play-mvd2.mjs` (unchanged; asserts
  `+set game <demo mod>`) stays green
- AC7 → e2e `scripts/flows/launch-with-scope.mjs` › step "AC7: Play launches with the saved mod";
  unit `src/main/services/launch-plan.test.ts` › "plain play applies the saved mod"

## Done

Launch with is now a Play-only choice: the footer hides it where a server or demo decides mod and map (manifest flag
`launchDecidedByContent` on `servers` and `replays`), a join passes no mod (`buildLaunchArgs` skips the saved
`activeGameDir` when `connect` is set), and the mod-mismatch confirmation with its dialog, test ids and i18n keys is deleted.

Commit message: `251: Launch with applies only to Play — footer hides it on Servers/Demos, joins pass no mod, mismatch prompt removed`

Verification (narrow gate): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` 3729 passed / 0 failed; e2e via
`ui:flows -- --affected <3 story flows> --parallel=4 --shard=1/2` and `2/2`. All three story flows (`launch-with-scope`, `servers-join`,
`replays-play-mvd2`) passed. AC → test as verified: AC1/AC2 launch-with-scope steps + ActionBar.test "not rendered on the servers and replays
routes"; AC3 step + ActionBar.test "rendered on home and library…"; AC4 servers-join "joins launch without the saved mod" + launch-plan.test "a join
does not apply the saved mod"; AC5 servers-join "server A with a different mod goes straight to the password prompt" + useJoinFlow.test; AC6
demo-play.test + replays-play-mvd2; AC7 launch-with-scope step + launch-plan.test "plain play applies the saved mod". No manual residue.
Review: default stage PASS, 7/7 AC; four low findings fixed (comment wrap, changelog wording, flow positive control + helper reuse, shared
`launchLines`/`nextLaunchLine` in `scripts/lib/flow-common.mjs`, view-wait in launch-with-scope); fix re-verified with lint, typecheck, vitest on
servers/shell/launch-plan and `ui:flows -- launch-with-scope servers-join play-with servers-actionbar-join` 4/4.
Open point: the two e2e slices selected 76 flows each (`--affected` pulls in everything the diff can reach) and 16 mod/play-with flows were red
(8s `nav-mods` / dialog timeouts) — not reproducible: the same 16 flows re-run through `ui:flows ... --parallel=4` passed 16/16 on the changed build,
so it was load flakiness; not caused by this story.

Decisions:
- Hide implemented purely as the manifest flag, shell looks it up by route (no module ids in `ActionBar.tsx`), as the plan says.
- Existing launch-plan test "puts +connect last…" moved the saved mod to an explicit `gameDir: 'ctf'` input so it still checks ordering.
- `demo-play.test.ts` mutates the harness installation (`activeGameDir: 'ctf'`, `gameDirs` incl. `opentdm`) since the harness has no override.
- `launchLines`/`nextLaunchLine` extracted to `flow-common.mjs` (was copied in play-with) rather than duplicated into the new flow.
- `docs/systems/game-browser.md` re-flowed by prettier, so its diff is wider than the content change.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 6
