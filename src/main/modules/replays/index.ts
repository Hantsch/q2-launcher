import type { ReplaysStageRect } from '@shared/modules/replays'
import { ok, type LaunchState } from '@shared/types'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
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
import type { UiHarness } from '../../lib/ui-harness'
import type { MainModule } from '../types'
import { resolveExtractorPath } from '../../lib/archive/7za-path'
import { SESSION_RESTORE_CVARS, createDemoPlay, launcherSweepDirs } from './demo-play'
import { createDemoRename } from './demo-rename'
import { sweepLauncherDirs } from './demo-staging'
import { composeDemoRows } from './demo-rows'
import { discoverDemos, type DiscoverContext } from './discovery'
import { appendExtraFolder, removeExtraFolder, resolveExtraFolder } from './extra-folders'
import { createDemoFileActions } from './file-actions'
import { REPLAYS_INDEX_CACHE_FILE, ReplaysIndexCache } from './index-cache'
import { createCinemaController } from './cinema-controller'
import { cinemaAvailability, displayGeometry, resolveOnPrimary } from './cinema'
import { createPlaybackControl } from './playback-control'
import { stageAvailability, stageGeometry, stageWindowKeeper, type StageRect } from './stage'
import { connectX11 } from './x11/connection'
import { createX11StageWindow } from './x11/stage-window'
import {
  createStageFollowSessions,
  parkGeometryAt,
  type StageFollowSessions,
  virtualDesktopRightEdge,
} from './stage-follow-session'
import { createPlaybackTimeline } from './playback-timeline'
import { createPlaybackConsole } from './playback-console'
import { createPlaybackStop } from './playback-stop'
import { createPlaybackSessions } from './playback-sessions'
import { replaysState } from './persisted'
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
  harness: UiHarness
  userData: string
  /** Defaults to the real `homedir()`; a parameter so a test never reads the real home dir. */
  osHome?: string
}

/**
 * The home dir `discoverDemos` uses to find Q2PRO's Linux write dir (`~/.q2pro`). Under the UI
 * harness (`harness.enabled`) this is redirected to `<userData>/harness-home` - a folder inside
 * the harness's own sandboxed userData dir - so a scripted UI-verification run never scans, and
 * never depends on, whatever happens to exist under the real operator's home directory.
 */
export function discoveryHomeDir({
  harness,
  userData,
  osHome = homedir(),
}: DiscoveryHomeDirOptions): string {
  if (harness.enabled) return join(userData, 'harness-home')
  return osHome
}

export interface ScanHoldMsOptions {
  harness: UiHarness
  userData: string
}

/** Upper bound `scanHoldMs` clamps a harness-provided value to - twice the harness's own default
 * per-step timeout budget is not a concern here, this is just a sane ceiling so a stray huge number
 * in the fixture file cannot wedge a scan indefinitely. */
const SCAN_HOLD_MS_MAX = 60_000

/**
 * Story 151: how long `runScan` pauses right after discovery (once the totals push has gone
 * out) before the incremental scan proper starts - the UI-verification harness's seam for scripting
 * a flow against the "scan is running" state instead of racing a scan that finishes near-instantly
 * against fixture data. `0` (no hold) unless the UI harness gate is open and
 * `<userData>/harness-replays-scan-hold-ms` exists and holds a positive integer; an unreadable file,
 * non-numeric content, zero/negative or non-integer values all read back as `0`. Mirrors
 * `discoveryHomeDir`'s own signature and harness gate exactly.
 */
export async function scanHoldMs({ harness, userData }: ScanHoldMsOptions): Promise<number> {
  if (!harness.enabled) return 0
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
 * The replays module's main half: wires the demo library's and playback's handlers to the services
 * behind them.
 *
 * Registers `overview.read`, `scan.start`, `index.read`, the sidecar read/write, `demos.*` file
 * actions, rename and play, the `playback.*` control channel (stage, timeline, console, stop, cinema,
 * display), `nameTemplates.*`, `extraFolders.*`, `list.*` sort and filter, and `modWarning.*`.
 * `setup()` registers and subscribes; the rules live in the files it composes.
 *
 * - Discovery (`discoverDemos`) runs over every known installation plus the extra folders. Demos
 *   cross IPC by id with an explicit field pick that drops `absolutePath`; main resolves the id back
 *   to a path itself, so a renderer-supplied path is never trusted. `discoveryHomeDir` is the one
 *   seam choosing the home dir for Q2PRO's Linux write dir, redirected under the UI harness.
 * - The index scan service reads installations, extra folders, name templates and the launch phase
 *   at scan time, never from a snapshot; the sidecar store resolves ids through it and builds no
 *   index of its own.
 * - Every state write runs on the live slice, replaces only its own key and returns what was
 *   persisted.
 * - Platform differences are decided at call time from the running platform:
 *   stage availability, the X11 window keeper (X11 only) and cinema availability.
 * - Everything `setup()` creates (playback control, stage follower, cinema, playback stop, window
 *   watcher) is released through `onDispose`, in reverse creation order.
 */
export const replaysModule: MainModule = {
  id: 'replays',

  setup({ handle, emit, app, log, onDispose }) {
    const discoveryContext = (): DiscoverContext => {
      const extractor = resolveExtractorPath({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      })
      return {
        // platform-read: injectable default, tests pass their own
        platform: process.platform,
        homeDir: discoveryHomeDir({ harness: app.harness, userData: app.userDataDir }),
        zipDeps: { extractorPath: extractor.path, extractorExists: extractor.exists },
      }
    }

    // Story 144: the index scan service. Everything it reads (installations, extra folders,
    // name templates, launch phase) is read at scan time, never captured here.
    const replaysIndexCache = new ReplaysIndexCache({
      log,
      filePath: join(app.userDataDir, REPLAYS_INDEX_CACHE_FILE),
    })
    app.persistence.register('replays-index', replaysIndexCache)
    const scanService = createReplaysScanService({
      emit,
      cache: replaysIndexCache,
      discover: () =>
        discoverDemos(
          app.installations.list(),
          replaysState(app.state).get().extraFolders,
          discoveryContext(),
        ),
      parse: readDemoFacts,
      nameMatcher: () => {
        const { templates, fingerprint } = currentNameTemplates(app)
        return nameMatcherFor(templates, fingerprint)
      },
      isGameRunning: () => app.launch.isRunning(),
      // Story 151: the UI-verification harness's scan-hold seam - a no-op outside the harness
      // (`scanHoldMs` answers `0` there, and the sleep is skipped entirely).
      holdAfterDiscovery: async () => {
        const ms = await scanHoldMs({ harness: app.harness, userData: app.userDataDir })
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
        return file.archiveEntry
          ? { kind: 'archive-entry' }
          : { kind: 'file', absolutePath: file.absolutePath }
      },
    })

    // Story 156: the demos.reveal/demos.copyPath actions - reveal/clipboard share the same
    // resolve-id-then-check-file logic (`file-actions.ts`); `app.os` records a reveal under the UI
    // harness instead of opening a file manager.
    const demoFileActions = createDemoFileActions({
      resolveFile: (id) => scanService.resolveFile(id),
      stat,
      writeClipboard: (p) => app.os.copyText(p),
      reveal: (p) => app.os.showItemInFolder(p),
    })

    // Story 157: demo rename - id + stem in, main resolves the path and validates the stem itself.
    // `playbackSessions` is filled by `demo.play` below (story 159).
    const playbackSessions = createPlaybackSessions()
    // Story 164: the running demo's control channel (position/state pushes, console lines).
    // Story 187: the display event also carries cinema (read from the controller below, which only
    // ever runs after setup) and whether cinema could run now.
    let stageNotice: { key: string } | null = null
    const playbackControl = createPlaybackControl({
      emit,
      launch: app.launch,
      cinema: () => ({ open: cinema.isOpen(), availability: currentCinemaAvailability() }),
      stageNotice: () => stageNotice,
    })
    // Registered first, so it runs last: the follower and the overlay are let go before the channel.
    onDispose(() => playbackControl.dispose())
    const demoRename = createDemoRename({
      scan: scanService,
      sidecars: sidecarStore,
      sessions: playbackSessions,
      nameMatcher: () => {
        const { templates, fingerprint } = currentNameTemplates(app)
        return nameMatcherFor(templates, fingerprint)
      },
    })

    // Story 159: demo playback - id + installation id in, main re-runs eligibility on its own
    // data, contains the file in that installation's demos folder, then starts the launch and
    // registers the playback session the rename guard above checks.
    // Story 160: a play from elsewhere stages a copy in `<gamedir>/demos/_launcher/` and removes
    // it when the game ends; a copy the launcher could not remove (a crash, a hand-off) is swept here,
    // fire-and-forget. Deferred to a microtask and fully caught, so nothing in it - not even a
    // synchronous throw while listing installations - can block or break this module's start.
    const startupSweep: Promise<void> = Promise.resolve()
      .then(() =>
        sweepLauncherDirs(launcherSweepDirs(app.installations.list(), discoveryContext()), log),
      )
      .catch((error: unknown) => log.warn(`demo staging sweep failed: ${String(error)}`))
    // Story 170: the stage's archived cvars are put back after each stage session; a snapshot a
    // crashed launcher left behind is applied once here. Its operations are serialised, so a play
    // started meanwhile snapshots only after this has run.
    const cvarRestore = createCvarRestore({
      names: SESSION_RESTORE_CVARS,
      pendingPath: join(app.userDataDir, SESSION_CVARS_PENDING_FILE),
    })
    void cvarRestore
      .applyPending()
      .catch((error: unknown) => log.warn(`stage cvar restore at start failed: ${String(error)}`))

    // Story 170: the stage rect (CSS px) as the engine's physical `vid_geometry`. Story 171: the
    // follower passes the observer's content bounds (the last un-minimized ones) instead of asking.
    // The DIP rect is converted against the main window ('main'), not the primary display: on a
    // mixed-DPI desktop the window's own display decides the scale.
    const geometryAt = (rect: StageRect, bounds?: { x: number; y: number }): string | null => {
      const win = app.mainWindow.snapshot()
      if (!win) return null
      return stageGeometry(
        rect,
        { contentBounds: bounds ?? win.contentBounds, zoomFactor: win.zoomFactor },
        (dip) => app.displays.dipToScreenRect(dip, 'main'),
      )
    }
    const harnessFlag = app.harness.enabled ? '1' : undefined
    const stageHarnessEnv = () => ({
      Q2L_UI_HARNESS: harnessFlag,
      Q2L_UI_SESSION_TYPE: app.harness.read('Q2L_UI_SESSION_TYPE'),
    })
    const currentStageAvailability = () =>
      // platform-read: host platform, decided at call time
      stageAvailability(process.platform, app.env, stageHarnessEnv())
    // The launcher restacks the game window itself only on X11; elsewhere none of this exists.
    // platform-read: host platform, decided once at setup
    const x11Keeper = stageWindowKeeper(process.platform, app.env, stageHarnessEnv()) === 'x11'

    // One keeper per placed session. The game's PID is the one main's own spawn reported after the
    // session began (never a renderer value); a keeper that gives up leaves a notice for the UI.
    const beginKeptSession = (
      start: { geometry: string; rect: ReplaysStageRect },
      begin: StageFollowSessions['begin'],
    ): (() => void) => {
      let pid: number | undefined
      const adopt = (state: LaunchState): void => {
        if (state.phase === 'running' && state.pid !== undefined) pid = state.pid
      }
      adopt(app.launch.getState())
      const offLaunch = app.launch.onStateChange(adopt)
      const keeper = createX11StageWindow({
        connect: () =>
          connectX11({ env: app.env, readFile: (path) => readFile(path), hostname: hostname() }),
        pid: () => pid,
        onFailure: (cause) => {
          log.warn(`stage keeper gave up: ${cause}`)
          stageNotice = { key: 'replays.stage.notOnTop.x11' }
          playbackControl.emitDisplay()
        },
      })
      const endFollow = begin({ ...start, windowState: keeper })
      return () => {
        endFollow()
        offLaunch()
        keeper.dispose()
        if (stageNotice === null) return
        stageNotice = null
        playbackControl.emitDisplay()
      }
    }
    // Story 187: cinema covers the primary display, so it is offered only while the launcher is on it
    // (`Q2L_UI_CINEMA_DISPLAY` fakes that under the UI harness).
    const onPrimaryDisplay = (): boolean => {
      const win = app.mainWindow.snapshot()
      const actual = win ? win.displayId === app.displays.primary().id : true
      return resolveOnPrimary(actual, {
        Q2L_UI_HARNESS: harnessFlag,
        Q2L_UI_CINEMA_DISPLAY: app.harness.read('Q2L_UI_CINEMA_DISPLAY'),
      })
    }
    const currentCinemaAvailability = () =>
      cinemaAvailability({
        stageReason: currentStageAvailability(),
        onPrimary: onPrimaryDisplay(),
        hasFollower: stageFollow.hasFollower(),
      })
    const primaryDisplayGeometry = (): string =>
      displayGeometry(app.displays.dipToScreenRect(app.displays.primary().bounds, null))

    // Story 171: a follower per placed stage session, fed by the main window's events and
    // `playback.stage`; it parks the game window beyond the virtual desktop's right edge.
    const stageFollow = createStageFollowSessions({
      window: app.mainWindow,
      send: (line) => playbackControl.send(line),
      computeGeometry: (rect, window) => geometryAt(rect, window.contentBounds) ?? '0x0+0+0',
      parkGeometry: (geometry) =>
        parkGeometryAt(
          geometry,
          virtualDesktopRightEdge(app.displays.all(), (dip) =>
            app.displays.dipToScreenRect(dip, null),
          ),
        ),
    })
    onDispose(() => stageFollow.dispose())

    // Story 187: the one owner of the cinema overlay. Pin before open, close before unpin.
    const cinema = createCinemaController({
      availability: currentCinemaAvailability,
      displayGeometry: primaryDisplayGeometry,
      pin: (geometry) => stageFollow.pin(geometry),
      settled: () => playbackControl.settled(),
      window: app.cinemaWindow,
      hasSession: () => playbackControl.currentFormat() !== null,
      enterFullscreen: () => playbackControl.enterFullscreen(),
      emitDisplay: () => playbackControl.emitDisplay(),
      ...(x11Keeper ? { raiseOverlay: () => app.cinemaWindow.raise() } : {}),
    })
    onDispose(() => cinema.dispose())

    // Story 172: a fullscreen demo is not steered - the follower rests until it is back on the stage.
    // Story 187: back from a fullscreen entered in cinema, the controller unpins first, then the
    // follower resumes, so the stage geometry and the focus-driven always-on-top are sent again.
    playbackControl.onDisplayChange((fullscreen) => {
      cinema.onDisplayChange(fullscreen)
      stageFollow.setSuspended(fullscreen)
    })
    // Story 187: availability follows the main window across displays - pushed only when it changes.
    // Subscribed when the first demo plays, so a module that never plays never touches the window.
    let lastAvailability: string | null = null
    let watchingWindow = false
    let offWindow: (() => void) | null = null
    const watchAvailability = (): void => {
      lastAvailability = JSON.stringify(currentCinemaAvailability())
      if (watchingWindow) return
      watchingWindow = true
      offWindow = app.mainWindow.on((event) => {
        if (event !== 'move' && event !== 'resize' && event !== 'restore') return
        const next = JSON.stringify(currentCinemaAvailability())
        if (next === lastAvailability) return
        lastAvailability = next
        if (playbackControl.currentFormat() !== null) playbackControl.emitDisplay()
      })
    }
    onDispose(() => {
      // A 'playing' push after this point must not subscribe again.
      watchingWindow = true
      offWindow?.()
      offWindow = null
    })
    playbackControl.onStateChange((state) => {
      if (state === 'playing') watchAvailability()
      cinema.onPlaybackState(state)
    })

    const demoPlay = createDemoPlay({
      readDemos: () => scanService.read(),
      resolveFile: (id) => scanService.resolveFile(id),
      installations: () => app.installations.list(),
      activeInstallationId: () => app.state.settings().activeInstallationId,
      // platform-read: injectable default, tests pass their own
      platform: process.platform,
      launch: app.launch,
      sessions: playbackSessions,
      discoveryContext,
      stagingReady: () => startupSweep,
      playback: playbackControl,
      cvarRestore,
      stageAvailability: currentStageAvailability,
      toGeometry: (rect) => geometryAt(rect),
      onStageSession: (start) =>
        x11Keeper ? beginKeptSession(start, stageFollow.begin) : stageFollow.begin(start),
    })

    handle(REPLAYS_HANDLERS.overviewRead, replaysNoInputSchema, async () =>
      ok(await scanService.overview()),
    )
    handle(REPLAYS_HANDLERS.scanStart, replaysNoInputSchema, async () =>
      ok(await scanService.start()),
    )
    // `index.read` answers composed rows - each demo plus its sidecar and resolved effective
    // values. A failed sidecar read (the store's own `Outcome` came back `ok: false`) becomes a
    // `null` sidecar input, same as an archive entry or an id the index doesn't know about.
    handle(REPLAYS_HANDLERS.indexRead, replaysNoInputSchema, async () =>
      ok(
        await composeDemoRows(await scanService.read(), async (id) => {
          const outcome = await sidecarStore.read(id)
          return outcome.ok ? outcome.value : null
        }),
      ),
    )

    handle(REPLAYS_HANDLERS.sidecarRead, replaysSidecarReadSchema, (payload) =>
      sidecarStore.read(payload.demoId),
    )
    handle(REPLAYS_HANDLERS.sidecarWrite, replaysSidecarWriteSchema, (payload) =>
      sidecarStore.write(payload.demoId, payload.fields, payload.confirmReplace),
    )

    handle(REPLAYS_HANDLERS.demosReveal, replaysDemoFileActionSchema, async (payload) =>
      ok(await demoFileActions.reveal(payload.demoId)),
    )
    handle(REPLAYS_HANDLERS.demosCopyPath, replaysDemoFileActionSchema, async (payload) =>
      ok(await demoFileActions.copyPath(payload.demoId)),
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

    handle(REPLAYS_HANDLERS.playbackStage, replaysPlaybackStageSchema, (payload) =>
      stageFollow.report(payload.rect),
    )

    // Story 187: fullscreen goes through the cinema controller, so leaving cinema for it keeps the pin.
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
    onDispose(() => playbackStop.dispose())
    handle(REPLAYS_HANDLERS.playbackStop, replaysNoInputSchema, () => playbackStop.stop())
    handle(REPLAYS_HANDLERS.playbackCinema, replaysPlaybackCinemaSchema, (payload) =>
      cinema.set(payload.enter),
    )
    handle(REPLAYS_HANDLERS.playbackDisplayRead, replaysPlaybackDisplayReadSchema, () =>
      ok(playbackControl.display()),
    )

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

    // Story 142: the `extraFolders.*` handlers. Every write runs on the live slice inside
    // `updateSlice`; a refusal returns the live slice unchanged (nothing persisted), and what comes
    // back is what `updateSlice` actually stored, not the local candidate.
    handle(REPLAYS_HANDLERS.extraFoldersList, replaysNoInputSchema, () =>
      ok(replaysState(app.state).get().extraFolders),
    )
    handle(REPLAYS_HANDLERS.extraFoldersAdd, extraFoldersAddSchema, async (payload) => {
      // The awaits come first: the dedupe below must see the list as it is when it writes.
      const resolved = await resolveExtraFolder(payload.path)
      if (!resolved.ok) return ok<ExtraFoldersResult>(resolved)
      let result: ExtraFoldersResult | undefined
      const persisted = replaysState(app.state).update((live) => {
        result = appendExtraFolder(
          live.extraFolders,
          resolved.canonical,
          new Date().toISOString(),
          randomUUID(),
        )
        return result.ok ? { ...live, extraFolders: result.folders } : live
      })
      if (!result || !result.ok) return ok(result as ExtraFoldersResult)
      return ok({ ok: true, folders: persisted.extraFolders } as ExtraFoldersResult)
    })
    handle(REPLAYS_HANDLERS.extraFoldersRemove, extraFoldersRemoveSchema, (payload) => {
      const persisted = replaysState(app.state).update((live) => ({
        ...live,
        extraFolders: removeExtraFolder(live.extraFolders, payload.id),
      }))
      return ok({ ok: true, folders: persisted.extraFolders } as ExtraFoldersResult)
    })

    /**
     * Story 152: the `list.*` sort handlers - same live-slice discipline as
     * `SERVERS_HANDLERS.listGetSort`/`listSetSort` (`src/main/modules/servers/index.ts`).
     * `listSetSort` replaces the top-level `listSort` field wholesale while carrying every other
     * `ReplaysState` key over from the live slice untouched; `null` clears it and is stored as
     * `null`. What's returned is what `updateSlice` actually stored.
     */
    handle(REPLAYS_HANDLERS.listGetSort, listGetSortInputSchema, () =>
      ok(replaysState(app.state).get().listSort),
    )
    handle(REPLAYS_HANDLERS.listSetSort, listSetSortInputSchema, (payload) =>
      ok(replaysState(app.state).update((live) => ({ ...live, listSort: payload.sort })).listSort),
    )

    /**
     * Story 153: the `listFilter.*` handlers - same live-slice discipline as
     * `listGetSort`/`listSetSort` right above. `listFilter` is never absent on `ReplaysState` (unlike
     * `listSort`), so there is no clear-to-null case to model here.
     */
    handle(REPLAYS_HANDLERS.listGetFilter, listGetFilterInputSchema, () =>
      ok(replaysState(app.state).get().listFilter ?? EMPTY_DEMO_LIST_FILTER),
    )
    handle(REPLAYS_HANDLERS.listSetFilter, listSetFilterInputSchema, (payload) => {
      // Normalizes the same way `parseReplaysState` does on read, so a structurally-valid but
      // semantically-invalid `date` (e.g. `from > to`, or both ends open) sent from the renderer
      // never round-trips through `state.json` un-normalized - paths/payloads from the renderer are
      // never trusted, and this is the write-side half of that same discipline.
      return ok(
        replaysState(app.state).update((live) => ({
          ...live,
          listFilter: normalizeDemoListFilter(payload.filter),
        })).listFilter ?? EMPTY_DEMO_LIST_FILTER,
      )
    })

    // Story 182: the `modWarning.*` handlers - same live-slice discipline as `listFilter`;
    // every one returns what `updateSlice` actually stored.
    handle(REPLAYS_HANDLERS.modWarningRead, modWarningReadInputSchema, () =>
      ok(replaysState(app.state).get().modWarning),
    )
    handle(REPLAYS_HANDLERS.modWarningSetEnabled, modWarningSetEnabledInputSchema, (payload) =>
      ok(
        replaysState(app.state).update((live) => ({
          ...live,
          modWarning: { ...live.modWarning, enabled: payload.enabled },
        })).modWarning,
      ),
    )
    handle(REPLAYS_HANDLERS.modWarningTrustMod, modWarningTrustModInputSchema, (payload) => {
      const dir = payload.gameDir.toLowerCase()
      return ok(
        replaysState(app.state).update((live) => {
          const trustedMods = live.modWarning.trustedMods.includes(dir)
            ? live.modWarning.trustedMods
            : [...live.modWarning.trustedMods, dir]
          return { ...live, modWarning: { ...live.modWarning, trustedMods } }
        }).modWarning,
      )
    })
    handle(REPLAYS_HANDLERS.modWarningResetTrusted, modWarningResetTrustedInputSchema, () =>
      ok(
        replaysState(app.state).update((live) => ({
          ...live,
          modWarning: { ...live.modWarning, trustedMods: [] },
        })).modWarning,
      ),
    )

    log.debug('replays module ready')
  },
}
