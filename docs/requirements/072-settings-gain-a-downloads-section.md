---
id: 072
title: Settings learn to host a module's own section, starting with Downloads
status: ready
created: 2026-09-08
---

## Requirement

The downloads module needs three settings of its own (concurrency limit, archive-cache budget,
download-while-playing), but `LauncherSettings` is a closed shape and "a feature is a module —
never edit the shell" forbids editing the Settings view for every module that needs a value. This
story resolves that once: the Settings view learns to render sections contributed by modules,
and the downloads module is the first to use it. The mechanism is meant to be reused by mods and
assets later, per [concepts/install-module.md §12](../concepts/install-module.md).

## Acceptance Criteria

- [ ] **AC1** — The Settings view renders a section contributed by the downloads module,
      alongside the existing shell-owned sections, without `LauncherSettings` gaining any
      downloads-specific fields.
- [ ] **AC2** — The section offers a concurrent-jobs limit, an archive-cache budget, and a
      download-while-playing toggle.
- [ ] **AC3** — The section shows the current archive-cache size.
- [ ] **AC4** — Clearing the cache states what will be deleted (size, item count) before the
      user confirms.
- [ ] **AC5** — When the cache exceeds its budget, the oldest archives are evicted first; an
      archive belonging to a running job is never evicted.
- [ ] **AC6** — The module's settings values, the archive cache location, and the mechanism for
      module-contributed sections all persist across an app restart.

## Open Questions

- ~~Default and allowed range for the concurrent-jobs setting...~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Concurrent-jobs setting: default 2, allowed range 1–4. Archive-cache budget:
  default 5GB. Download-while-playing: allowed by default.
- **Mechanism shape:** `RendererModule` (`src/renderer/src/modules/index.ts`) gains an optional
  `settingsSection: { titleKey, order, Section }`; the shell wraps every contributed section in its
  own `Panel` + `SectionLabel` chrome and the module supplies only the inner content — a module
  cannot then drift away from the shell's section look, and mods/assets reuse it verbatim.
- **`View` becomes optional** on `RendererModule` so `downloads` can be listed for its settings
  section while its route still falls back to `PlannedModuleView`; [[073]] fills the `View` in.
- **`MODULE_MANIFESTS`' `status` for `downloads` stays `planned`** — this story gives the module
  settings, not a tab, and flipping the status early would promise a surface that isn't there.
- **Placement:** contributed sections render after the shell's Library section and before About,
  sorted by `order` then module id — About stays the last, diagnostic block it is today.
- **Persistence:** an own top-level `downloadsSettings` key in `state.json` with per-field
  `.catch()` defaults (the `configProfiles` precedent, concept §4), not a generic
  `Record<string, unknown>` module bucket — that keeps the defensive typed parse in the state layer
  instead of pushing validation into every module's read path.
- **Both numeric settings are `Select`s** (concurrency 1–4, budget 1/2/5/10/20 GB) — reuses the
  existing control, makes an out-of-range value unrepresentable in the UI, and needs no new numeric
  input component.
- **Cache location** is `<userData>/cache/downloads/` behind a new `downloadsCacheDir()` in
  `src/main/lib/paths.ts` (concept §4); a cache is files, never `state.json`.
- **Eviction protects `*.part` files and anything an injected `isInUse(fileName)` predicate
  reports** — this story wires an always-false provider, [[071]]/[[074]] supply the real per-job
  claims, so AC5's guarantee is testable now and correct later.
- **Overlap with [[071]]/[[073]] is handled idempotently:** if `src/shared/modules/downloads.ts` or
  `src/main/modules/downloads/index.ts` already exist when this story is built, extend them instead
  of replacing them — the sprint's build order puts [[071]] first but this story must stand alone.
- **AC6's restart proof is boot-side + disk-side in one flow:** the populated fixture seeds
  non-default `downloadsSettings`, the flow asserts the app renders those at startup and that a UI
  change lands in the fixture's `state.json` — `withApp()` (`scripts/lib/harness.mjs:380`) asserts
  the app is still alive at the end, so a flow cannot close and relaunch the app itself.
- **Budget enforcement runs when the budget is lowered and after a clear**; a periodic sweeper is
  out of scope — the post-download sweep call site belongs to [[071]]/[[074]].
- **`clearCache` deletes only evictable entries** (never `*.part`, never in-use) and reports
  exactly what it removed, so AC4's stated size/count and the actual deletion cannot disagree.
- **Strings are i18n keys** under `module.downloads.settings.*` in
  `src/renderer/src/i18n/locales/en.json`; main returns numbers and keys, never prose.

## Plan

Triage: **clear and ready** — no ceremony beyond the plan below.

1. **Shell seam (renderer only).** `RendererModule` gains `settingsSection?` and an optional
   `View`; `AppShell.resolveView` falls back to `PlannedModuleView` when a listed module has no
   `View`; `SettingsView` maps the registry between its Library and About panels.
2. **Contract.** `src/shared/modules/downloads.ts`: `DOWNLOADS_HANDLERS`
   (`getSettings`/`patchSettings`/`cacheStatus`/`clearCache`), `DownloadsSettings`,
   `DEFAULT_DOWNLOADS_SETTINGS` (2 / 5 GB / true), the 1–4 bound, the budget choices,
   `ArchiveCacheStatus`, `ClearArchiveCacheResult`.
3. **State slot.** `downloadsSettingsSchema` + `parseDownloadsSettings` in
   `src/main/lib/schemas.ts`, key + getter/setter in `src/main/services/state.ts` — mirroring
   `configProfiles` end to end.
4. **Cache.** `downloadsCacheDir()` in `paths.ts`; `src/main/modules/downloads/cache.ts` with a
   pure `planEviction({ entries, budgetBytes, isInUse })` core plus a thin fs wrapper for
   `status()`, `enforceBudget()`, `clear()`.
5. **Main module.** `src/main/modules/downloads/index.ts` (+ `schemas.ts`), registered in
   `src/main/modules/index.ts`; `patchSettings` validates, persists, and enforces the budget when
   it was lowered.
6. **Renderer section.** `src/renderer/src/modules/downloads/{client.ts,DownloadsSettingsSection.tsx}`
   with the three controls, the live cache size (`formatBytes`) and a `Modal` confirm that names
   size + item count; registered in the renderer module registry.
7. **Acceptance surface.** Fixture seeds non-default settings and two dummy archives; a screens
   entry for the confirm dialog; `scripts/flows/settings-downloads-section.mjs` walks the story.

Order: D1 → D2 → D3 → D4 → D5 → D6. D1 and D2 are independent of each other.

## Deliverables

- **D1 — Settings hosts module-contributed sections.**
  `src/renderer/src/modules/index.ts` (optional `View`, new `settingsSection`),
  `src/renderer/src/components/shell/AppShell.tsx` (`resolveView` fallback when `View` is absent),
  `src/renderer/src/views/SettingsView.tsx` (render the registry's sections in `Panel` +
  `SectionLabel`, sorted, with `data-testid="settings-section-<moduleId>"`),
  `src/renderer/src/i18n/locales/en.json`.
  Plus its test in `src/renderer/src/views/SettingsView.test.tsx` (jsdom; mirror
  `src/renderer/src/modules/config/CreateProfileDialog.test.tsx` for the jsdom docblock + render
  style). Accepted when a stub module's section renders with its heading between Library and About,
  the shell's own sections are unchanged, and a module without a `View` still routes to
  `PlannedModuleView`.
- **D2 — The downloads contract and its persisted settings slot.**
  New `src/shared/modules/downloads.ts`; `src/main/lib/schemas.ts` (`downloadsSettingsSchema`,
  `parseDownloadsSettings`, per-field `.catch()`); `src/main/services/state.ts` (`downloadsSettings`
  key, default, parse, getter, setter) — mirror `configProfiles` at `state.ts:26/80/105/133/171`.
  Plus its tests in `src/shared/modules/downloads.test.ts` (defaults; the downloads keys are absent
  from `DEFAULT_SETTINGS`) and `src/main/services/state.test.ts` (write → reload round trip, garbage
  field falls back to its default). Accepted when a state.json written by the setter reads back
  identically on a fresh store and a corrupt field costs only that field.
- **D3 — The archive cache: size, clear, budget eviction.**
  `src/main/lib/paths.ts` (`downloadsCacheDir()`), new `src/main/modules/downloads/cache.ts` (pure
  `planEviction` + `status`/`enforceBudget`/`clear`).
  Plus its test in `src/main/modules/downloads/cache.test.ts`: status sums bytes and counts items;
  eviction removes oldest-by-mtime first and stops at the budget; an `isInUse` entry and any
  `*.part` are never removed; `clear` returns the bytes/count it actually deleted.
- **D4 — The downloads main module.**
  New `src/main/modules/downloads/index.ts` + `src/main/modules/downloads/schemas.ts`,
  registered in `src/main/modules/index.ts:15` — mirror `src/main/modules/library/index.ts` for the
  `MainModule` shape and `src/main/modules/config/schemas.ts` for the payload schemas.
  Plus its test in `src/main/modules/downloads/index.test.ts`: `getSettings` answers the persisted
  values, `patchSettings` rejects a concurrency outside 1–4 and an unlisted budget, a lowered budget
  triggers eviction, `clearCache` reports what it removed.
- **D5 — The Downloads settings section in the UI.**
  New `src/renderer/src/modules/downloads/client.ts` (over `callModule`, mirror
  `src/renderer/src/modules/library/client.ts`) and
  `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx`; registration in
  `src/renderer/src/modules/index.ts`; keys in `src/renderer/src/i18n/locales/en.json`.
  Plus its test in `src/renderer/src/modules/downloads/DownloadsSettingsSection.test.tsx` (jsdom,
  stubbed client): the three controls render the current values, and the clear confirm names the
  size and the item count before anything is called.
- **D6 — Acceptance surface: fixture, screen, flow.**
  `scripts/lib/fixture.mjs` (populated variant: non-default `downloadsSettings`, two dummy archives
  with distinct sizes/mtimes under `userdata/cache/downloads`), `scripts/lib/screens.mjs` (a screen
  for the clear-cache confirm dialog), new `scripts/flows/settings-downloads-section.mjs` — mirror
  `scripts/flows/raw-inline-edit.mjs` for the on-disk assertion idiom.
  Accepted when `npm run ui:flow -- settings-downloads-section` passes and `npm run ui:verify`
  stays clean (no new axe violations, no console errors, no network).

## Model Hints

- `D3 → deliverable-hard` — it is the only code in the story that deletes files inside the user's
  data directory, and the two carve-outs (`*.part`, in-use) plus oldest-first ordering are exactly
  the kind of off-by-one that a green build hides until it eats a running download's archive.
- `Review: → story-review-hard` — the story simultaneously opens the shell's first
  module-contributed UI seam (which every later module inherits) and lands destructive filesystem
  code, and a regression in either is invisible in passing tests.
- D1, D2, D4, D5, D6 → default tier.

## Acceptance Tests

- AC1 → e2e `npm run ui:flow -- settings-downloads-section` › "the Downloads section renders in
  Settings between Library and About", plus unit `src/renderer/src/views/SettingsView.test.tsx` ›
  "a module's contributed section renders in the shell's chrome" and
  `src/shared/modules/downloads.test.ts` › "downloads settings live outside LauncherSettings".
- AC2 → e2e `npm run ui:flow -- settings-downloads-section` › "concurrency, cache budget and
  download-while-playing can each be changed", plus unit
  `src/main/modules/downloads/index.test.ts` › "patchSettings refuses a value outside the allowed
  range".
- AC3 → e2e `npm run ui:flow -- settings-downloads-section` › "the section shows the seeded cache
  size", plus unit `src/main/modules/downloads/cache.test.ts` › "status sums size and item count".
- AC4 → e2e `npm run ui:flow -- settings-downloads-section` › "clearing the cache names size and
  item count before it is confirmed", plus unit
  `src/renderer/src/modules/downloads/DownloadsSettingsSection.test.tsx` › "the clear confirm names
  what will be deleted".
- AC5 → unit `src/main/modules/downloads/cache.test.ts` › "eviction removes the oldest archives
  first" and › "an archive in use by a running job is never evicted" (no user action involved —
  `test` is the right level), plus `src/main/modules/downloads/index.test.ts` › "lowering the budget
  evicts down to it".
- AC6 → e2e `npm run ui:flow -- settings-downloads-section` › "the values persisted in state.json
  are the ones the app started with, and a change lands back on disk" (boot-side: the flow asserts
  the section renders the fixture's non-default persisted values; disk-side: it asserts the changed
  values in `.ui-verify/fixture/populated/userdata/state.json`), plus unit
  `src/main/services/state.test.ts` › "downloads settings survive a reload" and
  `src/main/modules/downloads/cache.test.ts` › "the cache lives under userData/cache/downloads".

No manual residue.

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D1 (+ D5 registers the section) | flow + `SettingsView.test.tsx` + `downloads.test.ts` |
| AC2 | D2 (contract), D4 (validation), D5 (controls) | flow + `index.test.ts` |
| AC3 | D3, D5 | flow + `cache.test.ts` |
| AC4 | D3 (figures), D5 (confirm) | flow + `DownloadsSettingsSection.test.tsx` |
| AC5 | D3, D4 | `cache.test.ts` + `index.test.ts` |
| AC6 | D2, D3, D6 | flow + `state.test.ts` + `cache.test.ts` |

## Done
