import { useTranslation } from 'react-i18next'
import { type ComponentProps, type ReactNode } from 'react'
import { cn } from '../../../lib/cn'
import { TabPanel } from '../../../components/ui/Tabs'
import { Panel } from '../../../components/ui/primitives'
import { AliasesTab } from '../AliasesTab'
import { CareTab } from '../CareTab'
import { ControlsTab } from '../ControlsTab'
import { LayersPanel } from '../LayersPanel'
import { OverviewKeyboardPanel } from '../OverviewKeyboardPanel'
import { RawFileTab } from '../RawFileTab'
import { SettingsTab } from '../SettingsTab'
import { useRawDraft } from '../lib/raw-draft'
import type { useDriftState } from '../lib/use-drift-state'
import { useDraftValidation } from '../lib/useDraftValidation'
import type { DetailTab } from './ConfigTabStrip'
import { UnsavedChangesTab } from './UnsavedChangesTab'

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
export interface TabFocusState {
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

/** `CareTab` against the draft's validation. */
function DetailCareTab(props: Omit<ComponentProps<typeof CareTab>, 'validation'>) {
  return <CareTab {...props} validation={useDraftValidation()} />
}

export type GoToTab = (
  tab: DetailTab,
  focus?: { alias?: string; aliasActionId?: string; actionId?: string; layerName?: string },
) => void

/** The active tab's body inside its `TabPanel` and `Panel`; the raw tab fills the view's height. */
export function ConfigTabContent({
  focus,
  isRawFill,
  activeLayer,
  activeLayerId,
  onSelectLayer,
  driftState,
  goToTab,
}: {
  focus: TabFocusState
  isRawFill: boolean
  activeLayer: ComponentProps<typeof OverviewKeyboardPanel>['activeLayer']
  activeLayerId: string | null
  onSelectLayer: (id: string | null) => void
  driftState: ReturnType<typeof useDriftState>
  goToTab: GoToTab
}) {
  const activeTab = focus.tab
  return (
    <TabPanel
      idBase="config"
      tabId={activeTab}
      className={cn(isRawFill && 'flex flex-1 min-h-0 flex-col')}
    >
      <Panel className={cn(isRawFill ? 'flex flex-1 min-h-0 flex-col p-0' : 'p-6')}>
        {activeTab === 'raw' ? (
          <div className="flex flex-1 min-h-0 flex-col">
            <RawFileTab />
          </div>
        ) : activeTab === 'unsaved' ? (
          // Outside `StructuredTabsGuard` on purpose: this is the one tab whose content is
          // *about* the raw draft, so making it `inert` while a draft is open would hide
          // the only place that says what the draft is.
          <UnsavedChangesTab />
        ) : (
          <StructuredTabsGuard>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <OverviewKeyboardPanel activeLayer={activeLayer} onSelectLayer={onSelectLayer} />
                <LayersPanel activeLayerId={activeLayerId} onSelectLayer={onSelectLayer} />
              </div>
            )}
            {activeTab === 'settings' && <SettingsTab />}
            {activeTab === 'controls' && <ControlsTab focusActionId={focus.focusActionId} />}
            {activeTab === 'aliases' && (
              <AliasesTab
                focusAlias={focus.focusAlias}
                focusAliasActionId={focus.focusAliasActionId}
                onNavigateToAction={(actionId) => goToTab('controls', { actionId })}
                onNavigateToLayer={(layerName) => goToTab('overview', { layerName })}
              />
            )}
            {activeTab === 'care' && (
              <DetailCareTab
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
    </TabPanel>
  )
}
