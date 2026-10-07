import { useCallback, useEffect, useState } from 'react'

/**
 * Story 187: the cinema overlay's controls fade out after `idleMs` without input. `hold`
 * (bar hovered, demo paused) keeps them up; releasing the hold starts a fresh idle period.
 * `show()` is the "there was input" signal (mouse move, key, click on the picture).
 */
export function useIdleFade(idleMs: number, hold: boolean): { visible: boolean; show: () => void } {
  const [visible, setVisible] = useState(true)
  // Bumped by every input so the timer below restarts.
  const [activity, setActivity] = useState(0)

  const show = useCallback(() => {
    setVisible(true)
    setActivity((n) => n + 1)
  }, [])

  useEffect(() => {
    if (hold) {
      setVisible(true)
      return
    }
    const handle = setTimeout(() => setVisible(false), idleMs)
    return () => clearTimeout(handle)
  }, [idleMs, hold, activity])

  return { visible, show }
}
