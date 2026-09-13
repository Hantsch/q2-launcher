---
id: 079
title: A save reaches every installation, and Care sees drift
status: done # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

When I change something in a profile and save it, every installation that profile is assigned to
must carry the new file — without me doing anything else. Today that is only true for *one* of the
ways a profile's file changes. And when a copy no longer matches — because a save never reached
it, or because something edited the file in the game folder — Care must tell me, and let me fix it
from there. Care is where the "is my config where it should be" question already lives; the
answer just is not complete yet.

### What the real state showed (2026-09-10)

The launcher's own state on this machine, read directly from disk:

| File | Written | SHA-256 |
| --- | --- | --- |
| `%APPDATA%/Q2 Launcher/Hantsch-Test.cfg` (canonical) | 08:14:09 | `2037e6df…` |
| `C:\Games\Q2Pro\baseq2\Hantsch-Test.cfg` (installation copy) | 08:13:44 | `3c92ace0…` |

`state.json` says the profile is clean (`dirty: false`), `fileHash` is `2037e6df…`, no pending
writes, no write failures — i.e. from the launcher's point of view everything is fine. The copy
differs from the canonical file by exactly one block (the nine `Entries: Movement` anchor lines),
and every entry id, and the layer id, in `state.json` was minted anew at 08:14:09 while the
previous `state.json.bak` still carries the old ones. Ids are only ever re-minted by adopting a file
(`profile-restore.ts`: "an id is never adopted"), and the only path that both *writes* the
canonical file and *adopts* it is the Raw file tab's save (`CONFIG_HANDLERS.saveRawText`,
[index.ts:1107](../../src/main/modules/config/index.ts#L1107)) — which, by its own doc comment,
"deliberately" does not run the installation cascade. The structured save
(`CONFIG_HANDLERS.save`) does cascade, and is covered by
`index.test.ts › "writes the canonical file and the installation copy…"`.

So the observed behaviour is not a broken save; it is that "save" means two different things
depending on which tab the Save button was pressed from, and only one of them publishes. The
user cannot tell the two apart — it is the same button in the same save bar
(`ProfileSaveActions.tsx:119`).

### Every path on which the canonical file changes, and whether installations follow

| Path | Cascades today? | Where |
| --- | --- | --- |
| Structured save (Settings/Controls/Aliases) | yes | `save` → `syncAndPersist` |
| Raw file tab save | **no** — documented as deliberate | `saveRawText` |
| Adopting an external edit (Care › Reload, conflict dialog "take the file", focus/tab re-read) | **no** | `refreshFromFiles` |
| Tidy-up apply | yes | `tidyUpApply` → `syncAndPersist` |
| Game was running at save time | **not written at all** — deferred as `pending` and never flushed on game exit; only the next save/assign/launcher start retries | `sync.ts:280`, no `onStateChange` consumer in the config module |

### The running game is not a reason to hold a write back

Story 004 decision 3 / CFG-3 ("running installations are skipped and shown as pending") is
reversed by this story. There is no reason not to write a `.cfg` while the game runs — quite the
opposite: the engine reads a config only at `exec` time and holds no handle on it afterwards, so a
copy written mid-session is exactly what lets the player `exec` the new profile from the console
(or press the switch bind) without restarting. Holding the write back turns "tweak, alt-tab,
`exec`, try" into "tweak, quit, restart, try". The `pending` state therefore disappears as a
*reason*: an installation copy is written whenever its canonical file changes, running or not. What
stays is the honest report of a write that *failed* (a locked file, a permissions problem — the
existing `failed` row with Retry). `cleanup.ts`'s own running-game guard (`applyCleanupIfNotRunning`)
is about *deleting* files out from under a running engine and is not touched by this.

### Where drift is (not) visible today

- `syncState` compares every installation copy byte-for-byte — but it is only fetched while the
  Care tab is mounted (`use-care-sync.ts`, on profile switch and `updatedAt` bump). Nothing checks
  on window focus or tab open, where `useFileSourceRefresh` already re-reads the canonical file.
- The Care tab's badge in the tab strip counts validation + tidy-up findings only
  (`ConfigView.tsx:237`); a stale or missing installation copy never reaches it.
- A drifted installation row (`outOfSync` / `missing`) offers Open and Reveal, nothing that writes
  (`care-items.ts:241` — Retry exists for `failed` only). The `write` channel that would fix it is
  one IPC call away and is not offered.

### A round-trip flaw that would make the drift verdict wrong

Adopting a file mints a new layer id, but the layer id is *rendered into the file*
(`[q2l layer=<id> …]`, `render.ts:262`). After any adopt (raw save, Reload, focus re-read of an
external edit) `renderProfileFile(profile)` therefore differs from the very file that was just
adopted, by exactly that one line — verified with the real file above: parse → render is
byte-identical except for the layer banner. Consequences: the canonical row reads `outOfSync` with
the *externalEdit* reason although nothing external happened, every installation row reads
`outOfSync` against a render nobody wrote, and the next structured save rewrites the layer id into
every copy. A drift check that cannot trust its own render is worth nothing, so this story has to
close it (or judge drift against the canonical *file*, never the render — the same rule AC6 of
story 043 already applies to installation copies of a dirty profile).

## Acceptance Criteria

- [x] **AC1** — After a Raw file tab save, every assigned, not-running installation's copy is
  byte-identical to the canonical file (the typed text), the same way it is after a structured save.
- [x] **AC2** — After the launcher adopts an external edit of the canonical file (Care › Reload,
  the conflict dialog's "take the file", or the focus/tab re-read), every assigned, not-running
  installation's copy is byte-identical to the adopted file.
- [x] **AC3** — A save (structured or raw) while the installation's game is running writes that
  installation's copy and loader immediately, exactly as when it is not running; the Care row
  reads *in sync* right after the save, and `exec <profile>.cfg` in the running game's console
  picks up the new content. No write is ever deferred for a running game; `pending` no longer
  appears as a state (a write that actually fails is still reported as *failed* with Retry).
- [x] **AC4** — Adopting a launcher-owned file (raw save, Reload, focus re-read, startup rebuild)
  is render-stable: `renderProfileFile(adopted)` equals the file's bytes, so a freshly adopted
  profile reports its canonical file as in sync and its installation copies against the same bytes.
- [x] **AC5** — Drift is checked without the Care tab being open: on window focus and on
  switching to any config tab (the same triggers as the canonical re-read), a changed, missing or
  stale installation copy is detected.
- [x] **AC6** — The Care tab's badge in the tab strip counts file drift (any Files row that is not
  in sync) alongside validation and tidy-up findings, de-duplicated like the rest.
- [x] **AC7** — A drifted installation row in Care (`outOfSync` or `missing`) offers a one-click
  *Sync now* that rewrites that installation from the canonical file (backup-once rules of
  `writer.ts` unchanged: a foreign file is backed up before it is overwritten), and the row clears
  on success.
- [x] **AC8** — A hand-edited installation copy is reported as *changed in the game folder*, not as
  a launcher failure: the row's title distinguishes "the copy was edited" from "the launcher's write
  did not land", and Sync now says which file it will overwrite.
- [x] **AC9** — None of the above writes a `dirty` profile's unsaved edits to any installation
  (story 043 AC6 holds): the cascade after a raw save/adopt, the write into a running
  installation and Sync now all write from the canonical file's bytes.
- [x] **AC10** — `docs/systems/config-module.md` (§3 "Apply trigger", §4 write flow, §6
  "Game-lifecycle", CFG-3) states the new rule — copies are written running or not — instead of
  "skipped and marked pending".

## Open Questions

None — the two forks below were decided during refine (see Decisions in the plan). Corrections welcome.

## Plan

### Decisions

- **AC4 — adopt the file's grouping ids, do not re-mint them.** The "an id is never adopted" rule in
  `profile-restore.ts:68` generalised story 042 AC4, which is only about the *profile* id on
  *import*. Entry ids are no longer rendered at all (`render.ts:177-184`), and layer/category/
  section ids are only ever looked up within one profile (`alt-layers.ts:445`, `tidy-up.ts:349`,
  `bind-collision.ts:172`; entries match modifier slots by trigger key, not layer id). So a
  `[q2l layer=…]`/`cat=`/`sub=`/`cvs=` tag is adopted when non-empty and unique within the file,
  minted otherwise — the template branch (`mintTemplate`, `:1762`) already does exactly this.
  Judging drift against bytes instead would hide the symptom but leave the next structured save
  rewriting ids into every copy (spurious diff after every adopt), so it is not a substitute.
- **Installation copies always mirror the canonical file's bytes**, never the render. Today
  `writeSourceFor` (`sync.ts:221`) and the readers (`index.ts:333, 1501`) use the canonical bytes
  only when the profile is `dirty`. New rule, enforced in one place and used by writer *and*
  judges: copies are written from and compared against the canonical file's bytes whenever that
  file's hash equals the profile's `fileHash` (or the file was just written in this sync run);
  if the canonical file is absent the render is the source (it is what the run writes first); if
  the file has moved underneath (hash ≠ `fileHash`) copies are **not** written and read `outOfSync`
  — 043 D10's "never overwrite bytes nobody has read" extends to publishing them. This is what
  makes a raw save's typed text (story 057: never re-rendered) reach installations byte-identical.
- **AC5 triggers** = the existing canonical re-read triggers in `useFileSourceRefresh.ts`: entering
  the Config view (mount) and window focus regained — not every tab switch inside the profile,
  which that hook deliberately does not fire on.
- **`pending` is removed end to end** (type literal, persisted `pendingWrites`, i18n, tests), and
  the dead legacy `writeProfileToAssignedInstallations` (`index.ts:137-239`, test-only caller)
  goes with it — its one behaviour test asserts the rule this story reverses.
- **Sync now** = the existing `write` handler with an optional `installationId` (no new channel).
- **Not in scope:** the canonical row's own verdict (render vs bytes, 043 "no sixth state") is
  unchanged; a raw save whose formatting is not a render fixed point keeps 057's semantics.

### Order

1. **D1** render-stable adopt (shared parser) → 2. **D2** copies mirror canonical bytes (sync core)
→ 3. **D3** raw save + adopt cascade (+ two e2e flows) → 4. **D4** no running-game defer (main)
→ 5. **D5** drop `pending` from shared type + renderer → 6. **D6** drift fetched outside Care
→ 7. **D7** Care badge counts drift → 8. **D8** per-installation `write` (main) → 9. **D9** Sync now
row action + wording (+ e2e flow) → 10. **D10** docs.

D1 and D2 are the invariants everything else stands on; D3 is a two-line cascade call once they
hold. D4/D5 are independent of D6–D9 but ordered first so the renderer never renders a state main
no longer produces.

## Deliverables

- [x] **D1 — Adopting a file keeps its grouping ids (AC4).** `src/shared/config/profile-restore.ts`:
  `buildLayer` (`:3116`) uses `section.fields.layer` when non-empty and unseen in this file, else
  `newId()`; same for `categoryRegistry.mint`/`idFor` (`:1748`, `:1813`), `subcategoryIdFor`
  (`:1853`) and the cvar-section registry (`:1887ff`, `:1954`) — mirror the template branch at
  `:1762-1776`. Doc comments at `:68-70` and `:3966` restated ("the *profile* id is never
  adopted; grouping ids are adopted when well-formed and unique"). Tests: `round-trip.test.ts`
  drops `canonicalizeMintedIds` so the fixed point is asserted byte-for-byte over every 042
  fixture; `file-source-pipeline.test.ts` gains "refresh → syncState reads inSync without a save
  in between" (the `:852-865` case currently saves in between) and a duplicate/empty-tag fixture
  that still mints. Acceptance: all round-trip fixtures byte-stable; duplicate tag → minted.
- [x] **D2 — Installation copies are written from and judged against the canonical file's bytes.**
  `src/main/modules/config/sync.ts` (`writeSourceFor` `:221`, uses at `:374`/`:418`),
  `src/main/modules/config/index.ts` (`collectRawFiles` `:333-334`, syncState judge `:1501-1502`;
  `canonicalWriteAllowed` `:432-444` untouched). One predicate decides the source per the
  Decisions rule; the "moved underneath" case writes nothing and reports `outOfSync`. Tests in
  `sync.test.ts` + `index.test.ts`: clean profile with hand-formatted canonical → copy equals
  file bytes, not render; canonical absent → render; hash ≠ `fileHash` → no copy write,
  `outOfSync`; existing 043 dirty-profile tests (`index.test.ts:1367, 1419`) unchanged.
- [x] **D3 — Raw save and every adopt path cascade (AC1, AC2).** `index.ts`: `saveRawText` calls
  `syncAndPersist` after `adoptFromFile` (`:1230-1244`), doc comment `:1107-1111` replaced;
  `refreshFromFiles` calls it after each adopt (silent re-read, "take the file" `:1316-1397`).
  Tests in `index.test.ts` › `saveRawText` / `refreshFromFiles` describes: copy byte-identical to
  typed/adopted text; dirty sibling on the same installation untouched. **Plus** e2e
  `scripts/flows/raw-save-cascades.mjs` (raw tab: type, save via `config-save`, assert
  installation copy bytes == canonical) and `scripts/flows/external-edit-cascades.mjs` (edit the
  canonical file on disk via `fs`, leave to Library and re-enter Config → adopt, assert copy ==
  new bytes); fixture helper in `scripts/lib/fixture.mjs` if `writePopulatedFixture` lacks a
  second assigned installation.
- [x] **D4 — A running game defers nothing (AC3, main half).** `sync.ts:280-302` running check
  removed; `pendingWrites` dropped from the sync outcome, `syncAndPersist` (`index.ts:447`), the
  persisted state key + `src/main/lib/schemas.ts` (read-side stays forgiving so an old key is
  ignored) and the startup sweep (failures still retried); legacy
  `writeProfileToAssignedInstallations` (`index.ts:137-239`) and its `describe` (`index.test.ts:172`)
  deleted. `write-plan.ts`'s `isInstallationRunning` stays (cleanup uses it). Tests: `sync.test.ts:146`
  becomes "writes a running installation exactly like a stopped one"; `index.test.ts` › save with
  a running installation → copy written, syncState `inSync`, nothing persisted as pending;
  `applyCleanupIfNotRunning` tests (`:1907-1974`) unchanged.
- [x] **D5 — `pending` leaves the contract and the renderer (AC3, renderer half).**
  `src/shared/modules/config.ts` (`ProfileFileSyncStatus` `:1107`, `WriteTargetStatus` `:773`),
  `src/renderer/src/modules/config/lib/care-sync.ts` (`CareSyncState` mirror `:20-34`),
  `care-items.ts`, `care-summary.ts`, `client.ts:433,445` (`installationRunning` only if it has no
  other user), `en.json` (`care.sync.state.pending`, `care.item.files.consequence.pending`, and the
  error key if orphaned). Tests updated: `care-sync.test.ts:55,89`, `care-items.test.ts:237`,
  `care-summary.test.ts:247`, `save-bar.test.ts:115-119`. Acceptance: `npm run typecheck` clean,
  no `'pending'` sync literal left in `src/`.
- [x] **D6 — Drift is fetched on the re-read triggers, not only in Care (AC5).** Sync rows move up:
  new `lib/use-drift-state.ts` (or a small context next to `raw-draft.tsx`) owned by
  `ConfigView.tsx`, fetched via `getProfileSyncState` right after `useFileSourceRefresh.ts`'s
  `runRefresh` (`:58-64`) on both triggers (`:66-81`) and on `profile.updatedAt`; `use-care-sync.ts`
  consumes those rows (keeps `runAction`, conflict handling, and re-fetch after an action) instead
  of its own effect (`:83-93`); `CareTab.tsx` unchanged in behaviour. Tests: `useFileSourceRefresh`
  test (refresh on mount/focus is followed by a sync-state fetch), `use-care-sync` test (no own
  fetch, refetch after retry).
- [x] **D7 — The Care badge counts drift (AC6).** `lib/care-summary.ts`'s `dedupedFindingCounts`
  gains the non-`inSync` Files rows (`ConfigView.tsx:237-240`, tab badge `:495`), de-duplicated
  per row like findings. Tests: `care-summary.test.ts` (an `outOfSync` and a `missing` row add to
  the badge count; `inSync` adds nothing; validation + drift are summed, not double-counted).
- [x] **D8 — `write` targets one installation (AC7 main half, AC9).** `src/shared/modules/config.ts`
  `WriteProfileInput` gains optional `installationId`; `src/main/modules/config/schemas.ts`
  validates it against known installation ids; `index.ts` `write` (`:894-929`) / `sync.ts`
  restrict the run to that installation. Tests in `index.test.ts`: Sync now on a foreign copy
  backs it up once then overwrites (`writer.ts:147-160` contract); on a **dirty** profile the
  copy equals the canonical file's bytes, not the unsaved edits (AC9); unknown id → rejected.
- [x] **D9 — Sync now on a drifted row, and the row says what happened (AC7, AC8).**
  `lib/care-items.ts` (`:241-257`): `outOfSync`/`missing` installation rows get a `syncNow`
  action (Open/Reveal kept); `use-care-sync.ts` `runAction` → `writeConfigProfile({ profileId,
  installationId })` then re-fetch; `client.ts`; `en.json`: `care.sync.state.outOfSync` →
  "Changed in the game folder", `failed` → "The launcher's write did not land", `care.sync.syncNow`
  with the target path in its hint. Tests: `care-items.test.ts` (outOfSync/missing rows offer Sync
  now, failed keeps Retry, canonical row never gets Sync now). **Plus** e2e
  `scripts/flows/care-drift-sync-now.mjs`: edit the installation copy on disk via `fs`, leave to
  Library and re-enter Config → badge count includes the drift row (AC5, AC6), open Care → row
  titled "Changed in the game folder" (AC8), click Sync now → copy bytes == canonical, row gone
  (AC7). Register in `docs/UI-VERIFICATION.md` like the existing flows.
- [x] **D10 — Docs (AC10).** `docs/systems/config-module.md` §3 "Apply trigger", §4 write flow
  ("per assigned installation", copies from canonical bytes), §6 "Game-lifecycle", CFG-3; a
  one-line note that story 079 reverses story 004 decision 3.

## Model Hints

- D1 → `deliverable-hard` — id adoption inside a ~4000-line restore pipeline with per-file
  dedupe across four registries; every 042 round-trip fixture becomes a byte-exact assertion, so
  a wrong guard regresses adopt for every existing profile.
- D2 → `deliverable-hard` — a cross-file invariant (writer in `sync.ts`, two judges in
  `index.ts`) that must not disagree, plus the "moved underneath" case that must publish nothing
  without breaking the structured-save run that writes canonical then copies in one pass.
- D3–D10 → default.
- Review: → `story-review-hard` — the story changes which bytes land in game folders, removes a
  safety rule (running-game defer) and adds a renderer-triggered write with a target id; the spec
  + diff must be checked for AC9 (no unsaved edits ever reach an installation) across all new paths.

## Acceptance Tests

- AC1 → e2e `scripts/flows/raw-save-cascades.mjs` › "a raw save lands byte-identical in every
  assigned installation"; unit `src/main/modules/config/index.test.ts` › "saveRawText cascades the
  typed bytes to every assigned installation" (D3).
- AC2 → e2e `scripts/flows/external-edit-cascades.mjs` › "an adopted external edit reaches every
  assigned installation"; unit `index.test.ts` › "refreshFromFiles cascades the adopted file" and
  "taking the file in a conflict cascades it" (D3).
- AC3 → unit `src/main/modules/config/sync.test.ts` › "writes a running installation exactly like
  a stopped one"; `index.test.ts` › "a save while the game runs writes the copy and reads inSync,
  nothing is persisted as pending" (D4); `care-sync.test.ts` › "no pending state exists" (D5).
  **manual residue** for the last clause only: `exec <profile>.cfg` in the running game's
  console picking up the new content needs a real Quake II engine process, which the harness's
  fixture installations are not.
- AC4 → unit `src/main/modules/config/round-trip.test.ts` › "parse → render is byte-identical
  over every 042 fixture (no id canonicalisation)"; `file-source-pipeline.test.ts` › "refresh
  reports inSync without a save in between" and "a duplicate or empty grouping tag is minted" (D1).
- AC5 → e2e `scripts/flows/care-drift-sync-now.mjs` › step "re-entering Config shows the drift
  in the badge without opening Care" (D9, behaviour from D6); unit
  `useFileSourceRefresh.test` › "a focus re-read is followed by a sync-state fetch" (D6).
- AC6 → unit `lib/care-summary.test.ts` › "drifted Files rows count toward the Care badge, de-
  duplicated with findings" (D7); e2e `care-drift-sync-now.mjs` badge step (D9).
- AC7 → e2e `care-drift-sync-now.mjs` › "Sync now rewrites the copy and clears the row" (D9); unit
  `index.test.ts` › "write with installationId backs up a foreign copy once, then overwrites" (D8).
- AC8 → e2e `care-drift-sync-now.mjs` › "the row reads Changed in the game folder and Sync now
  names the file" (D9); unit `care-items.test.ts` › "outOfSync and failed rows carry different
  titles; Sync now names its target" (D9).
- AC9 → unit `index.test.ts` › "write with installationId on a dirty profile writes the canonical
  file's bytes, never the unsaved edits" (D8); "saveRawText's cascade leaves a dirty sibling on the
  same installation untouched" (D3); existing `:1367, 1419` (D2 keeps them green).
- AC10 → **manual residue**: prose in a design document — checked by the story review reading
  the `docs/systems/config-module.md` diff against CFG-3 and §3/§4/§6; no automated test applies.

### Coverage

AC1 D3 · AC2 D3 · AC3 D4+D5 · AC4 D1 · AC5 D6 (+D9 flow) · AC6 D7 (+D9 flow) · AC7 D8+D9 ·
AC8 D9 · AC9 D2+D3+D8 · AC10 D10.

## Done

Every path that changes a profile's canonical file now cascades to its assigned installations
byte-identically, never a re-render: raw saves, adopting an external edit (silent re-read, Reload,
"take the file"), and structured saves alike. Adopting a file is render-stable (grouping ids are
adopted, not re-minted), which is what makes drift judged against canonical bytes trustworthy. A
running game no longer defers writes — `pending` is removed end to end. Care now surfaces drift
outside the tab (badge, background fetch on focus/profile-open) and offers a one-click *Sync now*
per drifted row, with wording that tells a hand-edited copy apart from a failed launcher write.

**Commit message:** `079: a save reaches every installation, and Care sees drift`

**Verification:**
- `npm run typecheck` — clean.
- `npm run build` — succeeds.
- `npm test` — 3262/3262 passing across 159 files.
- `npm run ui:verify` — 68/68 screenshots, 0 axe violations (run against a fresh `ui:seed`).
- `npm run ui:flow raw-save-cascades` / `external-edit-cascades` / `care-drift-sync-now` — all OK
  (each requires a freshly-seeded fixture — `rawEditingMode` only allows typing while the profile's
  structured state is clean, which `ui:verify` leaves dirty; documented in each flow's own header).
- Clean-agent review (`story-review-hard`): verdict **PASS**. Confirmed/plausible findings fixed in
  a review-fix cycle (re-verified green afterward): a correctness regression in
  `canonicalWriteAllowed` that could strand a clean-but-not-render-fixed-point profile's canonical
  file at a stale path after a rename (extracted into `moveCanonicalProfileFile` in the new
  `canonical.ts`, gated on the file's own move-allowed predicate); a stale `sync.test.ts` helper
  that validated a rule no longer in production; three `switchBindFor` loader-chain tests lost when
  the legacy write path was deleted, re-covered against the current `syncProfile` write path.
- AC → test mapping, as verified:
  - AC1 → e2e `raw-save-cascades.mjs`; unit `index.test.ts` › `saveRawText` cascade — pass.
  - AC2 → e2e `external-edit-cascades.mjs`; unit `index.test.ts` › `refreshFromFiles`/"take the
    file" cascades — pass.
  - AC3 → unit `sync.test.ts` › "writes a running installation exactly like a stopped one";
    `index.test.ts` running-game save; `care-sync.test.ts` — pass. **Manual residue** (as planned):
    a real Quake II engine `exec`-ing the new content needs a real engine process the harness does
    not have.
  - AC4 → unit `round-trip.test.ts` byte-exact over all 042 fixtures; `file-source-pipeline.test.ts`
    inSync-without-a-save + duplicate/empty-tag minting — pass.
  - AC5 → e2e `care-drift-sync-now.mjs` badge-before-Care step; unit `useFileSourceRefresh.test.ts`
    — pass.
  - AC6 → unit `care-summary.test.ts`; e2e badge step — pass.
  - AC7 → e2e "Sync now rewrites the copy and clears the row"; unit `index.test.ts` backup-once —
    pass.
  - AC8 → e2e wording step; unit `care-items.test.ts` — pass.
  - AC9 → unit `index.test.ts` dirty-profile-never-leaks assertions on the raw-save cascade and
    Sync now (D8); existing 043 dirty-profile tests unchanged and still green (D2) — pass.
  - AC10 → **manual residue** (as planned): reviewed by the clean agent against
    `docs/systems/config-module.md`'s diff; prose, no automated test applies.
- **Deliberately unfixed review notes** (none block acceptance, none are load-bearing for an AC):
  - `use-drift-state.ts`'s fetch-on-refresh wiring has no direct unit test beyond the hook-contract
    spy and the e2e flow's integration coverage — the e2e flow is the AC5 acceptance test by design.
  - The story's D2 plan said `canonicalWriteAllowed` would stay untouched; the review-fix cycle
    touched it to fix F1. Recorded here since the plan's claim turned out inaccurate, not because
    the change itself is in question — it was reviewed and re-verified.
  - The Care badge (AC6) and a profile's own Files-item count in Care can disagree by one row for a
    dirty-but-otherwise-synced profile (the canonical `unsavedChanges` row is excluded from the
    badge but still listed in Care) — the Unsaved tab already signals that state, so this is not a
    missing signal, just an uncounted duplicate.
  - `sync.ts`'s `launchState` field on `SyncProfileDeps` has no reader left in the file; left in
    place rather than risking an unrelated signature change this late in the review-fix cycle.
  - `use-care-sync.ts`'s `syncNow` doesn't surface a toast when a publish is refused because the
    canonical file moved underneath mid-run (rare race, same "never publish stale bytes" rule as
    everywhere else in this story) — the row simply stays drifted rather than silently clearing.
  - AC9's dirty-sibling assertion exists for the raw-save cascade and Sync now; the AC2 adopt
    cascade and the running-installation write share the exact same `installationCopySource`
    predicate but weren't each given their own dirty-sibling test.
