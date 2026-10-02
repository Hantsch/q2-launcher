---
id: 218
title: the config detail screen reads its profile from a provider
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a new config tab to read the selected profile, its draft, `patch` and
the installations from one provider instead of accepting and forwarding a four-prop contract,
and I want the profile list to live in one store, so that a rename from the dashboard tile or the
address-book dialog is visible in an open Config view without a remount and `ConfigView` can
shrink to layout.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F40):
`src/renderer/src/modules/config/ConfigView.tsx` is 1,067 lines with 13 `useState`, 6 `useEffect`
and a 450-line `return` mounting 11 surfaces; `profile`/`draft`/`patch`/`onChanged` are props of
SettingsTab, ControlsTab and AliasesTab and `profile`/`onChanged` of eight more; `installations`
is re-read from `useLauncher` in two tabs; an `activeProfile` helper papers over `draft ?? selected`.
`listConfigProfiles` is fetched independently in `ConfigView`, `ConfigProfilesTile` and
`AddToAddressBookDialog` with no shared store, while replays already has Zustand stores for the
same kind of state and `useProfileChanges()` proves context works here.

Depends on stories 212 (save hook) and 215 (query hook).

## Acceptance Criteria

- [ ] **AC1** — `lib/ProfileDraftProvider.tsx` exposes
      `useProfileDraftContext(): { profile, draft, patch, installations, save }` and is mounted
      once around the detail screen; the three main tabs and the eight panels read from it; no
      tab declares `profile`/`draft`/`patch`/`onChanged` props (grep-zero in the module).
- [ ] **AC2** — A small Zustand `useConfigProfiles` store (`load`, `replaceAll`, `upsert`,
      `remove`) is the only reader of `listConfigProfiles`; `ConfigView`, `ConfigProfilesTile`
      and `AddToAddressBookDialog` subscribe to it; a renamed profile in the tile is reflected in
      an open Config view (component test).
- [ ] **AC3** — `ConfigDetailHeader`, `ConfigTabStrip` (on story 216's `Tabs` if it has landed)
      and the list screen are their own components; `ConfigView.tsx` is under 350 lines.
- [ ] **AC4** — The config header geometry flow (`config-header-geometry`) and every config flow
      pass.

## Open Questions

- [ ] **Q1** — Does the store also own the selected profile id (today in `useLauncher`'s route
      focus) or only the list?

## Plan

<!-- Filled by /refine 218. -->

## Deliverables

<!-- Filled by /refine 218. -->

## Model Hints

<!-- Filled by /refine 218. -->

## Acceptance Tests

<!-- Filled by /refine 218. -->

## Done

<!-- Filled by /build 218. -->
