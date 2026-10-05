# Architecture

How the launcher is put together, and where the parts that do not exist yet will
go. Read this before adding a module.

## Process model

Three build outputs, from `electron.vite.config.ts`:

|          | source            | output                 | format               |
| -------- | ----------------- | ---------------------- | -------------------- |
| main     | `src/main/**`     | `out/main/index.js`    | CommonJS             |
| preload  | `src/preload/**`  | `out/preload/index.js` | CommonJS             |
| renderer | `src/renderer/**` | `out/renderer/`        | ESM, bundled by Vite |

Main and preload stay CommonJS deliberately. A sandboxed preload cannot use ESM
imports; an ESM preload has to be `.mjs` and loads asynchronously, which races
`contextBridge` exposure. Vite bundles everything anyway, so CJS costs nothing.

`src/shared` is compiled into **both** TypeScript projects. Nothing in it may
import `node:*`, `electron`, or use DOM types — that constraint is what lets the
same domain model and IPC contract be used on both sides without duplication.

## Layering and security guards

The layer rules, enforced by `src/architecture.test.ts` over the real import graph of the
production sources:

- `src/shared` imports no `node:*`, `electron`, or main/renderer/preload code, and is typechecked
  without DOM types.
- `src/renderer` imports no `electron`, `node:*` or `src/main`.
- A main module imports another module only through an allowlisted edge; a main shell file imports
  only `modules/index` and `modules/registry` (the shell allowlist stays empty).
- A renderer module imports another module only through an allowlisted edge; a renderer shell file
  imports only the modules root files.

To add an allowlist entry in `src/architecture.test.ts`, name the story that introduces the edge and
give a one-line reason. The list only shrinks: an entry whose import is gone fails the test and must
be deleted.

Spawn and network use is confined by `src/main/layering.test.ts`: `child_process`, `net.fetch`,
`7za` and `spawn(` appear nowhere in `src/renderer/src` or `src/preload`, and in `src/main` only in
the downloads module and the files below. The production CSP keeps `connect-src 'self'`. Adding a
file to `ALLOWED_MAIN_SPAWN_NETWORK_FILES` requires a row here.

| File                                          | Why it is allowed                                                   |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `src/main/services/launch.ts`                 | spawns the game executable                                          |
| `src/main/lib/win-registry.ts`                | runs `reg.exe` to read the Windows registry                         |
| `src/main/lib/renderer-source.ts`             | only mentions `net.fetch` in a comment                              |
| `src/main/modules/home/news/feed-fetcher.ts`  | only mentions `net.fetch` in a comment; fetches with global `fetch` |
| `src/main/modules/home/images/fetch-image.ts` | only mentions `net.fetch` in a comment; fetches with global `fetch` |
| `src/main/lib/zip-entries.ts`                 | spawns the vendored 7-Zip to list and read zip entries              |
| `src/main/modules/replays/index.ts`           | resolves the vendored 7-Zip path; spawns nothing itself             |
| `src/main/lib/net/fetcher.ts`                 | story 209: shell-owned download/extract infrastructure              |
| `src/main/lib/archive/extractor.ts`           | story 209: shell-owned download/extract infrastructure              |
| `src/main/lib/archive/7za-path.ts`            | story 209: shell-owned download/extract infrastructure              |
| `src/main/services/package-staging.ts`        | story 209: shell-owned download/extract infrastructure              |

## The IPC contract

`src/shared/ipc.ts` is the single source of truth. One map declares every
request/response channel with its payload and return type:

```ts
export interface IpcInvokeMap {
  'installations:addExisting': { req: AddExistingInstallationInput; res: Outcome<Installation> }
  // ...
}
```

Everything derives from it:

- **main** registers handlers through a typed `handle()` wrapper
  (`src/main/ipc/index.ts`). At boot, `assertContractFullyHandled()` throws if a
  declared channel has no handler — a missing handler is a startup crash in
  development, not a rejected promise a user stumbles into months later. The
  wrapper takes a zod schema as a required parameter, so a channel with no
  schema, or the wrong schema, is a compile error, not just a runtime risk.
- **preload** builds its allowlist from the same file. `INVOKE_CHANNELS` and
  `EVENT_CHANNELS` are runtime arrays, and compile-time assertions
  (`ALL_INVOKE_CHANNELS_LISTED`) fail the build if a channel is added to a map but
  not to the array.
- **renderer** gets end-to-end types from `window.q2.invoke(...)`.

Push traffic (main → renderer) uses `IpcEventMap` and the `Broadcaster` service.

Payloads that cross from the renderer are validated by two wrappers around
`ipcMain.handle`, both in `src/main/ipc/index.ts`. `handle(channel, schema,
handler)` parses the payload (throwing on failure) before calling the handler,
so a malformed payload for a plain-value channel becomes a rejected promise —
still a renderer bug, not user input. `handleOutcome(channel, schema, handler,
invalidKey?)` is the same idea for channels whose response is `Outcome<T>`: it
`safeParse`s the payload and resolves to `fail(invalidKey ?? 'ipc.error.invalidPayload')`
on failure without ever calling the handler, so a bad payload never surfaces as
an unhandled promise rejection in the UI. `invalidKey` lets a channel keep an
existing, user-visible i18n key (e.g. `app:openExternal` ->
`app.error.invalidUrl`) instead of the generic default. Both wrappers register
through the same bookkeeping path, so `assertContractFullyHandled()` and the
registered-channel count don't care which one a handler uses.

Expected failures are an `Outcome`; a throw is a bug. Both surfaces turn a throw
into an i18n key and log the original error with the channel/handler, so
neither prose nor a path ever crosses IPC: the shell wrappers answer with
`ipc.error.handlerFailed` (`handleOutcome` resolves `fail(…, { channel })`,
`handle` rejects with an `Error` whose message is the key) and the module bus
(`MainModuleRegistry.invoke`) with `modules.error.handlerFailed`.

`Outcome<T>` is the transport/unexpected envelope (schema reject, throw, missing handler, I/O failure); `Refusal<R>` / `DomainResult<T, R>` is a handler's expected domain "no", returned _inside_ `Outcome.value`, always carrying a full i18n key (never a reason code the renderer must template), built with `refuse()`; the renderer toasts either through `toastOutcomeError`/`toastRefusal` in `src/renderer/src/lib/toast.ts`.

Schemas live in `src/shared/schemas.ts` (primitives shared with the persisted-state
schemas: `engineKindSchema`, `sourceSchema`, `absolutePathSchema`,
`settingsObjectSchema`) and `src/shared/ipc-schemas.ts` (one schema per invoke
channel, mirroring `IpcInvokeMap`'s section order) — not in `src/main/lib/schemas.ts`,
which now holds only the forgiving, `.catch()`-based persisted-state schemas
(state.json, installations, profiles, window state); those stay in main because
they use `node:crypto`. `src/shared/ipc.ts` itself stays zod-free: it is reachable
from the sandboxed preload bundle (`webPreferences.sandbox: true`), where an
external npm module like zod cannot be `require()`d, so the schemas live in
sibling files (`schemas.ts`, `ipc-schemas.ts`) instead.

The module seam (`ModuleSetup.handle` in `src/main/modules/types.ts`) mirrors the
same required-schema idea one level down, for `module:invoke`'s per-module-handler
payloads. A module's request schemas live in its shared contract map
(`<MODULE>_HANDLER_SCHEMAS` in `src/shared/modules/<id>.ts`, see `home.ts`), never exposed
as paths to trust. Main keeps only persisted-state and manifest schemas.

**Paths are never trusted.** `app:revealPath` only opens folders belonging to a
registered installation or the launcher's own data directories. A mod directory is
validated as a single ASCII token (`^[A-Za-z0-9_.-]+$`), which rules out traversal,
absolute paths and reserved device names in one check. Every "is this path inside that folder" decision in main goes through `isInside`
(`src/main/lib/fs-utils.ts`) — resolved, `path.relative`-based, case-folded.

## State and persistence

Two files under `app.getPath('userData')`:

- `state.json` — flat. The shell owns `schemaVersion`, `settings` and `installations`; every other
  top-level key belongs to one module (`config`, `downloads`, `home`, ...), and unlock codes to the
  unlock service. Written only on real changes. Unknown top-level keys are preserved verbatim across
  load and save, so a disabled module loses nothing.
- `window-state.json` — window geometry. Its own file because it changes on every
  resize and that write churn has no business near the installation list.

`JsonStore` (`src/main/lib/json-store.ts`) writes atomically: serialise to
`<file>.tmp`, copy the current file to `<file>.bak`, then rename over the target.
A crash mid-write cannot leave a half-written file. An unparseable file is moved
aside as `<file>.corrupt-<timestamp>`, the backup is tried, and the user is told
via a toast — losing an installation list silently is not acceptable.

Parsing is deliberately forgiving. Every settings field has a `.catch()` default,
and installations are parsed row by row so one bad entry is dropped instead of
taking the file with it. Row-level dropping, dedupe and envelope fallback all go
through `src/main/lib/forgiving.ts`. The runner lives in `src/main/services/migrations.ts` and takes its steps as an argument;
each module owns its steps (`config/persisted-migrations.ts`) and `MODULE_MIGRATIONS` in
`src/main/modules/index.ts` concatenates them for the `StateStore`, which `src/main/context.ts`
builds with `{ migrations }`.

A module owns its persisted keys in `src/main/modules/<id>/persisted.ts` (unlock, a shell service,
in `src/main/services/unlock/persisted.ts`): the schema, the forgiving parse, the defaults and a
`<id>State(state)` helper returning `StateStore.section()` handles. A handle is `{ get(), update(fn) }`
for one top-level key; `update` takes a synchronous callback over the live value. The shell never
imports module code (`src/main/shell-layering.test.ts`).

Changing a persisted shape follows a two-tier rule:

- **Additive optional key** — a forgiving parse with a default in the owner's `persisted.ts`. No
  version bump.
- **Shape change** (rename, move, reinterpret, split) — a step in the owner's
  `persisted-migrations.ts` plus a `STATE_SCHEMA_VERSION` bump. The runner validates the steps
  against the version on every load.

No new parse-time rewrites: a parser never silently reshapes old data, a migration step does.

Writes are debounced: `state.json` (and every other `JsonStore`) is flushed shortly after the last
change, not on each one. A failed write is retried once; if the retry fails too, the store reports
it and the user gets a toast instead of a silent loss.

A slice is changed through its mutator (`updateSlice`, `patchSettings`,
`InstallationsService.patch`), whose synchronous callback receives the live value. Never read ->
spread -> set: that overwrites whatever changed in between. Async work happens before the mutator,
never between a read and its write. A module's section handle (`app.state.section()`) has the same
semantics through `update(fn)`: synchronous, live value, an identical returned reference means no
write. `updateSlice` is only for the shell key `installations`.

Quit is a sequence the shell awaits (`src/main/shutdown.ts`). The first `before-quit` is held, the
playback pipe is released synchronously, then module disposers run (reverse registration order),
then `state`, the main window and every registered store settle in parallel - all bounded to 3 s.
Failures and a timeout are logged, then `app.quit()` runs; later `before-quit` events pass through.

## The installation domain

An `Installation` is identified by a generated `id`, never by its path — so a
folder can move, or come back on a different drive letter, without losing its
settings, play time or (later) mod and asset state.

`inspectInstallation()` (`src/main/services/inspector.ts`) is the only thing that
decides whether a folder is usable. The add dialog's preview, the detection scan
and the startup revalidation all call it, so the user can never be shown two
different verdicts about the same folder. It produces `ValidationCheck[]`, each
with a severity, an i18n key and an optional `ValidationFix` — and every fix is
wired to a real flow in `ChecksList.tsx`. That is what keeps a broken installation
from being a dead end.

Detection (`src/main/services/detection/`) runs in two passes:

1. **fast** — Steam (registry → `libraryfolders.vdf` → every library's
   `steamapps/common`), GOG and Epic manifests, plus the classic hand-made paths.
2. **deep, opt-in** — a bounded breadth-first walk of the drives looking for a
   `baseq2` folder: depth-capped, directory-count-capped, with a skip list, and it
   yields to the event loop so the UI stays responsive. Cancellable throughout.

Registry access shells out to `reg.exe` rather than taking a native dependency —
every npm option is either native (prebuild pain, rebuild per Electron version) or
wraps `reg.exe` anyway.

## Launching

`buildLaunchArgs()` (`src/main/services/launch-plan.ts`) is pure and unit-tested,
because r1q2's argument handling has sharp edges that are easy to get wrong and
impossible to verify by launching a game:

- `+set` values are emitted from exactly two tokens and can never contain a space.
- Quotes are ordinary characters to r1q2's early parser — they neither group nor
  get stripped.
- Any byte above 126 is a separator, so non-ASCII values arrive truncated.
- Quotes and backslashes are mangled by Windows argument escaping, which r1q2's
  hand-rolled parser never undoes.

So a value that cannot survive the trip is dropped and logged rather than emitted
broken. Install paths are never passed as arguments at all — the root goes in as
the process working directory, which sidesteps the problem for the one value most
likely to contain spaces.

Verifying the rest of the UI without launching a game — screenshots and an
accessibility report per screen, driven against the built app — is
[docs/UI-VERIFICATION.md](UI-VERIFICATION.md).

A Steam-owned installation can launch through Steam itself instead: `plan()` skips
`buildLaunchArgs()` entirely and builds a `steam://launch/<appid>/client/<n>` URL from the
installation's discovered appid and the user's chosen client, so none of the launcher's own
`+set` arguments or active game directory reach the game. `start()` takes a separate branch for
this — a detached, `unref()`d spawn with no exit listener — because a cold `steam` process
_becomes_ the Steam client and never exits; there is no child process left to observe, so no
playtime is ever recorded for it. The phase this reaches is a dedicated terminal state,
`handed-off`, never `running` — `isRunning()` treats it as not running. The write guard's
blocking set covers only `starting`/`running`, so a handed-off installation stays writable; the
launcher has no way to hold its own writes back from a game it can no longer see, and says so
rather than pretending otherwise.

## Unlock codes

Story 128: a code (`q2l1.<payload>.<sig>`, an Ed25519-signed payload of feature
names, a launcher installation id, and two timestamps) gates a feature per
machine. Verification is **main-only**: `src/main/services/unlock/verify.ts`
holds the only code path that accepts or rejects a code, and the private key
never exists anywhere near this repository or the renderer — the renderer
only ever calls `unlock:redeem` over IPC and reads back a verdict, never the
key or the raw signed bytes.

Two independent clocks are checked, and they must not be confused:

- the **redemption window** (`redeemBy`) gates _entering_ a code — once a code
  has been redeemed inside its window, the window no longer matters, even
  across restarts;
- **feature expiry** (`expiresAt`) is separate and re-checked on _every_
  verification, including every app start — a code stays revocable-by-time
  long after its redemption window has closed.

`UnlockService` (`src/main/services/unlock/service.ts`) is the one place that
tells the two apart: `verifyUnlockCode` is called with `mode: 'redeem'` only
from `redeem()`, and with `mode: 'reverify'` everywhere else (`init()` on
boot, `snapshot()` for the settings UI) — `reverify` never looks at
`redeemBy`. Redeemed codes are persisted under `state.json`'s `unlock` key
(`code`, `redeemedAt` only — nothing that could drift from what the code
itself says), and the in-memory active-feature set is rebuilt from a fresh
reverify pass every time the service starts.

**Known limits**, deliberately not defended against: a user can move their
system clock backward to keep an expiring feature alive, and the launcher
installation id is derived on the same machine it protects, from a value
(`MachineGuid`/`/etc/machine-id`) a determined user can read and spoof. This
is gatekeeping for a legitimate feature rollout, not a security boundary
against a hostile local user.

The public surface other code reaches through is `AppContext.unlock`:

- `isUnlocked(feature)` — whether `feature` is active right now;
- `unlockedFeatures()` — the full active set;
- `redeem(code)` — the only path that can add a new persisted code;
- `snapshot()` — every stored code with its current status, for the settings UI.

## Modules as built

Everything past the shell is a module, one of the eight `ModuleId`s in
`src/shared/types/module.ts`: seven are built, `assets` is planned.

- `home` — the home screen: the community news carousel (feed fetched by `home/news/`, slide
  images cached by `home/images/` and served over `q2launcher://news-image/`) and the dashboard
  grid of tiles the user arranges.
- `library` — the installation library view; its one handler, `stats`, feeds the stats row.
- `config` — config profiles: the settings, controls, aliases and raw-file editors, assigning a
  profile to installations and writing it into the game's files
  ([system doc](systems/config-module.md)).
- `downloads` — installing and maintaining the game: the bootstrap wizard, engine update and
  rollback, repair and retail upgrade, each a job, plus the Downloads tab
  ([system doc](systems/install-module.md)).
- `mods` — the mod catalog, installing, updating and removing mods as jobs, listing and revealing
  installed mods, and whether an installation has a server's map.
- `servers` — the server browser: master and HTTP list sources, LAN discovery, server queries,
  favourites, history, saved quick filters, and the watchlist behind the `watchlist` feature.
- `replays` — demos: discovery across installations, extra folders and zip archives with an
  index cache, per-demo details in sidecars (favourite, rating, sides), rename, and playback with
  timeline, console, stage and cinema modes.
- `assets` — planned: a `MODULE_MANIFESTS` entry with `status: 'planned'` and nothing else, so its
  route renders `PlannedModuleView` (what the module will do, which capabilities it needs).

The seams a module is built on, each described once:

- **The module bus.** Requests go through one shell-owned channel, `module:invoke`, with a
  `{ moduleId, type, payload }` envelope; events come back on `module:event`. Handlers are keyed
  `moduleId/type`, so modules cannot answer for each other and a module never widens the
  renderer's IPC surface. `MainModuleRegistry.invoke` (`src/main/modules/registry.ts`) returns
  one `Outcome` envelope: a handler's `Outcome<R>` passes through unchanged, an unknown handler is
  `modules.error.notImplemented`, a bad payload `ipc.error.invalidPayload`, and a throw or a
  non-`Outcome` result `modules.error.handlerFailed` (see [The IPC contract](#the-ipc-contract)).
  A module typed from a contract builds its half with `defineModule<XContract>(id, schemas)`
  (`src/main/modules/define-module.ts`) and its client with `createModuleClient<XContract>(id)`,
  so request and result types come from the contract instead of a cast. Two coverage tests keep
  the bus honest: `src/main/modules/handler-coverage.test.ts` (every declared handler of every
  loaded module is registered) and `src/renderer/src/modules/handler-coverage.test.ts` (every
  handler constant is referenced by its module's client).
- **Jobs.** Long-running work runs through the one `JobRunner`, `app.jobRunner` — see
  [Jobs](#jobs). `downloads` and `mods` produce jobs.
- **Persisted state.** Each module owns its `state.json` key in `src/main/modules/<id>/persisted.ts`
  and its shape-change steps in `persisted-migrations.ts` (only `config` has steps) — see
  [State and persistence](#state-and-persistence).
- **Features and unlock.** `app.features` (`src/main/features/gate.ts`) is a frozen snapshot of
  the unlocked features, resolved once at boot from the `UnlockService` (see
  [Unlock codes](#unlock-codes)). A handler registered with `{ feature }` is not registered at
  all while that feature is locked; the renderer reads the same set over `features:getUnlocked`
  and gates UI with `components/features/FeatureGate.tsx`.
- **The protocol handler.** `src/main/index.ts` registers the privileged `q2launcher` scheme and,
  in production, serves the renderer bundle from it with `PRODUCTION_CSP`, plus the cached news
  images under `q2launcher://news-image/` on the same origin (see
  [Dynamic styles under the production CSP](#dynamic-styles-under-the-production-csp)).
- **The UI harness.** `app.harness` is the `Q2L_UI_*` environment gate resolved once at boot
  (`resolveUiHarness` in `src/main/lib/ui-harness.ts`); a module reads its fixture overrides
  through it, never through `process.env` — see
  [Harness mode](UI-VERIFICATION.md#harness-mode-q2l_ui_harness).
- **The main-window observer.** `app.mainWindow` (`src/main/main-window-observer.ts`) is a
  read-only view of the main window — bounds, scale, minimized and focused state, and its
  move/resize/minimize/restore/focus/blur events — so a module never touches the `BrowserWindow`.
  The cinema overlay is the matching write-side service, see
  [Decisions: shell service for the cinema overlay](#decisions-shell-service-for-the-cinema-overlay).
- **Shutdown.** `src/main/shutdown.ts` runs the quit sequence: playback pipe release, module
  disposers in reverse registration order, then the stores settle — see
  [State and persistence](#state-and-persistence).

## Adding a module

The shell never needs editing to add a module. The steps, walked through `replays`
(`src/shared/modules/replays.ts`, `src/main/modules/replays/`, `src/renderer/src/modules/replays/`):

1. **Contract** — `src/shared/modules/<id>.ts` declares the handler names
   (`REPLAYS_HANDLERS`), the event names (`REPLAYS_EVENTS`), a zod schema per request and the
   result types. A module typed from a contract adds a schema map
   (`<ID>_HANDLER_SCHEMAS ... satisfies Record<string, ZodTypeAny>`) and a `type <Id>Contract`
   satisfying `ModuleContract` (`src/shared/modules/contract.ts`): `handlers` as `{ req, res }`
   per name (`req` via `z.infer` of the schema map, `res` the value inside `Outcome`) and
   `events` as name to payload — see `HomeContract` in `home.ts` and `ServersContract` in
   `servers.ts`. Every built module is contract-typed.
2. **`ModuleId` + manifest** — add the id to `ModuleId` and an entry to `MODULE_MANIFESTS` in
   `src/shared/types/module.ts`: title/description i18n keys, icon, route, nav placement,
   `status`, capabilities, `ipcNamespace`.
3. **State slot** — `src/main/modules/<id>/persisted.ts`: the schema, the forgiving parse, the
   defaults and `<id>State(app.state)` over `app.state.section()` (replays: `replaysState`, key
   `replays`), plus the module's line in the golden document of
   `src/main/modules/persisted-state.golden.test.ts`. A shape change adds a step to the module's
   `persisted-migrations.ts`, concatenated into `MODULE_MIGRATIONS` in `src/main/modules/index.ts`
   (see [State and persistence](#state-and-persistence)).
4. **Main half + registry** — `src/main/modules/<id>/index.ts` exports a `MainModule`
   (`replaysModule`), added to `MODULES` in `src/main/modules/index.ts`, which registers it with
   the `MainModuleRegistry` (`src/main/modules/registry.ts`) at boot, and to `DECLARED` in
   `src/main/modules/handler-coverage.test.ts`. `setup()` receives `handle`, `emit`, `app` (the
   services), a scoped `log` and `onDispose`. A contract-typed module binds them with
   `defineModule<XContract>(id, schemas).bind(setup)`, which types `handle` and `emit` against
   the contract and requires a schema for every handler. It never touches `ipcMain`,
   `BrowserWindow`, `electron` or `process.env`: its only way to the OS, the screen and the
   harness is `app.os` (open, reveal, copy), `app.displays`, `app.harness` (the resolved
   `Q2L_UI_*` gate), `app.env` (a frozen environment copy), `app.isPackaged` and
   `app.userDataDir`; `src/architecture.test.ts` enforces it. The only other electron-backed
   paths are the narrow shell libs a module may import (`lib/paths`, `lib/net/fetcher`,
   `lib/native-image`), which are not a general electron handle; each importing edge is an entry
   in `ALLOWED` in `src/architecture.test.ts`.
5. **Strings** — `src/renderer/src/modules/<id>/locale/en.json`, added to `MODULE_LOCALES_EN` in
   `src/renderer/src/modules/locales.ts` (replays keeps its keys under `replays.`); shell strings
   live in `src/renderer/src/i18n/locales/en.shell.json`. Main sends keys, never prose.
6. **Every handler returns `Outcome`** — `ok(value)` or `fail(key)` from `@shared/types`; a
   domain "no" is a `Refusal` built with `refuse()` inside `Outcome.value`. The registry passes
   the `Outcome` through unchanged (see [Modules as built](#modules-as-built)).
7. **Dispose via `onDispose`** — `setup()` keeps its state in its closure (no module-level `let`)
   and releases it through `onDispose`; replays registers one for each playback service
   (control, stop, stage follow, cinema) and one for its main-window subscription. The registry runs the disposers in reverse registration order at
   shutdown.
8. **Renderer half + client** — a view (and optionally a `settingsSection`) registered in
   `src/renderer/src/modules/index.ts` (replays: `ReplaysView`, `ReplaysSettingsSection`), and
   `src/renderer/src/modules/<id>/client.ts` over `moduleClient.ts`: a contract-typed module uses
   `createModuleClient<XContract>(id)`, whose `call` infers `Promise<Outcome<Res>>` and `on` the
   event payload. Add the handler map to `GROUPS` in `src/renderer/src/modules/handler-coverage.test.ts`.
9. **Flows and screens** — the module's user-facing behaviour is proven by flows in
   `scripts/flows/` (`replays-cinema.mjs`, `replays-copy-in.mjs`, ...), run with
   `npm run ui:flow -- <name>`, and every screen it adds is an entry in `SCREENS` in
   `scripts/lib/screens.mjs` (`replays-list`, `replays-detail`) — see
   [How to write a flow](UI-VERIFICATION.md#how-to-write-a-flow) and
   [How to add a screen to the registry](UI-VERIFICATION.md#how-to-add-a-screen-to-the-registry).
10. **Layering allowlist** — a module imports no other module; an edge that cannot be avoided is
    an `ALLOWED` entry in `src/architecture.test.ts` with its story number and reason (see
    [Layering and security guards](#layering-and-security-guards)).
11. **Docs** — the module's line in [Modules as built](#modules-as-built), and create or update
    `docs/systems/<id>-module.md` (purpose, map, persisted state, handlers, external inputs,
    limitations). Every later story that changes the module updates it.

Until the module's renderer half exists (step 8), the route renders `PlannedModuleView`, which states what the module will do
and which capabilities it needs. The roadmap lives in the product rather than only in a file.

### Jobs

Long-running module work is a `Job` in `JobsService`: the downloads module's bootstrap, engine
update and rollback, repair and retail-upgrade jobs and the mods module's install, update and
remove jobs. A job reports progress, and the action bar's download readout — bytes, speed, files
remaining, the `PLAYABLE` threshold marker — updates for free.

A module does not drive `JobsService` itself: every job runs through the one
`JobRunner.run(spec, body)` (`services/job-runner.ts`, `app.jobRunner`), which owns the lifecycle
and hands the body a `ctx`. The
runner owns the `AbortController` (the job's cancel aborts `ctx.signal` and kills
the handle registered with `ctx.setExtractor`), a `settled` promise that never
rejects, and the catch for a body that throws (it ends as
`downloads.error.diskWrite`). Writes go through `ctx.write`, which runs the
installation write guard and maps a cancelled write to `'cancelled'`. `jobs.finish`
is called once, and never over a job the user already cancelled. Every
installation a job wrote into is revalidated in a `finally`-style step before the
job finishes, even when the write or the body failed.

Exclusivity: a spec with `exclusive: 'installation'` is refused with
`jobs.error.installationBusy` while any module's active job targets that
installation. The check and `jobs.create` share one synchronous turn, so two
starts cannot both pass.

`dev:simulateJob` (development builds only) emits a fake job so the UI can be
worked on without a real download.

## Renderer

The shell store (`store/useLauncher.ts`, Zustand) mirrors the main-process state
the shell needs; main owns it and the store only ever applies what main pushes. It is one of six
Zustand stores: two more are shell-wide (`usePrimaryActionStore` in `lib/primary-action.ts`,
`useOverlayRegistry` in `lib/overlay-registry.ts`) and three belong to a module
(`useConfigProfiles`, `useDemoEditorStore`, `usePlaybackStore`).
Selectors are plain hooks so components subscribe to the narrowest slice they need.

Routing is a `switch` in `AppShell.tsx`, not a router. There are a handful of
top-level destinations, no URLs, no nesting and no history worth the name. If deep
links (`quake2launcher://`) arrive later, `resolveView` is the one place to change.

### UI kit

`components/ui` holds the shared primitives; a feature uses them instead of rebuilding
them: `NameDialog` (one text field, submits once), `ConfirmDialog`, `Tabs` (manual
activation, arrow-key navigation), `RadioGroup`, the textarea in `controls.tsx`, and the
single `ErrorBoundary`. `useSubmitting` owns the in-flight flag of a dialog action, and
`useStartJob` in `components/jobs` starts a job and reports its refusal. `ui-kit-adoption.test.ts`
guards that these stay the only implementations.

### State

Four kinds of renderer state, picked in this order:

- **Main-owned data** (lists and values main holds): `useModuleQuery` /
  `useModuleMutation` (`lib/useModuleQuery.ts`) — one hook for cancellation, error
  mapping, applying main's returned value and subscribing to pushes — or the shell
  store's mirror for what the shell itself shows.
- **Cross-view renderer state of one module**: a module Zustand store.
- **A handle a subtree shares**: a React context.
- **Everything else**: component state.

### Design system

`styles/index.css` holds the tokens in a Tailwind v4 `@theme` block — surfaces,
ink ramp, the amber `flame` ramp, `strogg` green, `rust`, semantics, type scale,
radii, motion. Contrast ratios are noted in comments next to the text tokens.

`styles/surfaces.css` holds the handwritten surfaces and is imported **into the
`components` layer**:

```css
@import './surfaces.css' layer(components);
```

That is not cosmetic. CSS gives unlayered rules priority over layered ones
regardless of specificity, so while `surfaces.css` was unlayered, `.panel-raised`'s
`position: relative` silently beat Tailwind's `fixed` utility — which put every
portalled hover card in the wrong place. Custom classes belong in `components` so
utilities can override them.

Floating elements (`HoverCard`, `Menu`) render into portals, because the
installation rail is a scroll container and `overflow-y: auto` clips horizontal
overflow. They position themselves from the anchor alone — width is known from the
class, and they anchor by top or bottom edge depending on which half of the window
the trigger is in — so there is no measure-then-reposition pass that can fail.
Both measure via `lib/anchor-rect.ts`, which falls back to the first child when the
wrapper is `display: contents` and therefore has no box.

#### Dynamic styles under the production CSP

The production policy is `style-src 'self'` (`PRODUCTION_CSP` in
`src/main/lib/renderer-source.ts`) — no `'unsafe-inline'`. That does **not** mean
styles cannot be computed at runtime; it means only one of the two ways of applying
them is still open.

Permitted, because both are CSSOM writes and `style-src` does not govern the CSSOM:

- React's `style={{ ... }}` prop, which React applies via
  `node.style.setProperty(...)`.
- A CSS custom property set from script —
  `element.style.setProperty('--foo', value)` — read back by a rule in
  `src/renderer/src/styles/` as `var(--foo)`. This is the escape hatch when a value
  has to reach a pseudo-element, a descendant, or a media/state variant that an
  inline `style` prop cannot address.

Blocked by this policy, and not to be introduced:

- `setAttribute('style', ...)` (and `cssText`) — a _parsed_ style attribute, which is
  what `style-src-attr` covers, unlike the property-by-property CSSOM write above.
- A literal `<style>` block, whether authored in markup or built with
  `document.createElement('style')` — `style-src-elem`.
- CSS injected through `dangerouslySetInnerHTML`, which lands as one of the two forms
  above.

The distinction is easy to lose, since the permitted and blocked forms differ by one
method call and produce the same visual result in development, where `DEV_CSP` still
carries `'unsafe-inline'` for Vite's HMR `<style>` injection. So it is enforced rather
than trusted: `scripts/lib/harness.mjs` asserts the served header contains
`style-src 'self';` (with the trailing semicolon, so a re-added `'unsafe-inline'`
cannot satisfy the check as a prefix) and collects the page's
`securitypolicyviolation` events into `RunLog.cspViolations`, so a violation fails a
`ui:verify` run the same way a console error does. Note that `ui:flow` shares the
collector but does not read it — a flow's pass/fail only reflects its own steps.

## Errors and logging

- **Expected failures are an `Outcome`**, returned to the caller (a refused write, a missing
  file, a bad payload). **A bug throws**; nothing catches it to turn it into a value.
- **A bare `catch` says what it swallows**: either a comment naming the failure class it
  tolerates (`// the file may not exist yet`) or a call to `log.caught(message, error)` from
  `scopedLogger` in `src/main/lib/logger.ts`, which logs at `warn` with the error last. Bare catches that
  predate the rule are not migrated; a file you edit gets its catches brought in line.
- **Levels.** `error` — a bug or lost user data. `warn` — degraded but handled. `info` —
  lifecycle (start, stop, job finished). `debug` — developer detail.
- **Always pass the `Error` object**, not `error.message`, so the stack reaches the log file.
- **No secrets and no user paths at `info`** — the log file is what users attach to bug reports.

## Renderer state

Pick in this order:

1. **Main-owned data** — a query hook (`useModuleQuery` / `useModuleMutation` in
   `lib/useModuleQuery.ts`) or, for what the shell itself shows, the shell store's mirror.
2. **Cross-view state of one module** — a module Zustand store.
3. **State a subtree shares** — a React context (e.g. `ProfileDraftProvider` in `config`).
4. **Everything else** — component state.

## Inside a renderer module

A module folder under `src/renderer/src/modules/<id>/` is laid out as:

- The `View` and its tabs sit at the module root, next to `client.ts` and `locale/`.
- `components/` — the module's presentational pieces and panels.
- `dialogs/` — the module's dialogs.
- `hooks/` — hooks, one per file, camelCase `useX.ts`.
- `lib/` — React-free logic (no hooks, no JSX), unit-testable without a DOM.

Not every module has every folder yet; a folder appears when the module needs it.

## Testing

Vitest runs main, shared and renderer tests (`.tsx` opts into jsdom with a docblock). The shared
kit keeps runs quiet and binary-free:

- `src/test-support/setup.ts` runs before every file; `vitest.config.ts` aliases `electron` and
  `electron-log/main` to `electron-stub.ts` / `electron-log-stub.ts`, so no Electron binary is
  needed and the logger prints nothing. A per-file `vi.mock('electron')` still wins; there is no
  global `console` mute, so a new warning shows up in the run.
- The kit lives in `src/test-support/` (`installTempDir`, `fakeAppContext`, `fixtures.ts` with
  `makeInstallation` / `makeJob` / `makeConfigProfile`), `src/renderer/src/test-support/mock-client.ts`
  and `src/main/modules/downloads/test-support.ts` (downloads fakes). Do not redefine them locally.
- Renderer client mocks go through `mockClient`:
  `vi.mock('./client', (importOriginal) => mockClient<typeof import('./client')>(importOriginal, {...}))`.
  Every function export becomes a `vi.fn()`; `overrides` are typed against the module.
- Prefer real temp dirs (`installTempDir(prefix)`, removed after each test) over fs mocks.
- Test files are named for behaviour, not stories; story numbers appear only in `it()` names.
- A test file stays under 1,500 lines. Split as `<name>.<behaviour>.test.ts` with shared setup in
  `<name>.test-helpers.ts`. `scripts/test-kit.test.mjs` enforces the cap and the kit rules above.

## Window chrome

`frame: false` with a React title bar, matching the reference launchers. The
trade-off: Windows 11 snap layouts (the flyout on the maximize button) are
unavailable without `titleBarStyle: 'hidden'` + `titleBarOverlay`, so the title bar
implements double-click-to-maximize instead. Switching to the native overlay is a
contained change in `src/main/window.ts` if snap layouts matter more than the
custom buttons.

Geometry is persisted from `getNormalBounds()` (the pre-maximize rectangle) and a
saved position that is no longer on any display is dropped, so unplugging a monitor
cannot strand the window off-screen.

### Decisions: shell service for the cinema overlay

Story 187's cinema mode lays a transparent, frameless window over the primary display. It is
exposed to modules as `app.cinemaWindow` (`open()`, `close()`, `isOpen()`, `raise()`, `onClosed(cb)`,
`src/main/cinema-window.ts`) - a narrow shell service like the main-window observer, because
modules never touch a `BrowserWindow` and a window is not per-installation data. It shares the
main window's preload and `webPreferences` (`rendererWebPreferences()`) and its popup/navigation
guard (`hardenWebContents()`, both in `src/main/window-shared.ts`), so the overlay is exactly as
privileged as the launcher window and no more. Its page, `cinema.html`, is served from the same
origin, so the same CSP (response header in dev, protocol handler in production) covers it.

### Decisions: the staged game stays on top on X11

On an X11 session (`stageWindowKeeper()` in `replays/stage.ts`) the launcher restacks the staged
game window itself: each placed stage session gets a keeper (`replays/x11/`, a minimal X11 client
over `node:net`) that finds the window by the PID of main's own spawn, strips its decorations and
sets or clears always-on-top as the follower asks. If it gives up, the `playback.display` event
carries `stageNotice` and the view says so; cinema also raises the overlay via `app.cinemaWindow.raise()`.
Windows and Wayland construct none of this.
