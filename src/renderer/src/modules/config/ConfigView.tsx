import { useEffect, useMemo, useState } from 'react'
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
import { ControlsTab } from './ControlsTab'
import { AssignmentsMenu } from './AssignmentsMenu'
import { CareTab } from './CareTab'
import { CreateProfileDialog } from './CreateProfileDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { ImportProfileDialog } from './ImportProfileDialog'
import { InstallationProfilesPanel } from './InstallationProfilesPanel'
import { LayersPanel } from './LayersPanel'
import { dedupedFindingCounts } from './lib/care-summary'
import { applyRefreshedProfile, noticeForRefreshedProfile } from './lib/file-source-refresh'
import { resolveSaveOutcome } from './lib/save-bar'
import { analyzeTidyUp } from './lib/tidy-up-findings'
import { validateProfileForEngines } from './lib/validation-scope'
import { useFileSourceRefresh } from './lib/useFileSourceRefresh'
import { useProfileDraft } from './lib/useProfileDraft'
import { OverviewKeyboardPanel } from './OverviewKeyboardPanel'
import { ProfileSaveBar } from './components/ProfileSaveBar'
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
type DetailTab = 'overview' | 'settings' | 'controls' | 'raw' | 'care'

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
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [fileDiagnostic, setFileDiagnostic] = useState<FileDiagnostic | null>(null)
  const [rewriting, setRewriting] = useState(false)

  const pushToast = useLauncher((state) => state.pushToast)

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
  const { draft, patch, savedCvars } = useProfileDraft(selected)

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
  const validationCounts = useMemo(
    () => dedupedFindingCounts(validation, tidyUpFindings),
    [validation, tidyUpFindings],
  )

  // Story 025 D7: the ids `CleanupPanel` (mounted inside `CareTab` now) defaults
  // its installation picker to, before the "scan any installation" control widens
  // it back to the full `installations` list.
  const assignedInstallationIds = useMemo(
    () => selected?.assignments.map((assignment) => assignment.installationId) ?? [],
    [selected],
  )

  const openProfile = (id: string): void => {
    setSelectedId(id)
    setActiveTab('overview')
    setScreen('detail')
  }

  const backToList = (): void => {
    setScreen('list')
  }

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
   * Story 043 D7: the outcome of one `useFileSourceRefresh` re-read for the selected profile.
   * `applyRefreshedProfile` folds the outcome into `profiles` (a no-op for `unchanged`/`conflict`,
   * a full replace for `adopted`, a `fileState`-only patch for `missing`/`unparseable`/`readError` -
   * see its own doc comment); `noticeForRefreshedProfile` says what, if anything, needs surfacing
   * on top of that.
   *
   * `adopted` is reported as a toast (AC3: "never a silent swap") - this module's existing one-shot
   * transient-notice idiom, per `ProfileSaveBar`'s own `pushToast` usage. `conflict` is reported the
   * same way `ProfileSaveBar`/`resolveSaveOutcome` (D6) stub it: a plain toast, no dialog - D5's own
   * doc comment already says this pair of triggers should not realistically produce a conflict
   * (that needs a dirty profile plus an external edit in the same instant), and the real two-pane
   * resolution is D8's job.
   */
  const handleFileSourceResult = (result: RefreshedProfileResult): void => {
    setProfiles((prev) => applyRefreshedProfile(prev, result))

    const notice = noticeForRefreshedProfile(result)
    if (notice?.kind === 'reloaded') {
      pushToast({ level: 'info', messageKey: 'config.fileSource.reloaded', timeoutMs: 6000 })
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

  useFileSourceRefresh({ profileId: selectedId, onResult: handleFileSourceResult })

  /**
   * The "Rewrite from cache" action on the `fileState: 'missing'` banner (story 043 D7) - reuses
   * D4's existing `save` handler exactly as-is: `save` writes from cache whenever the file is
   * missing or unchanged, so there is nothing new to build on the main side. `resolveSaveOutcome`
   * (D6, `lib/save-bar.ts`) is reused rather than re-implemented for the failure branches, so an
   * unreadable-file surprise here reports through the identical toast `ProfileSaveBar` would.
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

  const tabs: { id: DetailTab; label: string; badge?: string; badgeTone?: 'danger' | 'warning' }[] =
    [
      { id: 'overview', label: t('config.tabs.overview') },
      { id: 'settings', label: t('config.tabs.settings') },
      { id: 'controls', label: t('config.tabs.controls') },
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
    ]

  // `scrollbar-gutter-stable`: tabs flip between overflowing and not (Overview <-> Settings);
  // without the reserve the content box width jumps when the scrollbar appears (story 028).
  return (
    <div className="h-full overflow-y-auto scrollbar-gutter-stable">
      <div className="mx-auto max-w-[92rem] space-y-6 p-8">
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
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft className="size-3.5" />}
                onClick={backToList}
              >
                {t('config.nav.back')}
              </Button>
              <div className="flex items-center gap-2">
                <AssignmentsMenu profile={selected} onChanged={setProfiles} />
                <div className="flex items-center gap-1">
                  <IconButton
                    label={t('config.detail.rename')}
                    size="sm"
                    onClick={() => setShowRename(true)}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
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
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-lg tracking-[0.06em] text-ink uppercase">
                {selected.name}
              </h2>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <KeyValue label={t('config.detail.created')}>
                  {formatRelativeTime(selected.createdAt) ?? '-'}
                </KeyValue>
                <KeyValue label={t('config.detail.updated')}>
                  {formatRelativeTime(selected.updatedAt) ?? '-'}
                </KeyValue>
              </div>
            </div>

            {/*
              Story 043 D6: mounted at the detail level, not inside any `activeTab === ...` branch,
              so Save works no matter which tab is showing - the same placement the deleted
              `useProfileAutoWrite` hook used. `handleProfileUpdated` is the existing single-profile
              merge-by-id path (`CareTab`'s `onProfileUpdated`), reused rather than inventing a
              second update path for `save`'s single-profile result.
            */}
            <ProfileSaveBar profile={selected} onSaved={handleProfileUpdated} />

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
                  <p className="text-xs leading-relaxed text-ink-dim">{fileDiagnostic.message}</p>
                  <p className="text-xs text-ink-muted">{t('config.fileSource.diagnostic.hint')}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 border-b border-line pb-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`config-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors duration-[--dur-fast]',
                    activeTab === tab.id
                      ? 'bg-flame-900/30 text-flame-200'
                      : 'text-ink-dim hover:bg-hover hover:text-ink',
                  )}
                >
                  {tab.label}
                  {tab.badge && <Badge tone={tab.badgeTone ?? 'neutral'}>{tab.badge}</Badge>}
                </button>
              ))}
            </div>

            <Panel className="p-6">
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
                  savedCvars={savedCvars}
                  onChanged={setProfiles}
                />
              )}
              {activeTab === 'controls' && (
                <ControlsTab
                  profile={selected}
                  draft={activeProfile(selected)}
                  patch={patch}
                  onChanged={setProfiles}
                />
              )}
              {activeTab === 'raw' && (
                <RawFileTab profile={selected} onChanged={setProfiles} />
              )}
              {activeTab === 'care' && (
                <CareTab
                  profile={selected}
                  validation={validation}
                  onProfileUpdated={handleProfileUpdated}
                  installations={installations}
                  assignedInstallationIds={assignedInstallationIds}
                />
              )}
            </Panel>
          </div>
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
