import { useEffect, useState } from 'react'
import { useLauncher } from '../../store/useLauncher'

/**
 * Whether this user is currently asking for less motion (story 083 D3).
 *
 * Deliberately *not* a second reduced-motion concept. `settings.motion` is the launcher's own
 * three-way setting (`system` | `reduced` | `full`) and already the single source of truth: the
 * store mirrors it, `App.tsx` writes it onto `<html data-motion>`, and `styles/index.css` zeroes
 * `--dur-*` from there in both directions. This hook reads the very same store value and applies
 * the very same precedence - the setting overrides the OS, `system` defers to it - so the CSS and
 * the carousel can never disagree about what the user asked for.
 *
 * What the `data-motion` mechanism cannot do is stop a *timer*: zeroed transition durations still
 * leave an 8-second interval rewriting the screen. That is the only reason this exists as a
 * JavaScript-readable boolean, and it is what the carousel feeds into `setReducedMotion` so
 * `isRunning` (`carousel.ts`) refuses to run at all.
 */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function queryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(REDUCE_QUERY)
}

export function useReducedMotion(): boolean {
  const motion = useLauncher((state) => state.settings.motion)
  const [systemReduced, setSystemReduced] = useState(() => queryList()?.matches ?? false)

  useEffect(() => {
    // Only `system` defers to the OS, so nothing is listened to while the setting decides on its
    // own - and the OS state is re-read on the way back into `system` rather than trusted from
    // whenever the last listener happened to run.
    if (motion !== 'system') return
    const list = queryList()
    if (!list) return
    setSystemReduced(list.matches)
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [motion])

  if (motion === 'reduced') return true
  if (motion === 'full') return false
  return systemReduced
}
