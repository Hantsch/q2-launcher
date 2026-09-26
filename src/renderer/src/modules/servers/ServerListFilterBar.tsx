import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BotOff, Check, Search, User, UserX, X } from 'lucide-react'
import {
  EMPTY_SERVER_LIST_FILTER,
  isFilterActive,
  type ServerListFilter,
} from '@shared/servers/list-filter'
import type { ServerGamemode } from '@shared/servers/row-markers'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select, type SelectOption } from '../../components/ui/controls'
import { SectionLabel } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'

export interface ServerListFilterBarProps {
  filter: ServerListFilter
  onChange: (f: ServerListFilter) => void
  options: { mods: string[]; maps: string[] }
  shown: number
  total: number
}

/** The five `ServerGamemode` values in a fixed display order — mirrors `ServerRow.tsx`'s own
 * `servers.gamemode.<mode>` keys, just enumerated here since `ServerGamemode` itself has no
 * canonical ordered list export. */
const GAMEMODE_OPTIONS: readonly ServerGamemode[] = ['ctf', 'team', 'deathmatch', 'coop', 'single']

/** Builds a `<Select>`'s option list for a nullable string filter field: "Any" first, mapped to the
 * empty value, then every known option, plus the currently selected value appended if it isn't
 * already among them — so the control never silently shows nothing for a value it can't display
 * (e.g. a mod/map that dropped out of the list after a rescan). */
function nullableOptions(
  known: string[],
  current: string | null,
  t: (key: string) => string,
): SelectOption[] {
  const values = current !== null && !known.includes(current) ? [...known, current] : known
  return [
    { value: '', label: t('servers.filter.any') },
    ...values.map((value) => ({ value, label: value })),
  ]
}

/** One quick-filter toggle: a full-width chip with an icon, pressed state as a flame edge plus a
 * check mark (never colour-only), `aria-pressed` for assistive tech. */
function FilterChip({
  active,
  icon,
  label,
  onToggle,
  testId,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onToggle: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-sm border px-2.5 text-left text-xs transition-colors duration-[--dur-fast]',
        active
          ? 'border-flame-600 bg-flame-900/30 text-flame-200'
          : 'border-line bg-void/40 text-ink-dim hover:border-line-strong hover:text-ink',
      )}
    >
      <span className="shrink-0 [&>svg]:size-3.5" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
    </button>
  )
}

/**
 * Story 120 D2: the servers list's filter/search rail - a controlled component over
 * `ServerListFilter` (`@shared/servers/list-filter`), the same "controller owns state, this
 * component only renders it and reports a change" shape as `ServerListHeader`. Every field writes
 * its own partial update on every interaction (no debounce, no local buffering) - `ServersView` is
 * the single source of truth for `filter`.
 *
 * Laid out as a vertical rail (search on top, the boolean quick filters as chips - "waiting
 * for an opponent" first, it is the one people scan for - then the mod/gamemode/map selects), the
 * shape people know from q2servers.com's left-hand filter column.
 */
export function ServerListFilterBar({
  filter,
  onChange,
  options,
  shown,
  total,
}: ServerListFilterBarProps) {
  const { t } = useTranslation()

  const modOptions = nullableOptions(options.mods, filter.mod, t)
  const mapOptions = nullableOptions(options.maps, filter.map, t)
  const gamemodeOptions: SelectOption[] = [
    { value: '', label: t('servers.filter.any') },
    ...GAMEMODE_OPTIONS.map((gamemode) => ({
      value: gamemode,
      label: t(`servers.gamemode.${gamemode}`),
    })),
  ]

  const active = isFilterActive(filter)

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label={t('servers.filter.search')}
          value={filter.search}
          placeholder={t('servers.filter.searchPlaceholder')}
          onChange={(event) => onChange({ ...filter, search: event.target.value })}
          className="pl-8"
          data-testid="servers-filter-search"
        />
      </div>

      <div className="space-y-2">
        <SectionLabel>{t('servers.filter.quick')}</SectionLabel>
        <FilterChip
          active={filter.waitingForOpponent}
          icon={<User />}
          label={t('servers.filter.waiting')}
          onToggle={() => onChange({ ...filter, waitingForOpponent: !filter.waitingForOpponent })}
          testId="servers-filter-waiting"
        />
        <FilterChip
          active={filter.empty}
          icon={<UserX />}
          label={t('servers.filter.empty')}
          onToggle={() => onChange({ ...filter, empty: !filter.empty })}
          testId="servers-filter-empty"
        />
        <FilterChip
          active={filter.hideBotsOnly}
          icon={<BotOff />}
          label={t('servers.filter.hideBotsOnly')}
          onToggle={() => onChange({ ...filter, hideBotsOnly: !filter.hideBotsOnly })}
          testId="servers-filter-hide-bots"
        />
      </div>

      <div className="space-y-3">
        <Field label={t('servers.filter.mod')}>
          <Select
            value={filter.mod ?? ''}
            options={modOptions}
            onChange={(event) =>
              onChange({ ...filter, mod: event.target.value === '' ? null : event.target.value })
            }
            data-testid="servers-filter-mod"
          />
        </Field>

        <Field label={t('servers.filter.gamemode')}>
          <Select
            value={filter.gamemode ?? ''}
            options={gamemodeOptions}
            onChange={(event) =>
              onChange({
                ...filter,
                gamemode: event.target.value === '' ? null : (event.target.value as ServerGamemode),
              })
            }
            data-testid="servers-filter-gamemode"
          />
        </Field>

        <Field label={t('servers.filter.map')}>
          <Select
            value={filter.map ?? ''}
            options={mapOptions}
            onChange={(event) =>
              onChange({ ...filter, map: event.target.value === '' ? null : event.target.value })
            }
            data-testid="servers-filter-map"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button
          variant="ghost"
          size="sm"
          icon={<X className="size-3.5" aria-hidden="true" />}
          onClick={() => onChange(EMPTY_SERVER_LIST_FILTER)}
          disabled={!active}
          data-testid="servers-filter-clear"
        >
          {t('servers.filter.clear')}
        </Button>
        {active && (
          <span className="px-2.5 text-xs text-ink-muted" data-testid="servers-filter-count">
            {t('servers.filter.count', { shown, total })}
          </span>
        )}
      </div>
    </div>
  )
}
