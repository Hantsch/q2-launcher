import { useEffect, useRef, type RefObject } from 'react'
import type { ServerListRow } from '@shared/modules/servers'

export interface RowNavigation {
  tableRef: RefObject<HTMLDivElement | null>
  navigate: (address: string, step: 1 | -1) => void
}

/**
 * Keyboard navigation and selection upkeep for the visible server rows. Arrow keys stop at the
 * first and last row and focus follows the selection, so the next key press lands on the new row.
 * A selection the filter hides is dropped - it would keep driving "Refresh this server" against an
 * address the user can no longer see or pick again.
 */
export function useRowNavigation(
  visible: ServerListRow[],
  selectedAddress: string | null,
  select: (address: string | null) => void,
): RowNavigation {
  const tableRef = useRef<HTMLDivElement>(null)
  const focusSelectedRef = useRef(false)
  const focusSelectedRow = (): void => {
    const rowElement = tableRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    rowElement?.focus()
    // jsdom has no scrollIntoView.
    rowElement?.scrollIntoView?.({ block: 'nearest' })
  }

  const navigate = (address: string, step: 1 | -1): void => {
    const index = visible.findIndex((row) => row.address === address)
    if (index < 0) return
    const target = visible[Math.min(Math.max(index + step, 0), visible.length - 1)]
    if (target.address === selectedAddress) {
      focusSelectedRow()
      return
    }
    focusSelectedRef.current = true
    select(target.address)
  }

  useEffect(() => {
    if (!focusSelectedRef.current) return
    focusSelectedRef.current = false
    focusSelectedRow()
  }, [selectedAddress])

  useEffect(() => {
    if (selectedAddress !== null && !visible.some((row) => row.address === selectedAddress)) {
      select(null)
    }
  }, [selectedAddress, visible, select])

  return { tableRef, navigate }
}
