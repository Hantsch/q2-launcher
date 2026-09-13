---
id: 097
title: The launcher notices a new version
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

Once [[096]] publishes releases, a user who installed the launcher once has no way of learning
that a newer one exists — beta users are exactly the people who will not watch a releases page.
The launcher has to find out for them: once a day, at startup, quietly, and then hold that
knowledge until the user decides what to do with it ([[098]]).

Quietly is the requirement, not a nicety. A check that fails — no network, GitHub down, a rate
limit — must cost the user nothing: no dialog, no toast, no delayed startup, no repeated retry
storm. The launcher is a game launcher; if it cannot reach the update feed it starts and launches
games exactly as before. Equally, a check must not run more than once a day just because the user
restarts the launcher six times in an evening, and must not run at all in development, where the
version is whatever the working tree says.

This story is the knowledge, not the act: it decides _whether_ an update exists, what version it
is and what its notes say, and exposes that state over the IPC contract. Downloading, installing
and restarting belong to [[098]]; showing the notes in About belongs to [[099]].

## Acceptance Criteria

- [ ] **AC1** — On startup, the launcher checks for a newer published release at most once per
      24 hours; further starts within that window reuse the last result instead of checking again.
- [ ] **AC2** — When the published release is newer than the running version, the launcher holds
      an "update available" state carrying that version and its release notes; when it is not, the
      state says up to date.
- [ ] **AC3** — A failed check (offline, error response, malformed feed) leaves a state carrying
      the reason, shows the user nothing by itself, and does not delay or block startup.
- [ ] **AC4** — A failed check does not burn the daily window: the next start may check again
      rather than waiting 24 hours on a result that never arrived.
- [ ] **AC5** — No check runs in development or in an unpackaged build.
- [ ] **AC6** — The renderer can read the current update state and be told when it changes,
      through the typed IPC contract — no direct network access and no version comparison in the
      renderer.
- [ ] **AC7** — The user can trigger a check by hand at any time, independently of the daily
      window, and sees its outcome (including a failure reason).
- [ ] **AC8** — The check result survives a restart, so the launcher does not forget between
      sessions what it already knows.

## Open Questions

- ~~**`electron-updater` or a hand-rolled check?**~~ answered → Decisions (Sprint)
- ~~Depends on [[096]]'s open question about repository visibility and the prerelease
  channel~~ answered → Decisions (Sprint)
- ~~**AC7 has no user-facing trigger in this story.**~~ noted, not blocking → the manual check is
  proven here at the service and IPC level; its `e2e` proof through the real surface arrives with
  [[099]] AC4 ("check now" in About) in this same sprint. Listed in `## Acceptance Tests` as a
  named coverage gap for the sprint review.

## Decisions (Sprint)

- **(User)** Use `electron-updater` (GitHub provider, `autoDownload: false`) rather than a
  hand-rolled check — this project ships NSIS, unlike `claude-control`'s portable EXE.
- **(User)** `Hantsch/q2-launcher` is public and the first release is `1.0.0-beta.1` published
  as a GitHub prerelease (per [[096]]'s decisions). Since every release this sprint is a beta
  prerelease, "newer" is a straight semver comparison against the running version — there is no
  separate stable channel to exclude yet; revisit once a non-prerelease version ships.
- **Shell service, not a module** — `src/main/services/update/`, wired like `launch`/`jobs`:
  `ModuleId` is a closed set of routed feature areas (`config`, `downloads`, `mods`, `assets`) and
  an update check has no route, no manifest and no view.
- **Its own `userData/update-check.json` via `JsonStore`**, mirroring `news-feed.json` — a
  regenerable record derived from foreign content, carrying its own `cacheVersion`, so
  `state.json`'s schema and migrations stay untouched.
- **`electron-updater` lands in `dependencies`, not `devDependencies`** — `externalizeDepsPlugin`
  keeps main's `dependencies` external, so a devDependency would simply not be packed.
- **The guard is `app.isPackaged`, not `is.dev`** — `ui:verify` runs unpackaged, and an
  acceptance harness must never reach the network; that case reports `supported: false`.
- **`autoDownload: false`, `autoInstallOnAppQuit: false`, `allowPrerelease: true`, and
  `checkForUpdates()`** — never `checkForUpdatesAndNotify()`, whose native notification would
  break AC3's "shows the user nothing"; `allowPrerelease` because every beta release is a
  prerelease.
- **The semver comparison is `electron-updater`'s** (`UpdateCheckResult.isUpdateAvailable`) — no
  `semver` dependency, no hand-rolled comparison in main, none in the renderer (AC6).
- **Repository coordinates come from the generated `app-update.yml`** ([[096]]'s `publish` block),
  never hardcoded in `src/` — one source for where releases live.
- **State shape:** `status` is the last *attempt's* outcome; `update` is the last *known* available
  release and survives a later failed attempt, so a failure can never hide an update already found.
  Errors are `LocalizedMessage` (i18n key), never prose, per the repo's IPC rule.
- **`update:check` answers with the resulting `UpdateState`, not an `Outcome`** — a failed check is
  a state this story defines, not a channel failure; the channel never rejects.
- **The startup check is fire-and-forget from the existing `did-finish-load` hook** in
  `src/main/index.ts`, after a short delay, and is never awaited — that is AC3's "does not block
  startup" by construction, and it reuses the hook `revalidateOnStartup` already uses.
- **No periodic timer**, mirroring `news-service.ts`'s explicit "no timer, no focus hook": a
  long-running session re-checks at the next start or when the user asks (AC7).
- **A failure never toasts and never retries inside a session** — `broadcast.toast` is deliberately
  unused here (AC3's "no repeated retry storm").
- **The 24h window is measured from the last *successful* check** (`lastSuccessAt`), which makes
  AC4 true by construction rather than by a special case.
- **In-flight de-duplication plus a 20s timeout guard** — a manual check during a running one joins
  it, and a hung request cannot strand the state in `checking` forever.
- **Release notes are stored verbatim as one string** (array form joined), capped at 20 000
  characters, and treated as untrusted foreign content; rendering and sanitisation belong to
  [[099]] (its AC6).
- **`electron-updater`'s own logger is wired to the existing scoped `electron-log`** logger, so its
  diagnostics land in the app log instead of the console.
- **The `electron-updater` import is isolated in `checker.ts` behind an injectable seam**, mirroring
  `news-service.ts`'s `fetchImpl`/`cache` options — unit tests then load neither `electron-updater`
  nor Electron.
- **No `CHANGELOG.md` entry** — this story ships nothing a user can see; the visible surfaces
  ([[098]], [[099]]) carry the entries once [[096]] flips `changelog-path`.

## Plan

A main-process update-check service behind the typed IPC contract. Nothing renders here.

1. **Contract first** (`src/shared`): `UpdateState` in a new `types/update.ts` (+ `types/index.ts`
   re-export); `update:getState` / `update:check` (both `req: void`, `res: UpdateState`) in
   `IpcInvokeMap`, `update:state` in `IpcEventMap`, both runtime arrays; two `z.void()` schemas in
   `ipc-schemas.ts`.

   ```ts
   interface UpdateState {
     status: 'idle' | 'checking' | 'upToDate' | 'available' | 'error'
     update: { version: string; notes: string; releasedAt: string | null } | null
     error: LocalizedMessage | null
     lastCheckedAt: string | null   // any completed attempt
     lastSuccessAt: string | null   // drives the 24h window (AC4)
     supported: boolean             // false in an unpackaged build (AC5)
   }
   ```

2. **Persistence** (`src/main/services/update/store.ts`): `JsonStore`-backed
   `userData/update-check.json` holding `{ cacheVersion, update, lastCheckedAt, lastSuccessAt }`.
   Forgiving read (missing/corrupt/old version → "nothing known"), mirroring `feed-cache.ts`.

3. **The service** (`service.ts`): restores from the store on `load()`, decides whether the window
   is open, runs at most one check at a time, maps every failure to an i18n key, emits on every
   state change, never throws, never toasts, no-ops when `!isPackaged`.

4. **The adapter** (`checker.ts`): the only file importing `electron-updater` — configures
   `autoUpdater`, calls `checkForUpdates()`, normalises `UpdateInfo` (version, notes, releasedAt)
   and classifies errors into `update.error.*` keys. `electron-updater` added to `dependencies`.

5. **Wiring**: construct in `context.ts` (`onStateChange` → `broadcast.emit('update:state', …)`),
   registrar `src/main/ipc/update.ts` + `registerAllIpc`, startup kick from `index.ts`'s existing
   `did-finish-load` hook, fire-and-forget.

6. **Renderer read path**: an `update` slice in `store/useLauncher.ts` (bootstrap `update:getState`,
   subscribe `update:state`) plus the `update.error.*` keys in `i18n/locales/en.json`. No component
   touches this story — [[098]] and [[099]] build on the slice.

## Deliverables

- **D1 — The contract.** `src/shared/types/update.ts` (new), `src/shared/types/index.ts`,
  `src/shared/ipc.ts` (2 invoke channels + 1 event + both runtime arrays),
  `src/shared/ipc-schemas.ts` (two `z.void()` schemas, in map order). Mirror: the `launch:*`
  entries in all three files. Plus its test in `src/shared/ipc-schemas.test.ts` (the update
  channels are declared, listed and reject a non-void payload).
  _Acceptance:_ `npm run typecheck` passes; the compile-time `ALL_*_CHANNELS_LISTED` guards hold.

- **D2 — The persisted record.** `src/main/services/update/store.ts` (new) + its test
  `store.test.ts`. Mirror: `src/main/modules/home/news/feed-cache.ts` (own `JsonStore`, own
  `cacheVersion`, damaged file degrades to "nothing known" instead of throwing).
  _Acceptance:_ a written record reads back identically; a corrupt/foreign-version file reads as
  "nothing known".

- **D3 — The service.** `src/main/services/update/service.ts` (new) + its test `service.test.ts`.
  Mirror: `src/main/modules/home/news/news-service.ts` (injected `now`, injected checker, injected
  store, never throws). Owns: restore-on-load, the 24h window from `lastSuccessAt`, the unpackaged
  no-op, in-flight de-duplication, the timeout guard, error keys, `onStateChange`, and
  `scheduleStartupCheck()` returning `void` without awaiting the check.
  _Acceptance:_ the AC1–AC5/AC7/AC8 test names below all pass with no Electron and no network.

- **D4 — The `electron-updater` adapter.** `src/main/services/update/checker.ts` (new) + its test
  `checker.test.ts` (fakes the `autoUpdater` object), `package.json` (`electron-updater` in
  `dependencies`).
  _Acceptance:_ `autoDownload`/`autoInstallOnAppQuit` are off and `allowPrerelease` is on; an
  available release is normalised to `{version, notes, releasedAt}` with array notes joined and
  capped; offline / HTTP / missing-config / unknown errors map to distinct `update.error.*` keys.

- **D5 — Wiring into the app.** `src/main/ipc/update.ts` (new, mirror `src/main/ipc/launch.ts`),
  `src/main/ipc/index.ts`, `src/main/context.ts`, `src/main/index.ts` (startup kick in the existing
  `did-finish-load` hook) + its test `src/main/ipc/update.test.ts`.
  _Acceptance:_ both channels are registered (`assertContractFullyHandled` passes at boot) and
  answer with the service's state; `update:check` resolves with the state and never rejects.

- **D6 — The renderer read path.** `src/renderer/src/store/useLauncher.ts` (slice + bootstrap read
  + `onEvent('update:state')`, mirror the `launch` slice),
  `src/renderer/src/i18n/locales/en.json` (`update.error.*`) + its test
  `src/renderer/src/store/useLauncher.update.test.ts` (mirror
  `useLauncher.routeFocus.test.ts`).
  _Acceptance:_ the store mirrors the pushed state; every `update.error.*` key the adapter can
  produce exists in `en.json`.

## Model Hints

- `D3 → deliverable-hard` — it is the only piece with real regression surface: a time window that
  must survive restarts, a failure path that must *not* consume that window (AC4) and must not
  erase a previously known update, plus concurrency (startup check vs. manual check) and a timeout
  that together decide whether the state can get stuck in `checking`.
- D1, D2, D4, D5, D6 → default tier (contract edits, a mirrored store, a thin adapter, mechanical
  wiring, one store slice).
- `Review: → story-review-hard` — this story adds the first network-touching service outside a
  module, on the app-start path, writing foreign content to disk; a wrong guard here is either a
  network call from the acceptance harness or a delayed startup for every user.

## Acceptance Tests

- AC1 → unit `src/main/services/update/service.test.ts` › "a start inside 24 hours of the last
  successful check reuses the last result instead of checking"
- AC2 → unit `src/main/services/update/service.test.ts` › "a newer published release becomes an
  available state carrying version and notes, an older or equal one becomes up to date"; notes and
  version normalisation in unit `src/main/services/update/checker.test.ts` › "an available release
  is normalised to version, notes and releasedAt"
- AC3 → unit `src/main/services/update/service.test.ts` › "a failed check keeps the reason, never
  throws, never toasts and never retries" and › "scheduleStartupCheck returns before the check
  settles"
- AC4 → unit `src/main/services/update/service.test.ts` › "a failed check does not start the
  24-hour window"
- AC5 → unit `src/main/services/update/service.test.ts` › "an unpackaged build never checks and
  reports supported: false"
- AC6 → unit `src/shared/ipc-schemas.test.ts` › "the update channels are declared with void payload
  schemas"; unit `src/main/ipc/update.test.ts` › "update:getState and update:check answer with the
  service state"; unit `src/renderer/src/store/useLauncher.update.test.ts` › "an update:state event
  replaces the store's update state"
- AC7 → unit `src/main/services/update/service.test.ts` › "a manual check runs regardless of the
  24-hour window and reports its failure reason"; unit `src/main/ipc/update.test.ts` › "update:check
  triggers a check and resolves with the resulting state".
  **Coverage gap (sprint review):** the *user-facing* trigger does not exist in this story — About's
  "check now" is [[099]] AC4, which carries the `ui:verify` proof through the real surface in this
  same sprint. Not a manual step, and not deferred beyond S21.
- AC8 → unit `src/main/services/update/store.test.ts` › "a written result reads back after a
  restart"; unit `src/main/services/update/service.test.ts` › "a cold start restores the last known
  result before any check runs"

## Done
