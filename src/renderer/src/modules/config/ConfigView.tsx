import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ChevronRight,
  FilePlus2,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { ConfigProfile, RefreshedProfileResult } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { formatRelativeTime } from '../../lib/format'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge, EmptyState, KeyValue, Panel, SectionLabel } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { AliasesTab } from './AliasesTab'
import { ControlsTab } from './ControlsTab'
import { AssignmentsMenu } from './AssignmentsMenu'
import { CareTab } from './CareTab'
import { CreateProfileDialog } from './CreateProfileDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { ImportProfileDialog } from './ImportProfileDialog'
import { InstallationProfilesPanel } from './InstallationProfilesPanel'
import { LayersPanel } from './LayersPanel'
import { dedupedFindingCounts } from './lib/care-summary'
import {
  applyRefreshedProfile,
  droppedAliasWarning,
  noticeForRefreshedProfile,
} from './lib/file-source-refresh'
import { ProfileChangesProvider } from './lib/profile-changes'
import { RawDraftProvider, useRawDraft } from './lib/raw-draft'
import { isProfileDirty, resolveSaveOutcome } from './lib/save-bar'
import { analyzeTidyUp } from './lib/tidy-up-findings'
import { useDriftState } from './lib/use-drift-state'
import { validateProfileForEngines } from './lib/validation-scope'
import { useFileSourceRefresh } from './lib/useFileSourceRefresh'
import { useProfileDraft } from './lib/useProfileDraft'
import { OverviewKeyboardPanel } from './OverviewKeyboardPanel'
import { ProfileSaveActions } from './components/ProfileSaveActions'
import { UnsavedChangesTab } from './components/UnsavedChangesTab'
import { UnsavedIndicator, UnsavedTabBadge } from './components/UnsavedIndicator'
import { RawFileTab } from './RawFileTab'
import { RenameProfileDialog } from './RenameProfileDialog'
import { SettingsTab } from './SettingsTab'
import { listConfigProfiles, saveConfigProfile } from './client'

/** A parse/read diagnostic surfaced for the currently selected profile (story 043 D7) - kept
 * separate from `ConfigProfile` itself since `refreshFromFiles` never persists the message/line,
 * only the display-hint `fileState` (`ProfilesStore.setFileState`). Scoped to one profile id so a
 * stale diagnostic from a previously selected profile is never shown against a different one. */
interface FileDiagnostic {
  profileId: string
  file?: string
  line?: number
  message: string
}

type Screen = 'list' | 'detail'
type DetailTab = 'overview' | 'settings' | 'controls' | 'aliases' | 'raw' | 'care' | 'unsaved'

/**
 * Story 044 D6: the active tab, widened to optionally carry a focus target for the tab it is
 * switching to - the one cross-tab deep-link mechanism Care -> Aliases, Aliases -> Controls and
 * (review fix, finding 1) Aliases -> Overview all go through (`goToTab` below). Only one of
 * `focusAlias`/`focusActionId`/`focusLayerName` is ever set at a time (the caller picks exactly
 * one), but there is no need to model that as a union: each target tab reads only the one field it
 * understands and ignores the others, and a plain tab-button click (`goToTab(tab.id)` with no
 * `focus`) always clears all three - so a deep-link target can never linger and re-fire once the
 * user has navigated away by hand.
 */
interface TabFocusState {
  tab: DetailTab
  focusAlias?: string
  /** Story 060 D1: the duplicate-alias finding's owning entry id, alongside `focusAlias` - lets the
   * Aliases tab's focus effect target one specific colliding row instead of "first row with this
   * name" when two entries share a name. Unset for every other deep link into Aliases, which still
   * resolves by name alone. */
  focusAliasActionId?: string
  focusActionId?: string
  focusLayerName?: string
}

/**
 * Story 057 D5, the other half of AC7 ("raw editing and the structured tabs never hold two unsaved
 * truths at once"): while the Raw file tab holds a typed-but-unsaved draft, every *other* tab's
 * content is `inert` - not focusable, not clickable, not reachable by assistive tech - with one line
 * saying why. Enforced in this one place rather than by threading a `disabled` prop through five
 * tabs' worth of controls (story Decisions); `inert` is a real HTML attribute React 19 passes
 * through, so it covers controls this file has never heard of.
 *
 * Its own component (rather than inline in `ConfigView`) for one reason: `useRawDraft` has to be
 * called *below* the `RawDraftProvider` that `ConfigView` itself renders.
 */
function StructuredTabsGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const rawDraft = useRawDraft()

  return (
    <>
      {rawDraft.active && (
        <p className="mb-3 text-xs text-ink-muted" data-testid="config-tabs-locked-hint">
          {t('config.raw.tabsLockedByDraft')}
        </p>
      )}
      <div inert={rawDraft.active}>{children}</div>
    </>
  )
}

/**
 * Review fix (story 057, blocker 2): the detail header's Rename control also ends in a
 * `markUnsaved`-shaped update (`RenameProfileDialog`'s own submit), and sat outside
 * `StructuredTabsGuard` - which only wraps the non-raw tab branch, so it never covered this header,
 * rendered above the tabs regardless of which one is active. Its own component for the same reason
 * `StructuredTabsGuard` is: `useRawDraft` must be called *below* the `RawDraftProvider` `ConfigView`
 * itself renders, not inside `ConfigView`'s own body. Reuses the identical
 * `config.raw.tabsLockedByDraft` hint text as a `title` tooltip - the same string
 * `StructuredTabsGuard`/`RawFileTab`'s toolbar-row hint use, just surfaced through the icon button's
 * existing `title` mechanism (`IconButton` already renders one from `label`) rather than a new
 * paragraph squeezed into the header row.
 */
function RenameHeaderButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const rawDraft = useRawDraft()
  return (
    <IconButton
      label={t('config.detail.rename')}
      size="sm"
      disabled={rawDraft.active}
      title={rawDraft.active ? t('config.raw.tabsLockedByDraft') : t('config.detail.rename')}
      onClick={onClick}
    >
      <Pencil className="size-3.5" />
    </IconButton>
  )
}

/**
 * The config module's view: a list of profiles first, so "what configs do I
 * have" is the landing state rather than one profile's editor - selecting a
 * profile navigates into its detail (tabs, starting on the keyboard overview
 * per CFG-7), with a back button rather than a permanent master/detail split.
 */
export function ConfigView() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ConfigProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('list')
  const [tabState, setTabState] = useState<TabFocusState>({ tab: 'overview' })
  const activeTab = tabState.tab
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [fileDiagnostic, setFileDiagnostic] = useState<FileDiagnostic | null>(null)
  const [rewriting, setRewriting] = useState(false)

  const pushToast = useLauncher((state) => state.pushToast)
  const consumeRouteFocus = useLauncher((state) => state.consumeRouteFocus)

  useEffect(() => {
    let cancelled = false
    void listConfigProfiles().then((result) => {
      if (!cancelled && result.ok) setProfiles(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
   * Story 087 D5: the dashboard's config-profiles tile navigates here with the clicked profile's
   * id as the shell's one-shot `routeFocus` (`setRoute('/config', id)`), and this is where that
   * hint becomes a selection - through the same `openProfile` a row click on the list screen uses,
   * not a second selection path.
   *
   * Deliberately ONE effect that re-runs on `profiles`, rather than a plain mount effect: the hint
   * is there before `listConfigProfiles` has answered, so seeding `selectedId` on mount alone would
   * be undone on the very next tick by the reset effect right above (an id that is in no profile
   * yet). So the hint is consumed once - on mount, while `profiles` is still empty - parked in a
   * ref, and applied only on the commit where a non-empty `profiles` actually contains it. At that
   * point the reset effect agrees with the selection by construction, and it runs *before* this one
   * in every commit anyway (declaration order), so the two can never fight.
   *
   * One-shot on both halves, which is what "navigating away and back does not re-apply a stale
   * focus" needs: `consumeRouteFocus` clears the store's hint on the first read, so a second mount
   * of this view (the route switch unmounts it - `resolveView` renders a different component) gets
   * nothing and lands on the list; and the ref is cleared as soon as any non-empty list has
   * arrived, matched or not, so a hint naming a since-deleted profile is dropped instead of waiting
   * for some later list to match it. The ref is also what makes this safe under StrictMode's
   * double-invoked mount effect: the second `consumeRouteFocus()` returns nothing and must not
   * overwrite what the first call parked.
   */
  const pendingFocusIdRef = useRef<string | null>(null)
  useEffect(() => {
    // `unknown` from the shell, which knows nothing about profile ids - so validate the shape here.
    const focus = consumeRouteFocus()
    if (typeof focus === 'string' && focus.length > 0) pendingFocusIdRef.current = focus

    const pending = pendingFocusIdRef.current
    if (!pending || profiles.length === 0) return
    pendingFocusIdRef.current = null
    if (profiles.some((profile) => profile.id === pending)) openProfile(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, consumeRouteFocus])

  useEffect(() => {
    setActiveLayerId(null)
  }, [selectedId])

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null
  const activeLayer = selected?.layers?.find((layer) => layer.id === activeLayerId) ?? null

  // Story 009 D6: the shared in-progress draft every tab reads from and
  // writes into, so the Validation tab (D5) sees an edit the instant it
  // happens rather than waiting for a debounced save to land. `draft` lags
  // `selected` by one render right after a profile switch (its own reseed
  // effect fires after this render), the same one-tick staleness the removed
  // per-tab local states already had - `draftOrSelected` is what every child
  // below actually receives, so that gap is never visible outside this file.
  // Story 049 D7: `SettingsTab`'s "edited"/"unsaved" signal now comes from `useProfileChanges()`
  // (main-process `profile.baseline` diff), not from a renderer-local baseline inside
  // `useProfileDraft` - that mechanism (`savedCvars`, story 048 D6) had no other consumer left, so
  // it was removed from the hook outright rather than kept around unread.
  const { draft, patch, resetDraft } = useProfileDraft(selected)

  const draftOrSelected = draft ?? selected
  /**
   * `draftOrSelected` narrowed to non-null: its own type stays `ConfigProfile
   * | null` because it was computed before the `selected &&` guard below, so
   * TypeScript cannot see that `draft` can only be null when `selected` is -
   * this makes that fact explicit at each call site instead of repeating a
   * `?? selected` that reads like a real third fallback (review finding).
   */
  const activeProfile = (current: ConfigProfile): ConfigProfile => draftOrSelected ?? current

  const installations = useLauncher((state) => state.installations)

  /**
   * Story 079 D6 (AC5): the profile's file-sync/drift rows, owned here rather than by `CareTab` so
   * they are fetched on the canonical re-read triggers below (and on a save) whether or not Care is
   * ever opened. `driftState.status` is handed to `CareTab`; `driftState.refetch` is wired below as
   * `useFileSourceRefresh`'s `onAfterRefresh` for the mount/profile-open and focus triggers, and
   * `CareTab` also gets it directly to re-check after a Files action. Declared here, ahead of
   * `useFileSourceRefresh` itself, because D7 also needs `driftState.status` for the tab badge below.
   */
  const driftState = useDriftState(selectedId, selected?.updatedAt)

  // Computed once here rather than separately in the tab badge and in
  // `ValidationPanel` - both used to run `validateProfileForEngines` on the
  // same draft independently (review finding).
  const validation = useMemo(
    () =>
      draftOrSelected
        ? validateProfileForEngines(draftOrSelected, installations)
        : { status: 'unassigned' as const, byEngine: [], omitted: [] },
    [draftOrSelected, installations],
  )
  // Story 025 D8: the tab badge counts validation findings and tidy-up
  // findings together, de-duplicated by finding id (`dedupedFindingCounts`,
  // `lib/care-summary.ts`) - the alias-wiring rules feed both lists, so a
  // naive sum of `totalCounts(validation)` and `analyzeTidyUp(...).length`
  // would double-count them. Computed from `selected`, not `draftOrSelected`
  // - decision 3: tidy-up (unlike the validation report) always answers
  // against the *saved* profile, since that is what `tidyUp.apply` actually
  // mutates. `analyzeTidyUp` is pure and cheap, computed here the same way
  // `validation` already is, so the badge and `CareTab`'s own copy (needed
  // for its summary) never depend on one another.
  const tidyUpFindings = useMemo(() => (selected ? analyzeTidyUp(selected) : []), [selected])
  // Story 079 D7 (AC6): the badge also counts non-`inSync` Files rows, so a drifted/missing/failed
  // copy shows up the same way an unresolved finding does - `driftState.status` is only `'loaded'`
  // once the fetch resolves, so there is nothing to add while it is still loading or has errored.
  const driftRows = driftState.status.kind === 'loaded' ? driftState.status.rows : []
  // Story 079 review (finding 4): `selected.dirty`, not `draftOrSelected`'s - same profile
  // `tidyUpFindings` above reads, and what tells `dedupedFindingCounts` a canonical `outOfSync` row
  // is merely unsaved edits (excluded from the count) rather than a genuine external edit (still
  // counted); see `care-summary.ts`'s doc comment.
  const validationCounts = useMemo(
    () => dedupedFindingCounts(validation, tidyUpFindings, driftRows, selected?.dirty),
    [validation, tidyUpFindings, driftRows, selected?.dirty],
  )

  const openProfile = (id: string): void => {
    setSelectedId(id)
    setTabState({ tab: 'overview' })
    setScreen('detail')
  }

  const backToList = (): void => {
    setScreen('list')
  }

  /**
   * Story 044 D6: the one place both cross-tab deep links go through - Care's alias findings
   * ("show in Aliases") and the Aliases tab's owner link ("show on Controls"). A plain tab-button
   * click passes no `focus`, which is what clears a previous deep link's target the moment the user
   * navigates by hand instead of following another link (see `TabFocusState`'s own doc comment).
   */
  const goToTab = (
    tab: DetailTab,
    focus?: { alias?: string; aliasActionId?: string; actionId?: string; layerName?: string },
  ): void => {
    setTabState({
      tab,
      focusAlias: focus?.alias,
      focusAliasActionId: focus?.aliasActionId,
      focusActionId: focus?.actionId,
      focusLayerName: focus?.layerName,
    })
  }

  /**
   * Review fix (story 044, finding 1): the Aliases tab's owner link for a `layer`-origin row used to
   * land on Controls and do a best-effort scan there for a row bound to that layer's modifier, which
   * focused nothing for a layer whose overrides are all hand-typed or a brand-new layer with none yet
   * - a click with no visible outcome. A layer's actual owning surface is Overview's `LayersPanel`
   * (its CRUD - rename, mode, trigger key - lives there, not on any single Controls row), so the link
   * now routes to `goToTab('overview', { layerName })` and this effect resolves that name to the
   * layer's id, reusing the same `activeLayerId`/`onSelectLayer` selection `LayersPanel` already
   * supports for a click in its own list - so this can never disagree with what clicking a layer
   * there does. Matched against `selected`, not `draftOrSelected`: `LayersPanel` itself renders
   * `profile={selected}` below, so this must resolve against the exact same layer list it reads.
   */
  useEffect(() => {
    if (activeTab !== 'overview' || !tabState.focusLayerName) return
    const layer = selected?.layers?.find((candidate) => candidate.name === tabState.focusLayerName)
    if (layer) setActiveLayerId(layer.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabState])

  /**
   * `create` returns the full updated list rather than just the new profile, so
   * the newly-created one is whichever id in the response was not already in
   * `profiles` - reliable regardless of naming, since ids are always unique.
   *
   * Shared verbatim by `ImportProfileDialog` (`import.commit` returns the same
   * "full updated list" shape, per its contract) - it closes both dialogs
   * rather than knowing which one is currently open, since only one of them
   * can be mounted at a time anyway. A successful create/import navigates
   * straight into the new profile, since there is nothing useful to look at
   * on the list for it yet.
   */
  const handleCreated = (updated: ConfigProfile[]): void => {
    const previousIds = new Set(profiles.map((profile) => profile.id))
    const created = updated.find((profile) => !previousIds.has(profile.id))
    setProfiles(updated)
    setShowCreate(false)
    setShowImport(false)
    const target = created ?? updated[updated.length - 1]
    if (target) openProfile(target.id)
  }

  const handleRenamed = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    setShowRename(false)
  }

  const handleDeleted = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    setShowDelete(false)
    setSelectedId(null)
    setScreen('list')
  }

  /**
   * `tidyUp.apply` (story 025 D5, `CareTidyUpSection`) returns just the one
   * profile it mutated, not the full list every other mutation here returns
   * (`setCvars`/`setActions`/... via `onChanged={setProfiles}`). Same update
   * path all the same - `profiles` is still the one piece of state everything
   * reads `selected` from - just folding a single fresh profile back into it
   * by id instead of replacing the whole array wholesale.
   */
  const handleProfileUpdated = (updated: ConfigProfile): void => {
    setProfiles((prev) => prev.map((profile) => (profile.id === updated.id ? updated : profile)))
  }

  /**
   * Story 049 D6: `discard` (like `remove`/`rename`) returns the full, updated profile list.
   * `resetDraft` is called with the discarded profile itself (found in that list, not re-read from
   * `selected`, which still holds the pre-discard value at this point in the render) so
   * `useProfileDraft` force-adopts the reverted baseline instead of keeping the stale locally-patched
   * cvars/actions its own reconcile effect would otherwise protect - see `resetDraft`'s own doc
   * comment for why the effect alone cannot do this.
   */
  const handleDiscarded = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    if (!selectedId) return
    const discarded = updated.find((profile) => profile.id === selectedId)
    if (discarded) resetDraft(discarded)
  }

  /**
   * Story 043 D7: the outcome of one `useFileSourceRefresh` re-read for the selected profile.
   * `applyRefreshedProfile` folds the outcome into `profiles` (a no-op for `unchanged`/`conflict`,
   * a full replace for `adopted`, a `fileState`-only patch for `missing`/`unparseable`/`readError` -
   * see its own doc comment); `noticeForRefreshedProfile` says what, if anything, needs surfacing
   * on top of that.
   *
   * `adopted` is reported as a toast (AC3: "never a silent swap") - this module's existing one-shot
   * transient-notice idiom, per `ProfileSaveActions`'s own `pushToast` usage. `conflict` is reported the
   * same way `ProfileSaveActions`/`resolveSaveOutcome` (D6) stub it: a plain toast, no dialog - D5's own
   * doc comment already says this pair of triggers should not realistically produce a conflict
   * (that needs a dirty profile plus an external edit in the same instant), and the real two-pane
   * resolution is D8's job.
   */
  const handleFileSourceResult = (result: RefreshedProfileResult): void => {
    setProfiles((prev) => applyRefreshedProfile(prev, result))

    const notice = noticeForRefreshedProfile(result)
    if (notice?.kind === 'reloaded') {
      pushToast({ level: 'info', messageKey: 'config.fileSource.reloaded', timeoutMs: 6000 })
      // Story-050 review (finding 4, second round): the reload kept only the last definition of an
      // alias name the file spelled twice, so an entry's commands are gone from the profile that
      // just replaced the cached one. Its own toast next to the `info` one above, built by
      // `droppedAliasWarning` - the same single definition Care's Reload and the conflict dialog's
      // "Take the file" push through `adoptProfileFromFile` (finding 1, third round), so the three
      // adopt paths can never word this differently or forget it.
      const warning = droppedAliasWarning(notice.droppedAliases)
      if (warning) pushToast(warning)
    } else if (notice?.kind === 'conflict') {
      pushToast({ level: 'error', messageKey: 'config.fileSource.conflict', timeoutMs: 0 })
    }

    setFileDiagnostic((prev) => {
      if (notice?.kind === 'diagnostic') {
        return {
          profileId: result.profileId,
          file: notice.file,
          line: notice.line,
          message: notice.message,
        }
      }
      // Any other outcome for the same profile means the diagnostic no longer applies (the file
      // came back readable, was adopted, or went missing instead) - a diagnostic for a different
      // profile is left alone.
      return prev?.profileId === result.profileId ? null : prev
    })
  }

  /**
   * Review fix (story 057): whether the Raw file tab currently holds a typed-but-unsaved draft.
   *
   * A ref, written by `RawDraftProvider`'s `onActiveChange` below and never read during render, for
   * two reasons: this view must not re-render on every keystroke that starts or ends a draft, and
   * `useFileSourceRefresh` asks the question at trigger time anyway. It cannot come from
   * `useRawDraft()` here - that provider is mounted *inside* this component's own tree (which is why
   * `StructuredTabsGuard`/`RenameHeaderButton` exist as separate components), while the re-read hook
   * has to keep running for the whole view. See the prop's own doc comment for why re-reading under
   * an open draft silently destroyed external edits.
   */
  const rawDraftActiveRef = useRef(false)
  /**
   * The same `active` signal as the ref above, as state - the ref exists because
   * `useFileSourceRefresh` must not re-render on it, but the Unsaved tab's own visibility must
   * (it is a tab that appears and disappears). Both are set from the one `onActiveChange` call
   * below, so they cannot drift.
   */
  const [rawDraftActive, setRawDraftActive] = useState(false)

  useFileSourceRefresh({
    profileId: selectedId,
    isSuspended: () => rawDraftActiveRef.current,
    onResult: handleFileSourceResult,
    onAfterRefresh: driftState.refetch,
  })

  /**
   * The "Rewrite from cache" action on the `fileState: 'missing'` banner (story 043 D7) - reuses
   * D4's existing `save` handler exactly as-is: `save` writes from cache whenever the file is
   * missing or unchanged, so there is nothing new to build on the main side. `resolveSaveOutcome`
   * (D6, `lib/save-bar.ts`) is reused rather than re-implemented for the failure branches, so an
   * unreadable-file surprise here reports through the identical toast `ProfileSaveActions` would.
   *
   * A `'conflict'` outcome (story 043 D8's new action type) is not expected on this path - the
   * file was reported `missing` a moment ago, so a save reaching `changedOnDisk` here means it
   * reappeared between the banner rendering and this click. This deliberately does not open
   * `ConfigConflictDialog` for that vanishingly rare race (this button's whole point is a MISSING
   * file, not a changed one) - it falls back to the same plain toast `useFileSourceRefresh`'s own
   * conflict surfacing already uses (`handleFileSourceResult` above).
   */
  const handleRewriteFromCache = async (): Promise<void> => {
    if (!selected) return
    setRewriting(true)
    const outcome = await saveConfigProfile({ profileId: selected.id })
    setRewriting(false)

    const action = resolveSaveOutcome(outcome)
    if (action.type === 'saved') {
      handleProfileUpdated(action.profile)
      return
    }
    if (action.type === 'conflict') {
      pushToast({ level: 'error', messageKey: 'config.fileSource.conflict', timeoutMs: 0 })
      return
    }
    pushToast({
      level: 'error',
      messageKey: action.messageKey,
      timeoutMs: 0,
      ...(action.params ? { params: action.params } : {}),
    })
  }

  /**
   * There is something unsaved right now - either structured edits (`profile.dirty`, the server's
   * own flag) or a raw text draft (mirrored out of `RawDraftProvider` above, since this component
   * mounts that provider and so cannot read its context). Computed here rather than inside the
   * unsaved components because the *tab strip* needs it: the Unsaved tab exists only while it is
   * true.
   */
  const hasUnsaved = selected !== null && (isProfileDirty(selected) || rawDraftActive)

  /**
   * Saving or discarding the last change makes the Unsaved tab disappear underneath the user, so
   * the view falls back to Overview rather than leaving `activeTab` pointing at a tab with no
   * button in the strip (which would render an empty Panel with no way back).
   */
  useEffect(() => {
    if (activeTab === 'unsaved' && !hasUnsaved) setTabState({ tab: 'overview' })
  }, [activeTab, hasUnsaved])

  const tabs: {
    id: DetailTab
    label: string
    badge?: string
    badgeTone?: 'danger' | 'warning'
    /** A rendered badge instead of a string, for a count only a component below the detail
     * screen's providers can compute (`UnsavedTabBadge`). */
    badgeNode?: ReactNode
  }[] = [
    { id: 'overview', label: t('config.tabs.overview') },
    { id: 'settings', label: t('config.tabs.settings') },
    { id: 'controls', label: t('config.tabs.controls') },
    { id: 'aliases', label: t('config.tabs.aliases') },
    { id: 'raw', label: t('config.tabs.raw') },
    {
      id: 'care',
      label: t('config.tabs.care'),
      // Errors take priority over warnings for the one badge a tab button can
      // show; the panel itself lists both. Always present (never conditional
      // on findings existing) - see `ValidationPanel`'s own doc comment.
      ...(validationCounts.errors > 0
        ? { badge: String(validationCounts.errors), badgeTone: 'danger' as const }
        : validationCounts.warnings > 0
          ? { badge: String(validationCounts.warnings), badgeTone: 'warning' as const }
          : {}),
    },
    // Last in the strip, to the right of Care, and only while there is actually something
    // unsaved - the two dirty states are transient, so unlike Care (always present) a permanent
    // tab here would be empty most of the time. Its count badge is a node, see `badgeNode`.
    ...(hasUnsaved && selected
      ? [
          {
            id: 'unsaved' as const,
            label: t('config.tabs.unsaved'),
            badgeNode: <UnsavedTabBadge profile={selected} />,
          },
        ]
      : []),
  ]

  // Story 057 D2: the raw tab turns this whole view into a full-height code editor, so the page
  // itself must stop scrolling and hand its vertical space down a flex chain instead (outer
  // container -> content wrapper -> detail wrapper -> the Panel around tab content) - every other
  // tab keeps the original scrolling-page layout untouched. Story 061 D3 narrowed this to *only*
  // that fill chain plus the bottom padding: the header, the identity block, the tab strip and the
  // top/side padding are now identical on every tab, so `isRawFill` no longer decides what the
  // frame around the panel looks like, only how the panel gets the rest of the view's height.
  // Gated on `screen === 'detail'` too:
  // `activeTab` does not reset on `backToList`, so a user who backs out of a raw-tab profile back
  // to the list must not have the list itself go non-scrolling.
  const isRawFill = screen === 'detail' && activeTab === 'raw'

  // Story 061 D3: one strip, one padding value, on all seven tabs. Story 057's `isRawFill` branch
  // (`py-0` inline in the header row, `py-1.5` everywhere else) is gone: AC3 names the tab strip
  // explicitly, and a strip that changes height or position when the raw tab is picked has moved.
  // `py-1` rather than the old non-raw `py-1.5` because this is a density story - the shared header
  // has to fit inside the same 30-visible-line editor budget story 057's folded header bought for
  // the raw tab alone (AC4, measured by `scripts/flows/config-header-geometry.mjs`).
  const tabButtons = tabs.map((tab) => (
    <button
      key={tab.id}
      type="button"
      data-testid={`config-tab-${tab.id}`}
      onClick={() => goToTab(tab.id)}
      className={cn(
        'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-[--dur-fast]',
        activeTab === tab.id
          ? 'bg-flame-900/30 text-flame-200'
          : 'text-ink-dim hover:bg-hover hover:text-ink',
      )}
    >
      {tab.label}
      {tab.badge && <Badge tone={tab.badgeTone ?? 'neutral'}>{tab.badge}</Badge>}
      {tab.badgeNode}
    </button>
  ))

  // `scrollbar-gutter-stable`: tabs flip between overflowing and not (Overview <-> Settings);
  // without the reserve the content box width jumps when the scrollbar appears (story 028).
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
          // Story 061 D3 (AC3): the detail screen's padding no longer depends on which tab is
          // open - a header that starts at a different `y` per tab has moved, which is exactly the
          // relayout AC3 forbids, so story 057's raw-only `p-0` is gone. Only the *bottom* padding
          // stays raw-specific (`pb-0`, together with the fill chain): it sits below the header, so
          // it cannot move it. The profile *list* screen keeps its own `p-8`/`space-y-6` rhythm -
          // it has no header row and no tab strip to be consistent with.
          //
          // `pt-2`, not the story's planned `pt-4`: the second of the story's own fallback levers,
          // needed because the measured chrome came out 19px over the 30-line floor's allowance -
          // see the tab strip's comment below for the full accounting.
          screen === 'detail'
            ? cn('pt-2', isRawFill ? 'flex flex-1 min-h-0 flex-col pb-0' : 'pb-8')
            : 'space-y-6 py-8',
        )}
      >
        {screen === 'list' && (
          <>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
                  {t('config.title')}
                </h1>
                <p className="text-xs text-ink-muted">
                  {t('config.subtitle', { count: profiles.length })}
                </p>
              </div>

              <Button
                variant="neutral"
                size="sm"
                data-testid="config-create-profile"
                icon={<FilePlus2 className="size-3.5" />}
                onClick={() => setShowCreate(true)}
              >
                {t('config.newProfile')}
              </Button>
            </header>

            {profiles.length === 0 ? (
              <Panel className="mt-6">
                <EmptyState
                  icon={<SlidersHorizontal className="size-6" />}
                  title={t('config.empty.title')}
                  body={t('config.empty.body')}
                  hint={t('config.empty.hint')}
                />
              </Panel>
            ) : (
              <>
                <Panel className="p-3">
                  <SectionLabel className="px-2 pt-1 pb-2">{t('config.list.label')}</SectionLabel>
                  <ul className="divide-y divide-line">
                    {profiles.map((profile) => (
                      <li key={profile.id}>
                        <button
                          type="button"
                          data-testid="config-profile-row"
                          onClick={() => openProfile(profile.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-3.5 text-left transition-colors duration-[--dur-fast] hover:bg-hover"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink">{profile.name}</span>
                            <span className="block text-xs text-ink-muted">
                              {t('config.detail.updated')}:{' '}
                              {formatRelativeTime(profile.updatedAt) ?? '-'}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-ink-muted" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel className="space-y-3 p-6">
                  <InstallationProfilesPanel profiles={profiles} />
                </Panel>
              </>
            )}
          </>
        )}

        {screen === 'detail' && selected && (
          <ProfileChangesProvider profile={selected}>
            {/*
              Story 057 D5: the raw-text draft lives next to the structured change set, not inside
              it (story Decisions) - one provider per source of "unsaved", both wrapping the whole
              detail screen so the save bar can act on either without knowing which tab is showing.
              `handleProfileUpdated` is the same single-profile merge `ProfileSaveActions`'s own `onSaved`
              already uses: a raw save returns an ordinary updated profile.
            */}
            <RawDraftProvider
              profile={selected}
              onSaved={handleProfileUpdated}
              onActiveChange={(active) => {
                rawDraftActiveRef.current = active
                setRawDraftActive(active)
              }}
            >
              <div
                className={cn(
                  // Story 061 D3: one row rhythm for every tab - the gap between the header, any
                  // banner, the tab strip and the panel is the same on all seven tabs (AC3), down
                  // from story 009's `space-y-6`. The raw tab adds the fill chain on top of that
                  // gap rather than replacing it with `space-y-0`, which is what used to move the
                  // strip. `space-y-1` (4px), not the story's planned `space-y-2`: a fourth lever
                  // the story's fallback list did not have, needed because its three named ones
                  // only recovered 10px of the 19px the measured chrome was over - see the tab
                  // strip's comment below.
                  'space-y-1',
                  isRawFill && 'flex flex-1 min-h-0 flex-col',
                )}
              >
                {/*
                  Story 061 D3 (AC1/AC2): ONE header row, identical on all seven tabs - back left,
                  the profile's identity centred, the action cluster right - and no second identity
                  block below it. Both of the shapes this replaced are gone: the old two-row header
                  (this row, then a name/created/updated block) and story 057's raw-only folded row
                  (name + tab strip + actions, no unsaved indicator). The editor height that folded
                  row bought is funded inside the raw tab itself now (D2: one merged toolbar row,
                  `.cfg-code--fill` padding 6px) plus the denser shared strip below, so the raw tab
                  no longer needs a header of its own - which is what AC3 asks for.

                  Three flex zones, not `grid-cols-[1fr_auto_1fr]`: the middle zone grows and wraps,
                  where a rigid three-column grid clips or overflows at the app's minimum 940px
                  width (AC5). `gap-y-1` is what a wrapped line costs; `justify-between` keeps back
                  and actions on the outer edges of the first line once the middle has wrapped away.
                */}
                <header
                  data-testid="config-profile-header"
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                >
                  {/* `Button` is already `shrink-0`, so the left zone needs no wrapper of its own. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ArrowLeft className="size-3.5" />}
                    onClick={backToList}
                  >
                    {t('config.nav.back')}
                  </Button>

                  {/*
                    The identity zone, on every tab: name, created, updated and the unsaved
                    indicator (AC2 - story 057 had dropped the indicator from the raw tab's header
                    to buy width, which the funded budget now pays for). `KeyValue` and
                    `UnsavedIndicator` reused as-is, and the three strings already exist - no new
                    primitive, no new i18n key. `min-w-0` + `truncate` on the name is what keeps a
                    long profile name from pushing the action cluster off the row.

                    Story 069 D3: two lines instead of one - what a reader looks at first (which
                    profile, and whether it is saved) on line 1, the created/updated context that is
                    only read when looked for on line 2, which is what makes line 1 the focus (AC1)
                    and gives the block air against the tab strip. Still exactly ONE
                    `config-profile-identity` element, now with two child rows rather than two
                    sibling zones (D-4): AC3 forbids a second identity block, and the guard asserts
                    the testid exists exactly once and scans for stray duplicates.

                    AC2 needs no new class: line 2's subordination is already in the tokens the two
                    existing `KeyValue`s use (`stencil` 11px/`ink-muted` label, `text-xs`/`ink-dim`
                    value), both smaller and dimmer than the `h2`'s `text-sm`/`ink` - so the `h2` is
                    untouched (D-3) and `KeyValue` is not changed.

                    No `gap-y` between the two rows, and the wrapper above keeps `space-y-1`
                    (D-12): the zone is 20px + 16px = 36px, so the header - 28px, set by its 28px
                    buttons - follows it to 36px, and that +8px is the whole remaining line budget
                    over story 061's 30-visible-editor-line floor (AC4, measured by
                    `scripts/flows/config-header-geometry.mjs`). A gap here, a `leading-*` or
                    `items-start` instead of `items-center` costs an editor line for breathing room
                    no acceptance criterion asks for. `items-center` on the header is what keeps
                    back and actions centred against the now-taller zone (AC3).
                  */}
                  <div
                    data-testid="config-profile-identity"
                    className="flex min-w-0 flex-1 flex-col items-center justify-center"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="min-w-0 truncate font-display text-sm tracking-[0.06em] text-ink uppercase">
                        {selected.name}
                      </h2>
                      <UnsavedIndicator profile={selected} />
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-x-3">
                      <KeyValue label={t('config.detail.created')}>
                        {formatRelativeTime(selected.createdAt) ?? '-'}
                      </KeyValue>
                      <KeyValue label={t('config.detail.updated')}>
                        {formatRelativeTime(selected.updatedAt) ?? '-'}
                      </KeyValue>
                    </div>
                  </div>

                  {/* `config-profile-actions`: D4 compares the action cluster's rect tab by tab
                      (AC3) and needs an anchor for it, the same way the header and the identity
                      zone have one. */}
                  <div
                    data-testid="config-profile-actions"
                    className="flex shrink-0 items-center gap-2"
                  >
                    {/*
                      Save and Discard live here, in the header's right-hand cluster, instead of the
                      dedicated save-bar row that used to sit between the name and the tabs - that
                      row is gone (its status is the indicator next to the name, its change list is
                      the Unsaved tab). Ahead of Assignments/Rename/Delete in the cluster: they are
                      the actions a user reaches for while editing, and they are the only ones here
                      that come and go, so putting them first keeps the always-present controls at a
                      stable position on the right edge.
                    */}
                    <ProfileSaveActions
                      profile={selected}
                      onSaved={handleProfileUpdated}
                      onDiscarded={handleDiscarded}
                    />
                    <AssignmentsMenu profile={selected} onChanged={setProfiles} />
                    <div className="flex items-center gap-1">
                      <RenameHeaderButton onClick={() => setShowRename(true)} />
                      <IconButton
                        label={t('config.detail.delete')}
                        size="sm"
                        variant="danger"
                        onClick={() => setShowDelete(true)}
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </header>

                {/*
              Story 043 D7: persistent (never a toast) banner for a profile whose canonical file
              was deleted outside the launcher - `fileState` comes straight off the profile record,
              which `applyRefreshedProfile` patched from the last `refreshFromFiles` result. The two
              actions are real client calls, not stubs: "Rewrite from cache" reuses D4's `save`
              handler as-is (see `handleRewriteFromCache`'s doc comment), "Remove profile" opens the
              exact same confirmation dialog the detail header's own delete button opens.
            */}
                {selected.fileState === 'missing' && (
                  <div className="space-y-3 rounded-sm border border-danger/35 bg-danger/8 p-3">
                    <div className="flex items-start gap-2">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-danger">
                          {t('config.fileSource.missingBanner.title')}
                        </p>
                        <p className="text-xs leading-relaxed text-ink-dim">
                          {t('config.fileSource.missingBanner.body')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="neutral"
                        size="sm"
                        icon={<RotateCcw className="size-3.5" />}
                        disabled={rewriting}
                        onClick={() => void handleRewriteFromCache()}
                      >
                        {t('config.fileSource.missingBanner.rewrite')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 className="size-3.5" />}
                        onClick={() => setShowDelete(true)}
                      >
                        {t('config.fileSource.missingBanner.remove')}
                      </Button>
                    </div>
                  </div>
                )}

                {/*
              Story 043 D7: the last-good-cache diagnostic for an unparseable/unreadable file -
              persistent (not a toast, per AC4) but never disables the profile: the tabs below stay
              exactly as reachable as they are for any other profile.
            */}
                {fileDiagnostic && fileDiagnostic.profileId === selected.id && (
                  <div className="flex items-start gap-2 rounded-sm border border-warning/35 bg-warning/8 p-3">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-warning">
                        {fileDiagnostic.file !== undefined && fileDiagnostic.line !== undefined
                          ? t('config.fileSource.diagnostic.titleWithLine', {
                              file: fileDiagnostic.file,
                              line: fileDiagnostic.line,
                            })
                          : t('config.fileSource.diagnostic.title')}
                      </p>
                      <p className="text-xs leading-relaxed text-ink-dim">
                        {fileDiagnostic.message}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {t('config.fileSource.diagnostic.hint')}
                      </p>
                    </div>
                  </div>
                )}

                {/*
                  Story 061 D3: the tab strip is back in its own row on the raw tab too, so all
                  seven tabs get the same strip in the same place (AC3). No bottom padding under it
                  (story 057's `pb-2`, the story's plan `pb-1`): the buttons sit directly on the
                  bottom rule, which is the ordinary tab-strip idiom anyway.

                  Why the padding went all the way to 0, in one place because this is where the
                  budget was spent: a shared one-row header plus a shared strip costs the raw tab
                  63px it did not pay before (8px page padding + 31px strip + 2x4px row gaps), and
                  the 30-visible-line floor (AC4) only leaves 99px of chrome above the editor once
                  D2's funding is counted. The measured chrome after the naive build was 118px, so
                  19px had to come back out; the story's three named levers (strip `pb-1`->`pb-0.5`,
                  `pt-4`->`pt-2`, header gap 4px->2px) only yield 10px, and the third yields nothing
                  at all at 1280x800 since the header does not wrap there. So: this padding to 0
                  (-4px), `pt-2` (-8px) and the detail wrapper's row gap to 4px (-8px) = -20px, all
                  three uniform across every tab, which is what AC3 actually constrains. Verified,
                  not estimated: `npm run ui:flow -- config-header-geometry` reports 31 lines.
                */}
                <div
                  data-testid="config-tab-strip"
                  className="flex flex-wrap gap-1.5 border-b border-line"
                >
                  {tabButtons}
                </div>

                <Panel className={cn(isRawFill ? 'flex flex-1 min-h-0 flex-col p-0' : 'p-6')}>
                  {activeTab === 'raw' ? (
                    <div className="flex flex-1 min-h-0 flex-col">
                      <RawFileTab profile={selected} onChanged={setProfiles} />
                    </div>
                  ) : activeTab === 'unsaved' ? (
                    // Outside `StructuredTabsGuard` on purpose: this is the one tab whose content is
                    // *about* the raw draft, so making it `inert` while a draft is open would hide
                    // the only place that says what the draft is.
                    <UnsavedChangesTab profile={selected} />
                  ) : (
                    <StructuredTabsGuard>
                      {activeTab === 'overview' && (
                        <div className="space-y-6">
                          <OverviewKeyboardPanel
                            profile={selected}
                            activeLayer={activeLayer}
                            onChanged={setProfiles}
                            onSelectLayer={setActiveLayerId}
                          />
                          <LayersPanel
                            profile={selected}
                            activeLayerId={activeLayerId}
                            onSelectLayer={setActiveLayerId}
                            onChanged={setProfiles}
                          />
                        </div>
                      )}
                      {activeTab === 'settings' && (
                        <SettingsTab
                          profile={selected}
                          draft={activeProfile(selected)}
                          patch={patch}
                          onChanged={setProfiles}
                        />
                      )}
                      {activeTab === 'controls' && (
                        <ControlsTab
                          profile={selected}
                          draft={activeProfile(selected)}
                          patch={patch}
                          onChanged={setProfiles}
                          focusActionId={tabState.focusActionId}
                        />
                      )}
                      {activeTab === 'aliases' && (
                        <AliasesTab
                          profile={selected}
                          draft={activeProfile(selected)}
                          patch={patch}
                          onChanged={setProfiles}
                          focusAlias={tabState.focusAlias}
                          focusAliasActionId={tabState.focusAliasActionId}
                          onNavigateToAction={(actionId) => goToTab('controls', { actionId })}
                          onNavigateToLayer={(layerName) => goToTab('overview', { layerName })}
                        />
                      )}
                      {activeTab === 'care' && (
                        <CareTab
                          profile={selected}
                          validation={validation}
                          onProfileUpdated={handleProfileUpdated}
                          installations={installations}
                          syncStatus={driftState.status}
                          onRefetchSyncState={driftState.refetch}
                          onNavigateToAlias={(aliasName, actionId) =>
                            goToTab('aliases', { alias: aliasName, aliasActionId: actionId })
                          }
                          onNavigateToAction={(actionId) => goToTab('controls', { actionId })}
                        />
                      )}
                    </StructuredTabsGuard>
                  )}
                </Panel>
              </div>
            </RawDraftProvider>
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
