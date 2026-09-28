import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app as electronApp } from 'electron'
import {
  REPLAYS_HANDLERS,
  extraFoldersAddSchema,
  extraFoldersRemoveSchema,
  nameTemplatesAddSchema,
  nameTemplatesRemoveSchema,
  nameTemplatesReorderSchema,
  nameTemplatesResetSchema,
  nameTemplatesUpdateSchema,
  replaysNoInputSchema,
  type ExtraFoldersResult,
} from '@shared/modules/replays'
import { isUiHarnessEnabled } from '../../lib/ui-harness'
import { userDataDir } from '../../lib/paths'
import type { MainModule } from '../types'
import { resolveExtractorPath } from '../downloads/7za-path'
import { discoverDemos } from './discovery'
import { addExtraFolder, removeExtraFolder } from './extra-folders'
import {
  nameTemplatesAdd,
  nameTemplatesList,
  nameTemplatesRemove,
  nameTemplatesReorder,
  nameTemplatesReset,
  nameTemplatesRestore,
  nameTemplatesUpdate,
} from './name-templates'

export interface DiscoveryHomeDirOptions {
  /** Defaults to `process.env`; a parameter so a test never touches the real environment. */
  env?: NodeJS.ProcessEnv
  /** Defaults to `userDataDir()`; a parameter so a test never touches the real userData path. */
  userData?: string
  /** Defaults to the real `homedir()`; a parameter so a test never reads the real home dir. */
  osHome?: string
}

/**
 * The home dir `discoverDemos` uses to find Q2PRO's Linux write dir (`~/.q2pro`). Under the UI
 * harness (`isUiHarnessEnabled`) this is redirected to `<userData>/harness-home` - a folder inside
 * the harness's own sandboxed userData dir - so a scripted UI-verification run never scans, and
 * never depends on, whatever happens to exist under the real operator's home directory.
 */
export function discoveryHomeDir({
  env = process.env,
  userData = userDataDir(),
  osHome = homedir(),
}: DiscoveryHomeDirOptions = {}): string {
  if (isUiHarnessEnabled({ env, isDev: false })) return join(userData, 'harness-home')
  return osHome
}

/**
 * The replays module - story 135 D2 registered its main half with a single handler,
 * `overview.read`, answering a hardcoded zeroed overview. There is no demo scan yet: no
 * filesystem access, no `process.platform` checks - that is a later deliverable of this story.
 * Mirrors `src/main/modules/servers/index.ts`'s D2 shape (`overview.read` answering a hardcoded
 * zeroed overview before any real service exists) and `src/main/modules/home/index.ts`'s shape -
 * `setup()` registers handlers and does nothing else.
 *
 * Story 140 D2 adds the seven `nameTemplates.*` handlers on top - all the rules live in
 * `name-templates.ts` (read the persisted state, run the op, persist on success); this file just
 * wires each handler's payload schema to its handler body, same as `servers/index.ts` does for
 * `sources.*`.
 *
 * Story 141 D3 adds `demos.list`, the first handler to actually touch the filesystem: it runs
 * `discoverDemos` (`discovery.ts`, D2) over every known installation and strips each result's
 * `absolutePath` via an explicit field pick before it crosses IPC - a demo is named by its id, never
 * its real path (CLAUDE.md: "Paths from the renderer are never trusted"). `discoveryHomeDir` is the
 * one seam that decides which home dir the scan uses for Q2PRO's Linux write dir, redirected under
 * the UI harness so a scripted run never depends on the real operator's home directory.
 */
export const replaysModule: MainModule = {
  id: 'replays',

  setup({ handle, app, log }) {
    handle(REPLAYS_HANDLERS.overviewRead, replaysNoInputSchema, () => ({
      scanning: false,
      demoCount: 0,
    }))

    handle(REPLAYS_HANDLERS.nameTemplatesList, replaysNoInputSchema, () => nameTemplatesList(app))
    handle(REPLAYS_HANDLERS.nameTemplatesAdd, nameTemplatesAddSchema, (payload) =>
      nameTemplatesAdd(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesUpdate, nameTemplatesUpdateSchema, (payload) =>
      nameTemplatesUpdate(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesRemove, nameTemplatesRemoveSchema, (payload) =>
      nameTemplatesRemove(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesReorder, nameTemplatesReorderSchema, (payload) =>
      nameTemplatesReorder(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesReset, nameTemplatesResetSchema, (payload) =>
      nameTemplatesReset(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesRestore, replaysNoInputSchema, () =>
      nameTemplatesRestore(app),
    )

    handle(REPLAYS_HANDLERS.demosList, replaysNoInputSchema, async () => {
      const extractor = resolveExtractorPath({
        isPackaged: electronApp.isPackaged,
        resourcesPath: process.resourcesPath,
      })
      const { demos } = await discoverDemos(
        app.installations.list(),
        app.state.replaysState().extraFolders,
        {
          platform: process.platform,
          homeDir: discoveryHomeDir(),
          zipDeps: { extractorPath: extractor.path, extractorExists: extractor.exists },
        },
      )
      return demos.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        format: d.format,
        gzip: d.gzip,
        source: d.source,
        archiveEntry: d.archiveEntry,
        map: d.map,
        unparsableReason: d.unparsableReason,
      }))
    })

    // Story 142 D2: the `extraFolders.*` handlers. `add`/`remove` mirror `servers/index.ts`'s
    // `mutate()` pattern - read `replaysState()` once, run the op, on refusal return early without
    // persisting, on success persist and return what `setReplaysState` actually stored (not the
    // local candidate).
    handle(REPLAYS_HANDLERS.extraFoldersList, replaysNoInputSchema, () =>
      app.state.replaysState().extraFolders,
    )
    handle(REPLAYS_HANDLERS.extraFoldersAdd, extraFoldersAddSchema, async (payload) => {
      const current = app.state.replaysState()
      const result: ExtraFoldersResult = await addExtraFolder(
        current.extraFolders,
        payload.path,
        new Date().toISOString(),
        randomUUID(),
      )
      if (!result.ok) return result
      const persisted = app.state.setReplaysState({ ...current, extraFolders: result.folders })
      return { ok: true, folders: persisted.extraFolders } as ExtraFoldersResult
    })
    handle(REPLAYS_HANDLERS.extraFoldersRemove, extraFoldersRemoveSchema, (payload) => {
      const current = app.state.replaysState()
      const extraFolders = removeExtraFolder(current.extraFolders, payload.id)
      const persisted = app.state.setReplaysState({ ...current, extraFolders })
      return { ok: true, folders: persisted.extraFolders } as ExtraFoldersResult
    })

    log.debug('replays module ready')
  },
}
