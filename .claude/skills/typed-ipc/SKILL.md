---
name: typed-ipc
description: "Contract-first, end-to-end typed IPC for Electron: one map of channels in the shared layer from which main handlers, the preload allowlist and renderer types all derive, with boot-time and compile-time exhaustiveness checks plus an IPC coverage test. Use when: adding, renaming or removing an IPC channel; adding a main-to-renderer event; writing or reviewing a preload bridge; adding an ipcMain handler; typing window.<bridge> in the renderer; seeing 'no handler registered for channel' at runtime; setting up IPC in a new Electron app; adding a handler or event to a module:invoke bus; typing a module client; seeing Outcome<Outcome<T>> or a cast callModule<T>. DO NOT USE FOR: Electron layering and security questions (use electron-arch); non-Electron IPC."
---

<!-- tech-rules:managed 2.3.0 -->

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
 * Only `never` is assignable to `never`, so a missing channel is a type error at
 * the assignment - `Type '"x:y"' is not assignable to type 'never'` - naming it.
 */
export const ALL_INVOKE_CHANNELS_LISTED: never =
  undefined as unknown as Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>
export const ALL_EVENT_CHANNELS_LISTED: never =
  undefined as unknown as Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>
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

## 7. The module bus is a contract too

`electron-arch` routes every feature through one shell-owned channel with a `{ moduleId, type, payload }`
envelope, keyed `moduleId/type` - right for the security surface (the preload allowlist never grows),
and the end of every guarantee in §1-§6 if you stop there: the shell map knows
`'module:invoke': { req: ModuleInvokeRequest; res: Outcome<unknown> }` and nothing else. Measured in one
project after thirty sprints, the bus carried 73 % of all handlers as string names with hand-chosen
`callModule<T>` generics and results cast on the way out; the registry wrapped every return in `ok()`,
so handlers already returning `Outcome` arrived as `Outcome<Outcome<T>>`, flattened four different ways
by four clients, once as a shipped crash.

The fix is §1 one level down: **each module owns a contract map in the shared layer, shaped like
`IpcInvokeMap`, and both halves derive from it.** The schema map beside it is to the bus what
`INVOKE_CHANNELS` is to the shell - the runtime list of handler names, typed complete against the map:

```ts
/** Every module's contract has this shape; a module's own map narrows it. */
export interface ModuleContract { invoke: Record<string, { req: unknown; res: unknown }>; events: Record<string, unknown> }
/** One schema per handler; a missing or extra schema is a compile error. */
export type ModuleSchemas<I extends ModuleContract['invoke']> = { [K in keyof I]: ZodType<I[K]['req']> }

/** shared/modules/news.ts - the only file the module's two halves both import. */
export interface NewsModule {
  invoke: {
    'news.get': { req: void; res: NewsFeed }
    'news.refresh': { req: void; res: Outcome<NewsFeed> }
    'slide.openUrl': { req: string; res: Outcome<null> }
  }
  events: { 'news.changed': NewsFeed }
}

export const NEWS_SCHEMAS = {
  'news.get': z.void(),
  'news.refresh': z.void(),
  'slide.openUrl': z.string().min(1).max(2000),
} satisfies ModuleSchemas<NewsModule['invoke']>
```

Handler names are `noun.verb`; the module id is the namespace. Where a schema already exists, `req` may
be `z.infer<typeof thatSchema>` - the map is still what both halves derive from.

**Main derives from the map.** `defineModule<H>(id, schemas)` wraps the untyped `ModuleSetup` the shell
hands a module in a typed one that registers the schema itself. The setup object carries more than
IPC - persisted-section access and `onDispose`, see `electron-arch` - but `defineModule` uses only
`handle(type, schema, handler)` and `emit(type, payload)`. A handler without a schema, with the wrong
payload type or with the wrong result type is a compile error at the `handle` call:

```ts
type Req<H extends ModuleContract, K extends keyof H['invoke']> = H['invoke'][K]['req']
type Res<H extends ModuleContract, K extends keyof H['invoke']> = H['invoke'][K]['res']

export function defineModule<H extends ModuleContract>(id: ModuleId, schemas: ModuleSchemas<H['invoke']>) {
  return {
    id,
    bind: (setup: ModuleSetup) => ({
      handle<K extends keyof H['invoke'] & string>(
        type: K,
        handler: (payload: Req<H, K>) => Promise<Res<H, K>> | Res<H, K>,
      ): void {
        setup.handle(type, schemas[type], handler)
      },
      emit<E extends keyof H['events'] & string>(type: E, payload: H['events'][E]): void {
        setup.emit(type, payload)
      },
    }),
  }
}

const news = defineModule<NewsModule>('news', NEWS_SCHEMAS)
// inside the module's setup(raw):
const { handle, emit } = news.bind(raw)
handle('news.get', () => feed.current())            // must return NewsFeed
handle('news.refresh', () => feed.refresh())        // must return Outcome<NewsFeed>
handle('slide.openUrl', (url) => openSlideUrl(url)) // url: string, from the schema
feed.onChange((next) => emit('news.changed', next))
```

**The renderer derives from the same map.** `createModuleClient<H>(id)` is the typed bus access; the
module's `client.ts` builds one and exports a named wrapper per handler. Components import the
wrappers and never call `call()` with a handler string - `client.ts` is the only renderer file in
which a handler name appears:

```ts
/** The registry wraps a plain value, so every call resolves to exactly one Outcome. */
type BusResult<R> = R extends Outcome<infer T> ? Outcome<T> : Outcome<R>

export function createModuleClient<H extends ModuleContract>(moduleId: ModuleId) {
  return {
    call<K extends keyof H['invoke'] & string>(
      type: K,
      ...args: Req<H, K> extends void ? [] : [Req<H, K>]
    ): Promise<BusResult<Res<H, K>>> {
      const request = { moduleId, type, ...(args.length > 0 ? { payload: args[0] } : {}) }
      return window.app.invoke('module:invoke', request) as Promise<BusResult<Res<H, K>>>
    },
    on<E extends keyof H['events'] & string>(type: E, listener: (payload: H['events'][E]) => void): () => void {
      return window.app.on('module:event', (event) => {
        if (event.moduleId === moduleId && event.type === type) listener(event.payload as H['events'][E])
      })
    },
  }
}

// modules/news/client.ts - one wrapper per handler, named after it
const client = createModuleClient<NewsModule>('news')
export const readNews = () => client.call('news.get')                          // Outcome<NewsFeed>, inferred
export const refreshNews = () => client.call('news.refresh')                   // Outcome<NewsFeed>
export const openSlideUrl = (url: string) => client.call('slide.openUrl', url) // Outcome<null>
export const onNewsChanged = (listener: (feed: NewsFeed) => void) => client.on('news.changed', listener)
```

Two casts, both inside this one function, next to the wire type they narrow - where §3's preload keeps
its one cast. A `callModule<T>` whose generic the call site picks is the anti-pattern: nothing checks
`T` against anything, and a renamed handler or changed result shape is found at click time.

**One envelope.** `module:invoke` is `Outcome<unknown>` on the wire because the registry itself can fail
(unknown handler, rejected payload, thrown handler). A handler returns `Outcome<T>` for user-causable
failure (§1) or a plain `T`; the registry passes an `Outcome` through and wraps only a plain value -
never `ok(outcome)`:

```ts
export function isOutcome(value: unknown): value is Outcome<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
}

const result = await entry.handler(parsed.data)
return isOutcome(result) ? result : ok(result)
```

The sniff has one hole - a plain result that itself carries a boolean `ok` - so the stricter variant
types `handle`'s return as `Outcome<Res>` only, converts the few plain-value handlers, and never wraps.
Pick one and record it. Never acceptable: a client flattener (`result.ok ? result.value : result`) or a
component reading `.value.ok` - a flattener proves the envelope is nested, and a forgotten one treats a
failure as success.

**Coverage test, per module.** §5's test cannot see past `module:invoke`; one parameterised test runs
over the module list and checks for each module that

- registered handlers equal `Object.keys(schemas)` in both directions (the registry exposes
  `handlerTypes(moduleId)`) - a declared handler never registered fails, as does one nobody declared
- every handler name appears in the module's `client.ts` - the named wrappers are the only place a
  handler string may appear in the renderer, so that one file is the whole scan - or in an explicit
  flow-only allowlist entry with its reason; a handler nobody calls is dead code wearing a contract
- no handler body matches §5's placeholder pattern

**Module ids come from the manifest list.** A hand-kept `ModuleId` union repeated by the manifest list
and the envelope schema is three places to forget; derive the other two from the first:

```ts
export const MODULE_MANIFESTS = [
  { id: 'news', titleKey: 'module.news.title', route: '/news' },
  { id: 'library', titleKey: 'module.library.title', route: '/library' },
] as const satisfies readonly ModuleManifest[]   // ModuleManifest.id is `string`; the union is derived

export type ModuleId = (typeof MODULE_MANIFESTS)[number]['id']
export const moduleIdSchema = z.enum(MODULE_MANIFESTS.map((m) => m.id) as [ModuleId, ...ModuleId[]])
```

The `module:invoke` payload schema uses `moduleIdSchema`; a new module is addressable after one edit.

## Adding a channel: the whole procedure

1. Add the entry to `IpcInvokeMap` (or `IpcEventMap`) with its request and response types.
2. Add the channel name to `INVOKE_CHANNELS` / `EVENT_CHANNELS` - the build tells you if you forget.
3. Add a schema for the request payload if it comes from the renderer, and validate at the boundary.
4. Register the handler in main through the typed `handle()` wrapper - boot tells you if you forget.
5. Use it from the renderer through the bridge. No new type annotations needed.
6. Run the coverage test.

## Adding a module handler: the parallel procedure

1. Add the entry to the module's contract map (`invoke` or `events`) with its request and response types.
2. Add its schema to the module's schema map - the mapped type tells you if you forget.
3. Register it in the module's main half through the typed `handle()` from `defineModule` - the
   result type is checked against the map; there is no way to register without the schema.
4. Add a named wrapper for it to the module's `client.ts` (built on `createModuleClient`) and import
   that from components. No generic and no handler string at the call site.
5. Run the module's coverage test.

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
- [ ] A bus handler is typed from its module's contract map; no `callModule<T>` generic or cast at a call site; handler strings appear only in `client.ts`'s named wrappers
- [ ] One `Outcome` envelope, never nested: the registry passes a handler's `Outcome` through; no flattener or `.value.ok` in a client
- [ ] Per-module coverage test passes: registered set equals the schema map both ways, every handler has a wrapper in `client.ts` or an allowlist entry
- [ ] Module ids derive from the manifest list; the envelope schema uses the derived enum
