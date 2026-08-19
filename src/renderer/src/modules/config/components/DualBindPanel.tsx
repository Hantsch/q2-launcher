import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Trash2 } from 'lucide-react'
import { MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import type { AltLayer } from '@shared/config/alt-layers'
import {
  findBindLocation,
  upsertModifierLayerOverride,
  type ModifierTrigger,
} from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { IconButton } from '../../../components/ui/Button'
import { SectionLabel } from '../../../components/ui/primitives'
import { applyReplace, findModifierSlotCollision, findSlotCollision } from '../lib/bind-slot-collision'
import {
  applySlot,
  buildMovementRows,
  buildRowCommandString,
  buildWeaponRows,
  deriveRowState,
  type CatalogRow,
} from '../lib/catalog-binds'
import { BindSlot } from './BindSlot'

/**
 * Story 015 D5: the Movement/Weapons dual-bind editor - one row per catalogue
 * action (D3's `buildMovementRows`/`buildWeaponRows`), each with a Primary and
 * a Secondary `BindSlot` (D4) instead of story 008's free-form name/commands
 * flow. `AdvancedTab` renders this in place of the generic action list for
 * exactly these two built-in categories (`drops` still uses the old path
 * until D6's `DropBindPanel`); custom, user-created categories never reach
 * this component at all.
 *
 * Row label resolution: `CatalogRow` (D3) deliberately carries no `labelKey`
 * of its own - it has to stay hook-free, and a label needs `useTranslation()`
 * (see that file's docstring). `buildMovementRows`/`buildWeaponRows` map
 * `MOVEMENT_ACTIONS`/`WEAPON_ACTIONS`/`WEAPON_EXTRA_ACTIONS` in the same
 * order they iterate them, so `zip` below pairs each row back with its source
 * catalogue entry by index rather than duplicating `labelKey` into D3's
 * already-reviewed row shape.
 */
export interface DualBindPanelProps {
  categoryId: 'movement' | 'weapons'
  /** The full draft actions array, not pre-filtered - `applySlot` needs to find/replace/prune
   * within the whole array, and legacy rows below are filtered out of this same array. */
  actions: ConfigAction[]
  /**
   * Story 015 D7: the whole in-progress draft profile, needed for collision detection - a capture
   * has to be checked against `binds` and `layers` too, not just `actions`. Deliberately named
   * `draft` rather than `profile`: `draft.binds`/`draft.layers` are always the freshest
   * server-confirmed values while `draft.actions` may run ahead of the server, which is exactly
   * the combination `findSlotCollision` needs. The last-saved snapshot would miss an assignment
   * made two clicks ago.
   */
  draft: ConfigProfile
  /** Persists immediately (decision 16) - the caller's `persistCategoriesAndActions`. */
  onActionsChange: (nextActions: ConfigAction[]) => void
  /**
   * Story 016 D3: persists the whole `layers` array in one `updateProfileLayers`
   * call (decision 8 - `setLayers` has replace-whole-array semantics, so two
   * round trips could clobber a layer created in between). Separate from
   * `onActionsChange` because a modifier capture writes *only* to `layers`: the
   * action, and therefore the base bind for that key, is left exactly as it was
   * (AC 4).
   */
  onLayersChange: (nextLayers: AltLayer[]) => void
  /**
   * "Other actions" (decision 5) reuse `AdvancedTab`'s existing edit/remove handlers - there is
   * no reason to reinvent them for the handful of legacy rows still living here. Rename is
   * deliberately not offered for this group (D5's acceptance text: "edit + remove only") - unlike
   * a custom category's action list, these rows have no create step either, so the row's `name`
   * is whatever a pre-015 free-form action already called it.
   */
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

export function DualBindPanel({
  categoryId,
  actions,
  draft,
  onActionsChange,
  onLayersChange,
  onEditLegacyAction,
  onRemoveLegacyAction,
}: DualBindPanelProps) {
  const { t } = useTranslation()

  const movementRows = useMemo(() => zip(buildMovementRows(), MOVEMENT_ACTIONS), [])
  const weaponGroups = useMemo(() => {
    const { useRows, extraRows } = buildWeaponRows()
    return { useRows: zip(useRows, WEAPON_ACTIONS), extraRows: zip(extraRows, WEAPON_EXTRA_ACTIONS) }
  }, [])

  // Decision 5: pre-existing free-form actions (no `catalogId`) in this category stay reachable
  // under "Other actions" instead of turning invisible now that the category has its own editor.
  const legacyActions = actions.filter((action) => action.categoryId === categoryId && !action.catalogId)

  return (
    <div className="space-y-5">
      {categoryId === 'movement' ? (
        <ul className="space-y-2">
          {movementRows.map(({ row, labelKey }) => (
            <CatalogBindRow
              key={row.catalogId}
              row={row}
              label={t(labelKey)}
              actions={actions}
              draft={draft}
              onActionsChange={onActionsChange}
              onLayersChange={onLayersChange}
            />
          ))}
        </ul>
      ) : (
        <>
          <div className="space-y-2">
            <SectionLabel>{t('config.advanced.dualBind.weaponsUseGroup')}</SectionLabel>
            <ul className="space-y-2">
              {weaponGroups.useRows.map(({ row, labelKey }) => (
                <CatalogBindRow
                  key={row.catalogId}
                  row={row}
                  label={t(labelKey)}
                  actions={actions}
                  draft={draft}
                  onActionsChange={onActionsChange}
                  onLayersChange={onLayersChange}
                />
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <SectionLabel>{t('config.advanced.dualBind.weaponsCycleGroup')}</SectionLabel>
            <ul className="space-y-2">
              {weaponGroups.extraRows.map(({ row, labelKey }) => (
                <CatalogBindRow
                  key={row.catalogId}
                  row={row}
                  label={t(labelKey)}
                  actions={actions}
                  draft={draft}
                  onActionsChange={onActionsChange}
                  onLayersChange={onLayersChange}
                />
              ))}
            </ul>
          </div>
        </>
      )}

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

/** One catalogue row: its label plus a Primary and a Secondary `BindSlot`. `min-w-[…]` per slot
 * column (decision 15) keeps both columns aligned across rows without a `<table>`.
 *
 * Story 015 D7: each slot's capture is checked against the draft before it is applied. `ignore`
 * names this row's own action+slot, so re-capturing a slot to the key it already holds is not
 * reported as colliding with itself; it is `undefined` while the row is still unmaterialised
 * (decision 3) - there is nothing to self-ignore then. `onReplace` goes through `applyReplace`,
 * which is the one place that releases the previous owner and applies the new key as a single
 * save - see its doc comment before changing this wiring. */
function CatalogBindRow({
  row,
  label,
  actions,
  draft,
  onActionsChange,
  onLayersChange,
}: {
  row: CatalogRow
  label: string
  actions: ConfigAction[]
  draft: ConfigProfile
  onActionsChange: (nextActions: ConfigAction[]) => void
  onLayersChange: (nextLayers: AltLayer[]) => void
}) {
  const { t } = useTranslation()
  const action = actions.find((candidate) => candidate.catalogId === row.catalogId)
  const state = deriveRowState(action, row)

  // Story 016 D3: the one command builder both paths share (decision 12) - the
  // string that would be written as a layer override is the same one the base
  // path renders into this row's alias body.
  const rowCommand = buildRowCommandString(row, state)
  const modifierLocation = rowCommand ? findBindLocation(draft, rowCommand) : null
  // Accepted display-only ambiguity: `rowCommand` does not depend on which slot
  // holds it, so `findBindLocation`'s single first match cannot tell which slot
  // owns a modifier assignment if a row somehow had one in each. The UI never
  // produces that - `handleAssignModifier` is the same function for both slots
  // and each call writes one override - so this is a labelling edge case, not a
  // write-path bug.
  const primaryModifierDisplay =
    !state.primary && modifierLocation?.modifier
      ? { modifier: modifierLocation.modifier, key: modifierLocation.key }
      : undefined
  const secondaryModifierDisplay =
    !state.secondary && !primaryModifierDisplay && modifierLocation?.modifier
      ? { modifier: modifierLocation.modifier, key: modifierLocation.key }
      : undefined

  const handleAssignModifier = ({
    modifier,
    key,
  }: {
    modifier: ModifierTrigger
    key: string
  }): void => {
    const result = upsertModifierLayerOverride({
      layers: draft.layers ?? [],
      modifier,
      key,
      command: rowCommand,
      newId: crypto.randomUUID(),
    })
    onLayersChange(result.layers)
  }

  // Story 016 D4: what a modifier capture on this row would overwrite, if
  // anything. `rowCommand` is this row's own current command, so re-capturing
  // the same combo for the same row is never reported as a collision.
  const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
    findModifierSlotCollision(draft.layers ?? [], modifier, key, rowCommand)

  return (
    <li className="flex items-center gap-3 rounded-sm border border-line px-2.5 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
      <div className="flex min-w-37.5 items-center gap-1.5">
        <span className="w-14 shrink-0 text-[10px] tracking-wide text-ink-muted uppercase">
          {t('config.advanced.dualBind.primary')}
        </span>
        <BindSlot
          label={t('config.advanced.dualBind.primary')}
          boundKey={state.primary}
          modifierDisplay={primaryModifierDisplay}
          onAssignModifier={handleAssignModifier}
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
          modifierDisplay={secondaryModifierDisplay}
          onAssignModifier={handleAssignModifier}
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
    </li>
  )
}
