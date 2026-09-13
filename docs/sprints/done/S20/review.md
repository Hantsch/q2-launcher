# Sprint S20 review — Install closes out: update, rollback, repair, removal

## Overview

Goal: close out Phase 4 milestone 1 — an installation can update its engine and roll back a
bad update, repair whatever the manifest can supply, and be removed from disk (locked for
store-managed installs), all writes waiting for a running game to exit first.

| Story | Status | Commit |
| --- | --- | --- |
| 091 — Writes wait for a running game | done | `091: writes wait for a running game` |
| 092 — An engine updates and rolls back | done | `092: an engine updates and rolls back` |
| 093 — Repair fixes exactly what it can | done | `093: repair fixes exactly what it can` |
| 094 — An installation can be removed from disk | done | `094: an installation can be removed from disk` |

All four stories done, no blockers. One clarification round with the user (see Findings) and
one deliberate scope violation by a parallel build agent, caught and excluded (see Findings).

## Implemented stories

- **091** built the one shared seam every writing job in this sprint rides:
  `InstallationWriteGuard` (`src/main/services/write-guard.ts`) defers a job's write phase while
  its target installation's game is running, marks the job `waiting` with a visible reason, and
  resumes it on its own once the process exits — download/verify/extract stay ungated. Retrofitted
  onto 090's retail-upgrade job (closing the S19 review's flagged gap) and onto the bootstrap job's
  two assemble passes.
- **092** built the full engine update/rollback lifecycle: an update check against the pinned
  manifest version (or, opted in per installation, a `version.txt` probe of Q2PRO's rolling nightly
  — size-checked, not hashed, since there is no pinned hash for a moving target), an update job that
  downloads, verifies, backs up the previous engine files and replaces them, and a rollback job that
  restores the backup in one step with no network. Both ride 091's guard.
- **093** redeemed the `install-game-files` fix reserved since the installation model was built:
  a repair dialog reads a fresh `inspectInstallation` verdict and offers exactly what the manifest
  can supply (re-install the engine, the 3.20 point release for a missing `pak2.pak`) plus, for
  demo or missing retail paks, 090's existing retail-copy flow verbatim. The inspector learned to
  tell "only pak2 missing" apart from "retail paks missing" so the two repairs can differ.
- **094** closed the last open part of Phase 4 M1: removing a non-store installation now offers a
  choice between entry-only removal and removal from disk, with a confirmation naming the exact
  path; store-managed installations (Steam/GOG/Epic/Bethesda) keep entry-only removal only, with a
  note that the store uninstalls the game. A new safety fence refuses drive roots, the launcher's
  own data dir, the home dir, and any overlap with another installation's root before ever deleting.

## Findings & decisions

- **User clarification (bundled, phase 1a):** story 092's bleeding-edge probe mechanism was an open
  question in the concept (§15.12). Resolved with the user: probe via Q2PRO's `version.txt` next to
  the nightly asset (not the GitHub Releases API — no rate limit, r1q2 has no such file so bleeding
  edge stays Q2PRO-only), and verify by size only (no SHA256 — there is no pinned hash for a moving
  nightly target; the opt-in itself is the trust signal). Recorded in 092's `## Decisions (Sprint)`.
- **Two review cycles found and fixed real bugs before merge**, both caught by the
  `story-review-hard` clean-agent review this sprint's Model Hints required for every story:
  - 092: a cold-session manifest read made the update check always report "no update available"
    until the bootstrap wizard had run once in that session — AC1 was unreachable on a fresh app
    start. Also found: a backup-integrity gap where a partial restore or a mistimed pointer update
    could lose engine files or misdescribe the backup slot. Both fixed, regression-tested, re-
    reviewed to PASS.
  - 093: `Installation.engineKind` is not stable memory — `InstallationsService`'s own revalidation
    overwrites it to `'unknown'` on the next `validate()` (which runs on every app startup) once the
    engine's only detection marker (its executable) is gone, for any ordinary installation. That
    silently made AC1's "reinstall a missing engine executable" offer unreachable after a restart —
    its own canonical scenario. Fixed with a new one-way `Installation.recordedEngineKind`, set at
    bootstrap/import/successful-repair and never touched by revalidation.
  - 094: a wrong success toast claimed "files are still on disk" after a successful disk deletion; a
    fail-open default in the safety fence (`userDataDir`/`homeDir` defaulting to `''`) would have
    silently widened the deletable area instead of refusing loudly if a caller forgot to wire them;
    a tautological test compared a deleted installation's root against itself; and the dialog's
    confirm button stayed enabled in a narrow window if the game started running mid-dialog. All
    four fixed and re-verified.
- **A build agent (092's) created an unrelated, fully-refined story file**
  (`docs/requirements/095-a-news-entry-starts-from-a-template.md`, ~22 KB, about a news-entry
  template feature with no relation to install/update/repair/removal) during its build window,
  outside its assigned scope and not part of this sprint's plan. It was excluded from every commit
  in this sprint and left untouched in the working tree. **This needs a human decision**: either
  keep it as an accidental but usable head start on a real backlog idea, or discard it — it was not
  requested and its content has not been reviewed for accuracy.
- **091's own build agent needed a manual resume**: the orchestrator's first delegation for story
  093 returned early ("waiting for the D7 agent's clarified status report") without finishing —
  resumed via a follow-up message from the same agent, which then completed normally. No effect on
  the delivered story; noted here only as an orchestration hiccup, not a code finding.
- Every story's own `## Decisions (Sprint)` section carries its detail-level design decisions
  (guard shape, backup-slot layout, safety-fence rules, etc.) — not repeated here; see the linked
  story files under `docs/requirements/done/`.

## Blocked / open

None. All four stories completed with no blockers.

## Acceptance

Acceptance is the test suite; every criterion below was proven by the named test(s) in its story's
`## Done` section (all four are linked under `docs/requirements/done/`).

| Story | Criteria | How proven |
| --- | --- | --- |
| 091 | AC1–AC6 | Unit (`write-guard.test.ts`, `launch.test.ts`, `upgrade-job.test.ts`, `jobs.test.ts`, `bootstrap/job.test.ts`) + e2e `ui:flow -- job-waits-for-running-game` and `ui:flow -- retail-upgrade` (rewritten). No manual residue. |
| 092 | AC1–AC8 | Unit (`update-status.test.ts`, `bleeding-edge.test.ts`, `update-job.test.ts`, `rollback-job.test.ts`, `index.test.ts`) + e2e `ui:flow -- engine-update`. AC6's *waiting-state-on-the-real-surface* is deliberately proven by 091's own e2e, not re-proven here — 092's e2e cannot hold a real game process open against filler-byte fixture executables; 092 proves both jobs go through the guard at unit level. No manual residue. |
| 093 | AC1–AC9 | Unit (`inspector.test.ts`, `repair/plan.test.ts`, `repair/job.test.ts`, `RepairDialog.test.tsx`, `installations.test.ts`) + e2e `ui:flow -- repair`. AC9's e2e check was re-scoped from an unreachable literal ("action bar no longer shows Repair" — blocked by a pre-existing, unrelated `isPlayable()` behaviour) to its substantive claim (status never hand-set) — recorded in the story's Acceptance Tests section. No manual residue. |
| 094 | AC1–AC7 | Unit (`installation-removal.test.ts`, `installations.test.ts`, `RemoveInstallationDialog.test.tsx`) + e2e `ui:flow -- installation-remove-from-disk`. AC6's dashboard half has no dedicated assertion — the dashboard's two tiles are aggregate and name no specific installation, so there is nothing dashboard-side that could still show a removed one; recorded in the flow's own header comment. No manual residue. |

No `testplan.md` was written for this sprint — every story reported zero manual residue, so per
the project profile's `optional` testplan setting there is nothing left for a human to walk by
hand.
