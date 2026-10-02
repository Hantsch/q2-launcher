---
id: 180
title: The action bar button speaks for the tab I'm on
status: done # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The big button in the action bar, right of the active installation, is the launcher's main control —
but today it only ever says "Play" (start the game) or, during a demo, "Stop demo" ([[173]]). The
Demos tab meanwhile has its own smaller Play button inside the detail panel, plus a second
"I know the consequences — play anyway" button beneath it. Two play buttons for one screen.

The action bar button becomes **the** primary action for what I am looking at:

- Default (every tab without its own action): **Play** — starts the game, as today.
- **Demos** tab: **View** — plays the selected demo; disabled while no demo is selected.
- While a demo plays: **Stop** — as today ([[173]]).

Its label, enabled state and effect come from the tab that is open. The Demos detail panel loses its
own Play button; the demo-specific play eligibility ([[159]]: Q2PRO required, Wayland, game already
running, …) now decides the action bar button.

This needs a seam the shell does not have yet: a module contributes the primary action for its own
view. The shell keeps deciding the installation-level states (no installation, locate, repair,
installing, write-locked, running) — a module's action only applies when the installation itself
would allow Play. [[181]] uses the same seam for Servers.

## Acceptance Criteria

- [x] **AC1** — On a tab without its own action (e.g. Home, Library), the action bar button reads
      "Play" and starts the game, exactly as today.
- [x] **AC2** — On the Demos tab with no demo selected, the button reads "View" and is disabled.
- [x] **AC3** — On the Demos tab with a demo selected that can play, the button reads "View" and is
      enabled; pressing it plays that demo on the stage exactly as the detail panel's Play did
      ([[170]]).
- [x] **AC4** — On the Demos tab with a selected demo that cannot play, the button is disabled and
      the reason ([[159]]'s eligibility reason) is shown as visible text in the action bar, not only
      as a tooltip.
- [x] **AC5** — While a demo plays, the button reads "Stop demo" and stops it, as today ([[173]]).
- [x] **AC6** — The installation-level states win over a tab's action: with the installation
      missing, broken, installing or write-locked, the button shows Locate / Repair / Install /
      write-locked as today, on the Demos tab too.
- [x] **AC7** — The Demos detail panel shows no Play button and no "play anyway" button.
- [x] **AC8** — Switching tabs updates the button's label and state immediately (Demos → Home turns
      "View" back into "Play").
- [x] **AC9** — Pressing View on a selected demo whose mod is not installed asks for confirmation
      naming the mod (Play anyway / Cancel) before playing; Cancel plays nothing.

## Open Questions

- ~~Q1: Shell edit. CLAUDE.md says a feature never edits the shell; a module-contributed primary
  action is a new shell seam (a contribution point, same spirit as settings sections). Recorded as a
  sprint decision with this story as its reason, or a CLAUDE.md deviation row?~~ answered → Decisions (Sprint)
- ~~Q2: Where does the not-playable reason (AC4) sit — in the action bar's middle readout column
  (recommended: it is empty space when nothing downloads), or under the button?~~ answered → Decisions (Sprint)
- ~~Q3: Label "View" vs. "Watch" for playing a demo — the user said "View". Keep it.~~ answered → Decisions (Sprint)
- ~~Q4: The mod-missing warning ([[159]]'s acknowledgeable reason) loses its "play anyway" button
  (AC7). Proposed split: this story makes View on such a demo open a plain confirmation (Play
  anyway / Cancel), so nothing regresses; [[182]] removes the permanent paragraph and adds
  "don't ask again" plus the Settings switch. Confirm.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Shell edit: recorded as a sprint decision (module-contributed primary action is a new shell seam; reason: this story), no CLAUDE.md deviation row
- **(User)** Not-playable reason: sits in the action bar's middle readout column
- **(User)** Label: "View"
- **(User)** Mod-missing warning split: confirmed; 180 makes View on a mod-missing demo open a plain confirmation (Play anyway / Cancel); 182 removes the permanent paragraph and adds don't-ask-again + Settings switch
- Seam shape: a module view _publishes_ its action into a small shell store (`lib/primary-action.ts`) tagged with its own route, and the action bar applies it only while that route is active — the Demos rows and selection live in `ReplaysView` state, so a static registry field would force lifting them into a store for no gain.
- A contributed action only replaces the shell's `play` case of `resolvePrimaryAction`; every other kind (busy/no installation, running, stop, write-locked, install, locate, repair) is decided before it — this is AC6 by construction.
- The button carries the contribution's own id as `data-action` (`view` for Demos, later `join` for [[181]]) and keeps the Play icon — flows already address the button by `data-action`, and a new icon would be an unasked design change.
- The reason (and a play error, which lost its home with the panel's Play) render in the middle readout column with ids linked by `aria-describedby`; while a note is present the column is shown at every width, because it is `hidden lg:flex` and the window's minimum width (940px) is below `lg` — otherwise AC4's visible text would vanish on a narrow window.
- The mod-missing (acknowledgeable) reason keeps showing in the readout as a note while View stays enabled — it preserves today's information until [[182]] decides the warning's final form; the detail panel itself shows none (the whole play block leaves it).
- The Wayland stage limit stays what it is (a stage reason, not play eligibility, [[170]]) — the story's "Wayland" mention refers to that existing behaviour, and moving it is not in the ACs.
- While a View is in flight (stage arming + IPC) the button is disabled — same as the panel's `busy` today, so a double click cannot launch twice.
- `replays.play.action` / `replays.play.anyway` keys are removed with their only user; `installation.action.view` = "View" joins the other action labels.
- The existing play flows are migrated to the action bar rather than kept on a hidden button — AC7 removes the panel button, so every flow that clicked it must move.

## Plan

**Seam (shell, D1).** New `src/renderer/src/lib/primary-action.ts`: a tiny zustand store
`{ owner: string | null, action: ContributedAction | null }` plus
`usePrimaryActionContribution(owner, action | null)` (publish in an effect, clear on unmount only if
still the owner). `ContributedAction = { id, labelKey, disabled, reason?: LocalizedMessage,
error?: LocalizedMessage, run(): void }`. `ActionBar.tsx`: `resolvePrimaryAction` gains a 5th input
(the contribution, already filtered by `owner === route`) and uses it only where it would return
`play`. `onPrimary` calls `action.run()` for kind `contributed`. The readout column renders the note
(reason dim, error danger + `role="alert"`) and drops `hidden` while a note exists.

**Demos (replays module, D2–D3).** Extract `DemoPlayAction`'s eligibility + `handlePlay`
(stage arm/measure, `playDemo`, `beginSession`) into `modules/replays/useDemoPlay.ts`. `ReplaysView`
calls it for the selected row and publishes `{ id: 'view', labelKey: 'installation.action.view', … }`
under route `/replays` (disabled with no selection). `DemoDetailPanel` drops `<DemoPlayAction>`;
the component and its test are deleted (tests move to the hook). D3 adds a module-owned
confirmation modal for the acknowledgeable mod-missing reason: View opens it, Play anyway calls
play with `acknowledgeModMissing`, Cancel does nothing.

**Flows (D4–D6).** New flow `action-bar-view` for the tab-switching and state ACs;
`replays-play-q2pro` rewritten onto the action bar (AC3, AC4 reason, AC9); every other flow that
clicked `replays-demo-play` migrates to `actionbar-play[data-action="view"]`.

Order: D1 → D2 → D3 → D4 → D5/D6. Note [[177]] also edits `DemoDetailPanel.tsx` this sprint — D2
removes only the play mount, nothing else.

## Deliverables

- [x] **D1 — Shell: the primary-action contribution seam.** New `src/renderer/src/lib/primary-action.ts`
      (store + `usePrimaryActionContribution(owner, action)` hook + `ContributedAction` type: `id`,
      `labelKey`, `disabled`, optional `reason`/`error` as `LocalizedMessage` from `@shared/types`,
      `run()`); clear-on-unmount only when the store's owner is still the caller's. In
      `src/renderer/src/components/shell/ActionBar.tsx`: read `route` from `useLauncher` and the
      contribution; pass it to `resolvePrimaryAction` only when `owner === route`; in the function, the
      contribution replaces only the final `play` return (new kind `contributed`, tone `flame`,
      `disabled` from the contribution); `data-action` is the contribution's `id` for that kind;
      `onPrimary` calls `run()`. The readout column (`hidden lg:flex` div) shows the note —
      `data-testid="actionbar-action-reason"` (text-ink-dim) / `"actionbar-action-error"` (text-danger,
      `role="alert"`) — ahead of `LaunchReadout`, is `flex` at every width while a note exists, and the
      button gets `aria-describedby` to the note. Add `installation.action.view` = "View" to
      `src/renderer/src/i18n/locales/en.json`. Tests in `src/renderer/src/components/shell/ActionBar.test.tsx`
      (mirror the existing "during a demo session …" case) and `src/renderer/src/lib/primary-action.test.ts`:
      "a tab without a contribution shows Play and plays", "a contribution for the active route replaces
      Play", "a contribution for another route is ignored", "installation states win over a
      contribution" (missing → locate, invalid → repair, job → install, writeLock → writing, running →
      running/stop), "a disabled contribution's reason is visible text", "unmount clears only its own
      contribution".
- [x] **D2 — Demos: View plays the selected demo from the action bar.** New
      `src/renderer/src/modules/replays/useDemoPlay.ts`: move `DemoPlayAction.tsx`'s eligibility call and
      `handlePlay` unchanged (stage arm + bounded rect wait + `playDemo` + `beginSession`/`setStageReason`
  - `disarmStage` on failure), returning `{ eligibility, busy, error, play(ack?) }` for a
    `DemoRow | null` (null → not eligible, no reason). `src/renderer/src/modules/replays/ReplaysView.tsx`:
    call it with the selected row (`selected`, ~:274) and publish via `usePrimaryActionContribution('/replays', …)`
    `{ id: 'view', labelKey: 'installation.action.view', disabled: !row || !eligibility.ok || busy,
reason: eligibility reason when a row is selected and not ok, error, run }` — publish a stable
    object (memoised on its fields, `run` via ref) so the effect does not loop. For now an
    acknowledgeable reason keeps the button disabled (D3 changes that). `components/DemoDetailPanel.tsx`:
    remove the `<DemoPlayAction>` mount (:140) and import only. Delete `components/DemoPlayAction.tsx`
    and move its cases from `components/DemoPlayAction.test.tsx` into `useDemoPlay.test.ts`
    (play, error, disabled reason, unsafe name). Tests: `DemoDetailPanel.test.tsx` › "the detail
    panel has no play or play-anyway button"; `ReplaysView.test.tsx` › "selecting a playable demo
    publishes an enabled View", "no selection publishes a disabled View", "leaving the view clears the
    contribution". Remove `replays.play.action` from `en.json` if now unused.
- [x] **D3 — Demos: View on a mod-missing demo asks first.** New
      `src/renderer/src/modules/replays/components/ModMissingConfirmDialog.tsx` mirroring
      `components/DiscardDemoNotesDialog.tsx` (`Modal size="sm"`): title + body naming the mod
      (`{gameDir}` param of the `modMissing` reason), buttons Cancel (`common.cancel`,
      `data-testid="replays-mod-missing-cancel"`) and Play anyway (`replays-mod-missing-confirm`).
      In `useDemoPlay.ts` / `ReplaysView.tsx`: an acknowledgeable reason leaves View enabled (reason
      still published as note); `run` opens the dialog instead of playing; confirm calls
      `play(true)`, Cancel closes and plays nothing. en.json: `replays.play.modMissingConfirm.{title,body,confirm}`;
      remove `replays.play.anyway`. CHANGELOG.md entry under `### Changed` (Demos: View in the action
      bar replaces the panel's Play). Tests in `ModMissingConfirmDialog.test.tsx` / `useDemoPlay.test.ts`:
      "View on a mod-missing demo opens a confirmation naming the mod", "Cancel plays nothing",
      "Play anyway plays with the acknowledgement".
- [x] **D4 — Flows: the action bar speaks for the tab.** New `scripts/flows/action-bar-view.mjs`
      (mirror `scripts/flows/replays-play-q2pro.mjs` for setup/fixture): Home and Library → button reads
      "Play", `data-action="play"`; Demos, no selection → "View", disabled; select a demo → enabled;
      go to Home → "Play" at once (short timeout); on Demos `replays-demo-play`/`replays-demo-play-anyway`
      count 0; switch the active installation to one of `repair.mjs`'s broken fixture installations
      (`scripts/lib/fixture.mjs`) while on Demos → `data-action="repair"`. Rewrite
      `scripts/flows/replays-play-q2pro.mjs` onto `actionbar-play[data-action="view"]`: ctf demo plays
      with the same launch args as today; r1q2 active → disabled + "is not Q2PRO" in
      `actionbar-action-reason`; missing-mod demo → View enabled → confirmation names `opentdm` →
      Cancel launches nothing → Play anyway launches with `+set game opentdm`.
- [x] **D5 — Flows: migrate the playback flows.** Replace clicks on `replays-demo-play` with
      `page.getByTestId('actionbar-play')` filtered to `data-action="view"` in `scripts/flows/`
      `replays-stop.mjs`, `replays-stage.mjs`, `replays-stage-follow.mjs`, `replays-stage-overlays.mjs`,
      `replays-stage-view-leave.mjs`, `replays-stage-unavailable.mjs`, `replays-timeline.mjs`,
      `replays-fullscreen.mjs`. No other change; each still passes via `npm run ui:flow -- <name>`.
- [x] **D6 — Flows: migrate the remaining play users.** Same replacement in
      `scripts/flows/replays-console-command.mjs`, `replays-play-mvd2.mjs`, `replays-archive-readonly.mjs`,
      `replays-copy-in.mjs`, `replays-copy-in-not-writable.mjs`, `scripts/lib/replays-copy-in.mjs`,
      `scripts/lib/screens.mjs` (a `replays-demo-play-reason`/`-error` reference becomes
      `actionbar-action-reason`/`-error`). Each still passes via `npm run ui:flow -- <name>`;
      `npm run ui:verify` stays green.

## Model Hints

- D2 → deliverable-hard: the 170 stage-arm/measure sequence must survive moving out of the panel
  into a hook that runs from an action-bar click, and publishing a per-render action object from
  `ReplaysView` into a store is a classic render loop / stale-closure trap (a `run` that plays the
  previously selected demo).

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/action-bar-view.mjs` › "action-bar-view" (Home/Library read Play,
  `data-action="play"`) + unit `src/renderer/src/components/shell/ActionBar.test.tsx` › "a tab
  without a contribution shows Play and plays"
- AC2 → e2e `scripts/flows/action-bar-view.mjs` › "action-bar-view" (Demos, no selection: View,
  disabled) + unit `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "no selection publishes a disabled View"
- AC3 → e2e `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro" (View plays the ctf demo,
  same launch args) + e2e `scripts/flows/replays-stage.mjs` › "replays-stage" (on the stage)
- AC4 → e2e `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro" (r1q2: disabled, reason
  in `actionbar-action-reason`) + unit `ActionBar.test.tsx` › "a disabled contribution's reason is visible text"
- AC5 → e2e `scripts/flows/replays-stop.mjs` › "replays-stop"
- AC6 → e2e `scripts/flows/action-bar-view.mjs` › "action-bar-view" (broken installation on Demos →
  repair) + unit `ActionBar.test.tsx` › "installation states win over a contribution"
- AC7 → e2e `scripts/flows/action-bar-view.mjs` › "action-bar-view" (no panel play buttons) + unit
  `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` › "the detail panel has no play or play-anyway button"
- AC8 → e2e `scripts/flows/action-bar-view.mjs` › "action-bar-view" (Demos → Home: View → Play at
  once) + unit `ActionBar.test.tsx` › "a contribution for another route is ignored"
- AC9 → e2e `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro" (confirmation names
  opentdm; Cancel plays nothing; Play anyway plays) + unit `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "a mod-missing demo" › Cancel plays nothing

Coverage: AC1 D1+D4 · AC2 D2+D4 · AC3 D2+D4 · AC4 D1+D2+D4 · AC5 D5 (unchanged shell path) ·
AC6 D1+D4 · AC7 D2+D4 · AC8 D1+D2+D4 · AC9 D3+D4.

## Done

Summary: the action bar's primary button is now contributed by the open tab through a small shell seam (`lib/primary-action.ts`, route-tagged store; replaces only the `play` case). Demos publishes **View** (disabled without selection or when ineligible; reason/error as visible text in the readout column); the detail panel lost its Play/"play anyway" buttons; a mod-missing demo opens a Play anyway / Cancel confirmation. Play logic moved into `useDemoPlay`. All play flows migrated onto the action bar; new flow `action-bar-view`.

Commit message: `180: action bar button speaks for the tab — module-contributed primary action, Demos View, mod-missing confirm`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` green (107 files / 856 tests); e2e `npm run ui:flow -- action-bar-view | replays-play-q2pro | replays-stage | replays-stop` green; D6 agent also ran `npm run ui:verify` (60/60 screens, 0 axe violations) and the five migrated copy/console/mvd2/archive flows. Full regression gate not run (sprint's job). Review 1 (default): PASS, no blockers.
AC -> test, all passed: AC1 action-bar-view + ActionBar.test "a tab without a contribution shows Play and plays" · AC2 action-bar-view + ReplaysView.test "no selection publishes a disabled View" · AC3 replays-play-q2pro + replays-stage · AC4 replays-play-q2pro + ActionBar.test "a disabled contribution's reason is visible text" · AC5 replays-stop · AC6 action-bar-view + ActionBar.test "installation states win over a contribution" · AC7 action-bar-view + DemoDetailPanel.test · AC8 action-bar-view + ActionBar.test "a contribution for another route is ignored" · AC9 replays-play-q2pro + ReplaysView.test Cancel/Play anyway. No manual residue.

Decisions:

- Cancel/confirm unit tests live in `ReplaysView.test.tsx` (dialog state is in the view), not `useDemoPlay.test.ts`; mapping above corrected.
- ActionBar shows the contribution's reason whenever present (also while enabled), so the mod-missing note stays visible with View enabled.
- Play anyway uses `Button variant="primary"` (no flame variant exists).
- Flow fixture: `writeReplaysPlayFixture` gained a broken-installation option (status invalid, reads `repair`) and an empty `opentdm` game dir; a seeded `missing` installation reads `locate`, not `repair`.
- Unfixed, minor: `confirmingModMissing` is not reset on selection change (dialog could reappear when a mod-missing demo is re-selected); `'/replays'` literal in ReplaysView instead of the manifest route; stale comment in DemoTimeline.test.tsx:7 names the deleted DemoPlayAction.test.tsx.
- Pre-existing, noted: Play anyway on a mod whose game dir does not exist on disk fails in main (ENOENT writing q2l_back.cfg tmp) and is not surfaced as a play error — candidate follow-up story.

tiers: D 6 / hard 1 · review default · cycles 1 · agents 8
