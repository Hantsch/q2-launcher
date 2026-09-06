import { MoreVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../../../components/ui/Button'
import { Menu, type MenuItem } from '../../../components/ui/Menu'
import type { EntryMoveTarget } from '../lib/entry-order'

/**
 * Story 054 D8: the row menu that takes over move up/down (and adds "Move to…") from the inline
 * arrow buttons every Controls row used to carry (`renderMoveButtons`, story 052 D8). A kebab in
 * the row's action cluster, built on the existing `components/ui/Menu.tsx` - the same trigger/
 * portal/positioning `InstallationRail`'s "add" menu already uses, just with an `IconButton` as the
 * anchor instead of a plain styled button.
 *
 * Kept to exactly the three ordering commands the story's own decision names ("The row menu is new
 * and holds only ordering commands") - edit/rename/remove stay the icon buttons they are today,
 * right next to this one.
 */
export function ControlsRowMenu({
  entryName,
  moveTarget,
  onMoveUp,
  onMoveDown,
  onMoveTo,
}: {
  entryName: string
  moveTarget: EntryMoveTarget | undefined
  onMoveUp: () => void
  onMoveDown: () => void
  onMoveTo: () => void
}) {
  const { t } = useTranslation()
  const label = t('config.controls.actions.moveMenuFor', { name: entryName })

  const items: MenuItem[] = [
    {
      id: 'up',
      label: t('config.controls.actions.moveUp'),
      disabled: !moveTarget?.up,
      onSelect: onMoveUp,
    },
    {
      id: 'down',
      label: t('config.controls.actions.moveDown'),
      disabled: !moveTarget?.down,
      onSelect: onMoveDown,
    },
    {
      id: 'to',
      label: t('config.controls.actions.moveTo'),
      onSelect: onMoveTo,
    },
  ]

  return (
    <Menu items={items} label={label}>
      {({ open, toggle }) => (
        <IconButton label={label} size="sm" aria-expanded={open} onClick={toggle}>
          <MoreVertical className="size-3.5" />
        </IconButton>
      )}
    </Menu>
  )
}
