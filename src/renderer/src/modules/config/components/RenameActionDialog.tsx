import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AltLayer } from '@shared/config/alt-layers'
import { derivedAliasName, renderedAliasNames } from '@shared/config/alias-render'
import { validateAliasName } from '@shared/config/alias-names'
import { findAliasReferrers, type AliasReferrer } from '@shared/config/alias-references'
import type { ConfigAction } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'

/**
 * Renames one action. Mirrors `RenameProfileDialog`'s shape, plus - since story 039 - a second,
 * optional "own alias name" field and the rename-refusal check that field is the escape hatch for.
 *
 * `actions`/`binds`/`layers` are the profile's full reference sources (story 038's
 * `AliasReferenceSources` shape), needed for two independent reasons: `actions` (minus this one)
 * supplies `validateAliasName`'s duplicate-check `context`, and all three together are what
 * `findAliasReferrers` scans to decide whether changing the *display* name would leave a dangling
 * reference behind.
 *
 * Story 044, D5: extracted out of `ControlsTab.tsx` verbatim (same props, same behaviour) so both
 * that tab and `AliasesTab.tsx` share the one rename-refusal implementation - story 039's rule lives
 * in exactly one place rather than being duplicated for the second caller.
 */
export function RenameActionDialog({
  action,
  actions,
  binds,
  layers,
  onClose,
  onSubmit,
}: {
  action: ConfigAction
  actions: ConfigAction[]
  binds: Record<string, string>
  layers: AltLayer[]
  onClose: () => void
  onSubmit: (input: { name: string; aliasName: string | undefined }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(action.name)
  const [ownAliasName, setOwnAliasName] = useState(action.aliasName ?? '')
  const [submitting, setSubmitting] = useState(false)

  const placeholder = derivedAliasName(action)

  // The other entries' already-resolved alias names - `validateAliasName`'s duplicate check, same
  // shape D2's own doc comment describes (`alias-names.ts`).
  //
  // `renderedAliasNames`, not `aliasNameFor` (story-045 review, finding 3): a two-part entry defines
  // more names than the one it is called by (a toggle's `_s1`/`_s2` states, a press/release pair's
  // `+`/`-` halves), and every one of them is a name this dialog must refuse to hand out a second
  // time - the file has one definition per name, so a collision means the loser's body is simply
  // gone on the next save.
  const otherAliasNames = useMemo(
    () => actions.filter((other) => other.id !== action.id).flatMap((other) => renderedAliasNames(other)),
    [actions, action.id],
  )

  const trimmedOwnAliasName = ownAliasName.trim()
  // An empty own-name field means "use the derived name" - not a candidate to validate at all
  // (design decision: clearing the field returns the entry to the derived name).
  const aliasValidation =
    trimmedOwnAliasName.length > 0
      ? validateAliasName(trimmedOwnAliasName, otherAliasNames, action.kind)
      : { ok: true as const }
  const aliasError = aliasValidation.ok
    ? undefined
    : t(
        `config.controls.actions.renameDialog.aliasName.error.${aliasValidation.reason}`,
        aliasValidation.params,
      )

  // Rename refusal (story 039, D9): only the entry's *current* alias name - resolved before any
  // edit in this dialog - and only while the display name is actually changing. Changing solely the
  // alias-name field is never refused; that field is the story's own escape hatch.
  //
  // Review fix: the escape hatch must also cover "pin a name, then rename" *in one save* - typing
  // an own name (whether it repeats the current resolved name to lock it in place, or replaces it
  // outright) decouples the resolved alias name from the display name from this submit onward, so
  // a display-name change alongside it can never move the name any referrer relies on. Only when
  // the dialog would still fall back to the *derived* name (own-name field left empty) does a
  // display-name change risk silently moving a referenced name - that is the one case this refusal
  // exists for.
  const referrers = useMemo(
    () => findAliasReferrers(action, { actions, binds, layers }),
    [action, actions, binds, layers],
  )
  const nameChanged = name.trim() !== action.name
  const renameRefused = nameChanged && trimmedOwnAliasName.length === 0 && referrers.length > 0

  const formatReferrer = (referrer: AliasReferrer): string => {
    switch (referrer.kind) {
      case 'action':
        return referrer.name
      case 'bind':
        return t('config.controls.actions.renameDialog.refusal.handTypedBind', { key: referrer.key })
      case 'override':
        return t('config.controls.actions.renameDialog.refusal.handTypedOverride', {
          key: referrer.key,
          layer: referrer.layerName,
        })
    }
  }

  const referrerLabels = renameRefused ? referrers.map(formatReferrer) : []
  const refusalMessage = renameRefused
    ? t('config.controls.actions.renameDialog.refusal.message', { names: referrerLabels.join(', ') })
    : undefined

  const canSubmit = name.trim().length > 0 && !submitting && aliasValidation.ok && !renameRefused

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit({
      name: name.trim(),
      aliasName: trimmedOwnAliasName.length > 0 ? trimmedOwnAliasName : undefined,
    })
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.actions.renameDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.controls.actions.renameDialog.label')} error={refusalMessage}>
          <Input
            value={name}
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
        </Field>
        <Field
          label={t('config.controls.actions.renameDialog.aliasName.label')}
          hint={aliasError ? undefined : t('config.controls.actions.renameDialog.aliasName.hint', { placeholder })}
          error={aliasError}
        >
          <Input
            value={ownAliasName}
            placeholder={placeholder}
            // Deliberately not `MAX_OWN_ALIAS_NAME_LENGTH`: an input-level `maxLength` at exactly
            // the budget would silently stop the keystroke instead of ever reaching
            // `validateAliasName`'s `tooLong` reason, so a name past the budget could never be
            // rejected *with a reason* (AC6) - only ever truncated without one. `120` mirrors the
            // display-name field above and is generous enough that a user typing past the real
            // budget still sees the `tooLong` error instead of a truncated string.
            maxLength={120}
            onChange={(event) => setOwnAliasName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}
