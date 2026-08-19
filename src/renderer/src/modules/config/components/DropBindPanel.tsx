import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Trash2 } from 'lucide-react'
import { DROPPABLES } from '@shared/config/action-catalog'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { IconButton } from '../../../components/ui/Button'
import { Checkbox, Input } from '../../../components/ui/controls'
import { SectionLabel } from '../../../components/ui/primitives'
import {
  applyModifierReplace,
  applyReplace,
  findModifierSlotCollision,
  findSlotCollision,
} from '../lib/bind-slot-collision'
import {
  applyAmmo,
  applyMessage,
  applySlot,
  buildDropGroups,
  deriveRowState,
  type CatalogRow,
} from '../lib/catalog-binds'
import { BindSlot } from './BindSlot'

/**
 * Story 015 D6: the Weapon dropping dual-bind editor - D5's sibling
 * `DualBindPanel`, but with three groups instead of one/two (Weapons /
 * Ammunition / Misc, D3's `buildDropGroups`) and two extra per-row controls:
 * an ammo-choice checkbox (decision 7/8) and a free-text team-message field
 * (decision 6/16). `AdvancedTab` renders this in place of `DualBindPanel`
 * for exactly the `drops` category; `DualBindPanel` itself is untouched.
 *
 * Row label resolution mirrors `DualBindPanel`'s `zip`: `CatalogRow` stays
 * hook-free (see `catalog-binds.ts`'s docstring), so labels are resolved
 * here by pairing `buildDropGroups()`'s rows with `DROPPABLES` filtered by
 * `kind` in the exact same order `catalog-binds.ts` uses internally - same
 * technique, duplicated rather than imported from `DualBindPanel.tsx` to
 * avoid an out-of-scope edit to that just-reviewed sibling file.
 */
export interface DropBindPanelProps {
  /** The full draft actions array, not pre-filtered - the `apply*` helpers need to find/replace/
   * prune within the whole array, and the legacy rows below are filtered out of this same array. */
  actions: ConfigAction[]
  /** Story 015 D7: the whole in-progress draft profile, for collision detection - see
   * `DualBindPanel`'s identical prop for why it is the draft and not the last-saved snapshot. */
  draft: ConfigProfile
  /** Persists immediately (decision 16): slot assign/clear, a modifier capture (story 016 D9 - it
   * is an ordinary slot assignment carrying a modifier) and the ammo checkbox toggle are all
   * discrete clicks, same reasoning as `DualBindPanel`'s only save path. */
  onActionsChange: (nextActions: ConfigAction[]) => void
  /** Goes through the existing 500ms debounce (decision 16): the team-message field is typed
   * continuously, so this is `AdvancedTab`'s `scheduleActionsSave` passed straight through. */
  onMessageChange: (nextActions: ConfigAction[]) => void
  /** "Other actions" (decision 5) reuses `AdvancedTab`'s existing edit/remove handlers - see
   * `DualBindPanel`'s identical props for the full reasoning. */
  onEditLegacyAction: (actionId: string) => void
  onRemoveLegacyAction: (actionId: string) => void
}

interface LabeledRow {
  row: CatalogRow
  labelKey: string
}

function zip(rows: CatalogRow[], source: { labelKey: string }[]): LabeledRow[] {
  return rows.map((row, index) => ({ row, labelKey: source[index]!.labelKey }))
}

export function DropBindPanel({
  actions,
  draft,
  onActionsChange,
  onMessageChange,
  onEditLegacyAction,
  onRemoveLegacyAction,
}: DropBindPanelProps) {
  const { t } = useTranslation()

  const groups = useMemo(() => {
    const dropGroups = buildDropGroups()
    return {
      weapon: zip(dropGroups.weapon, DROPPABLES.filter((d) => d.kind === 'weapon')),
      ammo: zip(dropGroups.ammo, DROPPABLES.filter((d) => d.kind === 'ammo')),
      misc: zip(dropGroups.misc, DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech')),
    }
  }, [])

  // Decision 5: pre-existing free-form `drops` actions (no `catalogId`) stay reachable under
  // "Other actions" instead of turning invisible now that the category has its own editor.
  const legacyActions = actions.filter((action) => action.categoryId === 'drops' && !action.catalogId)

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <SectionLabel>{t('config.advanced.dropBind.weaponsGroup')}</SectionLabel>
        <ul className="space-y-2">
          {groups.weapon.map(({ row, labelKey }) => (
            <DropCatalogRow
              key={row.catalogId}
              row={row}
              label={t(labelKey)}
              actions={actions}
              draft={draft}
              onActionsChange={onActionsChange}
              onMessageChange={onMessageChange}
            />
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <SectionLabel>{t('config.advanced.dropBind.ammoGroup')}</SectionLabel>
        <ul className="space-y-2">
          {groups.ammo.map(({ row, labelKey }) => (
            <DropCatalogRow
              key={row.catalogId}
              row={row}
              label={t(labelKey)}
              actions={actions}
              draft={draft}
              onActionsChange={onActionsChange}
              onMessageChange={onMessageChange}
            />
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <SectionLabel>{t('config.advanced.dropBind.miscGroup')}</SectionLabel>
        <ul className="space-y-2">
          {groups.misc.map(({ row, labelKey }) => (
            <DropCatalogRow
              key={row.catalogId}
              row={row}
              label={t(labelKey)}
              actions={actions}
              draft={draft}
              onActionsChange={onActionsChange}
              onMessageChange={onMessageChange}
            />
          ))}
        </ul>
      </div>

      {legacyActions.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>{t('config.advanced.dualBind.otherActions')}</SectionLabel>
          <ul className="space-y-2">
            {legacyActions.map((action) => (
              <li
                key={action.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-line px-2.5 py-2"
              >
                <span className="min-w-0 truncate text-sm text-ink">{action.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={t('config.advanced.actions.edit')}
                    size="sm"
                    onClick={() => onEditLegacyAction(action.id)}
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.advanced.actions.remove')}
                    size="sm"
                    variant="danger"
                    onClick={() => onRemoveLegacyAction(action.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * One droppable's row: label, Primary/Secondary `BindSlot`s (mirrors
 * `DualBindPanel`'s `CatalogBindRow`), an optional "with ammo" checkbox
 * (decision 7/8 - rendered only when `row.ammoCommand` exists, never
 * disabled/placeholder otherwise) and a team-message `Input` on its own line
 * underneath. Two lines rather than one flex row: label + two slots +
 * checkbox already fills the width DualBindPanel's rows use, and a message
 * input needs room of its own to be usable (decision 15 - CSS/flex, no
 * `<table>`, still no arbitrary widths).
 *
 * Story 015 D7: the two slots' collision wiring mirrors `DualBindPanel`'s
 * `CatalogBindRow` exactly (see its comment for the `ignore`/`applyReplace`
 * reasoning). The ammo checkbox and the message field bind no key at all and
 * are therefore untouched by collision handling.
 *
 * Story 016 D9: there is no "layer-only row" here any more, and that is the
 * point. A modifier capture writes `keyModifier`/`secondaryKeyModifier` on this
 * row's own `ConfigAction` (`applySlot`), so a modifier-bound row and a
 * base-bound row are the same action with the same `commands` - which is why
 * the ammo checkbox and the message field below have no branch on where the key
 * lives: they always go through `applyAmmo`/`applyMessage`, exactly as they did
 * before this story. The layer override is derived from the saved action by main
 * (`applyActionLayerMirror` inside `setActions`) and therefore follows an
 * ammo/message edit automatically, with no second, debounced write into `layers`
 * to keep in step - the one that used to live here raced `draft.layers` (never
 * optimistically patched) and could not tell two rows apart whose commands
 * rendered the same text.
 */
function DropCatalogRow({
  row,
  label,
  actions,
  draft,
  onActionsChange,
  onMessageChange,
}: {
  row: CatalogRow
  label: string
  actions: ConfigAction[]
  draft: ConfigProfile
  onActionsChange: (nextActions: ConfigAction[]) => void
  onMessageChange: (nextActions: ConfigAction[]) => void
}) {
  const { t } = useTranslation()
  const action = actions.find((candidate) => candidate.catalogId === row.catalogId)
  const state = deriveRowState(action, row)

  // Story 016 D4/D9/D10: what a modifier capture on this row would overwrite, if
  // anything - see `DualBindPanel`'s identical closure for why this reads
  // `actions` directly and ignores this row's own action id.
  const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
    findModifierSlotCollision(actions, draft.layers ?? [], modifier, key, action?.id)

  // One path each, whatever this row's keys look like (story 016 D9): the ammo
  // choice and the team message are properties of the action's `commands`, and a
  // modifier changes nothing about them.
  const handleAmmoChange = (nextWithAmmo: boolean): void => {
    // A checkbox toggle is a single discrete click (decision 16), not a
    // keystroke burst - no debounce needed, unlike the message field below.
    onActionsChange(applyAmmo(actions, row, nextWithAmmo))
  }

  const handleMessageChange = (nextMessage: string): void => {
    onMessageChange(applyMessage(actions, row, nextMessage))
  }

  return (
    <li className="space-y-2 rounded-sm border border-line px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
        <div className="flex min-w-37.5 items-center gap-1.5">
          <span className="w-14 shrink-0 text-[10px] tracking-wide text-ink-muted uppercase">
            {t('config.advanced.dualBind.primary')}
          </span>
          <BindSlot
            label={t('config.advanced.dualBind.primary')}
            boundKey={state.primary}
            boundModifier={state.primaryModifier}
            onAssignModifier={({ modifier, key }) =>
              onActionsChange(
                applyModifierReplace({
                  actions,
                  collision: checkModifierCollision(modifier, key),
                  row,
                  slot: 'primary',
                  key,
                  modifier,
                }),
              )
            }
            checkModifierCollision={checkModifierCollision}
            checkCollision={(key) =>
              findSlotCollision(draft, key, action ? { actionId: action.id, slot: 'primary' } : undefined)
            }
            onAssign={(key) => onActionsChange(applySlot(actions, row, 'primary', key))}
            onReplace={(key, collision) =>
              onActionsChange(applyReplace({ actions, binds: draft.binds, collision, row, slot: 'primary', key }))
            }
            onClear={() => onActionsChange(applySlot(actions, row, 'primary', undefined))}
          />
        </div>
        <div className="flex min-w-37.5 items-center gap-1.5">
          <span className="w-14 shrink-0 text-[10px] tracking-wide text-ink-muted uppercase">
            {t('config.advanced.dualBind.secondary')}
          </span>
          <BindSlot
            label={t('config.advanced.dualBind.secondary')}
            boundKey={state.secondary}
            boundModifier={state.secondaryModifier}
            onAssignModifier={({ modifier, key }) =>
              onActionsChange(
                applyModifierReplace({
                  actions,
                  collision: checkModifierCollision(modifier, key),
                  row,
                  slot: 'secondary',
                  key,
                  modifier,
                }),
              )
            }
            checkModifierCollision={checkModifierCollision}
            checkCollision={(key) =>
              findSlotCollision(draft, key, action ? { actionId: action.id, slot: 'secondary' } : undefined)
            }
            onAssign={(key) => onActionsChange(applySlot(actions, row, 'secondary', key))}
            onReplace={(key, collision) =>
              onActionsChange(applyReplace({ actions, binds: draft.binds, collision, row, slot: 'secondary', key }))
            }
            onClear={() => onActionsChange(applySlot(actions, row, 'secondary', undefined))}
          />
        </div>
        {row.ammoCommand && (
          <Checkbox
            checked={state.withAmmo}
            onChange={handleAmmoChange}
            label={t('config.advanced.dropBind.withAmmo')}
          />
        )}
      </div>
      <Input
        value={state.message}
        placeholder={t('config.advanced.dropBind.messagePlaceholder')}
        aria-label={t('config.advanced.dropBind.messageLabel')}
        // Quotes are filtered as typed, not just at save time - Quake 2 has no in-quote escaping
        // (decision from story 008/`MessageEditor`), so a `"` cannot be represented at all and
        // letting one sit in the field would let the user hit a silent save-schema rejection.
        onChange={(event) => handleMessageChange(event.target.value.replace(/"/g, ''))}
      />
    </li>
  )
}
