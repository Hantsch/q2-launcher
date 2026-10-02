---
id: 206
title: a refusal is one shape with a full i18n key and one toast path
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a handler's "no, because …" answer to have one shape across modules,
carry the full i18n key, and reach the user through one toast helper, so that a caller can tell
from the type how a refusal arrives, a generic refusal-to-toast path exists, and no key is
assembled by string template where a key-coverage test cannot see it.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F04 part 3–4): 43
non-test files declare their own `{ ok: false … }` union — field named `reason` 31x, `reasonKey`
11x, `error` 3x, `code` 2x; `ReplaysStageResult` uses `placed`; seven local `fail`/`refuse`
helpers re-implement `@shared/types.fail`; the renderer assembles keys like
`servers.sources.reject.${reason}` and `replays.extraFolders.error.${reason}`. `toastError` is
private to `useLauncher.ts` while 12 sites re-spell
`{ level: 'error', messageKey: result.error.key, timeoutMs: 0, …params }` (some omit params).

Depends on story 204 (single `Outcome` envelope).

## Acceptance Criteria

- [ ] **AC1** — `src/shared/types/common.ts` exports `Refusal<R> = { ok: false; reasonKey: R; params? }`,
      `DomainResult<T, R>` and `refuse()`; the five to seven local `fail`/`refuse` copies are
      deleted.
- [ ] **AC2** — The servers and replays in-band result types (`ManualServerAddResult`,
      `MasterSourcesResult`, `ScanStartResult`, `QuickFiltersResult`, `WatchlistMutationResult`,
      `ExtraFoldersResult`, `DemoFileActionResult`, `ReplaysStageResult`) are expressed as
      `DomainResult` and main sends full i18n keys; no renderer file builds a key from a
      `${reason}` template (grep-zero for `` `.*\.\${reason`` in `src/renderer`).
- [ ] **AC3** — `src/renderer/src/lib/toast.ts` exports `toastOutcomeError`/`toastRefusal`;
      the 12 inline toast literals use them; params are never dropped.
- [ ] **AC4** — Story 204's error-key test also scans `reasonKey` literals in main and the keys
      are all present in `en.json`.
- [ ] **AC5** — docs/ARCHITECTURE.md documents the two shapes (`Outcome` for transport/unexpected,
      `Refusal` for a domain "no") in one paragraph.
- [ ] **AC6** — The affected flows (`servers-master-sources`, `servers-quick-filters`,
      `replays-extra-folders`, watchlist and demo file actions) stay green or are fixed inside
      this story.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Should `Refusal` carry `params` typed per key, or stay `Record<string, string | number>`
      like toasts do today?

## Decisions (Sprint)

- **(User)** Refusal params: Stay `Record<string, string | number>`.
- **Success shape:** `DomainResult<T extends object, R extends string = string> = ({ ok: true } & T) | Refusal<R>` keeps each result's existing success fields (`sources`, `list`, `entry`, `snapshot`, `folders`), because the finding is about the refusal side and renaming success payloads would churn every consumer for nothing; a bare-success result uses `T = Record<never, never>`.
- **Key typing:** where a refusal's key set is closed, `R` is the literal union of full keys (e.g. `'replays.extraFolders.error.notAbsolute' | …`), so the compiler and the key-coverage test both see every key; `string` stays only where a key comes from an existing mapper.
- **Nesting is intended:** after story 204 (every handler returns `Outcome<R>`) an in-band result arrives as `Outcome<DomainResult<…>>` — `Outcome` = transport/unexpected, `Refusal` = domain "no" — because that is exactly the two-shape split AC5 documents.
- **Which local helpers are "the copies" (AC1):** the refusal builders `refuse` in `src/main/modules/servers/master-sources.ts`, `refuse` in `src/shared/replays/demo-play.ts`, `fail` in `src/shared/replays/demo-rename.ts` and `fail` in `src/shared/replays/name-template.ts` (four, grep-verified at refine); the look-alikes are not refusal copies and stay — the job `failed`/`fail` helpers (job outcomes, story 219), `mods/remove.ts` `refuse` (throws), `playback-store.ts` `fail` (optimistic rollback), `optimistic-timeline.ts` `refuse` (a reducer) — because AC1's "five to seven" was the review's estimate, not a list.
- **Address parser stays reason-coded:** `parseServerAddress`'s `{ ok: false; reason }` is a parser result used by ~19 files (incl. `master-records.ts`' skipped list), so it is not converted; instead `serverAddressRejectionKey()` becomes a lookup in an exported literal `SERVER_ADDRESS_REJECTION_KEYS` map, because its `` `servers.address.reject.${reason}` `` template is exactly the coverage-invisible key this story removes, and that is a one-function change.
- **Master sources:** main maps `MasterSourcesRejectionReason` to full keys through an exported literal `MASTER_SOURCES_REFUSAL_KEYS: Record<MasterSourcesRejectionReason, …>` (all 20 `servers.sources.reject.*` keys already exist in `en.json`), because the reason union is shared with address validation and a map keeps both exhaustive.
- **`WatchlistMutationResult` moves to `src/shared/modules/servers.ts`**, because main builds it and a type declared in the renderer client cannot be the contract for both sides.
- **AC2's grep is generalised:** the guard test uses `/\.\$\{[\w.]*reason\}/` over non-test `src/renderer` files, because the AC's literal regex (`\.\${reason`) does not match the three sites it was written for (`${domain.reason}`, `${result.value.reason}`); the four extra hits this catches (`UnlockCodePanel.tsx`, `RenameActionDialog.tsx`, `ReplaysListStatus.tsx`, `care-items.ts`) are fixed with a local literal `Record<Reason, key>` — a one-line change each, no main/IPC change.
- **Out of scope, left as is:** `src/main/ipc/installations.ts`' `` `runner.unavailable.${kind}` `` and `source-resolution.ts`' `masterSourceFailureKey()` (status fields, not refusals of a listed type), and the remaining ~30 local `{ ok: false … }` unions (parser/validator results not crossing IPC as a handler's refusal), because AC2 names the in-band types this story owns; they ride along with whichever story next touches them.
- **Toast helper signature:** `toastOutcomeError(pushToast, failure)` / `toastRefusal(pushToast, refusal)` take the store's `pushToast` as an argument instead of importing the store, so `lib/` stays store-free and the helpers are unit-testable; useLauncher's private `toastError` is deleted.
- **Key coverage (AC4) scope:** the scan covers `src/main/**` and `src/shared/**` (non-test) because demo-play/demo-rename/name-template keys are built in shared validators that main forwards; it also imports the two exported key maps and fails on any `reasonKey:`/`refuse(` template literal, so a key can only enter a refusal as a visible literal.
- **Cut by domain, not by layer:** each servers/replays D changes a shared type together with its main producer and renderer consumer, because a shared type change split across layers would leave typecheck red between Ds.
- **No CHANGELOG entry:** the only user-visible effect is that a discard-changes error toast now shows its params, which is too small for a user line under CLAUDE.md's changelog rule.

## Plan

Order matters: D1 first (types), D2–D6 per domain (each compiles on its own), D7–D8 toasts,
D9 the renderer template guard (needs D2/D4/D5 done), D10 the key-coverage extension last
(needs every key literal). Story 204 is a hard prerequisite: handlers already return a single
`Outcome`, and its error-key test exists.

1. **D1** — `Refusal`, `DomainResult`, `refuse()` in `src/shared/types/common.ts`; ARCHITECTURE.md paragraph.
2. **D2** — servers master sources + manual add: full keys from main, address key map, renderer reads `reasonKey`.
3. **D3** — servers quick filters, scan start, watchlist: retype as `DomainResult`, literal quick-filter keys, move `WatchlistMutationResult` to shared.
4. **D4** — replays extra folders, demo file actions, stage result: `DomainResult` + full keys.
5. **D5** — demo-play + demo-rename validators use `refuse()` with full keys.
6. **D6** — name-template validator uses `refuse()`.
7. **D7/D8** — `src/renderer/src/lib/toast.ts` + the 12 inline toast literals.
8. **D9** — remaining renderer reason templates + the guard test.
9. **D10** — extend story 204's error-key test to `reasonKey`/`refuse(` literals and the key maps.

Flows: D2 → `servers-master-sources`; D3 → `servers-quick-filters`, `servers-watchlist`;
D4 → `replays-extra-folders`, `replays-demo-file-actions`. No user-visible text changes.

## Deliverables

- [ ] **D1 — the refusal shape.** In `src/shared/types/common.ts` (next to `Outcome`/`ok`/`fail`) add:
  `export type Refusal<R extends string = string> = { ok: false; reasonKey: R; params?: Record<string, string | number> }`;
  `export type DomainResult<T extends object, R extends string = string> = ({ ok: true } & T) | Refusal<R>`
  (bare success: `T = Record<never, never>`); `export function refuse<R extends string>(reasonKey: R, params?): Refusal<R>`
  that omits `params` when undefined (mirror `fail`'s shape). Re-export through `src/shared/types/index.ts` if `Outcome` is
  re-exported there. Add one paragraph to `docs/ARCHITECTURE.md` § "The IPC contract" (after the `handleOutcome` paragraph):
  `Outcome<T>` is the transport/unexpected envelope (schema reject, throw, missing handler, I/O failure); `Refusal<R>` /
  `DomainResult<T, R>` is a handler's expected domain "no", returned *inside* `Outcome.value`, always carrying a full i18n key
  (never a reason code the renderer must template), built with `refuse()`; the renderer toasts either through
  `toastOutcomeError`/`toastRefusal` in `src/renderer/src/lib/toast.ts`. Tests: new `src/shared/types/common.test.ts` ›
  "refuse() builds a Refusal and omits absent params" and › "ARCHITECTURE.md documents Outcome and Refusal" (reads
  `docs/ARCHITECTURE.md`, asserts one paragraph names `Outcome<T>`, `Refusal<R>`, `refuse()` and `toastRefusal`).
- [ ] **D2 — servers master sources and manual add send full keys.** Files: `src/shared/modules/servers.ts`
  (`MasterSourcesResult = DomainResult<{ sources: MasterSource[] }, MasterSourcesRefusalKey>`, `ManualServerAddResult =
  DomainResult<{ entry: ManualServerEntry }>`; `MasterSourcesRefusalKey` = literal union of the 20 `servers.sources.reject.*`
  keys in `en.json`), `src/main/modules/servers/master-sources.ts` (delete the local `refuse`; export
  `MASTER_SOURCES_REFUSAL_KEYS: Record<MasterSourcesRejectionReason, MasterSourcesRefusalKey>` with literal values and return
  `refuse(MASTER_SOURCES_REFUSAL_KEYS[reason])` from `@shared/types`), `src/shared/servers/address.ts`
  (`serverAddressRejectionKey()` returns `SERVER_ADDRESS_REJECTION_KEYS[reason]`, an exported literal
  `Record<ServerAddressRejection, …>` of the 13 `servers.address.reject.*` keys; no template; signature unchanged),
  `src/main/modules/servers/manual-servers.ts` (`refuse(serverAddressRejectionKey(parsed.reason))`),
  `src/renderer/src/modules/servers/ServersSettingsSection.tsx` (`setError({ key: domain.reasonKey, ...(domain.params ? { params: domain.params } : {}) })`
  — no template). Tests: `master-sources.test.ts` › "a refused mutation carries the full servers.sources.reject key",
  `src/shared/servers/address.test.ts` › "every address rejection maps to a literal servers.address.reject key".
  Run flow `servers-master-sources`.
- [ ] **D3 — quick filters, scan start and watchlist are DomainResults.** Files: `src/shared/modules/servers.ts`
  (`QuickFiltersResult = DomainResult<{ list: QuickFilter[] }, QuickFilterRefusalKey>` with the literal union of the 7
  `servers.quickFilter.error.*` keys; `ScanStartResult = DomainResult<Record<never, never>>`; move
  `WatchlistMutationResult = DomainResult<{ snapshot: WatchlistSnapshot }>` here from the renderer client),
  `src/main/modules/servers/quick-filter-entries.ts` (replace every `` `${KEY}…` `` template with a literal key via
  `refuse('servers.quickFilter.error.noCriteria')` etc.; for the `problem` branch use a literal
  `Record<'empty' | 'tooLong', QuickFilterRefusalKey>`), `src/main/modules/servers/watchlist-entries.ts` and
  `watchlist-service.ts` (use `refuse()` and the shared type), `src/renderer/src/modules/servers/client.ts` (delete the local
  `WatchlistMutationResult`, import from `@shared/modules/servers`), and any renderer file that imported it from the client
  (`useWatchlist.ts`, `WatchlistAddForm.tsx`, `WatchlistRow.tsx`) — import from shared, no re-export shim. Wire field names are
  unchanged (`ok`/`reasonKey`). Test: `quick-filter-entries.test.ts` › "every refusal carries a literal servers.quickFilter.error key".
  Run flows `servers-quick-filters` and `servers-watchlist`.
- [ ] **D4 — replays in-band results send full keys.** Files: `src/shared/modules/replays.ts`
  (`ExtraFoldersResult = DomainResult<{ folders: ReplaysExtraFolder[] }, ExtraFoldersRefusalKey>` with the 4
  `replays.extraFolders.error.*` keys; `DemoFileActionResult = DomainResult<Record<never, never>, 'replays.fileActions.unknownDemo' | 'replays.fileActions.fileMissing'>`;
  `ReplaysStageResult = DomainResult<Record<never, never>>` replacing `{ placed }`),
  `src/main/modules/replays/extra-folders.ts` and `file-actions.ts` (`refuse('<full key>')`),
  `src/main/modules/replays/demo-play.ts` (stage: `{ ok: true }` / `refuse(availability.reason.key, availability.reason.params)`;
  update every reader of `.placed`), `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` and
  `components/DemoFileActions.tsx` (read `reasonKey`/`params`, no template). Tests: `extra-folders.test.ts` ›
  "a refused folder carries the full replays.extraFolders.error key", `file-actions.test.ts` ›
  "a refused file action carries the full replays.fileActions key", `demo-play.test.ts` › "an unplaced stage is a Refusal with its key".
  Run flows `replays-extra-folders` and `replays-demo-file-actions`.
- [ ] **D5 — demo-play and demo-rename validators use `refuse()`.** Files: `src/shared/replays/demo-play.ts` (delete local
  `refuse`; `DemoPlayEligibility = DomainResult<…existing success fields…, DemoPlayReasonKey>`: `reason: { key, params }` becomes
  `reasonKey`/`params`), `src/shared/replays/demo-rename.ts` (delete local `fail`; `ValidateDemoRenameResult` refusal carries the
  full `replays.rename.error.<reason>` key as a literal union `DemoRenameRefusalKey`; any caller that branched on the reason code
  branches on the key), `src/main/modules/replays/demo-play.ts` (`fail(eligibility.reasonKey, eligibility.params)`),
  `src/main/modules/replays/demo-rename.ts` (replace `` fail(`replays.rename.error.${validated.reason}`, …) `` with
  `fail(validated.reasonKey, validated.params)`), `src/renderer/src/modules/replays/useDemoPlay.ts` and
  `RenameDemoDialog.tsx` (`t(validation.reasonKey, validation.params)`, no template). Tests: existing
  `src/shared/replays/demo-play.test.ts` and `demo-rename.test.ts` updated to the new shape, plus `demo-rename.test.ts` ›
  "a rejected stem carries the full replays.rename.error key".
- [ ] **D6 — name-template validator uses `refuse()`.** Files: `src/shared/replays/name-template.ts` (delete local `fail`;
  `CompileNameTemplateResult = DomainResult<…existing success fields…, NameTemplateErrorKey>`: `error: { key, params }` becomes
  `reasonKey`/`params`), its callers `src/shared/replays/name-patterns.ts`, `src/main/modules/replays/name-templates.ts`,
  `src/main/modules/replays/scan-service.ts`, `src/renderer/src/modules/replays/NameTemplatesList.tsx` (where a caller forwards
  the error as an `Outcome`, use `fail(r.reasonKey, r.params)`). Tests: existing `name-template.test.ts`, `name-templates.test.ts`,
  `name-patterns.test.ts` updated; `name-template.test.ts` › "a failed compile is a Refusal with its key and params".
- [ ] **D7 — one toast path.** New `src/renderer/src/lib/toast.ts`:
  `type PushToast = (toast: Omit<ToastMessage, 'id'>) => void` (`ToastMessage` from `@shared/types/toast`);
  `toastOutcomeError(push, failure: { ok: false; error: LocalizedMessage })` and `toastRefusal(push, refusal: Refusal)` both push
  `{ level: 'error', messageKey, timeoutMs: 0, ...(params ? { params } : {}) }` — params never dropped. No store import.
  Replace the inline literal `{ level: 'error', messageKey: <x>.error.key, timeoutMs: 0, … }` in
  `src/renderer/src/store/useLauncher.ts` (delete private `toastError`; its 10 callers call `toastOutcomeError(get().pushToast, result)`),
  `src/renderer/src/modules/config/DiscardChangesDialog.tsx` (today omits params), `SettingsTab.tsx`, `RawFileTab.tsx`,
  `CareTab.tsx` (2 sites). Test: new `src/renderer/src/lib/toast.test.ts` › "toastOutcomeError forwards key and params, sticky" and
  "toastRefusal forwards reasonKey and params, sticky".
- [ ] **D8 — the remaining toast literals.** Replace the same inline literal with `toastOutcomeError(deps.pushToast | pushToast, outcome)`
  from `src/renderer/src/lib/toast.ts` in `src/renderer/src/modules/config/lib/file-source-refresh.ts`, `lib/raw-draft.tsx`,
  `lib/save-bar.ts`, `lib/use-care-sync.ts` (3 sites). Add to `src/renderer/src/lib/toast.test.ts` a guard ›
  "no inline error-toast literal remains outside toast.ts": scan non-test `src/renderer/src/**/*.{ts,tsx}` for
  `/messageKey:\s*\w+\.error\.key/` and expect zero hits outside `lib/toast.ts`.
- [ ] **D9 — no renderer key is templated from a reason.** Replace `` t(`prefix.${x.reason}`) `` with a local literal
  `Record<ReasonUnion, string>` lookup (keys unchanged, all exist in `en.json`) in
  `src/renderer/src/components/unlock/UnlockCodePanel.tsx` (`settings.unlock.reject.*`),
  `src/renderer/src/modules/config/components/RenameActionDialog.tsx` (`config.controls.actions.renameDialog.aliasName.error.*`),
  `src/renderer/src/modules/replays/ReplaysListStatus.tsx` (`replays.list.sourceErrorReason.*`),
  `src/renderer/src/modules/config/lib/care-items.ts` (`config.care.sync.canonical.<reason>` and `<reason>Hint`). New guard test
  `src/renderer/src/i18n/reason-templates.test.ts` › "no renderer file builds an i18n key from a reason": scan non-test
  `src/renderer/src/**/*.{ts,tsx}` for `/\.\$\{[\w.]*reason\}/` and expect zero hits (this also proves D2/D4/D5's sites are gone).
- [ ] **D10 — every refusal key resolves.** Extend the error-key test story 204 added (204 AC3:
  `src/renderer/src/i18n/error-keys.test.ts`; if 204's Done section names another file, extend that one — reuse its scanner and
  its `en.json` leaf resolver, no second copy) so it also collects from non-test `src/main/**/*.ts` and `src/shared/**/*.ts`:
  `reasonKey: '…'` literals, `refuse('…'` literals, and `Object.values` of `MASTER_SOURCES_REFUSAL_KEYS` and
  `SERVER_ADDRESS_REJECTION_KEYS` (imported), asserting each resolves to a leaf in `en.json`; and asserts zero
  `` reasonKey: ` `` / `` refuse(` `` template literals under `src/main/modules/**` and `src/shared/**`. Tests in that file ›
  "every reasonKey and refuse() literal resolves in en.json", "no refusal key is built from a template", and the existing
  negative case extended › "a misspelled reasonKey literal fails the scan".

## Model Hints

No `deliverable-hard`: every D is a mechanical retype the compiler checks end to end, and the keys already exist in `en.json`.

Review: → default

## Acceptance Tests

- AC1 → unit `src/shared/types/common.test.ts` › "refuse() builds a Refusal and omits absent params"; plus typecheck (the four
  deleted helpers' callers compile against `@shared/types`) and D5/D6's tests (D1, D2, D5, D6).
- AC2 → unit `src/main/modules/servers/master-sources.test.ts` › "a refused mutation carries the full servers.sources.reject key",
  `src/main/modules/servers/quick-filter-entries.test.ts` › "every refusal carries a literal servers.quickFilter.error key",
  `src/main/modules/replays/extra-folders.test.ts` › "a refused folder carries the full replays.extraFolders.error key",
  `src/main/modules/replays/file-actions.test.ts` › "a refused file action carries the full replays.fileActions key",
  `src/main/modules/replays/demo-play.test.ts` › "an unplaced stage is a Refusal with its key"; grep-zero → unit
  `src/renderer/src/i18n/reason-templates.test.ts` › "no renderer file builds an i18n key from a reason" (D2, D3, D4, D9).
- AC3 → unit `src/renderer/src/lib/toast.test.ts` › "toastOutcomeError forwards key and params, sticky",
  "toastRefusal forwards reasonKey and params, sticky", "no inline error-toast literal remains outside toast.ts" (D7, D8).
- AC4 → unit `src/renderer/src/i18n/error-keys.test.ts` (story 204's file) › "every reasonKey and refuse() literal resolves in en.json",
  "no refusal key is built from a template", "a misspelled reasonKey literal fails the scan" (D10).
- AC5 → unit `src/shared/types/common.test.ts` › "ARCHITECTURE.md documents Outcome and Refusal" (D1).
- AC6 → e2e `scripts/flows/servers-master-sources.mjs` › servers-master-sources (D2);
  e2e `scripts/flows/servers-quick-filters.mjs` › servers-quick-filters (D3);
  e2e `scripts/flows/servers-watchlist.mjs` › servers-watchlist (D3);
  e2e `scripts/flows/replays-extra-folders.mjs` › replays-extra-folders (D4);
  e2e `scripts/flows/replays-demo-file-actions.mjs` › replays-demo-file-actions (D4).

## Done

<!-- Filled by /build 206. -->
