---
id: 135
title: a demos module exists with its own nav entry
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user opens the launcher and sees a **"Demos"** entry in the primary navigation, at the same level
as Library, Config and Servers — one place for every demo they have. Today that place does not
exist; the demo browser concept (`docs/concepts/demo-browser.md`) describes everything it will
eventually do, but nothing is registered with the app yet.

This story is the foundation only, the same way [[106]] was for the servers module: a module that
exists, is reachable, has its own IPC namespace, settings slot and i18n block — so every later demo
story has a home to land in rather than create.

Naming is decided in the concept (§3): the UI says **"Demos"**, the code and module id say
**`replays`**, because "demo" already means the shareware installation and the UI fixture data in
this repo. The module will write sidecars, renames and temporary copies into installation folders
and run a scan, so beyond the `game-lifecycle` capability the concept names (§14) it probably also
needs `mutates-installation` and `long-running-jobs` — refine confirms (Q1).

## Acceptance Criteria

- [x] **AC1** — A `replays` module is registered per the 5-step checklist in
      [ARCHITECTURE.md#adding-a-module](../../ARCHITECTURE.md#adding-a-module): a shared contract file
      under `src/shared/modules/`, the `ModuleId` entry **and** the hardcoded `moduleId` z.enum in
      `src/shared/ipc-schemas.ts`, a `MODULE_MANIFESTS` row, a main half under
      `src/main/modules/replays/` and a renderer half — with no edit to any shell file.
- [x] **AC2** — The manifest's `nav` is `{ section: 'primary', order: … }`; the nav label reads
      "Demos" and clicking it routes to the module's (placeholder) view.
- [x] **AC3** — The manifest declares exactly the capabilities decided in Q1.
- [x] **AC4** — The module's `ipcNamespace` (`module:replays`) is owned by this module the same way
      every other module's namespace is (a handler registered outside it is rejected).
- [x] **AC5** — The renderer module contributes a `settingsSection` that renders in the Settings
      view, even though it shows no controls yet — the slot [[140]] and [[142]] fill.
- [x] **AC6** — A top-level `replays` block exists in `src/renderer/src/i18n/locales/en.json`; every
      string this story shows comes from it.
- [x] **AC7** — Every `module:invoke` handler for `replays` — in this and every later demo story — is
      backed by a module-local zod schema before it is implemented, and the renderer never sends a
      filesystem path to open, play or edit a demo: it names a demo by an id main resolved itself
      (concept §14 "Paths"). Restated here as binding for every later demo story.

## Open Questions

- [x] ~~**Q1 — Capabilities.** `game-lifecycle` only (concept §14), or also `mutates-installation`
      (sidecars, rename, temp copies inside installation folders) and `long-running-jobs` (scan)?~~
      decided by refine → Decisions (Sprint)
- [x] ~~**Q2 — Nav order and icon** (concept open point §17.16): where "Demos" sits relative to
      Servers, and which inline-SVG icon it uses.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Nav placement: "Demos" sits right after Servers in the primary nav (the two
  "find something to play" entries stay adjacent); refine designs a simple inline-SVG icon
  matching the existing nav style — no specific motif required.
- **Q1: capabilities are exactly `['mutates-installation', 'game-lifecycle']`** — sidecars (§8.1),
  renames and the `<gamedir>/demos/_launcher/` temp copies (§11.2) write inside installation
  folders, and playback needs the game process's start/stop; `long-running-jobs` is not declared
  because §14 makes scan progress a pushed `module:event` (the `servers` scan precedent, which also
  declares no jobs) rather than a `JobsService` job in the action bar; no `network` because v1 has
  no remote source.
- **Nav order `25`** — the only integer slot between `servers` (20) and `config` (30), which is what
  the (User) placement "right after Servers" means in `MODULE_MANIFESTS`.
- **Icon: lucide-react `Film`, one map entry in `src/renderer/src/components/shell/moduleIcons.tsx`**
  — every existing nav icon is a lucide inline-SVG component resolved through that map, so a lucide
  icon _is_ "the existing nav style"; the map entry is a data row, not shell logic (story 106's
  `Globe` precedent), and is the only file outside the module's own paths this story touches besides
  the ones AC1 names.
- **`status: 'planned'`, no `View` in `RENDERER_MODULES`; the route renders the shell's
  `PlannedModuleView`** — that fallback is the documented placeholder for a registered module
  without a view (story 106 precedent), and the later list story swaps a real view in without
  touching the manifest.
- **All of this story's i18n keys live under the top-level `replays` block** (`replays.module.title`
  / `.description`, `replays.planned.intro` / `.highlight.1–3`, `replays.settings.title` /
  `.description` / `.placeholder`) — AC6 requires it, and manifest keys are free-form strings (no
  code assumes `module.<id>.*`); shell-owned chrome around them (e.g. `PlannedModuleView`'s own
  labels) is not this story's text.
- **`requiresInstallation: false`** — extra folders (concept §2/§14) hold demos with no installation
  registered; only Play needs one, and that is a later story's concern.
- **One handler: `overview.read` → `{ scanning: false, demoCount: 0 }`** — the module needs one real
  declared handler so the schema discipline (AC7) and the namespace (AC4) are exercised end to end
  through the registry; it is the one read on the §14 list that needs no entity shape a later story
  owns.
- **Zod schemas beside the handler names in `src/shared/modules/replays.ts`** — the `servers.ts` /
  `home.ts` precedent, so contract-first is one file to read.
- **AC7's "no renderer path" is enforced by a guard test over `REPLAYS_HANDLER_SCHEMAS`** — it walks
  every payload schema and fails on `absolutePathSchema` or a string field whose key matches
  `/path|dir|folder|file/i`, unless the handler is on an exported allowlist
  (`REPLAYS_PATH_PAYLOAD_HANDLERS`, empty now; concept §14 permits only "add extra folder" from a
  native dialog), so every later demo story hits the rule mechanically instead of by review.
- **Settings section `order: 25`** — mirrors the nav position, after `servers` (20).
- **No new IPC channel** — the module rides `module:invoke` / `module:event`; `src/shared/ipc.ts`
  and the preload allowlist stay untouched (only the `moduleId` z.enum in `ipc-schemas.ts` grows).
- **CHANGELOG** — a new primary nav entry is user-facing: one line under `## Unreleased → ### Added`.

## Plan

Five-step module registration per [ARCHITECTURE.md#adding-a-module](../../ARCHITECTURE.md#adding-a-module),
bottom-up, one layer per deliverable — the story 106 (`servers`) shape. No shell logic, no new IPC
channel, no platform branch.

1. **Shared** (D1) — `src/shared/modules/replays.ts`: `REPLAYS_HANDLERS = { overviewRead:
'overview.read' }`, `replaysNoInputSchema`, `replaysOverviewSchema` + `ReplaysOverview`,
   `REPLAYS_HANDLER_SCHEMAS`, `REPLAYS_PATH_PAYLOAD_HANDLERS = []`. `src/shared/types/module.ts`:
   `'replays'` in `ModuleId` + manifest row. `src/shared/ipc-schemas.ts`: `'replays'` in the
   `moduleId` z.enum. Tests: manifest row, capabilities, schema-per-handler, no-path guard.
2. **Main** (D2) — `src/main/modules/replays/index.ts` registering `overview.read` (zeroed answer);
   one entry in `src/main/modules/index.ts`. No filesystem, no state.
3. **Renderer** (D3) — `RENDERER_MODULES` entry with `settingsSection` only; typed client;
   `ReplaysSettingsSection.tsx` placeholder; `Film` in `moduleIcons.tsx`; the `replays` block in
   `en.json`; the `replays-module-shell` flow; the CHANGELOG line.

Order: D1 → D2 → D3 (D3's flow needs D2 registered, or the nav entry reports a missing main half).

## Deliverables

- **D1 — shared contract, manifest row, moduleId enum, and their tests.** Files:
  `src/shared/modules/replays.ts` (new, mirror `src/shared/modules/servers.ts`'s
  `SERVERS_HANDLERS` / `SERVERS_HANDLER_SCHEMAS` shape, or the smaller `src/shared/modules/home.ts`),
  `src/shared/modules/replays.test.ts` (new, mirror `src/shared/modules/servers.test.ts`),
  `src/shared/types/module.ts` (edit), `src/shared/types/module.test.ts` (edit: add a `replays`
  describe block next to the servers one), `src/shared/ipc-schemas.ts` (edit: add `'replays'` to the
  hardcoded `moduleId` z.enum — `src/shared/ipc-schemas.test.ts` › "accepts exactly the module ids
  known to MODULE_MANIFESTS" fails until you do).
  Contract: `REPLAYS_HANDLERS = { overviewRead: 'overview.read' } as const`; `replaysNoInputSchema`
  (`z.void()`, as servers/home); `replaysOverviewSchema = z.object({ scanning: z.boolean(),
demoCount: z.number().int().nonnegative() })` + `ReplaysOverview`; `REPLAYS_HANDLER_SCHEMAS` keyed
  by handler name; `REPLAYS_PATH_PAYLOAD_HANDLERS: readonly string[] = []` with a doc comment: the
  renderer never sends a path to open/play/edit a demo, it names a demo by an id main resolved (concept
  §14); the only handler that may ever join this list is "add extra folder" (native folder dialog,
  canonicalised in main).
  Manifest row: `id: 'replays'`, `titleKey: 'replays.module.title'`, `descriptionKey:
'replays.module.description'`, `plannedIntroKey: 'replays.planned.intro'`,
  `plannedHighlightKeys: ['replays.planned.highlight.1', '.2', '.3']` (full keys), `icon: 'Film'`,
  `route: '/replays'`, `nav: { section: 'primary', order: 25 }`, `status: 'planned'`,
  `capabilities: ['mutates-installation', 'game-lifecycle']`, `ipcNamespace: 'module:replays'`,
  `requiresInstallation: false`.
  Tests: `module.test.ts` › "replays is registered in ModuleId and MODULE_MANIFESTS with the decided
  route, nav slot, icon and status" (also asserts `replays` sorts directly after `servers` and before
  `config` among primary entries) and › "the replays manifest declares exactly the
  mutates-installation and game-lifecycle capabilities"; `replays.test.ts` › "every replays handler
  has a zod schema" (both directions: every `REPLAYS_HANDLERS` value has a schema, no schema without
  a handler) and › "no replays handler payload carries a filesystem path" — walks each payload
  schema (unwrap optional/nullable/default, recurse into object shapes and arrays) and fails on the
  `absolutePathSchema` instance from `src/shared/schemas.ts` or an object key matching
  `/path|dir|folder|file/i`, skipping handlers in `REPLAYS_PATH_PAYLOAD_HANDLERS`; the same test file
  proves the walker is not vacuous by running it on a synthetic `z.object({ demoPath: z.string() })`
  and on a nested `absolutePathSchema` and expecting both to be flagged.
  Acceptance: `npm run typecheck` clean; the tests above plus `ipc-schemas.test.ts` pass.
- **D2 — main half.** Files: `src/main/modules/replays/index.ts` (new, mirror
  `src/main/modules/home/index.ts` — `export const replaysModule: MainModule = { id: 'replays',
setup({ handle }) { … } }`), `src/main/modules/index.ts` (one import + one `MODULES` entry),
  `src/main/modules/replays/index.test.ts` (new, mirror `src/main/modules/servers/index.test.ts`).
  `setup()` registers `REPLAYS_HANDLERS.overviewRead` with `replaysNoInputSchema` (from
  `@shared/modules/replays`) and answers `{ scanning: false, demoCount: 0 }`. No `fs`, no state, no
  `process.platform`. Tests: › "the replays module registers its main half under its own id"
  (`overview.read` resolves the zeroed overview through the registry, and the set of registered
  handler types equals `Object.values(REPLAYS_HANDLERS)`), › "a bad overview.read payload is
  rejected", › "replays handlers are not reachable under another module's id" (invoking
  `overview.read` with `moduleId: 'servers'` or `'home'` does not reach the replays handler).
  Acceptance: those tests pass.
- **D3 — renderer half, nav entry, settings slot, strings, flow.** Files:
  `src/renderer/src/modules/index.ts` (edit: `{ id: 'replays', settingsSection: { titleKey:
'replays.settings.title', descriptionKey: 'replays.settings.description', order: 25, Section:
ReplaysSettingsSection } }` — **no** `View`, so the route falls back to `PlannedModuleView`),
  `src/renderer/src/modules/replays/client.ts` (new, typed `callModule` client for `overview.read`,
  mirror `src/renderer/src/modules/servers/client.ts`),
  `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` (new, placeholder paragraph only,
  `data-testid="replays-settings-placeholder"`, text `replays.settings.placeholder`),
  `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` (new, mirror
  `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx`),
  `src/renderer/src/components/shell/moduleIcons.tsx` (add lucide `Film` to the import and `ICONS`),
  `src/renderer/src/i18n/locales/en.json` (new **top-level** `"replays"` block, placed after
  `"servers"`: `module.title` "Demos", `module.description` (one line: browse, tag and watch your Quake
  II demos), `planned.intro` + `planned.highlight.1–3` (find every demo across installations and
  folders; see map, players and length before playing; play and scrub a demo from the launcher),
  `settings.title` "Demos", `settings.description`, `settings.placeholder` (e.g. "Demo folders and
  naming patterns will be set here.")), `CHANGELOG.md` (one line under `## Unreleased` →
  `### Added`, house style: short, a little funny), `scripts/flows/replays-module-shell.mjs` (new,
  mirror `scripts/flows/servers-module-shell.mjs`).
  Tests: `ReplaysSettingsSection.test.tsx` › "the replays renderer module contributes a settings
  section and no view", › "the section renders its placeholder while it has no controls", › "every
  string this story shows comes from the top-level replays block" (collects the replays manifest's
  `titleKey`, `descriptionKey`, `plannedIntroKey`, `plannedHighlightKeys`, the settings section's
  `titleKey`/`descriptionKey` and `replays.settings.placeholder`; each starts with `replays.` and
  resolves to a non-empty string in `en.json`); unit check that `moduleIcon('Film')` is not the
  `CircleHelp` fallback (in the same test file). Flow `replays-module-shell`: `nav-replays` is
  visible with text "Demos"; clicking it shows a heading named exactly "Demos"
  (`getByRole('heading', { name: 'Demos', exact: true })` — stays true when a later story swaps in a
  real view); shot `replays-route`; clicking `nav-settings` shows `settings-section-replays`
  containing `replays-settings-placeholder`; shot `replays-settings-section`. Comment the selectors
  at the top like the servers flow does, and note that [[140]]/[[142]] replace the placeholder and
  must update this flow's last assertion.
  Acceptance: those tests pass; `npm run ui:flow -- replays-module-shell` OK.

## Model Hints

- D1 → default — a contract file, a manifest row and an enum entry copied from the servers pattern;
  the path-guard walker is spelled out including its own non-vacuity check.
- D2 → default — one constant-returning handler mirroring `home`.
- D3 → default — registration plus a placeholder section; the flow mirrors an existing flow.
- Review: → default — additive registration only, no shell logic, no new IPC channel; the one
  structural claim that could be faked (the AC7 path guard passing vacuously) is pinned by the
  guard's own synthetic-schema self-test.

## Acceptance Tests

- AC1 → unit `src/shared/types/module.test.ts` › "replays is registered in ModuleId and
  MODULE_MANIFESTS with the decided route, nav slot, icon and status" (D1), unit
  `src/shared/ipc-schemas.test.ts` › "accepts exactly the module ids known to MODULE_MANIFESTS, no
  more, no fewer" (existing, D1), unit `src/main/modules/replays/index.test.ts` › "the replays module
  registers its main half under its own id" (D2), unit
  `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` › "the replays renderer module
  contributes a settings section and no view" (D3). "No shell file edited" is a review check on the
  D file lists — the one exception, the `Film` row in `moduleIcons.tsx`, is named in
  `## Decisions (Sprint)`.
- AC2 → e2e `scripts/flows/replays-module-shell.mjs` › flow `replays-module-shell` (D3) — `nav-replays`
  reads "Demos", clicking it renders the route's "Demos" heading; plus unit
  `src/shared/types/module.test.ts` › "replays is registered in ModuleId and MODULE_MANIFESTS with the
  decided route, nav slot, icon and status" (D1) for `{ section: 'primary', order: 25 }`.
- AC3 → unit `src/shared/types/module.test.ts` › "the replays manifest declares exactly the
  mutates-installation and game-lifecycle capabilities" (D1).
- AC4 → unit `src/shared/types/module.test.ts` › "every module's ipcNamespace is module: plus its id"
  (existing, now covers replays, D1) and unit `src/main/modules/replays/index.test.ts` › "replays
  handlers are not reachable under another module's id" (D2).
- AC5 → e2e `scripts/flows/replays-module-shell.mjs` › flow `replays-module-shell` (D3) —
  `settings-section-replays` with `replays-settings-placeholder` visible in Settings — plus unit
  `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` › "the section renders its
  placeholder while it has no controls" (D3).
- AC6 → unit `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` › "every string this
  story shows comes from the top-level replays block" (D3).
- AC7 → unit `src/shared/modules/replays.test.ts` › "every replays handler has a zod schema" and ›
  "no replays handler payload carries a filesystem path" (D1), plus unit
  `src/main/modules/replays/index.test.ts` › "a bad overview.read payload is rejected" (D2) proving
  the schema is enforced at the seam.

## Done

The `replays` module is registered end to end: shared contract
(`src/shared/modules/replays.ts`, `ModuleId`/`MODULE_MANIFESTS` row, `moduleId` z.enum), main
half (`src/main/modules/replays/index.ts`, `overview.read` → `{ scanning: false, demoCount: 0 }`),
renderer half (settings section only, `PlannedModuleView` fallback, "Demos" nav entry at order 25,
`Film` icon, top-level `replays` i18n block, `replays-module-shell` e2e flow). No shell file
touched beyond the one named `moduleIcons.tsx` exception; no new IPC channel.

Commit message: `135: register the replays (Demos) module skeleton`

Verification (narrow gate): `npm run build` green, `npm run typecheck` green, `npx vitest run
--changed HEAD` green (160 files, 2442 passed, 7 skipped — includes all AC-named unit tests),
`npm run ui:flow -- replays-module-shell` green. AC1-AC7 each verified against their named test(s)
per `## Acceptance Tests` — all ran and passed in this run, none missing from `--changed HEAD`.
No manual residue. Clean-agent review (default tier): PASS, no findings (no hard-tier stage —
`## Model Hints` names default only).

Decisions: none beyond `## Decisions (Sprint)` — no implementation-detail gaps found during
build; the `en.json` copy for `planned.*`/`settings.*` was written fresh (the plan's wording was
illustrative, not verbatim-required) and reviewed as acceptable.

tiers: D 3 / hard 0 · review default · cycles 0 · agents 5
