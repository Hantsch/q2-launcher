import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookmarkPlus, BotOff, Check, Search, User, UserX, X } from 'lucide-react'
import {
  EMPTY_SERVER_LIST_FILTER,
  isFilterActive,
  locationOptions,
  MAX_PING_STEPS,
  type MaxPingMs,
  type ServerListFilter,
} from '@shared/servers/list-filter'
import {
  applyCriteria,
  clearCriteria,
  criteriaOf,
  hasCriteria,
  QUICK_FILTER_MAX,
  sameCriteria,
  type QuickFilter,
} from '@shared/servers/quick-filters'
import { countryName, parseLocationToken } from '@shared/servers/location'
import type { ServerGamemode } from '@shared/servers/row-markers'
import type { ServerListEntry } from '@shared/modules/servers'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select, type SelectOption } from '../../components/ui/controls'
import { MultiSelect, type MultiSelectOption } from '../../components/ui/MultiSelect'
import { SectionLabel } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'

const NO_ROWS: readonly ServerListEntry[] = Object.freeze([])

export interface ServerListFilterBarProps {
  filter: ServerListFilter
  onChange: (f: ServerListFilter) => void
  options: { mods: string[]; maps: string[] }
  /** The scanned rows the location choices are derived from. */
  rows?: readonly ServerListEntry[]
  shown: number
  total: number
  /** Story 197: the saved quick filters, rendered as chips after the built-in ones. */
  quickFilters?: readonly QuickFilter[]
  onSaveQuickFilter?: () => void
  /** Story 197 slot: rendered beside each saved chip (the rename/delete menu). */
  renderQuickFilterActions?: (quickFilter: QuickFilter) => ReactNode
}

/** The five `ServerGamemode` values in a fixed display order — mirrors `ServerRow.tsx`'s own
 * `servers.gamemode.<mode>` keys, just enumerated here since `ServerGamemode` itself has no
 * canonical ordered list export. */
const GAMEMODE_OPTIONS: readonly ServerGamemode[] = ['ctf', 'team', 'deathmatch', 'coop', 'single']

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
 * Story 120: the servers list's filter/search rail - a controlled component over
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
  rows = NO_ROWS,
  shown,
  total,
  quickFilters = [],
  onSaveQuickFilter,
  renderQuickFilterActions,
}: ServerListFilterBarProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const locationChoices = useMemo(() => {
    const continentOf = new Map<string, string>()
    for (const { location } of rows) {
      if (location?.kind === 'country') continentOf.set(location.country, location.continent)
    }
    return locationOptions(rows, filter.location).map((token): MultiSelectOption => {
      const parsed = parseLocationToken(token)
      switch (parsed?.kind) {
        case 'region':
          return { value: token, label: t(`servers.location.region.${parsed.continent}`) }
        case 'country': {
          const continent = continentOf.get(parsed.country)
          return {
            value: token,
            label: countryName(parsed.country, locale),
            level: continent ? 1 : 0,
            impliedBy: continent ? `region:${continent}` : undefined,
          }
        }
        case 'lan':
          return { value: token, label: t('servers.location.lan') }
        case 'unknown':
          return { value: token, label: t('common.label.unknown') }
        default:
          return { value: token, label: token }
      }
    })
  }, [rows, filter.location, t, locale])

  const gamemodeOptions: SelectOption[] = [
    { value: '', label: t('common.label.any') },
    ...GAMEMODE_OPTIONS.map((gamemode) => ({
      value: gamemode,
      label: t(`servers.gamemode.${gamemode}`),
    })),
  ]
  const maxPingOptions: SelectOption[] = [
    { value: '', label: t('common.label.any') },
    ...MAX_PING_STEPS.map((ms) => ({
      value: String(ms),
      label: t('servers.filter.pingBelow', { ms }),
    })),
  ]

  const active = isFilterActive(filter)
  const currentCriteria = criteriaOf(filter)
  const saveReasonKey = !hasCriteria(currentCriteria)
    ? 'servers.quickFilter.saveNeedsCriteria'
    : quickFilters.length >= QUICK_FILTER_MAX
      ? 'servers.quickFilter.saveAtCap'
      : null

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label={t('common.label.search')}
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
          label={t('common.label.empty')}
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
        {quickFilters.map((qf) => {
          const pressed = sameCriteria(currentCriteria, qf.criteria)
          return (
            <div key={qf.id} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <FilterChip
                  active={pressed}
                  icon={<BookmarkPlus />}
                  label={qf.name}
                  onToggle={() =>
                    onChange(pressed ? clearCriteria(filter) : applyCriteria(filter, qf.criteria))
                  }
                  testId="servers-quickfilter-chip"
                />
              </div>
              {renderQuickFilterActions?.(qf)}
            </div>
          )
        })}
        <Button
          variant="ghost"
          size="sm"
          icon={<BookmarkPlus className="size-3.5" aria-hidden="true" />}
          onClick={onSaveQuickFilter}
          disabled={saveReasonKey !== null || !onSaveQuickFilter}
          data-testid="servers-quickfilter-save"
        >
          {t('servers.quickFilter.save')}
        </Button>
        {saveReasonKey && (
          <p
            className="px-2.5 text-xs text-ink-muted"
            data-testid="servers-quickfilter-save-reason"
          >
            {t(saveReasonKey)}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Field label={t('common.label.mod')}>
          <MultiSelect
            label={t('common.label.mod')}
            options={options.mods}
            value={filter.mod}
            onChange={(mod) => onChange({ ...filter, mod })}
            summaryCount={(count) => t('servers.filter.modsCount', { count })}
            data-testid="servers-filter-mod"
          />
        </Field>

        <Field label={t('common.label.location')}>
          <MultiSelect
            label={t('common.label.location')}
            options={locationChoices}
            value={filter.location}
            onChange={(location) => onChange({ ...filter, location })}
            summaryCount={(count) => t('servers.filter.locationsCount', { count })}
            filterable
            filterLabel={t('servers.filter.locationSearch')}
            data-testid="servers-filter-location"
          />
        </Field>

        <Field label={t('common.label.gamemode')}>
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

        <Field label={t('common.label.map')}>
          <MultiSelect
            label={t('common.label.map')}
            options={options.maps}
            value={filter.map}
            onChange={(map) => onChange({ ...filter, map })}
            summaryCount={(count) => t('servers.filter.mapsCount', { count })}
            data-testid="servers-filter-map"
          />
        </Field>

        <Field label={t('servers.filter.maxPing')}>
          <Select
            value={filter.maxPingMs === null ? '' : String(filter.maxPingMs)}
            options={maxPingOptions}
            onChange={(event) =>
              onChange({
                ...filter,
                maxPingMs:
                  event.target.value === '' ? null : (Number(event.target.value) as MaxPingMs),
              })
            }
            data-testid="servers-filter-max-ping"
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
          {t('common.action.clearFilters')}
        </Button>
        {active && (
          <span className="px-2.5 text-xs text-ink-muted" data-testid="servers-filter-count">
            {t('common.label.showingCount', { shown, total })}
          </span>
        )}
      </div>
    </div>
  )
}
