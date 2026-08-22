import { useTranslation } from 'react-i18next'
import { Circle } from 'lucide-react'
import type { ModuleManifest } from '@shared/types'
import { moduleIcon } from '../components/shell/moduleIcons'
import { Badge, Panel, SectionLabel } from '../components/ui/primitives'

/**
 * Shown for any module the shell knows about but has no renderer half for yet.
 *
 * This is the reason a parked module is not a dead end: the route exists, and
 * the page explains in plain language what the module is for and what it will
 * let the user do, via the manifest's optional `plannedIntroKey` /
 * `plannedHighlightKeys`. The `id / route / ipc` line is dev-only detail.
 */
export function PlannedModuleView({ module }: { module: ModuleManifest }) {
  const { t } = useTranslation()
  const Icon = moduleIcon(module.icon)

  return (
    <div className="h-full overflow-y-auto p-4 scrollbar-gutter-stable">
      <div className="mx-auto max-w-2xl space-y-4 py-8">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-md border border-line bg-panel">
            <Icon className="size-5 text-ink-muted" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl tracking-[0.06em] text-ink uppercase">
                {t(module.titleKey)}
              </h1>
              <Badge tone="neutral">{t('module.planned.badge')}</Badge>
            </div>
            <p className="text-sm text-ink-dim">{t(module.descriptionKey)}</p>
          </div>
        </div>

        <Panel className="stripes-hazard space-y-2 p-4">
          <h2 className="font-display text-sm tracking-[0.08em] text-flame-300 uppercase">
            {t('module.planned.title', { module: t(module.titleKey) })}
          </h2>
          <p className="text-xs leading-relaxed text-ink-dim">{t('module.planned.body')}</p>
        </Panel>

        {(module.plannedIntroKey || module.plannedHighlightKeys?.length) && (
          <Panel className="space-y-3 p-4">
            <SectionLabel>{t('module.planned.outlook')}</SectionLabel>
            {module.plannedIntroKey && (
              <p className="text-xs leading-relaxed text-ink-dim">{t(module.plannedIntroKey)}</p>
            )}
            {module.plannedHighlightKeys && module.plannedHighlightKeys.length > 0 && (
              <ul className="space-y-2">
                {module.plannedHighlightKeys.map((highlightKey) => (
                  <li key={highlightKey} className="flex items-start gap-2.5">
                    <Circle className="mt-1 size-2 shrink-0 text-flame-700" fill="currentColor" />
                    <span className="text-xs leading-relaxed text-ink-dim">{t(highlightKey)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {import.meta.env.DEV && (
          <div className="numeric px-1 text-[10px] text-ink-muted">
            id: {module.id} &middot; route: {module.route} &middot; ipc: {module.ipcNamespace}
          </div>
        )}
      </div>
    </div>
  )
}
