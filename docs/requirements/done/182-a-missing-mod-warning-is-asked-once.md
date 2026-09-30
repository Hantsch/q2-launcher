---
id: 182
title: A missing-mod warning is asked once
status: done # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

When a demo's mod is not fully installed in the active installation, the detail panel today shows a
permanent paragraph ("Mod `opentdm` is not fully installed in this installation — the demo may not
play correctly.") plus an "I know the consequences — play anyway" button, every time I look at such
a demo. For a player who knows the mod's demos play fine this is permanent noise.

Instead the warning is **asked once** — in the confirmation [[180]] opens when I press View on such
a demo — and my answer can be **remembered**, so the next time it does not ask again. Settings also offers a global switch
to never warn about a missing mod when playing a demo.

## Acceptance Criteria

- [x] **AC1** — Selecting a demo whose mod is not installed shows no permanent warning paragraph and
      no "play anyway" button in the detail panel.
- [x] **AC2** — [[180]]'s confirmation names the mod and the risk and offers a "Don't ask again"
      choice next to "Play anyway" and "Cancel".
- [x] **AC3** — "Cancel" with "Don't ask again" ticked remembers nothing.
- [x] **AC4** — After "Play anyway" with "Don't ask again" ticked, pressing View on a demo with the
      same missing mod plays it without asking; the choice survives a launcher restart.
- [x] **AC5** — Settings has a switch "Warn when a demo's mod is not installed" (default on); turned
      off, no demo asks; turned back on, the per-mod remembered answers from AC4 still apply.
- [x] **AC6** — The remembered answers can be reset in Settings, after which the warning asks again.
- [x] **AC7** — Main still re-checks eligibility before launching: a play request for a demo with a
      missing mod is only accepted when it carries the acknowledgement, whether from the dialog, a
      remembered answer or the global switch.

## Open Questions

- ~~Q1: Scope of "remembered" — per mod name (recommended: "opentdm is fine for me"), per mod *and*
  installation, or per demo?~~ answered → Decisions (Sprint)
- ~~Q2: Does the Servers join's mod-mismatch warning ([[125]]) share the same global switch and
  remembering, or stay a separate question? Recommendation: separate — joining a server without its
  mod fails harder than playing a demo.~~ answered → Decisions (Sprint)
- ~~Q3: Where in Settings — the Demos settings section (`ReplaysSettingsSection.tsx`, recommended) or
  a general section?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Remembered scope: per mod name
- **(User)** Servers join mod-mismatch warning (125): stays separate
- **(User)** Switch location: Demos settings section (ReplaysSettingsSection.tsx)
- Storage: a new `modWarning: { enabled: boolean; trustedMods: string[] }` field in the replays
  module's `ReplaysState` (`state.json`), not global AppSettings — it is module-owned state, sits next
  to `extraFolders`/`listFilter`, and the forgiving parser loads a missing field as the default (no
  schema bump).
- Mod names are stored and compared ASCII-lowercased — `demoPlayEligibility` already compares game
  dirs case-insensitively, so `OpenTDM` and `opentdm` are the same mod.
- AC7 keeps the request-carried flag: the renderer turns dialog answer / remembered mod / switch-off
  into the one existing `acknowledgeModMissing: true` on `replays:play`, and main's eligibility
  re-check stays unchanged — AC7 literally asks for a request-carried acknowledgement and this leaves
  main's play contract untouched.
- The renderer reads the mod-warning state via IPC at press time (not a cached store) — the Settings
  section and the dialog both change it, and a fresh read avoids a cross-component sync.
- The acknowledgeable `modMissing` reason is shown nowhere permanently — neither the detail panel nor
  the action bar readout ([[180]] AC4 shows reasons only for demos that cannot play); the dialog is
  its only place, which is the point of "asked once".
- "Don't ask again" is an unchecked checkbox in the dialog; it is only honoured on "Play anyway"
  (AC3/AC4), and it is not shown when the dialog could not be reached anyway.
- Settings shows the switch, the remembered mod names as plain text, and one "Forget remembered mods"
  button, disabled while the list is empty — AC6 asks only for a reset; per-mod removal is not asked
  for.
- AC4's "survives a launcher restart" is proven by the flow reading `state.json` off disk plus a
  parser round-trip unit test — the flow harness asserts the app is alive at the end and existing
  flows (`servers-scan-settings.mjs`) prove persistence the same way instead of relaunching.
- The new flow restores the default state (switch on, no remembered mods) before it finishes — flows
  never reseed between runs.

## Plan

Builds on [[180]]: its Demos primary action ("View") opens a plain mod-missing confirmation (Play
anyway / Cancel) and has already removed the detail panel's Play and "play anyway" buttons. 182 adds
persistence, the checkbox, the skip logic and the Settings controls.

1. **Shared + main (D1):** `ReplaysState.modWarning` (type, forgiving parser, default
   `{ enabled: true, trustedMods: [] }`); four handlers `modWarning.read`, `modWarning.setEnabled`,
   `modWarning.trustMod`, `modWarning.resetTrusted`, each returning the full state; zod payloads;
   main play path unchanged, pinned by a test.
2. **Renderer, the Demos side (D2):** client functions; on View for an acknowledgeable demo read the
   state — switch off or mod trusted → play with `acknowledgeModMissing: true` directly, else open
   180's dialog, now naming mod + risk and carrying a "Don't ask again" checkbox; Play anyway + ticked
   → `trustMod`; Cancel never writes. Remove any remaining permanent `modMissing` paragraph. New flow
   `replays-mod-warning` (AC1–AC4) and update `replays-play-q2pro`'s mod-missing step.
3. **Renderer, Settings (D3):** Switch + remembered list + reset in `ReplaysSettingsSection.tsx`;
   extend the flow with AC5/AC6; CHANGELOG.

Order D1 → D2 → D3. Servers' join mod-mismatch warning ([[125]]) is untouched.

## Deliverables

- **D1 — Persisted mod-warning state + IPC (shared + main).** Add `modWarning: { enabled: boolean;
  trustedMods: string[] }` to `ReplaysState` in `src/main/lib/schemas.ts` (type ~:1474, forgiving
  parser ~:1582 — add a `parseModWarning` next to `parseExtraFolders` ~:1554: non-boolean `enabled` →
  `true`, drop non-string/invalid entries, lowercase ASCII, dedupe) and its default in
  `src/main/services/state.ts` (~:158). In `src/shared/modules/replays.ts` add to `REPLAYS_HANDLERS`
  (mirror `listGetFilter: 'listFilter.read'` at :68) `modWarningRead: 'modWarning.read'`,
  `modWarningSetEnabled: 'modWarning.setEnabled'`, `modWarningTrustMod: 'modWarning.trustMod'`,
  `modWarningResetTrusted: 'modWarning.resetTrusted'`; export a `ReplaysModWarning` type; zod
  payloads (read/reset `z.void()` like `listFilter.read` ~:503; `setEnabled { enabled: boolean }`;
  `trustMod { gameDir }` with `gameDir` 1–64 chars matching `/^[A-Za-z0-9_.-]+$/` and not `.`/`..`),
  registered in the schema-by-handler map (~:519). Handlers in `src/main/modules/replays/index.ts`
  mirror the `listFilter` get/set pair (~:450: read `replaysState()`, spread, `setReplaysState`);
  `trustMod` lowercases and dedupes; every handler returns the full `ReplaysModWarning`. Do **not**
  touch `demo-play.ts`'s eligibility: main keeps refusing a mod-missing play without
  `acknowledgeModMissing`. Tests: `src/main/lib/schemas.test.ts` › "modWarning loads forgivingly and
  round-trips" (missing field → default; saved state re-parses equal); `src/main/modules/replays/index.test.ts`
  › "modWarning handlers persist enabled and trusted mods" (trust lowercases/dedupes, reset clears,
  setEnabled keeps the list) and › "modWarning.trustMod rejects an unsafe game dir";
  `src/main/modules/replays/demo-play.test.ts` › "a mod-missing play without acknowledgement is
  refused even when the mod is trusted" (store a trusted `opentdm`, play without the flag → refused
  with `modMissing`; with the flag → accepted).

- **D2 — Asked once: dialog checkbox, skip logic, no permanent warning (renderer, Demos).** Add
  `readModWarning`, `setModWarningEnabled`, `trustModWarningMod`, `resetModWarningTrusted` to
  `src/renderer/src/modules/replays/client.ts` (mirror `getListFilter`/`setListFilter` ~:276). Find
  the Demos primary action and its mod-missing confirmation that story 180 built (its `## Done` in
  `docs/requirements/180-the-action-bar-button-speaks-for-the-tab-im-on.md` names the files; the
  action today funnels into `playDemo({ …, acknowledgeModMissing })` as `DemoPlayAction.tsx` did).
  On View when eligibility is `ok: false` with `acknowledgeable: true`: `await readModWarning()`; if
  `!enabled` or `trustedMods` contains `reason.params.gameDir` ASCII-lowercased → play immediately
  with `acknowledgeModMissing: true`, no dialog; otherwise open the dialog. The dialog (existing
  `Modal`, `src/renderer/src/components/ui/Modal.tsx`) names the mod and the risk (new key
  `replays.play.modWarning.body` with `{{gameDir}}`), and adds a `Checkbox`
  (`src/renderer/src/components/ui/controls.tsx:192`, testid `replays-mod-warning-dont-ask`, key
  `replays.play.modWarning.dontAsk` "Don't ask again") beside "Play anyway" / "Cancel" (keep 180's
  testids). Play anyway + ticked → `trustModWarningMod({ gameDir })` then play; Cancel → close, write
  nothing, whatever the checkbox. A failed `readModWarning` falls back to asking. Ensure no
  permanent `replays.play.unavailable.modMissing` text remains in the detail panel or the action bar
  readout for an acknowledgeable demo; delete `replays.play.anyway` from `en.json` if nothing uses it.
  Tests (same D): renderer unit test next to 180's action/dialog test › "Cancel with don't-ask-again
  ticked remembers nothing", › "a trusted mod plays without asking", › "switched off, a missing mod
  plays without asking", each asserting the `playDemo` payload carries `acknowledgeModMissing: true`
  only when played. E2E: new `scripts/flows/replays-mod-warning.mjs` (mirror `replays-play-q2pro.mjs`:
  `writeReplaysPlayFixture()` in `setup`, `REPLAYS_PLAY_MISSING_MOD_DEMO` / `REPLAYS_PLAY_MISSING_MOD`
  from `scripts/lib/fixture.mjs` ~:3706, win32 7za skip): select the demo → no modMissing text in the
  detail panel or action bar (AC1); View → dialog names `opentdm`, shows checkbox, Play anyway, Cancel
  (AC2); tick + Cancel → View asks again (AC3); tick + Play anyway → launches (main.log `+demo
  play-tdm.dm2`), wait for exit, View → launches with no dialog, and `state.json`'s
  `replays.modWarning.trustedMods` contains `opentdm` (AC4); end by `resetModWarningTrusted` via
  `window.q2.invoke` so the flow leaves defaults. Update `scripts/flows/replays-play-q2pro.mjs`'s
  "missing mod" step (:127–136) to the dialog instead of the removed reason text. Files: client.ts,
  180's action + dialog files and their test, `en.json`, the two flows.

- **D3 — Settings: switch + reset (renderer, Settings).** In
  `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` add a `ModWarningSettings` block
  (sibling to `ExtraFoldersList`, same `mutate`-through-returned-state discipline, re-render from the
  handler's returned state): a `Switch` (`controls.tsx:143`, mirror
  `servers/ServersSettingsSection.tsx:236-253`, testid `replays-mod-warning-enabled`, label key
  `replays.modWarning.enabled` "Warn when a demo's mod is not installed", default on), the remembered
  mods as text (testid `replays-mod-warning-trusted`, empty-state key), and a "Forget remembered
  mods" `Button` (testid `replays-mod-warning-reset`, disabled while empty). i18n in `en.json` under
  `replays.modWarning.*`. Unit test in `ReplaysSettingsSection.test.tsx` › "mod warning switch and
  reset call their handlers and render the returned state". Extend `scripts/flows/replays-mod-warning.mjs`
  (after D2's AC4 steps, before its cleanup): Settings → switch off → Demos, View → plays without
  dialog; switch on → View still plays without dialog (opentdm remembered) (AC5); Settings → reset →
  list empty → View asks again, Cancel (AC6); switch off → View plays without dialog, then switch back
  on (AC5 "turned off, no demo asks"). Add a CHANGELOG.md `### Changed` entry. Files:
  `ReplaysSettingsSection.tsx`, its test, `en.json`, the flow, `CHANGELOG.md`.

## Model Hints

- All Ds default tier.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-mod-warning.mjs` › step "a missing-mod demo shows no permanent warning" (D2)
- AC2 → e2e `scripts/flows/replays-mod-warning.mjs` › step "View asks, naming the mod, with don't ask again" (D2)
- AC3 → e2e `scripts/flows/replays-mod-warning.mjs` › step "cancel with don't ask again remembers nothing" (D2);
  unit renderer › "Cancel with don't-ask-again ticked remembers nothing" (D2)
- AC4 → e2e `scripts/flows/replays-mod-warning.mjs` › step "play anyway with don't ask again is remembered" (D2);
  unit `src/main/lib/schemas.test.ts` › "modWarning loads forgivingly and round-trips" (D1, restart half)
- AC5 → e2e `scripts/flows/replays-mod-warning.mjs` › step "the settings switch silences and restores the warning" (D3);
  unit renderer › "switched off, a missing mod plays without asking" (D2)
- AC6 → e2e `scripts/flows/replays-mod-warning.mjs` › step "resetting remembered mods asks again" (D3);
  unit `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` › "mod warning switch and reset call their handlers and render the returned state" (D3)
- AC7 → unit `src/main/modules/replays/demo-play.test.ts` › "a mod-missing play without acknowledgement is refused even when the mod is trusted" (D1);
  unit renderer › "a trusted mod plays without asking" (asserts the payload carries the acknowledgement) (D2)

Run target: `npm run ui:flow -- replays-mod-warning` (and `replays-play-q2pro` for the updated step).

## Done

Summary: the missing-mod warning is asked once. `ReplaysState.modWarning { enabled, trustedMods }` persists in `state.json` with four `modWarning.*` handlers; on View the renderer reads it and skips the dialog when the switch is off or the mod is trusted (playing with `acknowledgeModMissing: true`), otherwise 180's dialog names the mod and offers "Don't ask again" (honoured only on Play anyway). Settings (Demos section) gains the switch, the remembered mods and "Forget remembered mods". Main's eligibility re-check is unchanged.

Commit message: `182: a missing-mod warning is asked once — Don't ask again in the confirm, per-mod remembered answers, Demos settings switch + forget`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` green (137 files / 1968 tests); e2e `npm run ui:flow -- replays-mod-warning | replays-play-q2pro` green. Full regression gate not run (sprint's job). Review 1 (default): PASS.
AC -> test, all passed: AC1-AC6 flow `replays-mod-warning` steps as named in Acceptance Tests; AC3 also ReplaysView.test "Cancel with don't ask again ticked remembers nothing"; AC4 schemas.test round-trip + index.test "modWarning handlers persist…"; AC5 ReplaysView.test "switched off, a missing mod plays without asking"; AC6 ReplaysSettingsSection.test; AC7 demo-play.test "a mod-missing play without acknowledgement is refused even when the mod is trusted" + ReplaysView.test "a trusted mod plays without asking". No manual residue.

Decisions:
- `replays.play.unavailable.modMissing` stays in en.json (main's refusal/shared demo-play use it); only the action-bar reason is dropped for acknowledgeable demos. `replays.play.anyway` never existed (button uses `modMissingConfirm.confirm`).
- `gameDir` exempted in the path-leak heuristic of `src/shared/modules/replays.test.ts` (schema pins it to a bare name; comment in place).
- Unfixed, minor: demo-play.test AC7 test's StateStore is not wired into main (proves the flag is required, not that trust is ignored); `runPlay` has no re-entry guard during the async read; a failed `trustMod` still plays; `replays.modWarning.error` key likely unused; ': '/', ' joined outside i18n in the trusted list.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
