import { useTranslation } from 'react-i18next'
import { EMPTY_SERVER_LIST_FILTER, isFilterActive, type ServerListFilter } from '@shared/servers/list-filter'
import type { ServerGamemode } from '@shared/servers/row-markers'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, Select, type SelectOption } from '../../components/ui/controls'

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
function nullableOptions(known: string[], current: string | null, t: (key: string) => string): SelectOption[] {
  const values = current !== null && !known.includes(current) ? [...known, current] : known
  return [{ value: '', label: t('servers.filter.any') }, ...values.map((value) => ({ value, label: value }))]
}

/**
 * Story 120 D2: the servers list's filter/search bar - a controlled component over
 * `ServerListFilter` (`@shared/servers/list-filter`), the same "controller owns state, this
 * component only renders it and reports a change" shape as `ServerSortBar`. Every field writes its
 * own partial update on every interaction (no debounce, no local buffering) - `ServersView` is the
 * single source of truth for `filter`.
 */
export function ServerListFilterBar({ filter, onChange, options, shown, total }: ServerListFilterBarProps) {
  const { t } = useTranslation()

  const modOptions = nullableOptions(options.mods, filter.mod, t)
  const mapOptions = nullableOptions(options.maps, filter.map, t)
  const gamemodeOptions: SelectOption[] = [
    { value: '', label: t('servers.filter.any') },
    ...GAMEMODE_OPTIONS.map((gamemode) => ({ value: gamemode, label: t(`servers.gamemode.${gamemode}`) })),
  ]

  const active = isFilterActive(filter)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('servers.filter.search')} className="min-w-48 flex-1">
          <Input
            type="search"
            value={filter.search}
            placeholder={t('servers.filter.searchPlaceholder')}
            onChange={(event) => onChange({ ...filter, search: event.target.value })}
            data-testid="servers-filter-search"
          />
        </Field>

        <Field label={t('servers.filter.mod')} className="w-40">
          <Select
            value={filter.mod ?? ''}
            options={modOptions}
            onChange={(event) => onChange({ ...filter, mod: event.target.value === '' ? null : event.target.value })}
            data-testid="servers-filter-mod"
          />
        </Field>

        <Field label={t('servers.filter.gamemode')} className="w-40">
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

        <Field label={t('servers.filter.map')} className="w-40">
          <Select
            value={filter.map ?? ''}
            options={mapOptions}
            onChange={(event) => onChange({ ...filter, map: event.target.value === '' ? null : event.target.value })}
            data-testid="servers-filter-map"
          />
        </Field>

        <Button
          variant="neutral"
          onClick={() => onChange(EMPTY_SERVER_LIST_FILTER)}
          disabled={!active}
          data-testid="servers-filter-clear"
        >
          {t('servers.filter.clear')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div data-testid="servers-filter-non-empty">
          <Checkbox
            className="min-h-11"
            checked={filter.nonEmpty}
            onChange={(nonEmpty) => onChange({ ...filter, nonEmpty })}
            label={t('servers.filter.nonEmpty')}
          />
        </div>
        <div data-testid="servers-filter-not-full">
          <Checkbox
            className="min-h-11"
            checked={filter.notFull}
            onChange={(notFull) => onChange({ ...filter, notFull })}
            label={t('servers.filter.notFull')}
          />
        </div>
        <div data-testid="servers-filter-no-password">
          <Checkbox
            className="min-h-11"
            checked={filter.noPassword}
            onChange={(noPassword) => onChange({ ...filter, noPassword })}
            label={t('servers.filter.noPassword')}
          />
        </div>
        <div data-testid="servers-filter-waiting">
          <Checkbox
            className="min-h-11"
            checked={filter.waitingForOpponent}
            onChange={(waitingForOpponent) => onChange({ ...filter, waitingForOpponent })}
            label={t('servers.filter.waiting')}
          />
        </div>

        {active && (
          <span className="text-xs text-ink-muted" data-testid="servers-filter-count">
            {t('servers.filter.count', { shown, total })}
          </span>
        )}
      </div>
    </div>
  )
}
