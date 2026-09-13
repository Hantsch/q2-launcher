import { useTranslation } from 'react-i18next'
import { Home, Minus, Settings, Square, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { invoke } from '../../lib/bridge'
import type { ModuleId } from '@shared/types'
import { ROUTE_HOME, ROUTE_SETTINGS, useActiveJobCount, useLauncher } from '../../store/useLauncher'
import { moduleIcon } from './moduleIcons'
import { UpdateButton } from './UpdateButton'
import { UtilityButton } from './UtilityButton'

/**
 * Custom window chrome plus the primary navigation.
 *
 * The whole bar is a drag region; every interactive child opts out with
 * `.no-drag`, otherwise the OS swallows the click and turns it into a
 * window move.
 */
export function TitleBar() {
  const { t } = useTranslation()
  const route = useLauncher((state) => state.route)
  const setRoute = useLauncher((state) => state.setRoute)
  const modules = useLauncher((state) => state.modules)
  const maximized = useLauncher((state) => state.chrome.maximized)

  const navModules = modules
    .filter((module) => module.nav?.section === 'primary')
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))

  const utilityModules = modules
    .filter((module) => module.nav?.section === 'secondary')
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))

  return (
    <header
      className="drag-region relative z-20 flex shrink-0 items-stretch border-b border-line bg-panel/80 backdrop-blur-sm"
      style={{ height: 'var(--titlebar-h)' }}
      // Matching the OS behaviour we lose by going frameless.
      onDoubleClick={() => void invoke('window:toggleMaximize')}
    >
      {/* Wordmark. Text only: the app icon belongs to the OS (taskbar, shortcut),
          repeating it inside our own chrome only crowds the bar. */}
      {/* Story 030's 26px/18px wordmark is what a wide window gets. It does not fit a narrow one:
          at the 940px minimum width, wordmark + nav + right cluster measure 964px, and the
          wordmark - the only flexible item in the row - absorbed the difference by breaking
          "QUAKE II" over two lines and pushing the tagline out through the bottom of the bar. So
          it never shrinks or wraps (`shrink-0`, `whitespace-nowrap`) and instead steps down one
          size below `lg`, which is the width from which the full-size block provably fits. */}
      <div className="flex shrink-0 items-center pr-5 pl-4 whitespace-nowrap lg:pr-6 lg:pl-5">
        <div className="leading-none">
          <div className="font-display text-[20px] font-semibold tracking-[0.18em] text-ink uppercase lg:text-[26px]">
            {t('app.wordmark')}
          </div>
          <div className="stencil mt-0.5 text-[14px] tracking-[0.3em] lg:text-[18px]">
            {t('app.tagline')}
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex items-stretch" aria-label={t('nav.home')}>
        <NavItem
          icon={<Home className="size-4.5" />}
          label={t('nav.home')}
          active={route === ROUTE_HOME}
          onClick={() => setRoute(ROUTE_HOME)}
          testId="nav-home"
        />
        {navModules.map((module) => {
          const Icon = moduleIcon(module.icon)
          return (
            <NavItem
              key={module.id}
              icon={<Icon className="size-4.5" />}
              label={t(module.titleKey)}
              active={route === module.route}
              planned={module.status === 'planned'}
              onClick={() => setRoute(module.route)}
              testId={`nav-${module.id}`}
            />
          )
        })}
      </nav>

      <div className="flex-1" />

      {/* Utility (secondary nav) + Settings + window controls */}
      <div className="flex items-center gap-1 pr-1 pl-2">
        <UpdateButton />

        {utilityModules.map((module) => (
          <UtilityModuleButton
            key={module.id}
            moduleId={module.id}
            titleKey={module.titleKey}
            icon={module.icon}
            active={route === module.route}
            onClick={() => setRoute(module.route)}
          />
        ))}

        <UtilityButton
          testId="nav-settings"
          label={t('nav.settingsTitle')}
          active={route === ROUTE_SETTINGS}
          onClick={() => setRoute(ROUTE_SETTINGS)}
        >
          <Settings className="size-5" />
        </UtilityButton>

        <div className="mx-1 h-7 w-px bg-line" />

        <WindowButton label={t('titlebar.minimize')} onClick={() => void invoke('window:minimize')}>
          <Minus className="size-5" />
        </WindowButton>
        <WindowButton
          label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          onClick={() => void invoke('window:toggleMaximize')}
        >
          <Square className={cn('size-4', maximized && 'opacity-70')} />
        </WindowButton>
        <WindowButton
          label={t('titlebar.close')}
          danger
          onClick={() => void invoke('window:close')}
        >
          <X className="size-5" />
        </WindowButton>
      </div>
    </header>
  )
}

function NavItem({
  icon,
  label,
  active,
  planned,
  onClick,
  testId,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  planned?: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'no-drag relative flex items-center gap-1.5 px-4',
        'font-display text-[13px] font-medium tracking-[0.14em] uppercase',
        'transition-colors duration-[--dur-fast]',
        active ? 'text-ink' : 'text-ink-muted hover:text-ink-dim',
      )}
    >
      <span className={cn(active ? 'text-flame-500' : 'text-current')}>{icon}</span>
      {label}
      {/* Planned modules stay reachable but are marked, so the roadmap is visible
          in the product instead of hidden in a file. */}
      {planned && <span className="size-1 rounded-full bg-ink-faint" />}
      {active && (
        <span className="absolute inset-x-3 bottom-0 h-0.5 bg-flame-500 shadow-[0_0_10px_rgb(255_138_31/0.6)]" />
      )}
    </button>
  )
}

/**
 * A utility-nav button for a module (e.g. Downloads): resolves its own active
 * job count and swaps in the count-aware, pluralised label when jobs are
 * active - story 032 D3. Kept generic over `moduleId`, never hardcoded to a
 * specific module, so any current or future secondary module gets the badge
 * for free.
 */
function UtilityModuleButton({
  moduleId,
  titleKey,
  icon,
  active,
  onClick,
}: {
  moduleId: ModuleId
  titleKey: string
  icon: string
  active: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const Icon = moduleIcon(icon)
  const activeJobCount = useActiveJobCount(moduleId)
  const label = activeJobCount > 0 ? t('nav.activeJobs', { count: activeJobCount }) : t(titleKey)

  return (
    <UtilityButton
      testId={`nav-${moduleId}`}
      label={label}
      active={active}
      onClick={onClick}
      badge={activeJobCount}
    >
      <Icon className="size-5" />
    </UtilityButton>
  )
}

function WindowButton({
  label,
  children,
  onClick,
  danger,
}: {
  label: string
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'no-drag grid h-11 w-12 place-items-center rounded-sm text-ink-muted',
        'transition-colors duration-[--dur-fast]',
        danger ? 'hover:bg-danger hover:text-void' : 'hover:bg-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
