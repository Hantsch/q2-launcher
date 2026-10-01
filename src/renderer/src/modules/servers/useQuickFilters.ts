import { useCallback, useEffect, useState } from 'react'
import type { QuickFiltersResult } from '@shared/modules/servers'
import type { QuickFilter, QuickFilterCriteria } from '@shared/servers/quick-filters'
import type { Outcome } from '@shared/types'
import { listQuickFilters, removeQuickFilter, renameQuickFilter, saveQuickFilter } from './client'

export interface UseQuickFiltersResult {
  list: QuickFilter[]
  save: (input: { name: string; criteria: QuickFilterCriteria; overwrite: boolean }) => Promise<QuickFiltersResult>
  rename: (input: { id: string; name: string }) => Promise<QuickFiltersResult>
  remove: (id: string) => Promise<QuickFiltersResult>
}

const TRANSPORT_FAILED: QuickFiltersResult = { ok: false, reasonKey: 'servers.quickFilter.error.failed' }

/**
 * Story 197 D3: the saved quick filters. A one-shot read on mount (a failed read leaves `[]` and
 * never toasts - the chips are an extra, not the list); each mutation applies its own successful
 * list immediately and returns the result so the caller can show a refusal's reason key.
 */
export function useQuickFilters(): UseQuickFiltersResult {
  const [list, setList] = useState<QuickFilter[]>([])

  useEffect(() => {
    let cancelled = false
    void listQuickFilters().then((result) => {
      if (!cancelled && result.ok) setList(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const settle = useCallback((outcome: Outcome<QuickFiltersResult>): QuickFiltersResult => {
    if (!outcome.ok) return TRANSPORT_FAILED
    if (outcome.value.ok) setList(outcome.value.list)
    return outcome.value
  }, [])

  const save = useCallback(
    async (input: { name: string; criteria: QuickFilterCriteria; overwrite: boolean }) =>
      settle(await saveQuickFilter(input)),
    [settle],
  )
  const rename = useCallback(
    async (input: { id: string; name: string }) => settle(await renameQuickFilter(input)),
    [settle],
  )
  const remove = useCallback(async (id: string) => settle(await removeQuickFilter(id)), [settle])

  return { list, save, rename, remove }
}
