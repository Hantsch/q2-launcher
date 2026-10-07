---
name: electron-arch
description: "Layering and security rules for Electron apps (main / preload / renderer + a pure shared layer). Use when: creating or editing anything under a main, preload or renderer source tree; creating a BrowserWindow or setting webPreferences; adding filesystem, registry, shell or child-process access; handling a path or any other value that came from the renderer; adding openExternal, navigation or window-open handling; setting a Content-Security-Policy or a permission handler; spawning a process; adding a module/feature to an Electron app; adding persisted state for a module; handling app quit/before-quit; a module importing another module or electron directly; reviewing Electron code for privilege leaks. DO NOT USE FOR: web-only React apps; the IPC contract mechanics (use typed-ipc); backend services."
---

<!-- tech-rules:managed 2.3.0 -->

# Electron Architecture and Security

Four layers, one direction of trust. The renderer is treated as hostile even though it is your own
code - that is the only assumption that survives a compromised dependency.

## Layers

```
src/
  shared/     contract + pure domain logic shared by main and renderer
              no node:*, no electron, no DOM types - compiled into both TS projects
  main/       Electron main process: services, IPC registrars, window, modules
  preload/    the contextBridge surface, with a channel allowlist derived from shared/
  renderer/   the UI. No node, no electron, no fs - ever
```

Some projects split the pure layer in two: `src/core/` for domain logic (parsers, planners,
analysers) and `src/shared/` for the IPC contract. Either shape is fine; what matters is that the
pure layer stays pure. **Nothing in it may import `node:*` or `electron`, or use DOM types.** That
single constraint is what lets the same domain model and contract be used on both sides without
duplication - and it is checkable, so check it: see *The layering test* below.

Two TypeScript projects, both including the shared layer: `tsconfig.node.json` for main/preload,
`tsconfig.web.json` for renderer.

**Main and preload stay CommonJS deliberately.** A sandboxed preload cannot use ESM imports; an ESM
preload has to be `.mjs` and loads asynchronously, which races `contextBridge` exposure. The bundler
handles the rest, so CJS costs nothing here.

## The trust boundary

- **All privileged work happens in main.** Filesystem, registry, `child_process`, `shell`, native
  dialogs. The renderer never touches them, and neither does the preload beyond forwarding.
- **The preload is a narrow, typed forwarder.** It exposes exactly one object via
  `contextBridge.exposeInMainWorld`, with an `invoke` and an `on` function that check the channel
  against an allowlist derived from the contract. No convenience helpers, no re-exported `fs`, no
  `ipcRenderer` handed through.
- **Every payload crossing from the renderer is validated in main**, with a schema library (zod or
  equivalent), at the boundary - not deeper in, where a caller might have skipped it.
- **The renderer supplies intent, never authority.** It asks to reveal a folder; it does not say
  which absolute path may be revealed. Main decides, from state it owns.

## Path containment

Any path that originates in the renderer is contained before use. One helper, used at every entry
point:

```ts
import { isAbsolute, relative, sep } from 'node:path'

/**
 * Every path the renderer asks for must resolve inside the root the user picked.
 * The renderer is not trusted to stay in bounds on its own.
 */
function assertInside(root: string, target: string): void {
  const rel = relative(root, target)
  // relative() hands back the absolute target when it is on another drive - isAbsolute catches that
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path is outside the allowed root: ${target}`)
  }
}
```

Rules around it:

- Resolve to an absolute path first, then contain. Containing a relative path proves nothing.
- The root comes from main-owned state (a registered installation, the app's own data directory),
  never from the same request that carries the target.
- A reveal/open operation is restricted to roots the app knows about, not to "any directory".
- Where a value is a name rather than a path, validate it as a name: a single token matched against
  `^[A-Za-z0-9_.-]+$` rules out traversal, absolute paths and Windows reserved device names in one
  check. Prefer that over sanitising a path.
- Contain before the operation, and again after resolving symlinks if the platform allows them in
  that location.

## Security checklist for every window and session

- **`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.**
  Where `sandbox: false` is unavoidable, that is a documented exception with a reason, not a default.
- **A strict Content-Security-Policy set on the session**, not only in a meta tag:

  ```ts
  const policy = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })
  ```

  The dev policy needs `unsafe-inline`/`unsafe-eval` for fast refresh and a websocket for HMR; the
  production policy must not.
- **Deny all permission requests by default.** Most desktop apps need no camera, microphone,
  geolocation or notifications:

  ```ts
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  ```

  Grant a specific permission explicitly if a feature genuinely needs it.
- **Deny every window-open, and route external links to the browser** - after checking the scheme:

  ```ts
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  ```

  The scheme test is the point: `shell.openExternal` on an unchecked URL hands the OS a `file:`,
  `smb:` or custom-protocol target chosen by whatever produced that string.
- **Block navigation away from your own content:**

  ```ts
  window.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    const allowed = devServer ? url.startsWith(devServer) : url.startsWith('file://')
    if (!allowed) { event.preventDefault(); log.warn(`blocked navigation to ${url}`) }
  })
  ```

- **Spawn with an argument array, never a shell string.** `spawn(exe, [arg1, arg2])`, no
  `shell: true` where any part of the command line can come from data. Pass a working directory
  instead of embedding a path in an argument - it sidesteps quoting entirely for the value most
  likely to contain spaces.
- **Single-instance lock** when the app owns files or launches processes: a second instance fights
  over the state file and can start the same thing twice.

  ```ts
  if (!app.requestSingleInstanceLock()) app.quit()
  else app.on('second-instance', () => { /* restore and focus the existing window */ })
  ```

- **No remote content in the app window.** If something must come from the network, it goes in the
  user's browser or a separate, restricted view.

## State and persistence

- Persisted files live under `app.getPath('userData')`, one file per write pattern. Geometry that
  changes on every resize does not belong in the same file as the domain state, because that write
  churn then endangers the data that matters.
- **Writes are atomic:** serialise to `<file>.tmp`, keep the previous good copy as `<file>.bak`,
  then rename over the target. A crash mid-write cannot leave a half-written file.
- **A damaged file is quarantined, not overwritten:** move it to `<file>.corrupt-<timestamp>`, try
  the backup, then fall back to defaults - and tell the user which of the three happened. Losing
  state silently is worse than failing loudly.
- **Parsing is forgiving on purpose:** per-field defaults, and collections parsed row by row so one
  bad entry is dropped instead of taking the file with it.
- **Schema migrations are an ordered, append-only list.** Never edit a shipped step; add a new one.
  A step is pure and must not throw. Bump the schema version in the same commit as the step.

A ready-made implementation of all of this can be copied into the project - ask for it with
`/tech-rules:setup`, which offers the store as a one-time file you then own yourself. Four more
rules decide whether what it holds survives thirty sprints of modules:

- **A module owns its persisted section.** In `setup` it registers `{ key, parse, defaults }` with
  the shell's store and gets back a typed `{ get(), update(fn) }`; schema, forgiving parse,
  defaults, the module's own migration steps and their tests live in `modules/<id>/persisted.ts`.
  The shell's state file holds shell state only and its schema file does not grow when a module is
  added. A key no registered section claims is preserved verbatim across load and save, so a
  disabled or not-yet-loaded module loses nothing.

  ```ts
  // shell: one store, typed sections handed out on request
  interface SectionSpec<T> { key: string; parse: (raw: unknown) => T; defaults: () => T }
  interface Section<T> {
    get(): T
    /** `fn` receives the live value; the result is stored and a write is scheduled. */
    update(fn: (current: T) => T): T
  }
  declare function section<T>(spec: SectionSpec<T>): Section<T>

  // module: in setup(); the key is the module id, parse and defaults come from persisted.ts
  const state = app.state.section({ key: 'notes', parse: parseNotesState, defaults: defaultNotesState })
  state.update((s) => ({ ...s, sort: next }))
  ```

- **A slice is changed through its mutator, never read-spread-set across an `await`.** The
  callback sees the live value at the write. `const cur = state.get(); await stat(dir);
  state.update(() => ({ ...cur, folders }))` writes back a snapshot: whatever a sibling field
  received during the `await` is silently reverted, and no test notices until two handlers run at
  once. Do the async work first, then `update` with its result; offer no whole-section setter
  (`setX(whole)`), so the stale write cannot compile.
- **Shutdown is a sequence the shell awaits, not a fire-and-forget.** An unsettled debounced store
  loses its last window of changes; a `dispose` nobody calls is a leak, and the reason modules keep
  module-level `let` singletons just so a static `dispose()` can reach them. Instead: `setup`
  keeps its state in its closure and registers releasers with `onDispose(cb)`; the shell runs them
  in reverse registration order, one throwing does not stop the rest; every store joins one
  shell-owned list when created. On quit, bounded to 2-3 s - a hanging shutdown is worse than a
  lost debounce window - log what failed or timed out, then quit anyway:

  ```ts
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return              // the app.quit() below fires this again - let it through
    quitting = true
    event.preventDefault()
    releaseChildProcesses()           // synchronous and first: a pipe's last write may depend on it
    void (async () => {
      const work = Promise.all([modules.disposeAll(), ...stores.map((s) => s.settle())])
      const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000))
      const outcome = await Promise.race([work.then(() => 'ok'), timeout]).catch((e) => e)
      if (outcome !== 'ok') log.error('shutdown did not complete cleanly', outcome)
      app.quit()
    })()
  })
  ```

- **A failed write is retried once, then surfaced to the user - never only logged.** After a failed
  rename the cache already holds the new value, so reads report success and `settle()` resolves
  normally; `.catch(log.error)` on the write chain
  lets a whole session vanish with nobody told. Retry once after a short delay, then report through
  the store (`onPersistError`) so the shell shows one notice per session, and have `settle()`
  return whether it succeeded so the quit path can log it.

## Adding a feature

Past the shell, a feature is a module, and the shell does not get edited to add one:

1. **Contract** - the handler names and data shapes in the shared layer, typed end to end; the
   module bus is a contract like the shell channels, and `typed-ipc` owns its shape.
2. **Manifest** - register the module id and its metadata (title, icon, route, capabilities) in one
   list, so the shell can render it without knowing what it is.
3. **Main half** - a module object that receives the services it needs plus a scoped logger. It
   never touches `ipcMain`, `BrowserWindow` or the state file directly, never imports `electron` or
   reads `process.env` - the shell hands in services and a frozen harness/config object instead.
4. **Persisted section** - `modules/<id>/persisted.ts` with schema, forgiving parse, defaults and
   the module's own migration steps, registered through `section()` in `setup`. The shell's
   schema file is not edited.
5. **Dispose** - every timer, subscription, worker and child process `setup` starts is released by
   an `onDispose(cb)` registered in the same place; state lives in `setup`'s closure, not in a
   module-level `let`.
6. **Renderer half** - a view, registered in one place, plus a typed client.
7. **Strings** - the i18n keys. Main sends keys across IPC, never prose: translation belongs to the
   renderer's bundle.

Module traffic goes through one shell-owned channel with a `{ moduleId, type, payload }` envelope,
keyed `moduleId/type`. Modules then cannot answer for each other and - more importantly - a module
can never widen the renderer's IPC surface.

**No placeholder handlers.** A registered channel that only throws "not implemented" looks finished
from the outside and turns into a user-facing rejection. Either the channel works or it does not
exist; if a route is planned but empty, say so in the UI, not in a handler.

## The layering test

Every rule above about who may import what is checkable, and prose that is not checked decays: in
one project the shell channels and the pure layer, which had tests, held for thirty sprints; module
boundaries, state ownership and lifecycle, which had only prose, did not. So the check has a shape -
**one test file in the node project** that walks both trees, main and renderer, resolves every
import specifier and asserts one layer rule per `it`:

- `shared/**` imports no `node:*` or `electron` and mentions no DOM type
- `renderer/**` imports no `electron` or `node:*`
- `main/modules/<a>/**` imports nothing from `main/modules/<b>/` except entries on an allowlist
- shell files under `main/` import only the modules' `index`/`registry` from the modules tree
- no `electron` import and no `process.env` read under `modules/`
- the renderer shell (`components/**`, `views/**`) imports nothing from `renderer/.../modules/**`
  except the module index; `renderer/.../modules/<a>` imports `modules/<b>` only through
  `modules/<b>/public.ts`; any other cross-module import is an allowlist entry (`renderer-guidelines`
  states these two rules and points here instead of keeping a test of its own)
- optionally, soft size caps (a module `index.ts` above N lines fails, with the number in the message)

```ts
// src/architecture.test.ts - node project; files(glob) walks the tree, the expect* helpers read imports
it('shared is pure', () => expectNoImport(files('src/shared/**'), [/^node:/, /^electron$/], { dom: false }))
it('renderer never reaches node or electron', () => expectNoImport(files('src/renderer/**'), [/^electron$/, /^node:/]))
it('modules never import electron', () => expectNoImport(files('src/main/modules/**'), [/^electron$/]))
it('modules never read process.env', () => expectNoToken(files('src/main/modules/**'), /process\.env/))
it('modules do not import each other', () => expectNoCrossModuleImport(files('src/main/modules/**'), ALLOWLIST))
it('the shell sees only the modules index and registry', () =>
  expectImportsInto(files('src/main/!(modules)/**'), 'src/main/modules/', ['index', 'registry']))
it('the renderer shell sees only the modules index', () =>
  expectImportsInto(files('src/renderer/src/!(modules)/**'), 'src/renderer/src/modules/', ['index']))
it('renderer modules reach each other only through public.ts', () =>
  expectNoCrossModuleImport(files('src/renderer/src/modules/**'), ALLOWLIST, { except: 'public' }))

/** Every entry names the story or decision that allows it; the next test fails on one that does not. */
const ALLOWLIST = [
  { from: 'editor', to: 'library/thumbnails', decision: 'story 042: one thumbnail cache; hoisting is story 051' },
]
it('the allowlist carries a reason per entry', () =>
  ALLOWLIST.forEach((e) => expect(e.decision, `${e.from} -> ${e.to}`).toMatch(/story \d+|ADR-\d+/)))
```

Why one tree-walking test and not a purity test per folder: a per-file test reads its own folder
with `node:fs`, so with two TypeScript projects each per-folder purity test needs its own
`tsconfig.web.json` exclude; a guard inside a module is invisible from elsewhere and goes red at a
gate because the implementer could not find it; one file at the root is the one place a rule is
added, and a new module is covered on the day it is created. The allowlist only shrinks - a new
entry carries a story or decision reference (`story 042`, `ADR-7`), not a convenience - and the
test, not a reviewer's memory, refuses an entry without one. One allowlist serves both trees.

A linter can mirror the import rules so they show while typing: `oxlint` is independent of the
TypeScript version (no `typescript-eslint` peer dependency to wait for) and its
`no-restricted-imports` takes per-directory overrides. Use whichever linter the project has; the
test stays the gate - it checks the allowlist's reasons and shell-side rules a linter cannot express.

## Review checklist

- [ ] Nothing in the shared/core layer imports `node:*`, `electron` or DOM types
- [ ] `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity` all set correctly
- [ ] Preload exposes one narrow object with an allowlist check on both invoke and subscribe
- [ ] Every renderer payload validated in main at the boundary
- [ ] Every renderer-supplied path resolved and passed through `assertInside` against a main-owned root
- [ ] Names validated as names (`^[A-Za-z0-9_.-]+$`), not sanitised as paths
- [ ] CSP set on the session; the production policy has no `unsafe-*`
- [ ] Permission handler denies by default
- [ ] `setWindowOpenHandler` denies, and checks the scheme before `openExternal`
- [ ] `will-navigate` blocks anything outside the dev server / `file://`
- [ ] `spawn` gets an argument array; no `shell: true` with interpolated data
- [ ] Single-instance lock where the app owns files or launches processes
- [ ] State writes atomic, damaged files quarantined, migrations append-only, a failed write retried once and then shown to the user
- [ ] A module's persisted section is registered from `modules/<id>/persisted.ts`; the shell's state file and schema file hold shell state only
- [ ] Every slice change goes through its section mutator; no `get()` -> `await` -> write-back of the snapshot
- [ ] `before-quit` calls `preventDefault()` once, releases processes, awaits dispose-all plus every store's `settle()` under a bounded timeout, then quits
- [ ] Everything `setup` starts has an `onDispose`; no module-level `let` kept to make a static `dispose()` reachable
- [ ] The layering test exists, covers every rule in Layers (including no `electron` import and no `process.env` read under `modules/`) and the renderer's two import rules (shell sees only the module index; modules only through `public.ts`), and its allowlist has no entry without a story or decision reference
- [ ] No handler that only throws "not implemented"
