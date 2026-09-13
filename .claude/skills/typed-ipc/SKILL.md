---
name: typed-ipc
description: "Contract-first, end-to-end typed IPC for Electron: one map of channels in the shared layer from which main handlers, the preload allowlist and renderer types all derive, with boot-time and compile-time exhaustiveness checks plus an IPC coverage test. Use when: adding, renaming or removing an IPC channel; adding a main-to-renderer event; writing or reviewing a preload bridge; adding an ipcMain handler; typing window.<bridge> in the renderer; seeing 'no handler registered for channel' at runtime; setting up IPC in a new Electron app. DO NOT USE FOR: Electron layering and security questions (use electron-arch); non-Electron IPC."
---

<!-- tech-rules:managed 1.0.0 -->

# Contract-First Typed IPC

One file is the single source of truth. Main handlers, the preload allowlist and the renderer's types
all derive from it, and three separate checks make a drift impossible to ship: a compile error, a
boot-time crash and a test.

**The rule:** add or change a channel in the contract *first*. Everything else follows from it, and
none of it compiles or starts if it does not.

## 1. The contract

In the shared layer (no `node:*`, no `electron`, no DOM), two maps:

```ts
/** Every request/response channel, in one place. */
export interface IpcInvokeMap {
  'app:getInfo': { req: void; res: AppInfo }
  'app:revealPath': { req: string; res: Outcome<null> }
  'installations:addExisting': { req: AddExistingInput; res: Outcome<Installation> }
}

/** Push traffic, main -> renderer. */
export interface IpcEventMap {
  'window:state': WindowChromeState
  'app:toast': ToastMessage
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeRequest<C extends InvokeChannel> = IpcInvokeMap[C]['req']
export type InvokeResponse<C extends InvokeChannel> = IpcInvokeMap[C]['res']
export type EventChannel = keyof IpcEventMap
export type EventPayload<E extends EventChannel> = IpcEventMap[E]
```

Naming: `domain:verb`, lower camel verb. The domain prefix is what keeps the map readable at fifty
channels and lets a module's channels be found by prefix.

**Return `Outcome<T>` for anything the user can cause to fail** (a folder that vanished, a file that
will not parse) and a plain value for anything only a bug can break. Then a rejected promise in the
renderer always means "our bug", never "expected failure", and the renderer stops needing try/catch
around normal operation.

## 2. Runtime channel arrays with a compile-time completeness check

The preload needs the channel names at runtime, but a hand-maintained list drifts. Use
`as const satisfies` plus an `Exclude<>` assertion so forgetting an entry is a compile error:

```ts
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'app:revealPath',
  'installations:addExisting',
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = ['window:state', 'app:toast'] as const satisfies readonly EventChannel[]

/**
 * Fails the build when a channel exists in the map but not in the array above.
 * `never` is the only assignable value, so a missing channel is a type error at
 * the assignment, naming exactly which one is missing.
 */
export const ALL_INVOKE_CHANNELS_LISTED: Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]> =
  undefined as never
export const ALL_EVENT_CHANNELS_LISTED: Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]> =
  undefined as never
```

`satisfies` catches a name that is not a channel; the `Exclude<>` assertion catches a channel that is
not in the list. You need both - either one alone leaves a hole.

## 3. The preload bridge

Typed, narrow, and it re-checks the allowlist at runtime. The compile-time work protects your own
code; the runtime check is what protects you from a compromised renderer.

```ts
const allowedInvoke = new Set<string>(INVOKE_CHANNELS)
const allowedEvents = new Set<string>(EVENT_CHANNELS)

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeRequest<C> extends void ? [] : [InvokeRequest<C>]
): Promise<InvokeResponse<C>> {
  if (!allowedInvoke.has(channel)) {
    return Promise.reject(new Error(`[preload] blocked invoke on unknown channel: ${channel}`))
  }
  return ipcRenderer.invoke(channel, ...(args as unknown[])) as Promise<InvokeResponse<C>>
}

function on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void {
  if (!allowedEvents.has(channel)) {
    throw new Error(`[preload] blocked subscription on unknown channel: ${channel}`)
  }
  const handler = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as EventPayload<E>)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('app', { invoke, on })
```

Note the void-request trick: `InvokeRequest<C> extends void ? [] : [InvokeRequest<C>]` means
`invoke('app:getInfo')` takes no second argument and `invoke('app:revealPath', p)` requires one.

`on` returns its own unsubscribe function. Never expose `removeListener` across the bridge - the
renderer cannot pass the same function identity back reliably, and a leaked listener is worse than
a slightly narrower API.

## 4. Main handlers and the boot-time assertion

Register through a typed wrapper, then assert completeness at boot:

```ts
function handle<C extends InvokeChannel>(
  channel: C,
  handler: (request: InvokeRequest<C>) => Promise<InvokeResponse<C>> | InvokeResponse<C>,
): void {
  registered.add(channel)
  ipcMain.handle(channel, (_event, request) => handler(request as InvokeRequest<C>))
}

/**
 * Throws when a declared channel has no handler. A missing handler is a startup
 * crash in development, not a rejected promise a user stumbles into months later.
 */
export function assertContractFullyHandled(): void {
  const missing = INVOKE_CHANNELS.filter((channel) => !registered.has(channel))
  if (missing.length > 0) throw new Error(`unhandled IPC channels: ${missing.join(', ')}`)
}
```

Call it at the end of registration, before the window loads.

**No placeholder handlers.** A handler that only throws "not implemented" satisfies the assertion
while presenting a finished-looking feature that fails on click. Do not write one, and do not keep a
helper around that builds one - if it exists, someone will use it.

## 5. The coverage test

The assertion runs at boot in development; a test makes it run in CI and adds what the assertion
cannot see. Mock `electron`, build the handler map without a real service container, import the
preload, and check:

- every channel in the contract has a handler (no missing, no extras)
- every event channel is forwarded by the preload - and only those
- no handler body matches a placeholder pattern (`/notImplemented|not implemented/`), scanned over
  the handler source files
- the preload exposes exactly the expected bridge shape

That last one is why the test imports the real preload rather than asserting on the arrays: it proves
the bridge the renderer actually receives, not the list it was built from.

## 6. Renderer usage

```ts
const info = await window.app.invoke('app:getInfo')          // AppInfo, inferred
const unsubscribe = window.app.on('app:toast', (toast) => …) // ToastMessage, inferred
```

Declare the bridge type once in a `.d.ts` for the renderer project, from the same contract types. The
renderer never hardcodes a channel string outside a typed call, and never reaches for `ipcRenderer`.

## Adding a channel: the whole procedure

1. Add the entry to `IpcInvokeMap` (or `IpcEventMap`) with its request and response types.
2. Add the channel name to `INVOKE_CHANNELS` / `EVENT_CHANNELS` - the build tells you if you forget.
3. Add a schema for the request payload if it comes from the renderer, and validate at the boundary.
4. Register the handler in main through the typed `handle()` wrapper - boot tells you if you forget.
5. Use it from the renderer through the bridge. No new type annotations needed.
6. Run the coverage test.

## Review checklist

- [ ] The channel exists in the contract map, with explicit request and response types
- [ ] The channel is listed in the runtime array; both completeness assertions still compile
- [ ] `Outcome<T>` for user-causable failure, a plain value where only a bug can break it
- [ ] Renderer payloads validated in main at the boundary
- [ ] Preload checks the allowlist at runtime for both invoke and subscribe
- [ ] `on` returns an unsubscribe; no `removeListener` across the bridge
- [ ] `assertContractFullyHandled()` still called before the window loads
- [ ] No placeholder handler, and no helper that builds one
- [ ] Coverage test passes: no missing channels, no extras, no placeholders
- [ ] No raw `ipcRenderer` use and no hardcoded channel string in the renderer
