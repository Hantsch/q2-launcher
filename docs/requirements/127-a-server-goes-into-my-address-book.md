---
id: 127
title: a server goes into my address book
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Quake II's own multiplayer menu reads nine cvars, `adr0` through `adr8`, as its address book — a
mechanism that exists in the engine independently of this launcher and works whether or not the
launcher's own history or favourites ([[113]]) are ever consulted. A user who wants a server to show
up there, the way the game itself expects, needs a way to write one of those nine slots without
hand-editing a config file.

In this app, `adr0`–`adr8` are ordinary, non-catalogue cvars: the config module already round-trips
any cvar a profile's `.cfg` carries, catalogued or not, and an uncatalogued one like `adr0` lands in
the settings view's "Other" group today (confirmed against `CVAR_OTHER_GROUP_ID` in
`src/renderer/src/modules/config/lib/cvar-rows.ts`). Nothing about writing `adr0`–`adr8` needs new
config-module machinery — it needs a dialog that makes the write deliberate.

That deliberateness is the actual point of this story: writing directly into one of nine slots by
address is easy to get wrong (which slot? was it already in use?), so the action opens a dialog
showing every config profile (active one preselected) and the current value of all nine slots before
anything is written — an overwrite is something the user sees and chooses, not something that
happens to whatever slot 0 happened to be.

The write itself goes through the config module's own existing cvar-write path — the concept's
architecture note is explicit that "the game browser does not touch profile files itself" (§16
Config). Using that same path is also what makes the write behave like any other cvar edit: it marks
the profile dirty and leaves it exactly where the config module's own save/sync/care machinery
already expects an edited-but-unsaved profile to be, rather than inventing a second,
game-browser-owned notion of "this profile changed."

## Acceptance Criteria

- [ ] **AC1** — The "Add to address book" action (available from the list ([[118]]) and the detail
      view ([[122]]), per concept §9 item 7) opens a dialog listing every config profile, with the
      active profile preselected.
- [ ] **AC2** — The dialog shows the current value of all nine `adr0`–`adr8` slots for the selected
      profile before any write happens, so an empty vs. occupied slot is visibly distinguishable.
- [ ] **AC3** — Confirming a chosen slot writes the server's address into that profile's `adr<N>`
      cvar through the config module's existing `setCvars` write path (`CONFIG_HANDLERS.setCvars` /
      `module:invoke` under the `config` module's `module:config` namespace) — the game browser
      contract has no cvar-write handler of its own for this.
- [ ] **AC4** — After the write, the profile shows exactly the same dirty/unsaved-changes state the
      config module already shows for a manual cvar edit made in the Settings tab — no separate
      "written by the game browser" state exists.
- [ ] **AC5** — Switching the selected profile in the dialog re-reads and re-displays that profile's
      own nine slot values before a write is confirmed, rather than showing stale values from a
      previously selected profile.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **"Active profile" is the active installation's default profile.** The launcher has no global
  "active config profile". The preselection is the profile whose `assignments` holds
  `{ installationId: settings.activeInstallationId, isDefault: true }`, and otherwise the first
  profile in `listConfigProfiles()` order. The active installation is what the rest of the launcher,
  125's join included, already acts on.
- **The write is a whole-map `setCvars` built from a fresh read.** `setCvars` replaces the entire
  `cvars` map (`profiles.ts:233`). So on confirm the dialog re-runs `listConfigProfiles()`, takes the
  chosen profile's current `cvars`, and sends `{ profileId, cvars: { ...fresh.cvars, adrN: address } }`
  with no `cvarSections`. That is the same payload shape the Settings tab's own plain edit sends
  (`SettingsTab.tsx:296`). Sending only `{ adrN }`, or a snapshot taken when the dialog opened, would
  silently wipe or revert the profile's other cvars.
- **No new IPC, no servers-module handler.** The renderer calls the config module's existing typed
  client (`updateProfileCvars` / `listConfigProfiles` from `modules/config/client.ts`), following the
  cross-module precedent `home/dashboard/ConfigProfilesTile.tsx:6`. AC3 forbids a game-browser
  cvar-write handler, and this also overrides the concept §16 list's "address-book write" handler.
- **The value written is `parseServerAddress(address).normalized`.** If the parse fails, Confirm is
  disabled and the rejection reason shows as text (`serverAddressRejectionKey`). The value ends up as
  a `set adrN` line in a `.cfg`, so a value with quotes or `;` must never get that far, and 107's
  validator is the one address rule the app has.
- **Slot preselection:** preselect the slot that already holds this address. Otherwise preselect the
  lowest empty slot. If every slot is occupied, preselect nothing, so the user has to pick one. An
  overwrite then stays a visible choice (Requirement: "not something that happens to whatever slot 0
  happened to be").
- **Occupied vs. empty is text, not colour.** An empty slot reads "Empty". An occupied slot shows its
  value. Choosing an occupied slot shows a visible "Replaces <value>" line. This follows the
  design-tokens rule that status is never colour-only.
- **Zero profiles:** the action stays visible. The dialog states that no config profile exists and
  Confirm is disabled. No silent omission.
- **Triggers.** In the list, the action is a toolbar button that acts on the selected row, beside
  the existing "Refresh this server" (`servers-refresh-selected`). It is disabled with a visible
  hint when no row is selected. In the detail view it is a button in the view's action area. Reason:
  118's row is one full-width `<button>`, so a nested button is invalid, and a selection-scoped
  toolbar action already exists. If [[125]] has already built a shared server-actions cluster by build
  time, the button joins that cluster instead.
- **After success** the dialog closes and a success toast names the profile and slot. The profile's
  unsaved state is left to the config module (AC4). The dialog adds no badge of its own.
- **No `ui:verify` registry entry.** The e2e flow's `shot` covers the dialog visually. The list and
  detail registry screens belong to [[121]]/[[122]], and no AC asks for one here.
- **Platform parity:** nothing here is platform-specific (a cvar write into launcher state), so there
  is no disabled-on-Linux case.

## Plan

Renderer only, inside `src/renderer/src/modules/servers/`. No contract, no main, no preload change.

1. **D1 — pure logic plus the dialog.**
   - `lib/address-book.ts`: slot reading (`adr0`–`adr8` from a profile's `cvars`), active-profile
     pick, slot preselection, and the whole-map cvars builder.
   - `AddToAddressBookDialog.tsx` on `Modal`: a profile `Select` and a nine-slot radio list, with a
     fresh `listConfigProfiles()` read on open and on every profile switch, and another fresh read
     plus `updateProfileCvars` on confirm.
   - Unit and component tests, and the `servers.addressBook.*` strings.
2. **D2 — triggers and e2e.**
   - Mount the dialog from the list toolbar (selected row) and from the detail view.
   - Add a new flow `scripts/flows/servers-address-book.mjs` (loopback responder, fresh fixture
     variant) that writes into Plain Profile, reopens the dialog to see the slot occupied, switches
     to Layered Profile to see its empty slots, then goes to Config and finds the profile unsaved with
     `adr0` in its change list.

Order: D1 → D2. Build after [[122]] (the detail view D2 mounts into) and [[125]] (so the button joins
its action placement).

## Deliverables

- **D1 — address-book logic and dialog (renderer).**
  - Create `src/renderer/src/modules/servers/lib/address-book.ts` (pure, no React), with colocated
    `address-book.test.ts`:
    - `ADDRESS_BOOK_SLOTS = ['adr0', …, 'adr8'] as const`.
    - `readAddressBookSlots(cvars: Record<string,string>): Array<{ slot, value: string | undefined }>`.
      A missing key, or a value that is empty or whitespace-only, is `undefined`, meaning empty.
    - `pickPreselectedProfileId(profiles: ConfigProfile[], activeInstallationId: string | null): string | undefined`.
      Return the profile with an assignment `{ installationId: activeInstallationId, isDefault: true }`,
      otherwise `profiles[0]?.id`.
    - `pickPreselectedSlot(slots, address): slot | undefined`. Return the slot whose value equals the
      address. Otherwise return the lowest empty slot. Otherwise return `undefined`.
    - `buildAddressBookCvars(currentCvars, slot, address): Record<string,string>`, which returns
      `{ ...currentCvars, [slot]: address }` as a new object. The input is never mutated.
  - Create `src/renderer/src/modules/servers/AddToAddressBookDialog.tsx` with props
    `{ open, address, onClose }`, built on `components/ui/Modal.tsx`. Mirror
    `components/installations/SetInstallationIconDialog.tsx` for the dialog shape and
    `home/dashboard/ConfigProfilesTile.tsx:6` for importing `listConfigProfiles` /
    `updateProfileCvars` from `../config/client`.
    - **On open:** call `listConfigProfiles()` and preselect via `pickPreselectedProfileId`, reading
      `activeInstallationId` from `useLauncher((s) => s.settings.activeInstallationId)`.
    - **Profile choice:** a profile `Select` (testid `servers-address-book-profile`) listing every
      profile by name.
    - **Profile switch (AC5):** call `listConfigProfiles()` again and render that profile's slots
      from the new result. While the read is in flight, show a loading line, not the previous
      profile's values.
    - **Slot list:** nine radio rows, testid `servers-address-book-slot-<n>`. Each shows `adr<n>` and
      either its value or the text "Empty" (`servers.addressBook.slotEmpty`). The preselected slot
      comes from `pickPreselectedSlot`. Choosing an occupied slot shows
      `servers.addressBook.replaces` ("Replaces {{value}}").
    - **Address validation:** run `parseServerAddress(address)` from `@shared/servers/address`.
      - On success, write `.normalized`.
      - On failure, disable Confirm and show `t(serverAddressRejectionKey(reason))` as text.
    - **Confirm** (testid `servers-address-book-confirm`): call `listConfigProfiles()` again, find
      the chosen profile, and call `updateProfileCvars({ profileId, cvars: buildAddressBookCvars(fresh.cvars, slot, normalized) })`.
      Send no `cvarSections`.
      - On `ok`, close and show a success toast (`servers.addressBook.written`, with profile and
        slot).
      - On `!ok`, show `t(result.error.key)` inline and stay open.
      - Confirm is disabled when there is no profile, no slot or an invalid address.
    - **Zero profiles:** show `servers.addressBook.noProfiles` and disable Confirm.
  - Add `servers.addressBook.*` keys to `src/renderer/src/i18n/locales/en.json` under the top-level
    `servers` block: `action`, `title`, `description`, `profileLabel`, `slotLabel`, `slotEmpty`,
    `replaces`, `confirm`, `cancel`, `noProfiles`, `loading`, `written`, `noSelection`.
  - Files: `lib/address-book.ts`, `lib/address-book.test.ts`, `AddToAddressBookDialog.tsx`,
    `AddToAddressBookDialog.test.tsx` (all under `src/renderer/src/modules/servers/`), and `en.json`.
  - Mirror for the component test's mocked `callModule`:
    `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx`.
  - Tests:
    - `address-book.test.ts` › "an absent or blank adr slot reads as empty".
    - `address-book.test.ts` › "the active installation's default profile is preselected, else the
      first".
    - `address-book.test.ts` › "the slot already holding the address wins, then the lowest empty
      slot, then none".
    - `address-book.test.ts` › "the written cvars keep every other cvar and do not mutate the input".
    - `AddToAddressBookDialog.test.tsx` › "lists every profile with the active one preselected".
    - `AddToAddressBookDialog.test.tsx` › "shows all nine slots with empty and occupied told apart in
      text".
    - `AddToAddressBookDialog.test.tsx` › "switching profile re-reads and shows that profile's own
      slots". This one asserts a second `list` call and no stale value on screen.
    - `AddToAddressBookDialog.test.tsx` › "confirm writes the full cvars map through config setCvars
      only". It asserts:
      - the envelope is `moduleId: 'config'`, type `setCvars`;
      - the payload keeps the profile's other cvars as they stand at the fresh read;
      - no `servers` module call is made.
    - `AddToAddressBookDialog.test.tsx` › "an address that fails validation cannot be written".
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes and `npm run typecheck` is
    clean.

- **D2 — the action on both surfaces, proven end to end.**
  - **List:** in `src/renderer/src/modules/servers/ServersView.tsx`, add a toolbar button
    `servers-address-book-open` next to `servers-refresh-selected`. It opens
    `AddToAddressBookDialog` for the selected row's `address`. With no selection it is disabled and
    shows `servers.addressBook.noSelection` as visible text, the same way `servers-refresh-selected-hint`
    does.
  - **Detail view:** add the same button, testid `servers-detail-address-book-open`, in the action or
    header area of the detail view component story 122 created under
    `src/renderer/src/modules/servers/`. If story 125 already placed a Join button in a shared action
    cluster on the list and detail surfaces, put the button in that cluster instead, keeping these
    testids.
  - Create the flow `scripts/flows/servers-address-book.mjs`, mirroring
    `scripts/flows/servers-scoped-refresh.mjs`: `variant`, `setup`/`teardown`, one `bindResponder`
    loopback server, `writePopulatedFixture` with `SERVERS_DISABLED_SOURCES`, the server as a manual
    server, and auto-scan off. The populated fixture's active installation is `fixture-install-favorite`,
    whose default profile is "Plain Profile". The steps:
    1. Open Servers, click `servers-refresh`, select the row, and open the dialog from the list.
       Assert "Plain Profile" is preselected and all nine slots show "Empty".
    2. Confirm `adr0`. Reopen the dialog from the detail view and assert `adr0` shows the address.
    3. Switch to "Layered Profile" and assert its `adr0` shows "Empty".
    4. Cancel, click `nav-config`, and open Plain Profile. Assert `config-unsaved-indicator` is
       visible and that the Unsaved tab (`config-tab-unsaved` → `config-save-changes`) lists `adr0`.
       This is the same surface `scripts/flows/unsaved-diff.mjs` uses for a manual edit.
  - Files: `ServersView.tsx`, `ServersView.test.tsx`, the 122 detail-view component, `en.json` (if a
    key is missing), and `scripts/flows/servers-address-book.mjs`.
  - Tests: `ServersView.test.tsx` › "the address-book action is disabled with a visible reason until
    a row is selected".
  - Acceptance: `npm run ui:flow -- servers-address-book` passes, and so do
    `npx vitest run src/renderer/src/modules/servers` and `npm run typecheck`.

## Model Hints

- No `deliverable-hard`. Both Ds are renderer-only, on existing primitives and an existing write
  path. The one real trap, the whole-map `setCvars` replace, is pinned by D1's named test.
- Review: → default. The plausible wrong write, sending only `{ adrN }` or a stale snapshot, is
  caught by D1's "keeps every other cvar" test. The "no servers handler" claim is asserted in the
  same test, so a default review plus the tests suffices.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book` (step 1 opens the
  dialog from the list, step 2 from the detail view, and Plain Profile is preselected); plus component
  `src/renderer/src/modules/servers/AddToAddressBookDialog.test.tsx` › "lists every profile with the
  active one preselected".
- AC2 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book` (all nine slots
  "Empty" before the write, `adr0` shows the address after it); plus component
  `AddToAddressBookDialog.test.tsx` › "shows all nine slots with empty and occupied told apart in text".
- AC3 → component `src/renderer/src/modules/servers/AddToAddressBookDialog.test.tsx` › "confirm writes
  the full cvars map through config setCvars only"; plus unit
  `src/renderer/src/modules/servers/lib/address-book.test.ts` › "the written cvars keep every other
  cvar and do not mutate the input".
- AC4 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book` (step 4: Plain
  Profile shows `config-unsaved-indicator`, and the Unsaved tab lists `adr0` the way it lists a
  manual Settings edit).
- AC5 → e2e `scripts/flows/servers-address-book.mjs` › flow `servers-address-book` (step 3: after
  Plain Profile got `adr0`, switching to Layered Profile shows its `adr0` as "Empty"); plus component
  `AddToAddressBookDialog.test.tsx` › "switching profile re-reads and shows that profile's own slots".

## Done

<!-- Filled by `/build 127`. -->
