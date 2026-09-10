import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleHelp, CircleX } from 'lucide-react'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types/installation'
import { engineLabel } from '@shared/types/engine'
import { Panel, SectionLabel, Spinner } from '../../components/ui/primitives'
import { Button } from '../../components/ui/Button'
import { useLauncher } from '../../store/useLauncher'
import { CareBatchFixDialog } from './CareBatchFixDialog'
import { CareItemRow } from './CareItemRow'
import { ConfigConflictDialog } from './ConfigConflictDialog'
import { RenameActionDialog } from './components/RenameActionDialog'
import { applyTidyUp, updateProfileActions } from './client'
import { buildCareItems, itemsInGroup, type CareItem, type CareItemAction } from './lib/care-items'
import { careSummary, type CareSummary, type CareSyncStatus } from './lib/care-summary'
import { analyzeTidyUp, type TidyUpFinding } from './lib/tidy-up-findings'
import { useCareSync } from './lib/use-care-sync'
import type { ProfileValidation } from './lib/validation-scope'

/**
 * Story 058 D2/D3: Care is a to-do list, not a stack of sections that each
 * get a turn regardless of whether they have anything to say (the story's
 * own framing). `ValidationPanel` and `PreservedLinesPanel` are gone — the
 * Config health group they used to cover is now either folded into the All
 * clear block below, rendered as one `CareItemRow` per finding under a single
 * "Config health" heading, or, for a profile with nothing to validate
 * against, an explicit line that is neither an item nor "all clear" (story
 * 058 decision 3 — this is the regression story 025's review already had to
 * catch once).
 *
 * D3 converts Files the same way: `CareSyncSection` (deleted) owned both the
 * sync fetch and its own row rendering; the fetch moved into `useCareSync`
 * (`lib/use-care-sync.ts`) and the rows now render through the shared
 * `CareItemRow`, same as Config health. Only rows `buildCareItems` kept (not
 * `inSync`) become items — an all-in-sync profile renders no Files group at
 * all, its count folded into the All clear block instead (AC 5).
 *
 * D4 converts Tidy-up the same way: `CareTidyUpSection` (deleted) owned the
 * finding-to-row rendering, its own apply/pending state and the "Fix all safe
 * findings" trigger; all three move into `TidyUpGroup` below. Preserved lines
 * are no longer a separate panel and no longer duplicated — they are one
 * `CareItemRow` each, same as every other tidy-up finding, with the line text
 * already part of the row's consequence sentence (the `preservedLine*` keys
 * interpolate `{{text}}`) rather than a second surface repeating it. The batch
 * trigger renders only when at least one `mode: 'auto'` finding exists — never
 * disabled, never with a second copy of its own explanation.
 *
 * D6 removes the last thing here that was not a to-do item: `CleanupPanel` (with
 * its own installation picker and scope control) is no longer mounted at all. The
 * redundant-copies cleanup is an action on the installation row in Library now,
 * so Care never reports on a manual scan it did not run (AC 2, AC 7).
 */
export function CareTab({
  profile,
  validation,
  onProfileUpdated,
  installations,
  syncStatus,
  onRefetchSyncState,
  onNavigateToAlias,
  onNavigateToAction,
}: {
  profile: ConfigProfile
  validation: ProfileValidation
  onProfileUpdated: (profile: ConfigProfile) => void
  /** Story 058 D6: only the Files group still needs these - to name the installation a sync row
   * belongs to. The redundant-copies cleanup that used to pick an installation here is now an
   * action on the installation row in Library. */
  installations: Installation[]
  /** Story 079 D6: the drift rows, fetched by `ConfigView`'s `useDriftState` on the canonical
   * re-read triggers (mount/profile-open, window focus) plus a save - not by this tab itself, so a
   * changed/missing/stale installation copy is caught even while Care is never opened (AC5). Passed
   * straight through to `useCareSync`, unchanged in behaviour otherwise. */
  syncStatus: CareSyncStatus
  onRefetchSyncState: () => void
  /** Story 044 D6: the Tidy-up group's "show in Aliases" action, threaded straight through - this
   * component owns no navigation logic of its own, same as every other prop it only stacks. Story
   * 060 D1 adds the optional owning-entry id: only a duplicate-name finding's per-entry detail rows
   * carry one (`CareItemAction.actionId`), and it lets the Aliases tab focus one specific colliding
   * row instead of the first row matching the name. */
  onNavigateToAlias: (aliasName: string, actionId?: string) => void
  /** Story 058 D5: the Tidy-up group's "Show in Controls" action - mirrors `onNavigateToAlias`,
   * wired by `ConfigView` through the same lifted `goToTab('controls', { focusActionId })` state the
   * Aliases tab's own "show on Controls" link already uses. */
  onNavigateToAction: (actionId: string) => void
}) {
  const tidyUpFindings = useMemo(() => analyzeTidyUp(profile), [profile])

  const sync = useCareSync({
    profile,
    onProfileUpdated,
    status: syncStatus,
    refetchSyncState: onRefetchSyncState,
  })

  const items = useMemo(
    () =>
      buildCareItems({
        validation,
        syncRows: sync.status.kind === 'loaded' ? sync.status.rows : [],
        tidyUp: tidyUpFindings,
        ...(profile.dirty === undefined ? {} : { profileDirty: profile.dirty }),
      }),
    [validation, sync.status, tidyUpFindings, profile.dirty],
  )

  const summary = careSummary({ items, validation, sync: sync.status })

  return (
    <div className="space-y-6">
      {summary.allClear ? (
        <AllClearBlock summary={summary} />
      ) : (
        <>
          <ConfigHealthGroup validation={validation} items={itemsInGroup(items, 'health')} />
          <FilesGroup
            items={itemsInGroup(items, 'files')}
            installations={installations}
            pendingKeys={sync.pendingKeys}
            onAction={sync.runAction}
            syncStatus={sync.status}
          />
          <TidyUpGroup
            items={itemsInGroup(items, 'tidy')}
            autoFindings={tidyUpFindings.filter((finding) => finding.mode === 'auto')}
            profile={profile}
            onProfileUpdated={onProfileUpdated}
            onNavigateToAlias={onNavigateToAlias}
            onNavigateToAction={onNavigateToAction}
          />
        </>
      )}

      {sync.conflict && (
        <ConfigConflictDialog
          profileId={profile.id}
          conflict={sync.conflict}
          onClose={sync.closeConflict}
          onResolved={sync.resolveConflict}
        />
      )}
    </div>
  )
}

/**
 * AC 1's "one calm block and stop": one summary line per checked thing
 * (`careSummary`'s `lines`), no illustration, no disabled button, no header
 * over nothing. Only rendered when `summary.allClear` — zero items and every
 * source resolved.
 */
function AllClearBlock({ summary }: { summary: CareSummary }) {
  const { t } = useTranslation()

  return (
    <Panel className="space-y-2 p-4">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 text-success" />
        <SectionLabel>{t('config.care.summary.overall.allClear')}</SectionLabel>
      </div>
      <ul className="space-y-1 pl-6 text-sm text-ink-dim">
        {summary.lines.map((line) => (
          <li key={line.group} data-selectable>
            {t(line.messageKey, line.params)}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * The Config health group (story 058 D2): one `CareItemRow` per finding under
 * a single heading, the engine already named on each row via `titleKey`
 * (`lib/care-items.ts`'s `healthItems`) — never a per-engine panel, so
 * "equally weighted, per engine" stays true without a header over nothing.
 *
 * `validation.status !== 'ok'` is its own explicit state (story 025 review
 * finding F2, story 058 decision 3): it is neither folded into the All clear
 * block nor silently dropped, and it renders even while `summary.allClear` is
 * (necessarily) false because of it.
 *
 * A validated profile with zero findings renders nothing at all — AC 3's "a
 * group with no items is not rendered" — its cleanliness is only ever spoken
 * for by the All clear block above, once every group agrees.
 */
function ConfigHealthGroup({
  validation,
  items,
}: {
  validation: ProfileValidation
  items: CareItem[]
}) {
  const { t } = useTranslation()

  if (validation.status !== 'ok') {
    return (
      <div className="space-y-2">
        <SectionLabel>{t('config.care.group.health')}</SectionLabel>
        <p className="flex items-start gap-2 text-xs text-ink-dim" data-selectable>
          <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
          {validation.status === 'unassigned'
            ? t('config.validation.empty.unassigned')
            : validation.status === 'unresolved'
              ? t('config.validation.empty.unresolved')
              : t('config.validation.empty.noFacts', {
                  engines: validation.omitted.map(engineLabel).join(', '),
                })}
        </p>
      </div>
    )
  }

  if (items.length === 0) return null

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.care.group.health')}</SectionLabel>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <CareItemRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  )
}

/**
 * The Files group (story 058 D3): one `CareItemRow` per row that is not `inSync` - the profile's
 * own canonical file, then one per assigned installation, same order `toCareSyncRows` produces.
 *
 * `buildCareItems`'s `fileItems` cannot name the installation on the row itself (`lib/care-items.ts`'s
 * own doc comment - it is handed a target id, not the installation list), so this component resolves
 * the display name and folds it into the item's own `params` as `name` before handing the item to
 * `CareItemRow` - `config.care.sync.state.*`/`config.care.sync.canonical.*` (the row's `titleKey`)
 * interpolate it. This is the render-side half of that split; the model stays free of the
 * installation list.
 *
 * Empty - every assigned file in sync - renders nothing at all, same "a group with no items is not
 * rendered" rule `ConfigHealthGroup` already follows (AC 3, AC 5): the count lives in the All clear
 * block instead.
 *
 * "Empty" only means that when `syncStatus.kind === 'loaded'`, though - while the fetch is still
 * loading or has errored, `buildCareItems` never has rows to turn into items either (the file doc
 * comment's point 2), so an empty list there does NOT mean "nothing to report", it means "nothing
 * answered yet". This group must say so explicitly (review finding: the tab used to go entirely
 * blank on a sync error, since the All clear block is unreachable whenever `careSummary` is not
 * `allClear`, which it never is while a source is `notChecked`) - mirrors the deleted
 * `CareSyncSection`'s own `t(result.error.key)` line for the error case.
 */
function FilesGroup({
  items,
  installations,
  pendingKeys,
  onAction,
  syncStatus,
}: {
  items: CareItem[]
  installations: Installation[]
  pendingKeys: ReadonlySet<string>
  onAction: (action: CareItemAction, target: string) => void
  syncStatus: CareSyncStatus
}) {
  const { t } = useTranslation()

  if (items.length === 0) {
    if (syncStatus.kind === 'loading') {
      return (
        <div className="space-y-2">
          <SectionLabel>{t('config.care.group.files')}</SectionLabel>
          <p className="flex items-center gap-2 text-xs text-ink-dim" data-selectable>
            <Spinner className="size-3.5" />
            {t('config.care.files.loading')}
          </p>
        </div>
      )
    }
    if (syncStatus.kind === 'error') {
      return (
        <div className="space-y-2">
          <SectionLabel>{t('config.care.group.files')}</SectionLabel>
          <p className="flex items-start gap-2 text-xs text-danger" data-selectable>
            <CircleX className="mt-0.5 size-3.5 shrink-0" />
            {t('config.care.files.error')}
          </p>
        </div>
      )
    }
    return null
  }

  const nameFor = (target: string): string =>
    target === 'canonical'
      ? t('config.care.sync.own')
      : (installations.find((installation) => installation.id === target)?.name ?? target)

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.care.group.files')}</SectionLabel>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const target = String(item.params['target'] ?? '')
          return (
            <CareItemRow
              key={item.id}
              item={{ ...item, params: { ...item.params, name: nameFor(target) } }}
              onAction={(action) => onAction(action, target)}
              pendingKeys={pendingKeys}
            />
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The Tidy-up group (story 058 D4): one `CareItemRow` per finding, exactly the row
 * `buildCareItems`'s `tidyItems` already built - Apply for every kind but `preservedLine`, which
 * splits into Drop and Re-classify (AC 4), "Show in Aliases" for the three alias-wiring kinds, and
 * no action at all for a `'report'` finding (its consequence sentence is the whole explanation).
 *
 * Preserved lines are no longer a separate panel (`PreservedLinesPanel`, deleted in D2) - each is
 * one row here, its line text already interpolated into the consequence sentence
 * (the `config.care.tidyUp.preservedLine*` keys' `{{text}}`), so it appears exactly once in the
 * whole tab (AC 4's accept criterion).
 *
 * "Fix all safe findings" (`CareBatchFixDialog`, reused unchanged) renders only when
 * `autoFindings` is non-empty - never a disabled button with a duplicated "nothing is safe yet"
 * explanation, which is what the deleted `CareTidyUpSection` used to render underneath it.
 *
 * Owns its own apply state (`pendingKeys`), mirroring `useCareSync`'s `withPending` idiom, since
 * `CareItemRow`'s shared shape only knows how to disable a button by its action key - there is no
 * second row component to hand this state to.
 */
function TidyUpGroup({
  items,
  autoFindings,
  profile,
  onProfileUpdated,
  onNavigateToAlias,
  onNavigateToAction,
}: {
  items: CareItem[]
  autoFindings: TidyUpFinding[]
  profile: ConfigProfile
  onProfileUpdated: (profile: ConfigProfile) => void
  onNavigateToAlias: (aliasName: string, actionId?: string) => void
  onNavigateToAction: (actionId: string) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set())
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [renamingActionId, setRenamingActionId] = useState<string | null>(null)
  const renamingAction =
    (profile.actions ?? []).find((action) => action.id === renamingActionId) ?? null

  if (items.length === 0) return null

  /**
   * Replaces the profile's actions - the same `config:setActions` channel the Controls and Aliases
   * tabs write through (never a second write path), so a rename or delete decided here is byte-for-
   * byte the one those tabs would have performed. Runs against `profile`, which Care is always
   * handed as the *saved* profile, exactly like `applyTidyUp` above it.
   */
  const persistActions = async (nextActions: ConfigAction[], key: string): Promise<boolean> => {
    setPendingKeys((prev) => new Set(prev).add(key))
    const outcome = await updateProfileActions({
      profileId: profile.id,
      categories: profile.categories ?? [],
      actions: nextActions,
    })
    setPendingKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })

    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
      return false
    }
    const updated = outcome.value.find((candidate) => candidate.id === profile.id)
    if (updated) onProfileUpdated(updated)
    return true
  }

  /** `RenameActionDialog`'s submit callback - same shape as the Aliases tab's own
   * `handleRenameAction`, which is where this rename otherwise lives. */
  const handleRenameEntry = async (
    actionId: string,
    input: { name: string; aliasName: string | undefined },
  ): Promise<boolean> => {
    const nextActions = (profile.actions ?? []).map((action) =>
      action.id === actionId ? { ...action, name: input.name, aliasName: input.aliasName } : action,
    )
    const ok = await persistActions(nextActions, `${actionId}:rename`)
    if (ok) setRenamingActionId(null)
    return ok
  }

  // `unreferencedAlias`/`duplicateAlias` name the alias as `params.name`, `undefinedAlias` as
  // `params.alias` (`@shared/config/validate-actions.ts`'s own param shapes) - the only three kinds
  // this action ever appears on (`lib/care-items.ts`'s `ALIAS_LINK_KINDS`), so reading either is
  // enough without threading the finding kind through the item as well.
  const handleAction = async (action: CareItemAction, item: CareItem): Promise<void> => {
    if (action.kind === 'showInAliases') {
      const aliasName = String(item.params['name'] ?? item.params['alias'] ?? '')
      // Story 060 D1 threaded the owning entry's real id into this link so a duplicate-name finding
      // could target one specific colliding row rather than the first row matching the name. Since
      // the collision is one row with one detail line per side (bug fix, 2026-09-07), that id comes
      // off the clicked *detail's* action; a row-level link (`undefinedAlias` and friends) carries
      // none and still resolves by name alone.
      if (aliasName) onNavigateToAlias(aliasName, action.actionId)
      return
    }
    // The two per-entry resolutions a duplicate-name detail offers (bug fix, 2026-09-07): rename
    // keeps both entries and frees the name, delete removes this side. Delete needs no confirmation
    // here because `lib/care-items.ts` only offers it for an entry nothing references - the same
    // rule the Aliases tab's own delete affordance follows.
    if (action.kind === 'renameEntry') {
      if (action.actionId) setRenamingActionId(action.actionId)
      return
    }
    if (action.kind === 'deleteEntry') {
      const actionId = action.actionId
      if (!actionId) return
      await persistActions(
        (profile.actions ?? []).filter((candidate) => candidate.id !== actionId),
        action.key,
      )
      return
    }
    // Story 058 D5: the item's own `actionId` (`lib/care-items.ts`'s `tidyItems`), not a params
    // lookup - unlike the alias link above, a `ConfigAction.id` is never a display string a row
    // would also want to show.
    if (action.kind === 'showInControls') {
      if (item.actionId) onNavigateToAction(item.actionId)
      return
    }
    if (!action.ops) return

    setPendingKeys((prev) => new Set(prev).add(action.key))
    const outcome = await applyTidyUp({ profileId: profile.id, ops: action.ops })
    setPendingKeys((prev) => {
      const next = new Set(prev)
      next.delete(action.key)
      return next
    })

    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
      return
    }
    if (outcome.value.rejected.length > 0) {
      pushToast({
        level: 'warning',
        messageKey: 'config.care.tidyUp.result.rejected',
        timeoutMs: 0,
      })
    }
    onProfileUpdated(outcome.value.profile)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>{t('config.care.group.tidy')}</SectionLabel>
        {autoFindings.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setBatchDialogOpen(true)}>
            {t('config.care.tidyUp.batch.button', { count: autoFindings.length })}
          </Button>
        )}
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <CareItemRow
            key={item.id}
            item={item}
            onAction={(action) => void handleAction(action, item)}
            pendingKeys={pendingKeys}
          />
        ))}
      </ul>

      {batchDialogOpen && (
        <CareBatchFixDialog
          profile={profile}
          findings={autoFindings}
          onClose={() => setBatchDialogOpen(false)}
          onProfileUpdated={onProfileUpdated}
        />
      )}

      {/* The same dialog the Controls and Aliases tabs rename an entry through (story 044 D5's
          extraction), so its refusal rules and its own-alias-name escape hatch apply here too -
          which is the whole point of offering the rename on the finding itself. */}
      {renamingAction && (
        <RenameActionDialog
          action={renamingAction}
          actions={profile.actions ?? []}
          binds={profile.binds}
          layers={profile.layers ?? []}
          onClose={() => setRenamingActionId(null)}
          onSubmit={(input) => handleRenameEntry(renamingAction.id, input)}
        />
      )}
    </div>
  )
}
