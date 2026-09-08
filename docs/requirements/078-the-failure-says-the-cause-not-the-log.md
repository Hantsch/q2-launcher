---
id: 078
title: The failure says the cause, not "go read the log"
status: draft
created: 2026-09-08
---

## Requirement

[[075]] shipped two actions on a failed download: copy a Markdown report, and reveal the log file
([FailureLogEntry.tsx](../../src/renderer/src/modules/downloads/components/FailureLogEntry.tsx)).
The copy action is right. **Revealing the log is not an answer for a user** — most people will not
open a 200 KB `main.log`, and nobody should have to in order to learn which of three downloads
went wrong. What the card itself says is still only the generic sentence
`downloads.error.installationNotPlayable`: "The files were downloaded, but the result was not a
usable Quake II installation."

The information to do better is already captured and already persisted. `DownloadDiagnostics`
([downloads.ts:282](../../src/shared/modules/downloads.ts#L282)) holds, per package, the id, the
URL that actually served it, its size and `verified`/`extracted`; and for a bootstrap failure a
`target` with the `verdict` and the failing `missingChecks` — each an id plus an i18n
`messageKey`, never prose. Every one of those is renderable in the card today, i18n intact. The
story that captured them stopped at putting them on the clipboard.

Second gap from the same run: the failure was only visible in the Downloads tab. The bootstrap
wizard's own running step prints one line, `t(job.error.key)`
([RunningStep.tsx:44](../../src/renderer/src/modules/downloads/bootstrap/RunningStep.tsx#L44)) —
the same generic sentence, in the place the user is actually looking when it breaks.

### What the real report showed, and what it could not show

The 2026-09-08 report (reviewed 2026-09-08) is honest about everything it covers: three packages,
each `Verified: Yes` / `Extracted: Yes`, one mirror fallback recorded (`Hantsch/...` 404 → upstream
`q2pro/q2pro` release), the target `C:\Games\Q2Pro` left `Not playable` with `engine-identified`,
`base-paks` and `executable` failing, and a log tail ending in "still invalid after assembly".
`Verified: Yes` is meaningful — `sha256` is mandatory in the manifest and a bad digest is refused
([verify.ts:106](../../src/main/modules/downloads/verify.ts#L106)) — and the redaction rule worked
(a self-chosen path outside the home directory stayed verbatim, [[075]] AC4).

But it stops one step short of the cause, and the step is always the same one. Everything the
report describes ends *before* assembly, and assembly is the stage that failed: with all three
archives verified and extracted, an unplayable target means
[`assembleInstallation`](../../src/main/modules/downloads/bootstrap/assemble.ts) copied nothing —
each allowlist entry it could not find is silently `continue`d ("A missing allowlisted file is
skipped, not thrown"), `assemble.ts` takes no logger at all, and its `copiedFiles` result is used
only as the cleanup set ([job.ts:718](../../src/main/modules/downloads/bootstrap/job.ts#L718)).
So the report cannot distinguish "the archives were wrong" from "our allowlist looks in the wrong
place" — which is exactly the question [[076]] is about, and exactly the question `assemble.ts`'s
own comment already flags as unverified for the two self-extracting id Software installers.

Two data points would have closed it in one glance: **what assembly looked for and whether it
found it**, and **what was actually inside each extracted package**.

## Acceptance Criteria

- [ ] **AC1** — A failure entry that carries diagnostics shows, in the UI, which package failed
      and at which step (fetched / verified / extracted / contributed), built in the renderer from
      `diagnostics.packages` — so the 2026-09-08 run reads as "every package downloaded, nothing
      reached the installation", not as "the result was not usable".
- [ ] **AC2** — For a bootstrap failure the entry shows the target verdict and the failing checks,
      rendered through their existing `messageKey`s (the same keys the library's check list already
      resolves), with no new prose in main and no untranslated string in the UI.
- [ ] **AC3** — The detail is collapsed by default. An entry stays as compact as today until the
      user expands it, and the failure list does not grow taller for entries nobody opens.
- [ ] **AC4** — The bootstrap wizard's failed running step shows the same cause summary as the
      Downloads tab, so the user learns the reason without changing tabs.
- [ ] **AC5** — Copy-report stays the primary action for reporting. Reveal-log is demoted: it is no
      longer offered as the first explanation, and the card never reads as "go look in the log".
- [ ] **AC6** — An entry without diagnostics ([[075]] AC6: written before it, or from the
      single-package pipeline) renders exactly as it does today, with no empty detail affordance.
- [ ] **AC7** — Diagnostics gain the assembly stage: per allowlist entry, what was looked for,
      whether it was found, and which package's extraction served it. A run where nothing was found
      says so per entry, instead of ending at "still invalid after assembly".
- [ ] **AC8** — Diagnostics gain, per package, a bounded listing of what its extraction actually
      produced (top-level entries, capped) — enough to see that a self-extracting installer nested
      its payload under a wrapper directory, without dumping a file tree into `state.json`.
- [ ] **AC9** — Both new records appear in the copied report and are covered by [[075]]'s existing
      size cap and redaction (`capDiagnostics`, `redactHome`) — an entry cannot grow `state.json`
      past its bound, and no account name enters either listing.
- [ ] **AC10** — The UI verification fixture renders the expanded detail for a bootstrap failure
      with diagnostics, offline.

## Open Questions

- **Q1 — Does the *user-facing* card show the assembly table too, or only the report?** AC7/AC8 are
  developer-grade detail; AC1's summary line is what the user needs. Recommendation: the card shows
  the per-package summary (AC1) and the verdict (AC2); the assembly table and the extraction
  listing go into the copied report only, where a maintainer reads them.
- **Q2 — Where does the wizard's summary live (AC4)?** Either `RunningStep` grows the same
  collapsible detail component, or the failed wizard step links into the Downloads tab entry.
  Recommendation: share the component — a link out of a modal to a different tab is the same
  "go somewhere else" move this story is removing.
- **Q3 — Overlap with [[076]].** 076 fixes the allowlist so the packages contribute; this story
  makes a *future* assembly failure legible. If 076 lands first, AC7's table will show all entries
  found on a healthy run — that is the intended shape, not a reason to defer.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
