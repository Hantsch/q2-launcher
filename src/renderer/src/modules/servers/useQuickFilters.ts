import { useCallback } from 'react'
import type { QuickFiltersResult } from '@shared/modules/servers'
import type { QuickFilter, QuickFilterCriteria } from '@shared/servers/quick-filters'
import type { Outcome } from '@shared/types'
import { useModuleMutation, useModuleQuery } from '../../lib/useModuleQuery'
import { listQuickFilters, removeQuickFilter, renameQuickFilter, saveQuickFilter } from './client'

export interface UseQuickFiltersResult {
  list: QuickFilter[]
  save: (input: {
    name: string
    criteria: QuickFilterCriteria
    overwrite: boolean
  }) => Promise<QuickFiltersResult>
  rename: (input: { id: string; name: string }) => Promise<QuickFiltersResult>
  remove: (id: string) => Promise<QuickFiltersResult>
}

const EMPTY: QuickFilter[] = []

const TRANSPORT_FAILED: QuickFiltersResult = {
  ok: false,
  reasonKey: 'servers.quickFilter.error.failed',
}

/**
 * Story 197: the saved quick filters. A one-shot read on mount (a failed read leaves `[]` and
 * never toasts - the chips are an extra, not the list); each mutation applies its own successful
 * list immediately and returns the result so the caller can show a refusal's reason key.
 */
export function useQuickFilters(): UseQuickFiltersResult {
  const query = useModuleQuery(listQuickFilters)
  const { setData } = query
  const mutation = useModuleMutation((action: () => Promise<Outcome<QuickFiltersResult>>) =>
    action(),
  )
  const { run } = mutation

  const settle = useCallback(
    async (action: () => Promise<Outcome<QuickFiltersResult>>): Promise<QuickFiltersResult> => {
      const result = await run(action)
      if (!result) return TRANSPORT_FAILED
      if (result.ok) setData(result.list)
      return result
    },
    [run, setData],
  )

  const save = useCallback(
    (input: { name: string; criteria: QuickFilterCriteria; overwrite: boolean }) =>
      settle(() => saveQuickFilter(input)),
    [settle],
  )
  const rename = useCallback(
    (input: { id: string; name: string }) => settle(() => renameQuickFilter(input)),
    [settle],
  )
  const remove = useCallback((id: string) => settle(() => removeQuickFilter(id)), [settle])

  return { list: query.data ?? EMPTY, save, rename, remove }
}
