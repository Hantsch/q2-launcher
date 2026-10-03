import { useCallback, useRef } from 'react'
import type { Outcome } from '@shared/types/common'
import { useModuleQuery } from './useModuleQuery'

/**
 * A persisted list sort. A failed read or write falls back to `null` (the default order); a
 * write shows `next` at once and then adopts the value main echoes back.
 */
export function useListSort<S>(
  get: () => Promise<Outcome<S | null>>,
  set: (next: S | null) => Promise<Outcome<S | null>>,
): { sort: S | null; setSort: (next: S | null) => void } {
  const { data, setData } = useModuleQuery(get)
  const setRef = useRef(set)
  setRef.current = set

  const setSort = useCallback(
    (next: S | null): void => {
      setData(next)
      setRef
        .current(next)
        .then((result) => setData(result.ok ? result.value : null))
        .catch(() => setData(null))
    },
    [setData],
  )

  return { sort: data ?? null, setSort }
}
