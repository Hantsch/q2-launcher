import { useEffect, useState } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppShell } from './components/shell/AppShell'
import { BootSplash } from './components/shell/BootSplash'
import { useLauncher } from './store/useLauncher'

/**
 * How long the boot splash stays up at minimum.
 *
 * Bootstrap usually answers in well under 100ms, which would make the title
 * card a flicker. Holding it briefly is the point of having one; lower this to
 * 0 to hand the window over as fast as possible.
 */
const SPLASH_MIN_MS = 900

export function App() {
  const ready = useLauncher((state) => state.ready)
  const bootstrap = useLauncher((state) => state.bootstrap)
  const motion = useLauncher((state) => state.settings.motion)
  const [splashHeld, setSplashHeld] = useState(SPLASH_MIN_MS > 0)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (!splashHeld) return
    const timer = window.setTimeout(() => setSplashHeld(false), SPLASH_MIN_MS)
    return () => window.clearTimeout(timer)
  }, [splashHeld])

  // The CSS reads this to override the OS motion preference in either direction.
  useEffect(() => {
    if (motion === 'system') delete document.documentElement.dataset['motion']
    else document.documentElement.dataset['motion'] = motion
  }, [motion])

  if (!ready || splashHeld) return <BootSplash />

  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}
