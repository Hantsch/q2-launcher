import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { nameForCatalogRow } from '@shared/config/catalog/catalog-rows'
import type { ActionEntryKind } from '@shared/modules/config'
import { Field, Input, Select } from '../../../components/ui/controls'
import { NameDialog } from '../../../components/ui/NameDialog'
import { allCatalogRowInfos, type CatalogRowInfo } from '../lib/controls-row-entries'

export const ENTRY_KIND_OPTIONS: ActionEntryKind[] = [
  'bind',
  'message',
  'alias',
  'toggle',
  'press-release',
]

/**
 * Create-action form: name plus the kind (the entry, not the category, carries the kind), plus a
 * catalogue suggestions list next to the free-form fields. Picking a suggestion submits
 * immediately with that row's `catalogId` - the same "one entry, one click" shape `ActionEditor`'s
 * own "pick from the catalogue" list already uses for a command, just one level up. Debounced-saved
 * by the caller either way, so this dialog never waits on a network round trip.
 *
 * The Name field and the catalogue filter stay separately addressable by accessible name: the
 * `ui:flow` scripts that create a custom action locate the Name field by its label.
 */
export function CreateActionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string, kind: ActionEntryKind, catalogId?: string) => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<ActionEntryKind>('bind')
  const [filter, setFilter] = useState('')

  /**
   * The *stored* name is the catalogue's own locale-independent one (`nameForCatalogRow`), never
   * `t(info.labelKey)`. `ConfigAction.name` is persisted and written verbatim into the `.cfg`
   * comment by `render.ts`, so a translated label here would make the user's file depend on the UI
   * language it happened to be created in - and every other catalogue-backed entry
   * (`STANDARD_TEMPLATE`, the migration, `bind-adoption.ts#materialise`) already uses
   * `nameForCatalogRow` for exactly that reason. The list still *shows* the translated label: that
   * is UI chrome, and the row renders under its translated label either way once it exists,
   * because it carries the `catalogId`.
   */
  const pickSuggestion = (info: CatalogRowInfo): void => {
    onSubmit(nameForCatalogRow(info.row), 'bind', info.row.catalogId)
  }

  const suggestions = useMemo(() => {
    const all = allCatalogRowInfos()
    const query = filter.trim().toLowerCase()
    return query ? all.filter((info) => t(info.labelKey).toLowerCase().includes(query)) : all
  }, [filter, t])

  return (
    <NameDialog
      titleKey="config.controls.actions.createDialog.title"
      labelKey="config.controls.actions.createDialog.nameLabel"
      submitLabelKey="config.controls.actions.createDialog.submit"
      initialName=""
      maxLength={120}
      onClose={onClose}
      onSubmit={(name) => onSubmit(name, kind)}
    >
      <Field label={t('config.controls.createDialog.entryKindLabel')}>
        <Select
          options={ENTRY_KIND_OPTIONS.map((option) => ({
            value: option,
            label: t(`config.controls.entryKind.${option}`),
          }))}
          value={kind}
          onChange={(event) => setKind(event.target.value as ActionEntryKind)}
        />
      </Field>
      <Field label={t('config.controls.actions.createDialog.suggestions.label')}>
        <Input
          value={filter}
          placeholder={t('config.controls.actions.createDialog.suggestions.filterPlaceholder')}
          aria-label={t('config.controls.actions.createDialog.suggestions.filterPlaceholder')}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-sm border border-line">
          {suggestions.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-ink-muted">{t('common.none')}</p>
          ) : (
            suggestions.map((info) => (
              <button
                key={info.row.catalogId}
                type="button"
                onClick={() => pickSuggestion(info)}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover"
              >
                <span>{t(info.labelKey)}</span>
                <code className="text-ink-muted">
                  {info.row.commands.join('; ')}
                  {info.row.ammoCommand
                    ? ` +${t('config.controls.actions.createDialog.suggestions.ammoBadge')}`
                    : ''}
                </code>
              </button>
            ))
          )}
        </div>
      </Field>
    </NameDialog>
  )
}
