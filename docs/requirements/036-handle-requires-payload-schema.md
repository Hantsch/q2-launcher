---
id: 036
title: Payload validation cannot be forgotten — handle() requires a schema
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

CLAUDE.md's second key rule is "paths from the renderer are never trusted". Today that rule is
enforced by discipline, not by the compiler. The typed wrapper
[handle()](../../src/main/ipc/index.ts#L32) takes a channel and a handler and nothing else:
whether the incoming payload is validated is up to whoever writes the handler. Some do it
(`handle('installations:reorder', (ids) => app.installations.reorder(idListSchema.parse(ids)))`),
some do not, and there are ~60 `handle()` call sites across `src/main/ipc/` and
`src/main/modules/`. A new channel added on a busy day is validated only if its author
remembers, and nothing in the build or at startup notices when they don't.

The roadmap already names the fix under "Hardening": make the zod schema a **required**
parameter of the typed `handle()` wrapper, so validation cannot be forgotten on a new channel.
Then a missing or wrong schema is a compile error, and the argument about which channels "need"
validation is settled once at the seam instead of per handler.

The value is not that every existing handler gets stricter — most are fine. The value is that
the *next* channel is safe by construction, and that reading a handler tells you what its
payload is allowed to be without having to trace into the body.

Two things this must not become:

- **A rubber stamp.** A channel whose real payload is a path must get a path schema, not
  `z.unknown()`. If a payload genuinely has no shape worth validating (`installations:list`
  takes nothing), the schema says exactly that (`z.void()`/`z.undefined()`) and that is
  meaningful, not an escape hatch.
- **A behaviour change nobody asked for.** A payload that is rejected must fail the way this
  codebase already fails an invalid IPC call, with the same shape of error the renderer already
  handles — not a new unhandled rejection or a silent `undefined`.

## Acceptance Criteria

- [ ] `handle()` takes the payload schema as a required parameter; omitting it does not compile.
- [ ] All ~60 existing `handle()` call sites pass a schema that describes their real payload —
      no blanket `z.any()`/`z.unknown()` used to get the build green.
- [ ] Validation happens once, in the wrapper. Handlers that used to `.parse()` their own payload
      no longer do it twice.
- [ ] An invalid payload is rejected before the handler body runs, and surfaces to the renderer
      as the error shape this codebase already produces for a failed IPC call — with a test
      covering at least one rejection path.
- [ ] Reusable schemas live where the existing ones do
      ([src/main/lib/schemas.ts](../../src/main/lib/schemas.ts)); no schema is redeclared
      per call site if one already exists.
- [ ] The existing startup completeness check (`assertContractFullyHandled`) and the IPC
      coverage test still pass, and the channel count logged at startup is unchanged.
- [ ] `npm run build`, `npm run typecheck`, `npm test` green; the app starts and every screen
      `npm run ui:verify` visits still works — a wrong schema shows up as a broken feature, not
      a failing test, so this needs the live pass.

## Open Questions

- ~~Where do the schemas live …~~ answered → Decisions (Sprint)
- ~~Do main-to-renderer events (broadcasts) need the same treatment …~~ answered → Decisions (Sprint)
- ~~Is there a channel whose payload is genuinely free-form …~~ answered by the refine survey →
  Decisions (Sprint), "Free-form payloads (survey result)".

## Decisions (Sprint)

- **(User)** Schema location: `src/shared/ipc.ts`, next to the channel definition — contract-first
  extends to the runtime schema, zod becomes a shared-layer dependency.
- **(User)** Scope: invoke-only. Main-to-renderer broadcast events get the same treatment in a
  separate follow-up, not this story.
- **Refined file split (implements the user decision):** the schemas go into a new
  `src/shared/ipc-schemas.ts`, section-for-section mirroring `IpcInvokeMap`, and `src/shared/ipc.ts`
  stays zod-free. Reason: `webPreferences.sandbox: true` (`src/main/window.ts:124`) plus
  `externalizeDepsPlugin()` for the preload build means a zod import reachable from
  `src/shared/ipc.ts` emits `require("zod")` into the sandboxed preload bundle, where an external
  npm module cannot be required — the app would fail to start. Same folder, same layer, same
  contract-first idea; only the file boundary moves.
- **Shared primitives:** the enums/primitives that both the persisted schemas and the IPC payload
  schemas need (`engineKindSchema`, `sourceSchema`, `absolutePathSchema`, `settingsObjectSchema`)
  move to a new `src/shared/schemas.ts`. Reason: `src/shared` must never import from `src/main`, so
  anything the shared payload schemas build on has to live in shared — and the persisted state
  schemas (which use `node:crypto`) must stay in main.
- **`src/main/lib/schemas.ts` keeps the persisted-state schemas** (state.json, installations,
  profiles, window state); only the IPC-payload part moves out. Reason: AC5's "reusable schemas
  live where the existing ones do" is about not redeclaring per call site; the user decision moved
  the *IPC* schemas to shared, and dragging `randomUUID` and the forgiving `.catch()` persisted
  schemas along would break the shared layer's no-node rule.
- **Two wrappers, so the error shape does not change:** `handle(channel, schema, handler)` throws
  on an invalid payload (rejected invoke — today's behaviour for the `.parse()` call sites) and
  `handleOutcome(channel, schema, handler, invalidKey?)` returns `fail('ipc.error.invalidPayload')`
  (today's behaviour for the `safeParse` + `fail(...)` call sites), constrained to channels whose
  response is an `Outcome`. Reason: both shapes already exist in this codebase per channel; picking
  one globally would turn a handled `Outcome` into an unhandled rejection in the UI (or vice versa).
- **Channel-specific invalid-payload keys are kept** via `handleOutcome`'s optional `invalidKey`:
  `app:openExternal` → `app.error.invalidUrl`, `app:revealPath` and `installations:inspectPath` →
  `app.error.invalidPath`. Reason: those keys are user-visible i18n strings today; the wrapper must
  not silently retranslate them.
- **`installations:validate` and `jobs:cancel` move from throw to `fail('ipc.error.invalidPayload')`**
  because they answer with an `Outcome`. Reason: consistency at the seam, unreachable in practice
  (the renderer only ever sends known ids), and a resolved `Outcome` is strictly safer for the UI
  than a rejection.
- **`settingsPatchSchema` stays as it is** (`settingsObjectSchema.partial()`, i.e. per-field
  `.catch()` → a bad value degrades to its default instead of being rejected). Reason: the story
  explicitly does not want existing handlers to get stricter; tightening it is a follow-up, not
  this refactor.
- **The `handle()` schema stays an explicit parameter** rather than a central
  `INVOKE_SCHEMAS[channel]` lookup inside the wrapper. Reason: AC1 asks for exactly that, and the
  pair "required parameter + `assertContractFullyHandled()`" is already airtight — a new channel
  cannot be unhandled, and a handler cannot be registered without a schema.
- **Module handler schemas stay in main** (`src/main/modules/config/schemas.ts`), while the module
  seam `ModuleSetup.handle(type, schema, handler)` gains the same required parameter. Reason: module
  handlers are not part of the preload allowlist or of the shell contract, and the renderer never
  needs their schemas — no reason to push them (or zod) into the shared layer.
- **An invalid module payload answers `fail('ipc.error.invalidPayload')` as the transport-level
  outcome.** Reason: `MainModuleRegistry.invoke` already wraps handler results, the renderer's
  config client already flattens (`result.ok ? result.value : result`,
  `src/renderer/src/modules/config/client.ts:109`), and 20 of the 27 config handlers produce exactly
  this key today — so the shape the renderer sees is unchanged.
- **The missing IPC coverage test is built in this story.** Reason: AC6 speaks of "the IPC coverage
  test", but no such test exists (`src/main/ipc/` has no test file) — the `/typed-ipc` house rule
  prescribes one, and without it "every channel has a schema" is only ever checked by eye.

### Free-form payloads (survey result)

Read from `src/shared/ipc.ts` (32 invoke channels) and all 60 `handle()` call sites
(32 in `src/main/ipc/`, 27 in `src/main/modules/config/index.ts`, 1 in
`src/main/modules/library/index.ts`):

- **Exactly one genuinely free-form payload exists:** the `payload` field of `ModuleInvokeRequest`
  on `module:invoke` → stays `z.unknown().optional()` (as today's `moduleInvokeSchema` has it). It is
  honest, not an escape hatch, because the module seam one level down now requires its own schema for
  it. The channel itself is not free-form: `moduleId` is an enum, `type` a bounded string.
- **No other invoke channel and no module handler is free-form.** All 25 payload-carrying config
  handlers already have a dedicated schema in `src/main/modules/config/schemas.ts`.
- **`z.void()` channels (12), because they take nothing:** `app:getInfo`, `window:minimize`,
  `window:toggleMaximize`, `window:close`, `window:getState`, `settings:get`, `installations:list`,
  `detection:listDrives`, `launch:getState`, `jobs:list`, `modules:list`, `dev:simulateJob`.
- **`z.void()` module handlers (4):** config `list`, `writeState`, `switchBinds`; library `stats`.
- **`Installation.moduleData` (`Record<string, unknown>`, `src/shared/types/installation.ts:105`) is
  never accepted from the renderer** — `updateInstallationInputSchema` has no such field, so no
  channel needs a schema for it. Should a future channel accept it, the honest schema is
  `z.record(z.string(), z.unknown())`, and it must not be slipped into `installations:update`.

## Plan

Move the IPC payload schemas into the shared layer, make the schema a required parameter of both
`handle()` wrappers, then walk the 60 call sites module by module.

1. **Shared schema layer** (D1): new `src/shared/schemas.ts` (primitives shared with the persisted
   schemas) and new `src/shared/ipc-schemas.ts` (one schema per invoke channel, in `IpcInvokeMap`
   order and under the same section comments). The IPC-payload half of `src/main/lib/schemas.ts`
   moves there; the persisted half stays. No handler changes yet.
2. **The seam** (D2): `handle(channel, schema, handler)` + `handleOutcome(channel, schema, handler,
   invalidKey?)` in `src/main/ipc/index.ts`; validation happens once, in the wrapper. The three small
   registrars migrate in the same step.
3. **Shell call sites, grouped by registrar** (D3, D4): `installations`/`detection`, then
   `launch`/`jobs`/`modules`/`dev`. Each handler loses its own `.parse()`/`safeParse()` block.
4. **Module seam** (D5): `ModuleSetup.handle` requires a schema, `MainModuleRegistry` validates
   before calling the handler, library module + the six fake `handle` harnesses in
   `src/main/modules/config/index.test.ts` follow.
5. **Config module call sites** (D6, D7): 27 handlers in `src/main/modules/config/index.ts`, split
   into two halves; the schemas already exist in that module's `schemas.ts`, so this is mechanical —
   pass the schema, delete the parse block, keep every domain check (`installations.find`, running
   installation, profile lookup) in the body.
6. **Tests** (D8): new `src/main/ipc/index.test.ts` — every channel handled, every handler has a
   schema, one rejection path per wrapper, channel count still 32.
7. **Live pass + docs** (D9): `npm run ui:verify` plus the flows in the test plan, and the IPC
   section of `docs/ARCHITECTURE.md`.

Order matters: D1 before everything (the schemas must be importable), D2 before D3/D4, D5 before
D6/D7. D8 can only be written once D2 exists.

Note for the user, not changed by this story: `CLAUDE.md`'s key rule still points renderer-payload
validation at `src/main/lib/schemas.ts`. After D1 that path is only half true — the one-line update
needs your sign-off, so it is deliberately left out of the deliverables.

## Deliverables

**D1 — Shared schema layer, no behaviour change**
New `src/shared/schemas.ts` (`engineKindSchema`, `sourceSchema`, `absolutePathSchema`,
`settingsObjectSchema`) and new `src/shared/ipc-schemas.ts` holding one exported schema per invoke
channel, mirroring `IpcInvokeMap`'s sections and order, including the schemas that do not exist yet
(`z.void()` for the 12 empty channels, `absolutePathSchema` for `app:revealPath` /
`installations:inspectPath`, `idSchema` for `detection:cancel`). The IPC-payload block of
`src/main/lib/schemas.ts` moves out; the persisted schemas stay and import the primitives from
shared. Fix up imports in `src/main/ipc/*.ts` and `src/main/lib/schemas.test.ts`.
*Files:* `src/shared/schemas.ts`, `src/shared/ipc-schemas.ts`, `src/main/lib/schemas.ts`,
`src/main/lib/schemas.test.ts`, import lines in `src/main/ipc/*.ts`.
*Acceptance:* `npm run typecheck` + `npm test` green; `src/shared/**` contains no `node:`/`electron`
import and `src/shared/ipc.ts` still has no zod import; after `npm run build`,
`out/preload/index.js` contains no `require("zod")`.

**D2 — `handle()` requires a schema; `handleOutcome()` for Outcome channels**
Wrapper in `src/main/ipc/index.ts`: both variants take the schema as a required second parameter
typed `z.ZodType<InvokeRequest<C>>`, parse once before the handler body runs, and register through
the same path (so `assertContractFullyHandled` is untouched). Migrate `app.ts`, `window.ts`,
`settings.ts` — including the `invalidKey` overrides for `app:openExternal` / `app:revealPath` and
the removal of their inline shape checks (the reveal allowlist check stays in the body).
*Files:* `src/main/ipc/index.ts`, `src/main/ipc/app.ts`, `src/main/ipc/window.ts`,
`src/main/ipc/settings.ts`.
*Acceptance:* omitting the schema is a compile error; a wrong-shaped schema is a compile error; the
app starts and logs `registered 32 IPC channels`; window buttons, settings toggles and "open log
file" still work.

**D3 — installations + detection call sites**
15 channels; every `safeParse`/`parse` block in the body disappears, domain checks stay.
*Files:* `src/main/ipc/installations.ts`, `src/main/ipc/detection.ts`. *Mirror:* D2's `app.ts`.
*Acceptance:* add/import/reorder/rename/remove an installation and run a scan through the UI, all
unchanged; no `.parse(` left in either file.

**D4 — launch + jobs + modules + dev call sites**
*Files:* `src/main/ipc/launch.ts`, `src/main/ipc/jobs.ts`, `src/main/ipc/modules.ts`,
`src/main/ipc/dev.ts`. *Mirror:* D3.
*Acceptance:* launch plan + start still work, `module:invoke` still routes (Library stats render),
`dev:simulateJob` still produces the fake job; `module:invoke`'s schema keeps
`payload: z.unknown().optional()`.

**D5 — Module seam requires a schema**
`ModuleSetup.handle(type, schema, handler)` in `src/main/modules/types.ts`;
`MainModuleRegistry.register` stores the schema and `invoke()` parses before calling the handler,
answering `fail('ipc.error.invalidPayload')` on failure; library module passes `z.void()`. Update the
six fake `handle` harnesses in `src/main/modules/config/index.test.ts` so they apply the schema too
(a harness that skips it would silently disable validation in every module test), and fix whatever
loose test payloads that surfaces.
*Files:* `src/main/modules/types.ts`, `src/main/modules/registry.ts`,
`src/main/modules/library/index.ts`, `src/main/modules/config/index.test.ts`.
*Acceptance:* `npm test` green; Library view still shows stats; an unknown module/type still answers
`modules.error.notImplemented`.

**D6 — Config handlers, part 1 (profiles and setters)**
`list`, `create`, `rename`, `remove`, `setCvars`, `setBinds`, `setLayers`, `setActions`, `assign`,
`unassign`, `setDefault` — pass the existing schema from `src/main/modules/config/schemas.ts`,
delete the parse block, keep every domain check and every comment that explains one.
*Files:* `src/main/modules/config/index.ts` (+ `schemas.ts` only if a `z.void()` export is added).
*Acceptance:* create/rename/delete a profile, edit a cvar and a bind, assign/unassign and set a
default through the Config UI — unchanged behaviour, including the error toasts.

**D7 — Config handlers, part 2 (write, raw files, import, cleanup, tidy-up)**
`write`, `preview`, `writeState`, `syncState`, `rawFiles`, `openFile`, `setPlayedMods`,
`switchBinds`, `setSwitchBind`, `import.*`, `cleanup.*`, `tidyUp.apply`. Same mechanic as D6.
*Files:* `src/main/modules/config/index.ts`. *Mirror:* D6.
*Acceptance:* Care tab (sync + tidy-up), Raw File tab, import dialog and cleanup run through the UI
unchanged; no `safeParse(` left in `index.ts`.

**D8 — IPC contract test**
New `src/main/ipc/index.test.ts` with `electron` mocked: every channel in `INVOKE_CHANNELS` is
registered (dev channels only in dev), the registered count is 32, an invalid payload on a plain
channel rejects, an invalid payload on an Outcome channel resolves to
`{ ok: false, messageKey: 'ipc.error.invalidPayload' }` and the handler body never runs, and a
channel-specific `invalidKey` is preserved. Plus one registry test: an invalid module payload never
reaches the module handler.
*Files:* `src/main/ipc/index.test.ts`, `src/main/modules/registry.test.ts` (new, or a case in
`src/main/modules/config/index.test.ts`).
*Acceptance:* `npm test` green; removing a schema argument or a handler registration makes the suite
fail (spot-checked once, then reverted).

**D9 — Live pass + architecture doc**
`npm run ui:verify` green, the manual test plan below walked in the running app, and the IPC section
of `docs/ARCHITECTURE.md` updated to describe the required schema parameter, both wrappers and where
the schemas live.
*Files:* `docs/ARCHITECTURE.md`.
*Acceptance:* `npm run build`, `npm run typecheck`, `npm test`, `npm run ui:verify` all green; no
screen regressed; the doc matches the code.

## Coverage

| AC | Deliverable |
| --- | --- |
| `handle()` takes the schema as a required parameter | D2 (module seam: D5) |
| all ~60 call sites pass a real schema, no blanket `z.any()` | D2, D3, D4 (shell, 32) · D5, D6, D7 (modules, 28) |
| validation happens once, in the wrapper; no double `.parse()` | D2 (wrapper) · D3, D4, D6, D7 (parse blocks removed) |
| invalid payload rejected before the body, existing error shape, with a test | D2 (semantics) + D8 (tests) |
| reusable schemas in one place, none redeclared per call site | D1 |
| `assertContractFullyHandled` + coverage test pass, channel count unchanged (32) | D8 |
| build / typecheck / test green, every `ui:verify` screen still works | D9 |

## Model Hints

- `D2 → deliverable-hard` — the wrapper decides the rejection shape for all 32 channels at once;
  getting throw-vs-`fail()` wrong per channel turns a handled `Outcome` into an unhandled rejection
  in the UI, which no test in this repo currently catches.
- `D5 → deliverable-hard` — the seam change also rewrites six fake `handle` harnesses in
  `config/index.test.ts` that feed handlers directly; a harness that drops the schema leaves every
  module test passing while validation is silently off.
- D1, D3, D4, D6, D7, D8, D9 → default.
- `Review: → story-review-hard` — 60 security-relevant call sites whose failure mode is a schema that
  is too loose or subtly wrong; that is invisible in a green test run and needs a reviewer that reads
  each schema against its channel's declared payload.

## Test Plan (manual acceptance)

Run `npm run ui:verify` first (screenshots + a11y report), then in the running app:

1. **Installations:** add an existing installation via the folder picker, rename it, toggle favorite,
   reorder the rail by drag, run a detection scan, remove one. All succeed as before.
2. **Settings:** toggle "minimize on launch" and switch the locale — the change persists across a
   restart.
3. **Launch:** launch an installation (plan + start), confirm the window minimizes if that setting is
   on.
4. **Config:** create a profile, edit a cvar and a bind, assign it to an installation and make it the
   default, then open the Care tab (sync state + a tidy-up apply) and the Raw File tab (open file /
   reveal). Import a hand-written config and run a cleanup scan + apply.
5. **Library:** the Library view still shows stats (proves `module:invoke` end to end).
6. **Errors (developer check, on top of 1-5, not instead of them):** in a dev build, call a channel
   with a deliberately wrong payload from the renderer console
   (`window.q2.invoke('installations:reorder', 5)`) and confirm the failure looks like it does today
   — a rejected promise with a Zod message, no crash, no silent success.
