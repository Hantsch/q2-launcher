import { z } from 'zod'
import type { IpcInvokeMap } from './ipc'
import { absolutePathSchema, engineKindSchema, settingsObjectSchema, sourceSchema } from './schemas'

/**
 * Runtime validation for every IPC payload from the renderer. Strict: a bad
 * payload here is a bug, not a state to repair (contrast with the forgiving
 * persisted-state schemas in `src/main/lib/schemas.ts`).
 *
 * One exported schema per `IpcInvokeMap` channel, in the same section order as
 * that map. Not yet wired into any `handle()` call - that is a later
 * deliverable of story 036; for now these are exported-but-unused by design.
 */

// ---- app --------------------------------------------------------------------

export const appGetInfoSchema: z.ZodType<IpcInvokeMap['app:getInfo']['req']> = z.void()

export const urlSchema: z.ZodType<IpcInvokeMap['app:openExternal']['req']> = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'only http(s) URLs may be opened')

export const appRevealPathSchema: z.ZodType<IpcInvokeMap['app:revealPath']['req']> =
  absolutePathSchema

// ---- window chrome ------------------------------------------------------------

export const windowMinimizeSchema: z.ZodType<IpcInvokeMap['window:minimize']['req']> = z.void()
export const windowToggleMaximizeSchema: z.ZodType<IpcInvokeMap['window:toggleMaximize']['req']> =
  z.void()
export const windowCloseSchema: z.ZodType<IpcInvokeMap['window:close']['req']> = z.void()
export const windowGetStateSchema: z.ZodType<IpcInvokeMap['window:getState']['req']> = z.void()

// ---- settings -----------------------------------------------------------------

export const settingsGetSchema: z.ZodType<IpcInvokeMap['settings:get']['req']> = z.void()
export const settingsPatchSchema: z.ZodType<IpcInvokeMap['settings:patch']['req']> =
  settingsObjectSchema.partial()

// ---- installations --------------------------------------------------------------

export const installationsListSchema: z.ZodType<IpcInvokeMap['installations:list']['req']> =
  z.void()

export const addExistingInputSchema: z.ZodType<IpcInvokeMap['installations:addExisting']['req']> =
  z.object({
    rootPath: absolutePathSchema,
    name: z.string().min(1).max(120).optional(),
    executablePath: absolutePathSchema.optional(),
    source: sourceSchema.optional(),
  })

export const createInstallationInputSchema: z.ZodType<
  IpcInvokeMap['installations:create']['req']
> = z.object({
  rootPath: absolutePathSchema,
  name: z.string().min(1).max(120),
  engineKind: engineKindSchema,
})

export const updateInstallationInputSchema: z.ZodType<
  IpcInvokeMap['installations:update']['req']
> = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  rootPath: absolutePathSchema.optional(),
  executablePath: absolutePathSchema.optional(),
  writeDirPath: absolutePathSchema.nullable().optional(),
  launchArgs: z.array(z.string().max(500)).max(64).optional(),
  activeGameDir: z
    .string()
    .max(64)
    // A game dir is a single folder name, never a path - this blocks traversal.
    .refine((value) => value === '' || /^[A-Za-z0-9_.-]+$/.test(value), 'invalid game directory')
    .optional(),
  favorite: z.boolean().optional(),
})

export const removeInstallationInputSchema: z.ZodType<
  IpcInvokeMap['installations:remove']['req']
> = z.object({
  id: z.string().min(1),
  deleteFromDisk: z.boolean().optional(),
})

/** Full ordering, by id, as shown in the rail (`installations:reorder`). */
export const idListSchema: z.ZodType<IpcInvokeMap['installations:reorder']['req']> = z
  .array(z.string().min(1))
  .max(500)

export const nullableIdSchema: z.ZodType<IpcInvokeMap['installations:setActive']['req']> = z
  .string()
  .min(1)
  .nullable()

export const idSchema: z.ZodType<IpcInvokeMap['installations:validate']['req']> = z
  .string()
  .min(1)

/** Validate a folder the user is *considering*, without registering anything. */
export const installationsInspectPathSchema: z.ZodType<
  IpcInvokeMap['installations:inspectPath']['req']
> = absolutePathSchema

export const pickPathInputSchema: z.ZodType<IpcInvokeMap['installations:pickFolder']['req']> =
  z.object({
    title: z.string().max(200),
    buttonLabel: z.string().max(80).optional(),
    defaultPath: z.string().optional(),
  })

/** These are import paths, hence built on `absolutePathSchema`. */
export const pathListSchema: z.ZodType<IpcInvokeMap['installations:import']['req']> = z
  .array(absolutePathSchema)
  .max(200)

// ---- detection ------------------------------------------------------------------

export const scanOptionsSchema: z.ZodType<IpcInvokeMap['detection:scan']['req']> = z.object({
  scanId: z.string().min(1).max(64).optional(),
  deepScan: z.boolean().optional(),
  drives: z.array(z.string().min(1)).max(32).optional(),
})

export const detectionListDrivesSchema: z.ZodType<IpcInvokeMap['detection:listDrives']['req']> =
  z.void()

// ---- launching --------------------------------------------------------------------

export const launchInputSchema: z.ZodType<IpcInvokeMap['launch:plan']['req']> = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().max(64).optional(),
  connect: z.string().max(200).optional(),
  extraArgs: z.array(z.string().max(500)).max(64).optional(),
})

export const launchGetStateSchema: z.ZodType<IpcInvokeMap['launch:getState']['req']> = z.void()

// ---- jobs (owned by modules; no module produces them yet) --------------------------

export const jobsListSchema: z.ZodType<IpcInvokeMap['jobs:list']['req']> = z.void()

// `jobs:cancel` shares `idSchema` (above, under installations) - both channels take a
// bare string id, same convention as `detection:cancel`.

// ---- modules ------------------------------------------------------------------------

export const modulesListSchema: z.ZodType<IpcInvokeMap['modules:list']['req']> = z.void()

export const moduleInvokeSchema: z.ZodType<IpcInvokeMap['module:invoke']['req']> = z.object({
  moduleId: z.enum(['library', 'config', 'downloads', 'mods', 'assets']),
  type: z.string().min(1).max(80),
  payload: z.unknown().optional(),
})

// ---- development only (registered only when `is.dev`) --------------------------------

export const devSimulateJobSchema: z.ZodType<IpcInvokeMap['dev:simulateJob']['req']> = z.void()
