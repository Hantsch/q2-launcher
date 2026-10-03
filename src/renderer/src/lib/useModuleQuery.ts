import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalizedMessage, Outcome, Refusal } from '@shared/types/common'

export type ModuleQueryState = 'loading' | 'error' | 'success'

export interface UseModuleQueryOptions<T> {
  /** Main-to-renderer push; returns the unsubscribe. Called once per `deps` cycle. */
  subscribe?: (push: (value: T) => void) => () => void
  /** The effect re-runs when these change (default: never). */
  deps?: unknown[]
}

export interface UseModuleQueryResult<T> {
  state: ModuleQueryState
  /** Kept across reload and error so a refetch does not blank a filled view. */
  data: T | undefined
  error: LocalizedMessage | null
  reload: () => void
  /** Applies a value main already returned (e.g. a mutation's result) without a re-read. */
  setData: (next: T) => void
}

const UNREACHABLE: LocalizedMessage = { key: 'ipc.error.unreachable' }

/**
 * Reads main-owned data. `read`/`subscribe` identities come from refs, so inline arrows are fine.
 * Every run has a generation: a response from an older run, or one arriving after unmount, is
 * dropped. A push or `setData` supersedes a still-pending read of the same cycle.
 */
export function useModuleQuery<T>(
  read: () => Promise<Outcome<T>>,
  options: UseModuleQueryOptions<T> = {},
): UseModuleQueryResult<T> {
  const readRef = useRef(read)
  readRef.current = read
  const subscribeRef = useRef(options.subscribe)
  subscribeRef.current = options.subscribe

  const [state, setState] = useState<ModuleQueryState>('loading')
  const [data, setDataState] = useState<T | undefined>(undefined)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  // Bumped by `setData`: a read that started before it must not overwrite the applied value.
  const applied = useRef(0)

  const deps = options.deps ?? []
  useEffect(() => {
    const mine = ++generation.current
    let disposed = false
    const live = (): boolean => !disposed && generation.current === mine
    // A push makes this cycle's still-pending read stale.
    let pushed = false
    const appliedAtStart = applied.current
    const superseded = (): boolean => pushed || applied.current !== appliedAtStart
    setState('loading')
    setError(null)

    const unsubscribe = subscribeRef.current?.((value) => {
      if (!live()) return
      pushed = true
      setDataState(value)
      setError(null)
      setState('success')
    })

    readRef
      .current()
      .then((outcome) => {
        if (!live() || superseded()) return
        if (outcome.ok) {
          setDataState(outcome.value)
          setError(null)
          setState('success')
        } else {
          setError(outcome.error)
          setState('error')
        }
      })
      .catch(() => {
        if (!live() || superseded()) return
        setError(UNREACHABLE)
        setState('error')
      })

    return () => {
      disposed = true
      unsubscribe?.()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deps are caller-supplied by design
  }, [attempt, ...deps])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const setData = useCallback((next: T) => {
    applied.current++
    setDataState(next)
    setError(null)
    setState('success')
  }, [])

  return { state, data, error, reload, setData }
}

export interface UseModuleMutationResult<I, R> {
  run: (input: I) => Promise<R | undefined>
  busy: boolean
  error: LocalizedMessage | null
  clearError: () => void
}

function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false
}

/** Runs a mutation whose value may be a domain refusal; transport failures never reach the caller as a throw. */
export function useModuleMutation<I, R>(
  apply: (input: I) => Promise<Outcome<R>>,
  toKey?: (refusal: Extract<R, { ok: false }>) => LocalizedMessage,
): UseModuleMutationResult<I, R> {
  const applyRef = useRef(apply)
  applyRef.current = apply
  const toKeyRef = useRef(toKey)
  toKeyRef.current = toKey

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async (input: I): Promise<R | undefined> => {
    setError(null)
    setBusy(true)
    let result: R | undefined
    let failure: LocalizedMessage | null = null
    try {
      const outcome = await applyRef.current(input)
      if (!outcome.ok) {
        failure = outcome.error
      } else {
        result = outcome.value
        if (isRefusal(result)) {
          const refusal = result as Extract<R, { ok: false }>
          failure = toKeyRef.current
            ? toKeyRef.current(refusal)
            : { key: result.reasonKey, ...(result.params ? { params: result.params } : {}) }
        }
      }
    } catch {
      failure = UNREACHABLE
    }
    if (mounted.current) {
      setError(failure)
      setBusy(false)
    }
    return result
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { run, busy, error, clearError }
}
