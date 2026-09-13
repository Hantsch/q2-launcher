import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../ui/Button'

export interface DragHandleProps {
  /** Spread from `SortableItemRenderState.attributes`/`.listeners` - the props dnd-kit needs on
   * whichever element should start a drag. */
  attributes?: DraggableAttributes
  listeners?: DraggableSyntheticListeners
  /** Story 054 decision: dragging is turned off while the Controls filter narrows the list. The
   * grip stays visible, focusable and hoverable (mirrors `DropToggles.tsx`'s `aria-disabled`
   * idiom) so the explaining tooltip actually reaches both a mouse and a keyboard user, instead of
   * a natively `disabled` button that would take itself out of the tab order and lose its title on
   * hover. */
  disabled?: boolean
  /** Required when `disabled` - why dragging is off right now. */
  disabledReason?: string
  className?: string
}

/**
 * An icon-button-sized grip (mirrors `IconButton`'s sizing/tooltip idiom in
 * `components/ui/Button.tsx`) that hands its `attributes`/`listeners` straight to dnd-kit's
 * pointer/keyboard sensors - the grip itself never touches `DndContext`.
 */
export function DragHandle({
  attributes,
  listeners,
  disabled = false,
  disabledReason,
  className,
}: DragHandleProps) {
  const { t } = useTranslation()
  const label = t('dnd.dragHandle.label')

  return (
    <IconButton
      label={label}
      title={disabled ? disabledReason : label}
      variant="ghost"
      size="sm"
      aria-disabled={disabled || undefined}
      className={disabled ? `cursor-not-allowed opacity-45 ${className ?? ''}` : className}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
    </IconButton>
  )
}
