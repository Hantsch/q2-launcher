import { useEffect, useRef, useState } from 'react'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { CreateProfileDialog } from './CreateProfileDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { ImportProfileDialog } from './ImportProfileDialog'
import { ProfileChangesProvider } from './lib/profile-changes'
import { RawDraftProvider } from './lib/raw-draft'
import { isProfileDirty } from './lib/save-bar'
import { useDriftState } from './lib/use-drift-state'
import { ProfileDraftProvider } from './lib/ProfileDraftProvider'
import { useProfileFileSync } from './lib/useProfileFileSync'
import { ConfigDetailHeader } from './components/ConfigDetailHeader'
import { ConfigListScreen } from './components/ConfigListScreen'
import { ConfigTabContent, type TabFocusState, type GoToTab } from './components/ConfigTabContent'
import { ConfigTabStrip } from './components/ConfigTabStrip'
import { ProfileFileBanners } from './components/ProfileFileBanners'
import { RenameProfileDialog } from './RenameProfileDialog'
import { useConfigProfiles } from './config-profiles-store'

type Screen = 'list' | 'detail'

/**
 * The config module's view: a list of profiles first, so "what configs do I
 * have" is the landing state rather than one profile's editor - selecting a
 * profile navigates into its detail (tabs, starting on the keyboard overview
 * per CFG-7), with a back button rather than a permanent master/detail split.
 */
export function ConfigView() {
  const profiles = useConfigProfiles((s) => s.profiles)
  const loadProfiles = useConfigProfiles((s) => s.load)
  const replaceAll = useConfigProfiles((s) => s.replaceAll)
  const upsert = useConfigProfiles((s) => s.upsert)
  /** Whether this mount's own `load()` has settled - the stored list may predate it. */
  const [listLoaded, setListLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('list')
  const [tabState, setTabState] = useState<TabFocusState>({ tab: 'overview' })
  const activeTab = tabState.tab
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  const consumeRouteFocus = useLauncher((state) => state.consumeRouteFocus)

  // The store outlives this view, so the list it holds on mount may be stale; re-read it on every
  // mount. A failed read leaves the stored list as it was.
  useEffect(() => {
    let cancelled = false
    void loadProfiles().then(() => {
      if (!cancelled) setListLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadProfiles])

  // A profile that disappears out from under an open detail view (deleted,
  // or gone after a reload) sends the view back to the list rather than
  // rendering a detail screen for nothing.
  useEffect(() => {
    if (selectedId && !profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(null)
      setScreen('list')
    }
  }, [profiles, selectedId])

  /**
   * The dashboard's config-profiles tile navigates here with a profile id as the shell's one-shot
   * `routeFocus`; it becomes a selection through the same `openProfile` a row click uses.
   *
   * ONE effect re-running on `profiles`/`listLoaded`: the stored list on mount may not hold the
   * hinted id yet, so the hint is consumed once, parked in a ref and applied on the first commit
   * whose `profiles` contains it. The ref is cleared once applied or once this mount's load settled
   * without it (a since-deleted profile is dropped, not awaited). It also makes StrictMode's double
   * mount effect safe: the second `consumeRouteFocus()` returns nothing and must not overwrite
   * the parked value nor re-open the profile.
   */
  const pendingFocusIdRef = useRef<string | null>(null)
  useEffect(() => {
    // `unknown` from the shell, which knows nothing about profile ids - so validate the shape here.
    const focus = consumeRouteFocus()
    if (typeof focus === 'string' && focus.length > 0) pendingFocusIdRef.current = focus

    const pending = pendingFocusIdRef.current
    if (!pending) return
    const found = profiles.some((profile) => profile.id === pending)
    if (!found && !listLoaded) return
    pendingFocusIdRef.current = null
    if (found) openProfile(pending)
  }, [profiles, listLoaded, consumeRouteFocus])

  useEffect(() => {
    setActiveLayerId(null)
  }, [selectedId])

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null
  const activeLayer = selected?.layers?.find((layer) => layer.id === activeLayerId) ?? null

  /** Owned here rather than by `CareTab` so the file-sync rows are fetched on the re-read triggers
   * and feed the Care badge whether or not Care is ever opened. */
  const driftState = useDriftState(selectedId, selected?.updatedAt)

  const openProfile = (id: string): void => {
    setSelectedId(id)
    setTabState({ tab: 'overview' })
    setScreen('detail')
  }

  const backToList = (): void => {
    setScreen('list')
  }

  /** The one place cross-tab deep links go through. A plain tab click passes no `focus`, which
   * clears a previous deep link's target so it can never linger and re-fire. */
  const goToTab: GoToTab = (tab, focus) => {
    setTabState({
      tab,
      focusAlias: focus?.alias,
      focusAliasActionId: focus?.aliasActionId,
      focusActionId: focus?.actionId,
      focusLayerName: focus?.layerName,
    })
  }

  /**
   * The Aliases tab's owner link for a layer row routes to Overview with a `layerName`; this
   * resolves it to the layer's id through the same selection `LayersPanel` uses for a click. Matched
   * against `selected` because `LayersPanel` renders `profile={selected}` - the same layer list.
   */
  useEffect(() => {
    if (activeTab !== 'overview' || !tabState.focusLayerName) return
    const layer = selected?.layers?.find((candidate) => candidate.name === tabState.focusLayerName)
    if (layer) setActiveLayerId(layer.id)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `selected` is read at the moment the focus request lands, not a trigger.
  }, [tabState])

  /**
   * `create` and `import.commit` both return the full updated list, so the new profile is the id
   * not already in `profiles`. Both dialogs close here (only one is ever mounted) and the view
   * navigates straight into the new profile.
   */
  const handleCreated = (updated: ConfigProfile[]): void => {
    const previousIds = new Set(profiles.map((profile) => profile.id))
    const created = updated.find((profile) => !previousIds.has(profile.id))
    replaceAll(updated)
    setShowCreate(false)
    setShowImport(false)
    const target = created ?? updated[updated.length - 1]
    if (target) openProfile(target.id)
  }

  const handleRenamed = (updated: ConfigProfile[]): void => {
    replaceAll(updated)
    setShowRename(false)
  }

  const handleDeleted = (updated: ConfigProfile[]): void => {
    replaceAll(updated)
    setShowDelete(false)
    setSelectedId(null)
    setScreen('list')
  }

  /** `tidyUp.apply` returns the one profile it mutated, not the full list: fold it in by id. */
  const handleProfileUpdated = (updated: ConfigProfile): void => {
    upsert(updated)
  }

  const { fileDiagnostic, rewriting, rewriteFromCache, rawDraftActive, onRawDraftActiveChange } =
    useProfileFileSync({
      selectedId,
      selected,
      onUpdated: handleProfileUpdated,
      onAfterRefresh: driftState.refetch,
    })

  /** Structured edits (`profile.dirty`) or a raw draft (mirrored out of `RawDraftProvider`, which
   * this component mounts and so cannot read). The Unsaved tab exists only while it is true. */
  const hasUnsaved = selected !== null && (isProfileDirty(selected) || rawDraftActive)

  /**
   * Saving or discarding the last change makes the Unsaved tab disappear underneath the user, so
   * the view falls back to Overview rather than leaving `activeTab` pointing at a tab with no
   * button in the strip (which would render an empty Panel with no way back).
   */
  useEffect(() => {
    if (activeTab === 'unsaved' && !hasUnsaved) setTabState({ tab: 'overview' })
  }, [activeTab, hasUnsaved])

  // The raw tab turns the view into a full-height code editor: the page stops scrolling and hands
  // its height down a flex chain (outer -> content -> detail wrapper -> the Panel). Only the fill
  // chain and the bottom padding differ per tab; header, strip and top/side padding never do, or
  // the header would start at a different `y` per tab. Gated on `screen === 'detail'` because
  // `activeTab` does not reset on `backToList`.
  const isRawFill = screen === 'detail' && activeTab === 'raw'

  // `scrollbar-gutter-stable`: tabs flip between overflowing and not (Overview <-> Settings);
  // without the reserve the content box width jumps when the scrollbar appears.
  return (
    <div
      className={cn(
        'h-full scrollbar-gutter-stable',
        isRawFill ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
      )}
    >
      <div
        className={cn(
          'mx-auto max-w-[92rem] px-8',
          // `pt-2` and the detail wrapper's `space-y-1` are budgeted against the 30-visible-editor-
          // line floor (`scripts/flows/config-header-geometry.mjs`); the list screen has no header
          // or strip to be consistent with and keeps its own rhythm.
          screen === 'detail'
            ? cn('pt-2', isRawFill ? 'flex flex-1 min-h-0 flex-col pb-0' : 'pb-8')
            : 'space-y-6 py-8',
        )}
      >
        {screen === 'list' && (
          <ConfigListScreen onOpen={openProfile} onCreate={() => setShowCreate(true)} />
        )}

        {screen === 'detail' && selected && (
          <ProfileChangesProvider profile={selected} key={selected.id}>
            <ProfileDraftProvider profile={selected}>
              {/* The raw-text draft lives next to the structured change set, not inside it: one
                  provider per source of "unsaved", both wrapping the whole detail screen so the
                  save bar can act on either. A raw save returns an ordinary updated profile. */}
              <RawDraftProvider
                profile={selected}
                onSaved={handleProfileUpdated}
                onActiveChange={onRawDraftActiveChange}
              >
                <div className={cn('space-y-1', isRawFill && 'flex flex-1 min-h-0 flex-col')}>
                  <ConfigDetailHeader
                    onBack={backToList}
                    onRename={() => setShowRename(true)}
                    onDelete={() => setShowDelete(true)}
                  />

                  <ProfileFileBanners
                    profile={selected}
                    diagnostic={fileDiagnostic}
                    rewriting={rewriting}
                    onRewrite={() => void rewriteFromCache()}
                    onDelete={() => setShowDelete(true)}
                  />

                  <ConfigTabStrip
                    activeTab={activeTab}
                    onChange={(tab) => goToTab(tab)}
                    hasUnsaved={hasUnsaved}
                    driftStatus={driftState.status}
                  />

                  <ConfigTabContent
                    focus={tabState}
                    isRawFill={isRawFill}
                    activeLayer={activeLayer}
                    activeLayerId={activeLayerId}
                    onSelectLayer={setActiveLayerId}
                    driftState={driftState}
                    goToTab={goToTab}
                  />
                </div>
              </RawDraftProvider>
            </ProfileDraftProvider>
          </ProfileChangesProvider>
        )}
      </div>

      {showCreate && (
        <CreateProfileDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          onWantImport={() => {
            setShowCreate(false)
            setShowImport(true)
          }}
        />
      )}

      {showImport && (
        <ImportProfileDialog
          profiles={profiles}
          onClose={() => setShowImport(false)}
          onCreated={handleCreated}
        />
      )}

      {showRename && selected && (
        <RenameProfileDialog
          profile={selected}
          onClose={() => setShowRename(false)}
          onRenamed={handleRenamed}
        />
      )}

      {showDelete && selected && (
        <DeleteProfileDialog
          profile={selected}
          onClose={() => setShowDelete(false)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
