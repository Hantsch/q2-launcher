---
id: 130
title: a locked feature does not exist
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

"Nobody asks for something they don't see" (concept §13.6) — a locked experimental feature has to
render **nothing**: no tab, no menu entry, no greyed-out row, no tooltip hinting it exists. This
story is that enforcement contract, general enough that [[128]]'s verified-code state is the only
input it needs and [[132]]'s watchlist tab is simply its first caller, not something baked into the
mechanism itself.

The repo already has a real example of the shape this needs, checked directly rather than
paraphrased: `DEV_ONLY_CHANNELS` in `src/shared/ipc.ts` is a plain array of invoke channels, and
`registerDevIpc()` in `src/main/ipc/dev.ts` is the only place that registers handlers for them —
called from `registerAllIpc()` in `src/main/ipc/index.ts` only `if (app.isDev || ...)`. Critically,
the boot-time completeness check (`assertContractFullyHandled` in the same file) does not treat an
unregistered dev-only channel as a bug when the build isn't a dev build — it excuses exactly those
channels, by name, from the "declared but not handled" failure. That is the shape the concept means
by "in the same spirit" (§13.7): a declarative gate, checked once, whose handlers are conditionally
registered, with the contract-completeness check already knowing how to excuse a channel that is
deliberately not registered in this build — instead of that check either being blind to gated
channels or failing the build every time a feature is locked.

The renderer hiding a tab is presentation, never the boundary (§13.7) — the same "paths from the
renderer are never trusted" reasoning CLAUDE.md already applies to filesystem paths applies here to
feature flags: a compromised or simply modified renderer must not be able to reach a locked
feature's functionality by calling its IPC channel directly. The decision of what is unlocked is
made once, in main, from [[128]]'s verified token state, and the renderer only ever finds out the
answer, never decides it.

This story builds the general mechanism only. [[131]] and [[132]] (the watchlist) are its first and
currently only consumer — the design has to hold up for a second future feature without anyone
having to duplicate the gate logic, but no second feature needs to exist yet to prove that.

## Acceptance Criteria

- [ ] **AC1** — With no valid unlock code present, a gated feature's UI surface (tab, menu entry or
      route) does not render at all — not present in the DOM, not shown disabled.
- [ ] **AC2** — With no valid unlock code present, that feature's main-process IPC handlers are not
      registered at all, so a direct IPC call from a compromised or modified renderer receives "no
      handler for this channel", never a permission-denied response.
- [ ] **AC3** — The unlocked/locked decision is made in main from [[128]]'s verified token state; no
      code path lets the renderer's own choice not to render stand in for that check.
- [ ] **AC4** — The gate is keyed by feature name, not hardcoded to `watchlist`. A test declares a
      test-only feature name through the same declaration and gets the same behaviour: its surface
      and handlers are absent when locked and present when unlocked, with no gate code specific to
      that name.

## Open Questions

None open.

## Decisions (Sprint)

- **Gate at the module seam, not in `shell` IPC.** Gated handlers are declared through
  `ModuleSetup.handle(type, schema, handler, { feature })`. When the feature is locked,
  `MainModuleRegistry` never stores the handler, so `module:invoke` answers exactly as it does
  for a type that never existed (`modules.error.notImplemented`). Reason: the concept routes all
  game-browser IPC, including "watchlist CRUD (gated)", through `module:invoke` (concept
  §Integration/IPC), modules must not edit the shell, and a shell-level `GATED_CHANNELS` list
  would have no consumer. That keeps the `DEV_ONLY_CHANNELS` idea (declared, conditionally
  registered, absence is the answer) where the gated handlers actually live.
- **"No handler" means the same answer as an unknown handler type.** AC2's "no handler for this
  channel" is read as a response byte-for-byte equal to invoking a type that was never
  registered. Reason: any different response, even a neutral one, would reveal that the feature
  exists.
- **The decision is made once per app start.** The gate is built in `createAppContext` after
  `state.load()` and before `registerModules`, and then frozen. A code redeemed mid-session
  takes effect at the next start. Reason: "not registered" is a boot-time fact, the same as
  `DEV_ONLY_CHANNELS`, and 128 AC5 already re-verifies on every start. [[129]]'s copy has to tell
  the user to restart.
- **Only 128's re-verification feeds the gate.** The gate's input is the union of `features`
  over every stored token that 128's boot-time verification accepts, so a feature whose expiry
  has passed is already dropped by 128 AC7. The gate never reads a persisted feature list.
  Reason: AC3. A stored "unlocked features" array would be renderer- or user-editable state
  standing in for the check.
- **The renderer learns the answer through one read-only channel, `features:getUnlocked`**
  (`void` payload → `string[]`), loaded in the store's `bootstrap`. It is deliberately not a
  field on `AppInfo`. Reason: it is launcher-level unlock state rather than build info, and
  about five test fixtures build `AppInfo` literals. No channel takes a feature decision from
  the renderer.
- **A feature name is a plain string (`FeatureName` in `src/shared/features.ts`), not a closed
  union.** Reason: AC4 needs a test-only name to use the same declaration with no cast, and
  unknown names inside a token are harmless.
- **`MainModuleRegistry`'s gate parameter is optional and defaults to "nothing unlocked".**
  Reason: failing closed means the existing `new MainModuleRegistry()` test call sites keep
  compiling, and a forgotten wiring hides a feature instead of leaking it.
- **`<FeatureGate feature>` is the only renderer entry point for a gated surface.** Reason:
  [[129]] AC4 wants the gate, not the feature, to supply the "experimental" marking, so [[129]]
  adds it inside `FeatureGate`'s unlocked branch and nothing else changes.
- **No e2e flow in this story.** No criterion describes a user action, and a test-only feature
  must not ship a real surface. The first real-surface e2e for the gate is [[132]] AC6.

## Plan

Public shape (what [[129]]/[[132]] build on):

- main: `app.features.isFeatureUnlocked(name): boolean` and `app.features.unlockedFeatures():
  FeatureName[]` on `AppContext`. Modules gate a handler with
  `handle(type, schema, handler, { feature: 'watchlist' })`.
- IPC: `features:getUnlocked` (void → `FeatureName[]`).
- renderer: `useFeatureUnlocked(name): boolean` plus `<FeatureGate feature="…">children</FeatureGate>`,
  which renders `null` when locked (no placeholder, no disabled state, no tooltip).

Order:

1. **D1 (main core):** `src/shared/features.ts` (`FeatureName`). `src/main/features/gate.ts`
   provides `createFeatureGate(names)`, a frozen set, and `resolveFeatureGate(...)`, which builds
   it from 128's boot-time verification of the stored token(s). The registry takes the gate and
   skips gated handlers of a locked feature. `context.ts` builds the gate before
   `registerModules` and exposes it as `AppContext.features`.
2. **D2 (IPC):** `features:getUnlocked` in the contract plus schema plus a registrar in
   `registerAllIpc`.
3. **D3 (renderer):** `unlockedFeatures` in `useLauncher` (loaded in `bootstrap`, no setter),
   the `useFeatureUnlocked` hook and the `FeatureGate` component.

Each D carries its own tests, and every test uses the test-only name `test-only-feature`. No
file mentions `watchlist` except as an example in a doc comment. The shell views are not touched.

## Deliverables

- **D1 — main-side gate + gated module handlers.** Files:
  - new `src/shared/features.ts`: `export type FeatureName = string`, with a doc comment.
  - new `src/main/features/gate.ts`: `interface FeatureGate { isFeatureUnlocked(name): boolean;
    unlockedFeatures(): FeatureName[] }`.
    - `createFeatureGate(names: Iterable<FeatureName>)` copies the names into a private `Set`
      at construction. There is no mutator.
    - `LOCKED_FEATURE_GATE` is an empty gate.
    - `resolveFeatureGate(...)` takes the stored token(s) from `StateStore` and 128's
      verification (read 128's `## Done` and use its exported boot-time re-verification
      function). It unions the `features` of every accepted token, and a rejected token
      contributes nothing.
    - This is the **only** input to the gate. Never read a persisted feature list.
  - new `src/main/features/gate.test.ts`.
  - `src/main/modules/types.ts`: `ModuleSetup.handle` gets an optional 4th parameter
    `options?: { feature?: FeatureName }`, with a doc comment that a locked feature's handler is
    never registered.
  - `src/main/modules/registry.ts`: the constructor takes `features: FeatureGate =
    LOCKED_FEATURE_GATE`. Inside `setup.handle`, if `options?.feature` is set and
    `!features.isFeatureUnlocked(options.feature)`, do not store the handler and log at debug
    level only. `invoke()` is unchanged, so the answer equals an unknown type's.
  - `src/main/modules/registry.test.ts`: add cases. Mirror the existing `fakeAppContext()` style.
  - `src/main/context.ts`: after `state.load()`, `const features = resolveFeatureGate(...)`. Add
    `features: FeatureGate` to `AppContext` and pass it via `new MainModuleRegistry(features)`.
  - Tests:
    - `gate.test.ts`: a token signed by a throwaway key pair that 128's verifier accepts unlocks
      its features.
    - `gate.test.ts`: a tampered, wrong-installation or expired token unlocks nothing.
    - `gate.test.ts`: `createFeatureGate` does not alias the input iterable, so mutating the
      source afterwards changes nothing.
    - `registry.test.ts`: a locked `test-only-feature` handler's `invoke` result `toEqual`s the
      result of invoking a type that was never registered (same key and params shape), and the
      handler is never called.
    - `registry.test.ts`: unlocked, the same handler answers `ok(...)`.
    - `registry.test.ts`: an ungated handler in the same module works in both cases.
- **D2 — `features:getUnlocked` channel.** Files:
  - `src/shared/ipc.ts`: add `'features:getUnlocked': { req: void; res: FeatureName[] }` and add
    it to `INVOKE_CHANNELS`. Mirror `'app:getInfo'`.
  - `src/shared/ipc-schemas.ts`: add `featuresGetUnlockedSchema = z.void()`. Mirror
    `appGetInfoSchema`.
  - new `src/main/ipc/features.ts`: `registerFeaturesIpc(app)`, which calls
    `handle('features:getUnlocked', schema, () => app.features.unlockedFeatures())`. Mirror
    `src/main/ipc/modules.ts`.
  - `src/main/ipc/index.ts`: call it in `registerAllIpc`, unconditionally.
  - new `src/main/ipc/features.test.ts`: mirror how `src/main/ipc/app.test.ts` mocks `ipcMain`.
  - Any IPC contract/coverage test that lists channels.
  - The preload allowlist derives on its own. Do not edit preload.
  - Tests: the handler returns exactly the gate's list, and a non-void payload is rejected (the
    handler throws, per `handle`).
- **D3 — renderer gate.** Files:
  - `src/renderer/src/store/useLauncher.ts`: add `unlockedFeatures: FeatureName[]` (initially
    `[]`). Add `invoke('features:getUnlocked')` to `bootstrap`'s `Promise.all` and store its
    result, treating a non-array as `[]`. Add **no** action that sets it.
  - new `src/renderer/src/components/features/FeatureGate.tsx`: `useFeatureUnlocked(name)`
    reads the store, and `FeatureGate({ feature, children })` returns `null` when locked and
    `children` when unlocked. Add a doc comment that [[129]] adds the experimental marking here.
  - new `src/renderer/src/components/features/FeatureGate.test.tsx`: mirror the store-seeding
    style of `src/renderer/src/components/shell/NavJobBadge.test.tsx`.
  - Fix any renderer test whose `bootstrap` invoke mock now misses the channel.
  - Tests, with `test-only-feature` wrapping a tab button:
    - Locked: `queryByRole('tab')` is null, and the container holds no gated text, no
      `aria-disabled` and no `title`.
    - Unlocked: the tab is present.
    - Before `bootstrap` resolves, the feature is locked.

## Model Hints

- D1 → deliverable-hard. Every module handler registration in the app goes through
  `MainModuleRegistry`. A wrong condition either leaks a locked feature's handler or silently
  drops ungated handlers in every module, and the gate's input has to be adapted to 128's
  just-built verification API without drifting to a stored feature list.
- D2, D3 → default.
- Review: → story-review-hard. The plausible wrong implementation is a gate fed from a persisted
  "unlocked features" value, or a renderer-writable one, instead of 128's re-verification (or a
  renderer-side store setter). Every unit test injects the gate, so it would pass them and a
  default review. That makes AC3 a structural negative claim that only a reading of the wiring in
  `context.ts` can confirm.

## Acceptance Tests

- AC1 → unit `src/renderer/src/components/features/FeatureGate.test.tsx` › "a locked feature's
  surface is absent from the DOM, not rendered disabled"
- AC2 → unit `src/main/modules/registry.test.ts` › "a locked feature's handler answers exactly
  like a handler that was never registered"
- AC3 → unit `src/main/features/gate.test.ts` › "only a token main's verifier accepts unlocks a
  feature" + unit `src/main/ipc/features.test.ts` › "features:getUnlocked takes no payload and
  returns the gate main built" + unit `src/renderer/src/components/features/FeatureGate.test.tsx`
  › "before bootstrap resolves the feature is locked"
- AC4 → unit `src/main/modules/registry.test.ts` › "a test-only feature name is gated with no
  name-specific code, absent when locked and present when unlocked" + unit
  `src/renderer/src/components/features/FeatureGate.test.tsx` › "a test-only feature renders when
  unlocked"
- No e2e: no criterion is a user action. The gate's first real-surface e2e is [[132]] AC6
  (watchlist absent without a code).

Coverage gate: AC1 → D3 · AC2 → D1 · AC3 → D1 + D2 + D3 · AC4 → D1 + D3.

## Done

<!-- Filled by `/build 130`. -->
