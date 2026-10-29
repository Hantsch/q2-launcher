---
id: 269
title: Quarantine entries get a real owner; Linux entries do not age out; two shard races fixed
status: done
created: 2026-10-27
---

## Requirement

A maintainer wants the Linux flow lane to verify the onboarding journey (add installation, bootstrap
wizard) instead of quarantining it, and wants every quarantine entry to name a story that owns it —
so that a quarantined flow is a visible, temporary debt and not silent coverage loss on the platform
CLAUDE.md says must reach parity.

Today ([review 2026-10-27](../../reviews/2026-10-27-tests-review.md), F05, priority P2, TD-047 and
TD-052): `scripts/flows/quarantine.json` holds 22 entries, about 12% of 179 flow files. 20 of them
(`"platform": "linux"`, story 234, since S34) share one cause, stated in the entries themselves: the
fixture's engine package is a Windows Q2PRO (`q2pro64.exe`), so the Linux wizard shows no engine
option; they include `add-installation-one-flow` and `bootstrap-existing-folder`. 2 entries
(`news-feed` at quarantine.json:143, `unlock-code` at :149; since S35) carry `"story": "unattributed"`
and flake only under four parallel shards (a background manifest refresh lands in the second launch
window; the Settings installation id is read before it renders). Quarantined flows do not break the
run (`flows-all.mjs:6`, loaded at `:203`), so nothing is red — the harm is unverified Linux onboarding.

Out of scope, by the judge's scoping: a generic age-check framework. One already exists —
`scripts/lib/flow-gate.mjs`, pinned by `scripts/flow-gate.test.mjs:58-61` ("quarantined since SNN,
older than three sprints" is a config error). The S34 review sets the fix deadline at S38.

## Acceptance Criteria

Cut by the binding user decision under `## Decisions (Sprint)` (Linux is a manually-run
qualification target, not a pipeline platform): AC1–AC3 are struck, AC6–AC7 replace them.

- [ ] ~~**AC1** — The flow fixture offers a Linux engine package selected by platform; the Windows
      package and the Windows flows that use it are unchanged (the Windows re-run of the flows that
      touch the fixture exits 0).~~ cut → Decisions (Sprint)
- [ ] ~~**AC2** — On Linux, `npm run ui:flows -- add-installation-one-flow bootstrap-existing-folder`
      exits 0 with both flows removed from quarantine and `--repeat` showing no flake.~~ cut → Decisions (Sprint)
- [ ] ~~**AC3** — `grep -c "Windows Q2PRO" scripts/flows/quarantine.json` returns 0: none of the 20
      story-234 entries remain (any remaining Linux entry names a different story and a different reason).~~ cut → Decisions (Sprint)
- [x] **AC4** — `grep -n unattributed scripts/flows/quarantine.json` returns nothing; the `news-feed`
      and `unlock-code` entries are gone because both flows are fixed (AC7).
- [x] **AC5** — A test fails when a quarantine entry has an empty or `unattributed` `story` (seeded
      defect: set `"story": "unattributed"` and the named test goes red).
- [x] **AC6** — An entry scoped `"platform": "linux"` is not subject to the three-sprint age rule, so
      the 20 story-234 entries (since S34) do not turn the Windows or the manual Linux run red at S38; an
      unscoped or `win32` entry older than three sprints still fails the run.
- [x] **AC7** — On Windows, `npm run ui:flows -- news-feed unlock-code home-tile-states
settings-downloads-section --repeat=10 --parallel=4` exits 0 with `news-feed` and `unlock-code`
      no longer in `scripts/flows/quarantine.json` (command and result recorded in `## Done

Quarantine entries must now name a real story or TD id (`unattributed` is a config error); `linux`-scoped entries are exempt from the three-sprint age rule. The two Windows shard races are fixed in the flows (unlock-code waits for the rendered installation id; news-feed waits for the failed refresh to settle via `news.get` before its no-toast/no-dialog checks), both quarantine entries and TD-047/TD-052 removed. Docs updated (`docs/UI-VERIFICATION.md`).

Commit: `269: quarantine needs a real owner, linux entries exempt from age rule, unlock-code + news-feed shard races fixed`

Verification (narrow gate): lint, typecheck green; `npx vitest run --changed HEAD` 27/27; `npm run ui:flows -- --affected scripts/flows/news-feed.mjs scripts/flows/unlock-code.mjs --parallel=4 --shard=1/2` and `2/2` green. AC7 command `npm run ui:flows -- news-feed unlock-code home-tile-states settings-downloads-section --repeat=10 --parallel=4` -> `40/40 flows passed in 351s` (after the review fix).
AC mapping: AC4 flow-gate test "an unattributed or empty story is a config error" + entries gone; AC5 same test (seeded defect confirmed red); AC6 "a linux-scoped entry does not age out" + "an entry older than three sprints fails the run"; AC7 the run above. AC1-3 cut by Decisions (Sprint).
Decisions: news-feed did not reproduce the failure under load (both entries showed "unexpected pass" x10); fix targets the likely race (absence checks before the failed refresh settled). Retitled the story to the cut scope.
Review 1 (default): FAIL on a blind 500 ms sleep before the absence check in news-feed; fixed (state wait on `news.get` lastRefreshFailed + renderer flush), re-verified with the AC7 run. Left unfixed: the added `win32` assertion in the age test is the same code path as the unscoped one (required by the plan, harmless); no test seeds an empty `story` (the missing-field check already covers it, existing test).
Pre-existing: none observed. Full regression gate pending (sprint runs it).

tiers: D 3 / hard 0 · review default · cycles 1 · agents 6
