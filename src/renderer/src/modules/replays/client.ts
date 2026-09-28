import { REPLAYS_HANDLERS, type DiscoveredDemo, type ReplaysOverview } from '@shared/modules/replays'
import type { NameTemplatesView } from '@shared/replays/name-templates'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the replays module's handlers (story 135 D3). One function per handler in its
 * contract - mirrors `modules/servers/client.ts`. */
export function getReplaysOverview(): Promise<Outcome<ReplaysOverview>> {
  return callModule<ReplaysOverview>('replays', REPLAYS_HANDLERS.overviewRead)
}

/**
 * Story 140 D3: the `nameTemplates.*` handlers' renderer-side transport. Every one of them resolves
 * to `Outcome<NameTemplatesView>` - main's own refusals (an invalid template, an unknown id, ...)
 * are `Outcome`'s own `{ ok: false; error }` here, not a nested domain result, since this module's
 * handlers never half-succeed the way `servers.sources.*`'s did.
 */
export function listNameTemplates(): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesList)
}

export function addNameTemplate(template: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesAdd, { template })
}

export function updateNameTemplate(id: string, template: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesUpdate, {
    id,
    template,
  })
}

export function removeNameTemplate(id: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesRemove, { id })
}

export function reorderNameTemplates(ids: string[]): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesReorder, { ids })
}

export function resetNameTemplate(id: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesReset, { id })
}

export function restoreNameTemplates(): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesRestore)
}

/** Story 141 D4: every discovered demo across every known installation - the `ReplaysView`'s list. */
export function listDemos(): Promise<Outcome<DiscoveredDemo[]>> {
  return callModule<DiscoveredDemo[]>('replays', REPLAYS_HANDLERS.demosList)
}
