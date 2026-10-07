import { memo, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Pencil, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import { isDropCatalogRow } from '@shared/config/catalog/catalog-rows'
import { dropStateFor, isDropEntry } from '@shared/config/aliases/drop-entries'
import type { ModifierTrigger } from '@shared/config/aliases/modifier-layers'
import type { ActionKeySlot, ConfigAction, ConfigProfile } from '@shared/modules/config'
import { Button, IconButton } from '../../../components/ui/Button'
import { findSlotConflictOwner, type indexBindConflicts } from '../lib/bind-conflicts'
import {
  applyModifierReplace,
  applyReplace,
  findModifierSlotCollision,
  findSlotCollision,
  layerNameForModifier,
} from '../lib/bind-slot-collision'
import {
  applyEntryKindBindable,
  applySlot,
  rawKeyIndex,
  withCatalogBody,
  type CatalogRow,
} from '../lib/catalog-binds'
import { rawCommandText, type ControlsRowEntry } from '../lib/controls-row-entries'
import type { ControlsRows } from '../lib/useControlsRows'
import { BindSlot, BindSlotPlaceholder } from './BindSlot'
import { ControlsOptionsCell } from './ControlsOptionsCell'
import { ControlsRow } from './ControlsRow'
import { ControlsRowMenu } from './ControlsRowMenu'
import { DropToggles } from './DropToggles'

export interface MessageEditorTarget {
  /** Absent for a drop entry outside the catalogue: there is no catalogue body to fill in. */
  row?: CatalogRow
  actionId: string
  label: string
}

/**
 * Everything a Controls row reads from the tab, built once per relevant change so a memoised row
 * re-renders only when something it shows actually changed. Every callback must keep its identity
 * across renders for that to hold.
 */
export interface ControlsEntryRowContext {
  draft: ConfigProfile
  conflictIndex: ReturnType<typeof indexBindConflicts>
  /** Catalogue entries' derived state; the only source of a catalogue row's keys. */
  rowState: ControlsRows['rowState']
  moveTargets: ControlsRows['moveTargets']
  editedActionIds: ReadonlySet<string>
  revealedMessageRows: ReadonlySet<string>
  expandedKeyRows: ReadonlySet<string>
  unavailableReasonKey: (row: CatalogRow) => string | undefined
  onActionsChange: (nextActions: ConfigAction[]) => void
  onReset: (actionId: string) => void
  onToggleExpanded: (actionId: string) => void
  onToggleDropAmmo: (action: ConfigAction, next: boolean, row?: CatalogRow) => void
  onToggleDropMessage: (action: ConfigAction, next: boolean) => void
  onEditMessage: (target: MessageEditorTarget) => void
  onMove: (actionId: string, targetId: string) => void
  onMoveTo: (target: { actionId: string; label: string }) => void
  onEdit: (actionId: string) => void
  onRename: (action: ConfigAction) => void
  onRemove: (actionId: string) => void
  setRowElement: (actionId: string, el: HTMLDivElement | null) => void
}

export interface ControlsEntryRowProps {
  entry: ControlsRowEntry
  odd: boolean
  grip: ReactNode
  ctx: ControlsEntryRowContext
}

const NO_ACTIONS: ConfigAction[] = []
const NO_LAYERS: NonNullable<ConfigProfile['layers']> = []
const NO_KEYS: readonly ActionKeySlot[] = []

/**
 * One Controls grid row, catalogue-backed or free-form. The two kinds differ only in data: where
 * the keys come from, the label/command text, whether an assignment first gives a body-less entry
 * the catalogue's commands, and which affordances the Options cell carries.
 */
function ControlsEntryRowImpl({ entry, odd, grip, ctx }: ControlsEntryRowProps) {
  const { t } = useTranslation()
  const { setRowElement } = ctx
  const { action } = entry
  const rowRef = useCallback(
    (el: HTMLDivElement | null) => setRowElement(action.id, el),
    [setRowElement, action.id],
  )

  const row = entry.kind === 'catalog' ? entry.row : undefined
  const label = entry.kind === 'catalog' ? t(entry.labelKey) : action.name
  const actions = ctx.draft.actions ?? NO_ACTIONS
  const layers = ctx.draft.layers ?? NO_LAYERS
  // Both sources hold compacted slots (an empty key is no slot), which is the index every write
  // below takes - so a rendered slot and the slot a write lands on can never disagree.
  const keys: readonly ActionKeySlot[] = row
    ? (ctx.rowState.get(action.id)?.keys ?? NO_KEYS)
    : actionKeySlots(action).filter((slot) => slot.key)
  const unavailableKey = row ? ctx.unavailableReasonKey(row) : undefined
  const unavailable = unavailableKey !== undefined
  // An alias entry must not be bindable through the UI at all, so it gets inert placeholder cells.
  const inert = entry.kind === 'action' && action.kind === 'alias'
  // A template drop row is seeded without commands, so `isDropEntry` alone cannot see it yet.
  const isDrop = isDropEntry(action) || (row !== undefined && isDropCatalogRow(row))
  const dropState = dropStateFor(action)
  const message = isDrop ? (dropState.message ?? '') : ''
  const messageOn = message.trim().length > 0 || ctx.revealedMessageRows.has(action.id)
  // Catalogue-mirror entry ids are minted fresh on every seed; `catalogId` is the stable handle.
  const testIdBase = row?.catalogId ?? action.id

  /** An assigning write first gives a body-less catalogue entry its catalogue commands, so the key
   * has something to run; a clear has nothing to make real and starts from `actions` as-is. */
  const assignBase = (): ConfigAction[] =>
    row ? withCatalogBody(actions, action.id, row) : actions
  const clearSlot = (slotIndex: number): void =>
    ctx.onActionsChange(applySlot(actions, action.id, slotIndex, undefined))

  const renderSlot = (slotIndex: number, compactAdd = false) => {
    const slot = keys[slotIndex]
    const boundKey = slot?.key || undefined
    const boundModifier = boundKey ? slot?.modifier : undefined
    const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
      findModifierSlotCollision(actions, layers, modifier, key, action.id)
    return (
      <BindSlot
        label={
          slotIndex === 0
            ? t('config.controls.dualBind.primaryKey')
            : t('config.controls.dualBind.keyN', { n: slotIndex + 1 })
        }
        compactAdd={compactAdd}
        boundKey={boundKey}
        boundModifier={boundModifier}
        isPrimary={slotIndex === 0}
        isConflicted={Boolean(
          findSlotConflictOwner(ctx.conflictIndex, layers, boundKey, boundModifier, action.name),
        )}
        disabled={unavailable}
        checkModifierCollision={checkModifierCollision}
        checkCollision={(key) =>
          findSlotCollision(ctx.draft, key, {
            actionId: action.id,
            slot: rawKeyIndex(action, slotIndex),
          })
        }
        onAssign={(key) => ctx.onActionsChange(applySlot(assignBase(), action.id, slotIndex, key))}
        onAssignModifier={({ modifier, key }) =>
          ctx.onActionsChange(
            applyModifierReplace({
              actions: assignBase(),
              collision: checkModifierCollision(modifier, key),
              actionId: action.id,
              slotIndex,
              key,
              modifier,
            }),
          )
        }
        onReplace={(key, collision) =>
          ctx.onActionsChange(
            applyReplace({
              actions: assignBase(),
              binds: ctx.draft.binds,
              collision,
              actionId: action.id,
              slotIndex,
              key,
            }),
          )
        }
        onClear={() => clearSlot(slotIndex)}
      />
    )
  }

  // Two bindings stay inline; three or more fold behind a disclosure, open per row.
  const hasMany = keys.length >= 3
  const expanded = ctx.expandedKeyRows.has(action.id)
  const foldedOpen = hasMany && expanded
  const toggleLabel = t(
    foldedOpen ? 'config.controls.grid.keyMoreHide' : 'config.controls.grid.keyMoreShow',
    { count: keys.length - 1, name: label },
  )
  const keyCell = inert ? (
    <BindSlotPlaceholder />
  ) : (
    <>
      {renderSlot(0)}
      {keys.length === 2 && renderSlot(1)}
      {hasMany && (
        <button
          type="button"
          className="ctrl-keymore"
          aria-expanded={foldedOpen}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => ctx.onToggleExpanded(action.id)}
        >
          <span>{'+' + (keys.length - 1)}</span>
          <ChevronDown aria-hidden className="ctrl-keymore-chevron size-3" />
        </button>
      )}
      {!foldedOpen && keys.length >= 1 && renderSlot(keys.length, keys.length >= 2)}
    </>
  )

  // `BindSlot` has no visible clear control, so each unfolded extra key gets its own; the add
  // slot moves to the last sub-row while the group is open.
  let extraKeyRows: ReactNode
  if (!inert && foldedOpen) {
    const rows: ReactNode[] = []
    for (let slotIndex = 1; slotIndex < keys.length; slotIndex += 1) {
      rows.push(
        <div
          key={`key-${slotIndex}`}
          className="ctrl-keysub-row"
          data-row-id={action.id}
          role="row"
        >
          <div className="ctrl-keysub" role="cell">
            {renderSlot(slotIndex)}
            <IconButton
              label={t('config.controls.actions.clearKey', { name: label, n: slotIndex + 1 })}
              size="sm"
              disabled={unavailable}
              onClick={() => clearSlot(slotIndex)}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
        </div>,
      )
    }
    rows.push(
      <div key="key-add" className="ctrl-keysub-row" data-row-id={action.id} role="row">
        <div className="ctrl-keysub" role="cell">
          {renderSlot(keys.length)}
        </div>
      </div>,
    )
    extraKeyRows = <>{rows}</>
  }

  // The first modifier and the first conflict in slot order win: one modifier per row is the
  // common case, and the cell has room for one name.
  const modifier = keys.find((slot) => slot.modifier !== undefined)?.modifier
  const conflictOwner = keys
    .map((slot) =>
      findSlotConflictOwner(ctx.conflictIndex, layers, slot.key, slot.modifier, action.name),
    )
    .find((owner) => owner !== undefined)
  // A body-less catalogue drop row has nothing for `dropStateFor` to read; its ammo toggle follows
  // the catalogue row, which is also what it has always shown before a key was assigned.
  const ammoFromRow = row !== undefined && action.commands.length === 0
  const rowAmmo = Boolean(row?.ammoCommand)
  const target = ctx.moveTargets.get(action.id)

  return (
    <ControlsRow
      name={label}
      // A catalogue row shows the catalogue's command text, so a seeded body-less entry still says
      // what it will run once bound.
      command={row ? row.commands.join(', ') : rawCommandText(action)}
      resetLabel={t('config.controls.actions.reset', { name: label })}
      onReset={() => ctx.onReset(action.id)}
      odd={odd}
      edited={ctx.editedActionIds.has(action.id)}
      keyCell={keyCell}
      extraKeyRows={extraKeyRows}
      rowId={action.id}
      grip={grip}
      unavailable={unavailable}
      optionsCell={
        // No `flex-wrap`: the Options track fits its icon buttons only at 2px gaps, and wrapping
        // would spill them outside the 40px row. The text part yields first (`min-w-0`).
        <div className="flex w-full items-center justify-end gap-0.5">
          {(!inert || isDrop) && (
            <div className="min-w-0 overflow-hidden">
              <ControlsOptionsCell
                layer={modifier ? layerNameForModifier(layers, modifier) : undefined}
                conflict={conflictOwner ? { owner: conflictOwner } : null}
                extra={
                  isDrop ? (
                    <DropToggles
                      ammoEnabled={ammoFromRow ? rowAmmo : dropState.canToggleAmmo}
                      ammoOn={ammoFromRow ? rowAmmo : dropState.hasAmmo}
                      messageOn={messageOn}
                      onToggleAmmo={(next) => ctx.onToggleDropAmmo(action, next, row)}
                      onToggleMessage={(next) => ctx.onToggleDropMessage(action, next)}
                      ammoTestId={`drop-ammo-${testIdBase}`}
                      messageTestId={`drop-message-${testIdBase}`}
                    />
                  ) : undefined
                }
                // Platform/engine parity: an unavailable row states why as visible text.
                unavailableReason={unavailableKey ? t(unavailableKey) : undefined}
              />
            </div>
          )}
          <ControlsRowMenu
            entryName={label}
            moveTarget={target}
            onMoveUp={() => {
              if (target?.up) ctx.onMove(action.id, target.up)
            }}
            onMoveDown={() => {
              if (target?.down) ctx.onMove(action.id, target.down)
            }}
            onMoveTo={() => ctx.onMoveTo({ actionId: action.id, label })}
            onMakeBindable={
              action.kind === 'alias'
                ? () => ctx.onActionsChange(applyEntryKindBindable(actions, action.id))
                : undefined
            }
          />
          {entry.kind === 'action' && (
            <>
              <IconButton
                label={t('config.controls.actions.edit')}
                size="sm"
                data-testid={`action-edit-${action.id}`}
                onClick={() => ctx.onEdit(action.id)}
              >
                <SlidersHorizontal className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('common.action.renameEllipsis')}
                size="sm"
                onClick={() => ctx.onRename(action)}
              >
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('common.action.removeEllipsis')}
                size="sm"
                variant="danger"
                onClick={() => ctx.onRemove(action.id)}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </>
          )}
        </div>
      }
      subRow={
        isDrop && messageOn ? (
          // `contents` keeps this wrapper out of the message row's flex layout while still giving
          // flows one selector for the whole row.
          <span className="contents" data-testid={`drop-message-row-${testIdBase}`}>
            <span
              className={
                message
                  ? 'min-w-0 truncate text-xs text-ink'
                  : 'min-w-0 truncate text-xs text-ink-faint'
              }
              title={message || undefined}
            >
              {message || t('config.controls.dropBind.messagePlaceholder')}
            </span>
            <Button
              size="sm"
              data-testid={`drop-message-edit-${testIdBase}`}
              aria-label={t('config.controls.dropBind.editMessageFor', { name: label })}
              onClick={() => ctx.onEditMessage({ row, actionId: action.id, label })}
            >
              {t('config.controls.dropBind.editMessage')}
            </Button>
          </span>
        ) : undefined
      }
      rowRef={rowRef}
    />
  )
}

export const ControlsEntryRow = memo(ControlsEntryRowImpl)
