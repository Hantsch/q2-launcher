import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Trash2 } from 'lucide-react'
import { DROPPABLES } from '@shared/config/action-catalog'
import type { AltLayer } from '@shared/config/alt-layers'
import { upsertModifierLayerOverride, type ModifierTrigger } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { IconButton } from '../../../components/ui/Button'
import { Checkbox, Input } from '../../../components/ui/controls'
import { SectionLabel } from '../../../components/ui/primitives'
import { applyReplace, findModifierSlotCollision, findSlotCollision } from '../lib/bind-slot-collision'
import {
  applyAmmo,
  applyMessage,
  applySlot,
  buildDropGroups,
  buildRowCommandString,
  deriveRowState,
  findRowLayerOverride,
  type CatalogRow,
} from '../lib/catalog-binds'
import { BindSlot } from './BindSlot'

/** Mirrors `AdvancedTab`'s `SAVE_DEBOUNCE_MS` (decision 16: the message field is typed
 * continuously, so its own layer-sync write is debounced too, not just its `ConfigAction` save). */
const LAYER_SYNC_DEBOUNCE_MS = 500

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
  /** Persists immediately (decision 16): slot assign/clear and the ammo checkbox toggle are
   * discrete clicks, same reasoning as `DualBindPanel`'s only save path. */
  onActionsChange: (nextActions: ConfigAction[]) => void
  /**
   * Story 016 D3: persists the whole `layers` array in one `updateProfileLayers`
   * call - see `DualBindPanel`'s identical prop for the replace-whole-array
   * reasoning (decision 8) and why a modifier capture never touches `actions`.
   */
  onLayersChange: (nextLayers: AltLayer[]) => void
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
  onLayersChange,
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
              onLayersChange={onLayersChange}
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
              onLayersChange={onLayersChange}
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
              onLayersChange={onLayersChange}
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
 * Review-fix (AC 5): a row whose only binding is a modifier capture has no
 * `ConfigAction` at all - `deriveRowState(undefined, row)` can only ever
 * report its "nothing bound yet" default, which has nothing to do with
 * whatever ammo/message state is actually sitting inside the layer override.
 * `findRowLayerOverride` (`catalog-binds.ts`) is the first-class read for that
 * case: a structural reverse-parse of the override's own stored command, not
 * a value comparison against something computed from possibly-stale local
 * state. `rowLayerOverride` is looked up fresh on every render and used two
 * ways below: to derive `state` when there is no `ConfigAction` to read, and
 * to know exactly *which* `(modifier, key)` to overwrite when ammo/message
 * changes - a direct, identity-based write (`upsertModifierLayerOverride`),
 * never a "find whatever still holds the old string" search. That distinction
 * is what fixes the two failure modes a value-based sync had: a layer-only row
 * where toggling ammo was either a silent no-op (a lazily created,
 * key-less `ConfigAction` gets pruned as empty, decision 4) or, once a message
 * existed, permanently desynced the moment two edits raced one IPC round trip
 * (`draft.layers` is never optimistically patched, so an old-command lookup
 * computed from post-edit local state could stop matching what is still on
 * disk mid-typing and silently stop writing at all).
 */
function DropCatalogRow({
  row,
  label,
  actions,
  draft,
  onActionsChange,
  onLayersChange,
  onMessageChange,
}: {
  row: CatalogRow
  label: string
  actions: ConfigAction[]
  draft: ConfigProfile
  onActionsChange: (nextActions: ConfigAction[]) => void
  onLayersChange: (nextLayers: AltLayer[]) => void
  onMessageChange: (nextActions: ConfigAction[]) => void
}) {
  const { t } = useTranslation()
  const action = actions.find((candidate) => candidate.catalogId === row.catalogId)
  // Review-fix (AC 5): a fresh structural scan every render, not a cached/diffed value - see the
  // file doc comment above for why that distinction is the actual fix.
  const rowLayerOverride = findRowLayerOverride(draft, row)
  const state = action
    ? deriveRowState(action, row)
    : rowLayerOverride
      ? { primary: undefined, secondary: undefined, withAmmo: rowLayerOverride.withAmmo, message: rowLayerOverride.message }
      : deriveRowState(undefined, row)

  // Story 016 D3: mirrors `DualBindPanel`'s `CatalogBindRow` exactly (see its
  // comments for the shared-builder and display-ambiguity reasoning). For a
  // drop row this is where AC 5 bites: `rowCommand` already carries the ammo
  // choice and the team message, so the layer override stores the identical
  // string the base path would render.
  const rowCommand = buildRowCommandString(row, state)
  const primaryModifierDisplay =
    !state.primary && rowLayerOverride
      ? { modifier: rowLayerOverride.modifier, key: rowLayerOverride.key }
      : undefined
  const secondaryModifierDisplay =
    !state.secondary && !primaryModifierDisplay && rowLayerOverride
      ? { modifier: rowLayerOverride.modifier, key: rowLayerOverride.key }
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
  // anything - see `DualBindPanel`'s identical closure.
  const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
    findModifierSlotCollision(draft.layers ?? [], modifier, key, rowCommand)

  // Review-fix (AC 5): overwrite the *known* override this row already owns
  // (`rowLayerOverride`'s own `(modifier, key)`) with a freshly computed
  // command - never a value-based "find whatever still says the old string"
  // rewrite, which is what raced stale `draft.layers` reads in the first place.
  const writeLayerOverride = (command: string): void => {
    if (!rowLayerOverride) return
    const result = upsertModifierLayerOverride({
      layers: draft.layers ?? [],
      modifier: rowLayerOverride.modifier,
      key: rowLayerOverride.key,
      command,
      newId: crypto.randomUUID(), // unused: `rowLayerOverride` existing means the layer already does too.
    })
    onLayersChange(result.layers)
  }

  // Debounced twin of `writeLayerOverride` for the message field (decision 16
  // - the same reasoning `scheduleActionsSave` uses for `onMessageChange`).
  // The timeout's closure captures whichever render scheduled it *last*
  // (`clearTimeout` cancels every earlier one), so only one write survives a
  // fast typing burst - no per-keystroke `updateProfileLayers` call, and no
  // window where an old-value comparison can fall behind and get stuck.
  const layerSyncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (layerSyncTimeout.current) clearTimeout(layerSyncTimeout.current)
    },
    [],
  )
  const scheduleLayerOverrideWrite = (command: string): void => {
    if (layerSyncTimeout.current) clearTimeout(layerSyncTimeout.current)
    layerSyncTimeout.current = setTimeout(() => {
      layerSyncTimeout.current = null
      writeLayerOverride(command)
    }, LAYER_SYNC_DEBOUNCE_MS)
  }

  const handleAmmoChange = (nextWithAmmo: boolean): void => {
    // A checkbox toggle is a single discrete click (decision 16), not a
    // keystroke burst - no debounce needed, unlike the message field below.
    const newCommand = buildRowCommandString(row, { ...state, withAmmo: nextWithAmmo })
    if (rowLayerOverride && !action) {
      // Purely layer-bound: the override *is* this row's only representation.
      // Routing this through `applyAmmo` would lazily create a key-less
      // `ConfigAction` that decision 4 immediately prunes as empty - a silent
      // no-op, and the bug this fix exists for.
      writeLayerOverride(newCommand)
      return
    }
    onActionsChange(applyAmmo(actions, row, nextWithAmmo))
    // A `ConfigAction` also exists (normal case, or a stray override left
    // over from before one was materialized) - keep both in sync.
    if (rowLayerOverride) writeLayerOverride(newCommand)
  }

  const handleMessageChange = (nextMessage: string): void => {
    const newCommand = buildRowCommandString(row, { ...state, message: nextMessage })
    if (rowLayerOverride && !action) {
      scheduleLayerOverrideWrite(newCommand)
      return
    }
    onMessageChange(applyMessage(actions, row, nextMessage))
    if (rowLayerOverride) scheduleLayerOverrideWrite(newCommand)
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
