import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { demoSourceKey, type DemoRow, type ReplaysScanProgress } from '@shared/modules/replays'
import {
  buildFolderView,
  isInArchive,
  nearestExisting,
  rowsBelow,
  type DiscoveredFolder,
  type FolderEntry,
  type FolderRef,
} from '@shared/replays/demo-folders'
import {
  nextSort,
  sortDemoRows,
  type DemoListSort,
  type DemoSortColumn,
  type DemoSortFields,
} from '@shared/replays/list-sort'
import {
  demoFilterOptions,
  demoFilterSubject,
  filterDemos,
  EMPTY_DEMO_LIST_FILTER,
  isDemoFilterActive,
  type DemoListFilter,
} from '@shared/replays/list-filter'
import { scopeDemoRows, type DemoListScope } from '@shared/replays/list-scope'
import { Button } from '../../components/ui/Button'
import { Switch } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { cn } from '../../lib/cn'
import { toastOutcomeError } from '../../lib/toast'
import { useListSort } from '../../lib/useListSort'
import { useModuleQuery } from '../../lib/useModuleQuery'
import { usePrimaryActionContribution, type ContributedAction } from '../../lib/primary-action'
import { findCatalogEntryByGameDir } from '@shared/mods/server-local-content'
import { ROUTE_SETTINGS, useActiveInstallation, useLauncher } from '../../store/useLauncher'
import {
  InstallDecisionDialog,
  type InstallDecisionRequest,
} from '../mods/components/InstallDecisionDialog'
import { getCatalog, installMod, onInstallDecision } from '../mods/client'
import { VirtualDemoList, type DemoListItem } from './components/VirtualDemoList'
import { DemoBreadcrumb } from './components/DemoBreadcrumb'
import { DemoDragZone } from './components/DemoDragZone'
import { FolderNameDialog } from './FolderNameDialog'
import { useFolderStore } from './folder-store'
import { DemoDetailPanel } from './components/DemoDetailPanel'
import { BulkActionBar } from './components/BulkActionBar'
import { SelectionSummary } from './components/SelectionSummary'
import { TagDemosDialog } from './components/TagDemosDialog'
import { MoveDemosDialog } from './components/MoveDemosDialog'
import { useBulkActions } from './useBulkActions'
import { DemoRowMenu, type RowMenuTarget } from './components/DemoRowMenu'
import { RenameDemoDialog } from './RenameDemoDialog'
import type { MenuPoint } from './row-menu'
import { ConsoleCommandField } from './components/ConsoleCommandField'
import { DemoStage } from './components/DemoStage'
import { DemoTimeline } from './components/DemoTimeline'
import { usePlaybackStore } from './playback-store'
import { useDemoPlay } from './useDemoPlay'
import { DemoListFilterBar } from './DemoListFilterBar'
import { findRowReplaceId, useDemoEditorStore, type RowPatcher } from './demo-editor-store'
import { ReplaceSidecarDialog } from './components/ReplaceSidecarDialog'
import { ModMissingConfirmDialog } from './components/ModMissingConfirmDialog'
import { rowWithSidecar } from './row-patch'
import {
  getListFilter,
  folderCreate,
  folderRename,
  deleteDemoFolder,
  deleteDemos,
  moveDemos,
  tagDemos,
  foldersRead,
  getListSort,
  indexRead,
  moveDemo,
  readModWarning,
  onScanProgress,
  scanStart,
  setListFilter,
  setListSort,
  sidecarRead,
  trustModWarningMod,
} from './client'
import { deriveReplaysListState } from './list-state'
import { sidesText } from './row-format'
import { ReplaysListStatus } from './ReplaysListStatus'

/** The list-beside-detail grid, mirroring `ServersView.tsx`'s own `detailSplit`/`DETAIL_PANE`
 * (read there first before changing this) - one slot until a demo is selected, then a fixed
 * 32rem detail pane beside it (or, below the `@4xl` container width, under it). On the stage the
 * list is hidden and the grid holds the detail pane alone, docked right of the stage. */
function detailSplit(detailOpen: boolean, stageMode: boolean): string {
  return cn(
    'grid h-full',
    detailOpen && !stageMode
      ? 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,1fr)_32rem] @4xl:grid-rows-1'
      : 'grid-rows-1',
  )
}

const DETAIL_PANE = 'min-h-0 overflow-y-auto border-line bg-panel/40'

/** How long a filter change waits, un-typed, before it is persisted (story 153) - mirrors the
 * "debounce writes, flush on unmount" shape without pulling in a new dependency. */
const FILTER_PERSIST_DEBOUNCE_MS = 300

/** Story 152: maps a `DemoRow` (150's row model) to the fields `sortDemoRows` needs - `players`
 * mirrors exactly what `DemoRow.tsx` shows for its sides cell (`sidesText`, no translated "+n"
 * suffix here since the sort only ever compares the text, never renders it). */
function toSortFields(row: DemoRow): DemoSortFields {
  return {
    id: row.id,
    favourite: row.sidecar.values.favourite === true,
    rating: row.sidecar.values.rating ?? null,
    map: row.effective.map.value,
    mod: row.effective.mod.value,
    players: sidesText(row.effective.sides.value ?? []) || null,
    date: row.effective.date.value,
    durationMs: row.durationMs,
  }
}

/** The label a source carries on its root folder - the same text main puts on `DiscoveredFolder.source`. */
function sourceLabel(row: DemoRow): string {
  return row.source.kind === 'installation'
    ? `${row.source.installationName} / ${row.source.gameDir}`
    : row.source.path
}

const EXTRA_KEY_PREFIX = 'extraFolder:'

/** The top level of a scoped list: the installation's roots, then - when extra folders exist - a
 * heading over them. Inside a folder, or with every installation shown, folders come as built. */
function rootListItems(
  folders: FolderEntry[],
  demos: { demo: DemoRow }[],
  grouped: boolean,
): DemoListItem[] {
  const items = (list: FolderEntry[]): DemoListItem[] =>
    list.map((folder): DemoListItem => ({ kind: 'folder', folder }))
  const demoItems = demos.map((entry): DemoListItem => ({ kind: 'demo', row: entry.demo }))
  if (!grouped) return [...items(folders), ...demoItems]
  const extra = folders.filter((f) => f.ref.sourceKey.startsWith(EXTRA_KEY_PREFIX))
  if (extra.length === 0) return [...items(folders), ...demoItems]
  const own = folders.filter((f) => !f.ref.sourceKey.startsWith(EXTRA_KEY_PREFIX))
  return [
    ...items(own),
    { kind: 'heading', labelKey: 'replays.scope.extraGroup', testId: 'replays-extra-group' },
    ...items(extra),
    ...demoItems,
  ]
}

/** A scan that hasn't reported anything yet - the placeholder before the first `scan.progress`
 * push arrives, so `ReplaysListStatus` always has something to render while `scanning` starts
 * `true` on mount. */
const IDLE_SCAN_PROGRESS: ReplaysScanProgress = {
  running: false,
  sources: [],
  sourceErrors: [],
}

/**
 * Story 141: a minimal Demos list view - just enough to make AC "every discovered demo across
 * every installation and mod is listed" provable on a real surface. Mirrors `ServersView`'s header
 * markup (the `h1`/status-line toolbar shape); everything else there (scan controls, sort, filter,
 * detail pane, tabs) is out of scope for this deliverable.
 *
 * Story 144: the index is read once on mount (cache-first - whatever `index.read` already has,
 * rendered at once, even if it's a stale/previous-run snapshot) and a background scan is kicked off
 * right behind it. `onScanProgress` is subscribed for the component's lifetime; only once a push
 * reports `running: false` is the index re-read and the whole list swapped in one go - never a
 * partial/incremental patch, matching the story's "single swap on completion" design. The refresh
 * button re-triggers the same `scanStart()` and is disabled while the latest known progress says a
 * scan is running.
 *
 * Story 158/159: the list itself is now `VirtualDemoList` (a virtualised, selectable body built
 * on the row/header/grid pieces), and selecting a row opens a side detail panel - shell only,
 * a later story fills in its content. A row that vanishes on a re-read (its id no longer in the new
 * list) clears the selection rather than leaving it pointed at a row that no longer renders.
 */
export function ReplaysView() {
  const { t } = useTranslation()
  const setRoute = useLauncher((state) => state.setRoute)
  const pushToast = useLauncher((state) => state.pushToast)
  const [demos, setDemos] = useState<DemoRow[] | null>(null)
  const [folders, setFolders] = useState<DiscoveredFolder[] | null>(null)
  const activeInstallation = useActiveInstallation()
  const activeInstallationId = activeInstallation?.id ?? null
  const installations = useLauncher((state) => state.installations)
  // View state, not persisted: the scan is global and scope only narrows what is shown.
  const [showAll, setShowAll] = useState(false)
  const scope = useMemo<DemoListScope>(
    () =>
      showAll
        ? { kind: 'all' }
        : activeInstallationId === null
          ? { kind: 'none' }
          : { kind: 'installation', installationId: activeInstallationId },
    [showAll, activeInstallationId],
  )
  const currentFolder = useFolderStore((state) => state.current)
  const openFolder = useFolderStore((state) => state.open)
  const [folderDialog, setFolderDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; folder: FolderEntry } | null
  >(null)
  // Story 151: the view always calls `scanStart()` on mount, so it starts out assuming a scan
  // is under way - flipped back to `false` only if that call itself resolves `ok: false` (refused
  // outright, never even started). A real `scan.progress` push takes over from there.
  const [scanning, setScanning] = useState(true)
  const [progress, setProgress] = useState<ReplaysScanProgress>(IDLE_SCAN_PROGRESS)
  const stageMode = usePlaybackStore((state) => state.stageArmed || state.session !== null)
  const selectedId = useDemoEditorStore((state) => state.selectedId)
  const selectedIds = useDemoEditorStore((state) => state.selectedIds)
  const toggleDemo = useDemoEditorStore((state) => state.toggleSelect)
  const selectRange = useDemoEditorStore((state) => state.selectRange)
  const selectAll = useDemoEditorStore((state) => state.selectAll)
  const selectDemo = useDemoEditorStore((state) => state.select)
  const closeDemo = useDemoEditorStore((state) => state.close)
  const drafts = useDemoEditorStore((state) => state.drafts)
  const cancelEdit = useDemoEditorStore((state) => state.cancelEdit)
  const { sort, setSort } = useListSort<DemoListSort>(getListSort, setListSort)
  const [filter, setFilter] = useState<DemoListFilter>(EMPTY_DEMO_LIST_FILTER)
  const cancelledRef = useRef(false)
  // Debounces `setListFilter` writes by 300ms - `filterDebounceRef` holds the pending timeout,
  // `pendingFilterRef` the latest not-yet-persisted value, so an unmount can flush it immediately
  // instead of losing the last, still-debounced change.
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFilterRef = useRef<DemoListFilter | null>(null)
  // Story 157: a rename can move the very row the active filter was matching on (e.g. a
  // free-text search against the old file name) out from under itself. The renamed
  // row must keep its selection regardless, so its new id is pinned into `visibleDemos` below until
  // the user does something that supersedes the pin (picks a different filter, or another row).
  const pinnedRowIdRef = useRef<string | null>(null)

  // The persisted filter seeds `filter` once; a failed read keeps the empty default.
  const filterQuery = useModuleQuery(getListFilter)
  const [filterLoaded, setFilterLoaded] = useState(false)
  const filterSeeded = useRef(false)
  useEffect(() => {
    if (filterSeeded.current || filterQuery.state === 'loading') return
    filterSeeded.current = true
    if (filterQuery.data !== undefined) setFilter(filterQuery.data)
    setFilterLoaded(true)
  }, [filterQuery.state, filterQuery.data])

  // Story 153: flushes a still-pending debounced write on unmount, so navigating away right
  // after a filter change never drops it.
  useEffect(() => {
    return () => {
      if (filterDebounceRef.current !== null) {
        clearTimeout(filterDebounceRef.current)
        filterDebounceRef.current = null
        if (pendingFilterRef.current !== null) {
          void setListFilter(pendingFilterRef.current)
          pendingFilterRef.current = null
        }
      }
    }
  }, [])

  const handleSort = (column: DemoSortColumn): void => {
    setSort(nextSort(sort, column))
  }

  const handleFilterChange = (next: DemoListFilter): void => {
    pinnedRowIdRef.current = null
    setFilter(next)
    pendingFilterRef.current = next
    if (filterDebounceRef.current !== null) clearTimeout(filterDebounceRef.current)
    filterDebounceRef.current = setTimeout(() => {
      filterDebounceRef.current = null
      const toPersist = pendingFilterRef.current
      pendingFilterRef.current = null
      if (toPersist === null) return
      void setListFilter(toPersist)
    }, FILTER_PERSIST_DEBOUNCE_MS)
  }

  // Rows and folders land in one render so the folder view never mixes two reads.
  const rereadLists = useCallback(async (): Promise<void> => {
    const [index, folderList] = await Promise.all([indexRead(), foldersRead()])
    if (cancelledRef.current) return
    const next = index.ok ? index.value : []
    setDemos(next)
    setFolders(folderList?.ok ? folderList.value : [])
    useDemoEditorStore.getState().deselectIfMissing(next.map((demo) => demo.id))
  }, [])

  useEffect(() => {
    cancelledRef.current = false

    function readIndex(): void {
      void rereadLists()
    }

    readIndex()
    void scanStart().then((result) => {
      if (cancelledRef.current) return
      if (!result.ok) setScanning(false)
    })

    const unsubscribe = onScanProgress((next) => {
      if (cancelledRef.current) return
      setScanning(next.running)
      setProgress(next)
      if (!next.running) readIndex()
    })

    return () => {
      cancelledRef.current = true
      unsubscribe()
    }
  }, [rereadLists])

  // Story 151: mirrors `ServersView.tsx`'s `handleOpenSourceSettings` - the route change lands
  // on the next render commit, so two rAFs (one for the commit, one for the browser's next paint)
  // is the smallest wait that reliably sees `settings-section-replays` in the DOM before scrolling.
  const handleOpenSettings = (): void => {
    setRoute(ROUTE_SETTINGS)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector('[data-testid="settings-section-replays"]')
          ?.scrollIntoView({ block: 'start' })
      })
    })
  }

  // The playing demo's row from the full list (not the scoped view), for the strip's comments.
  const sessionDemoId = usePlaybackStore((state) => state.session?.demoId ?? null)
  const sessionDemo =
    sessionDemoId === null ? null : (demos?.find((demo) => demo.id === sessionDemoId) ?? null)

  // Story 155: a notes save patches just that one row from its fresh `sidecar.read` - no rescan,
  // no `index.read`, so the list keeps its place and no loading strip flashes.
  const handleRowPatched: RowPatcher = (demoId, sidecar) => {
    setDemos((current) =>
      current === null
        ? current
        : current.map((demo) => (demo.id === demoId ? rowWithSidecar(demo, sidecar) : demo)),
    )
  }

  // Story 157: a rename swaps the row's id (and file name) out from under the selection - the
  // list is patched in place (old id -> the freshly composed row) and the selection follows the
  // new id, mirroring `handleRowPatched`'s "patch, never rescan" shape.
  const handleRenamed = (oldId: string, newRow: DemoRow): void => {
    setDemos((current) =>
      current === null ? current : current.map((d) => (d.id === oldId ? newRow : d)),
    )
    pinnedRowIdRef.current = newRow.id
    selectDemo(newRow.id)
  }

  // The moved demo leaves the open folder, so a selection on it clears; the list is patched with
  // the returned row and the folder counts re-read. A refusal is a toast, nothing changes.
  const handleDemoMove = async (demoId: string, target: FolderRef): Promise<void> => {
    const outcome = await moveDemo(demoId, target)
    if (!outcome.ok) {
      toastOutcomeError(pushToast, outcome)
      return
    }
    const sidecar = await sidecarRead(outcome.value.demo.id)
    const composed = rowWithSidecar(
      outcome.value.demo,
      sidecar.ok ? sidecar.value : { state: { state: 'none' }, values: {} },
    )
    setDemos((current) =>
      current === null ? current : current.map((d) => (d.id === demoId ? composed : d)),
    )
    if (selectedId === demoId) {
      pinnedRowIdRef.current = null
      closeDemo()
    }
    await rereadLists()
  }

  const handleFolderCreate = async (name: string) => {
    // The control is disabled at the top level, so a parent always exists here.
    const outcome = await folderCreate(currentFolder as FolderRef, name)
    if (outcome.ok) await rereadLists()
    return outcome
  }

  // A rename moves every demo below the folder: the selection follows the returned id map, and an
  // open folder at or below the renamed one follows the new name. (story 242)
  const handleFolderRename = async (folder: FolderEntry, name: string) => {
    const outcome = await folderRename(folder.ref, name)
    if (!outcome.ok) return outcome
    const moved = outcome.value.ids.find((pair) => pair.from === selectedId)
    if (moved !== undefined) {
      pinnedRowIdRef.current = moved.to
      selectDemo(moved.to)
    }
    const depth = folder.ref.path.length
    if (
      currentFolder !== null &&
      currentFolder.sourceKey === folder.ref.sourceKey &&
      currentFolder.path.length >= depth &&
      folder.ref.path.every((seg, i) => seg === currentFolder.path[i])
    ) {
      const renamedTo = name.trim()
      openFolder({
        sourceKey: currentFolder.sourceKey,
        path: [...folder.ref.path.slice(0, -1), renamedTo, ...currentFolder.path.slice(depth)],
      })
    }
    await rereadLists()
    return outcome
  }

  const scopedDemos = useMemo(() => scopeDemoRows(demos ?? [], scope), [demos, scope])
  const rowCount = scopedDemos.length
  const selected = demos?.find((demo) => demo.id === selectedId) ?? null
  const multiSelected = selectedIds.length > 1
  const selectedRows = useMemo(() => {
    const chosen = new Set(selectedIds)
    return (demos ?? []).filter((demo) => chosen.has(demo.id))
  }, [demos, selectedIds])
  const zipCount = selectedRows.filter((demo) => demo.archiveEntry !== null).length

  // Story 180: the action bar's primary button on this tab is "View" - it plays the selected
  // demo. The published object must stay stable (the contribution effect republishes on every new
  // identity), so `run` never changes; it reads the latest `play` - the one rendered for the
  // currently selected row - through a ref, never a stale closure over an earlier selection.
  const { eligibility, busy: playBusy, error: playError, play } = useDemoPlay(selected)
  // Story 180 / 182: a mod-missing refusal is a warning, not a wall - View stays enabled and
  // `run` asks first (the dialog below, the warning's only place) unless the user switched the
  // warning off or trusted this mod; the readout carries no permanent warning text.
  const askFirst = eligibility !== null && !eligibility.ok && eligibility.acknowledgeable === true
  const modGameDir =
    eligibility !== null && !eligibility.ok ? String(eligibility.params?.gameDir ?? '') : ''
  const [confirmingModMissing, setConfirmingModMissing] = useState(false)
  // Story 193: the catalog entry offered for install in the mod-missing dialog, if any.
  const [modOffer, setModOffer] = useState<{ id: string; name: string } | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [decision, setDecision] = useState<InstallDecisionRequest | null>(null)
  const [answeredDecisions, setAnsweredDecisions] = useState<string[]>([])
  useEffect(
    () =>
      onInstallDecision((event) => {
        if (event.installationId === activeInstallationId) setDecision(event)
      }),
    [activeInstallationId],
  )
  const [installPending, setInstallPending] = useState(false)
  const installPendingRef = useRef(false)
  const handleInstall = (): void => {
    if (installPendingRef.current || activeInstallationId === null || modOffer === null) return
    installPendingRef.current = true
    setInstallPending(true)
    setInstallError(null)
    installMod(activeInstallationId, modOffer.id)
      .then((outcome) => {
        if (outcome.ok) setConfirmingModMissing(false)
        else setInstallError(t(outcome.error.key, outcome.error.params))
      })
      .catch(() => setInstallError(t('replays.play.modMissingConfirm.installFailed')))
      .finally(() => {
        installPendingRef.current = false
        setInstallPending(false)
      })
  }
  const playRef = useRef({ play, askFirst, modGameDir })
  useLayoutEffect(() => {
    playRef.current = { play, askFirst, modGameDir }
  })
  const runPlay = useCallback(() => {
    const latest = playRef.current
    if (!latest.askFirst) {
      void latest.play()
      return
    }
    void readModWarning().then((result) => {
      // A failed read falls back to asking.
      if (
        result.ok &&
        (!result.value.enabled ||
          result.value.trustedMods.includes(latest.modGameDir.toLowerCase()))
      ) {
        void latest.play(true)
      } else {
        // Only here is the dialog opening: read the catalog fresh for an install offer. A failed,
        // rejected or empty read means no offer - it never blocks the dialog.
        void getCatalog()
          .then((catalog) =>
            catalog.ok && catalog.value.status === 'ok'
              ? findCatalogEntryByGameDir(
                  catalog.value.entries.map((e) => ({
                    id: e.id,
                    gameDir: e.gamedir,
                    name: e.name,
                  })),
                  latest.modGameDir,
                )
              : null,
          )
          .catch(() => null)
          .then((entry) => {
            setInstallError(null)
            setModOffer(entry === null ? null : { id: entry.id, name: entry.name })
            setConfirmingModMissing(true)
          })
      }
    })
  }, [])
  const hasSelection = selected !== null
  const viewAction = useMemo<ContributedAction>(
    () => ({
      id: 'view',
      labelKey: 'installation.action.view',
      disabled: !hasSelection || eligibility === null || (!eligibility.ok && !askFirst) || playBusy,
      ...(hasSelection && eligibility !== null && !eligibility.ok && !askFirst
        ? { reason: { key: eligibility.reasonKey, params: eligibility.params } }
        : {}),
      ...(hasSelection && eligibility?.ok && eligibility.engine === 'q2pro'
        ? { reason: { key: 'replays.play.withInstallationQ2pro' } }
        : {}),
      ...(playError ? { error: playError } : {}),
      run: runPlay,
    }),
    [hasSelection, eligibility, askFirst, playBusy, playError, runPlay],
  )
  usePrimaryActionContribution('/replays', viewAction)
  const bulk = useBulkActions({ rows: demos ?? [], reread: rereadLists })
  // The one delete confirmation: the bulk bar, the detail panel and the row menu all set its ids.
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [renaming, setRenaming] = useState<DemoRow | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<FolderEntry | null>(null)
  const [rowMenu, setRowMenu] = useState<{ at: MenuPoint; target: RowMenuTarget } | null>(null)
  const folderDeleteBusy = useRef(false)
  // The ids the open dialog acts on, so a context menu can open it for one demo.
  const [bulkDialog, setBulkDialog] = useState<{ kind: 'tag' | 'move'; ids: string[] } | null>(null)
  const selectedRowsOf = (ids: readonly string[]): DemoRow[] =>
    (demos ?? []).filter((demo) => ids.includes(demo.id))
  const deletableCount = selectedRowsOf(deleteIds ?? []).filter(
    (demo) => demo.archiveEntry === null,
  ).length
  const openDemoMenu = (id: string, at: MenuPoint): void => {
    const demo = (demos ?? []).find((row) => row.id === id)
    if (demo === undefined) return
    const inSelection = selectedIds.length > 1 && selectedIds.includes(id)
    if (!inSelection) {
      if (id !== pinnedRowIdRef.current) pinnedRowIdRef.current = null
      selectDemo(id)
    }
    setRowMenu({
      at,
      target: { kind: 'demo', demo, selection: inSelection ? selectedRowsOf(selectedIds) : [demo] },
    })
  }
  // The folder's demos leave the list with it; a refusal (playing, scanning, ...) is a toast.
  const handleFolderDelete = async (folder: FolderEntry): Promise<void> => {
    if (folderDeleteBusy.current) return
    folderDeleteBusy.current = true
    try {
      const outcome = await deleteDemoFolder(folder.ref)
      if (!outcome.ok) {
        toastOutcomeError(pushToast, outcome)
        return
      }
      await rereadLists()
    } finally {
      folderDeleteBusy.current = false
    }
  }
  const sortedDemos = useMemo(
    () => sortDemoRows(scopedDemos, sort, toSortFields),
    [scopedDemos, sort],
  )
  // Story 153: filtered AFTER sort, never touching sort state itself - filtering only narrows
  // the already-sorted list. Options are computed over the whole index, not the filtered subset.
  const filterOptions = useMemo(
    () => demoFilterOptions(scopedDemos.map(demoFilterSubject)),
    [scopedDemos],
  )
  // Story 155: every demo's own sidecar tags, for the notes editor's tag-suggestion input -
  // `suggestTags` excludes the current draft's own tags itself, so duplicates here are harmless.
  const otherDemosTags = useMemo(
    () => scopedDemos.map((demo) => demo.sidecar.values.tags ?? []),
    [scopedDemos],
  )
  const visibleDemos = useMemo(() => {
    const filtered = filterDemos(sortedDemos, filter, demoFilterSubject, Date.now())
    const pinnedId = pinnedRowIdRef.current
    if (pinnedId === null || filtered.some((demo) => demo.id === pinnedId)) return filtered
    const pinnedRow = sortedDemos.find((demo) => demo.id === pinnedId)
    if (pinnedRow === undefined) return filtered
    const visibleIds = new Set(filtered.map((demo) => demo.id))
    visibleIds.add(pinnedId)
    // Keep `sortedDemos`'s own order - the pinned row is inserted at its natural sorted position,
    // not tacked onto the end.
    return sortedDemos.filter((demo) => visibleIds.has(demo.id))
  }, [sortedDemos, filter])

  // Folders sort before demos and ignore the column sort; the demos keep it. The view is built
  // over the filtered, sorted rows, so a folder's count is what survives the filter.
  const rootLabels = useMemo(() => {
    const labels = new Map<string, { name: string; gameDir: string }>()
    for (const demo of demos ?? []) {
      if (demo.source.kind === 'installation') {
        labels.set(demoSourceKey(demo.source), {
          name: demo.source.installationName,
          gameDir: demo.source.gameDir,
        })
      }
    }
    return labels
  }, [demos])
  // Scoped, a root is named by its game dir alone; with every installation shown it also names
  // the installation. Roots no demo reached yet fall back to the installation list.
  const rootLabel = useCallback(
    (sourceKey: string, fallback: string | undefined): string | undefined => {
      let found = rootLabels.get(sourceKey)
      if (found === undefined) {
        for (const installation of installations) {
          const prefix = `installation:${installation.id}:`
          if (sourceKey.startsWith(prefix)) {
            found = { name: installation.name, gameDir: sourceKey.slice(prefix.length) }
            break
          }
        }
      }
      if (found === undefined) return fallback
      return showAll
        ? t('replays.list.source', { installation: found.name, gameDir: found.gameDir })
        : found.gameDir
    },
    [rootLabels, installations, showAll, t],
  )
  const allFoldersLabelled = useMemo(
    () =>
      (folders ?? []).map((f) => ({ ...f, source: rootLabel(f.sourceKey, f.source) ?? f.source })),
    [folders, rootLabel],
  )
  const scopedFolders = useMemo(() => {
    const reached = new Set(scopedDemos.map((demo) => demoSourceKey(demo.source)))
    const own = activeInstallationId === null ? null : `installation:${activeInstallationId}:`
    return (folders ?? [])
      .filter(
        (folder) =>
          scope.kind === 'all' ||
          (scope.kind === 'installation' &&
            (reached.has(folder.sourceKey) ||
              folder.sourceKey.startsWith(EXTRA_KEY_PREFIX) ||
              (own !== null && folder.sourceKey.startsWith(own)))),
      )
      .map((folder) => {
        const source = rootLabel(folder.sourceKey, folder.source)
        return source === undefined ? folder : { ...folder, source }
      })
  }, [folders, scopedDemos, scope, activeInstallationId, rootLabel])
  const folderView = useMemo(
    () =>
      buildFolderView({
        rows: visibleDemos.map((demo) => {
          const sourceKey = demoSourceKey(demo.source)
          const source = rootLabel(sourceKey, sourceLabel(demo))
          return {
            demo,
            sourceKey,
            ...(source === undefined ? {} : { source }),
            folder: demo.folder,
          }
        }),
        folders: scopedFolders,
        current: currentFolder,
      }),
    [visibleDemos, scopedFolders, currentFolder, rootLabel],
  )
  // An active filter searches every folder below the open one, flat; clearing it returns to the
  // folder view of the unchanged `current`.
  const searching = isDemoFilterActive(filter)
  const searchRows = useMemo(
    () =>
      searching
        ? rowsBelow(
            visibleDemos.map((demo) => ({
              demo,
              sourceKey: demoSourceKey(demo.source),
              folder: demo.folder,
            })),
            currentFolder,
          )
        : [],
    [searching, visibleDemos, currentFolder],
  )
  const listedDemos = useMemo(
    () => (searching ? searchRows.map((entry) => entry.demo) : folderView.demos.map((e) => e.demo)),
    [searching, searchRows, folderView],
  )
  const listItems = useMemo<DemoListItem[]>(
    () =>
      searching
        ? searchRows.map((entry): DemoListItem => ({
            kind: 'demo',
            row: entry.demo,
            folderText: [sourceLabel(entry.demo), ...entry.folder].join(' / '),
          }))
        : rootListItems(
            folderView.folders,
            folderView.demos,
            currentFolder === null && scope.kind === 'installation',
          ),
    [searching, searchRows, folderView, currentFolder, scope.kind],
  )
  // Empty folders count: a library of only folders still shows its folders and "New folder".
  const libraryHasEntries = rowCount > 0 || scopedFolders.length > 0
  const listState = deriveReplaysListState({
    scanning,
    rowCount: rowCount + scopedFolders.length,
    scope: scope.kind,
    installationCount: installations.length,
  })
  const noMatch = searching ? searchRows.length === 0 : listItems.length === 0

  // A different installation or scope starts at the tree root (the breadcrumb must not point into
  // an out-of-scope folder); the filter is left as it is.
  const previousScope = useRef({ activeInstallationId, showAll })
  useEffect(() => {
    const previous = previousScope.current
    if (previous.activeInstallationId === activeInstallationId && previous.showAll === showAll)
      return
    previousScope.current = { activeInstallationId, showAll }
    openFolder(null)
  }, [activeInstallationId, showAll, openFolder])

  // The open folder vanished in a rescan: fall back to its nearest surviving ancestor.
  useEffect(() => {
    if (folders === null || currentFolder === null) return
    const nearest = nearestExisting(currentFolder, folders)
    if (
      nearest?.sourceKey !== currentFolder.sourceKey ||
      nearest.path.length !== currentFolder.path.length
    ) {
      openFolder(nearest)
    }
  }, [folders, currentFolder, openFolder])

  // A row filtered out (or left behind by opening another folder) from under the current
  // selection is deselected. Not before the index and folders have loaded: a remount (module
  // switch) starts with no rows at all, and deselecting then would drop a demo left in edit
  // mode (story 178).
  useEffect(() => {
    if (demos === null || folders === null) return
    useDemoEditorStore.getState().deselectIfMissing(listedDemos.map((demo) => demo.id))
  }, [demos, folders, listedDemos])

  // The only replace dialog: every write that met a broken sidecar (row toggle or detail edit)
  // parks behind it, whether or not that demo's detail is open (story 243).
  const rowReplaceId = findRowReplaceId(drafts)
  const rowReplaceEntry = rowReplaceId !== undefined ? drafts[rowReplaceId] : undefined

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('common.label.demos')}
          </h1>
          <p className="text-xs text-ink-muted" data-testid="replays-scope-label">
            {scope.kind === 'installation' && activeInstallation !== null
              ? t('replays.scope.installation', { name: activeInstallation.name })
              : t('replays.scope.all')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Switch
            checked={showAll}
            onChange={setShowAll}
            label={t('replays.scope.all')}
            testId="replays-scope-all"
          />
          <Button
            variant="neutral"
            onClick={() => void scanStart()}
            disabled={scanning}
            data-testid="replays-refresh"
          >
            {scanning ? t('common.action.scanning') : t('replays.list.refresh')}
          </Button>
        </div>
      </header>

      <ReplaysListStatus
        listState={listState}
        progress={progress}
        scope={scope}
        installationName={activeInstallation?.name ?? null}
        onOpenSettings={handleOpenSettings}
      />

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'w-56 shrink-0 overflow-y-auto border-r border-line bg-panel/60 p-4',
            stageMode && 'hidden',
          )}
          aria-label={t('common.label.filters')}
        >
          <DemoListFilterBar
            filter={filter}
            onChange={handleFilterChange}
            options={filterOptions}
            shown={visibleDemos.length}
            total={rowCount}
          />
        </aside>

        {stageMode && <DemoStage />}
        <div
          className={cn(
            '@container min-h-0 min-w-0',
            !stageMode ? 'flex-1' : selected ? 'w-[32rem] shrink-0' : 'hidden',
          )}
          data-testid="replays-list-detail"
        >
          <div className={detailSplit(selected !== null || multiSelected, stageMode)}>
            <div className={cn('flex min-h-0 flex-col p-5', stageMode && 'hidden')}>
              {demos !== null && filterLoaded && rowCount > 0 && noMatch && (
                <div
                  className="flex flex-col items-center gap-3 px-6 py-12 text-center"
                  data-testid="replays-filter-no-match"
                >
                  <p className="text-xs text-ink-muted">{t('replays.filter.noMatch')}</p>
                  <Button
                    variant="neutral"
                    size="sm"
                    onClick={() => handleFilterChange(EMPTY_DEMO_LIST_FILTER)}
                    data-testid="replays-filter-no-match-clear"
                  >
                    {t('common.action.clearFilters')}
                  </Button>
                </div>
              )}
              {(multiSelected || bulk.outcome !== null) && (
                <BulkActionBar
                  count={selectedIds.length}
                  zipCount={zipCount}
                  busy={bulk.busy}
                  outcome={bulk.outcome}
                  onDelete={() => setDeleteIds([...selectedIds])}
                  onTag={() => setBulkDialog({ kind: 'tag', ids: [...selectedIds] })}
                  onMove={() => setBulkDialog({ kind: 'move', ids: [...selectedIds] })}
                />
              )}
              <DemoDragZone onMove={(id, target) => void handleDemoMove(id, target)}>
                {demos !== null && folders !== null && filterLoaded && libraryHasEntries && (
                  <DemoBreadcrumb
                    crumbs={folderView.crumbs}
                    onOpen={openFolder}
                    onNewFolder={() => setFolderDialog({ mode: 'create' })}
                    {...(currentFolder === null
                      ? { newFolderDisabledKey: 'replays.folder.newDisabledTop' }
                      : isInArchive(currentFolder, folders)
                        ? { newFolderDisabledKey: 'replays.folder.archive' }
                        : {})}
                  />
                )}
                {demos !== null && folders !== null && filterLoaded && !noMatch && (
                  <VirtualDemoList
                    items={listItems}
                    onOpenFolder={(folder) => openFolder(folder.ref)}
                    onRenameFolder={(folder) => setFolderDialog({ mode: 'rename', folder })}
                    onDemoMenu={openDemoMenu}
                    onFolderMenu={(folder, at) =>
                      setRowMenu({ at, target: { kind: 'folder', folder } })
                    }
                    selectedIds={selectedIds}
                    onSelect={(id) => {
                      if (id !== pinnedRowIdRef.current) pinnedRowIdRef.current = null
                      selectDemo(id)
                    }}
                    onToggle={(id) => {
                      pinnedRowIdRef.current = null
                      toggleDemo(id)
                    }}
                    onRange={(id, order) => {
                      pinnedRowIdRef.current = null
                      selectRange(id, order)
                    }}
                    onSelectAll={(order) => {
                      pinnedRowIdRef.current = null
                      selectAll(order)
                    }}
                    onClearSelection={() => {
                      pinnedRowIdRef.current = null
                      closeDemo()
                      bulk.dismiss()
                    }}
                    onRowPatched={handleRowPatched}
                    sort={sort}
                    onSort={handleSort}
                  />
                )}
              </DemoDragZone>
            </div>

            {multiSelected && (
              <div
                className={cn(
                  DETAIL_PANE,
                  stageMode ? 'border-l' : 'border-t @4xl:border-t-0 @4xl:border-l',
                )}
                data-testid="replays-multi-selection"
              >
                <SelectionSummary count={selectedIds.length} zipCount={zipCount} />
              </div>
            )}

            {selected && (
              <div
                className={cn(
                  DETAIL_PANE,
                  stageMode ? 'border-l' : 'border-t @4xl:border-t-0 @4xl:border-l',
                )}
              >
                <DemoDetailPanel
                  key={selected.id}
                  row={selected}
                  onClose={() => {
                    pinnedRowIdRef.current = null
                    closeDemo()
                  }}
                  onRowPatched={handleRowPatched}
                  onRename={setRenaming}
                  onMove={(demo) => setBulkDialog({ kind: 'move', ids: [demo.id] })}
                  onDelete={(demo) => setDeleteIds([demo.id])}
                  otherDemosTags={otherDemosTags}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(stageMode && 'h-32 shrink-0 overflow-hidden')}
        data-testid="replays-timeline-slot"
      >
        <DemoTimeline demo={sessionDemo} onRowPatched={handleRowPatched} />
      </div>
      {stageMode && <ConsoleCommandField />}

      {folderDialog?.mode === 'create' && (
        <FolderNameDialog
          titleKey="replays.folder.newFolder"
          submitLabelKey="replays.folder.create"
          initialName=""
          onSubmit={handleFolderCreate}
          onClose={() => setFolderDialog(null)}
        />
      )}
      {folderDialog?.mode === 'rename' && (
        <FolderNameDialog
          titleKey="replays.folder.rename"
          submitLabelKey="common.action.save"
          initialName={folderDialog.folder.name}
          onSubmit={(name) => handleFolderRename(folderDialog.folder, name)}
          onClose={() => setFolderDialog(null)}
        />
      )}

      {bulkDialog?.kind === 'tag' && (
        <TagDemosDialog
          rows={selectedRowsOf(bulkDialog.ids)}
          allTags={otherDemosTags}
          onSubmit={(add, remove) => {
            const ids = bulkDialog.ids
            setBulkDialog(null)
            void bulk.run('tag', ids, (all) => tagDemos(all, add, remove))
          }}
          onClose={() => setBulkDialog(null)}
        />
      )}
      {bulkDialog?.kind === 'move' && (
        <MoveDemosDialog
          folders={allFoldersLabelled}
          current={currentFolder}
          count={bulkDialog.ids.length}
          onMove={(target) => {
            const ids = bulkDialog.ids
            setBulkDialog(null)
            void bulk.run('move', ids, (all) => moveDemos(all, target))
          }}
          onClose={() => setBulkDialog(null)}
        />
      )}

      {deleteIds !== null && (
        <ConfirmDialog
          title={t('replays.bulk.delete.title', { count: deletableCount })}
          body={t('replays.bulk.delete.body', { count: deletableCount })}
          confirmLabel={t('replays.bulk.action.delete')}
          tone="danger"
          onConfirm={() => {
            const ids = deleteIds
            setDeleteIds(null)
            void bulk.run('delete', ids, deleteDemos)
          }}
          onClose={() => setDeleteIds(null)}
          testIds={{ confirm: 'replays-bulk-delete-confirm', cancel: 'replays-bulk-delete-cancel' }}
        />
      )}

      {deletingFolder !== null && (
        <ConfirmDialog
          title={t('replays.folder.delete.title', { name: deletingFolder.name })}
          body={t('replays.folder.delete.body', { count: deletingFolder.demoCount })}
          confirmLabel={t('replays.folder.delete.confirm')}
          tone="danger"
          onConfirm={() => {
            const folder = deletingFolder
            setDeletingFolder(null)
            void handleFolderDelete(folder)
          }}
          onClose={() => setDeletingFolder(null)}
          testIds={{
            confirm: 'replays-folder-delete-confirm',
            cancel: 'replays-folder-delete-cancel',
          }}
        />
      )}

      {renaming !== null && (
        <RenameDemoDialog
          demo={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={handleRenamed}
        />
      )}

      {rowMenu !== null && (
        <DemoRowMenu
          at={rowMenu.at}
          target={rowMenu.target}
          actions={{
            onRename: setRenaming,
            onMove: (ids) => setBulkDialog({ kind: 'move', ids }),
            onDelete: setDeleteIds,
            onTag: (ids) => setBulkDialog({ kind: 'tag', ids }),
            onRenameFolder: (folder) => setFolderDialog({ mode: 'rename', folder }),
            onDeleteFolder: setDeletingFolder,
          }}
          onClose={() => setRowMenu(null)}
        />
      )}

      {confirmingModMissing && askFirst && eligibility !== null && !eligibility.ok && (
        <ModMissingConfirmDialog
          gameDir={modGameDir}
          {...(modOffer !== null && activeInstallationId !== null
            ? { installOffer: { name: modOffer.name }, onInstall: handleInstall }
            : {})}
          installPending={installPending}
          {...(installError !== null ? { installError } : {})}
          onCancel={() => setConfirmingModMissing(false)}
          onConfirm={(dontAskAgain) => {
            setConfirmingModMissing(false)
            if (!dontAskAgain) {
              void play(true)
              return
            }
            void trustModWarningMod(modGameDir).finally(() => void play(true))
          }}
        />
      )}

      {decision && !answeredDecisions.includes(decision.jobId) && (
        <InstallDecisionDialog
          request={decision}
          onAnswered={(jobId) => {
            setAnsweredDecisions((prev) => [...prev, jobId])
            setDecision(null)
          }}
        />
      )}

      {rowReplaceId !== undefined && rowReplaceEntry?.replace !== undefined && (
        <ReplaceSidecarDialog
          fileName={rowReplaceEntry.replace.fileName}
          issues={rowReplaceEntry.replace.issues}
          onConfirm={() =>
            void useDemoEditorStore.getState().confirmEdit(rowReplaceId, handleRowPatched)
          }
          onCancel={() => cancelEdit(rowReplaceId)}
        />
      )}
    </div>
  )
}
