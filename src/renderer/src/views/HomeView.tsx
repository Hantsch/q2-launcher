import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import type { ModuleManifest } from '@shared/types'
import { cn } from '../lib/cn'
import { useLauncher } from '../store/useLauncher'
import { HeroPanel } from '../components/shell/HeroPanel'
import { moduleIcon } from '../components/shell/moduleIcons'
import { Badge } from '../components/ui/primitives'

/**
 * The landing view: key art, and a strip that shows every module and its state.
 *
 * The strip is the visible roadmap. A user opening the launcher today can see
 * exactly which parts exist and which are coming, instead of hunting for
 * features that are not there.
 */
export function HomeView() {
  const modules = useLauncher((state) => state.modules)
  const navModules = modules
    .filter((module) => module.nav !== null)
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))

  return (
    // Scrolls rather than squashing: at the minimum window height the hero used
    // to collapse until its title was clipped away.
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 scrollbar-gutter-stable">
      <HeroPanel />

      <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        {navModules.map((module) => (
          <ModuleCard key={module.id} module={module} />
        ))}
      </div>
    </div>
  )
}

function ModuleCard({ module }: { module: ModuleManifest }) {
  const { t } = useTranslation()
  const setRoute = useLauncher((state) => state.setRoute)
  const Icon = moduleIcon(module.icon)
  const planned = module.status === 'planned'

  return (
    <button
      type="button"
      onClick={() => setRoute(module.route)}
      className={cn(
        'panel group flex flex-col gap-2 rounded-md p-3.5 text-left',
        'transition-[border-color,background-color] duration-[--dur-base]',
        'hover:border-line-strong hover:bg-hover',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon
          className={cn(
            'size-4 transition-colors duration-[--dur-base]',
            planned ? 'text-ink-muted' : 'text-flame-500',
          )}
        />
        {planned ? (
          <Badge tone="neutral">{t('module.planned.badge')}</Badge>
        ) : (
          <ArrowRight className="size-3.5 text-ink-faint transition-transform duration-[--dur-base] group-hover:translate-x-0.5 group-hover:text-flame-400" />
        )}
      </div>

      <div className="space-y-1">
        <div className="font-display text-xs tracking-[0.12em] text-ink uppercase">
          {t(module.titleKey)}
        </div>
        <p className="line-clamp-2 text-[11px] leading-snug text-ink-muted">
          {t(module.descriptionKey)}
        </p>
      </div>
    </button>
  )
}
