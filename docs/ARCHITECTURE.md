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
  development, not a rejected promise a user stumbles into months later.
- **preload** builds its allowlist from the same file. `INVOKE_CHANNELS` and
  `EVENT_CHANNELS` are runtime arrays, and compile-time assertions
  (`ALL_INVOKE_CHANNELS_LISTED`) fail the build if a channel is added to a map but
  not to the array.
- **renderer** gets end-to-end types from `window.q2.invoke(...)`.

Push traffic (main → renderer) uses `IpcEventMap` and the `Broadcaster` service.

Payloads that cross from the renderer are validated in main with zod
(`src/main/lib/schemas.ts`). Channels returning `Outcome<T>` turn a bad payload
into a failed outcome; channels returning a plain value throw, because a malformed
payload there is a renderer bug rather than user input.

**Paths are never trusted.** `app:revealPath` only opens folders belonging to a
registered installation or the launcher's own data directories. A mod directory is
validated as a single ASCII token (`^[A-Za-z0-9_.-]+$`), which rules out traversal,
absolute paths and reserved device names in one check.

## State and persistence

Two files under `app.getPath('userData')`:

- `state.json` — `schemaVersion`, settings, installations. Written only on real
  changes.
- `window-state.json` — window geometry. Its own file because it changes on every
  resize and that write churn has no business near the installation list.

`JsonStore` (`src/main/lib/json-store.ts`) writes atomically: serialise to
`<file>.tmp`, copy the current file to `<file>.bak`, then rename over the target.
A crash mid-write cannot leave a half-written file. An unparseable file is moved
aside as `<file>.corrupt-<timestamp>`, the backup is tried, and the user is told
via a toast — losing an installation list silently is not acceptable.

Parsing is deliberately forgiving. Every settings field has a `.catch()` default,
and installations are parsed row by row so one bad entry is dropped instead of
taking the file with it. Migrations live in `src/main/services/migrations.ts`;
`MIGRATIONS` is empty at v1 and carries a worked example in its doc comment.

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

## Adding a module

Everything past the shell is a module: `config`, `downloads`, `mods`, `assets`. The
shell never needs editing to add one.

1. **Contract** — `src/shared/modules/<id>.ts`: the handler names and the data
   shapes. See `library.ts`.
2. **Manifest** — add the id to `ModuleId` and an entry to `MODULE_MANIFESTS` in
   `src/shared/types/module.ts` (title/description i18n keys, icon, route, nav
   placement, capabilities). Manifests already exist for all four planned modules.
3. **Main half** — a `MainModule` in `src/main/modules/<id>/index.ts`, registered
   in `src/main/modules/index.ts`. It receives `handle`, `emit`, `app` (the
   services) and a scoped logger. It never touches `ipcMain`, `BrowserWindow` or
   the state file.
4. **Renderer half** — a view, registered in `src/renderer/src/modules/index.ts`,
   plus a typed client over `callModule()`.
5. **Strings** — add the i18n keys.

Until step 4 exists, the route renders `PlannedModuleView`, which states what the
module will do and which capabilities it needs. The roadmap lives in the product
rather than only in a file.

Module request traffic goes through one shell-owned channel, `module:invoke`, with
a `{ moduleId, type, payload }` envelope. Handlers are keyed `moduleId/type`, so
modules cannot answer for each other and — more importantly — a module can never
widen the renderer's IPC surface. Type safety per call is the module's own job,
which is what its typed client is for.

`library` is the working reference implementation. Its stats row in the library
view is fetched over `module:invoke`, so the seam is exercised end to end rather
than merely described.

### Jobs

Long-running module work uses `JobsService`. A module creates a `Job`, reports
progress, and the action bar's download readout — bytes, speed, files remaining,
the `PLAYABLE` threshold marker — updates for free. No module produces jobs yet;
`dev:simulateJob` (development builds only) emits a fake one so the UI can be
worked on before the downloads module exists.

## Renderer

One Zustand store (`store/useLauncher.ts`) mirrors main-process state; main owns
it and the store only ever applies what main pushes. Selectors are plain hooks so
components subscribe to the narrowest slice they need.

Routing is a `switch` in `AppShell.tsx`, not a router. There are a handful of
top-level destinations, no URLs, no nesting and no history worth the name. If deep
links (`quake2launcher://`) arrive later, `resolveView` is the one place to change.

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
