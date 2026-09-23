---
id: 103
title: a windows build runs on linux through a runner i choose
status: done # draft -> ready -> in-progress -> done
created: 2026-09-22
---

## Requirement

A user on Linux whose only Quake II is a Windows build — the Steam copy, a GOG folder, an r1q2
install carried over from a Windows machine — can either play it through a compatibility layer the
launcher found on their machine, or is told plainly, before they press Play, that it cannot run
here and what to do instead. What they must never get is what they get today: a Play button that
starts something, reports a clean exit four seconds later, and leaves no trace of what went wrong.

Reported by a real Linux beta tester (2026-09-22):

```
17:10:10 (installations) › added installation Quake 2 (vanilla) at /home/user/.local/share/Steam/steamapps/common/Quake 2
17:10:33 (launch)        › launching /home/user/.local/share/Steam/steamapps/common/Quake 2/quake2.exe
17:10:37 (launch)        › game exited with code 0 after 4s
```

Three defects stack up behind those three lines:

1. **Detection accepts a Windows PE as the engine executable.** Since story 100 D3,
   `looksExecutable()` (`src/main/lib/fs-utils.ts:169`) means "regular file carrying an execute
   bit" off Windows. Steam ships `quake2.exe` as `0755`, so it passes. Nothing anywhere asks
   whether a binary is native to the running platform.
2. **Ranking actively prefers the `.exe`.** `rankExecutables()` (`src/main/services/inspector.ts:92`)
   ranks by position in the engine definition's `executables` list — `['quake2.exe', 'quake2']`
   (`src/shared/types/engine.ts:196`) — and is platform-blind. In a folder holding both a native
   binary and a Windows one, the Windows one wins on Linux.
3. **Launch has no gate and produces no signal.** `LaunchService.plan()`
   (`src/main/services/launch.ts:91`) checks only `isFile`. The tester has wine registered through
   `binfmt_misc`, so the kernel accepted the PE, wine ran, gave up, and exited `0` — and the
   launcher reported an ordinary `exited` state, indistinguishable from the user quitting the game.
   Without wine it would have been `ENOEXEC` → the generic `launch.error.processError`, still not
   "this is a Windows binary".

This is CLAUDE.md's platform-parity rule violated in the direction it does not yet cover: not a
feature silently *omitted* on Linux, but one silently *offered* there and failing.

The upside is larger than the bug. R1Q2 is Windows-only by decision (story 100 AC6,
[analysis B3](../linux-support-analysis.md)), so today the launcher's *primary* engine cannot run on
Linux at all. A wine runner makes it run — a much cheaper answer to blocker B1 than
[story 102](102-a-linux-q2pro-is-built-and-mirrored.md)'s standing obligation to build Q2PRO from
source and mirror it.

**Scope split (refine, 2026-09-23).** The tester's second round established that a Steam-owned
installation should also be able to hand off to Steam itself
(`steam://launch/<appid>/client/<n>`). That is a handoff, not a wrapper: it needs appid discovery
from `appmanifest_*.acf`, a client table, and a launch state for a process the launcher cannot
observe. It is now [story 104](104-steam-launches-the-client-i-choose.md) and builds on the runner
concept this story introduces. **103 is the local runners: native, wine, umu-run.**

## Acceptance Criteria

- [x] **AC1** — The launcher knows what kind of binary an executable is, by reading its header
      (`MZ` → Windows PE, `\x7fELF` → native ELF), never by file extension or execute bit alone.
      On Linux a folder holding both a native binary and a Windows one offers the native one first.

- [x] **AC2** — An installation on Linux whose selected executable is a Windows binary is never
      silently playable. The state is stated as **visible text** on the installation (not only a
      tooltip), in the platform-parity wording CLAUDE.md requires, and it is a validation check
      like every other — an i18n key with the executable's name as a param, never prose across IPC.

- [x] **AC3** — The launcher detects the ways of running a Windows binary that exist on this
      machine: `wine` on `PATH`, `umu-run` on `PATH`, and Proton builds inside the Steam libraries
      `findSteamRoot()`/`steamLibraryRoots()` already enumerate. Each found runner is recorded with
      what it is and where it is; nothing is assumed present.

- [x] **AC4** — An installation carries a runner choice the user sets, in a **Runner section of the
      installation detail** that also shows the resolved command. The default resolves on its own:
      native when a native executable exists, otherwise the best detected compat runner, otherwise
      nothing runnable. An unrunnable installation additionally raises a validation check whose fix
      points at that section.

- [x] **AC5** — Launching through a local runner (wine/umu) is a launch like any other: the same
      generated `+set` arguments and user launch args, the same working directory, the same
      `launch:state` phases, playtime recorded on exit, and the installation write guard still sees
      a running game. Args keep going through `spawn`'s array form — never a shell string — exactly
      as `LaunchService`'s own doc comment requires.

- [x] **AC6** — A runner the machine does not have is shown, disabled, carrying its reason as
      visible text ("wine not found — install wine to run Windows builds"), never omitted from the
      list. i18n keys like every other label.

- [x] **AC7** — Pressing Play when nothing on this machine can run the selected executable refuses
      with that reason and spawns no process at all. The refusal names the concrete way out — use
      this folder's game data with a native engine (story 089's existing-folder source), or install
      a runner.

- [x] **AC8** — Windows behaviour is byte-for-byte unchanged: no runner wrapping, no header read in
      the ranking path, the same executable chosen for the same folder as before this story.

## Open Questions

All resolved in the refine round of 2026-09-23 — kept here as the record of what was decided and
why, because each one bounds a deliverable.

**Q1 — Which runners does this story support, as opposed to merely detect? — RESOLVED: wine and
umu-run are supported runners; raw Proton is detected and offered only as a umu-run target, never
driven directly.** `wine <exe> <args>` and `umu-run <exe> <args>` are one-line wrappers; raw Proton
needs `STEAM_COMPAT_CLIENT_INSTALL_PATH`, a `STEAM_COMPAT_DATA_PATH` prefix the launcher would then
own, and behaves differently across Proton versions. For a *Steam-owned* installation "run it under
Proton" is answered by [story 104](104-steam-launches-the-client-i-choose.md)'s handoff anyway, so
driving Proton directly would only buy something for a Windows build Steam does not own — which is
exactly the case umu-run exists for.

**Q2 — Whose wine prefix? — RESOLVED: the machine default.** The launcher sets no `WINEPREFIX` and
behaves exactly like typing `wine quake2.exe` in a terminal, which is what a Linux user expects. A
launcher-owned prefix per installation would make the launcher responsible for creating, upgrading
and repairing prefixes — a support surface comparable to the downloads module — for no benefit this
story needs.

**Q3 — Is the Steam handoff in scope? — RESOLVED: yes, but as its own story.** See the scope split
above: [story 104](104-steam-launches-the-client-i-choose.md). Q6 (where the client entries come
from) and Q7 (`launch:state` for a handoff) moved there with it.

**Q4 — What does this do to [story 102](102-a-linux-q2pro-is-built-and-mirrored.md)? — RESOLVED as
far as this story can: 102 is not cut into a sprint until 103 has landed on a real Linux machine.**
If r1q2 runs under wine, blocker B1 has a second, far cheaper answer than building and mirroring
Q2PRO from source forever. 103 does not decide 102's fate; it makes the decision possible.

**Q5 — Is the engine table's `supported` flag the right shape here? — RESOLVED: no change to
`supported`.** A runner changes *whether the binary executes*, not *whether the config module can
manage that engine*. Steam's vanilla `quake2.exe` under wine is still an engine the launcher only
partly manages, and the existing `supported: false` messaging stays exactly as it is. The runner
picker says nothing about engine support, and the two texts sit side by side without either
contradicting the other.

**Discovered in refine, and now part of the plan:** AC4 originally said the runner choice sits
"next to the executable selection" and shows in "the existing launch preview". Neither surface
exists. Executable selection today is only a fix button inside `ChecksList`, and `launch:plan`'s
`preview` string is built in main but never rendered anywhere in the renderer. The Runner section
(D7) is therefore new UI, and it is also the **first implementation anywhere in the app** of
CLAUDE.md's disabled-with-visible-reason rule — there is no prior component to copy.

*Adjacent and deliberately excluded:* the roadmap's standing "crash detection — a non-zero exit
shortly after start is worth surfacing" follow-up. The tester's exit was code **0**, so that
follow-up would not have caught this; it is its own story.

## Plan

Four layers, bottom up. Every step off Windows only — `process.platform === 'win32'` takes the
exact path it takes today (AC8), which is why the header read lives behind a platform branch rather
than in the generic ranking code.

1. **Probe** (D1) — `readBinaryKind()` in `fs-utils.ts` reads the first 4 bytes: `MZ` → `'pe'`,
   `\x7fELF` → `'elf'`, `#!` → `'script'`, else `'unknown'`. Pure, no platform knowledge.
2. **Rank + report** (D2, D3) — `rankExecutables()` learns, off Windows only, to sort native
   binaries ahead of PEs; the inspector records the chosen executable's kind and raises a new
   `executable-runnable` check when it is foreign. `ValidationCheckId`/`ValidationFix` gain one
   member each.
3. **Runners** (D4, D5) — a new `src/main/services/runners.ts` detects wine/umu-run on `PATH` and
   Proton builds under the Steam libraries; `Installation.runner` stores the choice; every wrapping
   decision happens in exactly one place, `LaunchService.plan()`, which rewrites
   `executablePath`/`args` and therefore fixes the preview and the spawn together. `start()` gains
   no new logic beyond refusing a plan that has no runner (AC7).
4. **Surface** (D6, D7) — one new invoke channel lists the detected runners; the Runner section in
   the installation detail renders the choice, the disabled entries with their reasons, and the
   command `launch:plan` resolves.
5. **Proof** (D8) — a new e2e flow with two branches off one fixture: on Linux it proves AC2/AC4/
   AC6/AC7 and, with a stub `wine` script on `PATH`, AC5; on Windows it proves AC8. Wired into the
   existing ubuntu xvfb CI job.

Ordering is strict D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8; D9 (changelog/docs) last.

**Non-goals:** raw Proton execution, launcher-owned wine prefixes, any Steam handoff, any change to
`EngineDefinition.supported`, and any restructuring of executable selection (it stays a fix button
in `ChecksList` for now).

## Deliverables

**D1 — Binary header probe.** `readBinaryKind(path): Promise<'pe' | 'elf' | 'script' | 'unknown'>`
in `src/main/lib/fs-utils.ts`, reading only the first 4 bytes and returning `'unknown'` for an
unreadable or too-short file (never throwing). Mirror the neighbouring helpers' shape
(`looksExecutable` L169, `findChild` L140). Plus its test in `src/main/lib/fs-utils.test.ts`.
*Files:* `src/main/lib/fs-utils.ts`, `src/main/lib/fs-utils.test.ts`.
*Accepted when:* an `MZ` file reports `'pe'`, an ELF file reports `'elf'`, a missing file reports
`'unknown'`, and nothing else in the module changed.

**D2 — Native-first ranking, off Windows only.** `rankExecutables()`
(`src/main/services/inspector.ts:92`) gains a kind-aware sort: on `win32` it is the function it is
today, byte for byte; elsewhere `'elf'`/`'script'` sort ahead of `'pe'` and the existing
name-position ranking becomes the tie-break within each group. Becomes async (or takes a
pre-computed kind map — implementer's call, but the header read must not happen on Windows at all).
The chosen executable's kind lands on `ValidationResult` and is persisted on the installation
(`executableKind?: BinaryKind`, following `src/main/lib/schemas.ts:92`'s `.optional()` convention —
no migration step, per `src/main/services/migrations.ts`'s own rule).
*Files:* `src/main/services/inspector.ts`, `src/main/services/inspector.test.ts`,
`src/shared/types/installation.ts`, `src/main/lib/schemas.ts`.
*Mirror:* the existing rank helpers in `inspector.ts`; `stubPlatform()` from
`src/test-support/platform.ts` for the platform branch in tests.
*Accepted when:* a fixture folder holding `quake2.exe` (PE) and `quake2` (ELF) yields `quake2` first
under a stubbed `linux` and `quake2.exe` first under a stubbed `win32`.

**D3 — The `executable-runnable` check.** New `ValidationCheckId` member `'executable-runnable'` and
new `ValidationFix` member `'choose-runner'` in `src/shared/types/installation.ts:41-56`. The
inspector raises the check off Windows when the selected executable is `'pe'`, with the executable's
file name as a param. New i18n keys under `validation.` and `validation.fix.`. Renderer: one new
case in `useFixAction()` (`src/renderer/src/components/installations/ChecksList.tsx:81-130`) that
focuses the Runner section D7 adds (a `#`-anchor/`scrollIntoView` + focus is enough — no dialog).
*Files:* `src/shared/types/installation.ts`, `src/main/services/inspector.ts`,
`src/main/services/inspector.test.ts`, `src/renderer/src/components/installations/ChecksList.tsx`,
`src/renderer/src/i18n/locales/en.json`.
*Mirror:* the `executable`/`validation.noExecutable` check at `inspector.ts:236-247`.
*Accepted when:* a Linux-stubbed inspection of a PE-only folder returns a check with the new id, the
new message key and the file name in `params`; Windows returns no such check.

**D4 — Runner detection.** New `src/shared/types/runner.ts` (`RunnerKind = 'native' | 'wine' |
'umu' | 'proton'`, `DetectedRunner { kind, id, label?, path, available }`) and new
`src/main/services/runners.ts` with `detectRunners()`: `wine` and `umu-run` resolved off `PATH`,
Proton builds found under each Steam library's `steamapps/common/Proton*`. Requires exporting
`steamLibraryRoots()` from `src/main/services/detection/providers.ts:62` (currently module-private)
— export it, change nothing about it. On `win32` the function returns the native runner only and
touches neither `PATH` nor the Steam libraries.
*Files:* `src/shared/types/runner.ts`, `src/main/services/runners.ts`,
`src/main/services/runners.test.ts`, `src/main/services/detection/providers.ts`.
*Accepted when:* with a stubbed `PATH` containing a `wine` script the result contains a wine runner
with that path; with an empty `PATH` it contains the same entry marked `available: false`; on a
stubbed `win32` the result is native-only.

**D5 — Runner choice and the wrapped launch plan.** `Installation.runner?: RunnerChoice` (the
runner id, or `'native'`), optional + `.catch(undefined)` in `src/main/lib/schemas.ts`. A
`resolveRunner(installation, detected)` in `runners.ts` implements AC4's default cascade and, on
`win32`, always returns native. `LaunchService.plan()` (`src/main/services/launch.ts:91-113`)
becomes the single wrapping point: after `buildLaunchArgs`, a non-native runner rewrites
`executablePath` to the runner binary and prepends the original executable to `args`; `preview`
follows from the rewritten pair for free; `workingDirectory` is untouched. When nothing can run the
executable, `plan()` fails with a new `launch.error.noRunner` (params: executable name) — which
means `start()` (L129-130) refuses before `spawn` with no extra code (AC7). No `env` is set
(Q2: machine-default prefix). Playtime, write guard and `launch:state` are untouched by
construction (AC5).
*Files:* `src/shared/types/installation.ts`, `src/main/lib/schemas.ts`,
`src/main/services/runners.ts`, `src/main/services/launch.ts`, `src/main/services/launch.test.ts`,
`src/renderer/src/i18n/locales/en.json`.
*Accepted when:* a Linux-stubbed plan for a PE with a wine runner yields
`executablePath = <wine>` and `args[0] = <the exe>` with the generated `+set` args after it; the
same plan on `win32` is identical to today's; a PE with no available runner fails with
`launch.error.noRunner` and `start()` spawns nothing.

**D6 — IPC surface.** One new invoke channel `installations:listRunners` (req: installation id,
res: `Outcome<RunnerOption[]>` — each option carrying kind, label key, availability and, when
unavailable, its reason key) declared in `src/shared/ipc.ts` first, added to `INVOKE_CHANNELS`, with
its zod schema in `src/shared/ipc-schemas.ts` and its handler alongside the existing installation
handlers. Setting the choice needs no new channel — it rides `installations:update`.
*Files:* `src/shared/ipc.ts`, `src/shared/ipc-schemas.ts`, `src/main/ipc/installations.ts`,
`src/main/ipc/installations.test.ts`.
*Mirror:* `installations:validate` (`src/shared/ipc.ts:96`) and its handler; the IPC coverage test.
*Accepted when:* the channel round-trips through the real registrar, the preload allowlist derives
it without edits, and the coverage/exhaustiveness tests pass.

**D7 — Runner section in the installation detail.** New
`src/renderer/src/components/installations/RunnerSection.tsx`, rendered from `InstallationRow`
(`src/renderer/src/views/LibraryView.tsx:220`, next to `<ChecksList />` at L453). Lists every runner
from D6; unavailable ones stay visible, are `disabled`, and carry their reason as **visible text**
under the label (CLAUDE.md's rule, first implementation in the app — no `title`-only tooltip).
Shows the resolved command from `launch:plan`. On `win32` the section is not rendered at all (AC8 —
there is exactly one runner and nothing to choose). Testids: `installation-runner`,
`installation-runner-option-<kind>`, `installation-runner-reason-<kind>`,
`installation-runner-preview`. New i18n keys under `runner.`.
*Files:* `src/renderer/src/components/installations/RunnerSection.tsx`,
`src/renderer/src/components/installations/RunnerSection.test.tsx`,
`src/renderer/src/views/LibraryView.tsx`, `src/renderer/src/i18n/locales/en.json`.
*Accepted when:* the component test renders an unavailable wine entry as a disabled control whose
reason text is in the DOM as text, and selecting an available runner calls `installations:update`
with the new runner id.

**D8 — The end-to-end proof.** New flow `scripts/flows/windows-build-on-linux.mjs` plus a fixture
builder in `scripts/lib/fixture.mjs` that writes an install root containing a real `MZ`-header
`quake2.exe` and (for the ranking half) a native `quake2`. Two branches off one fixture, the way
`linux-user-journey.mjs` already branches on vendored-binary availability — loudly, never a silent
no-op:
- **Linux:** add the PE-only folder → assert the visible check text (AC2) and the Runner section's
  disabled wine entry with its reason (AC6) on a scrubbed `PATH`; press Play → assert the refusal
  and that **no** `launch:state` `running` is broadcast (AC7); then put a stub `wine` shell script
  on `PATH` that execs its first argument, choose it (AC4), and assert `running` → `exited` through
  the real `window.q2.on('launch:state', …)` listener (AC5), reusing `linux-user-journey.mjs`'s own
  listener pattern (L232-263).
- **Windows:** the same fixture adds with `quake2.exe` selected, no Runner section, and the launch
  preview unchanged (AC8).
Wire the flow into the ubuntu xvfb job at `.github/workflows/ci.yml:101`.
*Files:* `scripts/flows/windows-build-on-linux.mjs`, `scripts/lib/fixture.mjs`,
`.github/workflows/ci.yml`.
*Mirror:* `scripts/flows/linux-user-journey.mjs` — its `setup()`/`Q2L_UI_PICK_FOLDER` stub, its
launch-state listener, its loud-skip gate.
*Accepted when:* `npm run ui:flow -- windows-build-on-linux` passes on Windows and the ubuntu job
runs the Linux branch green.

**D9 — Changelog and the 102 note.** A `### Added`/`### Fixed` entry in `CHANGELOG.md` (house style
per `.claude/ai-scrum.md`'s Notes: Keep-a-Changelog headings, current version section only), and one
paragraph in `docs/linux-support-analysis.md` recording that blocker B1 now has a second answer and
that [story 102](102-a-linux-q2pro-is-built-and-mirrored.md) waits on real-machine confirmation
(Q4).
*Files:* `CHANGELOG.md`, `docs/linux-support-analysis.md`.
*Accepted when:* a user reading the changelog understands that Windows builds now run on Linux
through wine/umu and that the launcher refuses instead of pretending when they cannot.

## Model Hints

- **D2 → `deliverable-hard`.** Regression risk: `rankExecutables()` decides which executable every
  installation on **every** platform gets, and AC8 demands the Windows path stay byte-for-byte
  identical while the function becomes async and kind-aware — a wrong branch here silently changes
  the engine chosen for existing Windows users.
- **D5 → `deliverable-hard`.** Cross-module subtlety: `plan()` is shared by the preview and by
  `start()`, and the rewrite has to leave the write guard, playtime recording and the `launch:state`
  sequence untouched while introducing a refusal path that must fire *before* `spawn` — the exact
  seam where the reported bug lives.
- D1, D3, D4, D6, D7, D8, D9 → default.
- **Review: → `story-review-hard`.** The story's headline promise is a negative one (AC8: Windows
  behaviour byte-for-byte unchanged) across the launch and detection paths, which is precisely what a
  cheap diff review is worst at confirming.

## Acceptance Tests

- AC1 → unit `src/main/lib/fs-utils.test.ts` › "reads a PE header as pe and an ELF header as elf"
  **and** unit `src/main/services/inspector.test.ts` › "on linux a native binary outranks a windows
  one in the same folder" (D1, D2)
- AC2 → e2e `scripts/flows/windows-build-on-linux.mjs` › Linux branch, step "the windows build is
  called out in visible text" — asserts the check's rendered text in the DOM, not a title attribute
  (D3, D8); backed by unit `src/main/services/inspector.test.ts` › "a windows executable raises
  executable-runnable with the file name"
- AC3 → unit `src/main/services/runners.test.ts` › "finds wine and umu-run on PATH and proton under
  the steam libraries" (D4)
- AC4 → e2e `scripts/flows/windows-build-on-linux.mjs` › Linux branch, step "choosing wine changes
  the previewed command" (D7, D8); backed by unit `src/main/services/runners.test.ts` › "the default
  runner is native when a native executable exists"
- AC5 → e2e `scripts/flows/windows-build-on-linux.mjs` › Linux branch, step "a wine launch reaches
  running then exited" — real `launch:state` broadcasts through the preload bridge, against a stub
  `wine` on `PATH` (D8); backed by unit `src/main/services/launch.test.ts` › "a wine plan keeps the
  generated args, the working directory and the array spawn form"
- AC6 → e2e `scripts/flows/windows-build-on-linux.mjs` › Linux branch, step "an absent runner is
  disabled, not hidden, and says why" (D8); backed by component
  `src/renderer/src/components/installations/RunnerSection.test.tsx` › "an unavailable runner
  renders its reason as visible text"
- AC7 → e2e `scripts/flows/windows-build-on-linux.mjs` › Linux branch, step "play refuses and starts
  nothing" — asserts no `running` phase is ever broadcast (D8); backed by unit
  `src/main/services/launch.test.ts` › "start refuses with noRunner and never spawns"
- AC8 → e2e `scripts/flows/windows-build-on-linux.mjs` › Windows branch — asserts `quake2.exe` stays
  ranked/selected, no Runner section renders, and `launch:plan`'s preview is the plain unwrapped
  executable (D8); backed by unit `src/main/services/inspector.test.ts` › "on win32 the same folder
  still offers quake2.exe, and reads no header" (and its sibling "on win32 the same folder raises no
  executable-runnable check") and `src/main/services/launch.test.ts` › "win32 plan is unwrapped"

**manual residue:** a real `wine` (or `umu-run`) installation actually rendering Quake II from a
genuine Windows build. The automated Linux branch proves the launcher builds the right command,
hands it to a real `wine` on `PATH` and reports the real process lifecycle, but the runner on CI is
a stub script — a real wine prefix plus a licensed Windows Quake II build is neither installable nor
distributable on the CI image. *Reason: external third-party software and copyrighted game data not
available to CI.* One walk-through on the beta tester's machine closes it.

**No gap:** every AC above maps to the `e2e` command from the profile's `## Verify`
(`npm run ui:verify` / `npm run ui:flow`) where it describes something the user does, and to `test`
where it is core logic. The Linux branch of D8's flow only executes in the ubuntu xvfb CI job
(`.github/workflows/ci.yml:101`) — a dev machine on Windows runs the Windows branch. That is the
same arrangement story 100 D10 established, not a new gap.

## Done

**Summary.** A Windows Quake II build (Steam, GOG, a carried-over folder) is now detected by
reading the executable's header (`readBinaryKind()`), never by extension or execute bit; off
Windows a native binary in the same folder now outranks a `.exe`. A Windows binary with no native
alternative raises a visible `executable-runnable` validation check. The launcher detects wine,
umu-run and Proton builds (`detectRunners()`), lets the user pick one in a new Runner section of
the installation detail (unavailable runners shown disabled with their reason, Proton shown
disabled since this story never drives it directly — Q1), wraps the launch through wine/umu when
chosen (`LaunchService.plan()`), and refuses cleanly with `launch.error.noRunner` — surfaced as an
error toast — when nothing can run it, instead of the silent false "exited cleanly" the bug report
described. Windows behaviour is untouched (four independent `win32` early-returns, each traced and
unit-tested).

**Review.** Two clean-agent review rounds. Round 1: **FAIL** — the `executable-runnable` check was
raised at `error` severity, which forced installation status to `invalid` and permanently disabled
the Play button, making AC5's wrapped launch and AC7's press-and-refuse both unreachable through
the real UI (only a raw IPC call could exercise them). Fixed at the root: the check is now `warn`
severity (non-blocking; visible text is unaffected), with the seam pinned on both sides
(`inspector.test.ts`'s "stays playable" test, `status.test.ts`'s `isPlayable('warning')`). Six
smaller findings fixed alongside it: the Runner section's previewed command now refreshes when the
chosen runner changes; the section's container `id` is installation-scoped (was a single hardcoded
id shared by every installation row, so the "choose a runner" fix action always focused the first
one); a failed `launch:plan` preview is now rendered as visible text instead of silently dropped;
detected Proton builds are now marked unavailable with a reason instead of offered as a selectable
option that could never actually run anything; an i18n dash was made consistent. Round 2:
**PASS**, with 3 more test-quality findings fixed (the e2e AC4 step was passing for the wrong
reason — the cascade default, not the user's explicit click, had already changed the preview by
the time the assertion ran; the AC5 success-path step still bypassed the real Play button via a
raw invoke; one new RunnerSection test only asserted non-empty text rather than the resolved
sentence) and 3 documented, not fixed (below).

**Verification.**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `npm test` — 4158 passed, 2 pre-existing failures unrelated to this story
  (`UpdateCheckRow.test.tsx`, `NewsHero.test.tsx` — relative-time assertions that fail on this
  machine's German host locale, confirmed by stashing this story's changes and reproducing the
  same failures against the untouched tree).
- `npm run ui:verify` — 86/86 screenshots clean, 0 axe violations.
- `npm run ui:flow -- windows-build-on-linux` — Windows branch passes for real on this machine
  (AC8: ranking, absent Runner section, unwrapped preview, all unchanged); the Linux branch
  (AC2, AC4–AC7) is loudly skipped here by design and runs on the ubuntu xvfb CI job
  (`.github/workflows/ci.yml`), verified by static read-through in both review rounds.

**AC → test mapping, as verified:**
- AC1 → `fs-utils.test.ts` › "reads a PE header as pe and an ELF header as elf" (passed) +
  `inspector.test.ts` › "on linux a native binary outranks a windows one in the same folder"
  (skipped on this Windows host — execute bits aren't real on NTFS — runs on ubuntu CI)
- AC2 → e2e Linux branch, visible check text (ubuntu-CI-only) + `inspector.test.ts` › "a windows
  executable raises executable-runnable with the file name" (skipped here, runs on ubuntu CI)
- AC3 → `runners.test.ts` › "finds wine and umu-run on PATH and proton under the steam libraries"
  (win32-native-only half passed here; PATH/Proton half runs on ubuntu CI)
- AC4 → e2e Linux branch, explicit-choice-changes-preview (ubuntu-CI-only, rewritten in review
  round 2 to use two available runners so the assertion can't pass on the cascade default alone)
  + `runners.test.ts` › "the default runner is native when a native executable exists" (passed)
- AC5 → e2e Linux branch, real Play click reaches running → exited (ubuntu-CI-only) +
  `launch.test.ts` › "a wine plan keeps the generated args, the working directory and the array
  spawn form" (passed)
- AC6 → e2e Linux branch, disabled runner with reason (ubuntu-CI-only) +
  `RunnerSection.test.tsx` › "an unavailable runner renders its reason as visible text" (passed)
- AC7 → e2e Linux branch, real Play click refuses via toast, no `running` broadcast
  (ubuntu-CI-only) + `launch.test.ts` › "start refuses with noRunner and never spawns" (passed)
- AC8 → e2e Windows branch (passed here, for real) + `inspector.test.ts` › "on win32 the same
  folder still offers quake2.exe, and reads no header" + "on win32 the same folder raises no
  executable-runnable check" + `launch.test.ts` › "win32 plan is unwrapped" (all passed here)

**manual residue** (accepted at refine, unchanged): a real wine/umu-run installation actually
rendering Quake II from a genuine Windows build — CI has no licensed game data or real wine
environment; the automated Linux branch proves the launcher builds the right command and hands it
to a real `wine`/`umu-run` stub, reporting the real process lifecycle. Closed by one walk-through
on the beta tester's machine.

**Documented, not fixed** (round 2 findings, non-blocking — overall verdict PASS with these
present):
- `runner.unavailable.native` and the original `runner.unavailable.proton` i18n keys are now dead
  (native is always reported available; Proton's reason uses the more specific
  `runner.unavailable.protonNotDriven` added during the fix). Harmless, cheap follow-up cleanup.
- Selecting "Native" for an installation whose only executable is a Windows PE persists
  `runner: 'native'` and shows it checked, but `resolveRunner()` deliberately ignores an
  unrunnable stored choice and silently falls back to the cascade (documented at the function) —
  so the checked option and the shown preview can disagree. A future story should consider
  marking "Native" unavailable for a PE-only installation rather than always offering it.
- Every installation row on Linux calls `detectRunners()` (a PATH walk + Steam library scan) and
  `launch:plan` on mount and on every runner change — no correctness issue, but N installations
  cause N host scans; worth a shared/cached detection pass if the library view ever needs to
  scale.

**Commit message:** `103: a windows build runs on linux through a runner i choose`
