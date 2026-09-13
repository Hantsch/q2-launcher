---
id: 098
title: I update when I choose to
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

[[097]] knows an update exists; the user has to be able to see that and act on it — or not.
A launcher that updates itself behind the user's back is a launcher that interrupts a game
night, and a launcher that only mentions it in a settings page buried three clicks deep is one
nobody updates at all. The middle is a single affordance in the titlebar, left of the Downloads
button in the same utility row ([TitleBar.tsx](../../src/renderer/src/components/shell/TitleBar.tsx)),
that appears only when there is something to update and says what it is.

The user decides both _whether_ and _when_. Choosing to update downloads the release and then
waits — the launcher restarts into the new version only on a second, deliberate confirmation.
Dismissing it leaves the launcher running exactly as before; nothing is installed, nothing
nags again in the same session.

One hard rule: the launcher never restarts itself out from under a running game or an in-flight
download job. Those are the two cases where a restart destroys work the user can see, and both
already have state the launcher tracks.

## Acceptance Criteria

- [ ] **AC1** — When [[097]]'s state says an update is available, an update control appears in
      the titlebar's utility row, immediately left of the Downloads button; when no update is
      available it is not there at all.
- [ ] **AC2** — The control names the available version before the user commits to anything, and
      offers a way to see what changed ([[099]]'s notes) rather than only a version number.
- [ ] **AC3** — Starting the update downloads the release with visible progress, and the launcher
      stays fully usable while it downloads.
- [ ] **AC4** — Nothing is installed and nothing restarts until the user confirms a second time,
      after the download has finished.
- [ ] **AC5** — Dismissing the update leaves the launcher running unchanged and does not show the
      prompt again in the same session; the control remains reachable for the user to come back to.
- [ ] **AC6** — Restart-and-install is refused, with a readable reason, while a game launched by
      this launcher is running or a download job is in flight — it does not kill either.
- [ ] **AC7** — A failed download (offline, checksum/signature mismatch, cancelled) leaves the
      installed launcher untouched and says why, with the update still offerable afterwards.
- [ ] **AC8** — After a successful restart the launcher runs the new version, and the update
      control is gone.

## Open Questions

- ~~**What exactly is "the control"?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** The control is an icon button (matching the Downloads button's `size-8` deviation)
  that opens a popover carrying the version, a notes link, and the two staged actions
  (download, then confirm restart).

### Contract and main process

- **The update download is not a `JobsService` job** — it would otherwise trip AC6's own "a
  download job is in flight" guard, and `Job` is installation-scoped module work, which an app
  update is not; its progress lives in the update state and is shown in the popover.
- **The two guards reuse the state main already tracks**: `LaunchService.isRunning()`
  ([launch.ts:86](../../src/main/services/launch.ts#L86)) and
  `app.jobs.list().some(isJobActive)` ([jobs.ts:72](../../src/main/services/jobs.ts#L72),
  `isJobActive` in `src/shared/types/jobs.ts`) — no new tracking is invented for this story.
- **The refusal is authoritative in main**, returned as `fail('appUpdate.error.*')` and only
  mirrored by the renderer — the same shape story 091 used for `launch.error.installationBusy`,
  so a disabled button is never the only thing standing between a game and a restart.
- **`autoInstallOnAppQuit = false`** — left at its default, a downloaded update installs itself on
  the next ordinary quit and AC4's second confirmation would mean nothing.
- **Cancel during download is offered** and returns the state to "available" — AC7 lists
  `cancelled` as a failure path, so something has to be able to cause it.
- **Dismissal is in-memory in main's update state** (`dismissed`, reset on app start), not
  persisted: a renderer reload must not resurrect the nag, and nothing should persist a decision
  the criterion scopes to one session.
- **The new channels extend [[097]]'s update domain**, service and state type rather than adding a
  second one; if 097's refine settled on a different prefix than `update:*`, follow 097's.

### Renderer

- **Dismissing only removes the attention marker; the button stays** (AC5), and the popover never
  opens by itself — not nagging is the whole point of the story.
- **The trigger reuses the titlebar's existing `UtilityButton`** (the Downloads button's own
  shape), extracted into its own file so `UpdateButton` can use it without importing `TitleBar`
  back; that button is `size-11` (44px) today, so no new CLAUDE.md deviation row is needed — the
  `size-8` row in CLAUDE.md describes story 031's older titlebar.
- **Placement is before `utilityModules.map(...)`** in [TitleBar.tsx:87](../../src/renderer/src/components/shell/TitleBar.tsx#L87), i.e. left of Downloads, the first secondary module.
- **A new `components/ui/Popover.tsx`** modelled on `Menu.tsx` rather than generalising `Menu` —
  `Menu` is item-list-shaped and has many call sites to regress; the popover carries rich content,
  `role="dialog"`, Escape/outside-click dismissal and focus return to the trigger.
- **Progress uses the existing `ProgressBar`** primitive, not a second progress widget.
- **"What changed" is a link into Settings → About** ([[099]]'s surface, which gets a
  `data-testid` anchor here), not markdown rendered inside the popover — 099 owns notes rendering
  and a titlebar popover is not a document viewer.
- **Update state is mirrored into the existing `useLauncher` store** slice 097 adds, not a new
  store; all strings live under `appUpdate.*` in `en.json` and main sends keys, never prose.

### Verification

- **The e2e flow drives a fake updater backend injected into the real service** through a new
  dev-only `dev:simulateAppUpdate`, mirroring `dev:simulateJob('writing')`'s "real guard, faked
  work" precedent — only the network and `quitAndInstall` are faked, every transition and both
  refusals run through the real code.
- **AC8's second half is manual residue**: proving a restart actually runs the new build needs a
  packaged install plus a published release, and [[097]] AC5 forbids the updater in unpackaged
  builds — which is exactly what `ui:verify` runs.

## Plan

[[097]] holds the state (available version, notes, error reason, manual check). This story adds
the act: four staged actions in main, a titlebar control that drives them, and a fake updater
backend so the whole flow is verifiable offline.

**Main (D1).** Extend 097's update service with `startDownload` / `cancelDownload` /
`installAndRestart` / `dismiss` and a `phase` of `idle | checking | available | downloading |
downloaded | error`. `installAndRestart` is the only path that touches the installed launcher, and
it refuses — `appUpdate.error.gameRunning`, `.jobActive`, `.notReady` — before doing so, reading
`LaunchService.isRunning()` and the job list; it never cancels either. `autoInstallOnAppQuit` is
turned off. Download errors (offline, checksum, cancelled) fall back to `available` carrying a
reason, so the update stays offerable and nothing on disk changed. The four channels go into
`src/shared/ipc.ts` + `ipc-schemas.ts` (all `z.void()`) and `src/main/ipc/update.ts` via
`handleOutcome`.

**Renderer (D2, D3).** `components/ui/Popover.tsx` (portal + anchor placement + Escape/outside
click, mirroring `Menu.tsx`) and `UtilityButton` extracted out of `TitleBar.tsx`. Then
`UpdateButton` + `UpdatePopover` in `components/shell/`, rendered left of Downloads only while the
state says an update exists: the button carries an attention dot until the user acts or dismisses,
the popover names the version, links to Settings → About, and shows exactly one primary action per
phase — Download → (progress + Cancel) → Restart and install → the refusal reason when the guard
says no.

**Verification (D4, D5).** `dev:simulateAppUpdate` injects a fake backend into the real service
(available / progress / downloaded / error scenarios) plus a dev-panel button, mirroring
`dev:simulateLaunch`. `scripts/flows/app-update.mjs` then walks AC1–AC7 against the real app, using
`dev:simulateLaunch('running')` and `dev:simulateJob('stall')` for the two refusals, and
`scripts/lib/screens.mjs` gets the open popover as a screen so `npm run ui:verify`'s axe pass sees
it.

Order: D1 → D2 → D3 → D4 → D5 (D5 needs D4's simulation channel).

## Deliverables

- **D1 — Staged update actions and the restart guard (main + contract).**
  `src/shared/types/app-update.ts` (097's state type: add `phase`, `progress`, `dismissed`,
  `error`), `src/shared/ipc.ts` (+`update:download`, `update:cancelDownload`,
  `update:installAndRestart`, `update:dismiss`, all in `INVOKE_CHANNELS`),
  `src/shared/ipc-schemas.ts` (four `z.void()` schemas), `src/main/services/app-update.ts` (097's
  service: the four actions, the updater-backend seam, `autoInstallOnAppQuit = false`),
  `src/main/ipc/update.ts` (097's registrar, `handleOutcome`), `src/main/ipc/index.test.ts` (bump
  the registered-channel count). Mirror: `src/main/services/launch.ts` + `src/main/ipc/launch.ts`
  for the guard-then-`fail(key)` shape. Acceptance: the state machine, both refusals, the
  error-to-`available` fallback and `autoInstallOnAppQuit` are covered by
  `src/main/services/app-update.test.ts`.
- **D2 — A popover primitive and a reusable utility button (renderer plumbing, no behaviour
  change).** New `src/renderer/src/components/ui/Popover.tsx` (mirror
  `src/renderer/src/components/ui/Menu.tsx`), `src/renderer/src/components/shell/UtilityButton.tsx`
  (moved verbatim out of `TitleBar.tsx`), `TitleBar.tsx` (import instead of local definition).
  Acceptance: `src/renderer/src/components/ui/Popover.test.tsx` proves open/close, Escape,
  outside-click and focus return; the titlebar renders unchanged.
- **D3 — The titlebar update control and its popover.** New
  `src/renderer/src/components/shell/UpdateButton.tsx` and `UpdatePopover.tsx`, `TitleBar.tsx`
  (insert left of `utilityModules.map`), `src/renderer/src/store/useLauncher.ts` (actions on 097's
  update slice), `src/renderer/src/i18n/locales/en.json` (`appUpdate.*`),
  `src/renderer/src/views/SettingsView.tsx` (`data-testid="settings-about"` anchor only). Mirror:
  `modules/downloads/engine/EngineUpdateAction.tsx` for the label/`labelAvailable` pattern.
  Acceptance: `UpdatePopover.test.tsx` asserts one primary action per phase (available →
  downloading → downloaded → error → refused) and that dismissal keeps the button.
- **D4 — Offline simulation of the whole flow (dev-only).** `src/shared/ipc.ts` +
  `ipc-schemas.ts` (`dev:simulateAppUpdate`, also in `DEV_ONLY_CHANNELS`), `src/main/ipc/dev.ts`
  (mirror `dev:simulateLaunch`, [dev.ts:135](../../src/main/ipc/dev.ts#L135)),
  `src/main/services/app-update.ts` (fake backend feeding the real service),
  `src/renderer/src/views/SettingsView.tsx` (dev-panel button), `src/main/ipc/index.test.ts`
  (count). Acceptance: `src/main/ipc/dev.test.ts` covers each scenario reaching the real service.
- **D5 — The offline end-to-end proof.** New `scripts/flows/app-update.mjs` (mirror
  `scripts/flows/job-waits-for-running-game.mjs` for harness, `dev:simulateLaunch` and
  direct-IPC refusal assertions) covering AC1–AC7 plus AC8's control-disappears half, and
  `scripts/lib/screens.mjs` (one new screen: update available, popover open) so `npm run ui:verify`
  screenshots and axes the popover.

## Model Hints

- D1 → `deliverable-hard` — this is the only code in the app that can quit the launcher and
  overwrite its own installation: the guard has to read two live services without cancelling
  either, and a missed `autoInstallOnAppQuit` silently installs an update on the next quit,
  behind the user's back and past AC4.
- D2, D3, D4, D5 → default.
- Review: → `story-review-hard` — a wrong transition here does not produce a cosmetic bug but a
  launcher that restarts out from under a running game or bricks its own installation, and the
  diff spans contract, main, renderer and the harness.

## Acceptance Tests

- AC1 → e2e `scripts/flows/app-update.mjs` › "no control while up to date; the control appears
  left of Downloads once an update is available" (D5) — asserts DOM order against
  `nav-downloads`.
- AC2 → e2e `scripts/flows/app-update.mjs` › "the popover names the version and links to what
  changed" (D5); phase-to-content mapping additionally in
  `src/renderer/src/components/shell/UpdatePopover.test.tsx` (D3).
- AC3 → e2e `scripts/flows/app-update.mjs` › "downloading shows progress and the launcher stays
  usable" (D5) — progress readout advances while the flow navigates Library/Config and back.
- AC4 → e2e `scripts/flows/app-update.mjs` › "a finished download installs nothing until the
  second confirmation" (D5, the fake backend records that `quitAndInstall` was not called), plus
  unit `src/main/services/app-update.test.ts` › "installAndRestart refuses before the download is
  downloaded" and › "a downloaded update does not install itself on quit" (D1).
- AC5 → e2e `scripts/flows/app-update.mjs` › "dismissing stops the prompt for this session and
  leaves the control reachable" (D5) — dismiss, reload the renderer, attention marker gone, button
  present, nothing installed.
- AC6 → e2e `scripts/flows/app-update.mjs` › "restart-and-install is refused while a game runs or
  a job is in flight" (D5) — `dev:simulateLaunch('running')` and `dev:simulateJob('stall')`,
  asserting both the inline reason and the real IPC `error.key`, and that game and job survive;
  plus unit `src/main/services/app-update.test.ts` › "the restart guard refuses and cancels
  nothing" (D1).
- AC7 → e2e `scripts/flows/app-update.mjs` › "offline, checksum mismatch and cancelled each leave
  the launcher untouched and stay offerable" (D5), plus unit
  `src/main/services/app-update.test.ts` › "a failed download falls back to available with its
  reason" (D1).
- AC8 → e2e `scripts/flows/app-update.mjs` › "once the running version matches, the control is
  gone" (D5) — the fake backend reports the installed version, the control disappears.
  **manual residue:** that the restart genuinely relaunches into the new build cannot be
  automated here — it needs a packaged NSIS install plus a published GitHub release, and [[097]]
  AC5 disables the updater in exactly the unpackaged build `ui:verify` drives. Walked once by hand
  against [[096]]'s first release.
- Gate for every e2e line: `npm run ui:flow app-update` for the flow itself; `npm run ui:verify`
  covers the new popover screen (screenshot + axe).

## Done
