import { z } from 'zod'

/**
 * The replays module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share. Same pattern as `servers.ts`/`home.ts`.
 *
 * Story 135 D1 adds only the shared contract: the handler map, the overview
 * shape and its schema. The handler itself, the demo scan and the renderer view
 * are later deliverables of this story.
 */
export const REPLAYS_HANDLERS = {
  /** Resolves to the current `ReplaysOverview` - cache-first, no network of its own. */
  overviewRead: 'overview.read',
} as const

/**
 * `overview.read` takes no payload - same `z.void()` convention as
 * `serversNoInputSchema` in `servers.ts`.
 */
export const replaysNoInputSchema = z.void()

/**
 * What `overview.read` resolves to: whether a demo scan is currently in
 * progress and how many demos are known so far.
 */
export interface ReplaysOverview {
  scanning: boolean
  demoCount: number
}

export const replaysOverviewSchema = z.object({
  scanning: z.boolean(),
  demoCount: z.number().int().nonnegative(),
})

/**
 * Every `replays` handler paired with its payload schema - proves AC9's "every new channel exists
 * in the shared contract with a zod payload schema before its handler" for this module's own
 * handlers, and is what `replays.test.ts` iterates to check no handler is missing one.
 */
export const REPLAYS_HANDLER_SCHEMAS: Record<
  (typeof REPLAYS_HANDLERS)[keyof typeof REPLAYS_HANDLERS],
  z.ZodTypeAny
> = {
  [REPLAYS_HANDLERS.overviewRead]: replaysNoInputSchema,
}

/**
 * Handlers whose payload is allowed to carry a filesystem path/dir/folder/file value. Deliberately
 * empty: the renderer never sends a filesystem path to open/play/edit a demo - it names a demo by
 * an id main resolved itself, never a path the renderer picked. The only handler that may ever join
 * this list is an "add extra folder" action driven by a native folder-picker dialog, whose result
 * is canonicalised in main before it is trusted - never a free-typed or otherwise renderer-derived
 * path.
 */
export const REPLAYS_PATH_PAYLOAD_HANDLERS: readonly string[] = []
