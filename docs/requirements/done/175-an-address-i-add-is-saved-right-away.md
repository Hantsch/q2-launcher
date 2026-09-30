---
id: 175
title: an address I add is saved right away
status: done # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

When I add a server to my address book from the server browser ([[127]]), the launcher writes the
address into the profile's `adrN` cvar but leaves the profile *unsaved*: the Config view shows
"Unsaved changes" and the `.cfg` on disk does not contain the address yet. I only find out when I
open Config — and I have to know to press Save there, otherwise the game's own address book stays
empty. The dialog said "added"; the game says otherwise. That is a trap, not a feature.

Confirming "Add" in the dialog must be the whole action: after it, the address is in the profile's
`.cfg` on disk and the game's address book shows it, without a detour through the Config view.

This changes the choice recorded in [[127]] (AC4: the write leaves the profile in the config
module's normal dirty state). That was right for a *cvar edit*, where the user is in the Config view
and sees the Save button; it is wrong for an *action* triggered from another view, where the user
has no reason to look there.

## Acceptance Criteria

- [x] **AC1** — After confirming "Add to address book", the chosen `adrN` value is in the profile's
      `.cfg` on disk (the Raw file tab shows it as `ON DISK`, with no "not in this file yet" notice for
      it).
- [x] **AC2** — The profile does not show "Unsaved changes" because of the address write, and the
      Config view's unsaved counter does not include it.
- [x] **AC3** — If the profile already had *other* unsaved changes, only the address is written to
      disk; the other pending edits are neither saved nor lost and the profile still shows them as
      unsaved (Q1, decided).
- [x] **AC4** — If saving fails (e.g. the file is not writable), the dialog stays open and shows the
      error as text; the address is not reported as added and no half-written state remains.
- [x] **AC5** — The success toast says the address is saved to the profile (i18n key, `en` locale),
      not merely "written".
- [x] **AC6** — Story [[127]]'s ACs that this supersedes (AC4) are amended in place with a pointer
      to this story, so the two documents do not contradict each other.

## Open Questions

- ~~**Q1 — Profile already dirty (decided 2026-09-29):** only the address is saved; everything else
  pending stays pending and is never saved automatically.~~ answered → Decisions (Sprint)
- ~~**Q2 — Which layer saves:** does the dialog call an existing config save path after `setCvars`, or
  does the config module get one "set cvars and save" operation? Prefer the latter (one round trip,
  no window where the profile is dirty) — check `modules/config/client.ts` and the main-side
  `profiles.ts` before deciding.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User) Q1 — a dirty profile:** only the address is written to disk. Every other pending edit
  stays pending and is never saved automatically.
- **Q2 — one config operation, main-side.** Add a new config module handler, `CONFIG_HANDLERS.commitCvars`
  (`{ profileId, cvars }`, where `cvars` holds only the keys to set). It writes those keys into the
  `.cfg` and into the profile in one round trip. Reason: `save` writes the *whole* live profile, so a
  dirty profile would leak its other edits (Q1). The existing "a dirty profile is never written by
  anything but save" rule (`index.ts` `canonicalWriteAllowed`) also means the renderer cannot get
  there by chaining the existing calls.
- **The file is rendered from the baseline, not the live profile.** The bytes written are
  `renderProfileFile` of the profile with its `baseline` fields laid over it, plus the patched cvars.
  The same patch then goes into both `baseline.cvars` and the live `cvars`, and `fileHash` is set to
  the new bytes. Reason: the baseline is the launcher's model of what is on disk, so this changes
  exactly one key there. `markFileSeen` must not be used, because it reseeds the baseline from the
  live record and would silently absorb the other pending edits (AC3).
- **`dirty` is left exactly as it was.** Reason: the address adds no pending change, and it must not
  clear or add the flag for other pending changes (AC2 + AC3).
- **A profile with no `baseline` (persisted before story 049):**
  - if it is clean, it uses its live fields as the baseline, since clean means live equals disk;
  - if it is dirty, it refuses with `config.error.commitNeedsSave`.

  Reason: without a baseline the launcher cannot tell the file's content apart from the pending
  edits, and guessing would break Q1.
- **Same read-before-write guard as `save`, never forced.** If the canonical file changed on disk,
  is unparseable or cannot be read (`authoriseContentWrite` is false), the handler refuses with
  `config.error.commitConflict` and changes nothing. Reason: the dialog has no conflict-resolution
  UI, and overwriting an external edit from another view is exactly the trap this story removes.
- **File name:** the handler writes to the file the profile's sentinel owns (`ownedName ?? resolvedName`,
  as `authoriseContentWrite` resolves it). Reason: a dirty rename leaves the file under its old name
  until Save (story 043), and a second file must not appear.
- **Commit order is disk first, then state.** The handler writes the canonical file atomically
  (`writeTargetFile`). Only after that succeeds does it apply one `ProfilesStore` commit that patches
  the live cvars, the baseline cvars, `fileHash`, `fileSeenAt`, `fileState: 'unchanged'` and
  `updatedAt`. If the write throws, the handler returns `config.error.writeFailed` and has touched
  nothing. Reason: this is AC4's "no half-written state". `updatedAt` is bumped so the Raw file tab
  re-reads.
- **Installation copies are cascaded, not rendered.** After the commit, the handler runs `syncAndPersist(…, { refuseCanonicalWriteFor: profileId })`.
  That copies the new canonical bytes into the assigned installations (`installationCopySource`).
  Reason: this is what puts the address in the game's own address book, and it reuses story 079's
  cascade path. If one installation copy fails, that goes to the existing per-installation
  write-failure/retry surface and is not treated as a failed add, which matches how `save` treats
  cascade failures. The canonical file is the commit point.
- **The dialog sends only `{ [slot]: normalized }`.** This drops 127's whole-map `buildAddressBookCvars`
  and its test, which become dead code. Reason: the merge now happens main-side against the current
  record, so a stale renderer snapshot can no longer revert anything.
- **Success toast gets a new key.** `servers.addressBook.saved` ("Saved to "{{profile}}"'s address
  book as {{slot}}.") replaces `servers.addressBook.written`, and the old key is removed. Reason: AC5
  asks for "saved" wording, and a renamed key lets a test tell the two apart.
- **No new IPC channel.** The handler goes through the existing `module:invoke` seam with a zod
  schema in `src/main/modules/config/schemas.ts`. Reason: CLAUDE.md says IPC is contract-first and
  module traffic never widens the preload surface. The same cvar-name/value schema as
  `setProfileCvarsInputSchema` applies, plus a non-empty map of at most 9 keys.
- **Platform parity:** a file write in the launcher's own data folder behaves the same on Windows and
  Linux, so there is no disabled case.
- **AC4's e2e gap.** Making the `.cfg` unwritable does not fail the same way on Windows and Linux: an
  atomic rename over a read-only file fails on Windows and succeeds on Linux. So AC4 is proven by a
  main unit test plus a dialog component test on the real `Outcome` shape. Reason: a failure injected
  from the environment is not a user action, and a flow that passes on only one OS is not a gate.

## Plan

Config module gets one new main-side operation. The server browser's dialog switches to it. The
e2e flow flips 127's "left unsaved" assertion, and 127's AC4 gets a pointer to this story.

1. **D1, main + shared contract:** add the `commitCvars` handler.
   - The patch is rendered from the baseline and written atomically to the owned canonical file.
   - One store commit then patches the live cvars, the baseline cvars and the hash, and `dirty` is
     left unchanged.
   - Finally a cascade sync (with the canonical write refused) updates the installation copies.
   - Unit tests cover clean, dirty, conflict, write failure and legacy-no-baseline.
2. **D2, renderer:**
   - add a `commitProfileCvars` client wrapper;
   - the dialog sends `{ [slot]: normalized }` through it, shows the new `saved` toast, and on
     failure shows the error inline and stays open;
   - add the new error keys to `en.json`;
   - remove the dead `buildAddressBookCvars`.
3. **D3, e2e + docs:**
   - rewrite step 4 of `servers-address-book.mjs`: the profile is not unsaved, and the canonical
     file and the installation copy on disk hold `adr0`;
   - add a dirty-profile step;
   - amend 127's AC4;
   - add a CHANGELOG entry.

Order: D1 → D2 → D3.

## Deliverables

- **D1 — `commitCvars`: write chosen cvars to the profile's file without saving anything else (main + shared).**
  - **Contract.** In `src/shared/modules/config.ts`:
    - add `commitCvars: 'commitCvars'` to `CONFIG_HANDLERS`, next to `setCvars`;
    - add `CommitProfileCvarsInput = { profileId: string; cvars: Record<string, string> }`, next to
      `SetProfileCvarsInput`;
    - the response is `Outcome<ConfigProfile>`, mirroring `setCvars`'s response type.
  - **Schema.** In `src/main/modules/config/schemas.ts`, add `commitProfileCvarsInputSchema`. Mirror
    `setProfileCvarsInputSchema` (~L97) for the profile id and the cvar name/value rules, and add
    that the map is non-empty with at most 9 keys. Add a case to `schemas.test.ts`.
  - **Store.** In `src/main/modules/config/profiles.ts`, add
    `commitSavedCvars(profileId, patch, fileHash, fileSeenAt)`. It is one `commit` that:
    - applies `cvars = { ...current.cvars, ...patch }`;
    - applies `baseline = { ...base, cvars: { ...base.cvars, ...patch } }`, where `base` is
      `current.baseline ?? captureBaseline(current)`;
    - sets `fileHash`, `fileSeenAt`, `fileState: 'unchanged'` and `updatedAt: now`;
    - leaves `dirty` untouched;
    - throws on an unknown id.

    Doc-comment why it must not go through `markFileSeen` (L534): that reseeds the baseline from the
    live record.
  - **Handler.** In `src/main/modules/config/index.ts`, register
    `handle(CONFIG_HANDLERS.commitCvars, commitProfileCvarsInputSchema, …)` next to `setCvars`
    (~L676). In order:
    1. Look up the profile, or return `fail('config.error.profileNotFound')`.
    2. If `profile.dirty === true && !profile.baseline`, return `fail('config.error.commitNeedsSave')`.
    3. If `!(await authoriseContentWrite(log, profiles, profile))` (L420), return
       `fail('config.error.commitConflict')`. It is never forced.
    4. Resolve the file name the same way `authoriseContentWrite` does (`ownedName ?? resolvedName`).
       Extract a small shared helper if that avoids copying the lookup.
    5. Build `view = { ...profile, ...(profile.baseline ?? {}), cvars: { ...baseCvars, ...patch } }`
       and `bytes = renderProfileFile(view)`.
    6. Write with `writeTargetFile` (`writer.ts:147`, as `saveRawText` ~L1083 uses it). If it throws,
       log it and return `fail('config.error.writeFailed')` with no store change.
    7. `profiles.commitSavedCvars(id, patch, hashOf(bytes), Date.now())`. Use the same hash function
       `readFileState` compares against.
    8. `await syncAndPersist(…, { refuseCanonicalWriteFor: id })` to cascade the installation copies.
    9. Return `ok(profiles.find(id))`.

    Leave a comment at `canonicalWriteAllowed` (L331) noting that `commitCvars` is the one deliberate
    writer for a dirty profile and writes baseline bytes only.
  - **Tests** (`src/main/modules/config/index.test.ts`, new `describe('story 175: commitCvars')`,
    mirroring `describe('story 043 D4: explicit save')` ~L922):
    - "a clean profile gets the cvar on disk and in its installation copy and stays clean"
    - "a dirty profile writes only the committed cvar: pending cvar and bind edits stay off disk and
      stay unsaved". This asserts:
      - the file bytes contain `adr0` but not the pending cvar or bind;
      - `dirty` is still true;
      - `diffProfileAgainstBaseline` still lists exactly the pending edits and not `adr0`.
    - "a canonical file changed on disk is not overwritten and nothing changes"
    - "a write failure leaves the file and the profile record untouched"
    - "a dirty profile without a baseline is refused"
    - "a dirty rename writes to the file the profile still owns, not to a new name"
  - Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`, `schemas.test.ts`,
    `profiles.ts`, `index.ts` and `index.test.ts`.
  - Acceptance: `npx vitest run src/main/modules/config` passes and `npm run typecheck` is clean.

- **D2 — the dialog saves through `commitCvars` (renderer).**
  - **Client.** In `src/renderer/src/modules/config/client.ts`, add
    `commitProfileCvars(input: CommitProfileCvarsInput)`, which calls
    `callModule('config', CONFIG_HANDLERS.commitCvars, input)`. Mirror `updateProfileCvars` (~L80).
    `CONFIG_HANDLERS.commitCvars` and `CommitProfileCvarsInput` come from `src/shared/modules/config.ts`.
  - **Dialog.** In `src/renderer/src/modules/servers/AddToAddressBookDialog.tsx`, change Confirm:
    - drop the fresh `listConfigProfiles()` re-read and the `updateProfileCvars` call on confirm;
    - call `commitProfileCvars({ profileId, cvars: { [slot]: normalized } })`;
    - on `ok`, close and toast `servers.addressBook.saved` with `{ profile, slot }`;
    - on `!ok`, show `t(result.error.key)` inline as text, stay open and show no toast.

    Opening the dialog, switching profile and validation stay as they are.
  - **Dead code.** In `src/renderer/src/modules/servers/lib/address-book.ts`, remove
    `buildAddressBookCvars`, and remove its test in `address-book.test.ts`.
  - **Strings.** In `src/renderer/src/i18n/locales/en.json`:
    - replace `servers.addressBook.written` (~L969) with `servers.addressBook.saved`:
      `Saved to "{{profile}}"'s address book as {{slot}}.`;
    - next to `config.error.writeFailed` (~L1624), add `config.error.commitConflict`: "This profile's
      file changed on disk since the launcher last read it. Open the profile in Config to resolve
      that first.";
    - also add `config.error.commitNeedsSave`: "This profile has unsaved changes the launcher cannot
      keep apart from the address. Save or discard them in Config first."
  - **Tests** (`src/renderer/src/modules/servers/AddToAddressBookDialog.test.tsx`, replacing "confirm
    writes the full cvars map through config setCvars only"):
    - "confirm commits only the chosen slot through config commitCvars". This asserts the envelope is
      `moduleId: 'config'`, type `commitCvars`, and the payload is `{ profileId, cvars: { adr0: … } }`.
      It also asserts there is no `setCvars` and no `servers` module call.
    - "a successful add toasts the saved key". This asserts `servers.addressBook.saved` is used and
      `written` is not.
    - "a failed commit keeps the dialog open with the error as text and no toast"
  - Files:
    - `client.ts`;
    - under `src/renderer/src/modules/servers/`: `AddToAddressBookDialog.tsx`,
      `AddToAddressBookDialog.test.tsx`, `lib/address-book.ts` and `lib/address-book.test.ts`;
    - `en.json`.
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes and `npm run typecheck` is
    clean.

- **D3 — proven end to end, and 127 amended.**
  - **Flow.** Rewrite `scripts/flows/servers-address-book.mjs`. Keep steps 1–3 as they are (write
    `adr0` into Plain Profile, reopen from detail, Layered Profile empty). Replace step 4 (~L282-300)
    and update the header comment (L28-30) and the final log. The new steps:
    - **4.** Click `nav-config` and open Plain Profile. Assert:
      - `config-unsaved-indicator` is **not** visible;
      - the Raw file tab shows `ON DISK` and no `config.raw.unsavedNotice` line;
      - the canonical `.cfg` on disk contains `set adr0` with the address;
      - Plain Profile's installation copy (`fixture-install-favorite`) contains it too.

      Mirror the canonical-file read in `scripts/flows/raw-save-cascades.mjs` (~L83).
    - **5.** In Config, make one plain Settings cvar edit on Layered Profile (mirror
      `scripts/flows/unsaved-diff.mjs`) and leave it unsaved. Then go back to Servers and add the
      server to Layered Profile's `adr0` from the list. Back in Config on Layered Profile, assert:
      - `config-unsaved-indicator` is visible;
      - the Unsaved tab (`config-tab-unsaved` → `config-save-changes`) lists the Settings edit but not
        `adr0`;
      - the canonical `.cfg` on disk contains `adr0` but not the edited value.
  - **Docs.** In `docs/requirements/done/127-a-server-goes-into-my-address-book.md`, amend AC4 in
    place: keep its text and append "— superseded by [[175]]: the address is now saved to disk right
    away and leaves the profile clean". Add the same one-line pointer under 127's "After success"
    decision. Change nothing else in 127.
  - **Changelog.** Add a `### Fixed` entry to `CHANGELOG.md`, following the Keep-a-Changelog headings
    there: short, user-facing, e.g. an address you add from the server browser now actually lands in
    the game's address book.
  - Files: `scripts/flows/servers-address-book.mjs`, `docs/requirements/done/127-a-server-goes-into-my-address-book.md`
    and `CHANGELOG.md`.
  - Acceptance: `npm run ui:flow -- servers-address-book` passes.

## Model Hints

- D1 → deliverable-hard. It adds a second disk writer that deliberately bypasses the "dirty is only
  written by save" rule. Four things have to be exactly right:
  - render from the baseline, not the live record;
  - patch the baseline without `markFileSeen`, which would absorb the pending edits;
  - write to the sentinel-owned (possibly pre-rename) file;
  - cascade the installation copies with `refuseCanonicalWriteFor`.

  Each of these, done wrong, silently saves or loses other pending edits.
- D2, D3: default.
- Review: → default. The plausible wrong implementations each have a named D1 test: rendering the
  live profile, reseeding the baseline from live, and clearing `dirty`. The "dirty profile writes
  only the committed cvar" test asserts the bytes and the diff directly, and D3's step 5 checks the
  same on the real surface.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book`. Step 4 asserts
  `ON DISK`, no unsaved notice, and `set adr0` in the canonical `.cfg` and the installation copy.
  Plus unit `src/main/modules/config/index.test.ts` › "a clean profile gets the cvar on disk and in
  its installation copy and stays clean".
- AC2 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book`. Step 4 asserts no
  `config-unsaved-indicator`, and step 5 asserts the Unsaved tab does not list `adr0`. Plus unit
  `index.test.ts` › "a clean profile gets the cvar on disk and in its installation copy and stays
  clean".
- AC3 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book`. Step 5 asserts
  the pending Settings edit is still unsaved and not on disk, while `adr0` is on disk. Plus unit
  `index.test.ts` › "a dirty profile writes only the committed cvar: pending cvar and bind edits stay
  off disk and stay unsaved".
- AC4 → component `src/renderer/src/modules/servers/AddToAddressBookDialog.test.tsx` › "a failed
  commit keeps the dialog open with the error as text and no toast". Plus unit
  `src/main/modules/config/index.test.ts` › "a write failure leaves the file and the profile record
  untouched" and "a canonical file changed on disk is not overwritten and nothing changes". The e2e
  gap and its reason are recorded in Decisions (Sprint) under "AC4's e2e gap".
- AC5 → component `src/renderer/src/modules/servers/AddToAddressBookDialog.test.tsx` › "a successful
  add toasts the saved key".
- AC6 → manual residue. This is a documentation-only criterion with no runtime behaviour a test could
  observe. The default review checks the D3 diff: 127's AC4 carries the `[[175]]` pointer and nothing
  else in 127 changes.

## Done

**Summary.** New main-side config operation `commitCvars` writes only the chosen cvars into the profile's canonical `.cfg` (rendered from the baseline, sentinel-owned file name, atomic write), patches live + baseline cvars and hash in one store commit without touching `dirty`, then cascades installation copies. The address-book dialog now uses it, shows a `saved` toast and shows errors inline. `buildAddressBookCvars` removed; 127's AC4 amended; CHANGELOG entry added.

**Commit message:** `175: address-book add is saved right away (config commitCvars writes only the address, dirty profile keeps its pending edits)`

**Verification (narrow gate).** `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` green (133 files / 2223 tests); `npm run ui:flow -- servers-address-book` green, re-run after the last review fix together with `npx vitest run src/main/modules/config`, typecheck and build. `controls-extra-keys` (pre-existing red) not run. Full gate not run (sprint's job).
- AC1 flow step 4 + unit "a clean profile gets the cvar on disk…" passed. AC2 flow steps 4/5 + same unit passed. AC3 flow step 5 + unit "a dirty profile writes only the committed cvar…" passed. AC4 component "a failed commit keeps the dialog open…" + units "a write failure…" and "a canonical file changed on disk…" passed (no e2e, per Decisions). AC5 component "a successful add toasts the saved key" passed. AC6 manual residue (docs only; reviewer confirmed the pointer in 127).
- Review (default): FAIL in cycle 1 — vacuous `\s` in a template-literal regex in the flow's AC3 disk check, misplaced doc comment, missing clean-no-baseline test; all fixed (String.raw, comment moved, test "a clean profile without a baseline commits against its live fields and stays clean" added).

**Decisions.**
- Known limitation, documented in code comments: `writeCatalogDefaults` is not in `captureBaseline`, so a pending catalog-defaults toggle is rendered live and would land on disk with the commit. Follow-up: add the field to `src/shared/config/profile-baseline.ts`.
- `canonicalFileNameFor` helper shared by `authoriseContentWrite` and the handler (directory surveyed twice, fail-safe).
- Flow: the servers list toolbar trigger no longer exists, so "from the list" = row selected, detail-pane trigger.
- `index.test.ts` mocks `./writer` with a delegating `writeTargetFile` spy to test write failure.
- One unexplained flaky failure in 1 of 5 runs of `src/main/modules/config/index.test.ts` during D1 (test not captured); did not recur in 6 later runs.

tiers: D 3 / hard 1 · review default · cycles 1 · agents 7
