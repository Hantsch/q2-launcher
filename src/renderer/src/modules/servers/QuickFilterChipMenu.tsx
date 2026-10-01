import { MoreVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { QuickFilter } from '@shared/servers/quick-filters'
import { IconButton } from '../../components/ui/Button'
import { Menu, type MenuItem } from '../../components/ui/Menu'

/**
 * Story 197 D4: the per-chip kebab of a saved quick filter, a mirror of the Controls category
 * rail's `ControlsCategoryMenu`. *Rename* opens the name dialog in rename mode; *Delete* removes
 * the entry only - it never touches the current filter (the caller wires `onDelete` to the
 * persistence call, not to the filter state).
 */
export function QuickFilterChipMenu({
  quickFilter,
  onRename,
  onDelete,
}: {
  quickFilter: QuickFilter
  onRename: (quickFilter: QuickFilter) => void
  onDelete: (quickFilter: QuickFilter) => void
}) {
  const { t } = useTranslation()
  const label = t('servers.quickFilter.menuFor', { name: quickFilter.name })

  const items: MenuItem[] = [
    {
      id: 'rename',
      label: t('servers.quickFilter.rename'),
      onSelect: () => onRename(quickFilter),
    },
    {
      id: 'delete',
      label: t('servers.quickFilter.delete'),
      onSelect: () => onDelete(quickFilter),
    },
  ]

  return (
    <Menu items={items} label={label}>
      {({ open, toggle }) => (
        <IconButton
          label={label}
          size="sm"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={toggle}
          data-testid="servers-quickfilter-menu"
        >
          <MoreVertical className="size-3.5" />
        </IconButton>
      )}
    </Menu>
  )
}
