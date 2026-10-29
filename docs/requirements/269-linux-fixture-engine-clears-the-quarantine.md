---
id: 269
title: Linux fixture engine clears the quarantine; unattributed entries get an owner
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

A maintainer wants the Linux flow lane to verify the onboarding journey (add installation, bootstrap
wizard) instead of quarantining it, and wants every quarantine entry to name a story that owns it —
so that a quarantined flow is a visible, temporary debt and not silent coverage loss on the platform
CLAUDE.md says must reach parity.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F05, priority P2, TD-047 and
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
- [ ] **AC4** — `grep -n unattributed scripts/flows/quarantine.json` returns nothing; the `news-feed`
  and `unlock-code` entries are gone because both flows are fixed (AC7).
- [ ] **AC5** — A test fails when a quarantine entry has an empty or `unattributed` `story` (seeded
  defect: set `"story": "unattributed"` and the named test goes red).
- [ ] **AC6** — An entry scoped `"platform": "linux"` is not subject to the three-sprint age rule, so
  the 20 story-234 entries (since S34) do not turn the Windows or the manual Linux run red at S38; an
  unscoped or `win32` entry older than three sprints still fails the run.
- [ ] **AC7** — On Windows, `npm run ui:flows -- news-feed unlock-code home-tile-states
  settings-downloads-section --repeat=10 --parallel=4` exits 0 with `news-feed` and `unlock-code`
  no longer in `scripts/flows/quarantine.json` (command and result recorded in `## Done`).

## Open Questions

- ~~The 2 shard races: fix them here or only give them an owner and leave the repair to TD-052?~~
  answered → Decisions (Sprint)
- ~~Expiry: is an extra `expires` field worth it, or is the existing rule enough once the story field
  is real?~~ answered → Decisions (Sprint)
- ~~The Linux engine package: build it from story 102's Linux Q2PRO, or a minimal stub engine?~~
  answered → Decisions (Sprint)
- ~~Remove entries only after `--repeat` (story 233) shows green; is that the exit rule?~~ answered →
  Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Linux is not supported; it is qualified as an additional target and its tests run manually only, never in the pipeline. Refine must cut the story to that: no CI/quarantine machinery for Linux beyond what the manual run needs; fix the two shard races only if they also hit Windows, otherwise give them an owner.
- No Linux engine package (AC1–AC3 cut): it exists only to verify Linux onboarding, which the user decision takes out of scope; TD-047, whose fix it was, is deleted.
- Linux-scoped entries are exempt from the age rule: they are the manual qualification run's list of known Linux differences, not temporary debt, and without the exemption all 20 fail every run (Windows included, since `staleEntries` checks all entries) at S38.
- The two shard races are fixed here: both were recorded by the S35 gate on Windows (`docs/sprints/S35/sprint.md:63,71`), so per the user decision they hit Windows; TD-052 is deleted with them.
- No `expires` field: `flow-gate`'s three-sprint rule already is the expiry once `story` must be real.
- Exit rule for removing an entry: the `--repeat=10 --parallel=4` run of AC7 under load, matching story 233's `--repeat` purpose.

## Plan

Three small pieces, all in the flow gate and two flows. No product code changes.

1. **Gate rules** (`scripts/lib/flow-gate.mjs`): `validateQuarantine` rejects a `story` of
   `unattributed` (case-insensitive, trimmed) like an empty one; `staleEntries` skips entries with
   `platform: 'linux'`. Tests in `scripts/flow-gate.test.mjs`. Doc paragraph in
   `docs/UI-VERIFICATION.md` (~1563–1586). Delete TD-047 from `docs/TECH-DEBT.md`.
   Order matters: until D2/D3 land, the two `unattributed` entries would make the list invalid,
   so D1 retags them `"story": "TD-052"` in the same change.
2. **unlock-code race**: the `<code data-testid="unlock-installation-id">` renders empty until
   the unlock state arrives (`UnlockCodePanel.tsx:83`); `openSettings` waits for "visible" only.
   Wait until it holds the formatted id, then remove the quarantine entry.
3. **news-feed race**: a background manifest refresh lands in the phase-2 launch window. Reproduce
   under load, find which phase-2 assertion it trips, replace it with a wait on the state it
   needs (without weakening "only news/* was requested" or "no toast/dialog" for the news
   refresh itself), then remove the entry and TD-052.

Verification: `npx vitest run scripts/flow-gate.test.mjs`, then AC7's run on Windows. Linux is
not run (manual-only per decision).

## Deliverables

- [ ] D1 — **Quarantine rules: a real owner, and Linux entries do not age out.** In
  `scripts/lib/flow-gate.mjs`: (a) `validateQuarantine` adds a problem
  `${label}: "story" must name a story or TD id, got "unattributed"` when `entry.story.trim()`
  lower-cases to `unattributed` (an empty `story` is already rejected by the missing-field
  check); (b) `staleEntries` ignores entries whose `platform` is `'linux'` — Linux is a
  manually-run qualification target, its entries list known platform differences (add that
  reason as a one-line comment). In `scripts/flows/quarantine.json` change both
  `"story": "unattributed"` to `"story": "TD-052"` (keeps the list valid until D2/D3 remove
  them). Tests in `scripts/flow-gate.test.mjs` (`describe('flow gate quarantine')`, use the
  existing `entry()`/`gate()` helpers): "an unattributed or empty story is a config error"
  (`validateQuarantine([entry({ story: 'unattributed' })], ['flaky'])` and `' Unattributed '`
  each yield one problem naming `story`; a gate run with it has `ok === false`); "a linux-scoped
  entry does not age out" (`entry({ since: 'S28', platform: 'linux' })` at `current: 32` →
  `ok === true` on both `platform: 'linux'` and `'win32'` with a failing/passing flow
  respectively, no `configErrors`); extend nothing else — the existing "an entry older than
  three sprints fails the run" test keeps proving the unscoped case, add one `platform:
  'win32'`, `since: 'S28'` assertion to it. Update `docs/UI-VERIFICATION.md`'s quarantine
  paragraphs (~lines 1563–1586): `story` names the owning story or TD id, `unattributed` is
  rejected; the age rule does not apply to `linux` entries and why. Delete the TD-047 row from
  `docs/TECH-DEBT.md` (rows are removed when done). Files: `scripts/lib/flow-gate.mjs`,
  `scripts/flow-gate.test.mjs`, `scripts/flows/quarantine.json`, `docs/UI-VERIFICATION.md`,
  `docs/TECH-DEBT.md`.
- [ ] D2 — **unlock-code reads the installation id only once it has rendered.** In
  `scripts/flows/unlock-code.mjs`, `openSettings` (used by both launches) waits until
  `getByTestId('unlock-installation-id')` holds text matching
  `/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/` (a `page.waitForFunction` on the element's
  `textContent`, or Playwright's locator polling, with `TIMEOUT_MS`) instead of only `visible` —
  the `<code>` renders empty until the unlock state arrives
  (`src/renderer/src/components/unlock/UnlockCodePanel.tsx:83`). No `waitForTimeout`. Keep the
  existing format assertion in the flow body. Remove the `unlock-code` entry from
  `scripts/flows/quarantine.json`. Files: `scripts/flows/unlock-code.mjs`,
  `scripts/flows/quarantine.json`.
- [ ] D3 — **news-feed waits out the background refresh instead of racing it.** First reproduce
  on Windows: `npm run ui:flows -- news-feed home-tile-states settings-downloads-section
  unlock-code --repeat=10 --parallel=4` (S35 recorded: passes alone, fails under four shards; a
  background manifest refresh lands in the second launch window). Read the failing step from the
  output and fix it in `scripts/flows/news-feed.mjs` by waiting on the state that step needs
  (a test id, a `waitForFunction` predicate or an `expect` on a locator; no `waitForTimeout`).
  The flow must keep proving its criteria: phase 2 still asserts that the second app requested
  nothing but `news/*` from the fixture server and that a failed news refresh shows no toast and
  no dialog — if the manifest refresh's own request or notice is what trips it, scope the
  assertion to news (e.g. wait for the refresh to settle, or distinguish its request path), do
  not delete it. If the race turns out to be in product code, stop and report it instead of
  changing `src/`. Remove the `news-feed` entry from `scripts/flows/quarantine.json` and the
  TD-052 row from `docs/TECH-DEBT.md`. Then run AC7's command (all four named flows,
  `--repeat=10 --parallel=4`) and record command + result in `## Done`. Files:
  `scripts/flows/news-feed.mjs`, `scripts/flows/quarantine.json`, `docs/TECH-DEBT.md`.

## Model Hints

All deliverables default tier.

Review: → default

## Acceptance Tests

- AC1 → cut by Decisions (Sprint), no test.
- AC2 → cut by Decisions (Sprint), no test.
- AC3 → cut by Decisions (Sprint), no test.
- AC4 → unit `scripts/flow-gate.test.mjs` › "an unattributed or empty story is a config error"
  (the real list stays valid only without `unattributed`, checked by the gate on every flow run),
  plus D2/D3 removing both entries.
- AC5 → unit `scripts/flow-gate.test.mjs` › "an unattributed or empty story is a config error"
- AC6 → unit `scripts/flow-gate.test.mjs` › "a linux-scoped entry does not age out" and
  › "an entry older than three sprints fails the run" (extended with a `win32` entry).
- AC7 → e2e `scripts/flows/news-feed.mjs` › "news-feed" and `scripts/flows/unlock-code.mjs` ›
  "unlock-code", run as `npm run ui:flows -- news-feed unlock-code home-tile-states
  settings-downloads-section --repeat=10 --parallel=4` (D3 records the result in `## Done`).

## Done

<Leave empty. Filled by `/build <id>` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
