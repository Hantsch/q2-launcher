# Sprint S17 Review — the bootstrap survives a real, failed run

## Overview

Goal: close the three gaps a real (non-fixture) bootstrap run exposed on 2026-09-08 — the
allowlist matching the test fixtures instead of the real archives, a failed install vanishing
from the library instead of staying visible, and the failure card pointing at a log file instead
of naming the actual cause.

| Story | Status | Commit |
| --- | --- | --- |
| 076 — The bootstrap assembles the real archives, not the fixtures | done | `076: bootstrap assembles the real archives, not the fixtures` |
| 077 — A failed install stays in my library and shows its last error | done | `077: a failed install stays in my library and shows its last error` |
| 078 — The failure says the cause, not "go read the log" | done | `078: the failure says the cause, not "go read the log"` |

All three stories done, none blocked. Sprint goal reached: a real bootstrap run against the
actually-pinned archives now assembles correctly, a failure leaves the installation in the
library with its cause recorded, and that cause is legible on screen in both the Downloads tab
and the wizard's own running step — none of it requires opening `main.log`.

## Implemented stories

- **076** — Replaced `assemble.ts`'s guessed allowlist (written against synthetic fixtures) with
  one matching the three really-pinned archives: candidate `from` lists per entry, a
  `role`/`required` split, the engine's target name read from `ENGINE_DEFINITIONS` instead of
  hardcoded. A run missing a required file now fails naming that specific package
  (`downloads.error.packageIncomplete`) instead of only reporting the generic end-of-run verdict.
  The fixture archives and `docs/fixtures/archive-layouts.json` (a checked-in listing cross-checked
  against the shipped manifests, the allowlist and the fixtures) keep all three in step so a wrong
  allowlist can never again pass a green suite whose fixture silently agreed with it.
- **077** — A failed bootstrap job no longer deletes the installation it registered. The job now
  deletes only the assembled files (not the registration or the target root), records a
  machine-readable `lastFailure` on the installation, and revalidates before flipping to `failed`
  — so the surviving installation is honestly `invalid`/`missing`, never falsely playable. The
  Library card and rail tile show the failure with a text-bearing badge and microtag (mirroring
  the existing Demo marker), and a retry pointed at the same folder adopts the failed installation
  instead of tripping the duplicate-installation error.
- **078** — `DownloadDiagnostics` gained two new, redacted-and-capped records: an assembly table
  (what each allowlist entry looked for, whether it was found, which package served it) and a
  per-package extraction listing. A new shared `FailureCauseDetail` component renders the
  per-package step reached and the target verdict/failing checks behind a closed-by-default
  disclosure, mounted by both the Downloads tab's failure card and the bootstrap wizard's failed
  running step — so the 2026-09-08 run now reads as "every package downloaded, nothing reached the
  installation" wherever the user is looking, and reveal-log is demoted into the opened detail
  instead of being the card's first offered explanation.

## Findings & decisions

- **076 — candidate lists, not a search (User + refine):** each allowlist entry carries an
  ordered list of literal `from` candidates (first found wins) rather than a recursive copy or a
  single hard-coded path, so a release renaming or re-nesting one file doesn't break the whole
  entry; `q2ded64.exe` stays unlisted (client-only, User decision), `baseq2/q2pro.menu` is listed
  (User decision), and engine-marker detection is deliberately left unwidened — this story
  assembles an installation, it doesn't change how the launcher classifies a hand-added folder.
- **076 — review found two real coverage gaps, both fixed:** `GLOB_DIRS` sat outside the
  allowlist-vs-listing cross-check entirely (fixed: exported and added to
  `archive-layouts.test.ts`), and the fixture-vs-listing check was one-directional, so a fixture
  that silently stopped mirroring a real path would still pass (fixed: added the reverse check).
  One documentation-wording ambiguity (the Requirement table's summary phrasing vs. the more
  precise checked-in listing for the demo's `players/` path) was reviewed and left as-is —
  functionally inert (optional entry, first-found-wins already covers it) and unresolvable
  without re-measuring real archives, which is out of scope per the sprint's no-large-binaries
  decision.
- **077 — half-built files are deleted, the registration is kept (User decision, Q1):** the
  installation lands in an honest `missing`/`invalid` state pointing at an empty/cleaned folder;
  retry re-downloads from scratch rather than risking a half-built folder that looks closer to
  playable than it is. **Cancel keeps full removal (User decision, Q2)** — it is the one case
  where the user explicitly said "never mind"; only a real failure survives in the library.
- **077 — the failure record is a first-class typed field on `Installation`, not `moduleData`**
  (refine decision): `moduleData` is an untyped, unvalidated bag and AC3 asked for a
  machine-readable, persisted record; the field itself stays module-agnostic so nothing in the
  core type learns about downloads. It is cleared centrally, in the one place that already writes
  status from `inspectInstallation`, whenever the resulting verdict is playable — covering both a
  later successful download and the user pointing the installation at real game files without two
  call sites that can drift apart.
- **077 — review found and fixed a real AC8 regression:** the engine-preservation guard added
  during build was unconditional, so it also silently changed the engine badge on *ordinary*,
  never-failed installations whose folder happens to inspect as `unknown` — scoped to only apply
  when `lastFailure` is set, with a negative test pinning the pre-story behaviour for an ordinary
  installation. A proposed further tightening (revalidate before recording the failure, to close a
  narrower one-commit observability window) was tried and reverted — it broke the AC1 test outright
  because the engine-preservation fix itself depends on the current ordering — and is recorded as a
  rejected alternative rather than silently dropped.
- **078 — the user-facing card and the copied report show different depth (User decision, Q1):**
  the card shows only the per-package step summary and the target verdict/checks; the assembly
  table and extraction listing are report-only, for maintainers. **The wizard reuses the Downloads
  tab's detail component rather than linking out to another tab (User decision, Q2).**
- **078 — review found and fixed two real gaps in the shipped behaviour:** a package that never
  reached assembly (the job failed on an earlier package's download) was rendered identically to a
  package assembly actively rejected — an accusation assembly never made — fixed with a distinct
  "extracted, assembly never ran" state; and a not-found allowlist entry with multiple candidate
  paths recorded only the first one tried, which on the real wrapper-nested archive shape (076)
  made the assembly table read as "the allowlist never tries the wrapper path" when it does — fixed
  to record every candidate tried.
- **078 — one real, pre-existing gap surfaced but deliberately not fixed in this story (open
  follow-up):** a `missingChecks` entry whose translation interpolates a variable (e.g.
  `validation.rootMissing`'s `{{path}}`) renders that placeholder unfilled, because
  `DownloadDiagnosticsTarget.missingChecks` has stored only `{id, messageKey}` — no `params` — since
  [[075]]'s deliberate redaction boundary (a check's params can carry an absolute install path).
  This story is the first to put those keys on screen (previously report-only), inheriting a gap
  neither its own tests nor its e2e fixture happen to exercise (both use only param-free keys).
  Closing it means deciding how to redact-and-carry `params` through `missingChecks`, a shape
  change to a [[075]] type this story's plan never scoped — flagged rather than absorbed. See
  "Follow-ups worth doing" in the roadmap.

## Blocked / open

None. No story was blocked; both stories carrying deliberately open questions (077's half-built
files and cancel behaviour) had their answers resolved in the clarification round before refine
started, and no new user-decidable question arose during build.

## Acceptance

Acceptance is the test suite — every criterion below was proven by a named automated test as
part of its story's build (see each story's `## Done` section for the full AC → test mapping).

| Story | Criteria proven by tests | Manual residue |
| --- | --- | --- |
| 076 | AC1–AC7, all via unit tests (`assemble.test.ts`, `job.test.ts`, `archive-layouts.test.ts`) plus e2e (`ui:flow -- bootstrap-wizard`, `ui:flow -- bootstrap-incomplete-package`) | AC1: the same run against the live ~190 MB archives on the public mirrors is not automated — it depends on two external mirrors and would download ~190 MB per suite run. The checked-in archive-layouts listing (`archive-layouts.test.ts`) is what makes the offline run equivalent; a manifest re-pin that changes a real layout fails that test instead of a user's install. |
| 077 | AC1–AC8, all via unit tests (`installations.test.ts`, `job.test.ts`, `schemas.test.ts`) plus e2e (`ui:flow -- bootstrap-failure-retry`, `ui:verify -- --screens=library`) | None. |
| 078 | AC1–AC10, all via unit tests (`assemble.test.ts`, `job.test.ts`, `diagnostics.test.ts`, `failure-log.test.ts`, `report.test.ts`, `FailureCauseDetail.test.tsx`, `FailureLogEntry.test.tsx`, `RunningStep.test.tsx`) plus e2e (`ui:flow -- downloads-tab`, `ui:flow -- bootstrap-failure`, `ui:verify -- --screens=downloads`) | AC5: unchanged carry-over from [[075]] — that an OS file-manager window actually appears when reveal-log is invoked is not asserted; `shell.showItemInFolder` opens an out-of-process window Playwright cannot see. |

Two criteria across the sprint carry genuine manual residue, both listed in `testplan.md`. Every
other criterion was proven by a passing automated test through the real surface
(`ui:verify`/`ui:flow`) where the story described a user action, or by a unit/integration test
where it did not.
