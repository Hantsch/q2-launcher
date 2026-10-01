---
id: 193
title: the mod-missing warning offers the install
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player who wants to watch a demo recorded on a mod I do not have, the mod-missing dialog
(story 182) lets me install that mod instead of only *Play anyway* or *Cancel*, whenever the
catalog has it. *Play anyway* and the "asked once" behaviour stay as they are.

Concept: [mods.md](../concepts/mods.md) §11; requirement MOD-18.

## Acceptance Criteria

- [ ] **AC1** — When a demo's mod is missing and the catalog has an entry of that gamedir name
      (case-insensitive), the mod-missing dialog shows an *Install <mod>* action next to *Play
      anyway*.
- [ ] **AC2** — When the catalog has no entry for that mod, the dialog shows no Install action and
      otherwise looks as it does today.
- [ ] **AC3** — Choosing Install starts story 190's install into the installation the demo would
      play in, and closes the dialog without starting playback.
- [ ] **AC4** — After the install has finished, playing the same demo starts without the
      mod-missing dialog.
- [ ] **AC5** — Choosing Install does not add the mod to the "trusted mods" list that suppresses
      the warning (story 182).

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — — Does the demo start automatically when the install finishes, or does the player start
  it again?

## Decisions (Sprint)

- **(User)** Auto-start demo after install: no, the player starts the demo again
- Target installation = the **active** installation: a demo always plays in it
  (`src/shared/replays/demo-play.ts:90-111`, main re-checks with `WRONG_INSTALLATION`), so that is
  "the installation the demo would play in".
- Seam follows 192's binding answer: the replays renderer imports the mods renderer client
  (189's catalog read, 190's install start) and the shared case-insensitive catalog matcher. Main
  and the shell are untouched.
- The catalog is read when the dialog is about to open, not cached in the replays view. 182 already
  reads the mod-warning state at press time, and a fresh read sees a catalog that changed meanwhile.
- A failed or empty catalog read (offline, nothing cached) means there is no Install action. This is
  AC2's "looks as it does today", and the warning must never be blocked by the catalog.
- The Install button's label uses the catalog entry's display name (`Install {{name}}`): 189
  decided the name is English manifest text shown as foreign content.
- Install installs the entry's pinned (default) version. The dialog has no version picker: 189's
  version choice belongs to the Mods view, and the dialog's job is one click.
- "Don't ask again" is ignored on Install, ticked or not. 182 honours it only on *Play anyway*, and
  AC5 forbids trusting the mod.
- When the install fails to start (an Outcome error, e.g. a job already running), the dialog stays
  open and shows the reason as visible text. AC3 closes the dialog only for a started install, and
  a silent close would lose the error.
- No extra progress UI in the Demos view. The job shows in the Downloads surface (190 AC1), so the
  shell stays untouched and the job surface is not duplicated.
- AC4 relies on 190 AC8: after the install, the revalidated `gameDirs` contain the mod. The flow's
  fixture package therefore carries a `.pak`, so the inspector's `isGameDir` rule
  (`src/main/services/inspector.ts:159`) holds in the test whatever 190 does for content-only
  variants.
- Order: build after 189, 190 and 192, which provide the catalog channel, the install channel and
  the matcher. Each D names how to find them (their `## Done` sections).
- CHANGELOG: if 190 left a mod-install entry under `## Unreleased`, fold this into it ("…, also from
  a demo's mod warning"). Otherwise add one line. A feature is one entry.

## Plan

Renderer only. 189/190/192 provide the mods channels and the matcher. 193 wires them into 182's
dialog.

1. **D1 — dialog + View wiring (renderer).**
   - When `ReplaysView`'s `runPlay` is about to open the mod-missing dialog, it reads the catalog
     and matches the demo's `gameDir` case-insensitively.
   - On a match, the dialog gets an `installOffer`, and `ModMissingConfirmDialog` renders
     *Install <name>* next to *Play anyway*.
   - Install starts 190's install into the active installation. On success it closes the dialog,
     with no playback and no `trustMod`. On a start error the reason shows inline.
   - Unit tests in `ReplaysView.test.tsx`, plus i18n and the CHANGELOG entry.
2. **D2 — e2e (flows + fixture).**
   - A new fixture writer combines `writeReplaysPlayFixture()` with a catalog fixture holding an
     `opentdm` entry whose local package carries a `.pak`. It reuses 190's mods-catalog fixture
     helper.
   - A new flow `replays-mod-install` covers AC1, AC3, AC4 and AC5.
   - `replays-mod-warning.mjs` gets a catalog without `opentdm` and one step for AC2.

Order D1 → D2. Main, preload, shared IPC and the shell are not touched.

## Deliverables

- **D1 — The mod-missing dialog offers Install (renderer, Demos).**
  - **Prerequisites (built by earlier stories):** 189's renderer catalog read, 190's install-start
    client function and 192's shared case-insensitive catalog matcher.
    - Find them in `src/renderer/src/modules/mods/client.ts` and `src/shared/mods/`. The `## Done`
      sections of `docs/requirements/189-…`, `190-…` and `192-…` name them.
    - If no shared matcher exists, add a pure
      `findCatalogEntryByGameDir(entries, gameDir)` (ASCII-lowercase compare) in `src/shared/mods/`
      with a unit test.
  - **`src/renderer/src/modules/replays/ReplaysView.tsx`** (~281-300 `runPlay`, ~466-480 dialog
    render):
    - Read the catalog only on the path that opens the dialog, i.e. not when the switch is off or
      the mod is trusted.
    - Find the entry for `modGameDir`. Pass `installOffer={{ name: entry.displayName }}` only on a
      match. A rejected or failed catalog read means no offer, and the dialog still opens.
  - **`components/ModMissingConfirmDialog.tsx`:**
    - New optional props `installOffer` and `onInstall`, plus `installError?: string`.
    - With an offer, render a `Button` with testid `replays-mod-missing-install` and key
      `replays.play.modMissingConfirm.install` = "Install {{name}}", next to Play anyway.
    - Without an offer, the dialog is unchanged.
    - `installError`, when set, shows as visible text (testid `replays-mod-missing-install-error`).
  - **onInstall:** call 190's install start with `{ installationId: <active>, catalogId: entry.id }`
    (the pinned version, no version choice).
    - On an ok Outcome, close the dialog. Do not call `playDemo` and do not call
      `trustModWarningMod`, even if "Don't ask again" is ticked.
    - On an error Outcome, keep the dialog open and set `installError` from the error's i18n key.
  - **i18n:** keys in `src/renderer/src/i18n/locales/en.json` (~1165-1175).
  - **CHANGELOG:** fold into 190's Unreleased mod-install entry, otherwise add one line.
  - **Tests** in `src/renderer/src/modules/replays/ReplaysView.test.tsx`, mirroring its existing
    mod-missing tests (~640-700) and mocking the mods client like the replays client:
    - › "a catalog mod is offered for install in the mod-missing dialog"
    - › "without a catalog entry the dialog offers no install"
    - › "a failed catalog read still opens the dialog without install"
    - › "Install starts the install into the active installation and plays nothing" (asserts the
      payload, dialog closed, `playDemo` not called)
    - › "Install with don't ask again ticked does not trust the mod" (`trustModWarningMod` not
      called)
    - › "a failed install start keeps the dialog open with the reason"
  - **Files:** ReplaysView.tsx, ModMissingConfirmDialog.tsx, ReplaysView.test.tsx, en.json,
    CHANGELOG.md, plus the optional shared matcher and its test.

- **D2 — E2E: install from the demo dialog (flows + fixture).**
  - **Fixture, in `scripts/lib/fixture.mjs`:** add `writeReplaysModInstallFixture()` next to
    `writeReplaysPlayFixture` (~3772) and register a variant `replays-mod-install` in the variant
    dispatch (~3259).
    - It calls `writeReplaysPlayFixture()`: the stub q2pro installation, demo
      `REPLAYS_PLAY_MISSING_MOD_DEMO` = `play-tdm.dm2`, missing mod `REPLAYS_PLAY_MISSING_MOD` =
      `opentdm`.
    - It then seeds the mods catalog the way 190's flow fixture does (its `## Done` names the
      helper) with an `opentdm` entry whose variant for the stub's platform/engine is a local,
      hash-correct package containing `opentdm/pak0.pak`. The `.pak` makes the inspector list
      `opentdm`.
    - Also give `writeReplaysPlayFixture`'s callers a catalog that has an entry (e.g. `action`) but
      **no** `opentdm`. Do this via an option so `replays-play-q2pro` stays unchanged.
  - **New flow `scripts/flows/replays-mod-install.mjs`,** mirroring
    `scripts/flows/replays-mod-warning.mjs` (setup, `waitForScan`, `readLog`, `waitFor`,
    `trustedMods()`, the win32 7za loud skip). Steps:
    - "the dialog offers installing the catalog mod": select the demo, press View, and the dialog
      shows `replays-mod-missing-install` with "OpenTDM" next to `replays-mod-missing-confirm`.
    - "install starts the job and plays nothing": tick `replays-mod-warning-dont-ask`, click
      Install. The dialog is gone, a mods job appears in `window.q2.invoke('jobs:list')`, and
      `main.log` has no `+demo play-tdm.dm2`.
    - "install does not trust the mod": `state.json`'s `replays.modWarning.trustedMods` lacks
      `opentdm`.
    - "after the install the demo plays without asking": wait for the job to be `done`, press View,
      and no dialog appears. `main.log` gets `+demo play-tdm.dm2`. Wait for the game to exit.
  - **In `scripts/flows/replays-mod-warning.mjs`:** add a step after "View asks, naming the mod,
    with don't ask again": "without a catalog entry the dialog offers no install". It asserts
    `replays-mod-missing-install` is absent while the dialog shows.
  - **Files:** fixture.mjs, the new flow, replays-mod-warning.mjs.

## Model Hints

- All Ds default tier. D1 is a bounded renderer change. D2 mirrors an existing flow and fixture.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-mod-install.mjs` › step "the dialog offers installing the
  catalog mod" (D2); unit `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "a catalog mod
  is offered for install in the mod-missing dialog" (D1)
- AC2 → e2e `scripts/flows/replays-mod-warning.mjs` › step "without a catalog entry the dialog
  offers no install" (D2); unit `ReplaysView.test.tsx` › "without a catalog entry the dialog offers
  no install" and › "a failed catalog read still opens the dialog without install" (D1)
- AC3 → e2e `scripts/flows/replays-mod-install.mjs` › step "install starts the job and plays
  nothing" (D2); unit `ReplaysView.test.tsx` › "Install starts the install into the active
  installation and plays nothing" (D1)
- AC4 → e2e `scripts/flows/replays-mod-install.mjs` › step "after the install the demo plays
  without asking" (D2)
- AC5 → e2e `scripts/flows/replays-mod-install.mjs` › step "install does not trust the mod" (D2);
  unit `ReplaysView.test.tsx` › "Install with don't ask again ticked does not trust the mod" (D1)

Run target: `npm run ui:flow -- replays-mod-install` and `npm run ui:flow -- replays-mod-warning`.
No manual residue.

## Done
