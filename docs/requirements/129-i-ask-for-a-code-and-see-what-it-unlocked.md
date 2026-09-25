---
id: 129
title: i ask for a code and see what it unlocked
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[128]] can decide whether a token is valid; this story is where a user actually meets that
mechanism. Settings carries an unobtrusive code entry field and, next to it, the installation id
with a copy action — and that copy action *is* how a user asks for a code in the first place, since
the maintainer cannot sign anything without knowing which installation to bind it to (concept
§13.6). Nothing about this is a wizard or a flow with steps; it is one field and one id, sitting
quietly in Settings the way a build number does.

A rejected code has to say **which** check failed — not a code at all, bad signature, wrong
installation, redemption window elapsed, or feature already expired — because, in the concept's own
words, "'invalid' alone produces a support conversation that never ends" (§13.6). Each of [[128]]'s
AC9, AC2, AC3, AC4 and AC7 rejection paths needs to reach the user as a distinct, readable reason,
not a single generic failure.

An accepted code shows what it actually did: the list of feature names it unlocked, and its expiry
if it has one. Wherever an unlocked feature then appears in the rest of the UI — the watchlist tab
[[132]] is the concrete case today — it carries a visible "experimental" marking, so nobody mistakes
a feature that shipped behind a code for a finished part of the launcher (GB-X5). That marking is
this story's concern; whether the feature renders at all when locked is [[130]]'s mechanism, applied
by [[132]] as its first consumer.

Finally: a code can stop being valid between two runs of the app, purely because its feature expiry
passed while the launcher was closed. When that happens, the feature has to disappear at the next
start (enforced by [[130]]'s mechanism, triggered by [[128]]'s AC5/AC7 re-verification) — but
Settings has to say *why*, explicitly, the next time it is opened. A feature that silently stops
being where it used to be reads as a bug report waiting to happen; a sentence in Settings that says
the code expired does not.

## Acceptance Criteria

- [ ] **AC1** — Settings shows the installation id (from [[128]], in its `XXXX-XXXX-XXXX` form) and a
      working copy action next to it.
- [ ] **AC2** — Submitting a code shows exactly one of five specific rejection reasons — not a code
      (wrong prefix or malformed, [[128]] AC9), bad signature, wrong installation, redemption window
      elapsed, feature already expired — and never a generic "invalid code" message.
- [ ] **AC3** — An accepted code's unlocked feature list and its expiry (if any) are shown to the
      user immediately after submission.
- [ ] **AC4** — Any surface rendered through [[130]]'s gate for an unlocked feature carries a visible
      "experimental" marking. The gate supplies it, not the feature, so no gated feature can ship
      without it. [[132]]'s watchlist tab is the first real surface that shows it (its AC8).
- [ ] **AC5** — When a previously-valid code's feature expiry passes, the feature is gone at the
      next app start, and Settings states that the code expired rather than the feature simply not
      being there.

## Open Questions

None open.

## Decisions (Sprint)

- The unlock panel is a **shell-level Settings panel** (`components/unlock/`, next to About), not a
  module section — §13 is launcher-wide infrastructure with no `ModuleId`, exactly like About.
- **129 owns the renderer-facing channels** `unlock:getState` and `unlock:redeem`; [[128]] owns
  verification/persistence in main, [[130]] owns the unlocked-features query — 128's ACs name no
  renderer surface, so the IPC for it belongs to the story where the user meets it.
- An accepted code **takes effect at the next start** and the result says so — [[130]] decides the
  gate once at boot (the `DEV_ONLY_CHANNELS` shape), so mid-session registration is not promised.
- Likewise an expiry that passes mid-session removes the feature at the next start only (AC5's own
  wording); Settings is not polled for it.
- **Expired codes stay stored** and are reported with status `expired` (never deleted by
  re-verification) — without the record, AC5's "Settings says the code expired" has nothing to say.
- The five rejection reasons are one closed union `not-a-code | bad-signature | wrong-installation |
  redeem-window-elapsed | feature-expired`, each with its own i18n key and no fallback key — a
  generic "invalid" string that does not exist cannot be shown (AC2).
- Checks run in [[128]]'s order (format → signature → installation → window → expiry) and the
  first failure is the one reported — "exactly one" reason per AC2.
- Input is trimmed before it crosses IPC (pasted codes carry newlines/spaces) and capped by the zod
  schema at 4096 chars — paste-friendly per 128's format decision, bounded per CLAUDE.md.
- Re-redeeming an identical, already-stored code succeeds idempotently (no duplicate row) — a user
  pasting twice is not an error worth a reason.
- The copy action copies the id **exactly as displayed** (`XXXX-XXXX-XXXX`) via the existing
  `app:copyText` channel — what the user sees is what the maintainer receives; [[128]]'s issuing
  script must accept that grouped form.
- Feature names render through `unlock.feature.<name>` with the raw name as `defaultValue` — a
  token may name a feature this build has no label for, and a raw name beats a blank.
- Expiry renders as a localized date/time (`Intl`), "no expiry" as its own key — AC3's "if any".
- The experimental marking is an `ExperimentalBadge` (mirrors `DemoBadge`) that [[130]]'s renderer
  gate renders itself for every unlocked surface, with **no opt-out prop** — AC4's "the gate
  supplies it, not the feature".
- The e2e flow signs its own codes with a throwaway Ed25519 pair whose public key reaches the app
  through a harness-only env override `Q2L_UI_UNLOCK_PUBLIC_KEY`, honoured only under the existing
  `Q2L_UI_HARNESS==='1' && isDev` double gate — same pattern as `Q2L_UI_PICK_FILES`; 128's decision
  keeps the real private key out of the repo, so there is no other way to produce valid codes.
- No platform gap: nothing in this story is platform-specific (id derivation is [[128]]'s).

## Plan

Build order puts [[128]] (verify/store/installation id) and [[130]] (boot-time gate + renderer
gate + unlocked-features query) in the tree first; 129 plugs into both and names their files at
build time instead of guessing them now.

1. **D1 — contract + main.** `src/shared/types/unlock.ts`: `UnlockRejectReason` (5-member union),
   `RedeemedCode { features: string[]; featureExpiry: number | null; label: string | null;
   status: 'active' | 'expired' }`, `UnlockState { installationId: string; codes: RedeemedCode[] }`,
   `RedeemResult = { ok: true; code: RedeemedCode } | { ok: false; reason: UnlockRejectReason }`.
   `ipc.ts`: `unlock:getState` (void → `UnlockState`), `unlock:redeem` (string → `Outcome<RedeemResult>`);
   zod payload in `ipc-schemas.ts`; registrar `src/main/ipc/unlock.ts` wired in `registerAllIpc`.
   Adjust 128's service so expired tokens are retained and classified, and add the harness-only
   public-key override.
2. **D2 — Settings panel.** `UnlockCodePanel` (id + copy, code input + submit, result area, stored
   codes list with expired sentence) inserted in `SettingsView.tsx` before About; en.json keys;
   component tests; CHANGELOG entry.
3. **D3 — experimental marking.** `ExperimentalBadge` + wiring into 130's renderer gate; test via
   130's test-only feature declaration.
4. **D4 — e2e flow** `scripts/flows/unlock-code.mjs` proving AC1/2/3/5 on the real app, including
   a restart phase.

Order: D1 → D2 → D4; D3 is independent of D1/D2 (needs only 130).

## Deliverables

- **D1 — Unlock IPC contract and main handlers.** Files: new `src/shared/types/unlock.ts` (export
  it from `src/shared/types` index), `src/shared/ipc.ts` (a `// ---- unlock` block in
  `IpcInvokeMap`: `'unlock:getState': { req: void; res: UnlockState }`,
  `'unlock:redeem': { req: string; res: Outcome<RedeemResult> }`), `src/shared/ipc-schemas.ts`
  (redeem payload: `z.string().trim().min(1).max(4096)`; getState: void schema like `app:getInfo`),
  new `src/main/ipc/unlock.ts` (mirror `src/main/ipc/app.ts`), `src/main/ipc/index.ts`
  (register it unconditionally — these channels are not gated), and [[128]]'s main unlock service
  file(s) (find them by `grep -r "q2l1" src/main`). Types: `UnlockRejectReason = 'not-a-code' |
  'bad-signature' | 'wrong-installation' | 'redeem-window-elapsed' | 'feature-expired'`;
  `RedeemedCode { features: string[]; featureExpiry: number | null /* epoch ms */; label: string |
  null; status: 'active' | 'expired' }`; `UnlockState { installationId: string /* grouped
  XXXX-XXXX-XXXX, as 128 formats it */; codes: RedeemedCode[] }`; `RedeemResult = { ok: true; code:
  RedeemedCode } | { ok: false; reason: UnlockRejectReason }`. The handler maps 128's rejection
  outcomes 1:1 onto the union (128 AC9 → `not-a-code`, AC2 → `bad-signature`, AC3 →
  `wrong-installation`, AC4 → `redeem-window-elapsed`, AC7 → `feature-expired`) with an
  exhaustive `switch` (no default branch that could produce a generic reason). Behaviour changes in
  128's service: (a) re-verification at start keeps a stored token whose feature expiry passed and
  reports it `expired` (it must no longer unlock its features — 128 AC7 — but must not be deleted);
  (b) redeeming an identical already-stored token returns `ok: true` without adding a second entry;
  (c) the embedded public key is replaced by `process.env.Q2L_UI_UNLOCK_PUBLIC_KEY` (PEM or base64
  SPKI — use whatever 128's key loader parses) **only** when `Q2L_UI_HARNESS === '1' && isDev`,
  exactly like `DialogService.pickConfigFiles()` in `src/main/services/dialog.ts`; otherwise the
  variable is ignored. Main sends reason ids, never prose. Tests in new `src/main/ipc/unlock.test.ts`
  (mirror `src/main/ipc/app.test.ts`'s electron mocking): "each rejection path maps to its own
  reason", "a valid code resolves with its features, expiry and label", "an expired stored code is
  reported expired and its feature is no longer unlocked" (assert via 130's unlocked-features
  query after a simulated start), "re-redeeming a stored code does not duplicate it", "the test
  public key is ignored outside the harness double gate", "a non-string or over-length payload is
  refused before the service is called".

- **D2 — Unlock panel in Settings.** Files: new `src/renderer/src/components/unlock/UnlockCodePanel.tsx`,
  new `.../components/unlock/UnlockCodePanel.test.tsx`, `src/renderer/src/views/SettingsView.tsx`
  (insert `<Panel className="space-y-2.5 p-4" data-testid="settings-unlock"><SectionLabel>{t('settings.section.unlock')}</SectionLabel><UnlockCodePanel /></Panel>`
  directly before the About panel), `src/renderer/src/i18n/locales/en.json`, `CHANGELOG.md`
  (`### Added`, one short line). Mirror `src/renderer/src/modules/servers/ServersSettingsSection.tsx`
  for load-on-mount + Outcome/domain-result handling, and `modules/downloads/components/FailureLogEntry.tsx`
  for the copy action + visible confirmation. Calls go through `invoke` from `../../lib/bridge`:
  `unlock:getState` on mount, `unlock:redeem` on submit (then re-fetch state), `app:copyText` with
  `installationId` exactly as displayed. Layout, unobtrusive, no wizard: row 1 — stencil label
  "Installation id", the id in a monospace `<code data-testid="unlock-installation-id">`, a copy
  `IconButton`/`Button size="sm"` (`data-testid="unlock-copy-id"`, accessible name from i18n) with a
  transient "Copied" confirmation; one muted hint line ("Send this id to get a code"). Row 2 — a
  labelled `<input data-testid="unlock-code-input">` (styled like the servers address input) +
  `Button` `data-testid="unlock-code-submit"`, disabled while empty or submitting; Enter submits.
  Result area: rejection → `<p role="alert" data-testid="unlock-result-rejected">` with
  `t('settings.unlock.reject.<reason>')`; acceptance → `<div role="status" data-testid="unlock-result-accepted">`
  listing each feature (`t('unlock.feature.<name>', { defaultValue: name })`), the expiry
  (localized via `Intl.DateTimeFormat` with the active i18n language, or
  `settings.unlock.noExpiry`) and one line `settings.unlock.takesEffectNextStart`. Below: stored
  codes list `data-testid="unlock-codes"`, one `<li data-testid="unlock-code-row">` per code with
  features, label (if any) and expiry; an `expired` row shows the sentence
  `settings.unlock.expired` ("This code expired on {{date}} — its features are no longer
  available.") in text, not colour alone. en.json keys under `settings.unlock.*` plus
  `settings.section.unlock`; the five `settings.unlock.reject.*` strings are distinct, and there is
  **no** generic/fallback reject key. Tests (renderer, invoke mocked, mirror
  `ServersSettingsSection.test.tsx`): "shows the installation id and copies it verbatim", "each of
  the five rejection reasons renders its own distinct text", "an accepted code lists its features
  and expiry immediately", "an accepted code without expiry says it does not expire", "an expired
  stored code says it expired".

- **D3 — Experimental marking supplied by the gate.** Files: new
  `src/renderer/src/components/ui/ExperimentalBadge.tsx` (mirror `components/ui/DemoBadge.tsx`:
  `<Badge tone=… testId="experimental-badge">{t('experimental.badge')}</Badge>`, pick an existing
  `Badge` tone that is not `warning`/`danger`), `en.json` (`experimental.badge`: "Experimental"),
  [[130]]'s renderer gate component/helper (the single place a gated surface is rendered — find it
  from 130's Done section) plus its existing test file. The gate renders `ExperimentalBadge` itself
  for every unlocked surface kind it supports (for a tab/menu entry: inline after the label; for a
  route/view: at the top of the rendered surface), and exposes **no prop** to suppress it; a locked
  feature still renders nothing at all (no badge either). Tests, added to 130's gate test using
  130's test-only feature declaration: "an unlocked gated surface carries the experimental badge"
  and "a locked gated surface renders no badge and nothing else".

- **D4 — End-to-end flow `unlock-code`.** File: new `scripts/flows/unlock-code.mjs`. Mirror
  `scripts/flows/servers-master-sources.mjs` (navigation via `nav-settings`, restart phase = second
  `withApp()` over a fresh variant userData dir seeded with a copy of phase 1's `state.json`) and
  `bootstrap-no-engine-for-platform.mjs` (`setup()` returning `{ env }`). `setup()`: generate a
  throwaway Ed25519 pair with `node:crypto` and return `{ env: { Q2L_UI_UNLOCK_PUBLIC_KEY: <public
  key in the format D1's override parses> } }`; sign codes with the function exported by
  `scripts/issue-unlock-code.mjs` ([[128]] AC8) if it exports one, otherwise build the
  `q2l1.<payload>.<signature>` string the same way it does. Pass the same env to the restart
  `withApp()`. Steps: (AC1) open Settings, read `unlock-installation-id`, assert
  `/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/`, click `unlock-copy-id`, assert
  `app.evaluate(({ clipboard }) => clipboard.readText())` equals it. (AC2) submit five codes —
  `hello`, a valid code with one signature byte flipped, a code for another installation id, a code
  whose redeem-by is in the past, a code whose feature expiry is in the past — and assert each
  `unlock-result-rejected` text equals its exact en.json string, contains no `settings.unlock`, and
  all five texts are pairwise different. (AC3) submit a valid code for feature `watchlist` with a
  per-run unique label and feature expiry now+10 s; assert `unlock-result-accepted` shows the
  feature label and an expiry, and the code's row appears in `unlock-codes`. (AC5) wait until the
  expiry has passed, restart, open Settings, assert the row with that label shows the
  `settings.unlock.expired` sentence. Scope every row assertion to the per-run label so repeated
  runs without a reseed stay green. Screenshot each phase via `shot()`.

## Model Hints

- D1 → deliverable-hard: it changes [[128]]'s start-time re-verification to retain expired tokens
  without letting them unlock anything — a slip there either silently re-enables an expired feature
  (breaks 128 AC7/130) or drops the record AC5 needs — and adds a public-key override that must stay
  inert outside the harness double gate.
- D2, D3, D4 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/unlock-code.mjs` › "unlock-code" (installation id format + copy lands
  on the clipboard); unit `src/renderer/src/components/unlock/UnlockCodePanel.test.tsx` › "shows
  the installation id and copies it verbatim" (D2).
- AC2 → e2e `scripts/flows/unlock-code.mjs` › "unlock-code" (five distinct rendered reasons);
  unit `src/main/ipc/unlock.test.ts` › "each rejection path maps to its own reason" (D1);
  unit `src/renderer/src/components/unlock/UnlockCodePanel.test.tsx` › "each of the five rejection
  reasons renders its own distinct text" (D2).
- AC3 → e2e `scripts/flows/unlock-code.mjs` › "unlock-code" (accepted features + expiry shown);
  unit `src/renderer/src/components/unlock/UnlockCodePanel.test.tsx` › "an accepted code lists its
  features and expiry immediately" (D2).
- AC4 → unit, 130's renderer gate test file › "an unlocked gated surface carries the experimental
  badge" and "a locked gated surface renders no badge and nothing else" (D3). Not e2e here: no
  real gated surface exists until [[132]], whose AC8 flow proves the badge on the watchlist tab.
- AC5 → e2e `scripts/flows/unlock-code.mjs` › "unlock-code" (restart phase: Settings says the code
  expired); unit `src/main/ipc/unlock.test.ts` › "an expired stored code is reported expired and
  its feature is no longer unlocked" (D1 — the "gone at next start" half, via 130's query).

## Done

<!-- Filled by `/build 129`. -->
