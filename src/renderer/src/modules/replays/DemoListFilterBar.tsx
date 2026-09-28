import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import {
  EMPTY_DEMO_LIST_FILTER,
  isDemoFilterActive,
  type DemoGamemodeFilterOption,
  type DemoListFilter,
} from '@shared/replays/list-filter'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, Select, type SelectOption } from '../../components/ui/controls'
import { SectionLabel } from '../../components/ui/primitives'

export interface DemoListFilterBarProps {
  filter: DemoListFilter
  onChange: (next: DemoListFilter) => void
  options: {
    mods: string[]
    maps: string[]
    gamemodes: DemoGamemodeFilterOption[]
    tags: string[]
  }
  shown: number
  total: number
}

/** Builds a `<Select>`'s option list for a nullable string filter field: "Any" first, mapped to the
 * empty value, then every known option, plus the currently selected value appended if it isn't
 * already among them — so the control never silently shows nothing for a value it can't display
 * (e.g. a mod/map that dropped out of the list after a rescan). Copied verbatim from
 * `ServerListFilterBar.tsx`. */
function nullableOptions(
  known: string[],
  current: string | null,
  t: (key: string) => string,
): SelectOption[] {
  const values = current !== null && !known.includes(current) ? [...known, current] : known
  return [
    { value: '', label: t('replays.filter.any') },
    ...values.map((value) => ({ value, label: value })),
  ]
}

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/**
 * Story 153 D4: the demo list's filter/search rail — a controlled component over `DemoListFilter`
 * (`@shared/replays/list-filter`), the same "controller owns state, this component only renders it
 * and reports a change" shape as `ServerListFilterBar`. Every field writes its own partial update on
 * every interaction (no debounce, no local buffering) — the caller is the single source of truth for
 * `filter`.
 */
export function DemoListFilterBar({ filter, onChange, options, shown, total }: DemoListFilterBarProps) {
  const { t } = useTranslation()

  const modOptions = nullableOptions(options.mods, filter.mod, t)
  const mapOptions = nullableOptions(options.maps, filter.map, t)

  const knownGamemodeValues = options.gamemodes.map((g) => g.value)
  const gamemodeValues =
    filter.gamemode !== null && !knownGamemodeValues.includes(filter.gamemode)
      ? [...options.gamemodes, { value: filter.gamemode, label: filter.gamemode }]
      : options.gamemodes
  const gamemodeOptions: SelectOption[] = [
    { value: '', label: t('replays.filter.any') },
    ...gamemodeValues.map((g) => ({
      value: g.value,
      label: g.labelKey !== undefined ? t(g.labelKey) : (g.label ?? g.value),
    })),
  ]

  const ratingOptions: SelectOption[] = [
    { value: '', label: t('replays.filter.any') },
    ...RATINGS.map((n) => ({ value: String(n), label: t('replays.filter.ratingAtLeast', { n }) })),
  ]

  const active = isDemoFilterActive(filter)
  const tagsGroupId = 'replays-filter-tags-label'

  const selectedTags = filter.tags
  const allTags = [...new Set([...options.tags, ...selectedTags])]

  return (
    <div className="flex flex-col gap-5">
      <SectionLabel>{t('replays.filter.title')}</SectionLabel>

      <Input
        type="search"
        aria-label={t('replays.filter.search')}
        value={filter.search}
        placeholder={t('replays.filter.searchPlaceholder')}
        onChange={(event) => onChange({ ...filter, search: event.target.value })}
        data-testid="replays-filter-search"
      />

      <div className="space-y-3">
        <Field label={t('replays.filter.mod')}>
          <Select
            value={filter.mod ?? ''}
            options={modOptions}
            onChange={(event) =>
              onChange({ ...filter, mod: event.target.value === '' ? null : event.target.value })
            }
            data-testid="replays-filter-mod"
          />
        </Field>

        <Field label={t('replays.filter.gamemode')}>
          <Select
            value={filter.gamemode ?? ''}
            options={gamemodeOptions}
            onChange={(event) =>
              onChange({ ...filter, gamemode: event.target.value === '' ? null : event.target.value })
            }
            data-testid="replays-filter-gamemode"
          />
        </Field>

        <Field label={t('replays.filter.map')}>
          <Select
            value={filter.map ?? ''}
            options={mapOptions}
            onChange={(event) =>
              onChange({ ...filter, map: event.target.value === '' ? null : event.target.value })
            }
            data-testid="replays-filter-map"
          />
        </Field>

        <Field label={t('replays.filter.rating')}>
          <Select
            value={filter.minRating === null ? '' : String(filter.minRating)}
            options={ratingOptions}
            onChange={(event) =>
              onChange({
                ...filter,
                minRating: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            data-testid="replays-filter-rating"
          />
        </Field>
      </div>

      <Checkbox
        checked={filter.favouritesOnly}
        onChange={(next) => onChange({ ...filter, favouritesOnly: next })}
        label={t('replays.filter.favourites')}
        className="min-h-11"
        data-testid="replays-filter-favourites"
      />

      <div className="space-y-2">
        <SectionLabel id={tagsGroupId}>{t('replays.filter.tags')}</SectionLabel>
        {options.tags.length === 0 ? (
          <p className="text-xs text-ink-muted">{t('replays.filter.noTags')}</p>
        ) : (
          <div role="group" aria-labelledby={tagsGroupId} className="space-y-1">
            {allTags.map((tag) => {
              const checked = selectedTags.includes(tag)
              return (
                <Checkbox
                  key={tag}
                  checked={checked}
                  onChange={() =>
                    onChange({
                      ...filter,
                      tags: checked
                        ? selectedTags.filter((t2) => t2 !== tag)
                        : [...selectedTags, tag],
                    })
                  }
                  label={tag}
                  className="min-h-11"
                  data-testid="replays-filter-tag"
                  data-tag={tag}
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button
          variant="ghost"
          size="sm"
          icon={<X className="size-3.5" aria-hidden="true" />}
          onClick={() => onChange(EMPTY_DEMO_LIST_FILTER)}
          disabled={!active}
          data-testid="replays-filter-clear"
        >
          {t('replays.filter.clear')}
        </Button>
        {active && (
          <span className="px-2.5 text-xs text-ink-muted" data-testid="replays-filter-count">
            {t('replays.filter.count', { shown, total })}
          </span>
        )}
      </div>
    </div>
  )
}
