import { useCallback, useRef, useState } from 'react'

/**
 * Guards an async submit against re-entry. The ref (not the state) is the gate: two calls in the
 * same tick both see the pre-render `submitting` value, so only a ref can make the second one
 * a no-op.
 */
export function useSubmitting(): {
  submitting: boolean
  run: <T>(fn: () => Promise<T> | T) => Promise<T | undefined>
} {
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  const run = useCallback(async <T>(fn: () => Promise<T> | T): Promise<T | undefined> => {
    if (inFlight.current) return undefined
    inFlight.current = true
    setSubmitting(true)
    try {
      return await fn()
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }, [])

  return { submitting, run }
}
