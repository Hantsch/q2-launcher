import { MoreVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../../../components/ui/Button'
import { Menu, type MenuItem } from '../../../components/ui/Menu'

/**
 * the category rail's per-chip kebab, a 1:1 mirror of `ControlsRowMenu.tsx`
 *  - same trigger/portal/positioning `Menu.tsx`, same `IconButton`
 * anchor, applied to the category chip instead of a row. Carries all four actions
 * (move up, move down, rename, delete) so the chip stays
 * a single label plus grip plus one trigger.
 *
 * Move up/down stay in the menu rather than dropping out entirely - drag-and-drop
 *  is the pointer mechanism now, but a keyboard user still needs an equivalent
 * exactly as the row menu keeps "Move to…" next to the drag-based row
 * reorder.
 */
export function ControlsCategoryMenu({
  categoryName,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRename,
  onDelete,
  className,
}: {
  categoryName: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: () => void
  onDelete: () => void
  /** on the trigger itself, so the chip's reveal rule (`.ctrl-chip-kebab` in
   * `controls-grid.css`) can key off the trigger's own `aria-expanded` - the menu portals out of
   * the chip, so the chip's `:focus-within` goes false the moment the menu opens. */
  className?: string
}) {
  const { t } = useTranslation()
  const label = t('config.controls.categoryMenuFor', { name: categoryName })

  const items: MenuItem[] = [
    {
      id: 'up',
      label: t('config.controls.categoryMoveUp'),
      disabled: !canMoveUp,
      onSelect: onMoveUp,
    },
    {
      id: 'down',
      label: t('config.controls.categoryMoveDown'),
      disabled: !canMoveDown,
      onSelect: onMoveDown,
    },
    {
      id: 'rename',
      label: t('common.action.renameEllipsis'),
      onSelect: onRename,
    },
    {
      id: 'delete',
      label: t('common.action.deleteEllipsis'),
      onSelect: onDelete,
    },
  ]

  return (
    <Menu items={items} label={label}>
      {({ open, toggle }) => (
        <IconButton
          label={label}
          size="sm"
          className={className}
          aria-expanded={open}
          onClick={toggle}
        >
          <MoreVertical className="size-3.5" />
        </IconButton>
      )}
    </Menu>
  )
}
