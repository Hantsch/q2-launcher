import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_CVARS } from '@shared/config/cvar-catalog'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'

/**
 * Add-a-cvar-by-name-and-value form (story 059 D8), scoped to the section it was opened from -
 * the section's own toolbar "Add cvar" button mirrors `ControlsTab`'s "New sub-category" button
 * living in the category toolbar (053 D6), scoped to `selectedCategory`.
 *
 * Unlike `CreateActionDialog`'s catalogue suggestions (which submit immediately on pick, because an
 * action needs no value of its own), picking a suggestion here only fills the name field - a cvar
 * always needs a value too, so the two fields are filled in independently and one "Add cvar"
 * click commits both. A name that matches `ALL_CVARS` (case-insensitively, same rule `findCvar`
 * applies) gets today's rich `CvarRow` the moment it is added (D7's grouping already resolves any
 * cvar name through the catalogue); anything else renders as a `PlainCvarRow` - the acceptance
 * criterion this dialog exists to satisfy (adding `cl_maxfps` vs `zz_unknown`).
 */
export function AddCvarDialog({
  sectionLabel,
  existingCvarNames,
  onClose,
  onSubmit,
}: {
  sectionLabel: string
  /** Story 059 review Fix 6: every name already carrying a value in `profile.cvars` - checked
   * against the typed name so submitting an empty value for one of them can be caught here rather
   * than silently blanking its stored value. Exact-string, not case-folded: `profile.cvars` is keyed
   * by the literal name (real Quake II cvar lookup is case-sensitive, same rule `import-reader.ts`
   * documents for its own merge), so this must compare the same way. */
  existingCvarNames: ReadonlySet<string>
  onClose: () => void
  onSubmit: (name: string, value: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const trimmedName = name.trim()
  // Story 059 review Fix 6: a name that already has a stored value must not be submittable with an
  // empty one - that used to silently overwrite the existing value with `''`. An existing name with
  // a real value typed is an intentional overwrite and stays allowed.
  const collidesWithEmptyValue = existingCvarNames.has(trimmedName) && value.length === 0
  const canSubmit = trimmedName.length > 0 && !submitting && !collidesWithEmptyValue

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    const ok = await onSubmit(trimmedName, value)
    setSubmitting(false)
    if (!ok) return
  }

  // Story 059 D8: a typeahead over the catalogue's own names, not a full "pick from the
  // catalogue" list (`CreateActionDialog`'s suggestions need a whole `CatalogRowInfo`; a cvar
  // suggestion only ever needs to fill in the name field) - up to 8 matches, same cap
  // `CreateActionDialog`'s own suggestions box scrolls rather than grows past.
  const suggestions = useMemo(() => {
    const query = name.trim().toLowerCase()
    if (!query) return []
    return ALL_CVARS.filter((def) => def.name.toLowerCase().includes(query)).slice(0, 8)
  }, [name])

  return (
    <Modal
      open
      size="sm"
      title={t('config.settings.section.addCvarDialog.title', { section: sectionLabel })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.settings.section.addCvarDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.settings.section.addCvarDialog.nameLabel')}>
          <Input
            value={name}
            autoFocus
            maxLength={120}
            placeholder={t('config.settings.section.addCvarDialog.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
          {suggestions.length > 0 && (
            <div
              role="listbox"
              aria-label={t('config.settings.section.addCvarDialog.suggestionsLabel')}
              className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-sm border border-line"
            >
              {suggestions.map((def) => (
                <button
                  key={def.name}
                  type="button"
                  role="option"
                  aria-selected={def.name.toLowerCase() === name.trim().toLowerCase()}
                  onClick={() => setName(def.name)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover"
                >
                  <code className="font-mono">{def.name}</code>
                  <span className="text-ink-muted">{t(def.labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field
          label={t('config.settings.section.addCvarDialog.valueLabel')}
          error={
            collidesWithEmptyValue
              ? t('config.settings.section.addCvarDialog.existingNameWarning', { name: trimmedName })
              : undefined
          }
        >
          <Input value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
