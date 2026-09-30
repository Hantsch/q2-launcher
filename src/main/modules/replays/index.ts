import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app as electronApp, clipboard, screen, shell } from 'electron'
import {
  REPLAYS_HANDLERS,
  extraFoldersAddSchema,
  extraFoldersRemoveSchema,
  listGetFilterInputSchema,
  listGetSortInputSchema,
  listSetFilterInputSchema,
  listSetSortInputSchema,
  modWarningReadInputSchema,
  modWarningResetTrustedInputSchema,
  modWarningSetEnabledInputSchema,
  modWarningTrustModInputSchema,
  nameTemplatesAddSchema,
  nameTemplatesRemoveSchema,
  nameTemplatesReorderSchema,
  nameTemplatesResetSchema,
  nameTemplatesUpdateSchema,
  replaysDemoFileActionSchema,
  replaysDemoPlaySchema,
  replaysDemoRenameSchema,
  replaysPlaybackCinemaSchema,
  replaysPlaybackDisplayReadSchema,
  replaysPlaybackStageSchema,
  replaysConsoleSendSchema,
  replaysNoInputSchema,
  replaysSidecarReadSchema,
  replaysSidecarWriteSchema,
  type ExtraFoldersResult,
} from '@shared/modules/replays'
import { timelineActionSchema } from '@shared/replays/timeline'
import { EMPTY_DEMO_LIST_FILTER, normalizeDemoListFilter } from '@shared/replays/list-filter'
import { isUiHarnessEnabled, recordHarnessRevealedPath } from '../../lib/ui-harness'
import { userDataDir } from '../../lib/paths'
import type { MainModule } from '../types'
import { resolveExtractorPath } from '../downloads/7za-path'
import { SESSION_RESTORE_CVARS, createDemoPlay, launcherSweepDirs } from './demo-play'
import { createDemoRename } from './demo-rename'
import { sweepLauncherDirs } from './demo-staging'
import { composeDemoRows } from './demo-rows'
import { discoverDemos, type DiscoverContext } from './discovery'
import { addExtraFolder, removeExtraFolder } from './extra-folders'
import { createDemoFileActions } from './file-actions'
import { ReplaysIndexCache } from './index-cache'
import { createCinemaController } from './cinema-controller'
import { cinemaAvailability, displayGeometry, resolveOnPrimary } from './cinema'
import { createPlaybackControl } from './playback-control'
import { stageAvailability, stageGeometry, type StageRect } from './stage'
import { createStageFollowSessions, parkGeometryAt, virtualDesktopRightEdge } from './stage-follow-session'
import { createPlaybackTimeline } from './playback-timeline'
import { createPlaybackConsole } from './playback-console'
import { createPlaybackStop } from './playback-stop'
import { createPlaybackSessions } from './playback-sessions'
import { createReplaysScanService, nameMatcherFor, readDemoFacts } from './scan-service'
import { SESSION_CVARS_PENDING_FILE, createCvarRestore } from './session-cvar-restore'
import { createSidecarStore } from './sidecar-store'
import {
  currentNameTemplates,
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

export interface ScanHoldMsOptions {
  /** Defaults to `process.env`; a parameter so a test never touches the real environment. */
  env?: NodeJS.ProcessEnv
  /** Defaults to `userDataDir()`; a parameter so a test never touches the real userData path. */
  userData?: string
}

/** Upper bound `scanHoldMs` clamps a harness-provided value to - twice the harness's own default
 * per-step timeout budget is not a concern here, this is just a sane ceiling so a stray huge number
 * in the fixture file cannot wedge a scan indefinitely. */
const SCAN_HOLD_MS_MAX = 60_000

/**
 * Story 151 D2: how long `runScan` pauses right after discovery (once the totals push has gone
 * out) before the incremental scan proper starts - the UI-verification harness's seam for scripting
 * a flow against the "scan is running" state instead of racing a scan that finishes near-instantly
 * against fixture data. `0` (no hold) unless the UI harness gate is open and
 * `<userData>/harness-replays-scan-hold-ms` exists and holds a positive integer; an unreadable file,
 * non-numeric content, zero/negative or non-integer values all read back as `0`. Mirrors
 * `discoveryHomeDir`'s own signature and harness gate exactly.
 */
export async function scanHoldMs({ env = process.env, userData = userDataDir() }: ScanHoldMsOptions = {}): Promise<number> {
  if (!isUiHarnessEnabled({ env, isDev: false })) return 0
  let raw: string
  try {
    raw = await readFile(join(userData, 'harness-replays-scan-hold-ms'), 'utf8')
  } catch {
    return 0
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return 0
  const value = Number.parseInt(trimmed, 10)
  if (!Number.isSafeInteger(value) || value <= 0) return 0
  return Math.min(value, SCAN_HOLD_MS_MAX)
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
 *
 * Story 144 D3 adds the index scan service (`scan-service.ts`): `scan.start` / `index.read`, the
 * `scan.progress` push, and `overview.read` now answering the service's real `scanning` /
 * `demoCount` instead of hardcoded zeros.
 */
export const replaysModule: MainModule = {
  id: 'replays',

  setup({ handle, emit, app, log }) {
    const discoveryContext = (): DiscoverContext => {
      const extractor = resolveExtractorPath({
        isPackaged: electronApp.isPackaged,
        resourcesPath: process.resourcesPath,
      })
      return {
        platform: process.platform,
        homeDir: discoveryHomeDir(),
        zipDeps: { extractorPath: extractor.path, extractorExists: extractor.exists },
      }
    }

    // Story 144 D3: the index scan service. Everything it reads (installations, extra folders,
    // name templates, launch phase) is read at scan time, never captured here.
    const scanService = createReplaysScanService({
      emit,
      cache: new ReplaysIndexCache({ log }),
      discover: () =>
        discoverDemos(app.installations.list(), app.state.replaysState().extraFolders, discoveryContext()),
      parse: readDemoFacts,
      nameMatcher: () => {
        const { templates, fingerprint } = currentNameTemplates(app)
        return nameMatcherFor(templates, fingerprint)
      },
      isGameRunning: () => app.launch.isRunning(),
      // Story 151 D2: the UI-verification harness's scan-hold seam - a no-op outside the harness
      // (`scanHoldMs` answers `0` there, and the sleep is skipped entirely).
      holdAfterDiscovery: async () => {
        const ms = await scanHoldMs()
        if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
      },
      log,
    })

    // Story 146: the sidecar store's only index dependency is `scanService.resolveFile`, so the
    // store never builds a second index.
    const sidecarStore = createSidecarStore({
      resolveDemo: (id) => {
        const file = scanService.resolveFile(id)
        if (!file) return undefined
        return file.archiveEntry ? { kind: 'archive-entry' } : { kind: 'file', absolutePath: file.absolutePath }
      },
    })

    // Story 156: the demos.reveal/demos.copyPath actions - reveal/clipboard share the same
    // resolve-id-then-check-file logic (`file-actions.ts`), and the `reveal` dependency itself
    // routes through the UI harness gate the same way `app:openExternal` does (`ipc/app.ts`).
    const demoFileActions = createDemoFileActions({
      resolveFile: (id) => scanService.resolveFile(id),
      stat,
      writeClipboard: (p) => clipboard.writeText(p),
      reveal: (p) => {
        if (isUiHarnessEnabled({ isDev: app.isDev })) {
          return recordHarnessRevealedPath(p)
        }
        shell.showItemInFolder(p)
      },
    })

    // Story 157: demo rename - id + stem in, main resolves the path and validates the stem itself.
    // `playbackSessions` is filled by `demo.play` below (story 159).
    const playbackSessions = createPlaybackSessions()
    // Story 164 D4: the running demo's control channel (position/state pushes, console lines).
    // Story 187 D5: the display event also carries cinema (read from the controller below, which only
    // ever runs after setup) and whether cinema could run now.
    const playbackControl = createPlaybackControl({
      emit,
      launch: app.launch,
      cinema: () => ({ open: cinema.isOpen(), availability: currentCinemaAvailability() }),
    })
    const demoRename = createDemoRename({
      scan: scanService,
      sidecars: sidecarStore,
      sessions: playbackSessions,
      nameMatcher: () => {
        const { templates, fingerprint } = currentNameTemplates(app)
        return nameMatcherFor(templates, fingerprint)
      },
    })

    // Story 159 D2: demo playback - id + installation id in, main re-runs eligibility on its own
    // data, contains the file in that installation's demos folder, then starts the launch and
    // registers the playback session the rename guard above checks.
    // Story 160 D2: a play from elsewhere stages a copy in `<gamedir>/demos/_launcher/` and removes
    // it when the game ends; a copy the launcher could not remove (a crash, a hand-off) is swept here,
    // fire-and-forget. Deferred to a microtask and fully caught, so nothing in it - not even a
    // synchronous throw while listing installations - can block or break this module's start.
    const startupSweep: Promise<void> = Promise.resolve()
      .then(() => sweepLauncherDirs(launcherSweepDirs(app.installations.list(), discoveryContext()), log))
      .catch((error: unknown) => log.warn(`demo staging sweep failed: ${String(error)}`))
    // Story 170 D3: the stage's archived cvars are put back after each stage session; a snapshot a
    // crashed launcher left behind is applied once here. Its operations are serialised, so a play
    // started meanwhile snapshots only after this has run.
    const cvarRestore = createCvarRestore({
      names: SESSION_RESTORE_CVARS,
      pendingPath: join(userDataDir(), SESSION_CVARS_PENDING_FILE),
    })
    void cvarRestore
      .applyPending()
      .catch((error: unknown) => log.warn(`stage cvar restore at start failed: ${String(error)}`))

    // Story 170 D2: the stage rect (CSS px) as the engine's physical `vid_geometry`. Story 171 D2: the
    // follower passes the observer's content bounds (the last un-minimized ones) instead of asking.
    const geometryAt = (rect: StageRect, bounds?: { x: number; y: number }): string | null => {
      const win = app.getMainWindow()
      if (!win) return null
      const contentBounds = bounds ?? win.getContentBounds()
      const toScreen = (dip: StageRect): StageRect => {
        if (typeof screen.dipToScreenRect === 'function') return screen.dipToScreenRect(win, dip)
        const scale = screen.getDisplayMatching(win.getContentBounds()).scaleFactor
        return { x: dip.x * scale, y: dip.y * scale, width: dip.width * scale, height: dip.height * scale }
      }
      return stageGeometry(rect, { contentBounds, zoomFactor: win.webContents.getZoomFactor() }, toScreen)
    }
    const currentStageAvailability = () =>
      stageAvailability(process.platform, process.env, {
        Q2L_UI_HARNESS: process.env['Q2L_UI_HARNESS'],
        Q2L_UI_SESSION_TYPE: process.env['Q2L_UI_SESSION_TYPE'],
      })
    // Story 187 D5: cinema covers the primary display, so it is offered only while the launcher is on it
    // (`Q2L_UI_CINEMA_DISPLAY` fakes that under the UI harness).
    const onPrimaryDisplay = (): boolean => {
      const win = app.getMainWindow()
      const actual = win ? screen.getDisplayMatching(win.getBounds()).id === screen.getPrimaryDisplay().id : true
      return resolveOnPrimary(actual, process.env)
    }
    const currentCinemaAvailability = () =>
      cinemaAvailability({
        stageReason: currentStageAvailability(),
        onPrimary: onPrimaryDisplay(),
        hasFollower: stageFollow.hasFollower(),
      })
    const primaryDisplayGeometry = (): string => {
      const primary = screen.getPrimaryDisplay()
      if (typeof screen.dipToScreenRect === 'function') return displayGeometry(screen.dipToScreenRect(null, primary.bounds))
      const s = primary.scaleFactor
      const b = primary.bounds
      return displayGeometry({ x: b.x * s, y: b.y * s, width: b.width * s, height: b.height * s })
    }

    // Story 171 D2: a follower per placed stage session, fed by the main window's events and
    // `playback.stage`; it parks the game window beyond the virtual desktop's right edge.
    const stageFollow = createStageFollowSessions({
      window: app.mainWindow,
      send: (line) => {
        const result = playbackControl.send(line)
        log.info(`[diag187] follower send "${line}" -> ${result.ok ? 'ok' : result.error.key}`)
        return result
      },
      computeGeometry: (rect, window) => geometryAt(rect, window.contentBounds) ?? '0x0+0+0',
      parkGeometry: (geometry) =>
        parkGeometryAt(
          geometry,
          virtualDesktopRightEdge(
            screen.getAllDisplays(),
            typeof screen.dipToScreenRect === 'function' ? (dip) => screen.dipToScreenRect(null, dip) : undefined,
          ),
        ),
    })

    // Story 187 D5: the one owner of the cinema overlay. Pin before open, close before unpin.
    const cinema = createCinemaController({
      availability: currentCinemaAvailability,
      displayGeometry: primaryDisplayGeometry,
      pin: (geometry) => {
        const placed = stageFollow.pin(geometry)
        log.info(`[diag187] cinema pin ${geometry ?? 'off'} -> ${placed}`)
        return placed
      },
      settled: () => playbackControl.settled().then(() => log.info('[diag187] cinema pin settled, opening overlay')),
      window: app.cinemaWindow,
      hasSession: () => playbackControl.currentFormat() !== null,
      enterFullscreen: () => playbackControl.enterFullscreen(),
      emitDisplay: () => playbackControl.emitDisplay(),
    })

    // Story 172 D5: a fullscreen demo is not steered - the follower rests until it is back on the stage.
    // Story 187 D5: back from a fullscreen entered in cinema, the controller unpins first, then the
    // follower resumes, so the stage geometry and the focus-driven always-on-top are sent again.
    playbackControl.onDisplayChange((fullscreen) => {
      cinema.onDisplayChange(fullscreen)
      stageFollow.setSuspended(fullscreen)
    })
    // Story 187 D5: availability follows the main window across displays - pushed only when it changes.
    // Subscribed when the first demo plays, so a module that never plays never touches the window.
    let lastAvailability: string | null = null
    let watchingWindow = false
    const watchAvailability = (): void => {
      lastAvailability = JSON.stringify(currentCinemaAvailability())
      if (watchingWindow) return
      watchingWindow = true
      app.mainWindow.on((event) => {
        if (event !== 'move' && event !== 'resize' && event !== 'restore') return
        const next = JSON.stringify(currentCinemaAvailability())
        if (next === lastAvailability) return
        lastAvailability = next
        if (playbackControl.currentFormat() !== null) playbackControl.emitDisplay()
      })
    }
    playbackControl.onStateChange((state) => {
      if (state === 'playing') watchAvailability()
      cinema.onPlaybackState(state)
    })

    const demoPlay = createDemoPlay({
      readDemos: () => scanService.read(),
      resolveFile: (id) => scanService.resolveFile(id),
      installations: () => app.installations.list(),
      activeInstallationId: () => app.state.settings().activeInstallationId,
      platform: process.platform,
      launch: app.launch,
      sessions: playbackSessions,
      discoveryContext,
      stagingReady: () => startupSweep,
      playback: playbackControl,
      cvarRestore,
      stageAvailability: currentStageAvailability,
      toGeometry: (rect) => geometryAt(rect),
      onStageSession: (start) => stageFollow.begin(start),
    })

    handle(REPLAYS_HANDLERS.overviewRead, replaysNoInputSchema, () => scanService.overview())
    handle(REPLAYS_HANDLERS.scanStart, replaysNoInputSchema, () => scanService.start())
    // Story 150 D2: `index.read` now answers composed rows - each demo plus its sidecar and
    // resolved effective values - rather than the bare discovered-demo shape `demos.list` still
    // answers. A failed sidecar read (the store's own `Outcome` came back `ok: false`) becomes a
    // `null` sidecar input, same as an archive entry or an id the index doesn't know about.
    handle(REPLAYS_HANDLERS.indexRead, replaysNoInputSchema, async () =>
      composeDemoRows(await scanService.read(), async (id) => {
        const outcome = await sidecarStore.read(id)
        return outcome.ok ? outcome.value : null
      }),
    )

    handle(REPLAYS_HANDLERS.sidecarRead, replaysSidecarReadSchema, (payload) =>
      sidecarStore.read(payload.demoId),
    )
    handle(REPLAYS_HANDLERS.sidecarWrite, replaysSidecarWriteSchema, (payload) =>
      sidecarStore.write(payload.demoId, payload.fields, payload.confirmReplace),
    )

    handle(REPLAYS_HANDLERS.demosReveal, replaysDemoFileActionSchema, (payload) =>
      demoFileActions.reveal(payload.demoId),
    )
    handle(REPLAYS_HANDLERS.demosCopyPath, replaysDemoFileActionSchema, (payload) =>
      demoFileActions.copyPath(payload.demoId),
    )
    handle(REPLAYS_HANDLERS.demoRename, replaysDemoRenameSchema, (payload) =>
      demoRename.rename(payload.id, payload.name),
    )
    handle(REPLAYS_HANDLERS.demoPlay, replaysDemoPlaySchema, (payload) =>
      demoPlay.play(payload.demoId, payload.installationId, {
        acknowledgeModMissing: payload.acknowledgeModMissing === true,
        stage: payload.stage,
      }),
    )

    handle(REPLAYS_HANDLERS.playbackStage, replaysPlaybackStageSchema, (payload) => stageFollow.report(payload.rect))

    // Story 187 D5: fullscreen goes through the cinema controller, so leaving cinema for it keeps the pin.
    const playbackTimeline = createPlaybackTimeline({
      playback: {
        send: (line) => playbackControl.send(line),
        currentFormat: () => playbackControl.currentFormat(),
        enterFullscreen: () => cinema.enterFullscreen(),
        setSpeed: (speed) => playbackControl.setSpeed(speed),
      },
    })
    handle(REPLAYS_HANDLERS.playbackTimeline, timelineActionSchema, (payload) =>
      playbackTimeline.run(payload),
    )
    const playbackConsole = createPlaybackConsole({ playback: playbackControl })
    handle(REPLAYS_HANDLERS.playbackConsoleSend, replaysConsoleSendSchema, (payload) =>
      playbackConsole.send(payload.line),
    )
    const playbackStop = createPlaybackStop({ playback: playbackControl, launch: app.launch })
    handle(REPLAYS_HANDLERS.playbackStop, replaysNoInputSchema, () => playbackStop.stop())
    handle(REPLAYS_HANDLERS.playbackCinema, replaysPlaybackCinemaSchema, (payload) => cinema.set(payload.enter))
    handle(REPLAYS_HANDLERS.playbackDisplayRead, replaysPlaybackDisplayReadSchema, () => playbackControl.display())

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

    // Left on fresh discovery (no header parse, no cache) on purpose: `index.read` is the cached,
    // parsed view; switching this handler's callers over is the renderer's deliverable.
    handle(REPLAYS_HANDLERS.demosList, replaysNoInputSchema, async () => {
      const { demos } = await discoverDemos(
        app.installations.list(),
        app.state.replaysState().extraFolders,
        discoveryContext(),
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
        // No header parse here (see comment above): readable/fileTime/nameFacts stay the neutral
        // placeholders discovery itself sets, never a real answer.
        readable: d.readable,
        unreadable: d.unreadable,
        // Discovery's own values: a zip entry's real header facts/duration, a loose file's
        // null/[] placeholders (no header parse here, see above).
        gameDir: d.gameDir,
        pov: d.pov,
        players: d.players,
        durationMs: d.durationMs,
        fileTime: d.fileTime,
        nameFacts: d.nameFacts,
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

    /**
     * Story 152 D2: the `list.*` sort handlers - same read/replace/persist discipline as
     * `SERVERS_HANDLERS.listGetSort`/`listSetSort` (`src/main/modules/servers/index.ts`).
     * `listSetSort` replaces the top-level `listSort` field wholesale while carrying every other
     * `ReplaysState` key over from the same snapshot untouched; `null` clears it by destructuring it
     * out of the persisted candidate rather than setting it to `undefined`, so a cleared sort is an
     * absent key on disk, not a present `null`/`undefined` one. What's returned is what
     * `setReplaysState` actually persisted (`?? null`), not the local candidate.
     */
    handle(REPLAYS_HANDLERS.listGetSort, listGetSortInputSchema, () =>
      app.state.replaysState().listSort ?? null,
    )
    handle(REPLAYS_HANDLERS.listSetSort, listSetSortInputSchema, (payload) => {
      const current = app.state.replaysState()
      if (payload.sort === null) {
        const { listSort: _listSort, ...withoutSort } = current
        return app.state.setReplaysState(withoutSort).listSort ?? null
      }
      return app.state.setReplaysState({ ...current, listSort: payload.sort }).listSort ?? null
    })

    /**
     * Story 153 D3: the `listFilter.*` handlers - same read/replace/persist discipline as
     * `listGetSort`/`listSetSort` right above. `listFilter` is never absent on `ReplaysState` (unlike
     * `listSort`), so there is no clear-to-null case to model here.
     */
    handle(REPLAYS_HANDLERS.listGetFilter, listGetFilterInputSchema, () =>
      app.state.replaysState().listFilter ?? EMPTY_DEMO_LIST_FILTER,
    )
    handle(REPLAYS_HANDLERS.listSetFilter, listSetFilterInputSchema, (payload) => {
      const current = app.state.replaysState()
      // Normalizes the same way `parseReplaysState` does on read, so a structurally-valid but
      // semantically-invalid `date` (e.g. `from > to`, or both ends open) sent from the renderer
      // never round-trips through `state.json` un-normalized - paths/payloads from the renderer are
      // never trusted, and this is the write-side half of that same discipline.
      return (
        app.state.setReplaysState({
          ...current,
          listFilter: normalizeDemoListFilter(payload.filter),
        }).listFilter ?? EMPTY_DEMO_LIST_FILTER
      )
    })

    // Story 182 D1: the `modWarning.*` handlers - same read/spread/persist discipline as `listFilter`;
    // every one returns what `setReplaysState` actually persisted.
    handle(REPLAYS_HANDLERS.modWarningRead, modWarningReadInputSchema, () =>
      app.state.replaysState().modWarning,
    )
    handle(REPLAYS_HANDLERS.modWarningSetEnabled, modWarningSetEnabledInputSchema, (payload) => {
      const current = app.state.replaysState()
      return app.state.setReplaysState({
        ...current,
        modWarning: { ...current.modWarning, enabled: payload.enabled },
      }).modWarning
    })
    handle(REPLAYS_HANDLERS.modWarningTrustMod, modWarningTrustModInputSchema, (payload) => {
      const current = app.state.replaysState()
      const dir = payload.gameDir.toLowerCase()
      const trustedMods = current.modWarning.trustedMods.includes(dir)
        ? current.modWarning.trustedMods
        : [...current.modWarning.trustedMods, dir]
      return app.state.setReplaysState({
        ...current,
        modWarning: { ...current.modWarning, trustedMods },
      }).modWarning
    })
    handle(REPLAYS_HANDLERS.modWarningResetTrusted, modWarningResetTrustedInputSchema, () => {
      const current = app.state.replaysState()
      return app.state.setReplaysState({
        ...current,
        modWarning: { ...current.modWarning, trustedMods: [] },
      }).modWarning
    })

    log.debug('replays module ready')
  },
}
