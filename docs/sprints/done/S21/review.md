# Sprint S21 review — The launcher ships itself: release, changelog, updater

## Overview

Goal: a deliberate release produces a versioned, published Windows build whose notes come from
the changelog; an installed launcher finds out once a day that a newer one exists; the user
updates when they choose to, from the titlebar or About, seeing what they get for it.

| Story | Status | Commit |
| --- | --- | --- |
| 096 — A release ships from a changelog | done | `096: a release ships from a changelog` |
| 097 — The launcher notices a new version | done | `097: the launcher notices a new version` |
| 098 — I update when I choose to | done | `098: I update when I choose to` |
| 099 — About tells me what changed | done | `099: About tells me what changed` |

All four stories done, no blockers. Dependency chain (096 → 097 → 098 → 099) held as planned;
each story built directly on the previous one's contract with no rework.

## Implemented stories

- **096** — `CHANGELOG.md` in Keep a Changelog shape; a pure release core
  (`scripts/lib/release/*.mjs`: parse/validate/promote the changelog, derive the version bump,
  check the artifact set) driven by a thin `scripts/release.mjs` shell and a
  `.github/workflows/release.yml` (dispatch + push-to-`main`, `[skip ci]`/tag-exists guarded).
  `electron-builder.yml` gained a `publish:` block so packaging emits `latest.yml`/`app-update.yml`.
  `changelog-path` flipped from `none` to `CHANGELOG.md` in the project profile.
- **097** — A main-process update-check service (`src/main/services/update/`) wrapping
  `electron-updater` (`autoDownload:false`, `allowPrerelease:true`) behind a typed IPC contract
  (`update:getState`/`update:check`/`update:state`), persisted across restarts, gated to packaged
  builds, checking at most once per 24h from the last successful attempt, never blocking startup
  or retrying a failure in-session.
- **098** — The titlebar update control (icon button + popover, left of Downloads): names the
  version, links to the notes, downloads with visible progress, and stages a second confirmation
  before restart-and-install. The restart guard refuses while a game is running or a download job
  is in flight, reusing the existing `LaunchService`/jobs state rather than new tracking. A
  dev-only simulation path drives the whole flow offline for the acceptance harness.
- **099** — Settings' About section rebuilt (`components/about/`): the running version's own
  release notes bundled from `CHANGELOG.md` at build time (works offline), the pending update's
  notes fetched from 097's state and marked "not yet installed" next to 098's action, a
  last-checked timestamp with a check-now button, and links to the project/full changelog opened
  externally. A pure markdown-subset parser renders headings/list items as text, never raw markup.

## Findings & decisions

Aggregated from each story's `## Decisions (Sprint)` and the build/review cycles:

- **User decisions, binding across the chain:** first release `1.0.0-beta.1` as a GitHub
  prerelease; `Hantsch/q2-launcher` stays public (097's check needs it); unsigned artifacts
  accepted for the beta (SmartScreen documented in the README, no certificate yet);
  `electron-updater` over a hand-rolled check; the titlebar control is an icon + popover.
- **096 review** caught 4 real correctness bugs before merge: multi-line changelog bullets
  truncated by `promote()`, a lightweight git tag invisible to `--follow-tags`, `--bump` inert
  during the beta's prerelease phase (contradicting AC6), and a build/asset-check mismatch that
  made every run throw. A second cycle caught one more (a dry-run file revert not wrapped in
  try/finally). All fixed, both cycles ended clean.
- **097**: state shape deliberately separates the last *attempt's* outcome from the last *known*
  update, so a later failed check can never hide an update already found; release notes are
  stored as one capped, untrusted string — rendering/sanitising was left to 099 by design.
- **098 review** found one real bug (a narrow cancel-timing window in the real `checker.ts`) —
  left as a documented, non-blocking limitation rather than fixed under time pressure; worth a
  follow-up (below). One review-suggested fix (an explicit `!supported` guard in
  `installAndRestart`) was tried and reverted after it broke the real e2e proof of AC6, since
  `supported` is always `false` in the unpackaged build the harness runs — documented in code and
  in the Done section rather than silently dropped.
- **099 review** caught one real AC1-breaking bug: the version-section heading regex matched an
  invented bracketed format instead of the repo's actual `## <version> — <date>` heading (masked
  because no real version section existed yet at review time). Also caught a deliverable that had
  silently deleted 12 pre-existing, unrelated tests while replacing its target file — restored.
- **096 and 097 add no `CHANGELOG.md` entry of their own**, by explicit decision — neither ships
  anything a user can see directly; 098 and 099 carry the user-facing entries for the whole chain.

## Blocked / open

None. No story was blocked; no new user question surfaced during build.

## Acceptance

Per `.claude/ai-scrum.md`: `ac-tests-required: true`, `ui-acceptance-required: true`. Criteria
about user actions are proven through `npm run ui:verify`/`ui:flow`; criteria without a user
surface (core logic, IPC, the release process) are proven through `npm test`.

| Story | Criterion → proof |
| --- | --- |
| 096 | AC1–AC3, AC5–AC7 → `scripts/lib/release/*.test.mjs`, `scripts/release.test.mjs` (pure-core unit tests: changelog parse/promote, version derivation, refusal paths, idempotency, override). AC8 → `.claude/ai-scrum.md`'s `changelog-path` flip, checked by inspection. |
| 097 | AC1–AC6, AC8 → `src/main/services/update/{service,checker,store}.test.ts`, `src/main/ipc/update.test.ts` (24h window, state shape, persistence, packaged-only guard, IPC contract). AC7 (manual trigger) → proven at the real surface by 099's `check-now` button, exercised in `scripts/flows/about-release-notes.mjs`. |
| 098 | AC1–AC7 → `npm run ui:flow app-update` (titlebar control, popover contents, download progress, staged restart confirm, dismiss-stays-quiet, refusal reasons) plus `src/main/services/update/service.actions.test.ts`. AC8 (control disappears post-update) → same flow's terminal state. |
| 099 | AC1–AC6 → `npm run ui:flow about-release-notes` (own-version notes, pending-update notes marked not installed, external links via the harness-gated recorder, last-checked/check-now, empty states, structural markdown rendering) plus `src/shared/release-notes.test.ts`, `src/main/lib/release-notes.test.ts`. |

**Manual residue** (declared per-story, does not block anything — see `testplan.md`):

- **096 AC4** — the real `gh release create` publish against github.com. External-service side
  effect; no test may perform it. Everything up to and including the exact `gh` invocation and the
  artifact-set check is unit-tested.
- **098 AC8 (second half)** — that a real restart relaunches into the newly installed build.
  Needs a packaged NSIS install; the harness runs unpackaged (097 AC5 forbids checks there by
  design), so this cannot be driven end-to-end by the suite.

**Named gaps, not manual residue** (covered one level below the real surface, both by design of
how the acceptance harness works, not a shortfall in either story):

- 097 AC3's *network* failure paths (offline, malformed feed) are proven at the service/unit level,
  not through a real failed network call in `ui:verify` — the harness never reaches the network by
  design (097 AC5).
- 099's manual "check now" always resolves through the dev-simulation path in the harness for the
  same reason; the real network call is 097's own unit-level responsibility.

## Roadmap

Milestone 7.1 marked `done 2026-09-13`, linked to this review. `Where we stand` rewritten. The
open roadmap line "Auto-update via `electron-updater`, plus a code-signing decision" is removed —
both are now shipped decisions, not open questions. One new follow-up added for the narrow
cancel-timing window in 098's real `checker.ts`.
