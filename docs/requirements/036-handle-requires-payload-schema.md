---
id: 036
title: Payload validation cannot be forgotten — handle() requires a schema
status: draft
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

- Where do the schemas live: next to the channel definition in `src/shared/ipc.ts` (contract-first,
  but zod would then be a shared-layer dependency) or in the main process next to the handler?
  The typed-ipc house rule says the contract is the single source of truth — does that extend to
  the runtime schema, or deliberately not?
- Do main-to-renderer events (broadcasts) need the same treatment, or is this invoke-only?
- Is there a channel whose payload is genuinely free-form (module `moduleData`, for example) and
  therefore honestly `z.unknown()`? If so, list them explicitly in the story rather than letting
  each author decide.
