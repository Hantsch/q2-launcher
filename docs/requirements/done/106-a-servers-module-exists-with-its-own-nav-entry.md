---
id: 106
title: a servers module exists with its own nav entry
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the launcher and sees a "Servers" entry in the primary navigation, at the same level
as Library and Config — a dedicated place to find out where something is going on, distinct from
managing an installation. Today that place does not exist; the game browser concept
(`docs/concepts/game-browser.md`) describes everything it will eventually do, but nothing is
registered with the app yet.

This story does none of that content. It is the foundation the other three stories in this sprint,
and every later game-browser sprint, are built on: a module that exists, is reachable, has its own
IPC namespace and settings slot, and declares no platform delta — so [[107]], [[108]] and [[109]]
have a home to land their code in, and later sprints have a route and a settings section to fill
rather than create.

The concept left the module's final id and label open (its own open point #8: the document uses
`servers` throughout but the home concept once called the planned feature "Gamebrowser"). This
story settles it: the module id is `servers`, following [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module)'s
existing lowercase-noun convention (`library`, `config`, `downloads`, `mods`, `assets`), and its
nav label is "Servers" — the plain, activity-neutral name a user would look for, not the
implementation-flavoured "Gamebrowser". This is a decision, not an open question.

The concept also states that this milestone turns platform parity into a standing CLAUDE.md rule
(§15). That rule is already present in the live `CLAUDE.md` under "Key rules" ("Platform parity is
explicit."), landed by an earlier story — so this story adds no new rule text. It only has to show
that the `servers` module honours it: the module declares no platform-specific capability or
behaviour, consistent with `node:dgram` and `fetch` both being platform-neutral (concept §15, GB-T2).

## Acceptance Criteria

- [x] **AC1** — A `servers` module is registered per the 5-step checklist in
      [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module): a shared contract file
      under `src/shared/modules/`, a `ModuleId` entry, a `MODULE_MANIFESTS` row, a main half, and a
      renderer half — with no edit to `AppShell.tsx` or any other shell file.
- [x] **AC2** — The manifest's `nav` is `{ section: 'primary', order: … }`, placing "Servers" in the
      primary nav alongside Library and Config; clicking it routes to the module's (empty/placeholder)
      view.
- [x] **AC3** — The manifest declares the `network` and `game-lifecycle` capabilities and no others.
- [x] **AC4** — The module's `ipcNamespace` (`module:servers`) exists and is asserted as owned by this
      module the same way every other module's namespace is (a handler registered outside it is
      rejected).
- [x] **AC5** — The renderer module entry contributes a `settingsSection` (title + order + `Section`
      component) that renders in the Settings view, even though it currently shows no controls — the
      slot later sprints populate.
- [x] **AC6** — `CLAUDE.md`'s "Key rules" carries the platform-parity rule (verified present, not
      re-added); the `servers` module's manifest and code declare no platform-specific capability or
      branch, matching GB-T2.
- [x] **AC7** — The module's contract file (`src/shared/modules/servers.ts`) exists with at least one
      handler name declared, and every `module:invoke` handler for `servers` is backed by a
      module-local zod schema before it is implemented — the same contract-first discipline
      `src/shared/ipc.ts` enforces for shell-level channels, restated here as GB-A2 and binding for
      every story that adds a `servers` handler in this and later sprints.

## Open Questions

<!-- None. Every detail decision below was resolvable from the concept, the sibling stories and the
guardrails — see `## Decisions (Sprint)`. -->

## Decisions (Sprint)

- **Nav order `20`** — `servers` sits between `library` (10) and `config` (30), the only free slot in
  the primary section, because "where is something going on" is a sibling of the library, not of the
  parked `mods`/`assets` tail.
- **`status: 'planned'`** — the feature itself does not exist yet, and the `downloads` precedent
  (main half registered, `status` stayed `planned` until the renderer view landed) is exactly this
  situation.
- **No `View` in `RENDERER_MODULES`; the route renders the shell's `PlannedModuleView`** — that
  fallback is the documented mechanism for a registered module without a view yet, so AC2's
  "(empty/placeholder) view" is reused rather than re-implemented as a duplicate empty screen; 9.2
  swaps a real `ServersView` in without touching the manifest.
- **`plannedIntroKey` + three `plannedHighlightKeys`** — the placeholder route is the module's only
  surface this sprint, and the `mods`/`assets` rows show that a parked module explains itself there.
- **The renderer half is the `RENDERER_MODULES` entry carrying `settingsSection` only** — the
  `RendererModule` interface explicitly allows a module to contribute a settings section without
  owning a view.
- **One handler: `servers.overview.read` → `{ scanning, knownServerCount, lastScanAt }`** — AC7 needs
  a real declared handler, and this is the only one on the concept's handler list (§16) writable
  today without inventing a server entity shape 9.2 has not settled; it answers `false / 0 / null`
  now and stays the header/status read later.
- **Zod schemas live in the shared contract file `src/shared/modules/servers.ts`** — the `home.ts`
  precedent (schemas beside the handler names) rather than `downloads`' separate
  `main/modules/downloads/schemas.ts`, so "contract-first" is one file to read.
- **No new IPC channel** — the module rides the existing `module:invoke` / `module:event` seam, so
  `src/shared/ipc.ts` and the preload allowlist stay untouched; adding `'servers'` to `ModuleId`
  extends `moduleInvokeSchema` automatically (`src/shared/ipc-schemas.test.ts`).
- **`requiresInstallation: false`** — browsing servers is useful before any installation exists; only
  joining needs one, and that is a later sprint's concern.
- **Icon `Globe`, and `src/renderer/src/components/shell/moduleIcons.tsx` gets that one map entry** —
  the `ICONS` record is a data registry the manifest's `icon` field resolves against (`mods`/`assets`
  have rows there too), not shell behaviour, so AC1's "no shell edit" is read as no shell logic, nav
  or routing change; every other shell file stays untouched.
- **AC4 is covered as a *convention* test, not a new runtime assertion** — the registry already makes
  cross-namespace registration impossible by construction (handler keys are `module.id` + `/` +
  `type`, `src/main/modules/registry.ts`), so the story adds the missing tests (`ipcNamespace ===
  'module:<id>'` for every manifest; one module's handlers unreachable under another module's id)
  instead of a redundant second check.
- **AC6 is proven by a guard test, not by editing `CLAUDE.md`** — the rule is already in "Key rules",
  so the test asserts it is still there and that no `servers` source file branches on the platform.
- **CHANGELOG** — a new primary nav entry is user-facing, so `## Unreleased → ### Added` gets one
  line with D3.

## Plan

Five-step module registration per [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module),
bottom-up, one layer per deliverable. No shell logic, no new IPC channel, no platform branch.

1. **Shared** (D1) — `src/shared/modules/servers.ts`: `SERVERS_HANDLERS = { overviewRead:
   'overview.read' }`, `serversNoInputSchema = z.void()`, `serversOverviewSchema` + `ServersOverview`
   type, and `SERVERS_HANDLER_SCHEMAS` (the map `servers.test.ts` iterates), all mirroring
   `src/shared/modules/home.ts`. `src/shared/types/module.ts`: `'servers'` in `ModuleId` and the
   manifest row — `icon: 'Globe'`, `route: '/servers'`, `nav: { section: 'primary', order: 20 }`,
   `status: 'planned'`, `capabilities: ['network', 'game-lifecycle']`,
   `ipcNamespace: 'module:servers'`, `requiresInstallation: false`, plus
   `plannedIntroKey`/`plannedHighlightKeys`.
2. **Main** (D2) — `src/main/modules/servers/index.ts` (mirror `src/main/modules/home/index.ts`): a
   `MainModule` whose `setup()` registers `overview.read` with its schema and answers
   `{ scanning: false, knownServerCount: 0, lastScanAt: null }`; one line in
   `src/main/modules/index.ts`. No `dgram`, no `fetch`, no state — those are 9.2+.
3. **Renderer** (D3) — entry in `src/renderer/src/modules/index.ts` with `settingsSection`
   (`titleKey`, `order: 20`, `Section`) and **no** `View`; `modules/servers/client.ts` (typed
   `callModule` client, mirror `modules/downloads/client.ts`);
   `modules/servers/ServersSettingsSection.tsx` rendering only the placeholder line; `Globe` in
   `components/shell/moduleIcons.tsx`; the `module.servers.*` keys in `i18n/locales/en.json`; the
   `servers-module-shell` flow; the CHANGELOG line.
4. **Guard** (D4) — the platform-parity test that keeps AC6 true as later sprints fill the module.

Order matters: D1 → D2 → D3 → D4. D3's flow needs D2 registered, or the registry reports the nav
entry as `planned`-without-a-main-half regardless of the manifest.

## Deliverables

- **D1 — shared contract + manifest row.** Files: `src/shared/modules/servers.ts` (new, mirror
  `src/shared/modules/home.ts`), `src/shared/types/module.ts` (edit: `ModuleId`, `MODULE_MANIFESTS`),
  plus its tests `src/shared/modules/servers.test.ts` (new, mirror `src/shared/modules/home.test.ts`)
  and `src/shared/types/module.test.ts` (new). Acceptance: `npm run typecheck` clean; the servers
  handler map has a schema for every entry; every manifest's `ipcNamespace` equals `module:<id>`; the
  `servers` row's `nav`, `capabilities`, `route` and `requiresInstallation` are exactly as decided
  above. Covers AC1 (shared half), AC3, AC7, AC4 (namespace convention).
- **D2 — main half.** Files: `src/main/modules/servers/index.ts` (new, mirror
  `src/main/modules/home/index.ts`), `src/main/modules/index.ts` (one import + one array entry),
  `src/main/modules/servers/index.test.ts` (new, mirror `src/main/modules/home/index.test.ts`),
  `src/main/modules/registry.test.ts` (edit: add the cross-namespace case). Acceptance:
  `overview.read` resolves the zeroed overview through the registry; a bad payload is rejected; a
  handler registered by one module is not reachable under another module's id. Covers AC1 (main
  half), AC4.
- **D3 — renderer half, nav entry and settings slot.** Files: `src/renderer/src/modules/index.ts`
  (edit), `src/renderer/src/modules/servers/client.ts` (new, mirror
  `src/renderer/src/modules/downloads/client.ts`),
  `src/renderer/src/modules/servers/ServersSettingsSection.tsx` (new, mirror
  `modules/downloads/DownloadsSettingsSection.tsx` — placeholder text only,
  `data-testid="servers-settings-placeholder"`),
  `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx` (new),
  `src/renderer/src/components/shell/moduleIcons.tsx` (one `Globe` entry),
  `src/renderer/src/i18n/locales/en.json` (`module.servers.*` block), `CHANGELOG.md`,
  `scripts/flows/servers-module-shell.mjs` (new, mirror
  `scripts/flows/settings-downloads-section.mjs`). Acceptance: `nav-servers` is present in the
  primary nav between Library and Config, clicking it shows the Servers placeholder route, and the
  Settings view shows `settings-section-servers`; `moduleIcon('Globe')` resolves to a real icon, not
  the fallback. Covers AC1 (renderer half), AC2, AC5.
- **D4 — platform-parity guard.** File: `src/main/modules/servers/platform-parity.test.ts` (new).
  Acceptance: `CLAUDE.md`'s "Key rules" still contains the platform-parity rule (asserted, never
  written), and no file under `src/main/modules/servers/`, `src/shared/modules/servers.ts` or
  `src/renderer/src/modules/servers/` references `process.platform`, `os.platform` or a
  `win32`/`linux` literal. Covers AC6.

## Model Hints

- D1 → default — a contract file and a manifest row, both copied from an existing pattern.
- D2 → default — one handler returning constants, mirroring `home`'s module shape.
- D3 → default — registration plus a placeholder section; the flow follows an existing flow closely.
- D4 → default — a single assertion-only test file.
- Review: → default — additive registration only, no shell logic, no new IPC channel, and no
  behaviour any existing surface depends on.

## Acceptance Tests

- AC1 → unit `src/shared/types/module.test.ts` › "servers is registered in ModuleId and
  MODULE_MANIFESTS with the decided route, nav slot and status" (D1), unit
  `src/main/modules/servers/index.test.ts` › "the servers module registers its main half under its
  own id" (D2), and unit `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx` › "the
  servers renderer module contributes a settings section and no view" (D3). The "no shell file
  edited" clause is a review check on D2/D3's file lists — the one exception, the `Globe` row in
  `moduleIcons.tsx`, is named in `## Decisions (Sprint)`.
- AC2 → e2e `scripts/flows/servers-module-shell.mjs` › flow `servers-module-shell` (D3) — clicks
  `nav-servers` in the primary nav and asserts the Servers route renders.
- AC3 → unit `src/shared/types/module.test.ts` › "the servers manifest declares exactly the network
  and game-lifecycle capabilities" (D1).
- AC4 → unit `src/shared/types/module.test.ts` › "every module's ipcNamespace is module: plus its id"
  (D1) and unit `src/main/modules/registry.test.ts` › "a module's handlers are not reachable under
  another module's id" (D2).
- AC5 → e2e `scripts/flows/servers-module-shell.mjs` › flow `servers-module-shell` (D3) — opens
  Settings and asserts `settings-section-servers` is visible — plus unit
  `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx` › "the section renders its
  placeholder while it has no controls" (D3).
- AC6 → unit `src/main/modules/servers/platform-parity.test.ts` › "CLAUDE.md carries the
  platform-parity rule and the servers module declares no platform branch" (D4).
- AC7 → unit `src/shared/modules/servers.test.ts` › "every servers handler has a zod schema" (D1).

## Done

A `servers` module now exists end to end following the 5-step registration checklist: a shared
contract (`src/shared/modules/servers.ts`, one handler `overview.read` with a zod schema), a
`ModuleId`/`MODULE_MANIFESTS` row (`icon: 'Globe'`, `route: '/servers'`, `nav: { section:
'primary', order: 20 }`, `status: 'planned'`, `capabilities: ['network', 'game-lifecycle']`,
`ipcNamespace: 'module:servers'`, `requiresInstallation: false`), a main half
(`src/main/modules/servers/index.ts`, answers a zeroed overview through the registry) and a
renderer half (`src/renderer/src/modules/index.ts` entry contributing only a `settingsSection`,
no `View` — the route renders the shell's existing `PlannedModuleView` fallback). "Servers" is
now a primary-nav entry between Library and Config, with a `Globe` icon
(`components/shell/moduleIcons.tsx`) and a Settings section
(`ServersSettingsSection.tsx`/`.test.tsx`) showing only its placeholder text. A platform-parity
guard test (`src/main/modules/servers/platform-parity.test.ts`) locks in AC6 for later sprints.

**Commit message:** `106: register the servers module (nav entry, settings slot, contract-first main/shared halves)`

**Decisions (beyond the story's own `## Decisions (Sprint)`, made during build):**
- The story's Decisions section claimed adding `'servers'` to `ModuleId` extends
  `moduleInvokeSchema` "automatically" — it does not; `moduleId` there is a hardcoded
  `z.enum([...])` in `src/shared/ipc-schemas.ts`. Added `'servers'` to that enum; this was caught
  by the pre-existing convention test `src/shared/ipc-schemas.test.ts` › "accepts exactly the
  module ids known to MODULE_MANIFESTS, no more, no fewer" failing under the narrow gate, not by
  the review.
- `scripts/flows/servers-module-shell.mjs`'s heading locator (`getByRole('heading', { name:
  'Servers' })`) was ambiguous — it also matched the `PlannedModuleView`'s "Servers is coming in
  a later release" sub-heading. Narrowed to `{ name: 'Servers', exact: true }`.

**Verification — narrow gate:**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `test-story` (`npx vitest run --changed HEAD`) — 123 files, 1972 passed, 7 pre-existing skips,
  0 failed (after the `ipc-schemas.ts` enum fix above; the run before that fix had exactly the
  one expected failure in `ipc-schemas.test.ts`).
- `e2e-story` (`npm run ui:flow -- servers-module-shell`) — OK (after the locator fix above),
  covering AC2 and AC5's real-surface half.
- Clean-agent review (default tier, per `## Model Hints`): **PASS**, no findings. Verified AC1-AC7
  individually with evidence, judged each named test genuinely proves its criterion (no
  tautologies, no mocked-away assertions), confirmed no shell file was touched besides the
  documented one-line `Globe` entry in `moduleIcons.tsx`, no new IPC channel, no
  platform-specific branching, and the two orchestrator fixes above were in-scope corrections
  rather than scope creep.

**AC → test mapping, as verified:**
- AC1 → `src/shared/types/module.test.ts` (servers registered in `ModuleId`/`MODULE_MANIFESTS`),
  `src/main/modules/servers/index.test.ts` (main half registers under its own id),
  `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx` (renderer contributes a
  settings section and no view) — all pass.
- AC2 → e2e `servers-module-shell` flow (clicks `nav-servers`, asserts the Servers route) — pass.
- AC3 → `src/shared/types/module.test.ts` (exactly `network` + `game-lifecycle`) — pass.
- AC4 → `src/shared/types/module.test.ts` (every `ipcNamespace === module:<id>`) and
  `src/main/modules/registry.test.ts` (a module's handlers unreachable under another module's
  id) — both pass.
- AC5 → e2e `servers-module-shell` flow (`settings-section-servers` visible) plus
  `ServersSettingsSection.test.tsx` (placeholder renders) — pass.
- AC6 → `src/main/modules/servers/platform-parity.test.ts` — pass.
- AC7 → `src/shared/modules/servers.test.ts` (every servers handler has a zod schema) — pass.

No manual residue; no open blockers. `## Acceptance Tests` already names the real test files/paths
as written, no correction needed.
