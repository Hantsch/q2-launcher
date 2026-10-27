import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ServerListRow } from '@shared/modules/servers'
import { parseServerAddress, serverAddressRejectionKey } from '@shared/servers/address'
import type { LocalizedMessage } from '@shared/types'
import { usePrimaryActionContribution, type ContributedAction } from '../../lib/primary-action'
import { useModuleQuery } from '../../lib/useModuleQuery'
import { useActiveInstallation } from '../../store/useLauncher'
import { getScanSettings } from './client'
import { useJoinFlow } from './join/useJoinFlow'

/** Why a row cannot be joined right now, or `undefined` when it can. */
function joinBlockedReason(
  row: ServerListRow,
  hasInstallation: boolean,
): LocalizedMessage | undefined {
  const parsed = parseServerAddress(row.address)
  if (!parsed.ok) return { key: serverAddressRejectionKey(parsed.reason) }
  return hasInstallation ? undefined : { key: 'servers.join.noInstallation' }
}

export interface ServerJoin {
  dialogs: ReactNode
  /** Whether a row's double-click joins (the saved setting). */
  doubleClickJoins: boolean
  /** Joins the server at `address` if it is known and joinable; the one guard for every row join. */
  joinAddress: (address: string) => void
}

/**
 * The join half of the Servers view: the shared join flow, the guard every join from the list goes
 * through, and the action bar's primary "Join", which targets `targetAddress` (the list selection,
 * or on the watchlist tab the server open in its detail pane).
 */
export function useServerJoin(
  resolveServer: (address: string) => ServerListRow | undefined,
  targetAddress: string | null,
): ServerJoin {
  // `start` is read through a ref: the flow's closure changes every render, and a new contribution
  // identity would republish every time.
  const joinFlow = useJoinFlow()
  const startJoinRef = useRef(joinFlow.start)
  useLayoutEffect(() => {
    startJoinRef.current = joinFlow.start
  })
  const hasInstallation = useActiveInstallation() !== null
  // Not yet loaded counts as on: the default, so a fresh mount never swallows an early double-click.
  const scanSettings = useModuleQuery(getScanSettings)
  const doubleClickJoins = scanSettings.data?.doubleClickJoins ?? true
  const targetRow = targetAddress === null ? undefined : resolveServer(targetAddress)

  const joinIfAllowed = (row: ServerListRow): void => {
    if (joinBlockedReason(row, hasInstallation) === undefined) startJoinRef.current(row)
  }
  const joinIfAllowedRef = useRef(joinIfAllowed)
  useLayoutEffect(() => {
    joinIfAllowedRef.current = joinIfAllowed
  })
  const joinAction = useMemo<ContributedAction>(() => {
    const reason =
      targetRow === undefined ? undefined : joinBlockedReason(targetRow, hasInstallation)
    return {
      id: 'join-server',
      labelKey: 'common.action.join',
      disabled: targetRow === undefined || reason !== undefined,
      ...(reason ? { reason } : {}),
      run: () => {
        if (targetRow) joinIfAllowedRef.current(targetRow)
      },
    }
  }, [targetRow, hasInstallation])
  usePrimaryActionContribution('/servers', joinAction)

  return {
    dialogs: joinFlow.dialogs,
    doubleClickJoins,
    joinAddress: (address) => {
      const row = resolveServer(address)
      if (row) joinIfAllowed(row)
    },
  }
}
