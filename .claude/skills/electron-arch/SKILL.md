---
name: electron-arch
description: "Layering and security rules for Electron apps (main / preload / renderer + a pure shared layer). Use when: creating or editing anything under a main, preload or renderer source tree; creating a BrowserWindow or setting webPreferences; adding filesystem, registry, shell or child-process access; handling a path or any other value that came from the renderer; adding openExternal, navigation or window-open handling; setting a Content-Security-Policy or a permission handler; spawning a process; adding a module/feature to an Electron app; reviewing Electron code for privilege leaks. DO NOT USE FOR: web-only React apps; the IPC contract mechanics (use typed-ipc); backend services."
---

<!-- tech-rules:managed 1.0.0 -->

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
duplication - and it is checkable, so check it.

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
import { relative, sep } from 'node:path'

/**
 * Every path the renderer asks for must resolve inside the root the user picked.
 * The renderer is not trusted to stay in bounds on its own.
 */
function assertInside(root: string, target: string): void {
  const rel = relative(root, target)
  if (rel.startsWith('..') || (rel.length > 0 && rel.split(sep)[0] === '..')) {
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
`/tech-rules:setup`, which offers the store as a one-time file you then own yourself.

## Adding a feature

Past the shell, a feature is a module, and the shell does not get edited to add one:

1. **Contract** - the handler names and data shapes in the shared layer.
2. **Manifest** - register the module id and its metadata (title, icon, route, capabilities) in one
   list, so the shell can render it without knowing what it is.
3. **Main half** - a module object that receives the services it needs plus a scoped logger. It
   never touches `ipcMain`, `BrowserWindow` or the state file directly.
4. **Renderer half** - a view, registered in one place, plus a typed client.
5. **Strings** - the i18n keys. Main sends keys across IPC, never prose: translation belongs to the
   renderer's bundle.

Module traffic goes through one shell-owned channel with a `{ moduleId, type, payload }` envelope,
keyed `moduleId/type`. Modules then cannot answer for each other and - more importantly - a module
can never widen the renderer's IPC surface.

**No placeholder handlers.** A registered channel that only throws "not implemented" looks finished
from the outside and turns into a user-facing rejection. Either the channel works or it does not
exist; if a route is planned but empty, say so in the UI, not in a handler.

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
- [ ] State writes atomic, damaged files quarantined, migrations append-only
- [ ] No handler that only throws "not implemented"
